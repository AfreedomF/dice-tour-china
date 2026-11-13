// Browser/Node Web Crypto only. No modulo bias: reject the incomplete tail.
// Like node:crypto.randomInt, min is inclusive and max is exclusive.
export function randomInt(min, max) {
  if (max === undefined) { max = min; min = 0; }
  const range = max - min;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || range <= 0 || range >= 2 ** 48) {
    throw new RangeError('randomInt requires safe integer bounds and 0 < max - min < 2^48');
  }
  const size = range <= 2 ** 32 ? 2 ** 32 : 2 ** 48;
  const limit = size - size % range;
  const words = new Uint32Array(size === 2 ** 32 ? 1 : 2);
  let value;
  do {
    globalThis.crypto.getRandomValues(words);
    value = words.length === 1 ? words[0] : (words[0] & 0xffff) * 2 ** 32 + words[1];
  } while (value >= limit);
  return min + value % range;
}

export function randomUUID() {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
