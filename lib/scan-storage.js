import { generateHistoryKey } from './history-key.js';

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

export function mergeInflightScanLog(cloudEntries, localLog, cloudHistory) {
  const keys = new Set(Object.keys(cloudHistory || {}));
  const extra = [];
  const seen = new Set();
  for (const row of localLog || []) {
    if (!row || !row.codeProduct) continue;
    const key = generateHistoryKey(row.codeProduct, row.timeIso || '');
    if (keys.has(key) || seen.has(key)) continue;
    seen.add(key);
    extra.push(row);
  }
  const merged = (cloudEntries || []).concat(extra);
  merged.sort((a, b) => String(b.timeIso || '').localeCompare(String(a.timeIso || '')));
  return merged;
}
