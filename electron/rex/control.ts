import WebSocket from 'ws';
import { join } from 'node:path';

export interface RexCredentials { username?: string; password?: string; token?: string; headers?: Record<string, string> }
export interface RexWelcome { protocol: string; api_revision: number; api_server_revision?: number; limits?: { max_message_bytes?: number }; client?: { id: string; reconnect_token?: string; resumed?: boolean }; features?: string[] }
export type RexEvent = { type: string; seq?: number; payload?: Record<string, unknown>; [key: string]: unknown };
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export function localEndpoint(): string {
  return `unix://${join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`, 'rex/server.sock')}`;
}
export function socketAddress(endpoint: string, path: string): string {
  if (endpoint.startsWith('/')) endpoint = `unix://${endpoint}`;
  if (endpoint.startsWith('unix://')) {
    const socket = decodeURIComponent(endpoint.slice(7));
    if (!socket.startsWith('/') || socket.includes('\0')) throw new Error('Rex Unix endpoints must name an absolute socket path.');
    return `ws+unix://${socket}:${path}`;
  }
  const url = new URL(endpoint.startsWith('tcp://') ? `ws://${endpoint.slice(6)}` : endpoint);
  if (!['https:', 'wss:', 'http:', 'ws:'].includes(url.protocol)) throw new Error('Unsupported Rex endpoint scheme.');
  url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:';
  if (url.password) throw new Error('Save remote credentials separately from the host endpoint.');
  // A URL username selects a Rex login-server account. It is not HTTP Basic
  // authentication, and must never be left in the WebSocket request URL.
  url.username = '';
  url.pathname = path; url.search = ''; url.hash = '';
  return url.href;
}
export function openSocket(endpoint: string, path: string, protocol: string, credentials?: RexCredentials): WebSocket {
  const headers = { ...credentials?.headers };
  if (credentials?.token) headers.Authorization = `Bearer ${credentials.token}`;
  else if (credentials?.username !== undefined) headers.Authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password || ''}`).toString('base64')}`;
  let account: string | undefined;
  if (!endpoint.startsWith('unix://') && !endpoint.startsWith('/')) {
    const url = new URL(endpoint.startsWith('tcp://') ? `ws://${endpoint.slice(6)}` : endpoint);
    if (url.username) {
      account = decodeURIComponent(url.username);
      if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/.test(account)) throw new Error('Invalid Rex account selector.');
    }
  }
  const protocols = account ? [protocol, `rex.as.${account}`] : [protocol];
  return new WebSocket(socketAddress(endpoint, path), protocols, {
    headers, handshakeTimeout: 6_000, maxPayload: 256 * 1024 * 1024,
    perMessageDeflate: false,
  });
}

/** One negotiated, persistent control connection. Tokens never leave the main process. */
export class RexControl {
  private socket: WebSocket;
  private ready: Promise<RexWelcome>;
  private pending = new Map<string, Pending>();
  private nextId = 0;
  private closed = false;
  private readyDone = false;
  private maxMessageBytes = 1024 * 1024;
  private attached = new Map<string, Promise<unknown>>();
  private listeners = new Set<(event: RexEvent) => void>();
  private requestHandler?: (method: string, payload: Record<string, unknown>) => Promise<unknown>;
  welcome?: RexWelcome;

  constructor(readonly endpoint: string, readonly credentials?: RexCredentials, reconnectToken?: string, private revisions = { min: 7, max: 10 }) {
    this.socket = openSocket(endpoint, '/api/control', 'rex.control.v1', credentials);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.socket.terminate(); fail(new Error('Rex control handshake timed out.')); }, 6_000);
      const fail = (error: Error) => {
        if (!this.readyDone) { this.readyDone = true; clearTimeout(timer); reject(error); }
        if (this.closed) return;
        this.closed = true;
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
        this.pending.clear();
        this.emit({ type: 'disconnected', error: error.message });
      };
      this.socket.on('open', () => {
        if (this.socket.protocol !== 'rex.control.v1') { fail(new Error('Rex did not negotiate its control protocol.')); this.socket.terminate(); return; }
        this.socket.send(JSON.stringify({ type: 'hello', api_revision: this.revisions.max, api_min_revision: this.revisions.min,
          client: { name: 'Linusaurus Rex', version: '0.3.0', kind: 'app', platform: 'linux' },
          ...(reconnectToken ? { reconnect_token: reconnectToken } : {}),
        }));
      });
      this.socket.on('message', (bytes, binary) => {
        try {
          if (binary) throw new Error('Rex sent binary content on its control connection.');
          const message = JSON.parse(bytes.toString()) as RexEvent;
          if (!this.readyDone) {
            const welcome = message as unknown as RexWelcome;
            if (message.type !== 'welcome' || welcome.protocol !== 'rex.control.v1' || welcome.api_revision < this.revisions.min || welcome.api_revision > this.revisions.max) throw new Error(`Rex control protocol is incompatible; API revisions ${this.revisions.min}–${this.revisions.max} are supported.`);
            this.maxMessageBytes = Math.min(16 * 1024 * 1024, welcome.limits?.max_message_bytes ?? this.maxMessageBytes);
            this.welcome = welcome; this.readyDone = true; clearTimeout(timer); resolve(welcome);
          } else if (message.type === 'response') {
            const pending = this.pending.get(String(message.id));
            if (!pending) return;
            this.pending.delete(String(message.id)); clearTimeout(pending.timer);
            const error = message.error as { message?: string; code?: string } | undefined;
            if (error) pending.reject(new Error(error.message || error.code || 'Rex rejected the request.'));
            else pending.resolve(message.payload);
          } else if (message.type === 'request' && typeof message.id === 'string' && typeof message.method === 'string') {
            void this.handleRequest(message);
          } else this.emit(message);
        } catch (error) { fail(error instanceof Error ? error : new Error('Invalid Rex control response.')); this.socket.terminate(); }
      });
      this.socket.on('error', error => fail(new Error(`Rex control connection failed: ${error.message}`)));
      this.socket.on('close', () => fail(new Error('Rex control connection closed.')));
    });
    void this.ready.catch(() => {});
  }

  get connected() { return !this.closed; }
  readyPublic(): Promise<RexWelcome> { return this.ready; }
  onEvent(callback: (event: RexEvent) => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  setRequestHandler(handler: (method: string, payload: Record<string, unknown>) => Promise<unknown>) { this.requestHandler = handler; }
  private emit(event: RexEvent) { for (const listener of this.listeners) { try { listener(event); } catch { /* One observer must not destroy the transport. */ } } }
  private async handleRequest(message: RexEvent) {
    try {
      if (!this.requestHandler) throw new Error('This client operation is not supported.');
      const payload = await this.requestHandler(message.method as string, message.payload || {});
      if (this.connected) this.socket.send(JSON.stringify({ type: 'response', id: message.id, payload: payload ?? null }));
    } catch (error) {
      if (this.connected) this.socket.send(JSON.stringify({ type: 'response', id: message.id, error: { code: 'not_supported', message: error instanceof Error ? error.message : 'Client operation failed.' } }));
    }
  }
  async attach(sessionId: string) {
    let pending = this.attached.get(sessionId);
    if (!pending) { pending = this.call('session.attach', { session_id: sessionId }); this.attached.set(sessionId, pending); void pending.catch(() => this.attached.delete(sessionId)); }
    await pending;
  }
  async call<T = unknown>(method: string, payload: object): Promise<T> {
    await this.ready;
    if (this.closed) throw new Error('Rex control connection is disconnected.');
    const id = String(++this.nextId);
    const message = JSON.stringify({ type: 'request', id, method, payload });
    if (Buffer.byteLength(message) > this.maxMessageBytes) throw new Error('Rex request exceeds the negotiated message limit.');
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Rex control request timed out.')); }, 10_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.socket.send(message, error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
    });
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.socket.close();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Rex client has been closed.')); }
    this.pending.clear(); this.listeners.clear();
  }
}
