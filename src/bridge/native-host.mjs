import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MAX_MESSAGE = 64 * 1024;

export function encodeNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > 1024 * 1024) throw new RangeError('Native response too large');
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(body.length);
  return Buffer.concat([prefix, body]);
}

/** Handles split headers, split UTF-8 bodies and multiple messages per chunk. */
export function createMessageDecoder(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length === 0 || length > MAX_MESSAGE) throw new RangeError('Invalid native message size');
      if (buffer.length < length + 4) return;
      const message = JSON.parse(buffer.subarray(4, length + 4).toString('utf8'));
      buffer = buffer.subarray(length + 4);
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new TypeError('Invalid native message');
      onMessage(message);
    }
  };
}

export async function runNativeHost({ connectionFile, input = process.stdin, output = process.stdout } = {}) {
  if (!connectionFile) throw new TypeError('A connection file is required');
  let stopped = false;
  let reconnectTimer;
  let sseAbort;
  let connection;
  let queue = Promise.resolve();
  const send = (message) => {
    if (!stopped && !output.destroyed && output.writableLength < 1024 * 1024) output.write(encodeNativeMessage(message));
  };
  const disconnected = () => send({ type: 'disconnected' });
  async function loadConnection() {
    const saved = JSON.parse(await readFile(connectionFile, 'utf8'));
    if (!Number.isInteger(saved.port) || saved.port < 1 || saved.port > 65535 || typeof saved.token !== 'string' || !/^[a-f0-9]{64}$/.test(saved.token)) throw new Error('Invalid connection');
    connection = saved;
    return saved;
  }
  async function call(route, body) {
    const saved = connection ?? await loadConnection();
    const response = await fetch(`http://127.0.0.1:${saved.port}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${saved.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(route === '/tutor/generate' ? 50_000 : 10_000),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Coordinator unavailable'), { status: response.status, retryAt: result.retryAt });
    return result;
  }
  async function receive(message) {
    if (message.type === 'rpc') {
      const routes = { waiting:'/waiting', context:'/context', generate:'/tutor/generate', history:'/tutor/history', feedback:'/tutor/feedback', memory:'/tutor/memory', return:'/return' };
      if (typeof message.id !== 'string' || message.id.length > 100 || !routes[message.action]) return;
      try { send({type:'rpcResult', id:message.id, data:await call(routes[message.action],message.body ?? {})}); }
      catch(error) { send({type:'rpcResult', id:message.id, error:error.status ? error.message : 'Coordinator unavailable', retryAt:error.retryAt}); }
      return;
    }
    try {
      let snapshot;
      if (message.type === 'getState') snapshot = await call('/state');
      else if (message.type === 'select' && typeof message.sessionKey === 'string') snapshot = await call('/select', { sessionKey: message.sessionKey });
      else if (message.type === 'return') snapshot = await call('/return', {});
      else if (message.type === 'tutorGenerate') {
        const response = await call('/tutor/generate', { feedback: message.feedback });
        send({ type: 'tutorResponse', data: response });
        return;
      }
      else return send({ type: 'error', error: 'Unsupported message' });
      send({ type: 'state', snapshot });
    } catch { connection = undefined; disconnected(); }
  }
  async function connect() {
    if (stopped) return;
    try {
      const saved = await loadConnection();
      sseAbort = new AbortController();
      const response = await fetch(`http://127.0.0.1:${saved.port}/events`, { headers: { Authorization: `Bearer ${saved.token}` }, signal: sseAbort.signal });
      if (!response.ok || !response.body) throw new Error('Coordinator unavailable');
      const decoder = new TextDecoder();
      let pending = '';
      for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true });
        if (pending.length > 1024 * 1024) throw new Error('Coordinator response too large');
        let boundary;
        while ((boundary = pending.indexOf('\n\n')) !== -1) {
          const block = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          for (const line of block.split('\n')) if (line.startsWith('data: ')) send({ type: 'state', snapshot: JSON.parse(line.slice(6)) });
        }
      }
    } catch { /* Fail closed without leaking tokens or payloads to stdout/stderr. */ }
    if (!stopped) {
      connection = undefined;
      disconnected();
      reconnectTimer = setTimeout(connect, 1500);
    }
  }
  // Tutor requests must never block status or return commands.
  const decode = createMessageDecoder((message) => { if(message.type==='rpc') void receive(message); else queue = queue.then(() => receive(message)); });
  const onData = (chunk) => { try { decode(chunk); } catch { disconnected(); stop(); } };
  const stop = () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    sseAbort?.abort();
    input.off('data', onData);
    input.off('end', stop);
  };
  input.on('data', onData);
  input.once('end', stop);
  input.once('error', stop);
  output.once('error', stop);
  void connect();
  return { stop };
}

if (process.argv.includes('--connection-file')) {
  const index = process.argv.indexOf('--connection-file');
  runNativeHost({ connectionFile: index >= 0 ? process.argv[index + 1] : undefined }).catch(() => {
    process.stdout.write(encodeNativeMessage({ type: 'disconnected' }));
    process.exitCode = 1;
  });
}
