import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelectionKey } from '../lib/totalizer-selection.js';

describe('buildSelectionKey', () => {
  it('prefers code over id', () => {
    const a = buildSelectionKey({ rowCode: 'PC1', rowId: '9', colClass: 'mat-column-totalReal', val: '1000', grp: 'T' });
    const b = buildSelectionKey({ rowCode: 'PC2', rowId: '9', colClass: 'mat-column-totalReal', val: '1000', grp: 'T' });
    assert.notEqual(a, b);
    assert.match(a, /^PC1\|\|/);
  });

  it('falls back to id when code is empty', () => {
    const k = buildSelectionKey({ rowCode: '', rowId: '42', colClass: 'c', val: '1', grp: 'X' });
    assert.equal(k, '42||c||1||X');
  });
});
