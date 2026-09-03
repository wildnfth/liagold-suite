import { fitJsQrFrame, clampZoom, readZoomCaps } from './lib/camera-tune.js';
import {
  cornersFromDetect,
  holdQrBox,
  overlayPoints,
  scaleFramePoint,
} from './lib/qr-overlay.js';

const FORMATS = ['qr_code', 'code_128', 'ean_13', 'code_39'];
const BOX_HOLD_MS = 800;

export async function startCamera({ videoEl, overlayEl, onCode, onDenied }) {
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
  const detector = ('BarcodeDetector' in window)
    ? new BarcodeDetector({ formats: FORMATS })
    : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const zoomCaps = readZoomCaps(typeof track.getCapabilities === 'function' ? track.getCapabilities() : {});

  function paintBox(corners) {
    if (!overlayEl) return;
    const svg = overlayEl.tagName === 'polygon' ? overlayEl.ownerSVGElement : overlayEl;
    const poly = overlayEl.tagName === 'polygon' ? overlayEl : overlayEl.querySelector('polygon');
    const viewW = videoEl.clientWidth;
    const viewH = videoEl.clientHeight;
    if (svg) {
      svg.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    }
    if (!poly) return;
    poly.setAttribute('points', corners
      ? overlayPoints(corners, {
        videoW: videoEl.videoWidth,
        videoH: videoEl.videoHeight,
        viewW,
        viewH,
      })
      : '');
  }

  function trackBox(corners, now) {
    boxLast = holdQrBox({ now, corners, last: boxLast, holdMs: BOX_HOLD_MS });
    paintBox(boxLast && boxLast.corners);
  }

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
        const hit = codes[0];
        trackBox(cornersFromDetect(hit), performance.now());
        if (running && hit && hit.rawValue) onCode(hit.rawValue);
      } else if (window.jsQR && videoEl.readyState >= 2) {
        const srcW = videoEl.videoWidth;
        const srcH = videoEl.videoHeight;
        const size = fitJsQrFrame(srcW, srcH, 480);
        let corners = null;
        let data = '';
        if (size.width && size.height) {
          canvas.width = size.width;
          canvas.height = size.height;
          ctx.drawImage(videoEl, 0, 0, size.width, size.height);
          const img = ctx.getImageData(0, 0, size.width, size.height);
          const hit = window.jsQR(img.data, img.width, img.height);
          if (hit) {
            data = hit.data || '';
            const raw = cornersFromDetect(hit);
            corners = raw
              ? raw.map((p) => scaleFramePoint({
                x: p.x,
                y: p.y,
                srcW,
                srcH,
                frameW: size.width,
                frameH: size.height,
              }))
              : null;
          }
        }
        trackBox(corners, performance.now());
        if (running && data) onCode(data);
      } else {
        trackBox(null, performance.now());
      }
    } catch (e) {
      trackBox(null, performance.now());
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
      paintBox(null);
      for (const t of stream.getTracks()) t.stop();
      videoEl.srcObject = null;
    },
  };
}
