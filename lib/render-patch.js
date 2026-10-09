export function planKeyedRemoval(prevKeys, nextKeys) {
  const prev = prevKeys || [];
  const next = nextKeys || [];
  if (next.length > prev.length) return null;
  const remove = [];
  let j = 0;
  for (let i = 0; i < prev.length; i++) {
    if (j < next.length && prev[i] === next[j]) j++;
    else remove.push(i);
  }
  return j === next.length ? remove : null;
}

export function planLogPrepend(prevSigs, nextSigs, maxPrepend) {
  const prev = prevSigs || [];
  const next = nextSigs || [];
  const max = maxPrepend == null ? 20 : Number(maxPrepend);
  for (let k = 0; k <= next.length && k <= max; k++) {
    const keep = next.length - k;
    if (keep > prev.length) continue;
    let ok = true;
    for (let i = 0; i < keep; i++) {
      if (next[k + i] !== prev[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { prepend: k, drop: prev.length - keep };
  }
  return null;
}
