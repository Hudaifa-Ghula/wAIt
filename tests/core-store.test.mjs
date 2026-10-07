import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore } from '../src/core/store.mjs';

function event(kind, timestamp = 100, extra = {}) {
  return { provider: 'copilot', sessionId: 'a', runId: 'one', eventId: `${kind}-${timestamp}`, timestamp, kind, ...extra };
}

test('only the selected task can control scrolling across concurrent tasks', () => {
  const store = createSessionStore();
  assert.equal(store.getSnapshot().canScroll, false);
  store.dispatch(event('start'));
  store.dispatch(event('start', 101, { provider: 'antigravity', sessionId: 'b' }));
  assert.equal(store.getSnapshot().selectedSessionKey, 'copilot:a');
  store.dispatch(event('completed', 102, { provider: 'antigravity', sessionId: 'b' }));
  assert.equal(store.getSnapshot().canScroll, true);
  store.dispatch(event('completed', 103));
  assert.equal(store.getSnapshot().canScroll, false);
  store.dispatch(event('start', 104, { provider: 'antigravity', sessionId: 'b', runId: 'two' }));
  assert.equal(store.getSnapshot().canScroll, false);
  store.select('antigravity:b');
  assert.equal(store.getSnapshot().canScroll, true);
});

test('completion, returned and error latches require a fresh explicit run', () => {
  for (const terminal of ['completed', 'needs_input', 'error', 'cancelled', 'return']) {
    const store = createSessionStore();
    store.dispatch(event('start'));
    if (terminal === 'return') store.returnToAgent();
    else store.dispatch(event(terminal, 101));
    store.dispatch(event('activity', 200));
    store.dispatch(event('activity', 201, { runId: 'two' }));
    store.dispatch(event('start', 202));
    assert.equal(store.getSnapshot().canScroll, false, terminal);
    store.dispatch(event('start', 203, { runId: 'two' }));
    assert.equal(store.getSnapshot().canScroll, true, terminal);
    // A delayed packet from an old run cannot stop the new run, even with a newer arrival timestamp.
    store.dispatch(event('completed', 204));
    assert.equal(store.getSnapshot().canScroll, true, terminal);
    store.dispatch(event('start', 205));
    assert.equal(store.getSnapshot().session.runId, 'two', terminal);
  }
});

test('stop candidates lock immediately and activity can resume only candidates', () => {
  const store = createSessionStore();
  store.dispatch(event('start'));
  store.dispatch(event('stop_candidate', 101));
  assert.equal(store.getSnapshot().canScroll, false);
  store.dispatch(event('activity', 102));
  assert.equal(store.getSnapshot().canScroll, true);
  store.dispatch(event('completed', 103));
  store.dispatch(event('activity', 104));
  assert.equal(store.getSnapshot().session.state, 'ready');
});

test('deduplicates, rejects stale packets and returns copies of state', () => {
  const store = createSessionStore();
  const first = event('start');
  store.dispatch(first);
  const revision = store.getSnapshot().revision;
  store.dispatch({ ...first, timestamp: 1000 });
  store.dispatch(event('completed', 99));
  assert.equal(store.getSnapshot().revision, revision);
  const snapshot = store.getSnapshot();
  snapshot.session.state = 'ready';
  snapshot.sessions[0].label = 'changed';
  assert.equal(store.getSnapshot().session.state, 'working');
  assert.equal(store.getSnapshot().session.label, 'copilot task');
  assert.throws(() => store.select('unknown'), /Unknown session/);
});

test('unknown activity never opens access; malformed events fail validation', () => {
  const store = createSessionStore();
  store.dispatch(event('activity'));
  assert.equal(store.getSnapshot().canScroll, false);
  assert.equal(store.getSnapshot().session, null);
  for (const bad of [null, {}, event('invented'), event('start', NaN), event('start', 100, { sessionId: '' })]) {
    assert.throws(() => store.dispatch(bad), TypeError);
  }
  store.dispatch(event('start', '2026-09-11T12:00:00Z', { detail: 'private prompt text' }));
  assert.equal(store.getSnapshot().session.updatedAt, Date.parse('2026-09-11T12:00:00Z'));
  assert.equal(JSON.stringify(store.getSnapshot()).includes('private prompt'), false);
});
