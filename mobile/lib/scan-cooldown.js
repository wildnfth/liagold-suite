export function normalizeScanCode(code) {
  return String(code || '').trim().toLowerCase();
}

export function shouldPauseCameraCode({
  code,
  lockedCode,
  now,
  resumeMs = 3000,
  resumedAt,
} = {}) {
  const c = normalizeScanCode(code);
  if (!c) return { accept: false };
  const n = Number(now);
  if (!Number.isFinite(n)) return { accept: true };
  const locked = lockedCode == null || lockedCode === '' ? null : normalizeScanCode(lockedCode);
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
  lastEmitAt,
  now,
  goneMs = 2500,
  emitGapMs = 2500,
} = {}) {
  const raw = [];
  for (const v of Array.isArray(values) ? values : []) {
    const s = String(v || '').trim();
    if (s) raw.push(s);
  }
  const norms = raw.map((s) => s.toLowerCase());
  const n = Number(now);
  const gone = Number(goneMs) || 2500;
  const gap = Number(emitGapMs) || 2500;
  const locked = lockedCode == null || lockedCode === '' ? '' : normalizeScanCode(lockedCode);
  const emitAt = Number(lastEmitAt);
  const inGap = Number.isFinite(emitAt) && Number.isFinite(n) && (n - emitAt) < gap;

  if (locked) {
    const idx = norms.indexOf(locked);
    if (idx >= 0) {
      return {
        accept: false,
        code: null,
        lockedCode: locked,
        lastSeenAt: n,
        lastEmitAt: Number.isFinite(emitAt) ? emitAt : null,
      };
    }
    const seen = Number(lastSeenAt);
    if (Number.isFinite(seen) && Number.isFinite(n) && (n - seen) < gone) {
      return {
        accept: false,
        code: null,
        lockedCode: locked,
        lastSeenAt: seen,
        lastEmitAt: Number.isFinite(emitAt) ? emitAt : null,
      };
    }
  }

  if (!raw.length) {
    return {
      accept: false,
      code: null,
      lockedCode: null,
      lastSeenAt: null,
      lastEmitAt: Number.isFinite(emitAt) ? emitAt : null,
    };
  }

  if (inGap) {
    return {
      accept: false,
      code: null,
      lockedCode: locked || norms[0],
      lastSeenAt: n,
      lastEmitAt: emitAt,
    };
  }

  const next = raw[0];
  return {
    accept: true,
    code: next,
    lockedCode: norms[0],
    lastSeenAt: n,
    lastEmitAt: n,
  };
}

export function shouldAcceptDetectedCode({
  code,
  lastCode,
  lastAt,
  now,
  cooldownMs = 2000,
} = {}) {
  const c = normalizeScanCode(code);
  if (!c) return false;
  if (lastCode == null || lastCode === '') return true;
  if (normalizeScanCode(lastCode) !== c) return true;
  const last = Number(lastAt);
  const n = Number(now);
  if (!Number.isFinite(last) || !Number.isFinite(n)) return true;
  return (n - last) >= cooldownMs;
}
