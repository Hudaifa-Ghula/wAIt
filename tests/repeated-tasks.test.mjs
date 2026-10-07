import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHookNormalizer } from '../src/adapters/hooks.mjs';
import { createSessionStore } from '../src/core/store.mjs';

for (const fullyIdle of [true, false, undefined]) {
  test(`Antigravity reopens after return (fullyIdle=${fullyIdle}) and rejects stale invocations`, () => {
    const normalize = createHookNormalizer();
    const store = createSessionStore();
    const input = {conversationId: 'same-chat', invocationNum: 4, initialNumSteps: 10};
    store.dispatch(normalize('antigravity', 'PreInvocation', input));
    const oldRun = store.getSnapshot().session.runId;
    store.dispatch(normalize('antigravity', 'Stop', {...input, executionNum: 0, terminationReason: 'model_stop', fullyIdle}));
    store.returnToAgent();
    assert.equal(normalize('antigravity', 'PreInvocation', input), null);
    const next = normalize('antigravity', 'PreInvocation', {...input, invocationNum: 0, initialNumSteps: 20});
    assert.equal(next.kind, 'start');
    store.dispatch(next);
    assert.equal(store.getSnapshot().canScroll, true);
    assert.notEqual(store.getSnapshot().session.runId, oldRun);
    assert.equal(normalize('antigravity', 'PreInvocation', {...input, invocationNum: 5}), null);
    assert.equal(normalize('antigravity', 'Stop', {conversationId: 'same-chat', timestamp:'2000-01-01T00:00:00Z', executionNum: 0, fullyIdle: true, terminationReason: 'model_stop'}), null);
    store.dispatch(normalize('antigravity', 'Stop', {conversationId: 'same-chat', executionNum: 0, fullyIdle: true, terminationReason: 'model_stop'}));
    assert.equal(store.getSnapshot().session.state, 'ready');
    store.returnToAgent();
    store.dispatch(normalize('antigravity', 'PreInvocation', {...input, invocationNum: 1, initialNumSteps: 30}));
    assert.equal(store.getSnapshot().canScroll, true);
  });
}

test('manual return recovers on fresh invocation when the host never delivered Stop', () => {
  const normalize = createHookNormalizer();
  const store = createSessionStore();
  const first = {conversationId:'missing-stop', invocationNum:0, initialNumSteps:1};
  store.dispatch(normalize('antigravity','PreInvocation',first));
  const previous = store.getSnapshot().session;
  store.returnToAgent();
  normalize.returned(previous);
  assert.equal(normalize('antigravity','PreInvocation',first),null);
  store.dispatch(normalize('antigravity','PreInvocation',{...first,initialNumSteps:5}));
  assert.equal(store.getSnapshot().canScroll,true);
  assert.notEqual(store.getSnapshot().session.runId,previous.runId);
});

test('browser restores scrolling in the existing window for the next run and clears its old deadline', async () => {
  const updates = [], urls = [], tabMessages = [];
  let saved;
  const listener = {addListener() {}};
  const native = {onMessage: listener, onDisconnect: listener, postMessage() {}};
  const chrome = {
    storage: {local: {get: async () => ({}), set: async value => {saved = structuredClone(value);}}},
    runtime: {id: 'test', getURL: p => `chrome-extension://test/${p}`, sendMessage: async () => {}, onMessage: listener, connectNative: () => native},
    alarms: {clear: async () => {}, create: async () => {}, onAlarm: listener},
    windows: {get: async () => ({id: 1}), update: async (id, value) => {updates.push(value);}, onRemoved: listener},
    tabs: {sendMessage: async (id,message) => {tabMessages.push(message);}, get: async () => ({id: 2}), update: async (id, value) => {urls.push(value);}},
  };
  const context = vm.createContext({chrome, setTimeout: () => 0, clearTimeout() {}, console});
  vm.runInContext(await readFile('extensions/browser/worker.js', 'utf8'), context);
  await vm.runInContext('ready', context);
  vm.runInContext(`rpc=async()=>({}); managed={windowId:1,tabId:2,mode:'scroll',runKey:'antigravity:chat/old',deadline:1};`, context);
  context.oldState = {session: {key: 'antigravity:chat', runId: 'old', state: 'returned'}, waiting: {returned: true}};
  await vm.runInContext('onState(oldState)', context);
  tabMessages.length=0;
  context.newState = {session: {key: 'antigravity:chat', runId: 'new', state: 'working'}, waiting: null};
  await vm.runInContext('onState(newState)', context);
  assert.equal(urls.at(-1).active, true);
  assert.equal(urls.at(-1).url, undefined, 'keep the current reel when reopening the same mode');
  assert.equal(tabMessages.some(m=>m.type==='pauseNow'),false, 'do not lock the newly broadcast run');
  assert.equal(updates.at(-1).focused, true);
  assert.equal(saved.managed.runKey, 'antigravity:chat/new');
  assert.equal(saved.managed.deadline, null);
  await vm.runInContext('onState(newState)', context);
  assert.equal(urls.length, 1, 'duplicate state must not reopen the window');
  await vm.runInContext("automaticBack({sessionKey:'antigravity:chat',runId:'old'},1)", context);
  assert.equal(tabMessages.some(m=>m.type==='pauseNow'),false,'expired callbacks from the previous run cannot pause this run');
});
