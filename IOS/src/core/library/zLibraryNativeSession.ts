/**
 * Kotlin → TS: `library/ZLibraryNativeSession.kt` (369 lines total / 345 non-blank)
 *             → `src/core/library/zLibraryNativeSession.ts`
 *
 * 原生书库背后的隐藏 WebView 会话：
 * - 搜索：在隐藏 WebView 中加载 1lib.sk 搜索页，轮询 DOM 并把结果解析成
 *   List<SearchBook> 交给原生 UI 展示（用户全程不离开 App）。
 * - 登录：注入账号密码完成站点登录，Cookie 留在会话里自动生效。
 * - 下载：捕获 DownloadListener 的真实文件 URL 交给下载管理器。
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1         package com.example.library                   → SKIPPED (TS has no packages)
 *   L3         import android.net.Uri                       → `androidUriEncode` (a faithful port of
 *              `Uri.encode(s, null)`, spelled out below — see the "Uri.encode" note)
 *   L4         import android.content.Context                → dropped; the WebView factory is injected
 *   L5-7       import android.os.{Handler,Looper} / android.util.Log
 *                                                            → `Handler` → the tracked `setTimeout`
 *              pool (`post`/`removeAllTimers`); `Looper.getMainLooper()` checks → dropped (see
 *              "Threads"); `Log.d` → `SourceLog.log`
 *   L8-10      import android.webkit.{CookieManager,WebView,WebViewClient}
 *                                                            → the injected `ZLibrarySessionPage` /
 *              `ZLibrarySessionRuntime` / `ZLibraryPageClient` (extending the already-ported
 *              `HtmlRuntimePage` / `HtmlRuntimeCookieStore` from `zLibraryWebViewHelper.ts`)
 *   L11        import com.example.source.SearchBook          → type import
 *   L12        import …parser.ZLibraryParserManager         → the already-ported parser manager
 *   L13-18     import kotlinx.coroutines.* / org.json.JSONTokener
 *                                                            → coroutines dropped (plain async);
 *              `JSONTokener(it).nextValue() as String` → `unwrapJsonString`
 *   L21-27     the class KDoc                               → preserved verbatim above the class
 *   L28-32     `class ZLibraryNativeSession(onSearchResults, onRealDownloadUrl, onLoginResult)`
 *                                                            → same three constructor callbacks
 *   L34        MAX_POLL_TRIES = 5                           → exported const, verbatim
 *   L35-36     挑战态放宽轮询上限 KDoc                      → preserved verbatim
 *   L37        MAX_CHALLENGE_POLL_TRIES = 10               → exported const, verbatim
 *   L38        POLL_DELAY_MS = 2500L                        → 2500
 *   L39-40     挑战轮询上限…30s KDoc + SEARCH_TIMEOUT_MS    → preserved verbatim + 30000
 *   L42-44     DiamWall 复选框代点 KDoc                     → preserved verbatim above DIAMWALL_GATE_CLICK_JS
 *   L45-58     DIAMWALL_GATE_CLICK_JS                       → verbatim JS source
 *   L61-63     `private val domain get() = ZLibraryNodeConfig.domain.ifBlank { DEFAULT_NODE }`
 *                                                            → the `domain` getter (same fallback)
 *   L65-66     the Handler + CoroutineScope KDoc/fields     → the timer pool; the scope's only job is
 *              to give `destroy()` a cancellation point, so it becomes `scopeCancelled`
 *   L67-68     the scope itself + its KDoc (parse off the main thread)
 *                                                            → dropped as a construct; the parse call
 *              stays verbatim and runs inside the same async continuation
 *   L70-71     `var webView: WebView?` with a private setter → `get webView()` (read-only)
 *   L73-82     the nine private state fields                → the same nine fields
 *   L84-99     KDoc + `destroy()`                           → `destroy()`, same branch order
 *   L101-108   `performDestroy(wv)`                         → verbatim
 *   L110-125   KDoc + `ensureCreated(context)`              → `ensureCreated()` (context dropped; the
 *              WebView settings moved to the `create(settings)` call — see the settings note)
 *   L127-162   `attach(wv)`                                 → `attach(wv)`, verbatim from the cookie
 *              block down; L129-138 (the settings block) moves into `SESSION_SETTINGS`
 *   L164-181   `search(query)`                              → verbatim
 *   L183-193   `loadUrl(url)`                               → verbatim
 *   L195-198   KDoc + `resumeForAction(wv)`                 → verbatim
 *   L200-212   KDoc + `clickDiamWallGate(wv)`               → verbatim (6000 ms throttle preserved)
 *   L214-219   `finishSearch(wv, books, status)`            → verbatim
 *   L221-224   `isLoggedIn()`                               → verbatim
 *   L226-280   `login(email, password)`                     → verbatim (JSON quoting, the login client
 *              and the 20 s timeout included)
 *   L282-355   `parseCurrentPage(wv, url)`                  → verbatim (challenge detection, the
 *              no-result short-circuit, the parse + retry ladder)
 *   L357-368   `schedulePoll(wv, url)`                      → verbatim
 *   L369       closing brace                                → n/a
 *
 * ADAPTATIONS (documented at each site):
 *   - `Handler(Looper.getMainLooper())` + `postDelayed` + `removeCallbacksAndMessages(null)` →
 *     a tracked `setTimeout` pool, the same shape `zLibraryWebViewHelper.ts` uses, so
 *     `destroy()` can cancel everything exactly like the Handler teardown. The delays are
 *     unchanged (2500 / 30000 / 12000 / 20000 / 6000).
 *   - `if (Looper.myLooper() != Looper.getMainLooper()) { mainHandler.post { … }; return }` (L86,
 *     L116) → dropped: JS is single-threaded and every entry point already runs on the task queue,
 *     so the hop was a no-op here. (Not `withContext(Dispatchers.Main)` semantics either — the same
 *     reasoning is recorded in `zLibraryEndpointProvider.ts`.)
 *   - `CoroutineScope(SupervisorJob() + Dispatchers.Main)` + `scope.launch(Dispatchers.Default)`
 *     + `withContext(Dispatchers.Main)` → plain async. `parseSearchPage` is synchronous, so the
 *     "parse on a background dispatcher, hop back before touching state" pair collapses into one
 *     continuation; the ordering guarantees the Kotlin needed (parse → check `searchFinished`/
 *     `webView != wv` → decide) are preserved literally. `scope.cancel()` → `scopeCancelled`,
 *     which additionally guards the parse continuation (a Kotlin cancelled scope would never run
 *     `withContext`'s block).
 *   - `android.webkit.WebView` → the injected runtime (a real WebView is a native UI object; see
 *     the note at `zLibraryWebViewHelper.ts` L48-55 for the same reasoning).
 *   - `org.json.JSONObject.quote` → `jsonQuote` (AOSP `JSONStringer.appendQuoted` semantics).
 *   - `android.net.Uri.encode` → `androidUriEncode` (NOT `javaUrlEncode`: `Uri.encode` maps a
 *     space to `%20`, and `javaUrlEncode` — which this file's sibling `zLibraryWebViewHelper`
 *     uses because its Kotlin calls `URLEncoder` — maps it to `+`).
 *   - `String.isBlank()` → a local helper (JS `\s` also matches U+00A0/U+FEFF).
 *   - `System.currentTimeMillis()` → `Date.now()`.
 */

import { SourceLog } from '../source/sourceLog';
import type { SearchBook } from '../source/searchBook';
import { ZLibraryParserManager } from '../source/zlibrary/parser/zLibraryParserManager';
import type {
  HtmlRuntimeCookieStore,
  HtmlRuntimePage,
} from '../source/zlibrary/zLibraryWebViewHelper';
import { nodeDomain } from './zLibraryNodeConfig';
import { DEFAULT_NODE } from './zLibraryNodeManager';

/* ═══════════════════════════════════════════════════════════════════════════
 * Constants — Kotlin L34-58 verbatim (values, comments and JS source)
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin `private const val MAX_POLL_TRIES = 5` (L34). */
export const MAX_POLL_TRIES = 5;
// 挑战态放宽轮询上限：1lib.sk 的 DiamWall 透明 PoW 由页面 JS 自解约 3-8s，
// 交互式复选框挑战被代点后还要等校验回程，5 次（12.5s）不够，给 10 次（25s）。
/** Kotlin `private const val MAX_CHALLENGE_POLL_TRIES = 10` (L37). */
export const MAX_CHALLENGE_POLL_TRIES = 10;
/** Kotlin `private const val POLL_DELAY_MS = 2500L` (L38). */
export const POLL_DELAY_MS = 2500;
// 挑战轮询上限放宽到 25s，硬超时同步放到 30s（覆盖代点 + 校验回程时间）
/** Kotlin `private const val SEARCH_TIMEOUT_MS = 30000L` (L40). */
export const SEARCH_TIMEOUT_MS = 30000;
/** Kotlin `mainHandler.postDelayed(…, 12000)` (L95, L188). */
export const DOWNLOAD_HANDOFF_TIMEOUT_MS = 12_000;
/** Kotlin `if (now - lastGateClickAt < 6000) return` (L203). */
export const GATE_CLICK_THROTTLE_MS = 6000;
/** Kotlin `mainHandler.postDelayed(…, 20000)` — the login timeout (L270). */
export const LOGIN_TIMEOUT_MS = 20_000;

/**
 * DiamWall 复选框代点（与 ZLibraryWebViewHelper 同款）：
 * 挑战 iframe 与主文档同源，可跨 contentDocument 操作；点击后挑战页
 * JS 自行完成 PoW 校验并放行。
 *
 * Kotlin L45-58 `private const val DIAMWALL_GATE_CLICK_JS`, byte-for-byte the same JS source as
 * `ZLibraryWebViewHelper.DIAMWALL_GATE_CLICK_JS` (the Kotlin file also carries a copy). Only the
 * raw string's leading newline + 12-space indentation is rendered as a newline + 8 spaces, which
 * is inside JS whitespace and does not change a single character of code.
 */
export const DIAMWALL_GATE_CLICK_JS = `
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
`;

/** Kotlin L136-138 the session's User-Agent, verbatim (two Kotlin concatenations). */
export const SESSION_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/**
 * Kotlin L129-138 — the settings `attach` applies to the session WebView.
 * They are passed to `ZLibrarySessionRuntime.create(settings)` because that is where the runtime
 * seam accepts them; every flag keeps its Kotlin value. The comment at L133-134 is load-bearing:
 * 解析只需要 DOM/封面地址，禁止隐藏 WebView 下载页面图片，
 * 避免一次搜索触发几十个封面请求导致站点把 IP 临时封禁。
 * (`databaseEnabled` / `mixedContentMode` are NOT here — `ZLibraryNativeSession` never sets them;
 * only `ZLibraryWebViewHelper` does.)
 */
export const SESSION_SETTINGS = {
  javaScriptEnabled: true,
  domStorageEnabled: true,
  loadWithOverviewMode: true,
  useWideViewPort: true,
  blockNetworkImage: true,
  userAgentString: SESSION_USER_AGENT,
} as const;

/** Kotlin L322-325 — the "no results" markers, verbatim and in order. */
export const NO_RESULT_MARKERS: readonly string[] = [
  '没有找到',
  '未找到',
  '没有搜索结果',
  'no results',
  'nothing found',
  '0 results',
  'not found',
];

/* ═══════════════════════════════════════════════════════════════════════════
 * Injected seams
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin `WebViewClient` — the only callback this session overrides. */
export interface ZLibraryPageClient {
  /** Kotlin `WebViewClient.onPageFinished(view, url)`. */
  onPageFinished(url: string | null): void;
}

/** Kotlin `WebView` — the already-ported `HtmlRuntimePage` plus what this session adds. */
export interface ZLibrarySessionPage extends HtmlRuntimePage {
  /** Kotlin `wv.webViewClient = searchClient` / `= loginClient`. */
  setWebViewClient(client: ZLibraryPageClient): void;
  /** Kotlin `wv.setDownloadListener { url, _, _, _, _ -> … }`. */
  setDownloadListener(listener: (url: string | null) => void): void;
  /** Kotlin `wv.onPause()` (L157, L218, L255, L276). */
  onPause(): void;
  /** Kotlin `wv.onResume()` via `resumeForAction` (L197). */
  onResume(): void;
}

/** Kotlin L129-138 — exactly the flags `attach` sets, nothing more. */
export type ZLibrarySessionSettings = typeof SESSION_SETTINGS;

/** Kotlin `WebView(context.applicationContext)` + the global `CookieManager`. */
export interface ZLibrarySessionRuntime {
  cookies: HtmlRuntimeCookieStore;
  create(settings: ZLibrarySessionSettings): ZLibrarySessionPage;
}

/** Kotlin `class ZLibraryNativeSession(onSearchResults, onRealDownloadUrl, onLoginResult)`. */
export interface ZLibraryNativeSessionCallbacks {
  /** Kotlin `onSearchResults: (List<SearchBook>, String) -> Unit`. */
  onSearchResults(books: SearchBook[], status: string): void;
  /** Kotlin `onRealDownloadUrl: (String) -> Unit`. */
  onRealDownloadUrl(url: string): void;
  /** Kotlin `onLoginResult: (Boolean, String) -> Unit`. */
  onLoginResult(ok: boolean, message: string): void;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Pure helpers (exported for unit tests)
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin `String.isBlank()`. */
export function isBlank(value: string): boolean {
  return value.length === 0 || /^\s+$/.test(value);
}

/** Kotlin `String.contains(other, ignoreCase = true)` (locale-invariant on both sides). */
export function containsIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * `android.net.Uri.encode(s)` — `encode(s, null)`:
 * every character except `A-Za-z0-9` and `_-!.~'()*` is percent-encoded as UTF-8 with UPPERCASE
 * hex; a space becomes `%20` (NOT `+`). This is deliberately NOT `javaUrlEncode` from
 * `zLibraryHost.ts`, which reproduces `URLEncoder` (`+` for a space) because the *sibling*
 * Kotlin file calls `URLEncoder.encode`. Search URLs therefore differ between the two sessions
 * exactly as they do on Android.
 */
export function androidUriEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = '';
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (
      /[A-Za-z0-9]/.test(ch) ||
      ch === '_' ||
      ch === '-' ||
      ch === '!' ||
      ch === '.' ||
      ch === '~' ||
      ch === "'" ||
      ch === '(' ||
      ch === '*' ||
      ch === ')'
    ) {
      out += ch;
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

/**
 * `org.json.JSONObject.quote(String)` (AOSP `JSONStringer.appendQuoted`): wraps the value in
 * double quotes and escapes `"`, `\` and `/` with a backslash, uses the short forms for
 * `\b \t \n \f \r`, and emits `\u00xx` for any other char ≤ U+001F as well as for the JavaScript
 * line terminators U+2028 / U+2029. Note the `/` escaping — it is part of AOSP's behaviour and
 * is preserved here.
 */
export function jsonQuote(value: string): string {
  let out = '"';
  for (const ch of value) {
    switch (ch) {
      case '"':
      case '\\':
      case '/':
        out += `\\${ch}`;
        break;
      case '\t':
        out += '\\t';
        break;
      case '\b':
        out += '\\b';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\f':
        out += '\\f';
        break;
      case '\r':
        out += '\\r';
        break;
      default: {
        const code = ch.codePointAt(0) ?? 0;
        if (code <= 0x1f || code === 0x2028 || code === 0x2029) {
          out += `\\u${code.toString(16).padStart(4, '0')}`;
        } else {
          out += ch;
        }
      }
    }
  }
  return `${out}"`;
}

/**
 * Kotlin L233-242 — the login injection script, verbatim. Both credentials go through
 * `JSONObject.quote`, which is what makes the injected JS safe for quotes, backslashes and
 * newlines in a password.
 */
export function buildLoginJs(email: string, password: string): string {
  const jEmail = jsonQuote(email);
  const jPass = jsonQuote(password);
  return (
    "var e=document.querySelector('input[name=email],input[name=login],input[type=email]');" +
    "var p=document.querySelector('input[name=password],input[type=password]');" +
    `if(e&&p){e.value=${jEmail};p.value=${jPass};` +
    'var f=e.form||p.form;' +
    "if(f){var sb=f.querySelector('button[type=submit],input[type=submit]');" +
    "if(sb){sb.click();'clicked'}else{f.submit();'submitted'}}" +
    "else{'noform'}}" +
    "else{'nofields'}"
  );
}

/**
 * ADDITION — masks the two credential literals inside the injected login script so a host can log
 * the script itself (Android only ever logged the JS *evaluation result*, at L250, because
 * `buildLoginJs` output contains the account password verbatim). No Kotlin counterpart; exported
 * so the masking is unit-testable.
 */
export function redactInjectedCredentials(script: string): string {
  return script
    .replace(/e\.value=("(?:\\.|[^"\\])*")/, 'e.value="[redacted]"')
    .replace(/p\.value=("(?:\\.|[^"\\])*")/, 'p.value="[redacted]"');
}

/** Kotlin L304-307 — the DiamWall challenge markers, verbatim and in order. */
export function isChallengeHtml(html: string): boolean {
  return (
    containsIgnoreCase(html, 'Verifying your browser') ||
    containsIgnoreCase(html, 'Checking your browser') ||
    html.includes('cpt.lib') ||
    containsIgnoreCase(html, 'solve this captcha')
  );
}

/** Kotlin L326-327 — `!html.contains("z-bookcard") && noResultMarkers.any { … }`. */
export function isNoResultPage(html: string): boolean {
  if (html.includes('z-bookcard')) return false;
  return NO_RESULT_MARKERS.some((marker) => containsIgnoreCase(html, marker));
}

/**
 * Kotlin L299-303 — `try { JSONTokener(htmlJson).nextValue() as String } catch (e) { htmlJson }`:
 * `evaluateJavascript` returns a JSON-encoded string, so a string payload is unwrapped and
 * anything else (or a parse failure) is used raw.
 */
export function unwrapJsonString(htmlJson: string): string {
  try {
    const parsed: unknown = JSON.parse(htmlJson);
    return typeof parsed === 'string' ? parsed : htmlJson;
  } catch {
    return htmlJson;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * The session
 * ═══════════════════════════════════════════════════════════════════════════ */

export class ZLibraryNativeSession {
  /** Kotlin L70-71 `var webView: WebView?` with a private setter. */
  private page: ZLibrarySessionPage | null = null;

  /** Kotlin L73. */
  private pollTries = 0;
  /** Kotlin L74. */
  private pendingQuery: string | null = null;
  /** Kotlin L75 `private var searchClient: WebViewClient = WebViewClient()`. */
  private searchClient: ZLibraryPageClient = { onPageFinished: () => {} };
  /** Kotlin L76. */
  private loginInProgress = false;
  /** Kotlin L77. */
  private searchGeneration = 0;
  /** Kotlin L78. */
  private searchFinished = false;
  /** Kotlin L79. */
  private activeSearchUrl: string | null = null;
  /** Kotlin L80. */
  private downloadHandoffPending = false;
  /** Kotlin L81. */
  private pendingDestroy = false;
  /** Kotlin L82. */
  private lastGateClickAt = 0;

  /** Kotlin `scope.cancel()` — the scope's single observable effect on the parse continuation. */
  private scopeCancelled = false;

  /** Kotlin `mainHandler` — the tracked timer pool (`removeCallbacksAndMessages(null)`). */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly callbacks: ZLibraryNativeSessionCallbacks,
    private readonly runtime: ZLibrarySessionRuntime,
  ) {}

  /** Kotlin `var webView: WebView?` read side. */
  get webView(): ZLibrarySessionPage | null {
    return this.page;
  }

  /**
   * Kotlin L61-63:
   * `ZLibraryNodeConfig.domain.ifBlank { ZLibraryNodeManager.DEFAULT_NODE }`
   * — 空串 = 尚未恢复用户选择（仅启动空窗/单测），退回默认节点
   */
  get domain(): string {
    const domain = nodeDomain();
    return isBlank(domain) ? DEFAULT_NODE : domain;
  }

  /** Kotlin `mainHandler.postDelayed(runnable, delayMs)`. */
  private post(fn: () => void, delayMs: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, delayMs);
    this.timers.add(timer);
  }

  /** Kotlin `mainHandler.removeCallbacksAndMessages(null)`. */
  private removeAllTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  /** 离开书库时释放隐藏 WebView，回收渲染进程内存，避免后台持续占用。 (Kotlin L84) */
  destroy(): void {
    this.searchFinished = true;
    this.scopeCancelled = true; // Kotlin `scope.cancel()`
    this.removeAllTimers();
    const wv = this.page;
    if (wv === null) return;
    // 若正在等待下载真实链接（用户刚点下载就切走），等回调拿到 URL 后再释放
    if (this.downloadHandoffPending) {
      this.pendingDestroy = true;
      this.post(() => this.performDestroy(wv), DOWNLOAD_HANDOFF_TIMEOUT_MS);
    } else {
      this.performDestroy(wv);
    }
  }

  /** Kotlin L101-108 `performDestroy(wv)`. */
  private performDestroy(wv: ZLibrarySessionPage): void {
    if (this.page !== wv) return;
    try {
      wv.stopLoading();
    } catch {
      // Kotlin `try { wv.stopLoading() } catch (_: Exception) {}`
    }
    try {
      wv.destroy();
    } catch {
      // Kotlin `try { wv.destroy() } catch (_: Exception) {}`
    }
    this.page = null;
    this.pendingDestroy = false;
    this.downloadHandoffPending = false;
  }

  /**
   * 按需创建会话 WebView。WebView 不挂载到任何视图层级（游离模式）：
   * 依然可以加载页面、执行 JS、获取 DOM 和触发下载监听，但不会参与
   * 界面渲染，彻底避免挂载 WebView 导致的窗口冻结/CPU 空转问题。
   *
   * Kotlin L115-125; the `context` argument is dropped (the runtime is injected) and Kotlin's
   * L129-138 settings block is passed to `runtime.create(SESSION_SETTINGS)` instead of being
   * applied after construction — the same set, the same moment.
   */
  ensureCreated(): void {
    if (this.page === null) {
      try {
        this.attach(this.runtime.create(SESSION_SETTINGS));
      } catch {
        this.searchFinished = true;
        this.removeAllTimers();
        this.callbacks.onLoginResult(false, '系统 WebView 不可用，请更新 Android System WebView');
        this.callbacks.onSearchResults([], '系统 WebView 不可用');
      }
    }
  }

  /** Kotlin L127-162 `attach(wv)` (settings moved to `create`, see `ensureCreated`). */
  attach(wv: ZLibrarySessionPage): void {
    this.page = wv;
    this.runtime.cookies.setAcceptCookie(true);
    this.runtime.cookies.setAcceptThirdPartyCookies(wv, true);

    wv.setDownloadListener((url) => {
      this.downloadHandoffPending = false;
      if (url !== null) this.callbacks.onRealDownloadUrl(url);
      if (this.pendingDestroy) this.performDestroy(wv);
    });

    this.searchClient = {
      onPageFinished: (url) => {
        // Kotlin L148-153
        const activeUrl = this.activeSearchUrl;
        if (
          activeUrl !== null &&
          !this.searchFinished &&
          url !== null &&
          url.startsWith(`https://${this.domain}`)
        ) {
          this.parseCurrentPage(wv, activeUrl);
        }
      },
    };
    wv.setWebViewClient(this.searchClient);
    // 创建后默认暂停，避免隐藏 WebView 空闲时持续消耗 CPU/帧率
    try {
      wv.onPause();
    } catch {
      // Kotlin `try { wv.onPause() } catch (_: Exception) {}`
    }
    const pending = this.pendingQuery;
    if (pending !== null) {
      this.pendingQuery = null;
      this.search(pending);
    }
  }

  /** Kotlin L164-181 `search(query)`. */
  search(query: string): void {
    this.pollTries = 0;
    this.searchFinished = false;
    const generation = ++this.searchGeneration;
    this.pendingQuery = query;
    const wv = this.page;
    if (wv === null) return;
    // Kotlin `"https://$domain/s/" + Uri.encode(query)`
    const url = `https://${this.domain}/s/` + androidUriEncode(query);
    this.activeSearchUrl = url;
    this.resumeForAction(wv);
    wv.loadUrl(url);
    this.schedulePoll(wv, url);
    // 硬超时兜底：无论页面/回调卡在哪个环节，15 秒后必须结束搜索状态
    // (the constant is SEARCH_TIMEOUT_MS = 30000; the Kotlin comment still says 15 秒)
    this.post(() => {
      if (generation === this.searchGeneration && !this.searchFinished) {
        this.finishSearch(wv, [], '搜索超时，请重试或切换节点');
      }
    }, SEARCH_TIMEOUT_MS);
  }

  /** Kotlin L183-193 `loadUrl(url)` — load a page that will trigger the download listener. */
  loadUrl(url: string): void {
    const wv = this.page;
    if (wv === null) return;
    this.downloadHandoffPending = true;
    this.resumeForAction(wv);
    wv.loadUrl(url);
    this.post(() => {
      this.downloadHandoffPending = false;
      if (this.pendingDestroy) this.performDestroy(wv);
    }, DOWNLOAD_HANDOFF_TIMEOUT_MS);
  }

  /** 空闲时暂停隐藏 WebView，避免其 JS/渲染持续占用 CPU 导致界面掉帧。 (Kotlin L195) */
  private resumeForAction(wv: ZLibrarySessionPage): void {
    try {
      wv.onResume();
    } catch {
      // Kotlin `try { wv.onResume() } catch (_: Exception) {}`
    }
  }

  /** 代点 DiamWall 复选框（6s 节流，重复点击无益）。 (Kotlin L200) */
  private clickDiamWallGate(wv: ZLibrarySessionPage): void {
    const now = Date.now();
    if (now - this.lastGateClickAt < GATE_CLICK_THROTTLE_MS) return;
    try {
      void wv.evaluateJavascript(DIAMWALL_GATE_CLICK_JS).then((result) => {
        if (result !== null && result.includes('clicked')) {
          this.lastGateClickAt = now;
          SourceLog.log('ZLibSession', `DiamWall gate auto-clicked on ${this.domain}`);
        }
      });
    } catch {
      // Kotlin `runCatching { wv.evaluateJavascript(…) { … } }`
    }
  }

  /** Kotlin L214-219 `finishSearch(wv, books, status)`. */
  private finishSearch(wv: ZLibrarySessionPage | null, books: SearchBook[], status: string): void {
    if (this.searchFinished) return;
    this.searchFinished = true;
    this.callbacks.onSearchResults(books, status);
    try {
      wv?.onPause();
    } catch {
      // Kotlin `try { wv?.onPause() } catch (_: Exception) {}`
    }
  }

  /** Kotlin L221-224 `isLoggedIn()`. */
  isLoggedIn(): boolean {
    const cookies = this.runtime.cookies.getCookie(`https://${this.domain}/`);
    if (cookies === null) return false;
    return cookies.includes('remix_userid') || cookies.includes('remix_userkey');
  }

  /** Kotlin L226-280 `login(email, password)`. */
  login(email: string, password: string): void {
    const wv = this.page;
    if (wv === null) {
      this.callbacks.onLoginResult(false, '会话未就绪，请重试');
      return;
    }
    if (this.loginInProgress) return;
    this.loginInProgress = true;
    const js = buildLoginJs(email, password);

    const loginClient: ZLibraryPageClient = {
      onPageFinished: (url) => {
        // Kotlin L245-264
        if (!this.loginInProgress) return;
        if (url === null) return;
        if (url.includes('/login')) {
          void wv.evaluateJavascript(js).then((result) => {
            SourceLog.log('ZLibLogin', `inject result: ${String(result)}`);
          });
        } else if (url.startsWith(`https://${this.domain}`) && !url.includes('/login')) {
          this.loginInProgress = false;
          wv.setWebViewClient(this.searchClient);
          try {
            wv.onPause();
          } catch {
            // Kotlin `try { wv.onPause() } catch (_: Exception) {}`
          }
          if (this.isLoggedIn()) {
            SourceLog.log('ZLibLogin', 'login success, cookies present');
            this.callbacks.onLoginResult(true, '登录成功');
          } else {
            SourceLog.log('ZLibLogin', 'login failed, no session cookies');
            this.callbacks.onLoginResult(false, '登录失败，请检查账号密码');
          }
        }
      },
    };
    wv.setWebViewClient(loginClient);
    this.resumeForAction(wv);
    wv.loadUrl(`https://${this.domain}/login`);
    // 超时兜底：20 秒未完成则视为失败
    this.post(() => {
      if (this.loginInProgress) {
        this.loginInProgress = false;
        if (this.page === wv) {
          wv.setWebViewClient(this.searchClient);
        }
        try {
          wv.onPause();
        } catch {
          // Kotlin `try { wv.onPause() } catch (_: Exception) {}`
        }
        this.callbacks.onLoginResult(false, '登录超时，请检查网络后重试');
      }
    }, LOGIN_TIMEOUT_MS);
  }

  /** Kotlin L282-355 `parseCurrentPage(wv, url)`. */
  private parseCurrentPage(wv: ZLibrarySessionPage, url: string): void {
    // 游离 WebView 永不挂载，不能用 isAttachedToWindow；只校验是否仍是当前会话
    if (this.page !== wv) return;
    if (this.searchFinished) return;
    if (!url.startsWith(`https://${this.domain}`)) return;
    void wv.evaluateJavascript('(function(){return document.documentElement.outerHTML;})();').then(
      (htmlJson) => {
        // Kotlin `if (searchFinished) return@evaluateJavascript`
        if (this.searchFinished) return;
        if (htmlJson === null) {
          // 页面还没就绪/回调无结果：继续重试而不是永久转圈
          this.pollTries += 1;
          if (this.pollTries >= MAX_POLL_TRIES) {
            this.finishSearch(wv, [], '页面无响应，请重试或切换节点');
          } else {
            this.schedulePoll(wv, url);
          }
          return;
        }
        const html = unwrapJsonString(htmlJson);
        if (isChallengeHtml(html)) {
          // 被动等不会过：主动代点复选框（挑战 JS 自行完成后续校验）
          this.clickDiamWallGate(wv);
          this.pollTries += 1;
          if (this.pollTries >= MAX_CHALLENGE_POLL_TRIES) {
            this.finishSearch(wv, [], '验证未通过，请重试或切换节点');
            return;
          }
          this.callbacks.onSearchResults([], '正在通过验证…');
          this.schedulePoll(wv, url);
          return;
        }

        // 站点明确提示无结果时直接结束，不再空转 12 次
        if (isNoResultPage(html)) {
          this.finishSearch(wv, [], '未找到相关书籍');
          return;
        }

        // Kotlin L333 `scope.launch(Dispatchers.Default) { … withContext(Dispatchers.Main) { … } }`
        if (this.scopeCancelled) return; // a cancelled Kotlin scope never runs the continuation
        let books: SearchBook[] = [];
        try {
          books = ZLibraryParserManager.parseSearchPage(html, `https://${this.domain}`, 'zlibrary');
        } catch {
          books = [];
        }
        if (this.searchFinished || this.page !== wv) return;
        if (books.length > 0) {
          this.pollTries = 0;
          this.finishSearch(wv, books, `找到 ${books.length} 本`);
        } else {
          this.pollTries += 1;
          if (this.pollTries >= MAX_POLL_TRIES) {
            this.finishSearch(wv, [], '未解析到书籍（可能结构变化或需要登录）');
          } else {
            this.schedulePoll(wv, url);
          }
        }
      },
    );
  }

  /**
   * Kotlin L357-368 `schedulePoll(wv, url)`.
   *
   * PRESERVED QUIRK (not a port bug): the guard re-checks `pollTries < MAX_POLL_TRIES` (5) even
   * for the challenge branch, which raises `pollTries` toward MAX_CHALLENGE_POLL_TRIES (10). So a
   * stuck challenge page is polled 5 times (12.5 s) and then the 30 s hard timeout closes the
   * search with 搜索超时 — the `验证未通过，请重试或切换节点` branch is unreachable, exactly as on
   * Android. The mismatch is kept verbatim so the Android/TS behaviour stays identical; fixing it
   * is an upstream change, not a port change.
   */
  private schedulePoll(wv: ZLibrarySessionPage, url: string): void {
    const generation = this.searchGeneration;
    this.post(() => {
      if (
        generation === this.searchGeneration &&
        this.pollTries < MAX_POLL_TRIES &&
        this.page === wv &&
        !this.searchFinished
      ) {
        this.parseCurrentPage(wv, url);
      }
    }, POLL_DELAY_MS);
  }
}

/** Kotlin `object`/`class` construction helper for the host. */
export function createZLibraryNativeSession(
  runtime: ZLibrarySessionRuntime,
  callbacks: ZLibraryNativeSessionCallbacks,
): ZLibraryNativeSession {
  return new ZLibraryNativeSession(callbacks, runtime);
}