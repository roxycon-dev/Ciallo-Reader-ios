/**
 * Android source: `com.example.source.js.JsCookieJar.kt` (106 lines, 98 non-blank)
 * Ported: 98 / 98 non-blank lines. Skipped: none.
 *
 * Platform adaptations:
 * - `android.content.Context.getSharedPreferences("js_source_cookies", MODE_PRIVATE)`
 *   → the injected `KeyValueStorage` from `./jsPlatform` (Room/DataStore port).
 * - `org.json.JSONObject` → the local org.json port (`./json.ts`).
 * - `okhttp3.HttpUrl.Companion.toHttpUrlOrNull()` → `URL` with a null-on-throw
 *   wrapper; `topPrivateDomain()` → `topPrivateDomain()` below, backed by a
 *   reduced public-suffix table (the Android build ships OkHttp's full PSL via
 *   `public-suffix-database.gz`; that data is not in the TS tree, so a reduced
 *   table is inlined below — see the comment on `MULTI_LABEL_SUFFIXES`).
 * - `okhttp3.Cookie.parse(url, header)` → `parseSetCookie()` below, ported
 *   rule for rule from okhttp 4.12.0 `Cookie.kt` + `internal/Util.kt` +
 *   `internal/HttpUrl.kt`:
 *   ASCII-only `trimSubstring`, the `indexOfControlOrNonAscii` name/value test,
 *   OkHttp's lenient RFC 6265 `parseExpires`, strict-integer `parseMaxAge`
 *   (`Max-Age` in **seconds**, winning over `Expires`; `-?\d+` overflow fallback),
 *   `Domain` rejecting the whole cookie when it does not domain-match or is a
 *   public suffix, `hostOnly`, and `secure` recording only the presence of the
 *   Secure attribute.
 *   `canParseAsIpAddress` is `Regex.matches` (whole-string), **not** `test`.
 * - `synchronized(lock)` dropped — JS is single-threaded.
 *
 * 2026-10-06 fix pass on this file (see the report):
 * - `canParseAsIpAddress` used `RegExp.test`, i.e. a substring search instead of
 *   `Regex.matches`. Every host containing a dot or a digit looked like an IP,
 *   so `domainMatch` rejected **every** `Domain=` attribute (login cookies were
 *   dropped) and `topPrivateDomain` returned the host itself.
 * - `topPrivateDomain` returned the host for an IP address; `HttpUrl
 *   .topPrivateDomain()` returns null (see E69 for the reduced PSL itself).
 * - The wildcard-rule branch used a fixed 3-label suffix and keyed on
 *   `labels[length-2]`, so `*.ck`/`*.jm` were never matched and
 *   `foo.bar.ck` resolved to `bar.ck`.
 * - `COOKIE_NAME_RE` / `COOKIE_VALUE_RE` were invented and never referenced;
 *   OkHttp's test is `indexOfControlOrNonAscii()`, which the file already uses.
 *   Deleted.
 *
 * Review pass (this file): see `docs/PARITY_EXCEPTIONS.md` **E69** for the public-suffix
 * list. Closed 2026-10-07 — the 70-entry inlined table was replaced with the full
 * Mozilla PSL via the `psl` package, so wildcard (`*.ck`) and exception (`!city.kobe.jp`)
 * rules now behave exactly like OkHttp's `publicsuffixes.gz`.
 */

import { parse as pslParseImpl } from 'psl';
import type { KeyValueStorage } from './jsPlatform';

/** Kotlin `okhttp3.Cookie` — the parsed Set-Cookie attributes the jar stores. */
export interface ParsedCookie {
  readonly name: string;
  readonly value: string;
  /** OkHttp stores cookies with the leading dot stripped. */
  readonly domain: string;
  readonly path: string;
  readonly secure: boolean;
  readonly hostOnly: boolean;
  /** Kotlin `cookie.expiresAt`; `MAX_DATE` (year 9999) for session cookies. */
  readonly expiresAt: number;
}

/**
 * Kotlin `okhttp3.internal.http.MAX_DATE` — "Fri, 31 Dec 9999 23:59:59 GMT".
 * `Cookie.parse` starts `expiresAt` here (NOT `Long.MAX_VALUE`), so a session
 * cookie is stored with this value in `ck_meta_<host>`.
 */
const MAX_DATE = 253402300799999;
/** Kotlin `Long.MIN_VALUE` — `parseMaxAge`'s "delete this cookie now" marker. */
const LONG_MIN = -9223372036854775808;

const COOKIE_PREFS = 'js_source_cookies';

/** Kotlin `private fun pairs(raw: String): LinkedHashMap<String, String>`. */
function pairs(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of raw.split(';').map((it) => it.trim())) {
    if (!item.includes('=')) continue;
    const name = (item.includes('=') ? item.slice(0, item.indexOf('=')) : item).trim();
    if (name.trim() !== '') out.set(name, item);
  }
  return out;
}

/** Kotlin `private fun metadata(raw: String?)` — `JSONObject(raw ?: "{}")`, defaulting on error. */
function metadata(raw: string | null): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (raw === null) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return out;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      out.set(key, value as Record<string, unknown>);
    }
  }
  return out;
}

function metaGetBool(meta: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  // Kotlin `optBoolean(key, default)` also coerces the strings "true"/"false".
  const value = meta?.[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function metaGetNumber(meta: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = meta?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (value.trim() !== '' && Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function metaGetString(meta: Record<string, unknown> | undefined, key: string, fallback: string): string {
  const value = meta?.[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'null';
  return fallback;
}

/**
 * OkHttp resolves the prevailing public-suffix rule against the full Public Suffix
 * List shipped inside its jar (`publicsuffixes.gz`, ~9 000 rules + an exception table).
 * `psl` is Mozilla's official PSL in npm form (MIT), so the same rules are available
 * without vendoring a binary.
 *
 * `pslParse(host)` returns the same five fields OkHttp's `findMatchingRule` + the
 * `PublicSuffixDatabase` bookkeeping produce:
 *   - `tld`  → the prevailing rule (a wildcard `*.ck` and an exception `!city.kobe.jp`
 *              are both already collapsed into their effective suffix),
 *   - `sld`  → the one label in front of it, `null` when the host *is* a suffix,
 *   - `domain` → `sld` + the rule = OkHttp's `getEffectiveTldPlusOne(host)`,
 *   - `listed` → false when no rule matched at all (OkHttp's `PREVAILING_RULE` `*`).
 */
function pslParse(host: string): {
  tld: string | null;
  sld: string | null;
  domain: string | null;
  listed: boolean;
} | null {
  const result = pslParseImpl(host);
  // `parse` returns `ErrorResult` (an `error` discriminant) for an unparsable name —
  // e.g. a bare TLD with no second label. OkHttp has no such branch: its
  // `findMatchingRule` simply falls back to `PREVAILING_RULE` (`*`). Map it to "no
  // registrable domain", which is what `getEffectiveTldPlusOne` returns there.
  if ('error' in result) return null;
  return {
    tld: result.tld,
    sld: result.sld,
    domain: result.domain,
    listed: result.listed,
  };
}

/**
 * Kotlin `HttpUrl.topPrivateDomain()` → `PublicSuffixDatabase.getEffectiveTldPlusOne`.
 *
 * OkHttp resolves the prevailing rule against the **full** Public Suffix List shipped
 * inside its jar (`publicsuffixes.gz`, ~9 000 rules + the exception table). We now use the
 * same list through the `psl` package (Mozilla's official PSL, MIT), which is a normal npm
 * dependency rather than a binary blob.
 *
 * The algorithm below is still a direct transcription of OkHttp's
 * `getEffectiveTldPlusOne` / `findMatchingRule`; only the rule table changed:
 *   - `exactLength`   — labels covered by a **normal** (non-wildcard, non-exception) rule.
 *   - `wildcardLength`— labels covered by a `*.<root>` wildcard rule.
 *   - exceptions (`!city.kobe.jp`) make the prevailing rule **shorter**, which
 *     `psl.isException()` reports; handled below.
 *
 * E69 closed 2026-10-07: the previous inlined table was 70 suffixes, so hosts under
 * unlisted multi-label suffixes (`github.io`, `s3.amazonaws.com`, `uk.co`, …) got an
 * eTLD+1 one label too high and parent-domain cookies were dropped.
 */
export function topPrivateDomain(host: string): string | null {
  // Kotlin: `return if (host.canParseAsIpAddress()) null else …getEffectiveTldPlusOne(host)`.
  if (canParseAsIpAddress(host)) return null;
  const labels = host.toLowerCase().split('.').filter((it) => it !== '');
  if (labels.length === 0) return null;

  // The prevailing rule = the longest matching rule, where `*` in a non-final
  // position matches exactly one label (OkHttp `findMatchingRule`).
  const info = pslParse(labels.join('.'));
  // `psl` reports the prevailing rule's `tld`; a host that *is* a suffix has
  // `sld === null` (e.g. `co.uk`, `ck`, `foo.ck`).
  if (info === null) return null;
  if (!info.listed || info.sld === null || info.sld === '') return null;
  // Kotlin `getEffectiveTldPlusOne` returns `domain` (sld + one label), not the
  // subdomain, so `psl.parse(...).domain` is exactly the answer.
  return info.domain;
}

// ----------------------------------------------------------------------
// okhttp3.Cookie.parse — ported rule for rule (okhttp 4.12.0)
// ----------------------------------------------------------------------

/** Kotlin `okhttp3.internal.String.indexOfFirstNonAsciiWhitespace`. */
function indexOfFirstNonAsciiWhitespace(input: string, start: number, end: number): number {
  for (let i = start; i < end; i += 1) {
    const c = input.charCodeAt(i);
    // '\t', '\n', '\u000C', '\r', ' '
    if (c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20) continue;
    return i;
  }
  return end;
}

/** Kotlin `okhttp3.internal.String.indexOfLastNonAsciiWhitespace`. */
function indexOfLastNonAsciiWhitespace(input: string, start: number, end: number): number {
  for (let i = end - 1; i >= start; i -= 1) {
    const c = input.charCodeAt(i);
    if (c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20) continue;
    return i + 1;
  }
  return start;
}

/** Kotlin `okhttp3.internal.String.trimSubstring` — ASCII whitespace only. */
function trimSubstring(input: string, start: number, end: number): string {
  const from = indexOfFirstNonAsciiWhitespace(input, start, end);
  const to = indexOfLastNonAsciiWhitespace(input, from, end);
  return input.slice(from, to);
}

/** Kotlin `okhttp3.internal.String.delimiterOffset(delimiter, startIndex, endIndex)`. */
function delimiterOffset(input: string, delimiter: string, start: number, end: number): number {
  for (let i = start; i < end; i += 1) {
    if (input[i] === delimiter) return i;
  }
  return end;
}

/** Kotlin `okhttp3.internal.String.indexOfControlOrNonAscii` (-1 = clean). */
function indexOfControlOrNonAscii(input: string): number {
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    if (c <= 0x1f || c >= 0x7f) return i;
  }
  return -1;
}

/**
 * Kotlin `okhttp3.internal.canParseAsIpAddress`:
 * `VERIFY_AS_IP_ADDRESS = "([0-9a-fA-F]*:[0-9a-fA-F:.]*)|([\d.]+)"` applied with
 * `Regex.matches(...)`, i.e. the **whole host** must match one alternative — not
 * "contains a match". `RegExp.test` is a substring search, so it accepted every
 * host containing a dot or a digit ("example.com", "a.example.com"), which made
 * `domainMatch` reject every `Domain=` attribute and `topPrivateDomain` return
 * the host itself. `^…$` is `matches()`.
 */
function canParseAsIpAddress(input: string): boolean {
  return /^([0-9a-fA-F]*:[0-9a-fA-F:.]*|[\d.]+)$/.test(input);
}

/** Kotlin `okhttp3.Cookie.Companion.domainMatch(urlHost, domain)`. */
function domainMatch(urlHost: string, domain: string): boolean {
  if (urlHost === domain) return true; // As in 'example.com' matching 'example.com'.
  return (
    urlHost.endsWith(domain) &&
    urlHost[urlHost.length - domain.length - 1] === '.' &&
    !canParseAsIpAddress(urlHost)
  );
}

/**
 * Kotlin `okhttp3.Cookie.Companion.parseMaxAge`:
 * `s.toLong()` first (`Long.MIN_VALUE` for 0 / negative); on overflow it falls
 * back to the `-?\d+` test — `Long.MIN_VALUE` for a leading `-`, `Long.MAX_VALUE`
 * otherwise — and rethrows `NumberFormatException` for anything else.
 * `Long.MAX_VALUE` then saturates `expiresAt` to `MAX_DATE`.
 */
function parseMaxAge(s: string): number {
  const shape = /^([+-]?)(\d+)$/.exec(s);
  if (shape === null) throw new Error(`bad max-age: ${s}`);
  const parsed = Number(s);
  if (Number.isSafeInteger(parsed)) return parsed <= 0 ? LONG_MIN : parsed;
  // The Kotlin fallback regex is `-?\d+`, so a signed `+` overflow rethrows.
  if (shape[1] === '+') throw new Error(`bad max-age: ${s}`);
  return shape[1] === '-' ? LONG_MIN : MAX_DATE;
}

// Kotlin `okhttp3.Cookie.Companion.parseExpires` — RFC 6265 §5.1.1 lenient scan.
// `matches()` on the region makes each pattern region-anchored.
const YEAR_PATTERN = /^(\d{2,4})\D*$/;
const MONTH_PATTERN = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\D*$/i;
const DAY_OF_MONTH_PATTERN = /^(\d{1,2})\D*$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{1,2}):(\d{1,2})\D*$/;
/** The Kotlin source computes the month by indexing its own pattern text. */
const MONTH_PATTERN_TEXT = '(?i)(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec).*';

/** Kotlin `okhttp3.Cookie.Companion.dateCharacterOffset`. */
function dateCharacterOffset(input: string, pos: number, limit: number, invert: boolean): number {
  for (let i = pos; i < limit; i += 1) {
    const c = input.charCodeAt(i);
    const dateCharacter =
      (c < 0x20 && c !== 0x09) ||
      c >= 0x7f ||
      (c >= 0x30 && c <= 0x39) ||
      (c >= 0x61 && c <= 0x7a) ||
      (c >= 0x41 && c <= 0x5a) ||
      c === 0x3a;
    if (dateCharacter === !invert) return i;
  }
  return limit;
}

/** Kotlin `okhttp3.Cookie.Companion.parseExpires(s, 0, s.length)`. Throws when impossible. */
function parseExpires(s: string): number {
  let pos = dateCharacterOffset(s, 0, s.length, false);
  let hour = -1;
  let minute = -1;
  let second = -1;
  let dayOfMonth = -1;
  let month = -1;
  let year = -1;
  while (pos < s.length) {
    const end = dateCharacterOffset(s, pos + 1, s.length, true);
    const region = s.slice(pos, end);
    if (hour === -1) {
      const m = TIME_PATTERN.exec(region);
      if (m !== null) {
        hour = Number(m[1]);
        minute = Number(m[2]);
        second = Number(m[3]);
      }
    }
    if (dayOfMonth === -1) {
      const m = DAY_OF_MONTH_PATTERN.exec(region);
      if (m !== null) dayOfMonth = Number(m[1]);
    }
    if (month === -1) {
      const m = MONTH_PATTERN.exec(region);
      if (m !== null) {
        // Sneaky! jan=1, dec=12.
        month = Math.floor(MONTH_PATTERN_TEXT.indexOf((m[1] as string).toLowerCase()) / 4);
      }
    }
    if (year === -1) {
      const m = YEAR_PATTERN.exec(region);
      if (m !== null) year = Number(m[1]);
    }
    pos = dateCharacterOffset(s, end + 1, s.length, false);
  }
  // Convert two-digit years into four-digit years. 99 becomes 1999, 15 becomes 2015.
  if (year >= 70 && year <= 99) year += 1900;
  if (year >= 0 && year <= 69) year += 2000;
  // If any partial is omitted or out of range, the date is impossible.
  if (!(year >= 1601)) throw new Error(`bad expires year: ${s}`);
  if (month === -1) throw new Error(`bad expires month: ${s}`);
  if (!(dayOfMonth >= 1 && dayOfMonth <= 31)) throw new Error(`bad expires day: ${s}`);
  if (!(hour >= 0 && hour <= 23)) throw new Error(`bad expires hour: ${s}`);
  if (!(minute >= 0 && minute <= 59)) throw new Error(`bad expires minute: ${s}`);
  if (!(second >= 0 && second <= 59)) throw new Error(`bad expires second: ${s}`);
  const millis = Date.UTC(year, month - 1, dayOfMonth, hour, minute, second, 0);
  // Kotlin uses a non-lenient `GregorianCalendar(UTC)`, which rejects impossible
  // dates such as Feb 30; JS `Date` rolls them over, so verify the round trip.
  const round = new Date(millis);
  if (
    round.getUTCFullYear() !== year ||
    round.getUTCMonth() !== month - 1 ||
    round.getUTCDate() !== dayOfMonth ||
    round.getUTCHours() !== hour ||
    round.getUTCMinutes() !== minute ||
    round.getUTCSeconds() !== second
  ) {
    throw new Error(`impossible expires date: ${s}`);
  }
  return millis;
}

/** Kotlin `okhttp3.Cookie.Companion.parseDomain` — `.example.com` → `example.com`. */
function parseDomain(s: string): string | null {
  if (s.endsWith('.')) return null; // require(!s.endsWith("."))
  const stripped = s.startsWith('.') ? s.slice(1) : s;
  if (stripped === '') return null;
  // Kotlin `toCanonicalHost()` lower-cases and IDNA-encodes; `URL` already returns
  // the canonical form, and returns '' for a host it cannot parse.
  try {
    const canonical = new URL(`http://${stripped}`).hostname;
    return canonical === '' ? null : canonical;
  } catch {
    return null;
  }
}

// Kotlin's name/value admissibility test is NOT a range regex: `Cookie.parse`
// calls `cookieName.indexOfControlOrNonAscii()` (which rejects any code unit
// at or below U+001F and at or above U+007F) on its own, and the empty-name
// case is a separate `cookieName.isEmpty()`. `indexOfControlOrNonAscii()` above
// is that function, so it is what `parseSetCookie` calls; an equivalent
// `/^[\u0020-\u007e]+$/` + `/^[\u0020-\u007e]*$/` pair would be dead code.

/** Kotlin `okhttp3.Cookie.parse(url, setCookie)`; returns null when malformed. */
export function parseSetCookie(url: string, setCookie: string, now: number): ParsedCookie | null {
  let urlHost: string;
  let encodedPath: string;
  try {
    const parsed = new URL(url);
    urlHost = parsed.hostname.toLowerCase();
    encodedPath = parsed.pathname === '' ? '/' : parsed.pathname;
  } catch {
    return null;
  }
  const limit = setCookie.length;
  const cookiePairEnd = delimiterOffset(setCookie, ';', 0, limit);
  const pairEqualsSign = delimiterOffset(setCookie, '=', 0, cookiePairEnd);
  if (pairEqualsSign === cookiePairEnd) return null;
  const cookieName = trimSubstring(setCookie, 0, pairEqualsSign);
  if (cookieName === '' || indexOfControlOrNonAscii(cookieName) !== -1) return null;
  const cookieValue = trimSubstring(setCookie, pairEqualsSign + 1, cookiePairEnd);
  if (indexOfControlOrNonAscii(cookieValue) !== -1) return null;

  let expiresAt = MAX_DATE;
  let deltaSeconds: number | null = null;
  let domain: string | null = null;
  let path: string | null = null;
  let secureOnly = false;
  let hostOnly = true;

  let pos = cookiePairEnd + 1;
  while (pos < limit) {
    const attributePairEnd = delimiterOffset(setCookie, ';', pos, limit);
    const attributeEqualsSign = delimiterOffset(setCookie, '=', pos, attributePairEnd);
    const attributeName = trimSubstring(setCookie, pos, attributeEqualsSign);
    const attributeValue =
      attributeEqualsSign < attributePairEnd
        ? trimSubstring(setCookie, attributeEqualsSign + 1, attributePairEnd)
        : '';
    const key = attributeName.toLowerCase();
    if (key === 'expires') {
      try {
        expiresAt = parseExpires(attributeValue);
      } catch {
        // Ignore this attribute, it isn't recognizable as a date.
      }
    } else if (key === 'max-age') {
      try {
        deltaSeconds = parseMaxAge(attributeValue);
      } catch {
        // Ignore this attribute, it isn't recognizable as a max age.
      }
    } else if (key === 'domain') {
      const parsedDomain = parseDomain(attributeValue);
      if (parsedDomain !== null) {
        domain = parsedDomain;
        hostOnly = false;
      }
      // Ignore this attribute, it isn't recognizable as a domain.
    } else if (key === 'path') {
      path = attributeValue;
    } else if (key === 'secure') {
      secureOnly = true;
    }
    pos = attributePairEnd + 1;
  }

  // If 'Max-Age' is present, it takes precedence over 'Expires', regardless of the
  // order the two attributes are declared in the cookie string.
  if (deltaSeconds === LONG_MIN) {
    expiresAt = LONG_MIN;
  } else if (deltaSeconds !== null) {
    expiresAt = now + deltaSeconds * 1000;
    if (expiresAt < now || expiresAt > MAX_DATE) expiresAt = MAX_DATE; // overflow & clamp
  }

  // If the domain is present, it must domain match. Otherwise we have a host-only cookie.
  if (domain === null) {
    domain = urlHost;
  } else if (!domainMatch(urlHost, domain)) {
    return null; // No domain match? This is either incompetence or malice!
  }

  // If the domain is a suffix of the url host, it must not be a public suffix.
  if (urlHost.length !== domain.length && topPrivateDomain(domain) === null) {
    return null;
  }

  // If the path is absent or didn't start with '/', use the default path. It's a
  // string like '/foo/bar' for a URL like 'http://example.com/foo/bar/baz'.
  let finalPath = path;
  if (finalPath === null || !finalPath.startsWith('/')) {
    const lastSlash = encodedPath.lastIndexOf('/');
    finalPath = lastSlash !== 0 ? encodedPath.slice(0, lastSlash) : '/';
  }
  // Kotlin stores `secureOnly` (whether the Secure attribute was present); the
  // scheme of the request URL is only consulted when *sending* the cookie.
  return {
    name: cookieName,
    value: cookieValue,
    domain,
    path: finalPath,
    secure: secureOnly,
    hostOnly,
    expiresAt,
  };
}

/** Kotlin `object JsCookieJar` state — one instance per host storage. */
export class JsCookieJarStore {
  constructor(
    private readonly prefs: KeyValueStorage,
    private readonly now: () => number = Date.now,
  ) {}

  /** Kotlin `fun cookieHeader(context: Context, url: String): String`. */
  cookieHeader(url: string): string {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return '';
    }
    const now = this.now();
    const baseDomain = topPrivateDomain(parsed.hostname) ?? parsed.hostname;
    const cookies = new Map<string, string>();
    let host = parsed.hostname;
    while (host.trim() !== '') {
      const stored = pairs(this.prefs.getString(`ck_${host}`) ?? '');
      const attributes = metadata(this.prefs.getString(`ck_meta_${host}`));
      let changed = false;
      for (const [name, pair] of [...stored]) {
        const meta = attributes.get(name);
        // Migrate the old one-second search throttle without discarding login sessions.
        const oldSearchThrottle =
          meta === undefined &&
          name === 'ss_search_delay' &&
          (host === 'ikmmh.com' || host.endsWith('.ikmmh.com'));
        const expired =
          oldSearchThrottle ||
          (meta !== undefined && metaGetNumber(meta, 'expiresAt', MAX_DATE) <= now);
        if (expired) {
          attributes.delete(name);
          stored.delete(name);
          changed = true;
        } else {
          const path = meta === undefined ? '/' : metaGetString(meta, 'path', '/');
          const encodedPath = parsed.pathname === '' ? '/' : parsed.pathname;
          const pathMatches =
            encodedPath === path ||
            (encodedPath.startsWith(path) &&
              (path.endsWith('/') || encodedPath[path.length] === '/'));
          const scopeMatches =
            meta === undefined ||
            ((!metaGetBool(meta, 'hostOnly', false) || host === parsed.hostname) &&
              (!metaGetBool(meta, 'secure', false) || parsed.protocol === 'https:') &&
              pathMatches);
          if (scopeMatches && !cookies.has(name)) cookies.set(name, pair);
        }
      }
      if (changed) {
        this.prefs.putString(`ck_${host}`, [...stored.values()].join('; '));
        this.prefs.putString(`ck_meta_${host}`, JSON.stringify(Object.fromEntries(attributes)));
      }
      if (host === baseDomain) break;
      // Kotlin `host.substringAfter('.', "")` — no dot yields "" and ends the loop.
      const dot = host.indexOf('.');
      host = dot >= 0 ? host.slice(dot + 1) : '';
    }
    return [...cookies.values()].join('; ');
  }

  /** Kotlin `fun saveSetCookies(context: Context, url: String, headers: List<String>)`. */
  saveSetCookies(url: string, headers: string[]): void {
    const now = this.now();
    // Kotlin `url.toHttpUrlOrNull() ?: return@synchronized` — an unparsable URL
    // is rejected before anything is written (no exception escapes).
    try {
      void new URL(url);
    } catch {
      return;
    }
    const grouped = new Map<string, ParsedCookie[]>();
    for (const header of headers) {
      const cookie = parseSetCookie(url, header, now);
      if (cookie === null) continue;
      const bucket = grouped.get(cookie.domain);
      if (bucket === undefined) grouped.set(cookie.domain, [cookie]);
      else bucket.push(cookie);
    }
    for (const [host, updates] of grouped) {
      const stored = pairs(this.prefs.getString(`ck_${host}`) ?? '');
      const attributes = metadata(this.prefs.getString(`ck_meta_${host}`));
      for (const cookie of updates) {
        if (cookie.expiresAt <= now) {
          stored.delete(cookie.name);
          attributes.delete(cookie.name);
        } else {
          stored.set(cookie.name, `${cookie.name}=${cookie.value}`);
          attributes.set(cookie.name, {
            expiresAt: cookie.expiresAt,
            path: cookie.path,
            secure: cookie.secure,
            hostOnly: cookie.hostOnly,
          });
        }
      }
      this.prefs.putString(`ck_${host}`, [...stored.values()].join('; '));
      this.prefs.putString(`ck_meta_${host}`, JSON.stringify(Object.fromEntries(attributes)));
    }
  }

  /** JS and WebView supply live name/value pairs without Set-Cookie attributes. */
  saveCookiePairs(host: string, updates: string[]): void {
    if (host.trim() === '') return;
    const domain = host.replace(/^\.+/, '').toLowerCase();
    const stored = pairs(this.prefs.getString(`ck_${domain}`) ?? '');
    const attributes = metadata(this.prefs.getString(`ck_meta_${domain}`));
    for (const [name, pair] of pairs(updates.join('; '))) {
      stored.set(name, pair);
      attributes.delete(name);
    }
    this.prefs.putString(`ck_${domain}`, [...stored.values()].join('; '));
    this.prefs.putString(`ck_meta_${domain}`, JSON.stringify(Object.fromEntries(attributes)));
  }

  /** Kotlin `fun clear(context: Context, host: String)`. */
  clear(host: string): void {
    this.prefs.remove(`ck_${host}`);
    this.prefs.remove(`ck_meta_${host}`);
  }
}

/** Kotlin `object JsCookieJar` — process-wide singleton over `js_source_cookies`. */
export const JsCookieJar = {
  prefsName: COOKIE_PREFS,
  open(prefs: KeyValueStorage, now?: () => number): JsCookieJarStore {
    return new JsCookieJarStore(prefs, now);
  },
  pairs,
  parseSetCookie,
  topPrivateDomain,
};
