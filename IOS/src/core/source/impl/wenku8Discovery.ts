import type { FileSystemApi } from '@platform/interfaces';
import { catalogRanges, discoverCatalog, discoverEntry, discoverPage, parseDiscoverDate, type DiscoverCatalog, type DiscoverQuery } from '@core/discover/models';
import type { SearchBook } from '../searchBook';
import { createNovelInfo } from '../novelInfo';
import { ParseError } from '../sourceException';
import { isJsonObject, optInt, optJsonArray, optLong, optString, type JsonObject } from './jsonSupport';
import { parseHtmlDocument } from './jsoup';

export function wenkuHeatGrade(value: string, growth: boolean): number {
  const text = growth ? value.includes('：') ? value.slice(value.indexOf('：') + 1) : '' : value.split('级')[0]!;
  const level = /S{1,3}|[A-E]/i.exec(text)?.[0].toUpperCase(); return level ? ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'].indexOf(level) : -1;
}
const splitTags = (value: string): string[] => parseHtmlDocument(value).text().split(/[\s\u00a0]+/u).filter(Boolean);
const tags = (row: JsonObject): string[] => (optJsonArray(row, 'tags') ?? []).flatMap((tag) => typeof tag === 'string' ? splitTags(tag) : []);

/** Sort a complete public metadata index; the server ignores unknown sort parameters. */
export class Wenku8Discovery {
  private indexValue: { at: number; value: Promise<JsonObject[]> } | null = null;
  private catalogValue: { at: number; value: DiscoverCatalog } | null = null;
  private readonly ttl = 3_600_000;
  constructor(private readonly home: string, private readonly json: (url: string) => Promise<JsonObject>, private readonly book: (row: JsonObject) => SearchBook, private readonly fs?: FileSystemApi) {}
  private async cachePath(): Promise<string> { const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.home))); return `cache/wenku8-discover-${[...digest].map((b) => b.toString(16).padStart(2, '0')).join('')}.json`; }
  async catalog(): Promise<DiscoverCatalog> {
    if (this.catalogValue && Date.now() - this.catalogValue.at < this.ttl) return this.catalogValue.value;
    const data = await this.json(new URL('/api/categories', this.home).toString()), rows = optJsonArray(data, 'tags'); if (!rows) throw new ParseError('文库未返回标签目录');
    const value = discoverCatalog({ feeds: [{ id: 'native', label: '文库热度推荐', kind: null }, { id: 'updates', label: '文库更新', kind: 'updates' }, { id: 'heat', label: '文库热度分级榜', kind: 'ranking' }],
      categories: [...new Set(rows.filter(isJsonObject).flatMap((row) => splitTags(optString(row, 'name') ?? '')))].map((label) => ({ id: label, label, group: '文库标签' })), declared: true, explicit: true, dated: true, capabilities: { updates: ['最新'], ranking: ['热门', '飙升', '完结'] } });
    this.catalogValue = { at: Date.now(), value }; return value;
  }
  private index(): Promise<JsonObject[]> {
    if (this.indexValue && Date.now() - this.indexValue.at < this.ttl) return this.indexValue.value;
    const value = this.loadIndex().catch((error: unknown) => { this.indexValue = null; throw error; }); this.indexValue = { at: Date.now(), value }; return value;
  }
  private async loadIndex(): Promise<JsonObject[]> {
    const now = Date.now(), path = this.fs ? await this.cachePath() : null;
    if (this.fs && path) try {
      const bytes = await this.fs.readFile(path); if (bytes.length <= 16 * 1024 * 1024) { const saved: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (isJsonObject(saved) && saved['owner'] === this.home && typeof saved['at'] === 'number' && now - saved['at'] >= 0 && now - saved['at'] < this.ttl && Array.isArray(saved['items']) && saved['items'].length > 0 && saved['items'].length <= 7200 && saved['items'].every(isJsonObject)) return saved['items'];
      }
    } catch { /* Missing or expired metadata cache. */ }
    const list = (page: number): Promise<JsonObject> => { const url = new URL('/api/books', this.home); url.searchParams.set('page', String(page)); url.searchParams.set('limit', '60'); return this.json(url.toString()); };
    const first = await list(1), count = optInt(first, 'pages'); if (count < 1 || count > 120) throw new ParseError('文库目录规模已变化，请更新书源适配');
    const rows = (optJsonArray(first, 'items') ?? []).filter(isJsonObject), pages: JsonObject[][] = new Array(count - 1); let next = 2;
    await Promise.all(Array.from({ length: Math.min(4, count - 1) }, async () => { while (next <= count) { const page = next++; const items = optJsonArray(await list(page), 'items'); if (!items) throw new ParseError('文库目录页面不完整'); pages[page - 2] = items.filter(isJsonObject); } }));
    const distinct = [...new Map([...rows, ...pages.flat()].map((row) => [optLong(row, 'id'), row])).values()];
    if (distinct.length !== optInt(first, 'total')) throw new ParseError('文库目录在加载时发生变化，请刷新后重试');
    if (this.fs && path) { const bytes = new TextEncoder().encode(JSON.stringify({ owner: this.home, at: now, items: distinct })); if (bytes.length <= 16 * 1024 * 1024) await this.fs.writeFile(path, bytes).catch(() => {}); }
    return distinct;
  }
  async discover(q: DiscoverQuery) {
    const catalog = await this.catalog(); if (q.feedId === null && !catalogRanges(catalog, q.dimension).includes(q.range)) return discoverPage({ supported: false, catalog });
    const selected = new Set([...(q.categoryId ? [q.categoryId] : []), ...q.categoryIds]); if ([...selected].some((id) => !catalog.categories.some((c) => c.id === id))) throw new ParseError('文库标签已变化，请重新选择');
    const updates = q.feedId === 'updates' || q.feedId === null && q.dimension === 'UPDATES', growth = q.feedId === null && q.range === '飙升';
    const rows = (await this.index()).filter((row) => (!selected.size || tags(row).some((tag) => selected.has(tag))) && (q.range !== '完结' || q.feedId !== null || row['status'] === 'completed'));
    const heat = (row: JsonObject, rising: boolean): number => wenkuHeatGrade(optString(row, 'heat') ?? '', rising);
    const date = (row: JsonObject): number => parseDiscoverDate(optString(row, 'updatedAt')) ?? -Infinity;
    rows.sort((a, b) => updates ? (date(b) - date(a) || optLong(b, 'id') - optLong(a, 'id')) : q.feedId === 'native' ? (heat(b, false) * 2 + heat(b, true) - heat(a, false) * 2 - heat(a, true) || (optString(b, 'updatedAt') ?? '').localeCompare(optString(a, 'updatedAt') ?? '') || optLong(b, 'id') - optLong(a, 'id')) : (heat(b, growth) - heat(a, growth) || heat(b, !growth) - heat(a, !growth) || optLong(b, 'id') - optLong(a, 'id')));
    const origin = updates ? '文库更新日期' : q.feedId === 'native' ? '文库热度与上升等级推荐' : growth ? '文库热度上升等级' : '文库热度等级';
    const entries = rows.slice((q.page - 1) * 24, q.page * 24).map((row, i) => { const book = this.book(row); return discoverEntry({ ...book, novelInfo: createNovelInfo({ ...book.novelInfo, tags: tags(row) }) }, { updatedAt: parseDiscoverDate(optString(row, 'updatedAt')), nativeOrder: q.offset + i, native: true, origin, statistic: optString(row, 'heat') || null }); });
    return discoverPage({ entries, hasMore: q.page * 24 < rows.length, catalog, native: true, notice: updates ? '按文库公开更新日期整理' : '按文库公开热度及上升等级整理；同等级不代表精确点击名次' });
  }
}
