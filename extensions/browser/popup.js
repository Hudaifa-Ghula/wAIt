const $=id=>document.getElementById(id);
async function send(type,extra={}){const r=await chrome.runtime.sendMessage({type,...extra});if(r?.error)$('connection-status').textContent=r.error;}
function update({connected,snapshot}){
  $('connection-status').textContent=connected?'Connected':'Disconnected';
  $('connection-status').className=`status-indicator ${connected?'connected':'disconnected'}`;
  $('no-connection').hidden=connected;$('session-info').hidden=!snapshot?.session;
  $('no-task').hidden=!connected||Boolean(snapshot?.session);
  $('agent-name').textContent=snapshot?.session?.label??'No task detected';
  $('agent-state').textContent=snapshot?.session?.state?.replaceAll('_',' ')??'';
  $('btn-return').disabled=!snapshot?.session;$('btn-learn').disabled=!connected||snapshot?.session?.state!=='working';$('btn-scroll').disabled=$('btn-learn').disabled;
  const list=$('session-list');list.replaceChildren();$('session-list-container').hidden=!snapshot?.sessions?.length;
  for(const session of snapshot?.sessions??[]){const li=document.createElement('li');const b=document.createElement('button');b.textContent=`${session.label} · ${session.state}`;b.onclick=()=>send('select',{sessionKey:session.key});li.append(b);list.append(li);}
}
$('btn-learn').onclick=()=>send('openLearn');$('btn-scroll').onclick=()=>send('openScroll');$('btn-return').onclick=()=>send('return');$('btn-reconnect').onclick=()=>send('reconnect');
chrome.runtime.onMessage.addListener(m=>{if(m.type==='snapshot')update(m);if(m.type==='disconnected')update({connected:false});});
chrome.runtime.sendMessage({type:'getSnapshot'}).then(update);
