import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePendingQueue } from '../lib/pending-queue.js';

describe('parsePendingQueue', () => {
  it('returns empty for missing or corrupt data', () => {
    assert.deepEqual(parsePendingQueue(null), []);
    assert.deepEqual(parsePendingQueue('{'), []);
    assert.deepEqual(parsePendingQueue('{}'), []);
  });

  it('keeps objects that have codeProduct', () => {
    const raw = JSON.stringify([
      { codeProduct: 'A', status: 'MASUK' },
      { status: 'MASUK' },
      null,
    ]);
    assert.deepEqual(parsePendingQueue(raw), [{ codeProduct: 'A', status: 'MASUK' }]);
  });
});
