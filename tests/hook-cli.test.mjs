import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startBridge } from '../src/bridge/server.mjs';
import { createHookNormalizer } from '../src/adapters/hooks.mjs';
import { matchesProject } from '../src/adapters/workspace.mjs';
import { antigravityHookCommand } from '../src/adapters/hook-command.mjs';

function invoke(script, connectionFile, event, input) {
  return new Promise((resolve, reject) => {
    const installed = script === 'installed Antigravity command';
    const command = installed ? antigravityHookCommand(process.cwd(), path.dirname(connectionFile), event).split(/\s+/)
      : [process.execPath, script, '--connection-file', connectionFile, '--provider', 'antigravity', '--event', event];
    const child = spawn(command[0], command.slice(1), { windowsHide: true,
      ...(installed ? {cwd: path.dirname(connectionFile)} : {}) });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
    child.stdin.end(JSON.stringify(input));
  });
}

test('project matching considers all mounted workspaces and rejects unrelated or missing paths', () => {
  const root = path.resolve('example');
  assert.equal(matchesProject({ workspacePaths: [path.resolve('other'), root] }, root), true);
  assert.equal(matchesProject({ context: { workspace: { root } } }, root), true);
  assert.equal(matchesProject({ workspacePaths: [root + '-other'] }, root), false);
  assert.equal(matchesProject({ workspacePaths: [null, 4] }, root), false);
  assert.equal(matchesProject({}, root), false);
});

for (const script of ['src/adapters/hook-cli.mjs', 'dist/vscode/hook-cli.cjs', 'installed Antigravity command']) {
  test(`${script}: real hook process starts/stops a task and diagnoses rejected workspaces`, async t => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wait hook test with spaces-'));
    const normalize = createHookNormalizer();
    const bridge = await startBridge({ port: 0, dataDir, onHook: ({provider,event,payload}) => normalize(provider,event,payload) });
    t.after(async () => { await bridge.close(); await rm(dataDir, {recursive: true, force: true}); });
    const projectRoot = path.resolve('example');
    await writeFile(bridge.connectionFile, JSON.stringify({...bridge.connection, projectRoot}));
    const input = {conversationId: 'test-conversation', invocationNum: 0, initialNumSteps: 0,
      workspacePaths: [path.resolve('unrelated'), projectRoot], prompt: 'DO NOT LOG THIS'};
    const snapshot = async () => (await fetch(`http://127.0.0.1:${bridge.connection.port}/state`, {
      headers: { authorization: `Bearer ${bridge.connection.token}` },
    })).json();
    assert.deepEqual(await invoke(script, bridge.connectionFile, 'PreInvocation', input), {});
    assert.equal((await snapshot()).session.state, 'working');
    assert.deepEqual(await invoke(script, bridge.connectionFile, 'Stop', {...input, executionNum: 0,
      terminationReason: 'model_stop', fullyIdle: true}), {decision: 'stop'});
    assert.equal((await snapshot()).session.state, 'ready');
    await invoke(script, bridge.connectionFile, 'PreInvocation', {...input, conversationId: 'outside', workspacePaths: [path.resolve('unrelated')]});
    assert.equal((await snapshot()).sessions.length, 1);
    const status = await readFile(path.join(dataDir, 'hook-status-antigravity.json'), 'utf8');
    assert.equal(JSON.parse(status).status, 'workspace_mismatch');
    assert.equal(status.includes('DO NOT LOG THIS'), false);
    assert.equal(status.includes(bridge.connection.token), false);
  });
}
