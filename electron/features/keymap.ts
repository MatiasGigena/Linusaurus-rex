import type { KeyBinding, KeymapResult, RexKeyEvent } from '../../src/shared/types.js';

type Mode={name:string;exclusive?:boolean;blocked?:string[][]};
type StackMode={name:string;once:boolean};
type Route={kind:'forward';prefix?:string[]}|{kind:'consume'}|{kind:'action';action:string;args:Record<string,unknown>;prefix:string[]};
const modifierAliases:Record<string,string>={control:'ctrl',cmd:'super',command:'super',meta:'super',option:'alt'};
const keyAliases:Record<string,string>={arrow_up:'up',arrow_down:'down',arrow_left:'left',arrow_right:'right',arrowup:'up',arrowdown:'down',arrowleft:'left',arrowright:'right',return:'enter',esc:'escape',page_up:'pageup',page_down:'pagedown',space:' ',plus:'+',minus:'-'};
const modifierSet=(value:string)=>value.toLowerCase().split('+').filter(Boolean).map(value=>modifierAliases[value]||value).filter(value=>!['caps_lock','num_lock','shift_side','ctrl_side','alt_side','super_side'].includes(value)).sort().join('+');
const physical=(value:string)=>value.replace(/([a-z])([A-Z0-9])/g,'$1_$2').toLowerCase();

export function matchesKey(chord:string,event:RexKeyEvent):boolean {
  const parts=chord.split('+');let key=parts.pop()||'+';if(!key&&parts.at(-1)==='')parts.pop();
  const altGraphText=Boolean(event.text&&event.consumed_mods.split('+').includes('ctrl')&&event.consumed_mods.split('+').includes('alt'));
  const effectiveMods=altGraphText?event.mods.split('+').filter(mod=>mod!=='ctrl'&&mod!=='alt').join('+'):event.mods;
  if(modifierSet(parts.join('+'))!==modifierSet(effectiveMods))return false;
  if(key.startsWith('[')&&key.endsWith(']'))return physical(key.slice(1,-1))===event.key;
  key=key.toLowerCase();key=keyAliases[key]??key;
  const name=keyAliases[event.key]??event.key;
  if(name===key)return true;
  const point=event.unshifted_codepoint?String.fromCodePoint(event.unshifted_codepoint).toLowerCase():'';
  if(point&&point===key)return true;
  if(event.text&&[...event.text].length===1&&event.text.toLowerCase()===key)return true;
  return key==='enter'&&event.key==='numpad_enter';
}

/** Resolves the server's ordered keymap, including key sequences and client-owned modes. */
export class KeymapRouter {
  private map:KeymapResult={actions:[],bindings:[],modes:[],warnings:[]};
  private prefixEvents:RexKeyEvent[]=[];
  private modeStack:StackMode[]=[];
  private consumed=new Set<string>();
  private timer?:ReturnType<typeof setTimeout>;
  constructor(private changed:(state:{prefix:string[];mode?:string;hints:string[]})=>void){}
  setMap(map:KeymapResult){this.map=map;this.modeStack=this.modeStack.filter(mode=>map.modes.some(value=>(value as Mode).name===mode.name));this.clearPrefix();}
  mode(operation:'enter'|'exit'|'exitAll',name?:string,once=false){
    if(operation==='enter'){if(!name||!this.map.modes.some(value=>(value as Mode).name===name))throw new Error('The key mode does not exist in this client keymap.');this.modeStack.push({name,once});}
    else if(operation==='exit')this.modeStack.pop();else this.modeStack=[];
    this.clearPrefix();
  }
  route(event:RexKeyEvent):Route {
    if(event.action==='release'){if(this.consumed.delete(event.key))return{kind:'consume'};return{kind:'forward'};}
    if(event.composing)return{kind:'forward'};
    if(this.prefixEvents.length&&/^(?:alt|control|shift|meta)_(?:left|right)$/.test(event.key)){this.consume(event);return{kind:'consume'};}
    const prefix=this.prefixEvents;const events=[...prefix,event];
    const active=[...this.modeStack].reverse();
    for(const entry of active){
      const mode=this.map.modes.find(value=>(value as Mode).name===entry.name) as Mode|undefined;
      const result=this.match(events,this.map.bindings.filter(binding=>binding.mode===entry.name),event,entry);
      if(result)return result;
      const blocked=(mode?.blocked??[]).some(keys=>keys.length===events.length&&keys.every((key,index)=>matchesKey(key,events[index])));
      if(blocked){this.consume(event);this.clearPrefix();return{kind:'consume'};}
      const blockedPrefix=(mode?.blocked??[]).find(keys=>keys.length>events.length&&events.every((event,index)=>matchesKey(keys[index],event)));
      if(blockedPrefix){this.consume(event);this.prefixEvents=events;if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>this.clearPrefix(),2000);this.publish(blockedPrefix.slice(events.length));return{kind:'consume'};}
      if(event.key==='escape'&&!prefix.length){this.consume(event);this.modeStack.pop();this.clearPrefix();return{kind:'consume'};}
      if(mode?.exclusive){this.consume(event);this.clearPrefix();return{kind:'consume'};}
    }
    const result=this.match(events,this.map.bindings.filter(binding=>!binding.mode),event);
    if(result)return result;
    if(prefix.length){this.clearPrefix();return this.route(event);}
    return{kind:'forward'};
  }
  reset(){this.clearPrefix();this.consumed.clear();this.modeStack=[];this.publish();}
  dispose(){if(this.timer)clearTimeout(this.timer);}
  private match(events:RexKeyEvent[],bindings:KeyBinding[],event:RexKeyEvent,mode?:StackMode):Route|undefined {
    for(const binding of bindings){
      if(!binding.action||!Array.isArray(binding.keys)||binding.keys.length<events.length||!events.every((event,index)=>matchesKey(binding.keys[index],event)))continue;
      const action=this.map.actions.find(action=>action.name===binding.action);
      const known=binding.action==='client.key.forward'||Boolean(action);
      if(!known)continue;
      this.consume(event);
      if(binding.keys.length>events.length){
        this.prefixEvents=events;
        if(this.timer)clearTimeout(this.timer);
        this.timer=setTimeout(()=>this.clearPrefix(),2000);this.publish(binding.keys.slice(events.length));
        return{kind:'consume'};
      }
      const prefix=binding.keys.slice(0,-1);this.clearPrefix();
      if(event.action==='repeat'&&action?.repeats===false)return{kind:'consume'};
      if(mode?.once){const index=this.modeStack.lastIndexOf(mode);if(index>=0)this.modeStack.splice(index,1);this.publish();}
      return{kind:'action',action:binding.action,args:binding.args??{},prefix};
    }
    return undefined;
  }
  private consume(event:RexKeyEvent){this.consumed.add(event.key);}
  private clearPrefix(){this.prefixEvents=[];if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.publish();}
  private publish(hints:string[]=[]){this.changed({prefix:this.prefixEvents.map(event=>[event.mods,event.unshifted_codepoint?String.fromCodePoint(event.unshifted_codepoint):event.key].filter(Boolean).join('+')),mode:this.modeStack.at(-1)?.name,hints});}
}
