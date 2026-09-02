import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickLatestScan } from '../lib/scan-latest.js';

describe('pickLatestScan', () => {
  it('returns the history row with the latest time', () => {
    const latest = pickLatestScan({
      a: { codeProduct: 'OLD', status: 'MASUK', time: '2026-09-02T10:00:00.000Z', name: 'A' },
      b: { codeProduct: 'NEW', status: 'SALAH BAKI', time: '2026-09-02T10:00:05.000Z', name: 'B' },
    });
    assert.equal(latest.codeProduct, 'NEW');
    assert.equal(latest.status, 'SALAH BAKI');
  });

  it('skips empty history and rows without a code', () => {
    assert.equal(pickLatestScan(null), null);
    assert.equal(pickLatestScan({ x: { status: 'MASUK' } }), null);
  });
});
