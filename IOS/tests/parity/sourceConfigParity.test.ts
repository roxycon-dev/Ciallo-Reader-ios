/**
 * sourceConfigParity.test.ts —— `source/SourceConfig.kt`（89 行 / 9 个 data class）。
 *
 * 这个文件是**同名占位**踩坑的典型：`SourceConfig.kt` L70 的
 * `data class HtmlExploreRule(val label, val rule: HtmlSearchRule, val kind: String?)` 从来没实现过，
 * 而 `sourceText.ts` 里挂着一个**同名但不同物**的 DOM 节点快照（`tag`/`attributes`/`children`）。
 * ledger 的 S1/S2 按同名命中判 `port`，于是「9 个声明都有对应」看起来成立 —— 实际上
 * 少了一个类型、少了 `SourceConfig.explore` 字段，连带 `JsonBookSource.kt` L107-124 的
 * 整段「把 explore 变成发现页 feed」在端口里没有输入。
 *
 * 本轮补的东西：
 *   ① `HtmlExploreRule` 真身（+ `createHtmlExploreRule`），DOM 快照改名 `HtmlDomNode`
 *   ② `SourceConfig.explore`（含 `createSourceConfig` 的 `?? []`）
 *   ③ `JsonBookSource.kt` L108-124 的可判定部分：
 *      `declaredDiscoverFeeds` / `declaredDiscoverCapabilities` / `exploreFeedIndex` / `exploreRuleIsPaged`
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DECLARED_DISCOVER_CAPABILITIES,
  DECLARED_DISCOVER_CATALOG,
  UNDECLARED_DISCOVER_FEED_NOTICE,
  createBookFieldRule,
  createDetailRule,
  createDownloadRule,
  createHtmlChapterRule,
  createHtmlContentRule,
  createHtmlExploreRule,
  createHtmlSearchRule,
  createSearchRule,
  createSourceConfig,
  declaredDiscoverCapabilities,
  declaredDiscoverFeeds,
  exploreFeedIndex,
  exploreRuleIsPaged,
  type SourceConfig,
} from '@core/source/sourceConfig';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

const CONFIG_KT = 'source/SourceConfig.kt';
const JSON_KT = 'source/impl/JsonBookSource.kt';

function searchRule(url = 'https://e.com/s?q={keyword}&p={page}'): ReturnType<typeof createSearchRule> {
  return createSearchRule({ url });
}

function config(overrides: Partial<Parameters<typeof createSourceConfig>[0]> = {}): SourceConfig {
  return createSourceConfig({ id: 'x', name: 'X', search: searchRule(), ...overrides });
}

const explore = (label: string, kind: string | null = null) =>
  createHtmlExploreRule({
    label,
    rule: createHtmlSearchRule({ url: 'https://e.com/list?page={page}', listSelector: '.item' }),
    kind,
  });

/* ══════════════════════════════════════════════════════════════════════════════
   ① 八个 data class 的字段与默认值
   ══════════════════════════════════════════════════════════════════════════════ */

describe('SourceConfig.kt L3-11 BookFieldRule', () => {
  const src = kt(CONFIG_KT);

  it('七个字段，`id` / `title` 非空、其余五个可空，默认值就是字段名', () => {
    expect(src).toContain('val id: String = "id"');
    expect(src).toContain('val title: String = "title"');
    expect(src).toContain('val author: String? = "author"');
    expect(src).toContain('val cover: String? = "cover"');
    expect(src).toContain('val description: String? = "description"');
    expect(src).toContain('val format: String? = "format"');
    expect(src).toContain('val downloadUrl: String? = "downloadUrl"');
    expect(createBookFieldRule()).toEqual({
      id: 'id',
      title: 'title',
      author: 'author',
      cover: 'cover',
      description: 'description',
      format: 'format',
      downloadUrl: 'downloadUrl',
    });
  });

  it('覆盖任意字段不影响其余六个', () => {
    expect(createBookFieldRule({ author: null })).toMatchObject({ author: null, title: 'title' });
  });
});

describe('SourceConfig.kt L13-28 SearchRule / DetailRule', () => {
  const src = kt(CONFIG_KT);

  it('SearchRule：`method = "GET"`、`listPath = "books"`、`headers = emptyMap()`、`body = null`', () => {
    expect(src).toContain('val method: String = "GET"');
    expect(src).toContain('val listPath: String = "books", // e.g. "data.books"');
    expect(src).toContain('val headers: Map<String, String> = emptyMap()');
    expect(src).toContain('val body: String? = null');
    expect(createSearchRule({ url: 'u' })).toEqual({
      url: 'u',
      method: 'GET',
      listPath: 'books',
      fields: createBookFieldRule(),
      headers: {},
      body: null,
    });
  });

  it('DetailRule 没有 `listPath`，其余五项与 SearchRule 同默认', () => {
    const detailBlock = src.slice(src.indexOf('data class DetailRule('), src.indexOf('data class DownloadRule('));
    expect(detailBlock).not.toContain('listPath');
    expect(createDetailRule({ url: 'd' })).toEqual({
      url: 'd',
      method: 'GET',
      fields: createBookFieldRule(),
      headers: {},
      body: null,
    });
  });
});

describe('SourceConfig.kt L30-35 DownloadRule', () => {
  const src = kt(CONFIG_KT);

  it('`url = null` / `urlField = "downloadUrl"` / `defaultFormat = "epub"`', () => {
    expect(src).toContain('val url: String? = null');
    expect(src).toContain('val urlField: String? = "downloadUrl", // if url in JSON item');
    expect(src).toContain('val defaultFormat: String = "epub"');
    expect(createDownloadRule()).toEqual({
      url: null,
      urlField: 'downloadUrl',
      defaultFormat: 'epub',
      headers: {},
    });
  });

  it('`urlField` 可以显式置 null（不是「缺省才回落」）', () => {
    expect(createDownloadRule({ urlField: null }).urlField).toBeNull();
    expect(createDownloadRule({ url: 'x', defaultFormat: 'txt' })).toMatchObject({
      url: 'x',
      defaultFormat: 'txt',
    });
  });
});

describe('SourceConfig.kt L41-67 三个 HTML 规则', () => {
  const src = kt(CONFIG_KT);

  it('HtmlSearchRule：十个字段，doc 注释的四处语义逐字保留', () => {
    expect(src).toContain('val titleSelector: String = "",     // 标题，支持 "css@text" / "css@attr"');
    expect(src).toContain('val detailUrlSelector: String = "", // 详情链接，默认 "a@href"');
    expect(src).toContain('val introSelector: String = "",     // 简介（Legado ruleSearch.intro）');
    expect(src).toContain('val charset: String? = null,        // 页面编码（gbk / gb2312 / utf-8），默认自动');
    expect(src).toContain('val method: String = "GET",         // 请求方式（Legado 搜索支持 POST）');
    const rule = createHtmlSearchRule({ url: 'u', listSelector: '.l' });
    expect(rule).toEqual({
      url: 'u',
      listSelector: '.l',
      titleSelector: '',
      authorSelector: '',
      coverSelector: '',
      detailUrlSelector: '',
      introSelector: '',
      charset: null,
      method: 'GET',
      body: null,
    });
  });

  it('HtmlChapterRule：`nameSelector = "text"` / `hrefSelector = "href"` / `tocUrlSelector = null`', () => {
    expect(src).toContain('val nameSelector: String = "text"');
    expect(src).toContain('val hrefSelector: String = "href"');
    expect(src).toContain('val tocUrlSelector: String? = null');
    expect(createHtmlChapterRule({ url: 'u', listSelector: '.c' })).toEqual({
      url: 'u',
      listSelector: '.c',
      nameSelector: 'text',
      hrefSelector: 'href',
      tocUrlSelector: null,
    });
  });

  it('HtmlContentRule：两个必填字段（`url` 支持 {chapterUrl}、`imageSelector` 形如 "img.page@src"）', () => {
    expect(src).toContain('// 阅读页地址，支持 {chapterUrl}');
    expect(src).toContain('// 图片选择器，如 "img.page@src" 或 "img@data-src"');
    expect(createHtmlContentRule({ url: 'u', imageSelector: 'img@data-src' })).toEqual({
      url: 'u',
      imageSelector: 'img@data-src',
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② HtmlExploreRule（本轮补的真身）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('SourceConfig.kt L69-70 HtmlExploreRule', () => {
  const src = kt(CONFIG_KT);

  it('三个字段：`label` / `rule: HtmlSearchRule` / `kind: String? = null`', () => {
    expect(src).toContain('data class HtmlExploreRule(val label: String, val rule: HtmlSearchRule, val kind: String? = null)');
    const entry = explore('最新', null);
    expect(entry).toEqual({
      label: '最新',
      rule: createHtmlSearchRule({ url: 'https://e.com/list?page={page}', listSelector: '.item' }),
      kind: null,
    });
  });

  it('KDoc「A source-declared list: the search keyword is never used to fake a discovery feed.」', () => {
    expect(src).toContain('A source-declared list: the search keyword is never used to fake a discovery feed.');
    // 这条 KDoc 是它存在的理由：feed 必须由书源声明，不许拿搜索关键词伪造。
    expect(explore('最新', 'updates').kind).toBe('updates');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ SourceConfig 主结构（含 explore）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('SourceConfig.kt L72-89 SourceConfig 的默认值', () => {
  const src = kt(CONFIG_KT);

  it('`baseUrl = ""` / `detail = null` / `download = DownloadRule()` / 三个 html 规则为 null', () => {
    expect(src).toContain('val baseUrl: String = ""');
    expect(src).toContain('val detail: DetailRule? = null');
    expect(src).toContain('val download: DownloadRule = DownloadRule()');
    expect(src).toContain('val htmlSearch: HtmlSearchRule? = null');
    expect(src).toContain('val htmlChapters: HtmlChapterRule? = null');
    expect(src).toContain('val htmlContent: HtmlContentRule? = null');
    const built = config();
    expect(built.baseUrl).toBe('');
    expect(built.detail).toBeNull();
    expect(built.download).toEqual(createDownloadRule());
    expect(built.htmlSearch).toBeNull();
    expect(built.htmlChapters).toBeNull();
    expect(built.htmlContent).toBeNull();
  });

  it('`enabled = true` / `priority = 0` / `isCustom = true` / `insecureTls = false`', () => {
    expect(src).toContain('val enabled: Boolean = true');
    expect(src).toContain('val priority: Int = 0');
    expect(src).toContain('val isCustom: Boolean = true');
    expect(src).toContain('val insecureTls: Boolean = false');
    expect(config()).toMatchObject({ enabled: true, priority: 0, isCustom: true, insecureTls: false });
    // `isCustom` 默认 true —— 导入的书源就是自定义源，反过来才是特例
    expect(config({ isCustom: false }).isCustom).toBe(false);
  });

  it('`explore: List<HtmlExploreRule> = emptyList()` 与 `type: String? = null`', () => {
    expect(src).toContain('val explore: List<HtmlExploreRule> = emptyList(),');
    expect(src).toContain('val type: String? = null');
    expect(config().explore).toEqual([]);
    expect(config().type).toBeNull();
    expect(config({ type: 'comic' }).type).toBe('comic');
  });

  it('`explore` 的顺序原样保留（feed id 里带着下标）', () => {
    const built = config({ explore: [explore('最新', 'updates'), explore('热门', 'ranking')] });
    expect(built.explore.map((e) => e.label)).toEqual(['最新', '热门']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ JsonBookSource.kt L107-124 的可判定部分
   ══════════════════════════════════════════════════════════════════════════════ */

describe('JsonBookSource.kt L107-113 discoverCatalog', () => {
  const src = kt(JSON_KT);

  it('L108 feed id 是 `explore:<下标>`，label/kind 原样透传', () => {
    expect(src).toContain(
      'feeds = config.explore.mapIndexed { index, e -> com.example.discover.DiscoverFeed("explore:$index", e.label, e.kind) },',
    );
    const feeds = declaredDiscoverFeeds(config({ explore: [explore('最新', 'updates'), explore('其它')] }));
    expect(feeds).toEqual([
      { id: 'explore:0', label: '最新', kind: 'updates' },
      { id: 'explore:1', label: '其它', kind: null },
    ]);
  });

  it('L109 `declared = true, explicit = true`', () => {
    expect(src).toContain('declared = true, explicit = true,');
    expect(DECLARED_DISCOVER_CATALOG).toEqual({ declared: true, explicit: true });
  });

  it('L110-113 只有声明了对应 kind 才给出该维度', () => {
    expect(src).toContain('if (config.explore.any { it.kind == "updates" }) put("updates", listOf("最新"))');
    expect(src).toContain('if (config.explore.any { it.kind == "ranking" }) put("ranking", listOf("热门"))');
    expect(DECLARED_DISCOVER_CAPABILITIES).toEqual({ updates: ['最新'], ranking: ['热门'] });
    expect(declaredDiscoverCapabilities(config({ explore: [] }))).toEqual({});
    expect(declaredDiscoverCapabilities(config({ explore: [explore('最新', 'updates')] }))).toEqual({
      updates: ['最新'],
    });
    expect(
      declaredDiscoverCapabilities(
        config({ explore: [explore('最新', 'updates'), explore('热门', 'ranking')] }),
      ),
    ).toEqual({ updates: ['最新'], ranking: ['热门'] });
    // kind 为 null / 其它值都不产生维度
    expect(declaredDiscoverCapabilities(config({ explore: [explore('其它'), explore('杂', 'tag')] }))).toEqual({});
  });
});

describe('JsonBookSource.kt L115-124 feed 定位与分页判定', () => {
  const src = kt(JSON_KT);

  it('L116 `feedId == "native"` → 0', () => {
    expect(src).toContain('query.feedId == "native" -> 0');
    expect(exploreFeedIndex(config({ explore: [explore('a')] }), 'native', 'updates')).toBe(0);
  });

  it('L117 `removePrefix("explore:").toIntOrNull() ?: -1`', () => {
    expect(src).toContain('query.feedId != null -> query.feedId.removePrefix("explore:").toIntOrNull() ?: -1');
    const built = config({ explore: [explore('a'), explore('b'), explore('c')] });
    expect(exploreFeedIndex(built, 'explore:2', 'updates')).toBe(2);
    expect(exploreFeedIndex(built, 'explore:9', 'updates')).toBe(9);
    // 非数字 → -1（`toIntOrNull` 的语义）
    expect(exploreFeedIndex(built, 'explore:abc', 'updates')).toBe(-1);
    expect(exploreFeedIndex(built, 'explore:', 'updates')).toBe(-1);
    expect(exploreFeedIndex(built, 'garbage', 'updates')).toBe(-1);
    // 不带前缀的纯数字按 Kotlin 的 `removePrefix` 原样解析
    expect(exploreFeedIndex(built, '1', 'updates')).toBe(1);
  });

  it('L118 无 feedId 时按 dimension 找第一个 `kind` 命中', () => {
    expect(src).toContain('else -> config.explore.indexOfFirst { it.kind == query.dimension.name.lowercase() }');
    const built = config({ explore: [explore('a', 'tag'), explore('b', 'updates'), explore('c', 'updates')] });
    expect(exploreFeedIndex(built, null, 'updates')).toBe(1);
    expect(exploreFeedIndex(built, null, 'UPDATES')).toBe(1);
    expect(exploreFeedIndex(built, null, 'ranking')).toBe(-1);
  });

  it('L120-121 取不到 → 「该书源未声明此发现列表」', () => {
    expect(src).toContain('?: return@withContext SourceResult.Success(com.example.discover.DiscoverPage(supported = false, notice = "该书源未声明此发现列表"))');
    expect(UNDECLARED_DISCOVER_FEED_NOTICE).toBe('该书源未声明此发现列表');
    // `"native"` 在没有任何声明时仍返回 0，但 `getOrNull(0)` 落空 → 同样是「未声明」
    expect(exploreFeedIndex(config(), 'native', 'updates')).toBe(0);
    expect(config().explore[0]).toBeUndefined();
  });

  it('L123-124 `{page}` 既可能在 url 也可能在 body 里', () => {
    expect(src).toContain('val paged = feed.rule.url.contains("{page}") || feed.rule.body?.contains("{page}") == true');
    expect(exploreRuleIsPaged({ ...createHtmlSearchRule({ url: 'u', listSelector: 'l' }), url: 'a?p={page}' })).toBe(true);
    expect(
      exploreRuleIsPaged({ ...createHtmlSearchRule({ url: 'u', listSelector: 'l' }), body: 'page={page}' }),
    ).toBe(true);
    expect(exploreRuleIsPaged(createHtmlSearchRule({ url: 'u', listSelector: 'l' }))).toBe(false);
    expect(
      exploreRuleIsPaged({ ...createHtmlSearchRule({ url: 'u', listSelector: 'l' }), body: 'no marker' }),
    ).toBe(false);
  });
});
