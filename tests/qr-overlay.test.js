import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapCoverPoint,
  scaleFramePoint,
  cornersFromDetect,
  holdQrBox,
  overlayPoints,
  matchCorners,
  smoothQrCorners,
} from '../lib/qr-overlay.js';

describe('mapCoverPoint', () => {
  it('maps the video center to the view center under object-fit cover', () => {
    const p = mapCoverPoint({
      x: 960,
      y: 540,
      videoW: 1920,
      videoH: 1080,
      viewW: 400,
      viewH: 400,
    });
    assert.equal(Math.round(p.x), 200);
    assert.equal(Math.round(p.y), 200);
  });
});

describe('scaleFramePoint', () => {
  it('scales jsQR canvas coords back to video pixels', () => {
    assert.deepEqual(scaleFramePoint({
      x: 240,
      y: 135,
      srcW: 1920,
      srcH: 1080,
      frameW: 480,
      frameH: 270,
    }), { x: 960, y: 540 });
  });
});

describe('cornersFromDetect', () => {
  it('prefers BarcodeDetector cornerPoints', () => {
    assert.deepEqual(cornersFromDetect({
      cornerPoints: [
        { x: 1, y: 2 },
        { x: 3, y: 2 },
        { x: 3, y: 4 },
        { x: 1, y: 4 },
      ],
      rawValue: 'ABC',
    }), [
      { x: 1, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 4 },
      { x: 1, y: 4 },
    ]);
  });

  it('orders a TL/TR/BL/BR detector list into a non-crossing ring', () => {
    const out = cornersFromDetect({
      cornerPoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
      ],
    });
    assert.equal(isBowtie(out), false);
  });

  it('falls back to boundingBox, then jsQR location', () => {
    assert.deepEqual(cornersFromDetect({
      boundingBox: { x: 10, y: 20, width: 30, height: 40 },
    }), [
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 },
    ]);
    assert.deepEqual(cornersFromDetect({
      location: {
        topLeftCorner: { x: 1, y: 1 },
        topRightCorner: { x: 2, y: 1 },
        bottomRightCorner: { x: 2, y: 2 },
        bottomLeftCorner: { x: 1, y: 2 },
      },
    }), [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ]);
  });

  it('returns null without geometry', () => {
    assert.equal(cornersFromDetect(null), null);
    assert.equal(cornersFromDetect({ rawValue: 'X' }), null);
  });
});

describe('holdQrBox', () => {
  const box = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }];

  it('keeps a live detection and holds it through a short miss', () => {
    const live = holdQrBox({ now: 1000, corners: box, last: null, holdMs: 450 });
    assert.deepEqual(live.corners, box);
    assert.equal(live.lastAt, 1000);
    const held = holdQrBox({ now: 1300, corners: null, last: live, holdMs: 450 });
    assert.deepEqual(held.corners, box);
  });

  it('drops the box after the hold window', () => {
    const live = holdQrBox({ now: 1000, corners: box, last: null, holdMs: 450 });
    assert.equal(holdQrBox({ now: 1500, corners: null, last: live, holdMs: 450 }), null);
  });
});

describe('overlayPoints', () => {
  it('joins mapped corners into an SVG points string', () => {
    const pts = overlayPoints(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      { videoW: 100, videoH: 100, viewW: 50, viewH: 50 },
    );
    assert.equal(pts, '0.0,0.0 50.0,0.0 50.0,50.0 0.0,50.0');
  });
});

describe('matchCorners', () => {
  it('reorders the next quad to the previous corner order', () => {
    const prev = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const next = [
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    assert.deepEqual(matchCorners(prev, next), prev);
  });
});

describe('smoothQrCorners', () => {
  const prev = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it('ignores sub-deadzone jitter', () => {
    const jitter = prev.map((p) => ({ x: p.x + 2, y: p.y + 1 }));
    assert.deepEqual(smoothQrCorners({ prev, next: jitter, deadzone: 5 }), prev);
  });

  it('eases toward a real move instead of snapping', () => {
    const moved = prev.map((p) => ({ x: p.x + 40, y: p.y }));
    const out = smoothQrCorners({ prev, next: moved, alpha: 0.75, deadzone: 5 });
    assert.equal(out[0].x, 10);
    assert.equal(out[0].y, 0);
    assert.equal(out[1].x, 110);
  });

  it('clears the box when detection is gone', () => {
    assert.equal(smoothQrCorners({ prev, next: null }), null);
  });
});

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segsIntersect(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function isBowtie(pts) {
  if (!pts || pts.length !== 4) return true;
  return segsIntersect(pts[0], pts[1], pts[2], pts[3])
    || segsIntersect(pts[1], pts[2], pts[3], pts[0]);
}

