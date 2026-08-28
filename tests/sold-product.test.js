import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSoldProduct, pickSoldItem } from '../lib/sold-product.js';

describe('pickSoldItem', () => {
  it('prefers a top-level array, then items, then data, then a single object', () => {
    assert.deepEqual(pickSoldItem([{ Id: 1 }]), { Id: 1 });
    assert.deepEqual(pickSoldItem({ items: [{ Id: 2 }] }), { Id: 2 });
    assert.deepEqual(pickSoldItem({ data: [{ Id: 3 }] }), { Id: 3 });
    assert.deepEqual(pickSoldItem({ Name: 'Cincin', Id: 4 }), { Name: 'Cincin', Id: 4 });
  });

  it('returns null when the payload has no product', () => {
    assert.equal(pickSoldItem([]), null);
    assert.equal(pickSoldItem({}), null);
    assert.equal(pickSoldItem(null), null);
  });
});

describe('normalizeSoldProduct', () => {
  it('uses CodeProduct, then FullName prefix, then the scanned code', () => {
    const price = () => 10;
    assert.equal(normalizeSoldProduct({ CodeProduct: 'AAA' }, 'ZZZ', price).codeProduct, 'AAA');
    assert.equal(normalizeSoldProduct({ FullName: 'BBB - Cincin' }, 'ZZZ', price).codeProduct, 'BBB');
    assert.equal(normalizeSoldProduct({ Name: 'X' }, 'ZZZ', price).codeProduct, 'ZZZ');
  });

  it('returns null without an item', () => {
    assert.equal(normalizeSoldProduct(null, 'A', () => 0), null);
  });
});
