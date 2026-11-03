import { RexCommandRunner, type CommandRunner } from './command.js';
import { normalizeView } from './normalize.js';
import { RexControl } from './control.js';
import type { Host as RexHost, SessionSummary, SessionView, ServerStatus } from '../../src/shared/types.js';

export type { Host as RexHost } from '../../src/shared/types.js';
type Ref = { host: RexHost; sessionId: string; blockId: string };
type Capture = { content: string; id?: number; total?: number; eof?: boolean };
type InputQueue = { tail: Promise<void>; generation: number };
type Dimensions = Ref & { columns: number; rows: number };

const MAX_SNAPSHOT = 8 * 1024 * 1024;
const sleepInterval = 150;

export class RexService {
  private runner: RexCommandRunner;
  private run: CommandRunner;
  private subscriptions = new Set<() => void>();
  private inputQueues = new Map<string, InputQueue>();
  private disposed = false;
  private controls = new Map<string, Promise<RexControl>>();
  private customRunner: boolean;
  private dimensions = new Map<string, Dimensions>();
  private visible = new Map<string, number>();

  constructor(run?: CommandRunner) {
    this.runner = new RexCommandRunner();
    this.run = run ?? this.runner.run;
    this.customRunner = Boolean(run);
  }

  private args(host: RexHost, args: string[]) {
    return ['--autostart=false', '--timeout=4s', '--color=never', ...(host.endpoint ? ['--server', host.endpoint] : []), ...args];
  }

  private async command(host: RexHost, args: string[], stdin?: string) {
    if (this.disposed) throw new Error('Rex client has been closed.');
    return this.run(this.args(host, args), stdin);
  }

  private async json<T>(host: RexHost, args: string[], stdin?: string): Promise<T> {
    const output = await this.command(host, args, stdin);
    try { return JSON.parse(output) as T; }
    catch { throw new Error('Rex returned an invalid JSON response. The installed Rex version may be incompatible.'); }
  }

  private call<T = unknown>(host: RexHost, method: string, payload: object): Promise<T> {
    return this.json<T>(host, ['api', 'call', method, '-'], JSON.stringify(payload));
  }

  private async block<T = unknown>(host: RexHost, sessionId: string, blockId: string, method: string, args: object): Promise<T> {
    if (this.customRunner) return this.json<T>(host, ['block', 'call', '-s', sessionId, '-b', blockId, method, '-'], JSON.stringify(args));
    const control = await this.control(host);
    await control.attach(sessionId);
    return control.call<T>(`com.superlogical.terminal.${method}`, { session_id: sessionId, block_id: blockId, args });
  }

  async status(host: RexHost): Promise<ServerStatus> {
    try {
      const result = await this.json<{ endpoint?: string; rex_version?: string }>(host, ['whoami', '--json']);
      return { connected: true, endpoint: result.endpoint || host.endpoint || 'Local Rex', version: result.rex_version };
    } catch (error) {
      return { connected: false, endpoint: host.endpoint || 'Local Rex', error: errorMessage(error) };
    }
  }

  async sessions(host: RexHost): Promise<SessionSummary[]> {
    const result = await this.json<{ sessions?: { session_id: string; label?: string }[] }>(host, ['ls', '--json']);
    if (!Array.isArray(result.sessions)) throw new Error('Rex returned an invalid session list.');
    return result.sessions.map(session => ({ id: session.session_id, label: session.label || 'Untitled session' }));
  }

  async inspect(host: RexHost, sessionId: string): Promise<SessionView> {
    return normalizeView(await this.call(host, 'session.view', { session_id: sessionId }));
  }

  async createSession(host: RexHost, label: string, cwd?: string): Promise<string> {
    const response = await this.call<{ session_id: string }>(host, 'session.create', {
      label, initial_windows: [{ window_label: 'Shell', layout: shellLayout(cwd) }],
    });
    return response.session_id;
  }

  async renameSession(host: RexHost, sessionId: string, label: string) {
    await this.call(host, 'session.set_label', { session_id: sessionId, label });
  }

  async createWindow(host: RexHost, sessionId: string, label = 'Shell', cwd?: string) {
    await this.call(host, 'session.new_window', { session_id: sessionId, window_label: label, layout: shellLayout(cwd), focus: true });
  }

  async renameWindow(host: RexHost, sessionId: string, windowId: string, label: string) {
    await this.call(host, 'session.set_window_label', { session_id: sessionId, window_id: windowId, label });
  }

  async closeWindow(host: RexHost, sessionId: string, windowId: string) {
    await this.call(host, 'session.close_window', { session_id: sessionId, window_id: windowId });
  }

  async split(host: RexHost, sessionId: string, blockId: string, direction: 'right' | 'below', cwd?: string) {
    await this.call(host, 'session.new_split', {
      session_id: sessionId, anchor_id: blockId, direction: direction === 'below' ? 'vertical' : 'horizontal',
      side: 'after', layout: shellLayout(cwd), focus: true,
    });
  }

  async closeBlock(host: RexHost, sessionId: string, blockId: string) {
    await this.call(host, 'block.close', { session_id: sessionId, block_id: blockId });
  }

  async focusBlock(host: RexHost, sessionId: string, blockId: string) {
    if (this.customRunner) { await this.call(host, 'session.focus_block', { session_id: sessionId, block_id: blockId }); return; }
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
    if (!this.customRunner) {
      const control = await this.control(host);
      await control.attach(sessionId);
      if (this.dimensions.get(key) !== dimensions) return;
      await control.call('session.own_block', { session_id: sessionId, block_ids: [blockId], mode: 'take' });
    }
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
        // Stdin preserves leading dashes, control bytes, quotes and multiline paste literally.
        if (this.customRunner) await this.command(host, ['send', '-s', sessionId, '-b', blockId], data);
        else await this.block(host, sessionId, blockId, 'write', { data });
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
    if ((capture.total ?? 0) > MAX_SNAPSHOT) throw new Error('Terminal scrollback exceeds the 8 MiB snapshot limit. Clear its scrollback in Rex before reconnecting.');
    let content = capture.content;
    let offset = Buffer.byteLength(content);
    while (capture.id !== undefined && offset < (capture.total ?? Infinity)) {
      const part = await this.block<{ data: string; eof: boolean }>(host, sessionId, blockId, 'blob_read', { id: capture.id, offset, max_bytes: 983040 });
      if (typeof part.data !== 'string' || !part.data.length) throw new Error('Rex returned an incomplete terminal snapshot.');
      content += part.data;
      offset += Buffer.byteLength(part.data);
      if (offset > MAX_SNAPSHOT) throw new Error('Terminal scrollback exceeds the 8 MiB snapshot limit.');
      if (part.eof) break;
    }
    return content;
  }

  /** Only mounted, visible panes subscribe. Each poll waits for its predecessor. */
  subscribe(host: RexHost, sessionId: string, blockId: string, onFrame: (data: string) => void, onError: (error: string) => void): () => void {
    const key = refKey({ host, sessionId, blockId });
    this.visible.set(key, (this.visible.get(key) ?? 0) + 1);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous: string | undefined;
    let failureCount = 0;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      this.subscriptions.delete(stop);
      const remaining = (this.visible.get(key) ?? 1) - 1;
      if (remaining > 0) { this.visible.set(key, remaining); return; }
      this.visible.delete(key);
      this.dimensions.delete(key);
      this.release(host, sessionId, blockId);
    };
    const poll = async () => {
      if (stopped || this.disposed) return;
      try {
        const content = await this.capture(host, sessionId, blockId);
        if (!stopped && content !== previous) { previous = content; onFrame(content); }
        failureCount = 0;
      } catch (error) {
        // A recovered connection must deliver a frame even if the screen is unchanged.
        previous = undefined;
        if (!stopped) onError(errorMessage(error));
        failureCount++;
      }
      if (!stopped && !this.disposed) timer = setTimeout(poll, Math.min(5_000, sleepInterval * 2 ** Math.min(failureCount, 5)));
    };
    this.subscriptions.add(stop);
    void poll();
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
    this.runner.dispose();
  }

  private async control(host: RexHost): Promise<RexControl> {
    const key = JSON.stringify([host.id, host.endpoint]);
    const existing = this.controls.get(key);
    if (existing) {
      try { const control = await existing; if (control.connected) return control; }
      catch { /* A new explicit resize may establish a new connection. */ }
      this.controls.delete(key);
    }
    const pending = (async () => {
      const status = await this.json<{ endpoint: string }>(host, ['whoami', '--json']);
      if (!status.endpoint) throw new Error('Rex did not report its control endpoint.');
      const control = new RexControl(status.endpoint);
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

  private release(host: RexHost, sessionId: string, blockId: string) {
    const pending = this.controls.get(JSON.stringify([host.id, host.endpoint]));
    if (!pending || this.disposed) return;
    void pending.then(async control => {
      if (!control.connected || this.visible.has(refKey({ host, sessionId, blockId }))) return;
      await control.call('session.disown_block', { session_id: sessionId, block_ids: [blockId] });
    }).catch(() => {});
  }
}

function shellLayout(cwd?: string) {
  return { block: { flavor: 'com.superlogical.terminal.shell', ...(cwd ? { options: { cwd } } : {}) } };
}
function refKey(ref: Ref) { return JSON.stringify([ref.host.id, ref.host.endpoint, ref.sessionId, ref.blockId]); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Rex connection failed.'; }
