import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { RexService } from '../electron/rex/service.js';
import { normalizeView } from '../electron/rex/normalize.js';
import { RexCommandRunner } from '../electron/rex/command.js';

const local = { id: 'local', label: 'This computer', endpoint: '' };

test('terminal bytes travel literally through stdin and every call disables autostart', async () => {
  const calls: { args: string[]; stdin?: string }[] = [];
  const service = new RexService(async (args, stdin) => { calls.push({ args, stdin }); return '{}'; });
  const data = '-n\u0003\u001b[A\t\r\n$(touch /tmp/never) "quoted"';
  await service.input(local, 'session:1', 'block:2', data);
  assert.equal(calls[0].stdin, data);
  assert.ok(calls[0].args.includes('--autostart=false'));
  assert.ok(!calls[0].args.includes(data));
  service.dispose();
});

test('queued input is dropped after a failed send and is never retried', async () => {
  let rejectFirst: (error: Error) => void = () => {};
  const sent: string[] = [];
  const service = new RexService((_args, stdin) => {
    sent.push(stdin ?? '');
    return new Promise((_resolve, reject) => { rejectFirst = reject; });
  });
  const first = service.input(local, 's', 'b', 'first');
  const second = service.input(local, 's', 'b', 'second');
  await delay(0);
  rejectFirst(new Error('connection gone'));
  await assert.rejects(first, /connection gone/);
  await assert.rejects(second, /Input discarded/);
  assert.deepEqual(sent, ['first']);
  service.dispose();
});

test('paginated captures use UTF-8 byte offsets and preserve the complete VT stream', async () => {
  const calls: { args: string[]; data: Record<string, unknown> }[] = [];
  const service = new RexService(async (args, stdin) => {
    const data = JSON.parse(stdin ?? '{}') as Record<string, unknown>;
    calls.push({ args, data });
    if (args.includes('format')) return JSON.stringify({ content: '界\u001b[31m', id: 12, total: 20 });
    return JSON.stringify({ data: 'red\u001b[0m', eof: true });
  });
  assert.equal(await service.capture(local, 's', 'b'), '界\u001b[31mred\u001b[0m');
  assert.equal(calls[1].data.offset, Buffer.byteLength('界\u001b[31m'));
  assert.equal(calls[1].data.id, 12);
  assert.equal(calls[0].data.extra_cursor, true);
  assert.equal(calls[0].data.extra_modes, true);
  service.dispose();
});

test('subscriptions suppress unchanged snapshots and stop delivering after disposal', async () => {
  let captures = 0;
  const frames: string[] = [];
  const errors: string[] = [];
  const service = new RexService(async () => { captures++; return JSON.stringify({ content: 'same' }); });
  const stop = service.subscribe(local, 's', 'b', data => frames.push(data), error => errors.push(error));
  await delay(340);
  stop();
  const stoppedAt = captures;
  await delay(180);
  assert.deepEqual(frames, ['same']);
  assert.deepEqual(errors, []);
  assert.ok(captures >= 2);
  assert.equal(captures, stoppedAt);
  service.dispose();
});

test('a pending capture cannot deliver into an unsubscribed pane', async () => {
  let finish: (value: string) => void = () => {};
  const frames: string[] = [];
  const service = new RexService(() => new Promise(resolve => { finish = resolve; }));
  const stop = service.subscribe(local, 's', 'b', data => frames.push(data), () => {});
  stop();
  finish('{"content":"late"}');
  await delay(0);
  assert.deepEqual(frames, []);
  service.dispose();
});

test('reconnecting delivers the unchanged screen so the renderer can enable input', async () => {
  let captures = 0;
  const frames: string[] = [];
  const errors: string[] = [];
  const service = new RexService(async () => {
    captures++;
    if (captures === 2) throw new Error('offline');
    return JSON.stringify({ content: 'same screen' });
  });
  service.subscribe(local, 's', 'b', data => frames.push(data), error => errors.push(error));
  await delay(500);
  service.dispose();
  assert.deepEqual(frames, ['same screen', 'same screen']);
  assert.deepEqual(errors, ['offline']);
});

test('snapshots are bounded and invalid dimensions never reach Rex', async () => {
  let calls = 0;
  const service = new RexService(async () => { calls++; return JSON.stringify({ content: 'partial', total: 9 * 1024 * 1024 }); });
  await assert.rejects(service.capture(local, 's', 'b'), /8 MiB/);
  await assert.rejects(service.resize(local, 's', 'b', 0, 30), /dimensions/);
  assert.equal(calls, 1);
  service.dispose();
});

test('nested layouts, floating bounds and zoom follow the server view', () => {
  const view = {
    session_id: 's', active_window_id: 'w', windows: [{
      window_id: 'w', focused_block_id: 'b', layers: [{
        bounds: [0, 0, 1, 1], blocks: [{ block_id: 'a', label: 'Left' }, { block_id: 'b', label: 'Right' }],
        layout: { split: { before: { block_id: 'a', rect: [0, 0, .4, 1] }, after: { block_id: 'b', rect: [.4, 0, .6, 1] } } },
      }, {
        bounds: [.2, .3, .5, .4], blocks: [{ block_id: 'float' }], layout: { block_id: 'float', rect: [0, 0, 1, 1] },
      }, {
        state: 'minimized', blocks: [{ block_id: 'hidden' }], layout: { block_id: 'hidden' },
      }],
    }],
  };
  const normal = normalizeView(view);
  assert.deepEqual(normal.windows[0].panes.map(p => p.rect), [[0, 0, .4, 1], [.4, 0, .6, 1], [.2, .3, .5, .4]]);
  assert.deepEqual(normalizeView({ ...view, windows: [{ ...view.windows[0], zoomed_block_id: 'b' }] }).windows[0].panes.map(p => [p.id, p.rect]), [['b', [0, 0, 1, 1]]]);
});

test('missing Rex reports an actionable error and never starts a server', async () => {
  const runner = new RexCommandRunner('/does/not/exist/rex');
  await assert.rejects(runner.run(['--autostart=false', 'whoami', '--json']), /not found on PATH/);
  runner.dispose();
});

test('command runner bounds lifetime and reports timeout', async () => {
  const runner = new RexCommandRunner(process.execPath, 35);
  await assert.rejects(runner.run(['-e', 'setInterval(() => {}, 1000)']), /did not respond in time/);
  runner.dispose();
});
