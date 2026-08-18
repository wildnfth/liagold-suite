import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPaymentInjectPage,
  isPurchasingNonInvoicePage,
  isPurchasingFamilyChild,
} from '../lib/payment-page.js';

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

describe('isPurchasingFamilyChild', () => {
  it('is false on the two list pages', () => {
    assert.equal(isPurchasingFamilyChild('/purchasing'), false);
    assert.equal(isPurchasingFamilyChild('/purchasing/'), false);
    assert.equal(isPurchasingFamilyChild('/purchasing-non-invoice'), false);
    assert.equal(isPurchasingFamilyChild('/purchasing-non-invoice/'), false);
  });

  it('is true on purchasing and non-invoice children', () => {
    assert.equal(isPurchasingFamilyChild('/purchasing/123'), true);
    assert.equal(isPurchasingFamilyChild('/purchasing/create'), true);
    assert.equal(isPurchasingFamilyChild('/purchasing-non-invoice/create'), true);
    assert.equal(isPurchasingFamilyChild('/purchasing-non-invoice/abc/edit'), true);
  });

  it('is false on unrelated pages', () => {
    assert.equal(isPurchasingFamilyChild('/sales'), false);
    assert.equal(isPurchasingFamilyChild('/purchasing-head'), false);
    assert.equal(isPurchasingFamilyChild('/'), false);
  });
});
