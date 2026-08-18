export const MAX_FORM_CODE_ATTEMPTS = 3;

export function recordFormAttempt(attempts, code, success, maxAttempts = MAX_FORM_CODE_ATTEMPTS) {
  const lc = String(code || '').toLowerCase();
  if (success) {
    attempts.delete(lc);
    return { markFilled: true, retry: false, giveUp: false };
  }
  const n = (attempts.get(lc) || 0) + 1;
  attempts.set(lc, n);
  if (n >= maxAttempts) {
    return { markFilled: false, retry: false, giveUp: true };
  }
  return { markFilled: false, retry: true, giveUp: false };
}
