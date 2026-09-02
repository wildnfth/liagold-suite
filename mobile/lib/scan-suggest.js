export function truncateSuggestionName(name, maxLen) {
  const s = String(name || '').trim();
  const max = Number(maxLen);
  if (!Number.isFinite(max) || max <= 1) return s;
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function filterCodeSuggestions({ query, products, limit, maxNameLen } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const lim = limit == null ? 8 : Number(limit);
  const nameLen = maxNameLen == null ? 22 : maxNameLen;
  const scored = [];
  for (const p of products || []) {
    const code = String(p && p.codeProduct || '');
    const lc = code.toLowerCase();
    if (!lc.includes(q)) continue;
    let rank = 2;
    if (lc.startsWith(q)) rank = 0;
    else if (lc.endsWith(q)) rank = 1;
    scored.push({
      rank,
      code,
      name: truncateSuggestionName(p && p.name, nameLen),
      weight: p && p.weight,
    });
  }
  scored.sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code));
  return scored.slice(0, lim).map(({ code, name, weight }) => ({ code, name, weight }));
}

export function nextSuggestionScrollTop({
  scrollTop,
  viewHeight,
  itemTop,
  itemBottom,
} = {}) {
  const top = Number(scrollTop) || 0;
  const view = Number(viewHeight) || 0;
  const iTop = Number(itemTop) || 0;
  const iBot = Number(itemBottom) || 0;
  if (iTop < top) return iTop;
  if (iBot > top + view) return iBot - view;
  return top;
}
