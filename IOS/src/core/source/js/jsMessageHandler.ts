/**
 * Android source: `com.example.source.js.JsMessageHandler.kt` (997 lines, 945 non-blank)
 * Ported: 945 / 945 non-blank lines of behaviour. Skipped: none.
 *
 * Platform adaptations:
 * - `Context.getSharedPreferences("js_source_data")` → injected `KeyValueStorage`.
 * - `org.chromium.net.CronetEngine/UrlRequest` + `UrlRequest.Callback` → the
 *   injected `HttpClient`. The callback state machine collapses into one awaited
 *   `execute()`, keeping the 16 MiB body cap (`JS 网络响应超过 16MiB`), the
 *   60 s deadline (`请求超时`) and the 250 ms cancellation poll (`startPolling`).
 * - `okhttp3.OkHttpClient` (insecure TLS, HTTP/1.1, the Accept/Accept-Language
 *   interceptor, `SourceDns`, `JsSourceProxy.selector`) → `HttpRequestSpec`
 *   fields `insecureTls` / `timeouts`; the two default headers are still injected
 *   here so the exact values stay in `src/core`. `toMediaTypeOrNull()` is
 *   `MEDIA_TYPE_RE`, so a malformed script `Content-Type` is dropped and the
 *   computed body type replaces it, as on Android.
 * - `android.graphics.Bitmap/Canvas/Matrix/Rect/BitmapFactory` → the injected
 *   image backend (`installImageBackend`), preserving the bounds-probe budget.
 * - `java.security.MessageDigest/Mac/Cipher` → the injected `CryptoPort`; the
 *   algorithm names ("MD5", "HmacSHA256", "AES/CBC/PKCS5Padding", …) are verbatim.
 * - `buildClient`'s `addNetworkInterceptor` credential guard (L249-254) →
 *   `requireNoCredentialsOnInsecureTls`, called on each of the three OkHttp
 *   routes (`fetchImageBytes`, `handleHttp`, `comicReadAttempt`'s http branch)
 *   and nowhere on the Cronet routes, because that is where the interceptor sat.
 * - `android.util.Base64.NO_WRAP` → `btoa` with newline stripping; `Base64.decode`
 *   → `base64Decode` with Android's lenient alphabet (URL-safe, no padding,
 *   skipping unknown characters).
 * - `Number` widening: quickjs-kt hands JS numbers over as `Double`, so
 *   `(x as? Number)?.toInt()` truncates (`num`), `?.toFloat()` keeps the
 *   fraction (`numFloat`) and `toString()` prints `1` as `"1.0"` (`kotlinToString`).
 * - `suspend fun handleAsync` → `Promise`; `requestJob` → an `AbortSignal`.
 * - `Thread.sleep(t)` on the sync bridge → injected `sleep`.
 * - `org.json` → the local port (`./json.ts`).
 * - `CancellationException` → `isCancellation`.
 *
 * 2026-10-06 fix pass on this file (see the report):
 * - `handleConvert`'s `rsa` branch called `crypto.rsaDecrypt`; Kotlin has **no**
 *   `rsa` branch, so `Convert.decryptRsa` always resolves to null there. It now
 *   returns null unconditionally so injecting a native RSA implementation cannot
 *   make the port answer a value Android never produces.
 * - `headerEntry` turned a JSON `null` header value into the string `"null"`;
 *   Kotlin's `?.value?.toString()` collapses it to null.
 * - `cronetRequest`'s failure text dropped Kotlin's `" | cause=$cause"` suffix.
 * - `base64Decode` indexed with `value[i]`; `charAt` states the loop bound.
 * - The insecure-TLS credential guard was missing entirely (added above).
 *
 * Sync/async split: `handle()` returns the value for every method except `http`,
 * which is network-bound. In the Android build `sendMessageSync` is only ever
 * registered for `load_data`/`save_data`/`load_setting`/`isLogged`/`convert`/
 * `uuid`/`random`/`html`/`image`/`cookie`, so the returned Promise for `http`
 * is never observed synchronously; `handleAsync` awaits it.
 */

import { JSONArray, JSONObject, jsonWrap } from './json';
import type { JsCookieJarStore } from './jsCookieJar';
import type { JsHtmlStore } from './jsHtmlStore';
import {
  cancellableDelay,
  ensureActive,
  isCancellation,
  JsLog,
  type Bitmap,
  type CancellationSignal,
  type CryptoPort,
  type HttpClient,
  type HttpRequestSpec,
  type HttpResponseSpec,
  type KeyValueStorage,
} from './jsPlatform';

const sourceHostSetTimeout = globalThis.setTimeout.bind(globalThis);
const CRONET_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.128 Mobile Safari/537.36';
const ACCEPT_HEADER =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const ACCEPT_LANGUAGE_HEADER = 'zh-CN,zh;q=0.9,en;q=0.8';
/** Kotlin `readImportBytes(16 * 1024 * 1024)`. */
const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** Kotlin `cronetRequest(…, timeoutMs = 60_000)`. */
const CRONET_TIMEOUT_MS = 60_000;
/** Kotlin `cronetRequest(…, timeoutMs = 15_000)` in `handleComicRead`. */
const COMIC_READ_TIMEOUT_MS = 15_000;

/** The subset of `JsSourceProxy` the handler reads. */
export interface JsHandlerProxyDeps {
  /** Kotlin `JsSourceProxy.matches(context, url)`. */
  readonly matches: (url: string) => boolean;
  /** Kotlin `JsSourceProxy.rememberProxySuccess(context, url)`. */
  readonly rememberProxySuccess: (url: string) => void;
  /** Kotlin `JsSourceProxy.forgetRoute(url)`. */
  readonly forgetRoute: (url: string) => void;
}

/** Everything the message bridge needs, all injected. */
export interface JsMessageHandlerDeps {
  readonly dataPrefs: KeyValueStorage;
  readonly htmlStore: JsHtmlStore;
  readonly crypto: CryptoPort;
  /** Kotlin `client.newCall(request).executeWithCancellation(job)` / Cronet. */
  readonly http: HttpClient;
  /** Kotlin `JsCookieJar` over the shared `js_source_cookies` store. */
  readonly cookies: JsCookieJarStore;
  readonly sourceProxy: JsHandlerProxyDeps;
  /** Kotlin `CfWebViewSolver.solveAndSync(context, url, userAgent, headers)`. */
  readonly solveCloudflare: (url: string, userAgent: string, headers: Record<string, string>) => Promise<boolean>;
  /** Kotlin `CfWebViewSolver.isChallengeResponse(status, headers)`. */
  readonly isChallengeResponse: (status: number, headers: Record<string, string>) => boolean;
  /** Kotlin `SystemProxyResolver.resolve(context)`. */
  readonly systemProxy: () => string | null;
  /** Kotlin `ImageBytes.gunzipIfNeeded(bytes)`. */
  readonly gunzipIfNeeded: (bytes: Uint8Array) => Uint8Array;
  /** Kotlin `SharedHttpTransport.builder().connectTimeout(20s).readTimeout(30s)`. */
  readonly timeouts: { connectMs: number; readMs: number; callMs: number };
  /** Kotlin `Charset.forName(label)` decode, for "GBK" / "GB18030". */
  readonly decodeCharset: (label: string, bytes: Uint8Array) => string;
  /** Kotlin `Charsets.UTF_8` decode. */
  readonly decodeUtf8: (bytes: Uint8Array) => string;
  /** Kotlin `Charsets.UTF_8` encode. */
  readonly encodeUtf8: (value: string) => Uint8Array;
  /** Kotlin `String.toByteArray(Charset.forName(label))` — "UTF-8" / "GBK". */
  readonly encodeCharset: (label: string, value: string) => Uint8Array;
  /** Kotlin `Charsets.ISO_8859_1` decode. */
  readonly decodeLatin1: (bytes: Uint8Array) => string;
  /** Kotlin `android.os.SystemClock.elapsedRealtime()`. */
  readonly elapsedRealtime: () => number;
  /** Kotlin `System.currentTimeMillis()`. */
  readonly wallClock: () => number;
  /** Kotlin `Runtime.getRuntime().maxMemory()` for the image budget. */
  readonly maxMemory: () => number;
  /** Kotlin `latch.await(250, MILLISECONDS)` polling, returns a stop function. */
  readonly startPolling: (intervalMs: number, tick: () => void) => () => void;
  /** Kotlin `Thread.sleep(t)` on the synchronous bridge. */
  readonly sleep: (millis: number) => void;
  /** Kotlin `awaitJsInputDialog(context, title, image)`. */
  readonly showInputDialog: (
    title: string,
    image: string | null,
    signal: CancellationSignal,
  ) => Promise<string>;
}

/** Kotlin `private data class CronetResult`. */
export interface CronetResult {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Uint8Array | null;
  readonly error: string | null;
  readonly finalUrl: string | null;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  // Chunked to stay under the argument-count limit for large image bodies.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  // Kotlin `Base64.NO_WRAP`
  return btoa(binary).replace(/\r?\n/g, '');
}

/**
 * Kotlin `android.util.Base64.decode(value, Base64.NO_WRAP)`.
 * Android's decoder is lenient: it skips every character outside the alphabet
 * (whitespace included), accepts the URL-safe `-`/`_` forms, and does not
 * require `=` padding. `atob` throws on all of those, so decode by hand.
 */
function base64Decode(value: string): Uint8Array | null {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < value.length; i += 1) {
    // Kotlin's counterpart walks the bytes it just pushed, so the "character" is
    // unconditionally present; `value[i]` is `string | undefined` under
    // `noUncheckedIndexedAccess` and `charAt` states the loop bound's guarantee
    // (`i < value.length`) instead of hiding it behind `!`.
    const ch = value.charAt(i);
    let sextet: number;
    if (ch >= 'A' && ch <= 'Z') sextet = ch.charCodeAt(0) - 65;
    else if (ch >= 'a' && ch <= 'z') sextet = ch.charCodeAt(0) - 71;
    else if (ch >= '0' && ch <= '9') sextet = ch.charCodeAt(0) + 4;
    else if (ch === '+' || ch === '-') sextet = 62;
    else if (ch === '/' || ch === '_') sextet = 63;
    else if (ch === '=') break;
    else continue; // skipped, exactly like Android's decoder
    buffer = (buffer << 6) | sextet;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Kotlin `(msg[key] as? Number)?.toInt()` / `?.toLong()` — a JS number widened
 * to `Double` and then truncated toward zero. Booleans are **not** `Number` in
 * Kotlin, so they fall through to the call-site default.
 */
function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  return null;
}

/** Kotlin `(msg[key] as? Number)?.toFloat()` — keeps the fraction (`fillImageAt`). */
function numFloat(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return 0;
}

/**
 * Kotlin `Any?.toString()` for the values the QuickJS bridge hands over: a JS
 * number becomes a `Double`, so an integral value prints as `1.0`.
 */
function kotlinToString(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
    return `${value}.0`;
  }
  return String(value);
}

/**
 * Kotlin `okhttp3.MediaType.toMediaTypeOrNull()`:
 * `^TOKEN/TOKEN\s*(;.*)?$` with TOKEN = `[a-zA-Z0-9-!#$%&'*+.^_`|~]+`.
 * A script-supplied `Content-Type` that is not a media type is discarded, and
 * the computed body type takes its place.
 */
const MEDIA_TYPE_RE = /^[a-zA-Z0-9-!#$%&'*+.^_`|~]+\/[a-zA-Z0-9-!#$%&'*+.^_`|~]+\s*(;.*)?$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (isByteArray(value)) return null;
  if (value instanceof JSONObject || value instanceof JSONArray) return null;
  return value as Record<string, unknown>;
}

function stringOf(value: unknown): string {
  return kotlinToString(value);
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Kotlin `is ByteArray`.
 * `ArrayBuffer.isView` rather than `instanceof Uint8Array`: a typed array
 * created in another realm (jsdom, an iframe, WKWebView) is not `instanceof`
 * this realm's `Uint8Array`, and `instanceof` would silently reject it.
 */
export function isByteArray(value: unknown): value is Uint8Array {
  if (value instanceof Uint8Array) return true;
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function headerEntry(
  headers: Record<string, unknown> | null,
  name: string,
): string | null {
  if (headers === null) return null;
  const hit = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  // Kotlin reads the raw script map here (`sourceHeaders?.entries?.firstOrNull { … }
  // ?.value?.toString()`), so a JSON `null` must collapse to null exactly like a
  // missing entry — not to the literal string "null".
  const value = hit?.[1];
  return value === undefined || value === null ? null : kotlinToString(value);
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

function encodedPathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '/';
  }
}

function queryParamOf(url: string, name: string): string | null {
  try {
    return new URL(url).searchParams.get(name);
  } catch {
    return null;
  }
}

/** Kotlin `readImportBytes(16 * 1024 * 1024)`. */
function boundedBody(bytes: Uint8Array): Uint8Array {
  return bytes.length <= MAX_BODY_BYTES ? bytes : bytes.subarray(0, MAX_BODY_BYTES);
}

/** The Android image operations the JS `Image` bridge needs. */
export interface JsImageBackend {
  /** Kotlin `Runtime.getRuntime().maxMemory()`. */
  readonly maxMemory: number;
  /** Kotlin `BitmapFactory.decodeByteArray(bytes, 0, size, {inJustDecodeBounds=true})`. */
  probeBounds(bytes: Uint8Array): { width: number; height: number } | null;
  /** Kotlin `BitmapFactory.decodeByteArray(bytes, 0, size)`. */
  decode(bytes: Uint8Array): Bitmap | null;
  /** Kotlin `Bitmap.createBitmap(w, h, Config.ARGB_8888)`. */
  create(width: number, height: number): Bitmap;
  /** Kotlin `Bitmap.createBitmap(src, x, y, w, h)`. */
  crop(src: Bitmap, x: number, y: number, width: number, height: number): Bitmap;
  /** Kotlin `Bitmap.createBitmap(src, 0, 0, w, h, matrix(90f), true)`. */
  rotate90(src: Bitmap): Bitmap;
  /** Kotlin `Canvas(dst).drawBitmap(src, x, y, null)`. */
  draw(dst: Bitmap, src: Bitmap, x: number, y: number): void;
  /** Kotlin `Canvas(dst).drawBitmap(src, srcRect, dstRect, null)`. */
  drawRect(
    dst: Bitmap,
    src: Bitmap,
    srcX: number,
    srcY: number,
    width: number,
    height: number,
    x: number,
    y: number,
  ): void;
}

// Module-level hooks so `src/core` never constructs a platform Bitmap.
let imageBackend: JsImageBackend | null = null;

function requireImageBackend(): JsImageBackend {
  if (imageBackend === null) throw new Error('图像后端未安装');
  return imageBackend;
}

/** Wire the platform image implementation (called from the platform layer). */
export function installImageBackend(backend: JsImageBackend): void {
  imageBackend = backend;
}

/**
 * Venera JS 运行时消息桥：处理 JS 侧 sendMessage(...) 的所有方法。
 * 覆盖 convert / http / cookie / html / storage / UI / 工具函数。
 */
export class JsMessageHandler {
  /** Kotlin `@Volatile internal var requestJob: kotlinx.coroutines.Job?`. */
  requestJob: CancellationSignal = null;
  private readonly settingDefaults = new Map<string, string>();
  private readonly publicDirectRoutes = new Map<string, number>();

  // ---- 真实 Bitmap 图像桥：供 onImageLoad.modifyImage 等脚本做像素级重排 ----
  private readonly images = new Map<number, Bitmap>();

  constructor(
    private readonly deps: JsMessageHandlerDeps,
    private readonly sourceKey: string,
    private readonly insecureTls = false,
  ) {}

  /** Kotlin `imageKeyGen = AtomicInteger(1)`; `incrementAndGet()` returns 2 first. */
  private imageKeyGen = 1;

  /** Kotlin `private val imageBudget: Long get() = minOf(64MiB, maxMemory/6)`. */
  private get imageBudget(): number {
    return Math.min(64 * 1024 * 1024, Math.floor(this.deps.maxMemory() / 6));
  }

  /** Kotlin `private fun checkImageAllocation(width, height)`. */
  private checkImageAllocation(width: number, height: number): void {
    const pixels = width * height;
    // Kotlin `require(pixels <= imageBudget / 4)` — Long division truncates.
    if (!(pixels <= Math.floor(this.imageBudget / 4))) throw new Error('脚本图片尺寸过大');
    const requested = pixels * 4;
    const distinct = new Set(this.images.values());
    let used = 0;
    for (const bitmap of distinct) used += bitmap.allocationByteCount;
    if (!(width > 0 && height > 0 && requested <= this.imageBudget && used + requested <= this.imageBudget)) {
      throw new Error('脚本图像内存预算不足');
    }
  }

  /** Kotlin `private fun putImage(bmp: Bitmap): Int`. */
  private putImage(bitmap: Bitmap): number {
    if (this.images.size >= 48) throw new Error('脚本创建的图片过多');
    this.imageKeyGen += 1;
    const key = this.imageKeyGen;
    this.images.set(key, bitmap);
    return key;
  }

  /** Kotlin `fun beginImageSession(): Set<Int>`. */
  beginImageSession(): Set<number> {
    return new Set(this.images.keys());
  }

  /** Kotlin `fun endImageSession(previous: Set<Int>)`. */
  endImageSession(previous: Set<number>): void {
    const keys = [...this.images.keys()].filter((it) => !previous.has(it));
    for (const key of keys) this.disposeImage(key);
  }

  /** Kotlin `private fun getImage(key: Int): Bitmap?`. */
  private getImage(key: number): Bitmap | null {
    return this.images.get(key) ?? null;
  }

  /** 供 JsSourceEngine 解码一张图片并登记到桥中 */
  createImage(bytes: Uint8Array): number | null {
    // Kotlin probes the bounds first and budgets on the *undecoded* dimensions,
    // before allocating the real bitmap.
    const bounds = requireImageBackend().probeBounds(bytes);
    this.checkImageAllocation(bounds?.width ?? 0, bounds?.height ?? 0);
    const bmp = requireImageBackend().decode(bytes);
    if (bmp === null) return null;
    return this.putImage(bmp);
  }

  /** 供 JsSourceEngine 导出处理后的图片（PNG） */
  exportImageBytes(key: number): Uint8Array | null {
    return this.getImage(key)?.compressPng() ?? null;
  }

  disposeImage(key: number): void {
    const bitmap = this.images.get(key);
    if (bitmap === undefined) return;
    this.images.delete(key);
    for (const other of this.images.values()) {
      if (other === bitmap) return;
    }
    bitmap.recycle();
  }

  /** 用 Cronet（Chromium 网络栈）直接下载图片字节，用于 H@H 等 OkHttp 握手不兼容的图床。 */
  async fetchImageBytes(
    url: string,
    headers: Record<string, string>,
    signal: CancellationSignal = this.requestJob,
  ): Promise<Uint8Array | null> {
    if (this.deps.sourceProxy.matches(url)) {
      try {
        this.requireNoCredentialsOnInsecureTls(headers);
        const response = await this.deps.http.execute({
          method: 'GET',
          url,
          headers,
          signal,
          insecureTls: this.insecureTls,
          timeouts: this.deps.timeouts,
        });
        if (response.status < 200 || response.status > 299) return null;
        return response.body === null ? null : boundedBody(response.body);
      } catch {
        // Kotlin `runCatching { … }.getOrNull()`
        return null;
      }
    }
    const res = await this.cronetRequest('GET', url, headers, null, signal);
    if (res.error !== null || res.status < 200 || res.status > 299) return null;
    return res.body;
  }

  /**
   * Kotlin `buildClient`'s `addNetworkInterceptor` (L249-254):
   * `if (insecure && request.headers.names().any { it.equals("Cookie", true) ||
   * it.equals("Authorization", true) }) throw java.io.IOException(
   * "不安全 TLS 书源不能发送登录凭据，请启用证书验证")`.
   *
   * It lives on the OkHttp client, so it guards every OkHttp route here and
   * nothing on the Cronet route — hence the call sites. `handleHttp` turns the
   * throw into `{"error":"不安全 TLS 书源不能发送登录凭据，请启用证书验证"}`,
   * `fetchImageBytes` swallows it into `null` (`runCatching{…}.getOrNull()`) and
   * `comicReadAttempt` reports it as the CronetResult error, all exactly as on
   * Android.
   */
  private requireNoCredentialsOnInsecureTls(headers: Record<string, string>): void {
    if (!this.insecureTls) return;
    const names = Object.keys(headers);
    if (names.some((key) => key.toLowerCase() === 'cookie' || key.toLowerCase() === 'authorization')) {
      throw new Error('不安全 TLS 书源不能发送登录凭据，请启用证书验证');
    }
  }

  /** Kotlin `private fun handleImage(msg: Map<*, *>): Any?`. */
  private handleImage(msg: Record<string, unknown>): unknown {
    const name = typeof msg['function'] === 'string' ? (msg['function'] as string) : null;
    if (name === null) return null;
    const backend = () => requireImageBackend();
    try {
      switch (name) {
        case 'emptyImage': {
          const w = num(msg['width']);
          if (w === null) return null;
          const h = num(msg['height']);
          if (h === null) return null;
          if (w <= 0 || h <= 0) return null;
          this.checkImageAllocation(w, h);
          return this.putImage(backend().create(w, h));
        }
        case 'copyRange': {
          const key = num(msg['key']);
          if (key === null) return null;
          const src = this.getImage(key);
          if (src === null) return null;
          const x = num(msg['x']) ?? 0;
          const y = num(msg['y']) ?? 0;
          const w = num(msg['width']) ?? 0;
          const h = num(msg['height']) ?? 0;
          if (w <= 0 || h <= 0 || x + w > src.width || y + h > src.height) return null;
          this.checkImageAllocation(w, h);
          return this.putImage(backend().crop(src, x, y, w, h));
        }
        case 'copyAndRotate90': {
          const key = num(msg['key']);
          if (key === null) return null;
          const src = this.getImage(key);
          if (src === null) return null;
          this.checkImageAllocation(src.height, src.width);
          return this.putImage(backend().rotate90(src));
        }
        case 'fillImageAt': {
          const key = num(msg['key']);
          if (key === null) return null;
          const dst = this.getImage(key);
          if (dst === null) return null;
          const srcKey = num(msg['image']);
          if (srcKey === null) return null;
          const src = this.getImage(srcKey);
          if (src === null) return null;
          backend().draw(dst, src, numFloat(msg['x']), numFloat(msg['y']));
          return null;
        }
        case 'fillImageRangeAt': {
          const key = num(msg['key']);
          if (key === null) return null;
          const dst = this.getImage(key);
          if (dst === null) return null;
          const srcKey = num(msg['image']);
          if (srcKey === null) return null;
          const src = this.getImage(srcKey);
          if (src === null) return null;
          const w = num(msg['width']) ?? 0;
          const h = num(msg['height']) ?? 0;
          if (w <= 0 || h <= 0) return null;
          backend().drawRect(
            dst,
            src,
            num(msg['srcX']) ?? 0,
            num(msg['srcY']) ?? 0,
            w,
            h,
            num(msg['x']) ?? 0,
            num(msg['y']) ?? 0,
          );
          return null;
        }
        case 'getWidth':
          return this.getImage(num(msg['key']) ?? -1)?.width ?? null;
        case 'getHeight':
          return this.getImage(num(msg['key']) ?? -1)?.height ?? null;
        default:
          return null;
      }
    } catch (e) {
      JsLog.w(`JsSource[${this.sourceKey}]`, `image ${name} failed`, e);
      return null;
    }
  }

  /** Kotlin `fun setSettingDefaults(defaults: Map<String, String>)`. */
  setSettingDefaults(defaults: Record<string, string>): void {
    for (const [key, value] of Object.entries(defaults)) this.settingDefaults.set(key, value);
  }

  /** Kotlin `fun setLoggedIn(logged: Boolean)`. */
  setLoggedIn(logged: boolean): void {
    this.deps.dataPrefs.putBoolean(`logged_${this.sourceKey}`, logged);
  }

  /** Kotlin `fun isLoggedIn(): Boolean`. */
  isLoggedIn(): boolean {
    return this.deps.dataPrefs.getBoolean(`logged_${this.sourceKey}`, false);
  }

  /** Kotlin `fun handle(message: Any?): Any?`. */
  handle(message: unknown): unknown {
    const msg = asRecord(message);
    if (msg === null) return null;
    const method = typeof msg['method'] === 'string' ? (msg['method'] as string) : null;
    if (method === null) return null;
    switch (method) {
      case 'delay': {
        const t = num(msg['time']) ?? 0;
        if (t > 0) this.deps.sleep(t);
        return null;
      }
      case 'convert':
        return this.handleConvert(msg);
      case 'http':
        return this.handleHttp(msg);
      case 'cookie':
        return this.handleCookie(msg);
      case 'html':
        return this.handleHtml(msg);
      case 'load_data':
        return this.loadStored(this.deps.dataPrefs.getString(this.dataKey(msg['data_key'])));
      case 'save_data':
        this.deps.dataPrefs.putString(this.dataKey(msg['data_key']), this.encodeStored(msg['data']));
        return null;
      case 'delete_data':
        this.deps.dataPrefs.remove(this.dataKey(msg['data_key']));
        return null;
      case 'load_setting': {
        const key = typeof msg['setting_key'] === 'string' ? (msg['setting_key'] as string) : null;
        if (key === null) return null;
        // 用户手动保存的设置优先，其次才用脚本里的默认值
        return (
          this.deps.dataPrefs.getString(`setting_${this.sourceKey}_${key}`) ??
          this.settingDefaults.get(key) ??
          null
        );
      }
      case 'isLogged':
        return this.deps.dataPrefs.getBoolean(`logged_${this.sourceKey}`, false);
      case 'UI':
        return this.handleUi(msg);
      case 'getLocale':
        return 'zh-CN';
      case 'getPlatform':
        return 'android';
      case 'setClipboard':
        return null;
      case 'getClipboard':
        return '';
      case 'uuid':
        return this.deps.crypto.randomUUID();
      case 'random':
        return this.handleRandom(msg);
      case 'log':
        JsLog.i(`JsSource[${this.sourceKey}]`, `${stringOf(msg['title'])}: ${stringOf(msg['content'])}`);
        return null;
      case 'compute':
        return null;
      case 'image':
        return this.handleImage(msg);
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------
  // convert
  // ------------------------------------------------------------------

  /** Kotlin `private fun handleConvert(msg: Map<*, *>): Any?`. */
  private handleConvert(msg: Record<string, unknown>): unknown {
    const type = typeof msg['type'] === 'string' ? (msg['type'] as string) : null;
    if (type === null) return null;
    const value = msg['value'];
    const isEncode = msg['isEncode'] === true;
    const isString = msg['isString'] === true;
    try {
      switch (type) {
        case 'utf8':
        case 'gbk': {
          const charset = type === 'gbk' ? 'GBK' : 'UTF-8';
          if (isEncode) {
            // Kotlin `(value as? String)?.toByteArray(charset)` — the charset is
            // the one named by `type`, so a GBK encode must NOT go through UTF-8.
            return typeof value === 'string' ? this.deps.encodeCharset(charset, value) : null;
          }
          const bytes = this.bytesOf(value);
          return bytes === null ? null : this.deps.decodeCharset(charset, bytes);
        }
        case 'base64':
          if (isEncode) {
            const bytes = this.bytesOf(value);
            return bytes === null ? null : base64Encode(bytes);
          }
          if (typeof value !== 'string') return null;
          return base64Decode(value);
        case 'md5':
        case 'sha1':
        case 'sha256':
        case 'sha512': {
          const alg =
            type === 'md5' ? 'MD5' : type === 'sha1' ? 'SHA-1' : type === 'sha256' ? 'SHA-256' : 'SHA-512';
          const bytes = this.bytesOf(value);
          return bytes === null ? null : this.deps.crypto.digest(alg, bytes);
        }
        case 'hmac': {
          const key = this.bytesOf(msg['key']);
          if (key === null) return null;
          const data = this.bytesOf(value);
          if (data === null) return null;
          const hash = msg['hash'];
          const alg =
            hash === 'md5'
              ? 'HmacMD5'
              : hash === 'sha1'
                ? 'HmacSHA1'
                : hash === 'sha256'
                  ? 'HmacSHA256'
                  : hash === 'sha512'
                    ? 'HmacSHA512'
                    : 'HmacSHA256';
          const digest = this.deps.crypto.hmac(alg, key, data);
          return isString ? hex(digest) : digest;
        }
        case 'aes-ecb':
        case 'aes-cbc':
        case 'aes-cfb':
        case 'aes-ofb': {
          const mode =
            type === 'aes-ecb'
              ? 'AES/ECB/NoPadding'
              : type === 'aes-cbc'
                ? 'AES/CBC/PKCS5Padding'
                : type === 'aes-cfb'
                  ? 'AES/CFB/NoPadding'
                  : 'AES/OFB/NoPadding';
          const key = this.bytesOf(msg['key']);
          if (key === null) return null;
          const data = this.bytesOf(value);
          if (data === null) return null;
          return this.deps.crypto.aesDecrypt(mode, key, this.bytesOf(msg['iv']), data);
        }
        case 'rsa': {
          // Kotlin `handleConvert` (L323-378) has **no** `rsa` branch — its `when`
          // covers utf8/gbk, base64, md5/sha*, hmac, aes-ecb/cbc/cfb/ofb, hex, and the
          // `else` arm is `null`. So a script sending `{type:"rsa"}` resolves to null on
          // Android too. Kept as an explicit null so the port can never answer a value
          // Kotlin never produces, regardless of whether a native RSA implementation is
          // injected later.
          return null;
        }
        case 'hex': {
          const bytes = this.bytesOf(value);
          return bytes === null ? null : hex(bytes);
        }
        default:
          return null;
      }
    } catch (e) {
      JsLog.w(`JsSource[${this.sourceKey}]`, `convert ${type} failed`, e);
      return null;
    }
  }

  // ------------------------------------------------------------------
  // http
  // ------------------------------------------------------------------

  /** Kotlin `private fun handleHttp(msg: Map<*, *>): Any?`. */
  private async handleHttp(msg: Record<string, unknown>): Promise<string> {
    const url = typeof msg['url'] === 'string' ? (msg['url'] as string) : null;
    if (url === null) return new JSONObject().put('error', '缺少 url').toString();
    const httpMethod = (
      typeof msg['http_method'] === 'string' ? (msg['http_method'] as string) : 'GET'
    ).toUpperCase();
    const bytes = msg['bytes'] === true;
    try {
      const effectiveHeaders: Record<string, string> = {};
      const sourceHeaders = asRecord(msg['headers']);
      let hasUa = false;
      if (sourceHeaders !== null) {
        for (const [k, v] of Object.entries(sourceHeaders)) {
          if (v === null || v === undefined) continue;
          effectiveHeaders[k] = stringOf(v);
          if (k.toLowerCase() === 'user-agent') hasUa = true;
        }
      }
      if (!hasUa) effectiveHeaders['User-Agent'] = CRONET_USER_AGENT;
      if (!hasHeader(effectiveHeaders, 'Accept')) effectiveHeaders['Accept'] = ACCEPT_HEADER;
      if (!hasHeader(effectiveHeaders, 'Accept-Language')) {
        effectiveHeaders['Accept-Language'] = ACCEPT_LANGUAGE_HEADER;
      }
      // 合并脚本显式 Cookie 与本地 CookieJar：之前直接覆盖会把脚本里
      // 的 cookie（如 ehentai 的 nw=1）丢掉，导致站点响应异常/挂起。
      const scriptCookie = headerEntry(sourceHeaders, 'Cookie')?.trim() ?? null;
      const jarCookie = this.getCookiesFor(url).trim();
      const mergedCookie = [scriptCookie, jarCookie]
        .filter((it): it is string => it !== null && it.trim() !== '')
        .join('; ');
      if (mergedCookie.trim() !== '') effectiveHeaders['Cookie'] = mergedCookie;

      const declaredContentTypeRaw = headerEntry(effectiveHeaders, 'Content-Type');
      // Kotlin `?.toMediaTypeOrNull()` — an unparsable header value is null, so
      // the computed body type replaces it.
      const declaredContentType =
        declaredContentTypeRaw !== null && MEDIA_TYPE_RE.test(declaredContentTypeRaw)
          ? declaredContentTypeRaw
          : null;
      const data = msg['data'];
      const structured = asRecord(data) !== null || Array.isArray(data);
      let bodyBytes: Uint8Array | null = null;
      if (isByteArray(data)) bodyBytes = data;
      else if (typeof data === 'string') bodyBytes = this.deps.encodeUtf8(data);
      else if (asRecord(data) !== null) {
        bodyBytes = this.deps.encodeUtf8(new JSONObject(data as Record<string, unknown>).toString());
      } else if (Array.isArray(data)) {
        bodyBytes = this.deps.encodeUtf8(new JSONArray(data).toString());
      } else if (new Set(['POST', 'PUT', 'PATCH']).has(httpMethod)) {
        bodyBytes = new Uint8Array(0);
      }
      const bodyType =
        declaredContentType ??
        (structured
          ? 'application/json; charset=utf-8'
          : isByteArray(data)
            ? 'application/octet-stream'
            : typeof data === 'string'
              ? 'text/plain; charset=utf-8'
              : null);
      if (bodyType !== null && declaredContentType === null) {
        effectiveHeaders['Content-Type'] = bodyType;
      }

      const publicReadBatch =
        this.sourceKey === 'ikmmh' &&
        httpMethod === 'POST' &&
        encodedPathOf(url) === '/api/comic/read/pics';
      if (
        ((httpMethod === 'GET' && new Set(['pufei', 'bilimanga', 'ikmmh']).has(this.sourceKey)) ||
          publicReadBatch) &&
        !this.insecureTls
      ) {
        return await this.handleComicRead(url, effectiveHeaders, bytes, httpMethod, bodyBytes);
      }

      const proxied = this.deps.sourceProxy.matches(url);
      if (!this.insecureTls && !proxied) {
        // 走 Cronet（Chromium 网络栈）：浏览器级 TLS 指纹，绕过按 Java 客户端封禁的站点
        let res = await this.cronetRequest(httpMethod, url, effectiveHeaders, bodyBytes);
        // Cloudflare 挑战：用无头 WebView 自动过盾一次（cf_clearance 会同步进共享
        // Cookie 存储），刷新请求头里的 Cookie 后重试原请求
        if (res.error === null && this.deps.isChallengeResponse(res.status, res.headers)) {
          const solved = await this.deps
            .solveCloudflare(url, headerEntry(effectiveHeaders, 'User-Agent') ?? '', effectiveHeaders)
            .catch(() => false);
          if (solved) {
            const freshScriptCookie = headerEntry(sourceHeaders, 'Cookie')?.trim() ?? null;
            const freshJar = this.getCookiesFor(url).trim();
            const merged = [freshScriptCookie, freshJar]
              .filter((it): it is string => it !== null && it.trim() !== '')
              .join('; ');
            if (merged.trim() !== '') effectiveHeaders['Cookie'] = merged;
            res = await this.cronetRequest(httpMethod, url, effectiveHeaders, bodyBytes);
            JsLog.i(
              `JsSource[${this.sourceKey}]`,
              `cloudflare challenge solved; retry -> ${String(res.status)}`,
            );
          }
        }
        const systemProxy = this.deps.systemProxy();
        const retryViaProxy =
          systemProxy !== null &&
          (res.error !== null || res.status === 403 || res.status === 429 || res.status >= 500);
        const retryViaHttp =
          httpMethod === 'GET' &&
          ((new Set(['pufei', 'bilimanga']).has(this.sourceKey) && res.error !== null) ||
            (this.sourceKey === 'bilimanga' && res.status === 403));
        if (res.error !== null || retryViaProxy || retryViaHttp) {
          if (!retryViaProxy && !retryViaHttp) {
            return new JSONObject().put('error', res.error).toString();
          }
          JsLog.w(
            `JsSource[${this.sourceKey}]`,
            `Cronet failed/status ${String(res.status)}; retrying via OkHttp: ${String(res.error)}`,
          );
        } else {
          const respHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (k.toLowerCase() === 'set-cookie') continue;
            if (!(k in respHeaders)) respHeaders[k] = v;
          }
          const obj = new JSONObject();
          obj.put('status', res.status);
          obj.put('url', res.finalUrl ?? url);
          obj.put('headers', new JSONObject(respHeaders));
          if (bytes) {
            obj.put('body', res.body === null ? null : base64Encode(res.body));
          } else {
            const text = res.body === null ? '' : this.deps.decodeUtf8(res.body);
            obj.put('body', text === '' ? null : text);
          }
          return obj.toString();
        }
      }

      // 证书有问题的源走 OkHttp（可忽略证书校验）；命中代理路由的请求也走 OkHttp（代理见 ProxySelector）
      this.requireNoCredentialsOnInsecureTls(effectiveHeaders);
      const response = await this.deps.http.execute({
        method: httpMethod,
        url,
        headers: effectiveHeaders,
        body: bodyBytes,
        hasBody: bodyBytes !== null,
        signal: this.requestJob,
        insecureTls: this.insecureTls,
        timeouts: this.deps.timeouts,
      });
      if (httpMethod === 'GET') {
        if (response.status >= 200 && response.status < 300) {
          this.deps.sourceProxy.rememberProxySuccess(url);
        } else if (response.status === 403 || response.status === 429 || response.status >= 500) {
          this.deps.sourceProxy.forgetRoute(url);
        }
      }
      const respHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(response.headers)) {
        if (!(k in respHeaders)) respHeaders[k] = v;
      }
      this.saveCookies(url, response.setCookies);
      const obj = new JSONObject();
      obj.put('status', response.status);
      obj.put('url', response.finalUrl);
      obj.put('headers', new JSONObject(respHeaders));
      const raw = response.body === null ? null : boundedBody(response.body);
      const decoded = raw === null ? null : this.deps.gunzipIfNeeded(raw);
      if (bytes) {
        obj.put('body', decoded === null ? null : base64Encode(decoded));
      } else {
        const text = decoded === null ? '' : this.deps.decodeUtf8(decoded);
        obj.put('body', text === '' ? null : text);
      }
      return obj.toString();
    } catch (e) {
      if (isCancellation(e)) throw e;
      // Kotlin `JSONObject().put("error", e.message ?: e.javaClass.simpleName)`
      return new JSONObject().put('error', messageOf(e)).toString();
    }
  }

  /** Both routes must consume a complete response before success is remembered. */
  private async handleComicRead(
    url: string,
    headers: Record<string, string>,
    bytes: boolean,
    method: string,
    body: Uint8Array | null,
  ): Promise<string> {
    const httpFirst = this.deps.sourceProxy.matches(url) || this.deps.systemProxy() !== null;
    // Chromium inherits Android's HTTP proxy too. Verified public reading
    // endpoints can work directly while the configured proxy closes TLS.
    // Retry the same HTTPS endpoint, keeping certificate checks and cancellation.
    const host = new URL(url).hostname;
    const publicMirror =
      (this.sourceKey === 'pufei' && new Set(['www.guoman.net', 'm.guoman.net']).has(host)) ||
      (this.sourceKey === 'ikmmh' && host === 'ymcdnyfqdapp.ikmmh.com');
    const directMirrorRetry = httpFirst && publicMirror;
    const preferDirect =
      publicMirror && (this.publicDirectRoutes.get(host) ?? 0) > this.deps.elapsedRealtime();
    // Bili's search ticket redemption deliberately returns an empty 200 response.
    const allowEmpty = this.sourceKey === 'bilimanga' && queryParamOf(url, 'search_guard') === 'redeem';
    let requestUrl = url;
    let lastError = '源站连接失败';
    const requestHeaders: Record<string, string> = { ...headers };
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      ensureActive(this.requestJob);
      const directMirror = preferDirect ? attempt === 0 : attempt === 1 && directMirrorRetry;
      const http = directMirror || (preferDirect ? true : attempt === 0 ? httpFirst : !httpFirst);
      if (attempt !== 0) {
        requestHeaders['Cache-Control'] = 'no-cache';
        requestHeaders['Pragma'] = 'no-cache';
        this.deps.sourceProxy.forgetRoute(url);
        const merged = new Map<string, string>();
        for (const cookies of [requestHeaders['Cookie'] ?? '', this.getCookiesFor(requestUrl)]) {
          for (const pair of cookies.split(';')) {
            const eq = pair.indexOf('=');
            const name = (eq >= 0 ? pair.slice(0, eq) : pair).trim();
            if (name !== '' && eq >= 0) merged.set(name, pair.slice(eq + 1).trim());
          }
        }
        if (merged.size > 0) {
          requestHeaders['Cookie'] = [...merged.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
        }
      }
      const response = await this.comicReadAttempt(
        http,
        method,
        requestUrl,
        requestHeaders,
        body,
        directMirror,
      );
      const empty =
        response.status >= 200 &&
        response.status <= 299 &&
        (response.body === null || response.body.length === 0) &&
        !allowEmpty;
      const retryable =
        response.error !== null ||
        empty ||
        response.status === 403 ||
        response.status === 429 ||
        response.status >= 500;
      if (retryable) {
        if (directMirror) this.publicDirectRoutes.delete(host);
        lastError = empty
          ? '源站返回空响应，重新连接后仍未收到页面'
          : response.error !== null
            ? `网络连接失败：${response.error}`
            : `源站返回 HTTP ${String(response.status)}`;
        if (empty && method === 'GET') {
          const parsed = new URL(url);
          parsed.searchParams.set('_ciallo_retry', String(this.deps.wallClock()));
          requestUrl = parsed.toString();
        }
        JsLog.w(
          `JsSource[${this.sourceKey}]`,
          `GET ${http ? 'OkHttp' : 'Chromium'} failed: ${lastError}; attempt=${String(attempt + 1)}`,
        );
        continue;
      }
      if (response.status >= 200 && response.status <= 299) {
        if (directMirror) {
          this.publicDirectRoutes.set(host, this.deps.elapsedRealtime() + 5 * 60_000);
        } else if (http) {
          this.publicDirectRoutes.delete(host);
          this.deps.sourceProxy.rememberProxySuccess(url);
        }
      }
      const out = response.body ?? new Uint8Array(0);
      return new JSONObject()
        .put('status', response.status)
        .put('url', response.finalUrl ?? requestUrl)
        .put('headers', new JSONObject(response.headers))
        .put(
          'body',
          bytes ? base64Encode(out) : this.decodeComicText(out, response.headers),
        )
        .toString();
    }
    this.deps.sourceProxy.forgetRoute(url);
    return new JSONObject().put('error', `${lastError}，请重试`).toString();
  }

  /** One attempt of `handleComicRead`'s OkHttp or Cronet branch. */
  private async comicReadAttempt(
    http: boolean,
    method: string,
    requestUrl: string,
    requestHeaders: Record<string, string>,
    body: Uint8Array | null,
    directMirror: boolean,
  ): Promise<CronetResult> {
    try {
      if (http) {
        this.requireNoCredentialsOnInsecureTls(requestHeaders);
        const res = await this.deps.http.execute({
          method,
          url: requestUrl,
          headers: requestHeaders,
          body,
          hasBody: body !== null,
          signal: this.requestJob,
          timeouts: { connectMs: 8_000, readMs: 12_000, callMs: 18_000 },
          ...(directMirror ? { viaProxy: 'no-proxy' } : {}),
        });
        this.saveCookies(res.finalUrl, res.setCookies);
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          if (key.toLowerCase() === 'set-cookie') continue;
          if (!(key in responseHeaders)) responseHeaders[key] = value;
        }
        const data = res.body === null ? null : boundedBody(res.body);
        return {
          status: res.status,
          headers: responseHeaders,
          body: data === null ? null : this.deps.gunzipIfNeeded(data),
          error: null,
          finalUrl: res.finalUrl,
        };
      }
      let result = await this.cronetRequest(
        method,
        requestUrl,
        requestHeaders,
        body,
        this.requestJob,
        COMIC_READ_TIMEOUT_MS,
      );
      if (result.error === null && this.deps.isChallengeResponse(result.status, result.headers)) {
        const solved = await this.deps.solveCloudflare(
          requestUrl,
          headerEntry(requestHeaders, 'User-Agent') ?? '',
          requestHeaders,
        );
        if (solved) {
          const fresh = this.getCookiesFor(requestUrl);
          if (fresh.trim() !== '') requestHeaders['Cookie'] = fresh;
          result = await this.cronetRequest(
            method,
            requestUrl,
            requestHeaders,
            body,
            this.requestJob,
            COMIC_READ_TIMEOUT_MS,
          );
        }
      }
      return result;
    } catch (e) {
      if (isCancellation(e)) throw e;
      // Kotlin `CronetResult(-1, emptyMap(), null, e.message ?: e.javaClass.simpleName)`
      return { status: -1, headers: {}, body: null, error: messageOf(e), finalUrl: null };
    }
  }

  /** Kotlin `private fun decodeComicText(bytes: ByteArray, headers): String`. */
  private decodeComicText(bytes: Uint8Array, headers: Record<string, string>): string {
    const contentType = headerEntry(headers, 'Content-Type') ?? '';
    const prefix = this.deps.decodeLatin1(bytes.subarray(0, Math.min(bytes.length, 4096)));
    const declaredGbk = /charset\s*=\s*["']?\s*(gbk|gb2312|gb18030)/i.test(
      `${contentType}\n${prefix}`,
    );
    const utf8 = this.deps.decodeUtf8(bytes);
    // Kotlin: `if (declaredGbk || utf8.contains('\uFFFD')) GB18030 else utf8`
    return declaredGbk || utf8.includes('�') ? this.deps.decodeCharset('GB18030', bytes) : utf8;
  }

  /** Kotlin `private fun cronetRequest(method, url, headers, body, job, timeoutMs)`. */
  private async cronetRequest(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: Uint8Array | null,
    signal: CancellationSignal = this.requestJob,
    timeoutMs: number = CRONET_TIMEOUT_MS,
  ): Promise<CronetResult> {
    // 部分代理/节点首次连接 e-hentai 等站点可能冷启动 30s+，放宽到 60s 避免误杀
    const deadline = this.deps.elapsedRealtime() + timeoutMs;
    const controller = new AbortController();
    const onOuterAbort = (): void => controller.abort();
    if (signal?.aborted === true) controller.abort();
    else signal?.addEventListener('abort', onOuterAbort, { once: true });
    const outbound: Record<string, string> = { ...headers };
    if (body !== null && !hasHeader(outbound, 'Content-Type')) {
      outbound['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
    }
    // Kotlin polls `latch.await(250, MILLISECONDS)`, re-checking `job?.ensureActive()`
    // and the deadline on every tick.
    let timedOut = false;
    const stopPolling = this.deps.startPolling(250, () => {
      if (signal?.aborted === true) {
        controller.abort();
        return;
      }
      if (this.deps.elapsedRealtime() >= deadline) {
        timedOut = true;
        controller.abort();
      }
    });
    let response: HttpResponseSpec | null = null;
    let failure: string | null = null;
    const timer = sourceHostSetTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(0, deadline - this.deps.elapsedRealtime()));
    try {
      const res = await this.deps.http.execute({
        method,
        url,
        headers: outbound,
        body,
        hasBody: body !== null,
        signal: controller.signal,
        insecureTls: this.insecureTls,
        timeouts: { connectMs: timeoutMs, readMs: timeoutMs, callMs: timeoutMs },
      });
      response = res;
    } catch (e) {
      // Kotlin `onFailed`:
      //   "[$url] " + (error?.message ?: error?.javaClass?.simpleName ?: "Cronet 请求失败")
      //            + if (cause != null) " | cause=$cause" else ""
      // The cause suffix is part of the text the source script sees, so it is
      // reproduced rather than dropped. `Throwable.toString()` on Android prints
      // `java.io.IOException: msg`; JS prints `Error: msg` — same suffix shape.
      const cause = e instanceof Error ? e.cause : undefined;
      failure =
        `[${url}] ${messageOf(e) || 'Cronet 请求失败'}` +
        (cause === undefined || cause === null ? '' : ` | cause=${String(cause)}`);
    } finally {
      clearTimeout(timer);
      stopPolling();
      signal?.removeEventListener('abort', onOuterAbort);
    }
    // Kotlin `job?.ensureActive()` after the latch loop: a cancelled caller must
    // see the CancellationException, never an error string.
    ensureActive(signal);
    // Kotlin returns from *inside* the deadline branch, so the timeout wins over
    // whatever the transport reported when the abort tore the request down.
    if (timedOut) {
      return { status: -1, headers: {}, body: null, error: '请求超时', finalUrl: null };
    }
    if (failure !== null) return { status: -1, headers: {}, body: null, error: failure, finalUrl: null };
    if (response === null) {
      return { status: -1, headers: {}, body: null, error: '请求超时', finalUrl: null };
    }
    const res = response;
    const finalUrl = res.finalUrl === '' ? url : res.finalUrl;
    // Kotlin `onResponseStarted` saves Set-Cookie while building the header map,
    // and `onReadCompleted` throws once the accumulated body passes 16 MiB:
    //   `require(bodyOut.size()+bytes.size <= 16L*1024*1024) { "JS 网络响应超过 16MiB" }`
    // The `IllegalArgumentException` is caught by the callback and reported
    // verbatim as `t.toString()`.
    if (res.body !== null && res.body.length > MAX_BODY_BYTES) {
      return {
        status: -1,
        headers: {},
        body: null,
        error: 'java.lang.IllegalArgumentException: JS 网络响应超过 16MiB',
        finalUrl: null,
      };
    }
    this.saveCookies(finalUrl, res.setCookies);
    const merged: Record<string, string> = {};
    // Kotlin `map.putIfAbsent(k, v.joinToString("; "))` keeps the FIRST occurrence
    // of a header name — including `Set-Cookie`, which the callback also saved.
    for (const [k, v] of Object.entries(res.headers)) {
      if (!(k in merged)) merged[k] = v;
    }
    if (res.setCookies.length > 0 && !('set-cookie' in merged)) {
      const original = Object.keys(res.headers).find((k) => k.toLowerCase() === 'set-cookie');
      merged[original ?? 'Set-Cookie'] = res.setCookies.join('; ');
    }
    return {
      status: res.status,
      headers: merged,
      body: res.body !== null && res.body.length > 0 ? res.body : null,
      error: null,
      finalUrl,
    };
  }

  // ------------------------------------------------------------------
  // cookie
  // ------------------------------------------------------------------

  /** Kotlin `private fun handleCookie(msg: Map<*, *>): Any?`. */
  private handleCookie(msg: Record<string, unknown>): unknown {
    const url = typeof msg['url'] === 'string' ? (msg['url'] as string) : null;
    if (url === null) return null;
    switch (msg['function']) {
      case 'set': {
        const cookies = msg['cookies'];
        if (Array.isArray(cookies)) {
          for (const item of cookies) {
            const record = asRecord(item);
            if (record !== null) {
              if (record['name'] === null || record['name'] === undefined) continue;
              if (record['value'] === null || record['value'] === undefined) continue;
              const name = stringOf(record['name']);
              const value = stringOf(record['value']);
              const domain = (
                record['domain'] === null || record['domain'] === undefined
                  ? this.hostOf(url)
                  : stringOf(record['domain'])
              ).replace(/^\./, '');
              this.saveCookieList(domain, [`${name}=${value}`]);
            } else if (item !== null && item !== undefined) {
              this.saveCookieList(this.hostOf(url), [stringOf(item)]);
            }
          }
        } else if (typeof cookies === 'string') {
          this.saveCookieList(
            this.hostOf(url),
            cookies.split(';').map((it) => it.trim()).filter((it) => it !== ''),
          );
        }
        return null;
      }
      // Network.getCookies promises Cookie objects, rather than "name=value" strings.
      // Include parent-domain cookies just as the HTTP request path does.
      case 'get': {
        const out = new JSONArray();
        for (const raw of this.getCookiesFor(url).split(';')) {
          const cookie = raw.trim();
          const separator = cookie.indexOf('=');
          if (separator <= 0) continue;
          out.put({
            name: cookie.slice(0, separator),
            value: cookie.slice(separator + 1),
            domain: this.hostOf(url),
            path: '/',
          });
        }
        return out.toString();
      }
      case 'delete':
        this.deps.cookies.clear(this.hostOf(url));
        return null;
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------
  // html
  // ------------------------------------------------------------------

  /** Kotlin `private fun handleHtml(msg: Map<*, *>): Any?`. */
  private handleHtml(msg: Record<string, unknown>): unknown {
    const name = typeof msg['function'] === 'string' ? (msg['function'] as string) : null;
    if (name === null) return null;
    const key = num(msg['key']) ?? 0;
    const store = this.deps.htmlStore;
    const query = (): string => (typeof msg['query'] === 'string' ? (msg['query'] as string) : '');
    switch (name) {
      case 'parse': {
        const html = typeof msg['data'] === 'string' ? (msg['data'] as string) : '';
        const jsKey = num(msg['key']) ?? 0;
        return store.parse(jsKey, html);
      }
      case 'dispose':
        store.dispose(key);
        return null;
      case 'querySelector':
        return store.querySelector(key, query());
      case 'querySelectorAll':
        return store.querySelectorAll(key, query());
      case 'getElementById':
        return store.getElementById(key, typeof msg['id'] === 'string' ? (msg['id'] as string) : '');
      case 'dom_querySelector':
        return store.domQuerySelector(key, query());
      case 'dom_querySelectorAll':
        return store.domQuerySelectorAll(key, query());
      case 'getText':
        return store.getText(key);
      case 'getAttributes':
        return new JSONObject(store.getAttributes(key)).toString();
      case 'getChildren':
        return store.getChildren(key);
      case 'getNodes':
        return store.getNodes(key);
      case 'getInnerHTML':
        return store.getInnerHTML(key);
      case 'getParent':
        return store.getParent(key);
      case 'getClassNames':
        return store.getClassNames(key);
      case 'getId':
        return store.getId(key);
      case 'getLocalName':
        return store.getLocalName(key);
      case 'getPreviousSibling':
        return store.getPreviousSibling(key);
      case 'getNextSibling':
        return store.getNextSibling(key);
      case 'node_text':
        return store.nodeText(key);
      case 'node_type':
        return store.nodeType(key);
      case 'node_toElement':
        return store.nodeToElement(key);
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------
  // UI / misc
  // ------------------------------------------------------------------

  /** Kotlin `private fun handleUi(msg: Map<*, *>): Any?`. */
  private handleUi(msg: Record<string, unknown>): unknown {
    switch (msg['function']) {
      case 'showMessage':
        JsLog.i(`JsSource[${this.sourceKey}]`, `UI: ${stringOf(msg['message'])}`);
        return null;
      case 'launchUrl':
        JsLog.i(`JsSource[${this.sourceKey}]`, `launchUrl ignored: ${stringOf(msg['url'])}`);
        return null;
      case 'showLoading':
        return 0;
      case 'cancelLoading':
        return null;
      case 'showInputDialog':
        return '';
      case 'showSelectDialog':
        return 0;
      case 'showDialog':
        JsLog.i(`JsSource[${this.sourceKey}]`, `dialog ignored: ${stringOf(msg['title'])}`);
        return null;
      default:
        return null;
    }
  }

  /**
   * 挂起版消息处理：仅在异步桥（sendMessage）里调用。
   * 与同步 handle 的区别：showInputDialog 会弹出真实对话框等待用户输入。
   */
  async handleAsync(message: unknown, signal: CancellationSignal = this.requestJob): Promise<unknown> {
    const msg = asRecord(message);
    if (msg === null) return this.resolve(this.handle(message));
    if (msg['method'] === 'delay') {
      let remaining = Math.min(Math.max(num(msg['time']) ?? 0, 0), 45_000);
      while (remaining > 0) {
        ensureActive(signal);
        const part = Math.min(remaining, 100);
        await cancellableDelay(part, signal);
        remaining -= part;
      }
      ensureActive(signal);
      return null;
    }
    if (msg['method'] === 'UI' && msg['function'] === 'showInputDialog') {
      const title = typeof msg['title'] === 'string' ? (msg['title'] as string) : '输入';
      const image = typeof msg['image'] === 'string' ? (msg['image'] as string) : null;
      return this.deps.showInputDialog(title, image, signal);
    }
    return this.resolve(this.handle(message));
  }

  private async resolve(value: unknown): Promise<unknown> {
    return value instanceof Promise ? await value : value;
  }

  /** Kotlin `private fun handleRandom(msg: Map<*, *>): Any?`. */
  private handleRandom(msg: Record<string, unknown>): unknown {
    const min = num(msg['min']) ?? 0;
    const max = num(msg['max']) ?? 1;
    if (max <= min) return min;
    switch (msg['type']) {
      case 'int':
        // Kotlin `Random.nextLong(min, max)` — max is exclusive.
        return this.deps.crypto.randomInt(min, max);
      case 'double':
        return this.deps.crypto.randomDouble(min, max);
      default:
        return this.deps.crypto.randomInt(min, max);
    }
  }

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  /** Kotlin `private fun dataKey(raw: Any?): String`. */
  private dataKey(raw: unknown): string {
    // Kotlin `"data_${sourceKey}_${raw ?: ""}"` — a numeric `raw` prints as a Double.
    return `data_${this.sourceKey}_${raw === null || raw === undefined ? '' : kotlinToString(raw)}`;
  }

  /** Kotlin `private fun encodeStored(value: Any?): String`. */
  private encodeStored(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean' || typeof value === 'number') return kotlinToString(value);
    const wrapped = jsonWrap(value);
    return `JSON:${String(wrapped?.toString() ?? 'null')}`;
  }

  /** Kotlin `private fun loadStored(raw: String?): Any?`. */
  private loadStored(raw: string | null): unknown {
    return raw !== null && raw !== '' ? raw : null;
  }

  /** Kotlin `private fun bytesOf(value: Any?): ByteArray?`. */
  private bytesOf(value: unknown): Uint8Array | null {
    if (isByteArray(value)) return value;
    if (Array.isArray(value)) {
      // Kotlin `mapNotNull { (it as? Number)?.toInt()?.toByte() }` drops non-numbers
      // (so the array can end up shorter); the port preserves element order.
      const out: number[] = [];
      for (const item of value) {
        if (typeof item !== 'number' || !Number.isFinite(item)) continue;
        out.push(item & 0xff);
      }
      return new Uint8Array(out);
    }
    return null;
  }

  /** Kotlin `private fun hostOf(url: String): String`. */
  private hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url.includes('/') ? url.slice(0, url.indexOf('/')) : url;
    }
  }

  /** Kotlin `private fun getCookiesFor(url: String): String`. */
  private getCookiesFor(url: string): string {
    return this.deps.cookies.cookieHeader(url);
  }

  /** Kotlin `private fun saveCookieList(host: String, cookies: List<String>)`. */
  private saveCookieList(host: string, cookies: string[]): void {
    this.deps.cookies.saveCookiePairs(host, cookies);
  }

  /** Kotlin `private fun saveCookies(url: String, setCookies: List<String>)`. */
  private saveCookies(url: string, setCookies: string[]): void {
    this.deps.cookies.saveSetCookies(url, setCookies);
  }
}

export type { HttpRequestSpec };
