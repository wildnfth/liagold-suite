# Phone Scanner Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a phone HTTPS scanner that joins the existing Firebase opname session by session code, auto-detects QR/barcode with the camera, and writes the same history the laptop already auto-fills — without changing laptop-facing scanner UI.

**Architecture:** Laptop userscript stays the only ERP client. It silently mirrors tray/product catalog + heartbeat to Firebase and resolves unknown-code lookups. The phone is a static site that reads that catalog, classifies in-tray scans locally, and posts unknown codes to `lookups`. Same RTDB session, no new backend.

**Tech Stack:** Vanilla ESM `lib/*.js` + `node --test`, Tampermonkey userscript (`LG` bodies identical to lib), static `mobile/` site, Firebase RTDB REST + EventSource, `BarcodeDetector` + vendored jsQR.

**Spec:** `docs/superpowers/specs/2026-09-02-phone-scanner-design.md`

## Global Constraints

- Laptop is the only client that may fetch `liagold.cuan.co` (`/web/product`, `/web/helper/product-by-code`).
- Phone never calls the ERP origin.
- Do not add, remove, or relabel laptop panel buttons/settings. Form import/export/auto-fill stay as they are.
- Phone MASUK history uses `by` = phone participant name so existing `onCloudUpdate` auto-fill (`scan.by !== myName`) still runs. Do not queue form input from the lookup consumer.
- Join is type-the-session-code only. Phone does not create sessions.
- `lib/*.js` is source of truth; `LG` bodies in `liagold-suite.user.js` must stay identical.
- `@grant none`, single-file Tampermonkey install.
- `npm test` → `node --test`. No new runtime npm dependency.
- Camera requires HTTPS. Do not document an HTTP LAN workflow.
- Userscript version bump is **2.0.0 → 2.1.0**, once, when silent laptop wiring ships (Task 7).
- Phone footer label: `phone-scanner 1`.

## File map

| File | Responsibility |
|---|---|
| `lib/catalog-sync.js` | Catalog payload, remote-tray gate, host-alive, scan guard, tray-product match |
| `tests/catalog-sync.test.js` | Spec cases for those helpers |
| `lib/lookup-queue.js` | Lookup key, pending entry, pending filter |
| `tests/lookup-queue.test.js` | Key sanitize, pending vs done |
| `lib/scan-cooldown.js` | Camera duplicate-code cooldown |
| `tests/scan-cooldown.test.js` | First/same/different/after-cooldown |
| `lib/es-event.js` | EventSource path/state for `catalog` + `lookups` |
| `tests/es-event.test.js` | New path kinds + root/catalog/lookup puts |
| `liagold-suite.user.js` | Identical `LG` bodies + silent mirror/heartbeat/lookup consumer |
| `scripts/sync-mobile-lib.mjs` | Copy imported lib files into `mobile/lib/` |
| `mobile/index.html` | Join + scan markup |
| `mobile/style.css` | Mobile-first layout |
| `mobile/firebase.js` | RTDB REST + EventSource |
| `mobile/app.js` | Join, catalog, scan pipeline, render |
| `mobile/camera.js` | Continuous camera decode |
| `mobile/vendor/jsQR.js` | Vendored decoder fallback |
| `docs/firebase-rules.md` | catalog + lookups validate |
| `README.md` | Phone site pointer |
| `firebase.json` | Hosting public `mobile` |

---

### Task 1: Catalog sync helpers

**Files:**
- Create: `lib/catalog-sync.js`
- Test: `tests/catalog-sync.test.js`

**Interfaces:**
- Consumes: `sanitizeKey` from `lib/history-key.js`
- Produces:
  - `productCatalogKey(codeProduct) → string`
  - `buildCatalogPayload({ trays, selectedTray, selectedTrayCode, products, now }) → object` (no `hostAt`)
  - `withHostAt(payload, now) → object`
  - `shouldApplyRemoteTray({ localTray, remoteTray }) → boolean`
  - `isCatalogHostAlive(hostAt, now = Date.now(), maxAgeMs = 45000) → boolean`
  - `canAcceptScan({ hostAt, now, selectedTray, productCount }) → 'host-stale' \| 'no-tray' \| 'empty' \| null`
  - `productsMatchTray(products, selectedTray) → boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/catalog-sync.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  productCatalogKey,
  buildCatalogPayload,
  withHostAt,
  shouldApplyRemoteTray,
  isCatalogHostAlive,
  canAcceptScan,
  productsMatchTray,
} from '../lib/catalog-sync.js';

describe('productCatalogKey', () => {
  it('lowercases and sanitizes Firebase-illegal chars', () => {
    assert.equal(productCatalogKey('Ab/C'), 'ab_c');
  });
});

describe('buildCatalogPayload', () => {
  it('maps trays and products and records selected tray', () => {
    const now = '2026-09-02T00:00:00.000Z';
    const out = buildCatalogPayload({
      trays: [{ trayId: 14, trayCode: 'B14', count: 2 }],
      selectedTray: 14,
      selectedTrayCode: 'B14',
      products: [{
        codeProduct: 'Aaa',
        code: '1',
        name: 'Cincin',
        weight: 1.2,
        image: 'x.png',
        trayId: 14,
        trayCode: 'B14',
        kadar: '375',
        size: '6',
        group: 'CN',
      }],
      now,
    });
    assert.equal(out.updatedAt, now);
    assert.equal(out.selectedTray, '14');
    assert.equal(out.selectedTrayCode, 'B14');
    assert.deepEqual(out.trays['14'], { trayId: 14, trayCode: 'B14', count: 2 });
    assert.equal(out.products.aaa.codeProduct, 'Aaa');
    assert.equal(out.products.aaa.trayId, 14);
    assert.equal('hostAt' in out, false);
  });
});

describe('withHostAt', () => {
  it('adds hostAt without dropping payload fields', () => {
    const payload = { selectedTray: '14' };
    assert.deepEqual(withHostAt(payload, 't1'), { selectedTray: '14', hostAt: 't1' });
  });
});

describe('shouldApplyRemoteTray', () => {
  it('applies only when remote is non-empty and different', () => {
    assert.equal(shouldApplyRemoteTray({ localTray: '14', remoteTray: '14' }), false);
    assert.equal(shouldApplyRemoteTray({ localTray: '14', remoteTray: '8' }), true);
    assert.equal(shouldApplyRemoteTray({ localTray: '14', remoteTray: '' }), false);
    assert.equal(shouldApplyRemoteTray({ localTray: '14', remoteTray: null }), false);
  });
});

describe('isCatalogHostAlive', () => {
  it('is alive just under 45s and dead just over 45s', () => {
    const hostAt = 1_000_000;
    assert.equal(isCatalogHostAlive(hostAt, hostAt + 44_900), true);
    assert.equal(isCatalogHostAlive(hostAt, hostAt + 45_100), false);
    assert.equal(isCatalogHostAlive(null, hostAt), false);
  });
});

describe('canAcceptScan', () => {
  const now = 1_000_000;
  const hostAt = now - 1000;
  it('blocks stale host, all-tray, and empty catalog', () => {
    assert.equal(canAcceptScan({ hostAt: now - 46_000, now, selectedTray: '14', productCount: 1 }), 'host-stale');
    assert.equal(canAcceptScan({ hostAt, now, selectedTray: 'all', productCount: 1 }), 'no-tray');
    assert.equal(canAcceptScan({ hostAt, now, selectedTray: '14', productCount: 0 }), 'empty');
    assert.equal(canAcceptScan({ hostAt, now, selectedTray: '14', productCount: 3 }), null);
  });
});

describe('productsMatchTray', () => {
  it('requires every product to belong to the selected tray', () => {
    assert.equal(productsMatchTray({ a: { trayId: 14 } }, '14'), true);
    assert.equal(productsMatchTray({ a: { trayId: 14 }, b: { trayId: 8 } }, '14'), false);
    assert.equal(productsMatchTray({}, '14'), false);
    assert.equal(productsMatchTray({ a: { trayId: 14 } }, 'all'), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/catalog-sync.test.js`

Expected: FAIL with `Cannot find module` for `../lib/catalog-sync.js`

- [ ] **Step 3: Write minimal implementation**

Create `lib/catalog-sync.js`:

```js
import { sanitizeKey } from './history-key.js';

export function productCatalogKey(codeProduct) {
  return sanitizeKey(String(codeProduct || '').toLowerCase());
}

export function buildCatalogPayload({ trays, selectedTray, selectedTrayCode, products, now } = {}) {
  const trayMap = {};
  for (const t of trays || []) {
    if (t == null || t.trayId == null) continue;
    trayMap[String(t.trayId)] = {
      trayId: t.trayId,
      trayCode: t.trayCode || '-',
      count: t.count || 0,
    };
  }
  const productMap = {};
  for (const p of products || []) {
    if (!p || !p.codeProduct) continue;
    productMap[productCatalogKey(p.codeProduct)] = {
      codeProduct: p.codeProduct,
      code: p.code || '',
      name: p.name || '',
      weight: p.weight || 0,
      image: p.image || '',
      trayId: p.trayId ?? null,
      trayCode: p.trayCode || '-',
      kadar: p.kadar || '',
      size: p.size || '',
      group: p.group || '',
    };
  }
  const iso = typeof now === 'string' ? now : new Date(now || Date.now()).toISOString();
  return {
    updatedAt: iso,
    selectedTray: selectedTray == null ? 'all' : String(selectedTray),
    selectedTrayCode: selectedTrayCode == null ? '' : String(selectedTrayCode),
    trays: trayMap,
    products: productMap,
  };
}

export function withHostAt(payload, now) {
  const iso = typeof now === 'string' ? now : new Date(now || Date.now()).toISOString();
  return { ...(payload || {}), hostAt: iso };
}

export function shouldApplyRemoteTray({ localTray, remoteTray } = {}) {
  if (remoteTray == null || remoteTray === '') return false;
  return String(localTray) !== String(remoteTray);
}

export function isCatalogHostAlive(hostAt, now = Date.now(), maxAgeMs = 45000) {
  const t = typeof hostAt === 'number' ? hostAt : new Date(hostAt).getTime();
  if (!Number.isFinite(t)) return false;
  const n = typeof now === 'number' ? now : new Date(now).getTime();
  if (!Number.isFinite(n)) return false;
  return (n - t) < maxAgeMs;
}

export function canAcceptScan({ hostAt, now, selectedTray, productCount } = {}) {
  if (!isCatalogHostAlive(hostAt, now)) return 'host-stale';
  if (selectedTray == null || selectedTray === '' || selectedTray === 'all') return 'no-tray';
  if (!productCount) return 'empty';
  return null;
}

export function productsMatchTray(products, selectedTray) {
  if (selectedTray == null || selectedTray === '' || selectedTray === 'all') return false;
  const list = products && typeof products === 'object' ? Object.values(products) : [];
  if (!list.length) return false;
  const tray = String(selectedTray);
  return list.every((p) => p && String(p.trayId) === tray);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/catalog-sync.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/catalog-sync.js tests/catalog-sync.test.js
git commit -m "feat(scanner): catalog payload and host-alive helpers"
```

---

### Task 2: Lookup queue helpers

**Files:**
- Create: `lib/lookup-queue.js`
- Test: `tests/lookup-queue.test.js`

**Interfaces:**
- Consumes: `sanitizeKey` from `lib/history-key.js`
- Produces:
  - `lookupKey(code, time) → string`
  - `buildLookupEntry({ code, by, time }) → { code, by, time, state: 'pending' }`
  - `pendingLookups(map) → Array<{ key, code, by, time, state }>`

- [ ] **Step 1: Write the failing test**

Create `tests/lookup-queue.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lookupKey, buildLookupEntry, pendingLookups } from '../lib/lookup-queue.js';

describe('lookupKey', () => {
  it('sanitizes code_time for Firebase paths', () => {
    assert.equal(lookupKey('ab/c', 't.1'), 'ab_c_t_1');
  });
});

describe('buildLookupEntry', () => {
  it('always starts pending', () => {
    assert.deepEqual(buildLookupEntry({ code: 'Aaa', by: 'Lia', time: 't1' }), {
      code: 'Aaa',
      by: 'Lia',
      time: 't1',
      state: 'pending',
    });
  });
});

describe('pendingLookups', () => {
  it('returns only pending entries with a code and ignores done', () => {
    const list = pendingLookups({
      k1: { code: 'A', by: 'P', time: 't', state: 'pending' },
      k2: { code: 'B', by: 'P', time: 't', state: 'done' },
      k3: { by: 'P', time: 't', state: 'pending' },
    });
    assert.equal(list.length, 1);
    assert.equal(list[0].key, 'k1');
    assert.equal(list[0].code, 'A');
    assert.deepEqual(pendingLookups(null), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/lookup-queue.test.js`

Expected: FAIL with `Cannot find module`

- [ ] **Step 3: Write minimal implementation**

Create `lib/lookup-queue.js`:

```js
import { sanitizeKey } from './history-key.js';

export function lookupKey(code, time) {
  return sanitizeKey(String(code || '') + '_' + String(time || ''));
}

export function buildLookupEntry({ code, by, time } = {}) {
  return {
    code: String(code || ''),
    by: String(by || ''),
    time: String(time || ''),
    state: 'pending',
  };
}

export function pendingLookups(map) {
  if (!map || typeof map !== 'object') return [];
  const out = [];
  for (const [key, entry] of Object.entries(map)) {
    if (entry && entry.state === 'pending' && entry.code) {
      out.push({ key, ...entry });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/lookup-queue.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/lookup-queue.js tests/lookup-queue.test.js
git commit -m "feat(scanner): lookup queue helpers for phone unknown codes"
```

---

### Task 3: Scan cooldown helper

**Files:**
- Create: `lib/scan-cooldown.js`
- Test: `tests/scan-cooldown.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `shouldAcceptDetectedCode({ code, lastCode, lastAt, now, cooldownMs = 2000 }) → boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/scan-cooldown.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldAcceptDetectedCode } from '../lib/scan-cooldown.js';

describe('shouldAcceptDetectedCode', () => {
  it('rejects empty and accepts the first code', () => {
    assert.equal(shouldAcceptDetectedCode({ code: '  ', now: 1000 }), false);
    assert.equal(shouldAcceptDetectedCode({ code: 'AAA', lastCode: null, lastAt: 0, now: 1000 }), true);
  });

  it('rejects the same code inside 2s and accepts after cooldown or a different code', () => {
    assert.equal(shouldAcceptDetectedCode({
      code: 'AAA', lastCode: 'AAA', lastAt: 1000, now: 2500, cooldownMs: 2000,
    }), false);
    assert.equal(shouldAcceptDetectedCode({
      code: 'AAA', lastCode: 'AAA', lastAt: 1000, now: 3000, cooldownMs: 2000,
    }), true);
    assert.equal(shouldAcceptDetectedCode({
      code: 'BBB', lastCode: 'AAA', lastAt: 1000, now: 1100, cooldownMs: 2000,
    }), true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scan-cooldown.test.js`

Expected: FAIL with `Cannot find module`

- [ ] **Step 3: Write minimal implementation**

Create `lib/scan-cooldown.js`:

```js
export function shouldAcceptDetectedCode({
  code,
  lastCode,
  lastAt,
  now,
  cooldownMs = 2000,
} = {}) {
  const c = String(code || '').trim();
  if (!c) return false;
  if (lastCode == null || lastCode === '') return true;
  if (String(lastCode) !== c) return true;
  const last = Number(lastAt);
  const n = Number(now);
  if (!Number.isFinite(last) || !Number.isFinite(n)) return true;
  return (n - last) >= cooldownMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scan-cooldown.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/scan-cooldown.js tests/scan-cooldown.test.js
git commit -m "feat(scanner): camera code cooldown"
```

---

### Task 4: EventSource catalog and lookups

**Files:**
- Modify: `lib/es-event.js`
- Modify: `tests/es-event.test.js`
- Modify: `liagold-suite.user.js` (`LG.classifyEsPath`, `LG.putRoot`, `LG.applyEsPut` handlers, `LG.patchRoot` field map — bodies identical to lib)

**Interfaces:**
- Consumes: existing `applyEsPut` / `applyEsPatch` state shape
- Produces: extra state fields `catalog` and `lookups`; kinds `catalog`, `catalogField`, `lookups`, `lookupItem`; effects `onCatalogUpdate`, `onLookupsUpdate`

- [ ] **Step 1: Extend the failing tests**

In `tests/es-event.test.js` `classifyEsPath` first it, add:

```js
assert.deepEqual(classifyEsPath('/catalog'), { kind: 'catalog' });
assert.deepEqual(classifyEsPath('/lookups'), { kind: 'lookups' });
```

In the item-path it, add:

```js
assert.deepEqual(classifyEsPath('/catalog/selectedTray'), { kind: 'catalogField', key: 'selectedTray' });
assert.deepEqual(classifyEsPath('/lookups/ab_t1'), { kind: 'lookupItem', key: 'ab_t1' });
```

In `blankState`, add `catalog: null, lookups: {}`.

Add this it inside `describe('applyEsPut')`:

```js
it('stores catalog and lookups from root and leaf paths', () => {
  const catalog = { selectedTray: '14', hostAt: 't1', products: {} };
  const lookups = { k1: { code: 'A', state: 'pending' } };
  const root = applyEsPut(blankState(), '/', { catalog, lookups, history: {}, peserta: {}, dupes: null });
  assert.deepEqual(root.state.catalog, catalog);
  assert.deepEqual(root.state.lookups, lookups);
  assert.ok(root.effects.includes('onCatalogUpdate'));
  assert.ok(root.effects.includes('onLookupsUpdate'));
  const leaf = applyEsPut(blankState(), '/catalog', catalog);
  assert.deepEqual(leaf.state.catalog, catalog);
  assert.deepEqual(leaf.effects, ['onCatalogUpdate']);
  const field = applyEsPut(blankState({ catalog: { selectedTray: 'all' } }), '/catalog/selectedTray', '14');
  assert.equal(field.state.catalog.selectedTray, '14');
  const item = applyEsPut(blankState(), '/lookups/k1', { code: 'A', state: 'pending' });
  assert.equal(item.state.lookups.k1.code, 'A');
  assert.deepEqual(item.effects, ['onLookupsUpdate']);
});
```

The existing root-put it (`replaces root collections...`) must keep passing. `putRoot` may add `onCatalogUpdate`/`onLookupsUpdate` only when `data.catalog` / `data.lookups` is not `undefined`. That existing fixture has neither key, so its effects stay `['updateCountdownDisplay', 'onCloudUpdate', 'renderParticipants']`.

- [ ] **Step 2: Run test to verify new cases fail**

Run: `node --test tests/es-event.test.js`

Expected: FAIL on `/catalog` kind `unknown` (or assertion on `onCatalogUpdate`)

- [ ] **Step 3: Implement in `lib/es-event.js`**

Update `classifyEsPath` exact map to include `'/catalog': 'catalog'` and `'/lookups': 'lookups'`.

Add prefixes **before** the existing list (longer/new collections):

```js
['/catalog/', 'catalogField'],
['/lookups/', 'lookupItem'],
```

In `putRoot`, after building `state`, set:

```js
catalog: data.catalog === undefined ? state.catalog : data.catalog,
lookups: data.lookups === undefined ? (state.lookups || {}) : (data.lookups || {}),
```

If `data.catalog !== undefined` push `'onCatalogUpdate'`. If `data.lookups !== undefined` push `'onLookupsUpdate'`. Keep existing effects order: countdown (if any), `onCloudUpdate`, `renderParticipants`, then the new ones.

Add handlers:

```js
function putCatalog(state, data) {
  return { state: { ...state, catalog: data }, effects: ['onCatalogUpdate'] };
}
function putCatalogField(state, data, { key }) {
  const catalog = { ...(state.catalog || {}) };
  if (data === null) delete catalog[key];
  else catalog[key] = data;
  return { state: { ...state, catalog }, effects: ['onCatalogUpdate'] };
}
function putLookups(state, data) {
  return { state: { ...state, lookups: data || {} }, effects: ['onLookupsUpdate'] };
}
function putLookupItem(state, data, { key }) {
  const lookups = { ...(state.lookups || {}) };
  if (data === null) delete lookups[key];
  else lookups[key] = data;
  return { state: { ...state, lookups }, effects: ['onLookupsUpdate'] };
}
```

Register them on `PUT_HANDLERS` and `PATCH_HANDLERS` (patch can reuse the put handlers).

In `ROOT_PATCH` add:

```js
catalog(next, value, effects) {
  next.catalog = value;
  effects.push('onCatalogUpdate');
},
lookups(next, value, effects) {
  next.lookups = value || {};
  effects.push('onLookupsUpdate');
},
```

- [ ] **Step 4: Sync identical bodies into `LG` in `liagold-suite.user.js`**

Copy the updated `classifyEsPath`, `putRoot`, `applyEsPut` handler map, `patchRoot`/`applyField` map, and `applyEsPatch` handler map. Add `LG.putCatalog`, `LG.putCatalogField`, `LG.putLookups`, `LG.putLookupItem` with the same bodies as lib (lib uses free functions; `LG` versions must use `LG.mergeScanEntry` etc. as they already do). Do not add panel UI.

Also extend scanner state wiring (still this task — otherwise ES drops the fields):

In `startScanner` IIFE, next to `let cloudHistory = {};`:

```js
let catalog = null;
let lookups = {};
```

Replace `getEsState` / `applyEsResult` with:

```js
function getEsState() {
  return { cloudHistory, participants, dupeCount, lastScanAt, catalog, lookups };
}
function applyEsResult(result) {
  if (!result || !result.state) return;
  cloudHistory = result.state.cloudHistory;
  participants = result.state.participants;
  dupeCount = result.state.dupeCount;
  lastScanAt = result.state.lastScanAt;
  catalog = result.state.catalog;
  lookups = result.state.lookups || {};
  const effects = {
    verifySessionAlive,
    updateCountdownDisplay,
    onCloudUpdate,
    renderParticipants,
    updateStats,
    onCatalogUpdate() {},
    onLookupsUpdate() {},
  };
  for (const name of result.effects || []) {
    const fn = effects[name];
    if (fn) fn();
  }
}
```

Empty `onCatalogUpdate` / `onLookupsUpdate` are filled in Tasks 6–7. Leaving no-ops is required so Task 4 does not change laptop behaviour yet.

- [ ] **Step 5: Run tests**

Run: `node --test tests/es-event.test.js tests/catalog-sync.test.js tests/lookup-queue.test.js tests/scan-cooldown.test.js`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/es-event.js tests/es-event.test.js liagold-suite.user.js
git commit -m "feat(scanner): EventSource catalog and lookup nodes"
```

---

### Task 5: Laptop catalog mirror, heartbeat, remote tray

**Files:**
- Modify: `liagold-suite.user.js` only (silent; no new buttons)
- Sync `LG` with catalog-sync function bodies (copy from `lib/catalog-sync.js`, using `LG.sanitizeKey` instead of the import)

**Interfaces:**
- Consumes: `LG.buildCatalogPayload`, `LG.withHostAt`, `LG.shouldApplyRemoteTray`
- Produces: Firebase `PUT /opname/{sessionId}/catalog` and `/catalog/hostAt`; remote `selectTray(..., { fromRemote: true })`

- [ ] **Step 1: Add LG catalog-sync bodies**

Inside `const LG = {` after `sanitizeKey`, add the catalog-sync functions with identical logic to `lib/catalog-sync.js`, replacing `sanitizeKey(...)` with `LG.sanitizeKey(...)`.

- [ ] **Step 2: Add silent writers inside `startScanner`**

After `function fbPut` (around the existing helper), add:

```js
let catalogWriteTimer = null;
let hostBeatTimer = null;
let applyingRemoteTray = false;
function catalogNow() {
  return new Date().toISOString();
}
function selectedTrayCode() {
  const info = trayList.find((t) => String(t.trayId) === String(selectedTray));
  return info ? info.trayCode : '';
}
async function writeCatalog() {
  if (!isMulti() || !sessionId) return;
  const payload = LG.withHostAt(LG.buildCatalogPayload({
    trays: trayList,
    selectedTray,
    selectedTrayCode: selectedTrayCode(),
    products: allProducts,
    now: catalogNow(),
  }), catalogNow());
  await fbPut(`/opname/${sessionId}/catalog`, payload);
}
function scheduleCatalogWrite() {
  if (!isMulti() || !sessionId) return;
  if (catalogWriteTimer) clearTimeout(catalogWriteTimer);
  catalogWriteTimer = setTimeout(() => {
    catalogWriteTimer = null;
    writeCatalog().catch(() => {});
  }, 200);
}
function startCatalogHeartbeat() {
  if (hostBeatTimer) return;
  hostBeatTimer = setInterval(() => {
    if (!isMulti() || !sessionId) return;
    fbPut(`/opname/${sessionId}/catalog/hostAt`, catalogNow()).catch(() => {});
  }, 15000);
}
function stopCatalogHeartbeat() {
  if (hostBeatTimer) {
    clearInterval(hostBeatTimer);
    hostBeatTimer = null;
  }
}
```

Call `startCatalogHeartbeat()` from `listenSession()` after `es = new EventSource(...)`. Call `stopCatalogHeartbeat()` from `cleanupSessionLocal` / `onSessionDeletedRemotely` (same places that `stopCountdownInterval()`).

At the end of successful `syncTrayList` (the `updateStatus(\`✅ ${trayList.length} baki...\`)` branch) and successful `loadTrayData` (the `updateStatus(\`✅ ${label}:...\`)` branch), call `scheduleCatalogWrite()`.

- [ ] **Step 3: Remote tray without echo**

Change `selectTray` to:

```js
function selectTray(val, label, opts) {
  const fromRemote = !!(opts && opts.fromRemote);
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
  focusScanInput();
  if (!fromRemote) scheduleCatalogWrite();
  if (!opts || opts.syncForm !== false) syncFormTrayFromScanner();
}
```

Replace the Task 4 no-op:

```js
function onCatalogUpdate() {
  if (!isMulti() || applyingRemoteTray) return;
  const remote = catalog && catalog.selectedTray;
  if (!LG.shouldApplyRemoteTray({ localTray: selectedTray, remoteTray: remote })) return;
  const info = trayList.find((t) => String(t.trayId) === String(remote));
  const label = remote === 'all' ? 'Semua Baki' : (info ? `Baki ${info.trayCode}` : `Baki ${remote}`);
  applyingRemoteTray = true;
  try {
    selectTray(String(remote), label, { fromRemote: true });
  } finally {
    applyingRemoteTray = false;
  }
}
```

Wire `onCatalogUpdate` in `applyEsResult` effects (replace the empty function).

- [ ] **Step 4: Run unit tests**

Run: `npm test`

Expected: PASS (no userscript runtime test; do not click-test panel chrome)

- [ ] **Step 5: Commit**

```bash
git add liagold-suite.user.js
git commit -m "feat(scanner): mirror catalog and heartbeat to Firebase"
```

---

### Task 6: Laptop lookup consumer

**Files:**
- Modify: `liagold-suite.user.js`
- Sync `LG.lookupKey`, `LG.buildLookupEntry`, `LG.pendingLookups` from `lib/lookup-queue.js`

**Interfaces:**
- Consumes: `LG.pendingLookups`, `LG.classifySoldScan`, existing `checkSoldProduct`, `fbPut`
- Produces: history row with `by: lookup.by`; lookup `state: 'done'`

- [ ] **Step 1: Add LG lookup-queue bodies**

Copy `lookupKey` / `buildLookupEntry` / `pendingLookups` into `LG` (use `LG.sanitizeKey`).

- [ ] **Step 2: Consume pending lookups**

Inside `startScanner`:

```js
const lookupInFlight = new Set();
async function processLookups() {
  if (!isMulti() || !sessionId) return;
  for (const item of LG.pendingLookups(lookups)) {
    if (lookupInFlight.has(item.key)) continue;
    lookupInFlight.add(item.key);
    try {
      const soldItem = await checkSoldProduct(item.code);
      const hit = LG.classifySoldScan(soldItem);
      const view = describeSoldScan(hit, item.code);
      const nowIso = new Date().toISOString();
      const entry = {
        by: item.by,
        time: nowIso,
        status: view.st.label,
        codeProduct: view.finalCodeProduct,
        code: view.finalCode,
        name: view.finalName,
        tray: view.finalTray,
        image: view.imgUrl,
      };
      const uniqueKey = LG.generateHistoryKey(entry.codeProduct, entry.time);
      await fbPut(`/opname/${sessionId}/history/${uniqueKey}`, entry);
      await fbPut(`/opname/${sessionId}/lookups/${item.key}/state`, 'done');
    } catch (e) {
      // leave pending for the next ES tick / heartbeat
    } finally {
      lookupInFlight.delete(item.key);
    }
  }
}
function onLookupsUpdate() {
  processLookups();
}
```

Do **not** call `queueFormInput` here. `onCloudUpdate` handles MASUK from `by !== myName`.

Replace the Task 4 empty `onLookupsUpdate` in `applyEsResult`.

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add liagold-suite.user.js
git commit -m "feat(scanner): resolve phone lookups via product-by-code"
```

---

### Task 7: Userscript version 2.1.0

**Files:**
- Modify: `liagold-suite.user.js` header only

- [ ] **Step 1: Bump header**

```
// @version      2.1.0
// @description  v2.1.0: phone scanner catalog mirror + lookup consumer
```

Do not touch panel HTML.

- [ ] **Step 2: Commit**

```bash
git add liagold-suite.user.js
git commit -m "chore: bump userscript to 2.1.0"
```

---

### Task 8: Copy lib into `mobile/lib`

**Files:**
- Create: `scripts/sync-mobile-lib.mjs`
- Create: `mobile/lib/` copies

**Interfaces:**
- Consumes: `lib/*.js` listed below
- Produces: `mobile/lib/*.js` (same contents)

Copy exactly these files (imports must resolve inside `mobile/lib`):

- `history-key.js`
- `session-expiry.js`
- `scan-classify.js`
- `catalog-sync.js`
- `lookup-queue.js`
- `scan-cooldown.js`
- `es-event.js`
- `es-reconnect.js`
- `random-id.js`

- [ ] **Step 1: Write the sync script**

Create `scripts/sync-mobile-lib.mjs`:

```js
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'history-key.js',
  'session-expiry.js',
  'scan-classify.js',
  'catalog-sync.js',
  'lookup-queue.js',
  'scan-cooldown.js',
  'es-event.js',
  'es-reconnect.js',
  'random-id.js',
];
mkdirSync(join(root, 'mobile', 'lib'), { recursive: true });
for (const file of files) {
  copyFileSync(join(root, 'lib', file), join(root, 'mobile', 'lib', file));
}
```

- [ ] **Step 2: Run it**

Run: `node scripts/sync-mobile-lib.mjs`

Expected: files exist under `mobile/lib/`

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-mobile-lib.mjs mobile/lib
git commit -m "chore: copy scanner lib into mobile public folder"
```

---

### Task 9: Phone join + text scan (no camera yet)

**Files:**
- Create: `mobile/index.html`
- Create: `mobile/style.css`
- Create: `mobile/firebase.js`
- Create: `mobile/app.js`

**Interfaces:**
- Consumes: `mobile/lib/*` helpers, Firebase REST `https://stock-baki-default-rtdb.asia-southeast1.firebasedatabase.app`
- Produces: join by session code; history PUT for known products; lookup PUT for unknown; `meta/lastScanAt` on successful history write

Status labels (copy, do not invent): `MASUK`, `SUDAH DISCAN`, `SALAH BAKI`, `TERJUAL / RUSAK`, `BARCODE TIDAK ADA`.

- [ ] **Step 1: `mobile/firebase.js`**

```js
export const FIREBASE = 'https://stock-baki-default-rtdb.asia-southeast1.firebasedatabase.app';

export async function fbGet(path) {
  const res = await fetch(`${FIREBASE}${path}.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fbPut(path, data) {
  const res = await fetch(`${FIREBASE}${path}.json`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function fbPost(path, data) {
  const res = await fetch(`${FIREBASE}${path}.json`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export function openSessionEs(sessionId, { onPut, onPatch, onError }) {
  const es = new EventSource(`${FIREBASE}/opname/${sessionId}.json`);
  es.addEventListener('put', (e) => {
    try { onPut(JSON.parse(e.data)); } catch (err) {}
  });
  es.addEventListener('patch', (e) => {
    try { onPatch(JSON.parse(e.data)); } catch (err) {}
  });
  es.onerror = onError;
  return es;
}
```

- [ ] **Step 2: `mobile/index.html` + `style.css`**

Join screen: name input (placeholder Anonim), session code input, button `Masuk`, status line, footer `phone-scanner 1`.

Scan screen (hidden until join): video `#cam`, tray `<select id="tray">`, text input `#scan-input`, button `CEK`, result banner, stats, log list, peserta line. No kirim/ambil form, no batch controls.

Keep CSS compact: full-viewport, 16px controls, camera 40vh, system fonts.

- [ ] **Step 3: `mobile/app.js` scan pipeline**

Use:

- `shouldRejectExpiredJoin` from `./lib/session-expiry.js`
- `classifyFoundScan` from `./lib/scan-classify.js`
- `canAcceptScan`, `isCatalogHostAlive`, `productsMatchTray` from `./lib/catalog-sync.js`
- `lookupKey`, `buildLookupEntry` from `./lib/lookup-queue.js`
- `shouldAcceptDetectedCode` from `./lib/scan-cooldown.js`
- `generateHistoryKey` from `./lib/history-key.js`
- `applyEsPut`, `applyEsPatch` from `./lib/es-event.js`
- `planEsOnError`, `ES_CLOSED` from `./lib/es-reconnect.js`
- `randomBase36` from `./lib/random-id.js`

Join:

1. `code = input.trim().toUpperCase()`. If empty, status `Masukkan kode sesi dulu.`
2. `meta = await fbGet(`/opname/${code}/meta`)`. If `meta == null`, `Sesi tidak ditemukan.`
3. If `shouldRejectExpiredJoin(meta.lastScanAt || meta.dibuat)`, `Sesi sudah EXPIRED (>12 jam tanpa scan).`
4. Persist `lg_mp_name`, `lg_session`. `myId` from `lg_mp_id` or `'u' + randomBase36(8)`.
5. `fbPut(`/opname/${code}/peserta/${myId}`, { nama, join: iso })`.
6. Open EventSource. Show scan screen.

ES state: `{ cloudHistory, participants, dupeCount, lastScanAt, catalog, lookups }`. On each apply, rebuild `scannedCodes` from MASUK history like laptop `onCloudUpdate` (codes only; do not touch any ERP form).

Scan `submitCode(raw)`:

1. `code = String(raw).trim()`. If empty return.
2. `block = canAcceptScan({ hostAt: catalog?.hostAt, now: Date.now(), selectedTray: catalog?.selectedTray, productCount: Object.keys(catalog?.products || {}).length })`. Map `host-stale` → `Laptop tidak kirim katalog`, `no-tray` → `Pilih baki spesifik terlebih dahulu sebelum scan!`, `empty` → `Laptop belum muat baki`.
3. If `!productsMatchTray(catalog.products, catalog.selectedTray)` and selected is not `all`, same empty message (wait up to 10s after a local tray change before showing it; until then `Baki masih dimuat. Tunggu sebentar…`).
4. If `!shouldAcceptDetectedCode({ code, lastCode, lastAt, now: Date.now() })` return. Else store lastCode/lastAt.
5. `found = catalog.products[sanitizeKey(code.toLowerCase())]` — import `sanitizeKey` / `productCatalogKey`. Prefer `productCatalogKey(code)` then fallback scan Object.values for case-insensitive `codeProduct`.
6. `hit = classifyFoundScan({ found, scanned: scannedCodes, pending: pendingLocalScans, selectedTray: catalog.selectedTray })`.
7. `masuk` / `sudah` / `salah-baki`: `fbPut` history with laptop payload shape (`by, time, status, codeProduct, code, name, tray, image`). On `masuk` add to `pendingLocalScans`. On `sudah` `fbPost(`/opname/${sessionId}/dupes`, { code: found.codeProduct, by: myName, time: iso })`. Then `fbPut(`/opname/${sessionId}/meta/lastScanAt`, iso)`.
8. `lookup-sold`: `fbPut(`/opname/${sessionId}/lookups/${lookupKey(code, iso)}`, buildLookupEntry({ code, by: myName, time: iso }))`, banner `Mengecek "code"…`. After 8s if no history `codeProduct` match (case-insensitive), banner `Gagal cek. Laptop belum jawab.` Do not write TERJUAL/TIDAK_ADA locally.
9. Failed history PUT: push `{ ...entry, uniqueKey }` into `localStorage` key `lg_pendingCloudPushes` and retry every 5s (copy laptop retry shape).

Tray `<select>` change: `fbPut` `/opname/${id}/catalog/selectedTray` and `/catalog/selectedTrayCode` only. Do not write `products`. If already equal, skip.

Beep: MASUK 880, SUDAH 440, else 220, 0.12s, ignore AudioContext errors.

No `liagold.cuan.co` string anywhere under `mobile/` except comments if needed — do not add that host at all.

- [ ] **Step 4: Manual smoke without camera**

Serve `mobile/` over HTTPS (or localhost). Join a live session from the laptop userscript, type a known in-tray code, confirm laptop log + auto-fill.

- [ ] **Step 5: Commit**

```bash
git add mobile/index.html mobile/style.css mobile/firebase.js mobile/app.js
git commit -m "feat(mobile): join session and text scan"
```

---

### Task 10: Continuous camera

**Files:**
- Create: `mobile/camera.js`
- Create: `mobile/vendor/jsQR.js` (vendor the official jsQR UMD build 1.4.0; do not add npm)
- Modify: `mobile/index.html` to include `<script src="./vendor/jsQR.js"></script>` before `app.js` type=module
- Modify: `mobile/app.js` to start/stop camera on scan screen

**Interfaces:**
- Consumes: `shouldAcceptDetectedCode` (already used in `submitCode`)
- Produces: calls `window.__lgSubmitCode(code)` or the exported submit from app

- [ ] **Step 1: `mobile/camera.js`**

```js
const FORMATS = ['qr_code', 'code_128', 'ean_13', 'code_39'];

export async function startCamera({ videoEl, onCode, onDenied }) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
  } catch (e) {
    onDenied();
    return { stop() {} };
  }
  videoEl.srcObject = stream;
  await videoEl.play();
  let running = true;
  const detector = ('BarcodeDetector' in window)
    ? new BarcodeDetector({ formats: FORMATS })
    : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let lastTick = 0;

  async function tick(ts) {
    if (!running) return;
    if (document.hidden) {
      requestAnimationFrame(tick);
      return;
    }
    if (ts - lastTick < 120) {
      requestAnimationFrame(tick);
      return;
    }
    lastTick = ts;
    try {
      if (detector) {
        const codes = await detector.detect(videoEl);
        if (codes[0] && codes[0].rawValue) onCode(codes[0].rawValue);
      } else if (window.jsQR && videoEl.readyState >= 2) {
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        ctx.drawImage(videoEl, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hit = window.jsQR(img.data, img.width, img.height);
        if (hit && hit.data) onCode(hit.data);
      }
    } catch (e) {}
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  return {
    stop() {
      running = false;
      for (const t of stream.getTracks()) t.stop();
      videoEl.srcObject = null;
    },
  };
}
```

In `app.js` after showing the scan screen, `startCamera({ videoEl, onCode: submitCode, onDenied: () => setStatus('Izinkan kamera, atau ketik kodenya') })`. Stop on leave.

- [ ] **Step 2: Vendor jsQR**

Download jsQR 1.4.0 dist to `mobile/vendor/jsQR.js` (jsDelivr `npm/jsqr@1.4.0/dist/jsQR.js`). Do not add it to `package.json`.

- [ ] **Step 3: Commit**

```bash
git add mobile/camera.js mobile/vendor/jsQR.js mobile/index.html mobile/app.js
git commit -m "feat(mobile): continuous camera barcode detect"
```

---

### Task 11: Rules, hosting stub, README

**Files:**
- Modify: `docs/firebase-rules.md`
- Create: `firebase.json`
- Modify: `README.md`

- [ ] **Step 1: Rules**

Replace the JSON block in `docs/firebase-rules.md` with:

```json
{
  "rules": {
    "opname": {
      "$session": {
        ".read": "true",
        ".write": "true",
        ".validate": "$session.matches(/^[A-Z0-9]{6,16}$/)",
        "meta": {
          ".validate": "newData.hasChildren(['dibuat'])"
        },
        "history": {
          "$key": {
            ".validate": "newData.hasChildren(['codeProduct', 'status', 'time'])"
          }
        },
        "lookups": {
          "$key": {
            ".validate": "newData.hasChildren(['code', 'by', 'time', 'state'])"
          }
        }
      }
    }
  }
}
```

Keep the prose: do not set root `.read`/`.write` true. Note that `catalog` is allowed by the session write rule; `hostAt` is a string leaf.

Paste the same JSON into Firebase Console (manual; the agent cannot assume CLI login).

- [ ] **Step 2: `firebase.json`**

```json
{
  "hosting": {
    "public": "mobile",
    "ignore": ["firebase.json", "**/.*"]
  }
}
```

- [ ] **Step 3: README**

After the install section add:

```
## Phone scanner

Static site in `mobile/`. Join the same multiplayer session code from the userscript. Laptop must stay open (catalog heartbeat). Camera needs HTTPS.

Deploy: copy lib with `node scripts/sync-mobile-lib.mjs`, then Firebase Hosting (`public: mobile`). Put the live URL here after first deploy.
```

Do not invent a live URL.

- [ ] **Step 4: Full test run**

Run: `npm test`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/firebase-rules.md firebase.json README.md
git commit -m "docs: phone scanner hosting and Firebase rules"
```

---

## Self-review

**Spec coverage:**
- Shared Firebase session, type-code join → Task 9
- Camera continuous QR/barcode → Task 10
- Scan-baki statuses, no form import/export on phone → Task 9
- Laptop UI unchanged → Tasks 5–7 silent only
- Catalog mirror + heartbeat 15s / alive 45s → Tasks 1, 5
- Lookups + `by` = phone name → Tasks 2, 6
- ES catalog/lookups → Task 4
- Cooldown 2s → Task 3
- lastScanAt from phone → Task 9
- Pending cloud retry → Task 9
- Rules + hosting + lib copy → Tasks 8, 11
- Version 2.1.0 → Task 7
- `scan-classify` unchanged as source → no task edits it

**Placeholder scan:** none remaining (no TBD). Hosting live URL is explicitly “after first deploy”, matching the spec.

**Type consistency:** `buildCatalogPayload` / `withHostAt` / `shouldApplyRemoteTray` / `isCatalogHostAlive` / `canAcceptScan` / `productsMatchTray` / `lookupKey` / `buildLookupEntry` / `pendingLookups` / `shouldAcceptDetectedCode` names match across tasks. History payload fields match `pushScanToCloud`. ES state fields are `catalog` and `lookups`.
