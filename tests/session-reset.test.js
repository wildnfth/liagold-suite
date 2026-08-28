import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sessionResetUrls, deleteSessionNodes } from '../lib/session-reset.js';

describe('sessionResetUrls', () => {
  it('targets history, scans, and dupes under the session', () => {
    assert.deepEqual(sessionResetUrls('https://x.firebaseio.com', 'ABC12'), [
      'https://x.firebaseio.com/opname/ABC12/history.json',
      'https://x.firebaseio.com/opname/ABC12/scans.json',
      'https://x.firebaseio.com/opname/ABC12/dupes.json',
    ]);
  });
});

describe('deleteSessionNodes', () => {
  it('sends DELETE to every url and waits', async () => {
    const calls = [];
    const fetchFn = async (url, opts) => {
      calls.push({ url, method: opts.method });
      return { ok: true, status: 200 };
    };
    await deleteSessionNodes(fetchFn, ['a.json', 'b.json']);
    assert.deepEqual(calls, [
      { url: 'a.json', method: 'DELETE' },
      { url: 'b.json', method: 'DELETE' },
    ]);
  });

  it('rejects when any DELETE is not ok', async () => {
    const fetchFn = async (url) => ({
      ok: url.includes('dupes') ? false : true,
      status: url.includes('dupes') ? 401 : 200,
    });
    await assert.rejects(
      deleteSessionNodes(fetchFn, ['history.json', 'scans.json', 'dupes.json']),
      /HTTP 401/
    );
  });
});
