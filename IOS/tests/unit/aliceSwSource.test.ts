/**
 * AliceSw（爱丽丝书屋）Android → iOS 移植回归。
 *
 * 断言用的 HTML/JSON 片段全部按 `AliceSwParser.kt` / `AliceSwDiscover.kt` 里的真实选择器
 * 与字段拼成最小 fixture（不联网）：搜索列表 `div.list-group div.list-group-item`、
 * 详情 `div.novel_title` / `div.novel_info p` / `div.book_newchap`、目录 `ul.mulu_list`、
 * 正文 `div.read-content p`、发现卡片 `div.rec_rullist > ul`。EPUB 用 fflate 解压后逐条核对
 * `mimetype` / `content.opf` / 章节 xhtml / `META-INF/ciallo-source.json`。
 */

import { describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { discoverQuery } from '@core/discover/models';
import { writeAliceSwEpub } from '@core/download/aliceSwEpub';
import { AliceSwDiscover } from '@core/source/impl/aliceSwDiscover';
import {
  ALICE_SW_USER_AGENT,
  AliceSwDiscovery,
  AliceSwEndpoints,
  MemoryAliceSwRouteCache,
} from '@core/source/impl/aliceSwEndpoints';
import { AliceSwParser } from '@core/source/impl/aliceSwParser';
import { ALICE_SW_EPUB_MARKER, AliceSwSource } from '@core/source/impl/aliceSwSource';
import { createComicChapter } from '@core/source/comicChapter';
import { createSearchBook } from '@core/source/searchBook';
import { SourceResult } from '@core/source/sourceResult';
import type { HttpClient, HttpRequest, HttpResponse } from '@platform/interfaces';
import { createWebMockPlatform } from '@platform/web-mock';

const HOME = 'https://alicesw4.homes';

const SEARCH_HTML = `<div class="list-group">
  <div class="list-group-item">
    <h5><small>[连载]</small><a href="/novel/12345.html">1. 被标错序号的书名</a></h5>
    <p class="mb-1">字数：12.12万 <a href="/search?f=author&amp;q=作者甲">作者甲</a></p>
    <p class="content-txt">第一行的简介。</p>
    <p class="text-muted"><a href="/search?f=tag&amp;q=标签甲">#标签甲</a><a href="/lists/12.html">都市</a></p>
    <p class="timedesc">更新时间：2025-01-02</p>
  </div>
  <div class="list-group-item">
    <h5><a href="/novel/12345.html">2. 同 id 的重复条目</a></h5>
  </div>
</div>`;

const DETAIL_HTML = `<div class="box_intro"><img data-src="//img.example.com/cover.jpg" src="/placeholder.png"></div>
<div class="novel_title">测试书名</div>
<div class="novel_info">
  <p>作&nbsp;者：作者甲</p>
  <p>分 类：都市小说</p>
  <p>字 数：12.12万 · 章 节：11</p>
  <p>状 态：连载</p>
  <p>最新：第十二章 新的开始</p>
</div>
<div class="jianjie"><p>这是简介正文。</p></div>
<div class="tags_list"><a href="/search?f=tag&amp;q=标签甲">#标签甲</a><a href="/lists/1.html">都市</a></div>
<div class="book_newchap"><div class="con"><ul><li><em>更新时间：2025-03-04</em></li></ul></div></div>`;

const TOC_HTML = `<ul class="mulu_list">
  <li><a href="/book/98765/0a1b2c3d.html">第一章 开端</a></li>
  <li><a href="/book/98765/0a1b2c3e.html"></a></li>
  <li><a href="/novel/12345.html">不是章节</a></li>
</ul>`;

const CHAPTER_ONE = '<div class="read-content"><p>第一段正文。</p><p>   </p><p>第二段正文。</p></div>';
const CHAPTER_TWO = '<div class="read-content"><p>第二章正文。</p></div>';

const HOME_HTML = `<nav>
  <a href="/lists/12.html">都市小说</a>
  <a href="/lists/12.html">都市小说</a>
  <a href="/lists/13.html">玄幻</a>
  <a href="/lists/14.html">这是一个超过六个字的分类</a>
  <a href="/novel/12345.html">作品页不是分类</a>
</nav>`;

const LIST_HTML = `<div class="rec_rullist"><ul>
  <li class="one">1</li>
  <li class="sev">都市小说</li>
  <li class="two"><a href="/novel/12345.html">测试书名</a></li>
  <li class="three">第十二章 新的开始</li>
  <li class="four">作者甲</li>
  <li class="five">12.12万</li>
  <li class="six">2025-03-04</li>
  <li class="diyhot">1234</li>
</ul></div>
<a rel="next" href="/lists/12.html?page=2">下一页</a>`;

const LIST_NO_RANK_HTML = `<div class="rec_rullist"><ul>
  <li class="sev">玄幻</li>
  <li class="two"><a href="/novel/22222.html">另一本书</a></li>
  <li class="six">2025-05-06</li>
</ul></div>`;

type Route = { status?: number; body?: string } | null;

function fakeClient(handler: (url: string) => Route) {
  const request = vi.fn(async (req: HttpRequest): Promise<HttpResponse> => {
    const route = handler(req.url);
    return {
      status: route?.status ?? (route === null ? 404 : 200),
      url: req.url,
      headers: {},
      body: new TextEncoder().encode(route?.body ?? ''),
    };
  });
  return { client: { request } as HttpClient, request };
}

function aliceSource(client: HttpClient, domain = 'alicesw4.homes'): AliceSwSource {
  const cache = new MemoryAliceSwRouteCache({ domain, timestamp: Date.now() });
  const endpoints = new AliceSwEndpoints({
    client,
    cache,
    timings: { probeRoundMs: 25, probeTimeoutMs: 25, discoveryTimeoutMs: 25 },
  });
  return new AliceSwSource({ client, endpoints });
}

function detailHtml(title: string): string {
  return `<div class="novel_title">${title}</div><div class="novel_info"><p>作 者：作者甲</p></div>`;
}

describe('AliceSwParser（AliceSwParser.kt 逐行）', () => {
  it('parses the search list, strips the 序号 prefix and dedupes by id', () => {
    const books = AliceSwParser.books(SEARCH_HTML, 'alicesw');
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      id: '12345',
      sourceId: 'alicesw',
      title: '被标错序号的书名',
      author: '作者甲',
      description: '第一行的简介。',
      format: 'epub',
      language: '中文',
    });
    expect(books[0]?.novelInfo).toMatchObject({
      synopsis: '第一行的简介。',
      status: '连载',
      updatedAt: '2025-01-02',
      wordCount: '12.12万',
      tags: ['标签甲'],
      translation: '中文',
    });
  });

  it('parses the detail page, including ·-separated info rows and the cover scheme', () => {
    const book = AliceSwParser.detail(DETAIL_HTML, '12345', 'alicesw');
    expect(book).toMatchObject({
      id: '12345',
      title: '测试书名',
      author: '作者甲',
      cover: 'https://img.example.com/cover.jpg',
      description: '这是简介正文。',
    });
    expect(book.novelInfo).toMatchObject({
      status: '连载',
      category: '都市小说',
      latestChapter: '第十二章 新的开始',
      updatedAt: '2025-03-04',
      chapterCount: 11,
      wordCount: '12.12万',
      tags: ['标签甲'],
      translation: '中文',
      notice: '正文免登录公开；整本下载会逐章抓取并复核目录，任何一章失败都不会标记完成。',
    });
  });

  it('falls back to div.mu_h1 h1 and rejects a page without a title', () => {
    expect(AliceSwParser.detail('<div class="mu_h1"><h1>备用标题</h1></div>', '1', 'alicesw').title).toBe('备用标题');
    expect(() => AliceSwParser.detail('<div>没有标题</div>', '1', 'alicesw')).toThrow('爱丽丝书屋未返回作品标题，页面可能已变化');
  });

  it('lists chapters in ul.mulu_list order and skips non-chapter links', () => {
    const chapters = AliceSwParser.chapters(TOC_HTML, 'alicesw');
    expect(chapters.map((chapter) => chapter.id)).toEqual(['98765/0a1b2c3d', '98765/0a1b2c3e']);
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第一章 开端', '第 2 节']);
    expect(chapters.map((chapter) => chapter.order)).toEqual([1, 2]);
  });

  it('splits read-content paragraphs with blank lines and rejects empty bodies', () => {
    expect(AliceSwParser.chapterText(CHAPTER_ONE)).toBe('第一段正文。\n\n第二段正文。');
    expect(() => AliceSwParser.chapterText('<div class="other"><p>正文</p></div>')).toThrow('未能找到对应图书');
    expect(() => AliceSwParser.chapterText('<div class="read-content"><p> </p></div>')).toThrow(
      '本章正文为空，可能已下架或需要登录',
    );
  });

  it('validates work and chapter identifiers', () => {
    expect(AliceSwParser.isBookId('12345')).toBe(true);
    expect(AliceSwParser.isBookId('1234567890')).toBe(false);
    expect(AliceSwParser.isBookId('../12345')).toBe(false);
    expect(AliceSwParser.parseChapterId(' 98765/0a1b2c3d ')).toEqual({ bookKey: '98765', hash: '0a1b2c3d' });
    expect(() => AliceSwParser.parseChapterId('https://evil.test/book/1/0a1b2c3d.html')).toThrow('爱丽丝书屋章节标识无效');
    expect(() => AliceSwParser.parseChapterId('98765/ZZZ')).toThrow('爱丽丝书屋章节标识无效');
  });
});

describe('AliceSwDiscover（AliceSwDiscover.kt 逐行）', () => {
  it('builds the updates + four ranking feeds and the site category list', () => {
    const catalog = AliceSwDiscover.catalog(HOME_HTML, HOME);
    expect(catalog.feeds.map((feed) => feed.label)).toEqual(['最近更新', '日榜', '周榜', '月榜', '总榜']);
    expect(catalog.feeds[0]?.id).toBe(`${HOME}/all/order/update_time+desc.html`);
    expect(catalog.feeds[1]?.id).toBe(`${HOME}/other/rank_hits/order/hits_day.html`);
    expect(catalog.categories).toEqual([
      { id: `${HOME}/lists/12.html`, label: '都市', group: '分类' },
      { id: `${HOME}/lists/13.html`, label: '玄幻', group: '分类' },
    ]);
    expect(catalog.declared).toBe(true);
    expect(catalog.explicit).toBe(true);
    expect(catalog.capabilities).toEqual({ ranking: ['日', '周', '月', '总'], updates: ['最新'] });
  });

  it('routes cursor, feed, category and dimension the same way as Kotlin', () => {
    const catalog = AliceSwDiscover.catalog(HOME_HTML, HOME);
    const cursor = `${HOME}/all/order/update_time+desc.html?page=4`;
    expect(AliceSwDiscover.route(HOME, catalog, discoverQuery({ cursor }))).toBe(cursor);
    expect(
      AliceSwDiscover.route(HOME, catalog, discoverQuery({ feedId: `${HOME}/other/rank_hits/order/hits.html` })),
    ).toBe(`${HOME}/other/rank_hits/order/hits.html`);
    expect(
      AliceSwDiscover.route(HOME, catalog, discoverQuery({ categoryId: `${HOME}/lists/12.html`, page: 3 })),
    ).toBe(`${HOME}/lists/12.html?page=3`);
    expect(AliceSwDiscover.route(HOME, catalog, discoverQuery({ dimension: 'RANKING', range: '周' }))).toBe(
      `${HOME}/other/rank_hits/order/hits_week.html`,
    );
    expect(AliceSwDiscover.route(HOME, catalog, discoverQuery({ dimension: 'UPDATES', page: 2 }))).toBe(
      `${HOME}/all/order/update_time+desc.html?page=2`,
    );
    expect(AliceSwDiscover.route(HOME, catalog, discoverQuery({ dimension: 'CLICKS' }))).toBeNull();
    expect(AliceSwDiscover.route(HOME, catalog, discoverQuery({ feedId: 'native', dimension: 'DISCUSSION' }))).toBeNull();
  });

  it('parses card rows, rank fallback, clicks and the native order offset', () => {
    const rows = AliceSwDiscover.entries(LIST_HTML, 'alicesw', false, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.book).toMatchObject({ id: '12345', title: '测试书名', author: '作者甲' });
    expect(rows[0]?.book.novelInfo).toMatchObject({
      category: '都市',
      latestChapter: '第十二章 新的开始',
      updatedAt: '2025-03-04',
      wordCount: '12.12万',
      translation: '中文',
    });
    expect(rows[0]).toMatchObject({ rank: null, clicks: 1234, nativeOrder: 0, native: true, origin: '都市' });
    expect(rows[0]?.updatedAt).toBe(new Date(2025, 2, 4).getTime());

    const ranked = AliceSwDiscover.entries(LIST_HTML, 'alicesw', true, 20);
    expect(ranked[0]?.rank).toBe(1);
    const noRank = AliceSwDiscover.entries(LIST_NO_RANK_HTML, 'alicesw', true, 20);
    expect(noRank[0]?.rank).toBe(21);
    expect(noRank[0]?.clicks).toBeNull();
    expect(noRank[0]?.nativeOrder).toBe(20);
  });

  it('follows same-origin ?page= next links only', () => {
    const current = `${HOME}/lists/12.html`;
    expect(AliceSwDiscover.nextPage('<a rel="next" href="/lists/12.html?page=2">下一页</a>', current)).toBe(
      `${HOME}/lists/12.html?page=2`,
    );
    expect(AliceSwDiscover.nextPage('<a href="/lists/12.html?page=3">下一页</a>', current)).toBe(
      `${HOME}/lists/12.html?page=3`,
    );
    expect(AliceSwDiscover.nextPage('<a href="https://evil.test/x">下一页</a>', current)).toBeNull();
    expect(AliceSwDiscover.nextPage('<a href="">下一页</a>', current)).toBeNull();
    expect(AliceSwDiscover.nextPage('<div>没有下一页</div>', current)).toBeNull();
  });

  it('detects ranked queries and returns the native notice for unsupported dimensions', () => {
    expect(AliceSwDiscover.isRanked(discoverQuery({ dimension: 'RANKING' }))).toBe(true);
    expect(AliceSwDiscover.isRanked(discoverQuery({ feedId: `${HOME}/other/rank_hits/order/hits_day.html` }))).toBe(true);
    expect(AliceSwDiscover.isRanked(discoverQuery({ dimension: 'UPDATES' }))).toBe(false);
    expect(AliceSwDiscover.notice()).toMatchObject({
      supported: false,
      notice: '爱丽丝书屋只提供排行与分类目录，没有该维度的数据',
    });
  });
});

describe('AliceSwDiscovery（AliceSwDiscovery.kt 逐行）', () => {
  it('extracts reversed r(…) literals and plain https hosts, keeping alicesw* only', () => {
    const page = `<script>var u=r('semoh.2wsecila.www//:sptth');</script>
      <a href="https://alicesw4.homes/x">x</a>
      <a href="https://example.com/">y</a>
      <a href="https://www.alicesw4.homes/z">dup</a>`;
    expect(AliceSwDiscovery.hosts(page)).toEqual(['alicesw2.homes', 'alicesw4.homes']);
    expect(AliceSwDiscovery.hosts('')).toEqual([]);
  });
});

describe('AliceSwSource（AliceSwSource.kt 逐行，假 HttpClient）', () => {
  it('searches with URLEncoder + %20 and the Kotlin request headers', async () => {
    const { client, request } = fakeClient((url) =>
      url.includes('/search?q=') ? { body: SEARCH_HTML } : null,
    );
    const result = await aliceSource(client).search('异 世');
    if (result.kind === 'error') throw result.exception;
    expect(result.data[0]?.title).toBe('被标错序号的书名');
    const sent = request.mock.calls[0]?.[0];
    expect(sent?.url).toBe(`${HOME}/search?q=%E5%BC%82%20%E4%B8%96`);
    expect(sent?.headers).toEqual({
      'User-Agent': ALICE_SW_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: `${HOME}/`,
    });
  });

  it('returns an empty list for a blank keyword without any request', async () => {
    const { client, request } = fakeClient(() => null);
    const result = await aliceSource(client).search('   ');
    expect(result).toEqual({ kind: 'success', data: [] });
    expect(request).not.toHaveBeenCalled();
  });

  it('maps 404 to BookNotFound and does not retry on another route', async () => {
    const { client, request } = fakeClient(() => ({ status: 404 }));
    const result = await aliceSource(client).getDetail('12345');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.exception.message).toBe('未能找到对应图书');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects an interception page as ParseError without retrying', async () => {
    const { client, request } = fakeClient(() => ({
      body: '<html><head><title>Just a moment...</title></head><body></body></html>',
    }));
    const result = await aliceSource(client).getDetail('12345');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.exception.message).toBe('源站返回验证或拦截页面，请在书源管理完成站点验证或稍后重试');
    }
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retries a failing route once, then reports that every route is down', async () => {
    const { client } = fakeClient(() => ({ status: 500, body: 'boom' }));
    // Kotlin 的 failedUntil 是 companion 级（进程级）冷却；这里用独立线路，
    // 免得 5 分钟冷却把后续用例的 alicesw4 也一起冷掉。
    const result = await aliceSource(client, 'alicesw9.homes').getDetail('12345');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.exception.message).toBe('爱丽丝书屋当前所有线路都无法连接，请稍后重试');
    }
  });

  it('reads detail, chapters and chapter text through the site paths', async () => {
    const { client, request } = fakeClient((url) => {
      if (url.endsWith('/novel/12345.html')) return { body: DETAIL_HTML };
      if (url.endsWith('/other/chapters/id/12345.html')) return { body: TOC_HTML };
      if (url.endsWith('/book/98765/0a1b2c3d.html')) return { body: CHAPTER_ONE };
      return null;
    });
    const source = aliceSource(client);
    const detail = await source.getDetail('12345');
    if (detail.kind === 'error') throw detail.exception;
    expect(detail.data.title).toBe('测试书名');
    const toc = await source.getChapters('12345');
    if (toc.kind === 'error') throw toc.exception;
    expect(toc.data.map((chapter) => chapter.id)).toEqual(['98765/0a1b2c3d', '98765/0a1b2c3e']);
    const text = await source.getChapterText('98765/0a1b2c3d');
    if (text.kind === 'error') throw text.exception;
    expect(text.data).toBe('第一段正文。\n\n第二段正文。');
    expect(request.mock.calls.map(([req]) => req.url)).toEqual([
      `${HOME}/novel/12345.html`,
      `${HOME}/other/chapters/id/12345.html`,
      `${HOME}/book/98765/0a1b2c3d.html`,
    ]);
  });

  it('rejects invalid identifiers before touching the network', async () => {
    const { client, request } = fakeClient(() => null);
    const source = aliceSource(client);
    const detail = await source.getDetail('../etc/passwd');
    expect(detail.kind).toBe('error');
    if (detail.kind === 'error') expect(detail.exception.message).toBe('爱丽丝书屋作品标识无效');
    const chapter = await source.getChapterText('https://evil.test/book/1/0a1b2c3d.html');
    expect(chapter.kind).toBe('error');
    if (chapter.kind === 'error') expect(chapter.exception.message).toBe('爱丽丝书屋章节标识无效');
    expect(request).not.toHaveBeenCalled();
  });

  it('builds the EPUB download info with the marker, sanitized name and referer', async () => {
    const { client } = fakeClient((url) =>
      url.endsWith('/novel/12345.html') ? { body: detailHtml('测/试:书*名?') } : null,
    );
    const result = await aliceSource(client).getDownloadInfo('12345');
    if (result.kind === 'error') throw result.exception;
    expect(result.data).toEqual({
      url: `${HOME}/novel/12345.html#${ALICE_SW_EPUB_MARKER}`,
      fileName: '测_试_书_名_.epub',
      format: 'epub',
      size: null,
      headers: {},
      referer: `${HOME}/`,
    });
  });

  it('shares only numeric work pages and rejects image chapters', async () => {
    const { client } = fakeClient(() => null);
    const source = aliceSource(client);
    expect(await source.getShareUrl('12345')).toBe(`${HOME}/novel/12345.html`);
    expect(await source.getShareUrl('../12345')).toBeNull();
    const images = await source.getChapterImages('98765/0a1b2c3d');
    expect(images.kind).toBe('error');
    if (images.kind === 'error') {
      expect(images.exception.message).toBe('爱丽丝书屋是文字小说源，请使用小说阅读器');
    }
  });

  it('discovers the ranking feed, pages it, and reports the empty-list notice', async () => {
    const { client } = fakeClient((url) => {
      if (url === `${HOME}/`) return { body: HOME_HTML };
      if (url === `${HOME}/other/rank_hits/order/hits_week.html`) return { body: LIST_HTML };
      if (url === `${HOME}/all/order/update_time+desc.html?page=2`) return { body: LIST_NO_RANK_HTML };
      return null;
    });
    const source = aliceSource(client);
    const catalog = await source.discoverCatalog();
    if (catalog.kind === 'error') throw catalog.exception;
    expect(catalog.data.feeds).toHaveLength(5);
    const ranked = await source.discover(discoverQuery({ dimension: 'RANKING', range: '周' }));
    if (ranked.kind === 'error') throw ranked.exception;
    expect(ranked.data.entries[0]?.rank).toBe(1);
    expect(ranked.data.hasMore).toBe(false);
    expect(ranked.data.native).toBe(true);
    const unsupported = await source.discover(discoverQuery({ dimension: 'CLICKS' }));
    if (unsupported.kind === 'error') throw unsupported.exception;
    expect(unsupported.data.supported).toBe(false);
    expect(unsupported.data.notice).toBe('爱丽丝书屋只提供排行与分类目录，没有该维度的数据');
  });
});

describe('AliceSwEpub（AliceSwEpub.kt 逐行）', () => {
  const epubUrl = `${HOME}/novel/12345.html#${ALICE_SW_EPUB_MARKER}`;

  function epubClient(toc: () => string = () => TOC_HTML) {
    return fakeClient((url) => {
      if (url.endsWith('/novel/12345.html')) return { body: DETAIL_HTML };
      if (url.endsWith('/other/chapters/id/12345.html')) return { body: toc() };
      if (url.endsWith('/book/98765/0a1b2c3d.html')) return { body: CHAPTER_ONE };
      if (url.endsWith('/book/98765/0a1b2c3e.html')) return { body: CHAPTER_TWO };
      return null;
    });
  }

  it('streams a complete EPUB with stored mimetype, chapters, nav and OPF', async () => {
    const { client } = epubClient();
    const source = aliceSource(client);
    const fs = createWebMockPlatform().fs;
    const progress = vi.fn(async () => {});
    await writeAliceSwEpub(source, epubUrl, 'book.epub', { fs, progress, delayMs: 0 });

    const bytes = await fs.readFile('book.epub');
    const zip = unzipSync(bytes);
    const text = (name: string): string => new TextDecoder().decode(zip[name]!);
    expect(Object.keys(zip)[0]).toBe('mimetype');
    expect(text('mimetype')).toBe('application/epub+zip');
    // 第一条本地文件头：签名 + STORED（method 0），EPUB 规范要求。
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0);

    expect(text('META-INF/container.xml')).toContain('full-path="OEBPS/content.opf"');
    expect(text('OEBPS/chapter0.xhtml')).toContain('<title>第一章 开端</title>');
    expect(text('OEBPS/chapter0.xhtml')).toContain('<h1>第一章 开端</h1><p>第一段正文。</p><p>第二段正文。</p>');
    expect(text('OEBPS/chapter1.xhtml')).toContain('<h1>第 2 节</h1>');
    expect(text('OEBPS/nav.xhtml')).toContain('<a href="chapter1.xhtml">第 2 节</a>');
    const opf = text('OEBPS/content.opf');
    expect(opf).toContain('<dc:identifier id="bookid">alicesw:12345</dc:identifier>');
    expect(opf).toContain('<dc:title>测试书名</dc:title>');
    expect(opf).toContain('<dc:creator>作者甲</dc:creator>');
    expect(opf).toContain('<dc:language>zh</dc:language>');
    expect(opf.match(/<itemref idref="c\d"\/>/g)).toHaveLength(2);
    expect(opf).toContain('properties="nav"');

    const record = JSON.parse(text('META-INF/ciallo-source.json')) as {
      sourceId: string;
      bookId: string;
      images: unknown[];
      complete: boolean;
      chapters: Array<Record<string, unknown>>;
    };
    expect(record).toMatchObject({ sourceId: 'alicesw', bookId: '12345', images: [], complete: true });
    expect(record.chapters).toHaveLength(2);
    expect(record.chapters[0]).toMatchObject({
      url: '98765/0a1b2c3d',
      title: '第一章 开端',
      characters: '第一段正文。\n\n第二段正文。'.length,
      paragraphs: 2,
    });
    expect(record.chapters[0]?.['textSha256']).toMatch(/^[a-f0-9]{64}$/);
    expect(progress).toHaveBeenNthCalledWith(1, 1, 2);
    expect(progress).toHaveBeenNthCalledWith(2, 2, 2);
  });

  it('deletes the partial file when a chapter body is empty', async () => {
    const source = {
      id: 'alicesw',
      getDetail: async () =>
        SourceResult.Success(createSearchBook({ id: '12345', sourceId: 'alicesw', title: '测试书名', author: '作者甲' })),
      getChapters: async () =>
        SourceResult.Success([
          createComicChapter({ id: '98765/0a1b2c3d', title: '第一章 开端', order: 1 }),
          createComicChapter({ id: '98765/0a1b2c3e', title: '第 2 节', order: 2 }),
        ]),
      getChapterText: async (chapterId: string) =>
        SourceResult.Success(chapterId.endsWith('0a1b2c3d') ? '正文一。' : '   '),
    } as unknown as AliceSwSource;
    const fs = createWebMockPlatform().fs;
    await expect(
      writeAliceSwEpub(source, epubUrl, 'empty.epub', { fs, progress: async () => {}, delayMs: 0 }),
    ).rejects.toThrow('第 2 章正文为空，未生成缺章电子书');
    expect(await fs.exists('empty.epub')).toBe(false);
  });

  it('deletes the partial file when the source TOC changes during the download', async () => {
    let call = 0;
    const { client } = epubClient(() => (call++ === 0 ? TOC_HTML : TOC_HTML.replace('第一章 开端', '目录已经变化')));
    const fs = createWebMockPlatform().fs;
    await expect(
      writeAliceSwEpub(aliceSource(client), epubUrl, 'changed.epub', {
        fs,
        progress: async () => {},
        delayMs: 0,
      }),
    ).rejects.toThrow('下载期间源站目录变化，请重试；未导入旧目录的残缺书籍');
    expect(await fs.exists('changed.epub')).toBe(false);
  });

  it('deletes the partial file when a chapter request 404s and stops on cancellation', async () => {
    const missing = fakeClient((url) => {
      if (url.endsWith('/novel/12345.html')) return { body: DETAIL_HTML };
      if (url.endsWith('/other/chapters/id/12345.html')) return { body: TOC_HTML };
      if (url.endsWith('/book/98765/0a1b2c3d.html')) return { body: CHAPTER_ONE };
      return null;
    });
    const fs = createWebMockPlatform().fs;
    await expect(
      writeAliceSwEpub(aliceSource(missing.client), epubUrl, 'missing.epub', {
        fs,
        progress: async () => {},
        delayMs: 0,
      }),
    ).rejects.toThrow('未能找到对应图书');
    expect(await fs.exists('missing.epub')).toBe(false);

    const controller = new AbortController();
    const { client } = epubClient();
    const pending = writeAliceSwEpub(aliceSource(client), epubUrl, 'paused.epub', {
      fs,
      progress: async (done) => {
        if (done === 1) controller.abort();
      },
      signal: controller.signal,
      delayMs: 0,
    });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(await fs.exists('paused.epub')).toBe(false);
  });

  it('rejects a download URL without the AliceSw marker or a valid work id', async () => {
    const { client } = epubClient();
    const fs = createWebMockPlatform().fs;
    await expect(
      writeAliceSwEpub(aliceSource(client), `${HOME}/novel/12345.html`, 'a.epub', {
        fs,
        progress: async () => {},
      }),
    ).rejects.toThrow('爱丽丝书屋下载标识无效');
    await expect(
      writeAliceSwEpub(aliceSource(client), `${HOME}/novel/abc.html#${ALICE_SW_EPUB_MARKER}`, 'b.epub', {
        fs,
        progress: async () => {},
      }),
    ).rejects.toThrow('爱丽丝书屋作品标识无效');
  });
});
