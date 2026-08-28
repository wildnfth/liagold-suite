export function nextPaymentLookupPage({ found, pageNumber, itemCount, pageSize, maxPages }) {
  if (found) return null;
  if (itemCount < pageSize) return null;
  if (pageNumber + 1 >= maxPages) return null;
  return pageNumber + 1;
}

export function paymentLookupFilters(code) {
  const original = String(code || '');
  const digits = original.replace(/\D/g, '');
  if (digits && digits !== original) return [original, digits];
  return [original];
}

export async function lookupPaymentPages({
  filter,
  pageSize,
  maxPages,
  fetchPage,
  findItem,
}) {
  let page = 0;
  while (true) {
    const json = await fetchPage(filter, page, pageSize);
    const item = findItem(json);
    const n = ((json && json.items) || []).length;
    const next = nextPaymentLookupPage({
      found: !!item,
      pageNumber: page,
      itemCount: n,
      pageSize,
      maxPages,
    });
    if (item) return item;
    if (next == null) return null;
    page = next;
  }
}
