import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StringDecoder } from 'node:string_decoder';
import { WebSocketServer } from 'ws';
import { Terminal } from 'khostty-libghostty-vt-wasm/api';
import { MetadataParser, SnapshotAssembler, snapshotToVt } from '../electron/rex/stream.js';
import { RexControl, socketAddress } from '../electron/rex/control.js';

const fragmented = (bytes: Buffer, size = 1) => Array.from({ length: Math.ceil(bytes.length / size) }, (_, index) => bytes.subarray(index * size, (index + 1) * size));

test('snapshot framing locates FINISH across arbitrary frames and rejects oversized records', async () => {
  const terminal = await Terminal.open({ cols: 20, rows: 4 });
  try {
    terminal.write('framed snapshot');
    const bytes = Buffer.from(terminal.snapshot().bytes);
    const assembler = new SnapshotAssembler();
    let result: ReturnType<SnapshotAssembler['push']>;
    const withTail = Buffer.concat([bytes, Buffer.from('live tail')]);
    for (const part of fragmented(withTail, 7)) {
      const ready = assembler.push(part);
      if (ready) { result = ready; break; }
    }
    assert.deepEqual(result!.snapshot, bytes);
    const corrupt = Buffer.from(bytes); corrupt[0] = 0;
    assert.throws(() => new SnapshotAssembler().push(corrupt), /Unsupported/);
    const oversized = Buffer.concat([bytes.subarray(0, 10), Buffer.alloc(10)]);
    oversized.writeUInt32LE(257 * 1024 * 1024, 12);
    assert.throws(() => new SnapshotAssembler().push(oversized), /256 MiB/);
  } finally { terminal.close(); }
});

test('transport APCs require the channel nonce, tolerate split prefixes and preserve ordinary bytes', () => {
  const parser = new MetadataParser(12345678901234567890n);
  const metadata = '\x1b_rex1;12345678901234567890;{"type":"resize","cols":92,"rows":28}\x1b\\';
  const foreign = '\x1b_rex1;123;{"type":"resize"}\x1b\\';
  const input = Buffer.from(`before €${foreign}${metadata}after`);
  const output: Buffer[] = [], found: unknown[] = [];
  for (const part of fragmented(input)) for (const record of parser.feed(part)) {
    if ('output' in record) output.push(record.output); else found.push(record.metadata);
  }
  assert.equal(Buffer.concat(output).toString('utf8'), `before €${foreign}after`);
  assert.deepEqual(found, [{ type: 'resize', cols: 92, rows: 28 }]);
});

test('canonical decoder rejects corrupt CRCs and retains unfinished UTF-8 continuations', async () => {
  const terminal = await Terminal.open({ cols: 40, rows: 4 });
  const display = await Terminal.open({ cols: 40, rows: 4 });
  try {
    const abi = terminal.vt.abi;
    const limit = abi.alloc(abi.usizeSize);
    try {
      abi.memory.view.setUint32(limit, 1024, true);
      const result = abi.fn('ghostty_terminal_set')(terminal.handle, terminal.vt.enum('GhosttyTerminalOption', 'CONTINUATION_MAX_BYTES'), limit);
      assert.equal(result, 0);
    } finally { abi.free(limit, abi.usizeSize); }
    terminal.write('before ');
    terminal.write(new Uint8Array([0xe2]));
    const bytes = Buffer.from(terminal.snapshot().bytes);
    const frame = await snapshotToVt(bytes);
    display.write(frame.data);
    const decoder = new StringDecoder('utf8');
    display.write(decoder.write(frame.continuation));
    display.write(decoder.write(Buffer.from([0x82, 0xac])));
    assert.match(display.text(), /before €/);
    assert.ok(!display.text().includes('\ufffd'));
    const corrupt = Buffer.from(bytes); corrupt[25] ^= 1;
    await assert.rejects(snapshotToVt(corrupt), /snapshot decode/);
  } finally { terminal.close(); display.close(); }
});

test('remote control negotiates revision 7 and carries authentication without exposing secrets in events', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1', handleProtocols: protocols => protocols.has('rex.control.v1') ? 'rex.control.v1' : false });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(typeof address === 'object' && address);
  let authorization: string | undefined;
  server.on('connection', (socket, request) => {
    authorization = request.headers.authorization;
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'hello') socket.send(JSON.stringify({ type: 'welcome', protocol: 'rex.control.v1', api_revision: 7, limits: { max_message_bytes: 1024 * 1024 } }));
      else socket.send(JSON.stringify({ type: 'response', id: message.id, payload: { method: message.method } }));
    });
  });
  const control = new RexControl(`http://127.0.0.1:${address.port}`, { username: 'tester', password: 'secret' });
  try {
    assert.equal((await control.readyPublic()).api_revision, 7);
    assert.equal(authorization, `Basic ${Buffer.from('tester:secret').toString('base64')}`);
    assert.deepEqual(await control.call('server.version', {}), { method: 'server.version' });
    assert.throws(() => socketAddress('https://user:secret@example.com', '/api/control'), /separately/);
    assert.equal(socketAddress('unix:///tmp/a%20b.sock', '/api/control'), 'ws+unix:///tmp/a b.sock:/api/control');
  } finally { control.dispose(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Rex login accounts use a secondary WebSocket subprotocol rather than HTTP credentials', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1', handleProtocols: protocols => protocols.has('rex.control.v1') ? 'rex.control.v1' : false });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(typeof address === 'object' && address);
  let protocols: string | undefined, authorization: string | undefined;
  server.on('connection', (socket, request) => {
    protocols = request.headers['sec-websocket-protocol']; authorization = request.headers.authorization;
    socket.once('message', () => socket.send(JSON.stringify({ type: 'welcome', protocol: 'rex.control.v1', api_revision: 10 })));
  });
  const control = new RexControl(`http://verification-account@127.0.0.1:${address.port}`);
  try {
    await control.readyPublic();
    assert.equal(protocols, 'rex.control.v1,rex.as.verification-account');
    assert.equal(authorization, undefined);
    assert.equal(socketAddress('https://root@example.com', '/api/data'), 'wss://example.com/api/data');
    assert.throws(() => socketAddress('https://root:password@example.com', '/api/data'), /separately/);
  } finally { control.dispose(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

import { expandEndpoint, RexService } from '../electron/rex/service.js';

test('bare remote hosts resolve saved endpoint arrays before documented default ports', () => {
  assert.deepEqual(expandEndpoint('root@studio.example'), ['https://root@studio.example/', 'https://root@studio.example:7297/', 'http://root@studio.example:7297/']);
  assert.deepEqual(expandEndpoint('work', [{ label: 'work', endpoints: ['https://rex.example', 'unix:///tmp/forward.sock'] }]), ['https://rex.example', 'unix:///tmp/forward.sock']);
  assert.deepEqual(expandEndpoint('https://studio.example'), ['https://studio.example']);
  assert.throws(() => expandEndpoint('https://user:password@host/path').map(address => socketAddress(address, '/api/control')), /separately/);
  assert.throws(() => expandEndpoint('one', [{ label: 'one', endpoints: ['two'] }, { label: 'two', endpoints: ['one'] }]), /cycle/);
});

function fallbackService(fail: (endpoint: string) => boolean, gateway = false) {
  const attempts: string[] = [];
  const service = new RexService({
    credentials: gateway ? async () => ({ token: 'gateway-secret' }) : undefined,
    controlFactory: (endpoint) => {
      attempts.push(endpoint);
      const control = {
        endpoint, connected: true,
        readyPublic: async () => { if (fail(endpoint)) throw new Error('ECONNREFUSED'); return { protocol: 'rex.control.v1', api_revision: 10 }; },
        call: async (method: string) => method === 'hosts.list' ? { hosts: [] } : { rex_version: 'verification' },
        dispose: () => { control.connected = false; },
      };
      return control as unknown as RexControl;
    },
  });
  return { service, attempts };
}

test('implicit endpoint fallback prefers its last working address while explicit TLS never downgrades', async () => {
  const host = { id: 'remote', label: 'Remote', endpoint: 'example.test' };
  const { service, attempts } = fallbackService(endpoint => endpoint === 'https://example.test/');
  try {
    assert.equal((await service.status(host)).connected, true);
    assert.deepEqual(attempts.filter(endpoint => !endpoint.startsWith('unix:')), ['https://example.test/', 'https://example.test:7297/']);
    service.reconnect(host); attempts.length = 0;
    assert.equal((await service.status(host)).connected, true);
    assert.deepEqual(attempts.filter(endpoint => !endpoint.startsWith('unix:')), ['https://example.test:7297/']);
  } finally { service.dispose(); }
  const explicit = fallbackService(() => true);
  try {
    assert.equal((await explicit.service.status({ ...host, endpoint: 'https://example.test' })).connected, false);
    assert.deepEqual(explicit.attempts, ['https://example.test']);
  } finally { explicit.service.dispose(); }
});

test('implicit address fallback cannot send gateway credentials over unrequested plaintext', async () => {
  const { service, attempts } = fallbackService(endpoint => endpoint.startsWith('https:'), true);
  try {
    assert.equal((await service.status({ id: 'remote', label: 'Remote', endpoint: 'example.test' })).connected, false);
    assert.deepEqual(attempts.filter(endpoint => !endpoint.startsWith('unix:')), ['https://example.test/', 'https://example.test:7297/']);
    assert.ok(!attempts.some(endpoint => endpoint.startsWith('http:') || endpoint.startsWith('ws:')));
  } finally { service.dispose(); }
});

test('REX_SERVER selects the default host while saved endpoints override it and retain secure fallback rules', async () => {
  const previous = process.env.REX_SERVER;
  const direct = fallbackService(() => false);
  const secured = fallbackService(endpoint => endpoint.startsWith('https:'), true);
  try {
    process.env.REX_SERVER = 'https://account@environment.example';
    const fallback = { id: 'local', label: 'Default', endpoint: '' };
    assert.equal((await direct.service.status(fallback)).endpoint, 'https://account@environment.example');
    assert.equal((await direct.service.control(fallback)).endpoint, 'https://account@environment.example');
    assert.equal((await direct.service.status({ ...fallback, id: 'explicit', endpoint: 'unix:///tmp/explicit.sock' })).endpoint, 'unix:///tmp/explicit.sock');
    assert.deepEqual(direct.attempts, ['https://account@environment.example', 'unix:///tmp/explicit.sock']);
    process.env.REX_SERVER = 'environment.example';
    assert.equal((await secured.service.status(fallback)).connected, false);
    assert.deepEqual(secured.attempts.filter(endpoint => !endpoint.startsWith('unix:')), ['https://environment.example/', 'https://environment.example:7297/']);
  } finally {
    direct.service.dispose(); secured.service.dispose();
    if (previous === undefined) delete process.env.REX_SERVER; else process.env.REX_SERVER = previous;
  }
});
