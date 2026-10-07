import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startBridge} from '../src/bridge/server.mjs';
import {createTutor,buildMessages} from '../src/bridge/tutor.mjs';
import {sanitizeContext} from '../src/bridge/context.mjs';
import {createHookNormalizer} from '../src/adapters/hooks.mjs';
const summary=Array.from({length:100},(_,i)=>`word${i}`).join(' ');
const event=(kind,extra={})=>({provider:'codex',sessionId:'test',runId:'r1',eventId:crypto.randomUUID(),kind,timestamp:Date.now(),...extra});
async function fixture(t,options={}){
 const dir=await mkdtemp(path.join(os.tmpdir(),'wait-tutor-'));
 const bridge=await startBridge({port:0,dataDir:dir,shareContext:true,...options});
 t.after(async()=>{await bridge.close();await rm(dir,{recursive:true,force:true});});
 const request=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${bridge.connection.port}${route}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${bridge.connection.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};};
 await request('/event',event('start'));await request('/waiting',{mode:'learn'});
 return {bridge,request};
}
const mockTutor=()=>createTutor('gsk_test',{fetchImpl:async()=>new Response(JSON.stringify({model:'openai/gpt-oss-120b',choices:[{finish_reason:'stop',message:{content:summary}}]}),{status:200})});
test('generation is independent of return, cached, and records display/understanding separately',async t=>{
 let returned=0;const {request}=await fixture(t,{tutor:mockTutor(),onReturn:()=>returned++});
 assert.equal((await request('/tutor/generate',{})).status,422);
 await request('/context',{source:'selected text',text:'const sum = values.reduce((a, b) => a + b, 0);'});
 const lesson=await request('/tutor/generate',{});assert.equal(lesson.status,200);assert.equal(returned,0);
 assert.equal(lesson.body.displayedAt,null);assert.equal(lesson.body.understoodAt,null);
 assert.equal((await request('/tutor/generate',{})).body.id,lesson.body.id);
 await request('/tutor/feedback',{lessonId:lesson.body.id,action:'displayed'});
 let history=(await request('/tutor/history',{})).body.lessons;assert.ok(history[0].displayedAt);assert.equal(history[0].understoodAt,null);
 await request('/tutor/feedback',{lessonId:lesson.body.id,action:'understood'});
 history=(await request('/tutor/history',{})).body.lessons;assert.ok(history[0].understoodAt);
 await request('/tutor/memory',{action:'forget',lessonId:lesson.body.id});assert.deepEqual((await request('/tutor/history',{})).body.lessons,[]);
});
test('completion cancels pending lesson without storing it or delaying return',async t=>{
 let entered;const started=new Promise(r=>entered=r);let finish;
 const tutor={generate:({signal})=>{entered();return new Promise(resolve=>{finish=resolve;});}};
 let returned=0;const {request}=await fixture(t,{tutor,onReturn:()=>returned++,returnDelay:20});
 await request('/context',{text:'Selected code example'});
 const pending=request('/tutor/generate',{});await started;
 await request('/event',event('completed'));
 await new Promise(r=>setTimeout(r,45));assert.equal(returned,1);
 finish({id:'discard-me'});assert.equal((await pending).status,409);
 assert.deepEqual((await request('/tutor/history',{})).body.lessons,[]);
});
test('changing context and switching to Scroll discard pending output',async t=>{
 for(const change of ['context','scroll']){
  let finish,entered;const started=new Promise(r=>entered=r);
  const {request}=await fixture(t,{tutor:{generate:()=>{entered();return new Promise(r=>finish=r);}}});
  await request('/context',{text:'Initial context'});const pending=request('/tutor/generate',{});await started;
  if(change==='context')await request('/context',{text:'New context'});else await request('/waiting',{mode:'scroll'});
  finish({id:'discarded'});assert.equal((await pending).status,409);
 }
});
test('return deadline is stable across duplicate stop signals and mode changes; continuation cancels it',async t=>{
 let returned=0;const {request}=await fixture(t,{returnDelay:100,onReturn:()=>returned++});
 const first=await request('/event',event('stop_candidate'));const deadline=first.body.waiting.deadline;
 assert.ok(deadline);assert.equal((await request('/event',event('stop_candidate'))).body.waiting.deadline,deadline);
 assert.equal((await request('/waiting',{mode:'scroll'})).status,409);
 await request('/event',event('activity'));assert.equal((await request('/state')).body.waiting.deadline,null);
 await new Promise(r=>setTimeout(r,130));assert.equal(returned,0);
});
test('sharing disabled prevents context and external generation; raw context is absent from snapshots',async t=>{
 const {request}=await fixture(t,{shareContext:false,tutor:mockTutor()});
 assert.equal((await request('/context',{text:'private'})).status,403);
 assert.equal((await request('/tutor/generate',{})).status,403);
 const other=await fixture(t);await other.request('/context',{text:'private unique repository content'});
 assert.ok(!JSON.stringify((await other.request('/state')).body).includes('unique repository'));
});
test('Groq request uses fixed provider/model, suppresses provider errors, and observes cooldown',async()=>{
 let calls=0;const tutor=createTutor('never-print-this',{fetchImpl:async(url,init)=>{
  calls++;assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');const body=JSON.parse(init.body);assert.equal(body.model,'openai/gpt-oss-120b');assert.equal(body.tools,undefined);
  return new Response(JSON.stringify({error:{message:'private key text'}}),{status:429,headers:{'retry-after':'120'}});
 }});
 const input={session:{},context:{text:'code',source:'selected text'},memory:[]};
 await assert.rejects(tutor.generate(input),e=>e.status===429&&!e.message.includes('private'));
 await assert.rejects(tutor.generate(input),e=>e.status===429);assert.equal(calls,1);
});
test('prompt treats source as data, bounds context, redacts keys, and does not assume understanding',()=>{
 const context=sanitizeContext({text:'gsk_'+'abcdefghijklmnopqrstuvwxyz'+'\nAPI_KEY=secret\n'+'x'.repeat(9000)});
 assert.ok(context.text.length<=7000);assert.ok(!context.text.includes('abcdefghijklmnopqrstuvwxyz'));assert.ok(!context.text.includes('=secret'));
 const messages=buildMessages(context,[],'deeper');assert.match(messages[0].content,/without assuming/);assert.equal(messages[1].role,'user');
});
test('Codex hooks fence unrelated turns/subagents and surface approvals, continuation and stops',()=>{
 let n=0;const normalize=createHookNormalizer({makeId:()=>String(++n)});
 const start=normalize('codex','UserPromptSubmit',{session_id:'a',turn_id:'one'});assert.equal(start.kind,'start');
 assert.equal(normalize('codex','Stop',{session_id:'a',turn_id:'other'}),null);
 assert.equal(normalize('codex','Stop',{session_id:'a',turn_id:'one',agent_id:'child'}),null);
 assert.equal(normalize('codex','PermissionRequest',{session_id:'a',turn_id:'one'}).kind,'needs_input');
 assert.equal(normalize('codex','PreToolUse',{session_id:'a',turn_id:'one'}).kind,'start');
 assert.equal(normalize('codex','PostToolUse',{session_id:'a',turn_id:'one'}).kind,'activity');
 assert.equal(normalize('codex','Stop',{session_id:'a',turn_id:'one'}).kind,'stop_candidate');
});
