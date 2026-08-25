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
