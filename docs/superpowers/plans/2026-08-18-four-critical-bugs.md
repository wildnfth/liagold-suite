# Four Critical Bugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop four critical failures: accidental multiplayer session delete, duplicate scan history on merge, wrong Indonesian money/weight totals, and ERP footer reading Totalizer scratch values.

**Architecture:** Extract three pure helpers (`session-expiry`, `history-key`, `parse-id-number`) into `lib/` and test them with Node's built-in test runner. Copy the exact function bodies into a shared `LG` object at the top of `liagold-suite.user.js` (Tampermonkey is a single IIFE; no bundler). Module 1/2/3 call `LG.*` instead of their local copies. No behavior change outside these four issues.

**Tech Stack:** Vanilla userscript (one file), Node.js `node:test` (no npm deps), GitHub issues #1–#4 as spec.

**Spec:**
- https://github.com/wildnfth/liagold-suite/issues/1
- https://github.com/wildnfth/liagold-suite/issues/2
- https://github.com/wildnfth/liagold-suite/issues/3
- https://github.com/wildnfth/liagold-suite/issues/4
- This plan is the implementation spec. Executors read the issue + the matching task below.

## Global Constraints

- Do **not** fix important/medium/minor issues in this pass (no cache TTL, no Firebase auth, no REG_LONG, no formFilledCodes).
- Do **not** split `liagold-suite.user.js` into multiple userscript files.
- Keep `@grant none` and Tampermonkey single-file install.
- `lib/*.js` is the tested source of truth. The `LG` block in the userscript must stay byte-for-byte identical to those functions (comment `// synced from lib/<file>`).
- Locale for number parsing is **id-ID first** (`.` thousands, `,` decimal), with a US fallback only when both separators exist and `.` is last.
- `Math.random` must not appear in history keys.
- Unknown `lastScanAt` must never trigger `DELETE` or wipe `lg_scanLog`.
- Tests run with `npm test` → `node --test tests`.
- Each task ends with a commit. Reference the GitHub issue (`Refs #N`).
- Do not bump userscript `@version` until Task 4 commit (then `1.0.25` → `1.0.26`).

## File map

| File | Responsibility |
|---|---|
| `package.json` | `"type": "module"`, script `test` |
| `lib/session-expiry.js` | `DATA_TTL_MS`, `parseTimestamp`, `getRemainingTime`, `isDataExpired` |
| `lib/history-key.js` | `sanitizeKey`, `generateHistoryKey` |
| `lib/parse-id-number.js` | `parseIdNumber` |
| `tests/session-expiry.test.js` | Issue #1 cases |
| `tests/history-key.test.js` | Issue #2 cases |
| `tests/parse-id-number.test.js` | Issue #3 cases |
| `liagold-suite.user.js` | Embed `LG`, wire Modules 1–3, footer isolation |

```
liagold-suite/
  lib/
    session-expiry.js
    history-key.js
    parse-id-number.js
  tests/
    session-expiry.test.js
    history-key.test.js
    parse-id-number.test.js
  liagold-suite.user.js
  package.json
```

---

### Task 1: Session expiry must not treat unknown time as expired (issue #1)

**Files:**
- Create: `package.json`
- Create: `lib/session-expiry.js`
- Create: `tests/session-expiry.test.js`
- Modify: `liagold-suite.user.js` — add `LG` stub + expiry helpers; replace `getRemainingTime` / `isDataExpired` / `loadLastScanAt` catch / `startCountdownInterval` / `init` / `handleOnlineExpiry` guard (around lines 2398–2476, 2478–2488, 4397–4402)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export const DATA_TTL_MS = 12 * 60 * 60 * 1000`
  - `export function parseTimestamp(value): number | null`
  - `export function getRemainingTime(lastScanAt, now = Date.now(), ttlMs = DATA_TTL_MS): number | null`
  - `export function isDataExpired(lastScanAt, now = Date.now(), ttlMs = DATA_TTL_MS): boolean`
  - Userscript: `let expiryReady = false` in scanner scope; `LG.parseTimestamp`, `LG.getRemainingTime`, `LG.isDataExpired`, `LG.DATA_TTL_MS`

- [ ] **Step 1: Add package.json**

```json
{
  "name": "liagold-suite",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests"
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/session-expiry.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA_TTL_MS,
  parseTimestamp,
  getRemainingTime,
  isDataExpired,
} from '../lib/session-expiry.js';

const TTL = DATA_TTL_MS;
const NOW = Date.parse('2026-08-18T12:00:00.000Z');

describe('parseTimestamp', () => {
  it('returns null for null, undefined, empty, and garbage', () => {
    assert.equal(parseTimestamp(null), null);
    assert.equal(parseTimestamp(undefined), null);
    assert.equal(parseTimestamp(''), null);
    assert.equal(parseTimestamp('not-a-date'), null);
  });

  it('parses ISO strings', () => {
    assert.equal(parseTimestamp('2026-08-18T12:00:00.000Z'), NOW);
  });
});

describe('getRemainingTime', () => {
  it('returns null when lastScanAt is missing (unknown, not zero)', () => {
    assert.equal(getRemainingTime(null, NOW, TTL), null);
    assert.equal(getRemainingTime('', NOW, TTL), null);
  });

  it('returns remaining ms when still valid', () => {
    const last = new Date(NOW - 60 * 60 * 1000).toISOString();
    assert.equal(getRemainingTime(last, NOW, TTL), TTL - 60 * 60 * 1000);
  });

  it('returns 0 when older than TTL', () => {
    const last = new Date(NOW - TTL - 1).toISOString();
    assert.equal(getRemainingTime(last, NOW, TTL), 0);
  });
});

describe('isDataExpired', () => {
  it('is false when lastScanAt is unknown', () => {
    assert.equal(isDataExpired(null, NOW, TTL), false);
    assert.equal(isDataExpired(undefined, NOW, TTL), false);
    assert.equal(isDataExpired('', NOW, TTL), false);
  });

  it('is false when within TTL', () => {
    const last = new Date(NOW - 1000).toISOString();
    assert.equal(isDataExpired(last, NOW, TTL), false);
  });

  it('is true only when timestamp is known and older than TTL', () => {
    const last = new Date(NOW - TTL - 1).toISOString();
    assert.equal(isDataExpired(last, NOW, TTL), true);
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

Run: `npm test`

Expected: `ERR_MODULE_NOT_FOUND` for `../lib/session-expiry.js`

- [ ] **Step 4: Implement `lib/session-expiry.js`**

```js
export const DATA_TTL_MS = 12 * 60 * 60 * 1000;

export function parseTimestamp(value) {
  if (value == null || value === '') return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export function getRemainingTime(lastScanAt, now = Date.now(), ttlMs = DATA_TTL_MS) {
  const t = parseTimestamp(lastScanAt);
  if (t == null) return null;
  return Math.max(0, t + ttlMs - now);
}

export function isDataExpired(lastScanAt, now = Date.now(), ttlMs = DATA_TTL_MS) {
  const remaining = getRemainingTime(lastScanAt, now, ttlMs);
  if (remaining == null) return false;
  return remaining <= 0;
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm test`

Expected: all `session-expiry` tests pass.

- [ ] **Step 6: Embed helpers in the userscript**

Immediately after `window.__lgUltimateSuite = true;` (top IIFE, before Module 1), insert:

```js
  // synced from lib/session-expiry.js, lib/history-key.js, lib/parse-id-number.js
  // Keep bodies identical. Later tasks fill history-key + parse-id-number.
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
    }
  };
```

- [ ] **Step 7: Wire scanner expiry to `LG` + `expiryReady`**

In Module 3 scanner (same scope as `lastScanAt`):

1. Add `let expiryReady = false;` next to `let lastScanAt = null;`.

2. Replace local `getRemainingTime` / `isDataExpired` with:

```js
function getRemainingTime() {
  const remaining = LG.getRemainingTime(lastScanAt);
  return remaining == null ? 0 : remaining;
}
function isDataExpired() {
  if (!expiryReady) return false;
  return LG.isDataExpired(lastScanAt);
}
```

UI countdown may still use `getRemainingTime()` which returns `0` when unknown — `updateCountdownDisplay` already hides the element when `!lastScanAt`. Do not show `DATA EXPIRED` unless `expiryReady && LG.isDataExpired(lastScanAt)`.

Change the expired branch in `updateCountdownDisplay`:

```js
if (expiryReady && LG.isDataExpired(lastScanAt)) {
  countdownEl.innerHTML = '⏰ DATA EXPIRED';
  // ...existing red styles...
  return;
}
```

3. `loadLastScanAt` — on fetch failure do **not** overwrite a known timestamp with `null`:

```js
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
```

4. `handleOnlineExpiry` first lines become:

```js
async function handleOnlineExpiry() {
  if (!sessionId || isDeletingSession) return;
  if (!expiryReady || !LG.isDataExpired(lastScanAt)) return;
  // ...existing DELETE...
}
```

5. `handleSoloExpiry` first lines become:

```js
function handleSoloExpiry() {
  if (!expiryReady || !LG.isDataExpired(lastScanAt)) return;
  if (scanLog.length === 0) return;
  // ...existing wipe...
}
```

6. `init` must not start destructive countdown before load finishes:

```js
expiryReady = false;
loadLastScanAt().finally(() => {
  expiryReady = true;
  updateCountdownDisplay();
});
startCountdownInterval();
```

Keep `startCountdownInterval()` — the interval is safe because `isDataExpired()` is false until `expiryReady`.

7. `checkSessionExpiry` already calls `handleOnlineExpiry` after setting `lastScanAt` from meta. After this change, missing timestamps will not delete. Leave the rest of `checkSessionExpiry` alone.

- [ ] **Step 8: Manual check (no browser automation required)**

Re-read the wired functions and confirm:
- `LG.isDataExpired(null) === false`
- `handleOnlineExpiry` returns before `fetch(..., { method: 'DELETE' })` when `!expiryReady`
- `loadLastScanAt` catch does not assign `lastScanAt = null`

- [ ] **Step 9: Commit**

```bash
git add package.json lib/session-expiry.js tests/session-expiry.test.js liagold-suite.user.js
git commit -m "fix(scanner): do not expire unknown lastScanAt

Unknown or failed meta fetch is not a 12h timeout.
Stops accidental DELETE of live multiplayer sessions.

Refs #1"
```

---

### Task 2: Deterministic history keys (issue #2)

**Files:**
- Create: `lib/history-key.js`
- Create: `tests/history-key.test.js`
- Modify: `liagold-suite.user.js` — add `LG.sanitizeKey` / `LG.generateHistoryKey`; replace scanner `sanitizeKey` / `generateHistoryKey`; change EventSource `/scans` merge to use the **server key**

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export function sanitizeKey(str): string`
  - `export function generateHistoryKey(codeProduct, timestamp): string`
  - Same names on `LG`
  - Contract: same `(codeProduct, timestamp)` always returns the same key; no `Math.random`

- [ ] **Step 1: Write the failing tests**

Create `tests/history-key.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeKey, generateHistoryKey } from '../lib/history-key.js';

describe('sanitizeKey', () => {
  it('replaces Firebase-illegal characters', () => {
    assert.equal(sanitizeKey('a.b#c$d[e]f/g'), 'a_b_c_d_e_f_g');
  });
});

describe('generateHistoryKey', () => {
  it('is deterministic for the same code + timestamp', () => {
    const a = generateHistoryKey('ABC-1', '2026-08-18T12:00:00.000Z');
    const b = generateHistoryKey('ABC-1', '2026-08-18T12:00:00.000Z');
    assert.equal(a, b);
  });

  it('lowercases the product code', () => {
    const a = generateHistoryKey('AbC', '2026-08-18T12:00:00.000Z');
    const b = generateHistoryKey('abc', '2026-08-18T12:00:00.000Z');
    assert.equal(a, b);
  });

  it('differs when timestamp differs', () => {
    const a = generateHistoryKey('abc', '2026-08-18T12:00:00.000Z');
    const b = generateHistoryKey('abc', '2026-08-18T12:00:01.000Z');
    assert.notEqual(a, b);
  });

  it('does not contain a random suffix', () => {
    const key = generateHistoryKey('sku1', '2026-08-18T12:00:00.000Z');
    assert.equal(key, sanitizeKey('sku1_2026-08-18T12:00:00.000Z'));
  });

  it('migrate idempotency: existingKeys.has(key) is true on second generate', () => {
    const existing = new Set();
    const key1 = generateHistoryKey('sku1', '2026-08-18T12:00:00.000Z');
    existing.add(key1);
    const key2 = generateHistoryKey('sku1', '2026-08-18T12:00:00.000Z');
    assert.equal(existing.has(key2), true);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `node --test tests/history-key.test.js`

Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: Implement `lib/history-key.js`**

```js
export function sanitizeKey(str) {
  return String(str).replace(/[.#$\[\]/]/g, '_');
}

export function generateHistoryKey(codeProduct, timestamp) {
  const cp = String(codeProduct || '').toLowerCase();
  const ts = String(timestamp || '');
  return sanitizeKey(cp + '_' + ts);
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test tests/history-key.test.js`

Expected: PASS

- [ ] **Step 5: Copy into `LG` and delete local random key**

Add to the `LG` object in `liagold-suite.user.js` (same bodies as lib):

```js
    sanitizeKey(str) {
      return String(str).replace(/[.#$\[\]/]/g, '_');
    },
    generateHistoryKey(codeProduct, timestamp) {
      const cp = String(codeProduct || '').toLowerCase();
      const ts = String(timestamp || '');
      return LG.sanitizeKey(cp + '_' + ts);
    },
```

In the scanner IIFE, replace the local functions with wrappers (keep call sites unchanged):

```js
function sanitizeKey(str) {
  return LG.sanitizeKey(str);
}
function generateHistoryKey(codeProduct, timestamp) {
  return LG.generateHistoryKey(codeProduct, timestamp);
}
```

Confirm the new `generateHistoryKey` has **no** `Math.random`.

- [ ] **Step 6: Prefer `timeIso` when migrating**

In `migrateSoloScansToSession`, change the key line to:

```js
const uniqueKey = generateHistoryKey(l.codeProduct, l.timeIso || '');
if (!l.timeIso || existingKeys.has(uniqueKey)) return;
```

Skip rows without `timeIso` rather than keying on locale `l.time` (`toLocaleString('id-ID')` is not stable).

`pushScanToCloud` already sends `time: now.toISOString()`. Keep using that ISO string as the second argument (`entry.time`).

- [ ] **Step 7: Merge EventSource `/scans` by server key**

Every block that currently does:

```js
const uniqueKey = generateHistoryKey(v.codeProduct, v.time || '');
if (!cloudHistory[uniqueKey]) {
  cloudHistory[uniqueKey] = v;
}
```

must become (use the Firebase child key `k` from `Object.entries`):

```js
if (!cloudHistory[k]) {
  cloudHistory[k] = v;
}
```

There are four such loops in `listenSession` (`put` path `/`, `put` path `/scans`, `patch` path `/`, `es.onerror` resync). Change all four. Do not invent a new key.

- [ ] **Step 8: Commit**

```bash
git add lib/history-key.js tests/history-key.test.js liagold-suite.user.js
git commit -m "fix(scanner): make history keys deterministic

Drop Math.random from generateHistoryKey so solo-to-session
migrate is idempotent. Merge /scans by server key.

Refs #2"
```

---

### Task 3: Parse Indonesian numbers correctly (issue #3)

**Files:**
- Create: `lib/parse-id-number.js`
- Create: `tests/parse-id-number.test.js`
- Modify: `liagold-suite.user.js` — add `LG.parseIdNumber`; replace the number-normalization inside Module 1 `parseCell` + `parseApiAmount` and Module 2 `parseCell`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export function parseIdNumber(value): number`
  - `LG.parseIdNumber(value)`
  - Contract (id-ID first):

| Input | Output |
|---|---|
| `1500000` | `1500000` |
| `1.500.000` | `1500000` |
| `1.500.000,00` | `1500000` |
| `1.234,56` | `1234.56` |
| `1234,56` | `1234.56` |
| `12,50` | `12.5` |
| `1.500` | `1500` |
| `12.5` | `12.5` |
| `12.50` | `12.5` |
| `1,500,000` | `1500000` |
| `1,234,567.89` | `1234567.89` |
| `1,5` | `1.5` |
| `-1.500.000` | `-1500000` |
| `−12,50` (U+2212) | `-12.5` |
| `Rp 1.500.000` | `1500000` |
| `1.500.000 gr` | `1500000` |
| `''` / `null` / `undefined` | `0` |
| `1500000` (number) | `1500000` |
| `1.5` (number) | `1.5` |
| `NaN` (number) | `0` |

Rules to implement (do not invent others):
1. If `typeof value === 'number'`: return it if `Number.isFinite`, else `0`.
2. Strip everything except digits, `.`, `,`, `-`, `−`. Remember negativity if the original string contains `-` or `−`.
3. Remove sign characters from the digit string.
4. If both `.` and `,` exist: the **last** one is the decimal separator; delete the other everywhere. Then `parseFloat`.
5. If only `.`:
   - more than one `.` → thousands, delete all `.`
   - one `.` and 3 fraction digits → thousands (id-ID `1.500`), delete `.`
   - one `.` and 1–2 fraction digits → decimal, keep
6. If only `,`:
   - more than one `,` → US thousands, delete all `,`
   - one `,` and 3+ fraction digits that are all groups of 3 from the end with extra commas already handled — for a **single** comma: 1–3 fraction digits are **decimal** (id-ID `1,5` / `1,50` / `1,500` → `1.5` / `1.5` / `1.5`). Wait: `1,500` as `1.5` is the id-ID rule in the table above.
   - implement single comma as decimal: replace `,` with `.`
7. Apply sign. `parseFloat` failure → `0`.

Clarification locked here: **single comma always decimal**. `1,500` → `1.5`. `1,500,000` (two commas) → `1500000`.

- [ ] **Step 1: Write the failing tests**

Create `tests/parse-id-number.test.js` with one `it` per row of the table above (plus the number/NaN/null rows). Example skeleton:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseIdNumber } from '../lib/parse-id-number.js';

const cases = [
  ['1500000', 1500000],
  ['1.500.000', 1500000],
  ['1.500.000,00', 1500000],
  ['1.234,56', 1234.56],
  ['1234,56', 1234.56],
  ['12,50', 12.5],
  ['1.500', 1500],
  ['12.5', 12.5],
  ['12.50', 12.5],
  ['1,500,000', 1500000],
  ['1,234,567.89', 1234567.89],
  ['1,5', 1.5],
  ['-1.500.000', -1500000],
  ['−12,50', -12.5],
  ['Rp 1.500.000', 1500000],
  ['1.500.000 gr', 1500000],
  ['', 0],
  [null, 0],
  [undefined, 0],
  [1500000, 1500000],
  [1.5, 1.5],
  [NaN, 0],
];

describe('parseIdNumber', () => {
  for (const [input, expected] of cases) {
    it(`${String(input)} → ${expected}`, () => {
      assert.equal(parseIdNumber(input), expected);
    });
  }
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `node --test tests/parse-id-number.test.js`

Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: Implement `lib/parse-id-number.js`**

```js
export function parseIdNumber(value) {
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
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test tests/parse-id-number.test.js`

Expected: every row PASS. If a row fails, fix `parseIdNumber` only — do not weaken the table.

- [ ] **Step 5: Copy into `LG` and switch Module 1 + Module 2**

Add `parseIdNumber` to `LG` (identical body).

**Module 1 `parseCell`** — keep the cell/null/`data-val` read for now (Task 4 removes it). Replace the normalize + `parseFloat` block with:

```js
      const isNegative = /[-−]/.test(String(raw)) || !!cell.querySelector('.lgt-neg');
      const num = LG.parseIdNumber(raw);
      if (!num && num !== 0) return 0;
      return isNegative ? -Math.abs(num) : num;
```

`parseIdNumber` already applies the minus in `raw`. If `raw` is a positive `data-val` and `.lgt-neg` is present, the extra `isNegative` still forces a minus (Task 4 removes that). Do not double-negate: `parseIdNumber('-1.500.000')` is already negative; then `isNegative` is true; `-Math.abs(num)` is still `-1500000`. Safe.

**Module 1 `parseApiAmount`:**

```js
  function parseApiAmount(value) {
    return LG.parseIdNumber(value);
  }
```

**Module 2 `parseCell`:** same change as Module 1 `parseCell` (still may read `data-val` until Task 4).

- [ ] **Step 6: Run full test suite**

Run: `npm test`

Expected: all tests from Tasks 1–3 pass.

- [ ] **Step 7: Commit**

```bash
git add lib/parse-id-number.js tests/parse-id-number.test.js liagold-suite.user.js
git commit -m "fix(footer): parse id-ID money and weight

1.500.000 is 1500000, not 1.5. Shared LG.parseIdNumber
used by Module 1 and Module 2.

Refs #3"
```

---

### Task 4: ERP footer must ignore Totalizer scratch cache (issue #4)

**Files:**
- Modify: `liagold-suite.user.js` only
  - Module 1 `parseCell` (~318–348)
  - Module 2 `parseCell` (~1566–1583)
  - Totalizer `parseNum` (~1956)
  - Totalizer `span.dataset.val` (~2174)
  - Totalizer `getSelectionKey` / `saveSelection` / `update` reads of `dataset.val` (~1970–1977, 2003)

**Interfaces:**
- Consumes: `LG.parseIdNumber` from Task 3
- Produces: footer `parseCell` reads **only** `cell.textContent`; Totalizer stores `data-lgt-val` (not `data-val`)

- [ ] **Step 1: Write a node test for footer isolation**

Add to `tests/parse-id-number.test.js` (or new `tests/parse-footer-cell.test.js` if you prefer a new file):

The footer helper is the policy we will paste into both modules. Put it in lib so it stays tested:

Create `lib/parse-footer-cell.js`:

```js
import { parseIdNumber } from './parse-id-number.js';

export function parseFooterRaw(textContent) {
  return parseIdNumber(textContent);
}
```

This function must **not** accept a `data-val` argument. Tests:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFooterRaw } from '../lib/parse-footer-cell.js';

describe('parseFooterRaw', () => {
  it('reads visible id-ID text, not a pre-stripped integer', () => {
    assert.equal(parseFooterRaw('12,50 gr'), 12.5);
    assert.equal(parseFooterRaw('1.500.000'), 1500000);
  });

  it('does not have a data-val parameter', () => {
    assert.equal(parseFooterRaw.length, 1);
  });
});
```

- [ ] **Step 2: Run the new test — expect FAIL then implement lib and PASS**

Run: `node --test tests/parse-footer-cell.test.js`

Implement the one-liner lib file above, re-run, expect PASS.

- [ ] **Step 3: Module 1 + Module 2 `parseCell` — text only**

Replace both `parseCell` implementations with this shape (Module 1 keeps its try/catch; Module 2 can stay without):

```js
  function parseCell(cell) {
    if (!cell) return 0;
    return LG.parseIdNumber(cell.textContent);
  }
```

**Delete** these lines from both modules:
- `cell.querySelector('[data-val]')`
- `dataValEl ? dataValEl.getAttribute('data-val') : ...`
- `cell.querySelector('.lgt-neg')`
- any `isNegative ? -Math.abs(num) : num` extra pass (sign is inside `parseIdNumber`)

`parseIdNumber` already handles `−` / `-` in the visible text (`12,50` with CSS `::before` minus is **not** in `textContent` — that is Totalizer-only scratch and must not affect the footer).

- [ ] **Step 4: Totalizer writes `data-lgt-val`, not `data-val`**

In `processTextNode`:

```js
span.dataset.lgtVal = String(LG.parseIdNumber(h.v));
```

Remove `span.dataset.val = String(parseNum(h.v));`.

Replace local `parseNum` usages for the stored value with `LG.parseIdNumber`. Keep `parseNum` only if something else still calls it; if not, delete `parseNum`.

Update every Totalizer read:
- `getSelectionKey`: `const val = span.dataset.lgtVal || '';`
- `saveSelection`: `{ val: span.dataset.lgtVal, neg: !!neg }`
- `update`: `const v = +s.dataset.lgtVal || 0;`

Do **not** leave a `data-val` attribute on `.lgt-num` (defense in depth if an old parseCell is ever reintroduced).

- [ ] **Step 5: Grep for leftovers**

Run: `rg "data-val|dataset\\.val|lgt-neg" liagold-suite.user.js`

Allowed leftovers:
- CSS `.lgt-num.lgt-sel.lgt-neg` and click-cycle that toggles `.lgt-neg` **inside the Totalizer**
- Module 2 observer `attributeFilter: ['data-val', 'class']` may keep `data-val` (harmless) or change to `data-lgt-val`

Forbidden leftovers:
- Module 1/2 `parseCell` reading `[data-val]` or `.lgt-neg`
- `span.dataset.val =`

- [ ] **Step 6: Bump userscript version**

Header:
```
// @version      1.0.26
// @description  v1.0.26: fix session expiry race, deterministic scan keys, id-ID parse, footer ignores totalizer
```

- [ ] **Step 7: Run full tests**

Run: `npm test`

Expected: all files in `tests/` PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/parse-footer-cell.js tests/parse-footer-cell.test.js tests/parse-id-number.test.js liagold-suite.user.js
git commit -m "fix(footer): ignore totalizer data-val and lgt-neg

ERP totals read cell text via parseIdNumber only.
Totalizer stores data-lgt-val for its own UI.

Refs #4"
```

---

## Out of scope (do not do in this plan)

- Issue #5 REG_LONG splitting unformatted numbers
- Issue #6 formFilledCodes premature add
- Payment cache TTL / eviction / invoice vs non-invoice keys (#9–#13)
- Firebase auth (#21)
- `pendingCloudPushes` persist (#22)
- Cleaning already-duplicated random keys already sitting in live Firebase (new writes are deterministic; old rows stay)

## Self-review

**Spec coverage**
- #1 unknown `lastScanAt` not expired → Task 1 `isDataExpired` + `expiryReady` + no `lastScanAt = null` on fetch fail + DELETE guard
- #1 init race → Task 1 `expiryReady` false until `loadLastScanAt` settles
- #2 random key → Task 2 `generateHistoryKey` without `Math.random`
- #2 migrate idempotent → Task 2 test `existingKeys.has` + `timeIso` only
- #2 `/scans` remapped → Task 2 server key `k`
- #3 id-ID table → Task 3 `parseIdNumber` + Module 1/2 wire-up
- #4 footer `data-val` / `.lgt-neg` → Task 4 text-only `parseCell` + rename attribute

**Placeholders:** none. Function bodies and test tables are complete.

**Type consistency:** `getRemainingTime` in lib returns `number | null`; userscript wrapper for UI maps `null` → `0` so existing countdown math does not get `null`. `isDataExpired` in lib does not know `expiryReady`; the userscript wrapper adds that flag. `generateHistoryKey(codeProduct, timestamp)` signature unchanged at call sites except migrate (requires `timeIso`).

---

## Manual verification after all four tasks (human, on liagold.cuan.co)

1. **#1:** Join a live sesi, reload `/stock-opname` with DevTools offline for 2 seconds, go online. Sesi masih ada. Countdown tidak menulis `DATA EXPIRED` sebelum meta ter-load.
2. **#2:** Scan 1 barang solo, buat sesi, keluar, buat sesi lagi. Firebase `/history` tidak mendapat duplikat key untuk scan yang sama.
3. **#3:** Tabel purchasing dengan `1.500.000` di kolom harga — footer menampilkan `1.500.000`, bukan `2` atau `1,5`.
4. **#4:** Klik 2× sebuah harga (mode kurang, merah) — footer ERP tetap positif. Kolom berat `12,50` tetap `12,50 gr`, bukan `1.250 gr`.
