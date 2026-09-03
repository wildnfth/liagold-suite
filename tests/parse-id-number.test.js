import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseIdNumber } from '../lib/parse-id-number.js';

const cases = [
  ['1500000', 1500000],
  ['1.500.000', 1500000],
  ['1.500.000,00', 1500000],
  ['1.234,56', 1234.56],
  ['1234,56', 1234.56],
  ['12,50', 12.5],
  ['1.500', 1500],
  ['12.5', 12.5],
  ['12.50', 12.5],
  ['1,500,000', 1500000],
  ['389,000', 389000],
  ['1,234,567.89', 1234567.89],
  ['1,5', 1.5],
  ['-1.500.000', -1500000],
  ['−12,50', -12.5],
  ['Rp 1.500.000', 1500000],
  ['1.500.000 gr', 1500000],
  ['', 0],
  [null, 0],
  [undefined, 0],
  [1500000, 1500000],
  [1.5, 1.5],
  [NaN, 0],
];

describe('parseIdNumber', () => {
  for (const [input, expected] of cases) {
    it(`${String(input)} → ${expected}`, () => {
      assert.equal(parseIdNumber(input), expected);
    });
  }
});
