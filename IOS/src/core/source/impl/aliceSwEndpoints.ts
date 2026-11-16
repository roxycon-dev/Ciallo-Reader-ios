/**
 * Android source: `com.example.source.impl.AliceSwEndpoints.kt`（192 行）
 *                + `com.example.source.impl.AliceSwDiscovery.kt`（33 行）→ 本文件。
 *
 * 爱丽丝书屋线路池。站点同时跑多条线路（`alicesw4.homes`、`alicesw3.homes`……），墙内
 * 可达性随线路和网络状况变化，因此不做长期域名黑名单，只在失败后冷却 5 分钟再重新探活。
 *
 * 行号映射（Kotlin → TS）：
 *   AliceSwDiscovery.kt L10-L11  倒写域名 / https 主机正则 → REVERSED_LITERAL / HTTPS_HOST*
 *   AliceSwDiscovery.kt L14-L32  hosts()                   → AliceSwDiscovery.hosts()
 *   AliceSwEndpoints.kt L35-L56  prefs / probeClient / discoveryClient → `AliceSwRouteCache` 端口 + 每请求 timeout
 *   AliceSwEndpoints.kt L58-L59  currentBase()             → currentBase()
 *   AliceSwEndpoints.kt L61-L82  baseUrl()                 → baseUrl() / resolveBase()
 *   AliceSwEndpoints.kt L84-L89  reportFailure()           → reportFailure()
 *   AliceSwEndpoints.kt L91-L97  remember()                → remember()
 *   AliceSwEndpoints.kt L99      cooling()                 → cooling()
 *   AliceSwEndpoints.kt L101-L113 pick()                   → pick()
 *   AliceSwEndpoints.kt L115-L132 reachable()              → reachable()
 *   AliceSwEndpoints.kt L134-L156 discoverHosts()          → discoverHosts()
 *   AliceSwEndpoints.kt L158-L159 isAlicePage()            → isAlicePage()
 *   AliceSwEndpoints.kt L161-L163 hostOf()                 → hostOf()
 *   AliceSwEndpoints.kt L165-L191 companion（PRESET_HOSTS / SEEDS / TTL / failedUntil） → 模块级常量与表
 *
 * 未移植项 / 有意替换：
 *  - 任务只允许新建 `aliceSwEndpoints.ts`，因此 `AliceSwDiscovery.kt` 合并进本文件
 *    （它唯一的消费者就是这里的 `discoverHosts()`）；导出名仍是 `AliceSwDiscovery.hosts()`。
 *  - Android `SharedPreferences("alice_route_cache")` → 注入的 `AliceSwRouteCache` 端口；
 *    默认内存实现，跨进程持久化由平台层接线时提供（键名仍是 Kotlin 的 `domain` / `timestamp`）。
 *  - OkHttp 的 probeClient（4s）/ discoveryClient（6s）→ 端口没有独立 client，改为每请求
 *    `timeoutMs`，语义等价。
 *  - `AliceSwSource.USER_AGENT`（Kotlin L254-255，companion）在本文件引用；为避免
 *    `aliceSwSource.ts ↔ aliceSwEndpoints.ts` 循环导入，UA 常量定义在本文件，源文件再引用它。
 *  - `response.peekBody(n).string()` → 端口没有 peek，读完响应后 `subarray(0, n)`；
 *    因此 `maxBytes` 传 `Infinity`（peek 从不因页面过大而失败）。
 *  - 探活整轮上限 12s、单次超时 4s / 6s：默认值与 Kotlin 一致，允许注入缩短（单测用），
 *    与 `writeSourceNovelEpub({ delayMs })` 的注入风格一致。
 */

import { throwIfAborted } from '@core/download/abortable';
import type { HttpClient } from '@platform/interfaces';
import { AsyncMutex, decodeUtf8, executeSourceRequest, isSuccessful } from './sourceHttp';

/* ── 线路发现（Kotlin `AliceSwDiscovery.kt`）─────────────────────────────── *
 * 爱丽丝书屋只把域名写在发布页和线路页里，且两处都不直接给链接——线路页把域名倒着
 * 写进 `r('semoh.2wsecila.www//:sptth')`，跳转页则塞在带 `alicesw` 的明文 URL 里。
 * 这里只做纯文本抽取，不执行页面脚本，也不引 HTML 解析器。                       */

const REVERSED_LITERAL = /r\('([^']{8,120})'\)/g;
const HTTPS_HOST = /https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/;
const HTTPS_HOST_ALL = /https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/g;
const SITE_PREFIX = 'alicesw';

export const AliceSwDiscovery = {
  /** 从线路页/跳转页抽候选域名：倒写字符串 + 明文 https 地址，只保留站点自家域名。 */
  hosts(html: string): string[] {
    const found: string[] = [];
    for (const match of html.matchAll(REVERSED_LITERAL)) {
      // Kotlin `match.groupValues[1].reversed()` —— 纯 ASCII 域名，逐码点反转等价。
      const reversed = [...(match[1] ?? '')].reverse().join('');
      const host = HTTPS_HOST.exec(reversed);
      if (host?.[1] !== undefined) found.push(host[1]);
    }
    for (const match of html.matchAll(HTTPS_HOST_ALL)) {
      if (match[1] !== undefined) found.push(match[1]);
    }
    const result: string[] = [];
    for (const raw of found) {
      // Kotlin `raw.lowercase().removePrefix("www.")`。
      const host = raw.toLowerCase().replace(/^www\./, '');
      if (host.startsWith(SITE_PREFIX) && !result.includes(host)) result.push(host);
    }
    return result;
  },
};

/** Kotlin `AliceSwSource.Companion.USER_AGENT`（L254-255），逐字一致。 */
export const ALICE_SW_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Kotlin `PRESET_HOSTS`：站点自报的线路，按实测可用性排序。 */
export const ALICE_SW_PRESET_HOSTS: readonly string[] = [
  'alicesw4.homes',
  'alicesw3.homes',
  'alicesw2.homes',
  'alicesw1.homes',
  'alicesw.com',
];

/** Kotlin `DISCOVERY_SEEDS`：线路页与跳转页，只用来发现域名，不参与选路。 */
export const ALICE_SW_DISCOVERY_SEEDS: readonly string[] = [
  'https://www.alicesw1.quest/',
  'https://xn--vcsx64d.als1007.space/',
];

/** Kotlin `KEY_DOMAIN` / `KEY_AT`（SharedPreferences 键名）。 */
export const ALICE_SW_ROUTE_KEY_DOMAIN = 'domain';
export const ALICE_SW_ROUTE_KEY_AT = 'timestamp';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 4_000;
const DISCOVERY_TIMEOUT_MS = 6_000;
const PROBE_ROUND_MS = 12_000;
const PROBE_BODY_BYTES = 512 * 1024;
const DISCOVERY_BODY_BYTES = 256 * 1024;

/** Kotlin companion `failedUntil = ConcurrentHashMap<String, Long>()`：进程级共享。 */
const failedUntil = new Map<string, number>();

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Kotlin `SharedPreferences` 的最小面：读 string / 读 long / 一次写入多个键。 */
export interface AliceSwRouteCache {
  string(key: string): string | null;
  long(key: string): number;
  edit(values: ReadonlyArray<readonly [string, string | number]>): void;
}

/** Kotlin 的 SharedPreferences 默认值；测试与无线程平台可直接用。 */
export class MemoryAliceSwRouteCache implements AliceSwRouteCache {
  private readonly values = new Map<string, string | number>();

  constructor(initial: Readonly<Record<string, string | number>> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  string(key: string): string | null {
    const value = this.values.get(key);
    return typeof value === 'string' ? value : null;
  }

  long(key: string): number {
    const value = this.values.get(key);
    return typeof value === 'number' ? value : 0;
  }

  edit(values: ReadonlyArray<readonly [string, string | number]>): void {
    for (const [key, value] of values) this.values.set(key, value);
  }
}

/** 可选的时间参数注入（默认值 = Kotlin 常量；单测用它把 12s 探活轮压到毫秒级）。 */
export interface AliceSwEndpointTimings {
  probeRoundMs?: number;
  probeTimeoutMs?: number;
  discoveryTimeoutMs?: number;
}

export interface AliceSwEndpointsOptions {
  client: HttpClient;
  cache?: AliceSwRouteCache;
  timings?: AliceSwEndpointTimings;
}

export class AliceSwEndpoints {
  private readonly http: HttpClient;
  private readonly cache: AliceSwRouteCache;
  private readonly mutex = new AsyncMutex();
  private readonly probeRoundMs: number;
  private readonly probeTimeoutMs: number;
  private readonly discoveryTimeoutMs: number;

  private current: string | null = null;

  constructor(options: AliceSwEndpointsOptions) {
    this.http = options.client;
    this.cache = options.cache ?? new MemoryAliceSwRouteCache();
    this.probeRoundMs = options.timings?.probeRoundMs ?? PROBE_ROUND_MS;
    this.probeTimeoutMs = options.timings?.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
    this.discoveryTimeoutMs = options.timings?.discoveryTimeoutMs ?? DISCOVERY_TIMEOUT_MS;
  }

  /** 已选定的线路（协议 + 主机），没有则返回 null；不发网络请求。 */
  currentBase(): string | null {
    if (this.current !== null) return this.current;
    const domain = this.cache.string(ALICE_SW_ROUTE_KEY_DOMAIN);
    return domain !== null ? `https://${domain}` : null;
  }

  /**
   * 取一条可用线路的 base url（不带结尾斜杠）。全部线路都不可用时返回 null，
   * 由调用方转换成书源错误提示。
   */
  baseUrl(forceRefresh = false, signal?: AbortSignal): Promise<string | null> {
    return this.mutex.withLock(() => this.resolveBase(forceRefresh, signal));
  }

  /** 记录一条线路失败：短期冷却，避免每次请求都先撞一遍死线路。 */
  reportFailure(base: string): void {
    const host = this.hostOf(base);
    if (host === null) return;
    failedUntil.set(host, Date.now() + FAILURE_COOLDOWN_MS);
    if (this.current !== null && this.current.toLowerCase().endsWith(host.toLowerCase())) this.current = null;
  }

  private async resolveBase(forceRefresh: boolean, signal?: AbortSignal): Promise<string | null> {
    throwIfAborted(signal);
    const now = Date.now();
    const cached = this.cachedDomain();
    const cachedAt = this.cache.long(ALICE_SW_ROUTE_KEY_AT);
    if (!forceRefresh && cached !== null && now - cachedAt < CACHE_TTL_MS && !this.cooling(cached, now)) {
      this.current = `https://${cached}`;
      return this.current;
    }
    // Kotlin `buildList { cached?.let { add(it) }; addAll(PRESET_HOSTS) }.distinct()`。
    const quick: string[] = [];
    for (const host of [...(cached !== null ? [cached] : []), ...ALICE_SW_PRESET_HOSTS]) {
      if (!quick.includes(host)) quick.push(host);
    }
    const warm = quick.filter((host) => !this.cooling(host, now));
    const picked = await this.pick(warm, signal);
    if (picked !== null) return this.remember(picked);

    const discovered = (await this.discoverHosts(signal)).filter(
      (host) => !quick.includes(host) && !this.cooling(host, now),
    );
    const found = await this.pick(discovered, signal);
    return found !== null ? this.remember(found) : null;
  }

  private cachedDomain(): string | null {
    const value = this.cache.string(ALICE_SW_ROUTE_KEY_DOMAIN);
    return value !== null && value.trim() !== '' ? value : null;
  }

  private remember(host: string): string {
    const base = `https://${host}`;
    this.current = base;
    failedUntil.delete(host);
    this.cache.edit([
      [ALICE_SW_ROUTE_KEY_DOMAIN, host],
      [ALICE_SW_ROUTE_KEY_AT, Date.now()],
    ]);
    return base;
  }

  private cooling(host: string, now: number): boolean {
    return (failedUntil.get(host) ?? 0) > now;
  }

  /** 并行探活，首个返回真实站点页面的线路立即采用；整轮最多等 `probeRoundMs`。 */
  private async pick(candidates: readonly string[], signal?: AbortSignal): Promise<string | null> {
    if (candidates.length === 0) return null;
    throwIfAborted(signal);
    const round = new AbortController();
    const abortRound = (): void => {
      round.abort();
    };
    const timer = setTimeout(abortRound, this.probeRoundMs);
    if (signal) signal.addEventListener('abort', abortRound, { once: true });
    try {
      return await new Promise<string | null>((resolve) => {
        let settled = false;
        const finish = (value: string | null): void => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        round.signal.addEventListener('abort', () => { finish(null); }, { once: true });
        for (const host of candidates) {
          void this.reachable(host, round.signal)
            .then((ok) => { if (ok) finish(host); })
            .catch(() => undefined);
        }
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortRound);
      // Kotlin `probes.forEach { it.cancel() }; hits.close()`。
      round.abort();
    }
  }

  private async reachable(host: string, signal: AbortSignal): Promise<boolean> {
    try {
      const response = await executeSourceRequest(this.http, `https://${host}/`, {
        headers: {
          'User-Agent': ALICE_SW_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        maxBytes: Number.POSITIVE_INFINITY,
        timeoutMs: this.probeTimeoutMs,
        signal,
      });
      return isSuccessful(response) && this.isAlicePage(decodeUtf8(response.body.subarray(0, PROBE_BODY_BYTES)));
    } catch (error) {
      if (isAbortError(error)) throw error;
      return false;
    }
  }

  /** 从线路页动态发现域名；发布页/线路页本身不可达时静默返回空列表。 */
  private async discoverHosts(signal?: AbortSignal): Promise<string[]> {
    const hosts: string[] = [];
    for (const seed of ALICE_SW_DISCOVERY_SEEDS) {
      let html = '';
      try {
        const response = await executeSourceRequest(this.http, seed, {
          headers: { 'User-Agent': ALICE_SW_USER_AGENT, 'Accept-Language': 'zh-CN,zh;q=0.9' },
          maxBytes: Number.POSITIVE_INFINITY,
          timeoutMs: this.discoveryTimeoutMs,
          ...(signal ? { signal } : {}),
        });
        html = isSuccessful(response) ? decodeUtf8(response.body.subarray(0, DISCOVERY_BODY_BYTES)) : '';
      } catch (error) {
        if (isAbortError(error)) throw error;
        html = '';
      }
      if (html.trim() !== '') hosts.push(...AliceSwDiscovery.hosts(html));
    }
    return [...new Set(hosts)];
  }

  private isAlicePage(html: string): boolean {
    return html.trim() !== '' && (html.toLowerCase().includes('alicesw') || html.includes('爱丽丝书屋'));
  }

  private hostOf(base: string): string | null {
    try {
      return new URL(base.trim()).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}
