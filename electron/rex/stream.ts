import { StringDecoder } from 'node:string_decoder';
import type WebSocket from 'ws';
import { loadGhosttyVt, Terminal as GhosttyTerminal } from 'khostty-libghostty-vt-wasm/api';
import { check } from 'khostty-libghostty-vt-wasm';
import { openSocket, type RexControl } from './control.js';

export type FrameKind = 'snapshot' | 'output' | 'resize';
export type FrameSize = { cols: number; rows: number };
type Metadata = Record<string, unknown>;
type Welcome = { token: Buffer; nonce: bigint; retentionMs: number };
const MAX_SNAPSHOT = 256 * 1024 * 1024;
const MAX_QUEUED = 32 * 1024 * 1024;
let wasm: ReturnType<typeof loadGhosttyVt> | undefined;

function terminalTicket(value: unknown): Buffer {
  const invalid = () => new Error('Rex returned an invalid terminal ticket.');
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid();
  const ticket = (value as Record<string, unknown>).ticket;
  if (typeof ticket !== 'string' || !ticket) throw invalid();
  const token = Buffer.from(ticket, 'base64url');
  if (token.length !== 16) throw invalid();
  return token;
}

/** Incremental framing only; Ghostty validates all record order, lengths and CRCs. */
export class SnapshotAssembler {
  private chunks: Buffer[] = [];
  private total = 0;
  private header = Buffer.alloc(10);
  private headerUsed = 0;
  private envelope = true;
  private remaining = 0;
  private tag = -1;
  push(bytes: Buffer): { snapshot: Buffer; tail: Buffer } | undefined {
    let offset = 0;
    while (offset < bytes.length) {
      if (this.remaining) {
        const amount = Math.min(this.remaining, bytes.length - offset);
        this.remaining -= amount; offset += amount;
        continue;
      }
      const amount = Math.min(10 - this.headerUsed, bytes.length - offset);
      bytes.copy(this.header, this.headerUsed, offset, offset + amount);
      this.headerUsed += amount; offset += amount;
      if (this.headerUsed !== 10) continue;
      this.headerUsed = 0;
      if (this.envelope) {
        if (!this.header.equals(Buffer.from('GHOSTSNP\x01\x00', 'binary'))) throw new Error('Unsupported Ghostty terminal snapshot.');
        this.envelope = false;
      } else {
        this.tag = this.header.readUInt16LE(0);
        this.remaining = this.header.readUInt32LE(2);
        if (this.remaining > MAX_SNAPSHOT || this.total + offset + this.remaining > MAX_SNAPSHOT) throw new Error('Terminal snapshot exceeds the 256 MiB safety limit.');
        if (this.tag === 6) {
          if (this.remaining) throw new Error('Invalid terminal snapshot finish marker.');
          this.chunks.push(bytes.subarray(0, offset)); this.total += offset;
          const snapshot = Buffer.concat(this.chunks, this.total);
          this.chunks = [];
          return { snapshot, tail: bytes.subarray(offset) };
        }
      }
    }
    this.total += bytes.length;
    if (this.total > MAX_SNAPSHOT) throw new Error('Terminal snapshot exceeds the 256 MiB safety limit.');
    this.chunks.push(bytes);
    return undefined;
  }
}

/** Only transport APCs bearing this channel's unpredictable nonce are consumed. */
export class MetadataParser {
  private pending: Buffer = Buffer.alloc(0);
  private readonly prefix: Buffer;
  constructor(nonce: bigint) { this.prefix = Buffer.from(`\x1b_rex1;${nonce};`); }
  feed(bytes: Buffer): ({ output: Buffer } | { metadata: Metadata })[] {
    this.pending = this.pending.length ? Buffer.concat([this.pending, bytes]) : bytes;
    const parts: ({ output: Buffer } | { metadata: Metadata })[] = [];
    for (;;) {
      const start = this.pending.indexOf(this.prefix);
      if (start < 0) {
        let retain = Math.min(this.prefix.length - 1, this.pending.length);
        while (retain && !this.pending.subarray(this.pending.length - retain).equals(this.prefix.subarray(0, retain))) retain--;
        if (this.pending.length > retain) parts.push({ output: this.pending.subarray(0, this.pending.length - retain) });
        this.pending = retain ? this.pending.subarray(this.pending.length - retain) : Buffer.alloc(0);
        return parts;
      }
      if (start) { parts.push({ output: this.pending.subarray(0, start) }); this.pending = this.pending.subarray(start); }
      const end = this.pending.indexOf(Buffer.from('\x1b\\'), this.prefix.length);
      if (end < 0) {
        if (this.pending.length > 1024 * 1024) throw new Error('Terminal metadata exceeds the 1 MiB safety limit.');
        return parts;
      }
      if (end > 1024 * 1024) throw new Error('Terminal metadata exceeds the 1 MiB safety limit.');
      const value = JSON.parse(this.pending.subarray(this.prefix.length, end).toString('utf8')) as unknown;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid terminal stream metadata.');
      parts.push({ metadata: value as Metadata });
      this.pending = this.pending.subarray(end + 2);
    }
  }
}

function continuation(terminal: GhosttyTerminal): Buffer {
  const abi = terminal.vt.abi;
  if (!abi.has('ghostty_terminal_continuation_alloc')) return Buffer.alloc(0);
  const out = abi.allocOpaque();
  const length = abi.alloc(abi.usizeSize);
  try {
    check(abi.fn('ghostty_terminal_continuation_alloc')(terminal.handle, 0, out, length), 'terminal continuation');
    const ptr = abi.takeOpaque(out);
    const len = abi.memory.readUsize(length, abi.usizeSize);
    const data = Buffer.from(abi.takeAllocated(ptr, len));
    abi.freeAllocated(ptr, len);
    return data;
  } finally { abi.free(length, abi.usizeSize); abi.freeOpaque(out); }
}

export async function snapshotToVt(snapshot: Buffer): Promise<{ data: string; size: FrameSize; continuation: Buffer }> {
  wasm ??= loadGhosttyVt().catch((error: unknown) => {
    // A transient load failure must not poison every later reconnect.
    wasm = undefined;
    throw error;
  });
  const module = await wasm;
  const abi = module.abi;
  const source = abi.writeBytes(snapshot);
  const retain = abi.writeBytes([1]);
  let decoder = 0;
  let terminal: GhosttyTerminal;
  try {
    decoder = abi.opaqueNew(slot => abi.fn('ghostty_snapshot_decoder_new_buf')(0, slot, source.ptr, source.len), 'snapshot decoder');
    check(abi.fn('ghostty_snapshot_decoder_set')(decoder, module.enum('GhosttySnapshotDecoderOption', 'RETAIN_CONTINUATION'), retain.ptr), 'snapshot continuation');
    const handle = abi.opaqueNew(slot => abi.fn('ghostty_snapshot_decoder_decode')(decoder, slot), 'snapshot decode');
    terminal = new GhosttyTerminal(module, handle);
  } finally {
    if (decoder) abi.fn('ghostty_snapshot_decoder_free')(decoder);
    abi.freeBytes(source); abi.freeBytes(retain);
  }
  try {
    const size = { cols: terminal.cols, rows: terminal.rows };
    const unfinished = continuation(terminal);
    const options = { unwrap: true, extra: {
      palette: true, modes: true, scrolling_region: true, tabstops: true, pwd: true, keyboard: true,
      screen: { cursor: true, style: true, hyperlink: true, protection: true, kitty_keyboard: true, charsets: true },
    } };
    const active = terminal.vtText(options);
    let data = active;
    // Preserve the hidden primary screen too, so leaving an attached alternate
    // screen restores the existing shell rather than an empty local buffer.
    if (terminal.screen === 'ALTERNATE') {
      terminal.write('\x1b[?1049l');
      data = `\x1b[?1049l${terminal.vtText(options)}${active}`;
    }
    return { data, size, continuation: unfinished };
  } finally { terminal.close(); }
}

export interface StreamCallbacks {
  frame(data: string, kind: FrameKind, size?: FrameSize): void;
  error(error: string): void;
  metadata?(metadata: Metadata): void;
}

/** Ticket/resume terminal data connection; snapshots only occur on fresh attach. */
export class RexTerminalStream {
  private stopped = false;
  private socket?: WebSocket;
  private welcome?: Welcome;
  private received = 0n;
  private snapshot = new SnapshotAssembler();
  private parser?: MetadataParser;
  private decoder = new StringDecoder('utf8');
  private restored = false;
  private retry?: ReturnType<typeof setTimeout>;
  private failureCount = 0;
  constructor(private control: () => Promise<RexControl>, readonly sessionId: string, readonly blockId: string, private callbacks: StreamCallbacks) {
    void this.connect();
  }
  private async connect(): Promise<void> {
    if (this.stopped) return;
    try { await this.run(); }
    catch (error) {
      if (!this.stopped) this.callbacks.error(error instanceof Error ? error.message : 'Terminal connection failed.');
    }
    if (!this.stopped) this.retry = setTimeout(() => void this.connect(), Math.min(4_000, 200 * 2 ** Math.min(this.failureCount++, 4)));
  }
  private async run(): Promise<void> {
    const control = await this.control();
    let ticket: Buffer | undefined;
    const resuming = !!this.welcome;
    if (!resuming) {
      await control.attach(this.sessionId);
      ticket = terminalTicket(await control.call('data.connect', { session_id: this.sessionId, block_id: this.blockId, data_ref_id: 'terminal', subprotocol: 'rex.data.terminal.v1' }));
    }
    if (this.stopped) return;
    const socket = openSocket(control.endpoint, '/api/data', 'rex.data.terminal.v1', control.credentials);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      let welcomed = false;
      let processing = Promise.resolve();
      let queued = 0;
      let failed = false;
      const timer = setTimeout(() => { fail(new Error('Rex terminal handshake timed out.')); socket.terminate(); }, 8_000);
      const fail = (error?: Error) => {
        if (failed) return;
        failed = true; clearTimeout(timer);
        void processing.finally(() => { if (this.stopped) resolve(); else reject(error || new Error('Terminal stream disconnected.')); }).catch(reject);
      };
      socket.on('open', () => {
        if (socket.protocol !== 'rex.data.terminal.v1') { fail(new Error('Rex did not negotiate its terminal data protocol.')); socket.terminate(); return; }
        if (resuming && this.welcome) {
          const hello = Buffer.alloc(25); hello[0] = 2; this.welcome.token.copy(hello, 1); hello.writeBigUInt64LE(this.received, 17); socket.send(hello);
        } else {
          if (!ticket) { fail(new Error('Rex returned an invalid terminal ticket.')); socket.terminate(); return; }
          socket.send(Buffer.concat([Buffer.from([1]), ticket]));
        }
      });
      socket.on('message', (raw, binary) => {
        if (this.stopped || failed) return;
        const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (!binary) { fail(new Error('Rex sent text on a binary terminal connection.')); socket.terminate(); return; }
        if (!welcomed) {
          if (bytes[0] === 0x82) {
            this.welcome = undefined;
            fail(new Error(`Rex could not resume this terminal (reason ${bytes[1] ?? 'unknown'}); restoring a fresh snapshot.`)); socket.terminate(); return;
          }
          if (bytes.length !== 32 || bytes[0] !== 0x81 || bytes.readBigUInt64LE(24) === 0n) { this.welcome = undefined; fail(new Error('Invalid Rex terminal welcome.')); socket.terminate(); return; }
          const next: Welcome = { token: Buffer.from(bytes.subarray(1, 17)), nonce: bytes.readBigUInt64LE(24), retentionMs: bytes.readUInt32LE(20) };
          if (resuming && next.nonce !== this.welcome?.nonce) { this.welcome = undefined; fail(new Error('Rex changed the resumed terminal channel.')); socket.terminate(); return; }
          if (!resuming) {
            this.received = 0n; this.restored = false; this.snapshot = new SnapshotAssembler(); this.parser = new MetadataParser(next.nonce); this.decoder = new StringDecoder('utf8');
          }
          this.welcome = next; welcomed = true; clearTimeout(timer); this.failureCount = 0;
          if (resuming && this.restored) this.callbacks.frame('', 'output');
          return;
        }
        queued += bytes.length;
        const limit = this.restored ? MAX_QUEUED : MAX_SNAPSHOT + MAX_QUEUED;
        if (queued > limit) { this.welcome = undefined; fail(new Error('Terminal output exceeded the bounded receive queue. Restoring its snapshot.')); socket.terminate(); return; }
        // Preserve WebSocket message order even while WASM initializes.
        processing = processing.then(async () => {
          if (this.stopped) return;
          try { await this.feed(bytes); this.received += BigInt(bytes.length); }
          finally { queued -= bytes.length; }
        }).catch(error => { this.welcome = undefined; this.callbacks.error(error instanceof Error ? error.message : 'Terminal stream decode failed.'); socket.terminate(); throw error; });
        void processing.catch(() => {});
      });
      socket.on('error', error => fail(new Error(`Terminal connection failed: ${error.message}`)));
      socket.on('close', (code) => {
        if (code === 4000 && !this.stopped) { this.stopped = true; this.callbacks.error('Terminal closed on the Rex server.'); }
        fail();
      });
    });
  }
  private async feed(bytes: Buffer) {
    if (!this.restored) {
      const ready = this.snapshot.push(bytes);
      if (!ready) return;
      const frame = await snapshotToVt(ready.snapshot);
      if (this.stopped) return;
      this.callbacks.frame(frame.data, 'snapshot', frame.size);
      this.restored = true;
      const unfinished = this.decoder.write(frame.continuation);
      if (unfinished) this.callbacks.frame(unfinished, 'output');
      bytes = ready.tail;
    }
    for (const part of this.parser!.feed(bytes)) {
      if ('output' in part) {
        const data = this.decoder.write(part.output);
        if (data && !this.stopped) this.callbacks.frame(data, 'output');
      } else {
        const metadata = part.metadata;
        if (metadata.type === 'resize') {
          const cols = Number(metadata.cols), rows = Number(metadata.rows);
          if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || cols > 65535 || rows < 1 || rows > 65535) throw new Error('Invalid terminal resize metadata.');
          this.callbacks.frame('', 'resize', { cols, rows });
        }
        if (metadata.type === 'theme') {
          let theme = '\x1b]104\x07\x1b]110\x07\x1b]111\x07\x1b]112\x07';
          for (const [key, code] of [['foreground', 10], ['background', 11], ['cursor', 12]] as const) {
            const value = metadata[key];
            if (typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value)) theme += `\x1b]${code};#${value.replace(/^#/, '')}\x07`;
          }
          if (Array.isArray(metadata.palette)) for (const entry of metadata.palette) {
            if (typeof entry !== 'string') continue;
            const match = /^(\d{1,3})=#?([0-9a-f]{6})$/i.exec(entry);
            if (match && Number(match[1]) <= 255) theme += `\x1b]4;${match[1]};#${match[2]}\x07`;
          }
          this.callbacks.frame(theme, 'output');
        }
        try { this.callbacks.metadata?.(metadata); } catch { /* Metadata observers cannot interrupt terminal output. */ }
      }
    }
  }
  /** Used by reconnect control and integration tests; input is deliberately never queued. */
  reconnect() { this.socket?.terminate(); }
  dispose() { this.stopped = true; if (this.retry) clearTimeout(this.retry); this.socket?.close(); }
}
