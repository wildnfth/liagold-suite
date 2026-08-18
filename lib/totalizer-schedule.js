export function nextProcessDelay(now, lastProcessTime, minGapMs) {
  if (!lastProcessTime) return 0;
  const elapsed = now - lastProcessTime;
  if (elapsed >= minGapMs) return 0;
  return minGapMs - elapsed;
}
