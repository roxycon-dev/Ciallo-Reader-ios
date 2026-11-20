import { JSONObject, isPlainObject } from '@core/source/js/json';
import { JsComicMetadata } from '@core/source/js/jsComicMetadata';
import type { HtmlDomParser } from '@core/source/js/jsPlatform';
import { compactMetric, discoverCatalog, discoverEntry, discoverPage, parseDiscoverDate, rangeStart,
  type DiscoverCatalog, type DiscoverPage, type DiscoverQuery } from './models';

function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function arrayOrNull(value: unknown): unknown[] | null { return Array.isArray(value) ? value : null; }
function text(value: unknown): string | null { return value === null || value === undefined || String(value).trim() === '' || value === 'null' ? null : String(value); }
/**
 * Kotlin L40-48 `number()` 的 `is String -> value.toLongOrNull()` / L60 `toDoubleOrNull()`。
 * `Number()` 比 Java 的解析器宽（`0x10`→16、`0b101`→5、`""`→0），所以先过一道十进制字面量
 * 正则；Java 允许的结尾 `f/d` 后缀也一并接受，`NaN`/`Infinity` 由 `isFinite` 挡掉。
 */
const DECIMAL_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function decimalOrNull(raw: string | null): number | null {
  if (raw === null) return null;
  const literal = raw.trim().replace(/[dDfF]$/, '');
  if (!DECIMAL_LITERAL.test(literal)) return null;
  const parsed = Number(literal);
  return Number.isFinite(parsed) ? parsed : null;
}
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
  // Kotlin L26 `data.optJSONArray("entries") ?: data.optJSONArray("comics") ?: JSONArray()`
  // —— `optJSONArray` 对「存在但不是数组」返回 null，所以要按类型回退，不能只看 `??`。
  const raw = data.toJSON(); const rows = arrayOrNull(raw['entries']) ?? arrayOrNull(raw['comics']) ?? [];
  const native = query.feedId !== null || query.categoryId !== null || data.optBoolean('native') && query.categoryIds.length === 0;
  const start = !native && query.dimension === 'UPDATES' ? rangeStart(query.range, now) : null;
  let dated = false;
  const entries = rows.flatMap((row, index) => {
    // Kotlin L33 `row.optJSONObject("book") ?: row` —— 存在但不是对象时回退到行本身。
    const item = record(row), bookRaw = item['book'], book = isPlainObject(bookRaw) ? bookRaw : item;
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
    const growthText = firstText('growth'), growth = decimalOrNull(growthText);
    const statistic = firstText('statistic'); const statisticMatch = /^(关注|收藏)\s+(\d+)$/.exec(statistic ?? '');
    const statisticCount = statisticMatch === null ? null : Number(statisticMatch[2]);
        // Kotlin L65 `data.optString("origin").takeIf { it.isNotBlank() }`。org.json 的
    // `optString` 对**显式 JSON null** 返回字面量 "null"（缺席才是 ""），这里用 `has` 还原。
    const dataOrigin = data.has('origin') && data.opt('origin') === null ? 'null' : data.optString('origin');
    return [discoverEntry({ ...metadata, title, comicId: id, comicInfo: metadata.comicInfo ? { ...metadata.comicInfo, tags } : null }, {
      updatedAt, latestChapter: firstText('latestChapter', 'lastChapter'), discussions: discussions !== null && discussions >= 0 ? discussions : null,
      clicks: clicks !== null && clicks >= 0 ? clicks : null, growth: growth !== null && Number.isFinite(growth) ? growth : null,
      rank: rank !== null && rank >= 1 && rank <= 2147483647 ? rank : null,
      rankChange: change !== null && change >= -2147483648 && change <= 2147483647 ? change : null,
      newEntry: new JSONObject(item).optBoolean('newEntry'), hotComment: firstText('hotComment'), canonicalId: firstText('canonicalId'),
      nativeOrder: integer('nativeOrder') ?? query.offset + index + 1,
      // Kotlin L65 `text("origin") ?: data.optString("origin").takeIf { it.isNotBlank() }`
      // —— 这一层是 `optString`，显式 JSON null 会变成字面量 "null"（org.json 的既有行为）。
      origin: firstText('origin') ?? (dataOrigin.trim() === '' ? null : dataOrigin),
      subtitle: firstText('subtitle', 'subTitle'), native,
      statistic: statisticMatch !== null && statisticCount !== null && Number.isSafeInteger(statisticCount)
        ? `${statisticMatch[1]} ${compactMetric(statisticCount)}`
        : statistic,
    })];
  });
  const seen = new Set<string>();
  // Kotlin L73 `data.optJSONObject("catalog")?.let { … }` —— 非对象（数组/标量）必须当成 null。
  const catalogRaw = raw['catalog'];
  return discoverPage({ entries: entries.filter((entry) => { if (seen.has(entry.book.id)) return false; seen.add(entry.book.id); return true; }),
    hasMore: data.optBoolean('hasMore'), supported: data.optBoolean('supported', true), notice: text(raw['notice']),
    nextCursor: text(raw['nextCursor']), catalog: isPlainObject(catalogRaw) ? { ...parseJsDiscoverCatalog(new JSONObject(catalogRaw)), dated } : null, native });
}
