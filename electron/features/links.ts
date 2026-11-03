const appSchemes=new Set(['mailto:','ssh:','sftp:','vscode:','vscode-insiders:','vscode-remote:','jetbrains:','idea:','pycharm:','webstorm:','goland:','clion:','rider:','rubymine:','phpstorm:','zed:']);
export type AppLinkMode='ask'|'always'|'never';
export interface LinkDecision {url:string;kind:'web'|'app';target:string;confirmation:boolean}

/** Native application URLs are opened only according to an explicit user policy. */
export function linkDecision(value:string,mode:AppLinkMode,trusted:readonly string[]):LinkDecision {
  if(value.length>8192||/[\0\r\n]/.test(value))throw new Error('Invalid external link.');
  let url:URL;try{url=new URL(value);}catch{throw new Error('This link does not contain a valid URL.');}
  if(url.password)throw new Error('Links containing an embedded password cannot be opened.');
  if(url.protocol==='https:'||url.protocol==='http:')return{url:url.href,kind:'web',target:url.origin,confirmation:false};
  if(!appSchemes.has(url.protocol))throw new Error('This application link protocol is not supported.');
  if(mode==='never')throw new Error('Application links are disabled in Settings.');
  const target=`${url.protocol}${url.host?`//${url.host.toLowerCase()}`:''}`;
  return{url:url.href,kind:'app',target,confirmation:mode==='ask'&&!trusted.includes(target)};
}
export function validateTrustedLink(value:string):string {
  const decision=linkDecision(value,'always',[]);
  if(decision.kind!=='app'||decision.target!==value)throw new Error('Invalid trusted application target.');
  return decision.target;
}
