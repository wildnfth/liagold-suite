import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formWaitTimeout, nextFillAverage, planLegacyFill, formFailureNote } from '../lib/form-send.js';

describe('formWaitTimeout', () => {
  it('waits long for the first code of a run', () => {
    assert.equal(formWaitTimeout({ avgMs: null, hadSuccess: false }), 6000);
    assert.equal(formWaitTimeout({ avgMs: 200, hadSuccess: false }), 6000);
  });

  it('keeps the old 1.5 s floor while the form is fast', () => {
    assert.equal(formWaitTimeout({ avgMs: 100, hadSuccess: true }), 1500);
    assert.equal(formWaitTimeout({ avgMs: 250, hadSuccess: true }), 1500);
  });

  it('grows with the measured fill time instead of staying at 1.5 s', () => {
    assert.equal(formWaitTimeout({ avgMs: 1000, hadSuccess: true }), 4500);
    assert.equal(formWaitTimeout({ avgMs: 2000, hadSuccess: true }), 8500);
    assert.equal(formWaitTimeout({ avgMs: 2000, hadSuccess: false }), 8500);
  });

  it('is capped so a dead form does not hang the queue', () => {
    assert.equal(formWaitTimeout({ avgMs: 60000, hadSuccess: true }), 15000);
  });
});

describe('nextFillAverage', () => {
  it('starts from the first measurement', () => {
    assert.equal(nextFillAverage(null, 800), 800);
  });

  it('follows a slowing form', () => {
    let avg = 200;
    for (let i = 0; i < 12; i++) avg = nextFillAverage(avg, 2000);
    assert.ok(avg > 1900 && avg <= 2000, String(avg));
  });

  it('ignores bad measurements', () => {
    assert.equal(nextFillAverage(500, NaN), 500);
    assert.equal(nextFillAverage(null, -1), null);
  });
});

describe('planLegacyFill', () => {
  it('never accepts a bare counter change once codes are known to show in the list', () => {
    assert.equal(planLegacyFill({ changed: true, presenceMode: true, changedForMs: 5000 }), false);
  });

  it('accepts a counter change at once when the list never shows codes', () => {
    assert.equal(planLegacyFill({ changed: true, presenceMode: false, changedForMs: 0 }), true);
  });

  it('gives the code a moment to appear while that is still unknown', () => {
    assert.equal(planLegacyFill({ changed: true, presenceMode: null, changedForMs: 100 }), false);
    assert.equal(planLegacyFill({ changed: true, presenceMode: null, changedForMs: 400 }), true);
  });

  it('does nothing without a change', () => {
    assert.equal(planLegacyFill({ changed: false, presenceMode: false, changedForMs: 9999 }), false);
  });
});

describe('formFailureNote', () => {
  it('is empty when nothing failed', () => {
    assert.equal(formFailureNote([]), '');
    assert.equal(formFailureNote(null), '');
  });

  it('names the codes that did not reach the form', () => {
    assert.equal(formFailureNote(['A1', 'B2']), '⚠️ 2 kode gagal masuk form: A1, B2');
  });

  it('truncates a long list', () => {
    assert.equal(formFailureNote(['A', 'B', 'C', 'D'], 2), '⚠️ 4 kode gagal masuk form: A, B +2 lagi');
  });
});

describe('form fill wiring', () => {
  const src = readFileSync(new URL('../liagold-suite.user.js', import.meta.url), 'utf8');

  it('mirrors the helpers into LG', () => {
    assert.match(src, /\n {2}formWaitTimeout\(\{ avgMs, hadSuccess, longMs, minMs, maxMs \} = \{\}\) \{/);
    assert.match(src, /\n {2}nextFillAverage\(avgMs, fillMs\) \{/);
    assert.match(src, /\n {2}planLegacyFill\(\{ changed, presenceMode, changedForMs, graceMs \} = \{\}\) \{/);
    assert.match(src, /\n {2}formFailureNote\(codes, max\) \{/);
  });

  it('decides success by the code appearing in the form, with an adaptive timeout', () => {
    const body = src.slice(src.indexOf('async function fillFormCode('), src.indexOf('async function drainFormQueue('));
    assert.match(body, /LG\.formWaitTimeout\(\{ avgMs: formFillAvgMs, hadSuccess: ctx\.processed > 0 \}\)/);
    assert.doesNotMatch(body, /nextFormWaitTimeout/);
    assert.doesNotMatch(body, /requestAnimationFrame\(\(\) => r\(\)\)/);
  });

  it('checks the form before filling or resending a code', () => {
    const body = src.slice(src.indexOf('async function drainFormQueue('), src.indexOf('async function processFormQueue('));
    assert.match(body, /formHasCode\(code\)/);
  });

  it('recognises own scans by pushed key, not by participant name', () => {
    assert.doesNotMatch(src, /if \(scan\.by === myName\) return;/);
    assert.match(src, /if \(ownPushKeys\.has\(k\)\) return;/);
  });
});
