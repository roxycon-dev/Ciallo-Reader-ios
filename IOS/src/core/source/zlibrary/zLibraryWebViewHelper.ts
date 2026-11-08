/**
 * Kotlin → TS: `source/zlibrary/ZLibraryWebViewHelper.kt` (199 lines, 182 non-blank)
 *             → `src/core/source/zlibrary/zLibraryWebViewHelper.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary → SKIPPED (TS has no packages)
 *   L3        import android.content.Context     → REPLACED by the injected `HtmlRuntimeFactory`
 *   L4-5      import android.os.{Handler,Looper} → REPLACED by `setTimeout` (the timers keep their
 *                                                  exact delays; `handler.removeCallbacksAndMessages(null)`
 *                                                  becomes the tracked-timer list below)
 *   L6        import android.util.Log            → `SourceLog`
 *   L7-10     import android.webkit.{CookieManager,WebSettings,WebView,WebViewClient}
 *                                              → REPLACED by `HtmlRuntimePage` / `HtmlRuntimeCookieStore`
 *   L11-12    import SearchBook / ZLibraryParserManager → imported
 *   L13-14    import kotlinx.coroutines.*         → dropped (`withContext(Dispatchers.Main)` +
 *                                                 `suspendCancellableCoroutine` → a Promise driven by
 *                                                 the same `setTimeout` schedule, plus an
 *                                                 AbortSignal for `cont.invokeOnCancellation`)
 *   L15-16    import org.json.JSONTokener / org.jsoup.Jsoup → `JSON.parse` / `parseHtmlDocument`
 *   L17       import java.net.URLEncoder          → `javaUrlEncode`
 *   L18-19    import kotlin.coroutines.resume     → n/a (Promise resolution)
 *   L21-33    KDoc DiamWall/Cloudflare 验证兜底…（2026-09-04 增强（1lib.sk 实测校准）…）
 *                                                 → preserved verbatim
 *   L34-40    data class WebViewSearchResult     → readonly interface + factory
 *   L42       object ZLibraryWebViewHelper       → `export const ZLibraryWebViewHelper`
 *   L44-45    private const val CHROME_UA        → verbatim (Android 12 / TGR-W10G UA)
 *   L47-61    KDoc + private const val DIAMWALL_GATE_CLICK_JS → preserved VERBATIM, byte for byte
 *                                                 (the same JS source is handed to `evaluateJavascript`)
 *   L63       suspend fun searchViaWebView(context, node, keyword, cookies) → `searchViaWebView(runtime, node, keyword, cookies)`
 *   L68-69    withContext(Main) + suspendCancellableCoroutine → `async` + the promise below
 *   L70-76    webView/handler/attempts/finished/maxAttempts/reloadedForCookies/lastGateClickAt
 *                                                 → the same locals; `maxAttempts = 24 // 约 1.5s/次，最长 ~36s` verbatim
 *   L78-85    fun finish(result)                 → verbatim (cancel timers, stopLoading, destroy, resolve once)
 *   L87-89    fun extractCookies()               → `runtime.cookies.getCookie("https://$node")`
 *   L91-101   fun clickDiamWallGate() (6000ms throttle + Log.d) → verbatim
 *   L103-163  fun poll()                         → verbatim, including the 1500ms re-poll delay and
 *                                                 the `finish(...)` branches
 *   L165-191  try { WebView(context).apply { settings…; webViewClient… }; setCookie; loadUrl; postDelayed }
 *                                                 → `runtime.create(CHROME_UA)` + the same settings flags
 *                                                   (javascriptEnabled / domStorageEnabled /
 *                                                   databaseEnabled / userAgentString /
 *                                                   MIXED_CONTENT_COMPATIBILITY_MODE /
 *                                                   setAcceptCookie / setAcceptThirdPartyCookies)
 *   L189-191  catch → finish(WebViewSearchResult()) → verbatim
 *   L193-197  cont.invokeOnCancellation { … }    → the AbortSignal handler (same cleanup)
 *   L198-199  closing braces                     → n/a
 *
 * ADAPTATION — `android.webkit.WebView` (documented):
 *   A real WebView exists only in a native container and is a *UI* object, so `src/core` may
 *   not touch it (ESLint forbids DOM/React/Capacitor there). The two capabilities this file
 *   needs — "navigate + read the rendered HTML + run JS" and "read/write cookies" — become the
 *   `HtmlRuntimePage` / `HtmlRuntimeCookieStore` interfaces. The polling state machine, the
 *   DiamWall gate auto-click JS, the challenge/marker detection and the parse-then-finish
 *   decision are all ported verbatim and are fully unit-testable with a fake runtime.
 *
 * The "query `document.documentElement.outerHTML`" step and the JSON-string unwrapping are
 * preserved: `evaluateJavascript` returns a JSON-encoded string, which is unwrapped with
 * `JSON.parse` exactly like `JSONTokener(it).nextValue() as String`, falling back to the raw
 * value when it does not parse (same as the Kotlin catch).
 */

import { SourceLog } from '../sourceLog';
import type { SearchBook } from '../searchBook';
import { parseHtmlDocument } from './parser/htmlDocument';
import { ZLibraryParserManager } from './parser/zLibraryParserManager';
import { javaUrlEncode } from './zLibraryHost';

/** Kotlin `data class WebViewSearchResult` (L34-40). */
export interface WebViewSearchResult {
  readonly books: SearchBook[];
  readonly pageHasZlibMarkers: boolean;
  readonly stillChallenged: boolean;
  /** WebView 侧拿到的该域完整 Cookie 串（含 DiamWall 验证 Cookie），可为 null。 */
  readonly cookies: string | null;
}

function createWebViewSearchResult(params: Partial<WebViewSearchResult> = {}): WebViewSearchResult {
  return {
    books: params.books ?? [],
    pageHasZlibMarkers: params.pageHasZlibMarkers ?? false,
    stillChallenged: params.stillChallenged ?? false,
    cookies: params.cookies ?? null,
  };
}

/** A navigable page that can run JS and hand back its rendered HTML. */
export interface HtmlRuntimePage {
  loadUrl(url: string): void;
  reload(): void;
  /** `WebView.evaluateJavascript` — resolves with the JSON-encoded result. */
  evaluateJavascript(js: string): Promise<string | null>;
  stopLoading(): void;
  destroy(): void;
  /** `WebViewClient.onPageFinished`. */
  onPageFinished(handler: (url: string) => void): void;
}

/** `android.webkit.CookieManager` surface used here. */
export interface HtmlRuntimeCookieStore {
  setAcceptCookie(accept: boolean): void;
  setAcceptThirdPartyCookies(page: HtmlRuntimePage, accept: boolean): void;
  setCookie(url: string, cookie: string): void;
  flush(): void;
  getCookie(url: string): string | null;
}

/** `WebView(context)` factory, carrying the per-WebView settings the Kotlin sets. */
export interface HtmlRuntimeFactory {
  cookies: HtmlRuntimeCookieStore;
  create(settings: HtmlRuntimeSettings): HtmlRuntimePage;
}

/** Kotlin `settings.*` (L167-173). */
export interface HtmlRuntimeSettings {
  readonly javaScriptEnabled: boolean;
  readonly domStorageEnabled: boolean;
  readonly databaseEnabled: boolean;
  readonly userAgentString: string;
  /** Kotlin `WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE`. */
  readonly mixedContentMode: 'compatibility';
}

export const ZLibraryWebViewHelper = {
  /**
   * DiamWall 复选框代点：挑战 iframe 与主文档同源，可跨 contentDocument 操作。
   */
  DIAMWALL_GATE_CLICK_JS: `
        (function(){
            try {
                var ifr = document.querySelector('iframe');
                if (!ifr) return 'no-iframe';
                var doc = ifr.contentDocument;
                if (!doc || !doc.body) return 'no-doc';
                var gate = doc.querySelector('#pane-gate, .dw-gate, [class*="dw-gate"]');
                if (!gate) return 'no-gate';
                gate.click();
                return 'clicked';
            } catch (e) { return 'err'; }
        })()
    `,

  CHROME_UA:
    'Mozilla/5.0 (Linux; Android 12; TGR-W10G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

  /**
   * DiamWall/Cloudflare 验证兜底：HTTP 客户端解不了的交互式验证，
   * 用真实 WebView（Chrome UA）像浏览器一样加载搜索页，让验证 JS 自动跑，
   * 然后取出渲染后的 HTML 解析搜索结果。
   *
   * 2026-09-04 增强（1lib.sk 实测校准）：
   * - DiamWall 挑战页的"验证复选框"位于主文档的同源 iframe
   *   （/.well-known/diamwall/...）内，此前只被动等待导致挑战挂死到超时；
   *   现在轮询时主动代点复选框，PoW 由挑战页 JS 自动算，点击后即可放行；
   * - 挑战通过/页面成功后，把 WebView CookieManager 里的会话 Cookie
   *   （dwid / c_token / __diamwall / remix_*）回传给调用方，同步进 OkHttp
   *   的 CookieJar 后，后续详情页与下载请求全程免挑战。
   */
  async searchViaWebView(
    runtime: HtmlRuntimeFactory,
    node: string,
    keyword: string,
    cookies: string | null = null,
    signal?: AbortSignal | null,
  ): Promise<WebViewSearchResult> {
    let page: HtmlRuntimePage | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let attempts = 0;
    let finished = false;
    const maxAttempts = 24; // 约 1.5s/次，最长 ~36s
    let reloadedForCookies = false;
    let lastGateClickAt = 0;

    const post = (fn: () => void, delayMs: number): void => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, delayMs);
      timers.add(timer);
    };
    const clearTimers = (): void => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };

    return new Promise<WebViewSearchResult>((resolve) => {
      const finish = (result: WebViewSearchResult): void => {
        if (finished) return;
        finished = true;
        clearTimers();
        try {
          page?.stopLoading();
        } catch {
          // Kotlin `runCatching { webView?.stopLoading() }`
        }
        try {
          page?.destroy();
        } catch {
          // Kotlin `runCatching { webView?.destroy() }`
        }
        resolve(result);
      };

      const extractCookies = (): string | null => {
        try {
          return runtime.cookies.getCookie(`https://${node}`);
        } catch {
          return null;
        }
      };

      const clickDiamWallGate = (): void => {
        const wv = page;
        if (wv === null) return;
        const now = Date.now();
        if (now - lastGateClickAt < 6000) return;
        void wv.evaluateJavascript(ZLibraryWebViewHelper.DIAMWALL_GATE_CLICK_JS).then((result) => {
          if (result !== null && result.includes('clicked')) {
            lastGateClickAt = now;
            SourceLog.log('ZLibWebView', `DiamWall gate auto-clicked on ${node}`);
          }
        });
      };

      const poll = (): void => {
        const wv = page;
        if (wv === null) return;
        void wv
          .evaluateJavascript('(function(){return document.documentElement.outerHTML;})();')
          .then((raw) => {
            if (finished) return;
            const html =
              raw !== null
                ? ((): string => {
                    try {
                      const parsed: unknown = JSON.parse(raw);
                      return typeof parsed === 'string' ? parsed : raw;
                    } catch {
                      return raw;
                    }
                  })()
                : '';

            const isChallenge =
              html.toLowerCase().includes('just a moment') ||
              html.toLowerCase().includes('verifying your browser') ||
              html.toLowerCase().includes('checking your browser') ||
              html.toLowerCase().includes('solve this captcha') ||
              html.includes('cpt.lib');

            const hasMarkers =
              html.includes('/book/') ||
              html.includes('z-bookcard') ||
              html.includes('resItemBox') ||
              html.includes('book-item');

            if (isChallenge) {
              // DiamWall 复选框在挑战 iframe 里，被动等永远不会过：主动代点
              clickDiamWallGate();
            }

            if (!isChallenge) {
              let pageTitle = '';
              try {
                pageTitle = parseHtmlDocument(html).title();
              } catch {
                pageTitle = '';
              }
              SourceLog.log(
                'ZLibWebView',
                `sample node=${node} title=${pageTitle} len=${html.length} head=${html.slice(0, 240).replace(/\n/g, ' ')}`,
              );
              if (!reloadedForCookies && html.toLowerCase().includes('cookies are required')) {
                reloadedForCookies = true;
                SourceLog.log('ZLibWebView', `cookie error page, reloading ${node}`);
                wv.reload();
                return;
              }
              let books: SearchBook[] = [];
              try {
                books = ZLibraryParserManager.parseSearchPage(html, `https://${node}`, 'zlibrary');
              } catch {
                books = [];
              }
              if (books.length > 0) {
                finish(
                  createWebViewSearchResult({
                    books,
                    pageHasZlibMarkers: true,
                    cookies: extractCookies(),
                  }),
                );
                return;
              }
              if (hasMarkers) {
                finish(createWebViewSearchResult({ pageHasZlibMarkers: true, cookies: extractCookies() }));
                return;
              }
            }

            attempts += 1;
            if (attempts >= maxAttempts) {
              finish(createWebViewSearchResult({ stillChallenged: isChallenge, cookies: extractCookies() }));
            } else {
              post(() => poll(), 1500);
            }
          });
      };

      try {
        page = runtime.create({
          javaScriptEnabled: true,
          domStorageEnabled: true,
          databaseEnabled: true,
          userAgentString: ZLibraryWebViewHelper.CHROME_UA,
          mixedContentMode: 'compatibility',
        });
        runtime.cookies.setAcceptCookie(true);
        runtime.cookies.setAcceptThirdPartyCookies(page, true);
        page.onPageFinished(() => {
          post(() => poll(), 1200);
        });
        if (cookies !== null && cookies.trim() !== '') {
          try {
            runtime.cookies.setCookie(`https://${node}`, cookies);
            runtime.cookies.flush();
          } catch {
            // Kotlin `runCatching { … }`
          }
        }
        const url = `https://${node}/s/` + javaUrlEncode(keyword);
        page.loadUrl(url);
        post(() => poll(), 2200);
      } catch {
        finish(createWebViewSearchResult());
      }

      // Kotlin `cont.invokeOnCancellation { handler.removeCallbacksAndMessages(null);
      //                                        runCatching { webView?.destroy() } }`
      if (signal !== undefined && signal !== null) {
        const onAbort = (): void => {
          clearTimers();
          try {
            page?.destroy();
          } catch {
            // Kotlin `runCatching { webView?.destroy() }`
          }
        };
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }
    });
  },
};
