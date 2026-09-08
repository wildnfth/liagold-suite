import { parseIdNumber } from './parse-id-number.js';

export function parseFooterRaw(textContent) {
  return parseIdNumber(textContent);
}

export function isVisibleRow(row) {
  return !!row && row.offsetParent !== null;
}

export function getVisibleRows(table) {
  return Array
    .from(table.querySelectorAll('tbody tr.mat-row'))
    .filter((row) => isVisibleRow(row));
}
