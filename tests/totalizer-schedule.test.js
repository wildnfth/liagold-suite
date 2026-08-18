import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextProcessDelay } from '../lib/totalizer-schedule.js';

describe('nextProcessDelay', () => {
  it('runs immediately on first call', () => {
    assert.equal(nextProcessDelay(1000, 0, 500), 0);
  });

  it('returns remaining ms when inside the gap', () => {
    assert.equal(nextProcessDelay(1200, 1000, 500), 300);
  });

  it('runs immediately when the gap has elapsed', () => {
    assert.equal(nextProcessDelay(1600, 1000, 500), 0);
  });
});
