const $=id=>document.getElementById(id);
let snapshot=null,connected=false,lesson=null,busy=false,lastAttempt='',restore=true;
const key=()=>snapshot?.session?`${snapshot.session.key}/${snapshot.session.runId}`:'';
const active=()=>connected&&snapshot?.session?.state==='working'&&snapshot?.waiting?.mode==='learn';
async function send(type,extra={}){const result=await chrome.runtime.sendMessage({type,...extra});if(result?.error)throw new Error(result.error);return result?.data;}
const rpc=(action,body={})=>send('rpc',{action,body});
function error(e){$('error-message').textContent=e.message??String(e);}
function render(){
  $('status-badge').textContent=!connected?'Disconnected':snapshot?.session?.state==='working'?'Agent working':snapshot?.session?.state?.replaceAll('_',' ')??'Waiting for a task';
  $('status-badge').className=active()?'badge working':'badge';
  $('task-label').textContent=snapshot?.session?.label??'Start a task in Codex or Antigravity.';
  $('source').textContent=snapshot?.tutor?.source?`Context: ${snapshot.tutor.source} · Groq`:'Paste relevant task context below to begin.';
  for(const id of ['btn-generate','btn-simpler','btn-deeper','btn-understood','btn-ask','btn-context'])$(id).disabled=!active()||busy||(['btn-simpler','btn-deeper','btn-understood','btn-ask'].includes(id)&&(!lesson||lesson.runId!==snapshot?.session?.runId));
  $('btn-scroll').disabled=!active();
  $('btn-return').disabled=!snapshot?.session;
  $('btn-generate').textContent=busy?'Preparing your lesson…':'Explain this task';
  $('explanation-text').textContent=lesson?.summary??'Your next waiting moment can teach you something.';
  $('model').textContent=lesson?`${lesson.model} · ${lesson.understoodAt?'Understood':'Saved lesson'}`:'';
  tick();
}
function tick(){const d=snapshot?.waiting?.deadline;$('countdown').textContent=d?`Back to your agent in ${Math.max(0,Math.ceil((d-Date.now())/1000))} seconds`:snapshot?.session?.state==='returned'?'Returned to your agent.':'';}
async function showLesson(value){
  lesson=value;render();
  if(lesson && lesson.runId===snapshot?.session?.runId && active())await rpc('feedback',{lessonId:lesson.id,action:'displayed'}).catch(error);
  if(restore&&lesson){window.scrollTo(0,lesson.position??0);restore=false;}
}
async function history(){
  const data=await rpc('history');const list=$('history');list.replaceChildren();
  for(const item of data.lessons){
    const row=document.createElement('div');row.className='history-row';
    const button=document.createElement('button');button.textContent=`${new Date(item.createdAt).toLocaleString()} · ${item.topic}`;
    button.onclick=()=>showLesson(item);row.append(button);
    const edit=document.createElement('button');edit.textContent='Edit';edit.onclick=async()=>{const summary=prompt('Edit saved explanation',item.summary);if(summary?.trim())try{await rpc('memory',{action:'edit',lessonId:item.id,summary});if(lesson?.id===item.id)showLesson({...item,summary});await history();}catch(e){error(e);}};row.append(edit);
    const forget=document.createElement('button');forget.textContent='Forget';forget.onclick=async()=>{await rpc('memory',{action:'forget',lessonId:item.id});if(lesson?.id===item.id){lesson=null;render();}await history();};row.append(forget);list.append(row);
  }
  if(!lesson && data.lessons[0])await showLesson(data.lessons[0]);
}
async function generate(feedback){
  if(!active()||busy)return;
  busy=true;lastAttempt=`${key()}/${snapshot.tutor.contextRevision}`;$('error-message').textContent='';render();
  const expected=key();
  try{
    const data=await rpc('generate',{feedback,lessonId:lesson?.id,question:feedback==='question'?$('question').value:undefined});
    if(key()===expected&&active())await showLesson(data);
    await history();
  }catch(e){error(e);}finally{busy=false;render();}
}
async function update(next,isConnected=true){
  const old=key();snapshot=next;connected=isConnected;
  if(old!==key()){lesson=null;restore=true;lastAttempt='';if(snapshot?.session)await history().catch(error);}
  render();
  if(active()&&snapshot.tutor?.available&&snapshot.tutor.contextRevision&&!snapshot.tutor.error&&lastAttempt!==`${key()}/${snapshot.tutor.contextRevision}`)void generate();
}
chrome.runtime.onMessage.addListener(message=>{if(message.type==='snapshot')void update(message.snapshot,message.connected);if(message.type==='disconnected'){connected=false;render();}});
$('btn-generate').onclick=()=>generate();$('btn-simpler').onclick=()=>generate('simpler');$('btn-deeper').onclick=()=>generate('deeper');$('btn-ask').onclick=()=>generate('question');
$('btn-understood').onclick=async()=>{try{await rpc('feedback',{lessonId:lesson.id,action:'understood'});lesson.understoodAt=Date.now();render();}catch(e){error(e);}};
$('btn-context').onclick=async()=>{try{await rpc('context',{source:'selected text',text:$('context').value});$('context').value='';}catch(e){error(e);}};
$('btn-return').onclick=()=>send('return').catch(error);$('btn-scroll').onclick=()=>send('openScroll').catch(error);
$('btn-reset').onclick=async()=>{if(confirm('Forget the learning history for this task?')){await rpc('memory',{action:'reset'});lesson=null;render();await history();}};
let positionTimer;window.addEventListener('scroll',()=>{clearTimeout(positionTimer);positionTimer=setTimeout(()=>{if(lesson)rpc('feedback',{lessonId:lesson.id,action:'position',position:scrollY}).catch(()=>{});},300);});
setInterval(tick,250);
chrome.runtime.sendMessage({type:'getSnapshot'}).then(result=>update(result.snapshot,result.connected)).catch(error);
