import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startBridge } from '../src/bridge/server.mjs';
import { createMessageDecoder, encodeNativeMessage, runNativeHost } from '../src/bridge/native-host.mjs';
import { PassThrough } from 'node:stream';

const startEvent = { provider: 'demo', sessionId: 'first', runId: 'r1', eventId: 'e1', kind: 'start', timestamp: 100 };
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wait-bridge-test-'));
  const bridge = await startBridge({ port: 0, dataDir, ...options });
  t.after(async () => { await bridge.close(); await rm(dataDir, { recursive: true, force: true }); });
  const request = (route, body, headers = {}) => fetch(`http://127.0.0.1:${bridge.connection.port}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${bridge.connection.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  return { bridge, request, dataDir };
}

test('loopback bridge requires bearer credentials and rejects all web origins', async (t) => {
  const { bridge, request } = await fixture(t);
  assert.equal(bridge.server.address().address, '127.0.0.1');
  assert.equal((await request('/state', undefined, { Authorization: '' })).status, 403);
  assert.equal((await request('/state', undefined, { Origin: 'https://www.tiktok.com' })).status, 403);
  assert.equal((await request('/state', undefined, { Origin: 'null' })).status, 403);
  assert.equal((await request('/state', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('/state')).status, 200);
  assert.deepEqual(JSON.parse(await readFile(bridge.connectionFile, 'utf8')), bridge.connection);
});

test('bridge validates bodies and never exposes internal callback errors', async (t) => {
  const { request } = await fixture(t, { onReturn: () => { throw new Error('secret callback detail'); } });
  assert.equal((await request('/event', '{')).status, 400);
  assert.equal((await request('/event', {})).status, 400);
  assert.equal((await request('/event', startEvent, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request('/event', JSON.stringify({ text: 'x'.repeat(65536) }))).status, 413);
  assert.equal((await request('/select', { sessionKey: 'unknown' })).status, 400);
  assert.equal((await request('/return', {})).status, 409);
  await request('/event', startEvent);
  const returned = await request('/return', { command: 'ignored attacker command' });
  assert.equal(returned.status, 500);
  assert.equal((await returned.text()).includes('secret'), false);
  assert.equal((await (await request('/state')).json()).session.state, 'returned');
});

test('hooks dispatch safely and return callback receives only the selected session', async (t) => {
  let received;
  let returned;
  const { request } = await fixture(t, { onHook: (hook) => { received = hook; return hook.event === 'ignored' ? null : startEvent; }, onReturn: (session) => { returned = session; } });
  const hook = { provider: 'demo', event: 'start', payload: {}, observedAt: 101, eventId: 'hook-1' };
  assert.equal((await request('/hooks', hook)).status, 200);
  assert.deepEqual(received, hook);
  const before = (await (await request('/state')).json()).revision;
  await request('/hooks', { ...hook, event: 'ignored' });
  assert.equal((await (await request('/state')).json()).revision, before);
  await request('/event', { ...startEvent, sessionId: 'second', eventId: 'e2' });
  await request('/return', { sessionKey: 'demo:second', command: 'anything' });
  assert.equal(returned.key, 'demo:first');
  assert.equal(returned.command, undefined);
  assert.equal((await (await request('/state')).json()).canScroll, false);
});

test('SSE immediately publishes locked snapshot and subsequent transitions', async (t) => {
  const { request } = await fixture(t);
  const response = await request('/events');
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"canScroll":false/);
  await request('/event', startEvent);
  assert.match(new TextDecoder().decode((await reader.read()).value), /"canScroll":true/);
  await reader.cancel();
});

test('native framing survives split Unicode and concatenated messages and rejects oversized frames', () => {
  const result = [];
  const decode = createMessageDecoder((message) => result.push(message));
  const first = { type: 'select', sessionKey: 'demo:你好' };
  const combined = Buffer.concat([encodeNativeMessage(first), encodeNativeMessage({ type: 'return' })]);
  for (const byte of combined) decode(Buffer.from([byte]));
  assert.deepEqual(result, [first, { type: 'return' }]);
  const large = Buffer.alloc(4);
  large.writeUInt32LE(1000000);
  assert.throws(() => decode(large), RangeError);
});

test('native host sends live state, maps return requests and fails closed on disconnect', async (t) => {
  const { bridge, request } = await fixture(t);
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = [];
  const listeners = [];
  output.on('data', createMessageDecoder((message) => { messages.push(message); for (const notify of listeners.splice(0)) notify(); }));
  const host = await runNativeHost({ connectionFile: bridge.connectionFile, input, output });
  t.after(host.stop);
  const until = async (predicate) => {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'timed out waiting for native message');
      await new Promise((resolve) => { const timer = setTimeout(resolve, 50); listeners.push(() => { clearTimeout(timer); resolve(); }); });
    }
  };
  await until(() => messages.some((message) => message.type === 'state' && !message.snapshot.canScroll));
  await request('/event', startEvent);
  await until(() => messages.some((message) => message.type === 'state' && message.snapshot.canScroll));
  input.write(encodeNativeMessage({ type: 'return' }));
  await until(() => messages.some((message) => message.type === 'state' && message.snapshot.session?.state === 'returned'));
  await bridge.close();
  await until(() => messages.some((message) => message.type === 'disconnected'));
});
