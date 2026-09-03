import { fitJsQrFrame, clampZoom, readZoomCaps } from './lib/camera-tune.js';
import {
  cornersFromDetect,
  holdQrBox,
  mapCoverPoint,
  scaleFramePoint,
  smoothQrCorners,
  pickPrimaryDetect,
  quadCentroid,
} from './lib/qr-overlay.js';

const FORMATS = ['qr_code', 'code_128', 'ean_13', 'code_39'];
const BOX_HOLD_MS = 180;

export async function startCamera({ videoEl, overlayEl, labelEl, onCode, onDenied }) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
    });
  } catch (e) {
    onDenied();
    return { stop() {}, setZoom() {}, zoomCaps: null };
  }
  const track = stream.getVideoTracks()[0];
  try {
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch (e) {}
  videoEl.srcObject = stream;
  await videoEl.play();
  let running = true;
  let busy = false;
  let boxLast = null;
  let boxShown = null;
  let liveCode = '';
  const detector = ('BarcodeDetector' in window)
    ? new BarcodeDetector({ formats: FORMATS })
    : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const zoomCaps = readZoomCaps(typeof track.getCapabilities === 'function' ? track.getCapabilities() : {});

  function overlaySvg() {
    if (!overlayEl) return null;
    return overlayEl.tagName === 'polygon' || overlayEl.tagName === 'POLYGON'
      ? overlayEl.ownerSVGElement
      : overlayEl;
  }

  function paintBox(corners) {
    if (!overlayEl) return;
    const svg = overlaySvg();
    const poly = overlayEl.tagName === 'polygon' || overlayEl.tagName === 'POLYGON'
      ? overlayEl
      : overlayEl.querySelector('polygon');
    const viewW = videoEl.clientWidth;
    const viewH = videoEl.clientHeight;
    if (svg) {
      svg.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
      svg.classList.toggle('has-hit', Boolean(corners && corners.length));
    }
    if (!poly) return;
    poly.setAttribute('points', corners && corners.length
      ? corners.map((p) => `${Number(p.x).toFixed(1)},${Number(p.y).toFixed(1)}`).join(' ')
      : '');
  }

  function paintLabel(code, corners) {
    if (!labelEl) return;
    if (!code || !corners || !corners.length) {
      labelEl.hidden = true;
      labelEl.textContent = '';
      return;
    }
    const c = quadCentroid(corners);
    labelEl.hidden = false;
    labelEl.textContent = code;
    labelEl.style.left = `${c.x}px`;
    labelEl.style.top = `${c.y}px`;
  }

  function viewCorners(corners) {
    if (!corners) return null;
    const videoW = videoEl.videoWidth;
    const videoH = videoEl.videoHeight;
    const viewW = videoEl.clientWidth;
    const viewH = videoEl.clientHeight;
    return corners.map((c) => mapCoverPoint({
      x: c.x,
      y: c.y,
      videoW,
      videoH,
      viewW,
      viewH,
    }));
  }

  function trackTarget(picked, now) {
    const corners = picked && picked.corners;
    boxLast = holdQrBox({ now, corners, last: boxLast, holdMs: BOX_HOLD_MS });
    if (picked && picked.code) liveCode = picked.code;
    else if (!boxLast) liveCode = '';
    const next = boxLast ? viewCorners(boxLast.corners) : null;
    boxShown = smoothQrCorners({
      prev: boxShown,
      next,
      alpha: 0.85,
      deadzone: 8,
    });
    paintBox(boxShown);
    paintLabel(liveCode, boxShown);
  }

  function tap(e) {
    if (e) e.preventDefault();
    const code = liveCode;
    if (running && code) onCode(code);
  }

  if (labelEl) labelEl.addEventListener('click', tap);
  const svg = overlaySvg();
  if (svg) svg.addEventListener('click', tap);

  async function tick() {
    if (!running) return;
    if (document.hidden || busy) {
      requestAnimationFrame(tick);
      return;
    }
    busy = true;
    try {
      if (detector) {
        const codes = await detector.detect(videoEl);
        const picked = pickPrimaryDetect(codes, { prefer: liveCode });
        trackTarget(picked, performance.now());
      } else if (window.jsQR && videoEl.readyState >= 2) {
        const srcW = videoEl.videoWidth;
        const srcH = videoEl.videoHeight;
        const size = fitJsQrFrame(srcW, srcH, 480);
        let picked = null;
        if (size.width && size.height) {
          canvas.width = size.width;
          canvas.height = size.height;
          ctx.drawImage(videoEl, 0, 0, size.width, size.height);
          const img = ctx.getImageData(0, 0, size.width, size.height);
          const hit = window.jsQR(img.data, img.width, img.height);
          if (hit) {
            const raw = pickPrimaryDetect([hit]);
            if (raw) {
              picked = {
                code: raw.code,
                corners: raw.corners.map((p) => scaleFramePoint({
                  x: p.x,
                  y: p.y,
                  srcW,
                  srcH,
                  frameW: size.width,
                  frameH: size.height,
                })),
              };
            }
          }
        }
        trackTarget(picked, performance.now());
      } else {
        trackTarget(null, performance.now());
      }
    } catch (e) {
      trackTarget(null, performance.now());
    }
    busy = false;
    if (running) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  return {
    zoomCaps,
    async setZoom(value) {
      if (!zoomCaps) return;
      const z = clampZoom(value, zoomCaps.min, zoomCaps.max);
      try {
        await track.applyConstraints({ advanced: [{ zoom: z }] });
      } catch (e) {}
    },
    stop() {
      running = false;
      boxLast = null;
      boxShown = null;
      liveCode = '';
      paintBox(null);
      paintLabel('', null);
      if (labelEl) labelEl.removeEventListener('click', tap);
      if (svg) svg.removeEventListener('click', tap);
      for (const t of stream.getTracks()) t.stop();
      videoEl.srcObject = null;
    },
  };
}
