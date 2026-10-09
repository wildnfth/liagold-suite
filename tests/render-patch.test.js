import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planKeyedRemoval, planLogPrepend } from '../lib/render-patch.js';

describe('planKeyedRemoval', () => {
  it('returns no removals when the list is unchanged', () => {
    assert.deepEqual(planKeyedRemoval(['a', 'b', 'c'], ['a', 'b', 'c']), []);
  });

  it('returns the indexes of rows that left the list', () => {
    assert.deepEqual(planKeyedRemoval(['a', 'b', 'c', 'd'], ['a', 'c']), [1, 3]);
    assert.deepEqual(planKeyedRemoval(['a', 'b'], []), [0, 1]);
  });

  it('returns null when a row was added or the order changed', () => {
    assert.equal(planKeyedRemoval(['a', 'b'], ['a', 'b', 'c']), null);
    assert.equal(planKeyedRemoval(['a', 'b', 'c'], ['a', 'x']), null);
    assert.equal(planKeyedRemoval(['a', 'b'], ['b', 'a']), null);
  });

  it('compares by identity so duplicate codes stay distinct rows', () => {
    const p1 = { codeProduct: 'X' };
    const p2 = { codeProduct: 'X' };
    assert.deepEqual(planKeyedRemoval([p1, p2], [p2]), [0]);
  });

  it('treats missing lists as empty', () => {
    assert.deepEqual(planKeyedRemoval(null, null), []);
    assert.equal(planKeyedRemoval(null, ['a']), null);
  });
});

describe('planLogPrepend', () => {
  it('reports nothing to do for an unchanged log', () => {
    assert.deepEqual(planLogPrepend(['b', 'a'], ['b', 'a']), { prepend: 0, drop: 0 });
  });

  it('prepends one new scan on top of the existing rows', () => {
    assert.deepEqual(planLogPrepend(['b', 'a'], ['c', 'b', 'a']), { prepend: 1, drop: 0 });
  });

  it('drops the overflow row when the visible window is full', () => {
    assert.deepEqual(planLogPrepend(['c', 'b', 'a'], ['d', 'c', 'b']), { prepend: 1, drop: 1 });
  });

  it('fills an empty table when the batch is small', () => {
    assert.deepEqual(planLogPrepend([], ['b', 'a']), { prepend: 2, drop: 0 });
  });

  it('returns null when existing rows changed, so the caller rebuilds', () => {
    assert.equal(planLogPrepend(['b', 'a'], ['c', 'B', 'a'], 1), null);
    assert.equal(planLogPrepend(['b', 'a'], ['x', 'y'], 1), null);
  });

  it('plans a reorder as prepend plus drop when that yields the same rows', () => {
    assert.deepEqual(planLogPrepend(['b', 'a'], ['a', 'b'], 1), { prepend: 1, drop: 1 });
  });

  it('returns null when more rows arrived than maxPrepend', () => {
    assert.equal(planLogPrepend(['a'], ['d', 'c', 'b', 'a'], 2), null);
    assert.deepEqual(planLogPrepend(['a'], ['d', 'c', 'b', 'a'], 3), { prepend: 3, drop: 0 });
  });
});

describe('scanner render wiring', () => {
  const src = readFileSync(new URL('../liagold-suite.user.js', import.meta.url), 'utf8');

  it('mirrors the lib planners into LG', () => {
    assert.match(src, /\n {2}planKeyedRemoval\(prevKeys, nextKeys\) \{/);
    assert.match(src, /\n {2}planLogPrepend\(prevSigs, nextSigs, maxPrepend\) \{/);
  });

  it('patches product and log rows instead of rebuilding every scan', () => {
    assert.match(src, /LG\.planKeyedRemoval\(/);
    assert.match(src, /LG\.planLogPrepend\(/);
  });

  it('debounces the solo scan log write', () => {
    const body = src.slice(src.indexOf('async function persistScan('), src.indexOf('function scanBeepFreq('));
    assert.doesNotMatch(body, /\npersistScanLog\(\);/);
    assert.match(body, /\ndebouncedPersist\(\);/);
  });
});
