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
import { GuestNovelTransport, type GuestVerification } from './guestNovelTransport';
import { HtmlNovelDiscovery } from './htmlNovelDiscovery';
import type { DiscoverQuery } from '@core/discover/models';
import type { NovelPart } from './novelParts';

export const XBOOKCN_EPUB_MARKER = 'ciallo-xbookcn-epub-v1';
export function requireXbookId(id: string): void { if (!/^[0-9a-f]{6,16}$/.test(id)) throw new ParseError('书阁作品标识无效'); }
export function parseXbookChapter(id: string): { bookId: string; number: number } {
  const match = /^([0-9a-f]{6,16})\/([0-9]{1,7})$/.exec(id), number = Number(match?.[2]);
  if (!match || number < 1 || number > 100_000) throw new ParseError('书阁章节标识无效');
  return { bookId: match[1]!, number };
}
const BOOK_HREF = /\/book\/([0-9a-f]{6,16})(?:[-/?#]|$)/;
export const XbookcnParser = {
  books(html: string, sourceId = 'xbookcn'): SearchBook[] {
    const container = parseHtmlDocument(html).selectFirst('#search-books'); if (!container) return [];
    const books = container.select('li').flatMap((item) => {
      const link = item.selectFirst('h3 a[href^="/book/"]'), id = BOOK_HREF.exec(link?.attr('href') ?? '')?.[1], title = link?.text().trim();
      if (!id || !title) return [];
      const paragraphs = item.select('p');
      return [createSearchBook({ id, sourceId, title, author: paragraphs[0]?.text().trim() || '未知作者', description: paragraphs[1]?.text().trim() || null, format: 'epub', language: '中文' })];
    });
    return [...new Map(books.map((book) => [book.id, book])).values()];
  },
  chapters(html: string, bookId: string): ComicChapter[] {
    requireXbookId(bookId);
    const section = parseHtmlDocument(html).select('section').find((item) => item.selectFirst('h2')?.text().trim().startsWith('目录'));
    if (!section) return [];
    const chapters = section.select('ol li a[href*="/book/"]').flatMap((link) => {
      const match = /\/book\/([0-9a-f]{6,16})[^/]*\/([0-9]{1,7})(?:[?#]|$)/.exec(link.attr('href'));
      const number = Number(match?.[2]); if (!match || match[1] !== bookId || number < 1 || number > 100_000) return [];
      const title = link.selectFirst('span.truncate')?.text().trim() || link.select('span').at(-1)?.text().trim() || `第 ${number} 章`;
      return [createComicChapter({ id: `${bookId}/${number}`, title, order: number })];
    });
    return [...new Map(chapters.map((chapter) => [chapter.id, chapter])).values()].sort((a, b) => a.order - b.order);
  },
  detail(html: string, bookId: string, sourceId = 'xbookcn'): SearchBook {
    const doc = parseHtmlDocument(html), header = doc.selectFirst('main > header') ?? doc.selectFirst('header');
    const title = header?.selectFirst('h1')?.text().trim(); if (!title || !header) throw new ParseError('书阁未返回作品标题，页面可能已变化');
    const meta = header.select('p')[0]?.text() ?? '', synopsis = header.selectFirst('p.mt-3')?.text().trim()
      || header.select('p').find((p) => p.text().trim().length >= 40 && !p.text().trim().startsWith('标签'))?.text().trim() || null;
    const tags = [...new Set(header.select('a[href*="/novels?tag="]').map((a) => a.text().trim()).filter(Boolean))];
    const category = [...new Set(header.select('a[href*="/novels?cat="]').map((a) => a.text().trim()).filter(Boolean))].join('、') || null;
    const chapters = this.chapters(html, bookId), count = /([0-9]+)\s*章/.exec(meta)?.[1], words = /([0-9]+(?:\.[0-9]+)?)\s*万字/.exec(meta)?.[1];
    return createSearchBook({ id: bookId, sourceId, title, author: header.selectFirst('a[href^="/author/"]')?.text().trim() || '未知作者', description: synopsis, format: 'epub', language: '中文',
      novelInfo: createNovelInfo({ synopsis, category, tags, latestChapter: chapters.at(-1)?.title ?? null, updatedAt: /([0-9]{4}-[0-9]{2}-[0-9]{2})\s*更新/.exec(meta)?.[1] ?? null,
        chapterCount: count ? Number(count) : chapters.length || null, wordCount: words ? `${words} 万字` : null, translation: '中文', notice: '免登录公开正文；整本下载会逐章抓取并复核目录，任何一章失败都不会标记完成。' }) });
  },
  chapterText(html: string): string {
    const doc = parseHtmlDocument(html), article = doc.selectFirst('article.reading-text') ?? doc.selectFirst('article');
    if (!article) throw new ParseError('书阁未返回正文，页面可能已变化');
    const paragraphs = article.select('p').map((p) => [...p.text()].filter((c) => c === '\n' || c === '\t' || c.codePointAt(0)! >= 32).join('').trim()).filter(Boolean);
    if (!paragraphs.length) throw new ParseError('本章正文为空，可能已下架或需要登录');
    const text = paragraphs.join('\n\n');
    if (['请登录后阅读', '請登入後閱讀', '购买本章', '購買本章', '本章未完'].some((marker) => text.includes(marker))) throw new ParseError('该章节未完整公开，书源无法读取');
    return text;
  },
};

export class XbookcnSource extends ComicSource {
  readonly id = 'xbookcn'; readonly name = '书阁';
  readonly capabilities = createSourceCapabilities({ supportEbook: true, supportOnlineText: true });
  readonly home: string;
  private readonly transport: GuestNovelTransport;
  private readonly cache = new Map<string, { at: number; html: string }>();
  private readonly discovery: HtmlNovelDiscovery;
  constructor(options: { client: HttpClient; baseUrl?: string; verify?: GuestVerification }) {
    super(); this.home = (options.baseUrl ?? 'https://xbookcn.app').replace(/\/$/, '');
    this.transport = new GuestNovelTransport(options.client, this.home + '/', this.name, undefined, options.verify);
    this.discovery = new HtmlNovelDiscovery(this.id, this.home + '/', async (url) => parseHtmlDocument(await this.transport.html(url, true)), (url) => /^\/book\/([0-9a-f]{6,16})(?:-[^/]+)?\/?$/.exec(new URL(url).pathname)?.[1] ?? null);
  }
  private async result<T>(block: () => Promise<T>): Promise<Result<T>> { try { return SourceResult.Success(await block()); } catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; return SourceResult.Error(error instanceof SourceException ? error : new ParseError(error instanceof Error ? error.message : '书阁页面解析失败')); } }
  private async bookHtml(id: string): Promise<string> {
    requireXbookId(id); const cached = this.cache.get(id); if (cached && Date.now() - cached.at < 60_000) return cached.html;
    const html = await this.transport.html(`${this.home}/book/${id}`, true);
    if (this.cache.size >= 8) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(id, { at: Date.now(), html }); return html;
  }
  invalidateBook(id: string): void { this.cache.delete(id); }
  getEpubBookId(raw: string): string {
    const url = new URL(raw), base = new URL(this.home), match = /^\/book\/([0-9a-f]{6,16})$/.exec(url.pathname);
    if (url.origin !== base.origin || url.username || url.password || url.search || url.hash !== `#${XBOOKCN_EPUB_MARKER}` || !match) throw new ParseError('书阁下载地址或标识无效');
    return match[1]!;
  }
  async getNovelParts(chapterId: string): Promise<NovelPart[]> {
    const result = await this.getChapterText(chapterId); if (result.kind === 'error') throw result.exception;
    return result.data.split('\n\n').map((value) => value.trim()).filter(Boolean).map((value) => ({ kind: 'text', value }));
  }
  async search(keyword: string) { return this.result(async () => keyword.trim() ? XbookcnParser.books(await this.transport.html(`${this.home}/search?q=${encodeURIComponent(keyword.trim())}`, true)) : []); }
  async getDetail(id: string) { return this.result(async () => XbookcnParser.detail(await this.bookHtml(id), id)); }
  async refreshNovelDetail(id: string) { this.invalidateBook(id); return this.getDetail(id); }
  async getChapters(id: string) { return this.result(async () => XbookcnParser.chapters(await this.bookHtml(id), id)); }
  override async getChapterText(id: string) { return this.result(async () => { const parsed = parseXbookChapter(id); return XbookcnParser.chapterText(await this.transport.html(`${this.home}/book/${parsed.bookId}/${parsed.number}`, true)); }); }
  async getChapterImages() { return SourceResult.Error(new ParseError('书阁是文字小说源，请使用小说阅读器')); }
  override async getShareUrl(id: string) { requireXbookId(id); return `${this.home}/book/${id}`; }
  async getDownloadInfo(id: string) { return this.result(async () => { requireXbookId(id); const detail = await this.getDetail(id); const title = detail.kind === 'success' ? detail.data.title : id; return createDownloadInfo({ url: `${this.home}/book/${id}#${XBOOKCN_EPUB_MARKER}`, fileName: `${title.replace(/[\\/:*?"<>|]/g, '_').trim() || id}.epub`, format: 'epub', referer: this.home + '/' }); }); }
  override async discoverCatalog() { return this.result(() => this.discovery.catalog()); }
  override async discover(query: DiscoverQuery) { return this.result(() => this.discovery.discover(query)); }
  async login() { return SourceResult.Success(true); }
  async logout() {}
  async isLoggedIn() { return true; }
}
