/**
 * Unit tests for `src/core/library/zLibraryNativeSession.ts`
 * (the port of `com.example.library.ZLibraryNativeSession.kt`).
 *
 * The Kotlin class is a WebView state machine, so the tests drive it with a fake
 * `ZLibrarySessionRuntime` and vitest fake timers. Covered:
 *  - the search retry/backoff ladder (2500 ms poll, 5 tries, 30 s hard timeout),
 *  - the challenge ladder (10 tries, 6 s gate-click throttle, 正在通过验证… progress),
 *  - the no-result short-circuit and the "no response" ladder,
 *  - the download handoff (download listener + 12 s destroy deferral),
 *  - login: JSON-quoted credential injection, cookie-verified success, both failure
 *    messages and the 20 s timeout,
 *  - `Uri.encode` vs `URLEncoder` spacing, `JSONObject.quote` escaping and credential redaction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  androidUriEncode,
  buildLoginJs,
  createZLibraryNativeSession,
  DIAMWALL_GATE_CLICK_JS,
  DOWNLOAD_HANDOFF_TIMEOUT_MS,
  GATE_CLICK_THROTTLE_MS,
  isChallengeHtml,
  isNoResultPage,
  jsonQuote,
  LOGIN_TIMEOUT_MS,
  MAX_CHALLENGE_POLL_TRIES,
  MAX_POLL_TRIES,
  POLL_DELAY_MS,
  redactInjectedCredentials,
  SEARCH_TIMEOUT_MS,
  SESSION_SETTINGS,
  SESSION_USER_AGENT,
  unwrapJsonString,
  type ZLibraryNativeSession,
  type ZLibraryNativeSessionCallbacks,
  type ZLibraryPageClient,
  type ZLibrarySessionPage,
  type ZLibrarySessionRuntime,
} from '../../src/core/library/zLibraryNativeSession';
import { setNodeDomain } from '../../src/core/library/zLibraryNodeConfig';
import type { HtmlRuntimeCookieStore } from '../../src/core/source/zlibrary/zLibraryWebViewHelper';

const DOMAIN = '1lib.sk';
const SEARCH_URL = `https://${DOMAIN}/s/q`;

/* ── fakes ────────────────────────────────────────────────────────────── */

class FakePage implements ZLibrarySessionPage {
  urls: string[] = [];
  clients: ZLibraryPageClient[] = [];
  scripts: string[] = [];
  downloadListener: ((url: string | null) => void) | null = null;
  pauseCount = 0;
  resumeCount = 0;
  stopCount = 0;
  destroyCount = 0;
  /** Raw outerHTML returned by `evaluateJavascript` for the DOM query. */
  html: string | null = null;
  /** Result returned for the DiamWall gate-click script. */
  gateResult: string | null = '"clicked"';
  /** When set, the DOM query never resolves (models a stuck page). */
  stallDomQuery = false;
  createThrows = false;

  loadUrl(url: string): void {
    this.urls.push(url);
  }

  reload(): void {}

  evaluateJavascript(js: string): Promise<string | null> {
    this.scripts.push(js);
    if (js.includes('outerHTML')) {
      if (this.stallDomQuery) return new Promise<string | null>(() => {});
      return Promise.resolve(this.html === null ? null : JSON.stringify(this.html));
    }
    if (js.includes('dw-gate')) return Promise.resolve(this.gateResult);
    return Promise.resolve(null);
  }

  stopLoading(): void {
    this.stopCount += 1;
  }

  destroy(): void {
    this.destroyCount += 1;
  }

  onPageFinished(): void {}

  setWebViewClient(client: ZLibraryPageClient): void {
    this.clients.push(client);
  }

  setDownloadListener(listener: (url: string | null) => void): void {
    this.downloadListener = listener;
  }

  onPause(): void {
    this.pauseCount += 1;
  }

  onResume(): void {
    this.resumeCount += 1;
  }

  get client(): ZLibraryPageClient {
    const last = this.clients[this.clients.length - 1];
    if (last === undefined) throw new Error('no webViewClient installed');
    return last;
  }
}

class FakeCookies implements HtmlRuntimeCookieStore {
  acceptCookie = false;
  thirdParty = false;
  values = new Map<string, string>();

  setAcceptCookie(accept: boolean): void {
    this.acceptCookie = accept;
  }

  setAcceptThirdPartyCookies(): void {
    this.thirdParty = true;
  }

  setCookie(): void {}

  flush(): void {}

  getCookie(url: string): string | null {
    return this.values.get(url) ?? null;
  }
}

interface Harness {
  session: ZLibraryNativeSession;
  page: FakePage;
  cookies: FakeCookies;
  results: Array<{ books: readonly unknown[]; status: string }>;
  logins: Array<{ ok: boolean; message: string }>;
  downloads: string[];
}

function createHarness(): Harness {
  const page = new FakePage();
  const cookies = new FakeCookies();
  const runtime: ZLibrarySessionRuntime = {
    cookies,
    create: (): ZLibrarySessionPage => {
      if (page.createThrows) throw new Error('no system webview');
      return page;
    },
  };
  const results: Array<{ books: readonly unknown[]; status: string }> = [];
  const logins: Array<{ ok: boolean; message: string }> = [];
  const downloads: string[] = [];
  const callbacks: ZLibraryNativeSessionCallbacks = {
    onSearchResults: (books, status) => results.push({ books, status }),
    onRealDownloadUrl: (url) => downloads.push(url),
    onLoginResult: (ok, message) => logins.push({ ok, message }),
  };
  return {
    session: createZLibraryNativeSession(runtime, callbacks),
    page,
    cookies,
    results,
    logins,
    downloads,
  };
}

const lastStatus = (h: Harness): string => h.results[h.results.length - 1]?.status ?? '';

/* ── constants ────────────────────────────────────────────────────────── */

describe('session constants', () => {
  it('keeps every Kotlin poll/timeout value', () => {
    expect(MAX_POLL_TRIES).toBe(5);
    expect(MAX_CHALLENGE_POLL_TRIES).toBe(10);
    expect(POLL_DELAY_MS).toBe(2500);
    expect(SEARCH_TIMEOUT_MS).toBe(30000);
    expect(LOGIN_TIMEOUT_MS).toBe(20000);
    expect(DOWNLOAD_HANDOFF_TIMEOUT_MS).toBe(12000);
    expect(GATE_CLICK_THROTTLE_MS).toBe(6000);
  });

  it('keeps the WebView settings block verbatim', () => {
    expect(SESSION_SETTINGS).toEqual({
      javaScriptEnabled: true,
      domStorageEnabled: true,
      loadWithOverviewMode: true,
      useWideViewPort: true,
      blockNetworkImage: true,
      userAgentString:
        'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    });
    expect(SESSION_USER_AGENT).toContain('Chrome/120.0.0.0 Mobile Safari/537.36');
  });

  it('keeps the DiamWall gate-click JS body byte-identical to the Kotlin source', () => {
    expect(DIAMWALL_GATE_CLICK_JS).toContain(
      "var gate = doc.querySelector('#pane-gate, .dw-gate, [class*=\"dw-gate\"]');",
    );
    expect(DIAMWALL_GATE_CLICK_JS).toContain("if (!ifr) return 'no-iframe';");
    expect(DIAMWALL_GATE_CLICK_JS).toContain("return 'clicked'");
    expect(DIAMWALL_GATE_CLICK_JS).toContain("catch (e) { return 'err'; }");
  });
});

/* ── pure helpers ─────────────────────────────────────────────────────── */

describe('androidUriEncode (Uri.encode)', () => {
  it('percent-encodes a space as %20 (NOT +, which is URLEncoder)', () => {
    expect(androidUriEncode('a b')).toBe('a%20b');
  });

  it('keeps the Uri.encode unreserved set -_!.~\'()*', () => {
    expect(androidUriEncode("-_!.~'()*")).toBe("-_!.~'()*");
  });

  it('encodes CJK as uppercase UTF-8 percent triplets', () => {
    expect(androidUriEncode('三体')).toBe('%E4%B8%89%E4%BD%93');
  });

  it('encodes reserved delimiters', () => {
    expect(androidUriEncode('a/b?c=d&e')).toBe('a%2Fb%3Fc%3Dd%26e');
  });
});

describe('jsonQuote (JSONObject.quote)', () => {
  it('wraps in double quotes and escapes the AOSP set, including "/"', () => {
    expect(jsonQuote('a"b')).toBe('"a\\"b"');
    expect(jsonQuote('a\\b')).toBe('"a\\\\b"');
    expect(jsonQuote('a/b')).toBe('"a\\/b"');
    expect(jsonQuote('a\tb\nc\rd\fe\bg')).toBe('"a\\tb\\nc\\rd\\fe\\bg"');
    expect(jsonQuote('\u0001')).toBe('"\\u0001"');
    expect(jsonQuote('a\u2028b')).toBe('"a\\u2028b"');
    expect(jsonQuote('')).toBe('""');
  });
});

describe('buildLoginJs', () => {
  it('keeps the Kotlin script and injects the quoted credentials', () => {
    const js = buildLoginJs('a@b.c', 'pw"1');
    expect(js).toBe(
      "var e=document.querySelector('input[name=email],input[name=login],input[type=email]');" +
        "var p=document.querySelector('input[name=password],input[type=password]');" +
        'if(e&&p){e.value="a@b.c";p.value="pw\\"1";' +
        'var f=e.form||p.form;' +
        "if(f){var sb=f.querySelector('button[type=submit],input[type=submit]');" +
        "if(sb){sb.click();'clicked'}else{f.submit();'submitted'}}" +
        "else{'noform'}}" +
        "else{'nofields'}",
    );
  });
});

describe('redactInjectedCredentials', () => {
  it('masks both credential literals and leaves the rest of the script intact', () => {
    const redacted = redactInjectedCredentials(buildLoginJs('user@example.com', 's3cret!'));
    expect(redacted).not.toContain('user@example.com');
    expect(redacted).not.toContain('s3cret!');
    expect(redacted).toContain('e.value="[redacted]"');
    expect(redacted).toContain('p.value="[redacted]"');
    expect(redacted).toContain("sb.click();'clicked'");
  });

  it('is idempotent and handles an escaped quote inside the password', () => {
    const once = redactInjectedCredentials(buildLoginJs('a', 'b"c'));
    expect(redactInjectedCredentials(once)).toBe(once);
    expect(once).not.toContain('b\\"c');
    expect(once).toContain('p.value="[redacted]"');
    expect(once).toContain('e.value="[redacted]"');
  });
});

describe('challenge / no-result detection', () => {
  it('matches the four Kotlin challenge markers, case-insensitively except cpt.lib', () => {
    expect(isChallengeHtml('<title>Verifying your browser</title>')).toBe(true);
    expect(isChallengeHtml('<p>CHECKING YOUR BROWSER</p>')).toBe(true);
    expect(isChallengeHtml('<p>solve this CAPTCHA</p>')).toBe(true);
    expect(isChallengeHtml('<script src="/cpt.lib/x.js"></script>')).toBe(true);
    expect(isChallengeHtml('<div>ordinary search page</div>')).toBe(false);
  });

  it('short-circuits on the no-result markers unless a book card is present', () => {
    expect(isNoResultPage('<p>没有找到相关书籍</p>')).toBe(true);
    expect(isNoResultPage('<p>No Results found</p>')).toBe(true);
    expect(isNoResultPage('<p>0 RESULTS</p>')).toBe(true);
    expect(isNoResultPage('<p>没有找到</p><div class="z-bookcard">x</div>')).toBe(false);
    expect(isNoResultPage('<div class="z-bookcard">x</div>')).toBe(false);
  });
});

describe('unwrapJsonString', () => {
  it('unwraps a JSON-encoded string like JSONTokener.nextValue() as String', () => {
    expect(unwrapJsonString(JSON.stringify('<p>hi</p>'))).toBe('<p>hi</p>');
  });

  it('falls back to the raw value when it is not a JSON string', () => {
    expect(unwrapJsonString('42')).toBe('42');
    expect(unwrapJsonString('<p>hi</p>')).toBe('<p>hi</p>');
  });
});

/* ── the state machine ────────────────────────────────────────────────── */

describe('ZLibraryNativeSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setNodeDomain(DOMAIN);
  });

  afterEach(() => {
    vi.useRealTimers();
    setNodeDomain('');
  });

  it('falls back to the default node while the user selection is still empty', () => {
    setNodeDomain('   ');
    const h = createHarness();
    expect(h.session.domain).toBe('1lib.sk');
  });

  it('replays a query issued before the WebView existed (Kotlin pendingQuery)', async () => {
    const h = createHarness();
    h.session.search('q');
    expect(h.page.urls).toEqual([]);
    h.session.ensureCreated();
    expect(h.page.urls).toEqual([SEARCH_URL]);
    expect(h.page.pauseCount).toBeGreaterThan(0);
    expect(h.cookies.acceptCookie).toBe(true);
    expect(h.cookies.thirdParty).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
  });

  it('reports both failure callbacks when the system WebView cannot be created', async () => {
    const h = createHarness();
    h.page.createThrows = true;
    h.session.ensureCreated();
    expect(h.logins).toEqual([
      { ok: false, message: '系统 WebView 不可用，请更新 Android System WebView' },
    ]);
    expect(h.results).toEqual([{ books: [], status: '系统 WebView 不可用' }]);
    expect(h.session.webView).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('resumes the WebView for a search and pauses it when the search finishes', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.page.html = '<div>没有找到相关书籍</div>';
    const pauseBefore = h.page.pauseCount;
    h.session.search('q');
    expect(h.page.resumeCount).toBe(1);
    await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);
    expect(lastStatus(h)).toBe('未找到相关书籍');
    expect(h.page.pauseCount).toBe(pauseBefore + 1);
  });

  it('polls 5 times before giving up with 页面无响应 (retry/backoff ladder)', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.page.html = null; // evaluateJavascript returns null → 页面还没就绪
    h.session.search('q');
    for (let i = 0; i < MAX_POLL_TRIES - 1; i += 1) {
      await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);
      expect(lastStatus(h)).toBe('');
    }
    await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);
    expect(lastStatus(h)).toBe('页面无响应，请重试或切换节点');
    expect(h.results).toHaveLength(1);
  });

  it('stops the challenge ladder at the 5-try poll guard and ends on the 30s hard timeout', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.page.html = '<title>Verifying your browser</title>';
    h.session.search('q');
    // Kotlin quirk, preserved verbatim: the challenge branch raises `pollTries` up to
    // MAX_CHALLENGE_POLL_TRIES (10) but `schedulePoll` re-checks `pollTries < MAX_POLL_TRIES`
    // (5), so only 5 polls ever run and "验证未通过，请重试或切换节点" is unreachable —
    // the 30s hard timeout closes the search instead.
    for (let i = 0; i < MAX_POLL_TRIES; i += 1) {
      await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);
      expect(lastStatus(h)).toBe('正在通过验证…');
    }
    expect(h.results).toHaveLength(MAX_POLL_TRIES);
    // the gate click is throttled to 6s, so only 2 of the 5 rounds actually click
    const gateScripts = h.page.scripts.filter((it) => it.includes('dw-gate'));
    expect(gateScripts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS - POLL_DELAY_MS * MAX_POLL_TRIES);
    expect(lastStatus(h)).toBe('搜索超时，请重试或切换节点');
  });

  it('fires the 30s hard timeout when the DOM query never answers', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.page.stallDomQuery = true;
    h.session.search('q');
    await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS);
    expect(lastStatus(h)).toBe('搜索超时，请重试或切换节点');
    expect(h.session.webView).not.toBeNull();
  });

  it('reports 未解析到书籍 after 5 unparsable pages', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.page.html = '<html><body><div>nothing parseable here</div></body></html>';
    h.session.search('q');
    for (let i = 0; i < MAX_POLL_TRIES - 1; i += 1) {
      await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);
    }
    await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);
    expect(lastStatus(h)).toBe('未解析到书籍（可能结构变化或需要登录）');
  });

  it('stops polling once the search generation moved on', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.page.html = null;
    h.session.search('first');
    await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);
    h.session.search('second');
    const before = h.results.length;
    await vi.advanceTimersByTimeAsync(POLL_DELAY_MS * 3);
    // the first generation's scheduled polls are dropped, so no early finish for 'first'
    expect(h.results.length).toBe(before);
  });

  it('hands the real download URL over and clears the pending flag', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.session.loadUrl('https://1lib.sk/book/1/2/3');
    expect(h.page.urls).toContain('https://1lib.sk/book/1/2/3');
    h.page.downloadListener?.('https://covers.1lib.sk/dl/cover.epub');
    expect(h.downloads).toEqual(['https://covers.1lib.sk/dl/cover.epub']);
    await vi.advanceTimersByTimeAsync(DOWNLOAD_HANDOFF_TIMEOUT_MS);
  });

  it('defers destroy by 12s while a download URL is still pending', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.session.loadUrl('https://1lib.sk/book/1/2/3');
    h.session.destroy();
    expect(h.session.webView).not.toBeNull();
    expect(h.page.destroyCount).toBe(0);
    await vi.advanceTimersByTimeAsync(DOWNLOAD_HANDOFF_TIMEOUT_MS);
    expect(h.page.stopCount).toBe(1);
    expect(h.page.destroyCount).toBe(1);
    expect(h.session.webView).toBeNull();
  });

  it('releases the WebView immediately when no download is pending', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.session.destroy();
    expect(h.session.webView).toBeNull();
    expect(h.page.destroyCount).toBe(1);
  });

  it('destroys the page as soon as the download URL arrives after destroy()', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.session.loadUrl('https://1lib.sk/book/1/2/3');
    h.session.destroy();
    h.page.downloadListener?.('https://cdn/dl/book.epub');
    expect(h.downloads).toHaveLength(1);
    expect(h.page.destroyCount).toBe(1);
    expect(h.session.webView).toBeNull();
  });

  it('reports 会话未就绪 when login is attempted before the WebView exists', () => {
    const h = createHarness();
    h.session.login('a@b.c', 'pw');
    expect(h.logins).toEqual([{ ok: false, message: '会话未就绪，请重试' }]);
  });

  it('injects the credentials on the login page and verifies the session cookie', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.session.login('user@example.com', 's3cret!');
    expect(h.page.urls[h.page.urls.length - 1]).toBe(`https://${DOMAIN}/login`);
    h.page.client.onPageFinished(`https://${DOMAIN}/login`);
    await vi.advanceTimersByTimeAsync(0);
    const injected = h.page.scripts.find((it) => it.includes('e.value='));
    expect(injected).toBeDefined();
    expect(injected).toContain('user@example.com');

    h.cookies.values.set(`https://${DOMAIN}/`, 'remix_userid=42; remix_userkey=abc');
    h.page.client.onPageFinished(`https://${DOMAIN}/`);
    expect(h.logins).toEqual([{ ok: true, message: '登录成功' }]);
  });

  it('fails the login when no session cookie arrived', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.session.login('user@example.com', 'pw');
    h.page.client.onPageFinished(`https://${DOMAIN}/`);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.logins).toEqual([{ ok: false, message: '登录失败，请检查账号密码' }]);
  });

  it('fails the login after the 20s timeout', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.session.login('user@example.com', 'pw');
    await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS);
    expect(h.logins).toEqual([{ ok: false, message: '登录超时，请检查网络后重试' }]);
  });

  it('isLoggedIn() checks remix_userid / remix_userkey on the node cookie', () => {
    const h = createHarness();
    expect(h.session.isLoggedIn()).toBe(false);
    h.cookies.values.set(`https://${DOMAIN}/`, 'dwid=1; remix_userid=42');
    expect(h.session.isLoggedIn()).toBe(true);
    h.cookies.values.set(`https://${DOMAIN}/`, 'remix_userkey=abc');
    expect(h.session.isLoggedIn()).toBe(true);
  });

  it('parses the page as soon as the page-finished callback fires on the node origin', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.page.html = '<p>没有找到相关书籍</p>';
    h.session.search('q');
    h.page.client.onPageFinished(SEARCH_URL);
    await vi.advanceTimersByTimeAsync(0);
    expect(lastStatus(h)).toBe('未找到相关书籍');
  });

  it('ignores a page-finished callback for a foreign origin', async () => {
    const h = createHarness();
    h.session.ensureCreated();
    h.page.html = '<p>没有找到相关书籍</p>';
    h.session.search('q');
    h.page.client.onPageFinished('https://evil.example/s/q');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.results).toHaveLength(0);
  });
});