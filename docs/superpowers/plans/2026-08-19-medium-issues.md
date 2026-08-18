# Medium Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every remaining open `severity:medium` issue (#20–#26, #28, #29). #24 is likely already done by scoped cache keys — verify and close, do not re-implement.

**Architecture:** Three groups. (1) Payment cache hygiene + lookup pagination. (2) Scanner load/expiry/pending-queue. (3) Firebase blast-radius: crypto IDs, no auto-DELETE on TTL, documented RTDB rules. Full Firebase Auth is **out of scope** (needs a console project and user accounts).

**Tech Stack:** Existing userscript + `node --test`. Start from current `main` (v1.0.34 if #38 is merged).

**Spec:**
- https://github.com/wildnfth/liagold-suite/issues/20
- https://github.com/wildnfth/liagold-suite/issues/21
- https://github.com/wildnfth/liagold-suite/issues/22
- https://github.com/wildnfth/liagold-suite/issues/23
- https://github.com/wildnfth/liagold-suite/issues/24
- https://github.com/wildnfth/liagold-suite/issues/25
- https://github.com/wildnfth/liagold-suite/issues/26
- https://github.com/wildnfth/liagold-suite/issues/28
- https://github.com/wildnfth/liagold-suite/issues/29
- This plan. One PR is fine. **Must** include `Closes #N` for each issue actually fixed.

## Global Constraints

- Do **not** implement Firebase email/password or Google login.
- Do **not** fix remaining minors (#30 #32 #33) except crypto IDs that overlap #21 (session/user id). Leave #33 open unless you also switch every `Math.random` id; if you do switch session + `myId`, add `Closes #33` only if **all** random IDs in the scanner session path are crypto. Prefer closing #33 in the same PR if `createSession` and `myId` both use crypto.
- Do **not** reintroduce Total Bayar.
- `@grant none`. Bump userscript to **1.0.35** on the last commit.
- `npm test` green after every task.

## File map

| File | Issues |
|---|---|
| `lib/payment-lookup.js` | #20 paginate until exact item |
| `tests/payment-lookup.test.js` | |
| `lib/pending-queue.js` | #22 serialize/deserialize pending pushes |
| `tests/pending-queue.test.js` | |
| `lib/random-id.js` | #21 crypto ids |
| `tests/random-id.test.js` | |
| `docs/firebase-rules.md` | #21 recommended rules |
| `liagold-suite.user.js` | all wiring |
| `README.md` | link to firebase-rules |

---

### Task 0: Verify #24 already scoped

- [ ] **Step 1:** `rg "inflight\\.(has|get|set|delete)" liagold-suite.user.js`

Expected: every call uses `scoped(code, nonInvoice)` / `key` from `LG.paymentCacheKey`, not bare `code`.

- [ ] **Step 2:** If already scoped, do **not** change code. Note in the PR: “#24 fixed by #11 / PR #38”. Include `Closes #24`. If any bare `code` remains, wrap it with `scoped(code, nonInvoice)` in the same commit as Task 1.

---

### Task 1: Corrupt payment JSON is deleted (#29)

**Files:** `liagold-suite.user.js` `loadStorageCache`

Current: parse fail / non-object → `return {}` and leave the bad key.

- [ ] **Step 1:** Change `loadStorageCache`:

```js
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
```

- [ ] **Step 2:** Commit `fix(payment): drop corrupt goldPayDetailV4 JSON` `Refs #29`

---

### Task 2: Prune + sync negative cache (#28)

**Files:** Module 1 `tempEmpty`, `niCodeEmpty`, `storage` listener

- [ ] **Step 1:** Add:

```js
  function pruneNegativeCache(now) {
    if (now == null) now = Date.now();
    for (const [k, ts] of tempEmpty) {
      if (now - ts >= TEMP_EMPTY_TTL) tempEmpty.delete(k);
    }
    for (const [k, ts] of niCodeEmpty) {
      if (now - ts >= TEMP_EMPTY_TTL) niCodeEmpty.delete(k);
    }
  }
```

Call `pruneNegativeCache()` at the start of `updateAll` (after the child-page / inject-page guards, before `getTargetTables`).

- [ ] **Step 2:** Storage listener currently:

```js
    storageCache = loadStorageCache();
    memCache.clear();
```

Also: `tempEmpty.clear(); niCodeEmpty.clear(); pruneNegativeCache();`

- [ ] **Step 3:** Commit `fix(payment): prune and cross-tab reset negative cache` `Refs #28`

---

### Task 3: Paginate payment lookup (#20)

**Files:**
- Create: `lib/payment-lookup.js`
- Create: `tests/payment-lookup.test.js`
- Modify: `fetchPayment` / `findExactItem` loop

```js
export function nextPaymentLookupPage({ found, pageNumber, itemCount, pageSize, maxPages }) {
  if (found) return null;
  if (itemCount < pageSize) return null;
  if (pageNumber + 1 >= maxPages) return null;
  return pageNumber + 1;
}
```

Tests:
- found → `null`
- `itemCount < pageSize` → `null`
- `pageNumber 0`, 20 items, pageSize 20, maxPages 5 → `1`
- `pageNumber 4`, 20 items, max 5 → `null`

- [ ] FAIL / implement / PASS / commit helper `Refs #20`

- [ ] **Wire:** Copy onto `LG`. Change `buildApiUrl` / `buildNonInvoicePaymentUrl` to accept `pageNumber` (default 0). Raise `pageSize` to **50**.

In `fetchPayment`, after the first `findExactItem` miss:

```js
        let page = 0;
        const pageSize = 50;
        const maxPages = 5;
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
```

Keep the existing digits-fallback **after** this loop still misses. Do not nest unbounded loops.

`build(code)` today is `buildApiUrl` / `buildNonInvoicePaymentUrl` — extend both to `(filter, pageNumber = 0, pageSize = 50)`.

- [ ] Commit `fix(payment): paginate method lookup until exact Code` `Refs #20`

---

### Task 4: formFilledCodes on solo expiry (#25)

**Files:** `handleSoloExpiry`

- [ ] After clearing `scanLog` / `scannedCodes`, also:

```js
formFilledCodes = new Set();
formAttemptCounts = new Map();
formQueue = [];
```

- [ ] Commit `fix(scanner): reset form-fill state on solo expiry` `Refs #25`

---

### Task 5: loadTrayData must not wipe first (#26)

**Files:** `loadTrayData`, `rebuildProductMap`

- [ ] **Step 1:** Do **not** set `allProducts = []` at the start of `loadTrayData`. Use a local `tmp = []` like `syncTrayList`. Only assign `allProducts = tmp` after the first successful page (`tmp.length` or loop end). If `myLoadId !== currentLoadId`, return **without** clearing the previous `allProducts`.

```js
async function loadTrayData(trayId) {
  const myLoadId = ++currentLoadId;
  isLoading = true;
  const tmp = [];
  ...
    items.forEach(i => tmp.push(mapItem(i)));
  ...
  if (myLoadId !== currentLoadId) return;
  allProducts = tmp;
  rebuildProductMap();
```

- [ ] **Step 2:** `rebuildProductMap` — if a lowercase code already exists, keep the first and increment a `dupes` counter; `updateStatus` once if `dupes > 0` (`⚠️ N codeProduct duplikat, dipakai entri pertama`).

- [ ] Commit `fix(scanner): keep previous tray data until new load lands` `Refs #26`

---

### Task 6: Persist pending cloud pushes (#22)

**Files:**
- Create: `lib/pending-queue.js`
- Create: `tests/pending-queue.test.js`

```js
export function parsePendingQueue(raw) {
  if (raw == null) return [];
  try {
    const val = JSON.parse(raw);
    if (!Array.isArray(val)) return [];
    return val.filter((x) => x && typeof x === 'object' && x.codeProduct);
  } catch (e) {
    return [];
  }
}
```

Tests: corrupt → `[]`; one valid entry kept; missing `codeProduct` dropped.

- [ ] FAIL / implement / PASS / commit helper `Refs #22`

- [ ] **Wire:**
  - `const PENDING_KEY = 'lg_pendingCloudPushes';`
  - After `pendingCloudPushes.push(...)` and after a successful flush, `localStorage.setItem(PENDING_KEY, JSON.stringify(pendingCloudPushes))`.
  - On scanner `init`, if `isMulti()`: `pendingCloudPushes = LG.parsePendingQueue(localStorage.getItem(PENDING_KEY)); if (pendingCloudPushes.length) scheduleRetryPush();`
  - `cleanupSessionLocal` / leave / delete: `localStorage.removeItem(PENDING_KEY)` and `pendingCloudPushes = []`.
  - `beforeunload` already persists scan log; also persist pending if `pendingCloudPushes.length`.

- [ ] Commit `fix(scanner): persist pending cloud pushes` `Refs #22`

---

### Task 7: Crypto IDs + no auto-DELETE on TTL (#21, #23)

**Files:**
- Create: `lib/random-id.js`
- Create: `tests/random-id.test.js`
- Create: `docs/firebase-rules.md`
- Modify: `myId`, `createSession` code, `handleOnlineExpiry`, `README.md`

```js
export function randomBase36(length) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % 36];
  return out;
}
```

Tests: length 8; two calls differ (retry once if flaky); charset only `[0-9a-z]`.

- [ ] FAIL / implement / PASS / commit helper `Refs #21`

- [ ] **Wire `LG.randomBase36`:**

`myId` factory: `'u' + LG.randomBase36(8)`  
`createSession` code: `LG.randomBase36(8).toUpperCase()` (8 chars, not 6)

- [ ] **`handleOnlineExpiry` must not `DELETE` the Firebase tree.**

```js
async function handleOnlineExpiry() {
  if (!sessionId || isDeletingSession) return;
  if (!expiryReady || !LG.isDataExpired(lastScanAt)) return;
  isDeletingSession = true;
  try {
    persistScanLog(); // no-op in multi
    stopCountdownInterval();
    cleanupSessionLocal();
    updateStatus('⏰ Sesi expired di device ini. Data cloud tidak dihapus otomatis.');
    alert('⏰ Data scan sudah lewat 12 jam tanpa scan di device ini.\nKamu keluar ke mode solo.\nSesi cloud tidak dihapus otomatis — pakai “Selesai & Hapus” jika semua sudah selesai.');
  } finally {
    isDeletingSession = false;
  }
}
```

This **removes** the 1-second DELETE retry (#23) because there is no DELETE in the interval path. Manual `deleteSession` stays as-is (user confirmed).

- [ ] **`docs/firebase-rules.md`** — recommended rules (no root list, validate `opname/$code` shape). Link from README. Do not claim the script can apply rules.

- [ ] If `myId` + session code both use crypto, add `Closes #33` on the PR as well.

- [ ] Commit `fix(scanner): crypto session ids; stop auto-delete on expiry` `Refs #21 #23`

---

### Task 8: Version + PR closes

- [ ] `@version 1.0.35`, description listing medium fixes.
- [ ] `npm test` all green.
- [ ] Commit `chore: bump userscript to 1.0.35`
- [ ] PR body **must** contain:

```
Closes #20
Closes #21
Closes #22
Closes #23
Closes #24
Closes #25
Closes #26
Closes #28
Closes #29
```

Add `Closes #33` only if Task 7 switched both random IDs.

---

## Out of scope

- Firebase Authentication product (email/Google).
- Changing `deleteSession` confirm UX.
- Minors #30 #32 unless #33 is included as above.

## Self-review

| Issue | Task |
|---|---|
| #24 | Task 0 verify scoped inflight |
| #29 | Task 1 removeItem |
| #28 | Task 2 prune + storage clear |
| #20 | Task 3 paginate lookup |
| #25 | Task 4 solo expiry reset |
| #26 | Task 5 tmp buffer + first-wins map |
| #22 | Task 6 persist pending |
| #21 #23 | Task 7 crypto + no auto DELETE |

## Manual checks

1. Set `goldPayDetailV4:payments` to `{` — reload purchasing, no throw, key gone.
2. Offline then online — Metode Bayar retries; another tab updates after storage event.
3. Filter that returns >50 PCs — still finds the exact Code.
4. Solo expiry with form-fill history — new scan auto-fill runs again.
5. Switch baki quickly — no empty productMap flash / false TERJUAL.
6. Multi, kill network, scan, close tab, reopen — pending uploads resume.
7. Wait out TTL — device leaves solo; Firebase node still there until “Selesai & Hapus”.
