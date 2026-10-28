import { catalogRanges, discoverCatalog, discoverEntry, discoverPage, type DiscoverCatalog, type DiscoverFeed, type DiscoverNativeCategory, type DiscoverQuery } from '@core/discover/models';
import { createNovelInfo } from '../novelInfo';
import { createSearchBook, type SearchBook } from '../searchBook';
import { ParseError } from '../sourceException';
import type { HtmlDocument, HtmlElement } from './jsoup';

type Route = { url: string; label: string };
/** Follow only verified site navigation and same-origin catalogue pagination. */
export class HtmlNovelDiscovery {
  private readonly saved = new Map<string, { at: number; value: Promise<HtmlDocument> }>();
  constructor(private readonly sourceId: string, private readonly home: string,
    private readonly fetch: (url: string) => Promise<HtmlDocument>, private readonly identify: (url: string) => string | null,
    private readonly format = 'epub') {}
  private safe(raw: string): string | null {
    try { const url = new URL(raw, this.home), home = new URL(this.home); return url.host === home.host && url.protocol === home.protocol && !url.username && !url.password && !url.hash ? url.toString() : null; }
    catch { return null; }
  }
  private document(url: string): Promise<HtmlDocument> {
    const cached = this.saved.get(url); if (cached && Date.now() - cached.at < 60_000) return cached.value;
    if (this.saved.size >= 12) this.saved.delete(this.saved.keys().next().value!);
    const value = this.fetch(url).catch((error: unknown) => { this.saved.delete(url); throw error; });
    this.saved.set(url, { at: Date.now(), value }); return value;
  }
  async catalog(): Promise<DiscoverCatalog> {
    const path = this.sourceId === 'sfacg' ? '/category/' : this.sourceId === 'xbookcn' ? '/novels' : this.sourceId === 'ixdzs8' ? '/sort/1/' : '/';
    const doc = await this.document(new URL(path, this.home).toString());
    const feeds: DiscoverFeed[] = [{ id: 'native', label: '原站推荐', kind: null }], categories: DiscoverNativeCategory[] = [];
    const feed = (path: string, label: string, kind: string): void => { feeds.push({ id: new URL(path, this.home).toString(), label, kind }); };
    if (this.sourceId === 'xbookcn') { feed('/novels', '最近更新', 'updates'); feed('/novels?sort=heat', '热度榜', 'ranking'); }
    if (this.sourceId === 'ixdzs8') { feed('/new/', '最近更新', 'updates'); feed('/hot/', '总排行榜', 'ranking'); feed('/hot/day/', '日排行榜', 'ranking'); feed('/hot/month/', '月排行榜', 'ranking'); }
    if (this.sourceId === 'sfacg') { feed('/lateList/', '最新更新', 'updates'); for (const [path, label] of [['original', '人气榜'], ['new', '新书榜'], ['sale', '畅销榜'], ['ticket', '月票榜']]) feed(`/rank/${path}.html`, label!, 'ranking'); }
    if (this.sourceId === 'ihuaben') for (const [path, label] of [['girl', '女频'], ['boy', '男频'], ['tongren', '同人']]) { feed(`/${path}/updatetime/1.html`, `${label}·章节更新`, 'updates'); feed(`/${path}/clickcount_days_7/1.html`, `${label}·七日点击榜`, 'ranking'); feed(`/${path}/createtime/1.html`, `${label}·新书`, 'ranking'); }
    const huabenNames: Record<string, string> = { girl: '女频', boy: '男频', tongren: '同人', mingxingtongren: '明星同人', yingshitongren: '影视同人', dongmantongren: '动漫同人', youxitongren: '游戏同人', xiaoyuanyanqing: '校园言情', gudaiyanqing: '古代言情', chuanyueyanqing: '穿越言情', lingyiyanqing: '灵异言情', xuanhuan: '玄幻', dushi: '都市', xianxia: '仙侠', kehuan: '科幻', lishi: '历史', jingji: '竞技', qingxiaoshuo: '轻小说' };
    for (const anchor of doc.select('a[href]')) {
      const safe = this.safe(anchor.attr('href')); if (!safe) continue;
      const url = new URL(safe), label = anchor.text().trim();
      let category: DiscoverNativeCategory | null = null;
      if (this.sourceId === 'xbookcn' && url.pathname === '/novels') {
        const key = ['cat', 'tag'].find((key) => url.searchParams.get(key));
        if (key) { const value = url.searchParams.get(key)!; const canonical = new URL('/novels', this.home); canonical.searchParams.set(key, value); category = { id: canonical.toString(), label: value, group: key === 'cat' ? '题材' : '标签' }; }
      } else if (this.sourceId === 'sfacg' && /^\/category\/[0-9]+\/$/.test(url.pathname)) category = { id: safe, label: anchor.parent()?.ownText().trim() ?? '', group: '题材' };
      else if (this.sourceId === 'ihuaben' && huabenNames[url.pathname.replace(/^\/+|\/+$/g, '')]) category = { id: safe, label: huabenNames[url.pathname.replace(/^\/+|\/+$/g, '')]!, group: '话本分类' };
      else if (this.sourceId === 'quanben' && /^\/c\/[a-z]+\.html$/.test(url.pathname)) category = { id: safe, label, group: '题材' };
      else if (this.sourceId === 'ixdzs8' && !url.search && /^\/sort\/[0-9]+\/$/.test(url.pathname) && !/分类|推荐|完结|^全部$/.test(label)) category = { id: safe, label, group: '题材' };
      else if (!['xbookcn', 'sfacg', 'ihuaben', 'quanben', 'ixdzs8'].includes(this.sourceId) && label && label.length <= 18 && !this.identify(safe) && safe !== this.home) {
        const kind = /最近更新|最新更新|^更新$|^最新$/.test(label) ? 'updates' : /排行|榜单|热门榜|人气榜|收藏榜|点击榜/.test(label) ? 'ranking' : null;
        if (kind) feeds.push({ id: safe, label, kind });
        else if (/玄幻|奇幻|都市|言情|古言|穿越|青春|仙侠|修真|武侠|宫廷|乡村|灵异|悬疑|历史|军事|游戏|竞技|科幻|职场|官场|现言|耽美|同人|校园|轻小说|其他|其它/.test(label)) category = { id: safe, label, group: '原站分类' };
      }
      if (category?.label) categories.push(category);
    }
    const capabilities: Record<string, string[]> = {};
    if (feeds.some((feed) => feed.kind === 'updates')) capabilities['updates'] = ['最新'];
    if (feeds.some((feed) => feed.kind === 'ranking')) capabilities['ranking'] = ['sfacg', 'ihuaben'].includes(this.sourceId) ? ['热门', '新作'] : ['热门'];
    return discoverCatalog({ feeds: [...new Map(feeds.map((feed) => [feed.id, feed])).values()], categories: [...new Map(categories.map((category) => [category.id, category])).values()], explicit: true, declared: true, capabilities });
  }
  private ids(node: HtmlElement): Set<string> { return new Set(node.select('a[href]').flatMap((anchor) => { const url = this.safe(anchor.attr('href')); const id = url && this.identify(url); return id ? [id] : []; })); }
  books(doc: HtmlDocument, category: string | null = null): SearchBook[] {
    const found = new Map<string, SearchBook>();
    for (const link of doc.select('a[href]')) {
      const url = this.safe(link.attr('href')), id = url && this.identify(url); if (!id) continue;
      let card = link;
      for (let step = 0; step < 6; step++) { const parent = card.parent(); if (!parent) break; const ids = this.ids(parent); if (ids.size !== 1 || !ids.has(id)) break; card = parent; }
      const titleLink = card.select('h1 a[href], h2 a[href], h3 a[href], h4 a[href], .title a[href], .book-title a[href]').find((anchor) => { const url = this.safe(anchor.attr('href')); return url && this.identify(url) === id; });
      const title = (titleLink?.text() ?? card.selectFirst('#listtitle, h3.title, .book-title')?.text() ?? link.selectFirst('.font-medium, h1, h2, h3, h4')?.text() ?? (link.attr('title') || null) ?? link.selectFirst('p')?.text() ?? link.selectFirst('[itemprop=name]')?.text() ?? link.selectFirst('img[alt]')?.attr('alt') ?? link.ownText()).trim();
      if (title.length < 2 || title.length > 150 || /^\d+$/.test(title)) continue;
      const sfMeta = this.sourceId === 'sfacg' ? link.selectFirst('#listtitle')?.parent()?.children().at(-1)?.text() : null;
      const xAuthor = this.sourceId === 'xbookcn' ? card.selectFirst('h3')?.parent()?.parent()?.selectFirst('p')?.text() : null;
      const author = (sfMeta?.slice(0, sfMeta.lastIndexOf('/')) ?? xAuthor ?? card.selectFirst('.bauthor, .author, .author-info, [itemprop=author], .book-author, .novel-item-author, a[href*="/author/"], a[href*="user.ihuaben.com/"]')?.text() ?? link.selectFirst('span.text-xs')?.text().split(' · ')[0] ?? '').replace(/^作者[：:]/, '').trim();
      const image = card.selectFirst('img[data-original], img[data-src], img[src]');
      const rawImage = image && ['data-original', 'data-src', 'src'].map((key) => image.attr(key)).find(Boolean);
      let cover: string | null = null; try { if (rawImage) { const url = new URL(rawImage, this.home); if (['http:', 'https:'].includes(url.protocol)) cover = url.toString(); } } catch { /* No usable thumbnail. */ }
      const status = card.selectFirst('.lz, .novel-item-state, .state, .book-status')?.text() ?? null;
      const latestChapter = card.selectFirst('.l-last a, .novel-item-newest-chapter a, .newchapter a')?.text() ?? null;
      const synopsis = card.selectFirst('.l-p2, .intro, .description, .book-intro, [itemprop=description]')?.text() ?? null;
      let nativeCategory = sfMeta?.slice(sfMeta.lastIndexOf('/') + 1).trim() || card.selectFirst('.nsort, .book-type')?.text().trim() || (this.sourceId === 'xbookcn' ? card.selectFirst('span.shrink-0.rounded')?.text() : null) || category;
      if (this.sourceId === 'quanben') { let ancestor = card.parent(); while (ancestor && !ancestor.classNames().includes('box')) ancestor = ancestor.parent(); const label = ancestor?.selectFirst('h2')?.text().trim(); if (label && !label.includes('推荐')) nativeCategory = label; }
      const tags = this.sourceId === 'sfacg' ? (link.select('li')[0]?.selectFirst('div')?.text() ?? '').split('/').map((tag) => tag.trim()).filter(Boolean)
        : this.sourceId === 'ihuaben' ? card.select('a[href*="/category/"]').map((a) => a.text().trim()).filter(Boolean)
          : this.sourceId === 'xbookcn' ? card.select('span.text-stone-400').filter((node) => !node.children().length).map((node) => node.text().trim()).filter((tag) => tag && tag !== '·') : [];
      const book = createSearchBook({ id, sourceId: this.sourceId, title, author, cover, description: synopsis, format: this.format, language: '中文', novelInfo: createNovelInfo({ synopsis, status, category: nativeCategory, latestChapter, tags }) });
      const old = found.get(id); found.set(id, old ? { ...old, author: old.author || book.author, cover: old.cover ?? book.cover, description: old.description ?? book.description,
        novelInfo: createNovelInfo({ ...old.novelInfo, category: old.novelInfo?.category ?? nativeCategory, tags: [...new Set([...(old.novelInfo?.tags ?? []), ...tags])], status: old.novelInfo?.status ?? status, latestChapter: old.novelInfo?.latestChapter ?? latestChapter }) } : book);
    }
    return [...found.values()];
  }
  private routes(catalog: DiscoverCatalog, q: DiscoverQuery): Route[] {
    const selected = [...new Set([...(q.categoryId ? [q.categoryId] : []), ...q.categoryIds])].flatMap((id) => catalog.categories.find((category) => category.id === id) ?? []);
    if (q.feedId && q.feedId !== 'native') return catalog.feeds.filter((feed) => feed.id === q.feedId).map((feed) => ({ url: feed.id, label: feed.label }));
    if (q.feedId === 'native') return selected.length ? selected.map((c) => ({ url: c.id, label: c.label })) : [{ url: this.home, label: '原站推荐' }];
    if (this.sourceId === 'ihuaben') {
      const paths = selected.length ? selected.map((c) => ({ path: new URL(c.id).pathname.replace(/^\/+|\/+$/g, ''), label: c.label })) : [{ path: 'girl', label: '女频' }, { path: 'boy', label: '男频' }, { path: 'tongren', label: '同人' }];
      const sort = q.dimension === 'UPDATES' ? 'updatetime' : q.range === '新作' ? 'createtime' : 'clickcount_days_7';
      return paths.map(({ path, label }) => ({ url: new URL(`/${path}/${sort}/1.html`, this.home).toString(), label }));
    }
    if (selected.length && ['ixdzs8', 'xbookcn'].includes(this.sourceId)) return selected.map((c) => { const url = new URL(c.id); if (this.sourceId === 'xbookcn' && q.dimension === 'RANKING') url.searchParams.set('sort', 'heat'); if (this.sourceId === 'ixdzs8') url.pathname += q.dimension === 'RANKING' ? 'index-0-0-1-1.html' : 'index.html'; return { url: url.toString(), label: c.label }; });
    const feed = catalog.feeds.find((feed) => feed.kind === q.dimension.toLowerCase() && (q.range !== '新作' || feed.id.endsWith('/new.html')));
    return feed ? [{ url: feed.id, label: feed.label }] : [];
  }
  async discover(query: DiscoverQuery) {
    const catalog = await this.catalog();
    if (query.feedId === null && !catalogRanges(catalog, query.dimension).includes(query.range)) return discoverPage({ supported: false, notice: this.sourceId === 'quanben' ? '全本小说网未公开更新榜或热度榜，可查看原站推荐和分类目录' : '该书源未提供当前榜单或时间范围', catalog });
    if (query.categoryId && !catalog.categories.some((c) => c.id === query.categoryId)) return discoverPage({ supported: false, notice: '原站分类已变化，请重新选择', catalog });
    let starts: Route[] = [];
    if (query.cursor) {
      if (query.cursor.length > 30_000) throw new ParseError('小说续页标识过长');
      const raw: unknown = query.cursor.startsWith('[') ? JSON.parse(query.cursor) : [{ url: query.cursor, label: '原站续页' }];
      if (!Array.isArray(raw) || raw.length > 64) throw new ParseError('小说续页标识无效');
      starts = raw.flatMap((row: unknown) => { if (!row || typeof row !== 'object' || !('url' in row) || typeof row.url !== 'string') return []; const url = this.safe(row.url); return url ? [{ url, label: 'label' in row && typeof row.label === 'string' ? row.label.slice(0, 100) : '原站续页' }] : []; });
    } else if (query.page === 1) starts = this.routes(catalog, query);
    const pages: Array<{ books: SearchBook[]; origin: string; next: string | null }> = new Array(starts.length); let index = 0;
    await Promise.all(Array.from({ length: Math.min(3, starts.length) }, async () => { while (index < starts.length) {
      const slot = index++, route = starts[slot]!, safe = this.safe(route.url); if (!safe) throw new ParseError('原站目录地址无效');
      const target = new URL(safe), doc = await this.document(safe);
      const rows = this.sourceId === 'sfacg' && target.pathname === '/API/HTML5.ashx' ? this.sfBooks(doc) : this.books(doc, catalog.categories.find((c) => target.pathname.startsWith(new URL(c.id).pathname))?.label ?? null);
      if (!rows.length && !/暂无|没有|无结果|沒有/.test(doc.text()) && target.pathname !== '/API/HTML5.ashx') throw new ParseError('源站未返回可识别的小说列表');
      let next: string | null = null;
      for (const anchor of doc.select('a[href]')) if (anchor.attr('rel').toLowerCase() === 'next' || ['下一页', '下页', '下一頁', 'Next', '›', '»'].includes(anchor.text().trim())) {
        const url = this.safe(new URL(anchor.attr('href'), safe).toString()); if (url && url !== safe && !this.identify(url)) { next = url; break; }
      }
      if (!next && this.sourceId === 'sfacg' && rows.length && ['/lateList/', '/API/HTML5.ashx'].includes(target.pathname)) { const url = new URL('/API/HTML5.ashx', this.home); url.searchParams.set('op', 'latest'); url.searchParams.set('index', String(Number(target.searchParams.get('index') ?? '0') + 1)); url.searchParams.set('sign', 'false'); next = url.toString(); }
      pages[slot] = { books: rows, origin: route.label, next };
    } }));
    const ranked = query.feedId ? catalog.feeds.some((feed) => feed.id === query.feedId && feed.kind === 'ranking') : query.dimension === 'RANKING';
    const seen = new Set<string>(), rows = pages.flatMap((page) => page.books.map((book) => ({ book, origin: page.origin }))).filter(({ book }) => { if (seen.has(book.id)) return false; seen.add(book.id); return true; });
    const next = pages.flatMap((page) => page.next ? [{ url: page.next, label: page.origin }] : []);
    return discoverPage({ entries: rows.map(({ book, origin }, i) => discoverEntry(book, { latestChapter: book.novelInfo?.latestChapter ?? null, nativeOrder: query.offset + i, rank: ranked ? query.offset + i + 1 : null, native: true, origin })), hasMore: !!next.length, nextCursor: next.length === 1 ? next[0]!.url : next.length ? JSON.stringify(next) : null, catalog, native: true });
  }
  private sfBooks(doc: HtmlDocument): SearchBook[] {
    const raw: unknown = JSON.parse(doc.selectFirst('body')?.text() ?? doc.text()); if (!Array.isArray(raw)) throw new ParseError('SF更新列表格式异常');
    const decode = (value: unknown): string => { try { return decodeURIComponent(String(value ?? '')); } catch { return String(value ?? ''); } };
    return raw.map((row: Record<string, unknown>) => createSearchBook({ id: String(row['NovelID']), sourceId: this.sourceId, title: decode(row['NovelName']), author: decode(row['AuthorName']), cover: `https://rs.sfacg.com/web/novel/images/NovelCover/Big/${String(row['NovelCover'] ?? '')}`, format: this.format, language: '中文', novelInfo: createNovelInfo({ category: decode(row['TypeName']), tags: Array.isArray(row['Tags']) ? row['Tags'].map(decode) : [] }) }));
  }
}
