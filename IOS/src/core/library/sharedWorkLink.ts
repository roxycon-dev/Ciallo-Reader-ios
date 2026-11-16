/**
 * sharedWorkLink.ts  ←  novel-reader/app/src/main/java/com/example/library/SharedWorkLink.kt
 *
 * Kotlin source: 31 lines / 24 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1-4     package + android.net.Uri import    — package decl / import          │
 * │ L6-7     object + data class Target          — ported verbatim                │
 * │ L9-17    `fun create(...)`                   — ported verbatim                │
 * │ L19-29   `fun parse(uri)`                    — ported verbatim                │
 * └────────────────────────────────────────────────────────────────────────────────┘
 *
 * Doc comment kept verbatim: "Offline detail links for sources without a public
 * website. No account data is included."
 *
 * ADAPTATIONS
 * - `android.net.Uri.Builder()` → the WHATWG `URL` with the `ciallo:` scheme.
 *   `appendQueryParameter` percent-encodes each value; `URLSearchParams` does the
 *   same with the same reserved set, so the produced string is byte-identical for
 *   every input that survives Kotlin's `require` guards.
 * - `Uri.parse(bookId).userInfo == null` → reject a `bookId` that parses as a URL
 *   carrying user-info. `new URL()` throws on a non-URL string, which is the
 *   "no user-info" answer; the `catch` therefore returns `false` (allowed).
 * - `require(...)` throws `IllegalArgumentException`; the port throws a `RangeError`
 *   with the identical Chinese message so callers that match on the message keep
 *   working, and the throw site is unchanged.
 * - `uri.queryParameterNames != setOf("source","id","title")` → a sorted key list
 *   compared against the sorted expected list. Kotlin's `Set` equality is
 *   order-insensitive; the sort makes the JS comparison the same.
 * - `runCatching { … }.getOrNull()` → `try/catch` returning `null`.
 * - Round-trip: `parse` re-runs `create` on the parsed values and discards the
 *   result, purely so that a link which cannot be re-encoded is rejected. That
 *   call is kept for the same reason.
 */

const SCHEME = 'ciallo';
const AUTHORITY = 'detail';
const EXPECTED_KEYS = ['id', 'source', 'title'] as const;
/** Kotlin L22 `uri.toString().length > 20_000`. */
const MAX_URI_LENGTH = 20_000;
/** Kotlin L11 `sourceId.length <= 256 && bookId.length <= 4096`. */
const MAX_SOURCE_LENGTH = 256;
const MAX_BOOK_LENGTH = 4096;
/** Kotlin L16 `title.take(300)`. */
const MAX_TITLE_LENGTH = 300;

export interface SharedWorkTarget {
  readonly sourceId: string;
  readonly bookId: string;
  readonly title: string;
}

/** Kotlin `require(...) { "…" }` — 同异常类型契约、同消息。 */
function require(condition: boolean, message = 'Assertion failed'): void {
  if (!condition) throw new RangeError(message);
}

/**
 * Kotlin L9-17 `fun create(sourceId, bookId, title): String`.
 *
 * Throws on a blank / over-long / control-bearing id, or on a `bookId` that is
 * itself a URL carrying account info — the same four guards, in the same order.
 */
export function sharedWorkLinkCreate(
  sourceId: string,
  bookId: string,
  title: string,
): string {
  require(sourceId.trim() !== '' && bookId.trim() !== '', '作品来源或编号缺失');
  require(sourceId.length <= MAX_SOURCE_LENGTH && bookId.length <= MAX_BOOK_LENGTH);
  require(
    !hasIsoControl(sourceId + bookId),
    '作品来源或编号包含控制字符',
  );
  require(!carriesUserInfo(bookId), '作品链接包含账号信息，无法分享');
  const url = new URL(`${SCHEME}://${AUTHORITY}`);
  url.searchParams.set('source', sourceId);
  url.searchParams.set('id', bookId);
  url.searchParams.set('title', title.slice(0, MAX_TITLE_LENGTH));
  return url.toString();
}

/**
 * Kotlin L19-29 `fun parse(uri: Uri?): Target?`.
 *
 * Accepts a raw URI string. Every structural check from the Kotlin side is kept:
 * scheme, host, empty path, no fragment, no user-info, no explicit port, length
 * cap, exactly the three query keys, each appearing exactly once. The parsed
 * values are then re-encoded through `create` and the result thrown away — a link
 * that cannot round-trip is rejected.
 */
export function sharedWorkLinkParse(raw: string | null | undefined): SharedWorkTarget | null {
  try {
    if (typeof raw !== 'string' || raw === '') return null;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.protocol !== `${SCHEME}:`) return null;
    if (url.hostname !== AUTHORITY) return null;
    if (url.pathname !== '') return null;
    if (url.hash !== '') return null;
    if (url.username !== '' || url.password !== '') return null;
    if (url.port !== '') return null;
    if (raw.length > MAX_URI_LENGTH) return null;

    const keys = [...url.searchParams.keys()].sort();
    if (keys.length !== EXPECTED_KEYS.length) return null;
    for (let i = 0; i < EXPECTED_KEYS.length; i += 1) {
      if (keys[i] !== EXPECTED_KEYS[i]) return null;
    }
    for (const key of EXPECTED_KEYS) {
      if (url.searchParams.getAll(key).length !== 1) return null;
    }

    const target: SharedWorkTarget = {
      sourceId: url.searchParams.get('source') ?? '',
      bookId: url.searchParams.get('id') ?? '',
      title: url.searchParams.get('title') ?? '',
    };
    // Round-trip guard: a link that cannot be re-encoded is not a link we made.
    sharedWorkLinkCreate(target.sourceId, target.bookId, target.title);
    return target;
  } catch {
    return null;
  }
}

/** Kotlin `Char::isISOControl`. */
function hasIsoControl(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Kotlin `Uri.parse(bookId).userInfo == null` → "does this id carry account info?". */
function carriesUserInfo(bookId: string): boolean {
  try {
    const url = new URL(bookId);
    return url.username !== '' || url.password !== '';
  } catch {
    return false;
  }
}
