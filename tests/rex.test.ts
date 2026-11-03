import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { RexService, parseCommand } from '../electron/rex/service.js';
import { RexControl } from '../electron/rex/control.js';
import { normalizeView } from '../electron/rex/normalize.js';
import { RexCommandRunner } from '../electron/rex/command.js';

const local = { id: 'local', label: 'This computer', endpoint: '' };
type Call = { method: string; payload: Record<string, unknown> };
function mock(invoke: (call: Call) => Promise<unknown>) {
  const calls: Call[] = [];
  const factory = () => {
    const control = {
      endpoint: 'unix:///fake/rex.sock', connected: true,
      readyPublic: async () => ({ protocol: 'rex.control.v1', api_revision: 10 }),
      attach: async (_sessionId: string) => {},
      call: async (method: string, payload: Record<string, unknown>) => { const call = { method, payload }; calls.push(call); return invoke(call); },
      dispose: () => { control.connected = false; },
    };
    return control as unknown as RexControl;
  };
  return { calls, service: new RexService({ controlFactory: factory }) };
}

test('terminal input bytes go in a single control request without invoking a shell', async () => {
  const { calls, service } = mock(async () => ({}));
  const data = '-n\u0003\u001b[A\t\r\n$(touch /tmp/never) "quoted"';
  try {
    await service.input(local, 'session:1', 'block:2', data);
    assert.deepEqual(calls, [{ method: 'com.superlogical.terminal.write', payload: { session_id: 'session:1', block_id: 'block:2', args: { data } } }]);
  } finally { service.dispose(); }
});

test('queued input is dropped after a failed send and is never replayed', async () => {
  let rejectFirst: (error: Error) => void = () => {};
  const { calls, service } = mock(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
  const first = service.input(local, 's', 'b', 'first');
  const second = service.input(local, 's', 'b', 'second');
  await delay(0); rejectFirst(new Error('connection gone'));
  try {
    await assert.rejects(first, /connection gone/);
    await assert.rejects(second, /Input discarded/);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].payload.args, { data: 'first' });
  } finally { service.dispose(); }
});

test('paginated captures use UTF-8 byte offsets and preserve complete VT content', async () => {
  const { calls, service } = mock(async call => call.method.endsWith('.format')
    ? { content: '界\u001b[31m', id: 12, total: 20 }
    : { data: 'red\u001b[0m', eof: true });
  try {
    assert.equal(await service.capture(local, 's', 'b'), '界\u001b[31mred\u001b[0m');
    assert.deepEqual(calls[1].payload.args, { id: 12, offset: Buffer.byteLength('界\u001b[31m'), max_bytes: 983040 });
    assert.equal((calls[0].payload.args as Record<string, unknown>).extra_modes, true);
  } finally { service.dispose(); }
});

test('snapshots and terminal dimensions are bounded before oversized work begins', async () => {
  const { calls, service } = mock(async () => ({ content: 'partial', total: 257 * 1024 * 1024 }));
  try {
    await assert.rejects(service.capture(local, 's', 'b'), /256 MiB/);
    await assert.rejects(service.resize(local, 's', 'b', 0, 30), /dimensions/);
    assert.equal(calls.length, 1);
  } finally { service.dispose(); }
});

test('startup commands preserve quoted arguments and never expand shell expressions', () => {
  assert.deepEqual(parseCommand('fish --login'), ['fish', '--login']);
  assert.deepEqual(parseCommand(`printf '%s' "hello world" '' '$HOME' \`literal\``), ['printf', '%s', 'hello world', '', '$HOME', '`literal`']);
  assert.deepEqual(parseCommand('program escaped\\ space'), ['program', 'escaped space']);
  assert.throws(() => parseCommand('program "unfinished'), /quote/);
  assert.throws(() => parseCommand('program \\'), /escape/);
});

test('nested dividers, floating layers, minimized panes and zoom follow server layout', () => {
  const view = {
    session_id: 's', active_window_id: 'w', windows: [{
      window_id: 'w', focused_block_id: 'b', layers: [{
        layer_id: 'tiled', kind: 'tiled', bounds: [0, 0, 1, 1], blocks: [{ block_id: 'a', label: 'Left' }, { block_id: 'b', label: 'Right' }],
        layout: { split: { before: { block_id: 'a', rect: [0, 0, .4, 1] }, after: { block_id: 'b', rect: [.4, 0, .6, 1] } } },
      }, {
        layer_id: 'floating', kind: 'floating', bounds: [.2, .3, .5, .4], blocks: [{ block_id: 'float' }], layout: { block_id: 'float', rect: [0, 0, 1, 1] },
      }, {
        layer_id: 'minimized', state: 'minimized', blocks: [{ block_id: 'hidden', label: 'Hidden' }], layout: { block_id: 'hidden' },
      }],
    }],
  };
  const normal = normalizeView(view);
  assert.deepEqual(normal.windows[0].panes.map(pane => pane.rect), [[0, 0, .4, 1], [.4, 0, .6, 1], [.2, .3, .5, .4]]);
  assert.deepEqual(normal.windows[0].dividers, [{ direction: 'horizontal', beforeBlockId: 'a', afterBlockId: 'b', ratio: .4, rect: [0, 0, 1, 1] }]);
  assert.equal(normal.windows[0].panes[2].layerKind, 'floating');
  assert.deepEqual(normal.windows[0].minimizedLayers, [{ id: 'minimized', label: 'Hidden', blockId: 'hidden' }]);
  const zoomed = normalizeView({ ...view, windows: [{ ...view.windows[0], zoomed_block_id: 'b' }] }).windows[0];
  assert.deepEqual(zoomed.panes.map(pane => [pane.id, pane.rect]), [['b', [0, 0, 1, 1]]]);
  assert.equal(zoomed.zoomedBlockId, 'b');
  assert.deepEqual(zoomed.dividers, []);
});

test('missing local integration CLI reports an actionable error without starting Rex', async () => {
  const runner = new RexCommandRunner('/does/not/exist/rex');
  try { await assert.rejects(runner.run(['--autostart=false', 'skill', 'status', '--json']), /not found on PATH/); }
  finally { runner.dispose(); }
});

test('integration command runner bounds lifetime and reports timeout', async () => {
  const runner = new RexCommandRunner(process.execPath, 35);
  try { await assert.rejects(runner.run(['-e', 'setInterval(() => {}, 1000)']), /did not respond in time/); }
  finally { runner.dispose(); }
});
