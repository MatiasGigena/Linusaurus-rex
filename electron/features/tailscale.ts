import {randomUUID} from 'node:crypto';
import type {ClientEvent,NotificationSettings} from '../../src/shared/types.js';
import {desktopAllowed} from './notifications.js';
type Notice=Extract<ClientEvent,{type:'notification'}>&{source:'tailscale'};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** Uses the documented tailscale_status_changed event; never provisions a node. */
export class TailscaleNotices {
  private previous=new Map<string,{state:string;error:string;authUrl:string}>();
  constructor(private emit:(event:ClientEvent)=>void,private notify:(event:Notice)=>void,private settings:()=>NotificationSettings){}
  apply(hostId:string,label:string,value:unknown,live:boolean){
    const input=object(value);const status=object(input.tailscale??value);
    if(typeof status.state!=='string')return;
    const next={state:status.state,error:typeof status.error==='string'?status.error:'',authUrl:typeof status.auth_url==='string'?status.auth_url:''};
    const previous=this.previous.get(hostId);this.previous.set(hostId,next);
    if(!live||!this.settings().enabled)return;
    let title:string|undefined,body='';
    if(next.error&&next.error!==previous?.error&&this.settings().tailscaleError){title='Tailscale connection failed';body=`${label}: ${next.error}`;}
    else if(next.state==='needs_login'&&next.authUrl&&(previous?.state!==next.state||previous?.authUrl!==next.authUrl)&&this.settings().tailscaleLogin){title='Tailscale sign-in required';body=`${label}: Open Server settings to sign in.`;}
    else if(next.state==='needs_machine_approval'&&previous?.state!==next.state&&this.settings().tailscaleApproval){title='Tailscale device approval required';body=`${label}: Ask a tailnet administrator to approve this device.`;}
    if(!title)return;
    const event:Notice={type:'notification',source:'tailscale',id:randomUUID(),hostId,title,body:body.slice(0,4096),kind:'program'};
    this.emit(event);if(desktopAllowed(this.settings(),'program','tailscale'))this.notify(event);
  }
}
