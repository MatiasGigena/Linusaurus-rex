import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { RexControl, type RexEvent } from '../electron/rex/control.js';

const welcome = { type: 'welcome', protocol: 'rex.control.v1', api_revision: 10 };

async function controlServer(welcomes: unknown[]) {
  const server = new WebSocketServer({
    host: '127.0.0.1', port: 0,
    handleProtocols: protocols => protocols.has('rex.control.v1') ? 'rex.control.v1' : false,
  });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const requests: RexEvent[] = [];
  const disconnected: Promise<void>[] = [];
  server.on('connection', socket => {
    disconnected.push(new Promise<void>(resolve => socket.once('close', () => resolve())));
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString()) as RexEvent;
      if (message.type === 'hello') socket.send(JSON.stringify(welcomes.shift()));
      else {
        requests.push(message);
        socket.send(JSON.stringify({ type: 'response', id: message.id, payload: { ok: true } }));
      }
    });
  });
  return {
    endpoint: `http://127.0.0.1:${address.port}`, requests, disconnected,
    async close() {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

test('malformed control welcomes reject queued calls and close before publishing readiness', { timeout: 10_000 }, async t => {
  const malformed: [string, unknown][] = [
    ['null envelope', null],
    ['array envelope', []],
    ['primitive envelope', 'welcome'],
    ['wrong message type', { ...welcome, type: 'response' }],
    ['wrong protocol', { ...welcome, protocol: 'rex.control.v2' }],
    ['missing API revision', { type: 'welcome', protocol: 'rex.control.v1' }],
    ['string API revision', { ...welcome, api_revision: '10' }],
    ['fractional API revision', { ...welcome, api_revision: 9.5 }],
    ['revision below supported range', { ...welcome, api_revision: 6 }],
    ['revision above supported range', { ...welcome, api_revision: 11 }],
    ['null limits', { ...welcome, limits: null }],
    ['array limits', { ...welcome, limits: [] }],
    ['string byte limit', { ...welcome, limits: { max_message_bytes: '1024' } }],
    ['nonnumeric byte limit', { ...welcome, limits: { max_message_bytes: 'unbounded' } }],
    ['null byte limit', { ...welcome, limits: { max_message_bytes: null } }],
    ['zero byte limit', { ...welcome, limits: { max_message_bytes: 0 } }],
    ['negative byte limit', { ...welcome, limits: { max_message_bytes: -1 } }],
    ['fractional byte limit', { ...welcome, limits: { max_message_bytes: 128.5 } }],
    ['unsafe byte limit', { ...welcome, limits: { max_message_bytes: Number.MAX_SAFE_INTEGER + 1 } }],
    ['string server revision', { ...welcome, api_server_revision: '10' }],
    ['fractional server revision', { ...welcome, api_server_revision: 10.5 }],
    ['null client metadata', { ...welcome, client: null }],
    ['missing client identity', { ...welcome, client: { reconnect_token: 'token' } }],
    ['nonstring client identity', { ...welcome, client: { id: 42 } }],
    ['object reconnect token', { ...welcome, client: { id: 'client', reconnect_token: {} } }],
    ['string resumption flag', { ...welcome, client: { id: 'client', resumed: 'false' } }],
    ['nonarray features', { ...welcome, features: 'sessions' }],
    ['nonstring feature', { ...welcome, features: [42] }],
  ];
  for (const [name, response] of malformed) await t.test(name, async () => {
    const server = await controlServer([response, welcome]);
    const control = new RexControl(server.endpoint);
    const events: RexEvent[] = [];
    control.onEvent(event => events.push(event));
    const queued = control.call('server.status', {}).then(
      value => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    );
    let recovered: RexControl | undefined;
    try {
      await assert.rejects(control.readyPublic(), /Rex.*(?:control|protocol)/i);
      assert.ok((await queued).error instanceof Error, 'a call queued before the welcome must reject');
      assert.equal(control.connected, false);
      assert.equal(control.welcome, undefined);
      await assert.rejects(control.call('server.status', {}));
      await server.disconnected[0];
      assert.deepEqual(server.requests, [], 'no queued request may escape a rejected handshake');
      assert.equal(events.filter(event => event.type === 'disconnected').length, 1);
      recovered = new RexControl(server.endpoint);
      assert.equal((await recovered.readyPublic()).api_revision, 10);
      assert.deepEqual(await recovered.call('server.status', {}), { ok: true });
      assert.equal(recovered.connected, true);
    } finally {
      control.dispose();
      recovered?.dispose();
      await server.close();
    }
  });
});

test('all supported revisions preserve extension fields and enforce a valid advertised byte limit', async t => {
  for (const revision of [7, 8, 9, 10]) await t.test(`API ${revision}`, async () => {
    const response = {
      ...welcome, api_revision: revision, api_server_revision: 12,
      limits: { max_message_bytes: 256, future_limit: 100 },
      client: { id: 'client', reconnect_token: 'token', resumed: false, future_client_field: true },
      features: ['sessions', 'future-feature'], future_extension: { enabled: true },
    };
    const server = await controlServer([response]);
    const control = new RexControl(server.endpoint);
    try {
      assert.deepEqual(await control.readyPublic(), response);
      assert.deepEqual(await control.call('server.status', {}), { ok: true });
      await assert.rejects(control.call('server.status', { data: 'x'.repeat(1024) }), /negotiated message limit/);
      assert.equal(server.requests.length, 1, 'oversized requests must be rejected before sending');
      assert.equal(control.connected, true);
    } finally {
      control.dispose();
      await server.close();
    }
  });
});
