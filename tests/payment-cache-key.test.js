import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paymentCacheKey } from '../lib/payment-cache-key.js';

describe('paymentCacheKey', () => {
  it('scopes invoice and non-invoice separately', () => {
    assert.equal(paymentCacheKey('PC1', false), 'inv:PC1');
    assert.equal(paymentCacheKey('PC1', true), 'ni:PC1');
    assert.notEqual(paymentCacheKey('PC1', false), paymentCacheKey('PC1', true));
  });
});
