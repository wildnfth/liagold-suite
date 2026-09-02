import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  productCatalogKey,
  buildCatalogPayload,
  withHostAt,
  shouldApplyRemoteTray,
  isCatalogHostAlive,
  canAcceptScan,
  productsMatchTray,
} from '../lib/catalog-sync.js';

describe('productCatalogKey', () => {
  it('lowercases and sanitizes Firebase-illegal chars', () => {
    assert.equal(productCatalogKey('Ab/C'), 'ab_c');
  });
});

describe('buildCatalogPayload', () => {
  it('maps trays and products and records selected tray', () => {
    const now = '2026-09-02T00:00:00.000Z';
    const out = buildCatalogPayload({
      trays: [{ trayId: 14, trayCode: 'B14', count: 2 }],
      selectedTray: 14,
      selectedTrayCode: 'B14',
      products: [{
        codeProduct: 'Aaa',
        code: '1',
        name: 'Cincin',
        weight: 1.2,
        image: 'x.png',
        trayId: 14,
        trayCode: 'B14',
        kadar: '375',
        size: '6',
        group: 'CN',
      }],
      now,
    });
    assert.equal(out.updatedAt, now);
    assert.equal(out.selectedTray, '14');
    assert.equal(out.selectedTrayCode, 'B14');
    assert.deepEqual(out.trays['14'], { trayId: 14, trayCode: 'B14', count: 2 });
    assert.equal(out.products.aaa.codeProduct, 'Aaa');
    assert.equal(out.products.aaa.trayId, 14);
    assert.equal('hostAt' in out, false);
  });
});

describe('withHostAt', () => {
  it('adds hostAt without dropping payload fields', () => {
    const payload = { selectedTray: '14' };
    assert.deepEqual(withHostAt(payload, 't1'), { selectedTray: '14', hostAt: 't1' });
  });
});

describe('shouldApplyRemoteTray', () => {
  it('applies only when remote is non-empty and different', () => {
    assert.equal(shouldApplyRemoteTray({ localTray: '14', remoteTray: '14' }), false);
    assert.equal(shouldApplyRemoteTray({ localTray: '14', remoteTray: '8' }), true);
    assert.equal(shouldApplyRemoteTray({ localTray: '14', remoteTray: '' }), false);
    assert.equal(shouldApplyRemoteTray({ localTray: '14', remoteTray: null }), false);
  });
});

describe('isCatalogHostAlive', () => {
  it('is alive just under 45s and dead just over 45s', () => {
    const hostAt = 1_000_000;
    assert.equal(isCatalogHostAlive(hostAt, hostAt + 44_900), true);
    assert.equal(isCatalogHostAlive(hostAt, hostAt + 45_100), false);
    assert.equal(isCatalogHostAlive(null, hostAt), false);
  });
});

describe('canAcceptScan', () => {
  const now = 1_000_000;
  const hostAt = now - 1000;
  it('blocks stale host, all-tray, and empty catalog', () => {
    assert.equal(canAcceptScan({ hostAt: now - 46_000, now, selectedTray: '14', productCount: 1 }), 'host-stale');
    assert.equal(canAcceptScan({ hostAt, now, selectedTray: 'all', productCount: 1 }), 'no-tray');
    assert.equal(canAcceptScan({ hostAt, now, selectedTray: '14', productCount: 0 }), 'empty');
    assert.equal(canAcceptScan({ hostAt, now, selectedTray: '14', productCount: 3 }), null);
  });
});

describe('productsMatchTray', () => {
  it('requires every product to belong to the selected tray', () => {
    assert.equal(productsMatchTray({ a: { trayId: 14 } }, '14'), true);
    assert.equal(productsMatchTray({ a: { trayId: 14 }, b: { trayId: 8 } }, '14'), false);
    assert.equal(productsMatchTray({}, '14'), false);
    assert.equal(productsMatchTray({ a: { trayId: 14 } }, 'all'), false);
  });
});
