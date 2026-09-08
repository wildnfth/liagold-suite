import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFooterRaw, isVisibleRow, getVisibleRows } from '../lib/parse-footer-cell.js';

describe('parseFooterRaw', () => {
  it('reads visible id-ID text, not a pre-stripped integer', () => {
    assert.equal(parseFooterRaw('12,50 gr'), 12.5);
    assert.equal(parseFooterRaw('1.500.000'), 1500000);
  });

  it('does not have a data-val parameter', () => {
    assert.equal(parseFooterRaw.length, 1);
  });
});

describe('isVisibleRow', () => {
  it('rejects display:none rows so footers skip them', () => {
    assert.equal(isVisibleRow({ offsetParent: null }), false);
    assert.equal(isVisibleRow({ offsetParent: {} }), true);
  });
});

describe('getVisibleRows', () => {
  it('keeps only tbody mat-rows with offsetParent so Module 2 can fill TOTAL', () => {
    const visible = { offsetParent: {} };
    const hidden = { offsetParent: null };
    const table = {
      querySelectorAll(selector) {
        assert.equal(selector, 'tbody tr.mat-row');
        return [hidden, visible, hidden];
      },
    };
    assert.deepEqual(getVisibleRows(table), [visible]);
  });
});

describe('Module 2 footer', () => {
  it('calls LG.getVisibleRows so non-invoice TOTAL is not left empty', () => {
    const src = readFileSync(new URL('../liagold-suite.user.js', import.meta.url), 'utf8');
    const start = src.indexOf('MODULE 2: Gold ERP - Total Bawah Tabel');
    const end = src.indexOf('MODULE 2b:');
    assert.ok(start !== -1 && end > start);
    const mod2 = src.slice(start, end);
    assert.match(mod2, /const rows = LG\.getVisibleRows\(table\);/);
  });
});
