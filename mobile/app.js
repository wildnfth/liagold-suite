import { fbGet, fbPut, fbPost, openSessionEs } from './firebase.js';
import { shouldRejectExpiredJoin } from './lib/session-expiry.js';
import { classifyFoundScan } from './lib/scan-classify.js';
import {
  canAcceptScan,
  productsMatchTray,
  productCatalogKey,
} from './lib/catalog-sync.js';
import { lookupKey, buildLookupEntry } from './lib/lookup-queue.js';
import { shouldAcceptDetectedCode } from './lib/scan-cooldown.js';
import { pickLatestScan } from './lib/scan-latest.js';
import { filterCodeSuggestions } from './lib/scan-suggest.js';
import { filterProductsByScan, scanFilterCounts, catalogProductList as productsFromCatalog, productScanCode } from './lib/scan-filter.js';
import { photoOverlayView, productPhotoAttrs } from './lib/photo-overlay.js';
import { generateHistoryKey, sanitizeKey } from './lib/history-key.js';
import { applyEsPut, applyEsPatch } from './lib/es-event.js';
import { planEsOnError, ES_CLOSED } from './lib/es-reconnect.js';
import { randomBase36 } from './lib/random-id.js';
import { startCamera } from './camera.js';
import { nextCameraAction, cameraUiState } from './lib/camera-power.js';

const ST = {
  MASUK: 'MASUK',
  SUDAH: 'SUDAH DISCAN',
  SALAH_BAKI: 'SALAH BAKI',
  TERJUAL: 'TERJUAL / RUSAK',
  TIDAK_ADA: 'BARCODE TIDAK ADA',
};
const PENDING_KEY = 'lg_pendingCloudPushes';
const BLOCK_MSG = {
  'host-stale': 'Laptop tidak kirim katalog',
  'no-tray': 'Pilih baki spesifik terlebih dahulu sebelum scan!',
  empty: 'Laptop belum muat baki',
};

const joinScreen = document.getElementById('join-screen');
const scanScreen = document.getElementById('scan-screen');
const joinStatus = document.getElementById('join-status');
const resultEl = document.getElementById('result');
const statsEl = document.getElementById('stats');
const pesertaEl = document.getElementById('peserta');
const logEl = document.getElementById('log');
const productsEl = document.getElementById('products');
const photoOverlay = document.getElementById('photo-overlay');
const photoTitle = document.getElementById('photo-title');
const photoImgWrap = document.getElementById('photo-img-wrap');
const photoFill = document.getElementById('photo-fill');
const photoClose = document.getElementById('photo-close');
const trayEl = document.getElementById('tray');
const scanInput = document.getElementById('scan-input');
const suggestEl = document.getElementById('suggest');

let sessionId = null;
let myName = localStorage.getItem('lg_mp_name') || '';
let myId = localStorage.getItem('lg_mp_id') || '';
if (!myId) {
  myId = 'u' + randomBase36(8);
  localStorage.setItem('lg_mp_id', myId);
}
let es = null;
let esFailCount = 0;
let esReconnectTimer = null;
let esState = {
  cloudHistory: {},
  participants: {},
  dupeCount: 0,
  lastScanAt: null,
  catalog: null,
  lookups: {},
};
let scannedCodes = new Set();
let pendingLocalScans = new Set();
let lastCode = null;
let lastAt = 0;
let trayChangedAt = 0;
let lookupWait = null;
let pendingPushes = [];
try {
  pendingPushes = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
  if (!Array.isArray(pendingPushes)) pendingPushes = [];
} catch (e) {
  pendingPushes = [];
}
let retryTimer = null;
let audioCtx = null;
let camHandle = null;
let camWantedOn = true;
let camStartId = 0;
let lastShownScanTime = '';
let suggestItems = [];
let suggestIndex = -1;
let scanFilter = 'all';

document.getElementById('join-name').value = myName;
document.getElementById('join-btn').addEventListener('click', join);
document.getElementById('scan-btn').addEventListener('click', () => {
  hideSuggestions();
  submitCode(scanInput.value);
  scanInput.value = '';
  scanInput.focus();
});
scanInput.addEventListener('input', () => updateSuggestions(scanInput.value));
scanInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' && suggestItems.length) {
    e.preventDefault();
    highlightSuggest(Math.min(suggestItems.length - 1, suggestIndex + 1));
    return;
  }
  if (e.key === 'ArrowUp' && suggestItems.length) {
    e.preventDefault();
    highlightSuggest(Math.max(0, suggestIndex - 1));
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (suggestIndex >= 0 && suggestItems[suggestIndex]) {
      pickSuggestion(suggestItems[suggestIndex].code);
      return;
    }
    hideSuggestions();
    submitCode(scanInput.value);
    scanInput.value = '';
  }
  if (e.key === 'Escape') hideSuggestions();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#scan-input') && !e.target.closest('#suggest')) hideSuggestions();
});
trayEl.addEventListener('change', onTrayChange);
document.getElementById('leave-btn').addEventListener('click', leave);
document.getElementById('cam-toggle')?.addEventListener('change', (e) => {
  camWantedOn = Boolean(e.target.checked);
  applyCameraPower();
});
document.querySelector('.tabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('.scan-tab');
  if (!tab) return;
  e.preventDefault();
  scanFilter = tab.getAttribute('data-val') || 'all';
  render();
});
productsEl?.addEventListener('click', (e) => {
  const row = e.target.closest('[data-photo]');
  if (!row) return;
  openPhotoOverlay({
    img: row.getAttribute('data-img') || '',
    name: row.getAttribute('data-name') || '',
    code: row.getAttribute('data-code') || '',
    weight: row.getAttribute('data-weight') || '',
  });
});
photoOverlay?.addEventListener('click', (e) => {
  if (e.target === photoOverlay) closePhotoOverlay();
});
photoClose?.addEventListener('click', closePhotoOverlay);
photoFill?.addEventListener('click', () => {
  const code = photoFill.dataset.code || '';
  closePhotoOverlay();
  if (!code) return;
  submitCode(code);
  scanInput.value = '';
  scanInput.focus();
});

export async function submitCode(raw) {
  hideSuggestions();
  const code = String(raw || '').trim();
  if (!code) return;
  const catalog = esState.catalog || {};
  const products = catalog.products || {};
  const now = Date.now();
  const block = canAcceptScan({
    hostAt: catalog.hostAt,
    now,
    selectedTray: catalog.selectedTray,
    productCount: Object.keys(products).length,
  });
  if (block) {
    const waiting = trayChangedAt && now - trayChangedAt < 10000;
    if (block === 'empty' && waiting) {
      showResult('Baki masih dimuat. Tunggu sebentar…', 'sudah');
      return;
    }
    showResult(BLOCK_MSG[block], 'bad');
    beep(220);
    return;
  }
  if (!productsMatchTray(products, catalog.selectedTray)) {
    const waiting = trayChangedAt && now - trayChangedAt < 10000;
    showResult(waiting ? 'Baki masih dimuat. Tunggu sebentar…' : BLOCK_MSG.empty, waiting ? 'sudah' : 'bad');
    return;
  }
  if (!shouldAcceptDetectedCode({ code, lastCode, lastAt, now })) return;
  lastCode = code;
  lastAt = now;
  signalHit();

  const found = findProduct(products, code);
  const hit = classifyFoundScan({
    found,
    scanned: scannedCodes,
    pending: pendingLocalScans,
    selectedTray: catalog.selectedTray,
  });
  if (hit.kind === 'lookup-sold') {
    await startLookup(code);
    return;
  }
  const status = hit.kind === 'masuk' ? ST.MASUK : hit.kind === 'sudah' ? ST.SUDAH : ST.SALAH_BAKI;
  const product = hit.found;
  const iso = new Date().toISOString();
  const entry = {
    by: myName,
    time: iso,
    status,
    codeProduct: product.codeProduct,
    code: product.code || '-',
    name: product.name || '-',
    tray: product.trayCode || '-',
    image: product.image || '',
  };
  if (hit.kind === 'masuk') pendingLocalScans.add(String(product.codeProduct).toLowerCase());
  if (hit.kind === 'sudah') {
    fbPost(`/opname/${sessionId}/dupes`, { code: product.codeProduct, by: myName, time: iso }).catch(() => {});
  }
  await persistHistory(entry);
  lastShownScanTime = iso;
  showResult(`${status} — ${product.name || product.codeProduct}`, classFor(status));
  beep(hit.kind === 'masuk' ? 880 : hit.kind === 'sudah' ? 440 : 220);
}

function findProduct(products, code) {
  const direct = products[productCatalogKey(code)] || products[sanitizeKey(String(code).toLowerCase())];
  if (direct) return direct;
  const needle = String(code).toLowerCase();
  return Object.values(products).find((p) => p && String(p.codeProduct).toLowerCase() === needle) || undefined;
}

async function startLookup(code) {
  const iso = new Date().toISOString();
  const key = lookupKey(code, iso);
  try {
    await fbPut(`/opname/${sessionId}/lookups/${key}`, buildLookupEntry({ code, by: myName, time: iso }));
  } catch (e) {
    showResult('Gagal kirim cek ke laptop', 'bad');
    return;
  }
  lookupWait = { code: String(code).toLowerCase(), until: Date.now() + 8000 };
  showResult(`Mengecek "${code}"…`, 'sudah');
  setTimeout(checkLookupTimeout, 8000);
}

function checkLookupTimeout() {
  if (!lookupWait) return;
  if (Date.now() < lookupWait.until) return;
  const needle = lookupWait.code;
  lookupWait = null;
  const found = Object.values(esState.cloudHistory || {}).some(
    (v) => v && v.codeProduct && String(v.codeProduct).toLowerCase() === needle,
  );
  if (!found) showResult('Gagal cek. Laptop belum jawab.', 'bad');
}

async function persistHistory(entry) {
  const uniqueKey = generateHistoryKey(entry.codeProduct, entry.time);
  try {
    await fbPut(`/opname/${sessionId}/history/${uniqueKey}`, entry);
    await fbPut(`/opname/${sessionId}/meta/lastScanAt`, entry.time);
  } catch (e) {
    pendingPushes.push({ ...entry, uniqueKey });
    persistPending();
    scheduleRetry();
  }
}

function persistPending() {
  try {
    if (!pendingPushes.length) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(pendingPushes));
  } catch (e) {}
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    if (!sessionId || !pendingPushes.length) return;
    const batch = pendingPushes.splice(0, 10);
    for (const entry of batch) {
      const uniqueKey = entry.uniqueKey || generateHistoryKey(entry.codeProduct, entry.time);
      try {
        await fbPut(`/opname/${sessionId}/history/${uniqueKey}`, entry);
      } catch (e) {
        pendingPushes.push(entry);
      }
    }
    persistPending();
    if (pendingPushes.length) scheduleRetry();
  }, 5000);
}

async function join() {
  const nama = document.getElementById('join-name').value.trim() || 'Anonim';
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!code) {
    joinStatus.textContent = 'Masukkan kode sesi dulu.';
    return;
  }
  myName = nama;
  localStorage.setItem('lg_mp_name', nama);
  joinStatus.textContent = 'Menghubungkan…';
  try {
    const meta = await fbGet(`/opname/${code}/meta`);
    if (meta == null) {
      localStorage.removeItem('lg_session');
      joinStatus.textContent = 'Sesi tidak ditemukan.';
      return;
    }
    if (shouldRejectExpiredJoin(meta.lastScanAt || meta.dibuat)) {
      localStorage.removeItem('lg_session');
      joinStatus.textContent = 'Sesi sudah EXPIRED (>12 jam tanpa scan).';
      return;
    }
    await fbPut(`/opname/${code}/peserta/${myId}`, { nama: myName, join: new Date().toISOString() });
    sessionId = code;
    localStorage.setItem('lg_session', code);
    joinScreen.hidden = true;
    scanScreen.hidden = false;
    listen();
    scheduleRetry();
    applyCameraPower();
  } catch (e) {
    joinStatus.textContent = 'Gagal masuk: ' + e.message;
  }
}

function listen() {
  if (esReconnectTimer) {
    clearTimeout(esReconnectTimer);
    esReconnectTimer = null;
  }
  if (es) es.close();
  esFailCount = 0;
  es = openSessionEs(sessionId, {
    onPut: ({ path, data }) => applyEs(applyEsPut(esState, path, data)),
    onPatch: ({ path, data }) => applyEs(applyEsPatch(esState, path, data)),
    onError: onEsError,
  });
}

function applyEs(result) {
  if (!result || !result.state) return;
  esState = result.state;
  rebuildScanned();
  if (lookupWait) {
    const needle = lookupWait.code;
    const hit = Object.values(esState.cloudHistory || {}).find(
      (v) => v && v.codeProduct && String(v.codeProduct).toLowerCase() === needle,
    );
    if (hit) {
      lookupWait = null;
      lastShownScanTime = String(hit.time || '');
      showResult(`${hit.status} — ${hit.name || hit.codeProduct}`, classFor(hit.status));
      beep(hit.status === ST.MASUK ? 880 : 220);
    }
  }
  syncLatestBanner();
  render();
}

function syncLatestBanner() {
  const latest = pickLatestScan(esState.cloudHistory);
  if (!latest) return;
  const t = String(latest.time || '');
  if (!t || t === lastShownScanTime) return;
  lastShownScanTime = t;
  const who = latest.by && latest.by !== myName ? ` · ${latest.by}` : '';
  showResult(
    `${latest.status} — ${latest.name || '-'} (${latest.codeProduct})${who}`,
    classFor(latest.status),
  );
}

function rebuildScanned() {
  const next = new Set();
  Object.values(esState.cloudHistory || {}).forEach((v) => {
    if (v && v.status === ST.MASUK && v.codeProduct) {
      next.add(String(v.codeProduct).toLowerCase());
    }
  });
  pendingLocalScans.forEach((c) => {
    if (next.has(c)) pendingLocalScans.delete(c);
    else next.add(c);
  });
  scannedCodes = next;
}

function onEsError() {
  if (!sessionId || !es) return;
  const plan = planEsOnError({
    readyState: es.readyState,
    failCount: esFailCount,
  });
  esFailCount = plan.nextFailCount;
  if (plan.cancelPending && esReconnectTimer) {
    clearTimeout(esReconnectTimer);
    esReconnectTimer = null;
  }
  if (!plan.scheduleSync && !plan.recreate) return;
  esReconnectTimer = setTimeout(async () => {
    esReconnectTimer = null;
    if (!sessionId) return;
    if (plan.recreate) {
      esFailCount = 0;
      listen();
      return;
    }
    try {
      const data = await fbGet(`/opname/${sessionId}`);
      applyEs(applyEsPut(esState, '/', data));
      esFailCount = 0;
    } catch (e) {}
  }, plan.delayMs);
}

async function onTrayChange() {
  const val = trayEl.value;
  const catalog = esState.catalog || {};
  if (!sessionId || String(catalog.selectedTray) === String(val)) return;
  const info = (catalog.trays || {})[val];
  trayChangedAt = Date.now();
  try {
    await fbPut(`/opname/${sessionId}/catalog/selectedTray`, val);
    await fbPut(`/opname/${sessionId}/catalog/selectedTrayCode`, info ? info.trayCode : '');
  } catch (e) {
    showResult('Gagal ganti baki', 'bad');
  }
}

function render() {
  const catalog = esState.catalog || {};
  const trays = catalog.trays || {};
  const selected = catalog.selectedTray == null ? 'all' : String(catalog.selectedTray);
  const opts = ['<option value="all">Semua Baki</option>'];
  Object.values(trays).forEach((t) => {
    if (!t) return;
    opts.push(`<option value="${esc(String(t.trayId))}">Baki ${esc(t.trayCode || t.trayId)}</option>`);
  });
  trayEl.innerHTML = opts.join('');
  trayEl.value = selected;
  const productCount = Object.keys(catalog.products || {}).length;
  const masuk = scannedCodes.size;
  statsEl.textContent = `MASUK ${masuk} · katalog ${productCount} · dupes ${esState.dupeCount || 0}`;
  const names = Object.values(esState.participants || {}).map((p) => p && p.nama).filter(Boolean);
  pesertaEl.textContent = names.length ? `Online: ${names.join(', ')}` : 'Online: -';
  const productList = productsFromCatalog(catalog.products);
  const counts = scanFilterCounts({ products: productList, scanned: scannedCodes });
  document.querySelectorAll('.scan-tab').forEach((t) => {
    t.classList.toggle('on', t.getAttribute('data-val') === scanFilter);
  });
  document.querySelectorAll('[data-count]').forEach((el) => {
    el.textContent = String(counts[el.dataset.count] ?? 0);
  });
  if (productsEl) {
    const filtered = filterProductsByScan({
      products: productList,
      scanned: scannedCodes,
      filter: scanFilter,
    });
    if (!counts.all) {
      productsEl.innerHTML = '<li class="empty">Pilih baki untuk memuat</li>';
    } else if (!filtered.length) {
      const msg = scanFilter === 'unscanned'
        ? 'Semua sudah discan!'
        : 'Belum ada yang discan';
      productsEl.innerHTML = `<li class="empty">${msg}</li>`;
    } else {
      productsEl.innerHTML = filtered.map((p) => {
        const sc = scannedCodes.has(productScanCode(p));
        const photo = productPhotoAttrs(p);
        return `<li class="${sc ? 'done' : ''}" data-photo data-img="${esc(photo.img)}" data-name="${esc(photo.name)}" data-code="${esc(photo.code)}" data-weight="${esc(photo.weight)}">
          <div>
            <div class="code">${esc(p.codeProduct)}</div>
            <div class="name">${esc(p.name || '-')}</div>
          </div>
          <span class="meta">${esc(p.weight || 0)} gr</span>
          <span>${sc ? '✅' : '⬜'}</span>
        </li>`;
      }).join('');
    }
  }
  const rows = Object.values(esState.cloudHistory || {})
    .filter((v) => v && v.codeProduct)
    .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
    .slice(0, 40);
  logEl.innerHTML = rows.map((v) => (
    `<li>${esc(v.status)} · ${esc(v.codeProduct)} · ${esc(v.name || '-')} · ${esc(v.by || '')}</li>`
  )).join('');
}

function catalogProductList() {
  return productsFromCatalog((esState.catalog && esState.catalog.products) || {});
}

function productByCodeMap() {
  const map = new Map();
  for (const p of catalogProductList()) {
    const code = productScanCode(p);
    if (code) map.set(code, p);
  }
  return map;
}

function openPhotoOverlay({ img, name, code, weight } = {}) {
  if (!photoOverlay || !photoTitle || !photoImgWrap || !photoFill) return;
  const view = photoOverlayView({
    imgUrl: img,
    name,
    code,
    weight,
    productByCode: productByCodeMap(),
  });
  if (view.code) {
    photoTitle.innerHTML = `<div class="photo-code">${esc(view.code)}</div>${view.weight ? `<div class="photo-weight">${esc(view.weight)}</div>` : ''}${view.name ? `<div class="photo-name">${esc(view.name)}</div>` : '<div class="photo-name"></div>'}`;
  } else {
    photoTitle.innerHTML = `<div class="photo-name">${esc(view.name || 'Produk')}</div>`;
  }
  if (view.missingImage) {
    photoImgWrap.innerHTML = '<div class="photo-missing">Gambar tidak tersedia</div>';
  } else {
    photoImgWrap.innerHTML = `<img alt="" src="${esc(view.imgUrl)}">`;
    const imgEl = photoImgWrap.querySelector('img');
    if (imgEl) {
      imgEl.addEventListener('error', () => {
        photoImgWrap.innerHTML = '<div class="photo-missing">Gambar tidak tersedia</div>';
      });
    }
  }
  photoFill.hidden = !view.showFill;
  photoFill.dataset.code = view.code || '';
  photoOverlay.hidden = false;
}

function closePhotoOverlay() {
  if (!photoOverlay) return;
  photoOverlay.hidden = true;
  if (photoFill) photoFill.dataset.code = '';
}

function updateSuggestions(query) {
  suggestItems = filterCodeSuggestions({
    query,
    products: catalogProductList(),
    limit: 8,
    maxNameLen: 22,
  });
  suggestIndex = -1;
  if (!suggestEl) return;
  if (!suggestItems.length) {
    hideSuggestions();
    return;
  }
  suggestEl.hidden = false;
  suggestEl.innerHTML = suggestItems.map((item, i) => (
    `<div data-idx="${i}"><b>${esc(item.code)}</b> <span>${esc(item.name || '')}</span></div>`
  )).join('');
  suggestEl.querySelectorAll('div').forEach((opt) => {
    opt.addEventListener('click', () => {
      const item = suggestItems[Number(opt.dataset.idx)];
      if (item) pickSuggestion(item.code);
    });
  });
}

function hideSuggestions() {
  suggestItems = [];
  suggestIndex = -1;
  if (suggestEl) {
    suggestEl.hidden = true;
    suggestEl.innerHTML = '';
  }
}

function highlightSuggest(idx) {
  suggestIndex = idx;
  if (!suggestEl) return;
  suggestEl.querySelectorAll('div').forEach((opt, i) => {
    opt.style.background = i === suggestIndex ? '#eff6ff' : '#fff';
  });
}

function pickSuggestion(code) {
  scanInput.value = code;
  hideSuggestions();
  submitCode(code);
  scanInput.value = '';
  scanInput.focus();
}

function leave() {
  camWantedOn = true;
  const toggle = document.getElementById('cam-toggle');
  if (toggle) toggle.checked = true;
  stopCam();
  if (es) es.close();
  es = null;
  sessionId = null;
  try { localStorage.removeItem('lg_session'); } catch (e) {}
  joinScreen.hidden = false;
  scanScreen.hidden = true;
}

async function applyCameraPower() {
  const action = nextCameraAction({
    wantedOn: camWantedOn,
    running: Boolean(camHandle),
  });
  if (action === 'start') await startCam();
  else if (action === 'stop') stopCam();
  else applyCameraUi();
}

function stopCam() {
  camStartId += 1;
  if (camHandle) {
    camHandle.stop();
    camHandle = null;
  }
  applyCameraUi();
}

function applyCameraUi() {
  const ui = cameraUiState({
    wantedOn: camWantedOn,
    zoomCaps: camHandle && camHandle.zoomCaps,
  });
  const wrap = document.querySelector('.cam-wrap');
  if (wrap) wrap.hidden = ui.previewHidden;
  const zoomWrap = document.getElementById('zoom-wrap');
  if (zoomWrap) zoomWrap.hidden = ui.zoomHidden;
  const camStatus = document.getElementById('cam-status');
  if (camStatus && !camWantedOn) camStatus.textContent = '';
}

async function startCam() {
  const videoEl = document.getElementById('cam');
  const camStatus = document.getElementById('cam-status');
  const zoomInput = document.getElementById('zoom');
  const id = ++camStartId;
  const handle = await startCamera({
    videoEl,
    overlayEl: document.getElementById('cam-box-poly'),
    onCode: submitCode,
    onDenied() {
      if (id !== camStartId) return;
      camStatus.textContent = 'Izinkan kamera, atau ketik kodenya';
    },
  });
  if (id !== camStartId || !camWantedOn) {
    handle.stop();
    if (id === camStartId) applyCameraUi();
    return;
  }
  camHandle = handle;
  const caps = camHandle && camHandle.zoomCaps;
  if (caps && zoomInput) {
    zoomInput.min = String(caps.min);
    zoomInput.max = String(caps.max);
    zoomInput.step = String(caps.step);
    zoomInput.value = String(caps.min);
    zoomInput.oninput = () => {
      if (camHandle) camHandle.setZoom(zoomInput.value);
    };
  }
  applyCameraUi();
}

function signalHit() {
  const flash = document.getElementById('cam-flash');
  if (flash) {
    flash.classList.remove('on');
    void flash.offsetWidth;
    flash.classList.add('on');
  }
  try {
    if (navigator.vibrate) navigator.vibrate(40);
  } catch (e) {}
}

function showResult(msg, kind) {
  resultEl.textContent = msg;
  resultEl.className = 'result ' + (kind || '');
}

function classFor(status) {
  if (status === ST.MASUK) return 'masuk';
  if (status === ST.SUDAH) return 'sudah';
  if (status === ST.SALAH_BAKI) return 'salah';
  return 'bad';
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

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

void ES_CLOSED;
window.__lgSubmitCode = submitCode;

const savedSession = (localStorage.getItem('lg_session') || '').trim().toUpperCase();
if (savedSession) {
  document.getElementById('join-code').value = savedSession;
  join();
}
