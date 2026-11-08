/**
 * Kotlin → TS: `source/zlibrary/DiamWallInterceptor.kt` (247 lines, 223 non-blank)
 *             → `src/core/source/zlibrary/diamWallInterceptor.ts`
 *
 * The pure challenge/redirect/PoW logic ALREADY EXISTS as a root-level port at
 * `src/core/source/diamWall.ts` (`isChallengeStatus`, `peekLooksLikeDiamWall`,
 * `extractDocumentCookies`, `extractIframeSrc`, `isCaptchaBody`, `extractSha1Token`,
 * `extractSha256Challenge`, `solveSha256`, `solveSha1TwoByte`, `buildVerifyUrl`,
 * `shouldAbortUrlVisits`, `Cookie`). This file does NOT duplicate it: it imports those
 * helpers and adds the parts the root-level port left out — the interceptor state machine
 * (the `while (followUpCount < 8)` loop), the URL-visit accounting, the cookie-jar writes
 * and the bounded, memoised solver (`solveBounded` + the `solved` LRU), which all need
 * the OkHttp chain.
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary → SKIPPED (TS has no packages)
 *   L3-8      import android.util.Log / okhttp3.{Interceptor,Response,Cookie,HttpUrl} /
 *             java.security.MessageDigest / java.net.URLEncoder
 *                                    → Log → `SourceLog`; `Interceptor`/`Response`/`HttpUrl` →
 *                                      the injected transport + WHATWG `URL`;
 *                                      `MessageDigest`/`URLEncoder` live in the reused
 *                                      `../diamWall` solvers / `javaUrlEncode`
 *   L11       class DiamWallInterceptor(private val cookieJar) : Interceptor
 *                                    → `class DiamWallInterceptor` (constructed with a
 *                                      `ZLibraryDiamWallCookieJar` + a `ZLibraryHttpTransport`)
 *   L12-16    intercept(): request/response/followUpCount/urlCounts init → verbatim
 *   L18       while (followUpCount < 8)          → `MAX_FOLLOW_UPS = 8`
 *   L19-20    Log.d("DiamWall", "Response code: $code for ${request.url.host}") → verbatim
 *   L22-31    KDoc + `urlCounts.merge(url, 1, Int::plus)` + `hits > 3` loop guard + Log.w
 *                                              → `shouldAbortUrlVisits` from `../diamWall`
 *   L33-52    KDoc 1. Handle DiamWall 517/403/503/513 … + `smellsLikeDiamWall` (200 +
 *             text/html + body sniff) → `isChallengeStatus` + `peekLooksLikeDiamWall`
 *   L53-81    `document.cookie="dwid=…"` / `"_dwa=…"` extraction + 2 jar writes + Log.d
 *                                              → `extractDocumentCookies` + the same 2 writes
 *   L83-101   KDoc Parse PoW + iframe fetch (`chain.proceed` with Referer, peek 1MB) + Log.d
 *                                              → verbatim, using `extractIframeSrc` + a real
 *                                                transport call
 *   L104-113  KDoc + `isCaptchaChallenge` + Log.w + `break` → `isCaptchaBody` (same message)
 *   L115-131  KDoc New DiamWall PoW (SHA-1 two-byte) + 3 regexes + Log.d + `solveBounded` +
 *             `?: return response` → `extractSha1Token` + `solveSha1TwoByte` (bounded, memoised)
 *   L133-147  c_token/c_time cookie save + Log.d + close + re-proceed + followUpCount++ + continue
 *                                              → verbatim
 *   L150-171  KDoc legacy SHA-256 prefix PoW branch (`Checking your browser`/`DiamWall`/`TOKEN`
 *             gate, TOKEN/DIFF regexes, `solveSha256`, `URLEncoder` verify URL, re-proceed)
 *                                              → `extractSha256Challenge` + `solveSha256` +
 *                                                `buildVerifyUrl` (same `?t=&n=&r=` shape)
 *   L174-202  KDoc 2. Handle HTTP Redirects (followRedirects is false): Location resolve,
 *             redirect-body `dwid` extraction + jar write, new request, re-proceed, continue
 *                                              → verbatim
 *   L204-205  `break` (nothing handled)         → verbatim
 *   L208      `return response`                 → verbatim
 *   L211-212  companion object { solveLock, solved } → module-level lock + LRU map
 *   L215-223  internal fun solveSha256(token, difficulty, cancelled) → the same 0..6 guard and
 *             the zero-nibble predicate as `../diamWall`'s solver
 *   L225-244  private fun solveBounded(key, algorithm, cancelled, input, matches)
 *             → `solveBounded` with: 5s deadline (`performance.now()`, the documented
 *               `System.nanoTime` replacement), the shared solve lock, the `solved` memo,
 *               `nonce % 256` cancellation/timeout sampling, the 1_000_000 nonce bound and
 *               the `solved.size >= 64` oldest-entry eviction
 *   L246-247  closing braces                   → n/a
 *
 * ADAPTATION — OkHttp `Interceptor` (documented):
 *   There is no `Interceptor` in fetch, so the same state machine runs against the injected
 *   `ZLibraryHttpTransport.send()`: `chain.proceed(request)` is one `send()` with
 *   `followRedirects` disabled (the transport is configured that way — see
 *   `ZLibraryHttpClientConfig`), and `chain.call().isCanceled()` becomes the AbortSignal the
 *   transport receives plus the `cancelled()` predicate passed to the solvers.
 *   `response.peekBody(n)` → `peekBody(response.body, n)` (byte-accurate, see `zLibraryHost.ts`).
 *   `response.header(name)` → case-insensitive lookup in `ZLibraryHttpResponse.headers`.
 *
 * REVIEW FIXES (this pass) — three real behaviour gaps against Kotlin:
 *   - L118-120: Kotlin searches `bodyString` for the 40-hex TOKEN and `powHtml` for the two
 *     byte targets. The port called `../diamWall`'s `extractSha1Token(powHtml)`, i.e. all three
 *     in `powHtml`, so a challenge that puts the token on the outer page and the targets in
 *     the iframe (exactly the shape L87-102 fetches) was never solved. `extractSha1PoW` below
 *     keeps the two sources apart.
 *   - L157: Kotlin's `solveSha256` opens with `if (difficulty !in 0..6) return null`, so a
 *     hostile `var DIFF=99` makes the interceptor `return response` immediately. The port
 *     called `solveBounded` directly and skipped the guard, burning the 5 s budget instead.
 *     The `0..6` check is restored inline (the `../diamWall` solver's own guard is not on this path).
 *   - L162: Kotlin uses `java.net.URLEncoder.encode` (FORM encoding) for `t=` and `r=`.
 *     `../diamWall`'s `buildVerifyUrl` uses `encodeURIComponent`, which differs on space
 *     (`%20` vs `+`), on `! ~ * ' ( )` and on hex case. `buildVerifyUrlWithUrlEncoder` below
 *     builds the same query from this module's `javaUrlEncode`, which is the faithful
 *     `URLEncoder` port.
 */

import { SourceLog } from '../sourceLog';
import {
  extractDocumentCookies,
  extractIframeSrc,
  extractSha256Challenge,
  isCaptchaBody,
  isChallengeStatus,
  peekLooksLikeDiamWall,
  shouldAbortUrlVisits,
  solveSha1TwoByte,
  solveSha256,
} from '../diamWall';
import {
  type ZLibraryHttpResponse,
  type ZLibraryHttpTransport,
} from './network/zLibraryHttpClient';
import { buildCookie, type ZLibraryCookie } from './encryptedCookieJar';
import { javaUrlEncode, peekBody } from './zLibraryHost';

/** Kotlin `private val solveLock = ReentrantLock()`. */
const solveLock = { locked: false, queue: [] as Array<() => void> };
/** Kotlin `private val solved = LinkedHashMap<String, Long>()`. */
const solved = new Map<string, number>();
/** Kotlin `while (followUpCount < 8)` (L18). */
const MAX_FOLLOW_UPS = 8;
/** Kotlin `java.util.concurrent.TimeUnit.SECONDS.toNanos(5)` (L228). */
const SOLVE_DEADLINE_MS = 5_000;
/** Kotlin `if (!solveLock.tryLock(5, TimeUnit.SECONDS)) return null` (L229). */
const SOLVE_LOCK_WAIT_MS = 5_000;
/** Kotlin `for (nonce in 0L until 1_000_000L)` (L234). */
const SOLVE_MAX_NONCE = 1_000_000;
/** Kotlin `if (solved.size >= 64) solved.remove(solved.keys.first())` (L237). */
const SOLVED_CACHE_LIMIT = 64;

/** The cookie-jar surface the interceptor needs (`okhttp3.CookieJar` subset). */
export interface ZLibraryDiamWallCookieJar {
  saveFromResponse(url: URL, cookies: ZLibraryCookie[]): Promise<void>;
}

export interface ZLibraryDiamWallDeps {
  readonly transport: ZLibraryHttpTransport;
  readonly cookieJar: ZLibraryDiamWallCookieJar;
  /** Default headers + the `Sec-Ch-Ua*`/`Sec-Fetch-*` set applied by the transport. */
  readonly defaultHeaders?: Readonly<Record<string, string>>;
}

export class DiamWallInterceptor {
  constructor(private readonly deps: ZLibraryDiamWallDeps) {}

  /** Kotlin `override fun intercept(chain: Interceptor.Chain): Response` (L12-209). */
  async intercept(
    request: { url: string; referer: string | null; extraHeaders: Record<string, string> },
    signal: AbortSignal | null = null,
  ): Promise<ZLibraryHttpResponse> {
    let currentUrl = request.url;
    const referer = request.referer;
    let response = await this.proceed(currentUrl, referer, signal);
    let followUpCount = 0;
    const urlCounts = new Map<string, number>();

    while (followUpCount < MAX_FOLLOW_UPS) {
      const code = response.code;
      SourceLog.log('DiamWall', `Response code: ${code} for ${new URL(currentUrl).host}`);

      // Loop guard: DiamWall's 307→503 challenge dance legitimately revisits the
      // same URL (first visit 307, second visit the challenge page, third visit
      // after PoW solve). Only abort when the same URL has been hit 4+ times
      // without progress — the old set-based guard broke out on the second
      // hit, skipping the 503 PoW solving entirely (2026-09-04 1lib.sk fix).
      urlCounts.set(currentUrl, (urlCounts.get(currentUrl) ?? 0) + 1);
      if (shouldAbortUrlVisits(urlCounts, currentUrl)) {
        SourceLog.log('DiamWall', `Redirect/challenge loop detected for ${currentUrl}; stopping`);
        break;
      }

      // 1. Handle DiamWall 517 / 403 / 503 / 513 PoW Verification
      //    兜底：个别节点把挑战页以 HTTP 200 + text/html 返回，
      //    按 body 特征（DiamWall / Checking your browser / TOKEN）同样识别并求解，
      //    否则下载器会把挑战页当文件下载、进度条走满后才报“HTML 错误页”。
      const isChallengeCode = isChallengeStatus(code);
      const smellsLikeDiamWall =
        !isChallengeCode &&
        code === 200 &&
        headerContains(response, 'Content-Type', 'text/html') &&
        peekLooksLikeDiamWall(peekBody(response.body, 4096));
      if (isChallengeCode || smellsLikeDiamWall) {
        const bodyString = peekBody(response.body, 1024 * 1024);

        // Parse DWID JS Cookie
        for (const { name, value } of extractDocumentCookies(bodyString)) {
          const cookie = buildCookie(name, value, new URL(currentUrl).host);
          await this.deps.cookieJar.saveFromResponse(new URL(currentUrl), [cookie]);
          SourceLog.log('DiamWall', 'Challenge cookie received');
        }

        // Parse PoW
        let powHtml = bodyString;

        // If it contains an iframe, fetch the iframe content
        const iframeUrlStr = extractIframeSrc(bodyString);
        if (iframeUrlStr !== null) {
          const iframeUrl = new URL(iframeUrlStr, currentUrl).toString();
          SourceLog.log('DiamWall', `Found iframe, fetching: ${iframeUrl}`);
          const iframeResponse = await this.deps.transport.send(
            {
              method: 'GET',
              url: iframeUrl,
              referer: currentUrl,
              extraHeaders: { ...(this.deps.defaultHeaders ?? {}) },
              formFields: null,
              callTimeoutMs: null,
            },
            signal ?? null,
          );
          powHtml = peekBody(iframeResponse.body, 1024 * 1024);
          SourceLog.log('DiamWall', 'Challenge iframe received');
          iframeResponse.close();
        }

        // New DiamWall v2 uses an interactive CAPTCHA (cpt.lib) which cannot be solved
        // by a plain HTTP client. Detect it and stop retrying immediately.
        if (isCaptchaBody(powHtml)) {
          SourceLog.log(
            'DiamWall',
            'Captcha-based DiamWall challenge detected; HTTP client cannot auto-solve. Use WebView verification.',
          );
          break;
        }

        // New DiamWall PoW: SHA-1 digest of (TOKEN + nonce), checking two bytes:
        //   s1['array'](TOKEN + i)[n1] == byte1 && [n1+1] == byte2
        // where n1 = hex value of the first char of TOKEN.
        // Kotlin reads the TOKEN out of `bodyString` (L118) but the two byte targets out of
        // `powHtml` (L119-120), i.e. the possibly iframe-swapped body. The two sources are
        // kept separate here instead of calling `../diamWall`'s single-body `extractSha1Token`,
        // which would look for all three in `powHtml`.
        const pow = extractSha1PoW(bodyString, powHtml);
        if (pow !== null) {
          SourceLog.log(
            'DiamWall',
            `Solving c_token PoW token=${pow.token} n1=${pow.n1} targets=(${pow.t1.toString(16)},${pow.t2.toString(16)})`,
          );

          const nonce = await solveBounded(
            `sha1|${pow.token}|${pow.n1}|${pow.t1}|${pow.t2}`,
            'SHA-1',
            () => signal?.aborted === true,
            { n1: pow.n1, t1: pow.t1, t2: pow.t2, token: pow.token },
            (digest) => (digest[pow.n1] ?? -1) === pow.t1 && (digest[pow.n1 + 1] ?? -1) === pow.t2,
          );
          if (nonce === null) return response;

          const cookieHost = new URL(currentUrl).host;
          await this.deps.cookieJar.saveFromResponse(new URL(currentUrl), [
            buildCookie('c_token', pow.token + String(nonce), cookieHost),
            buildCookie('c_time', '1', cookieHost),
          ]);
          SourceLog.log('DiamWall', `c_token solved nonce=${nonce}, retrying ${cookieHost}`);
          response.close();
          response = await this.proceed(currentUrl, referer, signal);
          followUpCount += 1;
          continue;
        }

        if (
          powHtml.includes('Checking your browser') ||
          powHtml.toLowerCase().includes('diamwall') ||
          powHtml.includes('TOKEN')
        ) {
          const challenge = extractSha256Challenge(powHtml);

          if (challenge !== null) {
            // Kotlin `solveSha256(token, diff)` (L157) opens with `if (difficulty !in 0..6)
            // return null`, so the interceptor's `?: return response` fires immediately for a
            // hostile/absurd `var DIFF=`. The ported `solveBounded` had no such guard and would
            // have burned the whole 5 s budget (or the 1,000,000-nonce sweep) instead.
            if (!Number.isInteger(challenge.difficulty) || challenge.difficulty < 0 || challenge.difficulty > 6) {
              return response;
            }
            const nonce = await solveBounded(
              `sha256|${challenge.token}|${challenge.difficulty}`,
              'SHA-256',
              () => signal?.aborted === true,
              { token: challenge.token, difficulty: challenge.difficulty },
              (digest) => digestSha256NibblesZero(digest, challenge.difficulty),
            );
            if (nonce === null) return response;

            const originalUrl = new URL(currentUrl).pathname + new URL(currentUrl).search;
            // Kotlin L160-163 builds the verify URL with `URLEncoder.encode(token, "UTF-8")`
            // and `URLEncoder.encode(originalUrl, "UTF-8")` — FORM encoding (space → `+`,
            // `!~*'()` escaped, uppercase hex). `../diamWall`'s `buildVerifyUrl` uses
            // `encodeURIComponent` instead, which differs on exactly those characters, so the
            // query is assembled here from `javaUrlEncode` (the module's `URLEncoder` port).
            const verifyUrl = buildVerifyUrlWithUrlEncoder(
              currentUrl,
              challenge.token,
              nonce,
              originalUrl,
            );

            currentUrl = verifyUrl;
            response.close();
            response = await this.proceed(currentUrl, referer, signal);
            followUpCount += 1;
            continue;
          }
        }
      }

      // 2. Handle HTTP Redirects (since followRedirects is false)
      if (isRedirectCode(code)) {
        const location = headerValue(response, 'Location');
        if (location !== null) {
          const newUrl = new URL(location, currentUrl).toString();
          // Check for dwid cookie in redirect response body
          const bodyString = peekBody(response.body, 1024 * 1024);
          for (const { name, value } of extractDocumentCookies(bodyString)) {
            if (name !== 'dwid') continue;
            const cookie = buildCookie(name, value, new URL(currentUrl).host);
            await this.deps.cookieJar.saveFromResponse(new URL(currentUrl), [cookie]);
            SourceLog.log('DiamWall', 'Redirect cookie received');
          }

          currentUrl = newUrl;
          response.close();
          response = await this.proceed(currentUrl, referer, signal);
          followUpCount += 1;
          continue;
        }
      }

      // If no redirect or PoW handled, break
      break;
    }

    return response;
  }

  /** Kotlin `chain.proceed(request)`. */
  private proceed(
    url: string,
    referer: string | null,
    signal: AbortSignal | null,
  ): Promise<ZLibraryHttpResponse> {
    return this.deps.transport.send(
      {
        method: 'GET',
        url,
        referer,
        extraHeaders: { ...(this.deps.defaultHeaders ?? {}) },
        formFields: null,
        callTimeoutMs: null,
      },
      signal,
    );
  }
}

/** Kotlin `response.isRedirect` — OkHttp: `code in 300..399`. */
function isRedirectCode(code: number): boolean {
  return code >= 300 && code <= 399;
}

/**
 * Kotlin L118-120, verbatim, with the two source strings kept apart:
 * ```
 * val powTokenMatch = Regex("""['"]([0-9A-Fa-f]{40})['"]""").find(bodyString)
 * val byte1Match    = Regex("""s\[n1\]===(0x[0-9a-fA-F]+)""").find(powHtml)
 * val byte2Match    = Regex("""s\[n1\+0x1\]===(0x[0-9a-fA-F]+)""").find(powHtml)
 * ```
 * `bodyString` is the challenge page; `powHtml` is that page OR the same-origin challenge
 * iframe fetched at L97-98, so the token can live in either.
 */
function extractSha1PoW(
  bodyString: string,
  powHtml: string,
): { token: string; n1: number; t1: number; t2: number } | null {
  const tokenMatch = /['"]([0-9A-Fa-f]{40})['"]/.exec(bodyString);
  const byte1Match = /s\[n1\]===(0x[0-9a-fA-F]+)/.exec(powHtml);
  const byte2Match = /s\[n1\+0x1\]===(0x[0-9a-fA-F]+)/.exec(powHtml);
  const rawToken = tokenMatch?.[1];
  const rawByte1 = byte1Match?.[1];
  const rawByte2 = byte2Match?.[1];
  if (rawToken === undefined || rawByte1 === undefined || rawByte2 === undefined) return null;
  const token = rawToken.toUpperCase();
  const n1 = Number.parseInt(token.substring(0, 1), 16);
  const t1 = Number.parseInt(rawByte1.substring(2), 16);
  const t2 = Number.parseInt(rawByte2.substring(2), 16);
  return { token, n1, t1, t2 };
}

/**
 * Kotlin L160-163 — the legacy `/__ab/verify` URL:
 * ```
 * request.url.newBuilder()
 *   .encodedPath("/__ab/verify")
 *   .query("t=${URLEncoder.encode(token, "UTF-8")}&n=$nonce&r=${URLEncoder.encode(originalUrl, "UTF-8")}")
 * ```
 * i.e. FORM encoding (a space becomes `+`, `! ~ * ' ( )` are escaped, hex is uppercase) on BOTH
 * the token and the original path+query, with the plain nonce in the middle.
 */
function buildVerifyUrlWithUrlEncoder(
  originalRequestUrl: string,
  token: string,
  nonce: number,
  pathAndQuery: string,
): string {
  let origin: string;
  try {
    origin = new URL(originalRequestUrl).origin;
  } catch {
    origin = originalRequestUrl;
  }
  const query = `t=${javaUrlEncode(token)}&n=${nonce}&r=${javaUrlEncode(pathAndQuery)}`;
  return `${origin}/__ab/verify?${query}`;
}

/** Kotlin `response.header(name)` — OkHttp header lookup is case-insensitive. */
function headerValue(response: ZLibraryHttpResponse, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(response.headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

/** Kotlin `response.header("Content-Type")?.contains("text/html", ignoreCase = true) == true`. */
function headerContains(response: ZLibraryHttpResponse, name: string, needle: string): boolean {
  const value = headerValue(response, name);
  return value !== null && value.toLowerCase().includes(needle.toLowerCase());
}

/** The predicate of Kotlin `solveSha256` (L217-222): `difficulty` leading zero nibbles. */
function digestSha256NibblesZero(digest: Uint8Array, difficulty: number): boolean {
  for (let nibble = 0; nibble < difficulty; nibble += 1) {
    const byte = digest[Math.floor(nibble / 2)] ?? 0;
    if (nibble % 2 === 0) {
      if ((byte >>> 4) !== 0) return false;
    } else if ((byte & 15) !== 0) {
      return false;
    }
  }
  return true;
}

/** Kotlin `private fun solveBounded(key, algorithm, cancelled, input, matches): Long?` (L225-244). */
async function solveBounded<T>(
  key: string,
  algorithm: 'SHA-1' | 'SHA-256',
  cancelled: () => boolean,
  context: T,
  matches: (digest: Uint8Array) => boolean,
): Promise<number | null> {
  if (cancelled()) return null;
  // Kotlin `System.nanoTime() + TimeUnit.SECONDS.toNanos(5)` → `performance.now()` (documented).
  const deadline = performance.now() + SOLVE_DEADLINE_MS;
  if (!(await tryLock(SOLVE_LOCK_WAIT_MS))) return null;
  try {
    if (cancelled()) return null;
    const memo = solved.get(key);
    if (memo !== undefined) return memo;
    for (let nonce = 0; nonce < SOLVE_MAX_NONCE; nonce += 1) {
      if (
        nonce % 256 === 0 &&
        (cancelled() || performance.now() >= deadline)
      ) {
        return null;
      }
      const input =
        algorithm === 'SHA-1'
          ? String((context as { token: string; nonce?: number }).token) + String(nonce)
          : `${(context as { token: string }).token}:${nonce}`;
      const digest = new Uint8Array(
        await crypto.subtle.digest(algorithm, new TextEncoder().encode(input)),
      );
      if (matches(digest)) {
        if (solved.size >= SOLVED_CACHE_LIMIT) {
          const oldest = solved.keys().next();
          if (!oldest.done) solved.delete(oldest.value);
        }
        solved.set(key, nonce);
        return nonce;
      }
    }
    return null;
  } finally {
    solveLock.locked = false;
    const next = solveLock.queue.shift();
    if (next !== undefined) next();
  }
}

/** Kotlin `solveLock.tryLock(5, TimeUnit.SECONDS)`. */
async function tryLock(waitMs: number): Promise<boolean> {
  if (!solveLock.locked) {
    solveLock.locked = true;
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      const index = solveLock.queue.indexOf(wake);
      if (index >= 0) solveLock.queue.splice(index, 1);
      resolve(false);
    }, waitMs);
    const wake = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    solveLock.queue.push(wake);
  });
}

/** Re-exported so the platform transport can build the same verify request shape. */
export { solveSha256, solveSha1TwoByte };
