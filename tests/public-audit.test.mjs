import test from 'node:test';
import assert from 'node:assert/strict';
import { findingsFor } from '../scripts/audit-public.mjs';

test('public audit flags secret files even without a recognizable credential', () => {
  for (const file of ['.env.local', '.wait/runtime/connection.json', '.agents/hooks.json', 'learning_memory.db-wal', 'private.key']) {
    assert.ok(findingsFor(file, '').length, file);
  }
  assert.equal(findingsFor('.env.example', '# No credentials here').length, 0);
});

test('public audit reports locations without returning the matched secret', () => {
  const fake = 'gsk_' + 'a'.repeat(32);
  const result = findingsFor('src/example.mjs', '\n' + fake);
  assert.equal(result[0].line, 2);
  assert.equal(JSON.stringify(result).includes(fake), false);
});

test('public audit keeps the browser public key publishable', () => {
  assert.equal(findingsFor('extensions/browser/manifest.json', JSON.stringify({key:'public-base64-data'})).length, 0);
});
