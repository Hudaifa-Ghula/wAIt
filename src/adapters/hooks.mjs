import { randomUUID } from 'node:crypto';

const PROVIDERS = new Set(['codex', 'copilot', 'antigravity']);
const EVENTS = {
  codex: new Set(['UserPromptSubmit','PreToolUse','PostToolUse','PermissionRequest','Stop','Interrupt']),
  copilot: new Set(['UserPromptSubmit', 'Stop']),
  antigravity: new Set(['PreInvocation', 'Stop']),
};
const MAX_ID_LENGTH = 256;

function identifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
    && !/[\u0000-\u001f]/u.test(value) ? value : undefined;
}

function counter(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Discard prompts, transcripts, paths, tool arguments, and raw error messages. */
export function sanitizeHookPayload(provider, event, input = {}) {
  if (!PROVIDERS.has(provider) || !EVENTS[provider].has(event)
      || !input || typeof input !== 'object' || Array.isArray(input)) return null;
  const output = {};
  const sessionField = provider !== 'antigravity' ? 'session_id' : 'conversationId';
  const session = identifier(input[sessionField]);
  if (!session) return null;
  output[sessionField] = session;
  if (provider !== 'antigravity') {
    // Nested agents must never finish or reopen the selected parent session.
    if (input.agent_id || input.subagent_id || input.parent_agent_id) return null;
    if (typeof input.stop_hook_active === 'boolean') output.stop_hook_active = input.stop_hook_active;
    if (identifier(input.turn_id)) output.turn_id = input.turn_id;
    if (provider === 'codex' && event === 'PreToolUse' && /(?:^|[._])request_user_input(?:_async)?$/.test(input.tool_name ?? '')) output.awaitingInput = true;
    if (input.awaitingInput === true) output.awaitingInput = true;
  } else {
    for (const key of ['invocationNum', 'initialNumSteps', 'executionNum']) {
      if (counter(input[key]) !== undefined) output[key] = input[key];
    }
    if (typeof input.fullyIdle === 'boolean') output.fullyIdle = input.fullyIdle;
    if (['model_stop', 'max_steps_exceeded', 'error', 'cancelled', 'canceled', 'interrupted'].includes(input.terminationReason)) {
      output.terminationReason = input.terminationReason;
    }
    if (input.error) output.hasError = true;
    if (input.hasError === true) output.hasError = true;
  }
  // These are adapter envelope fields, never agent prompt data.
  if (identifier(input.eventId)) output.eventId = input.eventId;
  if (typeof input.timestamp === 'string' && Number.isFinite(Date.parse(input.timestamp))) {
    output.timestamp = new Date(input.timestamp).toISOString();
  }
  return output;
}

/** Keep one instance per bridge lifetime; separate hook processes cannot own this state. */
export function createHookNormalizer({ now = () => Date.now(), makeId = randomUUID } = {}) {
  const sessions = new Map();
  const seen = new Set();

  function normalize(provider, event, input) {
    const payload = sanitizeHookPayload(provider, event, input);
    if (!payload) return null;
    const sessionId = payload.session_id ?? payload.conversationId;
    const key = `${provider}:${sessionId}`;
    const timestamp = payload.timestamp ?? new Date(now()).toISOString();
    const eventId = payload.eventId ?? makeId();
    if (seen.has(eventId)) return null;
    const previous = sessions.get(key);
    if (previous && Date.parse(timestamp) < previous.updatedAt) return null;
    const state = previous ?? {
      runId: undefined, active: false, invocationNum: -1, executionNum: -1,
      stopWasIdle: false, updatedAt: 0, initialNumSteps: -1,
    };
    let kind;
    let detail;

    if (provider === 'codex') {
      if (event === 'UserPromptSubmit') {
        if (payload.turn_id && payload.turn_id === state.turnId) return null;
        state.turnId = payload.turn_id; state.runId = payload.turn_id ?? makeId(); state.active = true; kind = 'start';
      } else {
        if (!state.runId || (payload.turn_id && payload.turn_id !== state.turnId)) return null;
        kind = event === 'PermissionRequest' || payload.awaitingInput ? 'needs_input' : event === 'Interrupt' ? 'cancelled' : event === 'Stop' ? 'stop_candidate' : 'activity';
        // A subsequent observed tool call proves continuation after a stop/approval.
        if (kind === 'activity' && !state.active) { state.runId = `${payload.turn_id ?? state.runId}:${makeId()}`; kind = 'start'; }
        state.active = !['needs_input','cancelled'].includes(kind);
      }
    } else if (provider === 'copilot') {
      if (event === 'UserPromptSubmit') {
        state.runId = makeId();
        state.active = true;
        kind = 'start';
      } else {
        kind = 'stop_candidate';
        detail = payload.stop_hook_active
          ? 'A stop hook is continuing this execution. Check the agent before returning.'
          : 'Copilot stopped an execution. Other hooks may continue it; check the agent.';
      }
    } else if (event === 'PreInvocation') {
      const invocation = payload.invocationNum;
      // Invocation counters can restart for a later task in the same conversation.
      // A growing trajectory proves progress even when that counter resets.
      const steps = payload.initialNumSteps;
      if (invocation === undefined || (steps !== undefined && steps < state.initialNumSteps)) return null;
      if (invocation <= state.invocationNum && !(steps !== undefined && steps > state.initialNumSteps)) return null;
      state.invocationNum = invocation;
      if (steps !== undefined) state.initialNumSteps = steps;
      if (!state.active) {
        state.runId = makeId();
        state.active = true;
        // Stop counters belong to an execution cycle, not the conversation.
        state.executionNum = -1;
        state.stopWasIdle = false;
        kind = 'start';
        detail = 'Antigravity began an observed execution cycle; this is not proof of a new user prompt.';
      } else {
        kind = 'activity';
      }
    } else {
      const execution = payload.executionNum;
      if (execution !== undefined) {
        if (execution < state.executionNum) return null;
        // A candidate may later become fully idle for the same execution.
        if (execution === state.executionNum && (state.stopWasIdle || payload.fullyIdle !== true)) return null;
        state.executionNum = execution;
      }
      state.stopWasIdle = payload.fullyIdle === true;
      if (payload.hasError || payload.terminationReason === 'error' || payload.terminationReason === 'max_steps_exceeded') {
        kind = 'error';
        detail = 'Antigravity stopped with an error or execution limit.';
        state.active = false;
      } else if (['cancelled', 'canceled', 'interrupted'].includes(payload.terminationReason)) {
        kind = 'cancelled';
        detail = 'Antigravity reported an interrupted execution.';
        state.active = false;
      } else if (payload.fullyIdle === true && payload.terminationReason === 'model_stop') {
        kind = 'completed';
        state.active = false;
      } else {
        kind = 'stop_candidate';
        // A later observed invocation must start a fresh run, including after
        // the countdown has already marked the old run as returned.
        state.active = false;
        detail = payload.fullyIdle === false
          ? 'Antigravity stopped its loop while background work remains.'
          : 'Antigravity stopped; complete idle status was not confirmed.';
      }
    }

    state.updatedAt = Date.parse(timestamp);
    sessions.set(key, state);
    seen.add(eventId);
    if (seen.size > 4096) seen.delete(seen.values().next().value);
    return {
      provider, sessionId, ...(state.runId ? { runId: state.runId } : {}),
      eventId, timestamp, kind,
      label: `${provider === 'codex' ? 'Codex' : provider === 'copilot' ? 'Copilot' : 'Antigravity'} · ${sessionId.slice(0, 8)}`,
      ...(detail ? { detail } : {}),
    };
  }
  normalize.returned = session => {
    const state = sessions.get(`${session.provider}:${session.sessionId}`);
    if (state?.runId === session.runId) state.active = false;
  };
  return normalize;
}

// Convenience for isolated conversions. A running bridge must use the factory above.
export function normalizeHook(provider, event, payload) {
  return createHookNormalizer()(provider, event, payload);
}

export function passiveHookOutput(provider, event) {
  // Antigravity requires a decision for Stop. Any value other than "continue"
  // permits the existing stop; this does not grant any tool permissions.
  return provider === 'antigravity' && event === 'Stop' ? { decision: 'stop' } : {};
}
