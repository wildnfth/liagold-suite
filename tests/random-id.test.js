import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBase36 } from '../lib/random-id.js';

describe('randomBase36', () => {
  it('returns the requested length of base36 chars', () => {
    const id = randomBase36(8);
    assert.equal(id.length, 8);
    assert.match(id, /^[0-9a-z]{8}$/);
  });

  it('differs across calls', () => {
    const a = randomBase36(8);
    const b = randomBase36(8);
    assert.notEqual(a, b);
  });
});
