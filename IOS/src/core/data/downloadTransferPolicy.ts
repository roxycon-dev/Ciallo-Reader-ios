/**
 * Download transfer policy — port of Android `DownloadTransferPolicy.kt`.
 *
 * HTTP byte ranges must describe exactly the requested tail of the same representation.
 */

export interface Range {
  start: number;
  end: number;
  total: number;
}

const RANGE_RE = /^bytes (\d+)-(\d+)\/(\d+)$/;

/**
 * Kotlin `String.toLongOrNull()` — returns null (not a lossy double) when the
 * digit string does not fit in a signed 64-bit long. Byte offsets above 2^53
 * are exactly the case where a silent f64 rounding would let a bogus
 * `Content-Range` pass `validateTail`.
 */
const LONG_MAX = BigInt('9223372036854775807');

function toLongOrNull(digits: string): number | null {
  if (digits.length === 0 || digits.length > 19) return null;
  const value = BigInt(digits);
  if (value > LONG_MAX) return null;
  return Number(value);
}

export function parseRange(header: string | null | undefined): Range | null {
  const match = RANGE_RE.exec(header?.trim() ?? '');
  if (!match) return null;
  const start = toLongOrNull(match[1] as string);
  const end = toLongOrNull(match[2] as string);
  const total = toLongOrNull(match[3] as string);
  if (start === null || end === null || total === null) return null;
  // Kotlin: Range(start, end, total).takeIf { start <= end && end < total }
  if (start > end || end >= total) return null;
  return { start, end, total };
}

export function validateTail(header: string | null | undefined, offset: number, contentLength: number): number {
  const range = parseRange(header);
  if (!range) {
    throw new Error('服务器返回了无效的续传范围');
  }
  if (range.start !== offset || range.end !== range.total - 1) {
    throw new Error('服务器返回的续传位置不一致');
  }
  if (contentLength >= 0 && contentLength !== range.end - range.start + 1) {
    throw new Error('续传响应长度不一致');
  }
  return range.total;
}

/**
 * Strong ETag `"..."` preferred; else non-blank Last-Modified. Weak `W/"..."` never.
 *
 * Kotlin `etag?.takeIf { it.startsWith('"') && it.endsWith('"') }` — a bare `"`
 * (length 1) satisfies both `startsWith`/`endsWith` on the JVM, so the guard is
 * kept to the same two predicates here.
 */
export function validator(etag: string | null | undefined, lastModified: string | null | undefined): string | null {
  if (typeof etag === 'string' && etag.startsWith('"') && etag.endsWith('"')) {
    return etag;
  }
  if (typeof lastModified === 'string' && lastModified.trim() !== '') {
    return lastModified;
  }
  return null;
}
