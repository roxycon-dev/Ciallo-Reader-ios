/**
 * Unit tests for the `source/js` module ports.
 *
 * Android source under test: `com.example.source.js.*` (see each describe block).
 * These cover the pure algorithms only — every platform object is stubbed with a
 * minimal in-memory implementation of the injected ports.
 */

import { describe, expect, it } from 'vitest';
import { CfWebViewSolver } from '../../src/core/source/js/cfWebViewSolver';
import {
  extractComicId,
  friendlyJsSourceError,
  hashCodeOf,
  splitChapterId,
} from '../../src/core/source/js/jsComicSource';
import { JsComicMetadata } from '../../src/core/source/js/jsComicMetadata';
import {
  JsCookieJarStore,
  parseSetCookie,
  topPrivateDomain,
} from '../../src/core/source/js/jsCookieJar';
import { JsHtmlStore } from '../../src/core/source/js/jsHtmlStore';
import { JsImageProcessor } from '../../src/core/source/js/jsImageProcessor';
import { JsMessageHandler } from '../../src/core/source/js/jsMessageHandler';
import {
  boundedRegex,
  boundedRegexBatch,
  EXECUTION_BUDGET_MS,
  MAX_STACK_SIZE,
  MEMORY_LIMIT,
} from '../../src/core/source/js/jsSourceEngine';
import { JSONObject } from '../../src/core/source/js/json';
import {
  JsSourceRepo,
  mapWithConcurrency,
  prependIndent,
  replaceAllLiteral,
  replaceRange,
  trimIndent,
  validScript,
  withTimeout,
} from '../../src/core/source/js/jsSourceRepo';
import { SourceDns } from '../../src/core/source/js/sourceDns';
import {
  isMxsWhiteSpacer,
  stripLeadingMxsSpacers,
} from '../../src/core/source/js/mxsSpacerPages';
import { parseHtml, type HtmlNodeImpl } from '../../src/core/parser/legadoRule';
import {
  createMemoryKeyValueStorage,
  type Bitmap,
  type FileStoragePort,
  type HttpRequestSpec,
  type HttpResponseSpec,
  type HtmlDomNode,
  type HtmlDomParser,
  type KeyValueStorage,
} from '../../src/core/source/js/jsPlatform';

// ----------------------------------------------------------------------
// stubs
// ----------------------------------------------------------------------

function bitmap(width: number, height: number, rgba: [number, number, number, number]): Bitmap {
  const buffer = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    buffer[i * 4] = rgba[0];
    buffer[i * 4 + 1] = rgba[1];
    buffer[i * 4 + 2] = rgba[2];
    buffer[i * 4 + 3] = rgba[3];
  }
  return {
    width,
    height,
    getPixels: () => buffer,
    createBitmap: () => bitmap(width, height, rgba),
    createBitmapFrom: (_src: Bitmap, _x: number, _y: number, w: number, h: number) =>
      bitmap(w, h, [0, 0, 0, 0]),
    createRotated90: (src: Bitmap) => bitmap(src.height, src.width, rgba),
    drawBitmap: () => undefined,
    drawBitmapRect: () => undefined,
    allocationByteCount: width * height * 4,
    decodeBytes: () => null,
    compressPng: () => null,
    recycle: () => undefined,
  } as unknown as Bitmap;
}

/**
 * Reference adapter over the pure-TS DOM in `@core/parser/legadoRule`, mapping
 * its `HtmlNodeImpl` onto the injected `HtmlDomNode` port. The platform layer
 * needs an equivalent (WKWebView / jsdom).
 */
function createDomParser(): HtmlDomParser {
  const cache = new WeakMap<HtmlNodeImpl, HtmlDomNode>();
  const indexIn = (parent: HtmlNodeImpl, child: HtmlNodeImpl): number =>
    parent.childNodes.indexOf(child);
  const wrap = (node: HtmlNodeImpl, doc: HtmlNodeImpl): HtmlDomNode => {
    const memo = cache.get(node);
    if (memo !== undefined) return memo;
    const self = node;
    const parent = self.parent;
    const view: HtmlDomNode = {
      get tagName() {
        return self.tag;
      },
      get id() {
        return self.attrs['id'] ?? '';
      },
      get classNames() {
        return (self.attrs['class'] ?? '').split(/\s+/).filter((c) => c !== '');
      },
      get attributes() {
        return self.attrs;
      },
      get childNodes() {
        return self.childNodes.map((child) => wrap(child, doc));
      },
      get children() {
        return self.childNodes
          .filter((child) => child.kind === 'element')
          .map((child) => wrap(child, doc));
      },
      get parentNode() {
        return parent === null ? null : wrap(parent, doc);
      },
      get nodeKind() {
        // Kotlin `TextNode` -> 'text', `DataNode` (script/style) -> 'data'.
        if (self.kind === 'element' || self.kind === 'document') return self.kind;
        if (self.kind === 'comment') return 'comment';
        if (self.kind === 'doctype') return 'doctype';
        return self.parent !== null && (self.parent.tag === 'script' || self.parent.tag === 'style')
          ? 'data'
          : 'text';
      },
      text: () => self.text(),
      html: () => self.html(),
      data: () => self.data,
      outerHtml: () => self.outerHtml(),
      selectFirst: (query) => {
        const found = self.selectFirst(query);
        return found === null ? null : wrap(found as HtmlNodeImpl, doc);
      },
      select: (query) => self.select(query).map((found) => wrap(found as HtmlNodeImpl, doc)),
      getElementById: (id) => {
        const found = self.getElementById(id);
        return found === null ? null : wrap(found as HtmlNodeImpl, doc);
      },
      getAllElements: () => self.getAllElements().map((found) => wrap(found as HtmlNodeImpl, doc)),
      previousElementSibling: () => {
        if (parent === null) return null;
        const previous = parent.childNodes[indexIn(parent, self) - 1] ?? null;
        return previous === null || previous.kind !== 'element' ? null : wrap(previous, doc);
      },
      nextElementSibling: () => {
        if (parent === null) return null;
        const next = parent.childNodes[indexIn(parent, self) + 1] ?? null;
        return next === null || next.kind !== 'element' ? null : wrap(next, doc);
      },
      ownerDocument: () => wrap(doc, doc),
    };
    cache.set(node, view);
    return view;
  };
  return {
    parse: (html: string) => {
      const doc = parseHtml(html) as HtmlNodeImpl;
      return wrap(doc, doc);
    },
    wholeText: (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' '),
  };
}

type StubFileStorage = FileStoragePort & { assets: Map<string, string> };

function createFileStorage(): StubFileStorage {
  const files = new Map<string, Uint8Array>();
  const assets = new Map<string, string>();
  const decoder = new TextDecoder();
  const port: FileStoragePort = {
    filesDir: () => '/data',
    cacheDir: () => '/cache',
    exists: (path) => files.has(path),
    readText: (path) => {
      const raw = files.get(path);
      return raw === undefined ? null : decoder.decode(raw);
    },
    writeText: (path, content) => {
      files.set(path, new TextEncoder().encode(content));
    },
    readBytes: (path) => files.get(path) ?? null,
    writeBytes: (path, content) => {
      files.set(path, content);
    },
    delete: (path) => {
      files.delete(path);
    },
    mkdirs: () => undefined,
    length: (path) => files.get(path)?.length ?? 0,
    toFileUrl: (path) => `file://${path}`,
    readAsset: (path) => assets.get(path) ?? null,
    listFiles: () => [...files.keys()],
  };
  // Test seam so a case can seed a bundled asset.
  return Object.assign(port, { assets });
}

function createHttpStub(
  handler: (request: HttpRequestSpec) => HttpResponseSpec | null,
): {
  execute: (request: HttpRequestSpec) => Promise<HttpResponseSpec>;
  calls: HttpRequestSpec[];
} {
  const calls: HttpRequestSpec[] = [];
  return {
    calls,
    execute: async (request) => {
      calls.push(request);
      const response = handler(request);
      if (response === null) throw new Error('no response');
      return response;
    },
  };
}

function response(
  status: number,
  body: string,
  headers: Record<string, string> = {},
  setCookies: string[] = [],
): HttpResponseSpec {
  return {
    status,
    finalUrl: 'https://example.com/',
    headers,
    setCookies,
    body: new TextEncoder().encode(body),
  };
}

function createHandler(
  overrides: Partial<Record<string, unknown>> = {},
  insecureTls = false,
): {
  handler: JsMessageHandler;
  prefs: KeyValueStorage;
  files: FileStoragePort;
} {
  const prefs = createMemoryKeyValueStorage();
  const files = createFileStorage();
  const http = createHttpStub(() => response(200, 'ok'));
  const handler = new JsMessageHandler(
    {
      dataPrefs: prefs,
      htmlStore: new JsHtmlStore(createDomParser()),
      crypto: {
        digest: () => new Uint8Array(16),
        hmac: () => new Uint8Array(32),
        aesDecrypt: () => new Uint8Array(0),
        rsaDecrypt: () => new Uint8Array(0),
        randomUUID: () => 'uuid',
        randomInt: (min: number, _max: number) => min,
        randomDouble: (min: number, _max: number) => min,
      },
      http,
      cookies: new JsCookieJarStore(prefs),
      sourceProxy: {
        matches: () => false,
        rememberProxySuccess: () => undefined,
        forgetRoute: () => undefined,
      },
      solveCloudflare: async () => false,
      isChallengeResponse: CfWebViewSolver.isChallengeResponse,
      systemProxy: () => null,
      gunzipIfNeeded: (bytes: Uint8Array) => bytes,
      timeouts: { connectMs: 20_000, readMs: 30_000, callMs: 0 },
      decodeCharset: (label: string, bytes: Uint8Array) =>
        new TextDecoder(label === 'GBK' ? 'gbk' : 'gb18030').decode(bytes),
      decodeUtf8: (bytes: Uint8Array) => new TextDecoder().decode(bytes),
      encodeUtf8: (value: string) => new TextEncoder().encode(value),
      decodeLatin1: (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes),
      elapsedRealtime: () => Date.now(),
      wallClock: () => Date.now(),
      maxMemory: () => 256 * 1024 * 1024,
      startPolling: () => () => undefined,
      sleep: () => undefined,
      showInputDialog: async () => '',
      ...overrides,
    } as never,
    'test',
    insecureTls,
  );
  return { handler, prefs, files };
}

// ----------------------------------------------------------------------
// MxsSpacerPages.kt
// ----------------------------------------------------------------------

describe('MxsSpacerPages.kt', () => {
  it('rejects non-spacer shapes by size', () => {
    // width < 300 → false without touching pixels
    expect(isMxsWhiteSpacer(bitmap(200, 100, [255, 255, 255, 255]))).toBe(false);
    // height > 512 → false
    expect(isMxsWhiteSpacer(bitmap(400, 600, [255, 255, 255, 255]))).toBe(false);
    // height > width / 2 → false
    expect(isMxsWhiteSpacer(bitmap(400, 300, [255, 255, 255, 255]))).toBe(false);
  });

  it('accepts a short fully white strip and rejects a single off-white pixel', () => {
    expect(isMxsWhiteSpacer(bitmap(400, 200, [255, 255, 255, 255]))).toBe(true);
    expect(isMxsWhiteSpacer(bitmap(400, 200, [255, 255, 253, 255]))).toBe(false);
    // alpha 0 is ignored by the Kotlin `(pixel ushr 24) != 0` guard
    expect(isMxsWhiteSpacer(bitmap(400, 200, [0, 0, 0, 0]))).toBe(true);
  });

  it('only inspects the first three pages and stops at the first real page', async () => {
    const spacer = bitmap(400, 200, [255, 255, 255, 255]);
    const real = bitmap(400, 600, [10, 20, 30, 255]);
    const seen: string[] = [];
    const load = async (url: string): Promise<Bitmap | null> => {
      seen.push(url);
      return url === 'a' || url === 'b' ? spacer : real;
    };
    const urls = ['a', 'b', 'c', 'd', 'e'];
    expect(await stripLeadingMxsSpacers(urls, load)).toEqual(['c', 'd', 'e']);
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('stops entirely when the loader returns null', async () => {
    const urls = ['a', 'b', 'c'];
    expect(await stripLeadingMxsSpacers(urls, async () => null)).toEqual(urls);
  });
});

// ----------------------------------------------------------------------
// SourceDns.kt
// ----------------------------------------------------------------------

describe('SourceDns.kt', () => {
  it('passes non-pinned hosts straight to the base resolver', async () => {
    let calls = 0;
    const resolver = SourceDns.dns({
      lookup: async () => {
        calls += 1;
        return ['1.1.1.1'];
      },
    });
    expect(await resolver.lookup('example.com')).toEqual(['1.1.1.1']);
    expect(calls).toBe(1);
  });

  it('appends the pinned edge IP after the system addresses for the suffix zone', async () => {
    SourceDns.clearCache();
    const resolver = SourceDns.dns({ lookup: async () => ['9.9.9.9'] });
    expect(await resolver.lookup('img.cdndm5.com')).toEqual(['9.9.9.9', '222.200.254.75']);
  });

  it('caches the merged list for the TTL window', async () => {
    SourceDns.clearCache();
    let calls = 0;
    const resolver = SourceDns.dns({
      lookup: async () => {
        calls += 1;
        return ['9.9.9.9'];
      },
    });
    await resolver.lookup('a.cdndm5.com');
    await resolver.lookup('a.cdndm5.com');
    expect(calls).toBe(1);
    SourceDns.clearCache();
  });

  it('falls back to the pinned IP when the system resolver fails', async () => {
    SourceDns.clearCache();
    const resolver = SourceDns.dns({
      lookup: async () => {
        throw new Error('dns down');
      },
    });
    expect(await resolver.lookup('x.cdndm5.com')).toEqual(['222.200.254.75']);
    SourceDns.clearCache();
  });
});

// ----------------------------------------------------------------------
// CfWebViewSolver.kt
// ----------------------------------------------------------------------

describe('CfWebViewSolver.kt', () => {
  it('recognises the official challenge response', () => {
    expect(
      CfWebViewSolver.isChallengeResponse(403, {
        'CF-Mitigated': 'challenge',
        server: 'cloudflare',
      }),
    ).toBe(true);
    expect(CfWebViewSolver.isChallengeResponse(503, { 'cf-mitigated': 'challenge', server: 'CLOUDFLARE' })).toBe(
      true,
    );
    expect(CfWebViewSolver.isChallengeResponse(429, { 'cf-mitigated': 'challenge', server: 'nginx' })).toBe(
      false,
    );
    // status gate
    expect(CfWebViewSolver.isChallengeResponse(200, { 'cf-mitigated': 'challenge', server: 'cloudflare' })).toBe(
      false,
    );
  });

  it('extracts only http/https hosts', () => {
    expect(CfWebViewSolver.hostOf('https://Example.com/a')).toBe('example.com');
    expect(CfWebViewSolver.hostOf('ftp://example.com')).toBeNull();
    expect(CfWebViewSolver.hostOf('not a url')).toBeNull();
  });

  it('rejects loopback and private resolutions', () => {
    expect(CfWebViewSolver.isPublicHost('example.com', ['93.184.216.34'])).toBe(true);
    expect(CfWebViewSolver.isPublicHost('example.com', ['127.0.0.1'])).toBe(false);
    expect(CfWebViewSolver.isPublicHost('example.com', ['10.0.0.5'])).toBe(false);
    expect(CfWebViewSolver.isPublicHost('example.com', ['fd00::1'])).toBe(false);
    expect(CfWebViewSolver.isPublicHost('localhost', ['93.184.216.34'])).toBe(false);
  });

  it('reads the cf_clearance entry out of a cookie header', () => {
    expect(CfWebViewSolver.clearanceOf('a=1; cf_clearance=xyz; b=2')).toBe('cf_clearance=xyz');
    expect(CfWebViewSolver.clearanceOf('a=1; b=2')).toBeNull();
    expect(CfWebViewSolver.clearanceOf(null)).toBeNull();
  });

  it('strips the unsafe headers before loading the challenge page', () => {
    expect(
      CfWebViewSolver.filterSafeHeaders({
        Host: 'x',
        Cookie: 'a=1',
        'transfer-encoding': 'chunked',
        TE: 'trailers',
        'Proxy-Authorization': 'x',
        'User-Agent': 'UA',
        Referer: 'r',
      }),
    ).toEqual({ 'User-Agent': 'UA', Referer: 'r' });
  });
});

// ----------------------------------------------------------------------
// JsCookieJar.kt
// ----------------------------------------------------------------------

describe('JsCookieJar.kt', () => {
  it('computes the registrable domain', () => {
    expect(topPrivateDomain('a.b.example.com')).toBe('example.com');
    expect(topPrivateDomain('example.com')).toBe('example.com');
    expect(topPrivateDomain('a.b.example.co.uk')).toBe('example.co.uk');
    expect(topPrivateDomain('localhost')).toBeNull();
  });

  it('is not fooled into reading a host that merely contains a dot or digit as an IP', () => {
    // OkHttp's `canParseAsIpAddress` uses `Regex.matches`, i.e. the WHOLE host
    // must be an IP literal. A substring match made every dotted host look like
    // an address, which returned the host instead of the registrable domain.
    expect(topPrivateDomain('img1.6wm.top')).toBe('6wm.top');
    expect(topPrivateDomain('m.6wm.top')).toBe('6wm.top');
    // Kotlin `HttpUrl.topPrivateDomain()` returns null for an IP address.
    expect(topPrivateDomain('127.0.0.1')).toBeNull();
    expect(topPrivateDomain('::1')).toBeNull();
    expect(topPrivateDomain('192.168.0.1')).toBeNull();
  });

  it('applies wildcard rules at the length the PSL rule itself has', () => {
    // `*.ck` is a 2-label rule: `foo.bar.ck` -> eTLD+1 is the whole host and
    // `bar.ck` is itself a public suffix (null).
    expect(topPrivateDomain('foo.bar.ck')).toBe('foo.bar.ck');
    expect(topPrivateDomain('bar.ck')).toBeNull();
    // `*.kawasaki.jp` is a 3-label rule, so `x.kawasaki.jp` IS the suffix.
    expect(topPrivateDomain('x.kawasaki.jp')).toBeNull();
    expect(topPrivateDomain('a.x.kawasaki.jp')).toBe('a.x.kawasaki.jp');
    // A host that IS a plain public suffix has no registrable domain.
    expect(topPrivateDomain('co.uk')).toBeNull();
    expect(topPrivateDomain('com')).toBeNull();
  });

  it('keeps a Domain= cookie for any host that is not an IP literal', () => {
    // The regression that `RegExp.test` caused: `domainMatch` returned false, so
    // `Cookie.parse` discarded the cookie outright and the login session was lost.
    for (const host of ['img1.6wm.top', 'm.6wm.top', 'a.b.6wm.top']) {
      const cookie = parseSetCookie(`https://${host}/`, 'k=v; Domain=.6wm.top; Path=/', 0);
      expect(cookie, host).not.toBeNull();
    }
    expect(parseSetCookie('https://a.example.com/', 'k=v; Domain=.example.com; Path=/', 0)).toMatchObject({
      domain: 'example.com',
      hostOnly: false,
    });
  });

  it('still rejects a Domain= attribute that does not domain-match', () => {
    expect(parseSetCookie('https://a.example.com/', 'k=v; Domain=.evil.test', 0)).toBeNull();
    // Public suffix: `urlHost.length !== domain.length` and no eTLD+1.
    expect(parseSetCookie('https://a.b.co.uk/', 'k=v; Domain=.co.uk', 0)).toBeNull();
  });

  it('rejects a name or value outside U+0020..U+007E (indexOfControlOrNonAscii)', () => {
    // Kotlin checks the name with `indexOfControlOrNonAscii()` and emptiness
    // separately — there is no separate "value must be printable" pass.
    expect(parseSetCookie('https://example.com/', 'k=xÿ', 0)).toBeNull();
    expect(parseSetCookie('https://example.com/', 'k=v', 0)).toBeNull();
    expect(parseSetCookie('https://example.com/', '=v', 0)).toBeNull();
    // A space inside the value is legal (U+0020 is not a control character).
    expect(parseSetCookie('https://example.com/', 'k=a b', 0)).toMatchObject({
      name: 'k',
      value: 'a b',
    });
  });

  it('keeps Max-Age semantics: seconds, precedence, and the -?\\d+ overflow fallback', () => {
    // Max-Age wins over Expires regardless of declaration order.
    expect(
      parseSetCookie('https://example.com/', 'k=v; Max-Age=5; Expires=Thu, 01 Jan 2099 00:00:00 GMT', 0)
        ?.expiresAt,
    ).toBe(5000);
    // Max-Age=0 and negative values delete the cookie now (Long.MIN_VALUE).
    expect(parseSetCookie('https://example.com/', 'k=v; Max-Age=0', 1_000_000)?.expiresAt).toBeLessThanOrEqual(0);
    expect(parseSetCookie('https://example.com/', 'k=v; Max-Age=-1', 1_000_000)?.expiresAt).toBeLessThanOrEqual(0);
    // An unparsable Max-Age is ignored, leaving the MAX_DATE session sentinel.
    expect(parseSetCookie('https://example.com/', 'k=v; Max-Age=abc', 0)?.expiresAt).toBe(253402300799999);
    // A value too big for a Long saturates to MAX_DATE rather than being kept.
    expect(
      parseSetCookie('https://example.com/', 'k=v; Max-Age=99999999999999999999', 0)?.expiresAt,
    ).toBe(253402300799999);
  });

  it('keeps the raw pair (with its attributes) in ck_<host>', () => {
    const prefs = createMemoryKeyValueStorage();
    const jar = new JsCookieJarStore(prefs);
    jar.saveCookiePairs('example.com', ['a=1', 'b=2']);
    expect(prefs.getString('ck_example.com')).toBe('a=1; b=2');
    expect(jar.cookieHeader('https://example.com/x')).toBe('a=1; b=2');
  });

  it('migrates the stale one-second search throttle but keeps other cookies', () => {
    const prefs = createMemoryKeyValueStorage();
    const jar = new JsCookieJarStore(prefs);
    jar.saveCookiePairs('ikmmh.com', ['ss_search_delay=1', 'token=keep']);
    // Kotlin prunes the throttle inside cookieHeader, not on write.
    expect(jar.cookieHeader('https://ikmmh.com/')).toBe('token=keep');
    expect(prefs.getString('ck_ikmmh.com')).toBe('token=keep');
  });

  it('expires a Set-Cookie with a past Max-Age', () => {
    const prefs = createMemoryKeyValueStorage();
    const jar = new JsCookieJarStore(prefs, () => 1_000_000);
    jar.saveSetCookies('https://example.com/', ['gone=1; Max-Age=0; Path=/']);
    expect(prefs.getString('ck_example.com')).toBe('');
  });

  it('stores attributes for a live Set-Cookie', () => {
    const prefs = createMemoryKeyValueStorage();
    const jar = new JsCookieJarStore(prefs, () => 1_000_000);
    jar.saveSetCookies('https://example.com/', ['live=1; Max-Age=3600; Path=/; Secure']);
    expect(prefs.getString('ck_example.com')).toBe('live=1');
    expect(JSON.parse(prefs.getString('ck_meta_example.com') ?? '{}')).toEqual({
      live: { expiresAt: 4_600_000, path: '/', secure: true, hostOnly: true },
    });
  });

  it('parses name/value, Max-Age precedence and domain stripping', () => {
    const cookie = parseSetCookie('https://a.example.com/', 'k=v; Domain=.example.com; Max-Age=10', 500);
    expect(cookie).toMatchObject({ name: 'k', value: 'v', domain: 'example.com', hostOnly: false, expiresAt: 10_500 });
    // Max-Age wins over Expires
    const both = parseSetCookie('https://a.example.com/', 'k=v; Expires=Thu, 01 Jan 2099 00:00:00 GMT; Max-Age=5', 0);
    expect(both?.expiresAt).toBe(5000);
    // A cookie with neither Expires nor Max-Age keeps `expiresAt = MAX_DATE`,
    // which is okhttp's `internal.http.MAX_DATE` — "Fri, 31 Dec 9999 23:59:59 GMT",
    // NOT Long.MAX_VALUE (Cookie.parse seeds `expiresAt` with MAX_DATE).
    expect(parseSetCookie('https://a.example.com/', 'k=v', 0)?.expiresAt).toBe(253402300799999);
    // malformed → null
    expect(parseSetCookie('https://a.example.com/', 'novalue', 0)).toBeNull();
  });

  it('clears a host', () => {
    const prefs = createMemoryKeyValueStorage();
    const jar = new JsCookieJarStore(prefs);
    jar.saveCookiePairs('example.com', ['a=1']);
    jar.clear('example.com');
    expect(prefs.getString('ck_example.com')).toBeNull();
  });
});

// ----------------------------------------------------------------------
// JsHtmlStore.kt
// ----------------------------------------------------------------------

describe('JsHtmlStore.kt', () => {
  it('queries through the caller-supplied document key', () => {
    const store = new JsHtmlStore(createDomParser());
    expect(store.parse(0, '<div id="a" class="x y"><p>hello</p></div>')).toBe(0);
    const el = store.querySelector(0, '#a');
    expect(el).not.toBeNull();
    expect(store.getId(el as number)).toBe('a');
    expect(store.getClassNames(el as number)).toEqual(['x', 'y']);
    expect(store.getLocalName(el as number)).toBe('div');
    expect(store.getText(el as number)).toContain('hello');
  });

  it('returns null / empty for an unknown document', () => {
    const store = new JsHtmlStore(createDomParser());
    expect(store.querySelector(7, 'p')).toBeNull();
    expect(store.querySelectorAll(7, 'p')).toEqual([]);
    expect(store.getText(7)).toBe('');
  });

  it('enforces the 2Mi character guard with the Android message', () => {
    const store = new JsHtmlStore(createDomParser());
    expect(() => store.parse(0, 'x'.repeat(2 * 1024 * 1024 + 1))).toThrow('书源 HTML 超过 2Mi 字符');
  });

  it('reports node kinds and only upgrades elements', () => {
    const store = new JsHtmlStore(createDomParser());
    store.parse(0, '<div><!--c--><b>text</b></div>');
    const nodes = store.getNodes(store.querySelector(0, 'div') as number);
    const kinds = nodes.map((n) => store.nodeType(n));
    expect(kinds).toContain('element');
    expect(kinds).toContain('comment');
    const comment = nodes.find((n) => store.nodeType(n) === 'comment') as number;
    expect(store.nodeToElement(comment)).toBeNull();
  });

  it('disposes handles owned by a document', () => {
    const store = new JsHtmlStore(createDomParser());
    store.parse(0, '<div><span>x</span></div>');
    const span = store.querySelector(0, 'span') as number;
    store.dispose(0);
    expect(store.getLocalName(span)).toBe('');
  });
});

// ----------------------------------------------------------------------
// JsComicMetadata.kt
// ----------------------------------------------------------------------

describe('JsComicMetadata.kt', () => {
  const dom = createDomParser();

  it('accepts a plain string but drops "null" and blanks', () => {
    expect(JsComicMetadata.values('  画师  ')).toEqual(['画师']);
    expect(JsComicMetadata.values('null')).toEqual([]);
    expect(JsComicMetadata.values('   ')).toEqual([]);
    expect(JsComicMetadata.values(42)).toEqual([]);
  });

  it('flattens arrays and category-keyed objects', () => {
    expect(JsComicMetadata.values(['a', 'b', 'a'])).toEqual(['a', 'b', 'a']);
    expect(JsComicMetadata.values({ name: 'n', title: 't' })).toEqual(['n', 't']);
  });

  it('builds a book and never treats a subtitle as an author', () => {
    const book = JsComicMetadata.book(
      new JSONObject(
        JSON.stringify({
          title: '作品',
          author: ['作者甲', '作者甲', '作者乙'],
          cover: 'c.jpg',
          description: '第一行<br>第二行',
          language: 'zh',
          isCompleted: true,
          tags: { 作者: ['作者丙'], artist: ['画师甲'] },
        }),
      ),
      'src',
      'book-1',
      dom,
    );
    expect(book.title).toBe('作品');
    expect(book.author).toBe('作者甲、作者乙、作者丙');
    expect(book.format).toBe('漫画');
    expect(book.language).toBe('zh');
    expect(book.comicInfo?.status).toBe('已完结');
    expect(book.comicInfo?.artists).toEqual(['画师甲']);
    expect(book.description).toContain('第一行');
    expect(book.description).toContain('第二行');
    // category-keyed tags are labelled with a full-width colon
    expect(book.comicInfo?.tags).toEqual(['作者：作者丙', 'artist：画师甲']);
  });

  it('falls back to 连载中 and prefix-parsed tags', () => {
    const book = JsComicMetadata.book(
      new JSONObject(JSON.stringify({ isCompleted: false, tags: ['artist:画师乙'] })),
      'src',
      'b',
      dom,
    );
    expect(book.comicInfo?.status).toBe('连载中');
    expect(book.comicInfo?.artists).toEqual(['画师乙']);
  });
});

// ----------------------------------------------------------------------
// JsComicSource.kt (pure helpers)
// ----------------------------------------------------------------------

describe('JsComicSource.kt', () => {
  it('splits the U+0001 chapter id', () => {
    expect(splitChapterId('bookep2')).toEqual(['book', 'ep2']);
    expect(splitChapterId('book')).toBeNull();
    expect(splitChapterId('ep')).toBeNull();
  });

  it('translates raw bridge errors into actionable Chinese', () => {
    expect(friendlyJsSourceError('')).toBe('JS 执行失败');
    expect(friendlyJsSourceError('Not logged in')).toBe('该源需要登录：请在书源管理中登录');
    expect(friendlyJsSourceError('Invalid status code: 401')).toBe('登录已过期：请在书源管理中重新登录');
    expect(friendlyJsSourceError('Cloudflare challenge')).toBe('源站暂时拦截请求，请稍后重试');
    expect(friendlyJsSourceError('Invalid status code: 403')).toBe(
      '源站拒绝当前网络出口（HTTP 403），请稍后重试或更换 VPN 节点',
    );
    expect(friendlyJsSourceError('ERR_CONNECTION_RESET')).toBe(
      '网络连接失败：请检查该源站点、系统代理或 VPN 后重试',
    );
    expect(friendlyJsSourceError('x'.repeat(200))).toHaveLength(120);
  });

  it('extracts the work number for numeric search', () => {
    expect(extractComicId(new JSONObject(JSON.stringify({ id: 'https://e-hentai.org/g/123456/aa' })))).toBe('123456');
    expect(extractComicId(new JSONObject(JSON.stringify({ id: 'album/9988' })))).toBe('9988');
    expect(extractComicId(new JSONObject(JSON.stringify({ id: '12345' })))).toBe('12345');
    expect(extractComicId(new JSONObject(JSON.stringify({ id: 'no-number' })))).toBeNull();
    expect(extractComicId(new JSONObject(JSON.stringify({ id: '  ' })))).toBeNull();
  });

  it('reproduces the JVM string hash used for the image cache filename', () => {
    expect(hashCodeOf('')).toBe(0);
    expect(hashCodeOf('a')).toBe(97);
    expect(hashCodeOf('ab')).toBe(97 * 31 + 98);
  });
});

// ----------------------------------------------------------------------
// JsImageProcessor.kt
// ----------------------------------------------------------------------

describe('JsImageProcessor.kt', () => {
  it('registers, reports and clears transforms', async () => {
    JsImageProcessor.clear();
    const engine = { transformImageBlocking: async () => new Uint8Array([1]) };
    expect(JsImageProcessor.hasTransform('u')).toBe(false);
    expect(await JsImageProcessor.transform('u', new Uint8Array())).toBeNull();
    JsImageProcessor.register('u', engine, 'code');
    expect(JsImageProcessor.hasTransform('u')).toBe(true);
    expect(await JsImageProcessor.transform('u', new Uint8Array())).toEqual(new Uint8Array([1]));
    JsImageProcessor.register('u', engine, '   ');
    expect(JsImageProcessor.hasTransform('u')).toBe(false);
    JsImageProcessor.register('u', engine, 'code');
    JsImageProcessor.unregister('u');
    expect(JsImageProcessor.hasTransform('u')).toBe(false);
    JsImageProcessor.clear();
  });

  it('returns null (keeps the original bytes) when the engine throws', async () => {
    JsImageProcessor.clear();
    JsImageProcessor.register(
      'u',
      {
        transformImageBlocking: async () => {
          throw new Error('boom');
        },
      },
      'code',
    );
    expect(await JsImageProcessor.transform('u', new Uint8Array())).toBeNull();
    JsImageProcessor.clear();
  });
});

// ----------------------------------------------------------------------
// JsMessageHandler.kt
// ----------------------------------------------------------------------

describe('JsMessageHandler.kt', () => {
  it('returns the fixed platform values', () => {
    const { handler } = createHandler();
    expect(handler.handle({ method: 'getLocale' })).toBe('zh-CN');
    expect(handler.handle({ method: 'getPlatform' })).toBe('android');
    expect(handler.handle({ method: 'getClipboard' })).toBe('');
    expect(handler.handle({ method: 'compute' })).toBeNull();
    expect(handler.handle({ method: 'setClipboard' })).toBeNull();
    expect(handler.handle(null)).toBeNull();
    expect(handler.handle({ method: 'nope' })).toBeNull();
  });

  it('round-trips load_data / save_data with the JSON: prefix', () => {
    const { handler } = createHandler();
    handler.handle({ method: 'save_data', data_key: 'k', data: { a: 1 } });
    const loaded = handler.handle({ method: 'load_data', data_key: 'k' });
    expect(loaded).toBe('JSON:{"a":1}');
    handler.handle({ method: 'save_data', data_key: 's', data: 'plain' });
    expect(handler.handle({ method: 'load_data', data_key: 's' })).toBe('plain');
    handler.handle({ method: 'delete_data', data_key: 's' });
    expect(handler.handle({ method: 'load_data', data_key: 's' })).toBeNull();
  });

  it('prefers a user-saved setting over the script default', () => {
    const { handler, prefs } = createHandler();
    handler.setSettingDefaults({ base: 'default' });
    expect(handler.handle({ method: 'load_setting', setting_key: 'base' })).toBe('default');
    prefs.putString('setting_test_base', 'user');
    expect(handler.handle({ method: 'load_setting', setting_key: 'base' })).toBe('user');
  });

  it('keeps the login flag in the shared prefs', () => {
    const { handler, prefs } = createHandler();
    expect(handler.handle({ method: 'isLogged' })).toBe(false);
    handler.setLoggedIn(true);
    expect(prefs.getBoolean('logged_test', false)).toBe(true);
    expect(handler.isLoggedIn()).toBe(true);
  });

  it('hex-encodes and base64 round-trips through convert', () => {
    const { handler } = createHandler();
    expect(handler.handle({ method: 'convert', type: 'hex', value: [0, 255, 16] })).toBe('00ff10');
    // Kotlin `bytesOf` only accepts a ByteArray or a numeric List, so the
    // encoder input has to be bytes — a bare String encodes to null.
    const bytes = new TextEncoder().encode('hi');
    const encoded = handler.handle({ method: 'convert', type: 'base64', isEncode: true, value: bytes });
    expect(encoded).toBe('aGk=');
    const decoded = handler.handle({ method: 'convert', type: 'base64', isEncode: false, value: 'aGk=' });
    expect(new TextDecoder().decode(decoded as Uint8Array)).toBe('hi');
  });

  it('serves the html bridge through JsHtmlStore', () => {
    const { handler } = createHandler();
    expect(handler.handle({ method: 'html', function: 'parse', key: 0, data: '<b>hi</b>' })).toBe(0);
    const key = handler.handle({ method: 'html', function: 'querySelector', key: 0, query: 'b' });
    expect(handler.handle({ method: 'html', function: 'getText', key })).toBe('hi');
    const attrs = handler.handle({ method: 'html', function: 'getAttributes', key });
    expect(typeof attrs).toBe('string');
  });

  it('reports a missing url and merges script cookies with the jar', async () => {
    const { handler } = createHandler();
    await expect(handler.handle({ method: 'http' })).resolves.toContain('缺少 url');
  });

  it('refuses to send credentials from an insecure-TLS source (Kotlin network interceptor)', async () => {
    const { handler } = createHandler({}, true);
    // Kotlin `buildClient`'s `addNetworkInterceptor` throws before `proceed`, so
    // `handleHttp` reports it as the `error` field instead of a response object.
    const raw = (await handler.handle({
      method: 'http',
      http_method: 'GET',
      url: 'https://example.com/a',
      headers: { Cookie: 'a=1' },
    })) as string;
    expect(JSON.parse(raw)).toEqual({ error: '不安全 TLS 书源不能发送登录凭据，请启用证书验证' });

    // Authorization counts too, in any casing (Kotlin `equals(..., true)`).
    for (const header of [{ authorization: 'Bearer x' }, { AUTHORIZATION: 'Bearer x' }]) {
      const withAuth = (await handler.handle({
        method: 'http',
        http_method: 'GET',
        url: 'https://example.com/a',
        headers: header,
      })) as string;
      expect(JSON.parse(withAuth).error).toBe('不安全 TLS 书源不能发送登录凭据，请启用证书验证');
    }

    // A credential-free request from the same source still goes out.
    const clean = (await handler.handle({
      method: 'http',
      http_method: 'GET',
      url: 'https://example.com/a',
    })) as string;
    expect(JSON.parse(clean).status).toBe(200);

    // A trusted source is never blocked, even with credentials.
    const trusted = createHandler();
    const trustedRaw = (await trusted.handler.handle({
      method: 'http',
      http_method: 'GET',
      url: 'https://example.com/a',
      headers: { Cookie: 'a=1' },
    })) as string;
    expect(JSON.parse(trustedRaw).status).toBe(200);
  });

  it('refuses to send jar cookies from an insecure-TLS source too', async () => {
    const { handler } = createHandler({}, true);
    // The jar cookie is merged into the request headers before the guard runs,
    // exactly like Kotlin's interceptor inspecting the final request headers.
    handler.handle({ method: 'cookie', function: 'set', url: 'https://example.com/', cookies: ['a=1'] });
    const raw = (await handler.handle({
      method: 'http',
      http_method: 'GET',
      url: 'https://example.com/a',
    })) as string;
    expect(JSON.parse(raw).error).toBe('不安全 TLS 书源不能发送登录凭据，请启用证书验证');
  });

  it('convert rsa resolves to null because Kotlin has no rsa branch', () => {
    const { handler } = createHandler();
    expect(handler.handle({ method: 'convert', type: 'rsa', value: 'x', key: 'k' })).toBeNull();
  });

  it('drops a null script header value instead of stringifying it to "null"', async () => {
    const { handler } = createHandler();
    // Kotlin `?.value?.toString()` on `{"Cookie": null}` is null, so nothing is
    // merged and the request carries no Cookie header at all.
    const raw = (await handler.handle({
      method: 'http',
      http_method: 'GET',
      url: 'https://example.com/a',
      headers: { Cookie: null },
    })) as string;
    expect(JSON.parse(raw).status).toBe(200);
  });

  it('base64-decodes with Android\'s lenient alphabet', () => {
    const { handler } = createHandler();
    const decode = (value: string): Uint8Array =>
      handler.handle({ method: 'convert', type: 'base64', isEncode: false, value }) as Uint8Array;
    // Android's Base64 decoder skips characters outside the alphabet (whitespace
    // included) and stops at the first `=`, where `atob` throws on all of these.
    expect(new TextDecoder().decode(decode('aG Vs bG8='))).toBe('hello');
    // The URL-safe `-`/`_` forms and a missing `=` are accepted too.
    expect(Array.from(decode('_---A EFCQw').slice(0, 4))).toEqual([0xff, 0xef, 0xbe, 0x00]);
  });

  it('parses cookie get/set and honours the delete', () => {
    const { handler } = createHandler();
    handler.handle({ method: 'cookie', function: 'set', url: 'https://example.com/', cookies: ['a=1'] });
    const list = handler.handle({ method: 'cookie', function: 'get', url: 'https://example.com/' });
    expect(JSON.parse(list as string)).toEqual([
      { name: 'a', value: '1', domain: 'example.com', path: '/' },
    ]);
    handler.handle({ method: 'cookie', function: 'delete', url: 'https://example.com/' });
    expect(handler.handle({ method: 'cookie', function: 'get', url: 'https://example.com/' })).toBe('[]');
  });

  it('caps the async delay at 45 seconds and returns null for UI stubs', async () => {
    const { handler } = createHandler();
    expect(await handler.handleAsync({ method: 'delay', time: 0 })).toBeNull();
    expect(handler.handle({ method: 'UI', function: 'showLoading' })).toBe(0);
    expect(handler.handle({ method: 'UI', function: 'showInputDialog' })).toBe('');
    expect(handler.handle({ method: 'UI', function: 'showSelectDialog' })).toBe(0);
  });

  it('random() clamps when max <= min', () => {
    const { handler } = createHandler();
    expect(handler.handle({ method: 'random', min: 5, max: 5, type: 'int' })).toBe(5);
    expect(handler.handle({ method: 'random', min: 9, max: 2, type: 'int' })).toBe(9);
  });
});

// ----------------------------------------------------------------------
// JsSourceEngine.kt — the bounded regex guards
// ----------------------------------------------------------------------

describe('JsSourceEngine.kt', () => {
  it('keeps the QuickJS limits at the Kotlin values', () => {
    // Kotlin L33 `executionDeadline = elapsedRealtime() + 45_000`,
    // L49 `memoryLimit = 32L * 1024 * 1024`, L50 `maxStackSize = 512L * 1024`.
    expect(EXECUTION_BUDGET_MS).toBe(45_000);
    expect(MEMORY_LIMIT).toBe(32 * 1024 * 1024);
    expect(MAX_STACK_SIZE).toBe(512 * 1024);
  });

  it('reports index/end/groups for a scanning match', () => {
    const raw = boundedRegex(['a(b)c', '', 'xxabcyy', 0]);
    expect(JSON.parse(raw)).toEqual({ index: 2, end: 5, groups: ['abc', 'b'] });
  });

  it('returns the string "null" when there is no match', () => {
    expect(boundedRegex(['zzz', '', 'abc', 0])).toBe('null');
  });

  it('honours the sticky flag by anchoring at start', () => {
    expect(JSON.parse(boundedRegex(['a', 'y', 'bab', 1]))).toMatchObject({ index: 1, end: 2 });
    expect(boundedRegex(['a', 'y', 'bab', 0])).toBe('null');
  });

  it('rejects an out-of-range start for both guards', () => {
    expect(boundedRegex(['a', '', 'abc', 99])).toBe('null');
    expect(boundedRegexBatch(['a', '', 'abc', 99])).toBe('[]');
  });

  it('enforces the 4096 character pattern guard', () => {
    expect(() => boundedRegex(['x'.repeat(4097), '', 'a', 0])).toThrow('Check failed.');
  });

  it('collects up to 128 batch matches and stops after one without g/y', () => {
    const many = boundedRegexBatch(['a', 'g', 'a'.repeat(200), 0]);
    expect(JSON.parse(many)).toHaveLength(128);
    const single = boundedRegexBatch(['a', '', 'aaa', 0]);
    expect(JSON.parse(single)).toHaveLength(1);
  });

  it('sums captured length toward the 64 KiB cap', () => {
    const raw = boundedRegexBatch(['(.{1000})', 'g', 'x'.repeat(40000), 0]);
    // Kotlin adds group(0) + group(1) = 2000 chars per iteration, so the
    // 65536 budget trips at 33 matches - well before the 128 match ceiling.
    expect(JSON.parse(raw)).toHaveLength(33);
  });
});

// ----------------------------------------------------------------------
// JsSourceRepo.kt
// ----------------------------------------------------------------------

describe('JsSourceRepo.kt', () => {
  it('validates a cached script', () => {
    expect(validScript('x'.repeat(1024))).toBe(true);
    expect(validScript('x'.repeat(1023))).toBe(false);
    expect(validScript(`  <html>${'x'.repeat(2000)}`)).toBe(false);
  });

  it('parses the index, dropping excluded/duplicate/unsafe entries', () => {
    const metas = JsSourceRepo.parseIndex(
      JSON.stringify([
        { key: 'aa', name: 'A', fileName: 'aa.js', version: '1' },
        { key: 'aa', name: 'dup', fileName: 'aa2.js' },
        { key: 'komga', fileName: 'komga.js' },
        { key: 'bb', fileName: '../evil.js' },
        { key: 'cc', fileName: 'cc.txt' },
        { key: 'nhentai', fileName: 'nhentai.js' },
        { key: 'dd' },
        'not-an-object',
      ]),
    );
    expect(metas.map((m) => m.key)).toEqual(['aa', 'nhentai']);
    expect(metas[0]).toMatchObject({ name: 'A', version: '1', adult: false, insecure: false });
    // name/version default to the key / "0"
    expect(metas[1]).toMatchObject({ name: 'nhentai', version: '0', adult: true });
  });

  it('rejects an oversized index', () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ key: `k${i}`, fileName: `k${i}.js` }));
    expect(() => JsSourceRepo.parseIndex(JSON.stringify(many))).toThrow('书源仓库条目过多');
  });

  it('rejects an over-deep index', () => {
    const deep = `${'['.repeat(200)}${']'.repeat(200)}`;
    expect(() => JsSourceRepo.parseIndex(deep)).toThrow();
  });

  it('applies the mxs loadEp replacement', () => {
    const script = [
      'class Mxs extends ComicSource {}',
      '  comic: {',
      '    loadEp: async (comicId, epId) => { old(); },',
      '    // 加载评论列表',
      '  },',
    ].join('\n');
    const patched = JsSourceRepo.patchScript('mxs', script);
    expect(patched).toContain("this.baseUrl + '/chapter/' + epId");
    expect(patched).toContain('onImageLoad: (url, comicId, epId)');
    expect(patched).toContain('// 加载评论列表');
    expect(patched).not.toContain('old()');
  });

  it('migrates the manwaba api domain', () => {
    expect(JsSourceRepo.patchScript('manwaba', 'const u = "https://mwuu.cc";')).toBe(
      'const u = "https://manwaxu.cc";',
    );
  });

  it('normalises the jm api-domain index', () => {
    const script = [
      'class Jm extends ComicSource {',
      "    static imageUrl = \"https://cdn-msp.jmapinodeudzn.net\"",
      '    get api() {',
      "        let index = parseInt(this.loadSetting('apiDomain')) - 1",
      '        return `https://${JM.apiDomains[index]}`',
      '    }',
      '    async run() {',
      '        const body = this.convertData(await res.text(), domainSecret)',
      '        let res = await Network.get(url, this.getApiHeaders(time))',
      '        if(res.status !== 200) {',
      '    }',
      '}',
    ].join('\n');
    const patched = JsSourceRepo.patchJm(script);
    expect(patched).toContain('static apiDomains = [');
    expect(patched).toContain('index >= JM.apiDomains.length) index = 0');
    expect(patched).toContain('res.status === 404');
    // BOM strip on the converted payload
    expect(patched).toContain("replace(/^\\uFEFF/, '')");
  });

  it('leaves unknown keys untouched', () => {
    expect(JsSourceRepo.patchScript('whatever', 'unchanged')).toBe('unchanged');
  });

  it('matches Kotlin trimIndent / prependIndent / replaceRange semantics', () => {
    expect(trimIndent('\n    a\n      b\n    ')).toBe('a\n  b');
    expect(prependIndent('a\nb', '  ')).toBe('  a\n  b');
    expect(replaceRange('abcdef', 1, 3, 'X')).toBe('aXdef');
    expect(replaceAllLiteral('aXbXc', 'X', '-')).toBe('a-b-c');
    // `$` in the replacement is literal, unlike String.prototype.replaceAll
    expect(replaceAllLiteral('x', 'x', '$&$&')).toBe('$&$&');
  });

  it('bounds a promise with withTimeout', async () => {
    await expect(withTimeout(5, Promise.resolve('fast'))).resolves.toBe('fast');
    await expect(withTimeout(5, new Promise(() => undefined))).resolves.toBeNull();
    await expect(withTimeout(50, Promise.reject(new Error('x')))).resolves.toBeNull();
  });

  it('runs mapWithConcurrency without exceeding the permit count', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapWithConcurrency(2, [1, 2, 3, 4, 5], async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('installs from the index, writing the RAW prefix and stamping the patch version', async () => {
    const files = createFileStorage();
    const metaPrefs = createMemoryKeyValueStorage();
    const script = `class Demo extends ComicSource {}\n${'x'.repeat(1100)}`;
    const http = createHttpStub((request) => {
      if (request.url.endsWith('index.json')) {
        return response(200, JSON.stringify([{ key: 'demo', name: 'Demo', fileName: 'demo.js', version: '2' }]));
      }
      return response(200, script);
    });
    const statuses: string[] = [];
    const installed = await JsSourceRepo.install(
      {
        files,
        http,
        metaPrefs,
        proxy: {} as never,
        createSource: (params) => ({ params } as never),
        systemDns: { lookup: async () => [] },
      },
      'https://example.com/repo/index.json',
      true,
      (m) => statuses.push(m),
    );
    expect(statuses).toEqual(['正在获取源仓库列表…', '已安装 1 个漫画源']);
    expect(files.readText('/data/js_sources/demo.js')).toBe(JsSourceRepo.RAW_CACHE_PREFIX + script);
    expect(files.readText('/data/js_sources/index.json')).toContain('"key":"demo"');
    expect(metaPrefs.getInt('patch_version', 0)).toBe(49);
    expect(installed).toHaveLength(1);
  });

  it('returns an empty install list when the index is unreachable', async () => {
    const files = createFileStorage();
    const installed = await JsSourceRepo.install(
      {
        files,
        http: createHttpStub(() => null),
        metaPrefs: createMemoryKeyValueStorage(),
        proxy: {} as never,
        createSource: (params) => ({ params } as never),
        systemDns: { lookup: async () => [] },
      },
      'https://example.com/repo/index.json',
      true,
    );
    expect(installed).toEqual([]);
  });

  it('loads cached sources and reports a needed repair', async () => {
    const files = createFileStorage();
    const metaPrefs = createMemoryKeyValueStorage();
    const index = JSON.stringify([{ key: 'demo', name: 'Demo', fileName: 'demo.js', version: '2' }]);
    const script = `class Demo extends ComicSource {}\n${'x'.repeat(1100)}`;
    files.writeText('/data/js_sources/index.json', index);
    files.writeText('/data/js_sources/demo.js', JsSourceRepo.RAW_CACHE_PREFIX + script);
    const deps = {
      files,
      http: createHttpStub(() => null),
      metaPrefs,
      proxy: {} as never,
      createSource: (params: { sourceKey: string }) => ({ key: params.sourceKey }) as never,
      systemDns: { lookup: async () => [] },
    };
    const loaded = await JsSourceRepo.loadCached(deps, true);
    expect(loaded).toHaveLength(1);
    // patch version is stale → repair needed
    expect(JsSourceRepo.needsRepair(deps, true)).toBe(true);
    metaPrefs.putInt('patch_version', 49);
    expect(JsSourceRepo.needsRepair(deps, true)).toBe(false);
    // a script without the raw prefix also needs repair
    files.writeText('/data/js_sources/demo.js', script);
    expect(JsSourceRepo.needsRepair(deps, true)).toBe(true);
  });

  it('flags missing script files for repair', async () => {
    const files = createFileStorage();
    files.writeText(
      '/data/js_sources/index.json',
      JSON.stringify([{ key: 'gone', fileName: 'gone.js' }]),
    );
    const metaPrefs = createMemoryKeyValueStorage();
    metaPrefs.putInt('patch_version', 49);
    expect(
      JsSourceRepo.needsRepair(
        {
          files,
          http: createHttpStub(() => null),
          metaPrefs,
          proxy: {} as never,
          createSource: () => ({}) as never,
          systemDns: { lookup: async () => [] },
        },
        true,
      ),
    ).toBe(true);
  });

  it('keeps the remaining cached sources when one source fails to construct', async () => {
    const files = createFileStorage(), body = `class Demo extends ComicSource {}\n/*${'x'.repeat(1100)}*/`;
    files.writeText('/data/js_sources/index.json', JSON.stringify([{ key: 'bad', fileName: 'bad.js' }, { key: 'good', fileName: 'good.js' }]));
    for (const key of ['bad', 'good']) files.writeText(`/data/js_sources/${key}.js`, JsSourceRepo.RAW_CACHE_PREFIX + body);
    const loaded = await JsSourceRepo.loadCached({ files, http: createHttpStub(() => null), metaPrefs: createMemoryKeyValueStorage(), proxy: {} as never,
      createSource: (params) => { if (params.sourceKey === 'bad') throw new Error('damaged definition'); return { key: params.sourceKey } as never; }, systemDns: { lookup: async () => [] } }, true);
    expect(loaded).toEqual([{ key: 'good' }]);
  });

  it('falls back to the local extras when the index is missing or invalid', async () => {
    const files = createFileStorage();
    files.assets.set('js_extra/vomic.js', `class Vomic extends ComicSource {}\n${'y'.repeat(1100)}`);
    const deps = {
      files,
      http: createHttpStub(() => null),
      metaPrefs: createMemoryKeyValueStorage(),
      proxy: {} as never,
      createSource: (params: { sourceKey: string }) => ({ key: params.sourceKey }) as never,
      systemDns: { lookup: async () => [] },
    };
    const noIndex = await JsSourceRepo.loadCached(deps, true);
    expect(noIndex.map((s) => (s as unknown as { key: string }).key)).toEqual(['vomic']);

    files.writeText('/data/js_sources/index.json', 'not json');
    const badIndex = await JsSourceRepo.loadCached(deps, true);
    expect(badIndex.map((s) => (s as unknown as { key: string }).key)).toEqual(['vomic']);
  });
});
