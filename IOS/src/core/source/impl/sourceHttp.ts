/**
 * Injected HTTP transport for the ported book sources.
 *
 * Kotlin counterparts: NONE (single new adaptation module shared by the six
 * `com.example.source.impl.*` ports). It replaces the OkHttp surface that
 * `MangaDexSource.kt` / `JsonBookSource.kt` / `AutoNovelSource.kt` /
 * `IxdzsSource.kt` / `Wenku8LibrarySource.kt` share:
 *
 *   OkHttpClient / Request.Builder        → SourceHttpClient + HttpRequest
 *   client.newCall(request)               → http.request(req)
 *   .executeCancellable()                 → http.request(req, signal)
 *   response.isSuccessful                 → res.status >= 200 && res.status < 300
 *   response.code                         → res.status
 *   response.header(name)                 → res.headers[name] (lowercased keys)
 *   response.body?.byteStream()           → res.body (already a Uint8Array)
 *   readImportBytes(2 * 1024 * 1024)      → readBounded(res.body, 2 * 1024 * 1024)
 *   response.close()                      → dropped (no handle to release)
 *   SystemProxyResolver                   → out of scope (another module owns it);
 *                                            the caller injects a pre-configured client
 *   JsSourceProxy.failoverClient(...)     → injected failover client, optional
 *
 * No DOM/React/Capacitor imports: the only global touched is `fetch`, exactly
 * like the pre-existing `src/core/source/networkCalls.ts`.
 */

import type { HttpClient, HttpHeader, HttpRequest, HttpResponse } from '@platform/interfaces';

export type { HttpClient, HttpHeader, HttpRequest, HttpResponse };

/** Byte ceiling mirroring `readImportBytes(2 * 1024 * 1024)` call sites. */
export const MAX_SOURCE_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Kotlin `readImportBytes(max)` — a body over the budget aborts the request.
 *
 * The message is the one `ImportSafety.kt:26` throws from
 * `ArchiveBudget.copyEntry` (`require(size <= maxEntryBytes && …) { "压缩包解压体积超过安全上限" }`),
 * i.e. an `IllegalArgumentException`. Every ported call site reaches it through the
 * Kotlin `catch (e: Exception)` arm, so the *text* is user-visible and must match.
 */
export class SourceBodyTooLargeError extends Error {
  constructor() {
    super('压缩包解压体积超过安全上限');
    this.name = 'SourceBodyTooLargeError';
  }
}

/** Kotlin `readImportBytes(16 * 1024 * 1024)` (keyword dictionary refresh). */
export const MAX_IMPORT_BODY_BYTES = 16 * 1024 * 1024;

/** Kotlin `readImportBytes(1024 * 1024)` (keyword metadata lookups). */
export const MAX_METADATA_BODY_BYTES = 1024 * 1024;

/**
 * Kotlin `java.io.IOException` from the transport. OkHttp reports transport
 * failures (DNS, TLS, connect, timeout, cancellation) as `IOException`, and
 * every `catch (e: java.io.IOException)` branch in the ported sources maps to
 * `SourceException.NetworkError`. `fetch` rejects with a bare `TypeError`, so
 * the injected client contract is: throw this for transport-level failures.
 */
export class SourceNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SourceNetworkError';
  }
}

/** Mirror of Android's `readImportBytes` bound check on an already-read body. */
export function readBounded(body: Uint8Array, maxBytes: number): Uint8Array {
  if (body.byteLength > maxBytes) {
    // Kotlin `require(size <= maxEntryBytes && total <= maxTotalBytes)` — an
    // *exactly* maxBytes-sized entry is fine, one more byte is not.
    throw new SourceBodyTooLargeError();
  }
  return body;
}

const UTF8 = new TextDecoder('utf-8');

/** Kotlin `bytes.toString(Charsets.UTF_8)`. */
export function decodeUtf8(body: Uint8Array): string {
  return UTF8.decode(body);
}

/**
 * Kotlin `String(bytes, Charset.forName(charset))` with the `catch` fallback to
 * UTF-8. `TextDecoder` rejects unknown labels with a `RangeError`.
 */
export function decodeCharset(body: Uint8Array, charset: string | null | undefined): string {
  if (charset == null || charset.trim() === '') {
    return decodeUtf8(body);
  }
  try {
    return new TextDecoder(charset.trim().toLowerCase()).decode(body);
  } catch {
    return decodeUtf8(body);
  }
}

/** Kotlin `response.header("X")` — header names are case-insensitive. */
export function headerOf(response: HttpResponse, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(response.headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

/** Kotlin `Response.isSuccessful`. */
export function isSuccessful(response: HttpResponse): boolean {
  return response.status >= 200 && response.status < 300;
}

/** Kotlin `body.toRequestBody(mediaType)`. */
export interface SourceRequestInit {
  method?: HttpRequest['method'];
  headers?: HttpHeader;
  body?: string | Uint8Array;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

/**
 * Kotlin `client.newCall(request).executeCancellable()`.
 * `maxBytes` mirrors the `readImportBytes(...)` wrapper a call site puts around the
 * response body. `MangaDexSource.kt` never wraps its bodies (it calls
 * `response.body?.string()` at L189 / L351 / L841), so its call sites pass
 * `Number.POSITIVE_INFINITY` to stay byte-for-byte unbounded like the Kotlin side.
 */
export async function executeSourceRequest(
  http: HttpClient,
  url: string,
  init: SourceRequestInit = {},
): Promise<HttpResponse> {
  const req: HttpRequest = {
    url,
    method: init.method ?? 'GET',
  };
  if (init.headers !== undefined) req.headers = init.headers;
  if (init.body !== undefined) req.body = init.body;
  if (init.timeoutMs !== undefined) req.timeoutMs = init.timeoutMs;
  const response = await http.request(req);
  readBounded(response.body, init.maxBytes ?? MAX_SOURCE_BODY_BYTES);
  return response;
}

/**
 * Kotlin `response.body?.byteStream()?.use { it.readImportBytes(n).toString(UTF_8) } ?: ""`.
 * A missing/empty body is an empty string in every ported call site.
 */
export function bodyText(response: HttpResponse, maxBytes = MAX_SOURCE_BODY_BYTES): string {
  if (response.body.byteLength === 0) return '';
  return decodeUtf8(readBounded(response.body, maxBytes));
}

/**
 * `fetch`-backed default client — Kotlin counterpart is every
 * `SharedHttpTransport.builder()…build()` default argument in the impl files.
 * Injected clients are preferred; this exists so the ports keep the Kotlin
 * "default client when the caller passes none" shape.
 */
export function createFetchSourceHttpClient(): HttpClient {
  return {
    async request(req: HttpRequest): Promise<HttpResponse> {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (req.timeoutMs !== undefined && req.timeoutMs > 0) {
        timer = setTimeout(() => {
          controller.abort();
        }, req.timeoutMs);
      }
      try {
        const init: RequestInit = {
          method: req.method ?? 'GET',
          headers: req.headers ?? {},
          signal: controller.signal,
        };
        if (req.body !== undefined) {
          init.body =
            typeof req.body === 'string' ? req.body : (req.body as unknown as BodyInit);
        }
        const res = await fetch(req.url, init);
        const body = new Uint8Array(await res.arrayBuffer());
        const headers: HttpHeader = {};
        res.headers.forEach((value, name) => {
          headers[name] = value;
        });
        return {
          status: res.status,
          headers,
          body,
          url: res.url !== '' ? res.url : req.url,
        };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}

/**
 * Kotlin `client ?: JsSourceProxy.failoverClient(app, SharedHttpTransport…)`.
 * The failover wrapper lives in the JS-source module, so it is an injected
 * factory here; when absent the plain client is used.
 */
export type FailoverClientFactory = (base: HttpClient) => HttpClient;

export function resolveHttpClient(
  injected: HttpClient | null | undefined,
  fallback?: FailoverClientFactory,
): HttpClient {
  const base = injected ?? createFetchSourceHttpClient();
  return fallback != null ? fallback(base) : base;
}

/**
 * Kotlin `Mutex.withLock { … }` — serialises the async critical section that
 * guards LRU caches and single-flight metadata fetches.
 */
export class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();

  async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => gate);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * Kotlin `android.util.LruCache<K, V>(maxSize)` with insertion-order eviction
 * (LinkedHashMap access-order == false, the Android default).
 *
 * 2026-10-06 review fix: eviction now accounts for the entry WEIGHT (Kotlin
 * `sizeOf`) — previously the loop compared the raw entry count against
 * maxSize, which broke the 4 MiB text cache in AutoNovelSource (weight
 * `length * 2` was computed but never enforced).
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(
    private readonly maxSize: number,
    private readonly sizeOf: (key: K, value: V) => number = () => 1,
  ) {}

  private totalWeight = 0;

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  put(key: K, value: V): V | undefined {
    const previous = this.map.get(key);
    if (previous !== undefined) {
      this.totalWeight -= this.sizeOf(key, previous);
    }
    this.map.set(key, value);
    this.totalWeight += this.sizeOf(key, value);
    while (this.totalWeight > this.maxSize) {
      const oldest = this.map.keys().next();
      if (oldest.done === true) break;
      const oldValue = this.map.get(oldest.value);
      if (oldValue !== undefined) {
        this.totalWeight -= this.sizeOf(oldest.value, oldValue);
        this.map.delete(oldest.value);
      }
    }
    return previous;
  }

  get size(): number {
    return this.map.size;
  }

  currentSize(): number {
    return this.totalWeight;
  }

  clear(): void {
    this.map.clear();
    this.totalWeight = 0;
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }
}

/** Kotlin `SystemClock.elapsedRealtime()`. */
export function elapsedRealtime(): number {
  return performance.now();
}

/**
 * Kotlin `okhttp3.HttpUrl` helpers used to build query URLs.
 * `newBuilder().addQueryParameter(...)` appends with percent-encoding; the
 * existing params are preserved.
 */
export function buildUrl(
  base: string,
  segments: readonly string[] = [],
  query: ReadonlyArray<readonly [string, string]> = [],
): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`无效的地址: ${base}`);
  }
  for (const segment of segments) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${segment}`;
  }
  for (const [key, value] of query) {
    url.searchParams.append(key, value);
  }
  return url.toString();
}

/** Kotlin `baseUrl.resolve(link)` — relative hrefs resolved against the base. */
export function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * Kotlin `URLEncoder.encode(value, "UTF-8")` (application/x-www-form-urlencoded).
 *
 * JDK 8/11 `URLEncoder` keeps exactly `A-Z a-z 0-9 - _ . *` verbatim, maps a space
 * to `+` and percent-encodes every other byte as **uppercase** hex of the UTF-8
 * bytes (`!`, `'`, `(`, `)`, `~` are encoded too — unlike `encodeURIComponent`,
 * which leaves `!'()~*` alone). MangaDexSource.kt:84/175/331 and
 * JsonBookSource.kt:131/306/501/547 all call that method, so the byte output has to
 * match it, not the WHATWG `application/x-www-form-urlencoded` serializer.
 */
export function formUrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = '';
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    const safe =
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      ch === '-' ||
      ch === '_' ||
      ch === '.' ||
      ch === '*';
    if (safe) {
      out += ch;
    } else if (byte === 0x20) {
      out += '+';
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

/** Kotlin `android.util.Base64.encodeToString(bytes, NO_WRAP)`. */
export function base64NoWrap(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}