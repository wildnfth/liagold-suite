import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  truncateSuggestionName,
  filterCodeSuggestions,
  nextSuggestionScrollTop,
} from '../lib/scan-suggest.js';

describe('truncateSuggestionName', () => {
  it('keeps a short name intact', () => {
    assert.equal(truncateSuggestionName('Cincin', 22), 'Cincin');
  });

  it('cuts a long name and adds an ellipsis', () => {
    assert.equal(truncateSuggestionName('Kalung Rantai Panjang Model Lama', 18), 'Kalung Rantai Pan…');
  });
});

describe('filterCodeSuggestions', () => {
  const products = [
    { codeProduct: 'GLP75001A', name: 'Cincin', weight: 1.2 },
    { codeProduct: 'GLP75002B', name: 'Kalung Rantai Panjang Model Lama', weight: 3.4 },
    { codeProduct: 'GB37504MX', name: 'Giwang', weight: 2.19 },
    { codeProduct: 'XXGLP99', name: 'Anting', weight: 0.8 },
  ];

  it('matches a prefix like GLP and ranks prefix hits first', () => {
    assert.deepEqual(filterCodeSuggestions({
      query: 'glp',
      products,
      limit: 8,
      maxNameLen: 18,
    }), [
      { code: 'GLP75001A', name: 'Cincin', weight: 1.2 },
      { code: 'GLP75002B', name: 'Kalung Rantai Pan…', weight: 3.4 },
      { code: 'XXGLP99', name: 'Anting', weight: 0.8 },
    ]);
  });

  it('matches the ending letters of a code', () => {
    assert.deepEqual(filterCodeSuggestions({
      query: '04MX',
      products,
      limit: 8,
      maxNameLen: 22,
    }), [
      { code: 'GB37504MX', name: 'Giwang', weight: 2.19 },
    ]);
  });

  it('returns nothing until two characters are typed', () => {
    assert.deepEqual(filterCodeSuggestions({ query: 'G', products }), []);
  });
});

describe('nextSuggestionScrollTop', () => {
  it('scrolls up when the active item is above the visible box', () => {
    assert.equal(nextSuggestionScrollTop({
      scrollTop: 80,
      viewHeight: 100,
      itemTop: 20,
      itemBottom: 50,
    }), 20);
  });

  it('scrolls down when the active item is below the visible box', () => {
    assert.equal(nextSuggestionScrollTop({
      scrollTop: 0,
      viewHeight: 100,
      itemTop: 90,
      itemBottom: 120,
    }), 20);
  });

  it('does not move when the active item is already visible', () => {
    assert.equal(nextSuggestionScrollTop({
      scrollTop: 40,
      viewHeight: 100,
      itemTop: 50,
      itemBottom: 80,
    }), 40);
  });
});
