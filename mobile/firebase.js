export const FIREBASE = 'https://stock-baki-default-rtdb.asia-southeast1.firebasedatabase.app';

export async function fbGet(path) {
  const res = await fetch(`${FIREBASE}${path}.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fbPut(path, data) {
  const res = await fetch(`${FIREBASE}${path}.json`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function fbPost(path, data) {
  const res = await fetch(`${FIREBASE}${path}.json`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function fbDelete(path) {
  const res = await fetch(`${FIREBASE}${path}.json`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export function openSessionEs(sessionId, { onPut, onPatch, onError }) {
  const es = new EventSource(`${FIREBASE}/opname/${sessionId}.json`);
  es.addEventListener('put', (e) => {
    try { onPut(JSON.parse(e.data)); } catch (err) {}
  });
  es.addEventListener('patch', (e) => {
    try { onPatch(JSON.parse(e.data)); } catch (err) {}
  });
  es.onerror = onError;
  return es;
}
