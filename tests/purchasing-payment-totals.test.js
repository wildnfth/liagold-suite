import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregatePurchasingPayments,
  isPurchasingListPage,
  isPurchasingListApiUrl,
} from '../lib/purchasing-payment-totals.js';

describe('aggregatePurchasingPayments', () => {
  it('prefers CashBanks lines over PaymentMethodName', () => {
    const result = aggregatePurchasingPayments([
      {
        PaymentMethodName: 'CASH',
        TotalPurchase: 999999,
        CashBanks: 'TUN - 1.065.000<br> ',
      },
    ]);

    assert.equal(result.count, 1);
    assert.deepEqual(result.methods, [
      { method: 'TUN', label: 'Tunai', amount: 1065000 },
    ]);
    assert.equal(result.total, 1065000);
  });

  it('falls back to PaymentMethodName and TotalPurchase when CashBanks is empty', () => {
    const result = aggregatePurchasingPayments([
      { PaymentMethodName: 'CASH', TotalPurchase: 1065000.0, CashBanks: '' },
      { PaymentMethodName: 'TRANSFER BCA', TotalPurchase: 1840000 },
    ]);

    assert.equal(result.count, 2);
    assert.deepEqual(result.methods, [
      { method: 'TRANSFER BCA', label: 'TRANSFER BCA', amount: 1840000 },
      { method: 'CASH', label: 'CASH', amount: 1065000 },
    ]);
    assert.equal(result.total, 2905000);
  });
});

describe('purchasing list helpers', () => {
  it('matches only purchasing list pages', () => {
    assert.equal(isPurchasingListPage('/purchasing'), true);
    assert.equal(isPurchasingListPage('/purchasing/'), true);
    assert.equal(isPurchasingListPage('/purchasing-non-invoice'), true);
    assert.equal(isPurchasingListPage('/purchasing-non-invoice/'), true);
    assert.equal(isPurchasingListPage('/purchasing/123'), false);
    assert.equal(isPurchasingListPage('/purchasing-non-invoice/create'), false);
    assert.equal(isPurchasingListPage('/sales'), false);
  });

  it('matches only purchasing list APIs', () => {
    assert.equal(isPurchasingListApiUrl('/web/purchasing?pageNumber=0'), true);
    assert.equal(isPurchasingListApiUrl('https://liagold.cuan.co/web/purchasing?pageSize=100'), true);
    assert.equal(isPurchasingListApiUrl('/web/purchasing/non-invoice?pageNumber=0'), true);
    assert.equal(isPurchasingListApiUrl('/web/purchasing/detail-non-invoice?pageNumber=0'), false);
    assert.equal(isPurchasingListApiUrl('/web/sales?pageNumber=0'), false);
  });
});
