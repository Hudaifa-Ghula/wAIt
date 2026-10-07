import { createHash } from 'node:crypto';

export function redact(text) {
  return String(text ?? '')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:gsk_|sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, '[REDACTED TOKEN]')
    .replace(/((?:api[_-]?key|secret|password|access[_-]?token|authorization)\s*[=:]\s*)[^\r\n]+/gi, '$1[REDACTED]');
}
export function sanitizeContext(input) {
  if (!input || typeof input.text !== 'string' || !input.text.trim()) throw new TypeError('Context text required');
  const source = ['task prompt', 'selected text', 'recent diff', 'task activity'].includes(input.source) ? input.source : 'selected text';
  const text = redact(input.text).slice(0, 7000);
  return { text, source, revision: createHash('sha256').update(source + text).digest('hex').slice(0, 20) };
}
