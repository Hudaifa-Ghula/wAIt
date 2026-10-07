import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd();
async function browser(t){const b=await chromium.launch({headless:true});t.after(()=>b.close());return b;}
test('learning page generates automatically, escapes tutor text, disables actions on stop, and preserves reading',async t=>{
 const b=await browser(t);const page=await b.newPage({viewport:{width:1100,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const listeners=[];window.fakeCalls=[];
  window.fakeSnapshot={revision:1,session:{key:'codex:preview',runId:'one',provider:'codex',state:'working',label:'Codex · Explain the learning flow'},canScroll:true,waiting:{mode:'learn'},tutor:{available:true,sharing:true,source:'selected text',contextRevision:'a'}};
  window.fakeLesson={id:'lesson',runId:'one',summary:'The bridge keeps track of one coding task and shares its status with the browser. When the agent starts working, the learning page can request a short explanation of the selected code.\n\nThis is an event-driven design: each change in task state triggers the next useful action. The tutor request runs separately, so waiting for an explanation cannot block the return button.\n\nThat separation matters when your agent finishes quickly. The bridge cancels any unfinished lesson, starts the return countdown, and helps you get back to the task. <img src=x onerror=alert(1)>',model:'openai/gpt-oss-120b',topic:'Event-driven state',createdAt:Date.now()};
  window.chrome={runtime:{onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async m=>{
   window.fakeCalls.push(m);
   if(m.type==='getSnapshot')return {connected:true,snapshot:window.fakeSnapshot};
   if(m.type==='rpc'&&m.action==='history')return {data:{lessons:[]}};
   if(m.type==='rpc'&&m.action==='generate')return {data:window.fakeLesson};
   return {data:{ok:true}};
  }}};
  window.fakeStop=()=>{window.fakeSnapshot={...window.fakeSnapshot,revision:2,session:{...window.fakeSnapshot.session,state:'ready'},waiting:{mode:'learn',deadline:Date.now()+15000}};for(const listener of listeners)listener({type:'snapshot',snapshot:window.fakeSnapshot,connected:true});};
 });
 await page.goto(pathToFileURL(path.join(root,'extensions/browser/learn.html')).href);
 await page.waitForFunction(()=>document.querySelector('#explanation-text').textContent.includes('event-driven'));
 assert.equal(await page.locator('#explanation-text img').count(),0);
 assert.equal(await page.evaluate(()=>window.fakeCalls.filter(c=>c.action==='generate').length),1);
 await page.evaluate(()=>{document.querySelector('#explanation-text').textContent=window.fakeLesson.summary.replace(' <img src=x onerror=alert(1)>','');});
 await mkdir(path.join(root,'.wait-setup'),{recursive:true});await page.screenshot({path:path.join(root,'.wait-setup/learn-preview.png'),fullPage:true});
 await page.evaluate(()=>window.fakeStop());
 await page.waitForFunction(()=>document.querySelector('#btn-simpler').disabled);
 assert.match(await page.locator('#countdown').textContent(),/Back to your agent in/);
 assert.match(await page.locator('#explanation-text').textContent(),/event-driven/);assert.deepEqual(errors,[]);
});
test('Reels guard blocks navigation after stop and pauses at deadline; unrelated pages stay untouched',async t=>{
 const b=await browser(t);const page=await b.newPage({viewport:{width:800,height:800}});
 await page.route('https://fixture.test/**',r=>r.fulfill({contentType:'text/html',body:'<html><body><video src="data:video/mp4;base64,AAAA" style="width:300px;height:500px"></video><a href="/reel/abc/">Current reel</a></body></html>'}));
 await page.goto('https://fixture.test/reel/abc/');
 const source=await readFile('extensions/browser/content-controller.mjs','utf8');
 await page.addScriptTag({content:source.replace('export function createController','window.createController = function createController')});
 await page.evaluate(()=>{
  const v=document.querySelector('video');Object.defineProperty(v,'duration',{value:60});Object.defineProperty(v,'ended',{value:false});v.pause=()=>window.pauseCount=(window.pauseCount??0)+1;
  window.guard=window.createController({window,document});
 });
 assert.equal(await page.locator('[data-wait-phase]').count(),0);
 await page.evaluate(()=>{window.guard.enroll();window.guard.applySnapshot({revision:1,session:{key:'codex:x',runId:'1',state:'working'},canScroll:true});});
 assert.equal(await page.evaluate(()=>window.guard.inspect().phase),'working');
 await page.evaluate(()=>window.guard.applySnapshot({revision:2,session:{key:'codex:x',runId:'1',state:'ready'},canScroll:false,waiting:{deadline:Date.now()+250}}));
 const blocked=await page.evaluate(()=>{const e=new WheelEvent('wheel',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});assert.equal(blocked,true);
 await page.waitForFunction(()=>window.guard.inspect().phase==='returned');
 assert.ok(await page.evaluate(()=>window.pauseCount>0&&document.querySelector('video').muted));
 await page.evaluate(()=>window.guard.dispose());
});

test('finish-reel modal and grace period reset across three runs in the same page',async t=>{
 const b=await browser(t);const page=await b.newPage({viewport:{width:800,height:800}});
 await page.route('https://fixture.test/**',r=>r.fulfill({contentType:'text/html',body:'<html><body><video loop src="data:video/mp4;base64,AAAA" style="width:300px;height:500px"></video><a href="/reel/abc/">Current reel</a></body></html>'}));
 await page.goto('https://fixture.test/reel/abc/');
 await page.evaluate(()=>{
  const attach=Element.prototype.attachShadow;
  Element.prototype.attachShadow=function(options){const shadow=attach.call(this,options);if(this.id==='wait-companion-root')window.guardUi=shadow;return shadow;};
 });
 const source=await readFile('extensions/browser/content-controller.mjs','utf8');
 await page.addScriptTag({content:source.replace('export function createController','window.createController = function createController')});
 await page.evaluate(()=>{
  const v=document.querySelector('video');Object.defineProperty(v,'duration',{value:60});Object.defineProperty(v,'ended',{value:false});
  v.pause=()=>window.pauseCount=(window.pauseCount??0)+1;
  window.guard=window.createController({window,document});window.guard.enroll();
 });
 for(let run=1;run<=3;run++){
  await page.evaluate(run=>{
   window.guard.applySnapshot({revision:run*3,session:{key:'antigravity:x',runId:String(run),state:'working'},canScroll:true,waiting:null});
   window.pauseCount=0;
   window.guard.applySnapshot({revision:run*3+1,session:{key:'antigravity:x',runId:String(run),state:'ready'},canScroll:false,waiting:{deadline:Date.now()+15000}});
  },run);
  assert.equal(await page.evaluate(()=>window.guard.inspect().phase),'finishing');
  assert.equal(await page.evaluate(()=>window.guardUi.querySelector('.ready').hidden),false);
  assert.equal(await page.evaluate(()=>window.guardUi.querySelector('[data-action=finish]').hidden),false);
  assert.equal(await page.evaluate(()=>window.pauseCount),0,'current reel must keep playing during the grace period');
  await page.evaluate(()=>window.guardUi.querySelector('[data-action=finish]').click());
  assert.equal(await page.evaluate(()=>window.guardUi.querySelector('[data-action=finish]').hidden),true);
  await page.evaluate(run=>window.guard.applySnapshot({revision:run*3+2,session:{key:'antigravity:x',runId:String(run),state:'returned'},canScroll:false,waiting:{returned:true,deadline:null}}),run);
  assert.equal(await page.evaluate(()=>window.guard.inspect().phase),'returned');
 }
 await page.evaluate(()=>window.guard.dispose());
});
