import { sanitizeKey } from './history-key.js';

export function productCatalogKey(codeProduct) {
  return sanitizeKey(String(codeProduct || '').toLowerCase());
}

export function buildCatalogPayload({ trays, selectedTray, selectedTrayCode, products, now } = {}) {
  const trayMap = {};
  for (const t of trays || []) {
    if (t == null || t.trayId == null) continue;
    trayMap[String(t.trayId)] = {
      trayId: t.trayId,
      trayCode: t.trayCode || '-',
      count: t.count || 0,
    };
  }
  const productMap = {};
  for (const p of products || []) {
    if (!p || !p.codeProduct) continue;
    productMap[productCatalogKey(p.codeProduct)] = {
      codeProduct: p.codeProduct,
      code: p.code || '',
      name: p.name || '',
      weight: p.weight || 0,
      image: p.image || '',
      trayId: p.trayId ?? null,
      trayCode: p.trayCode || '-',
      kadar: p.kadar || '',
      size: p.size || '',
      group: p.group || '',
    };
  }
  const iso = typeof now === 'string' ? now : new Date(now || Date.now()).toISOString();
  return {
    updatedAt: iso,
    selectedTray: selectedTray == null ? 'all' : String(selectedTray),
    selectedTrayCode: selectedTrayCode == null ? '' : String(selectedTrayCode),
    trays: trayMap,
    products: productMap,
  };
}

export function withHostAt(payload, now) {
  const iso = typeof now === 'string' ? now : new Date(now || Date.now()).toISOString();
  return { ...(payload || {}), hostAt: iso };
}

export function shouldApplyRemoteTray({ localTray, remoteTray } = {}) {
  if (remoteTray == null || remoteTray === '') return false;
  return String(localTray) !== String(remoteTray);
}

export function isCatalogHostAlive(hostAt, now = Date.now(), maxAgeMs = 45000) {
  const t = typeof hostAt === 'number' ? hostAt : new Date(hostAt).getTime();
  if (!Number.isFinite(t)) return false;
  const n = typeof now === 'number' ? now : new Date(now).getTime();
  if (!Number.isFinite(n)) return false;
  return (n - t) < maxAgeMs;
}

export function canAcceptScan({ hostAt, now, selectedTray, productCount } = {}) {
  if (!isCatalogHostAlive(hostAt, now)) return 'host-stale';
  if (selectedTray == null || selectedTray === '' || selectedTray === 'all') return 'no-tray';
  if (!productCount) return 'empty';
  return null;
}

export function productsMatchTray(products, selectedTray) {
  if (selectedTray == null || selectedTray === '' || selectedTray === 'all') return false;
  const list = products && typeof products === 'object' ? Object.values(products) : [];
  if (!list.length) return false;
  const tray = String(selectedTray);
  return list.every((p) => p && String(p.trayId) === tray);
}
