import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scanProgress,
  scanStatCards,
  filterHistoryByStatus,
  nextStatusFilter,
} from '../lib/scan-stats.js';

const products = [
  { codeProduct: 'Aaa' },
  { codeProduct: 'Bbb' },
  { codeProduct: 'Ccc' },
];
const scanned = new Set(['aaa', 'ccc']);
const history = [
  { status: 'MASUK', codeProduct: 'Aaa', time: '2' },
  { status: 'MASUK', codeProduct: 'Ccc', time: '3' },
  { status: 'SUDAH DISCAN', codeProduct: 'Aaa', time: '4' },
  { status: 'SALAH BAKI', codeProduct: 'Xxx', time: '1' },
];

describe('scanProgress', () => {
  it('counts in-stock, MASUK progress, and remaining', () => {
    assert.deepEqual(scanProgress({ products, scanned }), {
      total: 3,
      progress: 2,
      sisa: 1,
      pct: 67,
    });
  });
});

describe('scanStatCards', () => {
  it('uses the same labels as the laptop stats grid', () => {
    const cards = scanStatCards({ products, scanned, history });
    assert.deepEqual(cards.map((c) => [c.label, c.value, c.filter]), [
      ['Data In-Stock', 3, ''],
      ['Total Scan', 4, ''],
      ['✅ Masuk', 2, 'MASUK'],
      ['⚠️ Sudah Discan', 1, 'SUDAH DISCAN'],
      ['🟠 Salah Baki', 1, 'SALAH BAKI'],
      ['🟣 Terjual / Rusak', 0, 'TERJUAL / RUSAK'],
      ['🔴 Barcode Tidak Ada', 0, 'BARCODE TIDAK ADA'],
      ['📊 Progress', '2/3 (67%)', ''],
      ['⏳ Sisa', 1, ''],
    ]);
  });
});

describe('filterHistoryByStatus', () => {
  it('keeps only rows with that status, newest first', () => {
    assert.deepEqual(
      filterHistoryByStatus(history, 'MASUK').map((r) => r.codeProduct),
      ['Ccc', 'Aaa'],
    );
  });
});

describe('nextStatusFilter', () => {
  it('toggles the same card off, otherwise selects it', () => {
    assert.equal(nextStatusFilter('none', 'MASUK'), 'MASUK');
    assert.equal(nextStatusFilter('MASUK', 'MASUK'), 'none');
    assert.equal(nextStatusFilter('MASUK', 'SALAH BAKI'), 'SALAH BAKI');
  });
});
