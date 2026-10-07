import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createSessionStore } from '../core/store.mjs';
import { createDatabase } from './db.mjs';
import { sanitizeContext } from './context.mjs';
import { TutorError } from './tutor.mjs';

const MAX_BODY = 64 * 1024;
const ATTENTION = new Set(['ready','needs_input','cancelled','error','stop_candidate']);
function json(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(value));
}
async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw Object.assign(new Error(),{status:415});
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw Object.assign(new Error(),{status:413}); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new TypeError('Invalid JSON'); }
}
export async function startBridge({port=43187, dataDir=path.resolve('.wait/runtime'), onReturn, onHook, tutor=null, shareContext=false, returnDelay=15000, now=Date.now}={}) {
  await mkdir(dataDir,{recursive:true,mode:0o700});
  const db = createDatabase(dataDir);
  const store = createSessionStore();
  const token = randomBytes(32).toString('hex');
  const connectionFile = path.join(dataDir,'connection.json');
  const clients = new Set();
  const contexts = new Map();
  const hookHistory = [];
  let waiting = null, returnTimer, inFlight = null, closed = false, returning = false;
  let lastError = null;
  const contextKey = s => s ? `${s.key}/${s.runId}` : '';
  const contextFor = s => contexts.get(contextKey(s));
  function getSnapshot() {
    const base = store.getSnapshot(); const context = contextFor(base.session);
    return {...base, waiting: waiting ? {...waiting} : null,
      tutor: { available: Boolean(tutor), sharing: shareContext, contextRevision: context?.revision ?? null, source: context?.source ?? null, generating: Boolean(inFlight), error: lastError }};
  }
  function publish() {
    const snapshot = getSnapshot(); const message = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of clients) {
      if (client.destroyed || client.writableLength > 1024*1024) {client.destroy();clients.delete(client);} else client.write(message);
    }
    return snapshot;
  }
  function invalidate() {
    if (inFlight) {inFlight.abort.abort();inFlight=null;}
  }
  async function returnToAgent(expected) {
    if (returning) throw new TutorError('Return already in progress',409);
    const session = store.getSnapshot().session;
    if (!session) throw new TutorError('No selected session',409);
    if (expected?.sessionKey && expected.runId && (expected.sessionKey !== session.key || expected.runId !== session.runId)) throw new TutorError('This waiting session has changed.',409);
    if (session.state === 'returned') return getSnapshot();
    returning = true; clearTimeout(returnTimer); invalidate();
    if (waiting) waiting = {...waiting, deadline:null, returned:true};
    store.returnToAgent(); publish();
    try {if (onReturn) await onReturn({...session}); return getSnapshot();}
    finally {returning=false;}
  }
  function broadcast() {
    const s = store.getSnapshot().session;
    if (inFlight && (s?.state !== 'working' || contextKey(s)!==inFlight.key || contextFor(s)?.revision!==inFlight.revision)) invalidate();
    if (waiting && s) {
      if (waiting.sessionKey !== s.key || waiting.runId !== s.runId) { clearTimeout(returnTimer); waiting=null; }
      else if (s.state === 'working' && waiting.deadline) {clearTimeout(returnTimer); waiting={...waiting,deadline:null};}
      else if (ATTENTION.has(s.state) && !waiting.deadline && !waiting.returned) {
        waiting={...waiting,deadline:now()+returnDelay}; const expected={...waiting};
        returnTimer=setTimeout(()=>void returnToAgent(expected).catch(()=>{lastError='Return focus failed. Use Back to AI.';publish();}),returnDelay);
        returnTimer.unref();
      }
    }
    return publish();
  }
  function setContext(session, input) {
    if (!shareContext) throw new TutorError('Enable project context sharing in local setup first.',403);
    const context=sanitizeContext(input);
    if (contextFor(session)?.revision!==context.revision) invalidate();
    contexts.set(contextKey(session),context);
    if (contexts.size>30) contexts.delete(contexts.keys().next().value);
    lastError=null; return context;
  }
  function selected(body, requireWorking=false) {
    const s=store.getSnapshot().session;
    if (!s || (body.sessionKey && (body.sessionKey!==s.key || body.runId!==s.runId))) throw new TutorError('The selected task has changed.',409);
    if (requireWorking && s.state!=='working') throw new TutorError('Return to your agent. New lessons are paused.',409);
    return s;
  }
  const authorized=req=>{
    if (req.headers.origin!==undefined || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site']!=='none')) return false;
    const a=Buffer.from(req.headers.authorization??''), b=Buffer.from(`Bearer ${token}`);
    return a.length===b.length && timingSafeEqual(a,b);
  };
  const server=http.createServer({requestTimeout:10000,headersTimeout:10000,maxHeaderSize:8192},async(req,res)=>{
    if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!authorized(req)) return json(res,403,{error:'Forbidden'});
    try {
      if(req.method==='GET' && req.url==='/state') return json(res,200,getSnapshot());
      if(req.method==='GET' && req.url==='/diagnostics') return json(res,200,{hooks:hookHistory});
      if(req.method==='GET' && req.url==='/events') {
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store',Connection:'keep-alive'});
        clients.add(res);res.write(`data: ${JSON.stringify(getSnapshot())}\n\n`);res.on('close',()=>clients.delete(res));return;
      }
      if(req.method!=='POST'||!['/event','/hooks','/select','/return','/waiting','/context','/tutor/generate','/tutor/history','/tutor/feedback','/tutor/memory'].includes(req.url)) return json(res,404,{error:'Not found'});
      const body=await readJson(req);
      if(!body||typeof body!=='object'||Array.isArray(body)) throw new TypeError();
      if(req.url==='/event') {store.dispatch(body);return json(res,200,broadcast());}
      if(req.url==='/hooks') {
        if(!onHook) return json(res,501,{error:'Hook adapter unavailable'});
        if(typeof body.provider!=='string'||typeof body.event!=='string'||!body.payload||typeof body.payload!=='object'||Array.isArray(body.payload)) throw new TypeError();
        const event=await onHook({provider:body.provider,event:body.event,payload:body.payload,observedAt:body.observedAt,eventId:body.eventId});
        const revisionBeforeHook = store.getSnapshot().revision;
        if(event) {
          const before = store.getSnapshot().revision;
          store.dispatch(event);
          const s=store.getSnapshot().sessions.find(s=>s.key===`${event.provider}:${event.sessionId}`);
          if(shareContext && body.context && store.getSnapshot().revision>before && s?.runId===event.runId && s.state==='working') setContext(s,body.context);
        }
        const counters = {};
        for (const name of ['invocationNum','initialNumSteps','executionNum']) if (Number.isSafeInteger(body.payload[name])) counters[name] = body.payload[name];
        if (typeof body.payload.fullyIdle === 'boolean') counters.fullyIdle = body.payload.fullyIdle;
        hookHistory.push({at:new Date().toISOString(), provider:body.provider.slice(0,32), event:body.event.slice(0,32), ...counters,
          result:!event?'ignored_by_adapter':store.getSnapshot().revision===revisionBeforeHook?'ignored_by_store':event.kind});
        if(hookHistory.length>100) hookHistory.shift();
        return json(res,200,broadcast());
      }
      if(req.url==='/select') {invalidate();store.select(body.sessionKey);return json(res,200,broadcast());}
      if(req.url==='/return') return json(res,200,await returnToAgent(body));
      const s=selected(body, ['/waiting','/context','/tutor/generate'].includes(req.url));
      if(req.url==='/waiting') {
        if(!['learn','scroll'].includes(body.mode)) throw new TypeError();
        if(body.mode==='scroll') invalidate();
        waiting={sessionKey:s.key,runId:s.runId,mode:body.mode,deadline:null,returned:false};
        return json(res,200,broadcast());
      }
      if(req.url==='/context') {setContext(s,body);return json(res,200,broadcast());}
      if(req.url==='/tutor/history') return json(res,200,{lessons:db.history(s.key)});
      if(req.url==='/tutor/feedback'||req.url==='/tutor/memory') {
        if(body.action==='reset' && req.url==='/tutor/memory') {invalidate();db.reset(s.key);return json(res,200,{ok:true});}
        const lesson=db.getLesson(body.lessonId);
        if(!lesson||lesson.sessionKey!==s.key) throw new TypeError();
        if(req.url==='/tutor/memory') {
          invalidate();
          if(body.action==='forget') db.forget(lesson.id);
          else if(body.action==='edit' && typeof body.summary==='string' && body.summary.trim() && body.summary.length<=4000) db.edit(lesson.id,sanitizeContext({text:body.summary}).text);
          else throw new TypeError();
        } else {
          if(!['displayed','understood','position'].includes(body.action)) throw new TypeError();
          db.feedback(lesson.id,body.action,body.position);
        }
        return json(res,200,{ok:true});
      }
      if(req.url==='/tutor/generate') {
        if(!tutor) throw new TutorError('Configure your Groq API key in local setup.');
        if(!shareContext) throw new TutorError('Project context sharing is disabled.',403);
        if(waiting?.mode!=='learn') throw new TutorError('Open Learn to request a lesson.',409);
        const context=contextFor(s);
        if(!context) throw new TutorError('Select relevant code or paste task context to begin.',422);
        if(inFlight) throw new TutorError('A lesson is already being generated.',409);
        if(body.feedback && !['simpler','deeper','question'].includes(body.feedback)) throw new TypeError();
        if(body.feedback==='question' && (typeof body.question!=='string'||!body.question.trim()||body.question.length>1000)) throw new TypeError();
        const previous=body.lessonId ? db.getLesson(body.lessonId) : null;
        if(body.feedback && (!previous||previous.sessionKey!==s.key||previous.runId!==s.runId)) throw new TutorError('Choose a lesson from this task first.',409);
        const cached=!body.feedback && db.history(s.key).find(l=>l.runId===s.runId && l.contextRevision===context.revision);
        if(cached) return json(res,200,cached);
        const job={key:contextKey(s),revision:context.revision,abort:new AbortController()};inFlight=job;lastError=null;publish();
        try {
          const lesson=await tutor.generate({session:s,context,memory:db.memory(s.key),feedback:body.feedback,previous,question:body.question,signal:job.abort.signal});
          if(job.abort.signal.aborted||inFlight!==job) throw new TutorError('The task changed; this lesson was discarded.',409);
          if(body.feedback) db.feedback(previous.id,body.feedback);
          return json(res,200,db.saveLesson(lesson));
        } catch(error) {
          if(job.abort.signal.aborted) throw new TutorError('The task changed; this lesson was discarded.',409);
          lastError=error.publicMessage ?? 'Tutor unavailable. Try again.';throw error;
        } finally {if(inFlight===job)inFlight=null;publish();}
      }
    } catch(error) {
      const status=error.status ?? (error instanceof TypeError||error instanceof RangeError ? 400:500);
      json(res,status,{error:error.publicMessage ?? ({413:'Body too large',415:'JSON required',400:'Invalid request'}[status]??'Operation failed'),...(error.retryAt?{retryAt:error.retryAt}:{})});
    }
  });
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
    await writeFile(connectionFile,JSON.stringify({port:server.address().port,token,shareContext}),{mode:0o600});
  } catch(error) {server.close();db.close();throw error;}
  const heartbeat=setInterval(()=>{for(const client of clients)client.write(': heartbeat\n\n');},10000);heartbeat.unref();
  async function close() {
    if(closed)return;closed=true;clearTimeout(returnTimer);clearInterval(heartbeat);invalidate();
    for(const c of clients)c.end();clients.clear();
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    try{const saved=JSON.parse(await readFile(connectionFile,'utf8'));if(saved.token===token)await unlink(connectionFile);}catch{}
    db.close();
  }
  return {server,store,db,connection:{port:server.address().port,token,shareContext},connectionFile,getSnapshot,setContext,broadcast,close};
}
