export function fitJsQrFrame(srcW, srcH, maxEdge = 480) {
  const w = Number(srcW) || 0;
  const h = Number(srcH) || 0;
  const max = Number(maxEdge) || 480;
  if (w <= 0 || h <= 0) return { width: 0, height: 0 };
  const long = Math.max(w, h);
  if (long <= max) return { width: w, height: h };
  const scale = max / long;
  return {
    width: Math.round(w * scale),
    height: Math.round(h * scale),
  };
}

export function clampZoom(value, min, max) {
  const n = Number(value);
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(n) || !Number.isFinite(lo) || !Number.isFinite(hi)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export function readZoomCaps(caps) {
  const zoom = caps && caps.zoom;
  if (!zoom) return null;
  const min = Number(zoom.min);
  const max = Number(zoom.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  const step = Number(zoom.step);
  return {
    min,
    max,
    step: Number.isFinite(step) && step > 0 ? step : 0.1,
  };
}
