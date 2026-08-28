import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  randomBase36,
  SESSION_CODE_LENGTH,
  sessionCodePlaceholder,
  unbiasedBase36Index,
} from '../lib/random-id.js';

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

describe('sessionCodePlaceholder', () => {
  it('states the same length used to generate session codes', () => {
    assert.equal(SESSION_CODE_LENGTH, 8);
    assert.equal(sessionCodePlaceholder(), 'Kode sesi (8 karakter)');
  });
});

describe('unbiasedBase36Index', () => {
  it('rejects bytes that would bias modulo 36', () => {
    assert.equal(unbiasedBase36Index(0), 0);
    assert.equal(unbiasedBase36Index(35), 35);
    assert.equal(unbiasedBase36Index(251), 251 % 36);
    assert.equal(unbiasedBase36Index(252), null);
    assert.equal(unbiasedBase36Index(255), null);
  });
});
