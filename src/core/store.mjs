const PROVIDERS = new Set(['codex', 'copilot', 'antigravity', 'demo']);
const KINDS = new Set(['start', 'activity', 'stop_candidate', 'completed', 'needs_input', 'cancelled', 'error']);
const TERMINAL = new Set(['ready', 'needs_input', 'cancelled', 'error', 'returned']);
const STATE_FOR_KIND = { start: 'working', activity: 'working', stop_candidate: 'stop_candidate', completed: 'ready', needs_input: 'needs_input', cancelled: 'cancelled', error: 'error' };

function shortString(value, name, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`Invalid ${name}`);
  return value;
}

/** Validate at the trust boundary. Chat text and arbitrary payload fields never enter snapshots. */
export function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('Invalid event');
  if (!PROVIDERS.has(event.provider) || !KINDS.has(event.kind)) throw new TypeError('Invalid event provider or kind');
  const timestamp = typeof event.timestamp === 'number' ? event.timestamp : typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : NaN;
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new TypeError('Invalid event timestamp');
  return {
    provider: event.provider,
    sessionId: shortString(event.sessionId, 'sessionId'),
    eventId: shortString(event.eventId, 'eventId'),
    ...(event.runId === undefined ? {} : { runId: shortString(event.runId, 'runId') }),
    timestamp,
    kind: event.kind,
    ...(event.label === undefined ? {} : { label: shortString(event.label, 'label', 160) }),
  };
}

/** A single selected task controls the feed; unrelated tasks never unlock it. */
export function createSessionStore() {
  const sessions = new Map();
  const seenEvents = new Set();
  const retiredRuns = new Map();
  let selectedSessionKey = null;
  let revision = 0;

  function getSnapshot() {
    const all = [...sessions.values()].map((session) => ({ ...session }));
    const session = all.find((item) => item.key === selectedSessionKey) ?? null;
    return { revision, selectedSessionKey, session, sessions: all, canScroll: session?.state === 'working' };
  }

  function dispatch(input) {
    const event = validateEvent(input);
    const key = `${event.provider}:${event.sessionId}`;
    const eventKey = JSON.stringify([key, event.eventId]);
    if (seenEvents.has(eventKey)) return getSnapshot();
    seenEvents.add(eventKey);
    // Bound duplicate bookkeeping; timestamps and run fencing still reject old events.
    if (seenEvents.size > 20_000) seenEvents.delete(seenEvents.values().next().value);
    const previous = sessions.get(key);
    if (previous && event.timestamp < previous.updatedAt) return getSnapshot();
    const changedRun = Boolean(previous && event.runId && event.runId !== previous.runId);
    if (changedRun && retiredRuns.get(key)?.has(event.runId)) return getSnapshot();
    // Opening a run requires a start signal. Activity alone cannot escape a completion lock.
    if (changedRun && event.kind !== 'start') return getSnapshot();
    if (previous && TERMINAL.has(previous.state)) {
      if (event.kind !== 'start') return getSnapshot();
      if (event.runId && event.runId === previous.runId) return getSnapshot();
    }
    // A missing start may record a stopped task, but it must never unlock the feed.
    if (!previous && event.kind === 'activity') return getSnapshot();
    if (changedRun && previous.runId) {
      if (!retiredRuns.has(key)) retiredRuns.set(key, new Set());
      retiredRuns.get(key).add(previous.runId);
    }
    const session = {
      key,
      provider: event.provider,
      sessionId: event.sessionId,
      runId: event.runId ?? (event.kind === 'start' ? undefined : previous?.runId),
      label: event.label ?? previous?.label ?? `${event.provider} task`,
      state: STATE_FOR_KIND[event.kind],
      updatedAt: event.timestamp,
    };
    sessions.set(key, session);
    if (selectedSessionKey === null && event.kind === 'start') selectedSessionKey = key;
    revision += 1;
    return getSnapshot();
  }

  function select(sessionKey) {
    if (typeof sessionKey !== 'string' || !sessions.has(sessionKey)) throw new RangeError('Unknown session');
    if (selectedSessionKey !== sessionKey) {
      selectedSessionKey = sessionKey;
      revision += 1;
    }
    return getSnapshot();
  }

  function returnToAgent() {
    const session = sessions.get(selectedSessionKey);
    if (session && session.state !== 'returned') {
      sessions.set(session.key, { ...session, state: 'returned' });
      revision += 1;
    }
    return getSnapshot();
  }

  return { dispatch, select, getSnapshot, returnToAgent };
}
