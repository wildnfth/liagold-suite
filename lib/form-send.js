export function codeInFormText(code, formTextLower) {
  const ft = formTextLower || '';
  const c = String(code).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return new RegExp('(?<![a-z0-9])' + c + '(?![a-z0-9])', 'i').test(ft);
  } catch (e) {
    return ft.includes(String(code).toLowerCase());
  }
}

export function collectPresentCodes(codes, formTextLower) {
  const set = new Set();
  for (const code of codes || []) {
    if (codeInFormText(code, formTextLower)) set.add(String(code).toLowerCase());
  }
  return set;
}

export function findMissingFormCodes(codes, formTextLower, filledSet) {
  return (codes || []).filter((code) => {
    const lc = String(code).toLowerCase();
    if (filledSet && filledSet.has(lc)) return false;
    return !codeInFormText(code, formTextLower);
  });
}

export function enqueueFormCode(queue, queuedSet, filledSet, code) {
  const lc = String(code).toLowerCase();
  if ((filledSet && filledSet.has(lc)) || (queuedSet && queuedSet.has(lc))) return false;
  if (queuedSet) queuedSet.add(lc);
  queue.push(code);
  return true;
}

export function dequeueFormCode(queue, queuedSet) {
  const code = queue.shift();
  if (code == null) return null;
  if (queuedSet) queuedSet.delete(String(code).toLowerCase());
  return code;
}

export function resetFormQueue(queue, queuedSet) {
  if (queue) queue.length = 0;
  if (queuedSet) queuedSet.clear();
}

export function beginFormSend(queue, queuedSet, filledSet, codes) {
  resetFormQueue(queue, queuedSet);
  let n = 0;
  for (const code of codes || []) {
    if (enqueueFormCode(queue, queuedSet, filledSet, code)) n++;
  }
  return n;
}

export function reconcileFilledCodes(filledSet, codes, formTextLower) {
  if (!filledSet) return 0;
  let removed = 0;
  for (const code of codes || []) {
    const lc = String(code).toLowerCase();
    if (filledSet.has(lc) && !codeInFormText(code, formTextLower)) {
      filledSet.delete(lc);
      removed++;
    }
  }
  return removed;
}

export function formCountIncreased(beforeCount, afterCount) {
  return Number(afterCount) > Number(beforeCount);
}

export function formFillDetected({ beforeCount, afterCount, beforeSig, afterSig }) {
  if (formCountIncreased(beforeCount, afterCount)) return true;
  if (beforeSig != null && afterSig != null && String(beforeSig) !== String(afterSig)) return true;
  return false;
}

export function nextFormWaitTimeout(hadSuccess, longMs, shortMs) {
  if (longMs == null) longMs = 6000;
  if (shortMs == null) shortMs = 1500;
  return hadSuccess ? shortMs : longMs;
}

export const FORM_LIST_OPTIMIZE_CLASS = 'lg-form-fill-opt';

export function formListOptimizeClassNames(current, on, cls) {
  if (cls == null) cls = FORM_LIST_OPTIMIZE_CLASS;
  const set = new Set(String(current || '').split(/\s+/).filter(Boolean));
  if (on) set.add(cls);
  else set.delete(cls);
  return [...set].join(' ');
}

export function looksLikeProductRecord(x) {
  if (!x || typeof x !== 'object') return false;
  return x.CodeProduct != null || x.codeProduct != null || x.FullName != null;
}

export function scoreProductListKey(key, arr) {
  const k = String(key).toLowerCase();
  let score = 0;
  if (/product|detail|item|list|opname|scan/.test(k)) score += 2;
  if (Array.isArray(arr) && arr.length && looksLikeProductRecord(arr[0])) score += 3;
  if (Array.isArray(arr)) score += Math.min(arr.length, 10) * 0.1;
  return score;
}

export function pickProductListFromComponent(root, maxDepth) {
  if (maxDepth == null) maxDepth = 4;
  let best = null;
  let bestScore = -1;
  const seen = new Set();
  const walk = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > maxDepth) return;
    if (obj.nodeType) return;
    if (seen.has(obj)) return;
    seen.add(obj);
    for (const key of Object.keys(obj)) {
      let val;
      try { val = obj[key]; } catch (e) { continue; }
      if (Array.isArray(val)) {
        const score = scoreProductListKey(key, val);
        if (score > bestScore) {
          bestScore = score;
          best = { key, list: val, parent: obj };
        }
      } else if (val && typeof val === 'object' && depth < maxDepth) {
        walk(val, depth + 1);
      }
    }
  };
  walk(root, 0);
  return bestScore >= 2 ? best : null;
}

export function chunkCodes(codes, size) {
  const out = [];
  const n = Math.max(1, Number(size) || 8);
  const list = codes || [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export function buildInjectedProduct(code, fetched) {
  if (fetched && typeof fetched === 'object') {
    return Object.assign({}, fetched, { CodeProduct: fetched.CodeProduct || code });
  }
  return { CodeProduct: code };
}

export function chooseFillStrategy(probe) {
  if (probe && Array.isArray(probe.list)) return 'inject';
  return 'click';
}

export function formListHidePatch() {
  return {
    contentVisibility: 'hidden',
    containIntrinsicSize: '0px 0px',
  };
}

export function applyInlineStylePatch(styleObj, patch) {
  const prev = {};
  for (const key of Object.keys(patch || {})) {
    prev[key] = styleObj[key] || '';
    styleObj[key] = patch[key];
  }
  return prev;
}

export function restoreInlineStylePatch(styleObj, prev) {
  if (!prev) return;
  for (const key of Object.keys(prev)) {
    styleObj[key] = prev[key];
  }
}

export function filterCodesForActiveTray({ codes, selectedTray, productByCode, scanByCode }) {
  if (selectedTray == null || selectedTray === '' || selectedTray === 'all') return [];
  const tray = String(selectedTray);
  return (codes || []).filter((code) => {
    const lc = String(code).toLowerCase();
    const product = productByCode && productByCode.get(lc);
    if (product) return String(product.trayId) === tray;
    const scan = scanByCode && scanByCode.get(lc);
    if (scan && scan.trayId != null && scan.trayId !== '') return String(scan.trayId) === tray;
    return false;
  });
}
