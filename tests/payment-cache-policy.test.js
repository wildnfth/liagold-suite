import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_CACHE_TTL_MS,
  isPaymentCacheFresh,
  isEmptyPayment,
  classifyPaymentFetch,
} from '../lib/payment-cache-policy.js';

const NOW = Date.parse('2026-08-18T12:00:00.000Z');

describe('isPaymentCacheFresh', () => {
  it('is false without a timestamp', () => {
    assert.equal(isPaymentCacheFresh(null, NOW), false);
    assert.equal(isPaymentCacheFresh({}, NOW), false);
    assert.equal(isPaymentCacheFresh({ t: 'nope' }, NOW), false);
  });

  it('is true inside TTL and false after', () => {
    assert.equal(isPaymentCacheFresh({ t: NOW - 1000 }, NOW), true);
    assert.equal(isPaymentCacheFresh({ t: NOW - PAYMENT_CACHE_TTL_MS - 1 }, NOW), false);
  });
});

describe('isEmptyPayment', () => {
  it('treats missing, dash, and blank method with zero amount as empty', () => {
    assert.equal(isEmptyPayment(null), true);
    assert.equal(isEmptyPayment({ m: '-', a: 0 }), true);
    assert.equal(isEmptyPayment({ m: '', a: 0 }), true);
    assert.equal(isEmptyPayment({ m: '  ', a: 0 }), true);
  });

  it('keeps a named method or a non-zero amount', () => {
    assert.equal(isEmptyPayment({ m: 'Cash', a: 0 }), false);
    assert.equal(isEmptyPayment({ m: '-', a: 15000 }), false);
  });
});

describe('classifyPaymentFetch', () => {
  it('does not cache network errors', () => {
    assert.equal(classifyPaymentFetch({ networkError: true, itemFound: false, value: null }), 'none');
  });

  it('temp-empties real misses and empty successes', () => {
    assert.equal(classifyPaymentFetch({ networkError: false, itemFound: false, value: null }), 'tempEmpty');
    assert.equal(
      classifyPaymentFetch({ networkError: false, itemFound: true, value: { m: '-', a: 0 } }),
      'tempEmpty'
    );
  });

  it('persists a real method', () => {
    assert.equal(
      classifyPaymentFetch({ networkError: false, itemFound: true, value: { m: 'Transfer BCA', a: 0 } }),
      'persist'
    );
  });
});
