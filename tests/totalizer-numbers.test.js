import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findNumberHits } from '../lib/totalizer-numbers.js';

describe('findNumberHits long', () => {
  it('keeps an unformatted integer as one token', () => {
    assert.deepEqual(findNumberHits('1500000', 'long'), [{ v: '1500000', i: 0 }]);
  });

  it('keeps id-ID formatted money as one token', () => {
    assert.deepEqual(findNumberHits('1.500.000', 'long'), [{ v: '1.500.000', i: 0 }]);
    assert.deepEqual(findNumberHits('1.500.000,00', 'long'), [{ v: '1.500.000,00', i: 0 }]);
  });

  it('keeps a short integer and a decimal', () => {
    assert.deepEqual(findNumberHits('100', 'long'), [{ v: '100', i: 0 }]);
    assert.deepEqual(findNumberHits('12,50', 'long'), [{ v: '12,50', i: 0 }]);
  });

  it('finds two amounts in one string', () => {
    const hits = findNumberHits('Rp 1.500.000 dan 2000000', 'long');
    assert.deepEqual(hits.map((h) => h.v), ['1.500.000', '2000000']);
  });
});

describe('findNumberHits strict', () => {
  it('matches grouped thousands only', () => {
    assert.deepEqual(findNumberHits('1.500.000', 'strict'), [{ v: '1.500.000', i: 0 }]);
    assert.deepEqual(findNumberHits('1500000', 'strict'), []);
    assert.deepEqual(findNumberHits('2024', 'strict'), []);
  });
});
