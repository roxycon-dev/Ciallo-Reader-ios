/**
 * Regression tests for the line-by-line review of the `zlibrary` + `library` module.
 *
 * Every test below pins a behaviour that the Kotlin source (`source/zlibrary/**`,
 * `library/ZLibrary*.kt`) defines and that the TypeScript port had wrong, plus the two
 * "counter-intuitive asymmetries" that must be copied verbatim rather than fixed.
 *
 * Kotlin line references are inline.
 */
import { describe, expect, it } from 'vitest';
import { BookcardLayoutParser } from '../../src/core/source/zlibrary/parser/bookcardLayoutParser';
import { DesktopLayoutParser } from '../../src/core/source/zlibrary/parser/desktopLayoutParser';
import { GenericFallbackParser } from '../../src/core/source/zlibrary/parser/genericFallbackParser';
import { LegacyLayoutParser } from '../../src/core/source/zlibrary/parser/legacyLayoutParser';
import { MobileLayoutParser } from '../../src/core/source/zlibrary/parser/mobileLayoutParser';
import { parseHtmlDocument, type HtmlElement } from '../../src/core/source/zlibrary/parser/htmlDocument';
import { DiamWallInterceptor } from '../../src/core/source/zlibrary/diamWallInterceptor';
import { guessFileFormatFromUrl } from '../../src/core/source/zlibrary/parsedBookDetail';
import { JAVA_PUNCT_WHITESPACE } from '../../src/core/source/zlibrary/zLibrarySource';
import { parseIpString } from '../../src/core/source/zlibrary/network/zLibraryDns';
import { ZLibraryEapiClient } from '../../src/core/source/zlibrary/zLibraryEapiClient';
import { javaUrlEncode } from '../../src/core/source/zlibrary/zLibraryHost';
import type {
  ZLibraryHttpRequestSpec,
  ZLibraryHttpResponse,
  ZLibraryHttpTransport,
} from '../../src/core/source/zlibrary/network/zLibraryHttpClient';
import type { ZLibraryCredentialStorage } from '../../src/core/source/zlibrary/zLibraryCredentialStorage';

// ---------------------------------------------------------------------------
// guessFileFormatFromUrl — Kotlin ZLibraryParser.kt L22-37
// ---------------------------------------------------------------------------

describe('guessFileFormatFromUrl — the "#" cut was missing', () => {
  it('strips the fragment before testing the suffix (Kotlin L25 substringBefore(\'#\'))', () => {
    // Kotlin: lower.substringBefore('?').substringBefore('#') → "/dl/1/a.epub" → "epub".
    expect(guessFileFormatFromUrl('/dl/1/a.epub#frag')).toBe('epub');
    expect(guessFileFormatFromUrl('/dl/1/a.epub?x=1#frag')).toBe('epub');
    // '?' is applied FIRST, so '#' only ever sees the already-truncated string.
    expect(guessFileFormatFromUrl('/dl/1/a.epub?a=1')).toBe('epub');
    expect(guessFileFormatFromUrl('/dl/1/a.epub?a=1#z')).toBe('epub');
  });

  it('still reads the format= query parameter after the "?" cut (Kotlin L32-34)', () => {
    expect(guessFileFormatFromUrl('/dl/1/abc?format=azw3')).toBe('azw3');
    // the query is only reached when the path suffix is not a known format
    expect(guessFileFormatFromUrl('/dl/1/abc?format=zzz')).toBeNull();
    expect(guessFileFormatFromUrl('')).toBeNull();
    expect(guessFileFormatFromUrl(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BookcardLayoutParser.parseDetail — Kotlin L79-120
// ---------------------------------------------------------------------------

describe('BookcardLayoutParser.parseDetail — jsoup elvis semantics', () => {
  const parser = new BookcardLayoutParser();
  const detail = (html: string) => parser.parseDetail(parseHtmlDocument(html), 'https://1lib.sk');

  it('reads the z-cover title from its ATTRIBUTE, not its children (Kotlin L81)', () => {
    // Kotlin: doc.selectFirst("h1.book-title, h1[itemprop=name], h1") is null →
    //         doc.selectFirst("z-cover")?.attr("title")?.trim()
    // Reading .text() would have produced the <img alt> instead.
    const out = detail(
      '<html><body><z-cover title="三体（全集）" author="刘慈欣"><img src="/c.jpg" alt="封面图"></z-cover>' +
        '<a class="dlButton" href="/dl/1/2/a.epub">下载</a></body></html>',
    );
    expect(out.title).toBe('三体（全集）');
    expect(out.author).toBe('刘慈欣');
  });

  it('keeps a present-but-blank <h1> blank instead of substituting 未知书名 (Kotlin L80-82)', () => {
    // Kotlin `?.text()?.trim()` is only null when the ELEMENT is absent, so "" survives.
    const out = detail(
      '<html><body><h1 class="book-title">   </h1>' +
        '<a class="dlButton" href="/dl/1/2/a.epub">下载</a></body></html>',
    );
    expect(out.title).toBe('');
  });

  it('substitutes 未知书名 only when NO title element exists at all (Kotlin L82)', () => {
    const out = detail(
      '<html><body><z-cover title="  "></z-cover>' +
        '<a class="dlButton" href="/dl/1/2/a.epub">下载</a></body></html>',
    );
    // `z-cover` exists, `attr("title")` is "  " → trimmed to "" → non-null → kept
    expect(out.title).toBe('');
  });

  it('reads the z-bookcard format from its ATTRIBUTE and keeps a blank element blank (Kotlin L107-111)', () => {
    const viaAttr = detail(
      '<html><body><h1 class="book-title">书名</h1><z-bookcard extension="MOBI"></z-bookcard>' +
        '<a class="dlButton" href="/dl/1/2/a.pdf">下载</a></body></html>',
    );
    expect(viaAttr.format).toBe('mobi');

    const blankElement = detail(
      '<html><body><h1 class="book-title">书名</h1><div class="book-property__extension">  </div>' +
        '<a class="dlButton" href="/dl/1/2/a.pdf">下载</a></body></html>',
    );
    // element present → text() "" wins; the URL suffix is NOT consulted
    expect(blankElement.format).toBe('');
  });

  it('uses ifBlank for data-src so a whitespace-only value falls through to src (Kotlin L93)', () => {
    const out = detail(
      '<html><body><h1 class="book-title">书名</h1>' +
        '<img class="cover" data-src="   " src="/covers/real.jpg">' +
        '<a class="dlButton" href="/dl/1/2/a.epub">下载</a></body></html>',
    );
    expect(out.cover).toBe('https://1lib.sk/covers/real.jpg');
  });
});

describe('BookcardLayoutParser.parseSearch — ifBlank on data-src (Kotlin L40)', () => {
  it('falls back to src when data-src is whitespace-only', () => {
    const parser = new BookcardLayoutParser();
    const books = parser.parseSearch(
      parseHtmlDocument(
        '<z-bookcard href="/book/1/2/a"><div slot="title">书</div>' +
          '<img data-src="  " src="/covers/1.jpg"></z-bookcard>',
      ),
      'https://1lib.sk',
      'zlibrary',
    );
    expect(books[0]?.cover).toBe('https://1lib.sk/covers/1.jpg');
  });
});

// ---------------------------------------------------------------------------
// ifBlank on data-src in the other three parsers
// ---------------------------------------------------------------------------

describe('ifBlank on data-src (Kotlin DesktopLayoutParser L80, Mobile L73, Legacy L34)', () => {
  it('DesktopLayoutParser.parseDetail uses src when data-src is blank', () => {
    const out = new DesktopLayoutParser().parseDetail(
      parseHtmlDocument(
        '<h1 itemprop="name">书</h1><img class="cover" data-src=" " src="/c/d.jpg">' +
          '<a class="dlButton" href="/dl/1/2/a.epub">x</a>',
      ),
      'https://z-lib.by',
    );
    expect(out.cover).toBe('https://z-lib.by/c/d.jpg');
  });

  it('MobileLayoutParser.parseDetail uses src when data-src is blank', () => {
    const out = new MobileLayoutParser().parseDetail(
      parseHtmlDocument(
        '<div class="book-title">书</div><img data-src="" src="/c/m.jpg">' +
          '<a class="dlButton" href="/dl/1/2/a.epub">x</a>',
      ),
      'https://z-lib.by',
    );
    expect(out.cover).toBe('https://z-lib.by/c/m.jpg');
  });

  it('LegacyLayoutParser.parseSearch uses src when data-src is blank', () => {
    const books = new LegacyLayoutParser().parseSearch(
      parseHtmlDocument(
        '<div><a href="/book/1/2/abc">书名很长</a><img data-src=" " src="/c/l.jpg"></div>',
      ),
      'https://z-lib.by',
      'zlibrary',
    );
    expect(books[0]?.cover).toBe('https://z-lib.by/c/l.jpg');
  });
});

// ---------------------------------------------------------------------------
// GenericFallbackParser — Kotlin L42 ifBlank + bestContainer's html/body stop
// ---------------------------------------------------------------------------

describe('GenericFallbackParser', () => {
  it('falls through to the inner /dl/ link when the download attribute is blank (Kotlin L42)', () => {
    const books = new GenericFallbackParser().parseSearch(
      parseHtmlDocument(
        '<z-bookcard href="/book/1/2/abc" download="  ">' +
          '<div slot="title">书名</div><a href="/dl/1/2/abc">DL</a></z-bookcard>',
      ),
      'https://1lib.sk',
      'zlibrary',
    );
    expect(books).toHaveLength(1);
    expect(books[0]?.downloadUrl).toBe('https://1lib.sk/dl/1/2/abc');
  });

  it('bestContainer stops at <body> instead of walking up to the document (Kotlin L101)', () => {
    // Requires the jsoup-equivalent <html><head><body> wrapper; without it `link.parents()`
    // would reach #document and the whole page would be chosen as the container.
    const books = new GenericFallbackParser().parseSearch(
      parseHtmlDocument(
        '<body><div id="list"><div class="cell"><a href="/book/1/2/abc">书名</a>' +
          '<img data-src="/c/1.jpg"></div></div><p>页脚文字</p></body>',
      ),
      'https://1lib.sk',
      'zlibrary',
    );
    expect(books).toHaveLength(1);
    expect(books[0]?.id).toBe('book/1/2/abc');
    expect(books[0]?.title).toBe('书名');
    expect(books[0]?.cover).toBe('/c/1.jpg');
  });
});

// ---------------------------------------------------------------------------
// parseIpString — Kotlin ZLibraryDns.kt L215-227 (String.toInt throws)
// ---------------------------------------------------------------------------

describe('parseIpString — Kotlin String.toInt() strictness (ZLibraryDns L217-222)', () => {
  it('accepts the four octets Kotlin parses', () => {
    expect(parseIpString('223.5.5.5')).toBe('223.5.5.5');
    expect(parseIpString('  8.8.4.4  ')).toBe('8.8.4.4');
    // Kotlin `Int.toByte()` truncates, so 300 -> 44 and -1 -> 255
    expect(parseIpString('1.2.3.300')).toBe('1.2.3.44');
    expect(parseIpString('1.2.3.-1')).toBe('1.2.3.255');
  });

  it('rejects anything Kotlin would have thrown on', () => {
    // `Number.parseInt` happily parses a PREFIX; Kotlin's `String.toInt()` does not.
    expect(parseIpString('1.2.3.4abc')).toBeNull();
    expect(parseIpString('0x10.0.0.1')).toBeNull();
    expect(parseIpString('1.2.3.')).toBeNull();
    expect(parseIpString('1.2.3')).toBeNull();
    expect(parseIpString('1.2.3.4.5')).toBeNull();
    expect(parseIpString('::1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DiamWall — Kotlin DiamWallInterceptor.kt
// ---------------------------------------------------------------------------

class OneShotTransport implements ZLibraryHttpTransport {
  readonly urls: string[] = [];
  constructor(private readonly script: (n: number) => Partial<ZLibraryHttpResponse>) {}
  async send(spec: ZLibraryHttpRequestSpec): Promise<ZLibraryHttpResponse> {
    const n = this.urls.length;
    this.urls.push(spec.url);
    const partial = this.script(n);
    const code = partial.code ?? 200;
    return {
      code,
      url: partial.url ?? spec.url,
      headers: partial.headers ?? {},
      setCookies: partial.setCookies ?? [],
      body: partial.body ?? '',
      isSuccessful: code >= 200 && code <= 299,
      close: () => {},
    };
  }
}

const NOOP_JAR = { saveFromResponse: async () => {} };

function interceptWith(transport: ZLibraryHttpTransport, url: string) {
  return new DiamWallInterceptor({ transport, cookieJar: NOOP_JAR }).intercept({
    url,
    referer: null,
    extraHeaders: {},
  });
}

describe('DiamWallInterceptor — legacy SHA-256 branch', () => {
  it('returns the challenge immediately when DIFF is outside 0..6 (Kotlin L216 solveSha256 guard)', () => {
    for (const diff of [7, 9, 99]) {
      const transport = new OneShotTransport((n) =>
        n === 0
          ? {
              code: 200,
              headers: { 'Content-Type': 'text/html' },
              body: `<html>Checking your browser<script>var TOKEN="deadbeefcafe"; var DIFF=${diff};</script></html>`,
            }
          : { code: 200, body: '<html>passed</html>' },
      );
      const done = interceptWith(transport, 'https://1lib.sk/s/x');
      expect(transport.urls).toHaveLength(1);
      return done.then((response) => {
        expect(response.code).toBe(200);
        expect(transport.urls).toHaveLength(1);
      });
    }
    return Promise.resolve();
  });

  it('builds /__ab/verify with URLEncoder semantics, not encodeURIComponent (Kotlin L162)', async () => {
    const transport = new OneShotTransport((n) =>
      n === 0
        ? {
            code: 200,
            headers: { 'Content-Type': 'text/html' },
            // a path with a space and a `!` — the two characters the two encoders disagree on
            body: '<html>Checking your browser<script>var TOKEN="deadbeef cafe!"; var DIFF=1;</script></html>',
          }
        : { code: 200, body: '<html>passed</html>' },
    );
    await interceptWith(transport, 'https://1lib.sk/s/a b');
    expect(transport.urls).toHaveLength(2);
    const verify = transport.urls[1] as string;
    expect(verify.startsWith('https://1lib.sk/__ab/verify?')).toBe(true);
    // space → `+` and `!` → `%21` are java.net.URLEncoder's behaviour (javaUrlEncode),
    // whereas encodeURIComponent would have produced `%20` and kept `!` literal.
    expect(verify).toContain('t=deadbeef+cafe%21');
    // Kotlin L159 builds `r` from `request.url.encodedPath`, which is ALREADY percent-encoded,
    // so its `%20` is re-encoded to `%2520` by URLEncoder — the port reproduces that.
    expect(verify).toContain('r=%2Fs%2Fa%2520b');
    expect(javaUrlEncode('deadbeef cafe!')).toBe('deadbeef+cafe%21');
  });
});

// ---------------------------------------------------------------------------
// eapi — org.json coercion (Kotlin org.json optInt / optBoolean)
// ---------------------------------------------------------------------------

class JsonTransport implements ZLibraryHttpTransport {
  constructor(private readonly body: string) {}
  async send(spec: ZLibraryHttpRequestSpec): Promise<ZLibraryHttpResponse> {
    return {
      code: 200,
      url: spec.url,
      headers: {},
      setCookies: [],
      body: this.body,
      isSuccessful: true,
      close: () => {},
    };
  }
}

/** `ZLibraryHttpClient.get/postForm` 传给 transport 的最小请求；URL 由调用方决定。 */
function jsonGet(url: string, body: string): Promise<ZLibraryHttpResponse> {
  return new JsonTransport(body).send({
    method: 'GET',
    url,
    referer: null,
    extraHeaders: {},
    formFields: null,
    callTimeoutMs: null,
  });
}

const STORAGE_STUB = {
  isLoggedIn: async () => true,
  getUserId: async () => null,
  getUserKey: async () => null,
  getDomain: async () => '1lib.sk',
  getCookies: async () => null,
  saveCredentials: async () => {},
} as unknown as ZLibraryCredentialStorage;

const HTTP_STUB = {
  get: async (url: string) => jsonGet(url, JSON.stringify({ success: 1 })),
  postForm: async (url: string) => jsonGet(url, JSON.stringify({ success: 1 })),
} as unknown as ConstructorParameters<typeof ZLibraryEapiClient>[0];

describe('ZLibraryEapiClient — org.json option coercion', () => {
  it('treats "success":"1" (a numeric string) as success (org.json optInt coerces)', async () => {
    const client = new ZLibraryEapiClient(
      {
        postForm: async (url: string) =>
          jsonGet(
            url,
            JSON.stringify({
              success: '1',
              books: [{ url: '/book/1/2/abc', id: '1', hash: 'h', title: '书' }],
            }),
          ),
        get: async (url: string) => jsonGet(url, '{}'),
      } as unknown as ConstructorParameters<typeof ZLibraryEapiClient>[0],
      STORAGE_STUB,
    );
    const books = await client.search('三体', '1lib.sk');
    expect(books).toHaveLength(1);
    expect(books[0]?.title).toBe('书');
  });

  it('treats allowDownload:"false" as blocked (org.json optBoolean coerces)', async () => {
    const client = new ZLibraryEapiClient(
      {
        get: async (url: string) =>
          jsonGet(
            url,
            JSON.stringify({
              success: 1,
              file: { allowDownload: 'false', disallowDownloadMessage: '<b>今日</b>额度已用尽' },
            }),
          ),
        postForm: async (url: string) => jsonGet(url, '{}'),
      } as unknown as ConstructorParameters<typeof ZLibraryEapiClient>[0],
      STORAGE_STUB,
    );
    const result = await client.getDownloadLinkResult('1', 'h', '1lib.sk');
    expect(result.url).toBeNull();
    // `<b>` is not one of the break tags `htmlToText` reproduces, so it collapses with no space
    expect(result.disallowMessage).toBe('今日额度已用尽');
  });

  it('falls back to the default quota message for a blank HTML message (Kotlin L241)', async () => {
    const client = new ZLibraryEapiClient(
      {
        get: async (url: string) =>
          jsonGet(url, JSON.stringify({ success: 1, file: { allowDownload: false } })),
        postForm: async (url: string) => jsonGet(url, '{}'),
      } as unknown as ConstructorParameters<typeof ZLibraryEapiClient>[0],
      STORAGE_STUB,
    );
    const result = await client.getDownloadLinkResult('1', 'h', '1lib.sk');
    expect(result.disallowMessage).toBe('今日下载次数已达上限，请等待额度重置或提升下载额度');
  });
  void HTTP_STUB;
});

// ---------------------------------------------------------------------------
// ZLibrarySource.search — Kotlin L300 \p{Punct}
// ---------------------------------------------------------------------------

describe('JAVA_PUNCT_WHITESPACE — Kotlin Regex("[\\s\\p{Punct}]+") (ZLibrarySource L300)', () => {
  it('strips whitespace and ASCII punctuation exactly like Java\'s POSIX \\p{Punct}', () => {
    const strip = (s: string) => s.toLowerCase().replace(JAVA_PUNCT_WHITESPACE, '');
    // ASCII punctuation IS in Java's POSIX \p{Punct}: space, '-', '!', '_', '.', '%', '(', ')',
    // '&', '#', '+'
    expect(strip('The Three-Body Problem!')).toBe('thethreebodyproblem');
    expect(strip('a_b-c.d')).toBe('abcd');
    expect(strip('100% (2019)')).toBe('1002019');
    expect(strip('C++ & C#')).toBe('cc');
  });

  it('leaves CJK punctuation alone — \\p{Punct} is ASCII-only, unlike JS \\p{P}', () => {
    const strip = (s: string) => s.toLowerCase().replace(JAVA_PUNCT_WHITESPACE, '');
    // Only the ASCII space before 著 is removed; （）， survive in the Kotlin/Android build.
    expect(strip('三体（全集），刘慈欣 著')).toBe('三体（全集），刘慈欣著');
    // JS \p{P} would additionally strip them, which is what the port used to do:
    expect('三体（全集），刘慈欣 著'.replace(/[\s\p{P}]+/gu, '')).toBe('三体全集刘慈欣著');
    expect(strip('三体（全集），刘慈欣 著')).not.toBe(
      '三体（全集），刘慈欣 著'.replace(/[\s\p{P}]+/gu, ''),
    );
  });
});

// ---------------------------------------------------------------------------
// Selector-engine edge cases raised by the review
// ---------------------------------------------------------------------------

describe('htmlDocument selector engine — review findings', () => {
  it('does NOT alias :containsOwn to :contains (jsoup matches ownText there)', () => {
    // The port folded `:containsOwn` into `:contains`. With it removed, an unknown
    // pseudo-class is IGNORED (documented), so `[class]` alone decides the match.
    const doc = parseHtmlDocument('<div id="w"><span class="k">abc</span><span>abc</span></div>');
    expect(doc.select('span:containsOwn(abc)')).toHaveLength(2);
  });

  it('reads jsoup\'s case-insensitivity flag as a trailing " i" after the VALUE', () => {
    const doc = parseHtmlDocument('<a data-x="AbC" href="/DL/1">x</a>');
    expect(doc.select('a[href*=/DL/ i]')).toHaveLength(1);
    // an attribute NAME that merely ends in "i" must not lose its last letter
    expect(doc.select('a[data-x i]')).toHaveLength(0);
    expect(doc.select('a[data-x]')).toHaveLength(1);
  });

  it('matches an attribute value that contains selector-special characters', () => {
    const doc = parseHtmlDocument(
      '<div style="background-image:url(\'/a,b/c.png?v=1\'); color:red"></div>' +
        '<input name="a[b]:c,d" value="1">',
    );
    expect(doc.select("[style*='background-image']")).toHaveLength(1);
    expect(doc.select('input[name="a[b]:c,d"]')).toHaveLength(1);
    expect(doc.select('input[name*=[b]:c]')).toHaveLength(1);
  });

  it('keeps a <script> payload out of text()/ownText() but visible in outerHtml()', () => {
    const doc = parseHtmlDocument('<div id="d">a<script>1 < 2 && 3 > 2;</script>b</div>');
    const div = doc.selectFirst('#d') as HtmlElement;
    expect(div.text()).toBe('a b');
    expect(div.ownText()).toBe('ab');
    // jsoup DataNode.outerHtml() is verbatim, so `<` is NOT re-escaped
    expect(div.outerHtml()).toContain('1 < 2 && 3 > 2;');
  });
});