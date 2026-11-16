/**
 * Unit tests for the ported DiamWall interceptor and the WebView challenge fallback.
 *
 * Kotlin sources:
 *   source/zlibrary/DiamWallInterceptor.kt        (247 lines)
 *   source/zlibrary/ZLibraryWebViewHelper.kt      (199 lines)
 *
 * Both files reach for Android-only capabilities (an OkHttp `Interceptor` chain and
 * `android.webkit.WebView`). The port declares injected interfaces for them, so these tests
 * drive the real state machines with a scripted transport and a fake WebView runtime — no
 * network, no DOM, no timers that need real time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiamWallInterceptor } from '../../src/core/source/zlibrary/diamWallInterceptor';
import { buildCookie, type ZLibraryCookie } from '../../src/core/source/zlibrary/encryptedCookieJar';
import {
  DEFAULT_ACCEPT,
  DEFAULT_USER_AGENT,
  type ZLibraryHttpRequestSpec,
  type ZLibraryHttpResponse,
  type ZLibraryHttpTransport,
} from '../../src/core/source/zlibrary/network/zLibraryHttpClient';
import {
  ZLibraryWebViewHelper,
  type HtmlRuntimeCookieStore,
  type HtmlRuntimeFactory,
  type HtmlRuntimePage,
  type HtmlRuntimeSettings,
} from '../../src/core/source/zlibrary/zLibraryWebViewHelper';

const HOST = 'https://1lib.sk';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class ScriptedTransport implements ZLibraryHttpTransport {
  readonly urls: string[] = [];
  constructor(private readonly script: (url: string, n: number) => Partial<ZLibraryHttpResponse>) {}
  async send(spec: ZLibraryHttpRequestSpec): Promise<ZLibraryHttpResponse> {
    const n = this.urls.length;
    this.urls.push(spec.url);
    const partial = this.script(spec.url, n);
    return {
      code: partial.code ?? 200,
      url: partial.url ?? spec.url,
      headers: partial.headers ?? {},
      setCookies: partial.setCookies ?? [],
      body: partial.body ?? '',
      isSuccessful: (partial.code ?? 200) >= 200 && (partial.code ?? 200) <= 299,
      close: () => {},
    };
  }
}

class RecordingCookieJar {
  readonly saved: Array<{ url: string; cookies: ZLibraryCookie[] }> = [];
  async saveFromResponse(url: URL, cookies: ZLibraryCookie[]): Promise<void> {
    this.saved.push({ url: url.toString(), cookies });
  }
  names(): string[] {
    return this.saved.flatMap((entry) => entry.cookies.map((c) => c.name));
  }
  valueOf(name: string): string | undefined {
    return this.saved.flatMap((entry) => entry.cookies).find((c) => c.name === name)?.value;
  }
}

function makeInterceptor(transport: ZLibraryHttpTransport, jar: RecordingCookieJar): DiamWallInterceptor {
  return new DiamWallInterceptor({
    transport,
    cookieJar: jar,
    defaultHeaders: { 'User-Agent': DEFAULT_USER_AGENT, Accept: DEFAULT_ACCEPT },
  });
}

// A challenge page whose SHA-1 targets are satisfiable at nonce 0 (n1 = 0).
const TOKEN = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
async function sha1PowHtml(): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${TOKEN}0`)),
  );
  const t1 = (digest[0] ?? 0).toString(16).padStart(2, '0');
  const t2 = (digest[1] ?? 0).toString(16).padStart(2, '0');
  return `<html><script>var s='${TOKEN}';
    if (s[n1]===0x${t1} && s[n1+0x1]===0x${t2}) { document.cookie="c_token="+s+i; }</script></html>`;
}

// ---------------------------------------------------------------------------
// DiamWallInterceptor
// ---------------------------------------------------------------------------

describe('DiamWallInterceptor', () => {
  it('passes a clean 200 response straight through without re-issuing a request', async () => {
    const transport = new ScriptedTransport(() => ({ code: 200, body: '<html>ok</html>' }));
    const jar = new RecordingCookieJar();
    const response = await makeInterceptor(transport, jar).intercept({
      url: `${HOST}/s/x`,
      referer: `${HOST}/`,
      extraHeaders: {},
    });
    expect(response.code).toBe(200);
    expect(transport.urls).toEqual([`${HOST}/s/x`]);
    expect(jar.saved).toHaveLength(0);
  });

  it('follows a 307 redirect and stores the dwid cookie found in the redirect body', async () => {
    const transport = new ScriptedTransport((url) => {
      if (url === `${HOST}/s/x`) {
        return {
          code: 307,
          headers: { Location: '/s/x?redirected=1' },
          body: '<script>document.cookie="dwid=dw-redirect; path=/";</script>',
        };
      }
      return { code: 200, body: '<html>final</html>' };
    });
    const jar = new RecordingCookieJar();
    const response = await makeInterceptor(transport, jar).intercept({
      url: `${HOST}/s/x`,
      referer: null,
      extraHeaders: {},
    });
    expect(response.code).toBe(200);
    expect(transport.urls).toEqual([`${HOST}/s/x`, `${HOST}/s/x?redirected=1`]);
    expect(jar.names()).toEqual(['dwid']);
    expect(jar.valueOf('dwid')).toBe('dw-redirect');
  });

  it('leaves a redirect response alone when there is no Location header', async () => {
    const transport = new ScriptedTransport(() => ({ code: 302, headers: {} }));
    const jar = new RecordingCookieJar();
    const response = await makeInterceptor(transport, jar).intercept({
      url: `${HOST}/s/x`,
      referer: null,
      extraHeaders: {},
    });
    expect(response.code).toBe(302);
    expect(transport.urls).toHaveLength(1);
  });

  it('solves the c_token SHA-1 PoW, stores c_token/c_time and retries', async () => {
    const powHtml = await sha1PowHtml();
    const transport = new ScriptedTransport((_url, n) =>
      n === 0
        ? { code: 503, body: `<html>DiamWall<script>document.cookie="dwid=dw1; path=/";document.cookie="_dwa=0; path=/";</script>${powHtml}</html>` }
        : { code: 200, body: '<html>passed</html>' },
    );
    const jar = new RecordingCookieJar();
    const response = await makeInterceptor(transport, jar).intercept({
      url: `${HOST}/s/y`,
      referer: null,
      extraHeaders: {},
    });
    expect(response.code).toBe(200);
    expect(transport.urls).toEqual([`${HOST}/s/y`, `${HOST}/s/y`]);
    // the challenge cookies first, then the solved pair — in the Kotlin order
    expect(jar.names()).toEqual(['dwid', '_dwa', 'c_token', 'c_time']);
    expect(jar.valueOf('c_time')).toBe('1');
    // the solved c_token is TOKEN + the winning nonce
    expect(jar.valueOf('c_token')).toMatch(new RegExp(`^${TOKEN}\\d+$`));
    expect(jar.saved.every((entry) => entry.cookies.every((c) => c.domain === '1lib.sk'))).toBe(true);
  });

  it('treats a 200 text/html DiamWall body as a challenge (the downloader trap)', async () => {
    const powHtml = await sha1PowHtml();
    const transport = new ScriptedTransport((_url, n) =>
      n === 0
        ? {
            code: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            // 200 + text/html is not a challenge status, so one of the body markers must
            // identify the DiamWall page — exactly the Kotlin `smellsLikeDiamWall` branch.
            body: `<html><head><title>DiamWall</title></head><body>${powHtml}</body></html>`,
          }
        : { code: 200, body: '<html>passed</html>' },
    );
    const jar = new RecordingCookieJar();
    const response = await makeInterceptor(transport, jar).intercept({
      url: `${HOST}/s/z`,
      referer: null,
      extraHeaders: {},
    });
    expect(transport.urls).toHaveLength(2);
    expect(jar.names()).toContain('c_token');
    expect(response.code).toBe(200);
  });

  it('does NOT treat a 200 text/plain body as a challenge', async () => {
    const transport = new ScriptedTransport(() => ({
      code: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
      body: 'diamwall',
    }));
    const jar = new RecordingCookieJar();
    await makeInterceptor(transport, jar).intercept({
      url: `${HOST}/dl/1/2/a.pdf`,
      referer: null,
      extraHeaders: {},
    });
    expect(transport.urls).toHaveLength(1);
  });

  it('fetches the same-origin challenge iframe and solves the PoW it contains', async () => {
    const powHtml = await sha1PowHtml();
    const transport = new ScriptedTransport((url, n) => {
      if (url.includes('/.well-known/diamwall/load/html/')) {
        return { code: 200, body: powHtml };
      }
      return n === 0
        ? {
            code: 503,
            // Kotlin L118 reads the 40-hex TOKEN out of `bodyString` (the outer challenge page)
            // while L119-120 read the two byte targets out of `powHtml` (the iframe). So the
            // outer page must carry the token for the branch to be reachable at all — the real
            // DiamWall page ships the token inline for its postMessage handshake.
            body: `<html><script>var TOKEN='${TOKEN}';</script><iframe src="https://1lib.sk/.well-known/diamwall/load/html/challenge-abc"></iframe></html>`,
          }
        : { code: 200, body: '<html>passed</html>' };
    });
    const jar = new RecordingCookieJar();
    const response = await makeInterceptor(transport, jar).intercept({
      url: `${HOST}/s/w`,
      referer: null,
      extraHeaders: {},
    });
    expect(transport.urls[1]).toBe('https://1lib.sk/.well-known/diamwall/load/html/challenge-abc');
    expect(transport.urls[2]).toBe(`${HOST}/s/w`);
    expect(jar.names()).toContain('c_token');
    expect(response.code).toBe(200);
  });

  it('does NOT solve the SHA-1 PoW when the token is only in the iframe (Kotlin searches bodyString)', async () => {
    // Kotlin L118: `Regex("""['"]([0-9A-Fa-f]{40})['"]""").find(bodyString)`. With no 40-hex
    // token in the OUTER challenge page the whole PoW branch is skipped and the response is
    // returned as-is — the port must not silently widen the search to the iframe body.
    const powHtml = await sha1PowHtml();
    const transport = new ScriptedTransport((url, n) => {
      if (url.includes('/.well-known/diamwall/load/html/')) {
        return { code: 200, body: powHtml };
      }
      return n === 0
        ? {
            code: 503,
            body: '<html><iframe src="https://1lib.sk/.well-known/diamwall/load/html/challenge-abc"></iframe></html>',
          }
        : { code: 200, body: '<html>passed</html>' };
    });
    const jar = new RecordingCookieJar();
    const response = await makeInterceptor(transport, jar).intercept({
      url: `${HOST}/s/w2`,
      referer: null,
      extraHeaders: {},
    });
    expect(transport.urls).toHaveLength(2); // initial + the iframe fetch, no retry
    expect(jar.names()).not.toContain('c_token');
    expect(response.code).toBe(503);
  });

  it('stops immediately on an interactive CAPTCHA challenge', async () => {
    const transport = new ScriptedTransport(() => ({
      code: 503,
      body: '<html>Please solve this captcha<script src="//cpt.lib/x.js"></script></html>',
    }));
    const jar = new RecordingCookieJar();
    const response = await makeInterceptor(transport, jar).intercept({
      url: `${HOST}/s/captcha`,
      referer: null,
      extraHeaders: {},
    });
    // no retry at all — the HTTP client cannot solve cpt.lib
    expect(transport.urls).toHaveLength(1);
    expect(response.code).toBe(503);
    expect(jar.names()).toEqual([]);
  });

  it('follows the legacy SHA-256 verify redirect', async () => {
    const transport = new ScriptedTransport((_url, n) =>
      n === 0
        ? { code: 200, headers: { 'Content-Type': 'text/html' }, body: '<html>Checking your browser<script>var TOKEN="deadbeefcafe"; var DIFF=1;</script></html>' }
        : { code: 200, body: '<html>passed</html>' },
    );
    const jar = new RecordingCookieJar();
    const response = await makeInterceptor(transport, jar).intercept({
      url: `${HOST}/s/legacy`,
      referer: null,
      extraHeaders: {},
    });
    expect(transport.urls).toHaveLength(2);
    expect(transport.urls[1]).toMatch(
      new RegExp(`^https://1lib\\.sk/__ab/verify\\?t=deadbeefcafe&n=\\d+&r=`),
    );
    expect(response.code).toBe(200);
  });

  it('aborts the redirect/challenge dance after the same URL is visited more than 3 times', async () => {
    // DiamWall's 307→503 dance legitimately revisits the same URL up to 3 times, so the guard
    // only trips on the 4th (Kotlin L22-31: `if (hits > 3) break`).
    const transport = new ScriptedTransport(() => ({
      code: 307,
      headers: { Location: '/s/loop' },
      body: '<html>again</html>',
    }));
    const jar = new RecordingCookieJar();
    const response = await makeInterceptor(transport, jar).intercept({
      url: `${HOST}/s/loop`,
      referer: null,
      extraHeaders: {},
    });
    expect(response.code).toBe(307);
    // 1 initial visit + 3 revisits, then the guard stops the chain
    expect(transport.urls).toHaveLength(4);
  });

  it('keeps following a self-redirect chain that keeps changing the URL', async () => {
    let n = 0;
    const transport = new ScriptedTransport(() => {
      n += 1;
      return { code: 307, headers: { Location: `/s/loop${n}` }, body: '' };
    });
    const jar = new RecordingCookieJar();
    await makeInterceptor(transport, jar).intercept({
      url: `${HOST}/s/loop0`,
      referer: null,
      extraHeaders: {},
    });
    // the Kotlin `while (followUpCount < 8)` cap, not the URL guard: 1 initial + 8 follow-ups
    expect(transport.urls).toHaveLength(9);
  });

  it('buildCookie() is reused for the challenge cookies (path "/", persistent)', () => {
    expect(buildCookie('dwid', 'v', '1lib.sk')).toEqual({
      name: 'dwid',
      value: 'v',
      domain: '1lib.sk',
      path: '/',
      expiresAt: Number.POSITIVE_INFINITY,
      secure: false,
    });
  });
});

// ---------------------------------------------------------------------------
// ZLibraryWebViewHelper
// ---------------------------------------------------------------------------

const SEARCH_PAGE = `<!doctype html><html><head><title>Search</title></head><body>
  <z-bookcard href="/book/1/a" download="/dl/1/a" extension="epub">
    <div slot="title">三体</div><div slot="author">刘慈欣</div>
  </z-bookcard></body></html>`;

const CHALLENGE_PAGE = '<html><body>Just a moment...<iframe src="/.well-known/diamwall/x"></iframe></body></html>';

class FakePage implements HtmlRuntimePage {
  readonly jsCalls: string[] = [];
  loaded: string[] = [];
  reloads = 0;
  destroyed = 0;
  stopped = 0;
  private pageFinished: ((url: string) => void) | null = null;
  constructor(private readonly replies: () => string) {}
  loadUrl(url: string): void {
    this.loaded.push(url);
    this.pageFinished?.(url);
  }
  reload(): void {
    this.reloads += 1;
  }
  evaluateJavascript(js: string): Promise<string | null> {
    this.jsCalls.push(js);
    if (js === ZLibraryWebViewHelper.DIAMWALL_GATE_CLICK_JS) {
      // the gate script returns its status string, JSON-encoded like evaluateJavascript does
      return Promise.resolve(JSON.stringify('clicked'));
    }
    return Promise.resolve(JSON.stringify(this.replies()));
  }
  stopLoading(): void {
    this.stopped += 1;
  }
  destroy(): void {
    this.destroyed += 1;
  }
  onPageFinished(handler: (url: string) => void): void {
    this.pageFinished = handler;
  }
}

class FakeCookieStore implements HtmlRuntimeCookieStore {
  accept: boolean | null = null;
  thirdParty: boolean | null = null;
  written: Array<{ url: string; cookie: string }> = [];
  flushed = 0;
  constructor(private readonly value: string | null) {}
  setAcceptCookie(accept: boolean): void {
    this.accept = accept;
  }
  setAcceptThirdPartyCookies(_page: HtmlRuntimePage, accept: boolean): void {
    this.thirdParty = accept;
  }
  setCookie(url: string, cookie: string): void {
    this.written.push({ url, cookie });
  }
  flush(): void {
    this.flushed += 1;
  }
  getCookie(_url: string): string | null {
    return this.value;
  }
}

class FakeRuntime implements HtmlRuntimeFactory {
  readonly cookies: FakeCookieStore;
  settings: HtmlRuntimeSettings | null = null;
  page: FakePage | null = null;
  createThrows = false;
  constructor(private readonly replies: () => string, cookieValue: string | null = null) {
    this.cookies = new FakeCookieStore(cookieValue);
  }
  create(settings: HtmlRuntimeSettings): HtmlRuntimePage {
    if (this.createThrows) throw new Error('no WebView available');
    this.settings = settings;
    this.page = new FakePage(this.replies);
    return this.page;
  }
}

describe('ZLibraryWebViewHelper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the search URL with Java-style encoding and parses the rendered HTML', async () => {
    const runtime = new FakeRuntime(() => SEARCH_PAGE, 'dwid=dw1; c_token=T');
    const pending = ZLibraryWebViewHelper.searchViaWebView(runtime, '1lib.sk', '三体', null);
    await vi.advanceTimersByTimeAsync(2200);
    const result = await pending;
    expect(runtime.page?.loaded).toEqual(['https://1lib.sk/s/%E4%B8%89%E4%BD%93']);
    expect(result.books).toHaveLength(1);
    expect(result.books[0]?.title).toBe('三体');
    expect(result.pageHasZlibMarkers).toBe(true);
    expect(result.stillChallenged).toBe(false);
    expect(result.cookies).toBe('dwid=dw1; c_token=T');
    expect(runtime.page?.destroyed).toBe(1);
    expect(runtime.page?.stopped).toBe(1);
  });

  it('applies the Kotlin WebView settings and cookie acceptance flags', async () => {
    const runtime = new FakeRuntime(() => SEARCH_PAGE, null);
    const pending = ZLibraryWebViewHelper.searchViaWebView(runtime, 'z-lib.by', 'x', 'seed=1');
    await vi.advanceTimersByTimeAsync(2200);
    await pending;
    expect(runtime.settings).toEqual({
      javaScriptEnabled: true,
      domStorageEnabled: true,
      databaseEnabled: true,
      userAgentString:
        'Mozilla/5.0 (Linux; Android 12; TGR-W10G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      mixedContentMode: 'compatibility',
    });
    expect(runtime.cookies.accept).toBe(true);
    expect(runtime.cookies.thirdParty).toBe(true);
    expect(runtime.cookies.written).toEqual([{ url: 'https://z-lib.by', cookie: 'seed=1' }]);
    expect(runtime.cookies.flushed).toBe(1);
  });

  it('clicks the DiamWall gate checkbox while a challenge is showing, then finishes', async () => {
    let poll = 0;
    const runtime = new FakeRuntime(() => {
      poll += 1;
      return poll === 1 ? CHALLENGE_PAGE : SEARCH_PAGE;
    });
    const pending = ZLibraryWebViewHelper.searchViaWebView(runtime, '1lib.sk', '三体', null);
    await vi.advanceTimersByTimeAsync(2200 + 1500);
    const result = await pending;
    expect(runtime.page?.jsCalls).toContain(ZLibraryWebViewHelper.DIAMWALL_GATE_CLICK_JS);
    expect(result.books).toHaveLength(1);
  });

  it('reports pageHasZlibMarkers when the markers are present but nothing parses', async () => {
    const runtime = new FakeRuntime(() => '<html><body>z-bookcard 但没有 href</body></html>');
    const pending = ZLibraryWebViewHelper.searchViaWebView(runtime, '1lib.sk', 'x', null);
    await vi.advanceTimersByTimeAsync(2200);
    const result = await pending;
    expect(result.books).toEqual([]);
    expect(result.pageHasZlibMarkers).toBe(true);
  });

  it('reloads once for the "Cookies are required" error page', async () => {
    let poll = 0;
    const runtime = new FakeRuntime(() => {
      poll += 1;
      return poll === 1 ? '<html>Cookies are required to continue</html>' : SEARCH_PAGE;
    });
    const pending = ZLibraryWebViewHelper.searchViaWebView(runtime, '1lib.sk', 'x', null);
    await vi.advanceTimersByTimeAsync(2200 + 1500);
    const result = await pending;
    expect(runtime.page?.reloads).toBe(1);
    expect(result.books).toHaveLength(1);
  });

  it('gives up with stillChallenged after 24 polls (~36s)', async () => {
    const runtime = new FakeRuntime(() => CHALLENGE_PAGE);
    const pending = ZLibraryWebViewHelper.searchViaWebView(runtime, '1lib.sk', 'x', null);
    await vi.advanceTimersByTimeAsync(2200 + 24 * 1500);
    const result = await pending;
    expect(result.stillChallenged).toBe(true);
    expect(result.books).toEqual([]);
    // the gate is re-clicked at most once per 6s window
    const gateCalls = (runtime.page?.jsCalls ?? []).filter(
      (js) => js === ZLibraryWebViewHelper.DIAMWALL_GATE_CLICK_JS,
    ).length;
    expect(gateCalls).toBeLessThanOrEqual(24 / 4);
  });

  it('returns an empty result when the runtime cannot create a page', async () => {
    const runtime = new FakeRuntime(() => SEARCH_PAGE);
    runtime.createThrows = true;
    const result = await ZLibraryWebViewHelper.searchViaWebView(runtime, '1lib.sk', 'x', null);
    expect(result).toEqual({ books: [], pageHasZlibMarkers: false, stillChallenged: false, cookies: null });
  });

  it('destroys the page when the caller aborts', async () => {
    const runtime = new FakeRuntime(() => CHALLENGE_PAGE);
    const controller = new AbortController();
    void ZLibraryWebViewHelper.searchViaWebView(runtime, '1lib.sk', 'x', null, controller.signal);
    await vi.advanceTimersByTimeAsync(2200);
    controller.abort();
    expect(runtime.page?.destroyed).toBeGreaterThanOrEqual(1);
  });
});
