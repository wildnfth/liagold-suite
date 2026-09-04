import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  totalsFooterCss,
  totalsPayBarCss,
  TOTALS_STICKY_BG,
} from '../lib/totals-ui-style.js';

const GOLD = ['#fffbe8', '#fff3c9', '#e3b53d', '#7c5c00', '#f0e2a8'];

function assertNaturalTableChrome(css) {
  const lower = String(css).toLowerCase();
  for (const token of GOLD) {
    assert.equal(lower.includes(token), false, `must not use ${token}`);
  }
  assert.doesNotMatch(css, /font-weight:\s*800/);
}

describe('totalsFooterCss', () => {
  it('matches parent table chrome instead of a yellow highlight', () => {
    assertNaturalTableChrome(totalsFooterCss({
      rowClass: 'gold-total-footer-row',
      labelClass: 'gold-total-label',
      valueClass: 'gold-total-value',
      negClass: 'gold-total-negative',
    }));
  });

  it('does not override mat-cell font-weight so tfoot matches table rows', () => {
    const css = totalsFooterCss({
      rowClass: 'gold-total-footer-row',
      labelClass: 'gold-total-label',
    });
    assert.doesNotMatch(css, /font-weight:/);
  });
});

describe('totalsPayBarCss', () => {
  it('matches parent table chrome instead of a yellow highlight', () => {
    assertNaturalTableChrome(totalsPayBarCss('gold-sales-pay-bar'));
  });

  it('uses mat-cell weight 400, not inherit from Metronic body 300', () => {
    const css = totalsPayBarCss('gold-sales-pay-bar');
    assert.match(css, /font-weight:\s*400/);
    assert.doesNotMatch(css, /font-weight:\s*inherit/);
  });
});

describe('TOTALS_STICKY_BG', () => {
  it('uses table white so sticky cells cover scroll, not gold', () => {
    assert.equal(TOTALS_STICKY_BG, '#fff');
  });
});
