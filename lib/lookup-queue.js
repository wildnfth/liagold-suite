import { sanitizeKey } from './history-key.js';

export function lookupKey(code, time) {
  return sanitizeKey(String(code || '') + '_' + String(time || ''));
}

export function buildLookupEntry({ code, by, time } = {}) {
  return {
    code: String(code || ''),
    by: String(by || ''),
    time: String(time || ''),
    state: 'pending',
  };
}

export function pendingLookups(map) {
  if (!map || typeof map !== 'object') return [];
  const out = [];
  for (const [key, entry] of Object.entries(map)) {
    if (entry && entry.state === 'pending' && entry.code) {
      out.push({ key, ...entry });
    }
  }
  return out;
}
