/** DOM-only controller. Browser permissions and transport stay in content-entry/worker. */
export function createController({ window: win, document: doc, send = () => {} }) {
  let enrolled = false;
  let phase = 'covered';
  let reason = 'Connecting to your agent…';
  let selectedSessionKey = null;
  let currentRunKey = null;
  let blockedRunKey = null;
  let provisional = false;
  let latch = null;
  let revision = -1;
  let snapshot = null;
  let compact = false;
  let host = null;
  let shadow = null;
  let observer = null;
  let timer = null;
  let disposed = false;
  let lastScroll = { x: 0, y: 0 };
  const listeners = [];
  const savedStyles = new Map();
  const navigationKeys = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Spacebar', 'ArrowLeft', 'ArrowRight']);
  const finalStates = new Set(['ready', 'needs_input', 'cancelled', 'error', 'returned']);

  const runKey = session => session?.key && session?.runId ? `${session.key}:${session.runId}` : null;
  const locked = () => enrolled && phase !== 'working';
  const videos = () => Array.from(doc.querySelectorAll('video'));
  const emit = value => { try { Promise.resolve(send(value)).catch(() => {}); } catch {} };

  function listen(target, event, callback, options = true) {
    target.addEventListener(event, callback, options);
    listeners.push(() => target.removeEventListener(event, callback, options));
  }

  function visibleScore(video) {
    const r = video.getBoundingClientRect();
    const width = Math.max(0, Math.min(r.right, win.innerWidth) - Math.max(r.left, 0));
    const height = Math.max(0, Math.min(r.bottom, win.innerHeight) - Math.max(r.top, 0));
    if (width < 40 || height < 40 || r.width <= 0 || r.height <= 0) return 0;
    const style = win.getComputedStyle(video);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return 0;
    return width * height / (r.width * r.height);
  }

  function clipId(href) {
    try {
      const url = new URL(href, doc.baseURI);
      const match = url.pathname.match(/^\/reels?\/([A-Za-z0-9_-]+)(?:\/|$)/);
      return match?.[1] ?? null;
    } catch { return null; }
  }

  function identify(video) {
    const locationId = clipId(win.location.href);
    let element = video;
    for (let depth = 0; element && depth < 9; depth++, element = element.parentElement) {
      const enclosed = element.matches('a[href]') ? [element, ...element.querySelectorAll('a[href]')] : Array.from(element.querySelectorAll('a[href]'));
      const ids = new Set(enclosed.map(a => clipId(a.href)).filter(Boolean));
      // Never climb into a container with multiple videos: its links may belong to a neighbor.
      if (element.querySelectorAll('video').length > 1) break;
      if (ids.size === 1) {
        const id = [...ids][0];
        if (locationId && locationId !== id) return null;
        return { id, container: element };
      }
      if (ids.size > 1) return null;
    }
    // A canonical individual-post URL is acceptable only with exactly one visible video.
    if (locationId && videos().filter(v => visibleScore(v) >= 0.6).length === 1) {
      return { id: locationId, container: video.parentElement };
    }
    // Reels' scrolling route may omit post links. Latch the exact video source only
    // when there is one visible player; replacement/source changes stay locked.
    if (videos().filter(v => visibleScore(v) >= 0.6).length === 1 && (video.currentSrc || video.getAttribute('src'))) {
      return { id: video.currentSrc || video.getAttribute('src'), container: video.parentElement };
    }
    return null;
  }

  function candidate() {
    const candidates = videos().map(video => ({ video, score: visibleScore(video) }))
      .filter(item => item.score >= 0.6).sort((a, b) => b.score - a.score);
    if (candidates.length !== 1) return null;
    const video = candidates[0].video;
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.ended) return null;
    const identity = identify(video);
    const source = video.currentSrc || video.getAttribute('src');
    if (!identity || !source || video.srcObject) return null;
    return {
      ...identity, video, source, duration: video.duration,
      lastTime: video.currentTime, originalLoop: video.loop,
      documentUrl: win.location.href,
    };
  }

  function pause(video, mute = false) {
    try { video.pause(); if (mute) video.muted = true; } catch {}
  }

  function preserveStyle(element, property, value) {
    if (!element) return;
    if (!savedStyles.has(element)) savedStyles.set(element, new Map());
    const properties = savedStyles.get(element);
    if (!properties.has(property)) properties.set(property, [element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
    if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value, 'important');
  }

  function freeze() {
    preserveStyle(doc.documentElement, 'overflow', 'hidden');
    preserveStyle(doc.body, 'overflow', 'hidden');
    if (latch) {
      for (let element = latch.video.parentElement; element && element !== doc.documentElement; element = element.parentElement) {
        const computed = win.getComputedStyle(element);
        if (/(auto|scroll)/.test(computed.overflowY) || element.scrollHeight > element.clientHeight + 10) {
          preserveStyle(element, 'overflow', 'hidden');
          preserveStyle(element, 'scroll-snap-type', 'none');
          preserveStyle(element, 'touch-action', 'none');
        }
      }
    }
  }

  function restoreStyles() {
    for (const [element, properties] of savedStyles) {
      for (const [property, [value, priority]] of properties) {
        if (value) element.style.setProperty(property, value, priority); else element.style.removeProperty(property);
      }
    }
    savedStyles.clear();
    if (latch?.video.isConnected) latch.video.loop = latch.originalLoop;
  }

  function status() {
    emit({ type: 'controllerStatus', status: { phase, reason, runKey: currentRunKey, blockedRunKey, clipId: latch?.id ?? null } });
  }

  function ensureUi() {
    if (!enrolled || disposed || !doc.documentElement) return;
    if (!host) {
      host = doc.createElement('div');
      host.id = 'wait-companion-root';
      host.setAttribute('data-wait-managed', 'true');
      shadow = host.attachShadow({ mode: 'closed' });
      shadow.innerHTML = `<style>
        :host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;color:#f5f4ef!important;font-family:Inter,ui-sans-serif,system-ui,sans-serif!important;font-size:14px!important;color-scheme:dark!important}
        *{box-sizing:border-box} .shield{position:absolute;inset:0;background:rgba(15,17,19,.985);pointer-events:auto;display:grid;place-items:center;padding:24px}.shield[hidden],.card[hidden],.strip[hidden]{display:none}
        .strip{position:absolute;top:14px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 28px);width:460px;display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid #393b3d;border-radius:13px;background:#191b1df5;box-shadow:0 6px 30px #0004;pointer-events:auto}
        .brand{color:#efbc80;font-weight:750;letter-spacing:-.8px;font-size:19px}.dot{width:6px;height:6px;border-radius:50%;background:#efbc80;flex:none}.status{flex:1;min-width:0;font-size:12px;line-height:1.5}.status strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:550}.status span{color:#aaa}
        button{appearance:none;cursor:pointer;border:1px solid #494946;border-radius:8px;background:#282b2c;color:#f5f4ef;font:600 12px/1.3 Inter,ui-sans-serif,system-ui,sans-serif;padding:9px 12px}button:hover{background:#343738}button:focus-visible,input:focus-visible{outline:2px solid #efbc80;outline-offset:3px}button.primary{background:#edbd85;border-color:#edbd85;color:#23201b}button.primary:hover{background:#f6cfa2}
        .card{position:absolute;right:24px;bottom:28px;width:340px;max-width:calc(100vw - 48px);border:1px solid #484642;background:#202224fa;border-radius:18px;padding:22px;pointer-events:auto;box-shadow:0 20px 60px #0007}.shield .card{position:static;width:380px;max-width:100%;box-shadow:none;background:#202224}.eyebrow{color:#efbc80;text-transform:uppercase;font-size:10px;font-weight:650;letter-spacing:1.8px;margin:0 0 13px}h1{font-size:22px;line-height:1.25;letter-spacing:-.7px;margin:0 0 10px;font-weight:600}p{font-size:13px;color:#b7b8b4;line-height:1.65;margin:0 0 18px}.actions{display:flex;gap:8px;flex-wrap:wrap}.controls{display:flex;gap:8px;align-items:center;margin:16px 0 0}.controls input{width:92px;accent-color:#efbc80}.foot{margin-top:13px;font-size:11px;color:#92948f}.guard{position:absolute;inset:0;pointer-events:auto;background:transparent}.guard[hidden]{display:none}
        @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
      </style>
      <div class="guard" hidden></div>
      <div class="shield" hidden><section class="card" role="region" aria-label="wAIt session"><div class="eyebrow">wAIt / Back to focus</div><h1></h1><p></p><div class="actions"><button class="primary" data-action="return">Back to AI ↗</button></div><div class="foot">Scrolling opens for your next agent turn.</div></section></div>
      <div class="strip" hidden><span class="brand">wAIt</span><span class="dot"></span><div class="status" aria-live="polite"><strong></strong><span></span></div><button data-action="return">Back to AI ↗</button></div>
      <section class="card ready" role="region" aria-label="Your agent is ready" hidden><div class="eyebrow">A good place to stop</div><h1>Your agent is ready.</h1><p>Finish this reel, then pick up where you left off. The next video is locked.</p><div class="actions"><button class="primary" data-action="return">Back to AI ↗</button><button data-action="finish">Finish this reel</button></div><div class="controls"><button data-action="pause">Pause</button><label>Volume <input aria-label="Volume" type="range" min="0" max="1" step="0.05"></label><button data-action="captions">CC</button></div></section>`;
      shadow.addEventListener('click', event => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'return') returnToAi();
        if (action === 'finish' && phase === 'finishing') { compact = true; render(); }
        if (action === 'pause' && phase === 'finishing' && latch) {
          if (latch.video.paused) latch.video.play().catch(() => fail('The current video could not continue. Return to your agent.'));
          else pause(latch.video);
          render();
        }
        if (action === 'captions' && latch) {
          const tracks = Array.from(latch.video.textTracks ?? []);
          const on = tracks.some(track => track.mode === 'showing');
          tracks.forEach(track => { track.mode = on ? 'hidden' : 'showing'; });
        }
      });
      shadow.addEventListener('input', event => {
        if (event.target.matches('input[type=range]') && latch) { latch.video.volume = Number(event.target.value); latch.video.muted = false; }
      });
    }
    if (!host.isConnected) doc.documentElement.append(host);
  }

  function render() {
    ensureUi();
    if (!shadow) return;
    const covered = !['working', 'finishing'].includes(phase);
    shadow.querySelector('.shield').hidden = !covered;
    shadow.querySelector('.guard').hidden = phase !== 'finishing';
    shadow.querySelector('.strip').hidden = covered;
    shadow.querySelector('.ready').hidden = phase !== 'finishing' || compact;
    const title = phase === 'returned' ? 'Back to your agent.' : phase === 'finished' ? 'Your reel is finished.' : 'Your feed is on hold.';
    shadow.querySelector('.shield h1').textContent = title;
    shadow.querySelector('.shield p').textContent = reason;
    shadow.querySelector('.status strong').textContent = phase === 'working' ? `${snapshot?.session?.provider || 'Agent'} is working` : 'Your agent is ready · next video locked';
    const deadline = snapshot?.waiting?.deadline;
    const countdown = deadline ? `Returning to your agent in ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))} seconds.` : 'Return to your agent when ready.';
    shadow.querySelector('.status span').textContent = phase === 'working' ? (snapshot?.session?.label || 'Enjoy a reel while you wait.') : countdown;
    shadow.querySelector('.ready p').textContent = countdown + ' The next reel is locked.';
    if (deadline) shadow.querySelector('.shield p').textContent = countdown;
    if (latch) {
      shadow.querySelector('[data-action=pause]').textContent = latch.video.paused ? 'Play' : 'Pause';
      shadow.querySelector('input[type=range]').value = String(latch.video.muted ? 0 : latch.video.volume);
    }
    // Compact mode still exposes playback controls without restoring page interactions.
    if (phase === 'finishing' && compact) {
      shadow.querySelector('.ready').hidden = false;
      shadow.querySelector('.ready h1').hidden = true;
      shadow.querySelector('.ready p').hidden = true;
      shadow.querySelector('.ready .eyebrow').hidden = true;
      shadow.querySelector('[data-action=finish]').hidden = true;
    } else {
      shadow.querySelector('.ready h1').hidden = false;
      shadow.querySelector('.ready p').hidden = false;
      shadow.querySelector('.ready .eyebrow').hidden = false;
      shadow.querySelector('[data-action=finish]').hidden = false;
    }
    host.setAttribute('data-wait-phase', phase);
  }

  function finish(message = 'Your agent is ready. Return to continue your work.') {
    if (latch) pause(latch.video);
    videos().forEach(video => pause(video));
    phase = 'finished'; reason = message; render(); status();
  }

  function fail(message) {
    videos().forEach(video => pause(video, true));
    phase = 'covered'; reason = message; compact = false; freeze(); render(); status();
  }

  function lock(message, hard = true) {
    if (!enrolled) return;
    if (hard && currentRunKey) blockedRunKey = currentRunKey;
    provisional = !hard;
    if (phase === 'working') {
      latch = candidate();
      lastScroll = { x: win.scrollX, y: win.scrollY };
      phase = latch ? 'finishing' : 'covered';
      reason = latch ? message : 'The current video could not be identified safely. Return to your agent.';
      if (latch) latch.video.loop = false;
      freeze();
      videos().forEach(video => { if (!latch || video !== latch.video) pause(video, true); });
    } else if (phase === 'covered') reason = message;
    render(); status();
  }

  function monitor() {
    if (!enrolled || disposed) return;
    ensureUi();
    if (snapshot?.waiting?.deadline && Date.now() >= snapshot.waiting.deadline && phase !== 'returned') { forcePause(); return; }
    if (!locked()) return;
    render();
    freeze();
    for (const video of videos()) {
      if (phase !== 'finishing' || video !== latch?.video) pause(video, true);
    }
    if (phase !== 'finishing' || !latch) return;
    const { video } = latch;
    if (!video.isConnected || (video.currentSrc || video.getAttribute('src')) !== latch.source || !Number.isFinite(video.duration)) {
      fail('The page changed. Your feed stays locked; return to your agent.'); return;
    }
    const identity = identify(video);
    if (!identity || identity.id !== latch.id || win.location.href !== latch.documentUrl || visibleScore(video) < 0.55) {
      fail('The current reel changed. Return to your agent to continue.'); return;
    }
    video.loop = false;
    if (video.currentTime + 0.35 < latch.lastTime) { finish('This reel has reached its stopping point. Return to your agent.'); return; }
    if (video.ended || video.currentTime >= latch.duration - 0.06) { finish(); return; }
    latch.lastTime = Math.max(latch.lastTime, video.currentTime);
  }

  function isOwnEvent(event) { return event.composedPath().includes(host); }
  function block(event) {
    if (!locked() || isOwnEvent(event)) return;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }

  function returnToAi() {
    if (!enrolled) return;
    if (currentRunKey) blockedRunKey = currentRunKey;
    phase = 'returned'; reason = 'The return request was sent. Your feed will stay locked for this turn.';
    videos().forEach(video => pause(video, true)); freeze(); render(); status();
    emit({ type: 'return' });
  }

  function forcePause() {
    if (!enrolled) return;
    if (currentRunKey) blockedRunKey = currentRunKey;
    phase = 'returned'; reason = 'Time to return to your agent.';
    videos().forEach(video => pause(video, true)); freeze(); render();
  }

  function start() {
    if (timer) return;
    for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'click', 'dblclick', 'auxclick', 'contextmenu', 'dragstart']) {
      listen(win, type, block, { capture: true, passive: false });
    }
    listen(win, 'keydown', event => {
      if (!locked() || isOwnEvent(event)) return;
      if (navigationKeys.has(event.key) || event.key === 'Enter' || event.key === 'Tab') block(event);
    }, { capture: true, passive: false });
    // Playback events are captured before application listeners can advance a different video.
    listen(doc, 'play', event => {
      if (!locked() || !(event.target instanceof win.HTMLVideoElement)) return;
      if (phase !== 'finishing' || event.target !== latch?.video) { pause(event.target, true); event.stopImmediatePropagation(); }
      else monitor();
    });
    listen(doc, 'ended', event => {
      if (locked() && event.target === latch?.video) { event.stopImmediatePropagation(); finish(); }
    });
    listen(doc, 'timeupdate', event => { if (event.target === latch?.video) monitor(); });
    listen(doc, 'seeking', event => { if (locked() && event.target === latch?.video) monitor(); });
    listen(win, 'popstate', () => { if (locked()) monitor(); });
    listen(win, 'hashchange', () => { if (locked()) monitor(); });
    listen(doc, 'scroll', () => {
      if (!locked()) return;
      if (win.scrollX !== lastScroll.x || win.scrollY !== lastScroll.y) win.scrollTo(lastScroll.x, lastScroll.y);
      monitor();
    }, { capture: true, passive: true });
    observer = new win.MutationObserver(monitor);
    observer.observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'loop', 'href'] });
    timer = win.setInterval(monitor, 100);
  }

  function enroll(options = {}) {
    if (disposed) return;
    enrolled = true;
    selectedSessionKey = options.sessionKey ?? selectedSessionKey;
    blockedRunKey = options.blockedRunKey ?? blockedRunKey;
    currentRunKey = options.lastRunKey ?? currentRunKey;
    phase = 'covered';
    reason = 'Waiting for fresh agent status. Your feed will open when work is confirmed.';
    latch = null; compact = false; start(); freeze(); render(); status();
  }

  function applySnapshot(next) {
    if (!enrolled || disposed || !next || !Number.isFinite(next.revision)) return;
    if (next.revision < revision) return;
    revision = next.revision;
    snapshot = next;
    if (next.session?.state === 'returned' || next.waiting?.returned) { forcePause(); return; }
    const session = next.session;
    if (!session || !session.key || !session.runId) { lock('Choose a detected agent session in wAIt to start watching.', true); return; }
    if (selectedSessionKey && selectedSessionKey !== session.key) { lock('A different session is selected. Start a new watch session from wAIt.', true); return; }
    selectedSessionKey = session.key;
    const nextKey = runKey(session);
    const previousKey = currentRunKey;
    const newRun = previousKey && nextKey !== previousKey;
    if (next.canScroll === true && session.state === 'working' && nextKey !== blockedRunKey) {
      if (phase === 'working' || newRun || !previousKey || (provisional && !blockedRunKey) || (phase === 'covered' && !blockedRunKey)) {
        restoreStyles(); latch = null; currentRunKey = nextKey; provisional = false; compact = false;
        phase = 'working'; reason = ''; render(); status(); return;
      }
    }
    // A new run is adopted only when the coordinator explicitly grants scrolling.
    if (!currentRunKey) currentRunKey = nextKey;
    const message = session.state === 'needs_input' ? 'Your agent needs your attention. Finish this reel or return now.' :
      session.state === 'cancelled' ? 'Your agent was stopped. Finish this reel or return now.' :
      session.state === 'error' ? 'Your agent needs attention. Finish this reel or return now.' :
      session.state === 'stop_candidate' ? 'Your agent may be finished. New videos are paused while its status is confirmed.' :
      'Your agent is ready. Finish this reel or return now.';
    lock(message, finalStates.has(session.state) || nextKey === blockedRunKey);
  }

  function disconnect() {
    if (!enrolled) return;
    lock('The helper disconnected. Finish this reel or reconnect from wAIt; new videos stay locked.', false);
  }

  function dispose() {
    disposed = true; enrolled = false;
    listeners.forEach(remove => remove());
    observer?.disconnect();
    if (timer) win.clearInterval(timer);
    restoreStyles(); host?.remove();
  }

  return { enroll, applySnapshot, disconnect, dispose, returnToAi, forcePause,
    inspect: () => ({ enrolled, phase, reason, selectedSessionKey, currentRunKey, blockedRunKey, clipId: latch?.id ?? null, revision }) };
}
