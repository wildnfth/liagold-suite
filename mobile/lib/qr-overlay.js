export function mapCoverPoint({ x, y, videoW, videoH, viewW, viewH } = {}) {
  const vw = Number(videoW) || 0;
  const vh = Number(videoH) || 0;
  const ow = Number(viewW) || 0;
  const oh = Number(viewH) || 0;
  if (!vw || !vh || !ow || !oh) return { x: 0, y: 0 };
  const scale = Math.max(ow / vw, oh / vh);
  return {
    x: Number(x) * scale + (ow - vw * scale) / 2,
    y: Number(y) * scale + (oh - vh * scale) / 2,
  };
}

export function scaleFramePoint({ x, y, srcW, srcH, frameW, frameH } = {}) {
  const fw = Number(frameW) || 0;
  const fh = Number(frameH) || 0;
  return {
    x: fw ? (Number(x) * (Number(srcW) || 0)) / fw : 0,
    y: fh ? (Number(y) * (Number(srcH) || 0)) / fh : 0,
  };
}

function point(p) {
  if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) return null;
  return { x: Number(p.x), y: Number(p.y) };
}

function four(a, b, c, d) {
  const pts = [point(a), point(b), point(c), point(d)];
  return pts.every(Boolean) ? pts : null;
}

export function cornersFromDetect(hit) {
  if (!hit || typeof hit !== 'object') return null;
  const corners = hit.cornerPoints;
  if (Array.isArray(corners) && corners.length >= 4) {
    return four(corners[0], corners[1], corners[2], corners[3]);
  }
  const b = hit.boundingBox;
  if (b && Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.width))) {
    const x = Number(b.x);
    const y = Number(b.y);
    const w = Number(b.width);
    const h = Number(b.height);
    return four(
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    );
  }
  const loc = hit.location;
  if (loc) {
    return four(
      loc.topLeftCorner,
      loc.topRightCorner,
      loc.bottomRightCorner,
      loc.bottomLeftCorner,
    );
  }
  return null;
}

export function holdQrBox({ now, corners, last, holdMs = 800 } = {}) {
  if (corners && corners.length >= 4) {
    return { corners, lastAt: now };
  }
  if (last && last.corners && Number(now) - Number(last.lastAt) <= Number(holdMs)) {
    return last;
  }
  return null;
}

export function overlayPoints(corners, view = {}) {
  if (!corners || !corners.length) return '';
  return corners.map((c) => {
    const p = mapCoverPoint({
      x: c.x,
      y: c.y,
      videoW: view.videoW,
      videoH: view.videoH,
      viewW: view.viewW,
      viewH: view.viewH,
    });
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');
}

export function matchCorners(prev, next) {
  if (!next || !next.length) return null;
  if (!prev || prev.length !== next.length) return next;
  const used = new Set();
  return prev.map((p) => {
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < next.length; i++) {
      if (used.has(i)) continue;
      const dx = next[i].x - p.x;
      const dy = next[i].y - p.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    used.add(bestI);
    return next[bestI];
  });
}

export function smoothQrCorners({ prev, next, alpha = 0.82, deadzone = 7 } = {}) {
  if (!next || next.length < 4) return prev || null;
  if (!prev || prev.length !== next.length) return next;
  const aligned = matchCorners(prev, next);
  const dz2 = Number(deadzone) * Number(deadzone);
  const a = Number(alpha);
  return prev.map((p, i) => {
    const n = aligned[i];
    const dx = n.x - p.x;
    const dy = n.y - p.y;
    if (dx * dx + dy * dy <= dz2) return p;
    return {
      x: p.x * a + n.x * (1 - a),
      y: p.y * a + n.y * (1 - a),
    };
  });
}
