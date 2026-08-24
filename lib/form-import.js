export function parseSesuaiFormCode(raw) {
  const s = String(raw || '').trim().replace(/,\s*$/, '').trim();
  if (!s) return null;
  const weighed = s.match(/^([A-Za-z0-9]+)-[\d.]+gr$/i);
  if (weighed) return weighed[1];
  if (/^[A-Za-z0-9]+$/.test(s)) return s;
  return null;
}

export function collectSesuaiFormCodes(raws) {
  const out = [];
  const seen = new Set();
  for (const raw of raws || []) {
    const code = parseSesuaiFormCode(raw);
    if (!code) continue;
    const lc = code.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(code);
  }
  return out;
}

export function planFormImport({ formCodes, scannedSet, productByCode, selectedTray } = {}) {
  const already = [];
  const toImport = [];
  const unknown = [];
  const tray = selectedTray == null ? '' : String(selectedTray);
  for (const code of formCodes || []) {
    const lc = String(code).toLowerCase();
    if (scannedSet && scannedSet.has(lc)) {
      already.push(code);
      continue;
    }
    const product = productByCode && productByCode.get(lc);
    if (!product || String(product.trayId) !== tray) {
      unknown.push(code);
      continue;
    }
    toImport.push(code);
  }
  return { already, toImport, unknown };
}
