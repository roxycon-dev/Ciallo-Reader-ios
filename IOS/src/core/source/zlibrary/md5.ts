/**
 * Kotlin → TS: NONE — this file provides the `md5Hex` helper that
 * `source/zlibrary/ZLibraryEapiClient.kt` (L75-77) gets from
 * `java.security.MessageDigest.getInstance("MD5")`.
 *
 * WHY: Web Crypto (`crypto.subtle.digest`) supports SHA-1/SHA-256/SHA-384/SHA-512 only —
 * there is no MD5. The eapi login protocol (bipinkrish/Zlibrary-API) hard-requires MD5, so a
 * self-contained RFC 1321 implementation is provided. It is NOT a project-chosen algorithm
 * (the Kotlin comment at L73-74 says so explicitly); it is dictated by the zlib server.
 *
 * Behaviour matched to the Kotlin one-liner exactly:
 *   - input is encoded as UTF-8 (`s.toByteArray(Charsets.UTF_8)`);
 *   - output is lowercase hex, two digits per byte, zero-padded
 *     (`joinToString("") { "%02x".format(it) }` — Java's Formatter renders a negative
 *      Byte as its unsigned two-digit hex value, so no sign ever appears);
 *   - malformed UTF-16 (unpaired surrogates) is encoded as U+FFFD, matching
 *     `String.toByteArray(UTF_8)`'s default replacement behaviour.
 */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** K[i] = floor(2^32 × abs(sin(i + 1))) — RFC 1321 §3.4, precomputed. */
const K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
  0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
  0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
  0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
  0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
  0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
  0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
  0xeb86d391,
];

/** `java.security.MessageDigest.getInstance("MD5").digest(bytes)` → 16 raw bytes. */
export function md5Bytes(input: string): Uint8Array {
  const message = new TextEncoder().encode(input);
  const bitLength = message.length * 8;
  // Pad to 56 mod 64, then append the 64-bit little-endian bit length.
  const paddedLength = (((message.length + 8) >>> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  // JS bit ops are 32-bit; the low 32 bits are enough because MD5 only uses `length * 8`.
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const block = new DataView(padded.buffer);
  const m = new Int32Array(16);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) m[i] = block.getInt32(offset + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f = 0;
      let g = 0;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + (K[i] as number) + (m[g] as number)) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl(f, S[i] as number)) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0 >>> 0, true);
  outView.setUint32(4, b0 >>> 0, true);
  outView.setUint32(8, c0 >>> 0, true);
  outView.setUint32(12, d0 >>> 0, true);
  return out;
}

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) | 0;
}

/** Kotlin `md5Hex(s)` = `MessageDigest("MD5").digest(s.toByteArray(UTF_8)).joinToString("") { "%02x".format(it) }`. */
export function md5Hex(s: string): string {
  let out = '';
  for (const byte of md5Bytes(s)) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}
