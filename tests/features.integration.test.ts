import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RexService } from '../electron/rex/service.js';
import { ClientFeatures } from '../electron/client/client.js';
import { DEFAULT_SETTINGS } from '../src/shared/types.js';
import { layoutAction } from '../electron/features/layout.js';

test('installed Rex supports registered client actions, Lua key forwarding, and advanced layout changes',{skip:process.env.REX_INTEGRATION!=='1',timeout:30_000},async()=>{
  const settings=structuredClone(DEFAULT_SETTINGS);settings.clientLabel='Linusaurus features verification';settings.notifications.enabled=false;
  const host=settings.hosts[0];let features:ClientFeatures;
  const rex=new RexService({onControl:(host,control)=>features.bindControl(host,control)});
  const performed:string[]=[];
  features=new ClientFeatures(rex,{settings:()=>settings,notify:()=>{throw new Error('Tests must not send notifications');},emit:event=>{if(event.type==='action'){performed.push(event.name);features.reply(event.requestId,{performed:true});}}});
  const caller=new RexService();let sessionId:string|undefined;
  try{
    sessionId=await rex.createSession(host,`linusaurus-features-${Date.now()}`);
    const view=await rex.inspect(host,sessionId);const blockId=view.windows[0].panes[0].id;const control=await rex.control(host);
    const directory=await rex.callMethod<any>(host,'com.superlogical.terminal.list_dir',{session_id:sessionId,block_id:blockId,args:{path:'/tmp',files:true,limit:4}});
    assert.equal(directory.status,'ok');assert.equal(directory.path,'/tmp');assert.ok(directory.entries.length<=4);
    await features.configure(host);
    const inspected=await caller.callMethod<any>(host,'client.inspect',{client_id:control.welcome!.client!.id});
    assert.ok(inspected.actions?.some((action:any)=>action.name==='client.sidebar.toggle'));
    const reply=await caller.callMethod<any>(host,'client.perform',{client_id:control.welcome!.client!.id,action:'client.sidebar.toggle',args:{},timeout_ms:5000});
    assert.ok(reply);assert.deepEqual(performed,['client.sidebar.toggle']);
    await control.call('client.set_script',{scripts:[{name:'linusaurus-features.lua',source:'rex.bind("ctrl+g", function(ctx, ev)\n rex.session.set_label{label="features-key-worked"}\n return true\nend)\nrex.bind("ctrl+b>z", function(ctx, ev)\n rex.session.set_label{label="features-sequence-worked"}\n return true\nend)\nrex.mode("verification",{exclusive=true})\nrex.bind("ctrl+r","client.mode.enter",{name="verification",once=true})\nrex.bind("verification/h","client.sidebar.toggle")'}]});
    await features.configure(host);
    const key=await features.input(host,'key',sessionId,blockId,{key:'key_g',mods:'ctrl',consumed_mods:'',text:'',unshifted_codepoint:103,composing:false,action:'press'});
    assert.equal((key as any).handled,true);assert.equal((await rex.inspect(host,sessionId)).label,'features-key-worked');
    await features.input(host,'key',sessionId,blockId,{key:'key_b',mods:'ctrl',consumed_mods:'',text:'',unshifted_codepoint:98,composing:false,action:'press'});
    await features.input(host,'key',sessionId,blockId,{key:'key_z',mods:'',consumed_mods:'',text:'z',unshifted_codepoint:122,composing:false,action:'press'});
    assert.equal((await rex.inspect(host,sessionId)).label,'features-sequence-worked');
    await features.input(host,'key',sessionId,blockId,{key:'key_r',mods:'ctrl',consumed_mods:'',text:'',unshifted_codepoint:114,composing:false,action:'press'});
    await features.input(host,'key',sessionId,blockId,{key:'key_h',mods:'',consumed_mods:'',text:'h',unshifted_codepoint:104,composing:false,action:'press'});
    assert.deepEqual(performed,['client.sidebar.toggle','client.sidebar.toggle']);
    await rex.split(host,sessionId,blockId,'right');
    const split=(await rex.inspect(host,sessionId)).windows[0];const other=split.panes.find(pane=>pane.id!==blockId)!.id;
    await rex.callMethod(host,'session.resize_pane',{session_id:sessionId,direction:'horizontal',before_block_id:blockId,after_block_id:other,ratio:.3});
    assert.equal((await rex.inspect(host,sessionId)).windows[0].panes[0].rect[2],.3);
    await layoutAction((host,method,args)=>rex.callMethod(host,method,args),host,{sessionId,blockId,operation:'balance'});
    assert.equal((await rex.inspect(host,sessionId)).windows[0].panes[0].rect[2],.5);
    await layoutAction((host,method,args)=>rex.callMethod(host,method,args),host,{sessionId,blockId,operation:'float'});
    const floated=(await rex.callMethod<any>(host,'session.view',{session_id:sessionId})).windows[0].layers.find((layer:any)=>layer.kind==='floating');
    assert.ok(floated);
    await layoutAction((host,method,args)=>rex.callMethod(host,method,args),host,{sessionId,blockId,operation:'minimize',layerId:floated.layer_id});
    await layoutAction((host,method,args)=>rex.callMethod(host,method,args),host,{sessionId,blockId,operation:'restore',layerId:floated.layer_id});
    await layoutAction((host,method,args)=>rex.callMethod(host,method,args),host,{sessionId,blockId,operation:'moveToNewTab'});
    assert.equal((await rex.inspect(host,sessionId)).windows.length,2);
  }finally{
    features.dispose();
    if(sessionId)await rex.callMethod(host,'session.destroy',{session_id:sessionId});
    rex.dispose();caller.dispose();
  }
});
