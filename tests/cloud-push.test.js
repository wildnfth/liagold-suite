import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldWriteLastScanAt, unsentPushEntries } from '../lib/cloud-push.js';

describe('shouldWriteLastScanAt', () => {
  it('writes the first scan of a session', () => {
    assert.equal(shouldWriteLastScanAt(0, 1000), true);
    assert.equal(shouldWriteLastScanAt(null, 1000), true);
  });

  it('skips writes within a minute of the last one', () => {
    assert.equal(shouldWriteLastScanAt(100000, 100001), false);
    assert.equal(shouldWriteLastScanAt(100000, 159999), false);
  });

  it('writes again once the gap has passed', () => {
    assert.equal(shouldWriteLastScanAt(100000, 160000), true);
    assert.equal(shouldWriteLastScanAt(100000, 105000, 5000), true);
  });
});

describe('unsentPushEntries', () => {
  const a = { codeProduct: 'A', time: 't1' };
  const b = { codeProduct: 'B', time: 't2' };

  it('returns queued entries of the current session in order', () => {
    assert.deepEqual(unsentPushEntries([{ entry: a, sid: 'S1' }, { entry: b, sid: 'S1' }], 'S1'), [a, b]);
  });

  it('drops entries queued for another session', () => {
    assert.deepEqual(unsentPushEntries([{ entry: a, sid: 'OLD' }, { entry: b, sid: 'S1' }], 'S1'), [b]);
  });

  it('ignores broken jobs and empty queues', () => {
    assert.deepEqual(unsentPushEntries([null, { sid: 'S1' }, { entry: {}, sid: 'S1' }], 'S1'), []);
    assert.deepEqual(unsentPushEntries(null, 'S1'), []);
  });
});

describe('multiplayer scan wiring', () => {
  const src = readFileSync(new URL('../liagold-suite.user.js', import.meta.url), 'utf8');

  it('mirrors the lib helpers into LG', () => {
    assert.match(src, /\n {2}shouldWriteLastScanAt\(lastWriteMs, nowMs, minGapMs\) \{/);
    assert.match(src, /\n {2}unsentPushEntries\(queue, sessionId\) \{/);
  });

  it('does not make the scan result wait for the cloud push', () => {
    const body = src.slice(src.indexOf('async function persistScan('), src.indexOf('function scanBeepFreq('));
    assert.doesNotMatch(body, /await pushScanToCloud\(/);
    assert.match(body, /\nenqueueCloudPush\(\{/);
  });

  it('saves unsent pushes when the tab closes', () => {
    assert.match(src, /LG\.unsentPushEntries\(cloudPushQueue, sessionId\)/);
  });

  it('throttles the lastScanAt write', () => {
    const body = src.slice(src.indexOf('function updateLastScanAt('), src.indexOf('function getRemainingTime('));
    assert.match(body, /LG\.shouldWriteLastScanAt\(lastScanAtWriteMs, /);
  });
});
