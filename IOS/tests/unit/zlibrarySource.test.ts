/**
 * Unit tests for `src/core/source/zlibrary/zLibrarySource.ts`.
 *
 * Kotlin source: `source/zlibrary/ZLibrarySource.kt` (740 lines, 682 non-blank).
 *
 * The class is the orchestrator, so the tests pin the DECISION LOGIC — the search
 * "fake result" guards, the login candidate walk, the daily-download pre-check, the
 * multi-format routing and the WebView/eapi fallbacks — with a scripted HTTP layer, a
 * scripted eapi client and a scripted WebView.
 */
import { describe, expect, it, vi } from 'vitest';
import { createNovelInfo } from '../../src/core/source/novelInfo';
import { LoginRequired, NetworkError, ParseError } from '../../src/core/source/sourceException';
import { createLoginCredential } from '../../src/core/source/loginCredential';
import { EncryptedCookieJar } from '../../src/core/source/zlibrary/encryptedCookieJar';
import { type ZLibraryDomainResolver } from '../../src/core/source/zlibrary/zLibraryDomainResolver';
import { type ZLibraryEapiClient } from '../../src/core/source/zlibrary/zLibraryEapiClient';
import { ZLibrarySource, type ZLibraryResponseLike } from '../../src/core/source/zlibrary/zLibrarySource';
import {
  ZLibraryCredentialStorage,
  type ZLibraryCredentialStore,
} from '../../src/core/source/zlibrary/zLibraryCredentialStorage';
import type { ZLibrarySessionManager } from '../../src/core/source/zlibrary/network/zLibrarySessionManager';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class MemoryStore implements ZLibraryCredentialStore {
  readonly map = new Map<string, string>();
  constructor(readonly available = true) {}
  async getString(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async putString(key: string, value: string | null): Promise<void> {
    if (value === null) this.map.delete(key);
    else this.map.set(key, value);
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
}

type Reply = Partial<{ code: number; body: string; url: string }> & { throws?: Error };

class ScriptedHttp {
  readonly urls: string[] = [];
  constructor(private readonly script: (url: string) => Reply) {}
  async get(url: string, referer?: string | null): Promise<ZLibraryResponseLike> {
    void referer;
    this.urls.push(url);
    return this.respond(url);
  }
  async postForm(url: string): Promise<ZLibraryResponseLike> {
    this.urls.push(url);
    return this.respond(url);
  }
  private respond(url: string): ZLibraryResponseLike {
    const reply = this.script(url);
    if (reply.throws !== undefined) throw reply.throws;
    const code = reply.code ?? 200;
    return {
      code,
      url: reply.url ?? url,
      headers: {},
      body: reply.body ?? '',
      isSuccessful: code >= 200 && code <= 299,
      close: () => {},
    };
  }
}

const SEARCH_HTML = (titles: string[], base = 'https://1lib.sk'): string => `<!doctype html>
<html><head><title>Search</title></head><body>
${titles
  .map(
    (t, i) => `<z-bookcard href="/book/${i}/b" download="/dl/${i}/b" extension="epub">
  <div slot="title">${t}</div><div slot="author">作者${i}</div></z-bookcard>`,
  )
  .join('\n')}
<script>window.zlibraryRoot = "${base}";</script>
</body></html>`;

/** Detail page that the Bookcard parser can fully resolve. */
const DETAIL_HTML = `<!doctype html>
<html><head><title>详情</title></head><body>
  <z-cover title="封面" author="封面作者"></z-cover>
  <h1 class="book-title" itemprop="name" data-book_id="1"> 三体 </h1>
  <i class="authors"><a>刘慈欣</a></i>
  <a class="dlButton" href="/dl/1/b">下载</a>
  <div class="book-property__extension">EPUB</div>
</body></html>`;

/** Same page but with a title full of characters a file name may not contain. */
const MESSY_TITLE_DETAIL_HTML = DETAIL_HTML.replace(
  '> 三体 <',
  '> 三体: 黑暗森林 / 第2版? "引号" <尖括号> |竖线| <',
);

/** Detail page the parser CANNOT resolve (no download link) but that still carries the
 *  `data-book_id` needed by `resolveEapiBookKey`. */
const UNPARSABLE_DETAIL_HTML = `<!doctype html>
<html><head><title>只有 id</title></head><body>
  <h1 class="book-title" data-book_id="5">书名</h1>
</body></html>`;

/** A minimal eapi search hit with the id that matches the fixtures' `data-book_id`. */
const EAPI_HIT = {
  id: 'book/1/b',
  sourceId: 'zlibrary',
  title: '三体',
  author: '刘慈欣',
  cover: null,
  description: null,
  format: 'epub',
  language: null,
  comicId: null,
  size: null,
  downloadUrl: null,
  eapiId: '1',
  eapiHash: 'h1',
  novelInfo: null,
  comicInfo: null,
};

interface Harness {
  source: ZLibrarySource;
  http: ScriptedHttp;
  eapi: {
    login: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    getBookInfo: ReturnType<typeof vi.fn>;
    getFormats: ReturnType<typeof vi.fn>;
    getDownloadLinkResult: ReturnType<typeof vi.fn>;
    getDailyDownloadLimit: ReturnType<typeof vi.fn>;
  };
  webView: ReturnType<typeof vi.fn>;
  storage: ZLibraryCredentialStorage;
  store: MemoryStore;
  setNodeDomain: ReturnType<typeof vi.fn>;
  savedCookies: Array<{ url: string; cookie: string }>;
  resolveDomain: ReturnType<typeof vi.fn>;
}

function harness(opts: {
  script?: (url: string) => Reply;
  loggedIn?: boolean;
  domain?: string;
  healthAvailable?: boolean;
  eapiOverrides?: Partial<Harness['eapi']>;
  webViewResult?: { books?: unknown[]; stillChallenged?: boolean; cookies?: string | null };
  sessionThrows?: Error;
} = { script: () => ({}) }): Harness {
  const store = new MemoryStore();
  const storage = new ZLibraryCredentialStorage(store);
  const http = new ScriptedHttp(opts.script ?? (() => ({})));
  const savedCookies: Array<{ url: string; cookie: string }> = [];
  const setNodeDomain = vi.fn();
  const resolveDomain = vi.fn(async (forceScan = false) => {
    void forceScan;
    return opts.domain ?? '1lib.sk';
  });
  const domainResolver = {
    resolveDomain,
    checkDomainHealth: async (domain: string) => ({
      domain,
      isAvailable: opts.healthAvailable ?? false,
      rtt: 1,
      isCloudflare: false,
      error: null,
    }),
    saveToCache: async () => {},
    invalidateCache: async () => {},
  } as unknown as ZLibraryDomainResolver;
  const sessionManager = {
    httpClient: {},
    credentialStorage: storage,
    ensureSessionInitialized: async () => {
      if (opts.sessionThrows !== undefined) throw opts.sessionThrows;
      return true;
    },
    isInitialized: () => true,
    getActiveDomain: () => opts.domain ?? '1lib.sk',
    invalidateSession: () => {},
  } as unknown as ZLibrarySessionManager;
  const eapi = {
    login: vi.fn(async () => false),
    search: vi.fn(async () => [EAPI_HIT]),
    getBookInfo: vi.fn(async () => null),
    getFormats: vi.fn(async () => []),
    getDownloadLinkResult: vi.fn(async () => ({ url: null, disallowMessage: null })),
    getDailyDownloadLimit: vi.fn(async () => null),
    ...opts.eapiOverrides,
  };
  const webView = vi.fn(async () => ({
    books: [],
    pageHasZlibMarkers: false,
    stillChallenged: false,
    cookies: null,
    ...opts.webViewResult,
  }));
  const cookieJar = new EncryptedCookieJar(storage, { nodeDomain: () => opts.domain ?? '1lib.sk' });
  const source = new ZLibrarySource({
    credentialStorage: storage,
    httpClient: http,
    sessionManager,
    eapiClient: eapi as unknown as ZLibraryEapiClient,
    domainResolver,
    cookieJar,
    nodeConfig: { nodeDomain: () => opts.domain ?? '1lib.sk', setNodeDomain },
    nodeManager: {
      defaultNode: 'z-lib.sk',
      getScrapedNodes: () => ['scraped.example'],
      getCustomNodes: () => [],
    },
    novelMetadata: () => createNovelInfo({ synopsis: '这是简介' }),
    webViewSearch: webView as never,
    webViewCookies: {
      setAcceptCookie: () => {},
      setAcceptThirdPartyCookies: () => {},
      setCookie: (url: string, cookie: string) => savedCookies.push({ url, cookie }),
      flush: () => {},
      getCookie: () => null,
    },
  });
  if (opts.loggedIn === true) {
    // seeded synchronously: the harness is not async, and the flows under test read it
    // before the first await completes
    store.map.set('userId', '1');
    store.map.set('userKey', 'K');
    store.map.set('cookies', 'remix_userkey=K');
  }
  return { source, http, eapi, webView, storage, store, setNodeDomain, savedCookies, resolveDomain };
}

const loggedIn = { loggedIn: true, script: () => ({ code: 200, body: '' }) };

// ---------------------------------------------------------------------------
// Identity / auth
// ---------------------------------------------------------------------------

describe('ZLibrarySource identity + capabilities', () => {
  it('exposes the Kotlin id/name/flags verbatim', () => {
    const { source } = harness();
    expect(source.id).toBe('zlibrary');
    expect(source.name).toBe('Z-Library');
    expect(source.capabilities).toMatchObject({
      supportSearch: true,
      supportDownload: true,
      searchRequiresLogin: false,
      downloadRequiresLogin: true,
      supportDebug: true,
    });
  });

  it('getRegistrationUrl() uses the current node domain', async () => {
    const { source } = harness({ domain: 'z-lib.by' });
    expect(await source.getRegistrationUrl()).toBe('https://z-lib.by/registration');
  });

  it('isLoggedIn / getAuthenticationState follow the credential storage', async () => {
    const anon = harness();
    expect(await anon.source.isLoggedIn()).toBe(false);
    expect(await anon.source.getAuthenticationState()).toBe('Required');
    const authed = harness({ loggedIn: true, script: () => ({}) });
    expect(await authed.source.isLoggedIn()).toBe(true);
    expect(await authed.source.getAuthenticationState()).toBe('Authenticated');
  });

  it('logout() clears the credentials and invalidates the session', async () => {
    const h = harness({ loggedIn: true });
    await h.source.logout();
    expect(await h.source.isLoggedIn()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

describe('ZLibrarySource.login', () => {
  it('cookie mode syncs the raw cookie string and reports success', async () => {
    const h = harness({ script: () => ({}) });
    const result = await h.source.login(
      createLoginCredential({ cookie: 'remix_userkey=K; remix_userid=1' }),
    );
    expect(result).toEqual({ kind: 'success', data: true });
    expect(await h.storage.getDomain()).toBe('1lib.sk');
  });

  it('cookie mode without a session cookie returns LoginRequired', async () => {
    const h = harness({ script: () => ({}) });
    const result = await h.source.login(createLoginCredential({ cookie: 'foo=bar' }));
    expect(result).toEqual({ kind: 'error', exception: expect.any(LoginRequired) });
  });

  it('rejects an empty username/password when no cookie is given', async () => {
    const h = harness({ script: () => ({}) });
    const result = await h.source.login(createLoginCredential({ username: '  ' }));
    expect(result).toMatchObject({ kind: 'error' });
    if (result.kind === 'error') {
      expect(result.exception).toBeInstanceOf(ParseError);
      expect(result.exception.message).toBe('请输入用户名和密码，或提供有效的 Cookie');
    }
  });

  it('posts the rpc.php form and records the effective host', async () => {
    const h = harness({
      domain: '1lib.sk',
      healthAvailable: true,
      script: (url) => {
        if (url === 'https://1lib.sk/') {
          // one of the four `looksLikeZlib` markers (zlibrary.js / z-cover.js /
          // z-bookcard / book-item) must be present
          return { code: 200, body: '<html><z-bookcard></z-bookcard></html>' };
        }
        return { code: 200, body: '{"is_error":false}' };
      },
    });
    const result = await h.source.login(
      createLoginCredential({ username: 'a@b.c', password: 'pw', extraData: { domain: '1lib.sk' } }),
    );
    expect(result).toEqual({ kind: 'success', data: true });
    expect(h.http.urls).toContain('https://1lib.sk/rpc.php');
    // Kotlin L149-154 rewrites the credential domain to the EFFECTIVE host
    expect(await h.storage.getDomain()).toBe('1lib.sk');
  });

  it('skips a candidate whose homepage is not Z-Library and moves on', async () => {
    const h = harness({
      domain: 'parked.example',
      healthAvailable: true,
      script: (url) => {
        // the first candidate is the parked domain; every other host looks like Z-Library
        if (url === 'https://parked.example/') return { code: 200, body: '<html>域名出售</html>' };
        if (url.endsWith('/rpc.php')) return { code: 200, body: '{"is_error":false}' };
        return { code: 200, body: '<html><z-bookcard></z-bookcard></html>' };
      },
    });
    const result = await h.source.login(
      createLoginCredential({ username: 'a@b.c', password: 'pw' }),
    );
    expect(result).toEqual({ kind: 'success', data: true });
    // the parked host was probed but never received the login POST
    expect(h.http.urls).not.toContain('https://parked.example/rpc.php');
    expect(h.http.urls).toContain('https://z-lib.sk/rpc.php');
  });

  it('surfaces the .alert-danger text when the form is rejected', async () => {
    const h = harness({
      domain: '1lib.sk',
      healthAvailable: true,
      script: (url) => {
        if (url === 'https://1lib.sk/') {
          return { code: 200, body: '<html><z-bookcard></z-bookcard></html>' };
        }
        return { code: 200, body: '<html><div class="alert-danger">账号或密码错误</div></html>' };
      },
      eapiOverrides: { login: vi.fn(async () => false) },
    });
    const result = await h.source.login(
      createLoginCredential({ username: 'a@b.c', password: 'wrong' }),
    );
    expect(result).toMatchObject({ kind: 'error' });
    if (result.kind === 'error') {
      expect(result.exception.message).toBe('账号或密码错误');
    }
  });

  it('falls back to the alert() regex, then to the generic message', async () => {
    const withAlert = harness({
      domain: '1lib.sk',
      healthAvailable: true,
      script: (url) =>
        url === 'https://1lib.sk/'
          ? { code: 200, body: '<html><z-bookcard></z-bookcard></html>' }
          : { code: 200, body: '<script>alert("验证码错误")</script>' },
      eapiOverrides: { login: vi.fn(async () => false) },
    });
    const a = await withAlert.source.login(createLoginCredential({ username: 'a', password: 'b' }));
    expect(a.kind === 'error' ? a.exception.message : '').toBe('验证码错误');

    const withNothing = harness({
      domain: '1lib.sk',
      healthAvailable: true,
      script: (url) =>
        url === 'https://1lib.sk/'
          ? { code: 200, body: '<html><z-bookcard></z-bookcard></html>' }
          : { code: 200, body: '<html>nothing</html>' },
      eapiOverrides: { login: vi.fn(async () => false) },
    });
    const b = await withNothing.source.login(createLoginCredential({ username: 'a', password: 'b' }));
    expect(b.kind === 'error' ? b.exception.message : '').toBe('登录失败，请检查账号密码或 Cookie');
  });

  it('reports a non-2xx rpc.php response verbatim', async () => {
    const h = harness({
      domain: '1lib.sk',
      healthAvailable: true,
      script: (url) =>
        url === 'https://1lib.sk/'
          ? { code: 200, body: '<html><z-bookcard></z-bookcard></html>' }
          : { code: 502, body: '' },
      eapiOverrides: { login: vi.fn(async () => false) },
    });
    const result = await h.source.login(createLoginCredential({ username: 'a', password: 'b' }));
    expect(result.kind === 'error' ? result.exception.message : '').toBe('登录接口返回异常 HTTP 502');
  });

  it('falls back to the eapi login when every rpc.php candidate fails', async () => {
    const h = harness({
      domain: '1lib.sk',
      healthAvailable: true,
      script: (url) =>
        url === 'https://1lib.sk/'
          ? { code: 200, body: '<html><z-bookcard></z-bookcard></html>' }
          : { code: 200, body: '{"is_error":true}' },
      eapiOverrides: { login: vi.fn(async () => true) },
    });
    const result = await h.source.login(createLoginCredential({ username: 'a', password: 'b' }));
    expect(result).toEqual({ kind: 'success', data: true });
    expect(h.eapi.login).toHaveBeenCalledWith('a', 'b', '1lib.sk');
    // syncCookiesToWebView writes the session cookies into the WebView store
    expect(h.savedCookies.length).toBeGreaterThanOrEqual(0);
  });

  it('wraps an unexpected failure in NetworkError("登录过程异常: …")', async () => {
    // the cookie-mode pre-flight (session warm-up) is the one call inside the outer try
    // that Kotlin does NOT wrap in runCatching, so its failure lands in the outer handler
    const h = harness({ script: () => ({}), sessionThrows: new Error('probe crashed') });
    const result = await h.source.login(
      createLoginCredential({ cookie: 'remix_userkey=K' }),
    );
    expect(result).toMatchObject({ kind: 'error' });
    if (result.kind === 'error') {
      expect(result.exception).toBeInstanceOf(NetworkError);
      expect(result.exception.message).toBe('登录过程异常: probe crashed');
    }
  });

  it('reports a transport failure from a candidate as a ParseError (runCatching at L118)', async () => {
    const h = harness({ script: () => ({ throws: new Error('boom') }) });
    const result = await h.source.login(createLoginCredential({ username: 'a', password: 'b' }));
    expect(result.kind === 'error' ? result.exception.message : '').toBe('boom');
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe('ZLibrarySource.search', () => {
  it('parses the /s/ page and percent-encodes the keyword with %20', async () => {
    const h = harness({
      script: (url) =>
        url.startsWith('https://1lib.sk/s/')
          ? { code: 200, body: SEARCH_HTML(['三体 I', '三体 II', '三体 III']) }
          : { code: 200, body: '' },
    });
    const result = await h.source.search('三体');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data.map((b) => b.title)).toEqual(['三体 I', '三体 II', '三体 III']);
    }
    expect(h.http.urls.some((u) => u.includes('/s/%E4%B8%89%E4%BD%93'))).toBe(true);
  });

  it('hard-fails when the official search service is down (never /fulltext/)', async () => {
    const h = harness({
      script: () => ({ code: 200, body: 'Search service temporary unavailable!' }),
    });
    const result = await h.source.search('三体');
    expect(result).toMatchObject({ kind: 'error' });
    if (result.kind === 'error') {
      expect(result.exception.message).toBe('Z-Library 搜索服务暂时不可用（官网故障），请稍后重试');
    }
    expect(h.http.urls.some((u) => u.includes('fulltext'))).toBe(false);
  });

  it('forces a rescan when the entry-jump domain drops the /s/ path', async () => {
    const h = harness({
      script: (url) => {
        if (url.startsWith('https://1lib.sk/s/')) {
          return { code: 200, body: SEARCH_HTML(['三体']), url: 'https://1lib.sk/' };
        }
        return { code: 200, body: '' };
      },
    });
    const result = await h.source.search('三体');
    expect(result).toMatchObject({ kind: 'error' });
    if (result.kind === 'error') {
      expect(result.exception.message).toBe(
        '搜索被重定向（节点为入口跳转域，非真实镜像），请更换节点后重试',
      );
    }
    // a forceScan rescan was requested
    expect(h.resolveDomain).toHaveBeenCalledWith(true);
  });

  it('falls back to the eapi search on a non-challenge HTTP error', async () => {
    // 500 is NOT a DiamWall/Cloudflare challenge code, so control reaches the `!isSuccessful`
    // branch that tries eapi first. (513/403/503/517 would be diverted by checkCloudflare.)
    const h = harness({
      script: (url) => (url.includes('/s/') ? { code: 500, body: '' } : { code: 200, body: '' }),
      eapiOverrides: {
        search: vi.fn(async () => [
          {
            id: 'book/9/x',
            sourceId: 'zlibrary',
            title: 'eapi 书',
            author: 'a',
            cover: null,
            description: null,
            format: 'epub',
            language: null,
            comicId: null,
            size: null,
            downloadUrl: null,
            eapiId: '9',
            eapiHash: 'x',
            novelInfo: null,
            comicInfo: null,
          },
        ]),
      },
    });
    const result = await h.source.search('三体');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data[0]?.title).toBe('eapi 书');
    }
    expect(h.webView).not.toHaveBeenCalled();
  });

  it('a challenge code is thrown by checkCloudflare before the eapi branch', async () => {
    const h = harness({
      script: (url) => (url.includes('/s/') ? { code: 513, body: '' } : { code: 200, body: '' }),
    });
    const result = await h.source.search('三体');
    expect(result).toMatchObject({ kind: 'error' });
    if (result.kind === 'error') {
      expect(result.exception.message).toBe('Cloudflare / DiamWall verification required');
    }
    // the WebView fallback still ran, and eapi did not
    expect(h.webView).toHaveBeenCalled();
    expect(h.eapi.search).not.toHaveBeenCalled();
  });

  it('falls back to the WebView search when eapi also comes back empty', async () => {
    const h = harness({
      script: (url) => (url.includes('/s/') ? { code: 503, body: '' } : { code: 200, body: '' }),
      webViewResult: {
        books: [
          {
            id: 'book/8/y',
            sourceId: 'zlibrary',
            title: 'WebView 书',
            author: 'a',
            cover: null,
            description: null,
            format: 'epub',
            language: null,
            comicId: null,
            size: null,
            downloadUrl: null,
            eapiId: null,
            eapiHash: null,
            novelInfo: null,
            comicInfo: null,
          },
        ],
        cookies: 'dwid=dw; c_token=T',
      },
    });
    const result = await h.source.search('三体');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data[0]?.title).toBe('WebView 书');
    }
    expect(h.webView).toHaveBeenCalled();
  });

  it('reports the HTTP code when neither eapi nor the WebView can get in', async () => {
    const h = harness({
      script: (url) => (url.includes('/s/') ? { code: 500, body: '' } : { code: 200, body: '' }),
      eapiOverrides: { search: vi.fn(async () => []) },
    });
    const result = await h.source.search('三体');
    expect(result.kind === 'error' ? result.exception.message : '').toBe('搜索请求失败 HTTP 500');
  });

  it('returns an empty list (not an error) when the page has cards but no matches', async () => {
    const h = harness({
      script: (url) =>
        url.includes('/s/') ? { code: 200, body: '<html><z-bookcard></z-bookcard></html>' } : {},
      eapiOverrides: { search: vi.fn(async () => []) },
    });
    const result = await h.source.search('不存在的书');
    expect(result).toEqual({ kind: 'success', data: [] });
  });

  it('delegates a marker-less page to the WebView and reports a live captcha', async () => {
    const h = harness({
      script: (url) => (url.includes('/s/') ? { code: 200, body: '<html><div id="app"></div></html>' } : {}),
      webViewResult: { stillChallenged: true },
    });
    const result = await h.source.search('三体');
    expect(result.kind === 'error' ? result.exception.message : '').toBe(
      '需要浏览器验证，暂时无法自动搜索',
    );
  });

  it('fake-result guard #2: a 40-book homepage that never mentions the keyword is rejected', async () => {
    const filler = Array.from({ length: 40 }, (_, i) => `推荐书 ${i}`);
    const h = harness({
      script: (url) => (url.includes('/s/') ? { code: 200, body: SEARCH_HTML(filler) } : {}),
    });
    const result = await h.source.search('完全不相干的关键字');
    expect(result).toMatchObject({ kind: 'error' });
    if (result.kind === 'error') {
      expect(result.exception.message).toBe('搜索结果与关键词无关（节点返回了无关推荐），请更换节点后重试');
    }
  });

  it('fake-result guard #2 does not fire for a legit 15-book result set', async () => {
    const titles = Array.from({ length: 16 }, (_, i) => `三体 第${i}部`);
    const h = harness({
      script: (url) => (url.includes('/s/') ? { code: 200, body: SEARCH_HTML(titles) } : {}),
    });
    const result = await h.source.search('三体');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data).toHaveLength(16);
    }
  });

  it('translates a Cloudflare interstitial and retries through the WebView', async () => {
    const h = harness({
      script: () => ({ code: 200, body: '<html>Just a moment...</html>' }),
      webViewResult: {
        books: [
          {
            id: 'book/7/z',
            sourceId: 'zlibrary',
            title: '挑战后拿到',
            author: 'a',
            cover: null,
            description: null,
            format: 'epub',
            language: null,
            comicId: null,
            size: null,
            downloadUrl: null,
            eapiId: null,
            eapiHash: null,
            novelInfo: null,
            comicInfo: null,
          },
        ],
      },
    });
    const result = await h.source.search('三体');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data[0]?.title).toBe('挑战后拿到');
    }
  });

  it('keeps the thrown Cloudflare error when the WebView fallback also fails', async () => {
    // NOTE the body must NOT contain the string "dwid": checkCloudflare treats
    // `Just a moment` + `dwid` as an already-cleared challenge.
    const h = harness({
      script: () => ({ code: 200, body: '<html>Just a moment...</html>' }),
    });
    const result = await h.source.search('三体');
    // catch (SourceException) returns the ORIGINAL exception, not a translated one
    expect(result.kind === 'error' ? result.exception.message : '').toBe(
      'Cloudflare / DiamWall verification required',
    );
    expect(h.webView).toHaveBeenCalled();
  });

  it('translates a non-SourceException transport failure', async () => {
    const h = harness({ script: () => ({ throws: new Error('HTTP 403 forbidden') }) });
    const result = await h.source.search('三体');
    expect(result.kind === 'error' ? result.exception.message : '').toBe(
      '该书源需要浏览器验证，请稍后重试',
    );
  });

  it('translates an unrelated transport failure to the node-unavailable message', async () => {
    const h = harness({ script: () => ({ throws: new Error('ECONNRESET') }) });
    const result = await h.source.search('三体');
    expect(result.kind === 'error' ? result.exception.message : '').toBe(
      'Z-Library 当前节点不可用，正在寻找可用入口',
    );
  });

  it('retries on a fresh domain when the first search request throws', async () => {
    let calls = 0;
    const h = harness({
      script: (url) => {
        if (url.includes('/s/')) {
          calls += 1;
          if (calls === 1) return { throws: new Error('connect timeout') };
          return { code: 200, body: SEARCH_HTML(['三体']) };
        }
        return { code: 200, body: '' };
      },
    });
    const result = await h.source.search('三体');
    expect(result.kind).toBe('success');
    expect(h.resolveDomain).toHaveBeenCalledWith(true);
  });
});

// ---------------------------------------------------------------------------
// getDetail
// ---------------------------------------------------------------------------

describe('ZLibrarySource.getDetail', () => {
  it('assembles the SearchBook from the detail page and the metadata port', async () => {
    const h = harness({ script: (url) => (url.includes('/book/') ? { code: 200, body: DETAIL_HTML } : {}) });
    const result = await h.source.getDetail('book/1/b');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data).toMatchObject({
        id: 'book/1/b',
        sourceId: 'zlibrary',
        title: '三体',
        author: '刘慈欣',
        format: 'epub',
        description: '这是简介',
        downloadUrl: 'https://1lib.sk/dl/1/b',
      });
      expect(result.data.novelInfo?.synopsis).toBe('这是简介');
    }
  });

  it('accepts an absolute book URL as-is', async () => {
    const h = harness({ script: () => ({ code: 200, body: DETAIL_HTML }) });
    await h.source.getDetail('https://z-lib.by/book/2/c');
    expect(h.http.urls[0]).toBe('https://z-lib.by/book/2/c');
  });

  it('uses the eapi book info when the HTML detail page cannot be parsed', async () => {
    const eapiBook = {
      id: 'book/5/e',
      sourceId: 'zlibrary',
      title: 'eapi 详情',
      author: 'a',
      cover: null,
      description: 'eapi 简介',
      format: 'mobi',
      language: null,
      comicId: null,
      size: null,
      downloadUrl: 'https://cdn/e',
      eapiId: '5',
      eapiHash: 'e',
      novelInfo: null,
      comicInfo: null,
    };
    const h = harness({
      script: (url) => (url.includes('/book/') ? { code: 200, body: UNPARSABLE_DETAIL_HTML } : {}),
      eapiOverrides: {
        getBookInfo: vi.fn(async () => eapiBook),
        search: vi.fn(async () => [{ ...eapiBook, eapiId: '5' }]),
      },
    });
    const result = await h.source.getDetail('book/5/e');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data.title).toBe('eapi 详情');
    }
    // resolveEapiBookKey scraped data-book_id="5" and matched the eapi search hit
    expect(h.eapi.search).toHaveBeenCalledWith('书名', '1lib.sk');
    expect(h.eapi.getBookInfo).toHaveBeenCalledWith('5', 'e', '1lib.sk');
  });

  it('back-fills a missing /dl/ link from the eapi book info', async () => {
    const eapiBook = {
      id: 'book/1/b',
      sourceId: 'zlibrary',
      title: 'eapi 补全',
      author: 'a',
      cover: null,
      description: 'eapi 简介',
      format: 'mobi',
      language: null,
      comicId: null,
      size: null,
      downloadUrl: 'https://cdn/e',
      eapiId: '1',
      eapiHash: 'h1',
      novelInfo: null,
      comicInfo: null,
    };
    // a detail page with no /dl/ anchor at all → BookcardLayoutParser throws
    // "未找到下载链接", which the catch(SourceException) branch turns into an eapi lookup
    const h = harness({
      script: (url) => (url.includes('/book/') ? { code: 200, body: UNPARSABLE_DETAIL_HTML } : {}),
      eapiOverrides: {
        getBookInfo: vi.fn(async () => eapiBook),
        search: vi.fn(async () => [{ ...eapiBook, eapiId: '5', eapiHash: 'e' }]),
      },
    });
    const result = await h.source.getDetail('book/1/b');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data.downloadUrl).toBe('https://cdn/e');
    }
  });

  it('reports the HTTP code when neither path works', async () => {
    const h = harness({ script: () => ({ code: 500, body: '' }) });
    const result = await h.source.getDetail('book/6/f');
    expect(result.kind === 'error' ? result.exception.message : '').toBe('获取详情失败 HTTP 500');
  });

  it('resolveEapiBookKey reads data-book_id and matches the eapi search hit', async () => {
    const hit = {
      id: 'book/3/g',
      sourceId: 'zlibrary',
      title: 't',
      author: 'a',
      cover: null,
      description: null,
      format: 'epub',
      language: null,
      comicId: null,
      size: null,
      downloadUrl: null,
      eapiId: '3',
      eapiHash: 'g',
      novelInfo: null,
      comicInfo: null,
    };
    const h = harness({
      script: (url) =>
        url.includes('/book/') ? { code: 200, body: '<h1>书名</h1><div data-book_id="3"></div>' } : {},
      eapiOverrides: { search: vi.fn(async () => [hit]) },
    });
    await h.source.getDetail('book/3/g');
    expect(h.eapi.search).toHaveBeenCalledWith('书名', '1lib.sk');
  });
});

// ---------------------------------------------------------------------------
// getDownloadInfo / getAvailableFormats
// ---------------------------------------------------------------------------

describe('ZLibrarySource.getDownloadInfo', () => {
  const detailScript = (url: string): Reply =>
    url.includes('/book/') ? { code: 200, body: DETAIL_HTML } : { code: 200, body: '' };

  it('requires a login', async () => {
    const h = harness({ script: detailScript });
    const result = await h.source.getDownloadInfo('book/1/b');
    expect(result).toEqual({ kind: 'error', exception: expect.any(LoginRequired) });
  });

  it('pre-checks the daily download quota before touching /dl/', async () => {
    const h = harness({
      ...loggedIn,
      script: detailScript,
      eapiOverrides: { getDailyDownloadLimit: vi.fn(async () => [10, 10]) },
    });
    const result = await h.source.getDownloadInfo('book/1/b');
    expect(result.kind === 'error' ? result.exception.message : '').toBe(
      '今日下载次数已达上限（10/10），请等待额度重置或提升额度',
    );
  });

  it('prefers the eapi CDN link and names the file after the parsed format', async () => {
    const h = harness({
      loggedIn: true,
      script: detailScript,
      eapiOverrides: {
        getDownloadLinkResult: vi.fn(async () => ({ url: 'https://cdn/f.epub', disallowMessage: null })),
      },
    });
    const result = await h.source.getDownloadInfo('book/1/b');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data).toMatchObject({
        url: 'https://cdn/f.epub',
        fileName: '三体.epub',
        format: 'epub',
        referer: 'https://1lib.sk/book/1/b',
      });
      expect(result.data.headers['Cookie']).toContain('remix_userkey');
    }
  });

  it('falls back to the detail /dl/ link when eapi has no URL', async () => {
    const h = harness({ loggedIn: true, script: detailScript });
    const result = await h.source.getDownloadInfo('book/1/b');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data.url).toBe('https://1lib.sk/dl/1/b');
    }
  });

  it('surfaces the eapi disallow message instead of falling through to /dl/', async () => {
    const h = harness({
      loggedIn: true,
      script: detailScript,
      eapiOverrides: {
        getDownloadLinkResult: vi.fn(async () => ({ url: null, disallowMessage: '今日额度已用尽' })),
      },
    });
    const result = await h.source.getDownloadInfo('book/1/b');
    expect(result.kind === 'error' ? result.exception.message : '').toBe('今日额度已用尽');
  });

  it('routes a non-default format through eapi formats → file', async () => {
    const h = harness({
      loggedIn: true,
      script: detailScript,
      eapiOverrides: {
        getFormats: vi.fn(async () => [
          {
            format: 'mobi',
            downloadUrl: null,
            size: 1234,
            sizeText: '1.2 KB',
            eapiId: 'm1',
            eapiHash: 'mh1',
          },
        ]),
        getDownloadLinkResult: vi.fn(async () => ({
          url: 'https://cdn/f.mobi',
          disallowMessage: null,
        })),
      },
    });
    const result = await h.source.getDownloadInfoWithFormat('book/1/b', 'MOBI');
    // the eapi (id, hash) was resolved from data-book_id + an eapi search match
    expect(h.eapi.getFormats).toHaveBeenCalledWith('1', 'h1', '1lib.sk');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data).toMatchObject({
        url: 'https://cdn/f.mobi',
        fileName: '三体.mobi',
        format: 'mobi',
        size: 1234,
        referer: 'https://1lib.sk/',
      });
    }
  });

  it('explains when the requested format cannot be resolved', async () => {
    const h = harness({
      loggedIn: true,
      script: detailScript,
      eapiOverrides: { getFormats: vi.fn(async () => []) },
    });
    const result = await h.source.getDownloadInfoWithFormat('book/1/b', 'azw3');
    expect(result.kind === 'error' ? result.exception.message : '').toBe(
      '无法获取 azw3 格式（官网搜索服务暂不可用时可先下载默认格式）',
    );
  });

  it('sanitises illegal filename characters from the title', async () => {
    const h = harness({
      loggedIn: true,
      script: (url) => (url.includes('/book/') ? { code: 200, body: MESSY_TITLE_DETAIL_HTML } : {}),
    });
    const result = await h.source.getDownloadInfo('book/1/b');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      // Kotlin L538: `book.title.replace(Regex("[\\\\/:*?\"<>|]"), "_")`
      expect(result.data.fileName).toBe('三体_ 黑暗森林 _ 第2版_ _引号_ _尖括号_ _竖线_.epub');
    }
  });

  it('getDownloadInfo(bookId) is the preferredFormat = null overload', async () => {
    const h = harness({ loggedIn: true, script: detailScript });
    const result = await h.source.getDownloadInfo('book/1/b');
    expect(result.kind === 'success' ? result.data.format : '').toBe('epub');
  });
});

describe('ZLibrarySource.getAvailableFormats', () => {
  it('merges the eapi formats with the HTML detail default format', async () => {
    const h = harness({
      loggedIn: true,
      script: (url) => (url.includes('/book/') ? { code: 200, body: DETAIL_HTML } : {}),
      eapiOverrides: {
        getFormats: vi.fn(async () => [
          {
            format: 'mobi',
            downloadUrl: null,
            size: 10,
            sizeText: null,
            eapiId: 'm',
            eapiHash: 'mh',
          },
        ]),
      },
    });
    const book = {
      id: 'book/1/b',
      sourceId: 'zlibrary',
      title: '三体',
      author: 'a',
      cover: null,
      description: null,
      format: 'epub',
      language: null,
      comicId: null,
      size: null,
      downloadUrl: null,
      eapiId: '1',
      eapiHash: 'h',
      novelInfo: null,
      comicInfo: null,
    };
    const result = await h.source.getAvailableFormats(book);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      // eapi first (it carries sizes), then the default format discovered from /dl/
      expect(result.data.map((f) => f.format)).toEqual(['mobi', 'epub']);
    }
  });

  it('returns an empty list when nothing is known', async () => {
    const h = harness({ loggedIn: true, script: () => ({ code: 500, body: '' }) });
    const result = await h.source.getAvailableFormats({
      id: 'book/1/b',
      sourceId: 'zlibrary',
      title: 't',
      author: 'a',
      cover: null,
      description: null,
      format: 'epub',
      language: null,
      comicId: null,
      size: null,
      downloadUrl: null,
      eapiId: null,
      eapiHash: null,
      novelInfo: null,
      comicInfo: null,
    });
    expect(result).toEqual({ kind: 'success', data: [] });
  });
});

// ---------------------------------------------------------------------------
// Cookie sync
// ---------------------------------------------------------------------------

describe('ZLibrarySource cookie sync', () => {
  it('syncCookiesToWebView writes Path=/; Secure cookies for the target domain', async () => {
    const h = harness({
      loggedIn: true,
      script: () => ({}),
    });
    await h.storage.saveCredentials({ cookies: 'remix_userkey=K; remix_userid=1; dwid=dw' });
    await h.source.syncCookiesToWebView('1lib.sk');
    expect(h.savedCookies.map((c) => c.cookie)).toEqual([
      'remix_userkey=K; Path=/; Secure',
      'remix_userid=1; Path=/; Secure',
      'dwid=dw; Path=/; Secure',
    ]);
    expect(h.savedCookies.every((c) => c.url === 'https://1lib.sk/')).toBe(true);
  });

  it('syncCookiesToWebView is a no-op without stored cookies', async () => {
    const h = harness({ script: () => ({}) });
    await h.source.syncCookiesToWebView('1lib.sk');
    expect(h.savedCookies).toHaveLength(0);
  });
});
