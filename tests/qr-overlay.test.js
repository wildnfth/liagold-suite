import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapCoverPoint,
  scaleFramePoint,
  cornersFromDetect,
  holdQrBox,
  overlayPoints,
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
