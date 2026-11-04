import { existsSync } from 'node:fs';
import { normalizeView } from './normalize.js';
import { parseServerVersion } from './server-version.js';
import { parseSavedHosts, type SavedHost } from './saved-hosts.js';
export type { SavedHost } from './saved-hosts.js';
import { parseCreatedSession, parseSessionList } from './session-summary.js';
import { RexControl, localEndpoint, type RexCredentials } from './control.js';
import { RexTerminalStream, type FrameKind, type FrameSize } from './stream.js';
import type { Host as RexHost, SessionSummary, SessionView, ServerStatus, RexMethods, PaneRect } from '../../src/shared/types.js';

export type { Host as RexHost } from '../../src/shared/types.js';
type Ref = { host: RexHost; sessionId: string; blockId: string };
type Capture = { content: string; id?: number; total?: number };
type InputQueue = { tail: Promise<void>; generation: number };
type Dimensions = Ref & { columns: number; rows: number };
type ControlConnection = { pending: Promise<RexControl>; control?: RexControl };
type PaneDirection = RexMethods['movePane']['args']['direction'];

function panePlacement(direction: PaneDirection): { direction: 'horizontal' | 'vertical'; side: 'before' | 'after' } {
  return {
    direction: direction === 'above' || direction === 'below' ? 'vertical' : 'horizontal',
    side: direction === 'left' || direction === 'above' ? 'before' : 'after',
  };
}

const MAX_SNAPSHOT = 256 * 1024 * 1024;

function replyRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
function optionalCount(value: unknown, message: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(message);
  return value;
}
function captureReply(value: unknown): Capture {
  const message = 'Rex returned an invalid terminal snapshot.';
  const result = replyRecord(value, message);
  if (typeof result.content !== 'string') throw new Error(message);
  return { content: result.content, id: optionalCount(result.id, message), total: optionalCount(result.total, message) };
}
function capturePage(value: unknown): { data: string; eof: boolean } {
  const message = 'Rex returned an invalid terminal snapshot page.';
  const result = replyRecord(value, message);
  if (typeof result.data !== 'string' || (result.eof !== undefined && typeof result.eof !== 'boolean')) throw new Error(message);
  return { data: result.data, eof: result.eof ?? false };
}

export interface RexServiceOptions { apiRevisions?: { min: number; max: number }; controlFactory?: (endpoint: string, credentials?: RexCredentials, reconnectToken?: string, revisions?: { min: number; max: number }) => RexControl; credentials?: (host: RexHost) => Promise<RexCredentials | undefined>; onControl?: (host: RexHost, control: RexControl) => void | Promise<void>; onMetadata?: (host: RexHost, sessionId: string, blockId: string, metadata: Record<string, unknown>) => void }

export class RexService {
  private subscriptions = new Map<() => void, RexHost>();
  private inputQueues = new Map<string, InputQueue>();
  private disposed = false;
  private controls = new Map<string, ControlConnection>();
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
      const version = parseServerVersion(await control.call('server.version', {}));
      return { connected: true, endpoint: control.endpoint, version };
    } catch (error) { return { connected: false, endpoint: effectiveEndpoint(host.endpoint) || localEndpoint(), error: errorMessage(error) }; }
  }

  async sessions(host: RexHost): Promise<SessionSummary[]> {
    return parseSessionList(await this.call(host, 'session.list', {}));
  }

  async inspect(host: RexHost, sessionId: string): Promise<SessionView> {
    return normalizeView(await this.call(host, 'session.view', { session_id: sessionId }));
  }

  async createSession(host: RexHost, label: string, cwd?: string, command?: string): Promise<string> {
    const response = await this.call(host, 'session.create', {
      label, initial_windows: [{ window_label: 'Shell', layout: shellLayout(cwd, command) }],
    });
    return parseCreatedSession(response);
  }

  async createTutorial(host: RexHost): Promise<{ sessionId: string; windowId: string; blockId: string }> {
    const sessionId = parseCreatedSession(await this.call(host, 'session.create', {
      label: 'Rex tutorial',
      initial_windows: [{ window_label: 'Getting started', layout: { block: { flavor: 'com.superlogical.onboarding.onboarding', options: {} } } }],
    }));
    try {
      const view = await this.inspect(host, sessionId);
      const first = view.windows[0];
      const pane = first?.panes[0];
      if (!first || !pane) throw new Error('The Rex tutorial did not create a usable pane.');
      return { sessionId, windowId: first.id, blockId: pane.id };
    } catch (error) {
      await this.call(host, 'session.destroy', { session_id: sessionId }).catch(() => {});
      throw error;
    }
  }

  async createBlock(host: RexHost, sessionId: string, block: { flavor: string; options?: Record<string, unknown>; windowId?: string }): Promise<unknown> {
    const layout = { block: { flavor: block.flavor, options: block.options } };
    if (block.windowId) {
      const view = await this.inspect(host, sessionId);
      const window = view.windows.find(window => window.id === block.windowId);
      const anchor = window?.focusedBlockId || window?.panes[0]?.id;
      if (!anchor) throw new Error('The destination tab has no pane.');
      return this.call(host, 'session.new_split', { session_id: sessionId, anchor_id: anchor, direction: 'horizontal', side: 'after', layout, focus: true });
    }
    return this.call(host, 'session.new_window', { session_id: sessionId, layout, focus: true });
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

  reorderWindow(host: RexHost, sessionId: string, windowId: string, beforeWindowId?: string) {
    return this.call(host, 'session.move_window', {
      session_id: sessionId, window_id: windowId,
      ...(beforeWindowId ? { before_window_id: beforeWindowId } : {}),
    });
  }

  resizeDivider(host: RexHost, sessionId: string, divider: Pick<RexMethods['resizeDivider']['args'], 'beforeBlockId' | 'afterBlockId' | 'direction' | 'ratio'>) {
    return this.call(host, 'session.resize_pane', {
      session_id: sessionId, before_block_id: divider.beforeBlockId,
      after_block_id: divider.afterBlockId, direction: divider.direction, ratio: divider.ratio,
    });
  }

  resizeLayer(host: RexHost, sessionId: string, layerId: string, bounds: PaneRect) {
    return this.call(host, 'session.resize_layer', { session_id: sessionId, layer_id: layerId, bounds });
  }

  movePane(host: RexHost, sessionId: string, blockId: string, move: Pick<RexMethods['movePane']['args'], 'anchorBlockId' | 'direction'>) {
    return this.call(host, 'session.move_block', {
      session_id: sessionId, block_id: blockId, anchor_block_id: move.anchorBlockId,
      ...panePlacement(move.direction),
    });
  }

  swapPanes(host: RexHost, sessionId: string, blockId: string, otherBlockId: string) {
    return this.call(host, 'session.swap_blocks', { session_id: sessionId, block_id: blockId, other_block_id: otherBlockId });
  }

  async split(host: RexHost, sessionId: string, blockId: string, direction: 'right' | 'below' | 'left' | 'above', options: { cwd?: string; ratio?: number; command?: string } = {}) {
    const { cwd, ratio, command } = options;
    await this.call(host, 'session.new_split', {
      session_id: sessionId, anchor_id: blockId, ...panePlacement(direction),
      layout: shellLayout(cwd, command), focus: true, ...(ratio !== undefined ? { ratio } : {}),
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
    const capture = captureReply(await this.block(host, sessionId, blockId, 'format', {
      format: 'vt', max_bytes: 983040, extra_cursor: true, extra_modes: true,
      extra_style: true, extra_scrolling_region: true, extra_tabstops: true,
    }));
    if ((capture.total ?? 0) > MAX_SNAPSHOT) throw new Error('Terminal scrollback exceeds the 256 MiB snapshot limit. Clear its scrollback in Rex before reconnecting.');
    let content = capture.content;
    let offset = Buffer.byteLength(content);
    if (offset > MAX_SNAPSHOT) throw new Error('Terminal scrollback exceeds the 256 MiB snapshot limit.');
    while (capture.id !== undefined && offset < (capture.total ?? Infinity)) {
      const part = capturePage(await this.block(host, sessionId, blockId, 'blob_read', { id: capture.id, offset, max_bytes: 983040 }));
      if (!part.data.length) throw new Error('Rex returned an incomplete terminal snapshot.');
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
    this.subscriptions.set(stop, host);
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
    for (const stop of [...this.subscriptions.keys()]) stop();
    this.inputQueues.clear();
    this.dimensions.clear();
    this.visible.clear();
    for (const connection of this.controls.values()) {
      connection.control?.dispose();
      void connection.pending.then(control => control.dispose()).catch(() => {});
    }
    this.controls.clear();
  }

  async control(host: RexHost): Promise<RexControl> {
    if (this.disposed) throw new Error('Rex client has been closed.');
    const key = JSON.stringify([host.id, host.endpoint]);
    const existing = this.controls.get(key);
    if (existing) {
      try {
        const control = await existing.pending;
        this.assertConnectionCurrent(key, existing);
        if (control.connected) return control;
      } catch (error) {
        // A waiter on a revoked attempt must not erase a newer connection or retry old work.
        if (this.disposed || this.controls.get(key) !== existing) throw error;
      }
      this.controls.delete(key);
    }
    const connection: ControlConnection = {
      pending: Promise.resolve().then(() => this.connect(host, key, connection)),
    };
    this.controls.set(key, connection);
    return connection.pending;
  }

  private assertConnectionCurrent(key: string, connection: ControlConnection): void {
    if (!this.disposed && this.controls.get(key) === connection) return;
    connection.control?.dispose();
    throw new Error(this.disposed ? 'Rex client has been closed.' : 'The Rex connection has been replaced or disconnected.');
  }

  private async connect(host: RexHost, key: string, connection: ControlConnection): Promise<RexControl> {
    this.assertConnectionCurrent(key, connection);
    const credentials = await this.options.credentials?.(host);
    this.assertConnectionCurrent(key, connection);
    const candidates = await this.resolveEndpoints(host);
    this.assertConnectionCurrent(key, connection);
    const preferred = this.preferredEndpoints.get(key);
    const endpoints = preferred && candidates.includes(preferred) ? [preferred, ...candidates.filter(endpoint => endpoint !== preferred)] : candidates;
    const implicit = !explicitEndpoint(effectiveEndpoint(host.endpoint));
    const protectedGateway = credentials && (credentials.username !== undefined || Boolean(credentials.password) || Boolean(credentials.token) || Object.keys(credentials.headers || {}).length > 0);
    let control: RexControl | undefined;
    let lastError: unknown;
    for (const endpoint of endpoints) {
      this.assertConnectionCurrent(key, connection);
      if (implicit && protectedGateway && /^(http|ws):\/\//.test(endpoint)) continue;
      const candidate = this.options.controlFactory
        ? this.options.controlFactory(endpoint, credentials, preferred === endpoint ? this.reconnectTokens.get(key) : undefined, this.options.apiRevisions)
        : new RexControl(endpoint, credentials, preferred === endpoint ? this.reconnectTokens.get(key) : undefined, this.options.apiRevisions);
      connection.control = candidate;
      try {
        const welcome = await candidate.readyPublic();
        this.assertConnectionCurrent(key, connection);
        if (welcome.client?.reconnect_token) this.reconnectTokens.set(key, welcome.client.reconnect_token);
        this.preferredEndpoints.set(key, endpoint);
        control = candidate; break;
      } catch (error) {
        candidate.dispose();
        this.assertConnectionCurrent(key, connection);
        connection.control = undefined;
        this.reconnectTokens.delete(key); lastError = error;
        if (/Unexpected server response: (401|403)/.test(errorMessage(error))) break;
      }
    }
    if (!control) throw lastError || new Error('No secure Rex endpoint could be reached. Enter an explicit HTTPS address.');
    try { await this.options.onControl?.(host, control); }
    catch (error) { control.dispose(); throw error; }
    this.assertConnectionCurrent(key, connection);
    // A reconnect discards the old client's viewport preferences. Restore
    // visible pane sizes before publishing another snapshot to the renderer.
    for (const [ref, dimensions] of this.dimensions) {
      this.assertConnectionCurrent(key, connection);
      if (dimensions.host.id !== host.id || dimensions.host.endpoint !== host.endpoint) continue;
      try {
        await control.attach(dimensions.sessionId);
        this.assertConnectionCurrent(key, connection);
        if (this.dimensions.get(ref) !== dimensions) continue;
        await control.call('session.own_block', { session_id: dimensions.sessionId, block_ids: [dimensions.blockId], mode: 'take' });
        this.assertConnectionCurrent(key, connection);
        await control.call('com.superlogical.terminal.resize', {
          session_id: dimensions.sessionId, block_id: dimensions.blockId,
          args: { columns: dimensions.columns, rows: dimensions.rows },
        });
      } catch (error) {
        this.assertConnectionCurrent(key, connection);
        if (!control.connected) { control.dispose(); throw error; }
        // A closed pane must not prevent other panes from reconnecting.
      }
    }
    this.assertConnectionCurrent(key, connection);
    return control;
  }

  reconnectTerminals() { for (const stream of this.streams.keys()) stream.reconnect(); }

  /** A removed or changed saved host must lose streams and control authority permanently. */
  disconnect(host: RexHost) {
    for (const [stop, owner] of this.subscriptions) if (owner.id === host.id && owner.endpoint === host.endpoint) stop();
    this.reconnect(host);
    this.preferredEndpoints.delete(JSON.stringify([host.id, host.endpoint]));
  }

  reconnect(host?: RexHost) {
    for (const [stream, owner] of this.streams) {
      if (!host || (owner.id === host.id && owner.endpoint === host.endpoint)) stream.reconnect();
    }
    for (const [key, connection] of this.controls) {
      if (host && key !== JSON.stringify([host.id, host.endpoint])) continue;
      this.controls.delete(key); this.reconnectTokens.delete(key);
      connection.control?.dispose();
      void connection.pending.then(control => control.dispose()).catch(() => {});
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
      try { await discovery.readyPublic(); aliases = parseSavedHosts(await discovery.call('hosts.list', {})); }
      catch { /* Try the documented remote hostname addresses below. */ }
      finally { discovery.dispose(); }
    }
    return expandEndpoint(endpoint, aliases);
  }

  /** Stop claiming a hidden pane's grid while retaining its image-bearing live stream. */
  async releaseViewport(host:RexHost,sessionId:string,blockId:string):Promise<void>{
    this.dimensions.delete(refKey({host,sessionId,blockId}));
    const key=JSON.stringify([host.id,host.endpoint]);
    const connection=this.controls.get(key);
    if(!connection||this.disposed)return;
    const control=await connection.pending;
    if(this.controls.get(key)!==connection)return;
    if(control.connected)await control.call('session.disown_block',{session_id:sessionId,block_ids:[blockId]});
  }

  private release(host: RexHost, sessionId: string, blockId: string) {
    const key = JSON.stringify([host.id, host.endpoint]);
    const connection = this.controls.get(key);
    if (!connection || this.disposed) return;
    void connection.pending.then(async control => {
      if (this.controls.get(key) !== connection) return;
      if (!control.connected || this.visible.has(refKey({ host, sessionId, blockId }))) return;
      await control.call('session.disown_block', { session_id: sessionId, block_ids: [blockId] });
    }).catch(() => {});
  }
}

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
