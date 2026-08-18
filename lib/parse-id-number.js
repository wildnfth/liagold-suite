export function parseIdNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (value == null) return 0;

  const original = String(value).trim();
  if (!original) return 0;

  const negative = /[-−]/.test(original);
  let raw = original.replace(/[^\d.,]/g, '');
  if (!raw) return 0;

  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  const commaCount = (raw.match(/,/g) || []).length;
  const dotCount = (raw.match(/\./g) || []).length;

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else {
      raw = raw.replace(/,/g, '');
    }
  } else if (dotCount > 0 && commaCount === 0) {
    if (dotCount > 1) {
      raw = raw.replace(/\./g, '');
    } else {
      const frac = raw.length - lastDot - 1;
      if (frac === 3) raw = raw.replace('.', '');
    }
  } else if (commaCount > 0 && dotCount === 0) {
    if (commaCount > 1) {
      raw = raw.replace(/,/g, '');
    } else {
      raw = raw.replace(',', '.');
    }
  }

  const num = parseFloat(raw);
  if (!Number.isFinite(num)) return 0;
  return negative ? -Math.abs(num) : num;
}
