import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickProductPrice } from '../lib/product-price.js';
import { parseIdNumber } from '../lib/parse-id-number.js';

describe('pickProductPrice', () => {
  it('parses id-ID display strings', () => {
    assert.equal(pickProductPrice({ SellingPriceDisplay: '1.500.000' }, parseIdNumber), 1500000);
  });

  it('prefers a finite numeric SellingPrice over display', () => {
    assert.equal(
      pickProductPrice({ SellingPrice: 1500000, SellingPriceDisplay: '1,5' }, parseIdNumber),
      1500000
    );
  });

  it('returns 0 for a missing item', () => {
    assert.equal(pickProductPrice(null, parseIdNumber), 0);
  });
});
