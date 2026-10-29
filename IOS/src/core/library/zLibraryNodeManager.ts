/**
 * Kotlin → TS: `library/ZLibraryNodeManager.kt` (231 lines total / 212 non-blank)
 *             → `src/core/library/zLibraryNodeManager.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1         package com.example.library                  → SKIPPED (TS has no packages)
 *   L3         import android.content.Context               → dropped: every preferences read/write goes
 *              through the injected `ZLibraryPrefsStore` (the already-ported
 *              `SharedPreferences` seam in `../source/zlibrary/zLibraryHost`)
 *   L4-5       import …network.ZLibraryDns / ZLibraryHttpClient
 *                                                         → the injected `ZLibraryHttpTransport` /
 *              `ZLibraryNodeHttpClient` + the reused `DEFAULT_USER_AGENT` / `DEFAULT_ACCEPT_LANG`
 *              constants; `SCRAPE_CONFIG` keeps `.dns(ZLibraryDns.INSTANCE)` for the platform transport
 *   L6-7       import kotlinx.coroutines.Dispatchers / withContext → dropped (plain async; the port is
 *              a Promise, there is no dispatcher in JS — see "Coroutines" below)
 *   L8         import okhttp3.{OkHttpClient,Request}        → `ZLibraryHttpTransport.send(spec)` +
 *              the `ZLibraryHttpRequestSpec`/`ZLibraryHttpResponse` shapes
 *   L9         import org.jsoup.Jsoup                       → `parseHtmlDocument`
 *   L10        import java.util.concurrent.TimeUnit        → millisecond literals (10_000 / 15_000)
 *   L13-21     the Z-Library 节点管理 KDoc (默认节点 1lib.sk / 扒取来源 / 自定义 / SharedPreferences)
 *                                                         → preserved verbatim on `ZLibraryNodeManager`
 *   L22        object ZLibraryNodeManager                  → `export class ZLibraryNodeManager`
 *              + `createZLibraryNodeManager()` (Kotlin `object` = one process-wide instance;
 *              TS hands the host a factory so the prefs store stays injectable)
 *   L23-26     the 2026-09-04 实测校准 comment + `DEFAULT_NODE` + `SCRAPE_URL` → verbatim consts
 *   L28-31     PREFS_NAME / KEY_SCRAPED_NODES / KEY_CUSTOM_NODES / KEY_SELECTED_NODE → verbatim consts
 *   L33-42     KDoc + `VERIFIED_LIVE_NODES`                → verbatim array + derived lookup Set
 *   L44-67     KDoc + `INITIAL_SCRAPED_NODES` (13 domains) → verbatim array
 *   L69-83     KDoc + `RETIRED_NODES` (12 entries + comments) → verbatim Set (comments kept inline)
 *   L85-86     `private fun prefs(context)`                → dropped; the store arrives via the constructor
 *   L88-93     getScrapedNodes                             → `scrapedNodesSync()` (cache) +
 *              `getScrapedNodes()` (store) + pure `parseScrapedNodes(raw)`
 *   L95-100    saveScrapedNodes                            → `saveScrapedNodes(nodes)`, merge preserved
 *   L102-105   getCustomNodes                              → `customNodesSync()` / `getCustomNodes()` + `parseCustomNodes`
 *   L107-112   addCustomNode                               → `addCustomNode(rawNode)`
 *   L114-120   removeCustomNode                            → `removeCustomNode(node)`
 *   L122-127   getSelectedNode                             → `selectedNodeSync()` / `getSelectedNode()` + `parseSelectedNode`
 *   L129-133   selectNode                                  → `selectNode(rawNode)` (+ `ZLibraryNodeConfig.domain = clean`)
 *   L135-147   KDoc + restoreSelection                     → `restoreSelection()`
 *   L149-174   KDoc + MIGRATED_NODES (18 entries)         → verbatim `Map` + pure `migrateNode(stored)`
 *   L176-222   KDoc + `suspend fun scrapeNodes(context)`   → `async scrapeNodes(transport, signal?)`
 *   L224-230   private fun cleanNode                       → exported pure `cleanNode(raw)`
 *   L231       closing brace                               → n/a
 *
 * ADDITIONS in this file (no Kotlin counterpart in these five files — every one documented):
 *   - `scrapedNodesSync()/customNodesSync()/selectedNodeSync()` + `createNodeManagerPort()`.
 *     `ZLibraryEndpointProvider` (already ported) reads the node lists through the SYNCHRONOUS
 *     `ZLibraryNodeManagerPort { defaultNode; getScrapedNodes(); getCustomNodes() }`, while the
 *     already-ported node screen declares the ASYNC `ZLibraryNodeStore`. Android had both for
 *     free because `SharedPreferences` reads are synchronous. Here the store is async, so the
 *     class keeps an in-memory mirror of the three raw preference strings (filled by
 *     `hydrate()`, which the host calls once at startup — the same moment MainActivity calls
 *     `restoreSelection`) and the sync port reads that mirror. Semantics are identical because
 *     every write updates the mirror first and the store second.
 *   - `createNodeProbe()` — assembles the already-ported `ZLibraryHttpClient` +
 *     `ZLibraryParserManager` + `ZLibraryWebViewHelper` into the `ZLibraryNodeProbe` shape that
 *     `src/ui/components/source/ZLibraryNodeManagementScreen.tsx` declares (the UI file is NOT
 *     edited; only the two plumbing methods are provided here, the verdict/ranking logic stays in
 *     the screen's own `probeNodeStatus`).
 *   - `nodeLabelFor(node)` — the four-way label ranking the Kotlin screen derives from
 *     `VERIFIED_LIVE_NODES` (默认节点 / 已验证可用 / 硬挑战·留池 / 导航站节点), exported so the
 *     ranking is unit-testable here; the screen keeps its own copy.
 *   - `failoverCandidateOrder(scraped, custom)` — the candidate ordering `scanForLiveNode` feeds
 *     its health checks in (scraped → custom), preserving first-seen order.
 *
 * ADAPTATIONS (documented at each site):
 *   - `getSharedPreferences(name, MODE_PRIVATE).edit().putString(k,v).apply()` → the injected
 *     `ZLibraryPrefsStore` (`putString` is awaited; `apply()` is fire-and-forget on Android while
 *     `commit()` is synchronous — awaiting the store write is the stronger, equivalent guarantee).
 *   - `withContext(Dispatchers.IO)` → dropped; `scrapeNodes` is a plain async function.
 *   - `suspend fun` → `Promise`-returning `async` methods.
 *   - `Regex(…, RegexOption.IGNORE_CASE)` + `findAll` → the same pattern with the `gi` flags.
 *   - `String.isBlank()` → a local `isBlank()` helper (JS `\s` also matches U+00A0/U+FEFF, which
 *     `CharSequence.isBlank()` does not — irrelevant for a domain, noted for completeness).
 *   - `distinct()` on a `List` (insertion-ordered) → `Array.from(new Set(…))`, same order.
 *   - `okhttp` per-socket timeouts (`.connectTimeout(10, SECONDS)`, `.readTimeout(10, SECONDS)`)
 *     → `callTimeoutMs: 10_000` on the request spec (the ported spec has one whole-call deadline,
 *     the same reasoning documented at `zLibraryHttpClient.ts` L99-101) plus `SCRAPE_CONFIG` for
 *     the platform transport.
 *   - `TimeUnit.SECONDS` → milliseconds.
 */

import type { SearchBook } from '../source/searchBook';
import {
  javaUrlEncode,
  type ZLibraryNodeConfigPort,
  type ZLibraryNodeManagerPort,
  type ZLibraryPrefsStore,
} from '../source/zlibrary/zLibraryHost';
import {
  DEFAULT_ACCEPT_LANG,
  DEFAULT_USER_AGENT,
  type ZLibraryHttpResponse,
  type ZLibraryHttpTransport,
} from '../source/zlibrary/network/zLibraryHttpClient';
import { parseHtmlDocument } from '../source/zlibrary/parser/htmlDocument';
import { ZLibraryParserManager } from '../source/zlibrary/parser/zLibraryParserManager';
import { ZLibraryWebViewHelper, type HtmlRuntimeFactory } from '../source/zlibrary/zLibraryWebViewHelper';
import { nodeDomain, setNodeDomain } from './zLibraryNodeConfig';

/* ═══════════════════════════════════════════════════════════════════════════
 * Constants — every Kotlin line below is verbatim (values, order and comments)
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Z-Library 节点管理：
 * - 默认节点固定为 1lib.sk（用户实测唯一正确官网，账号可登录、有免费下载额度；
 *   走 DiamWall 挑战，App 的 PoW 拦截器 + WebView 兜底自动过）；
 * - 节点从 https://zlib.wwkejishe.top/ 扒取（#official-urls 表格全部官方入口，
 *   更新勤、含假站黑名单——2026-09-04 用户指定）；
 * - 支持用户自定义节点；
 * - 选择的节点写入 SharedPreferences，并在启动时恢复。
 */

// 2026-09-04 实测校准：z-lib.li / z-lib.cc 等均为仿冒站（无下载功能或流程不符）；
// 1lib.sk 为唯一正确官网（DiamWall 挑战可自动过，rpc.php/eapi/搜索全链路已验证）。
/** Kotlin `const val DEFAULT_NODE = "1lib.sk"` (L25). */
export const DEFAULT_NODE = '1lib.sk';
/** Kotlin `const val SCRAPE_URL = "https://zlib.wwkejishe.top/"` (L26). */
export const SCRAPE_URL = 'https://zlib.wwkejishe.top/';

/** Kotlin `private const val PREFS_NAME = "zlib_node_manager"` (L28). */
export const PREFS_NAME = 'zlib_node_manager';
/** Kotlin `private const val KEY_SCRAPED_NODES = "scraped_nodes"` (L29). */
export const KEY_SCRAPED_NODES = 'scraped_nodes';
/** Kotlin `private const val KEY_CUSTOM_NODES = "custom_nodes"` (L30). */
export const KEY_CUSTOM_NODES = 'custom_nodes';
/** Kotlin `private const val KEY_SELECTED_NODE = "selected_node"` (L31). */
export const KEY_SELECTED_NODE = 'selected_node';

/** Kotlin `.header("Accept", …)` at L191 — verbatim. */
export const SCRAPE_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/**
 * Kotlin L182-187:
 * `SharedHttpTransport.builder().dns(ZLibraryDns.INSTANCE).connectTimeout(10, SECONDS)
 *  .readTimeout(10, SECONDS).followRedirects(true).build()`
 * — carried for the platform transport; the port's request spec has a single whole-call deadline
 * (`callTimeoutMs`), so `10 s` is also the value passed there.
 */
export const SCRAPE_CONFIG = {
  /** Kotlin `.connectTimeout(10, TimeUnit.SECONDS)`. */
  connectTimeoutMs: 10_000,
  /** Kotlin `.readTimeout(10, TimeUnit.SECONDS)`. */
  readTimeoutMs: 10_000,
  /** Kotlin `.followRedirects(true)`. */
  followRedirects: true,
  /** Kotlin `.dns(ZLibraryDns.INSTANCE)`. */
  useZLibraryDns: true,
} as const;

/**
 * 2026-09-04 晚 Edge 登录态逐个实测的活节点（首页真实 + 搜索出书卡片），
 * 节点管理页显示"已验证可用"标签的依据。
 */
export const VERIFIED_LIVE_NODES: readonly string[] = [
  '1lib.sk',
  'z-lib.by',
  'z-library.sk',
  'zh.z-lib.by',
  'zh.z-library.sk',
  'en.z-lib.by',
];

/** `setOf(...)` membership test over `VERIFIED_LIVE_NODES` (same insertion order). */
const VERIFIED_LIVE_NODE_SET: ReadonlySet<string> = new Set(VERIFIED_LIVE_NODES);

/**
 * 首次使用即内置的候选节点，扒取成功后可替换刷新（2026-09-04 晚 Edge
 * 全核实测，含登录态验证）。
 * 六活节点（CN 网络逐一实测搜索出书卡片）：1lib.sk（唯一正确官网）→
 * z-lib.by（无挑战直通，全链路含下载验证）→ z-library.sk → zh.z-lib.by
 * （中文）→ zh.z-library.sk（中文）→ en.z-lib.by → z-lib.sk（DiamWall 硬
 * 挑战留池）→ CF 域（海外/代理兜底）。
 * 退役：z-lib.is（指纹网关 fp=-7）、z-library.se（ww38 停放页）、z-lib.id
 * （停放页，官方发布页证实钓鱼）、z-lib.li / z-lib.cc（仿冒站）、zlib.bz /
 * 101k 系 / zlib.ch / zlib.re / zh.z-lib.rest（死透或 301 归拢枢纽）。
 */
export const INITIAL_SCRAPED_NODES: readonly string[] = [
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

/**
 * 已退役域名（2026-09-04 22:10 Edge 全核实测：死透 / 归拢枢纽已灭 / 仿冒站 /
 * 停放页 / 指纹网关拒绝）：老用户存储的候选列表里把它们过滤掉——节点管理页
 * 不再显示死节点占位，扫描池也不为 GFW 黑洞域名白等连接超时。
 */
export const RETIRED_NODES: ReadonlySet<string> = new Set([
  'z-lib.id', // 停放落地页（"Z-Library" 文案 59 处但无任何站点结构）
  'z-lib.li', // 仿冒站
  'z-lib.cc', // 仿冒站
  'z-lib.is', // 指纹网关 fp=-7 拒绝（真 Edge 20s 亦不可过，2026-09-04 22:10）
  'z-library.se', // 已沦为 ww28/ww38 域名停放页
  'zlib.bz', // 归拢枢纽，已死
  'zh.z-lib.rest', // 301 → zlib.bz（死枢纽），2026-09-04 23:20 curl 实测
  'zh.101k.by',
  'tw.101k.by',
  'zh.101z.by',
  'zlib.ch',
  'zlib.re',
  'zh.z-library.by',
]);

/**
 * 节点迁移表：旧节点 → 现节点（启动恢复时自动升级）。
 * 2026-09-04 23:30 校准：z-lib.sk / z-library.sk / z-lib.by 实测复活
 * （z-lib.by 无挑战直通，z-library.sk 全链路可用），从迁移表移除——
 * 只在它们上面存的用户不再被强制搬家。
 * 仍迁移：z-library.co 走 CF Turnstile（App 解不了）、z-lib.li / z-lib.cc 为
 * 仿冒站（无下载功能）、其余死透/归拢域——全部迁到 1lib.sk。
 */
export const MIGRATED_NODES: ReadonlyMap<string, string> = new Map<string, string>([
  ['zh.101k.by', DEFAULT_NODE],
  ['tw.101k.by', DEFAULT_NODE],
  ['zh.101z.by', DEFAULT_NODE],
  ['zlib.bz', DEFAULT_NODE],
  ['zh.z-library.by', DEFAULT_NODE],
  ['zlib.ch', DEFAULT_NODE],
  ['zlib.re', DEFAULT_NODE],
  ['z-lib.li', DEFAULT_NODE],
  ['z-lib.cc', DEFAULT_NODE],
  ['z-library.co', DEFAULT_NODE],
  ['z-library.net', DEFAULT_NODE],
  ['zlib-official.com', DEFAULT_NODE],
  ['zlibrary-global.com', DEFAULT_NODE],
  ['z-lib.id', DEFAULT_NODE],
  ['z-lib.is', DEFAULT_NODE],
  ['z-library.se', DEFAULT_NODE],
  ['z-lib.ad', DEFAULT_NODE],
  ['z-lib.my', DEFAULT_NODE],
]);

/**
 * Kotlin L207-210 — the fallback domain regex, verbatim:
 * `https?://((?:[a-z0-9-]+\.)*(?:z-lib|zlib|z-library|zlibrary|1lib)[a-z0-9.-]+)`
 * with `RegexOption.IGNORE_CASE` → the `gi` flags (global for `findAll` + case-insensitive).
 */
export const SCRAPE_DOMAIN_REGEX =
  /https?:\/\/((?:[a-z0-9-]+\.)*(?:z-lib|zlib|z-library|zlibrary|1lib)[a-z0-9.-]+)/gi;

/* ═══════════════════════════════════════════════════════════════════════════
 * Pure helpers — the Kotlin bodies that have no Android dependency, verbatim
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin `String.isBlank()` (L89, L104, L125, L226, L229). */
export function isBlank(value: string): boolean {
  return value.length === 0 || /^\s+$/.test(value);
}

/**
 * Kotlin L224-230 `private fun cleanNode(raw: String): String?`, verbatim:
 * ```
 * val trimmed = raw.trim()
 * if (trimmed.isBlank()) return null
 * var host = trimmed.substringAfter("://", trimmed)
 * host = host.substringBefore('/').substringBefore('?').substringBefore('#')
 * return host.trim().lowercase().ifBlank { null }
 * ```
 * `substringAfter(d, missing)` returns the WHOLE string when the delimiter is absent, so
 * `https://1lib.sk/`, `1lib.sk/path`, `1lib.sk?x`, `1lib.sk#y` and a bare `1LIB.SK` all
 * normalise to the same host.
 */
export function cleanNode(raw: string): string | null {
  const trimmed = raw.trim();
  if (isBlank(trimmed)) return null;
  // Kotlin `substringAfter("://", trimmed)`
  const schemeAt = trimmed.indexOf('://');
  let host = schemeAt < 0 ? trimmed : trimmed.slice(schemeAt + '://'.length);
  // Kotlin `substringBefore('/').substringBefore('?').substringBefore('#')`
  for (const delimiter of ['/', '?', '#']) {
    const at = host.indexOf(delimiter);
    if (at >= 0) host = host.slice(0, at);
  }
  const out = host.trim().toLowerCase();
  return out === '' ? null : out;
}

/** Kotlin L218 `filter { it !in RETIRED_NODES }`. */
export function filterRetired(nodes: readonly string[]): string[] {
  return nodes.filter((it) => !RETIRED_NODES.has(it));
}

/** Kotlin L89-92: `getString(KEY) ?: return INITIAL_SCRAPED_NODES` + split/trim/filter/ifEmpty. */
export function parseScrapedNodes(raw: string | null): string[] {
  if (raw === null) return [...INITIAL_SCRAPED_NODES];
  const nodes = raw
    .split('\n')
    .map((it) => it.trim())
    .filter((it) => it !== '' && !RETIRED_NODES.has(it));
  return nodes.length > 0 ? nodes : [...INITIAL_SCRAPED_NODES];
}

/** Kotlin L103-104: `getString(KEY) ?: return emptyList()` + split/trim/filter. */
export function parseCustomNodes(raw: string | null): string[] {
  if (raw === null) return [];
  return raw
    .split('\n')
    .map((it) => it.trim())
    .filter((it) => it !== '');
}

/** Kotlin L123-126: `getString(KEY)?.trim()?.takeIf { it.isNotBlank() } ?: DEFAULT_NODE`. */
export function parseSelectedNode(raw: string | null): string {
  const trimmed = raw === null ? '' : raw.trim();
  return trimmed === '' ? DEFAULT_NODE : trimmed;
}

/**
 * Kotlin L98 `val cleaned = (INITIAL_SCRAPED_NODES + nodes.mapNotNull { cleanNode(it) }).distinct()`
 * — merge, never replace: the six实测活节点 always stay at the front, so a scrape that only
 * reports a couple of entries can never drop the verified primaries.
 */
export function mergeScrapedNodes(nodes: readonly string[]): string[] {
  const merged: string[] = [...INITIAL_SCRAPED_NODES];
  const seen = new Set(merged);
  for (const raw of nodes) {
    const clean = cleanNode(raw);
    if (clean !== null && !seen.has(clean)) {
      seen.add(clean);
      merged.push(clean);
    }
  }
  return merged;
}

/** Kotlin L140 `MIGRATED_NODES[stored]!!` — `null` when the stored node stays put. */
export function migrateNode(stored: string | null): string | null {
  if (stored === null) return null;
  return MIGRATED_NODES.get(stored) ?? null;
}

/**
 * Kotlin L206-216 — the `scraped.isEmpty()` fallback branch: sweep the WHOLE page for
 * zlib-family domains, keep only dotted non-asset hosts, de-duplicate, then drop retired ones.
 * Exported so the regex path is unit-testable without a transport.
 */
export function scrapeFallbackDomains(html: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  SCRAPE_DOMAIN_REGEX.lastIndex = 0;
  for (const match of html.matchAll(SCRAPE_DOMAIN_REGEX)) {
    const host = (match[1] ?? '').toLowerCase();
    if (!host.includes('.')) continue;
    if (host.endsWith('.png') || host.endsWith('.js')) continue;
    if (seen.has(host)) continue;
    seen.add(host);
    found.push(host);
  }
  return filterRetired(found);
}

/** ADDITION — `node in ZLibraryNodeManager.VERIFIED_LIVE_NODES` (screen L295). */
export function isVerifiedLiveNode(node: string): boolean {
  return VERIFIED_LIVE_NODE_SET.has(node);
}

/**
 * ADDITION — the screen's four-way label ranking (L293-318 + L398-403 of the ported TSX),
 * kept here so `VERIFIED_LIVE_NODES` and the ranking that consumes it are tested together.
 */
export function nodeLabelFor(node: string, defaultNode: string = DEFAULT_NODE): string {
  if (node === defaultNode) return '默认节点';
  if (isVerifiedLiveNode(node)) return '已验证可用';
  if (node === 'z-lib.sk') return '硬挑战·留池';
  return '导航站节点';
}

/**
 * ADDITION — the candidate order `ZLibraryEndpointProvider.scanForLiveNode` builds from the two
 * lists this manager owns (scraped first, then custom), preserving first-seen order exactly like
 * the Kotlin `Map` that de-duplicates across the three sources.
 */
export function failoverCandidateOrder(
  scraped: readonly string[],
  custom: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const node of [...scraped, ...custom]) {
    if (node === '' || seen.has(node)) continue;
    seen.add(node);
    out.push(node);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * The manager (Kotlin `object ZLibraryNodeManager`)
 * ═══════════════════════════════════════════════════════════════════════════ */

export class ZLibraryNodeManager {
  /** Kotlin `ZLibraryNodeManager.DEFAULT_NODE` — for the screen's `ZLibraryNodeStore`. */
  readonly DEFAULT_NODE: string = DEFAULT_NODE;
  /** Kotlin `ZLibraryNodeManager.DEFAULT_NODE` — for `ZLibraryNodeManagerPort.defaultNode`. */
  readonly defaultNode: string = DEFAULT_NODE;
  /** Kotlin `ZLibraryNodeManager.VERIFIED_LIVE_NODES` — `ReadonlyArray` for `.includes`. */
  readonly VERIFIED_LIVE_NODES: readonly string[] = VERIFIED_LIVE_NODES;
  /** Kotlin `ZLibraryNodeManager.INITIAL_SCRAPED_NODES`. */
  readonly INITIAL_SCRAPED_NODES: readonly string[] = INITIAL_SCRAPED_NODES;
  /** Kotlin `private val RETIRED_NODES`. */
  readonly RETIRED_NODES: ReadonlySet<string> = RETIRED_NODES;
  /** Kotlin `private val MIGRATED_NODES`. */
  readonly MIGRATED_NODES: ReadonlyMap<string, string> = MIGRATED_NODES;

  /**
   * In-memory mirror of the three preference strings. Kotlin reads `SharedPreferences`
   * synchronously, so `getScrapedNodes()`/`getCustomNodes()` cost nothing; the async store
   * cannot be read synchronously, so the host calls `hydrate()` once at startup (next to
   * `restoreSelection()`) and the synchronous `ZLibraryNodeManagerPort` reads this mirror.
   * Every write below updates the mirror BEFORE the awaited store write.
   */
  private rawScraped: string | null = null;
  private rawCustom: string | null = null;
  private rawSelected: string | null = null;
  private hydrated = false;

  constructor(
    private readonly store: ZLibraryPrefsStore,
    /** Kotlin writes `ZLibraryNodeConfig.domain` directly; the port lets a host redirect it. */
    private readonly nodeConfig: ZLibraryNodeConfigPort = {
      nodeDomain,
      setNodeDomain,
    },
  ) {}

  /** ADDITION — one store read per key so the synchronous port is usable. */
  async hydrate(): Promise<void> {
    const [scraped, custom, selected] = await Promise.all([
      this.store.getString(KEY_SCRAPED_NODES),
      this.store.getString(KEY_CUSTOM_NODES),
      this.store.getString(KEY_SELECTED_NODE),
    ]);
    this.rawScraped = scraped;
    this.rawCustom = custom;
    this.rawSelected = selected;
    this.hydrated = true;
  }

  /** ADDITION — whether `hydrate()` has run (the sync getters assume it has). */
  get isHydrated(): boolean {
    return this.hydrated;
  }

  /* ── reads ───────────────────────────────────────────────────────────── */

  /** Kotlin L88-93 `getScrapedNodes(context)` — synchronous (mirror-backed). */
  scrapedNodesSync(): string[] {
    return parseScrapedNodes(this.rawScraped);
  }

  /** Kotlin L102-105 `getCustomNodes(context)` — synchronous (mirror-backed). */
  customNodesSync(): string[] {
    return parseCustomNodes(this.rawCustom);
  }

  /** Kotlin L122-127 `getSelectedNode(context)` — synchronous (mirror-backed). */
  selectedNodeSync(): string {
    return parseSelectedNode(this.rawSelected);
  }

  /** Kotlin L88-93 `getScrapedNodes(context)` — store-backed. */
  async getScrapedNodes(): Promise<string[]> {
    this.rawScraped = await this.store.getString(KEY_SCRAPED_NODES);
    return parseScrapedNodes(this.rawScraped);
  }

  /** Kotlin L102-105 `getCustomNodes(context)` — store-backed. */
  async getCustomNodes(): Promise<string[]> {
    this.rawCustom = await this.store.getString(KEY_CUSTOM_NODES);
    return parseCustomNodes(this.rawCustom);
  }

  /** Kotlin L122-127 `getSelectedNode(context)` — store-backed. */
  async getSelectedNode(): Promise<string> {
    this.rawSelected = await this.store.getString(KEY_SELECTED_NODE);
    return parseSelectedNode(this.rawSelected);
  }

  /* ── writes ──────────────────────────────────────────────────────────── */

  /** Kotlin L95-100 `saveScrapedNodes(context, nodes)`. */
  async saveScrapedNodes(nodes: readonly string[]): Promise<void> {
    // 合并而非替换（用户要求"作为内置节点的补充"）：六个实测活节点始终保留，
    // 新扒取的节点追加——导航站某次漏报/部分失败时不会丢掉已验证的主力节点。
    const cleaned = mergeScrapedNodes(nodes);
    const joined = cleaned.join('\n');
    this.rawScraped = joined;
    await this.store.putString(KEY_SCRAPED_NODES, joined);
  }

  /** Kotlin L107-112 `addCustomNode(context, rawNode)`. */
  async addCustomNode(rawNode: string): Promise<boolean> {
    const clean = cleanNode(rawNode);
    if (clean === null) return false;
    const current = await this.getCustomNodes();
    const list = Array.from(new Set([...current, clean]));
    const joined = list.join('\n');
    this.rawCustom = joined;
    await this.store.putString(KEY_CUSTOM_NODES, joined);
    return true;
  }

  /** Kotlin L114-120 `removeCustomNode(context, node)`. */
  async removeCustomNode(node: string): Promise<void> {
    const list = (await this.getCustomNodes()).filter((it) => it !== node);
    const joined = list.join('\n');
    this.rawCustom = joined;
    await this.store.putString(KEY_CUSTOM_NODES, joined);
    if ((await this.getSelectedNode()) === node) {
      await this.selectNode(DEFAULT_NODE);
    }
  }

  /** Kotlin L129-133 `selectNode(context, rawNode)`. */
  async selectNode(rawNode: string): Promise<void> {
    const clean = cleanNode(rawNode);
    if (clean === null) return;
    this.rawSelected = clean;
    await this.store.putString(KEY_SELECTED_NODE, clean);
    this.nodeConfig.setNodeDomain(clean);
  }

  /**
   * Kotlin L135-147 `restoreSelection(context)`:
   * 迁移（2026-09-04）：旧默认 zh.101k.by 已整站 301 → zlib.bz，存的是它就
   * 就地升级为新默认，避免老用户启动即落在重定向域上（搜索全卡/假结果）。
   */
  async restoreSelection(): Promise<void> {
    const stored = this.rawSelected === null ? null : this.rawSelected.trim();
    this.rawSelected = stored;
    const migrated = migrateNode(stored);
    if (stored !== null && migrated !== null) {
      this.rawSelected = migrated;
      await this.store.putString(KEY_SELECTED_NODE, migrated);
      this.nodeConfig.setNodeDomain(migrated);
    } else {
      this.nodeConfig.setNodeDomain(await this.getSelectedNode());
    }
  }

  /* ── scraping ────────────────────────────────────────────────────────── */

  /**
   * Kotlin L176-222 `suspend fun scrapeNodes(context): List<String>`.
   * 从 https://zlib.wwkejishe.top/ 扒取 #official-urls 表格内的全部官方入口
   * （z-lib.by / z-library.sk / zh.zlib.li 等优先尝试+备用+中文入口，2026-09-04
   * 实测解析验证）。站点长期维护（更新日期标注在页面），是当前最可靠的
   * 实时节点来源。
   */
  async scrapeNodes(
    transport: ZLibraryHttpTransport,
    signal?: AbortSignal | null,
  ): Promise<string[]> {
    try {
      const response = await transport.send(
        {
          method: 'GET',
          url: SCRAPE_URL,
          referer: null,
          extraHeaders: {
            'User-Agent': DEFAULT_USER_AGENT,
            Accept: SCRAPE_ACCEPT,
            'Accept-Language': DEFAULT_ACCEPT_LANG,
          },
          formFields: null,
          // Kotlin `.connectTimeout(10, SECONDS).readTimeout(10, SECONDS)` — see SCRAPE_CONFIG.
          callTimeoutMs: SCRAPE_CONFIG.connectTimeoutMs,
        },
        signal ?? null,
      );
      const html = response.isSuccessful ? response.body : null;
      response.close();
      if (html === null || isBlank(html)) return [];

      const doc = parseHtmlDocument(html);
      // #official-urls 区块的入口表格：每行第一格是 <a href="https://域名/">
      const scraped = Array.from(
        new Set(
          doc
            .select('#official-urls table a[href]')
            .map((el) => cleanNode(el.attr('href')))
            .filter((it): it is string => it !== null),
        ),
      );
      // 兜底：站点改版导致表格选择器失灵时，退化为抓整页 zlib 系域名
      const candidates = scraped.length === 0 ? scrapeFallbackDomains(html) : scraped;
      // 退役域名过滤（zh.z-lib.rest → 301 死枢纽 zlib.bz 等）
      return filterRetired(candidates);
    } catch {
      // Kotlin L219-221 `catch (e: Exception) { emptyList() }`
      return [];
    }
  }
}

/** Kotlin `object ZLibraryNodeManager` — one instance per app, wired by the host. */
export function createZLibraryNodeManager(
  store: ZLibraryPrefsStore,
  nodeConfig?: ZLibraryNodeConfigPort,
): ZLibraryNodeManager {
  return new ZLibraryNodeManager(store, nodeConfig);
}

/**
 * Structural mirror of the `ZLibraryNodeStore` interface declared in
 * `src/ui/components/source/ZLibraryNodeManagementScreen.tsx` (that file is not modified; this
 * declaration exists so `createNodeStore` is type-checked against the exact shape the screen
 * expects, and so `src/core` never has to import from `src/ui`).
 */
export interface ZLibraryNodeStore {
  readonly DEFAULT_NODE: string;
  readonly VERIFIED_LIVE_NODES: ReadonlyArray<string>;
  getScrapedNodes(): Promise<string[]>;
  saveScrapedNodes(nodes: ReadonlyArray<string>): Promise<void>;
  getCustomNodes(): Promise<string[]>;
  addCustomNode(domain: string): Promise<boolean>;
  removeCustomNode(domain: string): Promise<void>;
  getSelectedNode(): Promise<string>;
  selectNode(node: string): Promise<void>;
  /** Kotlin `ZLibraryNodeManager.scrapeNodes(context)` — pulls the official entry list. */
  scrapeNodes(): Promise<string[]>;
}

/**
 * ADDITION — binds the scrape transport so the class can be handed to the already-ported screen
 * as its `ZLibraryNodeStore` prop (`store.scrapeNodes()` takes no argument there, while the port
 * keeps `scrapeNodes(transport)` explicit and therefore unit-testable).
 *
 * Every other member is the class itself: `DEFAULT_NODE`, `VERIFIED_LIVE_NODES`, `getScrapedNodes`,
 * `saveScrapedNodes`, `getCustomNodes`, `addCustomNode`, `removeCustomNode`, `getSelectedNode` and
 * `selectNode` already match the screen's declared interface 1:1.
 */
export function createNodeStore(
  manager: ZLibraryNodeManager,
  transport: ZLibraryHttpTransport,
): ZLibraryNodeStore {
  return {
    DEFAULT_NODE: manager.DEFAULT_NODE,
    VERIFIED_LIVE_NODES: manager.VERIFIED_LIVE_NODES,
    getScrapedNodes: () => manager.getScrapedNodes(),
    saveScrapedNodes: (nodes) => manager.saveScrapedNodes(nodes),
    getCustomNodes: () => manager.getCustomNodes(),
    addCustomNode: (node) => manager.addCustomNode(node),
    removeCustomNode: (node) => manager.removeCustomNode(node),
    getSelectedNode: () => manager.getSelectedNode(),
    selectNode: (node) => manager.selectNode(node),
    scrapeNodes: () => manager.scrapeNodes(transport),
  };
}

/**
 * ADDITION — the synchronous `ZLibraryNodeManagerPort` that the already-ported
 * `ZLibraryEndpointProvider` constructor takes
 * (`ZLibraryEndpointProvider(store, nodeConfig, nodeManager, …)`).
 * The host calls `hydrate()` once at startup before handing this over.
 */
export function createNodeManagerPort(manager: ZLibraryNodeManager): ZLibraryNodeManagerPort {
  return {
    defaultNode: DEFAULT_NODE,
    getScrapedNodes: () => manager.scrapedNodesSync(),
    getCustomNodes: () => manager.customNodesSync(),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Node probe — the `ZLibraryNodeProbe` shape the already-ported screen declares
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The search keyword the Android probe uses — 三体, verbatim (screen L92). */
export const NODE_PROBE_KEYWORD = '三体';

/** Structural `ZLibraryHttpClient` subset the probe needs (screen L88-95). */
export interface ZLibraryNodeHttpClient {
  get(url: string, referer?: string | null): Promise<ZLibraryHttpResponse>;
}

/** Kotlin `val httpResult` final page — the screen's `ZLibraryProbeResult`. */
export interface ZLibraryNodeProbeResult {
  httpStatus: number;
  /** Kotlin `response.request.url.encodedPath` — the post-redirect path. */
  finalPath: string;
  html: string;
  books: readonly SearchBook[];
}

/** Kotlin `ZLibraryWebViewHelper.searchViaWebView(…)` — the screen's `ZLibraryWebViewResult`. */
export interface ZLibraryNodeWebViewResult {
  books: readonly SearchBook[];
  pageHasZlibMarkers: boolean;
  stillChallenged: boolean;
}

/**
 * The two methods `ZLibraryNodeManagementScreen.tsx` declares as `ZLibraryNodeProbe`
 * (that file is not edited; this is the implementation it is waiting for).
 *
 * Only the plumbing lives here — URL building, `finalPath` extraction, the parse and the
 * WebView call. The verdict/ranking ladder (可用/不可用/需验证 + the WebView retry) stays in
 * the screen's own `probeNodeStatus`, which already implements the Kotlin `testNode` ladder
 * verbatim; duplicating it here would create a second source of truth for those strings.
 */
export interface ZLibraryNodeProbe {
  search(node: string, keyword: string): Promise<ZLibraryNodeProbeResult>;
  searchViaWebView(node: string, keyword: string): Promise<ZLibraryNodeWebViewResult>;
}

export interface ZLibraryNodeProbeDeps {
  httpClient: ZLibraryNodeHttpClient;
  credentialStorage: { getCookies(): Promise<string | null> };
  runtime: HtmlRuntimeFactory;
}

/** ADDITION — assembles `ZLibraryNodeProbe` from the already-ported zlibrary modules. */
export function createNodeProbe(deps: ZLibraryNodeProbeDeps): ZLibraryNodeProbe {
  return {
    async search(node: string, keyword: string): Promise<ZLibraryNodeProbeResult> {
      // Kotlin L92-93: `URLEncoder.encode(kw, "UTF-8").replace("+", "%20")` — the port's
      // `javaUrlEncode` already emits `+` for a space, so the swap is kept verbatim.
      const encodedKw = javaUrlEncode(keyword).replace(/\+/g, '%20');
      const url = `https://${node}/s/${encodedKw}`;
      const response = await deps.httpClient.get(url, `https://${node}/`);
      const code = response.code;
      const html = response.body;
      // Kotlin L100: `response.request.url.encodedPath` — the port surfaces the FINAL url.
      let finalPath = '';
      try {
        finalPath = new URL(response.url).pathname;
      } catch {
        finalPath = '';
      }
      let books: SearchBook[] = [];
      try {
        books = ZLibraryParserManager.parseSearchPage(html, `https://${node}`, 'zlibrary');
      } catch {
        books = [];
      }
      response.close();
      return { httpStatus: code, finalPath, html, books };
    },
    async searchViaWebView(node: string, keyword: string): Promise<ZLibraryNodeWebViewResult> {
      const web = await ZLibraryWebViewHelper.searchViaWebView(
        deps.runtime,
        node,
        keyword,
        await deps.credentialStorage.getCookies(),
      );
      return {
        books: web.books,
        pageHasZlibMarkers: web.pageHasZlibMarkers,
        stillChallenged: web.stillChallenged,
      };
    },
  };
}