import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applicationLaunchArgs,parseLaunchArgs,prepareLaunchSettings,resolveLaunchSelection,type LaunchBackend} from '../electron/features/launch.js';
import {validateSettings} from '../electron/settings/validation.js';
import {DEFAULT_SETTINGS,type Host,type SessionView} from '../src/shared/types.js';

test('launch options validate values, conflicts, separate profiles, and Electron switches',()=>{
  assert.deepEqual(applicationLaunchArgs(['/electron','--inspect=9229','--remote-debugging-port=0','--no-sandbox','/repo','--font','/repo'],'/repo',false),['--inspect=9229','--remote-debugging-port=0','--no-sandbox','--font','/repo']);
  assert.deepEqual(applicationLaunchArgs(['/app','--font','/repo'],'/repo',true),['--font','/repo']);
  assert.deepEqual(parseLaunchArgs(['--endpoint=https://root@rex.example','--session','project','--block','block-123','--font','Fira Code','--font-size=18','--config','profile/settings.json','--window-size','1280x800'],'/tmp/launch-test'),{
    endpoint:'https://root@rex.example',session:'project',block:'block-123',font:'Fira Code',fontSize:18,config:'/tmp/launch-test/profile/settings.json',windowSize:{width:1280,height:800},help:false,
  });
  assert.deepEqual(parseLaunchArgs(['--inspect=9229','--remote-debugging-port','9333','--no-sandbox','--help']),{help:true});
  for(const args of [['--new','new','--session','old'],['--new','new','--block','existing'],['--font-size','7'],['--font-size','18.5'],['--window-size','759x800'],['--window-size','1280x99999'],['--session'],['--endpoint','--font'],['--unknown']])assert.throws(()=>parseLaunchArgs(args));
});

test('launch endpoint and font overrides preserve selected host configuration',()=>{
  const settings=structuredClone(DEFAULT_SETTINGS);
  settings.hosts.push({id:'remote',label:'Remote',endpoint:'https://root@rex.example',startupCommand:'fish -l'});
  settings.lastSelection={hostId:'remote',sessionId:'s',windowId:'w'};
  const saved=prepareLaunchSettings(settings,parseLaunchArgs(['--endpoint','https://root@rex.example','--font-size','19']));
  assert.equal(saved.host.id,'remote');assert.equal(saved.host.startupCommand,'fish -l');assert.equal(saved.settings.hosts.length,2);assert.equal(saved.settings.fontSize,19);assert.equal(settings.fontSize,DEFAULT_SETTINGS.fontSize);
  const fresh=prepareLaunchSettings(settings,parseLaunchArgs(['--endpoint','https://other.example']));
  assert.match(fresh.host.id,/^launch-/);assert.equal(fresh.settings.hosts.length,3);assert.equal(fresh.host.endpoint,'https://other.example');assert.doesNotThrow(()=>validateSettings(fresh.settings));
  assert.equal(prepareLaunchSettings(settings,parseLaunchArgs(['--endpoint','local'])).host.id,settings.hosts[0].id);
});

function backend(){
  const calls:{method:string;payload?:any}[]=[];
  const views:Record<string,SessionView>={
    a:{id:'a',label:'project',activeWindowId:'wa',windows:[{id:'wa',label:'A',focusedBlockId:'ba',panes:[{id:'ba',label:'A',rect:[0,0,1,1]}]}]},
    b:{id:'b',label:'project',activeWindowId:'wb',windows:[{id:'wb',label:'B',focusedBlockId:'bb',panes:[{id:'bb',label:'B',rect:[0,0,1,1]}]}]},
    created:{id:'created',label:'new',activeWindowId:'new-tab',windows:[]},
  };
  const rex:LaunchBackend={
    sessions:async()=>{calls.push({method:'sessions'});return[{id:'a',label:'project'},{id:'b',label:'project'}];},
    inspect:async(_host,id)=>{calls.push({method:'inspect',payload:{id}});return views[id];},
    createSession:async(_host,label,cwd,command)=>{calls.push({method:'create',payload:{label,cwd,command}});return'created';},
    callMethod:async(_host,method,payload:any)=>{calls.push({method,payload});if(method==='session.view')return{windows:[{window_id:payload.session_id==='b'?'wb':'wa',layers:[{layer_id:'floating',state:'minimized',blocks:payload.session_id==='b'?[{block_id:'hidden-exact-id'}]:[{block_id:'ba'}]}]}]};return{};},
    control:async()=>({endpoint:'/run/user/1000/rex/server.sock'}),
  };
  return{rex,calls,views};
}
const local:Host={id:'local',label:'Local',endpoint:''};

test('launch session selection is exact, rejects ambiguous labels, and never creates implicitly',async()=>{
  const{rex,calls}=backend();const settings=structuredClone(DEFAULT_SETTINGS);
  assert.equal(await resolveLaunchSelection(rex,local,settings,parseLaunchArgs([])),undefined);assert.equal(calls.length,0);
  await assert.rejects(resolveLaunchSelection(rex,local,settings,parseLaunchArgs(['--session','project'])),/Several sessions/);
  await assert.rejects(resolveLaunchSelection(rex,local,settings,parseLaunchArgs(['--session','proj'])),/No session/);
  assert.deepEqual(await resolveLaunchSelection(rex,local,settings,parseLaunchArgs(['--session','b'])),{hostId:'local',sessionId:'b',windowId:'wb'});
  assert.equal(calls.filter(call=>call.method==='create').length,0);
  rex.sessions=async()=>[];
  assert.deepEqual(await resolveLaunchSelection(rex,local,settings,parseLaunchArgs(['--endpoint','local'])),{hostId:'local',sessionId:'',windowId:''});
});

test('explicit launch block selection locates exact hidden panes and restores their layer',async()=>{
  const{rex,calls}=backend();
  const selection=await resolveLaunchSelection(rex,local,DEFAULT_SETTINGS,parseLaunchArgs(['--block','hidden-exact-id']));
  assert.deepEqual(selection,{hostId:'local',sessionId:'b',windowId:'wb',blockId:'hidden-exact-id'});
  assert.deepEqual(calls.filter(call=>call.method.startsWith('session.')&&call.method!=='session.view'),[
    {method:'session.set_layer_state',payload:{session_id:'b',layer_id:'floating',state:'normal',focus:true}},
    {method:'session.focus_block',payload:{session_id:'b',block_id:'hidden-exact-id'}},
  ]);
  calls.length=0;
  await assert.rejects(resolveLaunchSelection(rex,local,DEFAULT_SETTINGS,parseLaunchArgs(['--session','a','--block','hidden-exact-id'])),/No pane/);
  assert.deepEqual(calls.filter(call=>call.method.startsWith('session.')&&call.method!=='session.view'),[]);
});

test('only explicit new-session launch creates, and startup commands follow effective host locality',async()=>{
  const{rex,calls}=backend();const settings={...structuredClone(DEFAULT_SETTINGS),startupCommand:'local-shell -l'};
  assert.deepEqual(await resolveLaunchSelection(rex,local,settings,parseLaunchArgs(['--new','new'])),{hostId:'local',sessionId:'created',windowId:'new-tab'});
  assert.deepEqual(calls.filter(call=>call.method==='create'),[{method:'create',payload:{label:'new',cwd:undefined,command:'local-shell -l'}}]);
  calls.length=0;rex.control=async()=>({endpoint:'https://env-remote.example'});
  await resolveLaunchSelection(rex,local,settings,parseLaunchArgs(['--new','remote']));
  assert.equal(calls.find(call=>call.method==='create')?.payload.command,undefined);
  calls.length=0;
  await resolveLaunchSelection(rex,{...local,startupCommand:'remote-shell -l'},settings,parseLaunchArgs(['--new','remote']));
  assert.equal(calls.find(call=>call.method==='create')?.payload.command,'remote-shell -l');
});

test('empty-host and block launch selections persist, with bounded sidebar width',()=>{
  const settings={...structuredClone(DEFAULT_SETTINGS),lastSelection:{hostId:'local',sessionId:'',windowId:''}};
  assert.deepEqual(validateSettings(settings).lastSelection,settings.lastSelection);
  const block={hostId:'local',sessionId:'s',windowId:'w',blockId:'exact-block'};
  assert.deepEqual(validateSettings({...settings,lastSelection:block}).lastSelection,block);
  assert.throws(()=>validateSettings({...settings,lastSelection:{...block,sessionId:''}}),/empty host/);
  for(const sidebarWidth of [189,501,Infinity])assert.throws(()=>validateSettings({...settings,sidebarWidth}));
});
