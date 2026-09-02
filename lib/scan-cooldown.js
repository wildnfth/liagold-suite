export function shouldAcceptDetectedCode({
  code,
  lastCode,
  lastAt,
  now,
  cooldownMs = 2000,
} = {}) {
  const c = String(code || '').trim();
  if (!c) return false;
  if (lastCode == null || lastCode === '') return true;
  if (String(lastCode) !== c) return true;
  const last = Number(lastAt);
  const n = Number(now);
  if (!Number.isFinite(last) || !Number.isFinite(n)) return true;
  return (n - last) >= cooldownMs;
}
