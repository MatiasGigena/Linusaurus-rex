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
