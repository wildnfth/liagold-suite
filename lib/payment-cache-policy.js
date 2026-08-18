export const PAYMENT_CACHE_TTL_MS = 30 * 60 * 1000;
export const TEMP_EMPTY_TTL_MS = 60 * 1000;

export function isPaymentCacheFresh(entry, now = Date.now(), ttlMs = PAYMENT_CACHE_TTL_MS) {
  if (!entry || !Number.isFinite(entry.t)) return false;
  return now - entry.t <= ttlMs;
}

export function isEmptyPayment(value) {
  if (!value) return true;
  const method = String(value.m ?? '').trim();
  const amount = Number(value.a) || 0;
  const methodEmpty = method === '' || method === '-';
  return methodEmpty && amount === 0;
}

export function classifyPaymentFetch({ networkError, itemFound, value }) {
  if (networkError) return 'none';
  if (!itemFound) return 'tempEmpty';
  if (isEmptyPayment(value)) return 'tempEmpty';
  return 'persist';
}
