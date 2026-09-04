import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogPayload, withHostAt } from '../lib/catalog-sync.js';

const eventLog = [];
const fetchCalls = [];
const longTimers = [];
let esHandlers = null;

function stubGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
  });
}

function makeEl(id) {
  const listeners = new Map();
  const el = {
    __id: id,
    value: '',
    hidden: false,
    textContent: '',
    innerHTML: '',
    className: '',
    title: '',
    checked: true,
    tagName: 'div',
    style: {},
    dataset: {},
    clientWidth: 300,
    clientHeight: 200,
    videoWidth: 640,
    videoHeight: 480,
    readyState: 4,
    srcObject: null,
    min: '',
    max: '',
    step: '',
    oninput: null,
    classList: {
      add(...args) { eventLog.push({ el: id, method: 'classList.add', args }); },
      remove(...args) { eventLog.push({ el: id, method: 'classList.remove', args }); },
      toggle(...args) { eventLog.push({ el: id, method: 'classList.toggle', args }); },
      contains() { return false; },
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn));
    },
    fire(type, event = {}) {
      for (const fn of listeners.get(type) || []) return fn({ preventDefault() {}, ...event });
    },
    closest() { return null; },
    getAttribute() { return ''; },
    setAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {},
    focus() {},
    play: async () => {},
    getContext: () => ({}),
  };
  return el;
}

const els = new Map();
function elById(id) {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
}

const META_ISO = new Date().toISOString();

function installStubs() {
  const store = new Map();
  stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  });
  stubGlobal('fetch', async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    fetchCalls.push({ method, url: String(url), body: opts.body });
    const data = String(url).includes('/meta.json') && method === 'GET'
      ? { nama: 'Opname T', dibuat: META_ISO, lastScanAt: META_ISO }
      : {};
    return { ok: true, status: 200, json: async () => data };
  });
  stubGlobal('EventSource', class {
    constructor(url) {
      this.url = url;
      this.handlers = {};
      this.readyState = 0;
      esHandlers = this.handlers;
    }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    close() {}
  });
  const track = { applyConstraints: async () => {}, getCapabilities: () => ({}) };
  stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({
        getVideoTracks: () => [track],
        getTracks: () => [],
      }),
    },
    vibrate: (ms) => { eventLog.push({ el: 'navigator', method: 'vibrate', args: [ms] }); return true; },
  });
  stubGlobal('window', {
    BarcodeDetector: class {
      constructor() {}
      async detect() { return []; }
    },
  });
  stubGlobal('BarcodeDetector', globalThis.window.BarcodeDetector);
  stubGlobal('document', {
    hidden: false,
    createElement: () => makeEl('canvas'),
    getElementById: (id) => elById(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  });
  let rafs = 0;
  stubGlobal('requestAnimationFrame', (cb) => {
    if (rafs++ === 0) setTimeout(cb, 0);
    return 1;
  });
  const realSetTimeout = globalThis.setTimeout;
  stubGlobal('setTimeout', (fn, ms, ...args) => {
    const handle = realSetTimeout(fn, ms, ...args);
    if (Number(ms) >= 1000) longTimers.push(handle);
    return handle;
  });
}

function flashAdds() {
  return eventLog.filter((e) => e.el === 'cam-flash' && e.method === 'classList.add').length;
}

function vibrateCalls() {
  return eventLog.filter((e) => e.el === 'navigator' && e.method === 'vibrate').length;
}

function lookupsPuts() {
  return fetchCalls.filter((c) => c.method === 'PUT' && c.url.includes('/lookups/')).length;
}

function historyPuts() {
  return fetchCalls.filter((c) => c.method === 'PUT' && c.url.includes('/history/')).length;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let submitCode;

describe('submitCode hit feedback', () => {
  before(async () => {
    installStubs();
    ({ submitCode } = await import('../mobile/app.js'));
    elById('join-name').value = 'Tester';
    elById('join-code').value = 'TESTSESI';
    elById('join-btn').fire('click');
    await sleep(80);
    const iso = new Date().toISOString();
    const catalog = withHostAt(
      buildCatalogPayload({
        trays: [{ trayId: '14', trayCode: 'B14', count: 1 }],
        selectedTray: '14',
        selectedTrayCode: 'B14',
        products: [{
          codeProduct: 'PC1', code: 'C1', name: 'Emas', weight: 5, image: '', trayId: '14', trayCode: 'B14',
        }],
        now: iso,
      }),
      iso,
    );
    esHandlers.put({
      data: JSON.stringify({ path: '/', data: { catalog, cloudHistory: {}, peserta: {}, dupes: {}, meta: { lastScanAt: iso } } }),
    });
    await sleep(20);
  });

  after(() => {
    for (const handle of longTimers) clearTimeout(handle);
  });

  it('does not flash or vibrate for a lookup-sold code', async () => {
    const flashBefore = flashAdds();
    const vibeBefore = vibrateCalls();
    await submitCode('UNKNOWN-XYZ');
    assert.match(elById('result').textContent, /Mengecek/);
    assert.equal(lookupsPuts(), 1);
    assert.equal(flashAdds(), flashBefore, 'lookup path must not signal success');
    assert.equal(vibrateCalls(), vibeBefore, 'lookup path must not vibrate');
  });

  it('flashes and vibrates for an accepted MASUK scan', async () => {
    const flashBefore = flashAdds();
    const vibeBefore = vibrateCalls();
    await submitCode('PC1');
    assert.match(elById('result').textContent, /MASUK/);
    assert.equal(historyPuts(), 1);
    assert.equal(flashAdds(), flashBefore + 1);
    assert.equal(vibrateCalls(), vibeBefore + 1);
  });
});
