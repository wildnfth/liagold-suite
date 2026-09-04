function applyBothSeparators(raw, lastComma, lastDot) {
  if (lastComma > lastDot) return raw.replace(/\./g, '').replace(',', '.');
  return raw.replace(/,/g, '');
}

function applyDotsOnly(raw, lastDot, dotCount) {
  if (dotCount > 1) return raw.replace(/\./g, '');
  const frac = raw.length - lastDot - 1;
  return frac === 3 ? raw.replace('.', '') : raw;
}

function applyCommasOnly(raw, commaCount) {
  if (commaCount > 1) return raw.replace(/,/g, '');
  const lastComma = raw.lastIndexOf(',');
  const frac = raw.length - lastComma - 1;
  return frac === 3 ? raw.replace(',', '') : raw.replace(',', '.');
}

function normalizeIdNumberRaw(raw) {
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  const commaCount = (raw.match(/,/g) || []).length;
  const dotCount = (raw.match(/\./g) || []).length;
  if (lastComma !== -1 && lastDot !== -1) return applyBothSeparators(raw, lastComma, lastDot);
  if (dotCount > 0 && commaCount === 0) return applyDotsOnly(raw, lastDot, dotCount);
  if (commaCount > 0 && dotCount === 0) return applyCommasOnly(raw, commaCount);
  return raw;
}

export function parseIdNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (value == null) return 0;

  const original = String(value).trim();
  if (!original) return 0;

  const negative = /^[-−]/.test(original);
  const raw = original.replace(/[^\d.,]/g, '');
  if (!raw) return 0;

  const num = parseFloat(normalizeIdNumberRaw(raw));
  if (!Number.isFinite(num)) return 0;
  return negative ? -Math.abs(num) : num;
}
