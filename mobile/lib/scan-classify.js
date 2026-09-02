export function classifyFoundScan({ found, scanned, pending, selectedTray } = {}) {
  if (!found) return { kind: 'lookup-sold' };
  const cpL = String(found.codeProduct).toLowerCase();
  if ((scanned && scanned.has(cpL)) || (pending && pending.has(cpL))) {
    return { kind: 'sudah', found, cpL };
  }
  if (String(found.trayId) !== selectedTray) return { kind: 'salah-baki', found, cpL };
  return { kind: 'masuk', found, cpL };
}

export function classifySoldScan(soldItem) {
  if (!soldItem) return { kind: 'tidak-ada' };
  if (soldItem.stockQty > 0) return { kind: 'salah-baki-sold', soldItem };
  return { kind: 'terjual', soldItem };
}
