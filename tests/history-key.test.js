import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeKey, generateHistoryKey } from '../lib/history-key.js';

describe('sanitizeKey', () => {
  it('replaces Firebase-illegal characters', () => {
    assert.equal(sanitizeKey('a.b#c$d[e]f/g'), 'a_b_c_d_e_f_g');
  });
});

describe('generateHistoryKey', () => {
  it('is deterministic for the same code + timestamp', () => {
    const a = generateHistoryKey('ABC-1', '2026-08-18T12:00:00.000Z');
    const b = generateHistoryKey('ABC-1', '2026-08-18T12:00:00.000Z');
    assert.equal(a, b);
  });

  it('lowercases the product code', () => {
    const a = generateHistoryKey('AbC', '2026-08-18T12:00:00.000Z');
    const b = generateHistoryKey('abc', '2026-08-18T12:00:00.000Z');
    assert.equal(a, b);
  });

  it('differs when timestamp differs', () => {
    const a = generateHistoryKey('abc', '2026-08-18T12:00:00.000Z');
    const b = generateHistoryKey('abc', '2026-08-18T12:00:01.000Z');
    assert.notEqual(a, b);
  });

  it('does not contain a random suffix', () => {
    const key = generateHistoryKey('sku1', '2026-08-18T12:00:00.000Z');
    assert.equal(key, sanitizeKey('sku1_2026-08-18T12:00:00.000Z'));
  });

  it('migrate idempotency: existingKeys.has(key) is true on second generate', () => {
    const existing = new Set();
    const key1 = generateHistoryKey('sku1', '2026-08-18T12:00:00.000Z');
    existing.add(key1);
    const key2 = generateHistoryKey('sku1', '2026-08-18T12:00:00.000Z');
    assert.equal(existing.has(key2), true);
  });
});
