import { parseIdNumber } from './parse-id-number.js';

const METHOD_LABELS = {
  TUN: 'Tunai',
  'TF BCA': 'TF BCA',
  'DBT BCA': 'Debet BCA',
  'DBT BRI': 'Debet BRI',
  SHOPEE: 'Shopee',
};

export function parseSalesCashBanks(html) {
  if (html == null || html === '') return [];

  const text = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '\n');

  const out = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    const idx = line.lastIndexOf(' - ');
    if (idx === -1) continue;

    const method = line.slice(0, idx).trim();
    const amountRaw = line.slice(idx + 3).trim();
    if (!method) continue;

    const paren = /^\(.*\)$/.test(amountRaw);
    const amount = parseIdNumber(amountRaw.replace(/[()]/g, ''));
    out.push({ method, amount: paren ? -Math.abs(amount) : amount });
  }
  return out;
}

export function salesMethodLabel(method) {
  const key = String(method || '').trim().toUpperCase();
  if (!key) return '';
  return METHOD_LABELS[key] || String(method).trim();
}

export function aggregateSalesPayments(items) {
  const list = Array.isArray(items) ? items : [];
  const totals = new Map();

  for (const item of list) {
    for (const line of parseSalesCashBanks(item && item.CashBanks)) {
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

export function isSalesListPage(pathname) {
  return /^\/sales\/?$/.test(pathname || '');
}

export function isSalesListApiUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(String(url), 'https://liagold.cuan.co');
    return /\/web\/sales\/?$/.test(parsed.pathname);
  } catch (e) {
    return false;
  }
}

export function salesApiPageNumber(url) {
  try {
    const parsed = new URL(String(url), 'https://liagold.cuan.co');
    const n = Number(parsed.searchParams.get('pageNumber'));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

export function otherSalesPages({ pageNumber, pageSize, totalCount }) {
  const size = Number(pageSize) || 0;
  const total = Number(totalCount) || 0;
  const current = Number(pageNumber) || 0;
  if (size <= 0 || total <= 0) return [];

  const last = Math.ceil(total / size) - 1;
  const pages = [];
  for (let page = 0; page <= last; page++) {
    if (page !== current) pages.push(page);
  }
  return pages;
}

export function nextSalesListUrl(url, pageNumber) {
  const parsed = new URL(String(url), 'https://liagold.cuan.co');
  parsed.searchParams.set('pageNumber', String(pageNumber));
  return parsed.toString();
}
