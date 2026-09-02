import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitJsQrFrame, clampZoom, readZoomCaps } from '../lib/camera-tune.js';

describe('fitJsQrFrame', () => {
  it('scales the long edge down to max and keeps aspect', () => {
    assert.deepEqual(fitJsQrFrame(1920, 1080, 480), { width: 480, height: 270 });
  });

  it('leaves a small frame alone', () => {
    assert.deepEqual(fitJsQrFrame(200, 200, 480), { width: 200, height: 200 });
  });
});

describe('clampZoom', () => {
  it('clamps into [min, max]', () => {
    assert.equal(clampZoom(1.5, 1, 3), 1.5);
    assert.equal(clampZoom(0, 1, 3), 1);
    assert.equal(clampZoom(9, 1, 3), 3);
  });
});

describe('readZoomCaps', () => {
  it('returns min/max/step when zoom has a range', () => {
    assert.deepEqual(readZoomCaps({ zoom: { min: 1, max: 5, step: 0.1 } }), {
      min: 1,
      max: 5,
      step: 0.1,
    });
  });

  it('returns null when zoom is missing or has no range', () => {
    assert.equal(readZoomCaps({}), null);
    assert.equal(readZoomCaps({ zoom: { min: 1, max: 1 } }), null);
    assert.equal(readZoomCaps(null), null);
  });
});
