import { productScanCode } from './scan-filter.js';

export const SCAN_STAT_FILTERS = [
  'MASUK',
  'SUDAH DISCAN',
  'SALAH BAKI',
  'TERJUAL / RUSAK',
  'BARCODE TIDAK ADA',
];

export function historyRows(history) {
  const list = Array.isArray(history)
    ? history
    : Object.values(history && typeof history === 'object' ? history : {});
  return list.filter((row) => row && row.status);
}

export function scanProgress({ products, scanned } = {}) {
  const list = products || [];
  const set = scanned instanceof Set ? scanned : new Set();
  let progress = 0;
  for (const p of list) {
    if (set.has(productScanCode(p))) progress++;
  }
  const total = list.length;
  const sisa = total - progress;
  return {
    total,
    progress,
    sisa: sisa < 0 ? 0 : sisa,
    pct: total ? Math.round((progress / total) * 100) : 0,
  };
}

export function scanStatCards({ products, scanned, history } = {}) {
  const { total, progress, sisa, pct } = scanProgress({ products, scanned });
  const rows = historyRows(history);
  const cnt = (status) => {
    let n = 0;
    for (const row of rows) {
      if (row.status === status) n++;
    }
    return n;
  };
  return [
    { key: 'instock', label: 'Data In-Stock', value: total, color: '#1e293b', filter: '' },
    { key: 'scans', label: 'Total Scan', value: rows.length, color: '#1e293b', filter: '' },
    { key: 'masuk', label: '✅ Masuk', value: cnt('MASUK'), color: '#16a34a', filter: 'MASUK' },
    { key: 'sudah', label: '⚠️ Sudah Discan', value: cnt('SUDAH DISCAN'), color: '#d97706', filter: 'SUDAH DISCAN' },
    { key: 'salah', label: '🟠 Salah Baki', value: cnt('SALAH BAKI'), color: '#ea580c', filter: 'SALAH BAKI' },
    { key: 'terjual', label: '🟣 Terjual / Rusak', value: cnt('TERJUAL / RUSAK'), color: '#7c3aed', filter: 'TERJUAL / RUSAK' },
    { key: 'tidakada', label: '🔴 Barcode Tidak Ada', value: cnt('BARCODE TIDAK ADA'), color: '#dc2626', filter: 'BARCODE TIDAK ADA' },
    { key: 'progress', label: '📊 Progress', value: `${progress}/${total} (${pct}%)`, color: '#2563eb', filter: '' },
    { key: 'sisa', label: '⏳ Sisa', value: sisa, color: '#64748b', filter: '' },
  ];
}

export function filterHistoryByStatus(history, status) {
  const rows = historyRows(history);
  if (!status || status === 'none') return rows;
  return rows
    .filter((row) => row.status === status)
    .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));
}

export function nextStatusFilter(current, clicked) {
  if (!clicked) return current || 'none';
  return current === clicked ? 'none' : clicked;
}
