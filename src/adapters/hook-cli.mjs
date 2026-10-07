import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { sanitizeHookPayload, passiveHookOutput } from './hooks.mjs';
import { hookContext } from './context.mjs';
import { matchesProject } from './workspace.mjs';

function argumentsFrom(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--connection-file', '--provider', '--event'].includes(argv[i]) || !argv[i + 1]) throw new Error('Invalid arguments');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

async function readInput(limit = 262144) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('Input limit exceeded');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function main(argv = process.argv.slice(2)) {
  let args = {};
  let status = 'invalid_input';
  // Store only a bounded status record, never prompts, tokens or raw errors.
  async function diagnose() {
    if (!args['connection-file'] || !['codex','antigravity','copilot'].includes(args.provider)) return;
    try {
      await writeFile(path.join(path.dirname(args['connection-file']), `hook-status-${args.provider}.json`),
        JSON.stringify({ timestamp: new Date().toISOString(), event: args.event, status }), { mode: 0o600 });
    } catch {}
  }
  try {
    args = argumentsFrom(argv);
    const timestamp = new Date().toISOString();
    const eventId = randomUUID();
    status = 'reading_input';
    await diagnose();
    status = 'invalid_input';
    const raw = await readInput();
    status = 'invalid_payload';
    const payload = sanitizeHookPayload(args.provider, args.event, raw);
    if (!payload) return;
    status = 'connection_unavailable';
    const connection = JSON.parse(await readFile(args['connection-file'], 'utf8'));
    status = 'invalid_connection';
    if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535
        || typeof connection.token !== 'string' || connection.token.length < 16) return;
    if (!matchesProject(raw, connection.projectRoot)) { status = 'workspace_mismatch'; return; }
    status = 'context_failed';
    const context = await hookContext(raw, args.event, connection);
    status = 'bridge_unreachable';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const resp = await fetch(`http://127.0.0.1:${connection.port}/hooks`, {
        method: 'POST', signal: controller.signal,
        headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ provider: args.provider, event: args.event, payload: { ...payload, timestamp, eventId }, ...(context ? {context} : {}) }),
      });
      status = resp.ok ? 'delivered' : `bridge_http_${resp.status}`;
    } finally { clearTimeout(timeout); }
  } catch {
    // Watching reels must never interrupt the coding agent or reveal hook input.
  } finally {
    process.stdout.write(`${JSON.stringify(passiveHookOutput(args.provider, args.event))}\n`);
    await diagnose();
  }
}

main().catch(() => process.exit(1));
