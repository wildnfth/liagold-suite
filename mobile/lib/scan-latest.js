export function pickLatestScan(history) {
  let best = null;
  for (const v of Object.values(history || {})) {
    if (!v || !v.codeProduct) continue;
    if (!best || String(v.time || '') > String(best.time || '')) best = v;
  }
  return best;
}
