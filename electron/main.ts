import { app, BrowserWindow, globalShortcut, Menu, nativeTheme, Tray, type MenuItemConstructorOptions } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHANNELS } from './channels.js';
import { getHostCredentials,registerIpc } from './ipc.js';
import { SettingsStore } from './settings.js';
import type { Selection, Settings } from '../src/shared/types.js';
import {RexService} from './rex/service.js';
import {LAUNCH_HELP,applicationLaunchArgs,parseLaunchArgs,prepareLaunchSettings,resolveLaunchSelection,type LaunchOptions} from './features/launch.js';

const directory=dirname(fileURLToPath(import.meta.url));
const windows=new Set<BrowserWindow>();
const disposers=new Map<number,()=>void>();
let store:SettingsStore;
let lastWindow:BrowserWindow|undefined;
let tray:Tray|undefined;
let quitting=false;
let registeredAccelerator='';
let preferencesPath:string;
app.setName('Linusaurus Rex');
app.setAppUserModelId('com.matiasgigena.linusaurus-rex');
app.commandLine.appendSwitch('class','linusaurus-rex');

function rendererUrl():string {
  if(!app.isPackaged&&process.env.ELECTRON_RENDERER_URL){
    const url=new URL(process.env.ELECTRON_RENDERER_URL);
    if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Development renderer must use a loopback HTTP address');
    return url.href;
  }
  return pathToFileURL(join(directory,'../dist/index.html')).href;
}
function activeWindow(){const focused=BrowserWindow.getFocusedWindow();return focused??(lastWindow&&!lastWindow.isDestroyed()?lastWindow:[...windows][0]);}
function showWindow(){const window=activeWindow();if(!window){void createWindow();return;}if(window.isMinimized())window.restore();window.show();window.focus();}
function toggleVisibility(){const window=activeWindow();if(window?.isVisible()&&window.isFocused())window.hide();else showWindow();}
function command(name:string){return()=>activeWindow()?.webContents.send(CHANNELS.command,name);}
function buildMenu(settings:Settings){
  const template:MenuItemConstructorOptions[]=[
    {label:'File',submenu:[
      {label:'New Window',click:()=>void createWindow()},
      {label:'New Session…',click:command('new-session')},
      {label:'New Terminal Tab',click:command('new-window')},
      {label:'Close Tab…',click:command('close-window')},
      {type:'separator'}, {label:'Quit',accelerator:'CmdOrCtrl+Shift+Q',click:()=>app.quit()},
    ]},
    {label:'Edit',submenu:[{label:'Copy',click:command('copy')},{label:'Paste',click:command('paste')},{label:'Find…',click:command('find')}]},
    {label:'View',submenu:[
      {label:'Toggle Sidebar',click:command('toggle-sidebar')},
      {label:'Command Palette…',click:command('command-palette')},
      {label:'Switch Session…',click:command('session-switcher')},
      {type:'separator'},
      {label:'Split Right',click:command('split-right')},{label:'Split Below',click:command('split-below')},
      {label:'Zoom Pane',click:command('zoom')},
      {type:'separator'}, {label:'Settings…',click:command('settings')},
      {role:'togglefullscreen'},...(!app.isPackaged||settings.developerMode?[{role:'toggleDevTools' as const}]:[]),
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function applySettings(settings:Settings){
  buildMenu(settings);
  nativeTheme.themeSource=settings.appearance;
  for(const window of windows){if(!window.isDestroyed())window.webContents.setZoomFactor(settings.interfaceZoom);}
  if(registeredAccelerator!==settings.globalShortcut){
    if(registeredAccelerator)globalShortcut.unregister(registeredAccelerator);
    registeredAccelerator='';
    if(settings.globalShortcut){try{if(globalShortcut.register(settings.globalShortcut,toggleVisibility))registeredAccelerator=settings.globalShortcut;else console.warn('The global shortcut is already used by another application.');}catch{console.warn('The global shortcut is invalid or unsupported on this desktop.');}}
  }
  const needsTray=settings.closeToTray||!settings.showWindowOnLaunch;
  if(needsTray&&!tray){
    tray=new Tray(join(directory,'../resources/icon.png'));tray.setToolTip('Linusaurus Rex');
    tray.setContextMenu(Menu.buildFromTemplate([{label:'Show Linusaurus Rex',click:showWindow},{label:'New Window',click:()=>void createWindow()},{type:'separator'},{label:'Quit',click:()=>app.quit()}]));
    tray.on('click',showWindow);
  }else if(!needsTray&&tray){tray.destroy();tray=undefined;}
}
/** Paint the window in the theme's base color before the renderer loads, so it never flashes Graphite grey. */
function windowBackground(settings:ReturnType<typeof store.get>):string{
  const dark=settings.appearance==='dark'||(settings.appearance!=='light'&&nativeTheme.shouldUseDarkColors);
  const theme=settings.theme==='system'?(dark?settings.darkTheme:settings.lightTheme):settings.theme;
  return({macos:'#1e1e1e','macos-light':'#ffffff',midnight:'#1e2430',light:'#f2f5f6'} as Record<string,string>)[theme]??'#30353b';
}
async function createWindow(initialSelection?:Selection,size?:{width:number;height:number}):Promise<void>{
  const url=rendererUrl();const settings=store.get();
  const window=new BrowserWindow({
    width:size?.width??1440,height:size?.height??900,minWidth:760,minHeight:480,
    title:'Linusaurus Rex',backgroundColor:windowBackground(settings),show:false,
    frame:false,autoHideMenuBar:true,icon:join(directory,'../resources/icon.png'),
    webPreferences:{preload:join(directory,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false},
  });
  windows.add(window);lastWindow=window;
  disposers.set(window.id,registerIpc(window,store,url,{createWindow,initialSelection,onSettings:applySettings}));
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,destination)=>{if(destination.split('#')[0]!==url.split('#')[0])event.preventDefault();});
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  const trustedFontRequest=(contents:Electron.WebContents|null,permission:string,details:{isMainFrame:boolean;requestingUrl?:string})=>permission==='local-fonts'&&details.isMainFrame&&details.requestingUrl?.split('#')[0]===url&&Boolean(contents&&[...windows].some(window=>!window.isDestroyed()&&window.webContents===contents));
  window.webContents.session.setPermissionCheckHandler((contents,permission,_origin,details)=>trustedFontRequest(contents,permission,details));
  window.webContents.session.setPermissionRequestHandler((contents,permission,callback,details)=>callback(trustedFontRequest(contents,permission,details)));
  window.webContents.on('render-process-gone',(_event,details)=>console.error('Renderer stopped:',details.reason));
  window.webContents.once('did-finish-load',()=>window.webContents.setZoomFactor(settings.interfaceZoom));
  window.once('ready-to-show',()=>{if(settings.showWindowOnLaunch||windows.size>1)window.show();});
  window.on('focus',()=>{lastWindow=window;});
  window.on('close',event=>{if(!quitting&&store.get().closeToTray&&windows.size===1){event.preventDefault();window.hide();}});
  window.on('closed',()=>{disposers.get(window.id)?.();disposers.delete(window.id);windows.delete(window);if(lastWindow===window)lastWindow=[...windows][0];});
  await window.loadURL(url);
}
function applicationArgs(argv:readonly string[]){return applicationLaunchArgs(argv,app.getAppPath(),app.isPackaged);}
function startupError(error:unknown){console.error(`Linusaurus Rex: ${error instanceof Error?error.message:String(error)}`);app.exit(2);}
async function launch(options:LaunchOptions){
  const prepared=prepareLaunchSettings(store.get(),options);
  if(prepared.changed)await store.set(prepared.settings);
  let initialSelection:Selection|undefined;
  if(options.endpoint||options.session||options.newSession||options.block){
    const rex=new RexService({credentials:getHostCredentials});
    try{initialSelection=await resolveLaunchSelection(rex,prepared.host,store.get(),options);}
    finally{rex.dispose();}
    if(initialSelection)await store.set({...store.get(),lastSelection:initialSelection});
  }
  await createWindow(initialSelection,options.windowSize);
}
let options:LaunchOptions|undefined;
try{options=parseLaunchArgs(applicationArgs(process.argv));}catch(error){startupError(error);}
if(options?.help){console.log(LAUNCH_HELP);app.exit(0);}
else if(options&&!app.requestSingleInstanceLock())app.quit();
else if(options){
  app.on('second-instance',(_event,argv,cwd)=>{void(async()=>{const requested=parseLaunchArgs(applicationArgs(argv),cwd);if(requested.config&&requested.config!==preferencesPath)throw new Error('Quit the running app before selecting a different --config preferences file.');if(requested.endpoint||requested.session||requested.newSession||requested.block||requested.font||requested.fontSize||requested.windowSize)await launch(requested);else showWindow();})().catch(error=>console.error(`Linusaurus Rex: ${error instanceof Error?error.message:String(error)}`));});
  app.whenReady().then(async()=>{preferencesPath=options!.config||join(app.getPath('userData'),'settings.json');store=new SettingsStore(preferencesPath);await store.load();store.onChange(applySettings);applySettings(store.get());await launch(options!);}).catch(startupError);
  app.on('window-all-closed',()=>{if(!store?.get().closeToTray)app.quit();});
  app.on('before-quit',()=>{quitting=true;globalShortcut.unregisterAll();tray?.destroy();tray=undefined;for(const dispose of disposers.values())dispose();disposers.clear();});
}
