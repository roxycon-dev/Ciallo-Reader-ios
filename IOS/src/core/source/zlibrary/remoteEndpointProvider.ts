/**
 * Kotlin → TS: `source/zlibrary/RemoteEndpointProvider.kt` (170 lines, 158 non-blank)
 *             → `src/core/source/zlibrary/remoteEndpointProvider.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary → SKIPPED (TS has no packages)
 *   L3-5      import android.content.Context / android.content.SharedPreferences / android.util.Log
 *                                      → Context REPLACED by the injected transport; SharedPreferences
 *                                        REPLACED by `ZLibraryPrefsStore`; Log → `SourceLog`
 *   L6-10     import kotlinx.coroutines.*     → dropped (Promises)
 *   L11-12    import okhttp3.OkHttpClient / Request → injected `ZLibraryHttpTransport`
 *   L13-14    import org.json.{JSONArray,JSONObject} → plain `JSON` objects/arrays
 *   L15       import java.util.concurrent.TimeUnit → ms literals (`REMOTE_CLIENT_CONFIG`)
 *   L17-33    KDoc 远程 Z-Library 节点动态发现。第十三轮…第十一轮瘦身沿用：org.json 手写解析。
 *                                       → preserved verbatim on the class
 *   L34       class RemoteEndpointProvider(private val context: Context) → `constructor(store, transport)`
 *   L35       prefs = getSharedPreferences("zlib_remote_config", MODE_PRIVATE) → injected store
 *   L36-40    okHttpClient = builder().connectTimeout(6s).readTimeout(8s).build() → `REMOTE_CLIENT_CONFIG`
 *   L41-59    KDoc + PORTAL_SOURCES (6 URLs, Chinese annotations) → preserved verbatim
 *   L61-64    private companion object { DEPRIORITIZE } → module const (verbatim list + comment)
 *   L66       suspend fun fetchLatestEndpoints(): List<RemoteEndpointConfig>? → async
 *   L67-73    withContext(IO) + try → `async` + try/catch
 *   L68-72    KDoc 页面上全部官方域名… + domainRegex → verbatim regex
 *   L74-86    coroutineScope { PORTAL_SOURCES.map { async { runCatching { request } } }.awaitAll() }
 *                                       → `Promise.all` (each branch already catches)
 *   L87-96    LinkedHashSet + per-html regex scan + `.png`/`.js` filter → verbatim
 *   L97-98    found.add("z-lib.app")       → verbatim
 *   L100-103  empty → Log.w + getCachedEndpoints() → verbatim
 *   L104-107  Log.i with the `${htmls.count { … }}` expression → verbatim
 *   L109-112  sortedBy DEPRIORITIZE rank  → verbatim (stable sort, ES2019+)
 *   L113-120  mapIndexed → RemoteEndpointConfig(priority = ranked.size - i) → verbatim
 *   L122-133  JSONArray/JSONObject cache write → `JSON.stringify` of the same four fields
 *   L135-138  catch → Log.w + getCachedEndpoints() → verbatim
 *   L141-160  private fun parseConfigs   → `parseConfigs` (JSON.parse, same defaults)
 *   L162-164  private fun saveCache("cached_portal_domains") → verbatim
 *   L166-169  private fun getCachedEndpoints() → verbatim
 *   L170      closing brace              → n/a
 *
 * Adaptations:
 *   - `withContext(Dispatchers.IO)` dropped; `SharedPreferences` → injected `ZLibraryPrefsStore`.
 *   - `org.json` (Android-only) → `JSON.parse` / `JSON.stringify`. `optString` returns "" for a
 *     missing key (org.json's default) — reproduced with `?? ''`; `optInt`/`optLong` default
 *     0 — same. The cache JSON shape (`url`/`priority`/`updatedAt`/`version`) is unchanged.
 *   - Kotlin `sortedBy` is stable and so is `Array.prototype.sort` (ES2019), so the ranking
 *     order is identical.
 *   - `Request.Builder().url(url).header("Accept","text/html")` → the transport spec; note the
 *     Kotlin request has NO explicit method, i.e. OkHttp's default GET — kept as `method: 'GET'`.
 *   - `resp.isSuccessful ? resp.body?.string() : null` → the transport throws on non-2xx, which
 *     the per-source `runCatching` already absorbs, giving the same `null` per source.
 */

import { SourceLog } from '../sourceLog';
import {
  ZLibraryHttpClientConfig,
  type ZLibraryHttpTransport,
  isSuccessfulCode,
} from './network/zLibraryHttpClient';
import { createRemoteEndpointConfig, type RemoteEndpointConfig } from './remoteEndpointConfig';
import type { ZLibraryPrefsStore } from './zLibraryHost';

/**
 * 远程 Z-Library 节点动态发现。
 *
 * 第十三轮：官方把零散镜像持续 301 归拢（2026-09 实测 zh.101k.by / zlib.ch /
 * zlib.re / zh.z-library.by 全部 → zlib.bz），写死的节点清单注定过期。改为从
 * **官方访问入口页 z-lib.app** 抓取它披露的官方域名列表（纯静态页、不挂挑战、
 * 无需登录）——官方把用户引导到哪个域，这里就能发现哪个域，"站点变动自动跟上"。
 *
 * 2026-09-04 晚（回应"内置节点全部无效怎么办"）：单一来源一被墙，发现链就断。
 * 扩为**四源并行、互为备份**——任一源成功即可贡献域名，发现能力不再绑定任何
 * 单个站点的存亡。官方换域 → 门户/频道更新 → 下一次扫描自动跟上，内置清单
 * 过期不再是死局。
 *
 * 原远程 JSON 配置（example.com 占位）从未启用，本类替代其职责；
 * JSON 缓存格式保留兼容（旧缓存 key 独立，不冲突）。
 * 第十一轮瘦身沿用：org.json 手写解析。
 */
export class RemoteEndpointProvider {
  /**
   * 六个发现源（并行抓取）：
   *  1. zlib.wwkejishe.top  中文导航站（用户指定，2026-08-12 更新；#official-urls
   *                          表格维护全部官方入口 + 假站黑名单，发现价值最高：
   *                          2026-09-04 实测它披露的 z-lib.by 完全可用）；
   *  2. z-lib.app           官方门户，披露全部官方镜像域（2026-09-04 CN 实测可达 200）；
   *  3. go-to-zlibrary.com  官方跳转入口（CN 暂被墙 000，海外/挂系统代理网络可达）；
   *  4. z.wwwnav.com        第三方中文导航页（CN 可达性最高；节点管理页同源）；
   *  5. t.me/s/Zlib_IO      官方 TG 频道公开预览（新域公告第一现场；CN 被墙，
   *                          用户挂系统代理时可达）；
   *  6. znew.pages.dev      发布页"永久收藏页"（2026-09-04 22:40 实测披露了可用的
   *                          z-library.sk 官方入口 + 钓鱼站黑名单，发现价值已验证）。
   */
  static readonly PORTAL_SOURCES: readonly string[] = [
    'https://zlib.wwkejishe.top/',
    'https://z-lib.app/',
    'https://go-to-zlibrary.com/',
    'https://z.wwwnav.com/rkfby.html',
    'https://t.me/s/Zlib_IO',
    'https://znew.pages.dev/',
  ];

  constructor(
    private readonly store: ZLibraryPrefsStore,
    private readonly transport: ZLibraryHttpTransport,
  ) {}

  async fetchLatestEndpoints(signal?: AbortSignal | null): Promise<RemoteEndpointConfig[] | null> {
    try {
      // 页面上全部官方域名（z-lib.* / zlib* / z-library* / zlibrary* / 1lib* / singlelogin*）。
      const domainRegex =
        /https?:\/\/((?:[a-z0-9-]+\.)*(?:z-lib|zlib|z-library|zlibrary|1lib|singlelogin)[a-z0-9.-]+)/gi;

      // 四源并行抓取：单源失败/被墙不影响其他源（6s 连接超时快速失败）。
      const htmls = await Promise.all(
        RemoteEndpointProvider.PORTAL_SOURCES.map(async (url) => {
          try {
            const resp = await this.transport.send(
              {
                method: 'GET',
                url,
                referer: null,
                extraHeaders: { Accept: 'text/html' },
                formFields: null,
                callTimeoutMs: REMOTE_CLIENT_CONFIG.readTimeoutMs,
              },
              signal ?? null,
            );
            return isSuccessfulCode(resp.code) ? resp.body : '';
          } catch {
            return '';
          }
        }),
      );
      const found: string[] = [];
      for (const html of htmls) {
        if (html === '') continue;
        domainRegex.lastIndex = 0;
        for (const m of html.matchAll(domainRegex)) {
          const host = (m[1] ?? '').toLowerCase();
          if (host.includes('.') && !host.endsWith('.png') && !host.endsWith('.js')) {
            if (!found.includes(host)) found.push(host);
          }
        }
      }
      // 门户自身也常是可用入口（静态可达）
      if (!found.includes('z-lib.app')) found.push('z-lib.app');

      if (found.length === 0) {
        SourceLog.log(
          'ZLibRemote',
          `all ${RemoteEndpointProvider.PORTAL_SOURCES.length} discovery sources disclosed nothing`,
        );
        return this.getCachedEndpoints();
      }
      SourceLog.log(
        'ZLibRemote',
        `discovered ${found.length} domains from ${htmls.filter((it) => it !== '').length}/${RemoteEndpointProvider.PORTAL_SOURCES.length} sources: ${found.join(', ')}`,
      );

      // 排序：非归拢枢纽优先（真实镜像在前），压过纯入口页
      const ranked = found.slice().sort((a, b) => deprioritizeRank(a) - deprioritizeRank(b));
      const configs = ranked.map((host, i) =>
        createRemoteEndpointConfig({
          url: host,
          priority: ranked.length - i,
          updatedAt: Date.now(),
          version: 'portal',
        }),
      );

      // 缓存为 JSON（复用 parseConfigs 格式）
      await this.saveCache(
        JSON.stringify(configs.map((c) => ({ url: c.url, priority: c.priority, updatedAt: c.updatedAt, version: c.version }))),
      );
      return configs;
    } catch (e) {
      SourceLog.log('ZLibRemote', `portal fetch failed: ${errorMessage(e)}`);
      return this.getCachedEndpoints();
    }
  }

  /** Kotlin `private fun parseConfigs(json)` (L141-160). */
  parseConfigs(json: string): RemoteEndpointConfig[] | null {
    try {
      const array = JSON.parse(json) as unknown;
      if (!Array.isArray(array)) return null;
      const out: RemoteEndpointConfig[] = [];
      for (const item of array) {
        if (typeof item !== 'object' || item === null) continue;
        const o = item as { url?: unknown; priority?: unknown; updatedAt?: unknown; version?: unknown };
        out.push(
          createRemoteEndpointConfig({
            url: typeof o.url === 'string' ? o.url : '',
            priority: typeof o.priority === 'number' ? o.priority : 0,
            updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
            version: typeof o.version === 'string' ? o.version : '',
          }),
        );
      }
      return out;
    } catch {
      return null;
    }
  }

  /** Kotlin `private fun saveCache(json)` (L162-164). */
  async saveCache(json: string): Promise<void> {
    await this.store.putString('cached_portal_domains', json);
  }

  /** Kotlin `private fun getCachedEndpoints()` (L166-169). */
  async getCachedEndpoints(): Promise<RemoteEndpointConfig[] | null> {
    const json = await this.store.getString('cached_portal_domains');
    if (json === null) return null;
    return this.parseConfigs(json);
  }
}

/**
 * Kotlin `private val DEPRIORITIZE = listOf("z-lib.app", "zlibrary-forum", "pages.dev", "go-to-zlibrary")`
 * (L63) — 抓到的域名里，这些入口页/归拢枢纽价值低，排到候选列表尾部。
 */
const DEPRIORITIZE: readonly string[] = [
  'z-lib.app',
  'zlibrary-forum',
  'pages.dev',
  'go-to-zlibrary',
];

/**
 * Kotlin L110-112:
 *   `sortedBy { host -> DEPRIORITIZE.indexOfFirst { host.contains(it) }.let { if (it >= 0) 1 else 0 } }`
 */
function deprioritizeRank(host: string): number {
  return DEPRIORITIZE.some((it) => host.includes(it)) ? 1 : 0;
}

/** Kotlin L36-40: the private OkHttp client's timeouts (connect 6s / read 8s). */
const REMOTE_CLIENT_CONFIG = {
  connectTimeoutMs: 6_000,
  readTimeoutMs: 8_000,
  /** The default headers still apply (SharedHttpTransport is the base builder on Android). */
  base: ZLibraryHttpClientConfig,
} as const;

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
