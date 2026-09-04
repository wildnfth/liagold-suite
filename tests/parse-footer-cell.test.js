import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFooterRaw, isVisibleRow } from '../lib/parse-footer-cell.js';

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
