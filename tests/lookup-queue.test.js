import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lookupKey, buildLookupEntry, pendingLookups } from '../lib/lookup-queue.js';

describe('lookupKey', () => {
  it('sanitizes code_time for Firebase paths', () => {
    assert.equal(lookupKey('ab/c', 't.1'), 'ab_c_t_1');
  });
});

describe('buildLookupEntry', () => {
  it('always starts pending', () => {
    assert.deepEqual(buildLookupEntry({ code: 'Aaa', by: 'Lia', time: 't1' }), {
      code: 'Aaa',
      by: 'Lia',
      time: 't1',
      state: 'pending',
    });
  });
});

describe('pendingLookups', () => {
  it('returns only pending entries with a code and ignores done', () => {
    const list = pendingLookups({
      k1: { code: 'A', by: 'P', time: 't', state: 'pending' },
      k2: { code: 'B', by: 'P', time: 't', state: 'done' },
      k3: { by: 'P', time: 't', state: 'pending' },
    });
    assert.equal(list.length, 1);
    assert.equal(list[0].key, 'k1');
    assert.equal(list[0].code, 'A');
    assert.deepEqual(pendingLookups(null), []);
  });
});
