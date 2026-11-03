import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityRegistry, parseActivity } from '../electron/features/activity.js';
import { CredentialsStore, validateCredentials } from '../electron/features/credentials.js';
import { IntegrationManager, integrationArgs } from '../electron/features/integrations.js';
import { parseTheme } from '../electron/features/themes.js';
import { validateBounds } from '../electron/features/layout.js';
import { readConfig, writeConfig } from '../electron/features/config.js';
import { DEFAULT_SETTINGS, type ClientEvent } from '../src/shared/types.js';
import { KeymapRouter, matchesKey } from '../electron/features/keymap.js';
import {desktopAllowed,noticeSound} from '../electron/features/notifications.js';
import {TailscaleNotices} from '../electron/features/tailscale.js';
import {linkDecision,validateTrustedLink} from '../electron/features/links.js';
import {validateSettings} from '../electron/settings.js';
import {serverShortcut} from '../src/shared/actions.js';

test('program activity seeds silently, notifies only live changes, and respects visibility and preferences',()=>{
  const events:ClientEvent[]=[], notices:ClientEvent[]=[];
  const settings=structuredClone(DEFAULT_SETTINGS.notifications);
  const registry=new ActivityRegistry(event=>events.push(event),event=>notices.push(event),()=>settings);
  registry.track('local',{id:'s',label:'session',activeWindowId:'w',windows:[{id:'w',label:'tab',focusedBlockId:'b',panes:[{id:'b',label:'shell',rect:[0,0,1,1]}]}]});
  registry.seed('local','s','b',{records:[{id:'build',state:'working'}]},{title:'Build'},{foreground:{argv0:'/usr/bin/cargo',cwd:'/project'}});
  assert.equal(notices.length,0);
  assert.equal((events.at(-1)as any).program,'cargo');assert.equal((events.at(-1)as any).cwd,'/project');
  const event=(state:string)=>({creator_name:'com.superlogical.terminal',block_id:'b',name:'program_status_changed',payload:{id:'build',record:{state,kind:'permission',effective_app:'codex',progress:42}}});
  registry.setContext({hostId:'local',sessionId:'other',windowId:'other',visible:true});
  registry.apply('local','s',event('blocked'));registry.apply('local','s',event('blocked'));
  assert.equal(notices.length,1);assert.equal((notices[0]as any).title,'Needs approval');
  registry.setContext({hostId:'local',sessionId:'s',windowId:'w',visible:true});registry.apply('local','s',event('done'));
  assert.equal(notices.length,1);
  registry.apply('local','s',{creator_name:'com.superlogical.terminal',block_id:'b',name:'desktop_notification',payload:{title:'Ready',body:'Message'}});
  assert.equal(notices.length,2);
  settings.enabled=false;registry.apply('local','s',event('error'));assert.equal(notices.length,2);
  registry.apply('local','s',{creator_name:'com.superlogical.terminal',block_id:'b',name:'program_status_removed',payload:{ids:['build']}});
  assert.deepEqual((events.at(-1)as any).activities,[]);
  assert.equal(parseActivity({state:'future-state',progress:200}).state,'idle');
});

test('integration changes require a fresh single-use preview and pass only supported agents',async()=>{
  const calls:string[][]=[];
  const manager=new IntegrationManager(async args=>{calls.push(args);return JSON.stringify({steps:[{change:'create',path:'/test/skill'}]});});
  const change={operation:'setup' as const,agents:['codex','pi'],letAgentsNameSessions:false};
  const preview=await manager.preview(change);
  assert.ok(calls[0].includes('--dry-run'));assert.ok(calls[0].includes('--session-naming=false'));assert.equal(calls[0][0],'--autostart=false');
  await manager.apply(preview.previewId);
  assert.ok(calls[1].includes('--dry-run'));assert.ok(!calls[2].includes('--dry-run'));
  await assert.rejects(manager.apply(preview.previewId),/expired/);
  assert.throws(()=>integrationArgs({...change,agents:['codex; rm']},true),/supported/);
  manager.dispose();
});

test('changed integration previews never write agent configuration',async()=>{
  let count=0;const calls:string[][]=[];
  const manager=new IntegrationManager(async args=>{calls.push(args);return JSON.stringify({steps:[{change:++count===1?'create':'conflict'}]});});
  const preview=await manager.preview({operation:'remove',agents:['codex'],letAgentsNameSessions:false});
  await assert.rejects(manager.apply(preview.previewId),/changed/);assert.equal(calls.length,2);assert.ok(calls.every(args=>args.includes('--dry-run')));manager.dispose();
});

test('host secrets persist only encrypted and cannot be stored with an unavailable secret service',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'linusaurus-credentials-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'secrets.json');let available=true;
  const cipher={available:async()=>available,encrypt:async(value:string)=>Buffer.from(value.split('').reverse().join('')),decrypt:async(value:Buffer)=>value.toString().split('').reverse().join('')};
  const store=new CredentialsStore(path,cipher);await store.load();await store.set('remote',{username:'user',password:'not-plaintext'});
  assert.ok(!(await readFile(path,'utf8')).includes('not-plaintext'));
  const reopened=new CredentialsStore(path,cipher);await reopened.load();assert.deepEqual(await reopened.get('remote'),{username:'user',password:'not-plaintext'});
  assert.deepEqual(await reopened.status('remote'),{stored:true,secureStorageAvailable:true});
  available=false;await assert.rejects(reopened.set('remote',{token:'token'}),/secure desktop/);
  available=true;await reopened.remove('remote');assert.equal((await reopened.status('remote')).stored,false);
  assert.throws(()=>validateCredentials({username:'u',password:'p',token:'t'}),/either/);
});

test('theme imports parse Ghostty and iTerm colors without processing executable or XML directives',()=>{
  assert.deepEqual(parseTheme('background = #112233\nforeground=#abcdef\npalette = 1=#ff0000\ncommand=rm -rf /'),{background:'#112233',foreground:'#abcdef',red:'#ff0000'});
  assert.deepEqual(parseTheme('<plist><dict><key>Background Color</key><dict><key>Red Component</key><real>1</real><key>Green Component</key><real>0.5</real><key>Blue Component</key><real>0</real></dict></dict></plist>'),{background:'#ff8000'});
  assert.throws(()=>parseTheme('background=url(https://bad.test)'),/No supported/);
});

test('local config editor makes a backup and replaces only its resolved configured path',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'linusaurus-config-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'rex','init.lua');await writeConfig(path,'-- first\n');await writeConfig(path,'-- second\n');
  assert.equal(await readConfig(path),'-- second\n');assert.equal(await readFile(`${path}.linusaurus-backup`,'utf8'),'-- first\n');
  await assert.rejects(writeConfig(path,'bad\0config'),/text/);
  assert.deepEqual(validateBounds([.1,.2,.8,.7]),[.1,.2,.8,.7]);assert.throws(()=>validateBounds([.9,.2,.8,.7]),/inside/);
});

test('resolved keymaps respect physical/layout keys, shortcut precedence, sequences and exclusive once modes',()=>{
  const changes:unknown[]=[];const router=new KeymapRouter(value=>changes.push(value));
  const key=(key:string,mods='',point=0,text='')=>({key,mods,consumed_mods:'',text,unshifted_codepoint:point,composing:false,action:'press' as const});
  const a=key('key_q','ctrl',97);
  assert.ok(matchesKey('ctrl+a',a));assert.ok(matchesKey('ctrl+[KeyQ]',a));assert.ok(!matchesKey('ctrl+[KeyA]',a));
  router.setMap({actions:[{name:'client.sidebar.toggle'},{name:'client.mode.enter'},{name:'client.mode.exit'}],bindings:[
    {keys:['ctrl+b','z'],action:'client.sidebar.toggle'},
    {keys:['ctrl+r'],action:'client.mode.enter',args:{name:'resize',once:true}},
    {keys:['h'],mode:'resize',action:'client.sidebar.toggle'},
    {keys:['ctrl+x'],action:'unknown.client'},
    {keys:['ctrl+x'],action:'client.sidebar.toggle'},
  ],modes:[{name:'resize',exclusive:true,blocked:[['left']]}],warnings:[]});
  assert.equal(router.route(key('key_b','ctrl',98)).kind,'consume');
  assert.deepEqual(router.route(key('key_z','',122,'z')),{kind:'action',action:'client.sidebar.toggle',args:{},prefix:['ctrl+b']});
  assert.equal(router.route({...key('key_b'),action:'release'}).kind,'consume');
  assert.equal((router.route(key('key_x','ctrl',120))as any).action,'client.sidebar.toggle');
  router.mode('enter','resize',true);
  assert.equal(router.route(key('arrow_left')).kind,'consume');
  assert.equal(router.route(key('key_y','',121,'y')).kind,'consume');
  assert.equal((router.route(key('key_h','',104,'h'))as any).action,'client.sidebar.toggle');
  assert.equal(router.route(key('key_y','',121,'y')).kind,'forward');
  router.mode('enter','resize');assert.equal(router.route(key('escape')).kind,'consume');
  assert.equal(router.route(key('key_y','',121,'y')).kind,'forward');
  assert.ok(changes.length>0);router.dispose();
});

test('desktop, in-app, badge, and sound channels are independent and keep the master switch',()=>{
  const emitted:ClientEvent[]=[],desktop:ClientEvent[]=[],badges:number[]=[];const preferences=structuredClone(DEFAULT_SETTINGS.notifications);
  const registry=new ActivityRegistry(event=>emitted.push(event),event=>desktop.push(event),()=>preferences,count=>badges.push(count));
  registry.track('h',{id:'s',label:'s',activeWindowId:'w',windows:[{id:'w',label:'w',focusedBlockId:'b',panes:[{id:'b',label:'b',rect:[0,0,.5,1]},{id:'b2',label:'b2',rect:[.5,0,.5,1]}]}]});
  registry.setContext({hostId:'h',sessionId:'other',windowId:'other',visible:true});
  preferences.desktopEnabled=false;
  registry.apply('h','s',{creator_name:'com.superlogical.terminal',block_id:'b',name:'program_status_changed',payload:{id:'',record:{state:'blocked'}}});
  assert.ok(emitted.some(event=>event.type==='notification'));assert.equal(desktop.length,0);assert.equal(badges.at(-1),1);
  registry.apply('h','s',{creator_name:'com.superlogical.terminal',block_id:'b2',name:'program_status_changed',payload:{id:'',record:{state:'blocked'}}});assert.equal(badges.at(-1),1,'Two unread panes in one tab count as one badge');
  preferences.channels.blocked.badge=false;registry.setContext({hostId:'h',sessionId:'other',windowId:'other',visible:true});assert.equal(badges.at(-1),0);
  preferences.desktopEnabled=true;preferences.channels.blocked.desktop=false;assert.equal(desktopAllowed(preferences,'blocked'),false);
  preferences.sound=true;preferences.channels.blocked.sound=false;assert.equal(noticeSound(preferences,'blocked'),false);
  preferences.enabled=false;registry.setContext({hostId:'h',sessionId:'other',windowId:'other',visible:true});assert.equal(badges.at(-1),0);assert.equal(desktopAllowed(preferences,'done'),false);
});

test('Tailscale notices are based on live documented state changes, with no provisioning or startup alerts',()=>{
  const emitted:ClientEvent[]=[],desktop:ClientEvent[]=[];const preferences=structuredClone(DEFAULT_SETTINGS.notifications);preferences.programMessages=false;
  const tracker=new TailscaleNotices(event=>emitted.push(event),event=>desktop.push(event),()=>preferences);
  tracker.apply('h','Remote',{tailscale:{state:'needs_login',auth_url:'https://login.test/old'}},false);
  assert.equal(emitted.length,0);
  tracker.apply('h','Remote',{state:'needs_login',auth_url:'https://login.test/new'},true);
  tracker.apply('h','Remote',{state:'needs_login',auth_url:'https://login.test/new'},true);
  assert.equal(emitted.length,1);assert.equal(desktop.length,1);
  preferences.desktopEnabled=false;tracker.apply('h','Remote',{state:'needs_machine_approval'},true);
  assert.equal(emitted.length,2);assert.equal(desktop.length,1);
  preferences.tailscaleError=false;tracker.apply('h','Remote',{state:'disabled',error:'Test failure'},true);assert.equal(emitted.length,2);
});

test('preference migration preserves legacy desktop choices and validates channel, theme, and history fields',()=>{
  const legacy={...DEFAULT_SETTINGS,notifications:{enabled:true,showInTabs:true,working:false,blocked:true,error:true,done:true,sound:false,badge:true,programMessages:true,position:'top-right'}};
  const migrated=validateSettings(legacy);assert.equal(migrated.notifications.working,true);assert.equal(migrated.notifications.channels.working.desktop,false);assert.equal(migrated.notifications.channels.working.tabs,true);
  assert.equal(validateSettings({...DEFAULT_SETTINGS,customDarkTheme:{palette255:'#123456'},recentPaths:{local:['/tmp']}}).customDarkTheme?.palette255,'#123456');
  assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,notifications:{...DEFAULT_SETTINGS.notifications,channels:{blocked:{desktop:'yes'}}}}),/Invalid blocked/);
  assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,recentPaths:{local:Array(21).fill('/tmp')}}),/20 paths/);
  assert.equal(serverShortcut('Ctrl+Equal'),'ctrl+=');assert.equal(serverShortcut('Ctrl+Minus'),'ctrl+-');assert.equal(serverShortcut('Ctrl+[KeyD] > Shift+Z'),'ctrl+[KeyD]>shift+z');
});

test('application links require the selected policy and never allow executable or file URL schemes',()=>{
  assert.equal(linkDecision('https://example.test/path','never',[]).confirmation,false);
  assert.equal(linkDecision('vscode://file/project','ask',[]).confirmation,true);
  assert.equal(linkDecision('vscode://file/other?x=1','ask',['vscode://file']).confirmation,false);
  assert.equal(validateTrustedLink('ssh://host.test'),'ssh://host.test');
  assert.throws(()=>linkDecision('ssh://user@host.test','never',[]),/disabled/);
  for(const url of ['javascript:alert(1)','data:text/plain,unsafe','file:///etc/passwd','vbscript:msgbox(1)','https://user:secret@host.test/'])assert.throws(()=>linkDecision(url,'always',[]));
});
