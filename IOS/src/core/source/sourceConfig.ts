/**
 * Android source: `com.example.source.SourceConfig.kt`
 * Data classes: BookFieldRule, SearchRule, DetailRule, DownloadRule,
 * HtmlSearchRule, HtmlChapterRule, HtmlContentRule, SourceConfig.
 */

export interface BookFieldRule {
  readonly id: string;
  readonly title: string;
  readonly author: string | null;
  readonly cover: string | null;
  readonly description: string | null;
  readonly format: string | null;
  readonly downloadUrl: string | null;
}

export function createBookFieldRule(overrides: Partial<BookFieldRule> = {}): BookFieldRule {
  return {
    id: 'id',
    title: 'title',
    author: 'author',
    cover: 'cover',
    description: 'description',
    format: 'format',
    downloadUrl: 'downloadUrl',
    ...overrides,
  };
}

export interface SearchRule {
  readonly url: string; // e.g. https://example.com/search?q={keyword}
  readonly method: string;
  readonly listPath: string; // e.g. "data.books"
  readonly fields: BookFieldRule;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

export function createSearchRule(params: {
  url: string;
  method?: string;
  listPath?: string;
  fields?: BookFieldRule;
  headers?: Record<string, string>;
  body?: string | null;
}): SearchRule {
  return {
    url: params.url,
    method: params.method ?? 'GET',
    listPath: params.listPath ?? 'books',
    fields: params.fields ?? createBookFieldRule(),
    headers: params.headers ?? {},
    body: params.body ?? null,
  };
}

export interface DetailRule {
  readonly url: string; // e.g. https://example.com/book/{id}
  readonly method: string;
  readonly fields: BookFieldRule;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

export function createDetailRule(params: {
  url: string;
  method?: string;
  fields?: BookFieldRule;
  headers?: Record<string, string>;
  body?: string | null;
}): DetailRule {
  return {
    url: params.url,
    method: params.method ?? 'GET',
    fields: params.fields ?? createBookFieldRule(),
    headers: params.headers ?? {},
    body: params.body ?? null,
  };
}

export interface DownloadRule {
  readonly url: string | null; // e.g. https://example.com/download/{id}
  readonly urlField: string | null; // if url in JSON item
  readonly defaultFormat: string;
  readonly headers: Record<string, string>;
}

/**
 * `DownloadRule.kt` L30-35 的默认值构造。
 *
 * ⚠️ `urlField` 的默认值是 `"downloadUrl"` 但类型是 `String?` —— Kotlin 里
 * 「不传」得 `"downloadUrl"`、「显式传 `null`」得 `null`，两者是**不同状态**。
 * 用 `?? 'downloadUrl'` 会把显式 `null` 当成缺省，于是「不按字段取 url」的书源
 * 被静默改回按字段取。这里用 `in` 区分「键存在」与「值为 null」。
 */
export function createDownloadRule(
  params: {
    url?: string | null;
    urlField?: string | null;
    defaultFormat?: string;
    headers?: Record<string, string>;
  } = {},
): DownloadRule {
  return {
    url: params.url ?? null,
    urlField: 'urlField' in params ? (params.urlField ?? null) : 'downloadUrl',
    defaultFormat: params.defaultFormat ?? 'epub',
    headers: params.headers ?? {},
  };
}

/**
 * HTML(CSS 选择器) 书源规则 —— 允许用户在 App 内粘贴 JSON 定义任意 HTML 站点，
 * 无需修改代码即可添加小说/漫画源。
 */
export interface HtmlSearchRule {
  readonly url: string; // 搜索地址，支持 {keyword} {page}
  readonly listSelector: string; // 结果列表项 CSS
  readonly titleSelector: string; // 标题，支持 "css@text" / "css@attr"
  readonly authorSelector: string;
  readonly coverSelector: string;
  readonly detailUrlSelector: string; // 详情链接，默认 "a@href"
  readonly introSelector: string; // 简介（Legado ruleSearch.intro）
  readonly charset: string | null; // 页面编码（gbk / gb2312 / utf-8），默认自动
  readonly method: string; // 请求方式（Legado 搜索支持 POST）
  readonly body: string | null; // POST 请求体模板，支持 {keyword}
}

export function createHtmlSearchRule(params: {
  url: string;
  listSelector: string;
  titleSelector?: string;
  authorSelector?: string;
  coverSelector?: string;
  detailUrlSelector?: string;
  introSelector?: string;
  charset?: string | null;
  method?: string;
  body?: string | null;
}): HtmlSearchRule {
  return {
    url: params.url,
    listSelector: params.listSelector,
    titleSelector: params.titleSelector ?? '',
    authorSelector: params.authorSelector ?? '',
    coverSelector: params.coverSelector ?? '',
    detailUrlSelector: params.detailUrlSelector ?? '',
    introSelector: params.introSelector ?? '',
    charset: params.charset ?? null,
    method: params.method ?? 'GET',
    body: params.body ?? null,
  };
}

export interface HtmlChapterRule {
  readonly url: string; // 目录页地址，支持 {id}
  readonly listSelector: string; // 章节列表项 CSS
  readonly nameSelector: string;
  readonly hrefSelector: string;
  /**
   * 目录页跳转规则（Legado ruleBookInfo.tocUrl）：目录不在详情页时，
   * 先取 {id} 页，用此规则解析出目录页 URL；空则直接用 {id} 页作目录页
   */
  readonly tocUrlSelector: string | null;
}

export function createHtmlChapterRule(params: {
  url: string;
  listSelector: string;
  nameSelector?: string;
  hrefSelector?: string;
  tocUrlSelector?: string | null;
}): HtmlChapterRule {
  return {
    url: params.url,
    listSelector: params.listSelector,
    nameSelector: params.nameSelector ?? 'text',
    hrefSelector: params.hrefSelector ?? 'href',
    tocUrlSelector: params.tocUrlSelector ?? null,
  };
}

export interface HtmlContentRule {
  readonly url: string; // 阅读页地址，支持 {chapterUrl}
  readonly imageSelector: string; // 图片选择器，如 "img.page@src" 或 "img@data-src"
}

export function createHtmlContentRule(params: {
  url: string;
  imageSelector: string;
}): HtmlContentRule {
  return {
    url: params.url,
    imageSelector: params.imageSelector,
  };
}

/**
 * `SourceConfig.kt` L69-70 `data class HtmlExploreRule(val label, val rule, val kind = null)`。
 *
 * 「A source-declared list: the search keyword is never used to fake a discovery feed.」
 * —— 这一条 KDoc 就是它存在的理由：发现页的每个列表必须由书源**自己声明**，不许拿搜索
 * 关键词去伪造一个 feed。
 *
 * ⚠️ 2026-11-17 之前这个名字被 `sourceText.ts` 的 DOM 节点快照占着（`tag`/`attributes`/
 * `children`），真身从来没实现过，`SourceConfig.explore` 也跟着缺 —— 于是
 * `JsonBookSource.kt` L108-120 那整段「把 explore 映射成 DiscoverFeed / 处理 updates /
 * ranking 维度 / 按下标取 feed」在端口里没有输入（见 E196）。
 */
export interface HtmlExploreRule {
  /** 列表标题（`JsonBookSource.kt` L108 `DiscoverFeed(id, e.label, e.kind)`）。 */
  readonly label: string;
  /** 该列表用的搜索规则（复用 `HtmlSearchRule`）。 */
  readonly rule: HtmlSearchRule;
  /** 可选的内容类型标记：`"updates"` / `"ranking"` / 其它维度名（L111/L112/L118）。 */
  readonly kind: string | null;
}

/** L70 的三个参数（`kind` 默认 `null`）。 */
export function createHtmlExploreRule(params: {
  label: string;
  rule: HtmlSearchRule;
  kind?: string | null;
}): HtmlExploreRule {
  return {
    label: params.label,
    rule: params.rule,
    kind: params.kind ?? null,
  };
}

export interface SourceConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly search: SearchRule;
  readonly detail: DetailRule | null;
  readonly download: DownloadRule;
  readonly htmlSearch: HtmlSearchRule | null;
  readonly htmlChapters: HtmlChapterRule | null;
  readonly htmlContent: HtmlContentRule | null;
  readonly enabled: boolean;
  readonly priority: number;
  readonly isCustom: boolean;
  readonly insecureTls: boolean;
  /**
   * L87 `val explore: List<HtmlExploreRule> = emptyList()` —— 书源自己声明的发现页列表。
   *
   * `JsonBookSource.kt` L108 `feeds = config.explore.mapIndexed { index, e ->
   * DiscoverFeed("explore:$index", e.label, e.kind) }`：**下标即 feed id 的一部分**，
   * 所以顺序必须原样保留（不能当 Set 去重，也不能重排）。
   */
  readonly explore: readonly HtmlExploreRule[];
  /** 可选：显式声明内容类型 "comic"/"novel"/"text"，不声明时按规则自动判断。 */
  readonly type: string | null;
}

export function createSourceConfig(params: {
  id: string;
  name: string;
  baseUrl?: string;
  search: SearchRule;
  detail?: DetailRule | null;
  download?: DownloadRule;
  htmlSearch?: HtmlSearchRule | null;
  htmlChapters?: HtmlChapterRule | null;
  htmlContent?: HtmlContentRule | null;
  enabled?: boolean;
  priority?: number;
  isCustom?: boolean;
  insecureTls?: boolean;
  explore?: readonly HtmlExploreRule[];
  type?: string | null;
}): SourceConfig {
  return {
    id: params.id,
    name: params.name,
    baseUrl: params.baseUrl ?? '',
    search: params.search,
    detail: params.detail ?? null,
    download: params.download ?? createDownloadRule(),
    htmlSearch: params.htmlSearch ?? null,
    htmlChapters: params.htmlChapters ?? null,
    htmlContent: params.htmlContent ?? null,
    enabled: params.enabled ?? true,
    priority: params.priority ?? 0,
    isCustom: params.isCustom ?? true,
    insecureTls: params.insecureTls ?? false,
    explore: params.explore ?? [],
    type: params.type ?? null,
  };
}

/* ── `impl/JsonBookSource.kt` L107-124 的纯函数部分 ──────────────────────── */

/**
 * `JsonBookSource.kt` L108 `DiscoverFeed("explore:$index", e.label, e.kind)`。
 *
 * feed id 是 `"explore:" + 下标` —— 下标来自**声明顺序**，所以 `explore` 数组既不能重排
 * 也不能去重；`SourceImporter` 解析时的顺序就是这里拿到的顺序。
 */
export interface DeclaredDiscoverFeed {
  readonly id: string;
  readonly label: string;
  readonly kind: string | null;
}

/** L108 `feeds = config.explore.mapIndexed { index, e -> DiscoverFeed("explore:$index", e.label, e.kind) }`。 */
export function declaredDiscoverFeeds(config: SourceConfig): readonly DeclaredDiscoverFeed[] {
  return config.explore.map((entry, index) => ({
    id: `explore:${String(index)}`,
    label: entry.label,
    kind: entry.kind,
  }));
}

/** L109 `declared = true, explicit = true` —— 书源自己声明的目录不需要再探测。 */
export const DECLARED_DISCOVER_CATALOG = { declared: true, explicit: true } as const;

/**
 * L110-113 `capabilities = buildMap { if (any { kind == "updates" }) put("updates", listOf("最新"))
 * if (any { kind == "ranking" }) put("ranking", listOf("热门")) }`。
 *
 * 只在**存在**对应 kind 的列表时才声明该维度；两个都有就两个都声明，一个都没有就是空表。
 */
export const DECLARED_DISCOVER_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  updates: ['最新'],
  ranking: ['热门'],
};

export function declaredDiscoverCapabilities(
  config: SourceConfig,
): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};
  const kinds = new Set(config.explore.map((entry) => entry.kind));
  if (kinds.has('updates')) out.updates = DECLARED_DISCOVER_CAPABILITIES.updates ?? [];
  if (kinds.has('ranking')) out.ranking = DECLARED_DISCOVER_CAPABILITIES.ranking ?? [];
  return out;
}

/**
 * L115-121 `val index = when { … }` + `getOrNull(index)`：
 *
 * ```
 * query.feedId == "native"  -> 0
 * query.feedId != null      -> feedId.removePrefix("explore:").toIntOrNull() ?: -1
 * else                      -> explore.indexOfFirst { it.kind == query.dimension.name.lowercase() }
 * ```
 *
 * 返回 `-1` 表示「该书源未声明此发现列表」；调用方据此给出
 * L121 的 `notice = "该书源未声明此发现列表"`。注意 `"native"` 这一档在没有声明任何列表时
 * 仍返回 0，但 `getOrNull(0)` 会落空 → 同样是「未声明」。
 */
export const UNDECLARED_DISCOVER_FEED_NOTICE = '该书源未声明此发现列表';

export function exploreFeedIndex(
  config: SourceConfig,
  feedId: string | null,
  dimension: string,
): number {
  if (feedId === 'native') return 0;
  if (feedId !== null) {
    const raw = feedId.startsWith('explore:') ? feedId.slice('explore:'.length) : feedId;
    if (!/^[+-]?[0-9]+$/.test(raw)) return -1;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : -1;
  }
  const wanted = dimension.toLowerCase();
  return config.explore.findIndex((entry) => entry.kind === wanted);
}

/**
 * L123-124 `val paged = feed.rule.url.contains("{page}") || feed.rule.body?.contains("{page}") == true`
 * 与 `if (query.page > 1 && !paged) → DiscoverPage()`（空页）。
 */
export function exploreRuleIsPaged(rule: HtmlSearchRule): boolean {
  return rule.url.includes('{page}') || (rule.body?.includes('{page}') ?? false);
}
