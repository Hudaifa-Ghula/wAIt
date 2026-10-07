let port, snapshot=null, connected=false, managed=null, timer, opening=false;
const pending=new Map();
let stateQueue=Promise.resolve();
const ready=chrome.storage.local.get('managed').then(saved=>{managed=saved.managed??null;});
const runKey=s=>s?.key&&s?.runId?`${s.key}/${s.runId}`:null;
const refs=()=>({sessionKey:snapshot?.session?.key,runId:snapshot?.session?.runId});
const ownPage=sender=>sender.id===chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
async function save(){await chrome.storage.local.set({managed});}
function rpc(action,body={}){
  if(!connected||!port)return Promise.reject(new Error('Local companion disconnected.'));
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('Request timed out.'));},55000);
    pending.set(id,{resolve,reject,timeout});port.postMessage({type:'rpc',id,action,body});
  });
}
async function broadcast(){
  const message={type:'snapshot',snapshot,connected,managed};
  chrome.runtime.sendMessage(message).catch(()=>{});
  if(managed?.tabId)chrome.tabs.sendMessage(managed.tabId,{...message,snapshot:snapshot?{revision:snapshot.revision,session:snapshot.session,canScroll:snapshot.canScroll,waiting:snapshot.waiting}:null}).catch(()=>{});
}
async function pauseAndMinimize(){
  if(!managed)return;
  await chrome.tabs.sendMessage(managed.tabId,{type:'pauseNow'}).catch(()=>{});
  await chrome.windows.update(managed.windowId,{state:'minimized'}).catch(()=>{});
}
async function back(expected=refs()){
  await pauseAndMinimize();
  return rpc('return',expected);
}
async function automaticBack(expected,deadline){
  if(!deadline || Date.now()<deadline || snapshot?.waiting?.deadline!==deadline
    || expected.sessionKey!==snapshot?.session?.key || expected.runId!==snapshot?.session?.runId)return;
  return back(expected);
}
async function scheduleReturn(){
  clearTimeout(timer);await chrome.alarms.clear('wait-return');
  const deadline=snapshot?.waiting?.deadline;
  if(!managed || managed.runKey!==runKey(snapshot?.session))return;
  if(snapshot?.waiting?.returned || snapshot?.session?.state==='returned'){managed.deadline=null;await save();await pauseAndMinimize();return;}
  if(!deadline){if(managed.deadline){managed.deadline=null;await save();}return;}
  if(managed.deadline!==deadline){
    managed.deadline=deadline;await save();
    chrome.notifications.create('wait-ready',{type:'basic',iconUrl:'icon.png',title:'Your agent needs you',message:'Returning to your agent in 15 seconds.'}).catch(()=>{});
  }
  const remaining=Math.max(0,deadline-Date.now());
  const expected=refs();
  timer=setTimeout(()=>void automaticBack(expected,deadline).catch(()=>{}),remaining);
  await chrome.alarms.create('wait-return',{when:Math.max(Date.now()+1,deadline)});
}
async function openMode(mode='learn'){
  if(!connected||snapshot?.session?.state!=='working')throw new Error('Start an agent task before opening a waiting session.');
  if(opening)return;opening=true;
  try{
    const currentKey=runKey(snapshot.session), expected=refs();
    // onState already delivered the new run. Pausing the same scrolling tab
    // here would mark that NEW run returned before its finish-reel grace period.
    const keepReel=managed?.mode==='scroll' && mode==='scroll';
    if(managed?.tabId && !keepReel)await chrome.tabs.sendMessage(managed.tabId,{type:'pauseNow'}).catch(()=>{});
    const url=mode==='scroll'?'https://www.instagram.com/reels/':chrome.runtime.getURL('learn.html');
    let existing;
    if(managed)existing=await chrome.windows.get(managed.windowId).catch(()=>null);
    if(existing){
      const tab=await chrome.tabs.get(managed.tabId).catch(()=>null);
      if(tab)await chrome.tabs.update(tab.id,keepReel?{active:true}:{url,active:true});
      else {const created=await chrome.tabs.create({windowId:existing.id,url});managed.tabId=created.id;}
      await chrome.windows.update(existing.id,{state:'normal',focused:true});
      managed={...managed,mode,runKey:currentKey,deadline:null};
    }else{
      const win=await chrome.windows.create({url,type:'popup',width:920,height:840,focused:true});
      managed={windowId:win.id,tabId:win.tabs[0].id,mode,runKey:currentKey};
    }
    await save();
    await rpc('waiting',{...expected,mode});await broadcast();
  }finally{opening=false;}
}
async function onState(next){
  await ready;
  const previous=runKey(snapshot?.session);
  snapshot=next;connected=true;
  await broadcast();await scheduleReturn();
  const current=runKey(next.session);
  if(next.session?.state==='working' && current && current!==previous && managed?.runKey!==current){
    await openMode(managed?.mode==='scroll'?'scroll':'learn').catch(()=>{});
  }
}
function disconnect(){
  connected=false;
  for(const p of pending.values()){clearTimeout(p.timeout);p.reject(new Error('Local companion disconnected.'));}pending.clear();
  // Retain any known return deadline; loss of connectivity must not extend scrolling.
  chrome.runtime.sendMessage({type:'disconnected'}).catch(()=>{});
  if(managed?.tabId)chrome.tabs.sendMessage(managed.tabId,{type:'disconnected'}).catch(()=>{});
}
function connect(){
  if(port){try{port.disconnect();}catch{}}
  const current=chrome.runtime.connectNative('com.wait.companion');port=current;
  current.onMessage.addListener(message=>{
    if(current!==port)return;
    if(message.type==='state')stateQueue=stateQueue.then(()=>onState(message.snapshot)).catch(()=>{});
    if(message.type==='disconnected')disconnect();
    if(message.type==='rpcResult'){
      const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timeout);
      if(message.error)p.reject(new Error(message.error));else p.resolve(message.data);
    }
  });
  current.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(current===port){port=null;disconnect();chrome.alarms.create('wait-reconnect',{delayInMinutes:0.5});}});
  current.postMessage({type:'getState'});
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  const fromManaged=sender.tab?.id===managed?.tabId;
  if(!ownPage(sender) && !fromManaged)return;
  if(message.type==='getSnapshot'){respond({snapshot,connected,managed});return;}
  if(message.type==='contentReady'){
    if(fromManaged)respond({enrolled:true,snapshot:snapshot?{revision:snapshot.revision,session:snapshot.session,canScroll:snapshot.canScroll,waiting:snapshot.waiting}:null,connected});
    return;
  }
  if(message.type==='return'){back().then(data=>respond({data})).catch(error=>respond({error:error.message}));return true;}
  if(!ownPage(sender))return;
  const actions={reconnect:async()=>{connect();return {};}, openLearn:()=>openMode('learn'),openScroll:()=>openMode('scroll'),
    select:async()=>{port?.postMessage({type:'select',sessionKey:message.sessionKey});},
    rpc:()=>rpc(message.action,{...message.body,...refs()})};
  if(!actions[message.type])return;
  actions[message.type]().then(data=>respond({data})).catch(error=>respond({error:error.message}));return true;
});
chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name==='wait-return')void ready.then(()=>automaticBack(refs(),managed?.deadline)).catch(()=>{});
  if(alarm.name==='wait-reconnect'&&!port)connect();
});
chrome.windows.onRemoved.addListener(id=>{if(managed?.windowId===id){managed=null;void save();}});
void ready.then(()=>{connect();});
