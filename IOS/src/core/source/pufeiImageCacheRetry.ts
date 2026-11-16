/**
 * Android `com.example.source.PufeiImageCacheRetry.kt` (27 lines, 25 non-blank)
 * → `src/core/source/pufeiImageCacheRetry.ts`.
 *
 * Kotlin class KDoc (line 7), verbatim:
 * `Refresh one cached CDN server error without changing successful image/cache URLs.`
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-5     package/imports                  → header + imports
 *   7       object KDoc                       → header comment (verbatim)
 *   8       `object PufeiImageCacheRetry : Interceptor` → `intercept()` + `wrap()`
 *   9       intercept(chain)                  → intercept()
 *   10      chain.request()                   → request
 *   11      chain.proceed(request)            → proceed(request)
 *   12      request.url.host                  → hostOf(request.url)
 *   13-15   method/host/referer/status guards → the same four guards
 *   16      response.close()                  → dropped (the body is released by the platform client)
 *   17      chain.call().isCanceled()         → `isCanceled()` on the chain
 *   21-23   pufei_retry minute bucket         → setQueryParameter
 *   24-25   re-proceed with Cache-Control     → second `proceed`
 *
 * Skipped lines / adaptations:
 *   - OkHttp `Interceptor` / `Interceptor.Chain` → an injected pair of callbacks
 *     (`proceed(request)` and `isCanceled()`), plus a `wrap(client)` adapter that
 *     turns any `HttpClient` into the retrying client. The bridge layer's
 *     `Interceptor` API has no JS counterpart, so the hook lives here and the
 *     platform composition root installs it.
 *   - `Response.close()` → dropped: the `HttpResponse.body` is an already-read
 *     `Uint8Array`, there is no stream to release.
 *   - `System.currentTimeMillis()` → `Date.now()` (same wall-clock millis).
 *   - `request.url.newBuilder().setQueryParameter(...)` → `URL` + `searchParams.set`,
 *     which replaces an existing `pufei_retry` exactly like OkHttp's
 *     `setQueryParameter`.
 */

import type { HttpClient, HttpHeader, HttpRequest, HttpResponse } from '@platform/interfaces';

export const PUFEI_IMAGE_HOST_SUFFIX = '.6wm.top';
export const PUFEI_IMAGE_REFERER = 'https://manhuafree.com/';
export const PUFEI_RETRY_PARAM = 'pufei_retry';

export interface InterceptorChain {
  /** Kotlin `chain.request()`. */
  readonly request: HttpRequest;
  /** Kotlin `chain.proceed(request)`. */
  proceed(request: HttpRequest): Promise<HttpResponse>;
  /** Kotlin `chain.call().isCanceled()`. */
  isCanceled(): boolean;
}

/**
 * Kotlin `Request.header(name)` — OkHttp's `Headers` is a case-**insensitive**
 * multimap (`firstOrNull { it.name.equals(name, ignoreCase = true) }`). `HttpHeader`
 * is a plain `Record<string, string>`, so the lookup has to fold the case itself or a
 * request built with `referer` instead of `Referer` would silently skip the retry.
 */
function headerOf(headers: HttpHeader | undefined, name: string): string | undefined {
  if (headers === undefined) return undefined;
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

/**
 * Kotlin `Request.Builder.header(name, value)` — OkHttp's `Headers.Builder.set`
 * drops **every** existing value for that name (case-insensitively) before adding one,
 * so a pre-existing `cache-control` must not survive next to the new `Cache-Control`.
 */
function withHeader(headers: HttpHeader | undefined, name: string, value: string): HttpHeader {
  const lower = name.toLowerCase();
  const out: HttpHeader = {};
  for (const [key, existing] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== lower) out[key] = existing;
  }
  out[name] = value;
  return out;
}

/**
 * Refresh one cached CDN server error without changing successful image/cache URLs.
 */
export function intercept(chain: InterceptorChain): Promise<HttpResponse> {
  const request = chain.request;
  return chain.proceed(request).then((response) => {
    const host = hostOf(request.url);
    if (
      (request.method ?? 'GET') !== 'GET' ||
      !host.endsWith(PUFEI_IMAGE_HOST_SUFFIX) ||
      headerOf(request.headers, 'Referer') !== PUFEI_IMAGE_REFERER ||
      response.status < 500 ||
      response.status > 599
    ) {
      return response;
    }
    // Kotlin `response.close()` — nothing to release, the body is already read.
    if (chain.isCanceled()) throw new Error('Canceled');
    // A fixed URL can keep serving an edge's cached 502, even after ordinary
    // retries. Preserve path and headers; a minute bucket avoids random URLs
    // and lets concurrent requests share the refreshed edge cache.
    const refreshedUrl = new URL(request.url);
    refreshedUrl.searchParams.set(PUFEI_RETRY_PARAM, String(Math.floor(Date.now() / 60_000)));
    const headers = withHeader(request.headers, 'Cache-Control', 'no-cache');
    return chain.proceed({ ...request, url: refreshedUrl.toString(), headers });
  });
}

/**
 * Adapter form: install the retry on an `HttpClient`. Kotlin registers the
 * object with `OkHttpClient.Builder.addNetworkInterceptor(PufeiImageCacheRetry)`.
 */
export function wrap(client: HttpClient): HttpClient {
  return {
    async request(req: HttpRequest): Promise<HttpResponse> {
      return intercept({
        request: req,
        proceed: (next) => client.request(next),
        isCanceled: () => false,
      });
    },
  };
}

/** Kotlin `request.url.host` — hostname without IPv6 brackets is not needed here. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}