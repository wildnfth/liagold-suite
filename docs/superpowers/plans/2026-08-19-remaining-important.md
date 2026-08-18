# Remaining Important Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five open `severity:important` issues: scanner storage integrity, scanner price parse, Sudah Discan metric, payment cache scope, and non-invoice Id→PC mapping.

**Architecture:** Two independent parts. Part A is scanner-only (`safeParseArray`, `rebuildScannedCodes`, `pickProductPrice`, stats). Part B is Module 1 payment (`cacheKey` with `inv:`/`ni:`, drop sniffed URL templates, TTL + paginate Id→PC). Lib helpers are tested with `node:test` and copied onto `LG`.

**Tech Stack:** Existing userscript + `npm test` (`node --test`). Current version **1.0.32**.

**Spec:**
- https://github.com/wildnfth/liagold-suite/issues/14
- https://github.com/wildnfth/liagold-suite/issues/7
- https://github.com/wildnfth/liagold-suite/issues/15
- https://github.com/wildnfth/liagold-suite/issues/11
- https://github.com/wildnfth/liagold-suite/issues/13
- This plan. Parts A and B may be two PRs. PR body must include `Closes #N` for every issue the PR actually fixes.

## Global Constraints

- Do **not** fix medium/minor leftovers (#20–#33 except what falls out of #11/#13).
- Do **not** reintroduce Total Bayar.
- Do **not** change Firebase auth (#21).
- `@grant none`, single-file Tampermonkey. `LG` bodies identical to `lib/`.
- Bump to **1.0.33** after Part A, **1.0.34** after Part B.
- `npm test` green after every task. Commit with `Refs` / final PR with `Closes`.

## File map

| File | Part |
|---|---|
| `lib/scan-storage.js` | #14 parse + rebuild scanned set |
| `tests/scan-storage.test.js` | |
| `lib/product-price.js` | #7 pick numeric price |
| `tests/product-price.test.js` | |
| `lib/payment-cache-key.js` | #11 scoped keys |
| `tests/payment-cache-key.test.js` | |
| `lib/ni-url.js` | #13 clean API URLs |
| `tests/ni-url.test.js` | |
| `liagold-suite.user.js` | wire all of the above |

---

# Part A — scanner (#14, #7, #15)

### Task 1: safe array parse + rebuild scannedCodes (#14)

**Files:**
- Create: `lib/scan-storage.js`
- Create: `tests/scan-storage.test.js`

**Interfaces:**
- `export function parseArrayJson(raw, fallback): any[]`
  - `raw == null` → `fallback`
  - `JSON.parse` throws → `fallback`
  - parsed value not `Array.isArray` (including `null`, `{}`, `"x"`) → `fallback`
  - else return the array
- `export function scannedCodesFromLog(scanLog): string[]`
  - unique lowercased `codeProduct` where `status === 'MASUK'`
  - skip entries that are not objects or lack `codeProduct`

- [ ] **Step 1: Failing tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArrayJson, scannedCodesFromLog } from '../lib/scan-storage.js';

describe('parseArrayJson', () => {
  it('returns fallback for missing, corrupt, and non-array JSON', () => {
    assert.deepEqual(parseArrayJson(null, []), []);
    assert.deepEqual(parseArrayJson('{', ['x']), ['x']);
    assert.deepEqual(parseArrayJson('{}', []), []);
    assert.deepEqual(parseArrayJson('null', []), []);
    assert.deepEqual(parseArrayJson('"nope"', []), []);
  });

  it('returns a parsed array', () => {
    assert.deepEqual(parseArrayJson('[1,2]', []), [1, 2]);
  });
});

describe('scannedCodesFromLog', () => {
  it('keeps unique MASUK codes, lowercased', () => {
    const codes = scannedCodesFromLog([
      { status: 'MASUK', codeProduct: 'AbC' },
      { status: 'MASUK', codeProduct: 'abc' },
      { status: 'SALAH BAKI', codeProduct: 'zzz' },
      null,
      { status: 'MASUK' },
    ]);
    assert.deepEqual(codes, ['abc']);
  });
});
```

- [ ] **Step 2: Run — expect `ERR_MODULE_NOT_FOUND`**

`node --test tests/scan-storage.test.js`

- [ ] **Step 3: Implement**

```js
export function parseArrayJson(raw, fallback) {
  if (raw == null) return fallback;
  try {
    const val = JSON.parse(raw);
    return Array.isArray(val) ? val : fallback;
  } catch (e) {
    return fallback;
  }
}

export function scannedCodesFromLog(scanLog) {
  const set = new Set();
  if (!Array.isArray(scanLog)) return [];
  for (const row of scanLog) {
    if (!row || row.status !== 'MASUK' || row.codeProduct == null || row.codeProduct === '') continue;
    set.add(String(row.codeProduct).toLowerCase());
  }
  return [...set];
}
```

- [ ] **Step 4: PASS + commit** `test(scanner): validate scan arrays and rebuild codes` `Refs #14`

---

### Task 2: Wire storage + stop overwriting solo log (#14)

**Files:** Modify `liagold-suite.user.js`

- [ ] **Step 1:** Copy both functions onto `LG`. Update synced-from comment.

- [ ] **Step 2:** Replace scanner `safeParse` usages for arrays:

```js
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
```

Init:
```js
let trayList = safeParseArray('lg_trayList', []);
let scanLog = safeParseArray('lg_scanLog', []);
let scannedCodes = new Set();
rebuildScannedCodes();
```

Leave the generic `safeParse` in place if anything else still uses it; if only arrays used it, you may keep `safeParse` for objects unused or delete it if unused (`rg safeParse`).

- [ ] **Step 3:** `persistScanLog` after every successful `setItem` and after the 500-slice fallback must call `rebuildScannedCodes()`.

- [ ] **Step 4:** While `isMulti()`, **do not** write `lg_scanLog`.

```js
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
```

`leaveSession` may still call `persistScanLog()` — it becomes a no-op in multi, then `cleanupSessionLocal` reloads the **solo** `lg_scanLog` that was not overwritten. `onCloudUpdate` → `debouncedPersist` also no-ops in multi.

After `cleanupSessionLocal` reloads `scanLog`, call `rebuildScannedCodes()` instead of inlining the Set constructor.

- [ ] **Step 5:** `npm test` + commit `fix(scanner): validate localStorage and keep solo log off-session` `Refs #14`

---

### Task 3: Product price (#7)

**Files:**
- Create: `lib/product-price.js`
- Create: `tests/product-price.test.js`

**Interfaces:**
- `export function pickProductPrice(item, parseIdNumber): number`
  - Prefer first finite **number**: `SellingPrice`, `Price`, `SellingPriceValue` (skip if string)
  - Else `parseIdNumber(item.SellingPriceDisplay || item.Price || 0)`
  - Never `Number("1.500.000")`

```js
export function pickProductPrice(item, parseIdNumber) {
  if (!item || typeof item !== 'object') return 0;
  for (const key of ['SellingPrice', 'Price', 'SellingPriceValue']) {
    if (typeof item[key] === 'number' && Number.isFinite(item[key])) return item[key];
  }
  return parseIdNumber(item.SellingPriceDisplay || item.Price || 0);
}
```

- [ ] **Step 1: Tests** — `1.500.000` display → `1500000`; numeric `SellingPrice: 1500000` wins over a bad display string; `null` item → `0`.

- [ ] **Step 2: FAIL / implement / PASS / commit helper** `Refs #7`

- [ ] **Step 3: Wire** `LG.pickProductPrice(item)` that calls `LG.parseIdNumber`.

In `mapItem`:
```js
price: LG.pickProductPrice(item),
```

In `checkSoldProduct` return object:
```js
price: LG.pickProductPrice(item),
```

Display sites already do `Number(p.price).toLocaleString('id-ID')` — now `price` is numeric so that is correct. Leave them.

- [ ] **Step 4:** commit `fix(scanner): parse product price as id-ID number` `Refs #7`

---

### Task 4: Sudah Discan metric (#15)

**Files:** Modify `updateStats` only.

- [ ] **Step 1:** Replace

```js
const sudah = isMulti() ? dupeCount : cnt('SUDAH DISCAN');
```

with

```js
const sudah = cnt('SUDAH DISCAN');
```

Do not delete `dupeCount` updates (other code may still increment it). Just stop using it on the card.

- [ ] **Step 2:** Bump `@version` to **1.0.33**, description mentioning scanner storage, price, Sudah Discan.

- [ ] **Step 3:** `npm test` + commit `fix(scanner): count Sudah Discan from log in solo and multi` `Refs #15`

---

# Part B — payment (#11, #13)

### Task 5: Scoped cache keys (#11)

**Files:**
- Create: `lib/payment-cache-key.js`
- Create: `tests/payment-cache-key.test.js`

```js
export function paymentCacheKey(code, nonInvoice) {
  return (nonInvoice ? 'ni:' : 'inv:') + String(code || '');
}
```

Tests: `'PC1', false` → `'inv:PC1'`; `'PC1', true` → `'ni:PC1'`; they differ.

- [ ] FAIL / implement / PASS / commit helper `Refs #11`

- [ ] **Wire:** Copy onto `LG`.

`getCache(code)` and `setCache(code, value)` stay as-is **but every caller** must pass the scoped key.

Cleaner: change signatures to `getCache(code, nonInvoice)` / `setCache(code, nonInvoice, value)` / `isTempEmpty(code, nonInvoice)` / `setTempEmpty(code, nonInvoice)` / `inflight` Map keys.

```js
function scoped(code, nonInvoice) {
  return LG.paymentCacheKey(code, nonInvoice);
}
```

Update every `getCache(code)`, `setCache(code, value)`, `inflight.has(code)`, `isTempEmpty(code)` inside `fetchPayment` and `processNonInvoiceRows` / `processTable` to use `scoped(code, nonInvoice)` (`true` on non-invoice paths, `false` on invoice).

`fetchPayment(code, nonInvoice)` already has the flag — use it for all maps in that function.

Grep `getCache(`, `setCache(`, `inflight.`, `isTempEmpty(`, `setTempEmpty(` and fix every site. Do not leave a bare `code` key.

- [ ] `npm test` + commit `fix(payment): scope cache keys by invoice vs non-invoice` `Refs #11`

---

### Task 6: Clean non-invoice URLs + Id map (#13)

**Files:**
- Create: `lib/ni-url.js`
- Create: `tests/ni-url.test.js`

```js
export function buildNiLookupUrl(origin, path, filter, pageSize, pageNumber = 0) {
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
```

Tests: sniffed query `?from=2020&generalFilter=old` must **not** appear; only the params set above.

- [ ] FAIL / implement / PASS / commit helper `Refs #13`

- [ ] **Wire `LG.buildNiLookupUrl`.**

`buildNonInvoiceUrl(filter, pageSize, pageNumber = 0)` becomes:

```js
return LG.buildNiLookupUrl(location.origin, '/web/purchasing/detail-non-invoice', filter, pageSize, pageNumber);
```

`buildNonInvoicePaymentUrl(filter)` uses path `/web/purchasing/non-invoice` the same way (pageSize 20, page 0).

**Delete** writes to `niApiTemplate` and `niPayApiTemplate` in `absorb`. Keep `rememberNiItems(json)` on detail responses. You may leave the unused variables or delete them if `rg` shows no reads.

- [ ] **`niCodeCache` TTL:** store `{ code, t }` or parallel `niCodeCacheTime` Map. On get, if older than `LG.PAYMENT_CACHE_TTL_MS` (30m), treat as miss. `rememberNiItems` / `niCodeCache.set` write `Date.now()`.

Simplest: change the Map value from `code` string to `{ c: code, t: Date.now() }` and update every `.get` / `.set` / `.has`.

- [ ] **`ensureNiBulk`:** loop `pageNumber` 0..9 (max 10 pages × 500). Stop when `items.length === 0` or `< 500`. **Do not** set cooldown-as-success if the first page throws (keep existing catch cooldown). Do **not** call `setNiCodeEmpty` from bulk itself.

In `resolveNonInvoiceCode`, if after bulk the id is still missing, `setNiCodeEmpty` only if bulk finished without throw (add `let bulkOk = false` from `ensureNiBulk` returning boolean).

```js
export async function ... ensureNiBulk already in userscript:
async function ensureNiBulk() {
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
```

Then:

```js
if (!item) {
  const bulkOk = await ensureNiBulk();
  if (niCodeCache still has key) return code;
  if (bulkOk) setNiCodeEmpty(key);
  return '';
}
```

- [ ] On `LG.isPurchasingFamilyChild` / leaving inject pages, optional `niCodeCache.clear()` inside Module 1 `stripPurchasingInjects` — do it.

- [ ] Bump version **1.0.34**. `npm test`. Commit `fix(payment): clean NI urls, TTL Id map, paginate bulk` `Refs #13`

---

## Out of scope

- #20 pageSize 20 on payment search (invoice list) — not the same as NI bulk
- #21 Firebase rules
- #22 pendingCloudPushes
- #24 inflight page type — largely covered by #11 scoped keys; do not extra-fix
- #25 formFilledCodes on solo expiry

## Self-review

- #14 parse + rebuild + no multi persist to `lg_scanLog` → Tasks 1–2
- #7 pickProductPrice → Task 3
- #15 cnt('SUDAH DISCAN') always → Task 4
- #11 `ni:` / `inv:` keys → Task 5
- #13 no sniffed template, paginated bulk, cache TTL → Task 6
- PR must say `Closes #14` `Closes #7` `Closes #15` (Part A) and `Closes #11` `Closes #13` (Part B)

## Manual checks

1. Corrupt `localStorage.lg_scanLog` to `{}` — reload scanner, no throw, empty log.
2. Solo scan, join session, leave — solo log is the pre-session scans, not the whole cloud history.
3. Product with `SellingPriceDisplay: "1.500.000"` — UI shows Rp1.500.000 not Rp1,5.
4. Multi session, scan duplicate — Sudah Discan card equals log rows with that status, not `/dupes` length.
5. Same PC on invoice vs non-invoice with different methods — each page shows its own method.
6. Non-invoice after changing date filter — Metode Bayar still resolves (not stuck on old date template).
