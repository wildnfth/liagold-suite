export function parsePendingQueue(raw) {
  if (raw == null) return [];
  try {
    const val = JSON.parse(raw);
    if (!Array.isArray(val)) return [];
    return val.filter((x) => x && typeof x === 'object' && x.codeProduct);
  } catch (e) {
    return [];
  }
}
