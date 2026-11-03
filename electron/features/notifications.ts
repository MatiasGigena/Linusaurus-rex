import type { NotificationSettings } from '../../src/shared/types.js';
export type NoticeKind='working'|'blocked'|'error'|'done'|'program';
export function noticeAllowed(settings:NotificationSettings,kind:NoticeKind,source?:string){return settings.enabled&&(source==='tailscale'||(kind==='program'?settings.programMessages:settings[kind]));}
export function desktopAllowed(settings:NotificationSettings,kind:NoticeKind,source?:string){return noticeAllowed(settings,kind,source)&&settings.desktopEnabled&&(kind==='program'||settings.channels[kind].desktop);}
export function noticeSound(settings:NotificationSettings,kind:NoticeKind){return settings.sound&&(kind==='program'||settings.channels[kind].sound);}
export function badgeAllowed(settings:NotificationSettings,state:string){return settings.enabled&&settings.badge&&['working','blocked','error','done'].includes(state)&&settings[state as Exclude<NoticeKind,'program'>]&&settings.channels[state as Exclude<NoticeKind,'program'>].badge;}
