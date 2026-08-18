export function nextPaymentLookupPage({ found, pageNumber, itemCount, pageSize, maxPages }) {
  if (found) return null;
  if (itemCount < pageSize) return null;
  if (pageNumber + 1 >= maxPages) return null;
  return pageNumber + 1;
}
