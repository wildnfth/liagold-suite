import { fitJsQrFrame, clampZoom, readZoomCaps } from './lib/camera-tune.js';

const FORMATS = ['qr_code', 'code_128', 'ean_13', 'code_39'];

export async function startCamera({ videoEl, onCode, onDenied }) {
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
  const detector = ('BarcodeDetector' in window)
    ? new BarcodeDetector({ formats: FORMATS })
    : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const zoomCaps = readZoomCaps(typeof track.getCapabilities === 'function' ? track.getCapabilities() : {});

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
        if (running && codes[0] && codes[0].rawValue) onCode(codes[0].rawValue);
      } else if (window.jsQR && videoEl.readyState >= 2) {
        const srcW = videoEl.videoWidth;
        const srcH = videoEl.videoHeight;
        const size = fitJsQrFrame(srcW, srcH, 480);
        if (size.width && size.height) {
          canvas.width = size.width;
          canvas.height = size.height;
          ctx.drawImage(videoEl, 0, 0, size.width, size.height);
          const img = ctx.getImageData(0, 0, size.width, size.height);
          const hit = window.jsQR(img.data, img.width, img.height);
          if (running && hit && hit.data) onCode(hit.data);
        }
      }
    } catch (e) {}
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
      for (const t of stream.getTracks()) t.stop();
      videoEl.srcObject = null;
    },
  };
}
