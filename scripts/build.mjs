import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconPng } from './icon.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
await mkdir(path.join(output, 'browser'), { recursive: true });
await mkdir(path.join(output, 'vscode'), { recursive: true });
await writeFile(path.join(output, 'browser/icon.png'), iconPng());
await build({ entryPoints: [path.join(root, 'extensions/browser/content-entry.mjs')], outfile: path.join(output, 'browser/content.js'), bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', sourcemap: true });
for (const name of ['manifest.json', 'worker.js', 'popup.html', 'popup.js', 'popup.css', 'learn.html', 'learn.js', 'learn.css']) {
  await cp(path.join(root, 'extensions/browser', name), path.join(output, 'browser', name));
}
await build({ entryPoints: [path.join(root, 'extensions/vscode/extension.mjs')], outfile: path.join(output, 'vscode/extension.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'], sourcemap: true });
for (const [input, name] of [['src/adapters/hook-cli.mjs', 'hook-cli.cjs'], ['src/bridge/native-host.mjs', 'native-host.cjs']]) {
  await build({ entryPoints: [path.join(root, input)], outfile: path.join(output, 'vscode', name), bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
}
await cp(path.join(root, 'extensions/vscode/package.json'), path.join(output, 'vscode/package.json'));
await cp(path.join(root, 'README.md'), path.join(output, 'vscode/README.md'));
await cp(path.join(root, 'LICENSE'), path.join(output, 'vscode/LICENSE'));
for (const name of ['CONTRIBUTING.md', 'SECURITY.md', 'docs']) {
  await cp(path.join(root, name), path.join(output, 'vscode', name), { recursive: true });
}
await cp(path.join(root, 'scripts/register-browser.ps1'), path.join(output, 'vscode/register-browser.ps1'));
await cp(path.join(root, 'scripts/unregister-browser.ps1'), path.join(output, 'vscode/unregister-browser.ps1'));
const browserManifest = JSON.parse(await readFile(path.join(output, 'browser/manifest.json'), 'utf8'));
await writeFile(path.join(output, 'BUILD.txt'), `wAIt ${browserManifest.version}\nBuilt ${new Date().toISOString()}\nLocal prototype; see README for validation boundaries.\n`);
console.log('Built dist/browser and dist/vscode.');
