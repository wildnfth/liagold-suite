import { parseIdNumber } from './parse-id-number.js';

export function parseFooterRaw(textContent) {
  return parseIdNumber(textContent);
}
