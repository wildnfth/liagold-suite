export function sessionResetUrls(base, sessionId) {
  return ['history', 'scans', 'dupes'].map(
    (node) => `${String(base).replace(/\/$/, '')}/opname/${sessionId}/${node}.json`
  );
}

export async function deleteSessionNodes(fetchFn, urls) {
  const results = await Promise.all(
    urls.map((url) => fetchFn(url, { method: 'DELETE' }))
  );
  const bad = results.find((res) => !res || !res.ok);
  if (bad) throw new Error(`HTTP ${bad.status || 0}`);
  return results;
}
