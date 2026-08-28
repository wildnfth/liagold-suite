export function classifyEsPath(path) {
  const exact = {
    '/': 'root',
    '/history': 'history',
    '/meta': 'meta',
    '/meta/lastScanAt': 'metaLastScanAt',
    '/scans': 'scans',
    '/peserta': 'peserta',
    '/dupes': 'dupes',
  }[path];
  if (exact) return { kind: exact };
  const prefixes = [
    ['/history/', 'historyItem'],
    ['/scans/', 'scanItem'],
    ['/peserta/', 'pesertaItem'],
    ['/dupes/', 'dupeItem'],
  ];
  for (const [prefix, kind] of prefixes) {
    if (String(path).startsWith(prefix)) {
      return { kind, key: String(path).slice(prefix.length) };
    }
  }
  return { kind: 'unknown' };
}

function mergeScanEntry(history, key, entry) {
  if (!entry || !entry.codeProduct) return history;
  if (history[key]) return history;
  return { ...history, [key]: entry };
}

function mergeScansIntoHistory(history, scans) {
  if (!scans || typeof scans !== 'object') return history;
  let next = history;
  for (const [key, entry] of Object.entries(scans)) {
    next = mergeScanEntry(next, key, entry);
  }
  return next;
}

function putRoot(state, data) {
  if (data === null) return { state, effects: ['verifySessionAlive'] };
  const effects = [];
  let lastScanAt = state.lastScanAt;
  if (data.meta?.lastScanAt) {
    lastScanAt = data.meta.lastScanAt;
    effects.push('updateCountdownDisplay');
  }
  effects.push('onCloudUpdate', 'renderParticipants');
  let cloudHistory = data.history || {};
  cloudHistory = mergeScansIntoHistory(cloudHistory, data.scans);
  return {
    state: {
      ...state,
      cloudHistory,
      participants: data.peserta || {},
      dupeCount: data.dupes ? Object.keys(data.dupes).length : 0,
      lastScanAt,
    },
    effects,
  };
}

function putHistory(state, data) {
  return {
    state: { ...state, cloudHistory: data === null ? {} : data },
    effects: ['onCloudUpdate'],
  };
}

function putHistoryItem(state, data, { key }) {
  const cloudHistory = { ...state.cloudHistory };
  if (data === null) delete cloudHistory[key];
  else cloudHistory[key] = data;
  return { state: { ...state, cloudHistory }, effects: ['onCloudUpdate'] };
}

function putMeta(state, data) {
  if (!data?.lastScanAt) return { state, effects: [] };
  return {
    state: { ...state, lastScanAt: data.lastScanAt },
    effects: ['updateCountdownDisplay'],
  };
}

function putMetaLastScanAt(state, data) {
  return {
    state: { ...state, lastScanAt: data },
    effects: ['updateCountdownDisplay'],
  };
}

function putScans(state, data) {
  return {
    state: { ...state, cloudHistory: mergeScansIntoHistory(state.cloudHistory, data) },
    effects: ['onCloudUpdate'],
  };
}

function putScanItem(state, data, { key }) {
  return {
    state: { ...state, cloudHistory: mergeScanEntry(state.cloudHistory, key, data) },
    effects: ['onCloudUpdate'],
  };
}

function putPeserta(state, data) {
  return {
    state: { ...state, participants: data || {} },
    effects: ['renderParticipants'],
  };
}

function putPesertaItem(state, data, { key }) {
  const participants = { ...state.participants };
  if (data === null) delete participants[key];
  else participants[key] = data;
  return { state: { ...state, participants }, effects: ['renderParticipants'] };
}

function putDupes(state, data) {
  return {
    state: { ...state, dupeCount: data ? Object.keys(data).length : 0 },
    effects: ['updateStats'],
  };
}

function putDupeItem(state, data) {
  const dupeCount = data === null
    ? Math.max(0, state.dupeCount - 1)
    : state.dupeCount + 1;
  return { state: { ...state, dupeCount }, effects: ['updateStats'] };
}

const PUT_HANDLERS = {
  root: putRoot,
  history: putHistory,
  historyItem: putHistoryItem,
  meta: putMeta,
  metaLastScanAt: putMetaLastScanAt,
  scans: putScans,
  scanItem: putScanItem,
  peserta: putPeserta,
  pesertaItem: putPesertaItem,
  dupes: putDupes,
  dupeItem: putDupeItem,
};

export function applyEsPut(state, path, data) {
  const classified = classifyEsPath(path);
  const handler = PUT_HANDLERS[classified.kind];
  if (!handler) return { state, effects: [] };
  return handler(state, data, classified);
}

const ROOT_PATCH = {
  history(next, value) {
    next.cloudHistory = value || {};
  },
  peserta(next, value) {
    next.participants = value || {};
  },
  dupes(next, value) {
    next.dupeCount = value ? Object.keys(value).length : 0;
  },
  meta(next, value, effects) {
    if (!value?.lastScanAt) return;
    next.lastScanAt = value.lastScanAt;
    effects.push('updateCountdownDisplay');
  },
  scans(next, value) {
    if (!value || typeof value !== 'object') return;
    next.cloudHistory = mergeScansIntoHistory(next.cloudHistory, value);
  },
};

function patchRoot(state, data) {
  const next = { ...state };
  const effects = [];
  for (const [key, value] of Object.entries(data || {})) {
    const apply = ROOT_PATCH[key];
    if (apply) apply(next, value, effects);
  }
  effects.push('onCloudUpdate', 'renderParticipants');
  return { state: next, effects };
}

function patchHistory(state, data) {
  const cloudHistory = { ...state.cloudHistory };
  for (const [key, value] of Object.entries(data || {})) {
    if (value === null) delete cloudHistory[key];
    else cloudHistory[key] = value;
  }
  return { state: { ...state, cloudHistory }, effects: ['onCloudUpdate'] };
}

function patchHistoryItem(state, data, { key }) {
  const cloudHistory = { ...state.cloudHistory };
  const item = { ...(cloudHistory[key] || {}) };
  for (const [subKey, value] of Object.entries(data || {})) {
    if (value === null) delete item[subKey];
    else item[subKey] = value;
  }
  cloudHistory[key] = item;
  return { state: { ...state, cloudHistory }, effects: ['onCloudUpdate'] };
}

function patchScanItem(state) {
  return { state, effects: ['onCloudUpdate'] };
}

function patchPeserta(state, data) {
  const participants = { ...state.participants };
  for (const [key, value] of Object.entries(data || {})) {
    if (value === null) delete participants[key];
    else participants[key] = value;
  }
  return { state: { ...state, participants }, effects: ['renderParticipants'] };
}

function patchDupes(state, data) {
  if (!data || typeof data !== 'object') {
    return { state, effects: ['updateStats'] };
  }
  return {
    state: { ...state, dupeCount: Object.keys(data).length },
    effects: ['updateStats'],
  };
}

const PATCH_HANDLERS = {
  root: patchRoot,
  history: patchHistory,
  historyItem: patchHistoryItem,
  meta: putMeta,
  metaLastScanAt: putMetaLastScanAt,
  scans: putScans,
  scanItem: patchScanItem,
  peserta: patchPeserta,
  pesertaItem: putPesertaItem,
  dupes: patchDupes,
  dupeItem: patchDupes,
};

export function applyEsPatch(state, path, data) {
  const classified = classifyEsPath(path);
  const handler = PATCH_HANDLERS[classified.kind];
  if (!handler) return { state, effects: [] };
  return handler(state, data, classified);
}
