import type { HttpClient } from '@platform/interfaces';
import { ComicSource } from '../comicSource';
import { createComicChapter, type ComicChapter } from '../comicChapter';
import { createSourceCapabilities } from '../sourceCapabilities';
import { createSearchBook, type SearchBook } from '../searchBook';
import { createNovelInfo } from '../novelInfo';
import { createDownloadInfo } from '../downloadInfo';
import { ParseError, SourceException } from '../sourceException';
import { SourceResult, type SourceResult as Result } from '../sourceResult';
import { parseHtmlDocument } from './jsoup';
import { GuestNovelTransport } from './guestNovelTransport';
import { extractNovelParts, hasMissingNovelContent, type NovelPart } from './novelParts';
import { catalogRanges, discoverCatalog, discoverEntry, discoverPage, normalizeIdentity, type DiscoverCatalog, type DiscoverQuery } from '@core/discover/models';
import { PUBLIC_EPUB_MARKER } from './publicNovelSource';

type ObjectData = Record<string, unknown>;
const object = (value: unknown): ObjectData => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectData : {};
const objects = (value: unknown): ObjectData[] => Array.isArray(value) ? value.filter((v) => v && typeof v === 'object' && !Array.isArray(v)) as ObjectData[] : [];
const text = (data: ObjectData, ...keys: string[]): string => keys.map((key) => data[key]).find((value): value is string => typeof value === 'string' && !!value.trim()) ?? '';
function validId(id: string): string { if (!/^[0-9]{18,20}$/.test(id)) throw new ParseError('番茄小说标识无效'); return id; }
const notice = '搜索与目录来自番茄公开接口，书荒殿补充检索；正文由张老师API提供。接口可能缺章或停止服务，更新与覆盖以实际返回为准。';

/** Parse the JSON assignment as data, without executing any source-site script. */
function initialState(script: string): ObjectData {
  const marker = 'window.__INITIAL_STATE__=', start = script.indexOf('{', script.indexOf(marker) + marker.length);
  if (!script.includes(marker) || start < 0) throw new ParseError('番茄未返回分类目录');
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < script.length; i++) {
    const char = script[i];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true; else if (char === '{') depth++; else if (char === '}' && --depth === 0) return object(JSON.parse(script.slice(start, i + 1)));
  }
  throw new ParseError('番茄分类目录不完整');
}

export class FanqieSource extends ComicSource {
  readonly id = 'fanqie'; readonly name = '番茄小说（公开聚合）'; readonly home = 'https://fanqienovel.com/';
  readonly capabilities = createSourceCapabilities({ supportEbook: true, supportOnlineText: true });
  private readonly transport: GuestNovelTransport;
  private catalogCache: { at: number; value: DiscoverCatalog } | null = null;
  private readonly pageCache = new Map<string, { at: number; value: Promise<ObjectData> }>();
  constructor(options: { client: HttpClient }) { super(); this.transport = new GuestNovelTransport(options.client, this.home, this.name); }
  private async result<T>(block: () => Promise<T>): Promise<Result<T>> { try { return SourceResult.Success(await block()); } catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; return SourceResult.Error(error instanceof SourceException ? error : new ParseError(error instanceof Error ? error.message : '番茄数据读取失败')); } }
  private url(path: string, parameters: Record<string, string> = {}, home = this.home): string { const url = new URL(path, home); for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value); return url.toString(); }
  private api(action: string, parameter: string, id: string): string { return this.url('https://biek.top/api/fq.php', { action, [parameter]: validId(id) }); }
  private async json(url: string, gateway = true): Promise<ObjectData> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const data = await this.transport.json(url);
        if (gateway && ![0, 200].includes(Number(data['code'] ?? -1))) { const error = new Error('番茄接口暂时无法提供此内容，请稍后重试或换源'); if (Number(data['code'] ?? -1) !== -1) throw new ParseError(error.message); throw error; }
        return data;
      } catch (error) { if (attempt === 2 || error instanceof ParseError || error instanceof Error && error.name === 'AbortError') throw error; await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1))); }
    }
    throw new ParseError('番茄接口暂时不可用');
  }
  private book(data: ObjectData, index = false): SearchBook {
    const id = validId(text(data, index ? 'bookId' : 'book_id'));
    const title = parseHtmlDocument(text(data, index ? 'bookTitle' : 'title', 'book_name')).text();
    if (!title.trim() || title.includes('***')) throw new ParseError('番茄未返回可用书名，作品可能已下架');
    const synopsis = text(data, index ? 'bookIntro' : 'abstract');
    const status = index ? text(data, 'bookStatus') : text(data, 'creation_status') === '0' ? '已完结' : text(data, 'creation_status') === '1' ? '连载中' : '状态未知';
    return createSearchBook({ id, sourceId: this.id, title, author: text(data, index ? 'authorName' : 'author'), cover: text(data, index ? 'coverImgUrl' : 'thumb_url') || null,
      format: 'epub', language: '中文', description: synopsis, novelInfo: createNovelInfo({ synopsis, status, category: text(data, index ? 'bookType' : 'category') || null, translation: '中文网文', notice }) });
  }
  async search(keyword: string) { return this.result(async () => {
    const query = keyword.trim(); if (!query) return [];
    const direct = /^(?:https:\/\/fanqienovel\.com\/page\/)?([0-9]{18,20})\/?(?:\?.*)?$/.exec(query); if (direct) { const detail = await this.getDetail(direct[1]!); if (detail.kind === 'error') throw detail.exception; return [detail.data]; }
    const found = new Map<string, SearchBook>(); let succeeded = false, failure: unknown;
    try {
      const data = await this.json(this.url('https://novel.snssdk.com/api/novel/channel/homepage/search/search/v1/', { device_platform: 'android', parent_enterfrom: 'novel_channel_search.tab.', offset: '0', aid: '1967', q: query }));
      for (const row of objects(object(data['data'])['ret_data']).filter((row) => String(row['genre']) === '0')) { try { const book = this.book(row); found.set(book.id, book); } catch { /* Unusable result, possibly a removed work. */ } } succeeded = true;
    } catch (error) { failure = error; }
    try {
      const data = await this.json(this.url('https://www.shuhuangdian.com/api/book/search', { keyword: query, page: '1', pageSize: '20' }));
      for (const row of objects(object(data['data'])['books']).filter((row) => row['site'] === '番茄' && text(row, 'id').startsWith('fq'))) { try { const book = this.book(row, true); if (!found.has(book.id)) found.set(book.id, book); } catch { /* Incomplete secondary index entry. */ } } succeeded = true;
    } catch (error) { failure = error; }
    if (!succeeded) throw failure;
    return [...found.values()].sort((a, b) => Number(normalizeIdentity(b.title) === normalizeIdentity(query)) - Number(normalizeIdentity(a.title) === normalizeIdentity(query)));
  }); }
  async getDetail(id: string) { return this.result(async () => {
    validId(id); let book: SearchBook | null = null;
    try { const data = await this.json(this.api('detail', 'book_id', id)); const row = objects(object(data['data'])['book_infos']).find((row) => text(row, 'book_id') === id); if (row) book = this.book(row); } catch { /* Secondary public index has independent coverage. */ }
    if (!book) { const data = await this.json(this.url('https://www.shuhuangdian.com/api/book', { id: 'fq' + id })); const row = object(object(data['data'])['bookInfo']); if (row['bookId'] !== id || row['site'] !== '番茄') throw new ParseError('番茄详情归属异常'); book = this.book(row, true); }
    const toc = await this.getChapters(id); if (toc.kind === 'error') throw toc.exception;
    return { ...book, novelInfo: createNovelInfo({ ...book.novelInfo, chapterCount: toc.data.length, latestChapter: toc.data.at(-1)!.title }) };
  }); }
  async refreshNovelDetail(id: string) { return this.getDetail(id); }
  parseChapters(data: ObjectData): ComicChapter[] {
    const expected = Array.isArray(data['allItemIds']) ? data['allItemIds'].map((id) => validId(String(id))) : [];
    const rows = Array.isArray(data['chapterListWithVolume']) ? data['chapterListWithVolume'].flatMap(objects) : [];
    if (!expected.length || expected.length > 30_000 || new Set(expected).size !== expected.length || JSON.stringify(rows.map((row) => text(row, 'itemId'))) !== JSON.stringify(expected)) throw new ParseError('番茄目录为空、重复或不完整');
    return rows.map((row, order) => {
      if (!('needPay' in row) || Number(row['needPay']) !== 0 || row['isPaidPublication'] === true || row['isPaidStory'] === true) throw new ParseError('此书含付费章节，不能免登录完整下载');
      const title = text(row, 'title').trim(); if (!title) throw new ParseError('番茄章节标题缺失');
      return createComicChapter({ id: `${this.home}reader/${validId(text(row, 'itemId'))}`, title, volume: text(row, 'volume_name') || null, order });
    });
  }
  async getChapters(id: string) { return this.result(async () => this.parseChapters(object((await this.json(this.url('/api/reader/directory/detail', { bookId: validId(id) }), false))['data']))); }
  parseParts(data: ObjectData): NovelPart[] {
    if (![0, 200].includes(Number(data['code'] ?? -1))) throw new ParseError('番茄正文接口暂时不可用');
    const html = text(data, 'content') || text(object(data['data']), 'content');
    const doc = parseHtmlDocument(html); if (doc.select('script,style,iframe,canvas,img').length) throw new ParseError('番茄返回了不支持的正文格式');
    const root = doc.selectFirst('body') ?? doc;
    const parts = extractNovelParts(root, this.home), lines = parts.filter((part) => part.kind === 'text').flatMap((part) => part.value.split(/\r?\n/)).map((line) => line.trim()).filter(Boolean), plain = lines.join('\n\n');
    if (!plain || hasMissingNovelContent(plain) || ['获取内容失败', '请登录后阅读', '本章未完', '购买本章'].some((marker) => plain.includes(marker))) throw new ParseError('番茄章节为空、缺失或未完整公开，未保存不完整正文');
    return lines.map((value) => ({ kind: 'text', value }));
  }
  async getNovelParts(raw: string): Promise<NovelPart[]> {
    const url = new URL(raw); if (url.origin !== new URL(this.home).origin || url.username || url.password || url.search || url.hash || !/^\/reader\/[0-9]{18,20}$/.test(url.pathname)) throw new ParseError('番茄章节地址无效');
    return this.parseParts(await this.json(this.api('content', 'item_id', url.pathname.split('/').at(-1)!)));
  }
  override async getChapterText(id: string) { return this.result(async () => (await this.getNovelParts(id)).map((part) => part.kind === 'text' ? part.value : '').join('\n\n')); }
  async getChapterImages() { return SourceResult.Error(new ParseError('请使用小说阅读器')); }
  override async getShareUrl(id: string) { return `${this.home}page/${validId(id)}`; }
  override async getCoverHeaders() { return { Referer: this.home }; }
  getEpubBookId(raw: string): string { const url = new URL(raw); if (url.origin !== new URL(this.home).origin || url.username || url.password || url.search || url.hash !== `#${PUBLIC_EPUB_MARKER}` || !/^\/page\/[0-9]{18,20}$/.test(url.pathname)) throw new ParseError('番茄下载地址或标识无效'); return validId(url.pathname.split('/').at(-1)!); }
  async getDownloadInfo(id: string) { return this.result(async () => createDownloadInfo({ url: `${await this.getShareUrl(id)}#${PUBLIC_EPUB_MARKER}`, fileName: `${validId(id)}.epub`, format: 'epub' })); }
  private webJson(path: string, params: Record<string, string> = {}): Promise<ObjectData> {
    const url = this.url(path, params), old = this.pageCache.get(url); if (old && Date.now() - old.at < 60_000) return old.value;
    if (this.pageCache.size >= 12) this.pageCache.delete(this.pageCache.keys().next().value!);
    const value = this.json(url, false).then((data) => { if (Number(data['code'] ?? 0) !== 0) throw new ParseError('番茄未返回当前栏目'); return data; }).catch((error: unknown) => { this.pageCache.delete(url); throw error; });
    this.pageCache.set(url, { at: Date.now(), value }); return value;
  }
  private async catalog(): Promise<DiscoverCatalog> {
    if (this.catalogCache && Date.now() - this.catalogCache.at < 300_000) return this.catalogCache.value;
    const doc = parseHtmlDocument(await this.transport.html(this.url('/rank/1_1'))), script = doc.select('script').find((script) => script.html().includes('window.__INITIAL_STATE__='));
    if (!script) throw new ParseError('番茄未返回分类目录');
    const types = object(object(initialState(script.html())['rank'])['rankCategoryTypeList']);
    const categories = [['male', '1'], ['female', '0']].flatMap(([key, gender]) => objects(types[key!]).map((row) => ({ id: `${gender}:${String(row['id'])}`, label: text(row, 'name'), group: gender === '1' ? '男频' : '女频' })));
    const value = discoverCatalog({ feeds: [{ id: 'native', label: '番茄推荐', kind: null }, { id: 'updates', label: '最近更新', kind: 'updates' }, { id: 'top', label: '番茄作品榜', kind: 'ranking' }], categories, declared: true, explicit: true, dated: true, capabilities: { updates: ['最新'], ranking: ['热门'] } });
    this.catalogCache = { at: Date.now(), value }; return value;
  }
  override async discoverCatalog() { return this.result(() => this.catalog()); }
  override async discover(q: DiscoverQuery) { return this.result(async () => {
    const catalog = await this.catalog(), kind = q.feedId ?? (q.dimension === 'UPDATES' ? 'updates' : 'top');
    if (q.feedId === null && !catalogRanges(catalog, q.dimension).includes(q.range)) return discoverPage({ supported: false, catalog });
    const selected = [...new Set([...(q.categoryId ? [q.categoryId] : []), ...q.categoryIds])];
    if (selected.some((id) => !catalog.categories.some((c) => c.id === id))) throw new ParseError('番茄分类已变化，请重新选择');
    const labels = new Set(catalog.categories.filter((c) => selected.includes(c.id)).map((c) => c.label));
    let batches: Array<{ rows: ObjectData[]; origin: string }> = [], more = false;
    if (kind === 'native') for (const gender of ['0', '1']) { const data = object((await this.webJson('/api/rank/recommend/list', { type: gender, offset: String((q.page - 1) * 20), limit: '20' }))['data']); batches.push({ rows: objects(data['list']), origin: '番茄推荐' }); more ||= q.page * 20 < Number(data['total'] ?? q.page * 20); }
    else if (kind === 'updates') { const data = object((await this.webJson('/api/rank/recent/update/list', { offset: String((q.page - 1) * 24), limit: '24' }))['data']); const rows = objects(data['data']); more = q.page * 24 < Number(data['total'] ?? (rows.length === 24 ? q.page * 24 + 1 : 0)); batches = [{ rows, origin: '番茄章节更新' }]; }
    else if (kind === 'top') { const data = await this.webJson('/api/author/misc/top_book_list/v1/', { offset: '0', limit: '200' }); const rows = objects(data['book_list']).filter((row) => !labels.size || labels.has(text(row, 'category'))); more = q.page * 24 < rows.length; batches = [{ rows: rows.slice((q.page - 1) * 24, q.page * 24), origin: '番茄作品榜' }]; }
    else return discoverPage({ supported: false, notice: '番茄未提供此栏目', catalog });
    const found = new Set<string>();
    const entries = batches.flatMap(({ rows, origin }) => rows.flatMap((row) => {
      const id = text(row, 'bookId', 'book_id'), title = text(row, 'bookName', 'book_name'); if (!/^[0-9]{18,20}$/.test(id) || !title.trim() || found.has(id)) return [];
      if (/[\uE000-\uF8FF]/u.test(title)) throw new ParseError('番茄当前返回字形编码，未展示乱码作品');
      const category = text(row, 'category'); if (labels.size && !labels.has(category)) return []; found.add(id);
      const latestChapter = text(row, 'title', 'lastChapterTitle') || null, synopsis = text(row, 'abstract') || null, updated = Number(text(row, 'updateTime', 'lastChapterUpdateTime'));
      const status = text(row, 'creationStatus', 'creation_status');
      const book = createSearchBook({ id, sourceId: this.id, title, author: text(row, 'author'), cover: text(row, 'thumbUri', 'thumb_url') || null, format: 'epub', language: '中文', description: synopsis, novelInfo: createNovelInfo({ category: category || null, synopsis, latestChapter, status: status === '0' ? '已完结' : status === '1' ? '连载中' : null }) });
      return [discoverEntry(book, { updatedAt: Number.isFinite(updated) && updated > 0 ? updated * 1000 : null, latestChapter, native: true, origin, statistic: kind === 'top' ? text(row, 'rank_score') || null : null })];
    })).map((entry, i) => ({ ...entry, nativeOrder: q.offset + i, rank: kind === 'top' ? q.offset + i + 1 : null }));
    return discoverPage({ entries, hasMore: more, catalog, native: true });
  }); }
  async login() { return SourceResult.Success(true); }
  async logout() {}
  async isLoggedIn() { return true; }
}
