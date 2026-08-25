export function parseFormTrayLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const idx = s.indexOf(' - ');
  if (idx === -1) return s;
  const code = s.slice(0, idx).trim();
  return code || null;
}

export function matchTrayByCode(trayList, code) {
  if (code == null || code === '') return null;
  const needle = String(code).trim().toLowerCase();
  if (!needle) return null;
  return (trayList || []).find((t) => String(t.trayCode).toLowerCase() === needle) || null;
}

export function planAutoSelectFormTray({
  formLabel,
  trayList,
  selectedTray,
  trayListReady,
} = {}) {
  const code = parseFormTrayLabel(formLabel);
  if (!code) return { action: 'skip', reason: 'no-form-tray' };
  if (!trayListReady) return { action: 'pending', code };
  const tray = matchTrayByCode(trayList, code);
  if (!tray) return { action: 'missing', code };
  if (String(selectedTray) === String(tray.trayId)) {
    return { action: 'skip', reason: 'already-selected', tray };
  }
  return { action: 'select', tray };
}

export function readFormTrayLabel(root) {
  if (!root || typeof root.querySelector !== 'function') return '';
  const el = root.querySelector('ng-select[formcontrolname="TrayId"] .ng-value-label');
  return el ? String(el.textContent || '').trim() : '';
}

export function planSyncFormTray({
  scannerTray,
  scannerTrayCode,
  formLabel,
  fromFormAutoSelect,
} = {}) {
  if (fromFormAutoSelect) return { action: 'skip', reason: 'from-form' };
  if (scannerTray == null || scannerTray === '' || scannerTray === 'all') {
    return { action: 'skip', reason: 'no-scanner-tray' };
  }
  const code = scannerTrayCode == null ? '' : String(scannerTrayCode).trim();
  if (!code) return { action: 'skip', reason: 'no-scanner-tray' };
  const formCode = parseFormTrayLabel(formLabel);
  if (!formCode) return { action: 'apply', code };
  if (String(formCode).toLowerCase() === code.toLowerCase()) {
    return { action: 'skip', reason: 'already-same' };
  }
  return { action: 'apply', code };
}

export function findFormTrayOption(root, code) {
  if (!root || typeof root.querySelectorAll !== 'function') return null;
  if (code == null || code === '') return null;
  const needle = String(code).trim().toLowerCase();
  if (!needle) return null;
  const nodes = root.querySelectorAll('.ng-option');
  for (const node of nodes) {
    const parsed = parseFormTrayLabel(node && node.textContent);
    if (parsed && String(parsed).toLowerCase() === needle) return node;
  }
  return null;
}
