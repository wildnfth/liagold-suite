import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArrayJson, scannedCodesFromLog, mergeInflightScanLog, emptyScanState } from '../lib/scan-storage.js';
import { generateHistoryKey } from '../lib/history-key.js';

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

describe('emptyScanState', () => {
  it('returns fresh empty scan containers on every call', () => {
    const a = emptyScanState();
    assert.deepEqual(a.scanLog, []);
    assert.deepEqual([...a.scannedCodes], []);
    assert.deepEqual(a.cloudHistory, {});
    a.scanLog.push({ codeProduct: 'PC1' });
    a.scannedCodes.add('pc1');
    a.cloudHistory.k = { codeProduct: 'PC1' };
    const b = emptyScanState();
    assert.deepEqual(b.scanLog, []);
    assert.deepEqual([...b.scannedCodes], []);
    assert.deepEqual(b.cloudHistory, {});
  });
});

describe('mergeInflightScanLog', () => {
  it('keeps a local in-flight row that is not in cloud history yet', () => {
    const local = [{
      codeProduct: 'PC1',
      timeIso: '2026-08-19T00:00:00.000Z',
      status: 'MASUK',
    }];
    const cloudEntries = [{
      codeProduct: 'PC2',
      timeIso: '2026-08-19T00:00:01.000Z',
      status: 'MASUK',
    }];
    const merged = mergeInflightScanLog(cloudEntries, local, {});
    assert.deepEqual(
      merged.map((row) => row.codeProduct),
      ['PC2', 'PC1']
    );
  });

  it('drops a local row once its history key is in the cloud', () => {
    const timeIso = '2026-08-19T00:00:00.000Z';
    const local = [{ codeProduct: 'PC1', timeIso, status: 'MASUK' }];
    const cloudEntries = [{ codeProduct: 'PC1', timeIso, status: 'MASUK' }];
    const key = generateHistoryKey('PC1', timeIso);
    const merged = mergeInflightScanLog(cloudEntries, local, { [key]: { codeProduct: 'PC1' } });
    assert.deepEqual(merged.map((row) => row.codeProduct), ['PC1']);
  });
});
