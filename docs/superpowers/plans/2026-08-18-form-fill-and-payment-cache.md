# Form-fill integrity + payment cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop auto-fill from marking SKUs as sent when the ERP form did not change, and stop Metode Bayar from showing stale or “empty” payment methods from a cache that never expires.

**Architecture:** Two independent parts. Part A extracts a pure form-fill policy (`recordFormAttempt`) and wires `processFormQueue`. Part B extracts payment-cache policy (`isPaymentCacheFresh`, `isEmptyPayment`, `classifyPaymentFetch`) and wires `getCache` / `setCache` / `fetchPayment` / `resolveNonInvoiceCode`. No bundler — lib is tested, bodies copied into `LG` like existing helpers.

**Tech Stack:** Vanilla userscript, Node `node:test` (already in `package.json`), existing `LG` object in `liagold-suite.user.js`.

**Spec:**
- https://github.com/wildnfth/liagold-suite/issues/6
- https://github.com/wildnfth/liagold-suite/issues/9
- https://github.com/wildnfth/liagold-suite/issues/10
- https://github.com/wildnfth/liagold-suite/issues/12
- This plan. Parts A and B may be two PRs.

## Global Constraints

- Do **not** fix #11 (invoice vs non-invoice cache key), #13 (ni template/bulk), #21 (Firebase auth), #22, #25, #5, #7.
- Do **not** reintroduce the Total Bayar column.
- Keep `@grant none`, single-file Tampermonkey install.
- `lib/*.js` is source of truth; `LG` bodies must stay identical (comment `// synced from lib/<file>`).
- `npm test` → `node --test` (no extra npm deps).
- Current userscript version is **1.0.29**. Bump to **1.0.30** after Part A, **1.0.31** after Part B.
- Each task ends with a commit that `Refs` the issue numbers.
- Part A does not require Part B. Either can ship first. If both run in one session, do A then B.

## File map

| File | Responsibility |
|---|---|
| `lib/form-fill-policy.js` | `recordFormAttempt` |
| `tests/form-fill-policy.test.js` | Issue #6 cases |
| `lib/payment-cache-policy.js` | TTL constants, freshness, empty-payment, fetch classification |
| `tests/payment-cache-policy.test.js` | Issues #9 #10 #12 cases |
| `liagold-suite.user.js` | `LG` + Module 3 `processFormQueue` + Module 1 cache/fetch |

---

# Part A — formFilledCodes only after a real form change (issue #6)

### Task 1: Form-fill policy helper

**Files:**
- Create: `lib/form-fill-policy.js`
- Create: `tests/form-fill-policy.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export const MAX_FORM_CODE_ATTEMPTS = 3`
  - `export function recordFormAttempt(attempts, code, success, maxAttempts = MAX_FORM_CODE_ATTEMPTS)`
  - `attempts` is a `Map` (lowercase code → number). Mutated in place.
  - Return type: `{ markFilled: boolean, retry: boolean, giveUp: boolean }`

Contract:
- `success === true` → delete key from map, `{ markFilled: true, retry: false, giveUp: false }`
- `success === false` → increment count; if count `< max` → `{ markFilled: false, retry: true, giveUp: false }`; if count `>= max` → `{ markFilled: false, retry: false, giveUp: true }`
- `code` is compared/stored lowercased

- [ ] **Step 1: Write the failing tests**

Create `tests/form-fill-policy.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FORM_CODE_ATTEMPTS, recordFormAttempt } from '../lib/form-fill-policy.js';

describe('recordFormAttempt', () => {
  it('marks filled and clears attempts on success', () => {
    const attempts = new Map([['sku1', 2]]);
    const r = recordFormAttempt(attempts, 'SKU1', true);
    assert.deepEqual(r, { markFilled: true, retry: false, giveUp: false });
    assert.equal(attempts.has('sku1'), false);
  });

  it('retries on first failure and does not mark filled', () => {
    const attempts = new Map();
    const r = recordFormAttempt(attempts, 'abc', false);
    assert.deepEqual(r, { markFilled: false, retry: true, giveUp: false });
    assert.equal(attempts.get('abc'), 1);
  });

  it('gives up after MAX_FORM_CODE_ATTEMPTS failures', () => {
    const attempts = new Map();
    let last;
    for (let i = 0; i < MAX_FORM_CODE_ATTEMPTS; i++) {
      last = recordFormAttempt(attempts, 'x', false);
    }
    assert.deepEqual(last, { markFilled: false, retry: false, giveUp: true });
    assert.equal(attempts.get('x'), MAX_FORM_CODE_ATTEMPTS);
  });

  it('does not mark filled when giving up', () => {
    const attempts = new Map([['y', MAX_FORM_CODE_ATTEMPTS - 1]]);
    const r = recordFormAttempt(attempts, 'Y', false);
    assert.equal(r.markFilled, false);
    assert.equal(r.giveUp, true);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `node --test tests/form-fill-policy.test.js`

Expected: `ERR_MODULE_NOT_FOUND` for `../lib/form-fill-policy.js`

- [ ] **Step 3: Implement `lib/form-fill-policy.js`**

```js
export const MAX_FORM_CODE_ATTEMPTS = 3;

export function recordFormAttempt(attempts, code, success, maxAttempts = MAX_FORM_CODE_ATTEMPTS) {
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
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test tests/form-fill-policy.test.js`

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/form-fill-policy.js tests/form-fill-policy.test.js
git commit -m "test(scanner): add form-fill attempt policy

Refs #6"
```

---

### Task 2: Wire processFormQueue

**Files:**
- Modify: `liagold-suite.user.js`
  - add `LG.MAX_FORM_CODE_ATTEMPTS` + `LG.recordFormAttempt` (identical to lib)
  - scanner scope: `let formAttemptCounts = new Map();` next to `formFilledCodes`
  - replace the fill + always-`formFilledCodes.add` block (~2708–2733)
  - success toast only when the loop finished with an empty queue
  - clear `formAttemptCounts` wherever `formFilledCodes` is already cleared (`resetProgress`, `cleanupSessionLocal`, `createSession` / `joinSession` resets)

**Interfaces:**
- Consumes: `LG.recordFormAttempt`
- Produces: `formFilledCodes` only grows when the form actually contains the code or counters changed

- [ ] **Step 1: Copy policy onto `LG`**

Append to the `LG` object (same bodies as lib). Update the synced-from comment to include `lib/form-fill-policy.js`.

- [ ] **Step 2: Add `formAttemptCounts` and reset it with `formFilledCodes`**

Next to `let formFilledCodes = new Set();` add:

```js
let formAttemptCounts = new Map();
```

Every assignment `formFilledCodes = new Set()` (createSession, joinSession, cleanupSessionLocal, resetProgress solo + multi) must also do `formAttemptCounts = new Map();`.

- [ ] **Step 3: Replace the fill block inside `processFormQueue`**

Delete this pattern:

```js
const beforeSig = getFormCounters();
if (fillCodeProductToForm(code)) {
  await sleep(150);
  clickSearchBtn();
  await waitForFormChange(beforeSig, 6000);
}
formFilledCodes.add(lc);
processed++;
batchCount++;
await sleep(50);
```

Replace with:

```js
const already = isCodeInForm(code);
let changed = false;
if (!already) {
  const beforeSig = getFormCounters();
  const filled = fillCodeProductToForm(code);
  if (filled) {
    await sleep(150);
    clickSearchBtn();
    changed = await waitForFormChange(beforeSig, 6000);
  }
}
const success = already || changed || isCodeInForm(code);
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
```

Keep the earlier `if (isCodeInForm(code)) { formFilledCodes.add(lc); continue; }` **or** fold it into the block above (do not double-count `processed` — if you keep the early `isCodeInForm` continue, do not increment `processed` there unless you already did; current code increments nothing on that continue. Leave that early-continue as-is so already-on-form codes do not call `recordFormAttempt`).

Keep the missing-form `return` inside `try` (finally still clears `isProcessingForm`). Introduce `let exitedEarly = false;` at the start of the try. Set `exitedEarly = true` immediately before that `return` (form disappeared mid-loop).

- [ ] **Step 4: Fix the success toast**

Replace:

```js
if (processed > 0 && !isStoppingForm) {
  updateStatus(`✅ ${processed} kode berhasil diinput ke form.`);
}
```

with:

```js
if (processed > 0 && !isStoppingForm && !exitedEarly && formQueue.length === 0) {
  updateStatus(`✅ ${processed} kode berhasil diinput ke form.`);
} else if (exitedEarly && processed > 0) {
  updateStatus(`⏸️ ${processed} kode terinput. Form hilang, sisa di-retry.`);
}
```

`exitedEarly` must be declared in the function outer scope (before `try`) so the toast after `finally` can read it. Initialize `false`.

- [ ] **Step 5: Bump version**

Header: `@version 1.0.30` and description mentioning form-fill only marks success after the form changes.

- [ ] **Step 6: Run full tests**

Run: `npm test`

Expected: all existing tests + form-fill-policy PASS.

- [ ] **Step 7: Commit**

```bash
git add liagold-suite.user.js
git commit -m "fix(scanner): mark form filled only after ERP accepts code

Stop formFilledCodes false positives. Retry up to 3 times.
Do not toast success on early form-loss return.

Refs #6"
```

---

# Part B — payment cache TTL, no error-as-empty, no permanent empty (issues #9 #10 #12)

### Task 3: Payment cache policy helper

**Files:**
- Create: `lib/payment-cache-policy.js`
- Create: `tests/payment-cache-policy.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export const PAYMENT_CACHE_TTL_MS = 30 * 60 * 1000`
  - `export const TEMP_EMPTY_TTL_MS = 60 * 1000` (keep current 60s for real misses)
  - `export function isPaymentCacheFresh(entry, now = Date.now(), ttlMs = PAYMENT_CACHE_TTL_MS): boolean`
  - `export function isEmptyPayment(value): boolean`
  - `export function classifyPaymentFetch({ networkError, itemFound, value }): 'persist' | 'tempEmpty' | 'none'`

Contract locked:

`isPaymentCacheFresh`
- `entry` missing or `entry.t` not a finite number → `false`
- `now - entry.t > ttlMs` → `false`
- else `true`

`isEmptyPayment`
- `true` when `value` is null/undefined
- `true` when `(value.m == null || String(value.m).trim() === '' || value.m === '-')` **and** `(Number(value.a) || 0) === 0`
- `false` when method is a real name (even if amount is 0)
- `false` when amount is non-zero (even if method is `-`)

`classifyPaymentFetch`
- `networkError === true` → `'none'` (issue #9: do not cache errors)
- `itemFound === false` → `'tempEmpty'` (real miss, 60s)
- `itemFound === true` && `isEmptyPayment(value)` → `'tempEmpty'` (issue #12)
- `itemFound === true` && not empty → `'persist'` (issue #10 stores `t`)

- [ ] **Step 1: Write the failing tests**

Create `tests/payment-cache-policy.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_CACHE_TTL_MS,
  isPaymentCacheFresh,
  isEmptyPayment,
  classifyPaymentFetch,
} from '../lib/payment-cache-policy.js';

const NOW = Date.parse('2026-08-18T12:00:00.000Z');

describe('isPaymentCacheFresh', () => {
  it('is false without a timestamp', () => {
    assert.equal(isPaymentCacheFresh(null, NOW), false);
    assert.equal(isPaymentCacheFresh({}, NOW), false);
    assert.equal(isPaymentCacheFresh({ t: 'nope' }, NOW), false);
  });

  it('is true inside TTL and false after', () => {
    assert.equal(isPaymentCacheFresh({ t: NOW - 1000 }, NOW), true);
    assert.equal(isPaymentCacheFresh({ t: NOW - PAYMENT_CACHE_TTL_MS - 1 }, NOW), false);
  });
});

describe('isEmptyPayment', () => {
  it('treats missing, dash, and blank method with zero amount as empty', () => {
    assert.equal(isEmptyPayment(null), true);
    assert.equal(isEmptyPayment({ m: '-', a: 0 }), true);
    assert.equal(isEmptyPayment({ m: '', a: 0 }), true);
    assert.equal(isEmptyPayment({ m: '  ', a: 0 }), true);
  });

  it('keeps a named method or a non-zero amount', () => {
    assert.equal(isEmptyPayment({ m: 'Cash', a: 0 }), false);
    assert.equal(isEmptyPayment({ m: '-', a: 15000 }), false);
  });
});

describe('classifyPaymentFetch', () => {
  it('does not cache network errors', () => {
    assert.equal(classifyPaymentFetch({ networkError: true, itemFound: false, value: null }), 'none');
  });

  it('temp-empties real misses and empty successes', () => {
    assert.equal(classifyPaymentFetch({ networkError: false, itemFound: false, value: null }), 'tempEmpty');
    assert.equal(
      classifyPaymentFetch({ networkError: false, itemFound: true, value: { m: '-', a: 0 } }),
      'tempEmpty'
    );
  });

  it('persists a real method', () => {
    assert.equal(
      classifyPaymentFetch({ networkError: false, itemFound: true, value: { m: 'Transfer BCA', a: 0 } }),
      'persist'
    );
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `node --test tests/payment-cache-policy.test.js`

Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: Implement `lib/payment-cache-policy.js`**

```js
export const PAYMENT_CACHE_TTL_MS = 30 * 60 * 1000;
export const TEMP_EMPTY_TTL_MS = 60 * 1000;

export function isPaymentCacheFresh(entry, now = Date.now(), ttlMs = PAYMENT_CACHE_TTL_MS) {
  if (!entry || !Number.isFinite(entry.t)) return false;
  return now - entry.t <= ttlMs;
}

export function isEmptyPayment(value) {
  if (!value) return true;
  const method = String(value.m ?? '').trim();
  const amount = Number(value.a) || 0;
  const methodEmpty = method === '' || method === '-';
  return methodEmpty && amount === 0;
}

export function classifyPaymentFetch({ networkError, itemFound, value }) {
  if (networkError) return 'none';
  if (!itemFound) return 'tempEmpty';
  if (isEmptyPayment(value)) return 'tempEmpty';
  return 'persist';
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test tests/payment-cache-policy.test.js`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/payment-cache-policy.js tests/payment-cache-policy.test.js
git commit -m "test(payment): add cache freshness and classify policy

Refs #9 #10 #12"
```

---

### Task 4: Wire Module 1 cache + fetch

**Files:**
- Modify: `liagold-suite.user.js`
  - copy policy onto `LG`
  - `getCache` / `setCache` / `fetchPayment` / `resolveNonInvoiceCode` catch
  - `TEMP_EMPTY_TTL` already `60 * 1000` — keep the constant, or set it from `LG.TEMP_EMPTY_TTL_MS`

**Interfaces:**
- Consumes: `LG.isPaymentCacheFresh`, `LG.isEmptyPayment`, `LG.classifyPaymentFetch`, `LG.PAYMENT_CACHE_TTL_MS`
- Produces: stale/empty/error results are not treated as durable Metode Bayar

- [ ] **Step 1: Copy policy onto `LG`**

Identical bodies. Update synced-from comment to include `lib/payment-cache-policy.js`.

- [ ] **Step 2: `getCache` honors TTL**

Replace `getCache` so expired entries are deleted and treated as miss:

```js
  function getCache(code) {
    const stored = storageCache[code];
    if (!stored || !LG.isPaymentCacheFresh(stored)) {
      if (stored) {
        delete storageCache[code];
        memCache.delete(code);
        saveStorageCache();
      } else {
        memCache.delete(code);
      }
      return null;
    }

    const val = {
      m: typeof stored.m === 'string' ? stored.m : '-',
      a: Number(stored.a) || 0
    };
    memCache.set(code, val);
    return val;
  }
```

Do **not** return `memCache` without checking `storageCache[code].t`. If only mem is present (should not happen after this), miss.

- [ ] **Step 3: `setCache` unchanged shape, still writes `t: Date.now()`**

Existing `setCache` already writes `t`. Leave it. Callers decide whether to call it.

On `saveStorageCache` quota `catch`, evict expired keys then the oldest half of remaining entries and retry **once**:

```js
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
```

- [ ] **Step 4: `fetchPayment` uses `classifyPaymentFetch`**

Inside the async IIFE, replace the success/empty/catch tail with:

```js
        if (!item) {
          const kind = LG.classifyPaymentFetch({ networkError: false, itemFound: false, value: null });
          if (kind === 'tempEmpty') setTempEmpty(code);
          return { m: '', a: 0 };
        }

        const value = {
          m: extractPaymentMethod(item),
          a: LG.parseIdNumber(item.TotalPurchase)
        };

        const kind = LG.classifyPaymentFetch({ networkError: false, itemFound: true, value });
        if (kind === 'persist') setCache(code, value);
        else if (kind === 'tempEmpty') setTempEmpty(code);
        return kind === 'persist' ? value : { m: value.m || '', a: value.a || 0 };
      } catch (err) {
        LG.classifyPaymentFetch({ networkError: true, itemFound: false, value: null });
        return { m: '', a: 0 };
      } finally {
        inflight.delete(code);
      }
```

The `catch` must **not** call `setTempEmpty`. The classify call in catch is documentation-only; you may omit it and just `return { m: '', a: 0 }`.

Use `LG.parseIdNumber` if `parseApiAmount` is still a wrapper — either is fine, do not change parse rules.

- [ ] **Step 5: `resolveNonInvoiceCode` catch must not `setNiCodeEmpty`**

In `resolveNonInvoiceCode`, keep `setNiCodeEmpty` only on the “item not found / no code” paths. Change the outer `catch` to:

```js
      } catch (e) {
        return '';
      } finally {
        niCodeInflight.delete(key);
      }
```

Network failure → next `scheduleUpdate` retries. Do not 60s-lock a live Id.

- [ ] **Step 6: Run full tests**

Run: `npm test`

Expected: all PASS.

- [ ] **Step 7: Bump version to 1.0.31** and commit

Header description: payment cache TTL 30m, errors not cached, empty method not persisted.

```bash
git add liagold-suite.user.js
git commit -m "fix(payment): expire cache, skip errors and empty methods

Metode Bayar no longer sticks on stale or dash values.
Network failures are not stored as temp-empty.

Refs #9 #10 #12"
```

---

## Out of scope

- #11 cache key scope invoice vs non-invoice
- #13 niApiTemplate date filters / bulk 500
- #19 (obsolete — Total Bayar column removed)
- #21 Firebase auth
- #25 formFilledCodes on solo expiry (related; if you touch `handleSoloExpiry` in Part A you **may** also `formFilledCodes = new Set(); formAttemptCounts = new Map();` there — do it if you see the assignment list, do not expand further)

## Self-review

**Spec coverage**
- #6 mark only after change → Task 2 `success = already || changed || isCodeInForm`
- #6 retry → Task 1/2 `recordFormAttempt` max 3
- #6 no success toast on early return → Task 2 `exitedEarly`
- #9 error ≠ tempEmpty → Task 4 catch without `setTempEmpty`; classify `'none'`
- #10 TTL + eviction → Task 3 freshness + Task 4 `getCache` + quota prune
- #12 empty persist → classify `'tempEmpty'` not `setCache`

**Placeholders:** none.

**Independence:** Part A can merge without Part B. `LG` keys do not clash.

---

## Manual checks after implementation (human, on liagold.cuan.co)

**#6**
1. `/stock-opname/create`, pilih baki, scan 1 MASUK dengan form sengaja di-block (jangan klik search / tutup form). Status bukan “berhasil”. Scan ulang setelah form hidup — kode masuk form.
2. Kirim ke Form 3 kode; hentikan di tengah. Toast bukan “✅ N berhasil” untuk sisa yang belum masuk.

**#9 #10 #12**
1. `/purchasing`, DevTools offline, reload — Metode Bayar boleh kosong; online lagi dalam <60s harus fetch ulang (bukan nempel kosong 60s).
2. Transaksi yang metodenya baru diisi di ERP: dalam 30 menit boleh masih cache; setelah 30 menit (atau hapus `localStorage` key `goldPayDetailV4:payments`) tampil metode baru.
3. Transaksi belum bayar (`-` / 0) lalu dibayar: dalam 60s boleh kosong; setelah itu fetch ulang menampilkan metode baru, bukan `-` selamanya.
