import { readFile, mkdir, writeFile, rename, copyFile, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';

export function isLocalEndpoint(endpoint:string) { return !endpoint||endpoint.startsWith('unix://')||endpoint.startsWith('/'); }
export async function readConfig(path:string):Promise<string> {
  try { const value=await readFile(path,'utf8');if(Buffer.byteLength(value)>1024*1024)throw new Error('The Rex configuration is larger than the 1 MiB editor limit.');return value; }
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return '';throw error;}
}
export async function writeConfig(path:string,content:string) {
  if(Buffer.byteLength(content)>1024*1024||content.includes('\0'))throw new Error('The Rex configuration must be text smaller than 1 MiB.');
  const target=await realpath(path).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return path;throw error;});
  await mkdir(dirname(target),{recursive:true});
  try{await copyFile(target,`${target}.linusaurus-backup`);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const temporary=`${target}.linusaurus-${process.pid}.tmp`;
  await writeFile(temporary,content,{mode:0o600});await rename(temporary,target);
}
