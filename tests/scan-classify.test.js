import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFoundScan, classifySoldScan } from '../lib/scan-classify.js';

describe('classifyFoundScan', () => {
  const found = { codeProduct: 'Aaa', trayId: '14', name: 'Cincin' };

  it('asks for a sold lookup when the code is not on the loaded tray map', () => {
    assert.equal(classifyFoundScan({
      found: undefined,
      scanned: new Set(),
      pending: new Set(),
      selectedTray: '14',
    }).kind, 'lookup-sold');
  });

  it('marks already-scanned codes including in-flight pending', () => {
    assert.equal(classifyFoundScan({
      found,
      scanned: new Set(['aaa']),
      pending: new Set(),
      selectedTray: '14',
    }).kind, 'sudah');
    assert.equal(classifyFoundScan({
      found,
      scanned: new Set(),
      pending: new Set(['aaa']),
      selectedTray: '14',
    }).kind, 'sudah');
  });

  it('flags a product that belongs to another tray', () => {
    assert.equal(classifyFoundScan({
      found,
      scanned: new Set(),
      pending: new Set(),
      selectedTray: '8',
    }).kind, 'salah-baki');
  });

  it('accepts a new product on the selected tray', () => {
    assert.equal(classifyFoundScan({
      found,
      scanned: new Set(),
      pending: new Set(),
      selectedTray: '14',
    }).kind, 'masuk');
  });
});

describe('classifySoldScan', () => {
  it('treats missing API hits as barcode-not-found', () => {
    assert.equal(classifySoldScan(null).kind, 'tidak-ada');
  });

  it('treats in-stock unknown-tray hits as salah baki', () => {
    assert.equal(classifySoldScan({ stockQty: 1, codeProduct: 'A' }).kind, 'salah-baki-sold');
  });

  it('treats zero stock as terjual/rusak', () => {
    assert.equal(classifySoldScan({ stockQty: 0, codeProduct: 'A' }).kind, 'terjual');
  });
});
