import { existsSync } from 'node:fs';
import { normalizeView } from './normalize.js';
import { RexControl, localEndpoint, type RexCredentials } from './control.js';
import { RexTerminalStream, type FrameKind, type FrameSize } from './stream.js';
import type { Host as RexHost, SessionSummary, SessionView, ServerStatus } from '../../src/shared/types.js';

export type { Host as RexHost } from '../../src/shared/types.js';
type Ref = { host: RexHost; sessionId: string; blockId: string };
type Capture = { content: string; id?: number; total?: number; eof?: boolean };
type InputQueue = { tail: Promise<void>; generation: number };
type Dimensions = Ref & { columns: number; rows: number };

const MAX_SNAPSHOT = 256 * 1024 * 1024;

export interface RexServiceOptions { apiRevisions?: { min: number; max: number }; controlFactory?: (endpoint: string, credentials?: RexCredentials, reconnectToken?: string, revisions?: { min: number; max: number }) => RexControl; credentials?: (host: RexHost) => Promise<RexCredentials | undefined>; onControl?: (host: RexHost, control: RexControl) => void | Promise<void>; onMetadata?: (host: RexHost, sessionId: string, blockId: string, metadata: Record<string, unknown>) => void }

export class RexService {
  private subscriptions = new Set<() => void>();
  private inputQueues = new Map<string, InputQueue>();
  private disposed = false;
  private controls = new Map<string, Promise<RexControl>>();
  private dimensions = new Map<string, Dimensions>();
  private visible = new Map<string, number>();
  private options: RexServiceOptions;
  private reconnectTokens = new Map<string, string>();
  private streams = new Map<RexTerminalStream, RexHost>();
  private preferredEndpoints = new Map<string, string>();

  constructor(options: RexServiceOptions = {}) { this.options = options; }

  configure(options: RexServiceOptions) { this.options = { ...this.options, ...options }; }
  async callMethod<T = unknown>(host: RexHost, method: string, payload: object = {}): Promise<T> { return this.call<T>(host, method, payload); }

  private call<T = unknown>(host: RexHost, method: string, payload: object): Promise<T> {
    return this.control(host).then(async control => {
      const sessionId = (payload as { session_id?: unknown }).session_id;
      if (typeof sessionId === 'string' && method !== 'session.attach' && method !== 'session.detach') await control.attach(sessionId);
      return control.call<T>(method, payload);
    });
  }

  private async block<T = unknown>(host: RexHost, sessionId: string, blockId: string, method: string, args: object): Promise<T> {
    const control = await this.control(host);
    await control.attach(sessionId);
    return control.call<T>(`com.superlogical.terminal.${method}`, { session_id: sessionId, block_id: blockId, args });
  }

  async status(host: RexHost): Promise<ServerStatus> {
    try {
      const control = await this.control(host);
      const result = await control.call<{ version?: string; rex_version?: string }>('server.version', {});
      return { connected: true, endpoint: control.endpoint, version: result.version || result.rex_version };
    } catch (error) { return { connected: false, endpoint: effectiveEndpoint(host.endpoint) || localEndpoint(), error: errorMessage(error) }; }
  }

  async sessions(host: RexHost): Promise<SessionSummary[]> {
    const result = await this.call<{ sessions?: { session_id: string; label?: string }[] }>(host, 'session.list', {});
    if (!Array.isArray(result.sessions)) throw new Error('Rex returned an invalid session list.');
    return result.sessions.map(session => ({ id: session.session_id, label: session.label || 'Untitled session' }));
  }

  async inspect(host: RexHost, sessionId: string): Promise<SessionView> {
    return normalizeView(await this.call(host, 'session.view', { session_id: sessionId }));
  }

  async createSession(host: RexHost, label: string, cwd?: string, command?: string): Promise<string> {
    const response = await this.call<{ session_id: string }>(host, 'session.create', {
      label, initial_windows: [{ window_label: 'Shell', layout: shellLayout(cwd, command) }],
    });
    return response.session_id;
  }

  async renameSession(host: RexHost, sessionId: string, label: string) {
    await this.call(host, 'session.set_label', { session_id: sessionId, label });
  }

  async createWindow(host: RexHost, sessionId: string, label = 'Shell', cwd?: string, command?: string) {
    await this.call(host, 'session.new_window', { session_id: sessionId, window_label: label, layout: shellLayout(cwd, command), focus: true });
  }

  async renameWindow(host: RexHost, sessionId: string, windowId: string, label: string) {
    await this.call(host, 'session.set_window_label', { session_id: sessionId, window_id: windowId, label });
  }

  async closeWindow(host: RexHost, sessionId: string, windowId: string) {
    await this.call(host, 'session.close_window', { session_id: sessionId, window_id: windowId });
  }

  async split(host: RexHost, sessionId: string, blockId: string, direction: 'right' | 'below' | 'left' | 'above', options: { cwd?: string; ratio?: number; command?: string } = {}) {
    const { cwd, ratio, command } = options;
    await this.call(host, 'session.new_split', {
      session_id: sessionId, anchor_id: blockId, direction: ['below', 'above'].includes(direction) ? 'vertical' : 'horizontal',
      side: ['left', 'above'].includes(direction) ? 'before' : 'after', layout: shellLayout(cwd, command), focus: true, ...(ratio !== undefined ? { ratio } : {}),
    });
  }

  async closeBlock(host: RexHost, sessionId: string, blockId: string) {
    await this.call(host, 'block.close', { session_id: sessionId, block_id: blockId });
  }

  async focusBlock(host: RexHost, sessionId: string, blockId: string) {
    const control = await this.control(host);
    await control.attach(sessionId);
    await control.call('session.own_block', { session_id: sessionId, block_ids: [blockId], mode: 'take' });
    await control.call('session.focus_block', { session_id: sessionId, block_id: blockId });
  }

  async focusWindow(host: RexHost, sessionId: string, windowId: string) {
    await this.call(host, 'session.focus_window', { session_id: sessionId, window_id: windowId });
  }

  async zoom(host: RexHost, sessionId: string, blockId: string) {
    await this.call(host, 'session.zoom_block', { session_id: sessionId, block_id: blockId });
  }

  async resize(host: RexHost, sessionId: string, blockId: string, columns: number, rows: number) {
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 || columns > 65535 || rows > 65535) {
      throw new Error('Terminal dimensions must be integers between 1 and 65535.');
    }
    const key = refKey({ host, sessionId, blockId });
    const dimensions = { host, sessionId, blockId, columns, rows };
    this.dimensions.set(key, dimensions);
    // One-shot CLI clients lose their requested size on disconnect. Keep the
    // documented control channel alive while this graphical client is open.
    const control = await this.control(host);
    await control.attach(sessionId);
    if (this.dimensions.get(key) !== dimensions) return;
    await control.call('session.own_block', { session_id: sessionId, block_ids: [blockId], mode: 'take' });
    await this.block(host, sessionId, blockId, 'resize', { columns, rows });
  }

  async terminalSize(host: RexHost, sessionId: string, blockId: string) {
    return this.block<{ columns: number; rows: number }>(host, sessionId, blockId, 'size', {});
  }

  async input(host: RexHost, sessionId: string, blockId: string, data: string): Promise<void> {
    if (!data) return;
    if (Buffer.byteLength(data) > 1024 * 1024) throw new Error('Paste is larger than the 1 MiB input limit.');
    const key = refKey({ host, sessionId, blockId });
    let queue = this.inputQueues.get(key);
    if (!queue) { queue = { tail: Promise.resolve(), generation: 0 }; this.inputQueues.set(key, queue); }
    const generation = queue.generation;
    const pending = queue.tail.then(async () => {
      if (queue.generation !== generation) throw new Error('Input discarded after the connection failed. Reconnect before typing again.');
      try {
        // This is a single request, never retried after an ambiguous failure.
        await this.block(host, sessionId, blockId, 'write', { data });
      } catch (error) { queue.generation++; throw error; }
    });
    const settled = pending.catch(() => {});
    queue.tail = settled;
    try { await pending; }
    finally { if (queue.tail === settled) this.inputQueues.delete(key); }
  }

  async capture(host: RexHost, sessionId: string, blockId: string): Promise<string> {
    const capture = await this.block<Capture>(host, sessionId, blockId, 'format', {
      format: 'vt', max_bytes: 983040, extra_cursor: true, extra_modes: true,
      extra_style: true, extra_scrolling_region: true, extra_tabstops: true,
    });
    if (typeof capture.content !== 'string') throw new Error('Rex returned an invalid terminal snapshot.');
    if ((capture.total ?? 0) > MAX_SNAPSHOT) throw new Error('Terminal scrollback exceeds the 256 MiB snapshot limit. Clear its scrollback in Rex before reconnecting.');
    let content = capture.content;
    let offset = Buffer.byteLength(content);
    while (capture.id !== undefined && offset < (capture.total ?? Infinity)) {
      const part = await this.block<{ data: string; eof: boolean }>(host, sessionId, blockId, 'blob_read', { id: capture.id, offset, max_bytes: 983040 });
      if (typeof part.data !== 'string' || !part.data.length) throw new Error('Rex returned an incomplete terminal snapshot.');
      content += part.data;
      offset += Buffer.byteLength(part.data);
      if (offset > MAX_SNAPSHOT) throw new Error('Terminal scrollback exceeds the 256 MiB snapshot limit.');
      if (part.eof) break;
    }
    return content;
  }

  /** Only mounted panes subscribe; output is pushed by the Rex data connection. */
  subscribe(host: RexHost, sessionId: string, blockId: string, onFrame: (data: string, kind?: FrameKind, size?: FrameSize) => void, onError: (error: string) => void): () => void {
    const key = refKey({ host, sessionId, blockId });
    this.visible.set(key, (this.visible.get(key) ?? 0) + 1);
    let stopped = false;
    let stream: RexTerminalStream | undefined;
    const stop = () => {
      if (stopped) return;
      stream?.dispose(); if (stream) this.streams.delete(stream);
      stopped = true;
      this.subscriptions.delete(stop);
      const remaining = (this.visible.get(key) ?? 1) - 1;
      if (remaining > 0) { this.visible.set(key, remaining); return; }
      this.visible.delete(key);
      this.dimensions.delete(key);
      this.release(host, sessionId, blockId);
    };
    this.subscriptions.add(stop);
    stream = new RexTerminalStream(() => this.control(host), sessionId, blockId, {
        frame: (data, kind, size) => { if (!stopped && !this.disposed) onFrame(data, kind, size); },
        error: error => { if (!stopped && !this.disposed) onError(error); },
        metadata: metadata => this.options.onMetadata?.(host, sessionId, blockId, metadata),
      });
    this.streams.set(stream, host);
    return stop;
  }

  dispose() {
    this.disposed = true;
    for (const stop of [...this.subscriptions]) stop();
    this.inputQueues.clear();
    this.dimensions.clear();
    this.visible.clear();
    for (const pending of this.controls.values()) void pending.then(control => control.dispose()).catch(() => {});
    this.controls.clear();
  }

  async control(host: RexHost): Promise<RexControl> {
    if (this.disposed) throw new Error('Rex client has been closed.');
    const key = JSON.stringify([host.id, host.endpoint]);
    const existing = this.controls.get(key);
    if (existing) {
      try { const control = await existing; if (control.connected) return control; }
      catch { /* A new explicit resize may establish a new connection. */ }
      this.controls.delete(key);
    }
    const pending = (async () => {
      const credentials = await this.options.credentials?.(host);
      const candidates = await this.resolveEndpoints(host);
      const preferred = this.preferredEndpoints.get(key);
      const endpoints = preferred && candidates.includes(preferred) ? [preferred, ...candidates.filter(endpoint => endpoint !== preferred)] : candidates;
      const implicit = !explicitEndpoint(effectiveEndpoint(host.endpoint));
      const protectedGateway = credentials && (credentials.username !== undefined || Boolean(credentials.password) || Boolean(credentials.token) || Object.keys(credentials.headers || {}).length > 0);
      let control: RexControl | undefined;
      let lastError: unknown;
      for (const endpoint of endpoints) {
        if (implicit && protectedGateway && /^(http|ws):\/\//.test(endpoint)) continue;
        const candidate = this.options.controlFactory
          ? this.options.controlFactory(endpoint, credentials, preferred === endpoint ? this.reconnectTokens.get(key) : undefined, this.options.apiRevisions)
          : new RexControl(endpoint, credentials, preferred === endpoint ? this.reconnectTokens.get(key) : undefined, this.options.apiRevisions);
        try {
          const welcome = await candidate.readyPublic();
          if (welcome.client?.reconnect_token) this.reconnectTokens.set(key, welcome.client.reconnect_token);
          this.preferredEndpoints.set(key, endpoint);
          control = candidate; break;
        } catch (error) {
          candidate.dispose(); this.reconnectTokens.delete(key); lastError = error;
          if (/Unexpected server response: (401|403)/.test(errorMessage(error))) break;
        }
      }
      if (!control) throw lastError || new Error('No secure Rex endpoint could be reached. Enter an explicit HTTPS address.');
      await this.options.onControl?.(host, control);
      if (this.disposed) { control.dispose(); throw new Error('Rex client has been closed.'); }
      // A reconnect discards the old client's viewport preferences. Restore
      // visible pane sizes before publishing another snapshot to the renderer.
      for (const [key, dimensions] of this.dimensions) {
        if (dimensions.host.id !== host.id || dimensions.host.endpoint !== host.endpoint) continue;
        try {
          await control.attach(dimensions.sessionId);
          if (this.dimensions.get(key) !== dimensions) continue;
          await control.call('session.own_block', { session_id: dimensions.sessionId, block_ids: [dimensions.blockId], mode: 'take' });
          await control.call('com.superlogical.terminal.resize', {
            session_id: dimensions.sessionId, block_id: dimensions.blockId,
            args: { columns: dimensions.columns, rows: dimensions.rows },
          });
        } catch (error) {
          if (!control.connected) { control.dispose(); throw error; }
          // A closed pane must not prevent other panes from reconnecting.
        }
      }
      return control;
    })();
    this.controls.set(key, pending);
    return pending;
  }

  reconnectTerminals() { for (const stream of this.streams.keys()) stream.reconnect(); }

  reconnect(host?: RexHost) {
    for (const [stream, owner] of this.streams) {
      if (!host || (owner.id === host.id && owner.endpoint === host.endpoint)) stream.reconnect();
    }
    for (const [key, pending] of this.controls) {
      if (host && key !== JSON.stringify([host.id, host.endpoint])) continue;
      void pending.then(control => control.dispose()).catch(() => {}); this.controls.delete(key); this.reconnectTokens.delete(key);
    }
  }

  private async resolveEndpoints(host: RexHost): Promise<string[]> {
    const endpoint = effectiveEndpoint(host.endpoint);
    if (!endpoint) return [localEndpoint()];
    if (explicitEndpoint(endpoint)) return expandEndpoint(endpoint);
    let aliases: SavedHost[] = [];
    // Alias lookup is optional: a remote connection must not depend on a
    // running local server, and this temporary discovery client owns no pane.
    if (existsSync(localEndpoint().slice(7))) {
      const discovery = this.options.controlFactory ? this.options.controlFactory(localEndpoint(), undefined, undefined, this.options.apiRevisions) : new RexControl(localEndpoint(), undefined, undefined, this.options.apiRevisions);
      try { await discovery.readyPublic(); aliases = (await discovery.call<{ hosts?: SavedHost[] }>('hosts.list', {})).hosts || []; }
      catch { /* Try the documented remote hostname addresses below. */ }
      finally { discovery.dispose(); }
    }
    return expandEndpoint(endpoint, aliases);
  }

  /** Stop claiming a hidden pane's grid while retaining its image-bearing live stream. */
  async releaseViewport(host:RexHost,sessionId:string,blockId:string):Promise<void>{
    this.dimensions.delete(refKey({host,sessionId,blockId}));
    const pending=this.controls.get(JSON.stringify([host.id,host.endpoint]));
    if(!pending||this.disposed)return;
    const control=await pending;
    if(control.connected)await control.call('session.disown_block',{session_id:sessionId,block_ids:[blockId]});
  }

  private release(host: RexHost, sessionId: string, blockId: string) {
    const pending = this.controls.get(JSON.stringify([host.id, host.endpoint]));
    if (!pending || this.disposed) return;
    void pending.then(async control => {
      if (!control.connected || this.visible.has(refKey({ host, sessionId, blockId }))) return;
      await control.call('session.disown_block', { session_id: sessionId, block_ids: [blockId] });
    }).catch(() => {});
  }
}

export interface SavedHost { label: string; endpoints?: string[]; endpoint?: string; address?: string; url?: string }
/** An explicit saved endpoint takes precedence over the process-wide default. */
export function effectiveEndpoint(endpoint: string): string {
  return endpoint || process.env.REX_SERVER?.trim() || '';
}
function explicitEndpoint(value: string): boolean {
  return !value || /^(unix|wss?|https?|tcp):\/\//.test(value) || value.startsWith('/') || /^[^\s/:]+:\d+$/.test(value) || /^\[[^\]]+\]:\d+$/.test(value);
}
/** Resolve saved aliases before the documented implicit HTTPS/HTTP ports. */
export function expandEndpoint(value: string, aliases: SavedHost[] = [], seen = new Set<string>()): string[] {
  if (!value) return [localEndpoint()];
  if (/^(unix|wss?|https?|tcp):\/\//.test(value) || value.startsWith('/')) return [value];
  if (/^[^\s/:]+:\d+$/.test(value) || /^\[[^\]]+\]:\d+$/.test(value)) return [`ws://${value}`];
  const alias = aliases.find(host => host.label.toLowerCase() === value.toLowerCase());
  if (alias) {
    const key = alias.label.toLowerCase();
    if (seen.has(key) || seen.size > 8) throw new Error('Saved Rex host aliases form a cycle.');
    const next = new Set(seen).add(key);
    const addresses = alias.endpoints || [alias.endpoint || alias.address || alias.url || ''];
    const endpoints = addresses.filter(Boolean).flatMap(address => expandEndpoint(address, aliases, next));
    if (!endpoints.length) throw new Error('The saved Rex host has no endpoint.');
    return [...new Set(endpoints)];
  }
  let url: URL;
  try { url = new URL(`https://${value}`); }
  catch { throw new Error('Enter a hostname, saved Rex host, or explicit Unix/HTTPS/WSS endpoint.'); }
  if (!url.hostname || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Enter a hostname without a path or password. Save gateway credentials separately.');
  const first = url.href;
  url.port = '7297'; const second = url.href;
  url.protocol = 'http:'; const third = url.href;
  return [first, second, third];
}

export function parseCommand(command: string): string[] {
  const words: string[] = [];
  let word = '', quote = '', started = false;
  for (let index = 0; index < command.length; index++) {
    const character = command[index];
    if (character === '\\' && quote !== "'") {
      if (index + 1 >= command.length) throw new Error('Startup command ends with an unfinished escape.');
      const next = command[++index];
      if (quote === '"' && !['$', '`', '"', '\\', '\n'].includes(next)) word += '\\';
      word += next; started = true;
    } else if (quote) {
      if (character === quote) quote = ''; else word += character;
      started = true;
    } else if (character === "'" || character === '"') { quote = character; started = true; }
    else if (/\s/.test(character)) { if (started) { words.push(word); word = ''; started = false; } }
    else { word += character; started = true; }
  }
  if (quote) throw new Error('Startup command has an unfinished quote.');
  if (started) words.push(word);
  if (words.length && !words[0]) throw new Error('Startup command needs an executable.');
  return words;
}
function shellLayout(cwd?: string, command?: string) {
  const argv = command?.trim() ? parseCommand(command) : undefined;
  const options = { ...(cwd ? { cwd } : {}), ...(argv?.length ? { command: argv } : {}) };
  return { block: { flavor: 'com.superlogical.terminal.shell', ...(Object.keys(options).length ? { options } : {}) } };
}

function refKey(ref: Ref) { return JSON.stringify([ref.host.id, ref.host.endpoint, ref.sessionId, ref.blockId]); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Rex connection failed.'; }
