import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const fixture = `<!doctype html><html><head><style>
html,body,#root{height:100%;margin:0;background:#353b41}.terminal-pane{height:100%;position:relative;display:flex;flex-direction:column}.terminal-container{flex:1;min-height:0}.terminal-emulator .xterm{height:100%}.icon-button{border:0;background:transparent;color:inherit;display:inline-flex;align-items:center;justify-content:center}
</style></head><body><div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {TerminalPane,dispatchTerminalCommand,dispatchTerminalCommandAsync} from '/src/terminal/TerminalPane.tsx';
import {getCachedTerminal} from '/src/terminal/runtime.ts';
import {DEFAULT_SETTINGS} from '/src/shared/types.ts';
const ref={hostId:'test',sessionId:'test',blockId:'test'};
const requests=[],listeners=new Set(); let currentSubscription; let first=true; let clipboard='PASTE_FROM_CLIPBOARD';
window.rex={request:async(method,args)=>{requests.push({method,args,contentAtSend:window.fixture?.term()?.buffer.active.getLine(0)?.translateToString(true)}); if(method==='paste' && window.fixture?.deferNextPaste){window.fixture.deferNextPaste=false;await new Promise((resolve,reject)=>{window.fixture.releasePaste=resolve;window.fixture.rejectPaste=reject})} if(method==='key' && window.fixture?.requestServerPaste){window.fixture.requestServerPaste=false;await window.fixture.commandAsync('paste',ref,'queued');window.fixture.serverPasteReplied=true} if(method==='key' && window.fixture?.deferNextKey){window.fixture.deferNextKey=false;await new Promise(resolve=>{window.fixture.releaseKey=resolve})} if(method==='key' && window.fixture?.failNextKey){const message=window.fixture.failNextKey;window.fixture.failNextKey=undefined;throw new Error(message)} if(method==='subscribe'){currentSubscription=args.subscriptionId;if(first){first=false;if(!location.search.includes('deferSnapshot'))setTimeout(()=>emit({kind:'snapshot',data:'alpha alpha\\r\\nready> ',cols:80,rows:24}),10)}} return method==='key'?{handled:true}:undefined},onTerminal:cb=>{listeners.add(cb);return()=>listeners.delete(cb)},onCommand:()=>()=>{},readClipboard:async()=>{if(window.fixture?.deferClipboard){window.fixture.deferClipboard=false;await new Promise(resolve=>{window.fixture.releaseClipboard=resolve})}return clipboard},writeClipboard:async text=>{if(window.fixture?.deferClipboardWrite){window.fixture.deferClipboardWrite=false;await new Promise((resolve,reject)=>{window.fixture.releaseClipboardWrite=resolve;window.fixture.rejectClipboardWrite=reject})}clipboard=text}};
function emit(frame){for(const fn of listeners)fn({subscriptionId:currentSubscription,...frame})}
let update,show,mount; function Fixture(){const [settings,setSettings]=React.useState(DEFAULT_SETTINGS),[visible,setVisible]=React.useState(true),[mounted,setMounted]=React.useState(!location.search.includes('deferMount'));update=patch=>setSettings(s=>({...s,...patch}));show=setVisible;mount=setMounted;return mounted&&React.createElement(TerminalPane,{pane:{id:'test',label:'Test terminal',rect:[0,0,1,1]},terminalRef:ref,settings,visible,focused:true,showHeader:false,onFocus(){},onClose(){},onZoom(){},async onAction(command){window.fixture.actionCommand=command;if(window.fixture.deferAction){window.fixture.deferAction=false;await new Promise((resolve,reject)=>{window.fixture.releaseAction=resolve;window.fixture.rejectAction=reject})}}})}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
window.fixture={requests,emit,update:patch=>update(patch),show:value=>show(value),mount:value=>mount(value),subscribers:()=>listeners.size,runtime:()=>getCachedTerminal(ref),term:()=>getCachedTerminal(ref)?.terminal,command:dispatchTerminalCommand,commandAsync:dispatchTerminalCommandAsync,async flush(){const term=getCachedTerminal(ref).terminal;await new Promise(resolve=>term.write('',resolve));await document.fonts.ready;await new Promise(resolve=>{const listener=term.onRender(()=>{listener.dispose();resolve()});term.refresh(0,term.rows-1)})}};
</script></body></html>`;

test('terminal appends streams, retains selection/settings, routes mouse/keys, and searches output', { skip: process.env.TERMINAL_UI_TEST !== '1', timeout: 40_000 }, async () => {
  const source = fixture.split('<script type="module">')[1].split('</script>')[0];
  const html = fixture.replace(/<script type="module">[\s\S]*<\/script>/, '<script type="module" src="/@id/__x00__terminal-test-fixture"></script>');
  const server = await createServer({ configFile: false, root: process.cwd(), cacheDir: 'node_modules/.vite-terminal-test', optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', '@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-search', '@xterm/addon-web-links', '@xterm/addon-ligatures', 'lucide-react'] }, plugins: [react(), {
    name: 'terminal-fixture',
    resolveId(id) { if (id === '\0terminal-test-fixture') return id; },
    load(id) { if (id === '\0terminal-test-fixture') return source; },
    configureServer(vite) { vite.middlewares.use('/terminal-fixture', (request, response) => { response.setHeader('Content-Type', 'text/html'); void vite.transformIndexHtml(request.url || '/terminal-fixture', html).then(content => response.end(content)); }); },
  }], server: { host: '127.0.0.1', port: 5189, hmr: false, watch: { ignored: ['**/dist/**', '**/dist-electron/**'] } } });
  await server.listen();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const address = server.httpServer!.address() as { port: number };
    await page.addInitScript({ content: "Object.defineProperty(window, 'queryLocalFonts', { value: async function(){ return []; } });" });
    await page.goto(`http://127.0.0.1:${address.port}/terminal-fixture?deferSnapshot&deferMount`);
    await page.waitForFunction(() => typeof (window as any).fixture?.mount === 'function');
    await page.evaluate(async () => {
      const f = (window as any).fixture;
      f.initialCommand = 'waiting';
      void f.commandAsync('paste', { hostId: 'test', sessionId: 'test', blockId: 'test' }).then(() => { f.initialCommand = 'accepted'; }, (failure: Error) => { f.initialCommand = failure.message; });
      for (let frame = 0; frame < 4; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });
    assert.equal(await page.evaluate(() => (window as any).fixture.initialCommand), 'waiting', 'a target may register later than a fixed number of render frames');
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((request: any) => request.method === 'subscribe').length), 0);
    await page.evaluate(() => (window as any).fixture.mount(true));
    await page.waitForFunction(() => (window as any).fixture?.requests.some((request: any) => request.method === 'subscribe'));
    await page.evaluate(async () => {
      const f = (window as any).fixture;
      f.emit({ kind: 'resize', cols: 80, rows: 24 });
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    assert.equal(await page.evaluate(() => (window as any).fixture.initialCommand), 'waiting', 'a connecting pane must not acknowledge paste before its first frame');
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((request: any) => request.method === 'paste').length), 0);
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'snapshot', data: 'alpha alpha\r\nready> ', cols: 80, rows: 24 }));
    await page.waitForFunction(() => (window as any).fixture?.term()?.buffer.active.getLine(0)?.translateToString(true) === 'alpha alpha', undefined, { timeout: 6000 }).catch(failure => { throw new Error(String(failure) + ' Renderer errors: ' + JSON.stringify(errors)); });
    await page.waitForFunction(() => (window as any).fixture.initialCommand === 'accepted');
    await page.waitForFunction(() => (window as any).fixture.requests.some((request: any) => request.method === 'paste'));
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.find((request: any) => request.method === 'paste').contentAtSend), 'alpha alpha', 'paste must wait for the initial snapshot write');
    // Reading the buffer alone races the snapshot's subsequent viewport fit.
    // Drain writes, render with loaded fonts, then wait for that fit's resize.
    await page.evaluate(async () => {
      await document.fonts.ready;
      const term = (window as any).fixture.term();
      await new Promise<void>((resolve) => term.write('', resolve));
      await new Promise<void>((resolve) => {
        const listener = term.onRender(() => { listener.dispose(); resolve(); });
        term.refresh(0, term.rows - 1);
      });
    });
    await page.waitForFunction(() => {
      const f = (window as any).fixture, term = f.term();
      const resize = f.requests.filter((request: any) => request.method === 'resize').at(-1);
      return resize?.args.cols === term.cols && resize?.args.rows === term.rows;
    });
    await page.evaluate(() => { const f = (window as any).fixture; f.term().select(0, 0, 5); f.emit({ kind: 'output', data: 'STREAM' }); });
    await page.waitForFunction(() => (window as any).fixture.term().buffer.active.getLine(1)?.translateToString(true).includes('STREAM'));
    assert.equal(await page.evaluate(() => (window as any).fixture.term().getSelection()), 'alpha');
    await page.evaluate(() => { const f = (window as any).fixture; f.savedTerminal = f.term(); f.update({ fontSize: 17, theme: 'midnight', letterSpacing: 1 }); });
    await page.waitForFunction(() => (window as any).fixture.term().options.fontSize === 17);
    assert.equal(await page.evaluate(() => (window as any).fixture.savedTerminal === (window as any).fixture.term()), true);
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '\x1b[6n\x1b[c' }));
    await page.evaluate(() => (window as any).fixture.flush());
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'input').length), 0, 'parser replies must not enter the server input stream');
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('a');
    await page.waitForFunction(() => (window as any).fixture.requests.some((r: any) => r.method === 'key' && r.args.event.key === 'key_a' && r.args.event.action === 'release'));
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.find((r: any) => r.method === 'key' && r.args.event.key === 'key_a').args.event.text), 'a');
    const beforeDeferredKey = await page.evaluate(() => (window as any).fixture.requests.filter((request: any) => request.method === 'paste').length);
    await page.evaluate(() => { (window as any).fixture.deferNextKey = true; });
    await page.keyboard.down('d');
    await page.waitForFunction(() => typeof (window as any).fixture.releaseKey === 'function');
    await page.evaluate(() => (window as any).fixture.commandAsync('paste', undefined, 'queued'));
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((request: any) => request.method === 'paste').length), beforeDeferredKey, 'a server action acknowledges validated queue admission so its held key RPC can finish');
    await page.evaluate(() => (window as any).fixture.releaseKey());
    await page.keyboard.up('d');
    await page.waitForFunction((count) => (window as any).fixture.requests.filter((request: any) => request.method === 'paste').length === count + 1, beforeDeferredKey);
    const beforeServerPaste = await page.evaluate(() => (window as any).fixture.requests.filter((request: any) => request.method === 'paste').length);
    await page.evaluate(() => { (window as any).fixture.requestServerPaste = true; });
    await page.keyboard.press('r');
    await page.waitForFunction(() => (window as any).fixture.serverPasteReplied === true);
    await page.waitForFunction((count) => (window as any).fixture.requests.filter((request: any) => request.method === 'paste').length === count + 1, beforeServerPaste);
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.deferNextPaste = true;
      f.pasteCompletion = 'waiting';
      void f.commandAsync('paste').then(() => { f.pasteCompletion = 'completed'; }, (failure: Error) => { f.pasteCompletion = failure.message; });
    });
    await page.waitForFunction(() => typeof (window as any).fixture.rejectPaste === 'function');
    assert.equal(await page.evaluate(() => (window as any).fixture.pasteCompletion), 'waiting', 'an ordinary paste must wait for the underlying RPC');
    await page.evaluate(() => (window as any).fixture.rejectPaste(new Error('Paste action refused')));
    await page.waitForFunction(() => (window as any).fixture.pasteCompletion === 'Paste action refused');
    await page.getByText('Paste action refused', { exact: true }).waitFor();
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.deferAction = true;
      f.actionCompletion = 'waiting';
      void f.commandAsync('clear-terminal').then(() => { f.actionCompletion = 'completed'; }, (failure: Error) => { f.actionCompletion = failure.message; });
    });
    await page.waitForFunction(() => typeof (window as any).fixture.rejectAction === 'function');
    assert.equal(await page.evaluate(() => (window as any).fixture.actionCompletion), 'waiting', 'terminal action handoffs must await the parent executor');
    assert.equal(await page.evaluate(() => (window as any).fixture.actionCommand), 'pane.clear_content');
    await page.evaluate(() => (window as any).fixture.rejectAction(new Error('Clear action refused')));
    await page.waitForFunction(() => (window as any).fixture.actionCompletion === 'Clear action refused');
    await page.getByText('Clear action refused', { exact: true }).waitFor();
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '\x1b]133;C\x07copy-output\r\n\x1b]133;D\x07' }));
    await page.waitForFunction(() => !!(window as any).fixture.runtime().outputMarkers.end);
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.deferClipboardWrite = true;
      f.copyCompletion = 'waiting';
      void f.commandAsync('copy-last-output').then(() => { f.copyCompletion = 'completed'; }, (failure: Error) => { f.copyCompletion = failure.message; });
    });
    await page.waitForFunction(() => typeof (window as any).fixture.rejectClipboardWrite === 'function');
    assert.equal(await page.evaluate(() => (window as any).fixture.copyCompletion), 'waiting', 'copy-last-output must wait for clipboard completion');
    await page.evaluate(() => (window as any).fixture.rejectClipboardWrite(new Error('Clipboard write refused')));
    await page.waitForFunction(() => (window as any).fixture.copyCompletion === 'Clipboard write refused');
    await page.getByText('Clipboard write refused', { exact: true }).waitFor();
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'snapshot', data: 'alpha alpha\r\nready> ' }));
    await page.waitForFunction(() => (window as any).fixture.term().buffer.active.getLine(1)?.translateToString(true) === 'ready> ');
    await page.evaluate(() => { (window as any).fixture.failNextKey = 'Lua action failed: deliberate test failure'; });
    await page.keyboard.press('b');
    await page.getByText('Lua action failed: deliberate test failure').waitFor();
    await page.keyboard.press('c');
    await page.waitForFunction(() => (window as any).fixture.requests.some((r: any) => r.method === 'key' && r.args.event.key === 'key_c'));
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '\x1b[?1000h\x1b[?1006h' }));
    await page.waitForFunction(() => (window as any).fixture.term().modes.mouseTrackingMode === 'vt200');
    const screen = await page.locator('.xterm-screen').boundingBox();
    assert.ok(screen);
    await page.mouse.click(screen.x + 30, screen.y + 30);
    await page.waitForFunction(() => (window as any).fixture.requests.filter((r: any) => r.method === 'mouse').length >= 2);
    const mouse = await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'mouse').map((r: any) => r.args.event));
    assert.deepEqual(mouse.slice(-2).map((e: any) => [e.action, e.button]), [['press', 'left'], ['release', 'left']]);
    await page.mouse.wheel(0, 65);
    await page.waitForFunction(() => (window as any).fixture.requests.some((r: any) => r.method === 'wheel' && r.args.event.delta_y === 1));
    const wheelBeforeCollapsedGrid = await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'wheel').length);
    await page.evaluate(async () => {
      const grid = document.querySelector('.xterm-screen')!;
      Object.defineProperty(grid, 'clientHeight', { configurable: true, value: 0 });
      try {
        grid.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 65 }));
        await Promise.resolve();
      } finally { Reflect.deleteProperty(grid, 'clientHeight'); }
    });
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'wheel').length), wheelBeforeCollapsedGrid, 'an unmeasurable grid must not produce wheel input or poison its accumulator');
    await page.mouse.wheel(0, 65);
    await page.waitForFunction((before) => (window as any).fixture.requests.filter((r: any) => r.method === 'wheel').length > before, wheelBeforeCollapsedGrid);

    await page.keyboard.down('Shift');
    await page.mouse.click(screen.x + 35, screen.y + 35, { button: 'right' });
    await page.keyboard.up('Shift');
    await page.waitForFunction(() => (window as any).fixture.requests.some((r: any) => r.method === 'mouse' && r.args.event.button === 'right'));
    assert.equal(await page.getByRole('menu', { name: 'Terminal actions' }).count(), 0, 'Shift+right-click is delivered to the program');
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'mouse' && r.args.event.button === 'right').every((r: any) => !r.args.event.mods.includes('shift'))), true);
    const count = await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'mouse').length);
    await page.mouse.click(screen.x + 35, screen.y + 35, { button: 'right' });
    await page.getByRole('menu', { name: 'Terminal actions' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'mouse').length), count, 'normal right-click opens a local menu');
    await page.getByRole('menuitem', { name: /Find in terminal/ }).click();
    await page.getByRole('textbox', { name: 'Find terminal text' }).fill('alpha');
    await page.waitForFunction(() => document.querySelector('.terminal-search-count')?.textContent === '1/2');
    await page.getByRole('button', { name: 'Next match' }).click();
    await page.waitForFunction(() => document.querySelector('.terminal-search-count')?.textContent === '2/2');
    await page.getByRole('button', { name: 'Regular expression' }).click();
    await page.getByRole('textbox', { name: 'Find terminal text' }).fill('[');
    await page.getByText('Invalid regex').waitFor();
    await page.getByRole('button', { name: 'Close terminal search' }).click();
    const pasteBeforeCommand = await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'paste').length);
    await page.evaluate(() => (window as any).fixture.command('paste'));
    await page.waitForFunction((count) => (window as any).fixture.requests.filter((r: any) => r.method === 'paste' && r.args.text === 'PASTE_FROM_CLIPBOARD').length === count + 1, pasteBeforeCommand);
    const pasted = await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'paste').length);
    await page.evaluate(() => (window as any).fixture.command('paste', {hostId:'test',sessionId:'test',blockId:'other-pane'}));
    await page.evaluate(() => (window as any).fixture.commandAsync('select-all'));
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'paste').length), pasted, 'a scoped command must not run in the wrong pane');
    await page.evaluate(() => (window as any).fixture.command('paste', {hostId:'test',sessionId:'test',blockId:'test'}));
    await page.waitForFunction((count) => (window as any).fixture.requests.filter((r: any) => r.method === 'paste').length === count+1, pasted);
    await page.evaluate(() => (window as any).fixture.show(false));
    await page.locator('.terminal-pane[aria-hidden="true"]').waitFor({ state: 'attached' });
    await page.evaluate(async () => {
      const f = (window as any).fixture;
      f.hiddenCommand = 'waiting';
      void f.commandAsync('paste', { hostId: 'test', sessionId: 'test', blockId: 'test' }).then(() => { f.hiddenCommand = 'accepted'; }, (failure: Error) => { f.hiddenCommand = failure.message; });
      for (let frame = 0; frame < 4; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });
    assert.equal(await page.evaluate(() => (window as any).fixture.hiddenCommand), 'waiting');
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((request: any) => request.method === 'paste').length), pasted + 1);
    await page.evaluate(() => (window as any).fixture.show(true));
    await page.waitForFunction(() => (window as any).fixture.hiddenCommand === 'accepted');
    await page.waitForFunction((count) => (window as any).fixture.requests.filter((request: any) => request.method === 'paste').length === count + 2, pasted);
    const pastedBeforeDisconnect = await page.evaluate(() => (window as any).fixture.requests.filter((request: any) => request.method === 'paste').length);
    await page.waitForFunction(() => (window as any).fixture.requests.filter((request: any) => request.method === 'subscribe').length === 1);
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.emit({kind:'snapshot',data:'resynchronizing'});
      f.interruptedCommand = 'waiting';
      void f.commandAsync('paste', { hostId: 'test', sessionId: 'test', blockId: 'test' }).then(() => { f.interruptedCommand = 'accepted'; }, (failure: Error) => { f.interruptedCommand = failure.message; });
      f.emit({ error: 'socket disconnected during initial snapshot' });
    });
    await page.waitForFunction(() => (window as any).fixture.interruptedCommand !== 'waiting');
    assert.match(await page.evaluate(() => (window as any).fixture.interruptedCommand), /socket disconnected during initial snapshot|connection changed before the command could be accepted/);
    const rejectedWhileDisconnected = await page.evaluate(() => (window as any).fixture.commandAsync('paste', { hostId: 'test', sessionId: 'test', blockId: 'test' }).then(() => '', (failure: Error) => failure.message));
    assert.match(rejectedWhileDisconnected, /disconnected/);
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'snapshot', data: 'alpha alpha\r\nready> ' }));
    await page.waitForFunction(() => (window as any).fixture.term().buffer.active.getLine(1)?.translateToString(true) === 'ready> ');
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((request: any) => request.method === 'paste').length), pastedBeforeDisconnect, 'a disconnected pending paste must never replay after recovery');
    const missingTarget = await page.evaluate(() => (window as any).fixture.commandAsync('paste', { hostId: 'test', sessionId: 'test', blockId: 'missing' }).then(() => '', (failure: Error) => failure.message));
    assert.match(missingTarget, /within 10 seconds/);
    assert.equal(await page.evaluate(() => (window as any).fixture.savedTerminal === (window as any).fixture.term()), true, 'tab visibility must preserve the emulator');
    await page.evaluate(() => (window as any).fixture.update({ theme: 'system', appearance: 'dark', darkTheme: 'midnight', lightTheme: 'light', useExtendedPalette: true, darkThemeId: 'custom', themeLibrary: [{ id: 'custom', name: 'Custom', colors: { palette16: '#123456', palette255: '#abcdef' } }] }));
    await page.waitForFunction(() => (window as any).fixture.term().options.theme.extendedAnsi?.[0] === '#123456');
    assert.equal(await page.evaluate(() => (window as any).fixture.term().options.theme.background), '#10151f');
    await page.waitForFunction(() => (window as any).fixture.requests.some((r: any) => r.method === 'invokeAction' && r.args.args.palette?.includes('255=#abcdef')));
    await page.evaluate(() => (window as any).fixture.update({ useExtendedPalette: false, forceCursorStyle: false }));
    await page.waitForFunction(() => (window as any).fixture.term().options.theme.extendedAnsi?.[0] === '#000000');
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '\x1b[?25h\x1b[1;1H\x1b[5 q' }));
    await page.locator('.xterm-cursor-bar').waitFor();
    await page.evaluate(() => (window as any).fixture.update({ forceCursorStyle: true, cursorStyle: 'underline', cursorBlink: true, cursorBlinkInterval: 250 }));
    await page.locator('.xterm-cursor-underline').waitFor();
    assert.equal(await page.locator('.xterm-cursor-blink').evaluate((cursor) => getComputedStyle(cursor).animationDuration), '0.5s');
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '\x1b[6 q' }));
    await page.evaluate(() => (window as any).fixture.flush());
    assert.equal(await page.locator('.xterm-cursor-underline').count(), 1);
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '\x1b[' }));
    await page.evaluate(() => (window as any).fixture.flush());
    await page.waitForFunction(() => !(window as any).fixture.runtime().boundary.ground);
    await page.evaluate(() => (window as any).fixture.update({ forceCursorStyle: true, cursorStyle: 'bar' }));
    await page.waitForFunction(() => (window as any).fixture.term().options.cursorStyle === 'bar' && (window as any).fixture.runtime().cursorResetPending);
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '6 qZ' }));
    await page.waitForFunction(() => (window as any).fixture.term().buffer.active.getLine(0)?.translateToString(true).includes('Z'));
    assert.equal(await page.evaluate(() => (window as any).fixture.term().buffer.active.getLine(0)?.translateToString(true).includes('6 q')), false, 'cursor preference must not split a server escape sequence');
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '\x1b[?25l' }));
    await page.waitForFunction(() => document.querySelectorAll('.xterm-cursor').length === 0);
    await page.evaluate(() => (window as any).fixture.update({ fontStyle: 'italic', fontSmoothing: false }));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.terminal-emulator')!).fontStyle === 'italic');
    assert.equal(await page.locator('.terminal-emulator').evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-font-smoothing')), 'auto');
    await page.evaluate(() => (window as any).fixture.update({ fontFamily: '"FiraCode Nerd Font Mono", monospace', fontSize: 22, fontStyle: 'normal', ligatures: false }));
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '\x1b[?1000l\x1b[?25l\x1b[2J\x1b[H!= -> ===' }));
    await page.waitForFunction(() => (window as any).fixture.term().buffer.active.getLine(0)?.translateToString(true) === '!= -> ===');
    await page.evaluate(() => (window as any).fixture.flush());
    const plain = await page.locator('.xterm-screen').screenshot({ animations: 'disabled' });
    await page.evaluate(() => (window as any).fixture.update({ ligatures: true }));
    await page.waitForFunction(() => (document.querySelector('.terminal-emulator') as HTMLElement)?.style.fontVariantLigatures === 'normal');
    await page.evaluate(() => (window as any).fixture.flush());
    const ligatured = await page.locator('.xterm-screen').screenshot({ animations: 'disabled' });
    let fontAvailable = false;
    try { fontAvailable = /FiraCode/i.test(execFileSync('fc-match', ['-f', '%{family}', 'FiraCode Nerd Font Mono'], { encoding: 'utf8' })); } catch {}
    if (fontAvailable) assert.equal(plain.equals(ligatured), false, 'programming ligatures must change the rendered font glyphs');
    await page.evaluate(() => (window as any).fixture.update({ openLinks: false, appLinks: 'ask' }));
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '\x1b[2J\x1b[Hvscode://file/tmp/client.ts:7\r\nmailto:hello@example.com\r\n\x1b]8;;vscode://file/tmp/osc8.ts\x1b\\Open in editor\x1b]8;;\x1b\\' }));
    await page.waitForFunction(() => (window as any).fixture.term().buffer.active.getLine(2)?.translateToString(true) === 'Open in editor');
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'openExternal').length), 0, 'terminal output must never open applications by itself');
    const linkGrid = await page.locator('.xterm-screen').boundingBox(); assert.ok(linkGrid);
    const dimensions = await page.evaluate(() => ({ cols: (window as any).fixture.term().cols, rows: (window as any).fixture.term().rows }));
    for (let row = 0; row < 3; row++) {
      await page.mouse.move(linkGrid.x + linkGrid.width / dimensions.cols * 4, linkGrid.y + linkGrid.height / dimensions.rows * (row + .5));
      await page.locator('.xterm-cursor-pointer').waitFor();
      await page.mouse.click(linkGrid.x + linkGrid.width / dimensions.cols * 4, linkGrid.y + linkGrid.height / dimensions.rows * (row + .5));
    }
    await page.waitForFunction(() => (window as any).fixture.requests.filter((r: any) => r.method === 'openExternal').length === 3);
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'openExternal').map((r: any) => r.args.url)), ['vscode://file/tmp/client.ts:7', 'mailto:hello@example.com', 'vscode://file/tmp/osc8.ts']);
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '\x1b[2J\x1b[HA🦕B' }));
    await page.waitForFunction(() => (window as any).fixture.term().buffer.active.getLine(0)?.translateToString(true) === 'A🦕B' && (window as any).fixture.term().buffer.active.cursorX === 4);
    assert.equal(await page.evaluate(() => (window as any).fixture.term().buffer.active.cursorX), 4, 'dinosaur emoji width must match the installed Rex DSR');
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '\x1b[2J\x1b[HA🫠B' }));
    await page.waitForFunction(() => (window as any).fixture.term().buffer.active.getLine(0)?.translateToString(true) === 'A🫠B' && (window as any).fixture.term().buffer.active.cursorX === 4);
    assert.equal(await page.evaluate(() => (window as any).fixture.term().buffer.active.cursorX), 4, 'Unicode14 emoji width must match the installed Rex DSR');
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '\x1b[2J\x1b[HA👩‍💻B' }));
    await page.waitForFunction(() => (window as any).fixture.term().buffer.active.getLine(0)?.translateToString(true) === 'A👩‍💻B' && (window as any).fixture.term().buffer.active.cursorX === 6);
    assert.equal(await page.evaluate(() => (window as any).fixture.term().buffer.active.cursorX), 6, 'ZWJ emoji width must match the installed Rex DSR');
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'output', data: '\x1b[2J\x1b[HAéB' }));
    await page.waitForFunction(() => (window as any).fixture.term().buffer.active.getLine(0)?.translateToString(true) === 'AéB' && (window as any).fixture.term().buffer.active.cursorX === 3);
    assert.equal(await page.evaluate(() => (window as any).fixture.term().buffer.active.cursorX), 3, 'combining accents must not add a terminal column');
    await page.evaluate(() => {
      const f = (window as any).fixture, rows = f.term().rows;
      let data = '';
      for (let line = 0; line < rows + 12; line++) data += ([0, 8, rows + 5].includes(line) ? '\x1b]133;A\x07prompt-' : 'line-') + line + '\r\n';
      f.emit({ kind: 'snapshot', data });
    });
    await page.waitForFunction(() => (window as any).fixture.term().buffer.active.baseY > 8);
    const bottom = await page.evaluate(() => (window as any).fixture.term().buffer.active.baseY);
    await page.evaluate(() => (window as any).fixture.commandAsync('prompt-previous'));
    assert.equal(await page.evaluate(() => (window as any).fixture.term().buffer.active.viewportY), bottom, 'the final prompt is below the scrollback boundary');
    await page.evaluate(() => (window as any).fixture.commandAsync('prompt-previous'));
    assert.equal(await page.evaluate(() => (window as any).fixture.term().buffer.active.viewportY), 8, 'a second previous-prompt command must advance beyond the clamped prompt');
    await page.evaluate(() => (window as any).fixture.commandAsync('prompt-previous'));
    assert.equal(await page.evaluate(() => (window as any).fixture.term().buffer.active.viewportY), 0);
    await page.evaluate(() => (window as any).fixture.commandAsync('prompt-next'));
    assert.equal(await page.evaluate(() => (window as any).fixture.term().buffer.active.viewportY), 8);
    // Remounting a cached emulator replaces every input listener and clears a
    // held pointer, so a detached pane cannot send input or release a stale drag.
    await page.evaluate(async () => {
      const f = (window as any).fixture;
      await new Promise<void>(resolve => f.term().write('\x1b[?1000h\x1b[?1006h', resolve));
    });
    const remountScreen = await page.locator('.xterm-screen').boundingBox();
    assert.ok(remountScreen);
    await page.mouse.move(remountScreen.x + 20, remountScreen.y + 20);
    await page.mouse.down();
    const beforeUnmount = await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'mouse').length);
    const pasteBeforeUnmount = await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'paste').length);
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.deferClipboard = true;
      f.closedCommand = 'waiting';
      void f.commandAsync('paste', { hostId: 'test', sessionId: 'test', blockId: 'test' }).then(() => { f.closedCommand = 'accepted'; }, (failure: Error) => { f.closedCommand = failure.message; });
    });
    await page.waitForFunction(() => typeof (window as any).fixture.releaseClipboard === 'function');
    await page.evaluate(() => {
      const f = (window as any).fixture;
      const kitty = f.runtime().kitty;
      const original = kitty.command;
      kitty.command = () => {
        kitty.command = original;
        return f.pendingImage = new Promise(resolve => { f.releaseImage = resolve; });
      };
      f.emit({ kind: 'output', data: '\x1b_Gdeferred\x1b\\' });
    });
    await page.waitForFunction(() => typeof (window as any).fixture.releaseImage === 'function');
    await page.evaluate(() => (window as any).fixture.mount(false));
    await page.locator('.terminal-container').waitFor({ state: 'detached' });
    await page.waitForFunction(() => /closed/.test((window as any).fixture.closedCommand));
    assert.equal(await page.evaluate(() => (window as any).fixture.subscribers()), 0);
    await page.evaluate(() => (window as any).fixture.mount(true));
    await page.locator('.terminal-container .xterm').waitFor();
    await page.evaluate(() => (window as any).fixture.emit({ kind: 'snapshot', data: 'remounted> \x1b[?1000h\x1b[?1006h', cols: 80, rows: 24 }));
    await page.waitForFunction(() => (window as any).fixture.term().buffer.active.getLine(0)?.translateToString(true).trimEnd() === 'remounted>');
    await page.evaluate(async () => {
      const f = (window as any).fixture;
      f.releaseImage('STALE_IMAGE_MOVE');
      await f.pendingImage;
      await f.flush();
    });
    assert.equal(await page.evaluate(() => (window as any).fixture.term().buffer.active.getLine(0)?.translateToString(true).trimEnd()), 'remounted>', 'an image command from a disposed writer must not write into a remounted emulator');
    await page.evaluate(() => (window as any).fixture.releaseClipboard());
    await page.mouse.up();
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'mouse').length), beforeUnmount, 'a remounted pane must not release a pointer held by its previous input lifecycle');
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('z');
    await page.waitForFunction(() => (window as any).fixture.requests.some((r: any) => r.method === 'key' && r.args.event.key === 'key_z' && r.args.event.action === 'release'));
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'key' && r.args.event.key === 'key_z' && r.args.event.action === 'press').length), 1);
    assert.equal(await page.evaluate(() => (window as any).fixture.subscribers()), 1);
    assert.equal(await page.evaluate(() => (window as any).fixture.requests.filter((r: any) => r.method === 'paste').length), pasteBeforeUnmount, 'an accepted paste must not send or retry after its original pane is disposed');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
