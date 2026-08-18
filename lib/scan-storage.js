export function parseArrayJson(raw, fallback) {
  if (raw == null) return fallback;
  try {
    const val = JSON.parse(raw);
    return Array.isArray(val) ? val : fallback;
  } catch (e) {
    return fallback;
  }
}

export function scannedCodesFromLog(scanLog) {
  const set = new Set();
  if (!Array.isArray(scanLog)) return [];
  for (const row of scanLog) {
    if (!row || row.status !== 'MASUK' || row.codeProduct == null || row.codeProduct === '') continue;
    set.add(String(row.codeProduct).toLowerCase());
  }
  return [...set];
}
