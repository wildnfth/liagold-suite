export function buildSelectionKey({ rowCode, rowId, colClass, val, grp }) {
  const row = rowCode || rowId || '';
  return `${row}||${colClass || ''}||${val || ''}||${grp || ''}`;
}
