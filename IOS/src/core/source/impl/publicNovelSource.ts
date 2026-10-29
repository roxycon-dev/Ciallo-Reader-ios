import type { HttpClient } from '@platform/interfaces';
import { ComicSource } from '../comicSource';
import { createComicChapter, type ComicChapter } from '../comicChapter';
import { createSourceCapabilities } from '../sourceCapabilities';
import { createSearchBook } from '../searchBook';
import { createNovelInfo } from '../novelInfo';
import { createDownloadInfo } from '../downloadInfo';
import { ParseError, SourceException } from '../sourceException';
import { SourceResult, type SourceResult as Result } from '../sourceResult';
import { parseHtmlDocument, type HtmlDocument } from './jsoup';
import { GuestNovelTransport } from './guestNovelTransport';
import { HtmlNovelDiscovery } from './htmlNovelDiscovery';
import { extractNovelParts, hasMissingNovelContent, type NovelPart } from './novelParts';
import type { DiscoverQuery } from '@core/discover/models';

export const PUBLIC_NOVEL_SITES = {
  quanben: { name: '全本小说网', home: 'https://www.quanben.io/' },
  ihuaben: { name: '话本小说', home: 'https://www.ihuaben.com/' },
  sfacg: { name: 'SF轻小说', home: 'https://m.sfacg.com/' },
} as const;
export type PublicNovelSite = keyof typeof PUBLIC_NOVEL_SITES;
export const PUBLIC_EPUB_MARKER = 'ciallo-public-epub-v1';

/** Anonymous guest HTML and complete public directories; no user account or browser cookies. */
export class PublicNovelSource extends ComicSource {
  readonly id: PublicNovelSite; readonly name: string; readonly home: string;
  readonly capabilities = createSourceCapabilities({ supportEbook: true });
  private readonly transport: GuestNovelTransport;
  private readonly discovery: HtmlNovelDiscovery;
  constructor(site: PublicNovelSite, options: { client: HttpClient; baseUrl?: string }) {
    super(); this.id = site; this.name = PUBLIC_NOVEL_SITES[site].name; this.home = options.baseUrl ?? PUBLIC_NOVEL_SITES[site].home;
    const hosts = new Set([new URL(this.home).host]); if (site === 'ihuaben') hosts.add('so.ihuaben.com'); if (site === 'sfacg') { hosts.add('s.sfacg.com'); hosts.add('book.sfacg.com'); }
    this.transport = new GuestNovelTransport(options.client, this.home, this.name, hosts);
    this.discovery = new HtmlNovelDiscovery(site, this.home, async (url) => {
      if (site !== 'sfacg' || url !== this.home) return this.page(url);
      const doc = await this.page('https://book.sfacg.com/');
      for (const anchor of doc.select('a[href]')) { const parsed = new URL(anchor.attr('href'), 'https://book.sfacg.com/'); const match = /^\/Novel\/([0-9]+)\/?$/.exec(parsed.pathname); if (parsed.host === 'book.sfacg.com' && match) anchor.attributes['href'] = this.bookUrl(match[1]!); }
      return doc;
    }, (url) => { try { return this.bookId(url); } catch { return null; } });
  }
  private validId(id: string): string { if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new ParseError('小说标识无效'); return id; }
  bookUrl(id: string): string { this.validId(id); return new URL(this.id === 'sfacg' ? `b/${id}/` : this.id === 'ihuaben' ? `book/${id}.html` : `n/${id}/`, this.home).toString(); }
  bookId(raw: string): string {
    const url = new URL(raw), home = new URL(this.home);
    if (url.origin !== home.origin || url.username || url.password) throw new ParseError('小说地址不属于当前源');
    const pattern = this.id === 'sfacg' ? /^\/b\/([0-9]+)\/?$/ : this.id === 'ihuaben' ? /^\/book\/([0-9]+)\.html$/ : /^\/n\/([A-Za-z0-9_-]+)\/?$/;
    const id = pattern.exec(url.pathname)?.[1]; if (!id) throw new ParseError('小说下载地址无效'); return this.validId(id);
  }
  getEpubBookId(raw: string): string { const url = new URL(raw); if (url.hash !== `#${PUBLIC_EPUB_MARKER}` || url.search) throw new ParseError('小说下载标识无效'); return this.bookId(raw); }
  private async page(url: string): Promise<HtmlDocument> {
    const doc = parseHtmlDocument(await this.transport.html(url));
    if (/找不到|Redirecting/i.test(doc.title())) throw new ParseError('源站未返回小说页面'); return doc;
  }
  private async result<T>(block: () => Promise<T>): Promise<Result<T>> { try { return SourceResult.Success(await block()); } catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; return SourceResult.Error(error instanceof SourceException ? error : new ParseError(error instanceof Error ? error.message : `${this.name} 读取失败`)); } }
  override async getShareUrl(id: string) { return this.bookUrl(id); }
  override async getCoverHeaders() { return { Referer: this.home }; }
  async search(keyword: string) { return this.result(async () => {
    const query = keyword.trim(); if (!query) return [];
    const url = new URL(this.id === 'ihuaben' ? 'https://so.ihuaben.com/search' : this.id === 'sfacg' ? 'https://s.sfacg.com/' : 'index.php', this.home);
    if (this.id === 'ihuaben') url.searchParams.set('keyword', query);
    else if (this.id === 'sfacg') { url.searchParams.set('Key', query); url.searchParams.set('S', '1'); }
    else { url.searchParams.set('c', 'book'); url.searchParams.set('a', 'search'); url.searchParams.set('keywords', query); }
    const doc = await this.page(url.toString());
    if (this.id === 'sfacg') {
      const books = doc.select('a[href*="book.sfacg.com/Novel/"]').flatMap((anchor) => { const id = /\/Novel\/([0-9]+)/.exec(anchor.attr('href'))?.[1]; const title = anchor.text().trim(); return id && title ? [createSearchBook({ id, sourceId: this.id, title, author: '', format: 'epub', language: '中文', novelInfo: createNovelInfo({ translation: '中文原创', notice: '只支持整本公开作品；目录含 VIP 或锁定章节时会拒绝整本下载。' }) })] : []; });
      return [...new Map(books.map((book) => [book.id, book])).values()];
    }
    const cards = doc.select(this.id === 'ihuaben' ? '.searchresult' : '.list2');
    if (!cards.length && !/没有|沒有|找不到/.test(doc.text())) throw new ParseError('源站搜索结果格式变化，请稍后重试');
    const books = cards.flatMap((card) => {
      const anchor = card.selectFirst(this.id === 'ihuaben' ? 'h2 a[href]' : 'h3 a[href]'); if (!anchor) return [];
      let id: string; try { id = this.bookId(new URL(anchor.attr('href'), this.home).toString()); } catch { return []; }
      const title = anchor.text().trim(); if (!title) return [];
      const cover = card.selectFirst('img[src]')?.attr('src');
      return [createSearchBook({ id, sourceId: this.id, title, author: card.selectFirst(this.id === 'ihuaben' ? 'p.text-muted a' : 'p.author, .author')?.text() ?? '', cover: this.id === 'ihuaben' || !cover ? null : new URL(cover, this.home).toString(), format: 'epub', language: '中文', novelInfo: createNovelInfo({ translation: '中文', notice: '免登录公开正文；下载会核对全部目录，任何一章失败均不会标为完成。' }) })];
    });
    return [...new Map(books.map((book) => [book.id, book])).values()];
  }); }
  async getDetail(id: string) { return this.result(async () => {
    const doc = await this.page(this.bookUrl(id)); const meta = (key: string): string => doc.selectFirst(`meta[property="${key}"]`)?.attr('content') ?? '';
    const title = this.id === 'sfacg' ? doc.selectFirst('.book_newtitle')?.text() ?? '' : this.id === 'ihuaben' ? doc.selectFirst('h1')?.text() ?? '' : meta('og:novel:book_name') || doc.selectFirst('h1')?.text() || '';
    if (!title.trim()) throw new ParseError('未找到小说标题');
    const author = this.id === 'sfacg' ? (doc.selectFirst('.book_info3')?.ownText() ?? '').split('/')[0]!.trim() : this.id === 'ihuaben' ? doc.select('a[href*="user.ihuaben.com"]').find((a) => a.text().trim() && /\/[0-9]+\/?$/.test(a.attr('href')))?.text() ?? '' : meta('og:novel:author');
    const synopsis = doc.selectFirst(this.id === 'sfacg' ? '.book_Profile, .book_profile' : this.id === 'ihuaben' ? '.bookintro, .book-intro, .bookIntro' : '.description')?.text() ?? '';
    const toc = await this.chapters(id);
    return createSearchBook({ id, sourceId: this.id, title, author, cover: meta('og:image') || null, description: synopsis, format: 'epub', language: '中文', novelInfo: createNovelInfo({ synopsis, status: meta('og:novel:status') || null, chapterCount: toc.length, latestChapter: toc.at(-1)?.title ?? null, translation: '中文', notice: '整本下载包含源站本次公开目录的全部章节；源站缺章或更新滞后无法由客户端补齐。' }) });
  }); }
  async refreshNovelDetail(id: string) { return this.getDetail(id); }
  async getChapters(id: string) { return this.result(() => this.chapters(id)); }
  private async chapters(id: string): Promise<ComicChapter[]> {
    this.validId(id); let chapters: ComicChapter[];
    if (this.id === 'ihuaben') {
      const data = await this.transport.json(new URL(`book/chapters/${id}`, this.home).toString());
      if (data['code'] !== 0 || !Array.isArray(data['chapters']) || !data['chapters'].length || data['chapters'].length > 30_000) throw new ParseError('话本未返回完整公开目录');
      chapters = data['chapters'].map((item: Record<string, unknown>, index) => {
        if (item['chapterType'] !== 'FREE' || item['status'] !== 'PUBLISHED') throw new ParseError('此书含付费或非公开章节，不能免登录完整下载；请另选全本公开作品');
        if (String(item['bookId']) !== id) throw new ParseError('话本目录归属异常');
        const chapter = String(item['chapterId']), title = String(item['title'] ?? '').trim();
        if (!/^[1-9][0-9]*$/.test(chapter) || !title) throw new ParseError('章节标识或标题为空');
        return createComicChapter({ id: new URL(`book/${id}/${chapter}.html`, this.home).toString(), title, order: index });
      });
    } else {
      const doc = await this.page(this.id === 'sfacg' ? new URL(`i/${id}/`, this.home).toString() : new URL('list.html', this.bookUrl(id)).toString());
      const root = this.id === 'sfacg' ? doc.selectFirst('.mulu_list') : doc.selectFirst('.list3');
      if (!root) throw new ParseError('源站未返回完整章节目录');
      const anchors = root.select('a[href]');
      if (this.id === 'sfacg' && anchors.some((a) => a.select('.icon-lock2, .icon-lock, .vip').length)) throw new ParseError('此书含 VIP 或锁定章节，不能免登录完整下载；请另选全本公开作品');
      chapters = anchors.flatMap((a) => {
        const url = new URL(a.attr('href'), this.home), title = a.text().trim(), home = new URL(this.home);
        const valid = url.origin === home.origin && !url.username && !url.password && (this.id === 'sfacg' ? /^\/c\/[0-9]+\/$/.test(url.pathname) : url.pathname.startsWith(`/n/${id}/`));
        if (this.id === 'sfacg' && (!valid || !title)) throw new ParseError('SF 目录结构变化');
        if (!valid || !title) return [];
        if (title.includes('[锁]') || a.classNames().includes('vip')) throw new ParseError('此书含非公开章节，不能免登录整本下载');
        return [createComicChapter({ id: url.toString(), title })];
      });
    }
    if (!chapters.length || chapters.length > 30_000 || new Set(chapters.map((c) => c.id)).size !== chapters.length) throw new ParseError('小说目录为空、过大或存在重复章节地址');
    return chapters.map((chapter, order) => ({ ...chapter, order }));
  }
  async getNovelParts(chapterId: string): Promise<NovelPart[]> {
    const url = new URL(chapterId), home = new URL(this.home);
    const pattern = this.id === 'sfacg' ? /^\/c\/[0-9]+\/$/ : this.id === 'ihuaben' ? /^\/book\/[0-9]+\/[0-9]+\.html$/ : /^\/n\/[A-Za-z0-9_-]+\/[^/]+$/;
    if (url.origin !== home.origin || url.username || url.password || url.hash || !pattern.test(url.pathname)) throw new ParseError('小说章节地址无效');
    const doc = await this.page(chapterId), root = doc.selectFirst(this.id === 'sfacg' ? '.yuedu' : this.id === 'ihuaben' ? '#contentsource[data-ssr-read=true]' : '#content');
    if (!root) throw new ParseError('未找到章节正文，不能保存空章');
    const parts = extractNovelParts(root, chapterId, this.id === 'ihuaben'), text = parts.filter((part) => part.kind === 'text').map((part) => part.value).join('\n');
    if (hasMissingNovelContent(text) || ['请登录后阅读', '請登入後閱讀', '购买本章', '購買本章', '本章未完'].some((marker) => text.includes(marker))) throw new ParseError('章节未完整公开，下载已停止');
    if (doc.select('a[href]').some((a) => ['下一頁', '下一页', '继续阅读', '繼續閱讀'].includes(a.text().trim()) && new URL(a.attr('href'), chapterId).toString().includes(url.pathname.slice(0, url.pathname.lastIndexOf('/')) + '/') && /_[0-9]+\.html(?:$|[?#])/.test(a.attr('href')))) throw new ParseError('检测到分页正文，未将不完整章节保存为完成');
    return parts;
  }
  override async getChapterText(id: string) { return this.result(async () => (await this.getNovelParts(id)).map((part) => part.kind === 'text' ? part.value : `[插图] ${part.url}`).join('\n\n')); }
  async getChapterImages() { return SourceResult.Error(new ParseError('请使用小说阅读器')); }
  async getDownloadInfo(id: string) { return this.result(async () => createDownloadInfo({ url: `${this.bookUrl(id)}#${PUBLIC_EPUB_MARKER}`, fileName: `${this.validId(id)}.epub`, format: 'epub' })); }
  override async discoverCatalog() { return this.result(() => this.discovery.catalog()); }
  override async discover(query: DiscoverQuery) { return this.result(() => this.discovery.discover(query)); }
  async login() { return SourceResult.Success(true); }
  async logout() {}
  async isLoggedIn() { return true; }
}
