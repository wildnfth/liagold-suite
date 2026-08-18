import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextPaymentLookupPage } from '../lib/payment-lookup.js';

describe('nextPaymentLookupPage', () => {
  it('stops when found', () => {
    assert.equal(nextPaymentLookupPage({ found: true, pageNumber: 0, itemCount: 50, pageSize: 50, maxPages: 5 }), null);
  });

  it('stops on a short page', () => {
    assert.equal(nextPaymentLookupPage({ found: false, pageNumber: 0, itemCount: 10, pageSize: 50, maxPages: 5 }), null);
  });

  it('advances when the page is full', () => {
    assert.equal(nextPaymentLookupPage({ found: false, pageNumber: 0, itemCount: 20, pageSize: 20, maxPages: 5 }), 1);
  });

  it('stops at maxPages', () => {
    assert.equal(nextPaymentLookupPage({ found: false, pageNumber: 4, itemCount: 20, pageSize: 20, maxPages: 5 }), null);
  });
});
