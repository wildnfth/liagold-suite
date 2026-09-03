export function shouldPauseCameraCode({
  code,
  lockedCode,
  now,
  resumeMs = 3000,
  resumedAt,
} = {}) {
  const c = String(code || '').trim();
  if (!c) return { accept: false };
  const n = Number(now);
  if (!Number.isFinite(n)) return { accept: true };
  const locked = lockedCode == null || lockedCode === '' ? null : String(lockedCode);
  if (locked == null) return { accept: true };
  if (c !== locked) return { accept: true, clearLock: true };
  if (resumedAt == null) return { accept: false };
  const until = Number(resumedAt);
  if (Number.isFinite(until) && n < until) return { accept: false };
  return { accept: true };
}

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
