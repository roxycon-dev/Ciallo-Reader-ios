/**
 * Kotlin → TS: `source/zlibrary/ZLibraryEndpointProvider.kt` (273 lines, 250 non-blank)
 *             → `src/core/source/zlibrary/zLibraryEndpointProvider.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary → SKIPPED (TS has no packages)
 *   L3        import android.content.Context → dropped (all I/O injected)
 *   L4-5      import com.example.library.ZLibraryNodeConfig / ZLibraryNodeManager
 *                                                        → `ZLibraryNodeConfigPort` / `ZLibraryNodeManagerPort`
 *                                                          from `./zLibraryHost`
 *   L6        import …network.ZLibraryDns       → the health checker's injected resolver
 *   L7-18     import kotlinx.coroutines.*        → dropped (Promises; the three primitives that
 *                                                   needed mapping are listed in "Coroutines" below)
 *   L19       import com.example.source.executeCancellable → AbortSignal on the transport call
 *   L20-21    import okhttp3.{OkHttpClient,Request} / TimeUnit → injected transport + ms literals
 *   L23-28    class ZLibraryEndpointProvider(context, credentialStorage, healthChecker, remoteProvider)
 *                                                   → same dependency set, all injected
 *   L29-71    companion object: PREFS_NAME, 3 keys, CACHE_DURATION_MS, PROBE_TTL_MS,
 *             PROBE_TIMEOUT_S, the PRESET_DOMAINS list with its long 2026-09-04 comment, probeSlots
 *             Semaphore(3), FALLBACK_DOMAINS → module consts, comments preserved verbatim
 *   L73       prefs = getSharedPreferences("zlib_domain_cache", MODE_PRIVATE) → injected `ZLibraryPrefsStore`
 *             (the platform layer opens the file named by the exported `PREFS_NAME`)
 *   L75-85    the quickCheckClient OkHttpClient (.dns/4s timeouts) → `QUICK_CHECK_CONFIG` (ms)
 *   L87-88    @Volatile lastProbe: Triple<String, Boolean, Long>? → same shape
 *   L90-102   suspend fun isNodeReachable(domain) → `async isNodeReachable(domain)`:
 *             blank guard, 60s TTL reuse, HEAD "https://$domain/" with `it.code > 0`
 *   L104-149  KDoc 扫描候选池选活节点… + suspend fun scanForLiveNode() → `async scanForLiveNode()`:
 *             remote discovery (4s budget, priority-sorted, scheme/trailing-slash stripped),
 *             scraped + custom + preset nodes, `take(32)`, Channel + Semaphore(3) + first-usable
 *             wins + 25s budget + `finally { cancel; close }`
 *   L151-159  KDoc + private fun adoptLiveNode(domain) → `adoptLiveNode(domain)` (saveCache,
 *             `runCatching { ZLibraryNodeConfig.domain = domain }`, lastProbe seed)
 *   L161-172  KDoc + suspend fun failoverFrom(deadDomain) → `async failoverFrom(deadDomain)`
 *   L174-222  suspend fun getEndpoint(forceRefresh = false) → `async getEndpoint(forceRefresh)`,
 *             all 4 numbered steps and both KDoc blocks preserved
 *   L224-229  fun saveCache(domain)          → `async saveCache(domain)` (both keys + commit)
 *   L231-244  fun setCustomEndpoint(domain?) → `async setCustomEndpoint(domain?)` (Kotlin is
 *             synchronous here; the credential write is async in this port, hence the Promise)
 *   L246      fun getCustomEndpoint()        → `async getCustomEndpoint()`
 *   L248-250  fun invalidateCache()          → `async invalidateCache()` (both keys removed)
 *   L252-265  suspend fun diagnoseEndpoint(): Map<String, Any> → `async diagnoseEndpoint()`
 *             (same 8 keys, same `error ?: "None"`)
 *   L267-272  suspend fun diagnoseAllEndpoints() → `async diagnoseAllEndpoints()` (distinct order kept)
 *   L273      closing brace                  → n/a
 *
 * ADAPTATION — Coroutines (documented):
 *   - `withContext(Dispatchers.IO)` → dropped (no dispatcher in JS).
 *   - `coroutineScope { … async … }.awaitAll()` → `Promise.allSettled`, because the Kotlin code
 *     reads `deferred.awaitAll().filterNotNull()` — i.e. a single failed candidate must not
 *     abort the fan-out (each branch already uses `runCatching`).
 *   - `Channel<Pair<String, EndpointHealthResult>>(UNLIMITED)` + `repeat(n) { results.receive() }`
 *     inside `withTimeoutOrNull(25_000)` → the `AsyncChannel` helper below (unbounded FIFO +
 *     `receive()` that resolves null once closed), with an overall deadline.
 *   - `kotlinx.coroutines.sync.Semaphore(3)` + `withPermit` → the `Semaphore` helper below, so at
 *     most 3 health checks are in flight, exactly like the Kotlin `probeSlots`.
 *   - `finally { jobs.forEach { it.cancel() }; results.close() }` → `cancelled = true` (a late
 *     result is dropped instead of being sent, which is what `cancel()` achieves) plus
 *     `results.close()` and `await Promise.allSettled(jobs)`. JS Promises cannot be cancelled
 *     mid-flight, so an in-flight probe runs to completion and its result is discarded; it can
 *     no longer affect the scan, which is the observable contract.
 *   - `currentCoroutineContext().ensureActive()` in the two catch blocks → dropped: a rejected
 *     promise propagates on its own, and the per-candidate `runCatching` already prevents an
 *     outer abort from being swallowed.
 *
 * ADAPTATION — `getSharedPreferences` → injected `ZLibraryPrefsStore`; `commit()` → awaited
 *   store writes (the Kotlin code uses the synchronous `commit()` precisely because it must
 *   see the value immediately, which the async store also guarantees).
 *   `prefs.getLong(KEY_CACHE_TIMESTAMP, 0L)` → the store's string getter + `Number(...)`; the
 *   timestamp is written as `String(millis)` and defaults to 0 exactly like the Kotlin default.
 */

import { SourceLog } from '../sourceLog';
import {
  createEndpointHealthResult,
  type EndpointHealthChecker,
  type EndpointHealthResult,
} from './endpointHealthChecker';
import type { ZLibraryHttpTransport } from './network/zLibraryHttpClient';
import { type RemoteEndpointProvider } from './remoteEndpointProvider';
import type { ZLibraryCredentialStorage } from './zLibraryCredentialStorage';
import {
  type ZLibraryNodeConfigPort,
  type ZLibraryNodeManagerPort,
  type ZLibraryPrefsStore,
} from './zLibraryHost';

/** Kotlin `private const val PREFS_NAME = "zlib_domain_cache"` — the file the store opens. */
export const PREFS_NAME = 'zlib_domain_cache';
/** Kotlin `private const val KEY_CACHE_DOMAIN = "cached_domain"`. */
const KEY_CACHE_DOMAIN = 'cached_domain';
/** Kotlin `private const val KEY_CACHE_TIMESTAMP = "cached_timestamp"`. */
const KEY_CACHE_TIMESTAMP = 'cached_timestamp';
/** Kotlin `private const val KEY_CUSTOM_ENDPOINT = "custom_endpoint"`. */
const KEY_CUSTOM_ENDPOINT = 'custom_endpoint';
/** Kotlin `private const val CACHE_DURATION_MS = 24 * 60 * 60 * 1000L // 24 hours`. */
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
// 节点容灾体检：选中/缓存节点定期快速探测，死了自动换活节点（2026-09-04）
/** Kotlin `private const val PROBE_TTL_MS = 60 * 1000L`. */
const PROBE_TTL_MS = 60 * 1000; // 探测结果 60s 内复用，常规搜索不重复探测
/** Kotlin `private const val PROBE_TIMEOUT_S = 4L`. */
const PROBE_TIMEOUT_S = 4; // 单次探测 4s 超时，不拖慢主链路
/** Kotlin passes `PROBE_TIMEOUT_S` to `TimeUnit.SECONDS`; the port speaks milliseconds. */
const PROBE_TIMEOUT_MS = PROBE_TIMEOUT_S * 1000;
/** Kotlin `private val probeSlots = Semaphore(3)` (L69). */
const PROBE_CONCURRENCY = 3;

/** Kotlin `withTimeoutOrNull(4_000) { remoteProvider.fetchLatestEndpoints() }` (L112). */
const REMOTE_DISCOVERY_TIMEOUT_MS = 4_000;
/** Kotlin `withTimeoutOrNull(25_000) { … }` (L138). */
const SCAN_TIMEOUT_MS = 25_000;
/** Kotlin `candidates.keys.take(32)` (L126). */
const MAX_SCAN_CANDIDATES = 32;

/**
 * Preset high-availability mirror domains（2026-09-04 晚 Edge 全核实测，登录态）：
 * 六个活节点（CN 网络逐一实测：首页真实 + "harry potter" 搜索 51~102 卡片）：
 * - 1lib.sk：用户指定唯一正确官网（DiamWall 透明 PoW 自动过；账号登录/下载全链路已验证）；
 * - z-lib.by：导航站"优先尝试"第一位，无任何挑战直通（登录→搜索→对应书→
 *   EPUB 下载→内容无乱码，全链路实测通过）；
 * - z-library.sk：无挑战直通；
 * - zh.z-lib.by：中文界面，登录态与 z-lib.by 共享；
 * - zh.z-library.sk：中文界面，DiamWall 自动过；
 * - en.z-lib.by：英文，与 z-lib.by 同基础设施。
 * 域名级冗余对 CN 用户有效（GFW 按域封锁）；基础设施级共 3 个独立后端。
 * 其余：z-lib.sk（DiamWall 硬挑战，留池）；CF 域（z-library.co 等，海外/代理兜底）。
 * 退役：z-lib.is / z-library.se / z-lib.id / z-lib.li / z-lib.cc / zlib.bz /
 * 101k 系 / zlib.ch / zlib.re / zh.z-lib.rest；当前网络不可达（不入预置，
 * 仍可被导航站扒取到）：zh.zlib.li / zh.z-lib.gd / zh.intcn.online。
 */
export const PRESET_DOMAINS: readonly string[] = [
  '1lib.sk',
  'z-lib.by',
  'z-library.sk',
  'zh.z-lib.by',
  'zh.z-library.sk',
  'en.z-lib.by',
  'z-lib.sk',
  'z-library.co',
  'z-library.net',
  'zlib-official.com',
  'zlibrary-global.com',
  'z-lib.my',
  'z-lib.ad',
];

/** Kotlin `val FALLBACK_DOMAINS = PRESET_DOMAINS` (L70). */
export const FALLBACK_DOMAINS: readonly string[] = PRESET_DOMAINS;

/** Kotlin L80-85: the quickCheckClient's timeouts + DNS wiring (4s each). */
export const QUICK_CHECK_CONFIG = {
  connectTimeoutMs: PROBE_TIMEOUT_MS,
  readTimeoutMs: PROBE_TIMEOUT_MS,
  writeTimeoutMs: PROBE_TIMEOUT_MS,
  useZLibraryDns: true,
} as const;

export class ZLibraryEndpointProvider {
  // ---- 节点快速可达性体检（容灾第一步）----
  // 只判断“TCP/TLS/HTTP 能通”：被墙（SNI 阻断/RST）、DNS 污染（ZLibraryDns
  // 已过滤 Meta 假 IP）、站点挂掉 → 探不通；而 DiamWall/Cloudflare 挑战码
  // （403/503/513）也算“活着”——挑战随后由 PoW 拦截器 / WebView 兜底自动过，
  // 不构成换节点的理由。结果带 60s TTL，常规搜索不额外付探测延迟。
  private lastProbe: { domain: string; ok: boolean; at: number } | null = null;

  constructor(
    private readonly store: ZLibraryPrefsStore,
    private readonly nodeConfig: ZLibraryNodeConfigPort,
    private readonly nodeManager: ZLibraryNodeManagerPort,
    private readonly healthChecker: EndpointHealthChecker,
    private readonly remoteProvider: RemoteEndpointProvider,
    private readonly transport: ZLibraryHttpTransport,
    private readonly credentialStorage: ZLibraryCredentialStorage,
  ) {}

  /** Kotlin `private suspend fun isNodeReachable(domain)` (L90-102). */
  async isNodeReachable(domain: string): Promise<boolean> {
    if (domain.trim() === '') return false;
    const now = Date.now();
    if (this.lastProbe !== null) {
      const { domain: d, ok, at } = this.lastProbe;
      if (d === domain && now - at < PROBE_TTL_MS) return ok;
    }
    let ok = false;
    try {
      const response = await this.transport.send({
        method: 'HEAD',
        url: `https://${domain}/`,
        referer: null,
        extraHeaders: {},
        formFields: null,
        callTimeoutMs: PROBE_TIMEOUT_MS,
      });
      ok = response.code > 0;
    } catch {
      ok = false;
    }
    this.lastProbe = { domain, ok, at: now };
    return ok;
  }

  /**
   * 扫描候选池选活节点：远程门户动态发现（官方披露域名，自动跟上站点归拢/
   * 迁移）∪ 节点管理候选（官网/备用入口/用户自加）∪ 预置域名。并行健康检查
   * ——最多 3 个并发，首个搜索可用节点立即返回，整轮最多 25 秒；优先取“搜索可用”的节点（可达但搜索故障的只作
   * 下载兜底，否则搜到的全是主页推荐书）。全挂返回 null。
   */
  async scanForLiveNode(signal?: AbortSignal | null): Promise<string | null> {
    let remoteDomains: string[] = [];
    try {
      const remote = await withTimeout(
        this.remoteProvider.fetchLatestEndpoints(signal ?? null),
        REMOTE_DISCOVERY_TIMEOUT_MS,
      );
      if (remote !== null) {
        remoteDomains = remote
          .slice()
          .sort((a, b) => b.priority - a.priority)
          .map((it) =>
            it.url.trim().replace(/^https:\/\//, '').replace(/^http:\/\//, '').replace(/\/+$/, ''),
          )
          .filter((it) => it !== '');
      }
    } catch {
      remoteDomains = [];
    }
    const candidates = new Map<string, boolean>();
    for (const it of remoteDomains) if (!candidates.has(it)) candidates.set(it, true);
    for (const it of safeNodes(() => this.nodeManager.getScrapedNodes())) {
      if (!candidates.has(it)) candidates.set(it, true);
    }
    for (const it of safeNodes(() => this.nodeManager.getCustomNodes())) {
      if (!candidates.has(it)) candidates.set(it, true);
    }
    for (const it of PRESET_DOMAINS) if (!candidates.has(it)) candidates.set(it, false);
    const candidateList = Array.from(candidates.keys()).slice(0, MAX_SCAN_CANDIDATES);
    if (candidateList.length === 0) return null;

    // Kotlin L129-146: `Channel<Pair<String, EndpointHealthResult>>(UNLIMITED)` fed by
    // `launch { probeSlots.withPermit { healthChecker.checkHealth(candidate) } }` (Semaphore(3)),
    // drained by `repeat(candidateList.size) { results.receive() }` inside
    // `withTimeoutOrNull(25_000)`, with `finally { jobs.forEach { it.cancel() }; results.close() }`.
    const results = new AsyncChannel<[string, EndpointHealthResult]>();
    const slots = new Semaphore(PROBE_CONCURRENCY);
    let cancelled = false;
    let reachable: string | null = null;
    const jobs = candidateList.map(async (candidate) => {
      const health = await slots.withPermit(async () => {
        try {
          return await this.healthChecker.checkHealth(candidate);
        } catch (e) {
          SourceLog.log('ZLibEndpoint', `health check failed for ${candidate}: ${errorMessage(e)}`);
          return createEndpointHealthResult({ domain: candidate, isAvailable: false, rtt: 0 });
        }
      });
      // A cancelled Kotlin job never reaches `results.send(...)`; same guard here.
      if (!cancelled) results.push([candidate, health]);
    });
    try {
      const scanned = await withTimeout(
        (async (): Promise<string | null> => {
          for (let i = 0; i < candidateList.length; i += 1) {
            const item = await results.receive();
            if (item === null) break;
            const candidate = item[0];
            const health = item[1];
            if (health.isAvailable && health.searchAvailable) return candidate;
            if (health.isAvailable && reachable === null) reachable = candidate;
          }
          return reachable;
        })(),
        SCAN_TIMEOUT_MS,
      );
      return scanned ?? reachable;
    } finally {
      cancelled = true;
      results.close();
      await Promise.allSettled(jobs);
    }
  }

  /**
   * 容灾/扫描选中活节点后的固化：写 24h 缓存、内存选中值跟随（本进程内登录/
   *  搜索/下载立即用新节点，含书库隐藏 WebView 会话）、预热体检缓存避免下一
   *  次调用重复探测。不覆写节点管理页的持久化选择——临时被墙的网络恢复后
   *  重启 App 即回到用户手选节点。
   */
  private adoptLiveNode(domain: string): void {
    void this.saveCache(domain);
    try {
      this.nodeConfig.setNodeDomain(domain);
    } catch {
      // Kotlin `runCatching { ZLibraryNodeConfig.domain = domain }`
    }
    this.lastProbe = { domain, ok: true, at: Date.now() };
  }

  /**
   * 选中/自定义节点体检失败后的自动容灾：扫描换活节点并固化。
   *  返回 null = 全池不可达（保持原节点，交给 WebView Chromium 指纹/系统代理兜底）。
   */
  async failoverFrom(deadDomain: string): Promise<string | null> {
    const winner = await this.scanForLiveNode();
    if (winner === null) return null;
    if (winner === deadDomain) {
      // 快速体检误报（HEAD 被挡但全量健康检查通过）：预热缓存避免反复重扫
      this.lastProbe = { domain: deadDomain, ok: true, at: Date.now() };
      return null;
    }
    this.adoptLiveNode(winner);
    return winner;
  }

  async getEndpoint(forceRefresh = false): Promise<string> {
    // 0. 用户在“节点管理”里选中的节点优先（立即生效，不被缓存/扫描结果覆盖）。
    //    容灾（2026-09-04）：选中节点先做 4s 快速体检——挂了/被墙时不再原地
    //    卡死，自动扫描候选池换活节点并固化，登录/搜索/下载全部跟随新节点，
    //    用户零操作。全池探不通（无 VPN 整段被墙等极端情况）仍返回选中节点
    //    本身，交给 WebView（Chromium TLS 指纹 + 系统代理）兜底再试。
    const selectedNodeRaw = ((): string => {
      try {
        return this.nodeConfig.nodeDomain();
      } catch {
        return '';
      }
    })();
    const selectedNode = (selectedNodeRaw ?? '')
      .trim()
      .replace(/^https:\/\//, '')
      .replace(/^http:\/\//, '')
      .replace(/\/+$/, '');
    if (selectedNode !== '' && !forceRefresh) {
      if (await this.isNodeReachable(selectedNode)) {
        return selectedNode;
      }
      const failedOver = await this.failoverFrom(selectedNode);
      if (failedOver !== null) return failedOver;
      return selectedNode;
    }

    // 1. User custom config（同样体检：死了不再原地卡死，落回扫描流程自动换）
    const customDomainRaw = await this.store.getString(KEY_CUSTOM_ENDPOINT);
    const customDomain = customDomainRaw === null || customDomainRaw === undefined ? '' : customDomainRaw.trim();
    if (customDomain !== '' && !forceRefresh) {
      const cleanCustom = customDomain
        .replace(/^https:\/\//, '')
        .replace(/^http:\/\//, '')
        .replace(/\/+$/, '');
      if (await this.isNodeReachable(cleanCustom)) return cleanCustom;
    }

    // 2. History success cache（24h 内验证过的节点直接复用，省一次扫描往返；
    //    体检失败说明缓存节点已死/被墙，作废重扫，绝不把死节点再交出去）
    if (!forceRefresh) {
      const cached = await this.store.getString(KEY_CACHE_DOMAIN);
      const timestampRaw = await this.store.getString(KEY_CACHE_TIMESTAMP);
      const timestamp = timestampRaw === null || timestampRaw === undefined ? 0 : Number(timestampRaw);
      if (cached !== null && cached !== '' && Date.now() - timestamp < CACHE_DURATION_MS) {
        if (await this.isNodeReachable(cached)) return cached;
        await this.invalidateCache();
      }
    }

    // 3. 扫描候选池选活节点并固化（forceScan 强制重扫、缓存过期、容灾均走这里）。
    //    注意：远程发现的高优先级域名不再直接采信（旧逻辑曾把被墙的远程冠军
    //    原样返回，forceScan 也救不回来）——一律过健康检查才算数。
    const scanned = await this.scanForLiveNode();
    if (scanned !== null) {
      this.adoptLiveNode(scanned);
      return scanned;
    }

    // 4. Fallback to first preset domain if all fail
    return PRESET_DOMAINS[0] as string;
  }

  async saveCache(domain: string): Promise<void> {
    await this.store.putString(KEY_CACHE_DOMAIN, domain);
    await this.store.putString(KEY_CACHE_TIMESTAMP, String(Date.now()));
  }

  async setCustomEndpoint(domain: string | null): Promise<void> {
    const cleanDomain =
      domain === null
        ? null
        : domain
            .trim()
            .replace(/^https:\/\//, '')
            .replace(/^http:\/\//, '')
            .replace(/\/+$/, '');
    await this.store.putString(KEY_CUSTOM_ENDPOINT, cleanDomain);
    if (cleanDomain !== null && cleanDomain.trim() !== '') {
      await this.credentialStorage.saveCredentials({
        userId: await this.credentialStorage.getUserId(),
        userKey: await this.credentialStorage.getUserKey(),
        domain: cleanDomain,
        cookies: await this.credentialStorage.getCookies(),
      });
    }
  }

  async getCustomEndpoint(): Promise<string | null> {
    return this.store.getString(KEY_CUSTOM_ENDPOINT);
  }

  async invalidateCache(): Promise<void> {
    await this.store.remove(KEY_CACHE_DOMAIN);
    await this.store.remove(KEY_CACHE_TIMESTAMP);
  }

  async diagnoseEndpoint(): Promise<Record<string, unknown>> {
    const endpoint = await this.getEndpoint(true);
    const health = await this.healthChecker.checkHealth(endpoint);
    return {
      endpoint,
      dnsOk: health.dnsOk,
      tlsOk: health.tlsOk,
      httpCode: health.httpCode,
      isAvailable: health.isAvailable,
      isCloudflare: health.isCloudflare,
      rtt: health.rtt,
      error: health.error ?? 'None',
    };
  }

  async diagnoseAllEndpoints(): Promise<EndpointHealthResult[]> {
    const custom = await this.getCustomEndpoint();
    const domains: string[] = [];
    for (const it of [custom, ...PRESET_DOMAINS]) {
      if (it !== null && !domains.includes(it)) domains.push(it);
    }
    const out: EndpointHealthResult[] = [];
    for (const domain of domains) {
      out.push(await this.healthChecker.checkHealth(domain));
    }
    return out;
  }
}

/** Kotlin `runCatching { … }.getOrDefault(emptyList())` (L119-124). */
function safeNodes(fetch: () => string[]): string[] {
  try {
    return fetch();
  } catch (e) {
    SourceLog.log('ZLibEndpoint', `node lookup failed: ${errorMessage(e)}`);
    return [];
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Kotlin `withTimeoutOrNull(ms) { … }` → null when the deadline passes. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** `kotlinx.coroutines.channels.Channel(Channel.UNLIMITED)` — FIFO, no capacity bound. */
class AsyncChannel<T> {
  private readonly items: T[] = [];
  private closed = false;
  private waiter: (() => void) | null = null;

  push(item: T): void {
    this.items.push(item);
    this.wake();
  }

  close(): void {
    this.closed = true;
    this.wake();
  }

  private wake(): void {
    const waiter = this.waiter;
    this.waiter = null;
    if (waiter !== null) waiter();
  }

  async receive(): Promise<T | null> {
    while (this.items.length === 0) {
      if (this.closed) return null;
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }
    return this.items.shift() ?? null;
  }
}

/** `kotlinx.coroutines.sync.Semaphore(permits).withPermit { … }` (L69/L132). */
class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly permits: number) {}

  async withPermit<T>(block: () => Promise<T>): Promise<T> {
    if (this.active >= this.permits) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await block();
    } finally {
      const next = this.waiting.shift();
      if (next !== undefined) next();
      else this.active -= 1;
    }
  }
}
