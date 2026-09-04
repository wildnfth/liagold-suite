import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fbPatch, FIREBASE } from '../mobile/firebase.js';

function stubFetch(handler) {
  const calls = [];
  Object.defineProperty(globalThis, 'fetch', {
    value: async (url, opts = {}) => {
      calls.push({ url: String(url), method: (opts.method || 'GET').toUpperCase(), body: opts.body });
      return handler(calls[calls.length - 1]);
    },
    writable: true,
    configurable: true,
  });
  return calls;
}

describe('fbPatch', () => {
  it('sends one PATCH merge to the node url', async () => {
    const calls = stubFetch(() => ({ ok: true, status: 200 }));
    await fbPatch('/opname/SESI/catalog', { selectedTray: '14', selectedTrayCode: 'B14' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].url, `${FIREBASE}/opname/SESI/catalog.json`);
    assert.deepEqual(JSON.parse(calls[0].body), { selectedTray: '14', selectedTrayCode: 'B14' });
  });

  it('throws on HTTP error', async () => {
    stubFetch(() => ({ ok: false, status: 500 }));
    await assert.rejects(fbPatch('/opname/SESI/catalog', { a: 1 }), /HTTP 500/);
  });
});
