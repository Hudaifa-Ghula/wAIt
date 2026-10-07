import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { startBridge } from '../src/bridge/server.mjs';
import { createHookNormalizer } from '../src/adapters/hooks.mjs';
import { createTutor } from '../src/bridge/tutor.mjs';
import { loadGroqKey, createWindowReturn } from '../src/bridge/windows.mjs';
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const port=Number(option('--port',process.env.WAIT_PORT||'43187'));
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Choose a valid local port.');
const projectRoot=path.resolve(option('--project',process.cwd()));
// Hook and native-host registration always point to this checkout's runtime.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=path.resolve(option('--data-dir',path.join(root,'.wait/runtime')));
const shareContext=args.includes('--share-context');
const apiKey=await loadGroqKey(dataDir);
const normalizer=createHookNormalizer();const windows=createWindowReturn();
const bridge=await startBridge({port,dataDir,shareContext,tutor:apiKey?createTutor(apiKey):null,
  onHook:async request=>{const event=normalizer(request.provider,request.event,request.payload);if(event?.kind==='start')await windows.capture(event);return event;},
  onReturn:session=>{normalizer.returned(session);return windows.focus(session);}
});
await writeFile(bridge.connectionFile,JSON.stringify({...bridge.connection,projectRoot}),{mode:0o600});
console.log(`wAIt companion running on 127.0.0.1:${bridge.connection.port}.`);
console.log(`Waiting for a NEW agent task in: ${projectRoot}`);
console.log('Browser connected means the bridge is reachable. To troubleshoot task detection: npm run diagnose');
console.log(`Groq: ${apiKey?'configured':'run npm run setup:key'}; project context sharing: ${shareContext?'enabled for '+projectRoot:'disabled'}.`);
console.log('Use a Groq Free plan account. This app never upgrades plans or purchases credits. Ctrl+C stops the companion.');
let closing=false;
async function stop(){if(closing)return;closing=true;await bridge.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
