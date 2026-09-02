import { formatPhotoCaption, resolvePhotoWeight } from './photo-caption.js';

export function productPhotoAttrs(product) {
  const p = product && typeof product === 'object' ? product : {};
  const weight = p.weight;
  return {
    img: p.image || '',
    name: p.name || '',
    code: p.codeProduct || p.CodeProduct || '',
    weight: weight == null || weight === '' ? '' : weight,
  };
}

export function photoOverlayView({ imgUrl, name, code, weight, productByCode } = {}) {
  const resolved = resolvePhotoWeight({ weight, code, productByCode });
  const cap = formatPhotoCaption({ code, weight: resolved, name });
  const url = imgUrl || '';
  return {
    ...cap,
    imgUrl: url,
    showFill: Boolean(cap.code),
    missingImage: !url,
  };
}
