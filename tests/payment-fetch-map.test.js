import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapPaymentFetches } from '../lib/payment-fetch-map.js';

describe('mapPaymentFetches', () => {
  it('does not pass array index as nonInvoice', () => {
    const calls = [];
    const fetchPayment = (code, nonInvoice) => {
      calls.push({ code, nonInvoice });
      return Promise.resolve(code);
    };

    mapPaymentFetches(['PC1', 'PC2', 'PC3'], fetchPayment, false);

    assert.deepEqual(calls, [
      { code: 'PC1', nonInvoice: false },
      { code: 'PC2', nonInvoice: false },
      { code: 'PC3', nonInvoice: false },
    ]);
  });

  it('forwards true for non-invoice lookups', () => {
    const flags = [];
    mapPaymentFetches(['PC9', 'PC8'], (code, nonInvoice) => flags.push(nonInvoice), true);
    assert.deepEqual(flags, [true, true]);
  });
});
