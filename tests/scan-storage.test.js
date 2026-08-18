import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArrayJson, scannedCodesFromLog } from '../lib/scan-storage.js';

describe('parseArrayJson', () => {
  it('returns fallback for missing, corrupt, and non-array JSON', () => {
    assert.deepEqual(parseArrayJson(null, []), []);
    assert.deepEqual(parseArrayJson('{', ['x']), ['x']);
    assert.deepEqual(parseArrayJson('{}', []), []);
    assert.deepEqual(parseArrayJson('null', []), []);
    assert.deepEqual(parseArrayJson('"nope"', []), []);
  });

  it('returns a parsed array', () => {
    assert.deepEqual(parseArrayJson('[1,2]', []), [1, 2]);
  });
});

describe('scannedCodesFromLog', () => {
  it('keeps unique MASUK codes, lowercased', () => {
    const codes = scannedCodesFromLog([
      { status: 'MASUK', codeProduct: 'AbC' },
      { status: 'MASUK', codeProduct: 'abc' },
      { status: 'SALAH BAKI', codeProduct: 'zzz' },
      null,
      { status: 'MASUK' },
    ]);
    assert.deepEqual(codes, ['abc']);
  });
});
