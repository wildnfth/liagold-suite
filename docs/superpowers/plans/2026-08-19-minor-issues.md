# Minor Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last two open issues: drop unused Firebase per-entry purge (#30) and make **Kirim ke Form** respect the active tray (#32).

**Architecture:** #30 is a delete, not a revival — auto-DELETE of cloud history contradicts the #23 decision (TTL no longer wipes `/opname/$session`). #32 extracts the same tray filter `shouldQueueToForm` already uses so the bulk button cannot dump every MASUK code into the current opname form.

**Tech Stack:** Existing userscript + `node --test`. Start from current `main` (v1.0.35).

**Spec:**
- https://github.com/wildnfth/liagold-suite/issues/30
- https://github.com/wildnfth/liagold-suite/issues/32
- This plan. One PR. **Must** include `Closes #30` and `Closes #32`.

## Global Constraints

- Do **not** call `purgeExpiredEntries` and do **not** auto-`DELETE` Firebase history or the session tree on TTL. Cleanup stays **Selesai & Hapus**.
- Do **not** send codes when `selectedTray === 'all'` (same rule as auto-fill).
- Do **not** reintroduce Total Bayar or Firebase Auth.
- `@grant none`. Bump userscript to **1.0.36** on the last commit.
- `npm test` green after every task. Commit messages use `Refs #N`; PR body uses `Closes #N`.

## File map

| File | Issue |
|---|---|
| `lib/form-send.js` | #32 `filterCodesForActiveTray` |
| `tests/form-send.test.js` | |
| `liagold-suite.user.js` | delete `purgeExpiredEntries`; wire send filter |

---

### Task 1: Remove dead `purgeExpiredEntries` (#30)

**Files:**
- Modify: `liagold-suite.user.js` — function `purgeExpiredEntries` (only definition; no call sites)

**Why delete, not wire:** Issue #30 says “panggil secara berkala **atau** hapus”. Wiring it would `DELETE` `/opname/$session/history/$key` for every scan whose `entry.time` is older than 12h while the session is still live. That fights #23 (TTL must not auto-delete cloud data) and can wipe a teammate’s log mid-opname. `handleOnlineExpiry` already only leaves the device; **Selesai & Hapus** is the explicit cloud wipe.

- [ ] **Step 1:** Confirm it is dead

Run from repo root:

```bash
rg -n "purgeExpiredEntries" liagold-suite.user.js
```

Expected: one `async function purgeExpiredEntries()` definition, no calls.

- [ ] **Step 2:** Delete the whole function

Remove this block (current body; match on the function name if whitespace differs):

```js
async function purgeExpiredEntries() {
if (!isMulti() || isDeletingSession) return;
const expiredKeys = [];
Object.entries(cloudHistory || {}).forEach(([key, entry]) => {
if (isEntryExpired(entry)) {
expiredKeys.push(key);
}
});
if (expiredKeys.length === 0) return;
updateStatus(`🗑️ Menghapus ${expiredKeys.length} scan expired (>12 jam)...`);
let deleted = 0;
for (let i = 0; i < expiredKeys.length; i += 50) {
const batch = expiredKeys.slice(i, i + 50);
for (const key of batch) {
try {
await fetch(`${FIREBASE}/opname/${sessionId}/history/${key}.json`, { method: 'DELETE' });
delete cloudHistory[key];
deleted++;
} catch (e) {}
}
await sleep(100);
}
if (deleted > 0) {
updateStatus(`🗑️ ${deleted} scan expired dihapus otomatis.`);
onCloudUpdate();
}
}
```

Leave `isEntryExpired` — still used by `onCloudUpdate` to skip auto-fill of stale peer scans.

- [ ] **Step 3:** Confirm gone

```bash
rg -n "purgeExpiredEntries" liagold-suite.user.js
```

Expected: no matches.

- [ ] **Step 4:** Commit

```bash
git add liagold-suite.user.js
git commit -m "$(cat <<'EOF'
fix(scanner): drop unused purgeExpiredEntries

TTL must not DELETE Firebase history. Use Selesai & Hapus.

Refs #30
EOF
)"
```

---

### Task 2: Failing tests for tray-aware Kirim ke Form (#32)

**Files:**
- Create: `tests/form-send.test.js`
- Create: `lib/form-send.js` (empty / missing on first run)

**Interfaces:**
- Produces: `filterCodesForActiveTray({ codes, selectedTray, productByCode, scanByCode }) → string[]`

`productByCode` is a `Map` of lowercased `codeProduct` → `{ trayId }`.
`scanByCode` is a `Map` of lowercased `codeProduct` → `{ trayId }` used only when the product is not in the map (same fallback idea as `shouldQueueToForm` + `entry.tray` / `trayList`).

- [ ] **Step 1:** Write the failing test

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterCodesForActiveTray } from '../lib/form-send.js';

describe('filterCodesForActiveTray', () => {
  const productByCode = new Map([
    ['aaa', { trayId: '1' }],
    ['bbb', { trayId: '2' }],
  ]);

  it('returns empty when tray is all or missing', () => {
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['AAA', 'BBB'],
      selectedTray: 'all',
      productByCode,
      scanByCode: new Map(),
    }), []);
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['AAA'],
      selectedTray: '',
      productByCode,
      scanByCode: new Map(),
    }), []);
  });

  it('keeps only codes on the selected tray', () => {
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['AAA', 'BBB', 'aaa'],
      selectedTray: '1',
      productByCode,
      scanByCode: new Map(),
    }), ['AAA', 'aaa']);
  });

  it('falls back to scan trayId when product is unknown', () => {
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['ZZZ'],
      selectedTray: '9',
      productByCode: new Map(),
      scanByCode: new Map([['zzz', { trayId: '9' }]]),
    }), ['ZZZ']);
  });

  it('drops unknown codes with no scan tray', () => {
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['NOPE'],
      selectedTray: '1',
      productByCode: new Map(),
      scanByCode: new Map(),
    }), []);
  });
});
```

- [ ] **Step 2:** Run to verify it fails

```bash
node --test tests/form-send.test.js
```

Expected: `ERR_MODULE_NOT_FOUND` for `lib/form-send.js`.

- [ ] **Step 3:** Commit the test only (optional if you prefer one commit with the impl — prefer two: test then impl)

```bash
git add tests/form-send.test.js
git commit -m "$(cat <<'EOF'
test(scanner): filter Kirim ke Form by active tray

Refs #32
EOF
)"
```

If git refuses a commit that cannot pass `npm test` because the import is missing, skip this commit and include the test with Task 3.

---

### Task 3: Implement filter and wire `sendToForm` (#32)

**Files:**
- Create: `lib/form-send.js`
- Modify: `liagold-suite.user.js` — add `LG.filterCodesForActiveTray`, change `sendToForm`

**Interfaces:**
- Consumes: `filterCodesForActiveTray` from Task 2
- Produces: `sendToForm` only queues codes on the active tray

- [ ] **Step 1:** Implement

```js
// lib/form-send.js
export function filterCodesForActiveTray({ codes, selectedTray, productByCode, scanByCode }) {
  if (selectedTray == null || selectedTray === '' || selectedTray === 'all') return [];
  const tray = String(selectedTray);
  return (codes || []).filter((code) => {
    const lc = String(code).toLowerCase();
    const product = productByCode && productByCode.get(lc);
    if (product) return String(product.trayId) === tray;
    const scan = scanByCode && scanByCode.get(lc);
    if (scan && scan.trayId != null && scan.trayId !== '') return String(scan.trayId) === tray;
    return false;
  });
}
```

- [ ] **Step 2:** Run tests

```bash
node --test tests/form-send.test.js
```

Expected: 4 passing.

- [ ] **Step 3:** Copy onto `LG` (same body as `lib/form-send.js`)

Place next to `parsePendingQueue` / other `LG` helpers:

```js
  filterCodesForActiveTray({ codes, selectedTray, productByCode, scanByCode }) {
    if (selectedTray == null || selectedTray === '' || selectedTray === 'all') return [];
    const tray = String(selectedTray);
    return (codes || []).filter((code) => {
      const lc = String(code).toLowerCase();
      const product = productByCode && productByCode.get(lc);
      if (product) return String(product.trayId) === tray;
      const scan = scanByCode && scanByCode.get(lc);
      if (scan && scan.trayId != null && scan.trayId !== '') return String(scan.trayId) === tray;
      return false;
    });
  },
```

- [ ] **Step 4:** Change `sendToForm`

Replace the block that builds `scannedList` / `missing` so it filters by tray first. Current:

```js
const scannedList = [...scannedCodes];
if (!scannedList.length) {
updateStatus('⚠️ Belum ada barang yang discan.');
return;
}
updateStatus('🔍 Memeriksa isi form…');
const formTextLower = getFormListText();
const missing = scannedList.filter(code => !isCodeInForm(code, formTextLower) && !formFilledCodes.has(code));
```

New:

```js
const scannedList = [...scannedCodes];
if (!scannedList.length) {
updateStatus('⚠️ Belum ada barang yang discan.');
return;
}
if (!selectedTray || selectedTray === 'all') {
updateStatus('⚠️ Pilih baki dulu. Kirim ke Form tidak jalan di Semua Baki.');
return;
}
const scanByCode = new Map();
scanLog.forEach((row) => {
if (!row || !row.codeProduct) return;
const lc = String(row.codeProduct).toLowerCase();
if (scanByCode.has(lc)) return;
let trayId = null;
if (row.tray && row.tray !== '-') {
const info = trayList.find((t) => t.trayCode === row.tray);
if (info) trayId = info.trayId;
}
scanByCode.set(lc, { trayId });
});
const eligible = LG.filterCodesForActiveTray({
codes: scannedList,
selectedTray,
productByCode: productMap,
scanByCode,
});
if (!eligible.length) {
updateStatus('⚠️ Tidak ada scan MASUK di baki yang dipilih.');
return;
}
updateStatus('🔍 Memeriksa isi form…');
const formTextLower = getFormListText();
const missing = eligible.filter(code => !isCodeInForm(code, formTextLower) && !formFilledCodes.has(code));
const already = eligible.length - missing.length;
if (!missing.length) {
updateStatus(`✅ Semua ${eligible.length} barang baki ini sudah ada di form.`);
return;
}
if (!confirm(`📊 Hasil pemeriksaan form (baki aktif):\n✅ Sudah ada di form : ${already} barang\n📤 Belum ada di form : ${missing.length} barang\nLanjutkan?`)) return;
missing.forEach(code => queueFormInput(code));
updateStatus(`📤 Mengirim ${missing.length} barang ke form (batch: ${batchSize}, delay: ${batchDelay}ms)...`);
```

Do **not** change `shouldQueueToForm` or the per-scan auto-fill path.

- [ ] **Step 5:** Bump header to 1.0.36

```
// @version      1.0.36
// @description  v1.0.36: Kirim ke Form follows active tray; drop unused history purge
```

- [ ] **Step 6:** Full suite

```bash
npm test
```

Expected: previous count + 4, all green. (`node --check liagold-suite.user.js` also clean.)

- [ ] **Step 7:** Commit

```bash
git add lib/form-send.js tests/form-send.test.js liagold-suite.user.js
git commit -m "$(cat <<'EOF'
fix(scanner): Kirim ke Form only sends the active tray

Refs #32
EOF
)"
```

If Task 2 already committed the test file, omit it from this `git add` if unchanged.

---

## Self-review

1. **Spec coverage:** #30 → Task 1 delete. #32 → Tasks 2–3 filter + `sendToForm`. No leftover open issues after this PR.
2. **Placeholders:** none.
3. **Types:** `filterCodesForActiveTray({ codes, selectedTray, productByCode, scanByCode })` is the only new name; `sendToForm` consumes it.

## Manual check after implement

- [ ] `selectedTray === 'all'` → button says pilih baki, form untouched
- [ ] Scan A on baki 1, switch to baki 2, Kirim ke Form → A not queued
- [ ] Scan A on baki 1, stay on baki 1 → A queued if missing from form
