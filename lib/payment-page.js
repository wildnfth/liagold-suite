export function isPaymentInjectPage(pathname) {
  return /^\/purchasing\/?$/.test(pathname) || /^\/purchasing-non-invoice\/?$/.test(pathname);
}

export function isPurchasingNonInvoicePage(pathname) {
  return /^\/purchasing-non-invoice\/?$/.test(pathname);
}

export function isPurchasingFamilyChild(pathname) {
  return /^\/purchasing-non-invoice\/.+/.test(pathname) || /^\/purchasing\/.+/.test(pathname);
}
