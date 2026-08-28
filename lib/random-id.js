export const SESSION_CODE_LENGTH = 8;

export function sessionCodePlaceholder(length = SESSION_CODE_LENGTH) {
  return `Kode sesi (${length} karakter)`;
}

export function unbiasedBase36Index(byte) {
  if (byte >= 252) return null;
  return byte % 36;
}

export function randomBase36(length) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  let out = '';
  while (out.length < length) {
    const bytes = new Uint8Array(length - out.length);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) {
      const idx = unbiasedBase36Index(bytes[i]);
      if (idx == null) continue;
      out += alphabet[idx];
      if (out.length === length) break;
    }
  }
  return out;
}
