import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSalesCashBanks,
  salesMethodLabel,
  aggregateSalesPayments,
  isSalesListPage,
  isSalesListApiUrl,
  salesApiPageNumber,
  otherSalesPages,
  nextSalesListUrl,
} from '../lib/sales-payment-totals.js';

describe('parseSalesCashBanks', () => {
  it('parses a single TUN line as a positive amount', () => {
    assert.deepEqual(parseSalesCashBanks('TUN - 9.416.000<br> '), [
      { method: 'TUN', amount: 9416000 },
    ]);
  });

  it('treats parenthesized cancel amounts as negative', () => {
    assert.deepEqual(
      parseSalesCashBanks(
        "TUN - 488.000<br> <br> <span class='cancel'>Batal Jual</span> <br><span class='cancel'>TUN - (140.000) </span>"
      ),
      [
        { method: 'TUN', amount: 488000 },
        { method: 'TUN', amount: -140000 },
      ]
    );
  });

  it('splits mixed payment lines', () => {
    assert.deepEqual(
      parseSalesCashBanks('TUN - 3.570.000<br> TF BCA - 2.520.000<br> '),
      [
        { method: 'TUN', amount: 3570000 },
        { method: 'TF BCA', amount: 2520000 },
      ]
    );
  });

  it('keeps a dashed method name with a positive amount', () => {
    assert.deepEqual(parseSalesCashBanks('TRANSFER - BCA - 1.000.000<br>'), [
      { method: 'TRANSFER - BCA', amount: 1000000 },
    ]);
  });

  it('returns empty for blank input', () => {
    assert.deepEqual(parseSalesCashBanks(''), []);
    assert.deepEqual(parseSalesCashBanks(null), []);
  });
});

describe('salesMethodLabel', () => {
  it('maps TUN to Tunai and leaves unknown methods as-is', () => {
    assert.equal(salesMethodLabel('TUN'), 'Tunai');
    assert.equal(salesMethodLabel('tun'), 'Tunai');
    assert.equal(salesMethodLabel('TF BCA'), 'TF BCA');
    assert.equal(salesMethodLabel('DBT BCA'), 'Debet BCA');
    assert.equal(salesMethodLabel('DBT BRI'), 'Debet BRI');
    assert.equal(salesMethodLabel('SHOPEE'), 'Shopee');
    assert.equal(salesMethodLabel('QRIS'), 'QRIS');
  });
});

describe('aggregateSalesPayments', () => {
  it('nets cancel lines and splits mixed methods', () => {
    const result = aggregateSalesPayments([
      { CashBanks: 'TUN - 488.000<br> <br> <span class=\'cancel\'>Batal Jual</span> <br><span class=\'cancel\'>TUN - (140.000) </span>' },
      { CashBanks: 'TUN - 3.570.000<br> TF BCA - 2.520.000<br> ' },
      { CashBanks: 'TF BCA - 8.194.000<br> <br> <span class=\'cancel\'>Batal Jual</span> <br><span class=\'cancel\'>TF BCA - (8.194.000) </span>' },
    ]);

    assert.equal(result.count, 3);
    assert.equal(result.total, 3570000 + 2520000 + 348000);
    assert.deepEqual(result.methods, [
      { method: 'TUN', label: 'Tunai', amount: 3918000 },
      { method: 'TF BCA', label: 'TF BCA', amount: 2520000 },
    ]);
  });
});

describe('sales list helpers', () => {
  it('matches only the sales list page', () => {
    assert.equal(isSalesListPage('/sales'), true);
    assert.equal(isSalesListPage('/sales/'), true);
    assert.equal(isSalesListPage('/sales/create'), false);
    assert.equal(isSalesListPage('/sales/detail/135417'), false);
    assert.equal(isSalesListPage('/sales-cancel'), false);
  });

  it('matches only the /web/sales list API', () => {
    assert.equal(isSalesListApiUrl('/web/sales?pageNumber=0'), true);
    assert.equal(isSalesListApiUrl('https://liagold.cuan.co/web/sales?pageSize=100'), true);
    assert.equal(isSalesListApiUrl('/web/sales/detail/135417'), false);
    assert.equal(isSalesListApiUrl('/web/purchasing?pageNumber=0'), false);
  });

  it('reads pageNumber from the sales API url', () => {
    assert.equal(salesApiPageNumber('/web/sales?pageNumber=2&pageSize=100'), 2);
    assert.equal(salesApiPageNumber('/web/sales'), 0);
  });

  it('lists other pages needed for a full total', () => {
    assert.deepEqual(otherSalesPages({ pageNumber: 0, pageSize: 100, totalCount: 148 }), [1]);
    assert.deepEqual(otherSalesPages({ pageNumber: 1, pageSize: 100, totalCount: 148 }), [0]);
    assert.deepEqual(otherSalesPages({ pageNumber: 0, pageSize: 100, totalCount: 80 }), []);
  });

  it('rewrites pageNumber on the same filter url', () => {
    const next = nextSalesListUrl(
      'https://liagold.cuan.co/web/sales?sortOrder=desc&pageNumber=0&pageSize=100&timeFrom=06',
      1
    );
    const url = new URL(next);
    assert.equal(url.searchParams.get('pageNumber'), '1');
    assert.equal(url.searchParams.get('pageSize'), '100');
    assert.equal(url.searchParams.get('timeFrom'), '06');
  });
});
