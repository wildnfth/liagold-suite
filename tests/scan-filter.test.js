import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterProductsByScan, scanFilterCounts } from '../lib/scan-filter.js';

const products = [
  { codeProduct: 'Aaa', name: 'Cincin' },
  { codeProduct: 'Bbb', name: 'Kalung' },
  { codeProduct: 'Ccc', name: 'Giwang' },
];
const scanned = new Set(['aaa', 'ccc']);

describe('filterProductsByScan', () => {
  it('returns all, scanned, or unscanned products', () => {
    assert.deepEqual(filterProductsByScan({ products, scanned, filter: 'all' }).map((p) => p.codeProduct), ['Aaa', 'Bbb', 'Ccc']);
    assert.deepEqual(filterProductsByScan({ products, scanned, filter: 'scanned' }).map((p) => p.codeProduct), ['Aaa', 'Ccc']);
    assert.deepEqual(filterProductsByScan({ products, scanned, filter: 'unscanned' }).map((p) => p.codeProduct), ['Bbb']);
  });

  it('treats CodeProduct the same as codeProduct', () => {
    const rows = [{ CodeProduct: 'Aaa' }, { CodeProduct: 'Bbb' }];
    assert.deepEqual(
      filterProductsByScan({ products: rows, scanned, filter: 'scanned' }).map((p) => p.CodeProduct),
      ['Aaa'],
    );
  });
});

describe('scanFilterCounts', () => {
  it('counts all, scanned, and remaining', () => {
    assert.deepEqual(scanFilterCounts({ products, scanned }), { all: 3, scanned: 2, unscanned: 1 });
    assert.deepEqual(scanFilterCounts({ products: [], scanned: new Set() }), { all: 0, scanned: 0, unscanned: 0 });
  });
});
