/**
 * genericCoverLoader.ts —— `library/GenericCoverLoader.kt`（49 行）的移植。
 *
 * Kotlin 原文（逐条对应）：
 *
 * ```kotlin
 * object GenericCoverLoader {
 *     @Volatile private var cachedLoader: ImageLoader? = null
 *     fun get(context: Context): ImageLoader {
 *         return cachedLoader ?: synchronized(this) {
 *             cachedLoader ?: buildLoader(context.applicationContext).also { cachedLoader = it }
 *         }
 *     }
 *     private fun buildLoader(context: Context): ImageLoader {
 *         val clientBuilder = SharedHttpTransport.builder()
 *             .connectTimeout(10, TimeUnit.SECONDS)
 *             .readTimeout(15, TimeUnit.SECONDS)
 *             .protocols(listOf(Protocol.HTTP_1_1))
 *             .addInterceptor { chain ->
 *                 val req = chain.request()
 *                 val cookie = JsCookieJar.cookieHeader(context, req.url.toString())
 *                 val builder = req.newBuilder()
 *                 if (cookie.isNotBlank() && req.header("Cookie").isNullOrBlank()) builder.header("Cookie", cookie)
 *                 if (req.header("User-Agent").isNullOrBlank()) builder.header("User-Agent", "Mozilla/5.0 (Linux; Android 13) … Chrome/108.0.5359.128 Mobile Safari/537.36")
 *                 chain.proceed(builder.build())
 *             }
 *         return ImageLoader.Builder(context)
 *             .okHttpClient(JsSourceProxy.failoverClient(context, clientBuilder.build()))
 *             .crossfade(true)
 *             .build()
 *     }
 * }
 * ```
 *
 * 语义要点（都是**条件**，不是无条件覆盖）：
 *   · `Cookie` 只在「请求自己没有 Cookie **且** 该 URL 有已登录源的会话 cookie」时补；
 *   · `User-Agent` 只在「请求自己没有 UA」时补；
 *   · head 查找必须是**大小写不敏感**的（OkHttp 的 `header(name)` 就是），
 *     否则 `cookie:` 这种写法会被当成「没有」而插出两个 Cookie 头；
 *   · 单例缓存：`cachedLoader ?: …`，一处实例被复用（Coil 的 loader 很重）。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L15-16 `@Volatile var cachedLoader`          → 模块级 `cachedLoader`
 *   L18-22 `fun get(context)`                    → `GenericCoverLoader.get(deps)`
 *   L24-48 `private fun buildLoader(context)`     → `buildGenericCoverLoader(deps)`
 *   L25-28 `connectTimeout(10s)/readTimeout(15s)/protocols(HTTP_1_1)`
 *                                                → `GENERIC_COVER_CONFIG`
 *   L29-43 `addInterceptor { … }`                → `buildGenericCoverHeaders(...)`
 *   L45    `JsSourceProxy.failoverClient(…)`     → `failover: true`（宿主侧的走法见 E176）
 *   L46    `.crossfade(true)`                    → `crossfade: true`
 *
 * ⚠️ 与 Coil 的差别（见 `docs/PARITY_EXCEPTIONS.md` E176）：`ImageLoader` 是「请求 → 位图」的
 * 完整管线；Web/iOS 侧要的是**同一组请求头**落到真正的图片请求上。所以这里给的是
 * 「一次封面请求的配置 + 请求头」，由宿主用它去 `fetch` 再把响应转成 `blob:` URL ——
 * 直接丢给 `<img src>` 是**带不上**请求头的（`<img>` 没有 header 能力）。
 */

/** Kotlin L25-28 `.connectTimeout(10, SECONDS).readTimeout(15, SECONDS).protocols(HTTP_1_1)`。 */
export const GENERIC_COVER_CONFIG = {
  connectTimeoutMs: 10_000,
  readTimeoutMs: 15_000,
  protocols: ['http/1.1'],
  /** Kotlin L46 `.crossfade(true)`。 */
  crossfade: true,
} as const;

/**
 * Kotlin L39 的 UA 字面量，逐字：
 * `Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko)
 *  Chrome/108.0.5359.128 Mobile Safari/537.36`
 *
 * ⚠️ 与 `COVER_USER_AGENT`（Z-Library 专用，Android 14 + Chrome/120）**不是同一个串** ——
 * 两个 loader 用的是各自站点验证过的那一个，不要合并。
 */
export const GENERIC_COVER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/108.0.5359.128 Mobile Safari/537.36';

/** Kotlin 里 `JsCookieJar.cookieHeader(context, url)` 的最小形状。 */
export interface GenericCoverCookieJar {
  /** 该 URL 的已登录源会话 cookie；无则 `null` / 空串。 */
  getCookie(url: string): string | null;
}

export interface GenericCoverHeaderParams {
  /** 正在取封面的 URL（Kotlin `req.url.toString()`）。 */
  url: string;
  /** Kotlin `JsCookieJar.cookieHeader(context, url)`。 */
  cookie: string | null;
  /** 请求**已经**带的头（大小写不敏感查找）。 */
  existingHeaders?: Readonly<Record<string, string>>;
}

/**
 * Kotlin L29-43 的 `addInterceptor { chain -> … }` 本体 —— 只补缺，不覆盖。
 *
 * `Object.entries(...).find(([k]) => k.toLowerCase() === name)` 就是 OkHttp
 * `req.header("Cookie")` 的大小写不敏感语义。
 */
export function buildGenericCoverHeaders(
  params: GenericCoverHeaderParams,
): Record<string, string> {
  const headers: Record<string, string> = { ...(params.existingHeaders ?? {}) };
  const hasHeader = (name: string): boolean =>
    Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
  const cookie = params.cookie ?? '';
  // Kotlin `if (cookie.isNotBlank() && req.header("Cookie").isNullOrBlank())`
  if (cookie.trim() !== '' && !hasHeader('Cookie')) {
    headers['Cookie'] = cookie;
  }
  // Kotlin `if (req.header("User-Agent").isNullOrBlank())`
  if (!hasHeader('User-Agent')) {
    headers['User-Agent'] = GENERIC_COVER_USER_AGENT;
  }
  return headers;
}

/** 替代 Coil `ImageLoader` 的平台图片管线描述符。 */
export interface GenericCoverImageLoader {
  readonly config: typeof GENERIC_COVER_CONFIG;
  /** Kotlin L45 `JsSourceProxy.failoverClient(…)` —— 宿主必须走同一套「失败换线路」。 */
  readonly failover: true;
  /** Kotlin L46 `.crossfade(true)`。 */
  readonly crossfade: true;
  /** Kotlin L29-43 —— 一次封面请求的头。 */
  headersFor(url: string): Record<string, string>;
}

export interface GenericCoverLoaderDeps {
  cookies: GenericCoverCookieJar;
  /** 已经确定的请求头（例如调用方自己带 Referer）。 */
  existingHeaders?: Readonly<Record<string, string>>;
}

/** Kotlin L24-48 `private fun buildLoader(context): ImageLoader`。 */
export function buildGenericCoverLoader(deps: GenericCoverLoaderDeps): GenericCoverImageLoader {
  const headersFor = (url: string): Record<string, string> =>
    buildGenericCoverHeaders({
      url,
      cookie: deps.cookies.getCookie(url),
      ...(deps.existingHeaders !== undefined ? { existingHeaders: deps.existingHeaders } : {}),
    });
  return {
    config: GENERIC_COVER_CONFIG,
    failover: true,
    crossfade: true,
    headersFor,
  };
}

/** Kotlin L15-16 `@Volatile private var cachedLoader: ImageLoader? = null`。 */
let cachedLoader: GenericCoverImageLoader | null = null;

/** Kotlin L18-22 `fun get(context): ImageLoader` —— 单例复用。 */
export const GenericCoverLoader = {
  get(deps: GenericCoverLoaderDeps): GenericCoverImageLoader {
    if (cachedLoader === null) cachedLoader = buildGenericCoverLoader(deps);
    return cachedLoader;
  },
  /** 非 Kotlin：测试/宿主换依赖时清空单例（Coil 侧靠进程重启）。 */
  reset(): void {
    cachedLoader = null;
  },
};

/** 非 Kotlin：只读当前单例（测试用）。 */
export function currentGenericCoverLoader(): GenericCoverImageLoader | null {
  return cachedLoader;
}
