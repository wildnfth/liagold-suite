import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPaymentInjectPage, isPurchasingNonInvoicePage } from '../lib/payment-page.js';

describe('isPaymentInjectPage', () => {
  it('allows exact purchasing and non-invoice paths', () => {
    assert.equal(isPaymentInjectPage('/purchasing'), true);
    assert.equal(isPaymentInjectPage('/purchasing/'), true);
    assert.equal(isPaymentInjectPage('/purchasing-non-invoice'), true);
    assert.equal(isPaymentInjectPage('/purchasing-non-invoice/'), true);
  });

  it('rejects child routes', () => {
    assert.equal(isPaymentInjectPage('/purchasing/123'), false);
    assert.equal(isPaymentInjectPage('/purchasing/create'), false);
    assert.equal(isPaymentInjectPage('/purchasing-non-invoice/create'), false);
    assert.equal(isPaymentInjectPage('/purchasing-non-invoice/abc'), false);
  });

  it('rejects other pages and prefix lookalikes', () => {
    assert.equal(isPaymentInjectPage('/sales'), false);
    assert.equal(isPaymentInjectPage('/purchasing-head'), false);
    assert.equal(isPaymentInjectPage('/purchasing-non-invoice-archive'), false);
    assert.equal(isPaymentInjectPage('/'), false);
  });
});

describe('isPurchasingNonInvoicePage', () => {
  it('is true only on the exact non-invoice list path', () => {
    assert.equal(isPurchasingNonInvoicePage('/purchasing-non-invoice'), true);
    assert.equal(isPurchasingNonInvoicePage('/purchasing-non-invoice/'), true);
    assert.equal(isPurchasingNonInvoicePage('/purchasing-non-invoice/create'), false);
    assert.equal(isPurchasingNonInvoicePage('/purchasing'), false);
  });
});
