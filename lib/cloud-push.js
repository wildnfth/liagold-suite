export function shouldWriteLastScanAt(lastWriteMs, nowMs, minGapMs) {
  const gap = minGapMs == null ? 60000 : Number(minGapMs);
  const last = Number(lastWriteMs) || 0;
  if (!last) return true;
  return Number(nowMs) - last >= gap;
}

export function unsentPushEntries(queue, sessionId) {
  const out = [];
  for (const job of queue || []) {
    if (!job || !job.entry || !job.entry.codeProduct) continue;
    if (job.sid !== sessionId) continue;
    out.push(job.entry);
  }
  return out;
}
