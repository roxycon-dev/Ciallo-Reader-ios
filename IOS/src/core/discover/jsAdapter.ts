import { JSONObject } from '@core/source/js/json';
import { JsComicMetadata } from '@core/source/js/jsComicMetadata';
import type { HtmlDomParser } from '@core/source/js/jsPlatform';
import { compactMetric, discoverCatalog, discoverEntry, discoverPage, parseDiscoverDate, rangeStart,
  type DiscoverCatalog, type DiscoverPage, type DiscoverQuery } from './models';

function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string | null { return value === null || value === undefined || String(value).trim() === '' || value === 'null' ? null : String(value); }
export function parseJsDiscoverCatalog(data: JSONObject): DiscoverCatalog {
  const raw = data.toJSON(); const capabilities: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(record(raw['capabilities']))) capabilities[key] = array(values).map(String);
  return discoverCatalog({
    feeds: array(raw['feeds']).map((row) => { const item = record(row); return { id: String(item['id'] ?? ''), label: String(item['label'] ?? ''), kind: text(item['kind']) }; }),
    categories: array(raw['categories']).map((row) => { const item = record(row); return { id: String(item['id'] ?? ''), label: String(item['label'] ?? ''), group: String(item['group'] ?? '') }; }),
    dynamicCategories: data.optBoolean('dynamicCategories'), explicit: data.optBoolean('explicit'), declared: true,
    statuses: array(raw['statuses']).map(String), capabilities,
  });
}
export function parseJsDiscoverPage(data: JSONObject, sourceId: string, query: DiscoverQuery, dom: HtmlDomParser, now = Date.now()): DiscoverPage {
  const raw = data.toJSON(); const rows = array(raw['entries'] ?? raw['comics']);
  const native = query.feedId !== null || query.categoryId !== null || data.optBoolean('native') && query.categoryIds.length === 0;
  const start = !native && query.dimension === 'UPDATES' ? rangeStart(query.range, now) : null;
  let dated = false;
  const entries = rows.flatMap((row, index) => {
    const item = record(row), book = record(item['book'] ?? item);
    const id = text(book['id'])?.trim(), title = text(book['title'])?.trim();
    if (!id || id === 'null' || id.startsWith('__') || !title) return [];
    const metadata = JsComicMetadata.book(new JSONObject(book), sourceId, id, dom);
    const firstText = (...keys: string[]): string | null => keys.map((key) => text(item[key])).find((value) => value !== null) ?? null;
    const integer = (...keys: string[]): number | null => {
      for (const key of keys) {
        const value = item[key];
        if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
        if (typeof value === 'string' && /^[+-]?\d+$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
      }
      return null;
    };
    const timestamp = integer('updatedAt', 'updateTime');
    const updatedAt = timestamp !== null && timestamp > 0 ? timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
      : parseDiscoverDate(firstText('updatedAt', 'updateTime') ?? metadata.comicInfo?.updatedAt ?? null);
    if (updatedAt !== null) dated = true;
    if (!native && query.dimension === 'UPDATES' && start !== null && (updatedAt === null || updatedAt < start || updatedAt > now)) return [];
    const rating = firstText('contentRating');
    const tags = [...new Set([...(metadata.comicInfo?.tags ?? []), ...(rating === 'erotica' || rating === 'pornographic' ? [rating] : [])])];
    const rank = integer('rank'), change = integer('rankChange');
    const discussions = integer('discussions', 'commentCount'), clicks = integer('clicks', 'viewCount', 'readCount');
    const growthText = firstText('growth'), growth = growthText === null ? null : Number(growthText);
    const statistic = firstText('statistic'); const statisticMatch = /^(关注|收藏)\s+(\d+)$/.exec(statistic ?? '');
    return [discoverEntry({ ...metadata, title, comicId: id, comicInfo: metadata.comicInfo ? { ...metadata.comicInfo, tags } : null }, {
      updatedAt, latestChapter: firstText('latestChapter', 'lastChapter'), discussions: discussions !== null && discussions >= 0 ? discussions : null,
      clicks: clicks !== null && clicks >= 0 ? clicks : null, growth: growth !== null && Number.isFinite(growth) ? growth : null,
      rank: rank !== null && rank >= 1 && rank <= 2147483647 ? rank : null,
      rankChange: change !== null && change >= -2147483648 && change <= 2147483647 ? change : null,
      newEntry: new JSONObject(item).optBoolean('newEntry'), hotComment: firstText('hotComment'), canonicalId: firstText('canonicalId'),
      nativeOrder: integer('nativeOrder') ?? query.offset + index + 1, origin: firstText('origin') ?? text(raw['origin']),
      subtitle: firstText('subtitle', 'subTitle'), native, statistic: statisticMatch ? `${statisticMatch[1]} ${compactMetric(Number(statisticMatch[2]))}` : statistic,
    })];
  });
  const seen = new Set<string>();
  return discoverPage({ entries: entries.filter((entry) => { if (seen.has(entry.book.id)) return false; seen.add(entry.book.id); return true; }),
    hasMore: data.optBoolean('hasMore'), supported: data.optBoolean('supported', true), notice: text(raw['notice']),
    nextCursor: text(raw['nextCursor']), catalog: raw['catalog'] ? { ...parseJsDiscoverCatalog(new JSONObject(record(raw['catalog']))), dated } : null, native });
}
