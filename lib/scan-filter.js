export function productScanCode(product) {
  if (!product || typeof product !== 'object') return '';
  return String(product.codeProduct || product.CodeProduct || product.code || '').toLowerCase();
}

export function filterProductsByScan({ products, scanned, filter } = {}) {
  const list = products || [];
  const set = scanned instanceof Set ? scanned : new Set();
  if (filter === 'scanned') {
    return list.filter((p) => set.has(productScanCode(p)));
  }
  if (filter === 'unscanned') {
    return list.filter((p) => {
      const code = productScanCode(p);
      return code && !set.has(code);
    });
  }
  return list;
}

export function scanFilterCounts({ products, scanned } = {}) {
  const list = products || [];
  const set = scanned instanceof Set ? scanned : new Set();
  let scannedCount = 0;
  for (const p of list) {
    if (set.has(productScanCode(p))) scannedCount++;
  }
  return {
    all: list.length,
    scanned: scannedCount,
    unscanned: list.length - scannedCount,
  };
}

export function catalogProductList(products) {
  if (!products || typeof products !== 'object') return [];
  if (Array.isArray(products)) return products.filter(Boolean);
  const out = [];
  for (const [key, p] of Object.entries(products)) {
    if (!p || typeof p !== 'object') continue;
    const codeProduct = p.codeProduct || p.CodeProduct || key;
    out.push({ ...p, codeProduct });
  }
  return out;
}
