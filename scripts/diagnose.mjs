import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dataIndex = args.indexOf('--data-dir');
const dataDir = dataIndex < 0 ? path.join(root, '.wait/runtime') : path.resolve(args[dataIndex + 1]);
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const messages = {
  reading_input: 'Hook started but has not finished reading stdin (or was interrupted).',
  invalid_input: 'Hook input was not valid JSON or exceeded the input limit.',
  invalid_payload: 'Hook payload lacks a supported conversation/session ID.',
  connection_unavailable: 'Hook could not read the connection file. Start wAIt first.',
  invalid_connection: 'Connection file is invalid. Restart wAIt.',
  workspace_mismatch: 'Task was ignored because its workspace does not match the monitored project.',
  context_failed: 'Context extraction failed before the event could be sent.',
  bridge_unreachable: 'Hook could not reach the bridge before its timeout.',
  delivered: 'Hook reached the bridge. Check the detected sessions below.',
};
let connection;
try {
  connection = await readJson(path.join(dataDir, 'connection.json'));
  console.log(`Monitored project: ${connection.projectRoot ?? '(not restricted)'}`);
} catch { console.log('No connection file. Run npm start first.'); }
for (const provider of ['antigravity', 'codex']) {
  try {
    const latest = await readJson(path.join(dataDir, `hook-status-${provider}.json`));
    console.log(`${provider}: ${latest.timestamp} ${latest.event}: ${messages[latest.status] ?? latest.status}`);
  } catch { console.log(`${provider}: No hook invocation recorded by this build. Restart the agent app and send a new prompt.`); }
}
for (const file of [path.join(os.homedir(), '.gemini/config/hooks.json'), path.join(connection?.projectRoot ?? root, '.agents/hooks.json')]) {
  try {
    const config = await readJson(file);
    const hooks = config['wait-companion']?.PreInvocation ?? [];
    console.log(`Antigravity hooks in ${file}: ${hooks.length ? 'present' : 'no local wAIt start hook (global registration is sufficient)'}`);
    if (hooks.some(h => /["].*\s.*["]/.test(h.command ?? ''))) console.log('  Legacy quoted command: this Antigravity Windows launcher can split paths at spaces. Run npm run setup -- --repair-antigravity.');
  } catch { console.log(`No readable Antigravity hook config at ${file}`); }
}
if (connection) {
  try {
    const response = await fetch(`http://127.0.0.1:${connection.port}/state`, {
      headers: { authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error();
    const state = await response.json();
    console.log(`Bridge reachable. Detected tasks: ${state.sessions.length}.`);
    for (const session of state.sessions) console.log(`  ${session.label}: ${session.state}${session.key === state.selectedSessionKey ? ' (selected)' : ''}`);
    const diagnostics = await fetch(`http://127.0.0.1:${connection.port}/diagnostics`, {
      headers: { authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(3000),
    });
    if(diagnostics.ok) for(const hook of (await diagnostics.json()).hooks.slice(-20)) console.log(`  Hook: ${JSON.stringify(hook)}`);
  } catch { console.log('Bridge unreachable. Start/restart npm start and keep that terminal open.'); }
}
