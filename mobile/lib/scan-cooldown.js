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

export function advanceCameraHold({
  values,
  lockedCode,
  lastSeenAt,
  now,
  goneMs = 500,
} = {}) {
  const list = [];
  for (const v of Array.isArray(values) ? values : []) {
    const s = String(v || '').trim();
    if (s) list.push(s);
  }
  const n = Number(now);
  const gone = Number(goneMs) || 500;
  const locked = lockedCode == null || lockedCode === '' ? '' : String(lockedCode);

  if (locked) {
    if (list.includes(locked)) {
      return { accept: false, code: null, lockedCode: locked, lastSeenAt: n };
    }
    const seen = Number(lastSeenAt);
    if (Number.isFinite(seen) && Number.isFinite(n) && (n - seen) < gone) {
      return { accept: false, code: null, lockedCode: locked, lastSeenAt: seen };
    }
    if (!list.length) {
      return { accept: false, code: null, lockedCode: null, lastSeenAt: null };
    }
    const next = list[0];
    return { accept: true, code: next, lockedCode: next, lastSeenAt: n };
  }

  if (!list.length) {
    return { accept: false, code: null, lockedCode: null, lastSeenAt: null };
  }
  const next = list[0];
  return { accept: true, code: next, lockedCode: next, lastSeenAt: n };
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
