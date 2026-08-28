import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanLoadGuard } from '../lib/scan-load-guard.js';

describe('scanLoadGuard', () => {
  it('blocks while a tray is still loading even if old products remain', () => {
    assert.equal(scanLoadGuard({ isLoading: true, productCount: 40 }), 'loading');
  });

  it('blocks when no products and not loading', () => {
    assert.equal(scanLoadGuard({ isLoading: false, productCount: 0 }), 'empty');
  });

  it('allows scan when load settled with products', () => {
    assert.equal(scanLoadGuard({ isLoading: false, productCount: 10 }), null);
  });
});
