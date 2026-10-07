import { readFile,writeFile,mkdir,copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { powershell } from '../src/bridge/windows.mjs';
import { antigravityHookCommand } from '../src/adapters/hook-command.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),option=(n,d)=>{const i=args.indexOf(n);return i<0?d:args[i+1];};
const dataDir=path.join(root,'.wait/runtime');await mkdir(dataDir,{recursive:true});
if(args.includes('--key')){
  const source=path.resolve(option('--key-file',path.join(root,'groqAPI.txt')));
  await powershell('key-store.ps1',['-Mode','import','-StoreFile',path.join(dataDir,'groq.key'),'-SourceFile',source]);
  console.log('Groq key imported into Windows user-encrypted storage. The original file remains ignored by Git.');
}
function quoted(value){if(/["\r\n%&|<>^!]/.test(value))throw new Error('Unsupported character in hook command path');return `"${value}"`;}
function hookCommand(provider,event){return [quoted(process.execPath),quoted(path.join(root,'dist/vscode/hook-cli.cjs')),'--connection-file',quoted(path.join(dataDir,'connection.json')),'--provider',provider,'--event',event].join(' ');}
const codex={hooks:{}};
for(const event of ['UserPromptSubmit','PreToolUse','PostToolUse','PermissionRequest','Stop','Interrupt'])codex.hooks[event]=[{hooks:[{type:'command',command:hookCommand('codex',event),timeout:5}]}];
const antigravity={'wait-companion':{}};
for(const event of ['PreInvocation','Stop'])antigravity['wait-companion'][event]=[{type:'command',command:antigravityHookCommand(root,dataDir,event),timeout:10}];
const dir=path.join(root,'.wait-setup');await mkdir(dir,{recursive:true});
await writeFile(path.join(dir,'codex-hooks.json'),JSON.stringify(codex,null,2));
await writeFile(path.join(dir,'antigravity-hooks.json'),JSON.stringify(antigravity,null,2));
if(args.includes('--install-hooks') || args.includes('--repair-antigravity')){
  const targets=args.includes('--repair-antigravity') ? [[path.join(os.homedir(),'.gemini','config','hooks.json'),antigravity,'antigravity']] : [[path.join(os.homedir(),'.codex','hooks.json'),codex,'codex'],[path.join(os.homedir(),'.gemini','config','hooks.json'),antigravity,'antigravity']];
  for(const [target,addition,provider] of targets){
    await mkdir(path.dirname(target),{recursive:true});let existing={};
    try{existing=JSON.parse(await readFile(target,'utf8'));await copyFile(target,`${target}.wait-backup-${Date.now()}`);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(provider==='codex'){
      existing.hooks??={};
      for(const [event,groups] of Object.entries(addition.hooks)){
        const previous=existing.hooks[event]??[];
        // Replace only entries installed by this checkout; preserve unrelated hooks.
        existing.hooks[event]=[...previous.filter(g=>!g.hooks?.some(h=>h.command?.includes(path.join(root,'dist/vscode/hook-cli.cjs')))),...groups];
      }
    }else{
      existing['wait-companion']=addition['wait-companion'];
      if(args.includes('--repair-antigravity') && JSON.stringify(existing['hook-alive-test']??{}).includes('hook-alive.txt')) delete existing['hook-alive-test'];
    }
    await writeFile(target,JSON.stringify(existing,null,2));
    console.log(`Installed ${provider} lifecycle hooks. Restart that app to load them.`);
  }
  // Antigravity merges global and project hooks, so leave just one registration.
  const localTarget=path.join(root,'.agents/hooks.json');
  try {
    const local=JSON.parse(await readFile(localTarget,'utf8'));
    if(local['wait-companion']) {
      await copyFile(localTarget,`${localTarget}.wait-backup-${Date.now()}`);
      delete local['wait-companion'];
      if(args.includes('--repair-antigravity') && JSON.stringify(local['hook-alive-test']??{}).includes('hook-alive.txt')) delete local['hook-alive-test'];
      await writeFile(localTarget,JSON.stringify(local,null,2));
      console.log('Removed duplicate project wAIt hooks; global hooks handle this project.');
    }
  } catch(e) { if(e.code!=='ENOENT') throw e; }
}
const manifest=JSON.parse(await readFile(path.join(root,'extensions/browser/manifest.json'),'utf8'));
const stableId=manifest.key ? [...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('') : null;
const id=option('--extension-id',args.includes('--link-browser')?stableId:null);
if(id){await powershell('register-browser.ps1',['-ExtensionId',id,'-Browser','opera','-ConnectionFile',path.join(dataDir,'connection.json')]);console.log('Opera GX native host registered.');}
console.log('Generated hook configurations in .wait-setup.');
if(stableId)console.log(`Opera GX extension ID: ${stableId}`);
