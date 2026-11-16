/**
 * githubUpdateChecker.ts — line-by-line port of Android
 * `com/example/data/GithubUpdateChecker.kt`
 * (`novel-reader/app/src/main/java/com/example/data/GithubUpdateChecker.kt`,
 * 163 lines / 127 non-blank).
 *
 * Line map (Kotlin → this file):
 *   1-15    package + imports            → see "Skipped lines" below
 *   17-21   UpdateCheckResult            → `UpdateCheckResult`
 *   23      UpdateApkAsset               → `UpdateApkAsset`
 *   25-27   UpdateRelease (+ `version`)  → `UpdateRelease` + `releaseVersion()`
 *   29      UPDATE_REPOSITORY            → `UPDATE_REPOSITORY`
 *   30      MAX_UPDATE_BYTES             → `MAX_UPDATE_BYTES`
 *   32-43   officialUpdateAsset          → `officialUpdateAsset()`
 *   45-53   GithubUpdateChecker ctor     → `GithubUpdateCheckerOptions` + class
 *   54      CheckFailure                 → `GithubCheckFailure`
 *   56-83   suspend fun check            → `GithubUpdateChecker.check()`
 *   85-87   private fun request          → `request()`
 *   89-114  private suspend apiRelease   → `apiRelease()`
 *   116-133 private suspend webTag       → `webTag()`
 *   135-137 private fun releaseUrl       → `releaseUrl()`
 *   139     stableTag                    → `stableTag()`
 *   141-146 versionParts                 → `versionParts()` + `isNewerVersion()`
 *   148-152 httpFailure                  → `httpFailure()`
 *   154-162 failureReason                → `failureReason()` + `classifyFailure()`
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1     `package com.example.data` — TS module system.
 *  L3     `android.content.Context` — the only use is the nullable `SystemProxyResolver`
 *         argument; the browser and Capacitor both honour the OS proxy already.
 *  L4     `com.example.BuildConfig` — `VERSION_NAME` becomes the injected
 *         `versionName` option (there is no generated BuildConfig on web/iOS).
 *  L5-7   `SharedHttpTransport` / `executeCancellable` — the shared OkHttp pool →
 *         the injected `UpdateHttpClient` port (see below).
 *  L8     `SystemProxyResolver` — Android system-proxy discovery. Browsers resolve
 *         the OS proxy through their own network stack; SKIPPED, nothing to port.
 *  L9-10  `CancellationException` / `Dispatchers` — `withContext(Dispatchers.IO)` is
 *         implicit in JS; cancellation is the `AbortSignal` passed per request.
 *  L11-14 okhttp3 `HttpUrl` / `OkHttpClient` / `Request` — WHATWG `URL` +
 *         `UpdateHttpClient`/`UpdateHttpRequest`.
 *  L15    `java.util.concurrent.TimeUnit` — the 8 s / 10 s / 12 s budgets become the
 *         `CONNECT_TIMEOUT_MS` / `READ_TIMEOUT_MS` / `CALL_TIMEOUT_MS` constants
 *         below, sent as `HttpRequest.timeoutMs`.
 *  L57-58 `client.newBuilder().apply { if (proxy != null) proxy(proxy) }.build()` —
 *         OkHttp proxy configuration; SKIPPED (see L8).
 *  L90-93 `response.body?.byteStream()?.use { it.readImportBytes(512 * 1024) }` —
 *         the platform client already returns the whole body, so the bounded read
 *         collapses to `MAX_RELEASE_METADATA_BYTES`, a truncation guard applied
 *         before `JSON.parse`. `?: throw CheckFailure("GitHub 返回了空数据")` becomes
 *         `checkMetadataBody()`.
 *  L92    `Charsets.UTF_8` — `TextDecoder` with the fatal flag.
 *  L120-121 `.executeCancellable()` + `use { }` — the `use` block is inlined into the
 *         `await`; `executeCancellable` is `UpdateHttpClient.request`.
 *  L119    `transport.newBuilder().followRedirects(false).followSslRedirects(false)`
 *         → `UpdateHttpRequestOptions.followRedirects: false`.
 *  L135-137 `HttpUrl.newBuilder().encodedPath(...).addPathSegment(tag).build()`
 *         → `pathSegments`/`setPathSegments` helpers over WHATWG `URL`.
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * `okhttp3.HttpUrl.toHttpUrl()` → `new URL()` (both throw on a non-absolute URL,
 *    which the Kotlin code relies on inside `runCatching { … }.getOrDefault(false)`).
 *    `HttpUrl.pathSegments` (percent-DECODED) → `pathSegmentsOf()`.
 *    `HttpUrl.query == null` → `URL.search === ''`; `fragment == null` → `hash === ''`.
 *    `HttpUrl.port` returns 443 for an implicit https port → `effectivePort()`.
 *  * `org.json` accessors come from the existing core shim
 *    `@core/source/impl/jsonSupport` (`optString`/`optLong`/`optBoolean`/`isNull`/
 *    `optJsonArray`/`arrayOptJsonObject`) — same NULL-sentinel semantics.
 *  * `failureReason`'s `is <JavaException>` dispatch has no JS equivalent, so the
 *    classifier inspects `error.name` / `error.message` (and a `cause` chain) for the
 *    fetch/DNS/TLS failure names each mapped kind produces. The six Chinese strings and
 *    the `else` fallback are preserved verbatim.
 *
 * ── 2026-10-06 逐行审查 pass (agent: update module) ─────────────────────────────────
 *  Reviewed every Kotlin line above against this file. Verdict per focus item:
 *  * 1. 版本比较 — `versionParts` / `stableTag` / `isNewerVersion` transcribe Kotlin
 *    L141-146 / L139 / L79 exactly. Probed: `1.0.10 > 1.0.9` (numeric, never lexical),
 *    `1.2 == 1.2.0` padding, `1.2.3-beta.1 → [1,2,3,0]`, `1.2.3+123 → [1,2,3,0]`,
 *    `1.2.3.4.5 → null`, `vv1.2 → null`, `01.2 → [1,2,0,0]`, `2^63 → null`.
 *    NOTE: `stableTag` (the API gate, L96) rejects a `-beta.1` tag outright — Kotlin does
 *    too, so a pre-release is never offered, only the numeric core is ever compared.
 *    One documented divergence: the f64 ceiling on a single component (see
 *    `LONG_MAX_VALUE`).
 *  * 2. 更新源 — `apiUrl` / `webUrl` / `UPDATE_REPOSITORY` / the `User-Agent` and
 *    `Accept` literals are byte-for-byte equal to Kotlin L51/L52/L29/L86-87/L120.
 *    Field mapping `tag_name`/`assets[]`/`name`/`browser_download_url`/`size`/`digest`/
 *    `state`/`draft`/`prerelease`/`body` matches L95-L112 one for one.
 *  * 3. 超时/重试/限流 — Kotlin sets connect 8 s / read 10 s / call 12 s; only the 12 s
 *    call budget survives a one-deadline port (documented at `CALL_TIMEOUT_MS`). Kotlin
 *    has NO retry and NO backoff, so neither does this port. `httpFailure` maps
 *    403/429 → 「GitHub 接口访问受限或请求过多（HTTP $code）」 verbatim; Kotlin does not
 *    read `Retry-After` / `X-RateLimit-Remaining`, so the port does not either.
 *  * FIXED (BUG): `decodeReleaseMetadata` reported an OVERSIZED metadata body as
 *    「GitHub 返回了空数据」; Kotlin's `ArchiveBudget` throws a plain
 *    `IllegalArgumentException` there, which surfaces as 「无法读取 GitHub 更新信息」.
 *  * Also re-probed `officialUpdateAsset` against every Kotlin L34/L37-L41 guard:
 *    scheme, implicit/explicit :443, :8443, userinfo, query, fragment, `..`, `/`, `\`,
 *    mirror host, the 5..200 name window and the `[vV]?\d+(\.\d+){1,3}` tag — all agree.
 *
 *
 * ── Reused by ─────────────────────────────────────────────────────────────────────
 *  `appUpdateStore.ts` (officialUpdateAsset + UPDATE_REPOSITORY), `appUpdateDownload.ts`
 *  (UpdateHttpClient + officialUpdateAsset + MAX_UPDATE_BYTES), `index.ts`.
 */

import type { HttpHeader, HttpRequest, HttpResponse } from '@platform/interfaces';
import {
  arrayOptJsonObject,
  isNull,
  optBoolean,
  optJsonArray,
  optLong,
  optStringOrEmpty,
  parseJsonObjectOrThrow,
  type JsonArray,
  type JsonObject,
} from '../source/impl/jsonSupport';

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L17-21  internal data class UpdateCheckResult
   ══════════════════════════════════════════════════════════════════════════════ */

export interface UpdateCheckResult {
  readonly message: string;
  /** Kotlin default `null`. */
  readonly releaseUrl?: string | null;
  /** Kotlin default `null`. */
  readonly release?: UpdateRelease | null;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L23  internal data class UpdateApkAsset
   ══════════════════════════════════════════════════════════════════════════════ */

export interface UpdateApkAsset {
  readonly name: string;
  readonly url: string;
  /** Kotlin default `null`. */
  readonly size?: number | null;
  /** Kotlin default `null`. */
  readonly sha256?: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L25-27  internal data class UpdateRelease
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * Kotlin `internal data class UpdateRelease(val tag, val releaseUrl, val notes = "",
 * val apk = null)` — `version` is the Kotlin computed getter (L26), hoisted into the
 * factory below so the interface stays structurally identical to the Kotlin type.
 */
export interface UpdateRelease {
  readonly tag: string;
  readonly releaseUrl: string;
  /** Kotlin default `""`. */
  readonly notes: string;
  /** Kotlin default `null`. */
  readonly apk: UpdateApkAsset | null;
  /** Kotlin L26 `val version get() = tag.removePrefix("v").removePrefix("V")`. */
  readonly version: string;
}

/** Kotlin `UpdateRelease(version)` — the data-class constructor plus the `version` getter. */
export function makeUpdateRelease(
  tag: string,
  releaseUrl: string,
  notes = '',
  apk: UpdateApkAsset | null = null,
): UpdateRelease {
  return { tag, releaseUrl, notes, apk, version: releaseVersion(tag) };
}

/**
 * Kotlin L26 / L80 `tag.removePrefix("v").removePrefix("V")` — `removePrefix` strips
 * at most ONE occurrence, so `vv1.2` yields `v1.2` (the second pass looks for `V`).
 */
export function releaseVersion(tag: string): string {
  return tag.startsWith('v')
    ? tag.slice(1)
    : tag.startsWith('V')
      ? tag.slice(1)
      : tag;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L29-30  internal const val UPDATE_REPOSITORY / MAX_UPDATE_BYTES
   ══════════════════════════════════════════════════════════════════════════════ */

export const UPDATE_REPOSITORY = 'https://github.com/roxycon-dev/Ciallo-Reader';

export const MAX_UPDATE_BYTES = 192 * 1024 * 1024;

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L139 / L141-146  the two pure version helpers
   ══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin L34 / L139 / L143 `[vV]?\d+(?:\.\d+){1,3}` (full match). */
const STABLE_TAG_PATTERN = /^[vV]?\d+(?:\.\d+){1,3}$/;
/** Kotlin L143 `\d+(?:\.\d+){1,3}` (full match) — the same shape minus the v/V prefix. */
const VERSION_BODY_PATTERN = /^\d+(?:\.\d+){1,3}$/;

/** Kotlin L46 / L50 / L107 `[0-9a-f]{64}` (lowercase only, full match). */
const SHA256_LOWER_PATTERN = /^[0-9a-f]{64}$/;
/** Kotlin L107 `sha256:[0-9a-fA-F]{64}` — GitHub's asset digest, either case. */
const ASSET_DIGEST_PATTERN = /^sha256:[0-9a-fA-F]{64}$/;

/** Kotlin `String.substringBefore(delimiter)` — whole string when absent. */
function substringBefore(value: string, delimiter: string): string {
  const index = value.indexOf(delimiter);
  return index < 0 ? value : value.slice(0, index);
}

/**
 * Kotlin `Long.MAX_VALUE` as an exact double.
 *
 * ⚠️ DOCUMENTED DIVERGENCE (not a bug, and the safe direction): a JS `number` is an
 * f64, so a version component above `Number.MAX_SAFE_INTEGER` (2^53-1) cannot be
 * represented exactly. Kotlin's `String.toLongOrNull()` accepts any value up to 2^63-1.
 * `Number.isSafeInteger` therefore rejects a slightly wider window than Kotlin does.
 * Rejecting is the safe direction: accepting would make `1.2.<2^53+1>` compare EQUAL to
 * `1.2.0` because both would round to the same double, i.e. silently declare "no update"
 * when one exists. No real `versionCode` component is anywhere near 2^53.
 */
const LONG_MAX_VALUE = 9_223_372_036_854_775e3;

/**
 * Kotlin `String.toLongOrNull()` — `null` on anything that is not an unsigned decimal
 * run, and `null` past the representable ceiling (see `LONG_MAX_VALUE` above).
 */
function toLongOrNull(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value <= LONG_MAX_VALUE ? value : null;
}

/**
 * Kotlin L141-146:
 *   val text = version.removePrefix("v").removePrefix("V").substringBefore('-').substringBefore('+')
 *   if (!Regex("\\d+(?:\\.\\d+){1,3}").matches(text)) return null
 *   val parts = text.split('.').map { it.toLongOrNull() ?: return null }
 *   return parts + List(4 - parts.size) { 0L }
 *
 * Always exactly 4 entries (the pattern allows at most 4), so the caller's `zip` is total.
 */
export function versionParts(version: string): number[] | null {
  const stripped = version.startsWith('v') ? version.slice(1) : version;
  const deV = stripped.startsWith('V') ? stripped.slice(1) : stripped;
  const text = substringBefore(substringBefore(deV, '-'), '+');
  if (!VERSION_BODY_PATTERN.test(text)) return null;
  const parts: number[] = [];
  for (const piece of text.split('.')) {
    const parsed = toLongOrNull(piece);
    if (parsed === null) return null;
    parts.push(parsed);
  }
  while (parts.length < 4) parts.push(0);
  return parts;
}

/**
 * Kotlin L139 `stableTag(tag)`:
 *   if (Regex("[vV]?\\d+(?:\\.\\d+){1,3}").matches(tag)) versionParts(tag) else null
 */
export function stableTag(tag: string): number[] | null {
  if (!STABLE_TAG_PATTERN.test(tag)) return null;
  return versionParts(tag);
}

/**
 * Kotlin L79:
 *   val newer = latest.zip(current).firstOrNull { (a, b) -> a != b }?.let { (a, b) -> a > b } == true
 *
 * Returns `[a, b]` for the FIRST differing component, or `null` when the two
 * 4-component vectors are identical (then `newer` is `false`).
 */
export function firstDifferingPair(
  latest: readonly number[],
  current: readonly number[],
): [number, number] | null {
  const size = Math.max(latest.length, current.length);
  for (let index = 0; index < size; index += 1) {
    const a = latest[index];
    const b = current[index];
    if (a === undefined || b === undefined) return null;
    if (a !== b) return [a, b];
  }
  return null;
}

/** Kotlin L79 `…?.let { (a, b) -> a > b } == true`. */
export function isNewerVersion(latest: readonly number[], current: readonly number[]): boolean {
  const pair = firstDifferingPair(latest, current);
  return pair !== null && pair[0] > pair[1];
}

/** Kotlin `file.length` guard helpers — `size in 1..MAX_UPDATE_BYTES`. */
export function isAllowedSize(size: number | null | undefined): boolean {
  return typeof size === 'number' && size >= 1 && size <= MAX_UPDATE_BYTES;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L32-43  officialUpdateAsset
   ══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin `HttpUrl.pathSegments` — percent-DECODED, empty segments dropped. */
export function pathSegmentsOf(url: URL): string[] {
  const segments: string[] = [];
  for (const raw of url.pathname.split('/')) {
    if (raw === '') continue;
    try {
      segments.push(decodeURIComponent(raw));
    } catch {
      segments.push(raw);
    }
  }
  return segments;
}

/** Kotlin `HttpUrl.port` — the scheme default (443/80) when the URL omits the port. */
export function effectivePort(url: URL): number {
  if (url.port !== '') return Number(url.port);
  return url.protocol === 'http:' ? 80 : 443;
}

/** Kotlin L135-137 `releaseUrl` — `encodedPath.replaceSuffix("latest") + "tag/"` + segment. */
export function releaseUrlFrom(webUrl: string, tag: string): string {
  const parsed = new URL(webUrl);
  const segments = pathSegmentsOf(parsed);
  const withoutLatest = segments.slice(0, segments.length - 1);
  const next = new URL(webUrl);
  next.pathname = `/${withoutLatest.concat('tag', tag).map(encodeURIComponent).join('/')}`;
  return next.toString();
}

/**
 * Only an APK belonging to this exact official release can enter the download path.
 *
 * Kotlin L33-43, transposed guard for guard:
 *   tag regex + 5..200 name length + case-insensitive ".apk" suffix, then the URL must
 *   equal `https://github.com/roxycon-dev/Ciallo-Reader/releases/download/<tag>/<name>`
 *   with no userinfo, query or fragment, and the name must hold no path separator and
 *   no `..`. Any URL parse failure is `runCatching { … }.getOrDefault(false)`.
 */
export function officialUpdateAsset(tag: string, name: string, url: string): boolean {
  if (
    !STABLE_TAG_PATTERN.test(tag) ||
    !(name.length >= 5 && name.length <= 200) ||
    !name.toLowerCase().endsWith('.apk')
  ) {
    return false;
  }
  const expected = `${UPDATE_REPOSITORY}/releases/download/${tag}/${name}`;
  try {
    const parsed = new URL(url);
    const expectedUrl = new URL(expected);
    const expectedSegments = ['roxycon-dev', 'Ciallo-Reader', 'releases', 'download', tag, name];
    const actualSegments = pathSegmentsOf(parsed);
    return (
      parsed.href === expectedUrl.href &&
      actualSegments.length === expectedSegments.length &&
      actualSegments.every((segment, index) => segment === expectedSegments[index]) &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      !name.includes('/') &&
      !name.includes('\\') &&
      !name.includes('..')
    );
  } catch {
    // runCatching { … }.getOrDefault(false)
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L148-152  httpFailure
   ══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin `private fun httpFailure(code: Int)`. */
export function httpFailure(code: number): string {
  switch (code) {
    case 403:
    case 429:
      return `GitHub 接口访问受限或请求过多（HTTP ${code}）`;
    case 404:
      return '尚未找到正式发布版本（HTTP 404）';
    default:
      return `GitHub 请求未成功（HTTP ${code}）`;
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L54  private class CheckFailure
   ══════════════════════════════════════════════════════════════════════════════ */

export class GithubCheckFailure extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'GithubCheckFailure';
    this.reason = reason;
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L154-162  failureReason — the JavaException dispatch needs an adapter
   ══════════════════════════════════════════════════════════════════════════════ */

export type GithubFailureKind =
  | 'CHECK_FAILURE'
  | 'UNKNOWN_HOST'
  | 'TIMEOUT'
  | 'CONNECT'
  | 'SSL'
  | 'JSON'
  | 'UNKNOWN';

/** The platform may tag an error with an explicit kind instead of relying on sniffing. */
const FAILURE_KIND: unique symbol = Symbol('githubUpdateChecker.failureKind');

/** Test/composition seam: force a `failureReason` classification. */
export function withGithubFailureKind(error: Error, kind: GithubFailureKind): Error {
  (error as unknown as Record<symbol, GithubFailureKind>)[FAILURE_KIND] = kind;
  return error;
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  let cursor: unknown = error;
  for (let depth = 0; depth < 5 && cursor != null; depth += 1) {
    const name = cursor instanceof Error ? cursor.name : '';
    const message = cursor instanceof Error ? cursor.message : String(cursor);
    parts.push(`${name} ${message}`);
    cursor = cursor instanceof Error ? (cursor as { cause?: unknown }).cause : undefined;
  }
  return parts.join(' | ').toLowerCase();
}

/**
 * Kotlin L154-162 `when (e)` over `CheckFailure` / `java.net.UnknownHostException` /
 * `java.io.InterruptedIOException` / `java.net.ConnectException` /
 * `javax.net.ssl.SSLException` / `org.json.JSONException` / else.
 *
 * ADAPTATION: JS has no Java exception hierarchy, so the same six buckets are
 * recovered from (a) an explicit `withGithubFailureKind` tag, (b) `error.name`
 * (`SyntaxError` for the `JSON.parse` that replaces `JSONObject(text)`,
 * `AbortError` excluded above because cancellation is rethrown), and (c) the
 * `TypeError`/`Error` messages `fetch` produces — DNS (`ERR_NAME_NOT_RESOLVED`,
 * `ENOTFOUND`, `getaddrinfo`), timeout (`AbortError` raised by the request
 * timeout, `ETIMEDOUT`, `timed out`), TLS (`CERT_`, `SSL`, `ERR_TLS`,
 * `EPROTO`) and refused connections (`ECONNREFUSED`, `ECONNRESET`,
 * `NetworkError`, `Failed to fetch`).
 */
export function classifyFailure(error: unknown): GithubFailureKind {
  if (error instanceof GithubCheckFailure) return 'CHECK_FAILURE';
  const tagged = error as unknown as Record<symbol, GithubFailureKind> | null | undefined;
  const forced = tagged?.[FAILURE_KIND];
  if (forced !== undefined) return forced;
  if (error instanceof SyntaxError) return 'JSON';
  const text = errorText(error);
  if (/name_not_resolved|enotfound|getaddrinfo|dns\b/.test(text)) return 'UNKNOWN_HOST';
  if (/etimedout|timed out|timeout/.test(text)) return 'TIMEOUT';
  if (/ssl|tls|cert_|eproto|err_cert/.test(text)) return 'SSL';
  if (/econnrefused|econnreset|net::err|networkerror|failed to fetch|econnaborted/.test(text)) {
    return 'CONNECT';
  }
  return 'UNKNOWN';
}

/** Kotlin L154-162 `private fun failureReason(e: Exception): String`. */
export function failureReason(error: unknown): string {
  if (error instanceof GithubCheckFailure) return error.reason;
  switch (classifyFailure(error)) {
    case 'CHECK_FAILURE':
      return error instanceof GithubCheckFailure ? error.reason : '无法读取 GitHub 更新信息';
    case 'UNKNOWN_HOST':
      return 'GitHub 域名解析失败';
    case 'TIMEOUT':
      return '连接 GitHub 超时';
    case 'CONNECT':
      return '无法连接 GitHub，请检查网络或系统代理';
    case 'SSL':
      return 'GitHub 安全连接失败';
    case 'JSON':
      return 'GitHub 版本资料格式异常';
    default:
      return '无法读取 GitHub 更新信息';
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L5-7 / L90-121  the injected network port (replaces OkHttpClient)
   ══════════════════════════════════════════════════════════════════════════════ */

/** Per-call OkHttp knobs. `undefined` = client default. */
export interface UpdateHttpRequestOptions {
  /** Kotlin `followRedirects(false)` / `followSslRedirects(false)`. */
  readonly followRedirects?: boolean | undefined;
  /** Kotlin `call.cancel()` from the cancellation coroutine (AppUpdateDownload L51-53). */
  readonly signal?: AbortSignal | undefined;
}

/** Kotlin `Request.Builder().url(url).header(name, value)` — the request being issued. */
export interface UpdateHttpRequest extends HttpRequest {
  /** Kotlin `OkHttpClient.Builder.followRedirects(false)` per call. */
  followRedirects?: boolean | undefined;
  /** Kotlin `executeCancellable()` — cancels the in-flight call. */
  signal?: AbortSignal | undefined;
}

/**
 * Android `OkHttpClient` (Kotlin L48-50, L29-31) → injected transport.
 * `FetchHttpClient` satisfies this shape through `updateHttpClientFrom()`.
 */
export interface UpdateHttpClient {
  request(req: UpdateHttpRequest, options?: UpdateHttpRequestOptions): Promise<HttpResponse>;
}

/** Kotlin L44 `is java.net.UnknownHostException`-style classification escape hatch. */
export function isCancellationError(error: unknown): boolean {
  if (error instanceof GithubCheckFailure) return false;
  return error instanceof Error && (error as { name?: string }).name === 'AbortError';
}

/** Case-insensitive header read (fetch lowercases, OkHttp is case-insensitive). */
export function headerValue(headers: HttpHeader, name: string): string | null {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key] ?? null;
  }
  return null;
}

/** Kotlin `Request.Builder().header("User-Agent", …)` — Kotlin header literal. */
export function userAgent(versionName: string): string {
  return `Ciallo-Reader/${versionName} (${UPDATE_REPOSITORY})`;
}

/**
 * Kotlin L15 `callTimeout(12, TimeUnit.SECONDS)` — the per-call ceiling sent as
 * `HttpRequest.timeoutMs`. The 8 s connect / 10 s read budgets live on the OkHttp
 * builder (Kotlin L48-50) and therefore belong to the injected client's own
 * configuration, which `updateHttpClientFrom()` cannot express: it exposes ONE
 * deadline per request. SKIPPED (2 of the 3 numbers); the 12 s call timeout — the
 * only one that bounds the whole `check()` path — is preserved.
 */
const CALL_TIMEOUT_MS = 12 * 1000;
/** Kotlin L92 `readImportBytes(512 * 1024)` — the release-metadata read ceiling. */
const MAX_RELEASE_METADATA_BYTES = 512 * 1024;
/** Kotlin L93 `Charsets.UTF_8` decode; U+FFFD substitutes so a bad byte is not fatal. */
const UTF8 = new TextDecoder('utf-8');

/**
 * Kotlin L92-93 — bounded metadata body + UTF-8 decode, or the CheckFailure.
 *
 * REVIEW FIX (BUG): only the EMPTY body is a `CheckFailure` in Kotlin. An OVERSIZED body
 * is thrown by `readImportBytes(512 * 1024)` → `ArchiveBudget.copyEntry` →
 * `require(size <= maxEntryBytes …) { "压缩包解压体积超过安全上限" }`
 * (`com/example/data/ImportSafety.kt` L26) — a plain `IllegalArgumentException`, which
 * `failureReason`'s `when` therefore routes to the `else` bucket, `"无法读取 GitHub 更新信息"`.
 * This function used to raise `GithubCheckFailure("GitHub 返回了空数据")` for the oversize
 * case too, so the user was told the response was empty when it was merely too large.
 * Now: empty → CheckFailure (verbatim), oversize → plain `Error` (falls to `else`).
 */
export function decodeReleaseMetadata(body: Uint8Array): string {
  if (body.length === 0) throw new GithubCheckFailure('GitHub 返回了空数据');
  if (body.length > MAX_RELEASE_METADATA_BYTES) {
    // Kotlin: ArchiveBudget's IllegalArgumentException → failureReason `else` branch.
    throw new Error('压缩包解压体积超过安全上限');
  }
  return UTF8.decode(body);
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L45-53  GithubUpdateChecker constructor
   ══════════════════════════════════════════════════════════════════════════════ */

export interface GithubUpdateCheckerOptions {
  /** Kotlin `OkHttpClient`. */
  readonly http: UpdateHttpClient;
  /** Kotlin `com.example.BuildConfig.VERSION_NAME`. */
  readonly versionName: string;
  /** Kotlin default `apiUrl`. */
  readonly apiUrl?: string;
  /** Kotlin default `webUrl`. */
  readonly webUrl?: string;
}

/** Kotlin L116 / L122 / L136 redirect status set, kept as data for the tests. */
export const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Kotlin L122 `response.code !in setOf(301, 302, 303, 307, 308)`. */
export function isRedirectStatus(code: number): boolean {
  return REDIRECT_STATUSES.has(code);
}

/** Public GitHub metadata only; no account token or third-party update mirror. */
export class GithubUpdateChecker {
  private readonly http: UpdateHttpClient;
  private readonly versionName: string;
  private readonly apiUrl: string;
  private readonly webUrl: string;

  constructor(options: GithubUpdateCheckerOptions) {
    this.http = options.http;
    this.versionName = options.versionName;
    this.apiUrl = options.apiUrl ?? 'https://api.github.com/repos/roxycon-dev/Ciallo-Reader/releases/latest';
    this.webUrl = options.webUrl ?? `${UPDATE_REPOSITORY}/releases/latest`;
  }

  /** Kotlin L135-137 `private fun releaseUrl(tag: String)`. */
  releaseUrl(tag: string): string {
    return releaseUrlFrom(this.webUrl, tag);
  }

  /* Kotlin L56-83  suspend fun check(currentVersion: String): UpdateCheckResult */
  async check(currentVersion: string): Promise<UpdateCheckResult> {
    let release: UpdateRelease;
    try {
      release = await this.apiRelease();
    } catch (e) {
      if (isCancellationError(e)) throw e;
      const apiFailure = failureReason(e);
      try {
        const tag = await this.webTag();
        // Our release publishing convention is stable. Archive identity and signing
        // certificates are still verified before installation when API metadata is absent.
        const name = `Ciallo-Reader-${tag}.apk`;
        release = makeUpdateRelease(
          tag,
          this.releaseUrl(tag),
          '',
          { name, url: `${UPDATE_REPOSITORY}/releases/download/${tag}/${name}` },
        );
      } catch (cancelled) {
        if (isCancellationError(cancelled)) throw cancelled;
        const reasons = [...new Set([apiFailure, failureReason(cancelled)])].join('；');
        return { message: `检查更新失败：${reasons}。可稍后重试或打开 GitHub 发布页。` };
      }
    }
    const tag = release.tag;
    const latest = versionParts(tag);
    if (latest === null) {
      return { message: '无法识别 GitHub 发布版本，请打开发布页查看。' };
    }
    const current = versionParts(currentVersion);
    if (current === null) {
      return { message: '无法识别当前版本，请打开 GitHub 发布页查看。' };
    }
    const newer = isNewerVersion(latest, current);
    const display = releaseVersion(tag);
    if (newer) {
      return { message: `发现新版本 ${display}，可下载并安装。`, releaseUrl: this.releaseUrl(tag), release };
    }
    return { message: `当前已是最新版本（GitHub 正式版 ${display}）。` };
  }

  /* Kotlin L85-87  private fun request(url: String) */
  private request(url: string, accept: string, timeoutMs: number): UpdateHttpRequest {
    return {
      url,
      method: 'GET',
      timeoutMs,
      headers: {
        'User-Agent': userAgent(this.versionName),
        Accept: accept,
      },
    };
  }

  /* Kotlin L89-114  private suspend fun apiRelease(transport: OkHttpClient): UpdateRelease */
  private async apiRelease(): Promise<UpdateRelease> {
    const response = await this.http.request(
      this.request(this.apiUrl, 'application/vnd.github+json', CALL_TIMEOUT_MS),
      { followRedirects: true },
    );
    if (!(response.status >= 200 && response.status < 300)) {
      throw new GithubCheckFailure(httpFailure(response.status));
    }
    const data = parseJsonObjectOrThrow(decodeReleaseMetadata(response.body));
    const tag = optStringOrEmpty(data, 'tag_name');
    if (
      optBoolean(data, 'draft') ||
      optBoolean(data, 'prerelease') ||
      stableTag(tag) === null
    ) {
      throw new GithubCheckFailure('GitHub 返回的正式版本资料不完整');
    }
    const assets = optJsonArray(data, 'assets');
    const candidates = GithubUpdateChecker.selectAssets(assets ?? null, tag);
    const apk =
      candidates.find((item) => item.name === `Ciallo-Reader-${tag}.apk`) ??
      singleOrNull(candidates);
    const notes = isNull(data, 'body') ? '' : optStringOrEmpty(data, 'body').slice(0, 24_000);
    return makeUpdateRelease(tag, this.releaseUrl(tag), notes, apk);
  }

  /**
   * Kotlin L99-109 `mapNotNull { index -> … }` over the assets array.
   * Exported so `index.ts` callers and the tests can exercise the selection policy
   * without an HTTP round trip.
   */
  static selectAssets(assets: JsonArray | null, tag: string): UpdateApkAsset[] {
    const out: UpdateApkAsset[] = [];
    const length = assets?.length ?? 0;
    for (let index = 0; index < length; index += 1) {
      const asset = arrayOptJsonObject(assets, index);
      if (asset === null) continue;
      const name = optStringOrEmpty(asset, 'name');
      const url = optStringOrEmpty(asset, 'browser_download_url');
      const size = optLong(asset, 'size', -1);
      if (
        !officialUpdateAsset(tag, name, url) ||
        !(size >= 1 && size <= MAX_UPDATE_BYTES) ||
        assetState(asset) !== 'uploaded'
      ) {
        continue;
      }
      // Kotlin: asset.optString("digest").takeIf { it.isNotEmpty() && it != "null" }
      const rawDigest = optStringOrEmpty(asset, 'digest');
      const digest = rawDigest !== '' && rawDigest !== 'null' ? rawDigest : null;
      if (digest !== null && !ASSET_DIGEST_PATTERN.test(digest)) continue;
      out.push({
        name,
        url,
        size,
        sha256: digest === null ? null : digest.substring(digest.indexOf(':') + 1).toLowerCase(),
      });
    }
    return out;
  }

  /* Kotlin L116-133  private suspend fun webTag(transport: OkHttpClient): String */
  private async webTag(): Promise<string> {
    // /releases/latest redirects to the canonical stable release. Read only
    // that same-repository Location; do not scrape HTML or follow other hosts.
    const request = this.request(this.webUrl, 'text/html', CALL_TIMEOUT_MS);
    const response = await this.http.request(request, { followRedirects: false });
    if (!isRedirectStatus(response.status)) {
      throw new GithubCheckFailure(httpFailure(response.status));
    }
    const base = new URL(this.webUrl);
    const location = headerValue(response.headers, 'Location');
    if (location === null) throw new GithubCheckFailure('GitHub 发布页未提供版本地址');
    let target: URL;
    try {
      target = new URL(location, base);
    } catch {
      throw new GithubCheckFailure('GitHub 发布页返回了非项目版本地址');
    }
    const baseSegments = pathSegmentsOf(base);
    const targetSegments = pathSegmentsOf(target);
    const prefix = base.pathname.slice(0, base.pathname.length - 'latest'.length) + 'tag/';
    if (
      target.protocol !== 'https:' ||
      target.host !== base.host ||
      effectivePort(target) !== effectivePort(base) ||
      !target.pathname.startsWith(prefix) ||
      targetSegments.length !== baseSegments.length + 1 ||
      target.search !== ''
    ) {
      throw new GithubCheckFailure('GitHub 发布页返回了非项目版本地址');
    }
    const last = targetSegments[targetSegments.length - 1];
    if (last === undefined || stableTag(last) === null) {
      throw new GithubCheckFailure('GitHub 发布页版本格式异常');
    }
    return last;
  }
}

/** Kotlin `candidates.singleOrNull()` — `null` unless the list holds exactly one item. */
export function singleOrNull<T>(items: readonly T[]): T | null {
  return items.length === 1 ? (items[0] as T) : null;
}

/** Kotlin L105 `asset.optString("state", "uploaded") != "uploaded"` — explicit, readable form. */
export function assetState(asset: JsonObject): string {
  const state = asset['state'];
  if (state === undefined || state === null) return 'uploaded';
  if (typeof state === 'string') return state;
  if (typeof state === 'number') return String(state);
  if (typeof state === 'boolean') return String(state);
  return JSON.stringify(state);
}

/** Exported for tests: `Regex("[0-9a-f]{64}")` (metadata hashes, lowercase). */
export function isLowerSha256(value: string): boolean {
  return SHA256_LOWER_PATTERN.test(value);
}

/** Exported for tests: `Regex("sha256:[0-9a-fA-F]{64}")` (GitHub asset digests). */
export function isAssetDigest(value: string): boolean {
  return ASSET_DIGEST_PATTERN.test(value);
}
