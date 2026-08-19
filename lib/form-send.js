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
