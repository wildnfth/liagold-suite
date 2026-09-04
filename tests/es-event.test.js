import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyEsPatch, applyEsPut, classifyEsPath } from '../lib/es-event.js';

describe('classifyEsPath', () => {
  it('maps exact Firebase paths used by listenSession', () => {
    assert.deepEqual(classifyEsPath('/'), { kind: 'root' });
    assert.deepEqual(classifyEsPath('/history'), { kind: 'history' });
    assert.deepEqual(classifyEsPath('/meta'), { kind: 'meta' });
    assert.deepEqual(classifyEsPath('/meta/lastScanAt'), { kind: 'metaLastScanAt' });
    assert.deepEqual(classifyEsPath('/scans'), { kind: 'scans' });
    assert.deepEqual(classifyEsPath('/peserta'), { kind: 'peserta' });
    assert.deepEqual(classifyEsPath('/dupes'), { kind: 'dupes' });
    assert.deepEqual(classifyEsPath('/catalog'), { kind: 'catalog' });
    assert.deepEqual(classifyEsPath('/lookups'), { kind: 'lookups' });
  });

  it('strips the collection prefix for item paths', () => {
    assert.deepEqual(classifyEsPath('/history/abc_1'), { kind: 'historyItem', key: 'abc_1' });
    assert.deepEqual(classifyEsPath('/scans/abc_1'), { kind: 'scanItem', key: 'abc_1' });
    assert.deepEqual(classifyEsPath('/peserta/u1'), { kind: 'pesertaItem', key: 'u1' });
    assert.deepEqual(classifyEsPath('/dupes/x'), { kind: 'dupeItem', key: 'x' });
    assert.deepEqual(classifyEsPath('/catalog/selectedTray'), { kind: 'catalogField', key: 'selectedTray' });
    assert.deepEqual(classifyEsPath('/lookups/ab_t1'), { kind: 'lookupItem', key: 'ab_t1' });
  });

  it('does not treat an unknown path as a known collection', () => {
    assert.deepEqual(classifyEsPath('/other'), { kind: 'unknown' });
  });
});

function blankState(overrides = {}) {
  return {
    cloudHistory: {},
    participants: {},
    dupeCount: 0,
    lastScanAt: null,
    catalog: null,
    lookups: {},
    ...overrides,
  };
}

describe('applyEsPut', () => {
  it('asks to verify the session when the root snapshot is deleted', () => {
    const prev = blankState({ lastScanAt: 't0' });
    const out = applyEsPut(prev, '/', null);
    assert.deepEqual(out.state, prev);
    assert.deepEqual(out.effects, ['verifySessionAlive']);
  });

  it('replaces root collections and fills history gaps from scans', () => {
    const scan = { codeProduct: 'A', status: 'MASUK' };
    const hist = { h1: { codeProduct: 'B' } };
    const out = applyEsPut(blankState(), '/', {
      history: hist,
      scans: { h1: { codeProduct: 'B', extra: 1 }, s1: scan },
      peserta: { u1: { name: 'Lia' } },
      dupes: { d1: 1, d2: 1 },
      meta: { lastScanAt: 't1' },
    });
    assert.deepEqual(out.state.cloudHistory, { h1: hist.h1, s1: scan });
    assert.deepEqual(out.state.participants, { u1: { name: 'Lia' } });
    assert.equal(out.state.dupeCount, 2);
    assert.equal(out.state.lastScanAt, 't1');
    assert.deepEqual(out.effects, ['updateCountdownDisplay', 'onCloudUpdate', 'renderParticipants']);
  });

  it('replaces or clears /history', () => {
    const cleared = applyEsPut(blankState({ cloudHistory: { a: 1 } }), '/history', null);
    assert.deepEqual(cleared.state.cloudHistory, {});
    assert.deepEqual(cleared.effects, ['onCloudUpdate']);
    const replaced = applyEsPut(blankState(), '/history', { a: { codeProduct: 'A' } });
    assert.deepEqual(replaced.state.cloudHistory, { a: { codeProduct: 'A' } });
  });

  it('writes or deletes a single /history item', () => {
    const written = applyEsPut(blankState(), '/history/k1', { codeProduct: 'A' });
    assert.deepEqual(written.state.cloudHistory.k1, { codeProduct: 'A' });
    const deleted = applyEsPut(written.state, '/history/k1', null);
    assert.equal('k1' in deleted.state.cloudHistory, false);
    assert.deepEqual(deleted.effects, ['onCloudUpdate']);
  });

  it('updates lastScanAt from /meta and /meta/lastScanAt', () => {
    const skipped = applyEsPut(blankState({ lastScanAt: 't0' }), '/meta', {});
    assert.equal(skipped.state.lastScanAt, 't0');
    assert.deepEqual(skipped.effects, []);
    const meta = applyEsPut(blankState(), '/meta', { lastScanAt: 't1' });
    assert.equal(meta.state.lastScanAt, 't1');
    assert.deepEqual(meta.effects, ['updateCountdownDisplay']);
    const leaf = applyEsPut(blankState(), '/meta/lastScanAt', 't2');
    assert.equal(leaf.state.lastScanAt, 't2');
  });

  it('merges /scans into history only when the key is new and has codeProduct', () => {
    const existing = { s1: { codeProduct: 'OLD' } };
    const out = applyEsPut(blankState({ cloudHistory: existing }), '/scans', {
      s1: { codeProduct: 'NEW' },
      s2: { codeProduct: 'B' },
      s3: { noCode: true },
    });
    assert.equal(out.state.cloudHistory.s1.codeProduct, 'OLD');
    assert.deepEqual(out.state.cloudHistory.s2, { codeProduct: 'B' });
    assert.equal('s3' in out.state.cloudHistory, false);
    assert.deepEqual(out.effects, ['onCloudUpdate']);
    const item = applyEsPut(blankState(), '/scans/s4', { codeProduct: 'C' });
    assert.deepEqual(item.state.cloudHistory.s4, { codeProduct: 'C' });
  });

  it('replaces /peserta and writes or deletes a single peserta', () => {
    const all = applyEsPut(blankState(), '/peserta', { u1: { name: 'A' } });
    assert.deepEqual(all.state.participants, { u1: { name: 'A' } });
    assert.deepEqual(all.effects, ['renderParticipants']);
    const one = applyEsPut(all.state, '/peserta/u2', { name: 'B' });
    assert.equal(one.state.participants.u2.name, 'B');
    const gone = applyEsPut(one.state, '/peserta/u2', null);
    assert.equal('u2' in gone.state.participants, false);
  });

  it('counts /dupes and increments or decrements a dupe leaf', () => {
    const all = applyEsPut(blankState(), '/dupes', { a: 1, b: 1 });
    assert.equal(all.state.dupeCount, 2);
    assert.deepEqual(all.effects, ['updateStats']);
    const empty = applyEsPut(blankState({ dupeCount: 3 }), '/dupes', null);
    assert.equal(empty.state.dupeCount, 0);
    const plus = applyEsPut(blankState({ dupeCount: 2 }), '/dupes/x', { by: 'A' });
    assert.equal(plus.state.dupeCount, 3);
    const minus = applyEsPut(blankState({ dupeCount: 2 }), '/dupes/x', null);
    assert.equal(minus.state.dupeCount, 1);
  });

  it('stores catalog and lookups from root and leaf paths', () => {
    const catalog = { selectedTray: '14', hostAt: 't1', products: {} };
    const lookups = { k1: { code: 'A', state: 'pending' } };
    const root = applyEsPut(blankState(), '/', { catalog, lookups, history: {}, peserta: {}, dupes: null });
    assert.deepEqual(root.state.catalog, catalog);
    assert.deepEqual(root.state.lookups, lookups);
    assert.ok(root.effects.includes('onCatalogUpdate'));
    assert.ok(root.effects.includes('onLookupsUpdate'));
    const leaf = applyEsPut(blankState(), '/catalog', catalog);
    assert.deepEqual(leaf.state.catalog, catalog);
    assert.deepEqual(leaf.effects, ['onCatalogUpdate']);
    const field = applyEsPut(blankState({ catalog: { selectedTray: 'all' } }), '/catalog/selectedTray', '14');
    assert.equal(field.state.catalog.selectedTray, '14');
    const item = applyEsPut(blankState(), '/lookups/k1', { code: 'A', state: 'pending' });
    assert.equal(item.state.lookups.k1.code, 'A');
    assert.deepEqual(item.effects, ['onLookupsUpdate']);
  });
});

describe('applyEsPatch', () => {
  it('merges root patch fields without wiping unspecified collections', () => {
    const prev = blankState({
      cloudHistory: { old: { codeProduct: 'X' } },
      participants: { u0: { name: 'Z' } },
      dupeCount: 9,
      lastScanAt: 't0',
    });
    const out = applyEsPatch(prev, '/', {
      history: { h1: { codeProduct: 'A' } },
      scans: { s1: { codeProduct: 'B' } },
      peserta: { u1: { name: 'Lia' } },
      dupes: { d1: 1 },
      meta: { lastScanAt: 't1' },
    });
    assert.deepEqual(out.state.cloudHistory, {
      h1: { codeProduct: 'A' },
      s1: { codeProduct: 'B' },
    });
    assert.deepEqual(out.state.participants, { u1: { name: 'Lia' } });
    assert.equal(out.state.dupeCount, 1);
    assert.equal(out.state.lastScanAt, 't1');
    assert.deepEqual(out.effects, ['updateCountdownDisplay', 'onCloudUpdate', 'renderParticipants']);
  });

  it('patches /history entries and nested history items', () => {
    const merged = applyEsPatch(
      blankState({ cloudHistory: { a: { codeProduct: 'A' }, b: { codeProduct: 'B' } } }),
      '/history',
      { b: null, c: { codeProduct: 'C' } },
    );
    assert.equal('b' in merged.state.cloudHistory, false);
    assert.deepEqual(merged.state.cloudHistory.c, { codeProduct: 'C' });
    assert.deepEqual(merged.effects, ['onCloudUpdate']);
    const nested = applyEsPatch(
      blankState({ cloudHistory: {} }),
      '/history/k1',
      { status: 'MASUK', extra: null },
    );
    assert.equal(nested.state.cloudHistory.k1.status, 'MASUK');
    assert.equal('extra' in nested.state.cloudHistory.k1, false);
  });

  it('merges a patched /scans item like a put', () => {
    const out = applyEsPatch(blankState(), '/scans/s1', { codeProduct: 'A' });
    assert.deepEqual(out.state.cloudHistory, { s1: { codeProduct: 'A' } });
    assert.deepEqual(out.effects, ['onCloudUpdate']);
    const partial = applyEsPatch(blankState(), '/scans/s1', { by: 'Lia' });
    assert.deepEqual(partial.state.cloudHistory, {});
  });

  it('counts a patched /dupes item like a put', () => {
    const inc = applyEsPatch(blankState({ dupeCount: 0 }), '/dupes/x', { by: 'Lia', time: 't' });
    assert.equal(inc.state.dupeCount, 1);
    assert.deepEqual(inc.effects, ['updateStats']);
    const del = applyEsPatch(blankState({ dupeCount: 1 }), '/dupes/x', null);
    assert.equal(del.state.dupeCount, 0);
  });

  it('merges /peserta patches and counts /dupes from object keys', () => {
    const pes = applyEsPatch(
      blankState({ participants: { u1: { name: 'A' }, u2: { name: 'B' } } }),
      '/peserta',
      { u2: null, u3: { name: 'C' } },
    );
    assert.equal('u2' in pes.state.participants, false);
    assert.equal(pes.state.participants.u3.name, 'C');
    assert.deepEqual(pes.effects, ['renderParticipants']);
    const dupes = applyEsPatch(blankState({ dupeCount: 0 }), '/dupes/x', { a: 1, b: 1 });
    assert.equal(dupes.state.dupeCount, 1);
    assert.deepEqual(dupes.effects, ['updateStats']);
  });
});
