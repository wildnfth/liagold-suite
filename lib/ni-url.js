export function buildNiLookupUrl(origin, path, filter, pageSize, pageNumber = 0) {
  const url = new URL(path, origin);
  url.search = '';
  url.searchParams.set('sortOrder', 'desc');
  url.searchParams.set('sortField', 'id');
  url.searchParams.set('pageNumber', String(pageNumber));
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('startIndexCustom', '-1');
  url.searchParams.set('generalFilter', filter == null ? '' : String(filter));
  return url.toString();
}
