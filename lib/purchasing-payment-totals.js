import { parseIdNumber } from './parse-id-number.js';
import { isPaymentInjectPage } from './payment-page.js';
import { parseSalesCashBanks, salesMethodLabel } from './sales-payment-totals.js';

export function isPurchasingListPage(pathname) {
  return isPaymentInjectPage(pathname);
}

export function isPurchasingListApiUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(String(url), 'https://liagold.cuan.co');
    return /\/web\/purchasing\/?$/.test(parsed.pathname)
      || /\/web\/purchasing\/non-invoice\/?$/.test(parsed.pathname);
  } catch (e) {
    return false;
  }
}

export function purchasingPaymentLines(item) {
  const fromCash = parseSalesCashBanks(item && item.CashBanks);
  if (fromCash.length) {
    return fromCash.map((line) => ({ ...line, amount: Math.abs(line.amount) }));
  }

  const method = String((item && (item.PaymentMethodName || item.PaymentMethod)) || '').trim();
  if (!method) return [];

  return [{ method, amount: Math.abs(parseIdNumber(item && item.TotalPurchase)) }];
}

export function aggregatePurchasingPayments(items) {
  const list = Array.isArray(items) ? items : [];
  const totals = new Map();

  for (const item of list) {
    for (const line of purchasingPaymentLines(item)) {
      totals.set(line.method, (totals.get(line.method) || 0) + line.amount);
    }
  }

  const methods = [...totals.entries()]
    .filter(([, amount]) => amount !== 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([method, amount]) => ({
      method,
      label: salesMethodLabel(method),
      amount,
    }));

  return {
    methods,
    total: methods.reduce((sum, row) => sum + row.amount, 0),
    count: list.length,
  };
}
