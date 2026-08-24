import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSesuaiFormCode,
  collectSesuaiFormCodes,
  planFormImport,
} from '../lib/form-import.js';

describe('parseSesuaiFormCode', () => {
  it('strips the weight suffix from a sesuai list item', () => {
    assert.equal(parseSesuaiFormCode(' GB37504MX-2.19gr'), 'GB37504MX');
    assert.equal(parseSesuaiFormCode('GB37504ND-5gr ,'), 'GB37504ND');
  });

  it('keeps a bare code product', () => {
    assert.equal(parseSesuaiFormCode('GBP750005L'), 'GBP750005L');
  });

  it('returns null for blank or junk', () => {
    assert.equal(parseSesuaiFormCode(''), null);
    assert.equal(parseSesuaiFormCode(' , '), null);
  });
});

describe('collectSesuaiFormCodes', () => {
  it('dedupes codes case-insensitively and skips junk', () => {
    assert.deepEqual(collectSesuaiFormCodes([
      'GB37504MX-2.19gr',
      'gb37504mx-2.19gr',
      'GB37504NE-2.14gr',
      '',
    ]), ['GB37504MX', 'GB37504NE']);
  });
});

describe('planFormImport', () => {
  const productByCode = new Map([
    ['aaa', { trayId: '11' }],
    ['bbb', { trayId: '11' }],
    ['ccc', { trayId: '99' }],
  ]);

  it('splits already-scanned, importable, and unknown-on-tray codes', () => {
    assert.deepEqual(planFormImport({
      formCodes: ['AAA', 'BBB', 'CCC', 'ZZZ'],
      scannedSet: new Set(['aaa']),
      productByCode,
      selectedTray: '11',
    }), {
      already: ['AAA'],
      toImport: ['BBB'],
      unknown: ['CCC', 'ZZZ'],
    });
  });

  it('imports nothing when every form code is already scanned', () => {
    assert.deepEqual(planFormImport({
      formCodes: ['AAA'],
      scannedSet: new Set(['aaa']),
      productByCode,
      selectedTray: '11',
    }), {
      already: ['AAA'],
      toImport: [],
      unknown: [],
    });
  });
});
