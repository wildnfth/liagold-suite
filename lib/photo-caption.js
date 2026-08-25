export function formatPhotoCaption({ code, weight, name } = {}) {
  const rawCode = code == null ? '' : String(code).trim();
  const codeText = !rawCode || rawCode === '-' ? '' : rawCode;
  const w = Number(weight);
  const weightText = Number.isFinite(w) && w > 0 ? `${w} gr` : '';
  const nameText = name == null ? '' : String(name).trim();
  return { code: codeText, weight: weightText, name: nameText };
}

export function resolvePhotoWeight({ weight, code, productByCode } = {}) {
  const direct = Number(weight);
  if (Number.isFinite(direct) && direct > 0) return direct;
  if (!code || !productByCode || typeof productByCode.get !== 'function') return null;
  const product = productByCode.get(String(code).toLowerCase());
  const fallback = product == null ? NaN : Number(product.weight);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}
