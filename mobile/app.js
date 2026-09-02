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
import { generateHistoryKey, sanitizeKey } from './lib/history-key.js';
import { applyEsPut, applyEsPatch } from './lib/es-event.js';
import { planEsOnError, ES_CLOSED } from './lib/es-reconnect.js';
import { randomBase36 } from './lib/random-id.js';
import { startCamera } from './camera.js';

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
const trayEl = document.getElementById('tray');
const scanInput = document.getElementById('scan-input');

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

document.getElementById('join-name').value = myName;
document.getElementById('join-btn').addEventListener('click', join);
document.getElementById('scan-btn').addEventListener('click', () => {
  submitCode(scanInput.value);
  scanInput.value = '';
  scanInput.focus();
});
scanInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  submitCode(scanInput.value);
  scanInput.value = '';
});
trayEl.addEventListener('change', onTrayChange);
document.getElementById('leave-btn').addEventListener('click', leave);

export async function submitCode(raw) {
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
      joinStatus.textContent = 'Sesi tidak ditemukan.';
      return;
    }
    if (shouldRejectExpiredJoin(meta.lastScanAt || meta.dibuat)) {
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
    startCam();
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
      showResult(`${hit.status} — ${hit.name || hit.codeProduct}`, classFor(hit.status));
      beep(hit.status === ST.MASUK ? 880 : 220);
    }
  }
  render();
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
  const rows = Object.values(esState.cloudHistory || {})
    .filter((v) => v && v.codeProduct)
    .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
    .slice(0, 40);
  logEl.innerHTML = rows.map((v) => (
    `<li>${esc(v.status)} · ${esc(v.codeProduct)} · ${esc(v.name || '-')} · ${esc(v.by || '')}</li>`
  )).join('');
}

function leave() {
  if (camHandle) {
    camHandle.stop();
    camHandle = null;
  }
  if (es) es.close();
  es = null;
  sessionId = null;
  joinScreen.hidden = false;
  scanScreen.hidden = true;
}

async function startCam() {
  const videoEl = document.getElementById('cam');
  const camStatus = document.getElementById('cam-status');
  camHandle = await startCamera({
    videoEl,
    onCode: submitCode,
    onDenied() {
      camStatus.textContent = 'Izinkan kamera, atau ketik kodenya';
    },
  });
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
