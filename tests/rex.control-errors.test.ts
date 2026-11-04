import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { RexControl, RexRequestError } from '../electron/rex/control.js';

test('RPC rejections preserve server codes and the request method without closing transport', async () => {
  const server = new WebSocketServer({
    host: '127.0.0.1', port: 0,
    handleProtocols: protocols => protocols.has('rex.control.v1') ? 'rex.control.v1' : false,
  });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  server.on('connection', socket => socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (message.type === 'hello') {
      socket.send(JSON.stringify({ type: 'welcome', protocol: 'rex.control.v1', api_revision: 10 }));
    } else if (message.method === 'session.view') {
      socket.send(JSON.stringify({ type: 'response', id: message.id, error: { code: 'not_found', message: 'The session no longer exists.' } }));
    } else {
      socket.send(JSON.stringify({ type: 'response', id: message.id, payload: { ok: true } }));
    }
  }));
  const control = new RexControl(`http://127.0.0.1:${address.port}`);
  try {
    await assert.rejects(control.call('session.view', { session_id: 'closed' }), error => {
      assert.ok(error instanceof RexRequestError);
      assert.equal(error.code, 'not_found');
      assert.equal(error.method, 'session.view');
      assert.equal(error.message, 'The session no longer exists.');
      return true;
    });
    assert.deepEqual(await control.call('server.status', {}), { ok: true });
  } finally {
    control.dispose();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
