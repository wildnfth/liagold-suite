import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildNiLookupUrl } from '../lib/ni-url.js';

describe('buildNiLookupUrl', () => {
  it('drops sniffed query leftovers and sets lookup params', () => {
    const url = buildNiLookupUrl(
      'https://liagold.cuan.co',
      '/web/purchasing/detail-non-invoice?from=2020&generalFilter=old',
      'PC1',
      20,
      0
    );
    const u = new URL(url);
    assert.equal(u.searchParams.get('from'), null);
    assert.equal(u.searchParams.get('generalFilter'), 'PC1');
    assert.equal(u.searchParams.get('pageSize'), '20');
    assert.equal(u.searchParams.get('pageNumber'), '0');
  });
});
