import { randomUUID } from 'node:crypto';
import type { ClientEvent, NotificationSettings, ProgramActivity, Selection, SessionView } from '../../src/shared/types.js';
import {badgeAllowed,desktopAllowed,noticeAllowed} from './notifications.js';

type Target = Selection & { blockId: string };
type PaneActivity = { records: Map<string, ProgramActivity>; title?: string; program?: string; cwd?:string };
type NotificationEvent = Extract<ClientEvent, { type: 'notification' }>;
const states = new Set(['idle', 'working', 'blocked', 'error', 'done']);
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown, limit = 2048): string | undefined => typeof value === 'string' && value ? value.slice(0, limit) : undefined;

export function parseActivity(value: unknown): ProgramActivity {
  const input = object(value);
  return {
    id: text(input.id) || '', state: states.has(input.state) ? input.state : 'idle',
    kind: text(input.kind), app: text(input.effective_app) || text(input.app),
    message: text(input.msg) || text(input.title),
    progress: typeof input.progress === 'number' && Number.isFinite(input.progress) ? Math.max(0, Math.min(100, input.progress)) : undefined,
    updatedAt: text(input.updated_at),
  };
}

/** Tracks all attached sessions, independently from which terminal is displayed. */
export class ActivityRegistry {
  private targets = new Map<string, Target>();
  private panes = new Map<string, PaneActivity>();
  private current?: Partial<Target> & { visible?: boolean };
  private unread = new Set<string>();
  constructor(private emit: (event: ClientEvent) => void, private notify: (event: NotificationEvent) => void, private preferences: () => NotificationSettings, private badge: (count:number)=>void = ()=>{}) {}
  setContext(context: Partial<Target> & { visible?: boolean }) {
    this.current = context;
    if (context.visible !== false) for (const key of this.unread) { const target=this.targets.get(key);if(target&&target.hostId===context.hostId&&target.sessionId===context.sessionId&&target.windowId===context.windowId)this.unread.delete(key); }
    this.publishBadge();
  }
  track(hostId: string, view: SessionView) {
    const valid = new Set<string>();
    for (const window of view.windows) for (const pane of window.panes) {
      const key = this.key(hostId, pane.id); valid.add(key);
      this.targets.set(key, { hostId, sessionId: view.id, windowId: window.id, blockId: pane.id });
      const activity = this.panes.get(key);
      if (activity) { pane.activities = [...activity.records.values()]; pane.title = activity.title; pane.program=activity.program; pane.cwd=activity.cwd; }
    }
    for (const [key, target] of this.targets) if (target.hostId === hostId && target.sessionId === view.id && !valid.has(key)) { this.targets.delete(key); this.panes.delete(key); this.unread.delete(key); }
    this.publishBadge();
  }
  seed(hostId: string, sessionId: string, blockId: string, status: unknown, title: unknown, process: unknown) {
    const pane = this.pane(hostId, blockId);
    if (pane.records.size === 0) for (const record of object(status).records ?? []) { const parsed = parseActivity(record); pane.records.set(parsed.id, parsed); }
    pane.title ??= text(object(title).title, 512);
    const foreground=object(process).foreground||object(process).child;
    pane.program ??= this.program(foreground);
    pane.cwd ??= text(object(foreground).cwd,4096);
    this.publish(hostId, sessionId, blockId, pane);
  }
  apply(hostId: string, sessionId: string, payload: unknown) {
    const event = object(payload);
    if (event.creator_name !== 'com.superlogical.terminal' || typeof event.block_id !== 'string') return;
    const blockId = event.block_id;
    const body = object(event.payload);
    const pane = this.pane(hostId, blockId);
    if (event.name === 'program_status_changed') {
      const record = parseActivity({ ...object(body.record), id: body.id ?? object(body.record).id });
      const previous = pane.records.get(record.id);
      pane.records.set(record.id, record);
      const key=this.key(hostId,blockId);
      if(this.isVisible(hostId,sessionId,blockId))this.unread.delete(key);
      else if(record.state!=='idle')this.unread.add(key);
      this.publishBadge();
      if (record.state !== 'idle' && record.state !== previous?.state) {
        this.notice(hostId, sessionId, blockId, record.state, this.label(record), record.message || record.app || 'Program activity changed');
      }
    } else if (event.name === 'program_status_removed') {
      for (const id of Array.isArray(body.ids) ? body.ids : []) pane.records.delete(id);
      if(!pane.records.size){this.unread.delete(this.key(hostId,blockId));this.publishBadge();}
    } else if (event.name === 'title_changed') pane.title = text(body.title, 512) || '';
    else if (event.name === 'process_changed') {pane.program = this.program(body.foreground||body.child);pane.cwd=text(object(body.foreground||body.child).cwd,4096);}
    else if (event.name === 'desktop_notification') {
      this.notice(hostId, sessionId, blockId, 'program', text(body.title, 256) || pane.program || 'Rex terminal', text(body.body, 4096) || '');
    } else return;
    this.publish(hostId, sessionId, blockId, pane);
  }
  clearHost(hostId: string) {
    for (const [key, target] of this.targets) if (target.hostId === hostId) { this.targets.delete(key); this.panes.delete(key); this.unread.delete(key); }
    this.publishBadge();
  }
  isIdle(){return ![...this.panes.values()].some(pane=>[...pane.records.values()].some(record=>record.state==='working'||record.state==='blocked'));}
  private notice(hostId: string, sessionId: string, blockId: string, kind: NotificationEvent['kind'], title: string, body: string) {
    const settings = this.preferences();
    if (!noticeAllowed(settings,kind)) return;
    const target = this.targets.get(this.key(hostId, blockId));
    const visible = this.isVisible(hostId,sessionId,blockId);
    if (visible && kind !== 'program') return;
    const event: NotificationEvent = { type: 'notification', id: randomUUID(), hostId, sessionId, blockId, windowId: target?.windowId, title, body, kind };
    this.emit(event); if(desktopAllowed(settings,kind))this.notify(event);
  }
  private pane(hostId: string, blockId: string) {
    const key = this.key(hostId, blockId);
    let value = this.panes.get(key);
    if (!value) { value = { records: new Map() }; this.panes.set(key, value); }
    return value;
  }
  private publish(hostId: string, sessionId: string, blockId: string, pane: PaneActivity) {
    this.emit({ type: 'activity', hostId, sessionId, blockId, activities: [...pane.records.values()], title: pane.title, program: pane.program, cwd:pane.cwd });
  }
  private program(foreground: unknown) {
    const p = object(foreground);
    const value = text(p.script) || text(p.argv0) || text(p.name);
    return value?.split('/').at(-1)?.replace(/^-/, '');
  }
  private label(record: ProgramActivity) {
    if (record.state === 'blocked') return record.kind === 'permission' ? 'Needs approval' : record.kind === 'auth' ? 'Needs sign-in' : record.kind === 'question' ? 'Question' : 'Needs input';
    return record.state === 'error' ? 'Program failed' : record.state === 'done' ? 'Program finished' : 'Program started working';
  }
  private key(hostId: string, blockId: string) { return `${hostId}/${blockId}`; }
  private isVisible(hostId:string,sessionId:string,blockId:string){const target=this.targets.get(this.key(hostId,blockId));return this.current?.visible!==false&&this.current?.hostId===hostId&&this.current?.sessionId===sessionId&&this.current?.windowId===target?.windowId;}
  private publishBadge(){const settings=this.preferences();const tabs=new Set<string>();for(const key of this.unread)if([...this.panes.get(key)?.records.values()??[]].some(record=>badgeAllowed(settings,record.state))){const target=this.targets.get(key);tabs.add(target?JSON.stringify([target.hostId,target.sessionId,target.windowId]):key);}this.badge(tabs.size);}
}
