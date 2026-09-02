# Phone scanner companion — design

Date: 2026-09-02
Status: approved

## Problem

Stock-opname scanning today lives inside the Tampermonkey userscript on `https://liagold.cuan.co`. Input is a focused text field (USB/Bluetooth scanner as keyboard). Scanning on a phone is awkward: Tampermonkey on mobile is poor, and the phone cannot call the ERP product API from another origin (CORS + session cookies).

Staff want a separate HTTPS site on the phone that:

- joins the same Firebase session by typing the existing session code
- uses the camera to auto-detect QR/barcode and auto-submit
- keeps scan-baki behaviour (pilih baki, masuk / sudah / salah baki / terjual / tidak ada, log, peserta)
- does **not** import/export or auto-fill the ERP form
- does **not** change laptop-facing scanner features

The laptop stays on as the only ERP client and as the form auto-input host. The phone is a portable scanner.

## Goals

- Phone and laptop share one Firebase RTDB session (`stock-baki` / `opname/{sessionId}`).
- Phone never fetches `liagold.cuan.co`.
- Laptop user-visible UI, buttons, form import/export, and auto-fill stay as they are.
- A MASUK scan from the phone still auto-fills the ERP form on the laptop when `autoFillForm` is on (existing `onCloudUpdate` path for `scan.by !== myName`).
- Camera is continuous; detection submits the code without a shutter tap.
- Manual text input remains as fallback.

## Non-goals

- Firebase Auth or any new login
- Import / export / kirim ke form / ambil dari form / batch settings on the phone
- Changing or removing existing laptop scanner controls
- Native Play Store / App Store apps
- A backend other than the existing Firebase RTDB
- Phone working while the laptop userscript is not running (catalog heartbeat required)
- Solo-mode laptop sessions (phone needs a multiplayer session code)

## Constraints (locked)

- Laptop is mandatory and is the only ERP data source (`/web/product`, `/web/helper/product-by-code`).
- Phone joins by typing the same session code already used in the scanner. No join-QR in v1.
- Session code shape stays `[A-Z0-9]{6,16}` (current Firebase rule + `LG.randomBase36`).
- TTL stays 12 hours via `meta.lastScanAt` / `LG.shouldRejectExpiredJoin`.
- Userscript stays `@grant none`, single-file Tampermonkey install. `lib/*.js` remains source of truth; `LG` bodies stay identical.
- `npm test` stays `node --test`. No new runtime npm dependency for the userscript. Phone site is static files.
- Camera requires a secure context (HTTPS). HTTP on a LAN IP is out.

## Architecture

Two clients, one database. No new server.

```
ERP (liagold.cuan.co)
    ^ cookies + same-origin fetch
Laptop userscript
    |  PUT catalog + heartbeat
    |  PUT history (own scans + resolved lookups)
    |  GET/ES opname/{session}
    v
Firebase RTDB  stock-baki  /opname/{sessionId}
    ^
    |  GET/ES catalog, history, peserta, meta
    |  PUT history (known-product scans)
    |  PUT lookups (unknown codes)
Phone HTTPS static site
    ^ getUserMedia + BarcodeDetector
Camera
```

Laptop silent additions (no new panel buttons):

1. Mirror tray list, selected tray, and current-tray products to `catalog`.
2. Heartbeat `catalog.hostAt` while the scanner module is running and a session exists.
3. Apply remote `catalog.selectedTray` if it differs, without echoing a write (no loop).
4. Consume pending `lookups` with existing `checkSoldProduct` / `classifySoldScan`, write `history` with `by` = the phone participant name.

Phone:

1. Join screen: name + session code.
2. Scan screen: tray picker, camera, text input, result, log, stats, peserta.
3. Classify known products locally with `classifyFoundScan`.
4. Unknown codes go to `lookups`; wait for laptop `history`.

## Firebase shape

Existing nodes stay: `meta`, `history`, `scans`, `dupes`, `peserta`.

History write (same payload as `pushScanToCloud` today):

```
{
  by,            // participant display name
  time,          // ISO
  status,        // MASUK | SUDAH DISCAN | SALAH BAKI | TERJUAL / RUSAK | BARCODE TIDAK ADA
  codeProduct,
  code,
  name,
  tray,
  image
}
```

Key: `LG.generateHistoryKey(codeProduct, time)` (`sanitizeKey(codeProduct_time)`).

Peserta write (same as join today):

```
/opname/{sessionId}/peserta/{myId}  { nama, join }
```

`myId` on the phone is a new `u` + random id stored in phone `localStorage` (`lg_mp_id`), not reused from the laptop.

### New: `catalog`

```
/opname/{sessionId}/catalog
  hostAt            ISO, laptop heartbeat, every 15s
  updatedAt         ISO, last catalog content write
  selectedTray      string trayId, or "all"
  selectedTrayCode  string, empty when all
  trays             { [trayId]: { trayId, trayCode, count } }
  products          { [sanitizeKey(codeProduct lowercase)]: {
                      codeProduct, code, name, weight, image,
                      trayId, trayCode, kadar, size, group
                    } }
```

`products` is whatever the laptop currently has in `allProducts` (the active tray after `loadTrayData`, or the full in-stock list after `syncTrayList`). Phone still refuses to scan when `selectedTray === "all"` or `selectedTray` is missing, matching laptop `traySelected`.

Heartbeat: laptop PUTs `catalog/hostAt` every 15s while `sessionId` is set and the scanner IIFE is running. Content PUT of trays/products/selectedTray happens on `syncTrayList` success, `loadTrayData` success, and local `selectTray`.

Host alive: phone treats the laptop as alive if `hostAt` is less than 45s old. Otherwise show “Laptop tidak kirim katalog” and reject new scans. In-flight lookups may finish if history arrives anyway.

### New: `lookups`

```
/opname/{sessionId}/lookups/{sanitizeKey(code_time)}
  code     raw scanned string
  by       phone display name
  time     ISO
  state    "pending" | "done"
```

Phone writes `state: "pending"` when `classifyFoundScan` returns `lookup-sold`.

Laptop, on pending item: `checkSoldProduct(code)` then `classifySoldScan`, then `fbPut` history with `by: lookup.by` (not the laptop name — otherwise `onCloudUpdate` skips auto-fill). Then set `state: "done"`. Do not delete the lookup node in v1 (avoids extra ES churn); ignore `done` on later ticks.

Laptop must not enqueue form input itself for these writes; `onCloudUpdate` already queues MASUK from other names after the history PUT lands.

### EventSource

Extend `LG.classifyEsPath` / `applyEsPut` (lib + identical `LG` body) with:

- `/catalog` and `/catalog/...` → catalog replace / field
- `/lookups` and `/lookups/...` → lookup map

`putRoot` already receives the whole session; laptop and phone both read `data.catalog` and `data.lookups` from root snapshots.

### Rules

Update `docs/firebase-rules.md` and the live RTDB rules:

- Keep `opname/$session` read/write with `$session.matches(/^[A-Z0-9]{6,16}$/)`.
- Keep history child validate `codeProduct`, `status`, `time`.
- Allow `catalog` and `lookups` under the session. Do not open the database root.
- `catalog.hostAt` is a string. `lookups/$key` must have `code`, `by`, `time`, `state`.

## Phone app

Static files in `mobile/`:

- `mobile/index.html` — join + scan UI
- `mobile/app.js` — session, catalog, scan pipeline, render
- `mobile/camera.js` — continuous camera + decode
- `mobile/firebase.js` — REST + EventSource to the existing RTDB URL
- `mobile/style.css` — mobile-first layout
- `mobile/vendor/` — barcode decode fallback (jsQR or equivalent, vendored, no npm)

Reusable logic stays in `lib/` and is imported as ESM by tests and by the phone app. Userscript continues to copy bodies into `LG`.

New lib modules (pure, tested):

- `lib/catalog-sync.js`
  - `buildCatalogPayload({ trays, selectedTray, selectedTrayCode, products, now })`
  - `shouldApplyRemoteTray({ localTray, remoteTray })` → true only when remote is non-empty and `String(local) !== String(remote)`
  - `isCatalogHostAlive(hostAt, now, maxAgeMs = 45000)`
- `lib/lookup-queue.js`
  - `buildLookupEntry({ code, by, time })` → `{ code, by, time, state: "pending" }`
  - `lookupKey(code, time)` → `sanitizeKey(code + '_' + time)`
  - `pendingLookups(map)` → array of pending
- `lib/scan-cooldown.js`
  - `shouldAcceptDetectedCode({ code, lastCode, lastAt, now, cooldownMs = 2000 })`

Phone scan pipeline:

1. Guard: host alive, tray selected and not `all`, catalog `products` loaded, not expired session.
2. Normalize code string trim. Reject empty.
3. Cooldown: ignore same code within 2s (camera re-reads).
4. `classifyFoundScan({ found: products[code], scanned, pending, selectedTray })`.
5. If `masuk` / `sudah` / `salah-baki`: write history immediately; on `masuk` add the code to a local `pending` set until EventSource sees the history key (same as laptop `pendingLocalScans`). `sudah` also POST dupe like laptop `pushDupe`.
6. If `lookup-sold`: write lookup pending; show “Mengecek …”; wait up to 8s for a matching history `codeProduct`; on timeout show gagal cek, do not invent TERJUAL/TIDAK_ADA locally.
7. After any successful history write, PUT `meta/lastScanAt` (same as laptop `updateLastScanAt`) so the 12h TTL does not fire while only the phone is scanning.
8. Beep/vibrate: MASUK 880Hz, SUDAH 440Hz, others 220Hz (best-effort; ignore if AudioContext blocked until a tap).

Firebase REST + EventSource already use the absolute RTDB URL from the userscript; that API allows CORS, so the phone origin can call it without a proxy.

Camera:

- `getUserMedia({ video: { facingMode: "environment" } })`.
- Prefer `BarcodeDetector` with QR_CODE and the 1D formats the shop labels use (at least `qr_code`, `code_128`, `ean_13`, `code_39`).
- If `BarcodeDetector` is missing, use the vendored decoder on a canvas at ~8 fps.
- Continuous loop while the scan screen is visible. Pause when the tab is hidden (`document.hidden`).
- Permission denied: hide video, keep text input, show “Izinkan kamera, atau ketik kodenya”.

Join:

- Name (default `Anonim`, persist `lg_mp_name`).
- Session code, trim, uppercase.
- `GET /opname/{code}/meta.json`. Missing → not found. Expired → reject with the same 12h copy as laptop.
- PUT peserta. Open EventSource. Persist `lg_session`.
- Do not create sessions from the phone.

Tray change from phone:

- PUT `catalog/selectedTray` + `selectedTrayCode` only (not the whole products map).
- Wait for laptop to rewrite `products` + `updatedAt`.
- Do not scan until products match the selected tray (every product `trayId` equals selected, or products empty after a 10s wait → “Laptop belum muat baki”).

Tray change from laptop:

- Phone ES updates picker and product map. No write-back if already equal.

## Laptop userscript changes

Allowed:

- Silent catalog mirror, heartbeat, remote-tray apply, lookup consumer, ES path kinds for catalog/lookups.
- Tests + `LG` body sync for new lib functions.

Forbidden:

- New or removed panel buttons, labels, or settings.
- Changing form import/export, batch, auto-fill checkbox, scan input, tray dropdown behaviour for local clicks.
- Auto-fill shortcut that bypasses `onCloudUpdate` / `shouldQueueToForm`.

Remote tray apply calls the existing `selectTray(val, label, { syncForm: true })` so the ERP form tray still follows the baki — that is current laptop behaviour when the user picks a tray, now also when the phone picks it. Local `selectTray` must pass a flag `fromRemote: true` to skip writing `selectedTray` back.

Heartbeat and catalog writes run only when `sessionId` is set (multiplayer). Solo laptop is unchanged.

## Auto-fill (laptop)

Unchanged. `onCloudUpdate` already:

- rebuilds `scannedCodes` from cloud MASUK
- for new keys after initial sync, if `autoFillForm` and `scan.by !== myName` and `shouldQueueToForm(scan)`, calls `queueFormInput`

Phone MASUK history therefore auto-inputs on the laptop iff:

- laptop is in the same session
- auto-fill is checked
- a specific tray is selected on the laptop
- the product belongs to that tray (`shouldQueueToForm`)

If the phone’s selected tray and the laptop’s selected tray have not yet converged, auto-fill may skip until trays match. That is acceptable; heartbeat + remote tray apply exist to converge.

## Error handling

| Case | Behaviour |
|---|---|
| Wrong session code / meta null | Phone stays on join, “Sesi tidak ditemukan” |
| Session TTL expired | Phone rejects join; no new scans |
| Camera permission denied | Manual input only |
| Laptop heartbeat stale (>45s) | Phone blocks scan, “Laptop tidak kirim katalog” |
| Catalog selectedTray `all` | Phone blocks scan, same warning as laptop |
| Lookup no response in 8s | Phone shows gagal cek; lookup stays pending for laptop retry |
| History PUT fails | Phone queues in `localStorage` (`lg_pendingCloudPushes` equivalent) and retries every 5s |
| ES drop | Reconnect with existing `planEsOnError` (2.5s, recreate after 5) |
| Duplicate MASUK | `sudah` + dupe POST |

## Testing

`node --test` for new lib:

- `tests/catalog-sync.test.js` — payload shape, remote-tray apply / skip equal / skip empty, host alive/stale boundaries (44.9s vs 45.1s).
- `tests/lookup-queue.test.js` — key sanitize, pending filter, done ignored.
- `tests/scan-cooldown.test.js` — first accept, same code inside 2s reject, different code accept, after cooldown accept.
- Existing `tests/scan-classify.test.js` unchanged and still the classification source.

Manual (after deploy):

1. Laptop: create session, pilih baki, auto-fill on, form `/stock-opname/create` open.
2. Phone: join that code, camera on a known in-tray QR → MASUK on both, form on laptop gains the code.
3. Same QR again → SUDAH, no second form row.
4. QR from another tray → SALAH BAKI or lookup → SALAH BAKI / TERJUAL / TIDAK ADA after laptop check.
5. Kill laptop userscript → phone blocks scan within 45s.
6. Confirm laptop panel still has the same buttons as before the change.

## Hosting

- Develop: any static HTTPS server whose root can serve `mobile/` and `lib/`.
- Production: Firebase Hosting on the `stock-baki` project. Public folder is `mobile/`. Deploy copies the imported `lib/*.js` modules into `mobile/lib/` so Hosting has a single public directory.
- Document the live URL in `README.md` after first deploy. Camera will not work on `http://`.

## Security

Same model as today: session code is the capability. The phone site is a public static origin that can write to a session if the code is known. Do not log session codes. Do not put ERP credentials in the phone app. Do not set RTDB root `.read`/`.write` true.

## Rollout

1. Lib + tests (catalog, lookup, cooldown, ES path).
2. Userscript silent wiring behind multiplayer-only.
3. Phone static app.
4. Rules update.
5. Hosting deploy.
6. Manual path above.

Bump userscript `@version` once when the silent laptop wiring ships (from current `2.0.0` to `2.1.0`). Phone site has no userscript version; show a small build label in the join footer (`phone-scanner 1`).
