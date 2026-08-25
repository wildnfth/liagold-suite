import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhotoCaption, resolvePhotoWeight } from '../lib/photo-caption.js';

describe('formatPhotoCaption', () => {
  it('shows code and gramasi for a product photo', () => {
    assert.deepEqual(formatPhotoCaption({
      code: 'GB37504MX',
      weight: 2.19,
      name: 'Cincin',
    }), {
      code: 'GB37504MX',
      weight: '2.19 gr',
      name: 'Cincin',
    });
  });

  it('omits blank code and zero weight', () => {
    assert.deepEqual(formatPhotoCaption({
      code: '-',
      weight: 0,
      name: '  ',
    }), {
      code: '',
      weight: '',
      name: '',
    });
  });
});

describe('resolvePhotoWeight', () => {
  it('prefers the weight passed on the photo link', () => {
    assert.equal(resolvePhotoWeight({
      weight: '2.19',
      code: 'AAA',
      productByCode: new Map([['aaa', { weight: 9 }]]),
    }), 2.19);
  });

  it('falls back to productMap when the link has no weight', () => {
    assert.equal(resolvePhotoWeight({
      weight: '',
      code: 'GB37504MX',
      productByCode: new Map([['gb37504mx', { weight: 2.19 }]]),
    }), 2.19);
  });

  it('returns null when weight is unknown', () => {
    assert.equal(resolvePhotoWeight({ weight: '', code: 'ZZZ', productByCode: new Map() }), null);
  });
});
