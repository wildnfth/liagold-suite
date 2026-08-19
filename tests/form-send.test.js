import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterCodesForActiveTray } from '../lib/form-send.js';

describe('filterCodesForActiveTray', () => {
  const productByCode = new Map([
    ['aaa', { trayId: '1' }],
    ['bbb', { trayId: '2' }],
  ]);

  it('returns empty when tray is all or missing', () => {
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['AAA', 'BBB'],
      selectedTray: 'all',
      productByCode,
      scanByCode: new Map(),
    }), []);
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['AAA'],
      selectedTray: '',
      productByCode,
      scanByCode: new Map(),
    }), []);
  });

  it('keeps only codes on the selected tray', () => {
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['AAA', 'BBB', 'aaa'],
      selectedTray: '1',
      productByCode,
      scanByCode: new Map(),
    }), ['AAA', 'aaa']);
  });

  it('falls back to scan trayId when product is unknown', () => {
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['ZZZ'],
      selectedTray: '9',
      productByCode: new Map(),
      scanByCode: new Map([['zzz', { trayId: '9' }]]),
    }), ['ZZZ']);
  });

  it('drops unknown codes with no scan tray', () => {
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['NOPE'],
      selectedTray: '1',
      productByCode: new Map(),
      scanByCode: new Map(),
    }), []);
  });
});
