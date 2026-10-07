import { execFileSync } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const rules = [
  ['Groq credential', /\bgsk_[A-Za-z0-9]{20,}\b/g],
  ['API credential', /\bsk-(?:or-v1-|proj-|ant-api\d+-)?[A-Za-z0-9_-]{24,}/g],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ['AWS access ID', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['Personal home path', /(?:[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[^\s"'<>]+|\/(?:home|Users)\/[^\s"'<>]+)/g],
];

export function findingsFor(name, text) {
  const findings = [];
  const normalized = name.replaceAll('\\', '/');
  if (/(?:^|\/)(?:\.agents|\.codex|\.aws|\.wait(?:-local|-setup)?|node_modules|dist|artifacts|test-results|playwright-report)\//i.test(normalized)
    || /(?:^|\/)(?:\.env(?:\..+)?|[^/]+\.env|groqAPI\.txt|aiteacherOpenrouterKey\.txt|connection\.json)$/i.test(normalized) && !normalized.endsWith('.env.example')
    || /(?:\.(?:key|pem|p12|pfx|db|sqlite3?)(?:-.*)?|\.wait-backup-.*|\.(?:log|vsix|crx|zip))$/i.test(normalized)) {
    findings.push({ file: name, kind: 'Private/generated file is included in the public file set' });
  }
  for (const [kind, regex] of rules) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) findings.push({file: name, line: text.slice(0, match.index).split('\n').length, kind});
  }
  return findings;
}

async function main() {
  const staged = process.argv.includes('--staged');
  // The index check scans exactly what a commit would contain, including blobs
  // that have since been edited in the working tree. Never print matched values.
  const names = [...new Set(git(staged ? ['ls-files', '-z'] : ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))];
  if(staged && !names.length) throw new Error('The index is empty. Stage the reviewed public files before using --staged.');
  const findings = [];
  for (const name of names) {
    let bytes;
    if (staged) bytes = Buffer.from(git(['show', `:${name}`]));
    else {
      const file = path.join(root, name);
      let stat;
      try { stat = await lstat(file); } catch (error) { if(error.code === 'ENOENT') continue; throw error; }
      if (stat.isSymbolicLink()) { findings.push({file:name,kind:'Review symlink target before publication'}); continue; }
      bytes = await readFile(file);
    }
    findings.push(...findingsFor(name, bytes.toString('utf8')));
  }
  for (const item of findings) console.log(`${item.file}${item.line ? ':' + item.line : ''}: ${item.kind}`);
  console.log(`Scanned ${names.length} ${staged ? 'index' : 'public-candidate'} files; ${findings.length} finding(s). Matched values are never printed.`);
  console.log('This is a focused check, not a guarantee: review the staged diff and any screenshots, archives or unusual credentials separately.');
  if(findings.length) process.exitCode=1;
}
if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
