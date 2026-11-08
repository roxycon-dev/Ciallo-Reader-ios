import type { SearchBook } from '@core/source/searchBook';
import { isKnownComicAuthor } from '@core/source/comicInfo';

export const DISCOVER_DIMENSIONS = {
  UPDATES: { label: '更新', ranges: ['最新', '今日', '近 3 天', '本周'] },
  DISCUSSION: { label: '热议', ranges: ['24h', '7d', '30d'] },
  RANKING: { label: '榜单', ranges: ['热门', '飙升', '新作', '完结'] },
  CLICKS: { label: '点击', ranges: ['日', '周', '月', '总'] },
} as const;
export type DiscoverDimension = keyof typeof DISCOVER_DIMENSIONS;
export type DiscoverPartition = 'COMIC' | 'NOVEL';
export type DiscoverLayout = 'LIST' | 'GRID' | 'LARGE';
export interface DiscoverQuery {
  dimension: DiscoverDimension; range: string; page: number; cursor: string | null; offset: number;
  feedId: string | null; categoryId: string | null; includeAdult: boolean;
  standardCategories: string[]; categoryIds: string[]; status: string | null;
}
export function discoverQuery(query: Partial<DiscoverQuery> = {}): DiscoverQuery {
  return { dimension: 'UPDATES', range: '最新', page: 1, cursor: null, offset: 0, feedId: null,
    categoryId: null, includeAdult: true, standardCategories: [], categoryIds: [], status: null, ...query };
}
export interface DiscoverFeed { id: string; label: string; kind: string | null }
export interface DiscoverNativeCategory { id: string; label: string; group: string }
export interface DiscoverCatalog {
  feeds: DiscoverFeed[]; categories: DiscoverNativeCategory[]; dynamicCategories: boolean;
  explicit: boolean; declared: boolean; capabilities: Record<string, string[]>; dated: boolean; statuses: string[];
}
export function discoverCatalog(value: Partial<DiscoverCatalog> = {}): DiscoverCatalog {
  return { feeds: [], categories: [], dynamicCategories: false, explicit: false, declared: false,
    capabilities: {}, dated: false, statuses: [], ...value };
}
export function catalogRanges(catalog: DiscoverCatalog, dimension: DiscoverDimension): string[] {
  const defaults = [...DISCOVER_DIMENSIONS[dimension].ranges];
  if (!catalog.declared) return defaults;
  const ranges = catalog.capabilities[dimension.toLowerCase()] ?? [];
  return dimension === 'UPDATES' && catalog.dated && ranges.length ? defaults : ranges;
}
export interface DiscoverEntry {
  book: SearchBook; updatedAt: number | null; latestChapter: string | null; discussions: number | null;
  clicks: number | null; growth: number | null; rank: number | null; rankChange: number | null;
  newEntry: boolean; hotComment: string | null; canonicalId: string | null; nativeOrder: number | null;
  origin: string | null; subtitle: string | null; native: boolean; statistic: string | null;
}
export function discoverEntry(book: SearchBook, value: Partial<Omit<DiscoverEntry, 'book'>> = {}): DiscoverEntry {
  return { book, updatedAt: null, latestChapter: null, discussions: null, clicks: null, growth: null,
    rank: null, rankChange: null, newEntry: false, hotComment: null, canonicalId: null,
    nativeOrder: null, origin: null, subtitle: null, native: false, statistic: null, ...value };
}
export interface DiscoverPage {
  entries: DiscoverEntry[]; hasMore: boolean; supported: boolean; notice: string | null;
  nextCursor: string | null; catalog: DiscoverCatalog | null; native: boolean;
}
export function discoverPage(value: Partial<DiscoverPage> = {}): DiscoverPage {
  return { entries: [], hasMore: false, supported: true, notice: null, nextCursor: null, catalog: null, native: false, ...value };
}
export interface DiscoverWork { key: string; variants: DiscoverEntry[]; score: number }
export function discoverTags(book: SearchBook): string[] {
  return [...new Set([...(book.novelInfo?.tags ?? []), ...(book.novelInfo?.category ? [book.novelInfo.category] : []), ...(book.comicInfo?.tags ?? [])])];
}
export function normalizeIdentity(value: string): string { return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{Nd}]/gu, ''); }
export function discoverIdentity(entry: DiscoverEntry): string {
  return entry.canonicalId !== null ? `id:${entry.canonicalId}` : `title:${normalizeIdentity(entry.book.title)}|author:${normalizeIdentity(isKnownComicAuthor(entry.book.author) ? entry.book.author : '')}`;
}

function workGroups(entries: DiscoverEntry[]): DiscoverEntry[][] {
  const parents = entries.map((_, index) => index);
  const root = (index: number): number => { while (parents[index] !== index) index = parents[index]!; return index; };
  const author = (index: number): string => isKnownComicAuthor(entries[index]!.book.author) ? normalizeIdentity(entries[index]!.book.author) : '';
  const authors = entries.map((_, index) => new Set(author(index) ? [author(index)] : []));
  const canonical = entries.map((entry) => new Set(entry.canonicalId !== null ? [entry.canonicalId] : []));
  const aliases = new Map<string, number[]>();
  const ids = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    if (entry.canonicalId !== null) ids.set(entry.canonicalId, [...(ids.get(entry.canonicalId) ?? []), index]);
    for (const title of new Set([entry.book.title, ...(entry.book.comicInfo?.alternateTitles ?? [])].map(normalizeIdentity).filter(Boolean)))
      aliases.set(title, [...(aliases.get(title) ?? []), index]);
  });
  const join = (a: number, b: number, trusted = false): void => {
    const ra = root(a), rb = root(b); if (ra === rb) return;
    const aIds = canonical[ra]!, bIds = canonical[rb]!, aAuthors = authors[ra]!, bAuthors = authors[rb]!;
    if (!trusted && aIds.size && bIds.size && ![...aIds].some((id) => bIds.has(id))) return;
    if (!trusted && aAuthors.size && bAuthors.size && ![...aAuthors].some((name) => bAuthors.has(name))) return;
    parents[rb] = ra; canonical[ra] = new Set([...aIds, ...bIds]); authors[ra] = new Set([...aAuthors, ...bAuthors]);
  };
  for (const group of ids.values()) for (const index of group.slice(1)) join(group[0]!, index, true);
  for (const group of aliases.values()) {
    const known = new Set(group.map(author).filter(Boolean));
    const candidates = known.size > 1 ? group.filter((index) => author(index)) : group;
    for (let a = 0; a < candidates.length; a++) for (let b = a + 1; b < candidates.length; b++) join(candidates[a]!, candidates[b]!);
  }
  const groups = new Map<number, DiscoverEntry[]>();
  entries.forEach((entry, index) => { const key = root(index); groups.set(key, [...(groups.get(key) ?? []), entry]); });
  return [...groups.values()].map((group) => group.sort((a, b) => a.book.sourceId < b.book.sourceId ? -1 : a.book.sourceId > b.book.sourceId ? 1 : 0));
}

/** Per-source reciprocal ranks preserve equal budgets regardless of traffic/list size. */
export function mergeDiscoverEntries(entries: DiscoverEntry[], dimension: DiscoverDimension, aggregate = true): DiscoverWork[] {
  const seen = new Set<string>();
  const distinct = entries.filter((entry) => { const key = JSON.stringify([entry.book.sourceId, entry.book.id]); if (seen.has(key)) return false; seen.add(key); return true; });
  const sources = new Map<string, DiscoverEntry[]>();
  const scores = new Map<DiscoverEntry, number>();
  for (const row of distinct) sources.set(row.book.sourceId, [...(sources.get(row.book.sourceId) ?? []), row]);
  const metric = (row: DiscoverEntry): number | null => row.native ? null : dimension === 'UPDATES' ? row.updatedAt : dimension === 'DISCUSSION' ? row.discussions : dimension === 'CLICKS' ? row.clicks : row.rank === null ? null : -row.rank;
  for (const rows of sources.values()) {
    const ordered = [...rows].sort((a, b) => {
      const av = metric(a), bv = metric(b);
      if ((av === null) !== (bv === null)) return av === null ? 1 : -1;
      return (bv ?? 0) - (av ?? 0) || (a.nativeOrder ?? 2147483647) - (b.nativeOrder ?? 2147483647);
    });
    const ties = new Map<number, number>();
    ordered.forEach((row, index) => {
      const value = metric(row);
      let position = row.nativeOrder ?? index + 1;
      if (!row.native && dimension === 'RANKING' && row.rank !== null) position = row.rank;
      else if (!row.native && value !== null) {
        if (aggregate && dimension === 'UPDATES') position = index + 1;
        else { if (!ties.has(value)) ties.set(value, index + 1); position = ties.get(value)!; }
      }
      scores.set(row, 1 / (1 + 0.08 * (Math.max(1, position) - 1)));
    });
  }
  return (aggregate ? workGroups(distinct) : distinct.map((entry) => [entry])).map((variants) => {
    const bySource = new Map<string, DiscoverEntry>();
    for (const entry of variants) if (!bySource.has(entry.book.sourceId) || scores.get(entry)! > scores.get(bySource.get(entry.book.sourceId)!)!) bySource.set(entry.book.sourceId, entry);
    const rows = [...bySource.values()];
    return { key: aggregate ? rows.map(discoverIdentity).sort()[0]! : `${rows[0]!.book.sourceId}::${rows[0]!.book.id}`,
      variants: rows, score: rows.reduce((sum, row) => sum + (scores.get(row) ?? 0), 0) / Math.max(1, sources.size) };
  }).sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
export function rangeStart(range: string, now: number): number | null {
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  if (range === '近 3 天') day.setDate(day.getDate() - 2);
  else if (range === '本周' || range === '周') day.setDate(day.getDate() - (day.getDay() + 6) % 7);
  else if (range !== '今日' && range !== '日') return null;
  return day.getTime();
}
export function personalizeWorks(works: DiscoverWork[], dimension: DiscoverDimension, affinity: (work: DiscoverWork) => number): DiscoverWork[] {
  if (dimension === 'RANKING') return works;
  const result = [...works];
  for (let index = 0; index + 1 < result.length; index++) {
    const first = result[index]!, second = result[index + 1]!;
    if (second.score >= first.score * 0.92 && affinity(second) > affinity(first)) { result[index] = second; result[index + 1] = first; index++; }
  }
  return result;
}
export function parseDiscoverDate(value: string | null): number | null {
  if (!value?.trim()) return null;
  const text = value.trim().replace(/(\.\d{3})\d+(?=Z$|[+-]\d{2}:\d{2}$)/, '$1');
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:(\.\d{3}))?(Z|[+-]\d{2}:\d{2})?)?$/.exec(text);
  if (!match || (match[7] && !match[8])) return null;
  const [, y, m, d, h = '0', minute = '0', second = '0'] = match;
  const year = Number(y), month = Number(m), date = Number(d);
  if (month < 1 || month > 12 || date < 1 || Number(h) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const check = new Date(0); check.setUTCFullYear(year, month - 1, date);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) return null;
  if (!match[8]) {
    const local = new Date(0); local.setFullYear(year, month - 1, date); local.setHours(Number(h), Number(minute), Number(second), 0);
    return local.getFullYear() === year && local.getMonth() === month - 1 && local.getDate() === date && local.getHours() === Number(h) ? local.getTime() : null;
  }
  const timestamp = Date.parse(text); return Number.isFinite(timestamp) ? timestamp : null;
}
export function compactMetric(value: number | null): string {
  return value === null ? '未提供' : value >= 100_000_000 ? `${(value / 100_000_000).toFixed(1)}亿` : value >= 10_000 ? `${(value / 10_000).toFixed(1)}万` : String(value);
}
