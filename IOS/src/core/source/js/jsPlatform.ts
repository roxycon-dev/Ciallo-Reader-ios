/**
 * Support module (no Android counterpart in `source/js/`).
 *
 * Injected platform ports for the Venera JS runtime. Nothing in `src/core`
 * may touch React, the DOM or Capacitor, so every Android platform object used
 * by this module is declared here as an interface. The adapters (WKWebView /
 * Capacitor Preferences / fetch) are implemented OUTSIDE this directory.
 *
 * Android → port mapping:
 * - `android.content.Context` + `Context.getSharedPreferences(name, MODE_PRIVATE)`
 *   → `KeyValueStorage` (DataStore / Capacitor Preferences adapter).
 * - `java.io.File` (filesDir / cacheDir / assets) → `FileStoragePort`.
 * - `okhttp3.OkHttpClient` (+ Cronet `CronetEngine`) → `HttpClient`.
 * - `com.dokar.quickjs.QuickJs` → `JsRuntime`.
 * - `org.jsoup.Jsoup` DOM → `HtmlDom` (parsed by the existing pure-TS
 *   `@core/parser/legadoRule` parser, which is already a Jsoup-shaped tree).
 * - `android.webkit.WebView` / `CookieManager` → `WebViewPort` / `BrowserCookiePort`.
 * - `android.graphics.Bitmap` → `Bitmap`.
 * - `android.util.Log` → `JsLog`.
 * - `kotlinx.coroutines` `Mutex` / `Job` / `suspend` → promises + `MutexLike`.
 */

// Venera replaces global console/setTimeout; host logging and cancellation must
// retain the browser implementations to avoid re-entering the script bridge.
// eslint-disable-next-line no-console
const sourceHostConsole = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };
const sourceHostSetTimeout = globalThis.setTimeout.bind(globalThis);
/** Kotlin `android.util.Log`. */
export const JsLog = {
  i(tag: string, message: string): void {
    sourceHostConsole.log(`[${tag}] ${message}`);
  },
  w(tag: string, message: string, error?: unknown): void {
    sourceHostConsole.warn(`[${tag}] ${message}`, error ?? '');
  },
  e(tag: string, message: string, error?: unknown): void {
    sourceHostConsole.error(`[${tag}] ${message}`, error ?? '');
  },
};

/** Injected monotonic clock — Kotlin `android.os.SystemClock.elapsedRealtime()`. */
export type MonotonicClock = () => number;

/** Injected wall clock — Kotlin `System.currentTimeMillis()`. */
export type WallClock = () => number;

export interface KeyValueStorage {
  getString(key: string): string | null;
  getBoolean(key: string, fallback: boolean): boolean;
  getInt(key: string, fallback: number): number;
  putString(key: string, value: string): void;
  putBoolean(key: string, value: boolean): void;
  putInt(key: string, value: number): void;
  remove(key: string): void;
  clear(): void;
}

/** In-memory `KeyValueStorage`, the default adapter in tests / Capacitor-less hosts. */
export function createMemoryKeyValueStorage(): KeyValueStorage {
  const store = new Map<string, string>();
  return {
    getString: (key) => store.get(key) ?? null,
    getBoolean: (key, fallback) => (store.has(key) ? store.get(key) === 'true' : fallback),
    getInt: (key, fallback) => (store.has(key) ? Number(store.get(key)) : fallback),
    putString: (key, value) => void store.set(key, value),
    putBoolean: (key, value) => void store.set(key, String(value)),
    putInt: (key, value) => void store.set(key, String(value)),
    remove: (key) => void store.delete(key),
    clear: () => store.clear(),
  };
}

/** Injected file access — Kotlin `java.io.File` + `Context.filesDir/cacheDir/assets`. */
export interface FileStoragePort {
  /** Kotlin `Context.filesDir`; scripts + index.json live here. */
  filesDir(): string;
  /** Kotlin `Context.cacheDir`; downloaded e-hentai images live here. */
  cacheDir(): string;
  /** Kotlin `Context.cacheDir` file length / existence helpers. */
  exists(path: string): boolean;
  readText(path: string): string | null;
  writeText(path: string, content: string): void;
  readBytes(path: string): Uint8Array | null;
  writeBytes(path: string, content: Uint8Array): void;
  delete(path: string): void;
  mkdirs(path: string): void;
  length(path: string): number;
  /** Kotlin `Uri.fromFile(file).toString()` — a `file://` URL. */
  toFileUrl(path: string): string;
  /** Kotlin `context.assets.open(path)` — bundled JS runtime / source assets. */
  readAsset(path: string): string | null;
  listFiles(dir: string): string[];
}

export interface HttpRequestSpec {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: Uint8Array | null;
  /** Kotlin `Request.Builder().method(method, body)` — absent body for GET/HEAD. */
  readonly hasBody?: boolean;
  /** Kotlin `builder.proxy(proxy)` — the explicit proxy URL, or absent for NO_PROXY. */
  readonly viaProxy?: string;
  /** Kotlin `executeWithCancellation(job)` — the caller's AbortSignal. */
  readonly signal?: AbortSignal | null;
  /** Kotlin `connectTimeout`/`readTimeout`/`callTimeout` in milliseconds. */
  readonly timeouts?: { connectMs: number; readMs: number; callMs: number };
  /** Skip certificate verification — Kotlin `insecureTls`. */
  readonly insecureTls?: boolean;
}

export interface HttpResponseSpec {
  readonly status: number;
  readonly finalUrl: string;
  readonly headers: Record<string, string>;
  /** Kotlin `response.headers("Set-Cookie")` — every occurrence, not just the first. */
  readonly setCookies: string[];
  readonly body: Uint8Array | null;
}

export interface HttpFailure {
  /** Kotlin `e.message ?: e.javaClass.simpleName`. */
  readonly message: string;
}

/** Injected OkHttp/Cronet transport — see `src/core/source/networkCalls.ts`. */
export interface HttpClient {
  execute(request: HttpRequestSpec): Promise<HttpResponseSpec>;
}

/** Result envelope mirroring Kotlin's `CronetResult` + OkHttp error handling. */
export type HttpOutcome =
  | { readonly ok: true; readonly response: HttpResponseSpec }
  | { readonly ok: false; readonly error: string };

/** Kotlin `com.example.source.zlibrary.network.SystemProxyResolver`. */
export interface SystemProxyResolverPort {
  /** Resolves the device-configured system proxy, or null when unset. */
  resolve(): string | null;
}

/** Kotlin `java.net.Proxy` reduced to what the routing logic compares. */
export interface ProxyRoute {
  /** `host:port` of the proxy, used for equality against the cached value. */
  readonly authority: string;
  /** The proxy URL passed to the platform fetch/WebView. */
  readonly url: string;
}

/**
 * 2026-10-11（SECURITY_AUDIT P0-1~P0-4）改动说明：
 * - `evaluate` 从同步改为 **async**：生产求值路径现在走平台层的真 Worker 沙箱
 *   （`platform/web/jsSourcePlatform.ts` 的 `createWebJsRuntime`），求值必须在
 *   主线程 await Worker 的往返结果。Kotlin `quickJs.evaluate` 是同步 API ——
 *   这是 JS 侧做不到同步往返 Worker 时的**结构性偏差**，登记在 E33/E40
 *   （E40 的「同步求值」入口因此不复存在：所有调用方都是异步的）。
 * - 新增 `armExecution(signal)`：Kotlin `beginBudget()` 把 caller 的 Job 交给
 *   `checkBudget()`（JsSourceEngine.kt:31-39），取消请求能在下一次 tick/桥调用
 *   打断脚本。Worker 沙箱里 tick 运行在沙箱线程，主线程通过本方法投递
 *   `{op:'abort'}` 消息实现同一语义。
 * - `registerFunction` / `registerAsyncFunction` 现在是**真绑定**（此前是 no-op，
 *   P0-3）：平台实现把绑定记录到宿主侧注册表，沙箱内以「全局 RPC 桩」形态
 *   可调用（`registerFunction` 注册的同步函数在 Worker 隔离下也只能以
 *   Promise 形态返回 —— 同步往返在浏览器主线程上没有安全实现，见 E33/E40）。
 */
/** Kotlin `com.dokar.quickjs.QuickJs` — replaced by a Worker-isolated sandbox. */
export interface JsRuntime {
  readonly synchronousBindings?: boolean;
  /** Kotlin `quickJs.evaluate<String>(code, filename)` — async: Worker 往返（见上方说明）。 */
  evaluate(code: string, filename: string): Promise<string | null>;
  /** Kotlin `quickJs.function(name) { args -> ... }` — registers a native binding. */
  registerFunction(name: string, fn: (...args: unknown[]) => unknown): void;
  /** Kotlin `quickJs.asyncFunction(name) { args -> ... }` — returns a Promise. */
  registerAsyncFunction(name: string, fn: (...args: unknown[]) => Promise<unknown>): void;
  /**
   * Kotlin `beginBudget()` 的「把 caller Job 交给 checkBudget」半边（JsSourceEngine.kt:31-35）。
   * Worker 沙箱据此在 abort 时向沙箱投递打断消息；null = 解除武装。
   */
  armExecution(signal: CancellationSignal | null): void;
  /** Kotlin `memoryLimit = 32MiB` / `maxStackSize = 512KiB`; 0 = unlimited. */
  readonly memoryLimit: number;
  readonly maxStackSize: number;
  /** Kotlin `QuickJsAsyncLifecycle.settle(runtime)` → `runtime.gc()`. */
  gc(): void;
  /** Kotlin `Mutex.withLock` — serialize evaluations on one context. */
  acquire(): Promise<() => void>;
}

/** Kotlin `android.graphics.Bitmap` — only the pixel access the JS bridge uses. */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  /** Kotlin `bitmap.getPixels(row, 0, width, 0, y, width, 1)`. */
  getPixels(x: number, y: number, width: number, height: number): Uint8Array;
  /** Kotlin `Bitmap.createBitmap(w, h, ARGB_8888)`. */
  createBitmap(width: number, height: number): Bitmap;
  /** Kotlin `Bitmap.createBitmap(src, x, y, w, h)` / `+ Matrix`. */
  createBitmapFrom(src: Bitmap, x: number, y: number, width: number, height: number): Bitmap;
  /** Kotlin `Bitmap.createBitmap(src, 0, 0, w, h, matrix(90f), true)`. */
  createRotated90(src: Bitmap): Bitmap;
  /** Kotlin `Canvas(dst).drawBitmap(src, x, y, null)`. */
  drawBitmap(dst: Bitmap, src: Bitmap, x: number, y: number): void;
  /** Kotlin `Canvas(dst).drawBitmap(src, srcRect, dstRect, null)`. */
  drawBitmapRect(
    dst: Bitmap,
    src: Bitmap,
    srcX: number,
    srcY: number,
    width: number,
    height: number,
    x: number,
    y: number,
  ): void;
  /** Kotlin `bitmap.allocationByteCount`. */
  readonly allocationByteCount: number;
  /** Kotlin `BitmapFactory.decodeByteArray` (bounds probe + real decode). */
  decodeBytes(bytes: Uint8Array): Bitmap | null;
  /** Kotlin `bmp.compress(Bitmap.CompressFormat.PNG, 100, out)`. */
  compressPng(): Uint8Array | null;
  recycle(): void;
}

/** Kotlin `org.jsoup.nodes.Node` — the subset JsHtmlStore exposes to the JS side. */
export interface HtmlDomNode {
  readonly tagName: string;
  readonly id: string;
  readonly classNames: string[];
  readonly attributes: Readonly<Record<string, string>>;
  readonly childNodes: HtmlDomNode[];
  readonly children: HtmlDomNode[];
  readonly parentNode: HtmlDomNode | null;
  readonly nodeKind: 'element' | 'text' | 'comment' | 'data' | 'doctype' | 'document';
  /** Kotlin `el.text()` */
  text(): string;
  /** Kotlin `el.html()` */
  html(): string;
  /** Kotlin `el.data()` — DataNode contents (script/style payloads). */
  data(): string;
  /** Kotlin `Node.toString()` */
  outerHtml(): string;
  selectFirst(query: string): HtmlDomNode | null;
  select(query: string): HtmlDomNode[];
  getElementById(id: string): HtmlDomNode | null;
  getAllElements(): HtmlDomNode[];
  previousElementSibling(): HtmlDomNode | null;
  nextElementSibling(): HtmlDomNode | null;
  /** Optional: a pure-TS DOM may not track the owning document. */
  ownerDocument?(): HtmlDomNode | null;
}

/** Kotlin `org.jsoup.Jsoup.parse(html)` — a pure-TS parser supplies this. */
export interface HtmlDomParser {
  parse(html: string): HtmlDomNode;
  /** Kotlin `Jsoup.parse(raw).wholeText()` — used by JsComicMetadata. */
  wholeText(html: string): string;
}

/** Kotlin `android.webkit.CookieManager` (the WebView browser jar). */
export interface BrowserCookiePort {
  setAcceptCookie(accept: boolean): void;
  /** Kotlin `CookieManager.getCookie(url)`. */
  getCookie(url: string): string | null;
  flush(): void;
}

/** A headless page-load session — Kotlin `WebView` + its `WebViewClient`. */
export interface WebViewSession {
  /** Kotlin `wv.loadUrl(url, safeHeaders)`. */
  loadUrl(url: string, headers: Record<string, string>): void;
  stopLoading(): void;
  destroy(): void;
  /** Kotlin `wv.evaluateJavascript(script) { value -> }`. */
  evaluateJavascript(script: string): Promise<string | null>;
  /** Kotlin `wv.addJavascriptInterface(obj, name)`. */
  exposeInterface(name: string, api: Record<string, () => void>): void;
  /** Kotlin `browser.layoutParams = MATCH_PARENT × MATCH_PARENT`. */
  setFullSize(): void;
  /** Kotlin `wv.layout(0, 0, 1080, 1920)`. */
  setSize(width: number, height: number): void;
  /** Kotlin `wv.webViewClient = object : WebViewClient() { … }`. */
  setHandlers(handlers: WebViewClientHandlers): void;
}

export interface WebViewFactory {
  create(url: string, userAgent: string): WebViewSession;
  cookies: BrowserCookiePort;
}

/** WebView factory event callbacks — Kotlin `WebViewClient` overrides. */
export interface WebViewClientHandlers {
  /** Kotlin `onPageFinished(view, viewUrl)`. */
  onPageFinished?: (view: WebViewSession, viewUrl: string) => void;
  /** Kotlin `onPageStarted(view, url, favicon)`. */
  onPageStarted?: (view: WebViewSession, viewUrl: string) => void;
  /** Kotlin `onReceivedHttpError(view, request, errorResponse)`. */
  onReceivedHttpError?: (view: WebViewSession, url: string, isMainFrame: boolean, headers: Record<string, string>) => void;
  /** Kotlin `shouldOverrideUrlLoading(view, request)`. */
  shouldOverrideUrlLoading?: (url: string, isMainFrame: boolean) => boolean;
}

/** Kotlin `coil` image pipeline used for the MXS spacer probe. */
export interface ImageProbe {
  /** Kotlin `coil.request.ImageRequest … comicImageLoader(context).execute(request)`. */
  loadBitmap(url: string, headers: Record<string, string>): Promise<Bitmap | null>;
}

/** Kotlin `java.security.MessageDigest` / `Mac` / `javax.crypto.Cipher` primitives. */
export interface CryptoPort {
  digest(algorithm: string, data: Uint8Array): Uint8Array;
  hmac(algorithm: string, key: Uint8Array, data: Uint8Array): Uint8Array;
  /** Kotlin `Cipher.getInstance(mode).init(DECRYPT_MODE, key, iv)`. */
  aesDecrypt(
    mode: 'AES/ECB/NoPadding' | 'AES/CBC/PKCS5Padding' | 'AES/CFB/NoPadding' | 'AES/OFB/NoPadding',
    key: Uint8Array,
    iv: Uint8Array | null,
    data: Uint8Array,
  ): Uint8Array;
  /** Kotlin `RSA` decrypt with a PEM private key. */
  rsaDecrypt(value: Uint8Array, key: string): Uint8Array;
  randomUUID(): string;
  randomInt(min: number, max: number): number;
  randomDouble(min: number, max: number): number;
}

/** The complete set of adapters `JsSourceEngine` and friends need. */
export interface JsPlatform {
  readonly monotonicClock: MonotonicClock;
  readonly wallClock: WallClock;
  /** Kotlin `context.getSharedPreferences(name, MODE_PRIVATE)`. */
  preferences(name: string): KeyValueStorage;
  readonly files: FileStoragePort;
  readonly http: HttpClient;
  readonly systemProxy: SystemProxyResolverPort;
  readonly dom: HtmlDomParser;
  readonly webview: WebViewFactory;
  readonly crypto: CryptoPort;
  /** Kotlin `Runtime.getRuntime().maxMemory()` for the JS image budget. */
  readonly maxMemory: number;
}

/** Kotlin `kotlinx.coroutines.currentCoroutineContext()[Job]` — cancellation token. */
export type CancellationSignal = AbortSignal | null;

/**
 * 看门狗兜底错误（Web 侧独有，Kotlin 无对应物）：45s 预算由沙箱内的
 * `__cialloTick` 逐 tick 检查（对齐 Kotlin `checkBudget`，JsSourceEngine.kt:36-39）；
 * 但插桩管不到的原生悬挂（灾难性正则回溯、超大 `JSON.parse`）只能靠主线程
 * 看门狗**终止并重建沙箱**。终止意味着 realm 状态（`__veneraSrc` 实例等）丢失，
 * 引擎捕获本错误后必须把 `ready` 复位、下次调用重新初始化。
 */
export class JsSandboxResetError extends Error {
  constructor(message = 'JS 沙箱已被看门狗终止，运行环境将重新初始化') {
    super(message);
    this.name = 'JsSandboxResetError';
  }
}

/** Kotlin `requestJob?.ensureActive()`. */
export function ensureActive(signal: CancellationSignal): void {
  if (signal?.aborted === true) {
    const error = new Error('JS request cancelled');
    error.name = 'AbortError';
    throw error;
  }
}

/** Kotlin `kotlinx.coroutines.CancellationException` — must never be swallowed. */
export class JsCancellationError extends Error {
  constructor(message = 'JS request cancelled') {
    super(message);
    this.name = 'AbortError';
  }
}

export function isCancellation(error: unknown): boolean {
  return error instanceof JsCancellationError || (error instanceof Error && error.name === 'AbortError');
}

/** Kotlin `kotlinx.coroutines.delay(millis)`, cancellable through `signal`. */
export function cancellableDelay(millis: number, signal?: CancellationSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new JsCancellationError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new JsCancellationError());
    };
    const timer = sourceHostSetTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, millis);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Kotlin `Mutex` — an async lock; `withLock` returns the release action. */
export class JsMutex {
  private tail: Promise<void> = Promise.resolve();

  acquire(): Promise<() => void> {
    let release: () => void = () => undefined;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => next);
    return previous.then(() => release);
  }

  async withLock<T>(block: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await block();
    } finally {
      release();
    }
  }
}

/** Kotlin `LinkedHashMap<K, V>(initialCapacity, loadFactor, accessOrder)` — LRU. */
export class LruMap<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly readonlyMaxSize: number) {}

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    // Kotlin access-order LinkedHashMap: `get` promotes the entry.
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.readonlyMaxSize) {
      const eldest = this.map.keys().next();
      if (eldest.done === true) break;
      this.map.delete(eldest.value);
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /** Kotlin `keys.first()` — the eldest access-ordered key. */
  firstKey(): K | undefined {
    for (const key of this.map.keys()) return key;
    return undefined;
  }

  values(): V[] {
    return [...this.map.values()];
  }

  keys(): K[] {
    return [...this.map.keys()];
  }

  clear(): void {
    this.map.clear();
  }

  /** Kotlin `Map.values.sumOf { ... }`. */
  totalOf(selector: (value: V) => number): number {
    let total = 0;
    for (const value of this.map.values()) total += selector(value);
    return total;
  }
}

/** Kotlin `LinkedHashMap<String, V>(128, 0.75f, true)` with a 512-entry ceiling. */
export class Lru512<V> extends LruMap<string, V> {
  constructor() {
    super(512);
  }
}
