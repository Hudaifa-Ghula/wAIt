import * as vscode from 'vscode';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { startBridge } from '../../src/bridge/server.mjs';
import { createHookNormalizer } from '../../src/adapters/hooks.mjs';
import { createTutor } from '../../src/bridge/tutor.mjs';
let bridge,output,extensionContext;
export async function activate(context){
  extensionContext=context;output=vscode.window.createOutputChannel('wAIt');context.subscriptions.push(output);
  const command=(name,fn)=>context.subscriptions.push(vscode.commands.registerCommand(name,fn));
  command('wait.showStatus',()=>vscode.window.showInformationMessage(bridge?`wAIt running on port ${bridge.connection.port}`:'wAIt is stopped.'));
  command('wait.startServer',()=>start());command('wait.stopServer',()=>stop());
  command('wait.setGroqKey',async()=>{const key=await vscode.window.showInputBox({title:'Groq API key (use a Free plan account)',password:true,ignoreFocusOut:true});if(!key)return;await context.secrets.store('groqApiKey',key.trim());await stop();await start();});
  command('wait.shareSelection',async()=>{
    const editor=vscode.window.activeTextEditor,s=bridge?.store.getSnapshot().session;
    if(!editor||!s)return vscode.window.showWarningMessage('Start a task and select relevant code first.');
    if(editor.selection.isEmpty)return vscode.window.showWarningMessage('Select only the code you want the tutor to explain.');
    try{bridge.setContext(s,{source:'selected text',text:editor.document.getText(editor.selection)});bridge.broadcast();}catch{vscode.window.showWarningMessage('Enable wait.shareContext for this project first.');}
  });
  command('wait.linkBrowser',async()=>{
    const id=await vscode.window.showInputBox({title:'Link Opera GX',prompt:'Extension ID from opera://extensions',validateInput:v=>/^[a-p]{32}$/.test(v)?null:'Enter the 32-letter extension ID.'});
    if(!id||!bridge)return;
    await register(id);await vscode.workspace.getConfiguration('wait').update('browserExtensionId',id,vscode.ConfigurationTarget.Global);
  });
  command('wait.unlinkBrowser',async()=>{await runScript('unregister-browser.ps1',['-Browser',vscode.workspace.getConfiguration('wait').get('browser')||'opera']);});
  command('wait.simulateAgentStart',()=>{if(bridge)bridge.broadcast(bridge.store.dispatch({provider:'demo',sessionId:'preview',runId:String(Date.now()),eventId:String(Date.now()),timestamp:Date.now(),kind:'start',label:'Simulated task (not a real integration)'}));});
  command('wait.simulateAgentStop',()=>{const s=bridge?.store.getSnapshot().session;if(s?.provider==='demo')bridge.broadcast(bridge.store.dispatch({provider:'demo',sessionId:s.sessionId,runId:s.runId,eventId:String(Date.now()),timestamp:Date.now(),kind:'completed'}));});
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async e=>{if(e.affectsConfiguration('wait.shareContext')){await stop();await start();}}));
  await start();
}
async function start(){
  if(bridge)return;
  try{
    const config=vscode.workspace.getConfiguration('wait');const normalizer=createHookNormalizer();const key=await extensionContext.secrets.get('groqApiKey');
    bridge=await startBridge({port:0,dataDir:path.join(extensionContext.globalStorageUri.fsPath,'runtime'),shareContext:config.get('shareContext')===true,tutor:key?createTutor(key):null,
      onHook:r=>normalizer(r.provider,r.event,r.payload),
      onReturn:async session=>{normalizer.returned(session);await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');vscode.window.showInformationMessage('Your agent needs your attention.');}
    });
    output.appendLine(`Connection file: ${bridge.connectionFile}`);
    if(config.get('browserExtensionId'))await register(config.get('browserExtensionId'));
  }catch{output.appendLine('Bridge startup failed. Check Node version and local port availability.');}
}
async function stop(){if(bridge){await bridge.close();bridge=null;}}
function runScript(name,args){
  const bundled=path.join(extensionContext.extensionPath,name),dev=path.resolve(extensionContext.extensionPath,'../../scripts',name);
  const script=existsSync(bundled)?bundled:dev;
  return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,...args],{windowsHide:true,timeout:30000},error=>error?reject(new Error('Native host setup failed.')):resolve()));
}
function register(id){return runScript('register-browser.ps1',['-ExtensionId',id,'-Browser',vscode.workspace.getConfiguration('wait').get('browser')||'opera','-ConnectionFile',bridge.connectionFile]);}
export async function deactivate(){await stop();}
