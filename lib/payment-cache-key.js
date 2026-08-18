export function paymentCacheKey(code, nonInvoice) {
  return (nonInvoice ? 'ni:' : 'inv:') + String(code || '');
}
