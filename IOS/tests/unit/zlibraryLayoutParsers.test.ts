/**
 * Unit tests for the ported Z-Library HTML layout parsers.
 *
 * Kotlin sources:
 *   source/zlibrary/parser/BookcardLayoutParser.kt    (151 lines)
 *   source/zlibrary/parser/DesktopLayoutParser.kt     (113 lines)
 *   source/zlibrary/parser/MobileLayoutParser.kt     (106 lines)
 *   source/zlibrary/parser/LegacyLayoutParser.kt      (101 lines)
 *   source/zlibrary/parser/GenericFallbackParser.kt   (164 lines)
 *   source/zlibrary/parser/CoverExtractor.kt          (71 lines)
 *   source/zlibrary/parser/ZLibraryLayoutParser.kt    (23 lines)
 *   source/zlibrary/parser/ZLibraryParserManager.kt   (67 lines)
 *   source/zlibrary/ZLibraryParser.kt                 (49 lines)
 *   source/zlibrary/ZLibraryAccessChecker.kt          (36 lines)
 *
 * Every fixture below mirrors the markup the Kotlin selectors target, one per layout variant.
 */
import { describe, expect, it } from 'vitest';
import { BookcardLayoutParser } from '../../src/core/source/zlibrary/parser/bookcardLayoutParser';
import { CoverExtractor } from '../../src/core/source/zlibrary/parser/coverExtractor';
import { DesktopLayoutParser } from '../../src/core/source/zlibrary/parser/desktopLayoutParser';
import { GenericFallbackParser } from '../../src/core/source/zlibrary/parser/genericFallbackParser';
import { LegacyLayoutParser } from '../../src/core/source/zlibrary/parser/legacyLayoutParser';
import { MobileLayoutParser } from '../../src/core/source/zlibrary/parser/mobileLayoutParser';
import { parseHtmlDocument, type HtmlElement } from '../../src/core/source/zlibrary/parser/htmlDocument';
import { firstRealDownloadLink } from '../../src/core/source/zlibrary/parser/zLibraryLayoutParser';
import { ZLibraryParserManager } from '../../src/core/source/zlibrary/parser/zLibraryParserManager';
import { ZLibraryAccessChecker } from '../../src/core/source/zlibrary/zLibraryAccessChecker';
import { ZLibraryParser, guessFileFormatFromUrl } from '../../src/core/source/zlibrary/zLibraryParser';
import { LoginRequired, NetworkError, ParseError } from '../../src/core/source/sourceException';

const BASE = 'https://z-lib.by';

// ---------------------------------------------------------------------------
// Bookcard layout (2025+ web-component mirrors: zh.101k.by / tw.101k.by)
// ---------------------------------------------------------------------------

const BOOKCARD_SEARCH = `<!doctype html>
<html><head><title>Search</title><script src="/js/zlibrary.js"></script></head>
<body>
  <div id="content">
    <z-bookcard href="/book/123456/abc-def" download="/dl/123456/abc-def" extension="EPUB" filesize="9.40 MB">
      <div slot="title">  三体  </div>
      <div slot="author">刘慈欣</div>
      <img data-src="/covers/123456.jpg" alt="cover">
    </z-bookcard>
    <z-bookcard href="/book/123457/xyz" download="//cdn.example.com/dl/123457" extension="mobi" filesize="604 KB">
      <div slot="title"></div>
      <div slot="author">   </div>
      <img src="https://cdn-zlib.sk/c/2.jpg">
    </z-bookcard>
    <z-bookcard title="属性书名" author="属性作者" href="/book/123458/q" download="/dl/123458/q"></z-bookcard>
    <z-bookcard href="/not-a-book/1" download="/dl/x"></z-bookcard>
  </div>
</body></html>`;

const BOOKCARD_DETAIL = `<!doctype html>
<html><head><title>三体</title></head>
<body>
  <z-cover title="封面书名" author="封面作者"></z-cover>
  <h1 class="book-title" itemprop="name">  三体  </h1>
  <i class="authors"><a>刘慈欣</a><a>刘慈欣 著</a></i>
  <div class="details-book-cover-container"><img data-src="/c/1.jpg"></div>
  <template><a class="dlButton" href="/dl/hidden/placeholder" hidden>模板占位</a></template>
  <a class="dlButton" href="/dl/123456/abc-def">Download EPUB</a>
  <div class="book-property__extension">EPUB</div>
</body></html>`;

describe('BookcardLayoutParser — search', () => {
  const parser = new BookcardLayoutParser();
  const doc = parseHtmlDocument(BOOKCARD_SEARCH);

  it('detects the bookcard layout', () => {
    expect(parser.name).toBe('BookcardLayoutParser');
    expect(parser.canParseSearch(doc)).toBe(true);
    expect(parser.canParseSearch(parseHtmlDocument('<div class="resItemBox"></div>'))).toBe(false);
  });

  it('extracts every /book/ card with slot title/author, cover, format and size', () => {
    const books = parser.parseSearch(doc, BASE, 'zlibrary');
    // the 4th card has no "/book/" href and is skipped
    expect(books).toHaveLength(3);

    expect(books[0]).toMatchObject({
      id: 'book/123456/abc-def',
      sourceId: 'zlibrary',
      title: '三体',
      author: '刘慈欣',
      cover: 'https://z-lib.by/covers/123456.jpg',
      format: 'epub',
      downloadUrl: 'https://z-lib.by/dl/123456/abc-def',
    });
    // "9.40 MB" -> 9.4 * 1024 * 1024, truncated
    expect(books[0]?.size).toBe(Math.trunc(9.4 * 1024 * 1024));

    // protocol-relative download link is normalised to https:// by the shared formatUrl
    expect(books[1]).toMatchObject({
      id: 'book/123457/xyz',
      downloadUrl: 'https://cdn.example.com/dl/123457',
      format: 'mobi',
      cover: 'https://cdn-zlib.sk/c/2.jpg',
    });
    expect(books[1]?.size).toBe(604 * 1024);

    // missing slot elements fall back to the href/title/author attributes
    expect(books[2]).toMatchObject({
      id: 'book/123458/q',
      title: '属性书名',
      author: '属性作者',
      format: 'epub',
      cover: '',
      downloadUrl: 'https://z-lib.by/dl/123458/q',
    });
  });

  it('keeps a blank slot title blank and falls back to 未知作者 for a blank slot author', () => {
    const books = parser.parseSearch(doc, BASE, 'zlibrary');
    expect(books[1]?.title).toBe('');
    expect(books[1]?.author).toBe('未知作者');
  });

  it('parses file sizes: B/KB/MB/GB/TB, and rejects unusable text', () => {
    const sizeOf = (filesize: string): number | null => {
      const single = BOOKCARD_SEARCH.replace(
        'extension="mobi" filesize="604 KB"',
        `extension="mobi" filesize="${filesize}"`,
      );
      return parser.parseSearch(parseHtmlDocument(single), BASE, 'zlibrary')[1]?.size ?? null;
    };
    expect(sizeOf('1.5 GB')).toBe(Math.trunc(1.5 * 1024 ** 3));
    expect(sizeOf('1 TB')).toBe(1024 ** 4);
    expect(sizeOf('12 B')).toBe(12);
    expect(sizeOf('0 B')).toBeNull();
    expect(sizeOf('很大')).toBeNull();
  });
});

describe('BookcardLayoutParser — detail', () => {
  const parser = new BookcardLayoutParser();

  it('parses title, authors, cover and the non-hidden download button', () => {
    const detail = parser.parseDetail(parseHtmlDocument(BOOKCARD_DETAIL), BASE);
    expect(detail).toEqual({
      title: '三体',
      author: '刘慈欣, 刘慈欣 著',
      cover: 'https://z-lib.by/c/1.jpg',
      downloadUrl: 'https://z-lib.by/dl/123456/abc-def',
      format: 'epub',
    });
  });

  it('skips the [hidden] <template> placeholder link (it would return a 204 file)', () => {
    const doc = parseHtmlDocument(BOOKCARD_DETAIL);
    const link = firstRealDownloadLink(doc);
    expect(link?.attr('href')).toBe('/dl/123456/abc-def');
    expect(doc.select('a[href*=/dl/]:not([hidden])')).toHaveLength(1);
  });

  it('detects the detail layout via z-cover or h1.book-title', () => {
    expect(parser.canParseDetail(parseHtmlDocument(BOOKCARD_DETAIL))).toBe(true);
    expect(parser.canParseDetail(parseHtmlDocument('<div class="resItemBox"></div>'))).toBe(false);
  });

  it('falls back to the (unfiltered) a.dlButton selector before giving up', () => {
    // The second Kotlin fallback `doc.selectFirst("a.dlButton[href*=/dl/]")` has NO
    // `:not([hidden])`, so a page whose only download link is the hidden template
    // placeholder still resolves (to the dead link). Pinned because it is real behaviour.
    const html = `<h1 class="book-title">书</h1>
      <template><a class="dlButton" href="/dl/hidden" hidden>隐藏</a></template>`;
    expect(parser.parseDetail(parseHtmlDocument(html), BASE).downloadUrl).toBe(
      'https://z-lib.by/dl/hidden',
    );
  });

  it('throws ParseError("未找到下载链接") when the page has no /dl/ anchor at all', () => {
    const html = '<h1 class="book-title">书</h1><z-cover title="封面"></z-cover>';
    expect(() => parser.parseDetail(parseHtmlDocument(html), BASE)).toThrow(ParseError);
    expect(() => parser.parseDetail(parseHtmlDocument(html), BASE)).toThrow('未找到下载链接');
  });

  it('infers the format from the /dl/ suffix when the page has no extension property', () => {
    const html = `<h1 class="book-title">书</h1><a class="dlButton" href="/dl/1/2/book.pdf">x</a>`;
    const detail = parser.parseDetail(parseHtmlDocument(html), BASE);
    expect(detail.format).toBe('pdf');
  });
});

// ---------------------------------------------------------------------------
// Desktop layout (.resItemBox / tr.bookRow / #booksList .item)
// ---------------------------------------------------------------------------

const DESKTOP_SEARCH = `<!doctype html>
<html><head><title>Desktop</title></head>
<body>
<table id="booksList"><tbody>
  <tr class="bookRow">
    <td class="cover"><img src="/c/a.jpg" data-src="/c/a-large.jpg"></td>
    <td class="text">
      <h3><a href="/book/11/aa">三体 (桌面版)</a></h3>
      <div class="authors"><a href="/g/1">刘慈欣</a><a href="/g/2">刘慈欣</a></div>
      <div class="property_extension">MOBI</div>
      <a class="add_to_download_history" href="/dl/11/aa">DL</a>
    </td>
  </tr>
  <tr class="bookRow">
    <td><a href="/s/%E4%B8%89%E4%BD%93">搜索入口</a><a href="/dl/22/bb">DL</a></td>
  </tr>
  <tr class="bookRow"><td>没有书链接的行</td></tr>
</tbody></table>
</body></html>`;

const DESKTOP_DETAIL = `<!doctype html>
<html><head><title>Desktop detail</title></head>
<body>
  <h1 itemprop="name"> 桌面版书名 </h1>
  <div class="property"><a itemprop="author">作者甲</a><a itemprop="author">作者乙</a></div>
  <img class="cover" data-src="/cover/x.jpg">
  <a class="dlButton" href="/dl/33/cc">下载</a>
  <div class="property_extension">PDF</div>
</body></html>`;

describe('DesktopLayoutParser', () => {
  const parser = new DesktopLayoutParser();
  const doc = parseHtmlDocument(DESKTOP_SEARCH);

  it('detects the desktop layout via tr.bookRow / .resItemBox / #booksList .item', () => {
    expect(parser.name).toBe('DesktopLayoutParser');
    expect(parser.canParseSearch(doc)).toBe(true);
    expect(parser.canParseSearch(parseHtmlDocument('<z-bookcard href="/book/1"></z-bookcard>'))).toBe(false);
  });

  it('parses a bookRow with nested author links, cover and extension', () => {
    const books = parser.parseSearch(doc, BASE, 'zlibrary');
    // the third row has no /book/ or /s/ link at all and is skipped
    expect(books).toHaveLength(2);
    expect(books[0]).toMatchObject({
      id: 'book/11/aa',
      title: '三体 (桌面版)',
      author: '刘慈欣, 刘慈欣',
      cover: 'https://z-lib.by/c/a-large.jpg',
      format: 'mobi',
      downloadUrl: 'https://z-lib.by/dl/11/aa',
    });
  });

  it('accepts an /s/ href as the book link when no /book/ link exists', () => {
    const books = parser.parseSearch(doc, BASE, 'zlibrary');
    expect(books[1]?.id).toBe('s/%E4%B8%89%E4%BD%93');
    // no .property_extension in that row → falls back to the URL suffix → then 'epub'
    expect(books[1]?.format).toBe('epub');
  });

  it('parses the detail page, joining multiple author anchors', () => {
    expect(parser.parseDetail(parseHtmlDocument(DESKTOP_DETAIL), BASE)).toEqual({
      title: '桌面版书名',
      author: '作者甲, 作者乙',
      cover: 'https://z-lib.by/cover/x.jpg',
      downloadUrl: 'https://z-lib.by/dl/33/cc',
      format: 'pdf',
    });
  });

  it('falls back to `div:contains(Extension) + div` when .property_extension is absent', () => {
    const html = `<h1 itemprop="name">书</h1>
      <div class="prop"><div>Extension</div><div>EPUB3</div></div>
      <a class="dlButton" href="/dl/9/9">x</a>`;
    const detail = parser.parseDetail(parseHtmlDocument(html), BASE);
    expect(detail.format.toLowerCase()).toBe('epub3');
  });

  it('throws ParseError("未找到下载链接") without any download anchor', () => {
    expect(() => parser.parseDetail(parseHtmlDocument('<h1 itemprop="name">书</h1>'), BASE)).toThrow(
      '未找到下载链接',
    );
  });
});

// ---------------------------------------------------------------------------
// Mobile layout (.book-item / .mobile-book-card / z-bookcard)
// ---------------------------------------------------------------------------

const MOBILE_SEARCH = `<!doctype html>
<html><head><title>Mobile</title></head>
<body>
  <div class="book-item">
    <a href="/book/44/dd"><img class="cover" data-src="/c/m.jpg"></a>
    <div class="book-title">移动版书名</div>
    <div class="book-author">移动作者</div>
    <div class="book-property__extension">AZW3</div>
    <a class="btn-primary" href="/dl/44/dd">下载</a>
  </div>
  <div class="mobile-book-card">
    <a href="/book/45/ee"></a>
    <a class="btn-primary" href="/dl/45/ee">下载</a>
  </div>
</body></html>`;

const MOBILE_DETAIL = `<!doctype html>
<html><head><title>Mobile detail</title></head>
<body>
  <div class="book-title">移动详情书名</div>
  <div class="book-author">移动作者甲</div>
  <img class="cover" data-src="/c/d.jpg">
  <div class="book-property__extension">FB2</div>
  <a class="btn-primary" href="/dl/46/ff">下载</a>
</body></html>`;

describe('MobileLayoutParser', () => {
  const parser = new MobileLayoutParser();

  it('detects the mobile layout and parses both card classes', () => {
    expect(parser.name).toBe('MobileLayoutParser');
    const doc = parseHtmlDocument(MOBILE_SEARCH);
    expect(parser.canParseSearch(doc)).toBe(true);
    const books = parser.parseSearch(doc, BASE, 'zlibrary');
    expect(books).toHaveLength(2);
    expect(books[0]).toMatchObject({
      id: 'book/44/dd',
      title: '移动版书名',
      author: '移动作者',
      cover: 'https://z-lib.by/c/m.jpg',
      format: 'azw3',
      downloadUrl: 'https://z-lib.by/dl/44/dd',
    });
    // no .book-title / .book-author → 未知书名 / 未知作者, format falls back to epub
    expect(books[1]).toMatchObject({
      id: 'book/45/ee',
      title: '未知书名',
      author: '未知作者',
      format: 'epub',
    });
  });

  it('parses the mobile detail page', () => {
    const detail = parser.parseDetail(parseHtmlDocument(MOBILE_DETAIL), BASE);
    expect(detail).toEqual({
      title: '移动详情书名',
      author: '移动作者甲',
      cover: 'https://z-lib.by/c/d.jpg',
      downloadUrl: 'https://z-lib.by/dl/46/ff',
      format: 'fb2',
    });
  });

  it('throws ParseError("未找到移动端下载按钮") without a download anchor', () => {
    const html = '<div class="book-title">书</div><div class="book-property__extension">EPUB</div>';
    expect(() => parser.parseDetail(parseHtmlDocument(html), BASE)).toThrow('未找到移动端下载按钮');
  });
});

// ---------------------------------------------------------------------------
// Legacy layout (plain /book/ links)
// ---------------------------------------------------------------------------

const LEGACY_SEARCH = `<!doctype html>
<html><head><title>Legacy</title></head>
<body>
  <div class="zbook">
    <a href="/book/55/ee">旧版书名</a>
    <a href="/g/9">旧版作者</a>
    <img data-src="/c/l.jpg">
    <a href="/dl/55/ee/legacy.mobi">下载</a>
  </div>
  <div class="zbook">
    <a href="/book/55/ee">旧版书名 重复</a>
  </div>
  <div class="zbook">
    <a href="/book/56/ff"></a>
  </div>
</body></html>`;

describe('LegacyLayoutParser', () => {
  const parser = new LegacyLayoutParser();

  it('parses the first occurrence of each book id and drops the duplicate', () => {
    expect(parser.name).toBe('LegacyLayoutParser');
    const doc = parseHtmlDocument(LEGACY_SEARCH);
    expect(parser.canParseSearch(doc)).toBe(true);
    const books = parser.parseSearch(doc, BASE, 'zlibrary');
    expect(books.map((b) => b.id)).toEqual(['book/55/ee', 'book/56/ff']);
    expect(books[0]).toMatchObject({
      id: 'book/55/ee',
      title: '旧版书名',
      author: '旧版作者',
      cover: 'https://z-lib.by/c/l.jpg',
      // the format comes from the /dl/ URL suffix
      format: 'mobi',
      downloadUrl: 'https://z-lib.by/dl/55/ee/legacy.mobi',
    });
    expect(books[1]).toMatchObject({ id: 'book/56/ff', title: '未知书名', author: '未知作者' });
  });

  it('uses the document <title> for the legacy detail page and 未知作者 always', () => {
    const html = `<html><head><title>  旧版详情标题 </title></head>
      <body><a href="/dl/57/gg/book.epub">下载</a></body></html>`;
    const detail = parser.parseDetail(parseHtmlDocument(html), BASE);
    expect(detail).toEqual({
      title: '旧版详情标题',
      author: '未知作者',
      cover: null,
      downloadUrl: 'https://z-lib.by/dl/57/gg/book.epub',
      format: 'epub',
    });
  });

  it('throws ParseError("未找到通用下载链接") when the page has no /dl/ anchor', () => {
    expect(() => parser.parseDetail(parseHtmlDocument('<title>x</title>'), BASE)).toThrow(
      '未找到通用下载链接',
    );
  });
});

// ---------------------------------------------------------------------------
// Generic fallback layout
// ---------------------------------------------------------------------------

const GENERIC_SEARCH = `<!doctype html>
<html><head><title>Unknown redesign</title></head>
<body>
  <section class="results">
    <article class="card">
      <h3>兜底书名</h3>
      <a href="/book/66/ff"></a>
      <a href="/g/7">兜底作者</a>
      <img data-lazy-src="/c/g.jpg">
      <a href="/dl/66/ff/gen.pdf">下载</a>
      <span class="file-type">PDF</span>
    </article>
    <article class="card">
      <h3>第二本</h3>
      <a href="/book/67/gg">第二本详情</a>
    </article>
  </section>
</body></html>`;

const GENERIC_BOOKCARD_SEARCH = `<!doctype html>
<html><head><title>bookcards without title slot</title></head>
<body>
  <z-bookcard href="book/68/hh" extension="TXT" data-extension="PDF">
    <div class="title-holder">卡片标题</div>
    <div class="author-holder">卡片作者</div>
    <a href="/dl/68/hh">下载</a>
  </z-bookcard>
  <a href="/book/68/hh">同一本书的普通链接（应被去重）</a>
</body></html>`;

describe('GenericFallbackParser', () => {
  const parser = new GenericFallbackParser();

  it('detects any page that links to /book/', () => {
    expect(parser.name).toBe('GenericFallback');
    const doc = parseHtmlDocument(GENERIC_SEARCH);
    expect(parser.canParseSearch(doc)).toBe(true);
    expect(parser.canParseSearch(parseHtmlDocument('<div>nothing</div>'))).toBe(false);
  });

  it('extracts a card from an unknown layout and infers the format from the class name', () => {
    const books = parser.parseSearch(parseHtmlDocument(GENERIC_SEARCH), BASE, 'zlibrary');
    expect(books).toHaveLength(2);
    // the container is the outermost ancestor with exactly one book link
    expect(books[0]).toMatchObject({
      id: 'book/66/ff',
      title: '兜底书名',
      author: '兜底作者',
      format: 'pdf',
      downloadUrl: 'https://z-lib.by/dl/66/ff/gen.pdf',
    });
    // NOTE: the legacy branch of the fallback does NOT absolutise the cover (asymmetric with
    // the z-bookcard branch, which the Kotlin does) — pinned here on purpose.
    expect(books[0]?.cover).toBe('/c/g.jpg');
    expect(books[1]).toMatchObject({ id: 'book/67/gg', title: '第二本详情' });
  });

  it('handles the z-bookcard branch: absolute cover, attribute format, id de-duplication', () => {
    const books = parser.parseSearch(parseHtmlDocument(GENERIC_BOOKCARD_SEARCH), BASE, 'zlibrary');
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      id: 'book/68/hh',
      title: '卡片标题',
      author: '卡片作者',
      format: 'txt',
      downloadUrl: 'https://z-lib.by/dl/68/hh',
    });
  });

  it('parseDetail degrades gracefully instead of throwing', () => {
    const html = `<h1>兜底标题</h1>
      <div class="author-line"><a itemprop="author">作者一</a><a class="author-link">作者二</a></div>
      <img src="/c/dd.jpg">
      <span class="format-label">EPUB</span>
      <a class="dlButton" href="/dl/69/ii">下载</a>`;
    const detail = parser.parseDetail(parseHtmlDocument(html), BASE);
    expect(detail).toEqual({
      title: '兜底标题',
      author: '作者一, 作者二',
      cover: 'https://z-lib.by/c/dd.jpg',
      format: 'epub',
      downloadUrl: 'https://z-lib.by/dl/69/ii',
    });
  });

  it('parseDetail returns empty strings when nothing matches (no throw)', () => {
    const detail = parser.parseDetail(parseHtmlDocument('<p>nothing</p>'), BASE);
    expect(detail).toEqual({ title: '', author: '', cover: '', format: '', downloadUrl: '' });
  });
});

// ---------------------------------------------------------------------------
// CoverExtractor
// ---------------------------------------------------------------------------

describe('CoverExtractor', () => {
  const extract = (html: string): string => {
    const doc = parseHtmlDocument(html);
    return CoverExtractor.extract(doc.selectFirst('div') as HtmlElement);
  };

  it('prefers data-src over src and skips data: URIs', () => {
    expect(extract('<div><img src="data:image/gif;base64,R0lGOD" data-src="/real.jpg"></div>')).toBe('/real.jpg');
  });

  it('prefers the cdn-zlib.sk / s3proxy cover hosts over the first http candidate', () => {
    expect(
      extract(
        '<div><img src="https://other.example.com/a.jpg"><img src="https://s3proxy.example/b.jpg"></div>',
      ),
    ).toBe('https://s3proxy.example/b.jpg');
  });

  it('reads the first entry of an <img> srcset', () => {
    expect(extract('<div><img srcset="/a.jpg 1x, /b.jpg 2x"></div>')).toBe('/a.jpg');
  });

  it('scans every <img> before any <source>, so a <picture> <img src> wins over its srcset', () => {
    // Kotlin order: the `root.select("img")` loop runs BEFORE the
    // `picture source[srcset], source[srcset]` loop, so the fallback <img src> is the
    // first candidate. Pinned because swapping the loops would change the cover URL.
    expect(
      extract('<div><picture><source srcset="/p1.jpg 480w, /p2.jpg 960w"><img src="/fallback.jpg"></picture></div>'),
    ).toBe('/fallback.jpg');
    // with no <img> at all, the <source> srcset is used
    expect(extract('<div><picture><source srcset="/p1.jpg 480w, /p2.jpg 960w"></picture></div>')).toBe(
      '/p1.jpg',
    );
  });

  it('reads background-image from an inline style', () => {
    expect(extract('<div><span style="background-image:url(\'/bg.jpg\')">x</span></div>')).toBe('/bg.jpg');
  });

  it('accepts a protocol-relative cover', () => {
    expect(extract('<div><img data-cover="//cdn.example.com/c.jpg"></div>')).toBe('//cdn.example.com/c.jpg');
  });

  it('returns "" when there is no cover at all', () => {
    expect(extract('<div><span>no images</span></div>')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// ZLibraryParserManager + ZLibraryAccessChecker + ZLibraryParser facade
// ---------------------------------------------------------------------------

describe('ZLibraryParserManager', () => {
  it('detects the layout name for each variant (manager order decides ownership)', () => {
    expect(ZLibraryParserManager.detectLayoutName(BOOKCARD_SEARCH)).toBe('BookcardLayoutParser');
    expect(ZLibraryParserManager.detectLayoutName(DESKTOP_SEARCH)).toBe('DesktopLayoutParser');
    expect(ZLibraryParserManager.detectLayoutName(MOBILE_SEARCH)).toBe('MobileLayoutParser');
    // GENERIC_SEARCH only has plain /book/ links, and LegacyLayoutParser is probed before
    // GenericFallbackParser, so the legacy parser claims it.
    expect(ZLibraryParserManager.detectLayoutName(GENERIC_SEARCH)).toBe('LegacyLayoutParser');
    expect(ZLibraryParserManager.detectLayoutName(LEGACY_SEARCH)).toBe('LegacyLayoutParser');
    expect(ZLibraryParserManager.detectLayoutName('<p>nothing</p>')).toBe('Unknown / Default');
  });

  it('falls back to GenericFallbackParser when the selected parser yields 0 books', () => {
    // a desktop-looking page whose rows carry no /book/ or /s/ link at all
    const html = `<table id="booksList"><tr class="bookRow"><td>
      <a href="/dl/70/jj">DL</a><a href="/book/70/jj"></a></tr></table>`;
    const books = ZLibraryParserManager.parseSearchPage(html, BASE, 'zlibrary');
    // the fallback recovers the book via the plain /book/ link
    expect(books).toHaveLength(1);
    expect(books[0]?.id).toBe('book/70/jj');
  });

  it('routes detail pages by canParseDetail', () => {
    const detail = ZLibraryParserManager.parseDetailPage(BOOKCARD_DETAIL, BASE);
    expect(detail.title).toBe('三体');
    expect(detail.downloadUrl).toBe('https://z-lib.by/dl/123456/abc-def');
  });

  it('rejects a Cloudflare interstitial before parsing', () => {
    const html = '<html><head><title>Just a moment...</title></head><body></body></html>';
    expect(() => ZLibraryParserManager.parseSearchPage(html, BASE)).toThrow(NetworkError);
  });

  it('rejects a login wall with LoginRequired', () => {
    const html = `<html><head><title>Login</title></head><body>
      <form action="/login"><input name="email"><input name="password"></form></body></html>`;
    expect(() => ZLibraryParserManager.parseSearchPage(html, BASE)).toThrow(LoginRequired);
  });
});

describe('ZLibraryAccessChecker', () => {
  const response = (code: number, server: string | null = null): { code: number; header: (n: string) => string | null } => ({
    code,
    header: (n: string) => (n === 'Server' ? server : null),
  });

  it('throws NetworkError for 403/503 with a cloudflare Server header', () => {
    expect(() => ZLibraryAccessChecker.checkResponse(response(403, 'cloudflare'))).toThrow(NetworkError);
    expect(() => ZLibraryAccessChecker.checkResponse(response(503, 'Cloudflare'))).toThrow(
      '触发 Cloudflare 防火墙保护 (HTTP 503)',
    );
    // no Server header → no throw
    expect(() => ZLibraryAccessChecker.checkResponse(response(503, null))).not.toThrow();
    // 200 is not a challenge code
    expect(() => ZLibraryAccessChecker.checkResponse(response(200, 'cloudflare'))).not.toThrow();
  });

  it('rejects challenge titles and login walls from the parsed document', () => {
    const challenge = parseHtmlDocument('<head><title>Attention Required! | Cloudflare</title></head>');
    expect(() => ZLibraryAccessChecker.checkResponse(response(200), challenge)).toThrow(
      '触发 Cloudflare 人机验证，请更换节点或检查网页访问状态',
    );
    const login = parseHtmlDocument(
      '<head><title>Sign in</title></head><body><form action="/login"><input name="email"></form></body>',
    );
    expect(() => ZLibraryAccessChecker.checkResponse(response(200), login)).toThrow(LoginRequired);
    // a login form alongside real book cards is not treated as a login wall
    const mixed = parseHtmlDocument(
      '<head><title>Sign in</title></head><body><form action="/login"><input name="email"></form><z-bookcard href="/book/1"></z-bookcard></body>',
    );
    expect(() => ZLibraryAccessChecker.checkResponse(response(200), mixed)).not.toThrow();
  });
});

describe('ZLibraryParser facade + guessFileFormatFromUrl', () => {
  it('delegates to the manager', () => {
    expect(ZLibraryParser.parseSearchPage(BOOKCARD_SEARCH, BASE)).toHaveLength(3);
    expect(ZLibraryParser.parseDetailPage(BOOKCARD_DETAIL, BASE).title).toBe('三体');
  });

  it('guesses the format from the path suffix then the ?format= parameter', () => {
    expect(guessFileFormatFromUrl('/dl/123/abc.mobi')).toBe('mobi');
    expect(guessFileFormatFromUrl('https://x/dl/1/a.EPUB?x=1')).toBe('epub');
    expect(guessFileFormatFromUrl('https://x/dl?format=azw3')).toBe('azw3');
    expect(guessFileFormatFromUrl('https://x/dl?a=1&format=pdf#h')).toBe('pdf');
    expect(guessFileFormatFromUrl('https://x/dl?format=exe')).toBeNull();
    expect(guessFileFormatFromUrl('https://x/dl/1/a')).toBeNull();
    expect(guessFileFormatFromUrl(null)).toBeNull();
    expect(guessFileFormatFromUrl('   ')).toBeNull();
  });
});
