import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextPaymentLookupPage,
  paymentLookupFilters,
  lookupPaymentPages,
} from '../lib/payment-lookup.js';

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

describe('paymentLookupFilters', () => {
  it('adds a digit fallback when the code has non-digits', () => {
    assert.deepEqual(paymentLookupFilters('PC99'), ['PC99', '99']);
  });

  it('does not duplicate an already-numeric code', () => {
    assert.deepEqual(paymentLookupFilters('12345'), ['12345']);
  });
});

describe('lookupPaymentPages', () => {
  it('paginates a digit filter past a full page 0 miss', async () => {
    const calls = [];
    const item = await lookupPaymentPages({
      filter: '99',
      pageSize: 50,
      maxPages: 5,
      fetchPage: async (filter, page) => {
        calls.push({ filter, page });
        if (page === 0) return { items: Array(50).fill({ Code: 'X' }) };
        return { items: [{ Code: 'PC99' }] };
      },
      findItem: (json) => (json.items || []).find((row) => row.Code === 'PC99') || null,
    });
    assert.deepEqual(calls, [
      { filter: '99', page: 0 },
      { filter: '99', page: 1 },
    ]);
    assert.equal(item && item.Code, 'PC99');
  });
});
