import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { sanitizeContext } from '../bridge/context.mjs';
import { matchesProject } from './workspace.mjs';
const exec = promisify(execFile);
export async function hookContext(raw, event, connection) {
  if (!connection.shareContext || !connection.projectRoot) return null;
  const root = path.resolve(connection.projectRoot);
  if (!matchesProject(raw, root)) return null;
  if (event === 'UserPromptSubmit' && typeof raw.prompt === 'string') return sanitizeContext({source:'task prompt',text:raw.prompt});
  if (!['PostToolUse','PreInvocation'].includes(event)) return null;
  try {
    const {stdout:names}=await exec('git',['diff','--name-only','--no-ext-diff'],{cwd:root,windowsHide:true,timeout:1000,maxBuffer:16000});
    const files=names.split(/\r?\n/).filter(name=>/\.(?:[cm]?[jt]sx?|py|rs|go|css|html|java|cs|sql)$/.test(name)&&!/(?:secret|credential|token|password|api.?key|node_modules|vendor)/i.test(name)).slice(0,6);
    if(!files.length)return null;
    const {stdout}=await exec('git',['diff','--no-ext-diff','--no-textconv','--unified=2','--',...files],{cwd:root,windowsHide:true,timeout:1000,maxBuffer:32000});
    return stdout.trim()?sanitizeContext({source:'recent diff',text:stdout}):null;
  }catch{return null;}
}
