import path from 'node:path';

export function antigravityHookCommand(root, dataDir, event) {
  // Antigravity on Windows splits command strings on whitespace without
  // honoring quotes. Keep the entire JavaScript bootstrap in one argument.
  // The encoded text contains local paths and arguments only, never credentials.
  const script = path.join(root, 'dist/vscode/hook-cli.cjs');
  const args = ['node', script, '--connection-file', path.join(dataDir, 'connection.json'),
    '--provider', 'antigravity', '--event', event];
  const bootstrap = `process.argv=${JSON.stringify(args)};require(${JSON.stringify(script)});`;
  const encoded = Buffer.from(bootstrap).toString('base64');
  return `node -e eval(Buffer.from('${encoded}','base64').toString())`;
}
