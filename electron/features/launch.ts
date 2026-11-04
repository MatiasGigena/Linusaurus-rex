import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import type {Host,Selection,SessionSummary,SessionView,Settings} from '../../src/shared/types.js';
import {isLocalEndpoint} from './config.js';

export interface LaunchOptions {endpoint?:string;session?:string;newSession?:string;block?:string;font?:string;fontSize?:number;config?:string;windowSize?:{width:number;height:number};help:boolean}
export interface LaunchBackend {sessions(host:Host):Promise<SessionSummary[]>;inspect(host:Host,sessionId:string):Promise<SessionView>;createSession(host:Host,label:string,cwd?:string,command?:string):Promise<string>;callMethod(host:Host,method:string,payload:object):Promise<unknown>;control?(host:Host):Promise<{endpoint:string}>}
export const LAUNCH_HELP=`Linusaurus Rex — Linux graphical client for Rex

Usage: linusaurus-rex [options]

  --endpoint ADDRESS     Connect to a Unix socket or HTTP(S)/WSS Rex endpoint
  --session LABEL_OR_ID  Select an existing session by its exact label or ID
  --new LABEL            Create and select one new session (conflicts with --session)
  --block BLOCK_ID       Focus an existing pane by its exact block ID
  --font FAMILY          Set the terminal font family
  --font-size PIXELS     Set the terminal font size (8–48)
  --config PATH          Use a separate app preferences JSON file, not Rex init.lua
  --window-size WxH      Initial window dimensions (760x480 to 7680x4320)
  --help                 Print this help without opening a window

Endpoint hosts and font overrides are saved in the selected app preferences.
Only --new creates a server session. Closing the app leaves sessions running.
`;
const valueOptions=new Set(['endpoint','session','new','block','font','font-size','config','window-size']);
const ignoredValues=new Set(['--inspect','--inspect-brk','--remote-debugging-port','--user-data-dir','--js-flags']);
const ignoredFlags=new Set(['--remote-debugging-pipe','--no-sandbox','--disable-dev-shm-usage','--enable-logging','--disable-gpu','--enable-automation','--no-startup-window','--force-renderer-accessibility']);

/** Electron automation may leave debugging switches before its app argument. */
export function applicationLaunchArgs(argv:readonly string[],appPath:string,packaged:boolean):string[]{
  const args=argv.slice(1);if(packaged)return args;
  for(let index=0;index<args.length;index++){
    const argument=args[index];
    if(argument.startsWith('--')&&!argument.includes('=')&&valueOptions.has(argument.slice(2))){index++;continue;}
    if(!argument.startsWith('-')&&resolve(argument)===resolve(appPath)){args.splice(index,1);break;}
  }
  return args;
}

/** Accept only application options; known Electron debugging switches are ignored. */
export function parseLaunchArgs(argv:readonly string[],cwd=process.cwd()):LaunchOptions {
  const result:LaunchOptions={help:false};
  for(let index=0;index<argv.length;index++){
    const argument=argv[index];const equal=argument.indexOf('=');const name=equal>=0?argument.slice(0,equal):argument;
    if(ignoredFlags.has(name))continue;
    if(ignoredValues.has(name)){if(equal<0&&argv[index+1]&&!argv[index+1].startsWith('-'))index++;continue;}
    if(name==='--help'||name==='-h'){result.help=true;continue;}
    if(!name.startsWith('--')||!valueOptions.has(name.slice(2)))throw new Error(`Unknown option: ${argument}. Run with --help to see supported options.`);
    const value=equal>=0?argument.slice(equal+1):argv[++index];
    if(value===undefined||!value.trim()||(equal<0&&value.startsWith('--')))throw new Error(`Missing value for ${name}.`);
    if(value.includes('\0')||value.length>8192)throw new Error(`Invalid value for ${name}.`);
    switch(name){
      case'--endpoint':result.endpoint=value.trim();break;
      case'--session':result.session=value;break;
      case'--new':if(value.length>120)throw new Error('New session labels must be at most 120 characters.');result.newSession=value;break;
      case'--block':result.block=value;break;
      case'--font':if(value.length>256)throw new Error('Font family is too long.');result.font=value;break;
      case'--font-size':{const number=Number(value);if(!Number.isInteger(number)||number<8||number>48)throw new Error('Font size must be an integer from 8 to 48.');result.fontSize=number;break;}
      case'--config':result.config=resolve(cwd,value);break;
      case'--window-size':{const size=/^(\d+)[xX](\d+)$/.exec(value);const width=Number(size?.[1]),height=Number(size?.[2]);if(!size||width<760||width>7680||height<480||height>4320)throw new Error('Window size must be between 760x480 and 7680x4320.');result.windowSize={width,height};break;}
    }
  }
  if(result.newSession&&result.session)throw new Error('Use either --new or --session, not both.');
  if(result.newSession&&result.block)throw new Error('--block selects an existing pane and cannot be combined with --new.');
  return result;
}

export function prepareLaunchSettings(settings:Settings,options:LaunchOptions):{settings:Settings;host:Host;changed:boolean} {
  const next=structuredClone(settings);let host=next.hosts.find(host=>host.id===next.lastSelection?.hostId)||next.hosts[0];let changed=false;
  if(options.endpoint!==undefined){
    const endpoint=options.endpoint==='local'?'':options.endpoint;
    const saved=next.hosts.find(host=>host.endpoint===endpoint);
    if(saved)host=saved;
    else{
      if(next.hosts.length>=32)throw new Error('Remove a saved host before adding another launch endpoint.');
      let label=endpoint;try{const url=new URL(endpoint);label=url.host||endpoint;}catch{/* Unix paths and saved aliases remain readable. */}
      host={id:`launch-${createHash('sha256').update(endpoint).digest('hex').slice(0,16)}`,label:label.slice(0,256),endpoint};next.hosts.push(host);changed=true;
    }
  }
  if(options.font!==undefined){next.fontFamily=options.font;changed=true;}
  if(options.fontSize!==undefined){next.fontSize=options.fontSize;changed=true;}
  return{settings:next,host,changed};
}

/** Resolve a launch target: --new creates a session; --block may restore and focus a pane. */
export async function resolveLaunchSelection(rex:LaunchBackend,host:Host,settings:Settings,options:LaunchOptions):Promise<Selection|undefined> {
  if(!options.endpoint&&!options.session&&!options.newSession&&!options.block)return undefined;
  let session:SessionSummary|undefined;
  if(options.newSession){let command=host.startupCommand;if(command===undefined){const endpoint=rex.control?(await rex.control(host)).endpoint:host.endpoint;if(isLocalEndpoint(endpoint))command=settings.startupCommand||undefined;}const id=await rex.createSession(host,options.newSession,undefined,command);session={id,label:options.newSession};}
  const sessions=session?[session]:await rex.sessions(host);
  if(options.session){
    const id=sessions.find(session=>session.id===options.session);
    const matches=id?[id]:sessions.filter(session=>session.label===options.session);
    if(!matches.length)throw new Error(`No session has the exact label or ID “${options.session}”.`);
    if(matches.length>1)throw new Error(`Several sessions are named “${options.session}”. Pass a full session ID.`);
    session=matches[0];
  }
  if(options.block){
    for(const candidate of session?[session]:sessions){
      // Read the complete server view: the renderer's normalized view omits
      // zoom-hidden panes and minimized layers, which are valid launch targets.
      const view=await rex.callMethod(host,'session.view',{session_id:candidate.id})as{windows?:{window_id:string;layers?:{layer_id:string;state?:string;blocks?:{block_id:string}[]}[]}[]};
      for(const window of view.windows??[])for(const layer of window.layers??[])if(layer.blocks?.some(block=>block.block_id===options.block)){
        if(layer.state==='minimized')await rex.callMethod(host,'session.set_layer_state',{session_id:candidate.id,layer_id:layer.layer_id,state:'normal',focus:true});
        await rex.callMethod(host,'session.focus_block',{session_id:candidate.id,block_id:options.block});
        return{hostId:host.id,sessionId:candidate.id,windowId:window.window_id,blockId:options.block};
      }
    }
    throw new Error(`No pane has the exact block ID “${options.block}”${session?' in the selected session':''}.`);
  }
  session??=sessions.find(session=>session.id===settings.lastSelection?.sessionId&&settings.lastSelection.hostId===host.id)||sessions[0];
  if(!session)return{hostId:host.id,sessionId:'',windowId:''};
  const view=await rex.inspect(host,session.id);
  const saved=settings.lastSelection?.hostId===host.id&&settings.lastSelection.sessionId===session.id?view.windows.find(window=>window.id===settings.lastSelection!.windowId):undefined;
  return{hostId:host.id,sessionId:session.id,windowId:saved?.id||view.activeWindowId||view.windows[0]?.id||''};
}
