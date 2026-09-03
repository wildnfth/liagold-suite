import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldAcceptDetectedCode, shouldPauseCameraCode, advanceCameraHold } from '../lib/scan-cooldown.js';

describe('shouldAcceptDetectedCode', () => {
  it('rejects empty and accepts the first code', () => {
    assert.equal(shouldAcceptDetectedCode({ code: '  ', now: 1000 }), false);
    assert.equal(shouldAcceptDetectedCode({ code: 'AAA', lastCode: null, lastAt: 0, now: 1000 }), true);
  });

  it('rejects the same code inside 2s and accepts after cooldown or a different code', () => {
    assert.equal(shouldAcceptDetectedCode({
      code: 'AAA', lastCode: 'AAA', lastAt: 1000, now: 2500, cooldownMs: 2000,
    }), false);
    assert.equal(shouldAcceptDetectedCode({
      code: 'AAA', lastCode: 'AAA', lastAt: 1000, now: 3000, cooldownMs: 2000,
    }), true);
    assert.equal(shouldAcceptDetectedCode({
      code: 'BBB', lastCode: 'AAA', lastAt: 1000, now: 1100, cooldownMs: 2000,
    }), true);
  });
});

describe('shouldPauseCameraCode', () => {
  it('accepts when nothing is locked and locks nothing itself', () => {
    assert.deepEqual(shouldPauseCameraCode({ code: 'AAA', lockedCode: null, now: 1000 }), { accept: true });
    assert.deepEqual(shouldPauseCameraCode({ code: '  ', lockedCode: 'AAA', now: 1000 }), { accept: false });
  });

  it('drops the same code until the resume time, then accepts again', () => {
    assert.deepEqual(shouldPauseCameraCode({
      code: 'AAA', lockedCode: 'AAA', now: 1500, resumedAt: 4000,
    }), { accept: false });
    assert.deepEqual(shouldPauseCameraCode({
      code: 'AAA', lockedCode: 'AAA', now: 4000, resumedAt: 4000,
    }), { accept: true });
  });

  it('a different code clears the lock immediately', () => {
    assert.deepEqual(shouldPauseCameraCode({
      code: 'BBB', lockedCode: 'AAA', now: 1500, resumedAt: 9999,
    }), { accept: true, clearLock: true });
  });

  it('without a resume time the same code stays locked until a different code', () => {
    assert.deepEqual(shouldPauseCameraCode({
      code: 'AAA', lockedCode: 'AAA', now: 99999,
    }), { accept: false });
    assert.deepEqual(shouldPauseCameraCode({
      code: 'BBB', lockedCode: 'AAA', now: 99999,
    }), { accept: true, clearLock: true });
  });
});

describe('advanceCameraHold', () => {
  it('emits the first code and then ignores it while it stays in frame', () => {
    const first = advanceCameraHold({ values: ['AAA'], lockedCode: null, now: 1000 });
    assert.deepEqual(first, { accept: true, code: 'AAA', lockedCode: 'AAA', lastSeenAt: 1000 });
    const held = advanceCameraHold({
      values: ['AAA'], lockedCode: first.lockedCode, lastSeenAt: first.lastSeenAt, now: 1100,
    });
    assert.equal(held.accept, false);
    assert.equal(held.lockedCode, 'AAA');
  });

  it('ignores a second format while the locked code is still in the frame', () => {
    const held = advanceCameraHold({
      values: ['BBB', 'AAA'], lockedCode: 'AAA', lastSeenAt: 1000, now: 1200,
    });
    assert.equal(held.accept, false);
    assert.equal(held.lockedCode, 'AAA');
  });

  it('does not switch to another code until the locked one has been gone', () => {
    const early = advanceCameraHold({
      values: ['BBB'], lockedCode: 'AAA', lastSeenAt: 1000, now: 1300, goneMs: 500,
    });
    assert.equal(early.accept, false);
    assert.equal(early.lockedCode, 'AAA');
    const next = advanceCameraHold({
      values: ['BBB'], lockedCode: 'AAA', lastSeenAt: 1000, now: 1600, goneMs: 500,
    });
    assert.deepEqual(next, { accept: true, code: 'BBB', lockedCode: 'BBB', lastSeenAt: 1600 });
  });

  it('unlocks without emitting after the locked code leaves an empty frame', () => {
    const gone = advanceCameraHold({
      values: [], lockedCode: 'AAA', lastSeenAt: 1000, now: 1600, goneMs: 500,
    });
    assert.deepEqual(gone, { accept: false, code: null, lockedCode: null, lastSeenAt: null });
  });
});
