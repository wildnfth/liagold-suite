import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startCamera } from '../mobile/camera.js';

function makeListenerStore() {
  const map = new Map();
  return {
    addEventListener(type, fn) {
      if (!map.has(type)) map.set(type, []);
      map.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      map.set(type, (map.get(type) || []).filter((f) => f !== fn));
    },
    fire(type, event = {}) {
      for (const fn of map.get(type) || []) fn({ preventDefault() {}, ...event });
    },
  };
}

function makeEl(tagName, extra = {}) {
  return { tagName, hidden: false, textContent: '', style: {}, ...makeListenerStore(), ...extra };
}

const CORNERS = [
  { x: 10, y: 10 },
  { x: 50, y: 10 },
  { x: 50, y: 50 },
  { x: 10, y: 50 },
];

function stubGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
  });
}

function installBrowserStubs() {
  const track = { applyConstraints: async () => {}, getCapabilities: () => ({}) };
  const stream = { getVideoTracks: () => [track], getTracks: () => [] };
  stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => stream },
  });
  class FakeDetector {
    constructor() {}
    async detect() {
      return [{ rawValue: 'QR-CODE-1', cornerPoints: CORNERS }];
    }
  }
  stubGlobal('BarcodeDetector', FakeDetector);
  stubGlobal('window', { BarcodeDetector: FakeDetector });
  stubGlobal('document', {
    hidden: false,
    createElement: () => ({ getContext: () => ({}) }),
  });
  let scheduled = 0;
  stubGlobal('requestAnimationFrame', (cb) => {
    if (scheduled++ === 0) setTimeout(cb, 0);
    return 1;
  });
}

async function launch(onCode) {
  installBrowserStubs();
  const svg = { ...makeListenerStore(), setAttribute() {}, classList: { toggle() {} } };
  const poly = makeEl('polygon', {
    ownerSVGElement: svg,
    setAttribute() {},
  });
  const label = makeEl('button');
  const video = {
    srcObject: null,
    play: async () => {},
    clientWidth: 300,
    clientHeight: 200,
    videoWidth: 640,
    videoHeight: 480,
    readyState: 4,
  };
  const handle = await startCamera({
    videoEl: video,
    overlayEl: poly,
    labelEl: label,
    onCode,
    onDenied() {},
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { handle, svg, poly, label };
}

describe('camera tap-to-submit hit target', () => {
  let ctx;
  beforeEach(async () => {
    ctx = null;
  });

  it('does not submit when tapping the empty preview background', async (t) => {
    const seen = [];
    ctx = await launch((code) => seen.push(code));
    t.after(() => ctx.handle.stop());
    assert.equal(seen.length, 0, 'precondition: no auto-submit from detection');
    ctx.svg.fire('click');
    assert.deepEqual(seen, [], 'background tap must not submit the live code');
  });

  it('submits when tapping the QR polygon', async (t) => {
    const seen = [];
    ctx = await launch((code) => seen.push(code));
    t.after(() => ctx.handle.stop());
    ctx.poly.fire('click');
    assert.deepEqual(seen, ['QR-CODE-1']);
  });

  it('submits when tapping the code chip', async (t) => {
    const seen = [];
    ctx = await launch((code) => seen.push(code));
    t.after(() => ctx.handle.stop());
    ctx.label.fire('click');
    assert.deepEqual(seen, ['QR-CODE-1']);
  });
});
