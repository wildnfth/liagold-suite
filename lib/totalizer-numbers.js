const LONG_RE = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d{4,}(?:[.,]\d+)?|\d{1,3}(?:[.,]\d+)?/g;
const STRICT_RE = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?/g;

export function findNumberHits(text, mode) {
  const re = mode === 'strict' ? STRICT_RE : LONG_RE;
  re.lastIndex = 0;
  const hits = [];
  let m;
  const src = String(text ?? '');
  while ((m = re.exec(src)) !== null) {
    hits.push({ v: m[0], i: m.index });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return hits;
}
