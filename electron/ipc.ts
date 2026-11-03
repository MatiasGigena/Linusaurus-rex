import { clipboard, ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { CHANNELS } from './channels.js';
import { RexService } from './rex/service.js';
import type { Host } from '../src/shared/types.js';
import { SettingsStore, record, string, identifier, integer } from './settings.js';

/** Register the small API exposed to the isolated renderer. No arbitrary CLI or filesystem calls. */
export function registerIpc(window: BrowserWindow, store: SettingsStore, allowedUrl: string): () => void {
  const rex = new RexService();
  const contents = window.webContents;
  const subscriptions = new Map<string, { host: Host; stop: () => void }>();
  const verify = (event: IpcMainInvokeEvent | IpcMainEvent) => {
    if (event.sender !== contents || !event.senderFrame || event.senderFrame.url.split('#')[0] !== allowedUrl.split('#')[0]) throw new Error('Untrusted renderer');
  };
  const hostFor = (id: unknown): Host => {
    const hostId = identifier(id, 'host ID');
    const host = store.get().hosts.find((host) => host.id === hostId);
    if (!host) throw new Error('Host no longer exists. Select a saved host.');
    return host;
  };
  const clearSubscriptions = () => {
    for (const subscription of subscriptions.values()) subscription.stop();
    subscriptions.clear();
  };
  contents.on('did-start-loading', clearSubscriptions);
  ipcMain.handle(CHANNELS.readClipboard, (event) => {
    verify(event);
    return string(clipboard.readText(), 'clipboard content', 1024 * 1024, true);
  });
  ipcMain.handle(CHANNELS.writeClipboard, (event, value: unknown) => {
    verify(event);
    clipboard.writeText(string(value, 'clipboard content', 1024 * 1024, true));
  });
  ipcMain.handle(CHANNELS.getSettings, (event) => { verify(event); return store.get(); });
  ipcMain.handle(CHANNELS.setSettings, async (event, value: unknown) => {
    verify(event);
    const saved = await store.set(value);
    for (const [id, subscription] of subscriptions) {
      const host = saved.hosts.find((host) => host.id === subscription.host.id);
      if (!host || host.endpoint !== subscription.host.endpoint) { subscription.stop(); subscriptions.delete(id); }
    }
    return saved;
  });
  ipcMain.handle(CHANNELS.request, async (event, method: unknown, value: unknown) => {
    verify(event);
    const args = record(value);
    if (method === 'unsubscribe') {
      const id = identifier(args.subscriptionId, 'subscription ID');
      subscriptions.get(id)?.stop(); subscriptions.delete(id); return;
    }
    const host = hostFor(args.hostId);
    if (method === 'status') return rex.status(host);
    if (method === 'listSessions') return rex.sessions(host);
    if (method === 'createSession') return { sessionId: await rex.createSession(host, identifier(args.label, 'session name'), args.cwd === undefined ? undefined : string(args.cwd, 'working directory')) };
    const sessionId = identifier(args.sessionId, 'session ID');
    if (method === 'inspectSession') return rex.inspect(host, sessionId);
    if (method === 'renameSession') return rex.renameSession(host, sessionId, identifier(args.label, 'session name'));
    if (method === 'newWindow') return rex.createWindow(host, sessionId, args.label === undefined ? undefined : identifier(args.label, 'tab name'));
    if (method === 'renameWindow') return rex.renameWindow(host, sessionId, identifier(args.windowId, 'tab ID'), identifier(args.label, 'tab name'));
    if (method === 'closeWindow') return rex.closeWindow(host, sessionId, identifier(args.windowId, 'tab ID'));
    const blockId = identifier(args.blockId, 'pane ID');
    if (method === 'closePane') return rex.closeBlock(host, sessionId, blockId);
    if (method === 'focus') return rex.focusBlock(host, sessionId, blockId);
    if (method === 'zoom') return rex.zoom(host, sessionId, blockId);
    if (method === 'split') {
      if (args.direction !== 'right' && args.direction !== 'below') throw new Error('Invalid split direction');
      return rex.split(host, sessionId, blockId, args.direction);
    }
    if (method === 'input') return rex.input(host, sessionId, blockId, string(args.data, 'terminal input', 1024 * 1024, true));
    if (method === 'resize') return rex.resize(host, sessionId, blockId, integer(args.cols, 'columns', 2, 500), integer(args.rows, 'rows', 1, 300));
    if (method === 'subscribe') {
      const subscriptionId = identifier(args.subscriptionId, 'subscription ID');
      if (!subscriptions.has(subscriptionId) && subscriptions.size >= 32) throw new Error('Too many terminal subscriptions');
      subscriptions.get(subscriptionId)?.stop();
      const send = (frame: { data?: string; error?: string }) => {
        if (!window.isDestroyed() && !contents.isDestroyed()) contents.send(CHANNELS.terminal, { subscriptionId, ...frame });
      };
      subscriptions.set(subscriptionId, { host, stop: rex.subscribe(host, sessionId, blockId, (data) => send({ data }), (error) => send({ error })) });
      return;
    }
    throw new Error('Unsupported Rex operation');
  });
  const control = (event: IpcMainEvent, action: unknown) => {
    try { verify(event); } catch { return; }
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (action === 'close') window.close();
  };
  ipcMain.on(CHANNELS.windowControl, control);
  return () => {
    clearSubscriptions(); rex.dispose();
    contents.removeListener('did-start-loading', clearSubscriptions);
    for (const channel of [CHANNELS.getSettings, CHANNELS.setSettings, CHANNELS.request, CHANNELS.readClipboard, CHANNELS.writeClipboard]) ipcMain.removeHandler(channel);
    ipcMain.removeListener(CHANNELS.windowControl, control);
  };
}
