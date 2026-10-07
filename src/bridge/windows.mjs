import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const exec=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export async function powershell(script,args=[]){
  const result=await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts',script),...args],{windowsHide:true,timeout:10000,maxBuffer:64000});return result.stdout.trim();
}
export async function loadGroqKey(dataDir){
  if(process.env.GROQ_API_KEY)return process.env.GROQ_API_KEY.trim();
  try{return await powershell('key-store.ps1',['-Mode','load','-StoreFile',path.join(dataDir,'groq.key')]);}catch{return null;}
}
export function createWindowReturn(){
  const targets=new Map();
  return {
    async capture(session){
      if(!['codex','antigravity'].includes(session.provider))return;
      try{const target=JSON.parse(await powershell('agent-window.ps1',['-Mode','capture','-Provider',session.provider]));targets.set(`${session.provider}:${session.sessionId}`,target);}catch{}
    },
    async focus(session){
      const target=targets.get(session.key);
      if(!target)throw new Error('Originating window not identified');
      await powershell('agent-window.ps1',['-Mode','focus','-Provider',session.provider,'-WindowHandle',String(target.windowHandle),'-ProcessId',String(target.processId),'-Started',target.started]);
    }
  };
}
