export function sanitizeKey(str) {
  return String(str).replace(/[.#$\[\]/]/g, '_');
}

export function generateHistoryKey(codeProduct, timestamp) {
  const cp = String(codeProduct || '').toLowerCase();
  const ts = String(timestamp || '');
  return sanitizeKey(cp + '_' + ts);
}
