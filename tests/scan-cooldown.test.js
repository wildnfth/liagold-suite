import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldAcceptDetectedCode } from '../lib/scan-cooldown.js';

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
