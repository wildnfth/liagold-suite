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

export function shouldPauseBatch({ batchCount, batchSize, lastFillMs, slowThresholdMs }) {
  if (!(Number(batchCount) >= Number(batchSize))) return false;
  if (slowThresholdMs == null) slowThresholdMs = 400;
  if (lastFillMs == null) return true;
  return Number(lastFillMs) >= Number(slowThresholdMs);
}

export function nextFormWaitTimeout(hadSuccess, longMs, shortMs) {
  if (longMs == null) longMs = 6000;
  if (shortMs == null) shortMs = 1500;
  return hadSuccess ? shortMs : longMs;
}

export function formWaitTimeout({ avgMs, hadSuccess, longMs, minMs, maxMs } = {}) {
  if (longMs == null) longMs = 6000;
  if (minMs == null) minMs = 1500;
  if (maxMs == null) maxMs = 15000;
  const adaptive = avgMs == null
    ? minMs
    : Math.min(maxMs, Math.max(minMs, Math.round(Number(avgMs) * 4) + 500));
  return hadSuccess ? adaptive : Math.max(longMs, adaptive);
}

export function nextFillAverage(avgMs, fillMs) {
  const ms = Number(fillMs);
  if (!Number.isFinite(ms) || ms < 0) return avgMs == null ? null : avgMs;
  if (avgMs == null) return ms;
  return Math.round(Number(avgMs) * 0.7 + ms * 0.3);
}

export function planLegacyFill({ changed, presenceMode, changedForMs, graceMs } = {}) {
  if (!changed) return false;
  if (presenceMode === true) return false;
  if (presenceMode === false) return true;
  return Number(changedForMs) >= (graceMs == null ? 400 : Number(graceMs));
}

export function formFailureNote(codes, max) {
  const list = (codes || []).map((c) => String(c));
  if (!list.length) return '';
  const lim = max == null ? 5 : Number(max);
  const shown = list.slice(0, lim).join(', ');
  const more = list.length > lim ? ` +${list.length - lim} lagi` : '';
  return `⚠️ ${list.length} kode gagal masuk form: ${shown}${more}`;
}

export function planFormUnavailable({ hasInput, retryCount, maxRetry } = {}) {
  if (hasInput) return { action: 'run', retryCount: 0 };
  const nextRetry = Number(retryCount) + 1;
  if (nextRetry > Number(maxRetry)) return { action: 'give-up', retryCount: nextRetry };
  return { action: 'retry', retryCount: nextRetry };
}

export function planFormCodeStep({ code, filledSet, presentSet, hasInput } = {}) {
  const lc = String(code || '').toLowerCase();
  if ((filledSet && filledSet.has(lc)) || (presentSet && presentSet.has(lc))) {
    return { action: 'skip', lc };
  }
  if (!hasInput) return { action: 'form-missing', lc };
  return { action: 'fill', lc };
}

export function formQueueFinishKind({ processed, exitedEarly, stopping, remaining } = {}) {
  if (processed > 0 && !stopping && !exitedEarly && remaining === 0) return 'success';
  if (exitedEarly && processed > 0) return 'paused';
  return null;
}

export const FORM_LIST_OPTIMIZE_CLASS = 'lg-form-fill-opt';

export function formListOptimizeClassNames(current, on, cls) {
  if (cls == null) cls = FORM_LIST_OPTIMIZE_CLASS;
  const set = new Set(String(current || '').split(/\s+/).filter(Boolean));
  if (on) set.add(cls);
  else set.delete(cls);
  return [...set].join(' ');
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
