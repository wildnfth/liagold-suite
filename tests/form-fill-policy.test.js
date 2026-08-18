import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FORM_CODE_ATTEMPTS, recordFormAttempt } from '../lib/form-fill-policy.js';

describe('recordFormAttempt', () => {
  it('marks filled and clears attempts on success', () => {
    const attempts = new Map([['sku1', 2]]);
    const r = recordFormAttempt(attempts, 'SKU1', true);
    assert.deepEqual(r, { markFilled: true, retry: false, giveUp: false });
    assert.equal(attempts.has('sku1'), false);
  });

  it('retries on first failure and does not mark filled', () => {
    const attempts = new Map();
    const r = recordFormAttempt(attempts, 'abc', false);
    assert.deepEqual(r, { markFilled: false, retry: true, giveUp: false });
    assert.equal(attempts.get('abc'), 1);
  });

  it('gives up after MAX_FORM_CODE_ATTEMPTS failures', () => {
    const attempts = new Map();
    let last;
    for (let i = 0; i < MAX_FORM_CODE_ATTEMPTS; i++) {
      last = recordFormAttempt(attempts, 'x', false);
    }
    assert.deepEqual(last, { markFilled: false, retry: false, giveUp: true });
    assert.equal(attempts.get('x'), MAX_FORM_CODE_ATTEMPTS);
  });

  it('does not mark filled when giving up', () => {
    const attempts = new Map([['y', MAX_FORM_CODE_ATTEMPTS - 1]]);
    const r = recordFormAttempt(attempts, 'Y', false);
    assert.equal(r.markFilled, false);
    assert.equal(r.giveUp, true);
  });
});
