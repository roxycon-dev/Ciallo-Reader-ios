/**
 * Android source: `com.example.source.impl.AliceSwDiscover.kt`（160 行）→ 本文件。
 *
 * 爱丽丝书屋发现页：排行（日/周/月/总）与分类目录。
 * 列表结构在首页各栏目、`/lists/{分类id}.html`、`/other/rank_hits/order/hits*.html`
 * 和 `/all/order/update_time+desc.html` 上是同一套卡片：
 * `div.rec_rullist > ul`，其中 `li.one` 名次、`li.sev` 分类、`li.two` 书名、
 * `li.three` 最新章节、`li.four` 作者、`li.five` 字数、`li.six` 更新日期、`li.diyhot` 热度。
 *
 * 行号映射（Kotlin → TS）：
 *   L30-L44  正则 / RANK_PATH / UPDATES_PATH / RANK_RANGES → 同名模块级常量
 *   L46-L73  catalog()          → AliceSwDiscover.catalog()
 *   L76-L89  route()            → AliceSwDiscover.route()
 *   L91-L133 entries()          → AliceSwDiscover.entries()
 *   L136-L145 nextPage()        → AliceSwDiscover.nextPage()
 *   L147-L148 isRanked()        → AliceSwDiscover.isRanked()
 *   L150-L153 notice()          → AliceSwDiscover.notice()
 *   L155      withPage()        → withPage()
 *   L157-L159 epochDay()        → epochDay()
 *
 * 未移植项：
 *  - Kotlin `SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(...).time` → 本地时区零点的
 *    `Date#getTime()`；`DATE` 正则已把输入限定为 `YYYY-MM-DD`，Kotlin 的宽松解析在
 *    越界日期（如 2025-13-45）上会顺延，这里用同样的宽松 `setFullYear` 保持等价。
 *  - `toIntOrNull` / `toLongOrNull` → 完整的十进制正则 + 范围检查（JS 数字只有 53 位，
 *    `long` 用 `Number.isSafeInteger` 兜底；本站热度值远小于 2^53）。
 *  - Kotlin 直接构造 `DiscoverPage` / `DiscoverCatalog` / `DiscoverEntry` 数据类；
 *    TS 用 `@core/discover/models` 的 `discoverPage` / `discoverCatalog` / `discoverEntry`
 *    工厂补默认值（字段与 Kotlin 数据类默认值一一对应）。
 */

import {
  discoverCatalog,
  discoverEntry,
  discoverPage,
  type DiscoverCatalog,
  type DiscoverEntry,
  type DiscoverFeed,
  type DiscoverNativeCategory,
  type DiscoverPage,
  type DiscoverQuery,
} from '@core/discover/models';
import { createNovelInfo } from '../novelInfo';
import { createSearchBook } from '../searchBook';
import { parseHtmlDocument } from './jsoup';

const LIST_HREF = /\/lists\/(\d{1,3})\.html/;
const NOVEL_HREF = /\/novel\/(\d{1,9})\.html/;
const DATE = /(\d{4}-\d{2}-\d{2})/;
const CATEGORY_SUFFIX = /小说$/;

export const ALICE_SW_RANK_PATH = '/other/rank_hits/order/';
export const ALICE_SW_UPDATES_PATH = '/all/order/update_time+desc.html';

/** 排行档位与站点路径一一对应；站点只有这四档，不编造「飙升/新作」。 */
export const ALICE_SW_RANK_RANGES: ReadonlyArray<readonly [string, string]> = [
  ['日', 'hits_day.html'],
  ['周', 'hits_week.html'],
  ['月', 'hits_month.html'],
  ['总', 'hits.html'],
];

function withPage(url: string, page: number): string {
  return page <= 1 ? url : `${url}?page=${page}`;
}

/** Kotlin 名字是 `epochDay`，实际返回的是本地时区零点的毫秒时间戳。 */
function epochDay(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return null;
  try {
    const value = new Date(0);
    value.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    value.setHours(0, 0, 0, 0);
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  } catch {
    return null;
  }
}

/** Kotlin `String.toIntOrNull()`。 */
function intOf(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  if (!/^[+-]?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? value : null;
}

/** Kotlin `String.toLongOrNull()`（JS 侧用安全整数兜底）。 */
function longOf(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  if (!/^[+-]?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function trimmedOrNull(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  return text !== '' ? text : null;
}

export const AliceSwDiscover = {
  catalog(html: string, base: string): DiscoverCatalog {
    const doc = parseHtmlDocument(html);
    const feeds: DiscoverFeed[] = [
      { id: `${base}${ALICE_SW_UPDATES_PATH}`, label: '最近更新', kind: 'updates' },
    ];
    for (const [label, path] of ALICE_SW_RANK_RANGES) {
      feeds.push({ id: `${base}${ALICE_SW_RANK_PATH}${path}`, label: `${label}榜`, kind: 'ranking' });
    }
    const seen = new Set<string>();
    const categories: DiscoverNativeCategory[] = [];
    for (const anchor of doc.select('a[href]')) {
      const match = LIST_HREF.exec(anchor.attr('href'));
      if (match === null) continue;
      const label = anchor.text().trim().replace(CATEGORY_SUFFIX, '').trim();
      if (label === '' || label.length > 6) continue;
      const id = `${base}/lists/${match[1]!}.html`;
      if (!seen.has(id)) {
        seen.add(id);
        categories.push({ id, label, group: '分类' });
      }
    }
    return discoverCatalog({
      feeds,
      categories,
      declared: true,
      explicit: true,
      capabilities: {
        ranking: ALICE_SW_RANK_RANGES.map(([label]) => label),
        updates: ['最新'],
      },
    });
  },

  /** 把维度和档位翻译成站点地址；返回 null 表示该维度确实没有数据。 */
  route(base: string, catalog: DiscoverCatalog, query: DiscoverQuery): string | null {
    const cursor = query.cursor;
    if (cursor !== null && cursor.trim() !== '') return cursor;
    const feedId = query.feedId;
    if (feedId !== null && feedId !== 'native') {
      const feed = catalog.feeds.find((item) => item.id === feedId);
      if (feed !== undefined) return feed.id;
    }
    const wanted = [...(query.categoryId !== null ? [query.categoryId] : []), ...query.categoryIds];
    let category: DiscoverNativeCategory | null = null;
    for (const id of wanted) {
      const found = catalog.categories.find((item) => item.id === id);
      if (found !== undefined) {
        category = found;
        break;
      }
    }
    if (category !== null) return withPage(category.id, query.page);
    if (query.dimension === 'RANKING') {
      const range = ALICE_SW_RANK_RANGES.find(([label]) => label === query.range);
      return range !== undefined ? `${base}${ALICE_SW_RANK_PATH}${range[1]}` : null;
    }
    if (query.dimension === 'UPDATES') return withPage(`${base}${ALICE_SW_UPDATES_PATH}`, query.page);
    return null;
  },

  entries(html: string, sourceId: string, ranked: boolean, offset = 0): DiscoverEntry[] {
    const doc = parseHtmlDocument(html);
    const rows: DiscoverEntry[] = [];
    for (const item of doc.select('div.rec_rullist > ul')) {
      const titleLink = item.selectFirst('li.two a[href]');
      if (titleLink === null) continue;
      const bookId = NOVEL_HREF.exec(titleLink.attr('href'))?.[1];
      if (bookId === undefined) continue;
      const title = titleLink.text().trim();
      if (title === '') continue;
      const rank = intOf(item.selectFirst('li.one')?.text());
      const category = trimmedOrNull(
        (item.selectFirst('li.sev')?.text() ?? '').replace(CATEGORY_SUFFIX, '').trim(),
      );
      const latest = trimmedOrNull(item.selectFirst('li.three')?.text());
      const author = trimmedOrNull(item.selectFirst('li.four')?.text());
      const wordCount = trimmedOrNull(item.selectFirst('li.five')?.text());
      const date = DATE.exec(item.selectFirst('li.six')?.text() ?? '')?.[1] ?? null;
      const clicks = longOf(item.selectFirst('li.diyhot')?.text());
      rows.push(
        discoverEntry(
          createSearchBook({
            id: bookId,
            sourceId,
            title,
            author: author ?? '未知作者',
            format: 'epub',
            language: '中文',
            novelInfo: createNovelInfo({
              category,
              latestChapter: latest,
              updatedAt: date,
              wordCount,
              translation: '中文',
            }),
          }),
          {
            updatedAt: date === null ? null : epochDay(date),
            latestChapter: latest,
            clicks: clicks !== null && clicks >= 0 ? clicks : null,
            rank: ranked ? (rank ?? offset + rows.length + 1) : null,
            nativeOrder: offset + rows.length,
            native: true,
            origin: category,
          },
        ),
      );
    }
    // Kotlin `distinctBy { it.book.id }`：保留首次出现。
    const seen = new Set<string>();
    return rows.filter((entry) => {
      if (seen.has(entry.book.id)) return false;
      seen.add(entry.book.id);
      return true;
    });
  },

  /** `?page=N` 翻页；排行页没有下一页，站外地址一律丢弃。 */
  nextPage(html: string, current: string): string | null {
    const doc = parseHtmlDocument(html);
    const anchor = doc
      .select('a[href]')
      .find((item) => item.text().trim() === '下一页' || item.attr('rel').toLowerCase() === 'next');
    if (anchor === undefined) return null;
    let here: URL;
    try {
      here = new URL(current);
    } catch {
      return null;
    }
    let next: URL;
    try {
      next = new URL(anchor.attr('href').trim(), here);
    } catch {
      return null;
    }
    if (next.href === here.href || next.host !== here.host) return null;
    return next.toString();
  },

  isRanked(query: DiscoverQuery): boolean {
    return query.dimension === 'RANKING' || (query.feedId !== null && query.feedId.includes('rank_hits'));
  },

  notice(): DiscoverPage {
    return discoverPage({
      supported: false,
      notice: '爱丽丝书屋只提供排行与分类目录，没有该维度的数据',
    });
  },
};
