import WebSocket from 'ws';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

/** Keeps resize preferences alive for the lifetime of this graphical client. */
export class RexControl {
  private socket: WebSocket;
  private ready: Promise<void>;
  private pending = new Map<string, Pending>();
  private nextId = 0;
  private closed = false;
  private readyDone = false;
  private maxMessageBytes = 1024 * 1024;
  private attached = new Map<string, Promise<unknown>>();

  constructor(endpoint: string) {
    let address: string;
    if (endpoint.startsWith('unix://')) {
      address = `ws+unix://${endpoint.slice('unix://'.length)}:/api/control`;
    } else {
      const url = new URL(endpoint);
      if (!['https:', 'wss:', 'http:', 'ws:'].includes(url.protocol)) throw new Error('Unsupported Rex endpoint scheme.');
      url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:';
      url.pathname = '/api/control'; url.search = ''; url.hash = '';
      address = url.href;
    }
    this.socket = new WebSocket(address, 'rex.control.v1', { handshakeTimeout: 4_000, maxPayload: 16 * 1024 * 1024 });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.socket.terminate(); reject(new Error('Rex control handshake timed out.')); }, 4_000);
      const fail = (error: Error) => {
        if (!this.readyDone) { this.readyDone = true; clearTimeout(timer); reject(error); }
        this.closed = true;
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
        this.pending.clear();
      };
      this.socket.on('open', () => this.socket.send(JSON.stringify({
        type: 'hello', api_revision: 8, api_min_revision: 7,
        client: { name: 'Linusaurus Rex', version: '0.1.0', kind: 'app', platform: 'linux' },
      })));
      this.socket.on('message', (bytes, binary) => {
        try {
          if (binary) throw new Error('Rex sent binary content on its control connection.');
          const message = JSON.parse(bytes.toString());
          if (!this.readyDone) {
            if (message.type !== 'welcome' || message.protocol !== 'rex.control.v1' || message.api_revision < 7 || message.api_revision > 8) {
              throw new Error('Rex control protocol is incompatible; API revisions 7–8 are supported.');
            }
            this.maxMessageBytes = message.limits?.max_message_bytes ?? this.maxMessageBytes;
            this.readyDone = true; clearTimeout(timer); resolve();
          } else if (message.type === 'response') {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id); clearTimeout(pending.timer);
            if (message.error) pending.reject(new Error(message.error.message || message.error.code || 'Rex rejected the request.'));
            else pending.resolve(message.payload);
          }
        } catch (error) { fail(error instanceof Error ? error : new Error('Invalid Rex control response.')); this.socket.terminate(); }
      });
      this.socket.on('error', error => fail(new Error(`Rex control connection failed: ${error.message}`)));
      this.socket.on('close', () => fail(new Error('Rex control connection closed.')));
    });
    // Construction starts connecting; the first call still receives a failed handshake.
    void this.ready.catch(() => {});
  }

  get connected() { return !this.closed; }

  async attach(sessionId: string) {
    let pending = this.attached.get(sessionId);
    if (!pending) {
      pending = this.call('session.attach', { session_id: sessionId });
      this.attached.set(sessionId, pending);
      void pending.catch(() => this.attached.delete(sessionId));
    }
    await pending;
  }

  async call<T = unknown>(method: string, payload: object): Promise<T> {
    await this.ready;
    if (this.closed) throw new Error('Rex control connection is disconnected.');
    const id = String(++this.nextId);
    const message = JSON.stringify({ type: 'request', id, method, payload });
    if (Buffer.byteLength(message) > this.maxMessageBytes) throw new Error('Rex request exceeds the negotiated message limit.');
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Rex control request timed out.')); }, 4_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.socket.send(message, error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }

  dispose() {
    this.closed = true;
    this.socket.close();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Rex client has been closed.')); }
    this.pending.clear();
  }
}
