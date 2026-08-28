import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterCodesForActiveTray,
  codeInFormText,
  collectPresentCodes,
  findMissingFormCodes,
  enqueueFormCode,
  dequeueFormCode,
  formCountIncreased,
  formListHidePatch,
  applyInlineStylePatch,
  restoreInlineStylePatch,
  beginFormSend,
  reconcileFilledCodes,
  formFillDetected,
  nextFormWaitTimeout,
  formListOptimizeClassNames,
  FORM_LIST_OPTIMIZE_CLASS,
  shouldPauseBatch,
  planFormUnavailable,
  planFormCodeStep,
  formQueueFinishKind,
} from '../lib/form-send.js';

describe('filterCodesForActiveTray', () => {
  const productByCode = new Map([
    ['aaa', { trayId: '1' }],
    ['bbb', { trayId: '2' }],
  ]);

  it('returns empty when tray is all or missing', () => {
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['AAA', 'BBB'],
      selectedTray: 'all',
      productByCode,
      scanByCode: new Map(),
    }), []);
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['AAA'],
      selectedTray: '',
      productByCode,
      scanByCode: new Map(),
    }), []);
  });

  it('keeps only codes on the selected tray', () => {
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['AAA', 'BBB', 'aaa'],
      selectedTray: '1',
      productByCode,
      scanByCode: new Map(),
    }), ['AAA', 'aaa']);
  });

  it('falls back to scan trayId when product is unknown', () => {
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['ZZZ'],
      selectedTray: '9',
      productByCode: new Map(),
      scanByCode: new Map([['zzz', { trayId: '9' }]]),
    }), ['ZZZ']);
  });

  it('drops unknown codes with no scan tray', () => {
    assert.deepEqual(filterCodesForActiveTray({
      codes: ['NOPE'],
      selectedTray: '1',
      productByCode: new Map(),
      scanByCode: new Map(),
    }), []);
  });
});

describe('codeInFormText', () => {
  it('matches a code as a whole token, not a substring of another code', () => {
    assert.equal(codeInFormText('12', 'item 123 gold'), false);
    assert.equal(codeInFormText('ABC', 'sku abc tray'), true);
  });
});

describe('collectPresentCodes', () => {
  it('returns a lowercase set of codes that appear as tokens in form text', () => {
    const set = collectPresentCodes(['AAA', 'BBB', 'CCC'], 'product aaa · tray 1 product ccc');
    assert.deepEqual([...set].sort(), ['aaa', 'ccc']);
  });
});

describe('findMissingFormCodes', () => {
  it('drops codes already in form text or marked filled', () => {
    const missing = findMissingFormCodes(['AAA', 'BBB', 'CCC'], 'aaa is here', new Set(['bbb']));
    assert.deepEqual(missing, ['CCC']);
  });
});

describe('enqueueFormCode / dequeueFormCode', () => {
  it('skips codes already filled or queued', () => {
    const queue = [];
    const queued = new Set();
    const filled = new Set(['aaa']);
    assert.equal(enqueueFormCode(queue, queued, filled, 'AAA'), false);
    assert.equal(enqueueFormCode(queue, queued, filled, 'BBB'), true);
    assert.equal(enqueueFormCode(queue, queued, filled, 'bbb'), false);
    assert.deepEqual(queue, ['BBB']);
  });

  it('removes a dequeued code from the queued set so it can be retried', () => {
    const queue = [];
    const queued = new Set();
    const filled = new Set();
    enqueueFormCode(queue, queued, filled, 'AAA');
    assert.equal(dequeueFormCode(queue, queued), 'AAA');
    assert.equal(queued.has('aaa'), false);
    assert.equal(enqueueFormCode(queue, queued, filled, 'AAA'), true);
  });
});

describe('formCountIncreased', () => {
  it('is true only when the product count grew', () => {
    assert.equal(formCountIncreased(10, 11), true);
    assert.equal(formCountIncreased(10, 10), false);
    assert.equal(formCountIncreased(10, 9), false);
  });
});

describe('form list hide/restore', () => {
  it('applies hide patch then restores previous inline style values', () => {
    const style = { contentVisibility: '', containIntrinsicSize: 'auto' };
    const prev = applyInlineStylePatch(style, formListHidePatch());
    assert.equal(style.contentVisibility, 'hidden');
    restoreInlineStylePatch(style, prev);
    assert.equal(style.contentVisibility, '');
    assert.equal(style.containIntrinsicSize, 'auto');
  });
});

describe('beginFormSend', () => {
  it('replaces leftover queue so a new send can retry codes stuck in the queued set', () => {
    const queue = ['OLD'];
    const queued = new Set(['old', 'aaa', 'bbb']);
    const filled = new Set();
    const n = beginFormSend(queue, queued, filled, ['AAA', 'BBB']);
    assert.equal(n, 2);
    assert.deepEqual(queue, ['AAA', 'BBB']);
    assert.equal(queued.has('old'), false);
    assert.equal(queued.has('aaa'), true);
    assert.equal(queued.has('bbb'), true);
  });
});

describe('reconcileFilledCodes', () => {
  it('forgets filled codes that are not actually in the form text', () => {
    const filled = new Set(['aaa', 'bbb']);
    reconcileFilledCodes(filled, ['AAA', 'BBB'], 'aaa is here');
    assert.deepEqual([...filled], ['aaa']);
  });
});

describe('formFillDetected', () => {
  it('is true when product count grew even if counters stayed the same', () => {
    assert.equal(formFillDetected({ beforeCount: 10, afterCount: 11, beforeSig: 'a', afterSig: 'a' }), true);
  });

  it('is true when counters changed even if product count stayed the same', () => {
    assert.equal(formFillDetected({ beforeCount: 10, afterCount: 10, beforeSig: 'a', afterSig: 'b' }), true);
  });

  it('is false when neither count nor counters changed', () => {
    assert.equal(formFillDetected({ beforeCount: 10, afterCount: 10, beforeSig: 'a', afterSig: 'a' }), false);
  });
});

describe('nextFormWaitTimeout', () => {
  it('uses the short timeout after a successful fill', () => {
    assert.equal(nextFormWaitTimeout(true, 6000, 1500), 1500);
    assert.equal(nextFormWaitTimeout(false, 6000, 1500), 6000);
  });
});

describe('formListOptimizeClassNames', () => {
  it('adds and removes the optimize class without dropping other classes', () => {
    const on = formListOptimizeClassNames('list-section open', true);
    assert.equal(on.split(/\s+/).includes(FORM_LIST_OPTIMIZE_CLASS), true);
    assert.equal(on.split(/\s+/).includes('open'), true);
    const off = formListOptimizeClassNames(on, false);
    assert.equal(off.split(/\s+/).includes(FORM_LIST_OPTIMIZE_CLASS), false);
    assert.equal(off.split(/\s+/).includes('list-section'), true);
  });
});

describe('shouldPauseBatch', () => {
  it('does not pause before the batch is full', () => {
    assert.equal(shouldPauseBatch({ batchCount: 24, batchSize: 25, lastFillMs: 800, slowThresholdMs: 400 }), false);
  });

  it('skips the delay when the last fill was fast', () => {
    assert.equal(shouldPauseBatch({ batchCount: 25, batchSize: 25, lastFillMs: 120, slowThresholdMs: 400 }), false);
  });

  it('pauses when the last fill was slow or unknown', () => {
    assert.equal(shouldPauseBatch({ batchCount: 25, batchSize: 25, lastFillMs: 900, slowThresholdMs: 400 }), true);
    assert.equal(shouldPauseBatch({ batchCount: 25, batchSize: 25, lastFillMs: null, slowThresholdMs: 400 }), true);
  });
});

describe('planFormUnavailable', () => {
  it('runs and clears retries when the form input is present', () => {
    assert.deepEqual(
      planFormUnavailable({ hasInput: true, retryCount: 4, maxRetry: 10 }),
      { action: 'run', retryCount: 0 },
    );
  });

  it('retries while under the cap and gives up after', () => {
    assert.deepEqual(
      planFormUnavailable({ hasInput: false, retryCount: 2, maxRetry: 10 }),
      { action: 'retry', retryCount: 3 },
    );
    assert.deepEqual(
      planFormUnavailable({ hasInput: false, retryCount: 10, maxRetry: 10 }),
      { action: 'give-up', retryCount: 11 },
    );
  });
});

describe('planFormCodeStep', () => {
  it('skips codes already filled or already in the form text', () => {
    assert.equal(planFormCodeStep({
      code: 'AAA',
      filledSet: new Set(['aaa']),
      presentSet: new Set(),
      hasInput: true,
    }).action, 'skip');
    assert.equal(planFormCodeStep({
      code: 'BBB',
      filledSet: new Set(),
      presentSet: new Set(['bbb']),
      hasInput: true,
    }).action, 'skip');
  });

  it('stops the batch when the form input disappears mid-queue', () => {
    assert.equal(planFormCodeStep({
      code: 'AAA',
      filledSet: new Set(),
      presentSet: new Set(),
      hasInput: false,
    }).action, 'form-missing');
  });

  it('fills a new code when the form is still there', () => {
    assert.equal(planFormCodeStep({
      code: 'AAA',
      filledSet: new Set(),
      presentSet: new Set(),
      hasInput: true,
    }).action, 'fill');
  });
});

describe('formQueueFinishKind', () => {
  it('reports success only after a full drain with fills', () => {
    assert.equal(formQueueFinishKind({
      processed: 3,
      exitedEarly: false,
      stopping: false,
      remaining: 0,
    }), 'success');
  });

  it('reports paused when the form vanished after some fills', () => {
    assert.equal(formQueueFinishKind({
      processed: 2,
      exitedEarly: true,
      stopping: false,
      remaining: 4,
    }), 'paused');
  });

  it('stays quiet when stopped or nothing was filled', () => {
    assert.equal(formQueueFinishKind({
      processed: 2,
      exitedEarly: false,
      stopping: true,
      remaining: 0,
    }), null);
    assert.equal(formQueueFinishKind({
      processed: 0,
      exitedEarly: false,
      stopping: false,
      remaining: 0,
    }), null);
  });
});
