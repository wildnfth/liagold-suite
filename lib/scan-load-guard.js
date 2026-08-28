export function scanLoadGuard({ isLoading, productCount }) {
  if (isLoading) return 'loading';
  if (!productCount) return 'empty';
  return null;
}
