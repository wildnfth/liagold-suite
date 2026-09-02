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
