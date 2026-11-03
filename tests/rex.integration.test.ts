import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { RexService } from '../electron/rex/service.js';
import { RexCommandRunner } from '../electron/rex/command.js';

const local = { id: 'local', label: 'This computer', endpoint: '' };

// Opt-in: creates one temporary session; cleanup only ever targets its returned ID.
test('installed Rex supports terminal input, alternate screen, resize and session layouts', { skip: process.env.REX_INTEGRATION !== '1', timeout: 30_000 }, async () => {
  const rex = new RexService();
  const cleanup = new RexCommandRunner();
  let sessionId: string | undefined;
  try {
    sessionId = await rex.createSession(local, `linusaurus-verification-${Date.now()}`, '/tmp');
    const view = await rex.inspect(local, sessionId);
    const blockId = view.windows[0].panes[0].id;
    const originalWindow = view.windows[0].id;
    const input = (data: string) => rex.input(local, sessionId!, blockId, data);
    const capture = () => rex.capture(local, sessionId!, blockId);
    const waitFor = async (text: string) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const screen = await capture();
        if (screen.includes(text)) return screen;
        await delay(50);
      }
      throw new Error(`Terminal never displayed ${JSON.stringify(text)}. Last capture: ${JSON.stringify(await capture())}`);
    };
    await input("printf '\\nREX_OUTPUT_%s\\n' OK\r");
    await waitFor('REX_OUTPUT_OK');
    await input("printf '\\nCWD_%s\\n' \"$PWD\"\r");
    await waitFor('CWD_/tmp');

    // Raw mode proves arrows, Tab and Control-C survive byte-for-byte transport.
    await input('python3 -u -c \'import os,tty,termios; old=termios.tcgetattr(0); tty.setraw(0); print("RAW_READY",flush=True); data=os.read(0,64); termios.tcsetattr(0,termios.TCSADRAIN,old); print("RAW_HEX_"+data.hex(),flush=True)\'\r');
    await waitFor('RAW_READY');
    await delay(100);
    await input('\x1b[A\t\x03');
    await waitFor('RAW_HEX_1b5b410903');

    await input('sleep 30\r');
    await delay(150);
    await input('\x03');
    await input("printf '\\nINTERRUPTED_%s\\n' OK\r");
    await waitFor('INTERRUPTED_OK');

    await input("printf '\\033[?1049hALT_SCREEN_%s' OK; read -r ignored; printf '\\033[?1049l'\r");
    const alternate = await waitFor('ALT_SCREEN_OK');
    assert.match(alternate, /\x1b\[\?1049h/);
    await input('\r');
    await waitFor('INTERRUPTED_OK');
    await rex.resize(local, sessionId, blockId, 92, 28);
    const size = await rex.terminalSize(local, sessionId, blockId);
    assert.equal(size.columns, 92);
    assert.equal(size.rows, 28);

    await rex.renameSession(local, sessionId, '-renamed-verification');
    assert.equal((await rex.inspect(local, sessionId)).label, '-renamed-verification');
    await rex.split(local, sessionId, blockId, 'right');
    const split = (await rex.inspect(local, sessionId)).windows[0];
    assert.equal(split.panes.length, 2);
    assert.deepEqual(split.panes.map(pane => pane.rect), [[0, 0, .5, 1], [.5, 0, .5, 1]]);
    await rex.zoom(local, sessionId, blockId);
    assert.equal((await rex.inspect(local, sessionId)).windows[0].panes.length, 1);
    await rex.zoom(local, sessionId, blockId);
    const addedBlock = split.panes.find(pane => pane.id !== blockId)!.id;
    await rex.closeBlock(local, sessionId, addedBlock);
    await rex.createWindow(local, sessionId, '-new-window');
    const withWindow = await rex.inspect(local, sessionId);
    assert.equal(withWindow.windows.length, 2);
    const addedWindow = withWindow.windows.find(window => window.id !== originalWindow)!.id;
    await rex.renameWindow(local, sessionId, addedWindow, '-renamed-window');
    assert.equal((await rex.inspect(local, sessionId)).windows.find(window => window.id === addedWindow)?.label, '-renamed-window');
    await rex.closeWindow(local, sessionId, addedWindow);
    rex.dispose();
    const survivor = new RexService();
    try { assert.equal((await survivor.inspect(local, sessionId)).windows.length, 1); }
    finally { survivor.dispose(); }
  } finally {
    rex.dispose();
    if (sessionId) await cleanup.run(['--autostart=false', 'api', 'call', 'session.destroy', '-'], JSON.stringify({ session_id: sessionId }));
    cleanup.dispose();
  }
});
