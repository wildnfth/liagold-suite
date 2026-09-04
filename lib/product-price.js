export function pickProductPrice(item, parseIdNumber) {
  if (!item || typeof item !== 'object') return 0;
  for (const key of ['SellingPrice', 'Price', 'SellingPriceValue']) {
    if (typeof item[key] === 'number' && Number.isFinite(item[key])) return item[key];
  }
  return parseIdNumber(item.SellingPriceDisplay || item.SellingPrice || item.Price || 0);
}
