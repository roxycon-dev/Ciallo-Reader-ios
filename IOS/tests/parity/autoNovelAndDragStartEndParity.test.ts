/**
 * autoNovelAndDragStartEndParity.test.ts
 *   ├ `source/impl/AutoNovelDiscovery.kt`（83 行）→ `@core/source/impl/autoNovelDiscovery`
 *   └ `eu/wewox/pagecurl/page/DragStartEnd.kt`（83 行）→ `@core/pagecurl/pageCurl` 的
 *       `dragStartEndConfig` / `newEdgeCreator`
 *
 * 两个文件都有实现，缺的都是**读原文的测试**。本轮的实测抓出 `AutoNovelDiscovery` 三处偏差：
 *
 *   ① `type` / `status` 两个**请求参数**在 Kotlin 里是 `tr(...)`（L52/L57）—— 界面语言切到英文后
 *      发出去的是 "Genre" / "Completed"/"All"；端口写死中文，英文用户会拿到一份被服务端
 *      按中文值筛过的榜单。
 *   ② `origin` 的前半段同样是 `tr("成为小说家")`（L73），后半段 `"Kakuyomu"` 是裸字面量。
 *   ③ `statistic` 用 `takeIf(String::isNotBlank)`（L74）—— 纯空白串要落 null，
 *      而 `'   ' || null` 会把 `'   '` 当成有值。
 */
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { setAppLanguage } from '@core/i18n/locale';
import { AutoNovelDiscovery } from '@core/source/impl/autoNovelDiscovery';
import { createSearchBook } from '@core/source/searchBook';
import { createNovelInfo } from '@core/source/novelInfo';
import type { JsonObject } from '@core/source/impl/jsonSupport';
import type { DiscoverQuery } from '@core/discover/models';
import { dragStartEndConfig, newEdgeCreator } from '@core/pagecurl/pageCurl';

import { androidReference } from '../helpers/androidReference';

/**
 * 读 Kotlin 原文。`com/example/**` 之外的包（`eu/wewox/**`、`me/**`、`net/**`）按原路径读。
 */
function kt(rel: string): string {
  const under = /^(eu|me|net)\//.test(rel) ? rel : `com/example/${rel}`;
  return readFileSync(androidReference(`app/src/main/java/${under}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(rel, 'utf8');
}

const DISCOVERY_KT = 'source/impl/AutoNovelDiscovery.kt';
const DRAG_KT = 'eu/wewox/pagecurl/page/DragStartEnd.kt';

afterEach(() => {
  setAppLanguage('zh');
});

/* ══════════════════════════════════════════════════════════════════════════════
   ① AutoNovelDiscovery.kt L19-35 两张流派表与 catalog
   ══════════════════════════════════════════════════════════════════════════════ */

function bookOf(id: string, title = `书 ${id}`) {
  return createSearchBook({ id, sourceId: 'auto_novel', title, author: '作者', novelInfo: createNovelInfo() });
}

/** 一个只回固定 items 的端口，并记录请求过的 URL。 */
function ports(items: readonly unknown[], pageNumber?: number) {
  const urls: string[] = [];
  return {
    urls,
    discovery: new AutoNovelDiscovery(
      'https://novelia.example',
      async (url: string): Promise<JsonObject> => {
        urls.push(url);
        return { items: [...items], ...(pageNumber === undefined ? {} : { pageNumber }) } as JsonObject;
      },
      (id: string) => bookOf(id),
    ),
  };
}

const row = (providerId: string, novelId: string, extra: Record<string, unknown> = {}) => ({
  providerId,
  novelId,
  ...extra,
});

/** `DiscoverQuery` 的 `dimension` 是联合类型，测试里按 id 构造。 */
const query = (patch: Partial<DiscoverQuery> = {}): DiscoverQuery => ({
  dimension: 'RANKING',
  range: '热门',
  page: 1,
  offset: 0,
  cursor: null,
  feedId: null,
  categoryId: null,
  includeAdult: true,
  standardCategories: [],
  categoryIds: [],
  status: null,
  ...patch,
});

describe('AutoNovelDiscovery.kt L19-22 两个流派表', () => {
  const src = kt(DISCOVERY_KT);

  it('syosetu 19 个、kakuyomu 12 个，顺序与原文逐项一致', () => {
    const ts = repoText('src/core/source/impl/autoNovelDiscovery.ts');
    const syosetu = [...src.matchAll(/"(恋爱：异世界|恋爱：现实世界|幻想：高幻想|幻想：低幻想|文学：纯文学|文学：人性剧|文学：历史|文学：推理|文学：恐怖|文学：动作|文学：喜剧|科幻：VR游戏|科幻：宇宙|科幻：空想科学|科幻：惊悚|其他：童话|其他：诗|其他：散文|其他：其他)"/g)].map((m) => m[1]);
    expect(syosetu).toHaveLength(19);
    for (const genre of syosetu) expect(ts).toContain(`'${genre}'`);
    const kakuyomu = ['异世界幻想', '现代幻想', '科幻', '恋爱', '浪漫喜剧', '现代戏剧', '恐怖', '推理', '散文·纪实', '历史·时代·传奇', '创作论·评论', '诗·童话·其他'];
    expect(src).toContain('val kakuyomu = listOf("异世界幻想", "现代幻想", "科幻", "恋爱", "浪漫喜剧", "现代戏剧", "恐怖", "推理", "散文·纪实", "历史·时代·传奇", "创作论·评论", "诗·童话·其他")');
    for (const genre of kakuyomu) expect(ts).toContain(`'${genre}'`);
    // `·` 是中点 U+00B7，不是全角间隔号
    expect(kakuyomu[8]).toBe('散文·纪实');
  });

  it('L29-35 catalog：两个 ranking feed + 19+12 个分类 + capabilities', () => {
    expect(src).toContain('DiscoverFeed("syosetu", "成为小说家·综合日榜", "ranking")');
    expect(src).toContain('DiscoverFeed("kakuyomu", "Kakuyomu·综合日榜", "ranking")');
    expect(src).toContain('DiscoverNativeCategory("syosetu|$it", it, "成为小说家·流派")');
    expect(src).toContain('DiscoverNativeCategory("kakuyomu|$it", it, "Kakuyomu·流派")');
    expect(src).toContain('declared = true, explicit = true, dated = true,');
    expect(src).toContain('capabilities = mapOf("ranking" to listOf("热门", "完结"))');
    const discovery = ports([]).discovery;
    expect(discovery.catalog.feeds).toEqual([
      { id: 'syosetu', label: '成为小说家·综合日榜', kind: 'ranking' },
      { id: 'kakuyomu', label: 'Kakuyomu·综合日榜', kind: 'ranking' },
    ]);
    expect(discovery.catalog.categories).toHaveLength(31);
    expect(discovery.catalog.categories[0]).toEqual({ id: 'syosetu|恋爱：异世界', label: '恋爱：异世界', group: '成为小说家·流派' });
    expect(discovery.catalog.categories[19]).toEqual({ id: 'kakuyomu|异世界幻想', label: '异世界幻想', group: 'Kakuyomu·流派' });
    expect(discovery.catalog.declared).toBe(true);
    expect(discovery.catalog.explicit).toBe(true);
    expect(discovery.catalog.dated).toBe(true);
    expect(discovery.catalog.capabilities).toEqual({ ranking: ['热门', '完结'] });
  });

  it('L28 游客提示文案逐字（含「HTTP 401」）', () => {
    expect(src).toContain('val guestListNotice = "Novelia 已关闭游客列表接口（HTTP 401），推荐与更新需登录；公开日榜仍可查看"');
    expect(repoText('src/core/source/impl/autoNovelDiscovery.ts')).toContain(
      "'Novelia 已关闭游客列表接口（HTTP 401），推荐与更新需登录；公开日榜仍可查看'",
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② AutoNovelDiscovery.kt L36-46 三道门与路由
   ══════════════════════════════════════════════════════════════════════════════ */

describe('AutoNovelDiscovery.kt L36-46 三道门与路由过滤', () => {
  const src = kt(DISCOVERY_KT);

  it('L37-39 非榜单请求直接给游客提示，且**不发请求**', async () => {
    expect(src).toContain('val ranking = q.categoryId != null || q.feedId in setOf("syosetu", "kakuyomu") ||');
    const { urls, discovery } = ports([]);
    const page = await discovery.discover(query({ dimension: 'UPDATES', range: '最新' }));
    expect(page.supported).toBe(false);
    expect(page.notice).toBe('Novelia 已关闭游客列表接口（HTTP 401），推荐与更新需登录；公开日榜仍可查看');
    expect(urls).toEqual([]);
    // 指定分类时**即使** dimension 是 UPDATES 也算榜单（但 L40 的门要求 feedId 非 null 才放行）
    const withCategory = ports([row('syosetu', 'n1')]);
    await withCategory.discovery.discover(query({ dimension: 'UPDATES', feedId: 'syosetu', categoryId: 'syosetu|恋爱：异世界' }));
    expect(withCategory.urls).toHaveLength(1);
  });

  it('L40 未指定 feed 且该范围不受支持 → 不支持（不发请求）', async () => {
    expect(src).toContain('if (q.feedId == null && !catalog.supports(q.dimension, q.range)) return@coroutineScope DiscoverPage(supported = false, catalog = catalog)');
    const { urls, discovery } = ports([]);
    const page = await discovery.discover(query({ range: '最新' }));
    expect(page.supported).toBe(false);
    expect(urls).toEqual([]);
    // 「完结」在 capabilities 里 → 受支持
    const okPorts = ports([]);
    const supported = await okPorts.discovery.discover(query({ range: '完结' }));
    expect(supported.supported).toBe(true);
  });

  it('L41-42 未知分类 → 「轻小说分类已变化，请重新选择」', async () => {
    expect(src).toContain('require(categories.all { id -> catalog.categories.any { it.id == id } }) { tr("轻小说分类已变化，请重新选择") }');
    const { discovery } = ports([]);
    await expect(discovery.discover(query({ categoryId: 'syosetu|不存在的流派' }))).rejects.toThrow(
      '轻小说分类已变化，请重新选择',
    );
  });

  it('L43-46 路由：分类优先；否则按 feedId；再否则两条都来', async () => {
    expect(src).toContain('val routes = categories.ifEmpty {');
    const byCategory = ports([row('syosetu', 'n1')]);
    await byCategory.discovery.discover(query({ categoryId: 'kakuyomu|科幻' }));
    expect(byCategory.urls).toHaveLength(1);
    expect(byCategory.urls[0]).toContain('/api/novel/rank/kakuyomu');

    const byFeed = ports([row('syosetu', 'n1')]);
    await byFeed.discovery.discover(query({ feedId: 'syosetu' }));
    expect(byFeed.urls).toHaveLength(1);

    const both = ports([row('syosetu', 'n1')]);
    await both.discovery.discover(query());
    expect(both.urls).toHaveLength(2);
    expect(both.urls.map((u) => u.split('?')[0])).toEqual([
      'https://novelia.example/api/novel/rank/syosetu',
      'https://novelia.example/api/novel/rank/kakuyomu',
    ]);
  });

  it('L46 翻页或「完结 + 无 feed」时**整个剔除** kakuyomu', async () => {
    expect(src).toContain('val effectiveRoutes = routes.filterNot { (q.page > 1 || (q.range == "完结" && q.feedId == null)) && it.startsWith("kakuyomu") }');
    const page2 = ports([row('syosetu', 'n1')]);
    await page2.discovery.discover(query({ page: 2 }));
    expect(page2.urls.map((u) => u.split('?')[0])).toEqual(['https://novelia.example/api/novel/rank/syosetu']);

    const completed = ports([row('syosetu', 'n1')]);
    await completed.discovery.discover(query({ range: '完结' }));
    expect(completed.urls).toHaveLength(1);

    // 显式点了 kakuyomu feed 时**不**剔除（feedId 不为 null）
    const explicit = ports([row('kakuyomu', 'k1')]);
    await explicit.discovery.discover(query({ range: '完结', feedId: 'kakuyomu' }));
    expect(explicit.urls).toHaveLength(1);
    expect(explicit.urls[0]).toContain('kakuyomu');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ AutoNovelDiscovery.kt L48-58 请求参数
   ══════════════════════════════════════════════════════════════════════════════ */

describe('AutoNovelDiscovery.kt L48-58 URL 参数', () => {
  const src = kt(DISCOVERY_KT);

  it('L51-55 syosetu：type / page / genre / range / status 五个参数', async () => {
    expect(src).toContain('addQueryParameter("type", if (genre.isEmpty()) "综合" else tr("流派"))');
    expect(src).toContain('addQueryParameter("page", q.page.toString())');
    expect(src).toContain('if (genre.isNotEmpty()) addQueryParameter("genre", genre)');
    expect(src).toContain('addQueryParameter("range", "每日")');
    const { urls, discovery } = ports([row('syosetu', 'n1')]);
    await discovery.discover(query({ feedId: 'syosetu', categoryId: 'syosetu|恋爱：异世界', page: 3 }));
    const url = new URL(urls[0]!);
    expect(url.pathname).toBe('/api/novel/rank/syosetu');
    expect(url.searchParams.get('type')).toBe('流派');
    expect(url.searchParams.get('page')).toBe('3');
    expect(url.searchParams.get('genre')).toBe('恋爱：异世界');
    expect(url.searchParams.get('range')).toBe('每日');
    expect(url.searchParams.get('status')).toBe('全部');
  });

  it('L52 流派为空时 `type` 传「综合」；L56 kakuyomu 的 `genre` 补「综合」', async () => {
    expect(src).toContain('else if (provider == "kakuyomu") addQueryParameter("genre", "综合")');
    const pure = ports([row('syosetu', 'n1')]);
    await pure.discovery.discover(query({ feedId: 'syosetu' }));
    expect(new URL(pure.urls[0]!).searchParams.get('type')).toBe('综合');

    const kaku = ports([row('kakuyomu', 'k1')]);
    await kaku.discovery.discover(query({ feedId: 'kakuyomu' }));
    const kakuUrl = new URL(kaku.urls[0]!);
    expect(kakuUrl.searchParams.get('genre')).toBe('综合');
    // kakuyomu 没有 type / page 两个参数
    expect(kakuUrl.searchParams.has('type')).toBe(false);
    expect(kakuUrl.searchParams.has('page')).toBe(false);
  });

  it('L57 `status` 只有 syosetu 认「完结」—— kakuyomu 一律「全部」', async () => {
    expect(src).toContain('addQueryParameter("status", if (q.range == "完结" && provider == "syosetu") tr("完结") else tr("全部"))');
    const syosetu = ports([row('syosetu', 'n1')]);
    await syosetu.discovery.discover(query({ feedId: 'syosetu', range: '完结' }));
    expect(new URL(syosetu.urls[0]!).searchParams.get('status')).toBe('完结');
    const kakuyomu = ports([row('kakuyomu', 'k1')]);
    await kakuyomu.discovery.discover(query({ feedId: 'kakuyomu', range: '完结' }));
    expect(new URL(kakuyomu.urls[0]!).searchParams.get('status')).toBe('全部');
  });

  it('`type` / `status` 走 `tr(...)`：英文界面下请求值也要变', async () => {
    try {
      setAppLanguage('en');
      const { urls, discovery } = ports([row('syosetu', 'n1')]);
      await discovery.discover(query({ feedId: 'syosetu', categoryId: 'syosetu|恋爱：异世界', range: '完结' }));
      const params = new URL(urls[0]!).searchParams;
      // 三个值得过词表；具体英文串由词表决定，这里只钉「不是中文」
      expect(params.get('type')).not.toBe('流派');
      expect(params.get('status')).not.toBe('完结');
    } finally {
      setAppLanguage('zh');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ AutoNovelDiscovery.kt L61-77 逐条筛选与富集
   ══════════════════════════════════════════════════════════════════════════════ */

describe('AutoNovelDiscovery.kt L61-77 逐条筛选', () => {
  const src = kt(DISCOVERY_KT);

  it('L65 provider 白名单五个 + id 正则 `[A-Za-z0-9_-]{1,100}`', async () => {
    expect(src).toContain('if (provider !in setOf("syosetu", "kakuyomu", "novelup", "hameln", "alphapolis") || !id.matches(Regex("[A-Za-z0-9_-]{1,100}"))) return@mapNotNull null');
    const { discovery } = ports([
      row('syosetu', 'ok-1'),
      row('kakuyomu', 'ok_2'),
      row('novelup', 'ok3'),
      row('hameln', 'ok4'),
      row('alphapolis', 'ok5'),
      row('kakuyomu', 'bad id'), // 空格
      row('kakuyomu', 'bad/id'), // 斜杠
      row('evil', 'ok6'), // provider 不在白名单
      row('kakuyomu', 'a'.repeat(101)), // 超 100
    ]);
    const page = await discovery.discover(query({ feedId: 'syosetu' }));
    expect(page.entries.map((entry) => entry.book.id)).toEqual([
      'syosetu/ok-1',
      'kakuyomu/ok_2',
      'novelup/ok3',
      'hameln/ok4',
      'alphapolis/ok5',
    ]);
  });

  it('L67 标题空（含纯空白）→ 丢弃', async () => {
    expect(src).toContain('if (b.title.isBlank()) return@mapNotNull null');
    const discovery = new AutoNovelDiscovery(
      'https://novelia.example',
      async () => ({ items: [row('syosetu', 'a'), row('syosetu', 'b')] }),
      (id: string) => createSearchBook({ id, sourceId: 'x', title: id.endsWith('/b') ? '   ' : '书名', author: 'a' }),
    );
    const page = await discovery.discover(query({ feedId: 'syosetu' }));
    expect(page.entries.map((entry) => entry.book.id)).toEqual(['syosetu/a']);
  });

  it('L70-71 流派并进 tags（去重）；完结 + syosetu 时 status 改「已完结」', async () => {
    expect(src).toContain('tags = (b.novelInfo.tags + listOfNotNull(genre)).distinct()');
    expect(src).toContain('status = if (completed) tr("已完结") else b.novelInfo.status');
    const discovery = new AutoNovelDiscovery(
      'https://novelia.example',
      async () => ({ items: [row('syosetu', 'a')] }),
      (id: string) => createSearchBook({ id, sourceId: 'x', title: '书名', author: 'a',
        novelInfo: createNovelInfo({ tags: ['恋爱：异世界', '已有'], status: '连载中' }) }),
    );
    const page = await discovery.discover(query({ feedId: 'syosetu', categoryId: 'syosetu|恋爱：异世界', range: '完结' }));
    expect(page.entries[0]?.book.novelInfo?.tags).toEqual(['恋爱：异世界', '已有']);
    expect(page.entries[0]?.book.novelInfo?.status).toBe('已完结');

    // 连载中 + 热门 → 保持原 status
    const relaxed = new AutoNovelDiscovery(
      'https://novelia.example',
      async () => ({ items: [row('syosetu', 'a')] }),
      (id: string) => createSearchBook({ id, sourceId: 'x', title: '书名', author: 'a',
        novelInfo: createNovelInfo({ status: '连载中' }) }),
    );
    const kept = await relaxed.discover(query({ feedId: 'syosetu' }));
    expect(kept.entries[0]?.book.novelInfo?.status).toBe('连载中');
  });

  it('L72 `updatedAt = updateAt * 1000`，且只在 > 0 时给值', async () => {
    expect(src).toContain('updatedAt = o.optLong("updateAt").takeIf { it > 0 }?.times(1000)');
    const { discovery } = ports([
      row('syosetu', 'a', { updateAt: 1_700_000_000 }),
      row('syosetu', 'b', { updateAt: 0 }),
      row('syosetu', 'c', {}),
    ]);
    const page = await discovery.discover(query({ feedId: 'syosetu' }));
    expect(page.entries[0]?.updatedAt).toBe(1_700_000_000_000);
    expect(page.entries[1]?.updatedAt).toBeNull();
    expect(page.entries[2]?.updatedAt).toBeNull();
  });

  it('L73 origin：`tr("成为小说家")`·流派日榜，其余 provider 一律 Kakuyomu', async () => {
    expect(src).toContain('origin = "${if (provider == "syosetu") tr("成为小说家") else "Kakuyomu"}·${genre ?: "综合"}日榜"');
    const { discovery } = ports([row('syosetu', 'a'), row('kakuyomu', 'b'), row('novelup', 'c')]);
    // `科幻` 是 kakuyomu 的流派；syosetu 那边叫 `科幻：VR游戏`
    const page = await discovery.discover(query({ categoryId: 'syosetu|科幻：VR游戏' }));
    // 只有一条路由，三行都来自它 —— 后两行的 provider 不是 syosetu，所以前半段是裸的 Kakuyomu
    expect(page.entries.map((entry) => entry.origin)).toEqual([
      '成为小说家·科幻：VR游戏日榜',
      'Kakuyomu·科幻：VR游戏日榜',
      'Kakuyomu·科幻：VR游戏日榜',
    ]);
    // 无流派路由 → 「综合」
    const pure = ports([row('syosetu', 'a')]);
    const purePage = await pure.discovery.discover(query({ feedId: 'syosetu' }));
    expect(purePage.entries[0]?.origin).toBe('成为小说家·综合日榜');
  });

  it('L74 `statistic = extra.takeIf(String::isNotBlank)` —— 纯空白串落 null', async () => {
    expect(src).toContain('statistic = o.optString("extra").takeIf(String::isNotBlank)');
    const { discovery } = ports([
      row('syosetu', 'a', { extra: '★4.5' }),
      row('syosetu', 'b', { extra: '   ' }),
      row('syosetu', 'c', {}),
    ]);
    const page = await discovery.discover(query({ feedId: 'syosetu' }));
    expect(page.entries[0]?.statistic).toBe('★4.5');
    expect(page.entries[1]?.statistic).toBeNull();
    expect(page.entries[2]?.statistic).toBeNull();
  });

  it('L77 hasMore：kakuyomu 恒 false；syosetu 看 pageNumber，缺省按「满 24 条」推断', async () => {
    expect(src).toContain('entries to (if (route.startsWith("kakuyomu")) false else q.page < data.optInt("pageNumber", if (items.length() == 24) q.page + 1 else q.page))');
    const kaku = ports(Array.from({ length: 30 }, (_, i) => row('kakuyomu', `k${i}`)), 9);
    expect((await kaku.discovery.discover(query({ feedId: 'kakuyomu' }))).hasMore).toBe(false);

    const explicit = ports(Array.from({ length: 3 }, (_, i) => row('syosetu', `s${i}`)), 5);
    expect((await explicit.discovery.discover(query({ feedId: 'syosetu' }))).hasMore).toBe(true);

    const full24 = ports(Array.from({ length: 24 }, (_, i) => row('syosetu', `s${i}`)));
    expect((await full24.discovery.discover(query({ feedId: 'syosetu' }))).hasMore).toBe(true);

    const short = ports(Array.from({ length: 23 }, (_, i) => row('syosetu', `s${i}`)));
    expect((await short.discovery.discover(query({ feedId: 'syosetu' }))).hasMore).toBe(false);
  });

  it('L79-80 去重 + `nativeOrder = offset + i` / `rank = offset + i + 1`', async () => {
    expect(src).toContain('val entries = results.flatMap { it.first }.distinctBy { it.book.id }.mapIndexed { i, e ->');
    expect(src).toContain('e.copy(nativeOrder = q.offset + i, rank = q.offset + i + 1) }');
    const { discovery } = ports([row('syosetu', 'a'), row('syosetu', 'a'), row('syosetu', 'b')]);
    const page = await discovery.discover(query({ feedId: 'syosetu', offset: 40 }));
    expect(page.entries.map((entry) => entry.book.id)).toEqual(['syosetu/a', 'syosetu/b']);
    expect(page.entries.map((entry) => entry.nativeOrder)).toEqual([40, 41]);
    expect(page.entries.map((entry) => entry.rank)).toEqual([41, 42]);
    expect(page.native).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ DragStartEnd.kt L36-79
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DragStartEnd.kt L36-79 两份配置与起始判定', () => {
  const src = kt(DRAG_KT);
  const interaction = {
    forward: { start: { left: 0.8, top: 0, right: 1, bottom: 1 }, end: { left: 0, top: 0, right: 0.2, bottom: 1 } },
    backward: { start: { left: 0, top: 0, right: 0.2, bottom: 1 }, end: { left: 0.8, top: 0, right: 1, bottom: 1 } },
  };

  it('L36-53 前翻的 start 是右边缘、end 是左边缘；后翻相反', () => {
    expect(src).toContain('edge = state.forward,');
    expect(src).toContain('start = state.rightEdge,');
    expect(src).toContain('end = state.leftEdge,');
    const config = dragStartEndConfig({
      width: 1000,
      height: 800,
      pointerBehavior: 'Default',
      dragInteraction: interaction,
      policy: null,
      enabledForward: true,
      enabledBackward: true,
      onChange: () => {},
    });
    expect(config.forward.start).toEqual({ first: { x: 1000, y: 0 }, second: { x: 1000, y: 800 } });
    expect(config.forward.end).toEqual({ first: { x: 0, y: 0 }, second: { x: 0, y: 800 } });
    expect(config.backward.start).toEqual({ first: { x: 0, y: 0 }, second: { x: 0, y: 800 } });
    expect(config.backward.end).toEqual({ first: { x: 1000, y: 0 }, second: { x: 1000, y: 800 } });
  });

  it('L41 / L50 `isDragSucceed = { _, end -> …EndRect.contains(end) }`', () => {
    expect(src).toContain('isDragSucceed = { _, end -> forwardEndRect.contains(end) },');
    expect(src).toContain('isDragSucceed = { _, end -> backwardEndRect.contains(end) },');
    const config = dragStartEndConfig({
      width: 1000,
      height: 800,
      pointerBehavior: 'Default',
      dragInteraction: interaction,
      policy: null,
      enabledForward: true,
      enabledBackward: true,
      onChange: () => {},
    });
    // forward 的 end 是左 20% → 松手在 (100, 400) 算成功
    expect(config.forward.isDragSucceed({ x: 0, y: 0 }, { x: 100, y: 400 })).toBe(true);
    expect(config.forward.isDragSucceed({ x: 0, y: 0 }, { x: 900, y: 400 })).toBe(false);
    // backward 的 end 是右 20%
    expect(config.backward.isDragSucceed({ x: 0, y: 0 }, { x: 900, y: 400 })).toBe(true);
    expect(config.backward.isDragSucceed({ x: 0, y: 0 }, { x: 100, y: 400 })).toBe(false);
  });

  it('L42 / L51 `onChange(+1)` / `onChange(-1)`', () => {
    expect(src).toContain('onChange = { onChange(+1) },');
    expect(src).toContain('onChange = { onChange(-1) },');
    const seen: number[] = [];
    const config = dragStartEndConfig({
      width: 1000,
      height: 800,
      pointerBehavior: 'Default',
      dragInteraction: interaction,
      policy: null,
      enabledForward: true,
      enabledBackward: true,
      onChange: (delta) => seen.push(delta),
    });
    config.forward.onChange();
    config.backward.onChange();
    expect(seen).toEqual([1, -1]);
  });

  it('L43 / L52 `release = policy?.invoke(…) ?: native` —— 没有策略时原样透传 native', () => {
    expect(src).toContain('release = { start, end, velocity, native -> releasePolicy.value?.invoke(start, end, velocity, size, native) ?: native }');
    const config = dragStartEndConfig({
      width: 1000,
      height: 800,
      pointerBehavior: 'Default',
      dragInteraction: interaction,
      policy: null,
      enabledForward: true,
      enabledBackward: true,
      onChange: () => {},
    });
    // `DragConfig.release` 是可选字段（Kotlin 的 `release` 形参可为 null，配置里恒给一个）
    expect(config.forward.release?.({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }, true)).toBe(true);
    expect(config.forward.release?.({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }, false)).toBe(false);
  });

  it('L57-60 `PointerBehavior.Default → NewEdgeCreator.Default`、`PageEdge → PageEdge`', () => {
    expect(src).toContain('PointerBehavior.Default -> NewEdgeCreator.Default()');
    expect(src).toContain('PointerBehavior.PageEdge -> NewEdgeCreator.PageEdge()');
    expect(newEdgeCreator('Default')).toBe('Default');
    expect(newEdgeCreator('PageEdge')).toBe('PageEdge');
  });

  it('L61-71 `getConfig`：起点不在两个 start 矩形里 → null；不在启用侧 → null', () => {
    expect(src).toContain('if (forwardStartRect.contains(start)) {');
    expect(src).toContain('} else if (backwardStartRect.contains(start)) {');
    expect(src).toContain('if (config != null && !config.isEnabled()) return@getConfig null');
    const config = dragStartEndConfig({
      width: 1000,
      height: 800,
      pointerBehavior: 'Default',
      dragInteraction: interaction,
      policy: null,
      enabledForward: true,
      enabledBackward: false,
      onChange: () => {},
    });
    // 右边缘 → forward；左边缘 → backward（但 backward 被禁用）
    expect(config.getConfig({ x: 950, y: 400 })).toBe(config.forward);
    expect(config.getConfig({ x: 50, y: 400 })).toBeNull();
    // 中间 → 两边都不是
    expect(config.getConfig({ x: 500, y: 400 })).toBeNull();
  });
});
