/**
 * Unit tests for `src/core/library/zLibraryCoverLoader.ts` (the port of
 * `com.example.library.ZLibraryCoverLoader.kt`) and
 * `src/core/library/zLibraryNovelMetadata.ts` (the port of
 * `com.example.library.ZLibraryNovelMetadata.kt`).
 *
 * Covered:
 *  - cover request normalisation (User-Agent / anti-hotlink Referer / merged Cookie jar,
 *    the blank-cookie filter and the conditional `Cookie` header),
 *  - cookie-header redaction,
 *  - the loader singleton + system-proxy resolution,
 *  - the metadata parser: the actual-property-layout fixture from
 *    `ZLibraryNovelMetadataTest.kt`, the `book-property__*` fallback layout, the
 *    `substringAfter(':')` branch, tag extraction and the fact-joining separators.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCoverRequestHeaders,
  buildLoader,
  COVER_LOADER_CONFIG,
  COVER_USER_AGENT,
  createDefaultCoverLoader,
  redactCoverCookieHeader,
  ZLibraryCoverLoader,
} from '../../src/core/library/zLibraryCoverLoader';
import {
  cloneElement,
  isNotBlank,
  property,
  substringAfterColon,
  wholeTextOf,
  zLibraryNovelMetadata,
} from '../../src/core/library/zLibraryNovelMetadata';
import { parseHtmlDocument } from '../../src/core/source/zlibrary/parser/htmlDocument';
import { setNodeDomain } from '../../src/core/library/zLibraryNodeConfig';
import type { SystemProxyProvider } from '../../src/core/source/zlibrary/network/systemProxyResolver';
import type { ZLibraryNodeConfigPort } from '../../src/core/source/zlibrary/zLibraryHost';
import type { HtmlRuntimeCookieStore } from '../../src/core/source/zlibrary/zLibraryWebViewHelper';

const NODE = 'z-lib.by';

function createCookies(values: Record<string, string> = {}): HtmlRuntimeCookieStore {
  const map = new Map<string, string>(Object.entries(values));
  return {
    setAcceptCookie: () => {},
    setAcceptThirdPartyCookies: () => {},
    setCookie: () => {},
    flush: () => {},
    getCookie: (url: string) => map.get(url) ?? null,
  };
}

function createNodeConfig(domain: string): ZLibraryNodeConfigPort {
  let current = domain;
  return {
    nodeDomain: () => current,
    setNodeDomain: (next: string) => {
      current = next;
    },
  };
}

/* ── cover loader ─────────────────────────────────────────────────────── */

describe('buildCoverRequestHeaders', () => {
  it('always sends the mobile Chrome UA and the anti-hotlink node Referer', () => {
    const headers = buildCoverRequestHeaders({
      url: 'https://covers.1lib.sk/a.jpg',
      cookie: null,
      nodeCookie: null,
      nodeDomain: NODE,
    });
    expect(headers['User-Agent']).toBe(COVER_USER_AGENT);
    expect(headers['User-Agent']).toContain('AppleWebKit/537.36');
    expect(headers['Referer']).toBe(`https://${NODE}/`);
    expect('Cookie' in headers).toBe(false);
  });

  it('merges the CDN cookie and the node session cookie with "; "', () => {
    const headers = buildCoverRequestHeaders({
      url: 'https://covers.1lib.sk/a.jpg',
      cookie: 'dwid=1',
      nodeCookie: 'remix_userid=42; remix_userkey=abc',
      nodeDomain: NODE,
    });
    expect(headers['Cookie']).toBe('dwid=1; remix_userid=42; remix_userkey=abc');
  });

  it('drops blank cookie halves instead of emitting "; "', () => {
    const headers = buildCoverRequestHeaders({
      url: 'https://covers.1lib.sk/a.jpg',
      cookie: 'dwid=1',
      nodeCookie: '   ',
      nodeDomain: NODE,
    });
    expect(headers['Cookie']).toBe('dwid=1');
  });

  it('normalises the Referer to the bare node origin with a trailing slash', () => {
    expect(
      buildCoverRequestHeaders({ url: 'https://c/x.jpg', cookie: null, nodeCookie: null, nodeDomain: '1lib.sk' })[
        'Referer'
      ],
    ).toBe('https://1lib.sk/');
  });
});

describe('redactCoverCookieHeader', () => {
  it('masks every cookie value but keeps the names', () => {
    expect(redactCoverCookieHeader('dwid=1; remix_userkey=abc')).toBe('dwid=[redacted]; remix_userkey=[redacted]');
  });

  it('returns an empty string unchanged', () => {
    expect(redactCoverCookieHeader('')).toBe('');
    expect(redactCoverCookieHeader('   ')).toBe('');
  });
});

describe('buildLoader', () => {
  const proxyProvider: SystemProxyProvider = {
    defaultProxy: () => ({ host: '127.0.0.1', port: 7890 }),
    selectDefaultProxy: () => null,
  };

  it('carries the Kotlin client configuration verbatim', () => {
    expect(COVER_LOADER_CONFIG).toEqual({
      connectTimeoutMs: 10_000,
      readTimeoutMs: 15_000,
      useZLibraryDns: true,
    });
  });

  it('resolves the system proxy and keeps crossfade on', () => {
    const loader = buildLoader({
      cookies: createCookies(),
      proxyProvider,
      nodeConfig: createNodeConfig(NODE),
    });
    expect(loader.proxy).toEqual({ host: '127.0.0.1', port: 7890 });
    expect(loader.crossfade).toBe(true);
  });

  it('accepts a null proxy provider (no platform wiring)', () => {
    const loader = buildLoader({
      cookies: createCookies(),
      proxyProvider: null,
      nodeConfig: createNodeConfig(NODE),
    });
    expect(loader.proxy).toBeNull();
  });

  it('builds per-request headers from both cookie jars and redacts them for diagnostics', () => {
    const loader = buildLoader({
      cookies: createCookies({
        'https://covers.1lib.sk/a.jpg': 'dwid=1',
        [`https://${NODE}/`]: 'remix_userkey=abc',
      }),
      proxyProvider: null,
      nodeConfig: createNodeConfig(NODE),
    });
    const headers = loader.headersFor('https://covers.1lib.sk/a.jpg');
    expect(headers['Cookie']).toBe('dwid=1; remix_userkey=abc');
    expect(headers['Referer']).toBe(`https://${NODE}/`);
    expect(loader.describeHeadersFor('https://covers.1lib.sk/a.jpg')['Cookie']).toBe(
      'dwid=[redacted]; remix_userkey=[redacted]',
    );
  });

  it('follows the live node domain when it changes', () => {
    const nodeConfig = createNodeConfig(NODE);
    const loader = buildLoader({ cookies: createCookies(), proxyProvider: null, nodeConfig });
    expect(loader.headersFor('https://c/x.jpg')['Referer']).toBe(`https://${NODE}/`);
    nodeConfig.setNodeDomain('1lib.sk');
    expect(loader.headersFor('https://c/x.jpg')['Referer']).toBe('https://1lib.sk/');
  });
});

describe('ZLibraryCoverLoader singleton', () => {
  beforeEach(() => {
    ZLibraryCoverLoader.reset();
  });

  it('reuses the cached loader (Kotlin cachedLoader ?: …)', () => {
    const deps = { cookies: createCookies(), proxyProvider: null, nodeConfig: createNodeConfig(NODE) };
    const first = ZLibraryCoverLoader.get(deps);
    const second = ZLibraryCoverLoader.get(deps);
    expect(second).toBe(first);
    expect(ZLibraryCoverLoader.peek()).toBe(first);
  });

  it('reset() rebuilds it', () => {
    const deps = { cookies: createCookies(), proxyProvider: null, nodeConfig: createNodeConfig(NODE) };
    const first = ZLibraryCoverLoader.get(deps);
    ZLibraryCoverLoader.reset();
    expect(ZLibraryCoverLoader.peek()).toBeNull();
    expect(ZLibraryCoverLoader.get(deps)).not.toBe(first);
  });

  it('createDefaultCoverLoader wires the global node config', () => {
    setNodeDomain('1lib.sk');
    try {
      const loader = createDefaultCoverLoader(createCookies());
      expect(loader.headersFor('https://c/x.jpg')['Referer']).toBe('https://1lib.sk/');
    } finally {
      setNodeDomain('');
    }
  });

  it('mirrors the Kotlin string when the selection has not been restored yet', () => {
    setNodeDomain('');
    const loader = buildLoader({
      cookies: createCookies(),
      proxyProvider: null,
      nodeConfig: createNodeConfig(''),
    });
    // Kotlin builds "https://${ZLibraryNodeConfig.domain}/" with no blank check either.
    expect(loader.headersFor('https://c/x.jpg')['Referer']).toBe('https:///');
  });
});

/* ── novel metadata ───────────────────────────────────────────────────── */

describe('zLibraryNovelMetadata', () => {
  // Verbatim fixture from app/src/test/java/com/example/library/ZLibraryNovelMetadataTest.kt
  const actualLayout = `
    <div id="bookDescriptionBox"><p>小说简介。</p><script>tracking()</script><button>展开</button></div>
    <div class="property_publisher"><div class="property_value">人民文学出版社</div></div>
    <div class="property_year"><div class="property_value">2024</div></div>
    <div class="property_pages"><div class="property_value">320</div></div>
    <div class="property_isbn13"><div class="property_value">9780000000001</div></div>
    <div class="property_categories"><div class="property_value"><a>小说</a></div></div>
  `;

  it('actualPropertyLayoutProvidesPlainSynopsisAndBibliographicFacts', () => {
    const info = zLibraryNovelMetadata(actualLayout);
    expect(info.synopsis).toBe('小说简介。');
    expect(info.publisher).toBe('人民文学出版社');
    expect(info.tags).toEqual(['小说']);
    expect(info.notice).toContain('出版年份：2024');
    expect(info.notice).toContain('页数：320');
    expect(info.notice).toContain('ISBN-13：9780000000001');
    expect(zLibraryNovelMetadata('<html></html>').synopsis).toBeNull();
  });

  it('leaves untouched NovelInfo fields at their Kotlin defaults', () => {
    const info = zLibraryNovelMetadata(actualLayout);
    expect(info.originalTitle).toBeNull();
    expect(info.status).toBeNull();
    expect(info.category).toBeNull();
    expect(info.latestChapter).toBeNull();
    expect(info.chapterCount).toBeNull();
    expect(info.wordCount).toBeNull();
    expect(info.translation).toBeNull();
  });

  it('joins the facts with " · " in the Kotlin order and omits missing ones', () => {
    const info = zLibraryNovelMetadata(`
      <div class="property_year"><div class="property_value">2024</div></div>
      <div class="property_isbn"><div class="property_value">9780000000000</div></div>
    `);
    expect(info.notice).toBe('出版年份：2024 · ISBN：9780000000000');
  });

  it('supports the book-property__* layout and the colon-separated fallback', () => {
    const info = zLibraryNovelMetadata(`
      <div class="book-property__publisher"><span class="property_value">译林出版社</span></div>
      <div class="property_year">出版年份: 2019</div>
    `);
    expect(info.publisher).toBe('译林出版社');
    expect(info.notice).toContain('出版年份：2019');
  });

  it('drops blank tag anchors', () => {
    const info = zLibraryNovelMetadata(`
      <div class="property_categories"><div class="property_value"><a>小说</a><a>  </a><a>文学</a></div></div>
    `);
    expect(info.tags).toEqual(['小说', '文学']);
  });

  it('strips script/style/button from the synopsis without touching the source document', () => {
    const html = `
      <div class="book-description">
        第一段。<script>var a = "b";</script><style>.x{}</style><button>更多</button>第二段。
      </div>`;
    const info = zLibraryNovelMetadata(html);
    // `wholeText()` inserts NO block-element padding (unlike `text()`), so the paragraphs run
    // together exactly as they do on Android.
    expect(info.synopsis).toBe('第一段。第二段。');
    // the input html is untouched — the Kotlin clones before stripping
    expect(html).toContain('<script>');
  });

  it('accepts every Kotlin synopsis selector in order', () => {
    expect(zLibraryNovelMetadata('<div itemprop="description">A</div>').synopsis).toBe('A');
    expect(zLibraryNovelMetadata('<div id="description">B</div>').synopsis).toBe('B');
    expect(zLibraryNovelMetadata('<div class="book-description">C</div>').synopsis).toBe('C');
  });

  it('returns a blank-free synopsis or null', () => {
    expect(zLibraryNovelMetadata('<div id="bookDescriptionBox">   </div>').synopsis).toBeNull();
  });
});

describe('metadata helpers', () => {
  it('property() prefers the property_value branch and falls back to after the colon', () => {
    const doc = parseHtmlDocument(
      '<div class="property_year"><div class="property_value">2024</div></div>' +
        '<div class="property_pages">页数: 320</div>',
    );
    expect(property(doc, 'year')).toBe('2024');
    expect(property(doc, 'pages')).toBe('320');
    expect(property(doc, 'isbn')).toBeNull();
  });

  it('substringAfterColon returns the whole string when the delimiter is absent', () => {
    expect(substringAfterColon('a:b:c')).toBe('b:c');
    expect(substringAfterColon('no delimiter')).toBe('no delimiter');
  });

  it('wholeTextOf concatenates text without block-element padding and trims', () => {
    const doc = parseHtmlDocument('<div><p>一</p><p>二</p></div>');
    const el = doc.selectFirst('div');
    expect(el).not.toBeNull();
    expect(wholeTextOf(el as NonNullable<typeof el>)).toBe('一二');
  });

  it('cloneElement is a deep copy', () => {
    const doc = parseHtmlDocument('<div id="x"><p>text</p></div>');
    const el = doc.selectFirst('#x');
    expect(el).not.toBeNull();
    const copy = cloneElement(el as NonNullable<typeof el>);
    expect(copy).not.toBe(el);
    expect(copy.outerHtml()).toBe(el?.outerHtml());
  });

  it('isNotBlank mirrors Kotlin', () => {
    expect(isNotBlank('a')).toBe(true);
    expect(isNotBlank('  ')).toBe(false);
  });
});