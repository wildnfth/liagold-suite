import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planEsOnError, ES_CONNECTING, ES_CLOSED } from '../lib/es-reconnect.js';

describe('planEsOnError', () => {
  it('cancels a stacked timer and skips full fetch while EventSource is reconnecting', () => {
    const plan = planEsOnError({ readyState: ES_CONNECTING, failCount: 0 });
    assert.equal(plan.cancelPending, true);
    assert.equal(plan.scheduleSync, false);
    assert.equal(plan.recreate, false);
    assert.equal(plan.nextFailCount, 1);
  });

  it('schedules one full-tree sync only when EventSource is CLOSED', () => {
    const plan = planEsOnError({ readyState: ES_CLOSED, failCount: 0 });
    assert.equal(plan.cancelPending, true);
    assert.equal(plan.scheduleSync, true);
    assert.equal(plan.recreate, false);
  });

  it('recreates the listener after 5 closed errors', () => {
    const plan = planEsOnError({ readyState: ES_CLOSED, failCount: 4 });
    assert.equal(plan.scheduleSync, false);
    assert.equal(plan.recreate, true);
    assert.equal(plan.nextFailCount, 5);
  });
});
