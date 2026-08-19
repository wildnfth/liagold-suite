// ==UserScript==
// @name         LiaGold Suite Ultimate (Totalizer + Scanner + Payment Detail)
// @namespace    https://github.com/wildnfth/liagold-suite
// @version      1.0.35
// @description  v1.0.35: medium issues — cache hygiene, tray load, pending queue, crypto session, no TTL auto-delete
// @homepageURL  https://github.com/wildnfth/liagold-suite
// @supportURL   https://github.com/wildnfth/liagold-suite/issues
// @match        https://liagold.cuan.co/*
// @match        http://liagold.cuan.co/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
'use strict';
if (window.__lgUltimateSuite) return;
window.__lgUltimateSuite = true;

// synced from lib/*.js — keep LG bodies identical
// Keep bodies identical.
const LG = {
  DATA_TTL_MS: 12 * 60 * 60 * 1000,
  parseTimestamp(value) {
    if (value == null || value === '') return null;
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
  },
  getRemainingTime(lastScanAt, now, ttlMs) {
    if (now == null) now = Date.now();
    if (ttlMs == null) ttlMs = LG.DATA_TTL_MS;
    const t = LG.parseTimestamp(lastScanAt);
    if (t == null) return null;
    return Math.max(0, t + ttlMs - now);
  },
  isDataExpired(lastScanAt, now, ttlMs) {
    const remaining = LG.getRemainingTime(lastScanAt, now, ttlMs);
    if (remaining == null) return false;
    return remaining <= 0;
  },
  sanitizeKey(str) {
    return String(str).replace(/[.#$\[\]/]/g, '_');
  },
  generateHistoryKey(codeProduct, timestamp) {
    const cp = String(codeProduct || '').toLowerCase();
    const ts = String(timestamp || '');
    return LG.sanitizeKey(cp + '_' + ts);
  },
  parseIdNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    if (value == null) return 0;
    const original = String(value).trim();
    if (!original) return 0;
    const negative = /[-−]/.test(original);
    let raw = original.replace(/[^\d.,]/g, '');
    if (!raw) return 0;
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    const commaCount = (raw.match(/,/g) || []).length;
    const dotCount = (raw.match(/\./g) || []).length;
    if (lastComma !== -1 && lastDot !== -1) {
      if (lastComma > lastDot) {
        raw = raw.replace(/\./g, '').replace(',', '.');
      } else {
        raw = raw.replace(/,/g, '');
      }
    } else if (dotCount > 0 && commaCount === 0) {
      if (dotCount > 1) {
        raw = raw.replace(/\./g, '');
      } else {
        const frac = raw.length - lastDot - 1;
        if (frac === 3) raw = raw.replace('.', '');
      }
    } else if (commaCount > 0 && dotCount === 0) {
      if (commaCount > 1) {
        raw = raw.replace(/,/g, '');
      } else {
        raw = raw.replace(',', '.');
      }
    }
    const num = parseFloat(raw);
    if (!Number.isFinite(num)) return 0;
    return negative ? -Math.abs(num) : num;
  },
  isPaymentInjectPage(pathname) {
    return /^\/purchasing\/?$/.test(pathname) || /^\/purchasing-non-invoice\/?$/.test(pathname);
  },
  isPurchasingNonInvoicePage(pathname) {
    return /^\/purchasing-non-invoice\/?$/.test(pathname);
  },
  isPurchasingFamilyChild(pathname) {
    return /^\/purchasing-non-invoice\/.+/.test(pathname) || /^\/purchasing\/.+/.test(pathname);
  },
  MAX_FORM_CODE_ATTEMPTS: 3,
  recordFormAttempt(attempts, code, success, maxAttempts) {
    if (maxAttempts == null) maxAttempts = LG.MAX_FORM_CODE_ATTEMPTS;
    const lc = String(code || '').toLowerCase();
    if (success) {
      attempts.delete(lc);
      return { markFilled: true, retry: false, giveUp: false };
    }
    const n = (attempts.get(lc) || 0) + 1;
    attempts.set(lc, n);
    if (n >= maxAttempts) {
      return { markFilled: false, retry: false, giveUp: true };
    }
    return { markFilled: false, retry: true, giveUp: false };
  },
  PAYMENT_CACHE_TTL_MS: 30 * 60 * 1000,
  TEMP_EMPTY_TTL_MS: 60 * 1000,
  isPaymentCacheFresh(entry, now, ttlMs) {
    if (now == null) now = Date.now();
    if (ttlMs == null) ttlMs = LG.PAYMENT_CACHE_TTL_MS;
    if (!entry || !Number.isFinite(entry.t)) return false;
    return now - entry.t <= ttlMs;
  },
  isEmptyPayment(value) {
    if (!value) return true;
    const method = String(value.m ?? '').trim();
    const amount = Number(value.a) || 0;
    const methodEmpty = method === '' || method === '-';
    return methodEmpty && amount === 0;
  },
  classifyPaymentFetch({ networkError, itemFound, value }) {
    if (networkError) return 'none';
    if (!itemFound) return 'tempEmpty';
    if (LG.isEmptyPayment(value)) return 'tempEmpty';
    return 'persist';
  },
  findNumberHits(text, mode) {
    const LONG_RE = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d{4,}(?:[.,]\d+)?|\d{1,3}(?:[.,]\d+)?/g;
    const STRICT_RE = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?/g;
    const re = mode === 'strict' ? STRICT_RE : LONG_RE;
    re.lastIndex = 0;
    const hits = [];
    let m;
    const src = String(text ?? '');
    while ((m = re.exec(src)) !== null) {
      hits.push({ v: m[0], i: m.index });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return hits;
  },
  buildSelectionKey({ rowCode, rowId, colClass, val, grp }) {
    const row = rowCode || rowId || '';
    return row + '||' + (colClass || '') + '||' + (val || '') + '||' + (grp || '');
  },
  nextProcessDelay(now, lastProcessTime, minGapMs) {
    if (!lastProcessTime) return 0;
    const elapsed = now - lastProcessTime;
    if (elapsed >= minGapMs) return 0;
    return minGapMs - elapsed;
  },
  parseArrayJson(raw, fallback) {
    if (raw == null) return fallback;
    try {
      const val = JSON.parse(raw);
      return Array.isArray(val) ? val : fallback;
    } catch (e) {
      return fallback;
    }
  },
  scannedCodesFromLog(scanLog) {
    const set = new Set();
    if (!Array.isArray(scanLog)) return [];
    for (const row of scanLog) {
      if (!row || row.status !== 'MASUK' || row.codeProduct == null || row.codeProduct === '') continue;
      set.add(String(row.codeProduct).toLowerCase());
    }
    return [...set];
  },
  pickProductPrice(item) {
    if (!item || typeof item !== 'object') return 0;
    for (const key of ['SellingPrice', 'Price', 'SellingPriceValue']) {
      if (typeof item[key] === 'number' && Number.isFinite(item[key])) return item[key];
    }
    return LG.parseIdNumber(item.SellingPriceDisplay || item.Price || 0);
  },
  parsePendingQueue(raw) {
    if (raw == null) return [];
    try {
      const val = JSON.parse(raw);
      if (!Array.isArray(val)) return [];
      return val.filter((x) => x && typeof x === 'object' && x.codeProduct);
    } catch (e) {
      return [];
    }
  },
  paymentCacheKey(code, nonInvoice) {
    return (nonInvoice ? 'ni:' : 'inv:') + String(code || '');
  },
  nextPaymentLookupPage({ found, pageNumber, itemCount, pageSize, maxPages }) {
    if (found) return null;
    if (itemCount < pageSize) return null;
    if (pageNumber + 1 >= maxPages) return null;
    return pageNumber + 1;
  },
  randomBase36(length) {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < length; i++) out += alphabet[bytes[i] % 36];
    return out;
  },
  buildNiLookupUrl(origin, path, filter, pageSize, pageNumber) {
    if (pageNumber == null) pageNumber = 0;
    const url = new URL(path, origin);
    url.search = '';
    url.searchParams.set('sortOrder', 'desc');
    url.searchParams.set('sortField', 'id');
    url.searchParams.set('pageNumber', String(pageNumber));
    url.searchParams.set('pageSize', String(pageSize));
    url.searchParams.set('startIndexCustom', '-1');
    url.searchParams.set('generalFilter', filter == null ? '' : String(filter));
    return url.toString();
  }
};

// ==========================================
// MODULE 1: Gold ERP - Payment Method Detail
// ==========================================
(() => {
  'use strict';

  if (window.__goldPayDetailV4Injected) return;
  window.__goldPayDetailV4Injected = true;

  // Blokir guard script lama (goldTotalFooterInjected dibiarkan agar Module 2 bisa jalan di halaman non-purchasing)
  window.__goldPaymentFooterInjected = true;
  window.__goldPaymentExactInjected = true;
  window.__goldPayDetailV2Injected = true;
  window.__goldPayDetailV3Injected = true;

  const STYLE_ID = 'gold-pay-detail-v4-style';

  const FOOTER_ROW_CLASS = 'gold-pay-footer-row';
  const FOOTER_LABEL_CLASS = 'gold-pay-footer-label';
  const FOOTER_NEG_CLASS = 'gold-pay-neg';

  const METHOD_HEADER_CLASS = 'gold-pay-method-header';
  const AMOUNT_HEADER_CLASS = 'gold-pay-amount-header';

  const METHOD_CELL_CLASS = 'gold-pay-method';
  const AMOUNT_CELL_CLASS = 'gold-pay-amount';

  const STORAGE_KEY = 'goldPayDetailV4:payments';
  const TEMP_EMPTY_TTL = 60 * 1000;
  const FETCH_LIMIT = 4;

  const SUM_COLUMNS = [
    { key: 'weightNote',      type: 'weight' },
    { key: 'weightReal',      type: 'weight' },
    { key: 'totalPrice',      type: 'money'  },
    { key: 'cost',            type: 'money'  },
    { key: 'discountPrice',   type: 'money'  },
    { key: 'notePrice',       type: 'money'  },
    { key: 'purchasePrice',   type: 'money'  },
    { key: 'differencePrice', type: 'money'  }
  ];

  const moneyFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
  const weightFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

  const memCache = new Map();
  const tempEmpty = new Map();
  const inflight = new Map();
  const tableStates = new WeakMap();

  // Non-invoice: map Id baris -> Code PC, plus cache & antrean resolve
  const niCodeCache = new Map();
  const niCodeEmpty = new Map();
  const niCodeInflight = new Map();

  const fetchQueue = [];
  let activeFetch = 0;

  let suppressObserver = false;
  let suppressTimer = 0;
  let debounceTimer = 0;
  let rafId = 0;
  let saveTimer = 0;

  let storageCache = loadStorageCache();

  function loadStorageCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};

      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        localStorage.removeItem(STORAGE_KEY);
        return {};
      }

      return obj;
    } catch (e) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e2) {}
      return {};
    }
  }

  function saveStorageCache() {
    clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(storageCache));
      } catch (e) {
        const now = Date.now();
        Object.keys(storageCache).forEach((k) => {
          if (!LG.isPaymentCacheFresh(storageCache[k], now)) delete storageCache[k];
        });
        const keys = Object.keys(storageCache).sort(
          (a, b) => (storageCache[a].t || 0) - (storageCache[b].t || 0)
        );
        keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => delete storageCache[k]);
        memCache.clear();
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(storageCache));
        } catch (e2) {
          // ignore
        }
      }
    }, 200);
  }

  function scoped(code, nonInvoice) {
    return LG.paymentCacheKey(code, nonInvoice);
  }

  function getCache(code, nonInvoice) {
    const key = scoped(code, nonInvoice);
    const stored = storageCache[key];
    if (!stored || !LG.isPaymentCacheFresh(stored)) {
      if (stored) {
        delete storageCache[key];
        memCache.delete(key);
        saveStorageCache();
      } else {
        memCache.delete(key);
      }
      return null;
    }

    const val = {
      m: typeof stored.m === 'string' ? stored.m : '-',
      a: Number(stored.a) || 0
    };
    memCache.set(key, val);
    return val;
  }

  function setCache(code, nonInvoice, value) {
    const key = scoped(code, nonInvoice);
    memCache.set(key, value);

    storageCache[key] = {
      m: value.m,
      a: value.a,
      t: Date.now()
    };

    saveStorageCache();
  }

  function isTempEmpty(code, nonInvoice) {
    const ts = tempEmpty.get(scoped(code, nonInvoice));
    return !!ts && (Date.now() - ts < TEMP_EMPTY_TTL);
  }

  function setTempEmpty(code, nonInvoice) {
    tempEmpty.set(scoped(code, nonInvoice), Date.now());
  }

  function isNiCodeEmpty(id) {
    const ts = niCodeEmpty.get(id);
    return !!ts && (Date.now() - ts < TEMP_EMPTY_TTL);
  }

  function setNiCodeEmpty(id) {
    niCodeEmpty.set(id, Date.now());
  }

  function pruneNegativeCache(now) {
    if (now == null) now = Date.now();
    for (const [k, ts] of tempEmpty) {
      if (now - ts >= TEMP_EMPTY_TTL) tempEmpty.delete(k);
    }
    for (const [k, ts] of niCodeEmpty) {
      if (now - ts >= TEMP_EMPTY_TTL) niCodeEmpty.delete(k);
    }
  }

  function domWrite(fn) {
    suppressObserver = true;

    try {
      fn();
    } finally {
      clearTimeout(suppressTimer);

      suppressTimer = setTimeout(() => {
        suppressObserver = false;
      }, 100);
    }
  }

  function scheduleUpdate(delay = 250) {
    clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
      if (rafId) return;

      rafId = requestAnimationFrame(() => {
        rafId = 0;
        updateAll();
      });
    }, delay);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      th.${METHOD_HEADER_CLASS},
      td.${METHOD_CELL_CLASS},
      th.${AMOUNT_HEADER_CLASS},
      td.${AMOUNT_CELL_CLASS} {
        flex: 0 0 140px !important;
        min-width: 140px;
        width: 140px;
        box-sizing: border-box;
      }

      th.${METHOD_HEADER_CLASS},
      td.${METHOD_CELL_CLASS} {
        text-align: left !important;
      }

      th.${AMOUNT_HEADER_CLASS},
      td.${AMOUNT_CELL_CLASS} {
        text-align: right !important;
      }

      td.${METHOD_CELL_CLASS} {
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 160px;
      }

      td.${AMOUNT_CELL_CLASS} {
        font-variant-numeric: tabular-nums;
      }

      .${FOOTER_ROW_CLASS} td {
        background: #fffbe8 !important;
        font-weight: 800;
        color: #15151c;
        border-top: 2px solid #e3b53d !important;
        white-space: nowrap;
        position: sticky;
        bottom: 0;
        z-index: 60;
        box-sizing: border-box;
      }

      .${FOOTER_ROW_CLASS} td.mat-table-sticky {
        z-index: 65;
      }

      .${FOOTER_ROW_CLASS} td.${FOOTER_LABEL_CLASS} {
        background: #fff3c9 !important;
        color: #7c5c00;
        text-align: left !important;
        padding-left: 16px !important;
        font-size: 13px;
        z-index: 70 !important;
        white-space: nowrap !important;
        font-weight: 800;
      }

      .${FOOTER_ROW_CLASS} td.${FOOTER_LABEL_CLASS}.mat-table-sticky {
        z-index: 70 !important;
      }

      .${FOOTER_ROW_CLASS} td.${FOOTER_NEG_CLASS} {
        color: #d2453a !important;
      }

      .${FOOTER_ROW_CLASS} td.${METHOD_CELL_CLASS} {
        text-align: left !important;
        font-size: 12px;
        max-width: 160px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .${FOOTER_ROW_CLASS} td.${AMOUNT_CELL_CLASS} {
        text-align: right !important;
      }

      tfoot {
        display: table-footer-group;
      }
    `;

    document.head.appendChild(style);
  }

  function setText(el, text) {
    if (!el) return;

    const value = String(text ?? '');

    if (el.textContent !== value) {
      el.textContent = value;
    }
  }

  function setTitle(el, title) {
    if (!el) return;

    const value = String(title ?? '');

    if (el.title !== value) {
      el.title = value;
    }
  }

  function setStyle(el, prop, value) {
    if (!el) return;

    if (el.style[prop] !== value) {
      el.style[prop] = value;
    }
  }

  function fmtMoney(n) {
    return moneyFmt.format(Math.round(Number(n) || 0));
  }

  function fmtWeight(n) {
    return `${weightFmt.format(Number(n) || 0)} gr`;
  }

  function parseCell(cell) {
    if (!cell) return 0;
    return LG.parseIdNumber(cell.textContent);
  }

  function parseApiAmount(value) {
    return LG.parseIdNumber(value);
  }

  function isNonInvoicePage() {
    return LG.isPurchasingNonInvoicePage(location.pathname);
  }

  // Tabel non-invoice: ada purchasePrice + description, tanpa notePrice.
  // Kolom code bisa ada maupun tidak — kalau ada, kode PC dipakai langsung per baris.
  function isNonInvoiceTable(table) {
    try {
      if (table.querySelector('th.mat-column-notePrice, th.cdk-column-notePrice, td.mat-column-notePrice, td.cdk-column-notePrice')) return false;

      return (
        !!table.querySelector('th.mat-column-purchasePrice, th.cdk-column-purchasePrice') &&
        !!table.querySelector('th.mat-column-description, th.cdk-column-description') &&
        (
          !!table.querySelector('th.mat-column-code, th.cdk-column-code') ||
          !!table.querySelector('th.mat-column-id, th.cdk-column-id')
        )
      );
    } catch (e) {
      return false;
    }
  }

  function isTargetTable(table) {
    try {
      if (!table || table.tagName !== 'TABLE') return false;

      if (table.closest('m-purchasing-head-table')) return false;

      if (isNonInvoicePage() && isNonInvoiceTable(table)) return true;

      return (
        !!table.querySelector('th.mat-column-code, td.mat-column-code, th.cdk-column-code, td.cdk-column-code') &&
        !!table.querySelector('th.mat-column-discountPrice, td.mat-column-discountPrice, th.cdk-column-discountPrice, td.cdk-column-discountPrice') &&
        !!table.querySelector('th.mat-column-notePrice, td.mat-column-notePrice, th.cdk-column-notePrice, td.cdk-column-notePrice') &&
        !!table.querySelector('th.mat-column-purchasePrice, td.mat-column-purchasePrice, th.cdk-column-purchasePrice, td.cdk-column-purchasePrice')
      );
    } catch (e) {
      return false;
    }
  }

  function getTargetTables() {
    return Array
      .from(document.querySelectorAll('table.mat-table'))
      .filter(isTargetTable);
  }

  function getState(table) {
    let state = tableStates.get(table);

    if (!state) {
      state = {
        processing: false,
        legacyCleaned: false
      };

      tableStates.set(table, state);
    }

    return state;
  }

  function cleanupLegacy(table, keepTotalFooter) {
    table.querySelectorAll(
      'th.mat-column-paymentMethod, th.mat-column-paymentAmount, th.gold-payment-header-cell, td.mat-column-paymentMethod, td.mat-column-paymentAmount'
    ).forEach((el) => el.remove());

    // Baris TOTAL milik Module 2 dibiarkan di tabel non-invoice
    if (!keepTotalFooter) {
      table.querySelectorAll('tfoot tr.gold-total-footer-row').forEach((el) => el.remove());
    }
  }

  function ensureHeaderColumns(table) {
    const headerRow = table.querySelector('thead tr.mat-header-row');
    if (!headerRow) return false;

    const noteTh = headerRow.querySelector('th.mat-column-notePrice, th.cdk-column-notePrice');
    const nonInvoice = !noteTh;
    const anchorTh = nonInvoice
      ? headerRow.querySelector('th.mat-column-purchasePrice, th.cdk-column-purchasePrice')
      : noteTh;
    if (!anchorTh) return false;

    if (!headerRow.querySelector(`th.${METHOD_HEADER_CLASS}`)) {
      const th = document.createElement('th');
      th.className = `mat-header-cell ${METHOD_HEADER_CLASS} ${METHOD_CELL_CLASS}`;
      th.setAttribute('role', 'columnheader');
      th.textContent = 'Metode Bayar';
      headerRow.insertBefore(th, anchorTh);
    }

    headerRow.querySelectorAll(`th.${AMOUNT_HEADER_CLASS}`).forEach((el) => el.remove());

    return true;
  }

  function ensureRowCells(row) {
    const noteCell = row.querySelector('td.mat-column-notePrice, td.cdk-column-notePrice');
    const nonInvoice = !noteCell;
    const anchorCell = nonInvoice
      ? row.querySelector('td.mat-column-purchasePrice, td.cdk-column-purchasePrice')
      : noteCell;
    if (!anchorCell) return;

    if (!row.querySelector(`td.${METHOD_CELL_CLASS}`)) {
      const td = document.createElement('td');
      td.className = `mat-cell ${METHOD_CELL_CLASS}`;
      td.setAttribute('role', 'gridcell');
      td.textContent = '';
      row.insertBefore(td, anchorCell);
    }

    row.querySelectorAll(`td.${AMOUNT_CELL_CLASS}`).forEach((el) => el.remove());
  }

  function getVisibleRows(table) {
    return Array
      .from(table.querySelectorAll('tbody tr.mat-row'))
      .filter((row) => row.offsetParent !== null);
  }

  function getRowCode(row) {
    const cell = row.querySelector('td.mat-column-code, td.cdk-column-code');
    if (!cell) return '';

    const text = cell.textContent || '';
    const match = text.match(/PC\s*\d+/i);

    if (match) {
      return match[0].replace(/\s+/g, '').toUpperCase();
    }

    return text.trim().toUpperCase();
  }

  function getRowId(row) {
    const cell = row.querySelector('td.mat-column-id, td.cdk-column-id');
    if (!cell) return '';

    const text = cell.textContent || '';
    const match = text.match(/\d+/);

    return match ? match[0] : text.trim();
  }

  function getUniqueCodes(rows) {
    const set = new Set();

    rows.forEach((row) => {
      const code = getRowCode(row);
      if (code) set.add(code);
    });

    return Array.from(set);
  }

  function computeSums(rows) {
    const sums = {};

    SUM_COLUMNS.forEach((col) => {
      sums[col.key] = 0;
    });

    rows.forEach((row) => {
      SUM_COLUMNS.forEach((col) => {
        const cell = row.querySelector(`td.mat-column-${col.key}, td.cdk-column-${col.key}`);
        sums[col.key] += parseCell(cell);
      });
    });

    SUM_COLUMNS.forEach((col) => {
      if (col.type === 'weight') {
        sums[col.key] = Math.round(sums[col.key] * 100) / 100;
      } else {
        sums[col.key] = Math.round(sums[col.key]);
      }
    });

    return sums;
  }

  function buildApiUrl(filter, pageNumber, pageSize) {
    if (pageNumber == null) pageNumber = 0;
    if (pageSize == null) pageSize = 50;
    const params = new URLSearchParams({
      sortOrder: 'desc',
      sortField: 'id',
      pageNumber: String(pageNumber),
      pageSize: String(pageSize),
      startIndexCustom: '-1',
      generalFilter: filter
    });

    return `${window.location.origin}/web/purchasing?${params.toString()}`;
  }

  // List pembelian non-invoice (punya PaymentMethodName/TotalPurchase, format sama /web/purchasing)
  function buildNonInvoicePaymentUrl(filter, pageNumber, pageSize) {
    if (pageNumber == null) pageNumber = 0;
    if (pageSize == null) pageSize = 50;
    return LG.buildNiLookupUrl(window.location.origin, '/web/purchasing/non-invoice', filter, pageSize, pageNumber);
  }

  function runFetchQueue() {
    while (activeFetch < FETCH_LIMIT && fetchQueue.length) {
      const job = fetchQueue.shift();
      activeFetch++;

      fetch(job.url, {
        credentials: 'include',
        headers: {
          Accept: 'application/json'
        }
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(job.resolve)
        .catch(job.reject)
        .finally(() => {
          activeFetch--;
          runFetchQueue();
        });
    }
  }

  function fetchJson(url) {
    return new Promise((resolve, reject) => {
      fetchQueue.push({ url, resolve, reject });
      runFetchQueue();
    });
  }

  function findExactItem(json, code) {
    const items = (json && json.items) || [];
    if (!items.length) return null;

    const target = String(code || '').trim().toUpperCase();

    return items.find((item) => {
      return String(item.Code || '').trim().toUpperCase() === target;
    }) || null;
  }

  function extractPaymentMethod(item) {
    const direct = item.PaymentMethodName || item.PaymentMethod;
    if (direct) return String(direct).trim();

    const cashBanks = item.CashBanks;

    if (cashBanks) {
      const text = String(cashBanks)
        .replace(/<br\s*\/?>/gi, ', ')
        .replace(/<[^>]*>/g, '')
        .trim();

      const first = text.split(',')[0].trim();

      if (first) {
        return first.split(' - ')[0].trim();
      }
    }

    return '-';
  }

  function fetchPayment(code, nonInvoice) {
    const key = scoped(code, nonInvoice);
    const cached = getCache(code, nonInvoice);
    if (cached) return Promise.resolve(cached);

    if (isTempEmpty(code, nonInvoice)) {
      return Promise.resolve({ m: '', a: 0 });
    }

    if (inflight.has(key)) {
      return inflight.get(key);
    }

    const build = nonInvoice ? buildNonInvoicePaymentUrl : buildApiUrl;

    const promise = (async () => {
      try {
        const pageSize = 50;
        const maxPages = 5;
        let json = null;
        let item = null;
        let page = 0;
        while (true) {
          json = await fetchJson(build(code, page, pageSize));
          item = findExactItem(json, code);
          const n = ((json && json.items) || []).length;
          const next = LG.nextPaymentLookupPage({
            found: !!item,
            pageNumber: page,
            itemCount: n,
            pageSize,
            maxPages
          });
          if (item || next == null) break;
          page = next;
        }

        if (!item) {
          const digits = code.replace(/\D/g, '');

          if (digits && digits !== code) {
            json = await fetchJson(build(digits, 0, pageSize));
            item = findExactItem(json, code);
          }
        }

        if (!item) {
          const kind = LG.classifyPaymentFetch({ networkError: false, itemFound: false, value: null });
          if (kind === 'tempEmpty') setTempEmpty(code, nonInvoice);
          return { m: '', a: 0 };
        }

        const value = {
          m: extractPaymentMethod(item),
          a: parseApiAmount(item.TotalPurchase)
        };

        const kind = LG.classifyPaymentFetch({ networkError: false, itemFound: true, value });
        if (kind === 'persist') setCache(code, nonInvoice, value);
        else if (kind === 'tempEmpty') setTempEmpty(code, nonInvoice);
        return kind === 'persist' ? value : { m: value.m || '', a: value.a || 0 };
      } catch (err) {
        return { m: '', a: 0 };
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, promise);
    return promise;
  }

  // ===== Non-invoice: Id baris -> Code PC -> pembayaran =====

  function buildNonInvoiceUrl(filter, pageSize, pageNumber) {
    return LG.buildNiLookupUrl(
      location.origin,
      '/web/purchasing/detail-non-invoice',
      filter,
      pageSize,
      pageNumber == null ? 0 : pageNumber
    );
  }

  function getNiCode(id) {
    const hit = niCodeCache.get(String(id));
    if (!hit) return '';
    if (typeof hit === 'string') return hit;
    if (!LG.isPaymentCacheFresh(hit)) {
      niCodeCache.delete(String(id));
      return '';
    }
    return hit.c || '';
  }

  function setNiCode(id, code) {
    niCodeCache.set(String(id), { c: code, t: Date.now() });
  }

  function rememberNiItems(json) {
    const items = (json && json.items) || [];

    items.forEach((item) => {
      if (!item || item.Id == null || !item.Code) return;

      const id = String(item.Id);
      const code = String(item.Code).trim().toUpperCase();

      if (code) setNiCode(id, code);
    });
  }

  function findExactNiItem(json, id) {
    const items = (json && json.items) || [];
    const target = String(id);

    return items.find((item) => String(item && item.Id) === target) || null;
  }

  let niBulkPromise = null;
  let niBulkCooldown = 0;

  // Fallback: tarik list non-invoice sekali (pageSize besar) buat petakan Id -> Code
  function ensureNiBulk() {
    if (niBulkPromise) return niBulkPromise;
    if (Date.now() < niBulkCooldown) return Promise.resolve(false);

    niBulkPromise = (async () => {
      try {
        for (let page = 0; page < 10; page++) {
          const json = await fetchJson(buildNonInvoiceUrl('', 500, page));
          rememberNiItems(json);
          const n = ((json && json.items) || []).length;
          if (n < 500) break;
        }
        niBulkCooldown = Date.now() + 60 * 1000;
        return true;
      } catch (e) {
        niBulkCooldown = Date.now() + 60 * 1000;
        return false;
      } finally {
        niBulkPromise = null;
      }
    })();

    return niBulkPromise;
  }

  function resolveNonInvoiceCode(id) {
    const key = String(id);

    const existing = getNiCode(key);
    if (existing) return Promise.resolve(existing);
    if (niCodeInflight.has(key)) return niCodeInflight.get(key);
    if (isNiCodeEmpty(key)) return Promise.resolve('');

    const promise = (async () => {
      try {
        let item = null;

        try {
          const json = await fetchJson(buildNonInvoiceUrl(key, 20));
          item = findExactNiItem(json, key);
          if (item) rememberNiItems(json);
        } catch (e) {
          // lanjut fallback bulk
        }

        if (!item) {
          const bulkOk = await ensureNiBulk();
          const mapped = getNiCode(key);
          if (mapped) return mapped;
          if (bulkOk) setNiCodeEmpty(key);
          return '';
        }

        const code = String(item.Code || '').trim().toUpperCase();

        if (!code) {
          setNiCodeEmpty(key);
          return '';
        }

        setNiCode(key, code);
        return code;
      } catch (e) {
        return '';
      } finally {
        niCodeInflight.delete(key);
      }
    })();

    niCodeInflight.set(key, promise);
    return promise;
  }

  // Sniffer: serap respons non-invoice dari request aplikasi sendiri
  // (Id -> Code gratis + template URL lengkap dengan filter tanggal)
  function installNonInvoiceSniffer() {
    if (window.__lgNiSnifferPatched) return;
    window.__lgNiSnifferPatched = true;

    const isNiEndpoint = (url) => {
      return (
        typeof url === 'string' &&
        (url.indexOf('purchasing/detail-non-invoice') !== -1 ||
          url.indexOf('purchasing/non-invoice') !== -1)
      );
    };

    const absorb = (url, text) => {
      try {
        const isDetail = url.indexOf('purchasing/detail-non-invoice') !== -1;
        const json = JSON.parse(text);

        // Hanya list detail yang dipetakan Id -> Code (ruang Id-nya beda dengan list pembayaran)
        if (isDetail) rememberNiItems(json);
      } catch (e) {
        // ignore
      }
    };

    try {
      const origOpen = XMLHttpRequest.prototype.open;

      XMLHttpRequest.prototype.open = function (method, url) {
        try {
          if (isNiEndpoint(url)) {
            this.__lgNiUrl = url;
          }
        } catch (e) {
          // ignore
        }

        return origOpen.apply(this, arguments);
      };

      const origSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.send = function () {
        if (this.__lgNiUrl) {
          const url = this.__lgNiUrl;

          this.addEventListener('load', function () {
            try {
              absorb(url, this.responseText);
            } catch (e) {
              // ignore
            }
          });
        }

        return origSend.apply(this, arguments);
      };
    } catch (e) {
      // ignore
    }

    try {
      const origFetch = window.fetch;

      if (typeof origFetch === 'function') {
        window.fetch = function (input, init) {
          let url = '';

          try {
            url = typeof input === 'string' ? input : (input && input.url) || '';
          } catch (e) {
            // ignore
          }

          const promise = origFetch.apply(this, arguments);

          if (isNiEndpoint(url)) {
            promise
              .then((res) => {
                try {
                  res.clone().text().then((text) => absorb(url, text)).catch(() => {});
                } catch (e) {
                  // ignore
                }
              })
              .catch(() => {});
          }

          return promise;
        };
      }
    } catch (e) {
      // ignore
    }
  }

  function fillRows(rows, paymentMap) {
    rows.forEach((row) => {
      const code = getRowCode(row);
      const data = paymentMap[code];

      const methodCell = row.querySelector(`td.${METHOD_CELL_CLASS}`);

      if (methodCell) {
        const methodText = data ? (data.m || '') : '';
        setText(methodCell, methodText);
        setTitle(methodCell, methodText);
      }
    });
  }

  function fillRowsByMap(rows, payments) {
    rows.forEach((row) => {
      const data = payments.get(row);

      const methodCell = row.querySelector(`td.${METHOD_CELL_CLASS}`);

      if (methodCell) {
        const methodText = data ? (data.m || '') : '';
        setText(methodCell, methodText);
        setTitle(methodCell, methodText);
      }
    });
  }

  function ensureFooter(table) {
    let tfoot = table.querySelector('tfoot');

    if (!tfoot) {
      tfoot = document.createElement('tfoot');
      tfoot.classList.add('mat-table-sticky');
      setStyle(tfoot, 'position', 'sticky');
      setStyle(tfoot, 'bottom', '0px');
      setStyle(tfoot, 'zIndex', '10');
      table.appendChild(tfoot);
    }

    tfoot.classList.add('gold-pay-footer');

    tfoot.querySelectorAll('tr.gold-total-footer-row').forEach((el) => el.remove());

    const existing = tfoot.querySelectorAll(`tr.${FOOTER_ROW_CLASS}`);
    existing.forEach((row, idx) => {
      if (idx > 0) row.remove();
    });

    let tr = tfoot.querySelector(`tr.${FOOTER_ROW_CLASS}`);

    if (!tr) {
      tr = document.createElement('tr');
      tr.className = `mat-footer-row ${FOOTER_ROW_CLASS}`;
      tr.setAttribute('role', 'row');
      tfoot.appendChild(tr);
    }

    return tr;
  }

  function getLabelIndex(headerCells) {
    let idx = headerCells.findIndex((th) => {
      return (
        th.classList.contains('mat-table-sticky') &&
        (th.style.left === '0px' || th.style.left === '0')
      );
    });

    if (idx === -1) {
      idx = headerCells.findIndex((th) => th.classList.contains('mat-table-sticky'));
    }

    if (idx === -1) idx = 0;

    return idx;
  }

  function buildFooterCells(tr, headerCells) {
    tr.textContent = '';

    headerCells.forEach(() => {
      const td = document.createElement('td');
      td.className = 'mat-cell mat-footer-cell';
      td.setAttribute('role', 'gridcell');
      tr.appendChild(td);
    });
  }

  function alignFooterCells(table, tr, headerCells, labelIdx) {
    if (!tr || tr.childElementCount !== headerCells.length) return;

    const metrics = headerCells.map((th) => {
      const rect = th.getBoundingClientRect();
      const cs = getComputedStyle(th);

      return {
        width: rect.width,
        flexGrow: cs.flexGrow,
        flexShrink: cs.flexShrink,
        textAlign: cs.textAlign
      };
    });

    Array.from(tr.children).forEach((td, i) => {
      const th = headerCells[i];
      if (!td || !th || !metrics[i]) return;

      const hadNeg = td.classList.contains(FOOTER_NEG_CLASS);

      let cls = 'mat-cell mat-footer-cell';

      if (i === labelIdx) {
        cls += ` ${FOOTER_LABEL_CLASS}`;
      }

      Array.from(th.classList).forEach((c) => {
        if (
          c.startsWith('cdk-column-') ||
          c.startsWith('mat-column-') ||
          c.startsWith('text-') ||
          c === METHOD_CELL_CLASS ||
          c === AMOUNT_CELL_CLASS ||
          c === 'mat-table-sticky'
        ) {
          cls += ` ${c}`;
        }
      });

      if (hadNeg) {
        cls += ` ${FOOTER_NEG_CLASS}`;
      }

      td.className = cls;

      const w = `${Math.max(metrics[i].width, 0)}px`;

      setStyle(td, 'boxSizing', 'border-box');
      setStyle(td, 'width', w);
      setStyle(td, 'minWidth', w);
      setStyle(td, 'maxWidth', w);

      let alignText = metrics[i].textAlign;

      const sumCol = SUM_COLUMNS.find((c) => {
        return (
          th.classList.contains(`mat-column-${c.key}`) ||
          th.classList.contains(`cdk-column-${c.key}`)
        );
      });

      if (sumCol) {
        alignText = 'right';
      }

      if (th.classList.contains(METHOD_HEADER_CLASS)) {
        alignText = 'left';
      }

      if (th.classList.contains(AMOUNT_HEADER_CLASS)) {
        alignText = 'right';
      }

      setStyle(td, 'textAlign', alignText);

      if (metrics[i].flexGrow) {
        setStyle(td, 'flexGrow', metrics[i].flexGrow);
      }

      if (metrics[i].flexShrink) {
        setStyle(td, 'flexShrink', metrics[i].flexShrink);
      }

      setStyle(td, 'flexBasis', w);
    });

    let stickyLeft = 0;

    Array.from(tr.children).forEach((td, i) => {
      const th = headerCells[i];
      if (!td || !th || !metrics[i]) return;

      if (th.classList.contains('mat-table-sticky')) {
        td.classList.add('mat-table-sticky');
        setStyle(td, 'position', 'sticky');
        setStyle(td, 'left', `${stickyLeft}px`);
        setStyle(td, 'zIndex', i === labelIdx ? '70' : '65');

        stickyLeft += metrics[i].width;
      } else {
        td.classList.remove('mat-table-sticky');
        setStyle(td, 'left', '');
        setStyle(td, 'zIndex', '');
      }
    });
  }

  function renderFooter(table, rows, sums, paymentMap, codes) {
    const tr = ensureFooter(table);

    const headerCells = Array.from(
      table.querySelectorAll('thead tr.mat-header-row th.mat-header-cell')
    );

    const totalColumns = headerCells.length;
    if (!totalColumns) return;

    const labelIdx = getLabelIndex(headerCells);
    const structSig = `${totalColumns}:${labelIdx}`;

    if (tr.dataset.structSig !== structSig || tr.childElementCount !== totalColumns) {
      buildFooterCells(tr, headerCells);
      tr.dataset.structSig = structSig;
    }

    for (let i = 0; i < totalColumns; i++) {
      const td = tr.children[i];
      const th = headerCells[i];

      if (!td || !th) continue;

      if (i === labelIdx) {
        setText(td, `TOTAL (${rows.length} baris)`);
        continue;
      }

      if (th.classList.contains(METHOD_HEADER_CLASS)) {
        setText(td, '');
        setTitle(td, '');
        continue;
      }

      if (th.classList.contains(AMOUNT_HEADER_CLASS)) {
        setText(td, '');
        setTitle(td, '');
        continue;
      }

      const col = SUM_COLUMNS.find((c) => {
        return (
          th.classList.contains(`mat-column-${c.key}`) ||
          th.classList.contains(`cdk-column-${c.key}`)
        );
      });

      if (col) {
        const value = sums[col.key] || 0;
        const text = col.type === 'weight' ? fmtWeight(value) : fmtMoney(value);

        setText(td, text);
        td.classList.toggle(FOOTER_NEG_CLASS, value < 0);
      } else {
        setText(td, '');
      }
    }

    alignFooterCells(table, tr, headerCells, labelIdx);
  }

  function fillNonInvoiceFooterTotals(table) {
    try {
      const tr = table.querySelector('tfoot tr.gold-total-footer-row');
      if (!tr) return;

      const headerCells = Array.from(
        table.querySelectorAll('thead tr.mat-header-row th.mat-header-cell')
      );
      const methodIdx = headerCells.findIndex((th) => th.classList.contains(METHOD_HEADER_CLASS));
      const amountIdx = headerCells.findIndex((th) => th.classList.contains(AMOUNT_HEADER_CLASS));

      if (methodIdx !== -1 && tr.children[methodIdx]) {
        setText(tr.children[methodIdx], '');
        setTitle(tr.children[methodIdx], '');
      }

      if (amountIdx !== -1 && tr.children[amountIdx]) {
        setText(tr.children[amountIdx], '');
        setTitle(tr.children[amountIdx], '');
      }
    } catch (e) {
      // ignore
    }
  }

  function processNonInvoiceRows(table, rows) {
    const payments = new Map();
    const needResolve = [];
    const needPayment = [];

    rows.forEach((row) => {
      const code = getRowCode(row);

      if (code && /^PC/i.test(code)) {
        // Kolom code tersedia: pakai kode PC langsung
        const cached = getCache(code, true);

        if (cached) {
          payments.set(row, cached);
        } else if (!inflight.has(scoped(code, true)) && !isTempEmpty(code, true)) {
          needPayment.push(code);
        }

        return;
      }

      // Fallback: resolve Id baris -> Code PC
      const id = getRowId(row);
      if (!id) return;

      const mapped = getNiCode(id);

      if (mapped) {
        const cached = getCache(mapped, true);

        if (cached) {
          payments.set(row, cached);
        } else if (!inflight.has(scoped(mapped, true)) && !isTempEmpty(mapped, true)) {
          needPayment.push(mapped);
        }
      } else if (!isNiCodeEmpty(id) && !niCodeInflight.has(id)) {
        needResolve.push(id);
      }
    });

    domWrite(() => {
      rows.forEach(ensureRowCells);
      fillRowsByMap(rows, payments);
      fillNonInvoiceFooterTotals(table);
    });

    // Footer TOTAL dikelola Module 2; di sini cukup kolom per baris

    const jobs = [];

    needResolve.forEach((id) => {
      jobs.push(
        resolveNonInvoiceCode(id)
          .then((code) => (code ? fetchPayment(code, true) : null))
          .catch(() => {})
      );
    });

    needPayment.forEach((code) => {
      jobs.push(
        fetchPayment(code, true).catch(() => {})
      );
    });

    if (jobs.length) {
      Promise.all(jobs)
        .then(() => {
          scheduleUpdate(50);
        })
        .catch(() => {
          // ignore
        });
    }
  }

  function processTable(table) {
    if (!table || table.offsetParent === null) return;

    const state = getState(table);
    if (state.processing) return;

    state.processing = true;

    try {
      const nonInvoice = isNonInvoiceTable(table);

      if (!state.legacyCleaned) {
        state.legacyCleaned = true;

        domWrite(() => {
          cleanupLegacy(table, nonInvoice);
        });
      }

      let columnsOk = false;

      domWrite(() => {
        columnsOk = ensureHeaderColumns(table);
      });

      if (!columnsOk) return;

      const rows = getVisibleRows(table);
      if (!rows.length) return;

      if (nonInvoice) {
        processNonInvoiceRows(table, rows);
        return;
      }

      const sums = computeSums(rows);
      const codes = getUniqueCodes(rows);

      const paymentMap = Object.create(null);

      codes.forEach((code) => {
        const cached = getCache(code, false);
        if (cached) {
          paymentMap[code] = cached;
        }
      });

      domWrite(() => {
        rows.forEach(ensureRowCells);
        fillRows(rows, paymentMap);
        renderFooter(table, rows, sums, paymentMap, codes);
      });

      const missing = codes.filter((code) => {
        return !paymentMap[code] && !inflight.has(scoped(code, false)) && !isTempEmpty(code, false);
      });

      if (missing.length) {
        Promise.all(missing.map(fetchPayment))
          .then(() => {
            scheduleUpdate(50);
          })
          .catch(() => {
            // ignore
          });
      }
    } catch (err) {
      console.warn('[GoldPayDetailV4] process error', err);
    } finally {
      state.processing = false;
    }
  }

  function stripPurchasingInjects() {
    niCodeCache.clear();
    document.querySelectorAll(
      'th.gold-pay-method-header, td.gold-pay-method, th.gold-pay-amount-header, td.gold-pay-amount'
    ).forEach((el) => el.remove());
    document.querySelectorAll(
      'tfoot tr.gold-pay-footer-row, tfoot tr.gold-total-footer-row'
    ).forEach((el) => el.remove());
  }

  function updateAll() {
    if (document.hidden) return;
    if (LG.isPurchasingFamilyChild(location.pathname)) {
      stripPurchasingInjects();
      return;
    }
    if (!LG.isPaymentInjectPage(location.pathname)) return;

    pruneNegativeCache();

    try {
      injectStyle();

      const tables = getTargetTables();
      if (!tables.length) return;

      tables.forEach(processTable);
    } catch (err) {
      console.warn('[GoldPayDetailV4] update error', err);
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (suppressObserver || document.hidden) return;

    const relevant = mutations.some((m) => {
      return (
        m.type === 'childList' ||
        (m.type === 'attributes' && m.attributeName === 'data-val')
      );
    });

    if (relevant) {
      scheduleUpdate(300);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-val']
  });

  window.addEventListener('resize', () => {
    scheduleUpdate(200);
  });

  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      storageCache = loadStorageCache();
      memCache.clear();
      tempEmpty.clear();
      niCodeEmpty.clear();
      pruneNegativeCache();
      scheduleUpdate(100);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      scheduleUpdate(0);
    }
  });

  installNonInvoiceSniffer();

  scheduleUpdate(0);

  setInterval(() => {
    scheduleUpdate(0);
  }, 5000);
})();

// ==========================================
// MODULE 2: Gold ERP - Total Bawah Tabel (Other Pages)
// ==========================================
(() => {
if (window.__goldTotalFooterInjected) return;
window.__goldTotalFooterInjected = true;
const STYLE_ID = 'gold-total-footer-style';
const ROW_CLASS = 'gold-total-footer-row';
const COLUMNS = [
{ key: 'weightNote',      label: 'Berat Di Nota',  type: 'weight' },
{ key: 'weightReal',      label: 'Berat Real',     type: 'weight' },
{ key: 'totalPrice',      label: 'Harga',          type: 'money'  },
{ key: 'cost',            label: 'Ongkos',         type: 'money'  },
{ key: 'discountPrice',   label: 'Potongan',       type: 'money'  },
{ key: 'notePrice',       label: 'Harga Nota',     type: 'money'  },
{ key: 'purchasePrice',   label: 'Harga Beli',     type: 'money'  },
{ key: 'differencePrice', label: 'Selisih Harga',  type: 'money'  }
];
function injectStyle() {
if (document.getElementById(STYLE_ID)) return;
const style = document.createElement('style');
style.id = STYLE_ID;
style.textContent = `
.${ROW_CLASS} td {
background: #fffbe8 !important;
font-weight: 800;
color: #15151c;
border-top: 2px solid #e3b53d !important;
white-space: nowrap;
position: sticky;
bottom: 0;
z-index: 60;
}
.${ROW_CLASS} td.gold-total-label {
background: #fff3c9 !important;
color: #7c5c00;
text-align: left !important;
padding-left: 16px !important;
font-size: 13px;
z-index: 70 !important;
white-space: nowrap !important;
font-weight: 800;
}
.${ROW_CLASS} td.gold-total-value {
text-align: right !important;
font-variant-numeric: tabular-nums;
}
.${ROW_CLASS} td.gold-total-negative {
color: #d2453a !important;
}
tfoot {
display: table-footer-group;
}
`;
document.head.appendChild(style);
}
const normalize = (s) => {
return (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
};
function parseCell(cell) {
if (!cell) return 0;
return LG.parseIdNumber(cell.textContent);
}
const fmtMoney = (n) => {
return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(n));
};
const fmtWeight = (n) => {
return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n)} gr`;
};
function isTargetTable(table) {
  if (!table.querySelector('th.mat-column-purchasePrice, td.mat-column-purchasePrice, th.cdk-column-purchasePrice, td.cdk-column-purchasePrice')) {
    return false;
  }
  if (table.tagName !== 'TABLE') return false;
  if (table.closest('m-purchasing-head-table')) return false;
  
  // Exclude tables handled by Payment Detail module (Purchasing pages)
  if (
    table.querySelector('th.mat-column-code, td.mat-column-code, th.cdk-column-code, td.cdk-column-code') &&
    table.querySelector('th.mat-column-discountPrice, td.mat-column-discountPrice, th.cdk-column-discountPrice, td.cdk-column-discountPrice') &&
    table.querySelector('th.mat-column-notePrice, td.mat-column-notePrice, th.cdk-column-notePrice, td.cdk-column-notePrice')
  ) {
    return false;
  }
  return true;
}
function ensureFooterRow(table) {
let tfoot = table.querySelector('tfoot');
if (!tfoot) {
tfoot = document.createElement('tfoot');
table.appendChild(tfoot);
}
let tr = tfoot.querySelector(`tr.${ROW_CLASS}`);
if (!tr) {
tr = document.createElement('tr');
tr.className = `mat-footer-row ${ROW_CLASS}`;
tr.setAttribute('role', 'row');
tfoot.appendChild(tr);
}
return tr;
}
function renderTable(table) {
const tr = ensureFooterRow(table);
const rows = Array.from(table.querySelectorAll('tbody tr.mat-row'));
const headerCells = Array.from(table.querySelectorAll('thead tr.mat-header-row th.mat-header-cell'));
const totalColumns = headerCells.length;
if (totalColumns === 0) return;
const sums = {};
COLUMNS.forEach((col) => {
sums[col.key] = 0;
});
rows.forEach((row) => {
COLUMNS.forEach((col) => {
const cell = row.querySelector(`td.mat-column-${col.key}, td.cdk-column-${col.key}`);
sums[col.key] += parseCell(cell);
});
});
COLUMNS.forEach((col) => {
if (col.type === 'weight') {
sums[col.key] = Math.round(sums[col.key] * 100) / 100;
} else {
sums[col.key] = Math.round(sums[col.key]);
}
});
const signature = JSON.stringify({
c: rows.length,
n: totalColumns,
s: sums
});
if (tr.dataset.signature === signature) return;
const positions = {};
COLUMNS.forEach((col) => {
let idx = headerCells.findIndex((th) => {
return (
th.classList.contains(`mat-column-${col.key}`) ||
th.classList.contains(`cdk-column-${col.key}`)
);
});
if (idx === -1) {
idx = headerCells.findIndex((th) => normalize(th.textContent) === normalize(col.label));
}
if (idx !== -1) {
positions[col.key] = idx;
}
});
let labelIdx = headerCells.findIndex(th =>
th.classList.contains('mat-table-sticky') &&
(th.style.left === '0px' || th.style.left === '0')
);
if (labelIdx === -1) {
labelIdx = headerCells.findIndex(th => th.classList.contains('mat-table-sticky'));
}
if (labelIdx === -1) labelIdx = 0;
tr.innerHTML = '';
for (let i = 0; i < totalColumns; i++) {
const td = document.createElement('td');
td.className = 'mat-cell mat-footer-cell gold-total-value';
td.setAttribute('role', 'gridcell');
const col = COLUMNS.find(c => positions[c.key] === i);
const th = headerCells[i];
const isSticky = th && th.classList.contains('mat-table-sticky');
if (i === labelIdx) {
td.textContent = `TOTAL (${rows.length} baris)`;
td.classList.remove('gold-total-value');
td.classList.add('gold-total-label');
td.style.textAlign = 'left';
td.style.paddingLeft = '16px';
} else if (col) {
const value = sums[col.key];
const text = col.type === 'weight' ? fmtWeight(value) : fmtMoney(value);
td.textContent = text;
td.classList.add(`gold-total-${col.key}`);
td.classList.add(`mat-column-${col.key}`);
if (value < 0) td.classList.add('gold-total-negative');
} else {
td.textContent = '';
}
if (isSticky) {
td.classList.add('mat-table-sticky');
td.style.position = 'sticky';
td.style.left = th.style.left;
td.style.zIndex = (i === labelIdx) ? '70' : '62';
td.style.backgroundColor = (i === labelIdx) ? '#fff3c9' : '#fffbe8';
}
tr.appendChild(td);
}
tr.dataset.signature = signature;
}
function stripYellowFooter() {
document.querySelectorAll('tfoot tr.gold-total-footer-row').forEach((el) => el.remove());
}
function updateAll() {
if (LG.isPurchasingFamilyChild(location.pathname)) {
stripYellowFooter();
return;
}
injectStyle();
const tables = Array
.from(document.querySelectorAll('table.mat-table'))
.filter(isTargetTable);
tables.forEach(renderTable);
}
function debounce(fn, ms) {
let timer;
return (...args) => {
clearTimeout(timer);
timer = setTimeout(() => fn(...args), ms);
};
}
const safeUpdate = debounce(() => {
if (window.__goldTotalUpdating) return;
window.__goldTotalUpdating = true;
try {
updateAll();
} finally {
setTimeout(() => {
window.__goldTotalUpdating = false;
}, 0);
}
}, 180);
const observer = new MutationObserver(() => {
if (!window.__goldTotalUpdating) {
safeUpdate();
}
});
observer.observe(document.documentElement, {
childList: true,
subtree: true,
characterData: true,
attributes: true,
attributeFilter: ['data-val', 'class']
});
updateAll();
setInterval(safeUpdate, 2500);
})();

// ==========================================
// MODULE 3: LiaGold Suite (Totalizer + Scanner)
// ==========================================
(function () {
'use strict';
if (window.__lgSuite) return;
window.__lgSuite = true;
const TOTAL_PAGES = [
/^\/sales\/?$/,
/^\/sales-cancel\/?$/,
/^\/purchasing\/?$/,
/^\/purchasing-non-invoice\/?$/,
/^\/money-balance\/?$/,
/^\/repair\/?$/,
/^\/order\/?$/,
/^\/tokenizer\/?$/,
];
const SCANNER_PAGES = [
/^\/stock-opname\/?$/,
/^\/stock-opname\/create\/?$/,
/^\/product-daily\/?$/,
/^\/product\/?$/,
];
const isTotalPage = () => TOTAL_PAGES.some((re) => re.test(location.pathname));
const isScannerPage = () => SCANNER_PAGES.some((re) => re.test(location.pathname));
const suiteStyle = document.createElement('style');
suiteStyle.textContent = `html:not(.lgs-scanner-on) #lg-panel, html:not(.lgs-scanner-on) #lg-fab, html:not(.lgs-scanner-on) #lg-img-overlay { display: none !important; }`;
document.documentElement.appendChild(suiteStyle);
let totalStarted = false;
let scannerStarted = false;
function applyRouteClasses() {
document.documentElement.classList.toggle('lgs-scanner-on', isScannerPage());
}
function startTotalizer() {
if (totalStarted) return;
totalStarted = true;
(function () {
'use strict';
if (window.__lgTotalizer) return;
window.__lgTotalizer = true;
const PAGES = [
{ re: /^\/sales\/?$/,                   label: 'Sales' },
{ re: /^\/sales-cancel\/?$/,            label: 'Sales Cancel' },
{ re: /^\/purchasing\/?$/,              label: 'Purchasing' },
{ re: /^\/purchasing-non-invoice\/?$/,  label: 'Purchasing Non-Invoice' },
{ re: /^\/money-balance\/?$/,           label: 'Money Balance' },
{ re: /^\/repair\/?$/,                  label: 'Repair' },
{ re: /^\/order\/?$/,                   label: 'Order' },
{ re: /^\/tokenizer\/?$/,               label: 'Tokenizer' },
];
function detectPage() {
const path = location.pathname;
for (const p of PAGES) if (p.re.test(path)) return p.label;
return null;
}
const isAllowedPage = () => detectPage() !== null;
const style = document.createElement('style');
style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap');
html:not(.lgt-page-on) #lgt-fab,
html:not(.lgt-page-on) #lgt-panel,
html:not(.lgt-page-on) #lgt-toast{ display:none !important; }
.lgt-num{
cursor:pointer; border-radius:4px;
text-decoration:underline dotted rgba(21,21,28,.18);
text-underline-offset:2px; text-decoration-thickness:1px;
box-decoration-break:clone; -webkit-box-decoration-break:clone;
-webkit-user-select:none; user-select:none; white-space:nowrap;
transition:background .14s ease, box-shadow .14s ease, color .14s ease;
}
.lgt-num:hover{ background:rgba(189,138,6,.10); text-decoration-color:#bd8a06; }
.lgt-num.lgt-sel{ background:#fcf5e2; color:#7c5c00; font-weight:700; text-decoration:none; box-shadow:0 0 0 1.5px #ecca63; }
.lgt-num.lgt-sel.lgt-neg{ background:#fdeceb; color:#d2453a; box-shadow:0 0 0 1.5px #f0a59f; }
.lgt-num.lgt-sel.lgt-neg::before{ content:'−'; margin-right:1px; font-weight:700; }
#lgt-fab{
position:fixed; right:22px; bottom:22px; z-index:2147483002;
width:54px; height:54px; border-radius:50%;
background:#fff; color:#15151c; border:1px solid #e8e8ee;
box-shadow:0 2px 6px rgba(16,16,29,.10), 0 12px 28px -10px rgba(16,16,29,.25);
cursor:pointer; padding:0;
transition:transform .18s cubic-bezier(.2,.85,.25,1), box-shadow .2s, background .2s, color .2s;
animation:lgtFabIn .45s .1s cubic-bezier(.2,.85,.25,1) both;
}
@keyframes lgtFabIn{ from{opacity:0;transform:translateY(16px) scale(.7);} to{opacity:1;transform:none;} }
#lgt-fab:hover{ transform:translateY(-2px) scale(1.05); box-shadow:0 4px 10px rgba(16,16,29,.12), 0 18px 36px -12px rgba(16,16,29,.30); }
#lgt-fab:active{ transform:scale(.96); }
#lgt-fab.lgt-active{ background:#15151c; color:#fff; border-color:#15151c; }
#lgt-fab .lgt-glyph{
position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
font-family:'Space Grotesk',sans-serif; font-size:23px; font-weight:700;
transition:opacity .22s, transform .28s cubic-bezier(.2,.85,.25,1);
}
#lgt-fab .lgt-glyph-close{ opacity:0; transform:rotate(-90deg) scale(.5); }
#lgt-fab.lgt-active .lgt-glyph-open{ opacity:0; transform:rotate(90deg) scale(.5); }
#lgt-fab.lgt-active .lgt-glyph-close{ opacity:1; transform:none; }
#lgt-fab.lgt-nudge{ animation:lgtNudge .35s ease; }
@keyframes lgtNudge{ 0%{transform:scale(1);} 30%{transform:scale(1.14);} 100%{transform:scale(1);} }
#lgt-fab .lgt-badge{
position:absolute; top:-4px; right:-4px; min-width:20px; height:20px; padding:0 5px;
border-radius:999px; background:#e3b53d; color:#241c00; border:2px solid #fff;
font:700 10.5px/16px 'Plus Jakarta Sans',sans-serif; text-align:center;
display:none; box-sizing:border-box;
}
#lgt-fab .lgt-badge.lgt-show{ display:block; animation:lgtBadgePop .3s ease; }
@keyframes lgtBadgePop{ 0%{transform:scale(.4);} 60%{transform:scale(1.18);} 100%{transform:scale(1);} }
#lgt-panel{
position:fixed; right:22px; bottom:90px; z-index:2147483000;
width:322px; max-width:calc(100vw - 28px);
background:#fff; color:#15151c; border:1px solid #e8e8ee; border-radius:18px;
box-shadow:0 10px 24px -10px rgba(16,16,29,.16), 0 30px 60px -24px rgba(16,16,29,.18);
font-family:'Plus Jakarta Sans',sans-serif; overflow:hidden;
opacity:0; visibility:hidden; transform:translateY(14px) scale(.97); pointer-events:none;
transition:opacity .25s, transform .28s cubic-bezier(.2,.85,.25,1), visibility .25s;
}
#lgt-panel.lgt-open{ opacity:1; visibility:visible; transform:none; pointer-events:auto; }
#lgt-panel::before{ content:''; position:absolute; top:0; left:0; right:0; height:3px; background:linear-gradient(90deg,#e3b53d,#bd8a06,#e3b53d); }
#lgt-panel .lgt-head{ display:flex; align-items:center; gap:9px; padding:13px 15px 12px; cursor:grab; border-bottom:1px solid #f1f1f5; }
#lgt-panel .lgt-head:active{ cursor:grabbing; }
#lgt-panel .lgt-dot{ width:8px; height:8px; border-radius:50%; background:#bd8a06; animation:lgtPulse 2.4s infinite; flex:none; }
@keyframes lgtPulse{ 0%{box-shadow:0 0 0 0 rgba(189,138,6,.45);} 70%{box-shadow:0 0 0 7px rgba(189,138,6,0);} 100%{box-shadow:0 0 0 0 rgba(189,138,6,0);} }
#lgt-panel .lgt-title{ font-family:'Space Grotesk',sans-serif; font-size:11.5px; font-weight:600; letter-spacing:.16em; text-transform:uppercase; color:#565661; }
#lgt-panel .lgt-page{
margin-left:auto; font-family:'Space Grotesk',sans-serif; font-size:9.5px; font-weight:700;
letter-spacing:.1em; text-transform:uppercase; color:#7c5c00;
background:#fcf5e2; border:1px solid #ecca63; border-radius:999px;
padding:3px 9px; line-height:1.2; white-space:nowrap;
}
#lgt-panel .lgt-page.lgt-pop{ animation:lgtPagePop .32s cubic-bezier(.2,.85,.25,1); }
@keyframes lgtPagePop{ 0%{transform:scale(.5);opacity:0;} 60%{transform:scale(1.15);} 100%{transform:scale(1);opacity:1;} }
#lgt-panel .lgt-close{ width:26px; height:26px; border:1px solid #e8e8ee; border-radius:8px; cursor:pointer; background:#fff; color:#565661; font-size:15px; line-height:1; flex:none; }
#lgt-panel .lgt-close:hover{ background:#fdeceb; color:#d2453a; border-color:#f0a59f; }
#lgt-panel .lgt-body{ padding:14px 16px 16px; }
#lgt-panel .lgt-total{ font-family:'Space Grotesk',sans-serif; font-size:30px; font-weight:700; letter-spacing:-.5px; color:#15151c; font-variant-numeric:tabular-nums; display:flex; align-items:baseline; gap:7px; }
#lgt-panel .lgt-cur{ font-size:15px; font-weight:600; color:#90909b; }
#lgt-panel .lgt-total.lgt-pop #lgt-total-num{ animation:lgtPop .28s ease; }
@keyframes lgtPop{ 0%{transform:scale(1);} 35%{transform:scale(1.06);color:#bd8a06;} 100%{transform:scale(1);} }
#lgt-panel .lgt-meta{ margin-top:6px; font-size:11.5px; color:#90909b; }
#lgt-panel .lgt-meta b{ color:#565661; }
#lgt-panel .lgt-negcount{ color:#d2453a; }
#lgt-panel .lgt-actions{ display:flex; gap:7px; margin-top:13px; }
#lgt-panel .lgt-actions button{ flex:1; padding:9px 6px; border-radius:10px; cursor:pointer; font-family:inherit; font-size:11px; font-weight:700; border:1px solid #e8e8ee; background:#fff; color:#565661; transition:.15s; }
#lgt-panel .lgt-actions button:hover{ transform:translateY(-1px); box-shadow:0 4px 12px -4px rgba(16,16,29,.18); color:#15151c; }
#lgt-panel .lgt-actions .lgt-primary{ background:#15151c; color:#fff; border-color:#15151c; }
#lgt-panel .lgt-actions .lgt-primary:hover{ background:#000; }
#lgt-panel .lgt-hint{ margin-top:12px; padding-top:11px; border-top:1px solid #f1f1f5; font-size:10.5px; line-height:1.55; color:#90909b; }
#lgt-panel .lgt-hint b{ color:#565661; }
#lgt-toast{ position:fixed; left:50%; bottom:30px; transform:translateX(-50%) translateY(16px); z-index:2147483003; padding:10px 18px; border-radius:999px; background:#15151c; color:#fff; font:600 12.5px/1 'Plus Jakarta Sans',sans-serif; box-shadow:0 12px 30px -8px rgba(16,16,29,.4); opacity:0; pointer-events:none; transition:.25s; }
#lgt-toast.lgt-show{ opacity:1; transform:translateX(-50%) translateY(0); }
#lgt-toast .lgt-tick{ color:#e3b53d; margin-right:6px; }
`;
document.documentElement.appendChild(style);
const fab = document.createElement('button');
fab.id = 'lgt-fab';
fab.type = 'button';
fab.innerHTML = `<span class="lgt-glyph lgt-glyph-open">Σ</span><span class="lgt-glyph lgt-glyph-close">×</span><span class="lgt-badge" id="lgt-badge">0</span>`;
document.documentElement.appendChild(fab);
const panel = document.createElement('div');
panel.id = 'lgt-panel';
panel.innerHTML = `
<div class="lgt-head" id="lgt-head">
<span class="lgt-dot"></span>
<span class="lgt-title">Total Pilihan</span>
<span class="lgt-page" id="lgt-page">—</span>
<button class="lgt-close" id="lgt-close" title="Tutup">×</button>
</div>
<div class="lgt-body">
<div class="lgt-total" id="lgt-total"><span class="lgt-cur">Rp</span><span id="lgt-total-num">0</span></div>
<div class="lgt-meta"><b id="lgt-count">0</b> nominal dipilih <span id="lgt-negcount" class="lgt-negcount" hidden></span></div>
<div class="lgt-actions">
<button id="lgt-all" class="lgt-primary">Pilih Semua</button>
<button id="lgt-copy">Salin</button>
<button id="lgt-reset">Reset</button>
</div>
<div class="lgt-hint">Klik angka: <b>1×</b> tambah · <b>2×</b> kurang · <b>3×</b> lepas.</div>
</div>`;
document.documentElement.appendChild(panel);
const toast = document.createElement('div');
toast.id = 'lgt-toast';
document.documentElement.appendChild(toast);
const badge = fab.querySelector('#lgt-badge');
const totalEl = panel.querySelector('#lgt-total');
const totalNumEl = panel.querySelector('#lgt-total-num');
const curEl = panel.querySelector('.lgt-cur');
const countEl = panel.querySelector('#lgt-count');
const negCountEl = panel.querySelector('#lgt-negcount');
const pageEl = panel.querySelector('#lgt-page');
let open = false;
function setOpen(v) {
open = v;
panel.classList.toggle('lgt-open', v);
fab.classList.toggle('lgt-active', v);
}
fab.addEventListener('click', (e) => {
e.stopPropagation();
setOpen(!open);
});
panel.querySelector('#lgt-close').addEventListener('click', (e) => {
e.stopPropagation();
setOpen(false);
});
const fmt = (n) => Math.abs(n).toLocaleString('id-ID');
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let prevCount = 0;
let lastSum = 0;
const selectionMemory = new Map();
function getSelectionKey(span) {
const row = span.closest('mat-row, .mat-row, tr');
const cell = span.closest('mat-cell, .mat-cell, td');
let rowCode = '';
let rowId = '';
if (row) {
const codeCell = row.querySelector('td.mat-column-code, td.cdk-column-code, .mat-column-code');
const idCell = row.querySelector('td.mat-column-id, td.cdk-column-id, .mat-column-id');
if (codeCell) rowCode = codeCell.textContent.trim();
if (idCell) rowId = idCell.textContent.trim();
}
const colClass = cell ? Array.from(cell.classList).filter((c) => c.startsWith('mat-column-')).join(',') : '';
const val = span.dataset.lgtVal || '';
const grp = span.dataset.grp || '';
return LG.buildSelectionKey({ rowCode, rowId, colClass, val, grp });
}
function saveSelection(span, neg) {
const key = getSelectionKey(span);
selectionMemory.set(key, { val: span.dataset.lgtVal, neg: !!neg });
}
function removeSelection(span) {
const key = getSelectionKey(span);
selectionMemory.delete(key);
}
function reapplySelections() {
document.querySelectorAll('.lgt-num').forEach(span => {
const key = getSelectionKey(span);
if (selectionMemory.has(key)) {
const mem = selectionMemory.get(key);
span.classList.add('lgt-sel');
if (mem.neg) span.classList.add('lgt-neg');
}
});
}
function clearAllSelections() {
selectionMemory.clear();
document.querySelectorAll('.lgt-num.lgt-sel').forEach(s => {
s.classList.remove('lgt-sel', 'lgt-neg');
});
}
function update(skipAnimation = false) {
const sels = [...document.querySelectorAll('.lgt-num.lgt-sel')];
let sum = 0;
let neg = 0;
sels.forEach((s) => {
const v = +s.dataset.lgtVal || 0;
if (s.classList.contains('lgt-neg')) {
sum -= v;
neg++;
} else {
sum += v;
}
});
const previousSum = lastSum;
lastSum = sum;
curEl.textContent = sum < 0 ? '−Rp' : 'Rp';
totalNumEl.textContent = fmt(sum);
if (!skipAnimation && previousSum !== sum) {
totalEl.classList.remove('lgt-pop');
void totalEl.offsetWidth;
totalEl.classList.add('lgt-pop');
}
countEl.textContent = sels.length;
negCountEl.hidden = neg === 0;
negCountEl.textContent = '· ' + neg + ' pengurang';
badge.textContent = sels.length;
badge.classList.toggle('lgt-show', sels.length > 0);
if (sels.length > prevCount && !open) {
fab.classList.remove('lgt-nudge');
void fab.offsetWidth;
fab.classList.add('lgt-nudge');
}
prevCount = sels.length;
fab.title = (detectPage() || '') + ' — Rp ' + fmt(sum) + ' (' + sels.length + ' dipilih)';
}
function showToast(msg) {
toast.innerHTML = '<span class="lgt-tick">✓</span>' + esc(msg);
toast.classList.add('lgt-show');
clearTimeout(showToast._t);
showToast._t = setTimeout(() => toast.classList.remove('lgt-show'), 1500);
}
document.addEventListener('click', function (e) {
const span = e.target.closest && e.target.closest('.lgt-num');
if (!span) return;
if (e.target.closest('a, button, input, textarea, select')) return;
e.stopPropagation();
const grp = span.dataset.grp;
const isSel = span.classList.contains('lgt-sel');
const isNeg = span.classList.contains('lgt-neg');
if (!isSel) {
if (grp === 'T' || grp === 'R') {
const row = span.closest('mat-row, .mat-row, tr');
if (row) {
row.querySelectorAll('.lgt-num.lgt-sel[data-grp="' + (grp === 'T' ? 'R' : 'T') + '"]')
.forEach((s) => {
s.classList.remove('lgt-sel', 'lgt-neg');
removeSelection(s);
});
}
}
span.classList.add('lgt-sel');
span.classList.remove('lgt-neg');
saveSelection(span, false);
} else if (!isNeg) {
span.classList.add('lgt-neg');
saveSelection(span, true);
} else {
span.classList.remove('lgt-sel', 'lgt-neg');
removeSelection(span);
}
update();
}, false);
panel.querySelector('#lgt-all').addEventListener('click', () => {
document.querySelectorAll('.lgt-num.lgt-sel[data-grp="R"]').forEach((s) => {
s.classList.remove('lgt-sel', 'lgt-neg');
removeSelection(s);
});
document.querySelectorAll('.lgt-num[data-grp="T"]').forEach((s) => {
s.classList.add('lgt-sel');
s.classList.remove('lgt-neg');
saveSelection(s, false);
});
update();
});
panel.querySelector('#lgt-reset').addEventListener('click', () => {
clearAllSelections();
update();
});
panel.querySelector('#lgt-copy').addEventListener('click', async () => {
const txt = (lastSum < 0 ? '-' : '') + fmt(lastSum);
try {
await navigator.clipboard.writeText(txt);
showToast('Tersalin: ' + txt);
} catch (_) {
const ta = document.createElement('textarea');
ta.value = txt;
document.body.appendChild(ta);
ta.select();
document.execCommand('copy');
ta.remove();
showToast('Tersalin: ' + txt);
}
});
(function () {
const head = panel.querySelector('#lgt-head');
let d = false, sx, sy, ox, oy;
head.addEventListener('mousedown', (e) => {
if (e.target.closest('button')) return;
d = true;
const r = panel.getBoundingClientRect();
panel.style.left = r.left + 'px';
panel.style.top = r.top + 'px';
panel.style.right = 'auto';
panel.style.bottom = 'auto';
sx = e.clientX;
sy = e.clientY;
ox = r.left;
oy = r.top;
e.preventDefault();
});
addEventListener('mousemove', (e) => {
if (!d) return;
panel.style.left = Math.max(4, Math.min(ox + e.clientX - sx, innerWidth - panel.offsetWidth - 4)) + 'px';
panel.style.top = Math.max(4, Math.min(oy + e.clientY - sy, innerHeight - panel.offsetHeight - 4)) + 'px';
});
addEventListener('mouseup', () => {
d = false;
});
})();
const TABLE_ZONE = 'mat-table, .mat-table, table, [role="grid"]';
const SKIP = '#lgt-panel,#lgt-fab,#lgt-toast,.lgt-num,script,style,noscript,input,textarea,select,button,form,mat-form-field,.mat-form-field,[contenteditable],mat-dialog-container,.mat-dialog-container,mat-step,mat-expansion-panel';
function groupOf(node) {
const cell = node.parentNode ? node.parentNode.closest('mat-cell, td') : null;
if (!cell) return { grp: 'X', mode: 'strict' };
const cls = cell.className || '';
if (cls.includes('mat-column-totalReal')) return { grp: 'T', mode: 'long' };
if (cls.includes('mat-column-cashBanks')) return { grp: 'R', mode: 'long' };
if (cls.includes('mat-column-price') || cls.includes('mat-column-total') || cls.includes('mat-column-amount')) {
return { grp: 'X', mode: 'long' };
}
return { grp: 'X', mode: 'strict' };
}
let selfMutating = false;
function processTextNode(node) {
const parent = node.parentNode;
if (!parent || !parent.closest) return;
if (parent.closest(SKIP)) return;
if (!parent.closest(TABLE_ZONE)) return;
const text = node.nodeValue;
if (!text || !/\d/.test(text)) return;
const { grp, mode } = groupOf(node);
const hits = LG.findNumberHits(text, mode);
if (!hits.length) return;
const wasMutating = selfMutating;
selfMutating = true;
try {
const frag = document.createDocumentFragment();
let last = 0;
for (const h of hits) {
if (h.i > last) frag.appendChild(document.createTextNode(text.slice(last, h.i)));
const span = document.createElement('span');
span.className = 'lgt-num';
span.dataset.grp = grp;
span.dataset.lgtVal = String(LG.parseIdNumber(h.v));
span.textContent = h.v;
span.title = 'Klik: + • klik lagi: − • klik lagi: lepas';
frag.appendChild(span);
last = h.i + h.v.length;
}
if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
parent.replaceChild(frag, node);
} finally {
selfMutating = wasMutating;
}
}
let processing = false;
let lastProcessTime = 0;
let processTimer = null;
function scan(root) {
const tables = root.querySelectorAll(TABLE_ZONE);
const list = [];
tables.forEach((table) => {
const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT, {
acceptNode(n) {
const p = n.parentNode;
if (!p || !p.closest) return NodeFilter.FILTER_REJECT;
if (p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
return NodeFilter.FILTER_ACCEPT;
}
});
let n;
while ((n = walker.nextNode())) list.push(n);
});
list.forEach(processTextNode);
}
function processAll() {
if (processing) {
if (!processTimer) processTimer = setTimeout(() => { processTimer = null; processAll(); }, 500);
return;
}
if (!isAllowedPage()) return;
const delay = LG.nextProcessDelay(Date.now(), lastProcessTime, 500);
if (delay > 0) {
if (!processTimer) processTimer = setTimeout(() => { processTimer = null; processAll(); }, delay);
return;
}
lastProcessTime = Date.now();
processing = true;
obs.disconnect();
try {
scan(document.body);
reapplySelections();
update(true);
} finally {
obs.observe(document.body, { childList: true, subtree: true, characterData: true });
processing = false;
}
}
let obsTimer = null;
const obs = new MutationObserver((mutations) => {
if (selfMutating || processing) return;
if (!isAllowedPage()) return;
let relevant = false;
for (const mut of mutations) {
if (mut.type === 'attributes') continue;
let t = mut.target;
if (t.nodeType === 3) t = t.parentNode;
if (!t || !t.closest) continue;
if (!t.closest(TABLE_ZONE)) continue;
if (t.closest(SKIP)) continue;
if (t.classList && t.classList.contains('lgt-num')) continue;
relevant = true;
break;
}
if (!relevant) return;
clearTimeout(obsTimer);
obsTimer = setTimeout(processAll, 400);
});
obs.observe(document.body, { childList: true, subtree: true, characterData: true });
let lastHref = location.href;
let lastPage = null;
function applyPageState(navigated) {
const page = detectPage();
const on = page !== null;
document.documentElement.classList.toggle('lgt-page-on', on);
if (on && page !== lastPage) {
pageEl.textContent = page;
pageEl.classList.remove('lgt-pop');
void pageEl.offsetWidth;
pageEl.classList.add('lgt-pop');
}
lastPage = page;
if (on) {
if (navigated) {
setOpen(false);
setTimeout(processAll, 350);
setTimeout(processAll, 1000);
setTimeout(processAll, 2200);
}
} else {
setOpen(false);
}
update();
}
function onNav() {
if (location.href === lastHref) return;
lastHref = location.href;
applyPageState(true);
}
window.__lgtTriggerNav = onNav;
addEventListener('popstate', onNav);
addEventListener('hashchange', onNav);
setInterval(onNav, 800);
applyPageState(false);
addEventListener('load', () => applyPageState(false));
setTimeout(processAll, 800);
setTimeout(processAll, 2500);
})();
}
function startScanner() {
if (scannerStarted) return;
scannerStarted = true;
if (window.__lgScannerUnified) return;
window.__lgScannerUnified = true;
(function () {
'use strict';
const API_STOCK = '/web/product?sortOrder=desc&sortField=id&startIndexCustom=-1&generalFilter=&isInStockFilter=true';
const API_BYCODE = '/web/helper/product-by-code?codeProductFilter=';
const FIREBASE = 'https://stock-baki-default-rtdb.asia-southeast1.firebasedatabase.app';
const PAGE_SIZE = 1000;
const MAX_SCAN_LOG = 2000;
const MAX_FORM_RETRY = 20;
const DATA_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ST = {
MASUK:      { label: 'MASUK',             color: '#16a34a', bg: '#f0fdf4', bd: '#bbf7d0' },
SUDAH:      { label: 'SUDAH DISCAN',      color: '#d97706', bg: '#fffbeb', bd: '#fde68a' },
SALAH_BAKI: { label: 'SALAH BAKI',        color: '#ea580c', bg: '#fff7ed', bd: '#fed7aa' },
TERJUAL:    { label: 'TERJUAL / RUSAK',   color: '#7c3aed', bg: '#f5f3ff', bd: '#ddd6fe' },
TIDAK_ADA:  { label: 'BARCODE TIDAK ADA', color: '#dc2626', bg: '#fef2f2', bd: '#fecaca' },
};
function esc(str) {
const s = String(str ?? '');
return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
.replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escAttr(str) {
return String(str ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;')
.replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function safeParse(key, fallback) {
try {
const raw = localStorage.getItem(key);
if (raw === null) return fallback;
return JSON.parse(raw);
} catch (e) {
console.warn('[LiaGold] localStorage korup untuk key:', key, e);
localStorage.removeItem(key);
return fallback;
}
}
function safeParseArray(key, fallback) {
const raw = localStorage.getItem(key);
if (raw === null) return fallback;
const val = LG.parseArrayJson(raw, null);
if (val === null) {
console.warn('[LiaGold] localStorage bukan array:', key);
localStorage.removeItem(key);
return fallback;
}
return val;
}
function rebuildScannedCodes() {
scannedCodes = new Set(LG.scannedCodesFromLog(scanLog));
}
let allProducts = [];
let productMap = new Map();
let filteredProducts = [];
let trayList = safeParseArray('lg_trayList', []);
let selectedTray = 'all';
let traySelected = false;
let scanFilter = 'all';
let statusFilter = 'none';
let autoFillForm = true;
let scanLog = safeParseArray('lg_scanLog', []);
let scannedCodes = new Set();
rebuildScannedCodes();
let sessionId = localStorage.getItem('lg_session') || null;
let myName = localStorage.getItem('lg_mp_name') || '';
let myId = localStorage.getItem('lg_mp_id') || (() => {
const id = 'u' + LG.randomBase36(8);
localStorage.setItem('lg_mp_id', id);
return id;
})();
let cloudHistory = {};
let participants = {};
let dupeCount = 0;
let es = null;
let esFailCount = 0;
let knownCloudKeys = new Set();
let initialCloudSyncDone = false;
let isDeletingSession = false;
let formQueue = [];
let isProcessingForm = false;
let isStoppingForm = false;
let formFilledCodes = new Set();
let formAttemptCounts = new Map();
let formRetryCount = 0;
let formRetryTimer = null;
let panelVisible = false;
let isLoading = false;
let currentLoadId = 0;
let scanQueue = [];
let isScanning = false;
let pendingLocalScans = new Set();
let pendingCloudPushes = [];
const PENDING_KEY = 'lg_pendingCloudPushes';
function persistPendingPushes() {
try {
if (!pendingCloudPushes.length) {
localStorage.removeItem(PENDING_KEY);
return;
}
localStorage.setItem(PENDING_KEY, JSON.stringify(pendingCloudPushes));
} catch (e) {}
}
let retryTimer = null;
let audioCtx = null;
let renderThrottleTimer = null;
let persistDebounceTimer = null;
let initialized = false;
let filterBtnBound = false;
let batchSize = parseInt(localStorage.getItem('lg_batchSize') || '25');
let batchDelay = parseInt(localStorage.getItem('lg_batchDelay') || '1000');
let lastScanAt = null;
let expiryReady = false;
let countdownIntervalId = null;
let sessionCreatedAt = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isMulti = () => !!sessionId;
function sanitizeKey(str) {
return LG.sanitizeKey(str);
}
function generateHistoryKey(codeProduct, timestamp) {
return LG.generateHistoryKey(codeProduct, timestamp);
}
function isEntryExpired(entry) {
if (!entry || !entry.time) return false;
try {
const entryTime = new Date(entry.time).getTime();
const age = Date.now() - entryTime;
return age > DATA_TTL_MS;
} catch (e) {
return false;
}
}
function updateLastScanAt() {
lastScanAt = new Date().toISOString();
if (isMulti()) {
fbPut(`/opname/${sessionId}/meta/lastScanAt`, lastScanAt).catch(() => {});
} else {
localStorage.setItem('lg_lastScanAt', lastScanAt);
}
updateCountdownDisplay();
}
function getRemainingTime() {
const remaining = LG.getRemainingTime(lastScanAt);
return remaining == null ? 0 : remaining;
}
function isDataExpired() {
if (!expiryReady) return false;
return LG.isDataExpired(lastScanAt);
}
function updateCountdownDisplay() {
const countdownEl = document.getElementById('lg-countdown');
if (!countdownEl) return;
if (!lastScanAt) {
countdownEl.style.display = 'none';
return;
}
countdownEl.style.display = 'block';
const remaining = getRemainingTime();
if (expiryReady && LG.isDataExpired(lastScanAt)) {
countdownEl.innerHTML = '⏰ DATA EXPIRED';
countdownEl.style.color = '#dc2626';
countdownEl.style.fontWeight = '700';
return;
}
const hours = Math.floor(remaining / (60 * 60 * 1000));
const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
countdownEl.innerHTML = `⏳ Data valid: <b>${hours}j ${minutes}m ${seconds}d</b>`;
countdownEl.style.color = remaining < 60 * 60 * 1000 ? '#dc2626' : '#16a34a';
countdownEl.style.fontWeight = remaining < 60 * 60 * 1000 ? '700' : '600';
}
function startCountdownInterval() {
stopCountdownInterval();
countdownIntervalId = setInterval(() => {
updateCountdownDisplay();
if (isDataExpired()) {
if (isMulti()) {
handleOnlineExpiry();
} else {
handleSoloExpiry();
}
}
}, 1000);
}
function stopCountdownInterval() {
if (countdownIntervalId) {
clearInterval(countdownIntervalId);
countdownIntervalId = null;
}
}
function handleSoloExpiry() {
if (!expiryReady || !LG.isDataExpired(lastScanAt)) return;
if (scanLog.length === 0) return;
updateStatus('🗑️ Data scan expired (>12 jam). Menghapus otomatis...');
scanLog = [];
scannedCodes = new Set();
formFilledCodes = new Set();
formAttemptCounts = new Map();
formQueue = [];
localStorage.removeItem('lg_scanLog');
localStorage.removeItem('lg_lastScanAt');
lastScanAt = null;
updateStats();
renderLog();
applyFilters();
updateCountdownDisplay();
alert('⏰ Data scan telah EXPIRED (>12 jam tanpa scan).\nSemua data scan lokal telah dihapus otomatis.\nMulai scan baru untuk melanjutkan.');
}
async function handleOnlineExpiry() {
if (!sessionId || isDeletingSession) return;
if (!expiryReady || !LG.isDataExpired(lastScanAt)) return;
isDeletingSession = true;
try {
persistScanLog();
stopCountdownInterval();
cleanupSessionLocal();
updateStatus('⏰ Sesi expired di device ini. Data cloud tidak dihapus otomatis.');
alert('⏰ Data scan sudah lewat 12 jam tanpa scan di device ini.\nKamu keluar ke mode solo.\nSesi cloud tidak dihapus otomatis — pakai “Selesai & Hapus” jika semua sudah selesai.');
} finally {
isDeletingSession = false;
}
}
async function loadLastScanAt() {
if (isMulti()) {
try {
const res = await fetch(`${FIREBASE}/opname/${sessionId}/meta.json`);
const meta = await res.json();
lastScanAt = meta?.lastScanAt || meta?.dibuat || lastScanAt || null;
} catch (e) {
// keep previous lastScanAt
}
} else {
lastScanAt = localStorage.getItem('lg_lastScanAt') || lastScanAt || null;
}
updateCountdownDisplay();
}
async function checkSessionExpiry() {
if (!sessionId || isDeletingSession) return;
try {
const res = await fetch(`${FIREBASE}/opname/${sessionId}/meta.json`);
const meta = await res.json();
if (meta === null) {
onSessionDeletedRemotely();
return;
}
sessionCreatedAt = meta.dibuat || null;
lastScanAt = meta.lastScanAt || meta.dibuat || null;
if (isDataExpired()) {
await handleOnlineExpiry();
return;
}
updateCountdownDisplay();
} catch (e) {}
}
function updateSessionCountdown() {
updateCountdownDisplay();
}
function mapItem(item) {
return {
codeProduct: item.CodeProduct || '',
code: item.Code || '',
name: item.Name || '',
size: item.Size || '-',
weight: item.WeightReal || item.WeightSystem || 0,
price: LG.pickProductPrice(item),
image: item.ProductPicture || '',
kadar: item.Kadar || '',
trayId: item.TrayId ?? null,
trayCode: item.TrayCode || '-',
group: item.GroupCode || '',
};
}
function rebuildProductMap() {
productMap = new Map();
let dupes = 0;
allProducts.forEach(p => {
const k = String(p.codeProduct).toLowerCase();
if (productMap.has(k)) {
dupes++;
return;
}
productMap.set(k, p);
});
if (dupes > 0) updateStatus(`⚠️ ${dupes} codeProduct duplikat, dipakai entri pertama`);
}
function injectStyles() {
const existingStyle = document.getElementById('lg-styles');
if (existingStyle) existingStyle.remove();
const existingStyleV2 = document.getElementById('lg-styles-v2');
if (existingStyleV2) existingStyleV2.remove();
const s = document.createElement('style');
s.id = 'lg-styles-v2';
s.textContent = `
@keyframes lgPop { 0%{transform:scale(.96);opacity:0} 100%{transform:scale(1);opacity:1} }
@keyframes lgPulse { 0%,100%{box-shadow:0 0 0 0 rgba(22,163,74,.5)} 50%{box-shadow:0 0 0 6px rgba(22,163,74,0)} }
.lg-dot-live { animation: lgPulse 1.6s infinite; }
#lg-panel button {
transition: transform .12s ease, box-shadow .12s ease, filter .12s ease, background .15s ease;
}
#lg-panel button:hover {
transform: translateY(-1px);
filter: brightness(1.08);
box-shadow: 0 3px 10px rgba(0,0,0,.12);
}
#lg-panel button:active {
transform: translateY(0) scale(.97);
}
#lg-panel tbody tr { transition: background .15s ease; }
#lg-panel tbody tr:hover { background: #f1f5f9 !important; }
.lg-tray-opt { transition: background .12s ease; }
.lg-result-anim { animation: lgPop .18s ease; }
#lg-fab { transition: transform .2s ease, box-shadow .2s ease !important; }
.lg-stat-clickable {
cursor: pointer !important;
user-select: none;
transition: transform .15s ease, box-shadow .15s ease, outline .15s ease, border-color .15s ease;
}
.lg-stat-clickable:hover {
transform: translateY(-2px) scale(1.02);
box-shadow: 0 4px 12px rgba(0,0,0,.12);
border-color: #2563eb !important;
}
.lg-stat-clickable:active {
transform: translateY(0) scale(0.98);
}
.lg-stat-clickable.lg-stat-active {
outline: 2.5px solid #2563eb !important;
outline-offset: 1px;
transform: scale(1.03);
box-shadow: 0 4px 14px rgba(37,99,235,.30);
border-color: #2563eb !important;
}
.lg-tray-opt:hover {
background: #eff6ff !important;
}
.lg-scan-tab:hover {
filter: brightness(1.05);
transform: translateY(-1px);
}
.lg-img-link:hover {
text-decoration: underline !important;
opacity: 0.85;
}
#lg-countdown {
margin-top: 8px;
padding: 6px 12px;
background: #f8fafc;
border: 1px solid #e2e8f0;
border-radius: 6px;
font-size: 12px;
text-align: center;
}
`;
document.head.appendChild(s);
}
function getFormInput() {
return document.querySelector('input[formcontrolname="CodeProduct"]')
|| document.querySelector('input[placeholder="Masukan Kode Barang"]');
}
function fillCodeProductToForm(code) {
const input = getFormInput();
if (!input) return false;
Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, code);
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
input.focus();
return true;
}
function clickSearchBtn() {
const input = getFormInput();
if (!input) return;
const group = input.closest('.input-group');
if (group) {
const btn = group.querySelector('.input-group-append button');
if (btn) btn.click();
}
}
function getFormCounters() {
const counters = {};
document.querySelectorAll('.label-info-cont .label-info').forEach(li => {
const help = li.querySelector('.m-form__help');
const val = li.querySelector('.m-label');
if (help && val) counters[help.textContent.trim()] = val.textContent.trim();
});
return JSON.stringify(counters);
}
async function waitForFormChange(beforeSig, timeout = 8000) {
const start = Date.now();
while (Date.now() - start < timeout) {
await sleep(100);
if (getFormCounters() !== beforeSig) return true;
}
return false;
}
function getFormListText() {
let txt = '';
document.querySelectorAll('.list-section ul.product-item').forEach(ul => {
txt += ' ' + (ul.textContent || '');
});
return txt.toLowerCase();
}
function isCodeInForm(code, formTextLower) {
const ft = formTextLower !== undefined ? formTextLower : getFormListText();
const c = String(code).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
try {
return new RegExp('(?<![a-z0-9])' + c + '(?![a-z0-9])', 'i').test(ft);
} catch (e) {
return ft.includes(String(code).toLowerCase());
}
}
function shouldQueueToForm(entry) {
if (!entry || !entry.codeProduct) return false;
if (entry.status !== 'MASUK') return false;
const product = productMap.get(String(entry.codeProduct).toLowerCase());
if (product) {
if (selectedTray === 'all') return false;
return String(product.trayId) === selectedTray;
}
if (entry.tray && entry.tray !== '-') {
const trayInfo = trayList.find(t => t.trayCode === entry.tray);
if (trayInfo && selectedTray !== 'all') {
return String(trayInfo.trayId) === selectedTray;
}
}
return false;
}
function queueFormInput(code) {
const lc = String(code).toLowerCase();
if (formFilledCodes.has(lc)) return;
if (formQueue.some(c => String(c).toLowerCase() === lc)) return;
formQueue.push(code);
processFormQueue();
}
async function processFormQueue() {
if (isProcessingForm) return;
if (!formQueue.length) return;
if (!getFormInput()) {
formRetryCount++;
if (formRetryCount > MAX_FORM_RETRY) {
updateStatus(`⚠️ Form tidak tersedia setelah ${MAX_FORM_RETRY}x retry. Queue dihapus (${formQueue.length} kode).`);
formQueue = [];
formRetryCount = 0;
return;
}
updateStatus(`⚠️ Form belum tersedia. Retry ${formRetryCount}/${MAX_FORM_RETRY}…`);
if (!formRetryTimer) {
formRetryTimer = setTimeout(() => {
formRetryTimer = null;
processFormQueue();
}, 3000);
}
return;
}
isProcessingForm = true;
isStoppingForm = false;
formRetryCount = 0;
let processed = 0;
let batchCount = 0;
let exitedEarly = false;
const totalItems = formQueue.length;
try {
while (formQueue.length) {
if (isStoppingForm) {
updateStatus(`⏹ Dihentikan. ${formQueue.length} kode tersisa di queue.`);
break;
}
if (batchCount >= batchSize && formQueue.length > 0) {
updateStatus(`⏸️ Jeda batch: ${processed}/${totalItems} diproses. Menunggu ${batchDelay}ms...`);
await sleep(batchDelay);
batchCount = 0;
if (isStoppingForm) {
updateStatus(`⏹ Dihentikan setelah jeda batch.`);
break;
}
}
const code = formQueue.shift();
const lc = String(code).toLowerCase();
if (formFilledCodes.has(lc)) continue;
if (!getFormInput()) {
formQueue.unshift(code);
formRetryCount++;
if (formRetryCount > MAX_FORM_RETRY) {
updateStatus(`⚠️ Form hilang. Sisa ${formQueue.length} kode dihapus.`);
formQueue = [];
formRetryCount = 0;
break;
}
if (!formRetryTimer) {
formRetryTimer = setTimeout(() => {
formRetryTimer = null;
processFormQueue();
}, 3000);
}
exitedEarly = true;
return;
}
if (isCodeInForm(code)) {
formFilledCodes.add(lc);
continue;
}
const beforeSig = getFormCounters();
const filled = fillCodeProductToForm(code);
let changed = false;
if (filled) {
await sleep(150);
clickSearchBtn();
changed = await waitForFormChange(beforeSig, 6000);
}
const success = changed || isCodeInForm(code);
const decision = LG.recordFormAttempt(formAttemptCounts, lc, success);
if (decision.markFilled) {
formFilledCodes.add(lc);
processed++;
batchCount++;
} else if (decision.retry) {
formQueue.push(code);
updateStatus(`⚠️ Gagal input ${code}. Retry ${formAttemptCounts.get(lc)}/${LG.MAX_FORM_CODE_ATTEMPTS}…`);
} else {
updateStatus(`⚠️ Gagal input ${code} setelah ${LG.MAX_FORM_CODE_ATTEMPTS}x. Dilewati.`);
}
await sleep(50);
}
} finally {
isProcessingForm = false;
isStoppingForm = false;
}
if (processed > 0 && !isStoppingForm && !exitedEarly && formQueue.length === 0) {
updateStatus(`✅ ${processed} kode berhasil diinput ke form.`);
} else if (exitedEarly && processed > 0) {
updateStatus(`⏸️ ${processed} kode terinput. Form hilang, sisa di-retry.`);
}
}
async function fbPut(path, data) {
const res = await fetch(`${FIREBASE}${path}.json`, {
method: 'PUT',
body: JSON.stringify(data)
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
async function pushScanToCloud(entry, retries = 3) {
if (!isMulti()) return;
const uniqueKey = generateHistoryKey(entry.codeProduct, entry.time);
for (let i = 0; i < retries; i++) {
if (!isMulti()) return;
try {
await fbPut(`/opname/${sessionId}/history/${uniqueKey}`, entry);
return;
} catch (e) {
if (i === retries - 1) {
updateStatus('⚠️ Gagal kirim ke cloud setelah ' + retries + 'x. Data di-queue.');
pendingCloudPushes.push({ ...entry, uniqueKey });
persistPendingPushes();
scheduleRetryPush();
} else {
await sleep(400 * (i + 1));
}
}
}
}
function scheduleRetryPush() {
if (retryTimer) return;
retryTimer = setTimeout(async () => {
retryTimer = null;
if (!pendingCloudPushes.length || !isMulti()) return;
const batch = pendingCloudPushes.splice(0, 10);
for (const entry of batch) {
if (!isMulti()) {
pendingCloudPushes.push(entry);
break;
}
const uniqueKey = entry.uniqueKey || generateHistoryKey(entry.codeProduct, entry.time);
try {
await fbPut(`/opname/${sessionId}/history/${uniqueKey}`, entry);
} catch (e) {
pendingCloudPushes.push(entry);
}
await sleep(200);
}
persistPendingPushes();
if (pendingCloudPushes.length) scheduleRetryPush();
}, 5000);
}
async function migrateSoloScansToSession() {
if (!scanLog.length) return;
const byCode = new Map();
scanLog.forEach(l => {
if (!l || !l.codeProduct) return;
const k = String(l.codeProduct).toLowerCase() + '_' + (l.timeIso || l.time || '');
if (!byCode.has(k)) byCode.set(k, l);
});
let existingKeys = new Set();
try {
const res = await fetch(`${FIREBASE}/opname/${sessionId}/history.json`);
const data = await res.json();
if (data) existingKeys = new Set(Object.keys(data));
const res2 = await fetch(`${FIREBASE}/opname/${sessionId}/scans.json`);
const data2 = await res2.json();
if (data2) {
Object.keys(data2).forEach(k => existingKeys.add(k));
}
} catch (e) {}
const payload = {};
let count = 0;
byCode.forEach((l, k) => {
const uniqueKey = generateHistoryKey(l.codeProduct, l.timeIso || '');
if (!l.timeIso || existingKeys.has(uniqueKey)) return;
payload[uniqueKey] = {
by: myName,
time: l.timeIso || new Date().toISOString(),
status: l.status,
codeProduct: l.codeProduct,
code: l.code || '-',
name: l.name || '-',
tray: l.tray || '-',
image: l.image || '',
};
count++;
});
if (!count) {
updateStatus('✅ Semua scan solo sudah ada di sesi — progress LANJUT.');
return;
}
updateStatus(`📤 Melanjutkan progress: unggah ${count} scan solo ke sesi…`);
const keys = Object.keys(payload);
let ok = 0;
for (let i = 0; i < keys.length; i += 100) {
const batch = {};
keys.slice(i, i + 100).forEach(k => {
batch[k] = payload[k];
});
try {
const res = await fetch(`${FIREBASE}/opname/${sessionId}/history.json`, {
method: 'PATCH',
body: JSON.stringify(batch)
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
ok += Object.keys(batch).length;
} catch (e) {
Object.values(batch).forEach(entry => pendingCloudPushes.push(entry));
}
await sleep(150);
}
if (pendingCloudPushes.length) scheduleRetryPush();
updateStatus(`✅ ${ok}/${count} scan solo terunggah — progress LANJUT.`);
}
async function createSession() {
const nama = document.getElementById('lg-mp-name').value.trim() || 'Anonim';
myName = nama;
localStorage.setItem('lg_mp_name', nama);
const code = LG.randomBase36(8).toUpperCase();
const now = new Date().toISOString();
try {
await fbPut(`/opname/${code}/meta`, {
nama: 'Opname ' + new Date().toLocaleDateString('id-ID'),
dibuat: now,
lastScanAt: now,
expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
});
await fbPut(`/opname/${code}/peserta/${myId}`, {
nama: myName,
join: now
});
sessionId = code;
localStorage.setItem('lg_session', code);
sessionCreatedAt = now;
lastScanAt = now;
knownCloudKeys = new Set();
initialCloudSyncDone = false;
dupeCount = 0;
formFilledCodes = new Set();
formAttemptCounts = new Map();
formQueue = [];
formRetryCount = 0;
pendingLocalScans = new Set();
pendingCloudPushes = [];
persistPendingPushes();
statusFilter = 'none';
await migrateSoloScansToSession();
listenSession();
updateMpUI();
updateCountdownDisplay();
startCountdownInterval();
updateStatus(`✅ Sesi ${code} dibuat! COPY kodenya & bagikan ke rekan.`);
} catch (e) {
updateStatus('❌ Gagal buat sesi: ' + e.message + ' (cek Rules Firebase)');
}
}
async function joinSession() {
const nama = document.getElementById('lg-mp-name').value.trim() || 'Anonim';
const code = document.getElementById('lg-mp-code').value.trim().toUpperCase();
if (!code) {
updateStatus('⚠️ Masukkan kode sesi dulu.');
return;
}
myName = nama;
localStorage.setItem('lg_mp_name', nama);
try {
const res = await fetch(`${FIREBASE}/opname/${code}/meta.json`);
const meta = await res.json();
if (!meta) {
updateStatus('❌ Sesi "' + code + '" tidak ditemukan.');
return;
}
lastScanAt = meta.lastScanAt || meta.dibuat || null;
sessionCreatedAt = meta.dibuat || null;
if (isDataExpired()) {
updateStatus('❌ Sesi "' + code + '" sudah EXPIRED (>12 jam tanpa scan).');
return;
}
await fbPut(`/opname/${code}/peserta/${myId}`, {
nama: myName,
join: new Date().toISOString()
});
sessionId = code;
localStorage.setItem('lg_session', code);
knownCloudKeys = new Set();
initialCloudSyncDone = false;
dupeCount = 0;
formFilledCodes = new Set();
formAttemptCounts = new Map();
formQueue = [];
formRetryCount = 0;
pendingLocalScans = new Set();
pendingCloudPushes = [];
persistPendingPushes();
statusFilter = 'none';
await migrateSoloScansToSession();
listenSession();
updateMpUI();
updateCountdownDisplay();
startCountdownInterval();
updateStatus(`✅ Bergabung ke sesi ${code}!`);
} catch (e) {
updateStatus('❌ Gagal gabung: ' + e.message);
}
}
function leaveSession() {
if (sessionId) {
fetch(`${FIREBASE}/opname/${sessionId}/peserta/${myId}.json`, { method: 'DELETE' }).catch(() => {});
}
persistScanLog();
stopCountdownInterval();
cleanupSessionLocal();
updateStatus('🔴 Keluar dari sesi. Mode solo.');
}
function cleanupSessionLocal() {
if (es) {
es.close();
es = null;
}
sessionId = null;
sessionCreatedAt = null;
lastScanAt = null;
cloudHistory = {};
participants = {};
dupeCount = 0;
knownCloudKeys = new Set();
initialCloudSyncDone = false;
formFilledCodes = new Set();
formAttemptCounts = new Map();
formQueue = [];
formRetryCount = 0;
pendingLocalScans = new Set();
pendingCloudPushes = [];
try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
esFailCount = 0;
statusFilter = 'none';
if (retryTimer) {
clearTimeout(retryTimer);
retryTimer = null;
}
if (formRetryTimer) {
clearTimeout(formRetryTimer);
formRetryTimer = null;
}
stopCountdownInterval();
localStorage.removeItem('lg_session');
scanLog = safeParseArray('lg_scanLog', []);
rebuildScannedCodes();
updateMpUI();
updateStats();
renderLog();
applyFilters();
}
async function deleteSession() {
if (!sessionId || isDeletingSession) return;
const totalScans = Object.keys(cloudHistory).length;
if (!confirm(`Hapus sesi ${sessionId} PERMANEN dari cloud?\n${totalScans} data scan akan dihapus untuk SEMUA peserta.\nSemua device lain akan OTOMATIS keluar.\n⚠️ Export CSV dulu kalau masih perlu datanya!`)) return;
isDeletingSession = true;
try {
persistScanLog();
const res = await fetch(`${FIREBASE}/opname/${sessionId}.json`, { method: 'DELETE' });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
stopCountdownInterval();
cleanupSessionLocal();
updateStatus('🗑️ Sesi dihapus permanen. Semua peserta otomatis keluar.');
} catch (e) {
updateStatus('❌ Gagal hapus sesi: ' + e.message);
} finally {
isDeletingSession = false;
}
}
function persistScanLog() {
if (isMulti()) return;
try {
if (scanLog.length > MAX_SCAN_LOG) scanLog = scanLog.slice(0, MAX_SCAN_LOG);
localStorage.setItem('lg_scanLog', JSON.stringify(scanLog));
rebuildScannedCodes();
} catch (e) {
try {
scanLog = scanLog.slice(0, 500);
localStorage.setItem('lg_scanLog', JSON.stringify(scanLog));
rebuildScannedCodes();
} catch (e2) {}
}
}
function debouncedPersist() {
if (persistDebounceTimer) return;
persistDebounceTimer = setTimeout(() => {
persistDebounceTimer = null;
persistScanLog();
}, 1000);
}
window.addEventListener('beforeunload', () => {
if (scanLog.length) persistScanLog();
if (pendingCloudPushes.length) persistPendingPushes();
});
async function verifySessionAlive() {
if (!sessionId || isDeletingSession) return;
try {
const res = await fetch(`${FIREBASE}/opname/${sessionId}/meta.json`);
const meta = await res.json();
if (meta === null) onSessionDeletedRemotely();
} catch (e) {}
}
function onSessionDeletedRemotely() {
if (!sessionId || isDeletingSession) return;
persistScanLog();
stopCountdownInterval();
cleanupSessionLocal();
updateStatus('🗑️ Sesi dihapus oleh peserta lain — kamu otomatis keluar.');
alert(`🗑️ Sesi telah DIHAPUS oleh peserta lain.\nKamu otomatis kembali ke MODE SOLO.\nData scan di device ini tetap tersimpan lokal.`);
}
function listenSession() {
if (es) es.close();
esFailCount = 0;
es = new EventSource(`${FIREBASE}/opname/${sessionId}.json`);
es.addEventListener('put', e => {
let path, data;
try {
({ path, data } = JSON.parse(e.data));
} catch (err) {
return;
}
if (path === '/') {
if (data === null) {
verifySessionAlive();
return;
}
cloudHistory = data.history || {};
if (data.scans) {
Object.entries(data.scans).forEach(([k, v]) => {
if (!v || !v.codeProduct) return;
if (!cloudHistory[k]) {
cloudHistory[k] = v;
}
});
}
participants = data.peserta || {};
dupeCount = data.dupes ? Object.keys(data.dupes).length : 0;
if (data.meta?.lastScanAt) {
lastScanAt = data.meta.lastScanAt;
updateCountdownDisplay();
}
onCloudUpdate();
renderParticipants();
return;
}
if (path === '/history') {
if (data === null) {
cloudHistory = {};
onCloudUpdate();
return;
}
cloudHistory = data;
onCloudUpdate();
return;
}
if (path.startsWith('/history/')) {
const k = path.slice('/history/'.length);
if (data === null) delete cloudHistory[k];
else cloudHistory[k] = data;
onCloudUpdate();
return;
}
if (path === '/meta') {
if (data?.lastScanAt) {
lastScanAt = data.lastScanAt;
updateCountdownDisplay();
}
return;
}
if (path === '/meta/lastScanAt') {
lastScanAt = data;
updateCountdownDisplay();
return;
}
if (path === '/scans' || path.startsWith('/scans/')) {
const scansData = path === '/scans' ? data : null;
if (scansData && typeof scansData === 'object') {
Object.entries(scansData).forEach(([k, v]) => {
if (!v || !v.codeProduct) return;
if (!cloudHistory[k]) {
cloudHistory[k] = v;
}
});
} else if (path.startsWith('/scans/')) {
const k = path.slice('/scans/'.length);
if (data && data.codeProduct) {
if (!cloudHistory[k]) {
cloudHistory[k] = data;
}
}
}
onCloudUpdate();
return;
}
if (path === '/peserta') {
participants = data || {};
renderParticipants();
return;
}
if (path.startsWith('/peserta/')) {
const k = path.slice('/peserta/'.length);
if (data === null) delete participants[k];
else participants[k] = data;
renderParticipants();
return;
}
if (path === '/dupes') {
dupeCount = data ? Object.keys(data).length : 0;
updateStats();
return;
}
if (path.startsWith('/dupes/')) {
dupeCount = data === null ? Math.max(0, dupeCount - 1) : dupeCount + 1;
updateStats();
return;
}
});
es.addEventListener('patch', e => {
let path, data;
try {
({ path, data } = JSON.parse(e.data));
} catch (err) {
return;
}
if (path === '/') {
Object.entries(data || {}).forEach(([k, v]) => {
if (k === 'history') cloudHistory = v || {};
if (k === 'peserta') participants = v || {};
if (k === 'dupes') dupeCount = v ? Object.keys(v).length : 0;
if (k === 'meta' && v?.lastScanAt) {
lastScanAt = v.lastScanAt;
updateCountdownDisplay();
}
if (k === 'scans' && v && typeof v === 'object') {
Object.entries(v).forEach(([sk, sv]) => {
if (!sv || !sv.codeProduct) return;
if (!cloudHistory[sk]) {
cloudHistory[sk] = sv;
}
});
}
});
onCloudUpdate();
renderParticipants();
return;
}
if (path === '/history') {
Object.entries(data || {}).forEach(([k, v]) => {
if (v === null) delete cloudHistory[k];
else cloudHistory[k] = v;
});
onCloudUpdate();
return;
}
if (path.startsWith('/history/')) {
const k = path.slice('/history/'.length);
if (!cloudHistory[k]) cloudHistory[k] = {};
Object.entries(data || {}).forEach(([subK, v]) => {
if (v === null) delete cloudHistory[k][subK];
else cloudHistory[k][subK] = v;
});
onCloudUpdate();
return;
}
if (path === '/meta') {
if (data?.lastScanAt) {
lastScanAt = data.lastScanAt;
updateCountdownDisplay();
}
return;
}
if (path === '/meta/lastScanAt') {
lastScanAt = data;
updateCountdownDisplay();
return;
}
if (path === '/scans' || path.startsWith('/scans/')) {
const scansData = path === '/scans' ? data : null;
if (scansData && typeof scansData === 'object') {
Object.entries(scansData).forEach(([k, v]) => {
if (!v || !v.codeProduct) return;
if (!cloudHistory[k]) {
cloudHistory[k] = v;
}
});
} else if (path.startsWith('/scans/')) {
const k = path.slice('/scans/'.length);
const entryData = path === '/scans' ? data : null;
if (entryData && typeof entryData === 'object') {
Object.entries(entryData).forEach(([subK, v]) => {
if (v === null) return;
if (!v.codeProduct) return;
if (!cloudHistory[subK]) {
cloudHistory[subK] = v;
}
});
}
}
onCloudUpdate();
return;
}
if (path === '/peserta') {
Object.entries(data || {}).forEach(([k, v]) => {
if (v === null) delete participants[k];
else participants[k] = v;
});
renderParticipants();
return;
}
if (path.startsWith('/peserta/')) {
const k = path.slice('/peserta/'.length);
if (data === null) delete participants[k];
else participants[k] = data;
renderParticipants();
return;
}
if (path === '/dupes' || path.startsWith('/dupes/')) {
if (data && typeof data === 'object') dupeCount = Object.keys(data).length;
updateStats();
return;
}
});
es.onerror = () => {
if (!sessionId) return;
esFailCount++;
updateStatus('⚠️ Koneksi terputus (percobaan ' + esFailCount + ')…');
setTimeout(async () => {
if (!sessionId) return;
try {
const res = await fetch(`${FIREBASE}/opname/${sessionId}.json`);
const data = await res.json();
if (data === null) {
verifySessionAlive();
return;
}
cloudHistory = data.history || {};
if (data.scans) {
Object.entries(data.scans).forEach(([k, v]) => {
if (!v || !v.codeProduct) return;
if (!cloudHistory[k]) {
cloudHistory[k] = v;
}
});
}
participants = data.peserta || {};
dupeCount = data.dupes ? Object.keys(data.dupes).length : 0;
if (data.meta?.lastScanAt) {
lastScanAt = data.meta.lastScanAt;
updateCountdownDisplay();
}
onCloudUpdate();
renderParticipants();
esFailCount = 0;
updateStatus('🟢 Koneksi pulih, data disinkronkan.');
} catch (e) {
updateStatus('⚠️ Gagal re-sync.');
}
if (esFailCount >= 5) {
esFailCount = 0;
updateStatus('🔄 Membuat ulang koneksi real-time…');
listenSession();
}
}, 2500);
};
}
function onCloudUpdate() {
const newScannedCodes = new Set();
const historyEntries = [];
Object.values(cloudHistory || {}).forEach(v => {
if (!v || !v.codeProduct) return;
if (isEntryExpired(v)) return;
historyEntries.push({
time: v.time ? new Date(v.time).toLocaleString('id-ID') : '-',
timeIso: v.time || '',
scanCode: v.scanCode || v.codeProduct,
codeProduct: v.codeProduct,
code: v.code || '-',
name: v.name || '-',
tray: v.tray || '-',
image: v.image || '',
status: v.status || '',
by: v.by || '',
});
if (v.status === 'MASUK') {
newScannedCodes.add(String(v.codeProduct).toLowerCase());
}
});
pendingLocalScans.forEach(rawCode => newScannedCodes.add(rawCode));
scannedCodes = newScannedCodes;
pendingLocalScans.forEach(rawCode => {
let found = false;
Object.values(cloudHistory || {}).forEach(v => {
if (v && v.codeProduct && String(v.codeProduct).toLowerCase() === rawCode) {
found = true;
}
});
if (found) pendingLocalScans.delete(rawCode);
});
scanLog = historyEntries.sort((a, b) => (b.timeIso || '').localeCompare(a.timeIso || ''));
debouncedPersist();
const newKeys = [];
Object.keys(cloudHistory || {}).forEach(k => {
if (!knownCloudKeys.has(k)) {
knownCloudKeys.add(k);
newKeys.push(k);
}
});
if (initialCloudSyncDone && autoFillForm && newKeys.length) {
newKeys.forEach(k => {
const scan = cloudHistory[k];
if (!scan || !scan.codeProduct) return;
if (scan.by === myName) return;
if (isEntryExpired(scan)) return;
if (!shouldQueueToForm(scan)) return;
queueFormInput(scan.codeProduct);
});
}
initialCloudSyncDone = true;
scheduleRender();
}
function scheduleRender() {
if (renderThrottleTimer) return;
renderThrottleTimer = setTimeout(() => {
renderThrottleTimer = null;
updateStats();
renderLog();
applyFilters();
updateCountdownDisplay();
}, 200);
}
async function pushDupe(code) {
if (!isMulti()) return;
try {
await fetch(`${FIREBASE}/opname/${sessionId}/dupes.json`, {
method: 'POST',
body: JSON.stringify({
code,
by: myName,
time: new Date().toISOString()
})
});
} catch (e) {}
}
function copySessionCode() {
if (!sessionId) return;
navigator.clipboard.writeText(sessionId).then(() => {
updateStatus(`📋 Kode sesi "${sessionId}" disalin!`);
}).catch(() => {
updateStatus(`Kode sesi: ${sessionId} (salin manual)`);
});
}
function updateMpUI() {
const box = document.getElementById('lg-mp-box');
if (!box) return;
if (isMulti()) {
box.innerHTML = `
<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
<span class="lg-dot-live" style="width:10px;height:10px;border-radius:50%;background:#16a34a;display:inline-block;"></span>
<b style="font-size:13px;color:#16a34a;">🟢 Online · Login: ${esc(myName)}</b>
</div>
<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px;margin-bottom:10px;">
<div style="font-size:10px;color:#64748b;margin-bottom:4px;">KODE SESI (simpan & bagikan ke rekan):</div>
<div style="display:flex;align-items:center;gap:8px;">
<b style="font-size:17px;color:#2563eb;letter-spacing:1px;font-family:monospace;">${esc(sessionId)}</b>
<button id="lg-mp-copy" style="padding:5px 12px;background:#2563eb;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:11px;font-weight:600;">📋 Copy</button>
</div>
<div id="lg-countdown" style="margin-top:6px;font-size:10px;font-weight:600;"></div>
</div>
<div id="lg-mp-participants" style="font-size:11px;color:#475569;margin-bottom:10px;"></div>
<div style="display:flex;gap:6px;flex-wrap:wrap;">
<button id="lg-mp-leave" style="padding:7px 14px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;">🚪 Keluar Sesi</button>
<button id="lg-mp-delete" style="padding:7px 14px;background:#991b1b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;">🗑️ Selesai & Hapus</button>
</div>
<div style="margin-top:8px;font-size:10px;color:#94a3b8;line-height:1.5;">💡 Scan pemain lain otomatis terinput ke form kamu (sinkron real-time). Progress solo otomatis dimerge saat buat/gabung sesi. ⏰ Data auto-expire 12 jam tanpa scan.</div>
`;
document.getElementById('lg-mp-leave').addEventListener('click', leaveSession);
document.getElementById('lg-mp-delete').addEventListener('click', deleteSession);
document.getElementById('lg-mp-copy').addEventListener('click', copySessionCode);
renderParticipants();
updateCountdownDisplay();
} else {
box.innerHTML = `
<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
<span style="width:10px;height:10px;border-radius:50%;background:#94a3b8;display:inline-block;"></span>
<b style="font-size:13px;color:#64748b;">🔴 Mode Solo (offline)</b>
</div>
<div id="lg-countdown" style="margin-bottom:10px;font-size:10px;font-weight:600;"></div>
<input id="lg-mp-name" type="text" placeholder="Nama kamu" value="${escAttr(myName)}"
style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #cbd5e1;font-size:12px;margin-bottom:8px;" />
<button id="lg-mp-create" style="width:100%;padding:8px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;margin-bottom:8px;">➕ Buat Sesi Baru <span style="font-weight:400;opacity:.85;">(progress solo ikut)</span></button>
<div style="display:flex;gap:6px;">
<input id="lg-mp-code" type="text" placeholder="Kode sesi (6 karakter)"
style="flex:1;padding:8px 10px;border-radius:6px;border:1px solid #cbd5e1;font-size:12px;text-transform:uppercase;" />
<button id="lg-mp-join" style="padding:8px 14px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;">Gabung</button>
</div>
<div style="margin-top:8px;font-size:10px;color:#94a3b8;line-height:1.5;">⏰ Data scan solo auto-expire 12 jam tanpa scan baru.</div>
`;
document.getElementById('lg-mp-create').addEventListener('click', createSession);
document.getElementById('lg-mp-join').addEventListener('click', joinSession);
updateCountdownDisplay();
}
}
function renderParticipants() {
const el = document.getElementById('lg-mp-participants');
if (!el) return;
const list = Object.values(participants || {}).map(p => esc(p.nama || '?'));
el.innerHTML = `👥 Online (${list.length}): ` + (list.length ? list.map(n => `<b>${n}</b>`).join(', ') : '-');
}
async function syncTrayList() {
const myLoadId = ++currentLoadId;
isLoading = true;
const tmp = [];
let page = 0;
try {
while (true) {
updateStatus(`⏳ Sinkron baki… hal ${page + 1} (${tmp.length})`);
const res = await fetch(`${API_STOCK}&pageNumber=${page}&pageSize=${PAGE_SIZE}`);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const items = (await res.json()).items || [];
if (!items.length) break;
if (myLoadId !== currentLoadId) return;
items.forEach(i => tmp.push(mapItem(i)));
if (items.length < PAGE_SIZE) break;
page++;
await sleep(300);
if (myLoadId !== currentLoadId) return;
}
if (myLoadId !== currentLoadId) return;
const m = new Map();
tmp.forEach(p => {
if (p.trayId === null) return;
const k = `${p.trayId}`;
if (!m.has(k)) m.set(k, { trayId: p.trayId, trayCode: p.trayCode, count: 0 });
m.get(k).count++;
});
trayList = [...m.values()].sort((a, b) => a.trayId - b.trayId);
localStorage.setItem('lg_trayList', JSON.stringify(trayList));
allProducts = tmp;
rebuildProductMap();
selectedTray = 'all';
traySelected = false;
scanFilter = 'all';
statusFilter = 'none';
resetScanTabUI();
renderTrayDropdown('');
applyFilters();
updateStatus(`✅ ${trayList.length} baki · ${allProducts.length} produk`);
} catch (e) {
if (myLoadId !== currentLoadId) return;
updateStatus(`⚠️ Gagal: ${e.message}`);
if (tmp.length) {
allProducts = tmp;
rebuildProductMap();
applyFilters();
}
} finally {
if (myLoadId === currentLoadId) {
isLoading = false;
}
}
}
async function loadTrayData(trayId) {
const myLoadId = ++currentLoadId;
isLoading = true;
const tmp = [];
let page = 0;
const isAll = trayId === 'all';
const label = isAll ? 'Semua Baki' : `Baki ${trayId}`;
try {
while (true) {
const url = isAll
? `${API_STOCK}&pageNumber=${page}&pageSize=${PAGE_SIZE}`
: `${API_STOCK}&trayFilter=${trayId}&pageNumber=${page}&pageSize=${PAGE_SIZE}`;
updateStatus(`⏳ ${label}… hal ${page + 1} (${tmp.length})`);
const res = await fetch(url);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const items = (await res.json()).items || [];
if (!items.length) break;
if (myLoadId !== currentLoadId) return;
items.forEach(i => tmp.push(mapItem(i)));
if (items.length < PAGE_SIZE) break;
page++;
await sleep(300);
if (myLoadId !== currentLoadId) return;
}
if (myLoadId !== currentLoadId) return;
allProducts = tmp;
rebuildProductMap();
applyFilters();
updateStatus(`✅ ${label}: ${allProducts.length} produk dimuat`);
} catch (e) {
if (myLoadId !== currentLoadId) return;
updateStatus(`⚠️ Gagal: ${e.message}`);
if (tmp.length) {
allProducts = tmp;
rebuildProductMap();
applyFilters();
}
} finally {
if (myLoadId === currentLoadId) {
isLoading = false;
}
}
}
function highlightMatch(text, query) {
if (!query) return esc(text);
const idx = text.toLowerCase().indexOf(query.toLowerCase());
if (idx === -1) return esc(text);
return esc(text.slice(0, idx))
+ `<b style="color:#2563eb;background:#eff6ff;border-radius:3px;padding:0 2px;">${esc(text.slice(idx, idx + query.length))}</b>`
+ esc(text.slice(idx + query.length));
}
function renderTrayDropdown(filter) {
const dd = document.getElementById('lg-tray-dropdown');
if (!dd) return;
const f = (filter || '').trim().toLowerCase();
let html = '';
if (!f) {
html += `<div class="lg-tray-opt" data-val="all" data-label="Semua Baki" style="padding:9px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#94a3b8;">📦 Semua Baki (hanya lihat)</div>`;
}
trayList.forEach(t => {
const label = `Baki ${t.trayCode}`;
if (f && !label.toLowerCase().includes(f)) return;
html += `<div class="lg-tray-opt" data-val="${escAttr(t.trayId)}" data-label="${escAttr(label)}" style="padding:9px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid #f1f5f9;">${highlightMatch(label, f)}</div>`;
});
if (!html) html = '<div style="padding:12px;font-size:11px;color:#94a3b8;text-align:center;">Tidak ada baki yang cocok</div>';
dd.innerHTML = html;
dd.querySelectorAll('.lg-tray-opt').forEach(opt => {
opt.addEventListener('mouseenter', () => opt.style.background = '#eff6ff');
opt.addEventListener('mouseleave', () => opt.style.background = '#fff');
opt.addEventListener('click', () => selectTray(opt.dataset.val, opt.dataset.label));
});
}
function selectTray(val, label) {
selectedTray = val;
traySelected = (val !== 'all');
statusFilter = 'none';
document.getElementById('lg-tray-search').value = label;
document.getElementById('lg-tray-dropdown').style.display = 'none';
const info = trayList.find(t => String(t.trayId) === val);
document.getElementById('lg-tray-info').textContent = info
? `Baki ${info.trayCode} · ${info.count} barang${val === 'all' ? ' · ⚠️ pilih baki spesifik untuk scan' : ' · ✅ siap scan'}`
: (val === 'all' ? '⚠️ Pilih baki spesifik untuk memulai scan' : '');
loadTrayData(val);
}
async function checkSoldProduct(cp) {
try {
const res = await fetch(`${API_BYCODE}${encodeURIComponent(cp)}`);
if (!res.ok) return null;
const d = await res.json();
let item = null;
if (Array.isArray(d) && d.length) item = d[0];
else if (d.items?.length) item = d.items[0];
else if (d.data?.length) item = d.data[0];
else if (d.Name || d.FullName || d.Id) item = d;
if (!item) return null;
let code = item.CodeProduct || '';
if (!code && item.FullName) code = item.FullName.split(' - ')[0].trim();
if (!code) code = cp;
return {
codeProduct: code,
code: item.Code || '-',
name: item.Name || '',
fullName: item.FullName || '',
weight: item.WeightReal || item.WeightSystem || 0,
price: LG.pickProductPrice(item),
image: item.ProductPicture || '',
kadar: item.Kadar || '',
trayCode: item.TrayCode || '-',
stockQty: item.StockQuantity ?? 0,
};
} catch (e) {
return null;
}
}
function applyFilters() {
const banner = document.getElementById('lg-filter-banner');
const bannerText = document.getElementById('lg-filter-banner-text');
const clearBtn = document.getElementById('lg-clear-filter-btn');
if (statusFilter !== 'none') {
filteredProducts = scanLog.filter(l => l.status === statusFilter);
renderProductsFromLog();
if (banner) {
banner.style.display = 'flex';
if (bannerText) {
const statusIcon = {
'MASUK': '✅',
'SUDAH DISCAN': '⚠️',
'SALAH BAKI': '🟠',
'TERJUAL / RUSAK': '🟣',
'BARCODE TIDAK ADA': '🔴',
}[statusFilter] || '🔍';
bannerText.innerHTML = `${statusIcon} Filter: <b style="color:#1e40af;">${esc(statusFilter)}</b> — menampilkan <b>${filteredProducts.length}</b> scan`;
}
if (clearBtn && !filterBtnBound) {
filterBtnBound = true;
clearBtn.addEventListener('click', () => {
statusFilter = 'none';
applyFilters();
});
}
}
} else {
filteredProducts = allProducts.filter(p => {
const s = scannedCodes.has(String(p.codeProduct).toLowerCase());
return scanFilter === 'all' || (scanFilter === 'scanned' && s) || (scanFilter === 'unscanned' && !s);
});
renderProducts();
if (banner) banner.style.display = 'none';
}
updateStats();
updateFilterCounts();
}
function updateFilterCounts() {
const total = allProducts.length;
const sc = allProducts.filter(p => scannedCodes.has(String(p.codeProduct).toLowerCase())).length;
document.querySelectorAll('.lg-scan-tab').forEach(tab => {
const v = tab.dataset.val;
const countEl = tab.querySelector('.lg-tab-count');
if (countEl) countEl.textContent = v === 'all' ? total : v === 'scanned' ? sc : total - sc;
});
}
function resetScanTabUI() {
scanFilter = 'all';
statusFilter = 'none';
document.querySelectorAll('.lg-scan-tab').forEach(t => {
const a = t.dataset.val === 'all';
t.style.background = a ? '#2563eb' : '#fff';
t.style.color = a ? '#fff' : '#64748b';
t.style.borderColor = a ? '#2563eb' : '#cbd5e1';
});
}
function enqueueScan(code) {
if (!code) return;
scanQueue.push(code);
processScanQueue();
}
async function processScanQueue() {
if (isScanning) return;
isScanning = true;
const btn = document.getElementById('lg-scan-btn');
while (scanQueue.length) {
const code = scanQueue.shift();
try {
await doScanInternal(code);
} catch (e) {
console.error('[LiaGold] Scan error:', code, e);
showResult(`❌ Error saat scan "${esc(code)}": ${esc(e.message)}`, ST.TIDAK_ADA, '');
}
}
isScanning = false;
if (btn) {
btn.disabled = false;
btn.textContent = 'CEK';
}
const input = document.getElementById('lg-scan-input');
if (input) input.focus();
}
async function doScanInternal(code) {
if (!traySelected) {
showResult('⚠️ Pilih baki spesifik terlebih dahulu sebelum scan!', ST.TIDAK_ADA, '');
beep(200);
return;
}
if (!allProducts.length) {
showResult('Data baki belum dimuat. Tunggu sebentar…', ST.TIDAK_ADA, '');
return;
}
const btn = document.getElementById('lg-scan-btn');
if (btn) {
btn.disabled = true;
btn.textContent = '…';
}
const now = new Date();
const found = productMap.get(code.toLowerCase());
let st, msg, imgUrl = '', finalCodeProduct = code, finalName = '-', finalTray = '-', finalCode = '-';
if (found) {
imgUrl = found.image;
finalCodeProduct = found.codeProduct;
finalName = found.name;
finalTray = found.trayCode;
finalCode = found.code;
const cpL = String(found.codeProduct).toLowerCase();
if (scannedCodes.has(cpL) || pendingLocalScans.has(cpL)) {
st = ST.SUDAH;
const sKey = sanitizeKey(cpL);
let byWhom = '';
if (isMulti()) {
const foundEntry = Object.values(cloudHistory).find(v =>
v && v.codeProduct && String(v.codeProduct).toLowerCase() === cpL && v.status === 'MASUK'
);
if (foundEntry && foundEntry.by) {
byWhom = ` (oleh ${esc(foundEntry.by)})`;
}
}
msg = `SUDAH DISCAN — "${esc(found.name)}" (${esc(found.codeProduct)}) · Baki ${esc(found.trayCode)}${byWhom}`;
pushDupe(found.codeProduct);
} else if (String(found.trayId) !== selectedTray) {
st = ST.SALAH_BAKI;
msg = `SALAH BAKI — "${esc(found.name)}" seharusnya di Baki ${esc(found.trayCode)}`;
} else {
st = ST.MASUK;
msg = `MASUK — "${esc(found.name)}" · ${esc(found.codeProduct)} · ${found.weight} gr · Kadar ${esc(found.kadar)} · Baki ${esc(found.trayCode)} · Rp${Number(found.price).toLocaleString('id-ID')}`;
}
} else {
showResult(`🔍 Mengecek "${esc(code)}"…`, ST.SUDAH, '');
const soldItem = await checkSoldProduct(code);
if (soldItem) {
imgUrl = soldItem.image;
finalCodeProduct = soldItem.codeProduct;
finalName = soldItem.fullName || soldItem.name;
finalTray = soldItem.trayCode;
finalCode = soldItem.code;
if (soldItem.stockQty > 0) {
st = ST.SALAH_BAKI;
msg = `SALAH BAKI — "${esc(finalName)}" seharusnya di Baki ${esc(soldItem.trayCode)}`;
} else {
st = ST.TERJUAL;
msg = `TERJUAL / RUSAK — "${esc(finalName)}" · ${esc(soldItem.codeProduct)} · ${soldItem.weight} gr · Baki ${esc(soldItem.trayCode)} · Stock: ${soldItem.stockQty}`;
}
} else {
st = ST.TIDAK_ADA;
msg = `BARCODE TIDAK ADA — "${esc(code)}" tidak ditemukan`;
}
}
const logEntry = {
time: now.toLocaleString('id-ID'),
timeIso: now.toISOString(),
scanCode: code,
codeProduct: finalCodeProduct,
code: finalCode,
name: finalName,
tray: finalTray,
image: imgUrl,
status: st.label,
by: myName || '',
};
if (isMulti()) {
scanLog.unshift(logEntry);
if (scanLog.length > MAX_SCAN_LOG) scanLog = scanLog.slice(0, MAX_SCAN_LOG);
if (st === ST.MASUK) {
scannedCodes.add(finalCodeProduct.toLowerCase());
pendingLocalScans.add(finalCodeProduct.toLowerCase());
}
debouncedPersist();
scheduleRender();
updateLastScanAt();
await pushScanToCloud({
by: myName,
time: now.toISOString(),
status: st.label,
codeProduct: finalCodeProduct,
code: finalCode,
name: finalName,
tray: finalTray,
image: imgUrl,
});
} else {
if (st === ST.MASUK) scannedCodes.add(finalCodeProduct.toLowerCase());
scanLog.unshift(logEntry);
if (scanLog.length > MAX_SCAN_LOG) scanLog = scanLog.slice(0, MAX_SCAN_LOG);
persistScanLog();
scheduleRender();
updateLastScanAt();
}
showResult(msg, st, imgUrl);
beep(st === ST.MASUK ? 880 : st === ST.SUDAH ? 440 : 220);
if (autoFillForm && st === ST.MASUK && shouldQueueToForm(logEntry)) {
queueFormInput(finalCodeProduct);
}
}
function beep(freq) {
try {
if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
if (audioCtx.state === 'suspended') audioCtx.resume();
const o = audioCtx.createOscillator();
const g = audioCtx.createGain();
o.frequency.value = freq;
g.gain.value = 0.25;
o.connect(g);
g.connect(audioCtx.destination);
o.start();
o.stop(audioCtx.currentTime + 0.12);
} catch (e) {}
}
function updateStats() {
const total = allProducts.length;
const progress = allProducts.filter(p => scannedCodes.has(String(p.codeProduct).toLowerCase())).length;
const sisa = total - progress;
const pct = total ? Math.round(progress / total * 100) : 0;
const cnt = l => scanLog.filter(x => x.status === l).length;
const sudah = cnt('SUDAH DISCAN');
const cards = [
{ l: 'Data In-Stock', v: total, c: '#1e293b' },
{ l: 'Total Scan', v: scanLog.length, c: '#1e293b' },
{ l: '✅ Masuk', v: cnt('MASUK'), c: '#16a34a', filter: 'MASUK' },
{ l: '⚠️ Sudah Discan', v: sudah, c: '#d97706', filter: 'SUDAH DISCAN' },
{ l: '🟠 Salah Baki', v: cnt('SALAH BAKI'), c: '#ea580c', filter: 'SALAH BAKI' },
{ l: '🟣 Terjual / Rusak', v: cnt('TERJUAL / RUSAK'), c: '#7c3aed', filter: 'TERJUAL / RUSAK' },
{ l: '🔴 Barcode Tidak Ada', v: cnt('BARCODE TIDAK ADA'), c: '#dc2626', filter: 'BARCODE TIDAK ADA' },
{ l: '📊 Progress', v: `${progress}/${total} (${pct}%)`, c: '#2563eb' },
{ l: '⏳ Sisa', v: sisa < 0 ? 0 : sisa, c: '#64748b' },
];
const el = document.getElementById('lg-stats');
if (!el) return;
el.innerHTML = cards.map(c => {
const clickable = !!c.filter;
const active = c.filter && c.filter === statusFilter;
const classes = [];
if (clickable) classes.push('lg-stat-clickable');
if (active) classes.push('lg-stat-active');
return `
<div class="${classes.join(' ')}"
data-filter="${c.filter || ''}"
title="${clickable ? 'Klik untuk filter daftar' : ''}"
style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px 6px;text-align:center;${clickable ? 'cursor:pointer;' : 'cursor:default;'}">
<div style="font-size:1.05rem;font-weight:700;color:${c.c};">${c.v}</div>
<div style="font-size:0.6rem;color:#64748b;margin-top:2px;">${c.l}</div>
</div>
`;
}).join('');
el.querySelectorAll('.lg-stat-clickable').forEach(card => {
card.addEventListener('click', () => {
const filter = card.dataset.filter;
if (!filter) return;
if (statusFilter === filter) {
statusFilter = 'none';
} else {
statusFilter = filter;
}
applyFilters();
});
});
const bar = document.getElementById('lg-progress-bar');
if (bar) {
bar.style.width = pct + '%';
bar.textContent = pct > 8 ? pct + '%' : '';
}
}
function renderLog() {
const el = document.getElementById('lg-log');
if (!el) return;
if (!scanLog.length) {
el.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:16px;">Belum ada riwayat scan</td></tr>';
return;
}
el.innerHTML = scanLog.slice(0, 150).map(l => {
const s = Object.values(ST).find(x => x.label === l.status) || ST.TIDAK_ADA;
return `<tr style="border-bottom:1px solid #f1f5f9;">
<td style="padding:6px 8px;font-size:10px;color:#94a3b8;white-space:nowrap;">${esc(l.time)}</td>
<td style="padding:6px 8px;"><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:10px;border:1px solid #e2e8f0;">${esc(l.scanCode)}</code></td>
<td style="padding:6px 8px;font-size:11px;">${l.codeProduct !== '-' ? `<a href="#" class="lg-img-link" data-img="${escAttr(l.image)}" data-name="${escAttr(l.name)}" style="color:#2563eb;text-decoration:none;font-weight:600;">${esc(l.codeProduct)}</a>` : '-'}</td>
<td style="padding:6px 8px;font-size:11px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(l.name)}</td>
<td style="padding:6px 8px;font-size:10px;text-align:center;color:#64748b;">${esc(l.tray)}</td>
<td style="padding:6px 8px;font-size:10px;text-align:center;color:#64748b;">${esc(l.by || '-')}</td>
<td style="padding:6px 8px;"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;color:${s.color};background:${s.bg};border:1px solid ${s.bd};white-space:nowrap;">${esc(l.status)}</span></td>
</tr>`;
}).join('');
bindImageLinks(el);
}
function renderProducts() {
const el = document.getElementById('lg-products');
if (!el) return;
const table = el.closest('table');
if (table) {
const thead = table.querySelector('thead tr');
if (thead) {
thead.innerHTML = `
<th style="padding:8px;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">No</th>
<th style="padding:8px;text-align:left;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">CodeProduct</th>
<th style="padding:8px;text-align:left;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Nama</th>
<th style="padding:8px;text-align:center;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Baki</th>
<th style="padding:8px;text-align:center;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Berat</th>
<th style="padding:8px;text-align:center;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Kadar</th>
<th style="padding:8px;text-align:right;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Harga</th>
<th style="padding:8px;text-align:center;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">✓</th>
`;
}
}
if (!filteredProducts.length) {
const m = scanFilter === 'unscanned'
? '🎉 Semua sudah discan!'
: scanFilter === 'scanned'
? 'Belum ada yang discan'
: 'Pilih baki untuk memuat';
el.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:16px;">${m}</td></tr>`;
return;
}
el.innerHTML = filteredProducts.map((p, i) => {
const sc = scannedCodes.has(String(p.codeProduct).toLowerCase());
return `<tr style="${sc ? 'opacity:0.45;background:#f0fdf4;' : ''}border-bottom:1px solid #f1f5f9;">
<td style="padding:5px 8px;text-align:center;font-size:10px;color:#94a3b8;">${i + 1}</td>
<td style="padding:5px 8px;"><a href="#" class="lg-img-link" data-img="${escAttr(p.image)}" data-name="${escAttr(p.name)}" style="color:#2563eb;text-decoration:none;font-weight:600;font-size:11px;font-family:monospace;">${esc(p.codeProduct)}</a></td>
<td style="padding:5px 8px;font-size:11px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.name)}</td>
<td style="padding:5px 8px;text-align:center;font-size:10px;color:#64748b;">${esc(p.trayCode)}</td>
<td style="padding:5px 8px;text-align:center;font-size:10px;">${p.weight} gr</td>
<td style="padding:5px 8px;text-align:center;font-size:10px;">${esc(p.kadar)}</td>
<td style="padding:5px 8px;text-align:right;font-size:10px;">Rp${Number(p.price).toLocaleString('id-ID')}</td>
<td style="padding:5px 8px;text-align:center;">${sc ? '✅' : '⬜'}</td>
</tr>`;
}).join('');
bindImageLinks(el);
}
function renderProductsFromLog() {
const el = document.getElementById('lg-products');
if (!el) return;
const table = el.closest('table');
if (table) {
const thead = table.querySelector('thead tr');
if (thead) {
thead.innerHTML = `
<th style="padding:8px;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Waktu</th>
<th style="padding:8px;text-align:left;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">CodeProduct</th>
<th style="padding:8px;text-align:left;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Nama</th>
<th style="padding:8px;text-align:center;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Baki</th>
<th style="padding:8px;text-align:center;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Oleh</th>
<th style="padding:8px;text-align:center;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Status</th>
`;
}
}
if (!filteredProducts.length) {
el.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:16px;">Belum ada scan dengan status "${esc(statusFilter)}"</td></tr>`;
return;
}
el.innerHTML = filteredProducts.map(l => {
const s = Object.values(ST).find(x => x.label === l.status) || ST.TIDAK_ADA;
return `<tr style="border-bottom:1px solid #f1f5f9;">
<td style="padding:5px 8px;font-size:10px;color:#94a3b8;white-space:nowrap;">${esc(l.time || '-')}</td>
<td style="padding:5px 8px;">${l.codeProduct && l.codeProduct !== '-' ? `<a href="#" class="lg-img-link" data-img="${escAttr(l.image)}" data-name="${escAttr(l.name)}" style="color:#2563eb;text-decoration:none;font-weight:600;font-size:11px;font-family:monospace;">${esc(l.codeProduct)}</a>` : '-'}</td>
<td style="padding:5px 8px;font-size:11px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(l.name || '-')}</td>
<td style="padding:5px 8px;text-align:center;font-size:10px;color:#64748b;">${esc(l.tray || '-')}</td>
<td style="padding:5px 8px;text-align:center;font-size:10px;color:#64748b;">${esc(l.by || '-')}</td>
<td style="padding:5px 8px;text-align:center;"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;color:${s.color};background:${s.bg};border:1px solid ${s.bd};white-space:nowrap;">${esc(l.status)}</span></td>
</tr>`;
}).join('');
bindImageLinks(el);
}
function showImageModal(imgUrl, name) {
let ov = document.getElementById('lg-img-overlay');
if (ov) ov.remove();
ov = document.createElement('div');
ov.id = 'lg-img-overlay';
ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100000;display:flex;align-items:center;justify-content:center;cursor:pointer;';
ov.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;max-width:520px;width:90%;text-align:center;cursor:default;box-shadow:0 20px 60px rgba(0,0,0,0.25);animation:lgPop .18s ease;">
<div style="font-weight:700;font-size:14px;color:#1e293b;margin-bottom:14px;">${esc(name || 'Produk')}</div>
${imgUrl ? `<img src="${escAttr(imgUrl)}" style="max-width:100%;max-height:400px;border-radius:8px;border:1px solid #e2e8f0;" onerror="this.outerHTML='<div style=\\'padding:40px;color:#94a3b8;\\'>Gambar tidak tersedia</div>'" />` : '<div style="padding:40px;color:#94a3b8;">Gambar tidak tersedia</div>'}
<div style="margin-top:16px;"><button id="lg-img-close-btn" style="padding:8px 28px;background:#1e293b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">Tutup</button></div>
</div>`;
ov.addEventListener('click', e => {
if (e.target === ov) ov.remove();
});
document.body.appendChild(ov);
document.getElementById('lg-img-close-btn').addEventListener('click', () => ov.remove());
}
function bindImageLinks(c) {
c.querySelectorAll('.lg-img-link').forEach(a => {
a.onclick = e => {
e.preventDefault();
showImageModal(a.dataset.img, a.dataset.name);
};
});
}
function updateStatus(msg) {
const el = document.getElementById('lg-status');
if (el) el.textContent = msg;
}
function showResult(msg, st, imgUrl) {
const el = document.getElementById('lg-result');
if (!el) return;
el.style.display = 'block';
el.style.background = st.bg;
el.style.border = `1px solid ${st.bd}`;
el.style.color = st.color;
el.innerHTML = `<div style="font-weight:700;font-size:13px;">${msg}</div>`;
if (imgUrl) {
el.innerHTML += `<div style="margin-top:6px;"><a href="#" class="lg-img-link" data-img="${escAttr(imgUrl)}" data-name="" style="color:#2563eb;font-size:11px;text-decoration:underline;">📷 Lihat Gambar</a></div>`;
bindImageLinks(el);
}
el.classList.remove('lg-result-anim');
void el.offsetWidth;
el.classList.add('lg-result-anim');
}
function exportLog() {
if (!scanLog.length) {
updateStatus('⚠️ Tidak ada data untuk di-export.');
return;
}
const csvEsc = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
let csv = '\uFEFF' + ['Waktu','Kode Scan','CodeProduct','Code','Nama Barang','Baki','Oleh','Status'].map(csvEsc).join(',') + '\n';
scanLog.forEach(l => {
csv += [l.time, l.scanCode, l.codeProduct, l.code, l.name, l.tray, l.by || '-', l.status].map(csvEsc).join(',') + '\n';
});
const a = document.createElement('a');
a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
a.download = `scan_log_${new Date().toISOString().slice(0, 10)}.csv`;
a.click();
setTimeout(() => URL.revokeObjectURL(a.href), 5000);
updateStatus('✅ CSV berhasil di-export (' + scanLog.length + ' baris).');
}
function resetProgress() {
if (isMulti()) {
if (!confirm('Reset SEMUA progress sesi (untuk semua peserta)?')) return;
fetch(`${FIREBASE}/opname/${sessionId}/history.json`, { method: 'DELETE' });
fetch(`${FIREBASE}/opname/${sessionId}/scans.json`, { method: 'DELETE' });
fetch(`${FIREBASE}/opname/${sessionId}/dupes.json`, { method: 'DELETE' });
pendingLocalScans = new Set();
knownCloudKeys = new Set();
formFilledCodes = new Set();
formAttemptCounts = new Map();
formQueue = [];
formRetryCount = 0;
initialCloudSyncDone = false;
statusFilter = 'none';
lastScanAt = new Date().toISOString();
fbPut(`/opname/${sessionId}/meta/lastScanAt`, lastScanAt).catch(() => {});
updateCountdownDisplay();
updateStatus('🔄 Mereset progress sesi…');
} else {
if (!confirm('Reset semua progress scan?')) return;
scanLog = [];
scannedCodes = new Set();
formFilledCodes = new Set();
formAttemptCounts = new Map();
formQueue = [];
statusFilter = 'none';
localStorage.removeItem('lg_scanLog');
lastScanAt = new Date().toISOString();
localStorage.setItem('lg_lastScanAt', lastScanAt);
updateCountdownDisplay();
updateStats();
renderLog();
applyFilters();
updateStatus('🔄 Progress direset.');
}
}
async function sendToForm() {
if (isProcessingForm) {
updateStatus('⚠️ Proses sedang berjalan. Klik "⏹ Stop" untuk menghentikan.');
return;
}
const input = getFormInput();
if (!input) {
updateStatus('❌ Form tidak ditemukan. Buka /stock-opname/create.');
return;
}
const scannedList = [...scannedCodes];
if (!scannedList.length) {
updateStatus('⚠️ Belum ada barang yang discan.');
return;
}
updateStatus('🔍 Memeriksa isi form…');
const formTextLower = getFormListText();
const missing = scannedList.filter(code => !isCodeInForm(code, formTextLower) && !formFilledCodes.has(code));
const already = scannedList.length - missing.length;
if (!missing.length) {
updateStatus(`✅ Semua ${scannedList.length} barang sudah ada di form.`);
return;
}
if (!confirm(`📊 Hasil pemeriksaan form:\n✅ Sudah ada di form : ${already} barang\n📤 Belum ada di form : ${missing.length} barang\nLanjutkan?`)) return;
missing.forEach(code => queueFormInput(code));
updateStatus(`📤 Mengirim ${missing.length} barang ke form (batch: ${batchSize}, delay: ${batchDelay}ms)...`);
}
function stopFormQueue() {
if (isProcessingForm) {
isStoppingForm = true;
updateStatus('⏹ Menghentikan proses auto-fill...');
} else {
updateStatus('⚠️ Tidak ada proses yang sedang berjalan.');
}
}
function updateBatchSettings() {
const sizeInput = document.getElementById('lg-batch-size');
const delayInput = document.getElementById('lg-batch-delay');
if (sizeInput) {
const newSize = parseInt(sizeInput.value) || 25;
batchSize = Math.max(1, Math.min(100, newSize));
sizeInput.value = batchSize;
localStorage.setItem('lg_batchSize', batchSize);
}
if (delayInput) {
const newDelay = parseInt(delayInput.value) || 1000;
batchDelay = Math.max(100, Math.min(10000, newDelay));
delayInput.value = batchDelay;
localStorage.setItem('lg_batchDelay', batchDelay);
}
updateStatus(`⚙️ Batch settings: ${batchSize} barang/batch, ${batchDelay}ms delay`);
}
function togglePanel() {
panelVisible = !panelVisible;
const p = document.getElementById('lg-panel');
const f = document.getElementById('lg-fab');
if (panelVisible) {
p.style.display = 'block';
f.textContent = '✕';
f.style.background = '#dc2626';
setTimeout(() => document.getElementById('lg-scan-input')?.focus(), 100);
} else {
p.style.display = 'none';
f.textContent = '📦';
f.style.background = '#2563eb';
}
}
window.__lgCloseScannerPanel = () => {
if (panelVisible) togglePanel();
};
function onDocClick(e) {
if (!e.target.closest('#lg-tray-search') && !e.target.closest('#lg-tray-dropdown')) {
const dd = document.getElementById('lg-tray-dropdown');
if (dd) dd.style.display = 'none';
}
}
function injectUI() {
document.getElementById('lg-panel')?.remove();
document.getElementById('lg-fab')?.remove();
document.removeEventListener('click', onDocClick);
const panel = document.createElement('div');
panel.id = 'lg-panel';
panel.style.cssText = `position:fixed;top:0;right:0;width:50vw;min-width:500px;height:100vh;background:#f8fafc;color:#1e293b;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;overflow-y:auto;z-index:99999;border-left:1px solid #e2e8f0;box-shadow:-4px 0 24px rgba(0,0,0,0.08);padding:24px;display:none;`;
panel.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e2e8f0;">
<div>
<div style="font-size:18px;font-weight:800;color:#1e293b;">📦 LiaGold Scanner</div>
<div style="font-size:11px;color:#64748b;margin-top:2px;">Stock Opname · Multiplayer + Merge Solo <b style="color:#16a34a;">v36</b></div>
</div>
<button id="lg-close" style="background:#f1f5f9;border:1px solid #e2e8f0;color:#64748b;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:14px;">✕</button>
</div>
<div id="lg-status" style="font-size:12px;color:#64748b;margin-bottom:12px;padding:8px 12px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;">Pilih baki untuk memulai</div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:12px;">
<div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">👥 Multiplayer</div>
<div id="lg-mp-box"></div>
</div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:12px;">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
<span style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;">🗂️ Baki <span style="color:#dc2626;">*</span></span>
<button id="lg-sync-btn" style="padding:3px 10px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;font-size:10px;color:#64748b;font-weight:600;">🔄 Sinkron Baki</button>
</div>
<div style="position:relative;">
<input id="lg-tray-search" type="text" placeholder="Pilih Baki (wajib untuk scan)" autocomplete="off"
style="width:100%;padding:10px 12px;border-radius:6px;border:1px solid #cbd5e1;font-size:13px;background:#fff;color:#1e293b;font-weight:600;" />
<div id="lg-tray-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #cbd5e1;border-radius:6px;max-height:220px;overflow-y:auto;z-index:10;box-shadow:0 4px 12px rgba(0,0,0,0.1);margin-top:4px;"></div>
</div>
<div id="lg-tray-info" style="margin-top:6px;font-size:10px;color:#94a3b8;">⚠️ Pilih baki spesifik untuk memulai scan</div>
</div>
<div style="background:#e2e8f0;border-radius:8px;height:24px;overflow:hidden;margin-bottom:12px;">
<div id="lg-progress-bar" style="height:100%;background:linear-gradient(90deg,#2563eb,#3b82f6);width:0%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;transition:width 0.4s;border-radius:8px;"></div>
</div>
<div id="lg-stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px;"></div>
<div id="lg-filter-banner" style="display:none;padding:10px 14px;background:linear-gradient(90deg,#eff6ff,#dbeafe);border:1.5px solid #93c5fd;border-radius:8px;font-size:12px;color:#1e3a8a;margin-bottom:12px;align-items:center;justify-content:space-between;gap:10px;">
<span>🔍 <span id="lg-filter-banner-text"></span></span>
<button id="lg-clear-filter-btn" style="padding:5px 12px;background:#2563eb;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap;">✕ Reset Filter</button>
</div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:12px;">
<div style="display:flex;gap:8px;">
<input id="lg-scan-input" type="text" placeholder="Scan barcode / ketik CodeProduct lalu Enter…"
style="flex:1;padding:12px 16px;border-radius:8px;border:2px solid #2563eb;font-size:15px;font-weight:600;color:#1e293b;" />
<button id="lg-scan-btn" style="padding:12px 20px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:14px;">CEK</button>
</div>
<div style="margin-top:10px;">
<label style="display:flex;align-items:center;gap:8px;font-size:11px;color:#64748b;cursor:pointer;user-select:none;">
<input type="checkbox" id="lg-autofill" checked style="accent-color:#2563eb;width:14px;height:14px;" />
Auto-isi & sinkron form <span style="color:#94a3b8;">(hanya produk dari baki aktif)</span>
</label>
</div>
<div style="margin-top:8px;font-size:10px;color:#94a3b8;line-height:1.6;">
✅ Masuk · ⚠️ Sudah Discan · 🟠 Salah Baki · 🟣 Terjual/Rusak · 🔴 Barcode Tidak Ada — <b>semua otomatis</b> · <b style="color:#2563eb;">klik kartu untuk filter</b>
</div>
</div>
<div id="lg-result" style="display:none;padding:12px 16px;border-radius:8px;font-size:13px;margin-bottom:12px;line-height:1.6;"></div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:12px;">
<div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">⚙️ Auto-Fill Settings</div>
<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">
<label style="font-size:11px;color:#64748b;white-space:nowrap;">Batch:</label>
<input id="lg-batch-size" type="number" min="1" max="100" value="${batchSize}"
style="width:60px;padding:5px 8px;border-radius:4px;border:1px solid #cbd5e1;font-size:11px;" />
<span style="font-size:11px;color:#94a3b8;">barang</span>
<label style="font-size:11px;color:#64748b;white-space:nowrap;margin-left:10px;">Delay:</label>
<input id="lg-batch-delay" type="number" min="100" max="10000" step="100" value="${batchDelay}"
style="width:70px;padding:5px 8px;border-radius:4px;border:1px solid #cbd5e1;font-size:11px;" />
<span style="font-size:11px;color:#94a3b8;">ms</span>
<button id="lg-apply-batch-btn" style="padding:5px 12px;background:#16a34a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:10px;font-weight:600;margin-left:auto;">✓ Apply</button>
</div>
<div style="display:flex;gap:6px;flex-wrap:wrap;">
<button id="lg-send-form-btn" style="padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">📤 Kirim ke Form</button>
<button id="lg-stop-form-btn" style="padding:8px 16px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">⏹ Stop</button>
<button id="lg-export-btn" style="padding:8px 16px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">📥 Export CSV</button>
<button id="lg-reset-btn" style="padding:8px 16px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">🔄 Reset Progress</button>
</div>
</div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:14px;overflow:hidden;">
<div style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;font-size:12px;color:#475569;">📜 Riwayat Scan</div>
<div style="max-height:220px;overflow-y:auto;">
<table style="width:100%;border-collapse:collapse;">
<thead>
<tr style="background:#f8fafc;position:sticky;top:0;">
<th style="padding:8px;text-align:left;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Waktu</th>
<th style="padding:8px;text-align:left;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Kode</th>
<th style="padding:8px;text-align:left;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">CodeProduct</th>
<th style="padding:8px;text-align:left;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Nama</th>
<th style="padding:8px;text-align:center;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Baki</th>
<th style="padding:8px;text-align:center;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Oleh</th>
<th style="padding:8px;text-align:left;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Status</th>
</tr>
</thead>
<tbody id="lg-log"></tbody>
</table>
</div>
</div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
<div style="padding:10px 14px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
<span style="font-weight:700;font-size:12px;color:#475569;">📋 Daftar Barang</span>
<div style="display:flex;gap:4px;">
<button class="lg-scan-tab" data-val="all" style="padding:5px 12px;border-radius:5px;border:1px solid #2563eb;background:#2563eb;color:#fff;font-size:10px;cursor:pointer;font-weight:600;">Semua <span class="lg-tab-count">0</span></button>
<button class="lg-scan-tab" data-val="scanned" style="padding:5px 12px;border-radius:5px;border:1px solid #cbd5e1;background:#fff;color:#64748b;font-size:10px;cursor:pointer;font-weight:600;">✅ Sudah <span class="lg-tab-count">0</span></button>
<button class="lg-scan-tab" data-val="unscanned" style="padding:5px 12px;border-radius:5px;border:1px solid #cbd5e1;background:#fff;color:#64748b;font-size:10px;cursor:pointer;font-weight:600;">⬜ Belum <span class="lg-tab-count">0</span></button>
</div>
</div>
<div style="max-height:340px;overflow-y:auto;">
<table style="width:100%;border-collapse:collapse;">
<thead>
<tr style="background:#f8fafc;position:sticky;top:0;">
<th style="padding:8px;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">No</th>
<th style="padding:8px;text-align:left;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">CodeProduct</th>
<th style="padding:8px;text-align:left;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Nama</th>
<th style="padding:8px;text-align:center;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Baki</th>
<th style="padding:8px;text-align:center;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Berat</th>
<th style="padding:8px;text-align:center;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Kadar</th>
<th style="padding:8px;text-align:right;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">Harga</th>
<th style="padding:8px;text-align:center;font-size:10px;color:#64748b;border-bottom:1px solid #e2e8f0;">✓</th>
</tr>
</thead>
<tbody id="lg-products"></tbody>
</table>
</div>
</div>
`;
document.body.appendChild(panel);
const fab = document.createElement('button');
fab.id = 'lg-fab';
fab.textContent = '📦';
fab.style.cssText = `position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:#2563eb;color:#fff;font-size:24px;border:none;cursor:pointer;z-index:99998;box-shadow:0 4px 16px rgba(37,99,235,0.4);`;
fab.onmouseenter = () => fab.style.transform = 'scale(1.1)';
fab.onmouseleave = () => fab.style.transform = 'scale(1)';
document.body.appendChild(fab);
fab.addEventListener('click', togglePanel);
document.getElementById('lg-close').addEventListener('click', togglePanel);
document.getElementById('lg-scan-input').addEventListener('keydown', e => {
if (e.key === 'Enter') {
e.preventDefault();
const inp = document.getElementById('lg-scan-input');
const val = inp.value.trim();
if (val) {
enqueueScan(val);
inp.value = '';
}
}
});
document.getElementById('lg-scan-btn').addEventListener('click', () => {
const inp = document.getElementById('lg-scan-input');
const val = inp.value.trim();
if (val) {
enqueueScan(val);
inp.value = '';
}
});
document.getElementById('lg-export-btn').addEventListener('click', exportLog);
document.getElementById('lg-reset-btn').addEventListener('click', resetProgress);
document.getElementById('lg-sync-btn').addEventListener('click', syncTrayList);
document.getElementById('lg-send-form-btn').addEventListener('click', sendToForm);
document.getElementById('lg-stop-form-btn').addEventListener('click', stopFormQueue);
document.getElementById('lg-apply-batch-btn').addEventListener('click', updateBatchSettings);
document.getElementById('lg-autofill').addEventListener('change', e => {
autoFillForm = e.target.checked;
});
const traySearch = document.getElementById('lg-tray-search');
const trayDrop = document.getElementById('lg-tray-dropdown');
traySearch.addEventListener('focus', () => {
renderTrayDropdown(traySearch.value);
trayDrop.style.display = 'block';
});
traySearch.addEventListener('input', () => {
renderTrayDropdown(traySearch.value);
trayDrop.style.display = 'block';
});
traySearch.addEventListener('keydown', e => {
if (e.key === 'Enter') {
e.preventDefault();
const first = trayDrop.querySelector('.lg-tray-opt');
if (first) first.click();
}
if (e.key === 'Escape') trayDrop.style.display = 'none';
});
document.addEventListener('click', onDocClick);
panel.querySelectorAll('.lg-scan-tab').forEach(tab => {
tab.addEventListener('click', () => {
scanFilter = tab.dataset.val;
statusFilter = 'none';
panel.querySelectorAll('.lg-scan-tab').forEach(t => {
const a = t === tab;
t.style.background = a ? '#2563eb' : '#fff';
t.style.color = a ? '#fff' : '#64748b';
t.style.borderColor = a ? '#2563eb' : '#cbd5e1';
});
applyFilters();
});
});
}
function init() {
if (initialized) return;
initialized = true;
injectStyles();
injectUI();
updateMpUI();
renderLog();
updateStats();
expiryReady = false;
loadLastScanAt().finally(() => {
expiryReady = true;
updateCountdownDisplay();
});
startCountdownInterval();
if (isMulti()) {
listenSession();
checkSessionExpiry();
pendingCloudPushes = LG.parsePendingQueue(localStorage.getItem(PENDING_KEY));
if (pendingCloudPushes.length) scheduleRetryPush();
updateStatus(`🟢 Menyambung ke sesi ${sessionId}…`);
}
if (trayList.length) {
renderTrayDropdown('');
if (!isMulti()) updateStatus(`✅ ${trayList.length} baki tersedia · Pilih baki spesifik untuk scan`);
} else {
syncTrayList();
}
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
setTimeout(init, 500);
} else {
window.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
}
})();
}
function bootByRoute() {
try {
applyRouteClasses();
if (isTotalPage()) startTotalizer();
if (isScannerPage()) startScanner();
} catch (e) {
console.error('[LiaGold Suite] bootByRoute ERROR:', e);
}
}
let lastHref = location.href;
function onRouteChange() {
if (location.href === lastHref) return;
lastHref = location.href;
try {
applyRouteClasses();
const ov = document.getElementById('lg-img-overlay');
if (ov) ov.remove();
if (window.__lgCloseScannerPanel) window.__lgCloseScannerPanel();
if (window.__lgtTriggerNav) window.__lgtTriggerNav();
setTimeout(bootByRoute, 150);
setTimeout(bootByRoute, 800);
setTimeout(bootByRoute, 2200);
} catch (e) {
console.error('[LiaGold Suite] onRouteChange ERROR:', e);
}
}
function patchHistory() {
const wrap = (fn, flag) => {
if (fn && fn[flag]) return fn;
const wrapped = function (...args) {
const res = fn.apply(this, args);
onRouteChange();
return res;
};
wrapped[flag] = true;
return wrapped;
};
history.pushState = wrap(history.pushState, '__lgPushPatched');
history.replaceState = wrap(history.replaceState, '__lgReplacePatched');
}
patchHistory();
setInterval(patchHistory, 2000);
addEventListener('popstate', onRouteChange);
addEventListener('hashchange', onRouteChange);
setInterval(onRouteChange, 900);
bootByRoute();
})();
})();
