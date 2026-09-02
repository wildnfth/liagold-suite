export const DATA_TTL_MS = 12 * 60 * 60 * 1000;

export function parseTimestamp(value) {
  if (value == null || value === '') return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export function getRemainingTime(lastScanAt, now = Date.now(), ttlMs = DATA_TTL_MS) {
  const t = parseTimestamp(lastScanAt);
  if (t == null) return null;
  return Math.max(0, t + ttlMs - now);
}

export function isDataExpired(lastScanAt, now = Date.now(), ttlMs = DATA_TTL_MS) {
  const remaining = getRemainingTime(lastScanAt, now, ttlMs);
  if (remaining == null) return false;
  return remaining <= 0;
}

export function shouldRejectExpiredJoin(lastScanAt, now = Date.now(), ttlMs = DATA_TTL_MS) {
  return isDataExpired(lastScanAt, now, ttlMs);
}
