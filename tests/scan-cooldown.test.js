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

  it('treats the same letters in a different case as the same code', () => {
    assert.equal(shouldAcceptDetectedCode({
      code: 'lgl750g00006', lastCode: 'LGL750G00006', lastAt: 1000, now: 1500, cooldownMs: 2000,
    }), false);
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
    assert.equal(first.accept, true);
    assert.equal(first.code, 'AAA');
    assert.equal(first.lockedCode, 'aaa');
    const held = advanceCameraHold({
      values: ['AAA'], lockedCode: first.lockedCode, lastSeenAt: first.lastSeenAt, lastEmitAt: first.lastEmitAt, now: 1100,
    });
    assert.equal(held.accept, false);
    assert.equal(held.lockedCode, 'aaa');
  });

  it('ignores a second format while the locked code is still in the frame', () => {
    const held = advanceCameraHold({
      values: ['BBB', 'AAA'], lockedCode: 'aaa', lastSeenAt: 1000, lastEmitAt: 1000, now: 1200,
    });
    assert.equal(held.accept, false);
    assert.equal(held.lockedCode, 'aaa');
  });

  it('keeps the lock through brief empty detections', () => {
    const miss = advanceCameraHold({
      values: [], lockedCode: 'aaa', lastSeenAt: 1000, lastEmitAt: 1000, now: 1400, goneMs: 2500,
    });
    assert.equal(miss.accept, false);
    assert.equal(miss.lockedCode, 'aaa');
    const back = advanceCameraHold({
      values: ['AAA'], lockedCode: 'aaa', lastSeenAt: 1000, lastEmitAt: 1000, now: 1500, goneMs: 2500,
    });
    assert.equal(back.accept, false);
    assert.equal(back.lockedCode, 'aaa');
  });

  it('does not switch to another code until the locked one has been gone', () => {
    const early = advanceCameraHold({
      values: ['BBB'], lockedCode: 'aaa', lastSeenAt: 1000, lastEmitAt: 1000, now: 2000, goneMs: 2500, emitGapMs: 2500,
    });
    assert.equal(early.accept, false);
    assert.equal(early.lockedCode, 'aaa');
    const next = advanceCameraHold({
      values: ['BBB'], lockedCode: 'aaa', lastSeenAt: 1000, lastEmitAt: 1000, now: 3600, goneMs: 2500, emitGapMs: 2500,
    });
    assert.equal(next.accept, true);
    assert.equal(next.code, 'BBB');
    assert.equal(next.lockedCode, 'bbb');
  });

  it('unlocks without emitting after a long empty gap', () => {
    const gone = advanceCameraHold({
      values: [], lockedCode: 'aaa', lastSeenAt: 1000, lastEmitAt: 1000, now: 3600, goneMs: 2500,
    });
    assert.equal(gone.accept, false);
    assert.equal(gone.lockedCode, null);
  });

  it('blocks every code during the emit gap even after unlock', () => {
    const blocked = advanceCameraHold({
      values: ['BBB'], lockedCode: null, lastSeenAt: null, lastEmitAt: 1000, now: 2000, emitGapMs: 2500,
    });
    assert.equal(blocked.accept, false);
  });
});
