# Totalizer Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the click-to-sum Totalizer wrap whole money amounts, remember the correct row, not block Angular clicks, not skip DOM updates, and keep seeing SPA navigations.

**Architecture:** Extract two pure helpers (`findNumberHits`, `buildSelectionKey`) plus a tiny throttle scheduler (`scheduleProcessAll`). Copy bodies onto `LG`. Wire only Module 3 Totalizer and the suite `history.pushState` wrapper. Do not change Module 1/2 footers or the scanner.

**Tech Stack:** Vanilla userscript, existing `node --test` / `LG` embed pattern, current version **1.0.31**.

**Spec:**
- https://github.com/wildnfth/liagold-suite/issues/5
- https://github.com/wildnfth/liagold-suite/issues/16
- https://github.com/wildnfth/liagold-suite/issues/17
- https://github.com/wildnfth/liagold-suite/issues/18
- https://github.com/wildnfth/liagold-suite/issues/31
- This plan

## Global Constraints

- Do **not** change payment inject, scanner form-fill, or Firebase.
- Keep wrapping only inside `TABLE_ZONE`; do not wrap IDs/years in unknown columns (`REG_STRICT` stays thousands-only).
- Money/total/price/amount/totalReal/cashBanks use the new “long” matcher (issue #5).
- `data-lgt-val` stays; do not bring back `data-val`.
- Values still go through `LG.parseIdNumber`.
- `@grant none`, single file. Bump `@version` to **1.0.32** on the last userscript commit.
- `npm test` must stay green after every task.
- Each task commits with `Refs #N`.

## File map

| File | Responsibility |
|---|---|
| `lib/totalizer-numbers.js` | `findNumberHits(text, mode)` |
| `tests/totalizer-numbers.test.js` | Issue #5 |
| `lib/totalizer-selection.js` | `buildSelectionKey(parts)` |
| `tests/totalizer-selection.test.js` | Issue #16 |
| `lib/totalizer-schedule.js` | `nextProcessDelay(now, lastProcessTime, minGapMs)` |
| `tests/totalizer-schedule.test.js` | Issue #18 |
| `liagold-suite.user.js` | `LG` + Totalizer `groupOf`/`processTextNode`/`getSelectionKey`/`click`/`processAll` + suite history patch |

---

### Task 1: Number token finder (issue #5)

**Files:**
- Create: `lib/totalizer-numbers.js`
- Create: `tests/totalizer-numbers.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export function findNumberHits(text, mode): Array<{ v: string, i: number }>`
  - `mode` is `'long'` (money columns) or `'strict'` (need thousands separators)

`'long'` must treat these as **one** hit each:
- `1500000`
- `1.500.000`
- `1.500.000,00`
- `12,50`
- `100`

`'strict'` must match `1.500.000` and `1,500,000` but **not** bare `1500000` or `2024`.

Two hits in `'Rp 1.500.000 dan 2000000'` for `'long'`: `1.500.000` and `2000000`.

Implementation (copy exactly):

```js
const LONG_RE = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d{4,}(?:[.,]\d+)?|\d{1,3}(?:[.,]\d+)?/g;
const STRICT_RE = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?/g;

export function findNumberHits(text, mode) {
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
}
```

Alternation order is required: thousands-groups first, then 4+ digit runs, then 1–3 digits with optional fraction. That is what stops `1500000` from becoming `150` + `000` + `0`.

- [ ] **Step 1: Write failing tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findNumberHits } from '../lib/totalizer-numbers.js';

describe('findNumberHits long', () => {
  it('keeps an unformatted integer as one token', () => {
    assert.deepEqual(findNumberHits('1500000', 'long'), [{ v: '1500000', i: 0 }]);
  });

  it('keeps id-ID formatted money as one token', () => {
    assert.deepEqual(findNumberHits('1.500.000', 'long'), [{ v: '1.500.000', i: 0 }]);
    assert.deepEqual(findNumberHits('1.500.000,00', 'long'), [{ v: '1.500.000,00', i: 0 }]);
  });

  it('keeps a short integer and a decimal', () => {
    assert.deepEqual(findNumberHits('100', 'long'), [{ v: '100', i: 0 }]);
    assert.deepEqual(findNumberHits('12,50', 'long'), [{ v: '12,50', i: 0 }]);
  });

  it('finds two amounts in one string', () => {
    const hits = findNumberHits('Rp 1.500.000 dan 2000000', 'long');
    assert.deepEqual(hits.map((h) => h.v), ['1.500.000', '2000000']);
  });
});

describe('findNumberHits strict', () => {
  it('matches grouped thousands only', () => {
    assert.deepEqual(findNumberHits('1.500.000', 'strict'), [{ v: '1.500.000', i: 0 }]);
    assert.deepEqual(findNumberHits('1500000', 'strict'), []);
    assert.deepEqual(findNumberHits('2024', 'strict'), []);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`ERR_MODULE_NOT_FOUND`)

`node --test tests/totalizer-numbers.test.js`

- [ ] **Step 3: Write the lib file above**

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/totalizer-numbers.js tests/totalizer-numbers.test.js
git commit -m "test(totalizer): match unformatted money as one token

Refs #5"
```

---

### Task 2: Wire number hits into Totalizer

**Files:**
- Modify: `liagold-suite.user.js` — add `LG.findNumberHits`; replace `REG_LONG`/`REG_STRICT` usage in `groupOf` + `processTextNode`

**Interfaces:**
- Consumes: `LG.findNumberHits`, `LG.parseIdNumber`
- Produces: `.lgt-num` spans whose `textContent` is a full amount

- [ ] **Step 1: Copy `findNumberHits` onto `LG`** (identical body, including the two regex constants as locals inside the method). Update the synced-from comment.

- [ ] **Step 2: Change `groupOf` to return a mode, not a regex**

Replace:

```js
function groupOf(node) {
  ...
  if (!cell) return { grp: 'X', re: REG_STRICT };
  ...
  return { grp: 'T', re: REG_LONG };
}
```

with:

```js
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
```

- [ ] **Step 3: Change `processTextNode` to use hits**

Replace the `re.lastIndex` / `re.exec` loop with:

```js
const { grp, mode } = groupOf(node);
const hits = LG.findNumberHits(text, mode);
if (!hits.length) return;
```

Delete unused `REG_LONG` and `REG_STRICT` constants if nothing else references them.

Keep `span.dataset.lgtVal = String(LG.parseIdNumber(h.v));`.

- [ ] **Step 4: `npm test` then commit**

```bash
git add liagold-suite.user.js
git commit -m "fix(totalizer): wrap full money tokens including 1500000

Refs #5"
```

---

### Task 3: Stable selection keys (issue #16)

**Files:**
- Create: `lib/totalizer-selection.js`
- Create: `tests/totalizer-selection.test.js`
- Modify: `getSelectionKey` in `liagold-suite.user.js`

**Interfaces:**
- Consumes: nothing
- Produces: `export function buildSelectionKey({ rowCode, rowId, colClass, val, grp }): string`

Contract:
- Prefer `rowCode`, else `rowId`, else `''`
- Return `${row}||${colClass}||${val}||${grp}`
- Two rows with empty first-cell text but different `rowCode` must differ
- Two rows with only empty `rowCode`/`rowId` and the same col/val/grp still collide (accepted leftover; we cannot invent identity)

- [ ] **Step 1: Failing tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelectionKey } from '../lib/totalizer-selection.js';

describe('buildSelectionKey', () => {
  it('prefers code over id', () => {
    const a = buildSelectionKey({ rowCode: 'PC1', rowId: '9', colClass: 'mat-column-totalReal', val: '1000', grp: 'T' });
    const b = buildSelectionKey({ rowCode: 'PC2', rowId: '9', colClass: 'mat-column-totalReal', val: '1000', grp: 'T' });
    assert.notEqual(a, b);
    assert.match(a, /^PC1\|\|/);
  });

  it('falls back to id when code is empty', () => {
    const k = buildSelectionKey({ rowCode: '', rowId: '42', colClass: 'c', val: '1', grp: 'X' });
    assert.equal(k, '42||c||1||X');
  });
});
```

- [ ] **Step 2: Run — FAIL; implement:**

```js
export function buildSelectionKey({ rowCode, rowId, colClass, val, grp }) {
  const row = rowCode || rowId || '';
  return `${row}||${colClass || ''}||${val || ''}||${grp || ''}`;
}
```

- [ ] **Step 3: Run — PASS; commit helper**

```bash
git add lib/totalizer-selection.js tests/totalizer-selection.test.js
git commit -m "test(totalizer): prefer PC/id in selection keys

Refs #16"
```

- [ ] **Step 4: Wire `getSelectionKey`**

Copy `buildSelectionKey` onto `LG`. Replace the function body:

```js
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
```

Do **not** use the first cell’s 50-character prefix anymore.

- [ ] **Step 5: `npm test` + commit**

```bash
git add liagold-suite.user.js
git commit -m "fix(totalizer): key selections by code/id not first cell

Refs #16"
```

---

### Task 4: Click on bubble, no preventDefault (issue #17)

**Files:**
- Modify: the `document.addEventListener('click', …, true)` block in the Totalizer IIFE (~2046)

**Interfaces:**
- Consumes: existing selection helpers
- Produces: same 1× / 2× / 3× cycle; Angular row/link clicks work unless the target is `.lgt-num`

- [ ] **Step 1: Change the listener**

Replace the listener signature and the first lines:

```js
document.addEventListener('click', function (e) {
  const span = e.target.closest && e.target.closest('.lgt-num');
  if (!span) return;
  if (e.target.closest('a, button, input, textarea, select')) return;
  e.stopPropagation();
  // do not call preventDefault
  // ...keep the existing select / negate / clear body unchanged...
}, false);
```

The third argument must be `false` (bubble), not `true` (capture).

- [ ] **Step 2: Grep**

`rg "preventDefault|addEventListener\\('click'" liagold-suite.user.js`

Allowed: drag `preventDefault` on `#lgt-head` mousedown; scan input Enter `preventDefault`. Forbidden: Totalizer number-click `preventDefault` or `, true)`.

- [ ] **Step 3: Commit**

```bash
git add liagold-suite.user.js
git commit -m "fix(totalizer): bubble clicks without preventDefault

Refs #17"
```

---

### Task 5: Reschedule throttled processAll (issue #18)

**Files:**
- Create: `lib/totalizer-schedule.js`
- Create: `tests/totalizer-schedule.test.js`
- Modify: `processAll` in the userscript

**Interfaces:**
- Consumes: nothing
- Produces: `export function nextProcessDelay(now, lastProcessTime, minGapMs): number`
  - `0` → run now
  - `> 0` → wait that many ms then run
  - `lastProcessTime` is `0` on first call → `0`

```js
export function nextProcessDelay(now, lastProcessTime, minGapMs) {
  if (!lastProcessTime) return 0;
  const elapsed = now - lastProcessTime;
  if (elapsed >= minGapMs) return 0;
  return minGapMs - elapsed;
}
```

- [ ] **Step 1: Tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextProcessDelay } from '../lib/totalizer-schedule.js';

describe('nextProcessDelay', () => {
  it('runs immediately on first call', () => {
    assert.equal(nextProcessDelay(1000, 0, 500), 0);
  });

  it('returns remaining ms when inside the gap', () => {
    assert.equal(nextProcessDelay(1200, 1000, 500), 300);
  });

  it('runs immediately when the gap has elapsed', () => {
    assert.equal(nextProcessDelay(1600, 1000, 500), 0);
  });
});
```

- [ ] **Step 2: FAIL then implement then PASS; commit helper** (`Refs #18`)

- [ ] **Step 3: Wire `processAll`**

Copy `nextProcessDelay` onto `LG`. Replace the early `if (now - lastProcessTime < 500) return;` with a single pending timer:

```js
let processing = false;
let lastProcessTime = 0;
let processTimer = null;

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
```

Keep the MutationObserver `setTimeout(processAll, 400)` as-is.

- [ ] **Step 4: `npm test` + commit**

```bash
git add liagold-suite.user.js
git commit -m "fix(totalizer): reschedule processAll when throttled

Refs #18"
```

---

### Task 6: Re-apply history hooks if Angular overwrites them (issue #31)

**Files:**
- Modify: suite boot at the bottom of `liagold-suite.user.js` (`originalPush` / `history.pushState` block)

**Interfaces:**
- Consumes: existing `onRouteChange`
- Produces: `patchHistory()` that is idempotent and re-run on an interval

- [ ] **Step 1: Replace the one-shot wrap**

```js
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
```

Keep the 900ms `onRouteChange` poll. Do not remove `window.__lgtTriggerNav`.

If `fn` is already wrapped (`fn[flag]`), return it unchanged so we do not nest wrappers every 2s.

- [ ] **Step 2: Commit**

```bash
git add liagold-suite.user.js
git commit -m "fix(suite): re-wrap history.pushState after Angular

Refs #31"
```

---

### Task 7: Version bump

- [ ] Set `@version` to `1.0.32` and `@description` to mention totalizer token/selection/click/schedule/history fixes.
- [ ] `npm test` — all suites green.
- [ ] Commit `chore: bump userscript to 1.0.32`

---

## Out of scope

- Scanner issues (#14, #21, #22, #7, #15)
- Payment cache key scope (#11) and ni template (#13)
- Closing obsolete #19

## Self-review

- #5 → Tasks 1–2 `findNumberHits` long mode
- #16 → Task 3 code/id key
- #17 → Task 4 bubble, no `preventDefault`
- #18 → Task 5 `nextProcessDelay` + timer
- #31 → Task 6 re-wrap every 2s
- No placeholders. `LG` names match lib exports.

## Manual checks (human)

1. Cell showing `1500000` or `1.500.000` — one clickable span, Pilih Semua sums the full value.
2. Two rows, same amount, empty checkbox first cell, different PC — selecting one does not select the other after sort/re-render.
3. Click a number — Angular row click / open-detail still works if you click outside the span; clicking the span still cycles + / − / off.
4. Fast table refresh — numbers still wrap within ~1s (no permanently bare digits).
5. In-app navigate sales → purchasing → sales — Totalizer page chip and wrapping follow the route even if Angular patched history.
