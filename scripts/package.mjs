import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);
await mkdir(path.join(root, 'artifacts'), { recursive: true });
const output = path.join(root, 'artifacts/wait-companion-0.1.0.vsix');
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@vscode/vsce/vsce'), 'package', '--no-dependencies', '--allow-missing-repository', '--no-rewrite-relative-links', '--out', output], { cwd: path.join(root, 'dist/vscode'), stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
console.log(`VS Code package: ${output}`);
