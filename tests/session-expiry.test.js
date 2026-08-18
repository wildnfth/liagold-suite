import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA_TTL_MS,
  parseTimestamp,
  getRemainingTime,
  isDataExpired,
} from '../lib/session-expiry.js';

const TTL = DATA_TTL_MS;
const NOW = Date.parse('2026-08-18T12:00:00.000Z');

describe('parseTimestamp', () => {
  it('returns null for null, undefined, empty, and garbage', () => {
    assert.equal(parseTimestamp(null), null);
    assert.equal(parseTimestamp(undefined), null);
    assert.equal(parseTimestamp(''), null);
    assert.equal(parseTimestamp('not-a-date'), null);
  });

  it('parses ISO strings', () => {
    assert.equal(parseTimestamp('2026-08-18T12:00:00.000Z'), NOW);
  });
});

describe('getRemainingTime', () => {
  it('returns null when lastScanAt is missing (unknown, not zero)', () => {
    assert.equal(getRemainingTime(null, NOW, TTL), null);
    assert.equal(getRemainingTime('', NOW, TTL), null);
  });

  it('returns remaining ms when still valid', () => {
    const last = new Date(NOW - 60 * 60 * 1000).toISOString();
    assert.equal(getRemainingTime(last, NOW, TTL), TTL - 60 * 60 * 1000);
  });

  it('returns 0 when older than TTL', () => {
    const last = new Date(NOW - TTL - 1).toISOString();
    assert.equal(getRemainingTime(last, NOW, TTL), 0);
  });
});

describe('isDataExpired', () => {
  it('is false when lastScanAt is unknown', () => {
    assert.equal(isDataExpired(null, NOW, TTL), false);
    assert.equal(isDataExpired(undefined, NOW, TTL), false);
    assert.equal(isDataExpired('', NOW, TTL), false);
  });

  it('is false when within TTL', () => {
    const last = new Date(NOW - 1000).toISOString();
    assert.equal(isDataExpired(last, NOW, TTL), false);
  });

  it('is true only when timestamp is known and older than TTL', () => {
    const last = new Date(NOW - TTL - 1).toISOString();
    assert.equal(isDataExpired(last, NOW, TTL), true);
  });
});
