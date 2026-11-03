import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHANNELS } from './channels.js';
import { registerIpc } from './ipc.js';
import { SettingsStore } from './settings.js';

const directory = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let disposeIpc: (() => void) | undefined;

app.setName('Linusaurus Rex');
app.setAppUserModelId('com.matiasgigena.linusaurus-rex');
app.commandLine.appendSwitch('class', 'linusaurus-rex');

function rendererUrl(): string {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Development renderer must use a loopback HTTP address');
    return url.href;
  }
  return pathToFileURL(join(directory, '../dist/index.html')).href;
}

function buildMenu(): void {
  const command = (name: string) => () => window?.webContents.send(CHANNELS.command, name);
  const template: MenuItemConstructorOptions[] = [
    { label: 'File', submenu: [
      { label: 'New Session…', click: command('new-session') },
      { label: 'New Terminal', click: command('new-window') },
      { label: 'Close Tab…', click: command('close-window') },
      { type: 'separator' }, { role: 'quit', accelerator: 'CmdOrCtrl+Shift+Q' },
    ] },
    { label: 'View', submenu: [
      { label: 'Toggle Sidebar', click: command('toggle-sidebar') },
      { label: 'Command Palette…', click: command('command-palette') },
      { type: 'separator' },
      { label: 'Split Right', click: command('split-right') },
      { label: 'Split Below', click: command('split-below') },
      { type: 'separator' },
      { label: 'Settings…', click: command('settings') },
      { role: 'togglefullscreen' },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : []),
    ] },
    { label: 'Edit', submenu: [
      { label: 'Copy', click: command('copy') },
      { label: 'Paste', click: command('paste') },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  const store = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  await store.load();
  const url = rendererUrl();
  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 760, minHeight: 480,
    title: 'Linusaurus Rex', backgroundColor: '#30353b', show: false,
    frame: false, autoHideMenuBar: true,
    icon: join(directory, '../resources/icon.png'),
    webPreferences: {
      preload: join(directory, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  const current = window;
  disposeIpc = registerIpc(current, store, url);
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('will-navigate', (event, destination) => {
    if (destination.split('#')[0] !== url.split('#')[0]) event.preventDefault();
  });
  current.webContents.on('will-attach-webview', (event) => event.preventDefault());
  current.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  current.webContents.on('render-process-gone', (_event, details) => console.error('Renderer stopped:', details.reason));
  current.once('ready-to-show', () => current.show());
  current.on('closed', () => {
    disposeIpc?.(); disposeIpc = undefined;
    if (window === current) window = null;
  });
  buildMenu();
  await current.loadURL(url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  });
  app.whenReady().then(createWindow).catch((error: unknown) => {
    console.error('Could not start Linusaurus Rex:', error);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { disposeIpc?.(); disposeIpc = undefined; });
}
