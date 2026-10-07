import path from 'node:path';

// A mounted project may appear anywhere in Antigravity's workspace list.
export function matchesProject(raw, projectRoot) {
  if (!projectRoot) return true;
  const canonical = value => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const candidates = [raw.cwd, ...(Array.isArray(raw.workspacePaths) ? raw.workspacePaths : []), raw.context?.workspace?.root];
  return candidates.some(value => typeof value === 'string' && value.length > 0
    && canonical(value) === canonical(projectRoot));
}
