import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { photoOverlayView, productPhotoAttrs } from '../lib/photo-overlay.js';

describe('productPhotoAttrs', () => {
  it('exposes image, name, code, and weight for a catalog product', () => {
    assert.deepEqual(productPhotoAttrs({
      codeProduct: 'GB37504MX',
      name: 'Cincin',
      weight: 2.19,
      image: 'https://img.example/cincin.jpg',
    }), {
      img: 'https://img.example/cincin.jpg',
      name: 'Cincin',
      code: 'GB37504MX',
      weight: 2.19,
    });
  });

  it('falls back to CodeProduct and empty image', () => {
    assert.deepEqual(productPhotoAttrs({ CodeProduct: 'AAA', name: 'X' }), {
      img: '',
      name: 'X',
      code: 'AAA',
      weight: '',
    });
  });
});

describe('photoOverlayView', () => {
  it('shows caption, image, and fill when the product has a code', () => {
    assert.deepEqual(photoOverlayView({
      imgUrl: 'https://img.example/cincin.jpg',
      name: 'Cincin',
      code: 'GB37504MX',
      weight: 2.19,
    }), {
      code: 'GB37504MX',
      weight: '2.19 gr',
      name: 'Cincin',
      imgUrl: 'https://img.example/cincin.jpg',
      showFill: true,
      missingImage: false,
    });
  });

  it('marks missing image and hides fill when there is no code', () => {
    assert.deepEqual(photoOverlayView({
      imgUrl: '',
      name: 'Produk',
      code: '-',
      weight: 0,
    }), {
      code: '',
      weight: '',
      name: 'Produk',
      imgUrl: '',
      showFill: false,
      missingImage: true,
    });
  });
});
