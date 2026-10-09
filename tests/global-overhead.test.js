import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PDF_LIB_URLS, shouldPreloadPdfLibs } from '../lib/invoice-overlay.js';
import { aggregateSalesPayments, slimSalesItem } from '../lib/sales-payment-totals.js';
import { aggregatePurchasingPayments, slimPurchasingItem } from '../lib/purchasing-payment-totals.js';

const src = readFileSync(new URL('../liagold-suite.user.js', import.meta.url), 'utf8');

describe('shouldPreloadPdfLibs', () => {
  it('preloads only on sales pages, where Cetak Invoice Lama lives', () => {
    assert.equal(shouldPreloadPdfLibs('/sales'), true);
    assert.equal(shouldPreloadPdfLibs('/sales/'), true);
    assert.equal(shouldPreloadPdfLibs('/sales/123'), true);
    assert.equal(shouldPreloadPdfLibs('/sales-cancel'), false);
    assert.equal(shouldPreloadPdfLibs('/stock-opname/create'), false);
    assert.equal(shouldPreloadPdfLibs('/product'), false);
    assert.equal(shouldPreloadPdfLibs(null), false);
  });
});

describe('pdf libs load on demand', () => {
  it('lists pdf-lib, pdf.js and its worker in load order', () => {
    assert.equal(PDF_LIB_URLS.length, 3);
    assert.match(PDF_LIB_URLS[0], /pdf-lib@1\.17\.1\/dist\/pdf-lib\.min\.js$/);
    assert.match(PDF_LIB_URLS[1], /pdfjs-dist@3\.11\.174\/legacy\/build\/pdf\.min\.js$/);
    assert.match(PDF_LIB_URLS[2], /pdfjs-dist@3\.11\.174\/legacy\/build\/pdf\.worker\.min\.js$/);
  });

  it('no longer @requires them on every page', () => {
    const header = src.slice(0, src.indexOf('==/UserScript=='));
    assert.doesNotMatch(header, /@require/);
  });

  it('mirrors the same urls into LG and loads them when an old invoice is requested', () => {
    for (const url of PDF_LIB_URLS) assert.ok(src.includes(`'${url}'`), url);
    assert.match(src, /this\.__lgOldInvoiceId = LG\.invoiceOverlayGate\.arm\(\);\s+ensurePdfLibs\(\);/);
    assert.match(src, /const libs = await ensurePdfLibs\(\);/);
  });
});

describe('slimSalesItem', () => {
  it('keeps only what the sales total reads', () => {
    const item = { Id: 7, Code: 'SL1', CashBanks: 'TUN - 100.000<br>TF BCA - 50.000', Details: [{ big: 'x'.repeat(100) }] };
    assert.deepEqual(slimSalesItem(item), { CashBanks: item.CashBanks });
    assert.deepEqual(slimSalesItem(null), { CashBanks: undefined });
  });

  it('gives the same totals and row count as the full items', () => {
    const items = [
      { Id: 1, CashBanks: 'TUN - 100.000' },
      { Id: 2, CashBanks: 'TF BCA - 250.000<br>TUN - (50.000)' },
      { Id: 3, CashBanks: '' },
      null,
    ];
    assert.deepEqual(aggregateSalesPayments(items.map(slimSalesItem)), aggregateSalesPayments(items));
  });
});

describe('slimPurchasingItem', () => {
  it('gives the same totals and row count as the full items', () => {
    const items = [
      { Id: 1, Code: 'PC1', CashBanks: 'TUN - 100.000', TotalPurchase: '100.000' },
      { Id: 2, Code: 'PC2', CashBanks: '', PaymentMethodName: 'TF BCA', TotalPurchase: '2.500.000' },
      { Id: 3, Code: 'PC3', PaymentMethod: 'TUN', TotalPurchase: '75.000', Items: [1, 2, 3] },
      null,
    ];
    assert.deepEqual(aggregatePurchasingPayments(items.map(slimPurchasingItem)), aggregatePurchasingPayments(items));
    assert.deepEqual(Object.keys(slimPurchasingItem(items[2])).sort(), ['CashBanks', 'PaymentMethod', 'PaymentMethodName', 'TotalPurchase']);
  });
});

describe('payment total bars', () => {
  it('store slim rows and cap parallel extra-page requests', () => {
    assert.match(src, /pageItems\.set\(page, items\.map\(LG\.slimSalesItem\)\);/);
    assert.match(src, /pageItems\.set\(page, items\.map\(LG\.slimPurchasingItem\)\);/);
    assert.equal(src.split('while (activeExtra < EXTRA_LIMIT && extraQueue.length) {').length - 1, 2);
  });

  it('re-aggregate only when the loaded data changed', () => {
    assert.equal(src.split('if (!aggCache || aggCache.version !== dataVersion) {').length - 1, 2);
  });
});
