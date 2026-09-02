export function filterProductsByScan({ products, scanned, filter } = {}) {
  const list = products || [];
  const set = scanned instanceof Set ? scanned : new Set();
  if (filter === 'scanned') {
    return list.filter((p) => set.has(String(p && p.codeProduct).toLowerCase()));
  }
  if (filter === 'unscanned') {
    return list.filter((p) => !set.has(String(p && p.codeProduct).toLowerCase()));
  }
  return list;
}

export function scanFilterCounts({ products, scanned } = {}) {
  const list = products || [];
  const set = scanned instanceof Set ? scanned : new Set();
  let scannedCount = 0;
  for (const p of list) {
    if (set.has(String(p && p.codeProduct).toLowerCase())) scannedCount++;
  }
  return {
    all: list.length,
    scanned: scannedCount,
    unscanned: list.length - scannedCount,
  };
}
