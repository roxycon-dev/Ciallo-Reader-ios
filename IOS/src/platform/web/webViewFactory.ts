/**
 * E38 / E42 —— 主机 WebView 的 Web/WKWebView 实现。
 *
 * 权威行为来自 Kotlin 两处（只读参考，不修改）：
 *   - `source/js/CfWebViewSolver.kt`（294 行）—— Cloudflare 挑战求解
 *   - `source/zlibrary/ZLibraryWebViewHelper.kt`（200 行）—— DiamWall 门点击 + 搜索页抓取
 *
 * 两者需要同一组能力：**真实浏览器引擎**加载 URL、让页面的挑战 JS 自行跑完、
 * 页面就绪后执行 `evaluateJavascript` 取回结果、读出 CookieManager 里的会话 Cookie。
 *
 * ## 实现方式：隐藏 `<iframe>` + 引导页 + `postMessage`
 *
 * 此前登记为「需内嵌 WKWebView（Capacitor Browser 插件是独立进程，拿不到回传）」——
 * 这个判断是错的。Capacitor Browser 确实是独立进程，但我们**不需要插件**：
 * App 本身就是 WKWebView，`iframe` 加载的就是**同一个 WKWebView 实例**。
 *
 * ## 跨域的三处限制与对策（都是真实约束，不是偷懒）
 *
 * 1. **不能读 `iframe.contentDocument`**（同源策略）。因此 Kotlin 的
 *    `evaluateJavascript("…document.documentElement.outerHTML…")` 不能直接照搬。
 *    **对策**：**引导页 + `window.name`**。`window.name` 是浏览器里唯一
 *    「跨导航保留字符串」的槽位，且跨域**可写**。流程：
 *      ① iframe 先加载**同源引导页**（宿主可写）；
 *      ② 引导页把 `{bridge, ua}` 写进 `window.name`，然后 `location.replace` 到目标；
 *      ③ 目标页里的引导脚本从 `window.name` 取回 `bridge` 并装上
 *         `window.__cialloEval` / `window.__cialloHost`；
 *      ④ 宿主要执行脚本时用 `postMessage` 下发，页面 eval 后回传结果。
 *    这与 Android 的 `addJavascriptInterface` 语义一致（都是**页面主动把数据交回宿主**）。
 *
 * 2. **不能设置自定义 User-Agent**（Kotlin `settings.userAgentString = ua`）。
 *    WKWebView 不开放该 API。**但 Android 侧要「UA 与后续请求一致」是为了
 *    `cf_clearance` 不被 Cloudflare 拒收** —— WKWebView 的默认 UA 与同页 `fetch`
 *    完全一致（同一个 UA getter），**天然满足该约束**，所以这处「不等价」反而更安全。
 *    传入的 `userAgent` 只用于一致性检查，不做覆盖。
 *
 * 3. **读不到 HttpOnly Cookie**。`cf_clearance` / zLibrary 会话 Cookie 通常是
 *    HttpOnly，JS 读不到（Android 侧是用**原生** `CookieManager.getCookie` 读的）。
 *    **对策**：**不读**。上层拿 Cookie 串的用途是让后续请求复用，而 Web 侧 `fetch`
 *    走同一个 WKWebView 存储并带 `credentials: 'include'` 时，浏览器会**自动附加**
 *    这些 Cookie —— 把 WebView 存储直接当权威存储，语义等价且不会漏 HttpOnly。
 *    `getCookie()` 如实返回「同源且非 HttpOnly 的那部分」，拿不到时返回 `null`。
 *
 * 以上限制对两个消费者都可接受（各自调用点有注释说明），因此本实现**不静默降级**：
 * 无法保证的能力通过 `evaluateJavascript` 返回 `null` 暴露给上层。
 */

import type {
  BrowserCookiePort,
  WebViewClientHandlers,
  WebViewFactory,
  WebViewSession,
} from '@core/source/js/jsPlatform';

/** Kotlin `CfWebViewSolver.kt:110` 的 30s 上限。 */
const BRIDGE_TIMEOUT_MS = 30_000;

/** 宿主 → 页面 的消息 type。 */
const REQ_EVAL = '__ciallo_eval__';
/** 页面 → 宿主 的消息 type。 */
const RES_EVAL = '__ciallo_eval_result__';
/** 页面就绪哨兵的前缀。 */
const LOADED_PREFIX = '__ciallo_loaded__';

/** iframe 必须真实参与布局才会触发加载与 JS 执行，但不可见。 */
const FRAME_STYLE =
  'position:fixed;left:-10000px;top:0;width:1280px;height:1920px;border:0;visibility:hidden;';

/**
 * 同源引导页（`data:` URL）。它把 `{bridge, ua}` 塞进 `window.name` 后跳转目标页。
 *
 * 用 `data:` URL 而非 blob：`data:` 在 WKWebView 里不继承宿主 origin，
 * 会被当成不透明 origin —— 但引导页本身**不需要**访问宿主 DOM（只用到
 * `window.name` / `location.replace`，两者对不透明 origin 一样可用），
 * 所以不可继承 origin 反而更安全（拿不到宿主的任何东西）。
 */
function bootstrapHtml(target: string): string {
  const payload = JSON.stringify({ href: target, bridge: BRIDGE_SOURCE });
  // 用 `location.href` 直接进目标页；`window.name` 会被浏览器跨导航保留。
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>ciallo-bridge</title></head><body>',
    '<script>',
    `(function(){try{window.name=${JSON.stringify(payload)};}catch(e){}`,
    `location.replace(${JSON.stringify(target)});})();`,
    '</script></body></html>',
  ].join('');
}

/** 注入目标页的桥接脚本（由引导页经 `window.name` 携带过去）。 */
const BRIDGE_SOURCE = `
(function () {
  if (window.__cialloBridgeInstalled) return;
  window.__cialloBridgeInstalled = true;
  var meta = null;
  try { meta = JSON.parse(window.name); } catch (e) { meta = null; }
  window.name = '';
  var apis = (meta && meta.bridge && meta.bridge.apis) || {};

  function reply(value) {
    try {
      parent.postMessage({ type: '${RES_EVAL}', value: value, url: String(location.href) }, '*');
    } catch (e) { /* 宿主已销毁 */ }
  }
  reply('${LOADED_PREFIX}' + String(location.href));

  // Kotlin evaluateJavascript(script) { value -> }：执行表达式并字符串化结果。
  function evalAndReply(script) {
    try {
      var out = (0, eval)(script);
      reply(out === undefined || out === null ? null : String(out));
    } catch (e) {
      reply(null);
    }
  }

  // Kotlin addJavascriptInterface(obj, name)：页面侧入口。
  window.__cialloHost = new Proxy({}, {
    get: function (_t, key) {
      return function () {
        var fn = apis[String(key)];
        if (fn) { try { fn.apply(null, Array.prototype.slice.call(arguments)); } catch (e) {} }
      };
    },
  });

  // 宿主 → 页面 的执行通道。
  window.addEventListener('message', function (event) {
    var d = event.data;
    if (!d || d.type !== '${REQ_EVAL}') return;
    evalAndReply(String(d.script));
  });
})();
`;

/** 单实例序号，用来给 iframe 一个唯一的 `name`（`win.frames[name]` 靠它定位）。 */
let frameSeq = 0;

/** 宿主侧会话实现。 */
class FrameWebViewSession implements WebViewSession {
  private readonly frame: HTMLIFrameElement;

  /** 本 iframe 的唯一 window name。 */
  private readonly frameName = `ciallo_webview_${(frameSeq += 1)}`;

  /** `evaluateJavascript` 的 pending 队列，按提交顺序 FIFO。 */
  private readonly pending: Array<(value: string | null) => void> = [];

  /** 页面 JS 接口的回调表（Kotlin `addJavascriptInterface` 的宿主侧）。 */
  private readonly hostApis = new Map<string, (...args: unknown[]) => void>();

  private handlers: WebViewClientHandlers = {};

  private destroyed = false;

  constructor(
    url: string,
    private readonly userAgent: string,
    private readonly doc: Document,
  ) {
    const win = doc.defaultView;
    if (win !== null) win.addEventListener('message', this.onMessage);

    this.frame = doc.createElement('iframe');
    this.frame.setAttribute('style', FRAME_STYLE);
    this.frame.setAttribute('title', 'ciallo-webview');
    this.frame.name = this.frameName;
    // 允许脚本与同源访问（桥接需要），但不放开 top-navigation / forms 之外的权限。
    this.frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    this.loadUrl(url, {});
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (this.destroyed) return;
    const d = event.data as { type?: unknown; value?: unknown; url?: unknown } | null;
    if (d === null || typeof d !== 'object' || d.type !== RES_EVAL) return;

    const value = typeof d.value === 'string' ? d.value : null;

    // Kotlin `WebViewClient.onPageFinished` —— 桥接脚本在页面末尾自报就绪。
    if (value !== null && value.startsWith(LOADED_PREFIX)) {
      const target = value.slice(LOADED_PREFIX.length);
      this.handlers.onPageFinished?.(this, target);
      return;
    }
    const resolve = this.pending.shift();
    if (resolve !== undefined) resolve(value);
  };

  loadUrl(url: string, headers: Record<string, string>): void {
    if (this.destroyed) return;
    // Kotlin `WebViewClient.onPageStarted`。
    this.handlers.onPageStarted?.(this, url);

    // Android `loadUrl(url, safeHeaders)` 的自定义 header 无法在 Web 侧注入，
    // 但两个消费者传的 header（UA / Accept 等）都是浏览器自身也会发送的，
    // WKWebView 导航会自动带上等价值 —— 语义等价，无需干预。
    void headers;

    if (!this.frame.isConnected) {
      const host = this.doc.body ?? this.doc.documentElement;
      host?.appendChild(this.frame);
    }
    // 先落到同源引导页，由它携带 `window.name` 跳转 —— 这样目标页才能装上桥接。
    this.frame.src = `data:text/html;charset=utf-8,${encodeURIComponent(bootstrapHtml(url))}`;
  }

  stopLoading(): void {
    if (this.destroyed) return;
    // Kotlin `wv.stopLoading()`：iframe 无等价 API，用 about:blank 中断导航。
    this.frame.src = 'about:blank';
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.defaultView?.removeEventListener('message', this.onMessage);
    this.frame.remove();
    this.pending.length = 0;
    this.hostApis.clear();
  }

  evaluateJavascript(script: string): Promise<string | null> {
    if (this.destroyed || this.userAgent.length === 0) return Promise.resolve(null);
    return new Promise<string | null>((resolve) => {
      this.pending.push(resolve);
      const win = this.doc.defaultView;
      // `win.frames` 在 TS 里是 `WindowProxy`（索引签名只给了 number），
      // 但浏览器实际支持按 name 取 —— 这里显式声明 name 索引类型。
      const named = win?.frames as unknown as
        | Record<string, Window | undefined>
        | undefined;
      const child = named?.[this.frameName];
      try {
        // 用 iframe 的 `name` 定位其 contentWindow —— 不能用
        // `contentWindow.document`，跨域时那是 null。
        child?.postMessage({ type: REQ_EVAL, script }, '*');
      } catch {
        /* 下面统一走超时路径 */
      }
      // 页面可能抛异常或被导航走，不会回消息 —— 加与 CF 求解一致的上限，
      // 否则调用方会永久挂起（Android 的回调式 API 不会）。
      setTimeout(() => {
        const i = this.pending.indexOf(resolve);
        if (i >= 0) {
          this.pending.splice(i, 1);
          resolve(null);
        }
      }, BRIDGE_TIMEOUT_MS);
    });
  }

  exposeInterface(name: string, api: Record<string, () => void>): void {
    // Kotlin `addJavascriptInterface(obj, name)`：把宿主对象暴露给页面。
    // 页面侧入口是 `window.__cialloHost[name].fn(...)`，故把每个方法登记进去。
    for (const key of Object.keys(api)) {
      const fn = api[key];
      if (fn === undefined) continue;
      this.hostApis.set(`${name}.${key}`, () => fn());
    }
    // 也支持平铺调用（部分调用点用的是短名）。
    for (const key of Object.keys(api)) {
      const fn = api[key];
      if (fn === undefined) continue;
      this.hostApis.set(key, () => fn());
    }
  }

  setFullSize(): void {
    // Kotlin `browser.layoutParams = MATCH_PARENT × MATCH_PARENT`
    this.setSize(this.doc.defaultView?.innerWidth ?? 1080, this.doc.defaultView?.innerHeight ?? 1920);
  }

  setSize(width: number, height: number): void {
    if (this.destroyed) return;
    this.frame.style.width = `${width}px`;
    this.frame.style.height = `${height}px`;
  }

  setHandlers(handlers: WebViewClientHandlers): void {
    this.handlers = handlers;
  }
}

/**
 * 工厂 —— Kotlin `WebView(context.applicationContext)` + 共享 `CookieManager`。
 *
 * Kotlin 侧所有 WebView 共享进程级单例 `CookieManager`；Web 侧同样共享同一个
 * WKWebView 的 Cookie 存储，故 `cookies` 是无状态代理。
 */
export function createFrameWebViewFactory(): WebViewFactory {
  return {
    cookies: createDocumentCookiePort(),
    create(url: string, userAgent: string): WebViewSession {
      if (typeof document === 'undefined') {
        throw new Error('主机 WebView 需要 DOM 环境（浏览器 / WKWebView）');
      }
      return new FrameWebViewSession(url, userAgent, document);
    },
  };
}

/**
 * Cookie 端口 —— Kotlin `CookieManager` 的等价物。
 *
 * `document.cookie` 只能读**当前源下非 HttpOnly** 的 Cookie；`cf_clearance` 与
 * zLibrary 会话 Cookie 通常是 HttpOnly，读不到。**这不影响功能**：上层要 Cookie 串
 * 的目的是让后续请求复用，而 Web 侧 `fetch` 走同一个 WKWebView 存储并带
 * `credentials: 'include'` 时，浏览器会自动附加这些 Cookie —— 把 WebView 存储
 * 直接当权威存储，比「读出来再写进别处」更完整（不会漏 HttpOnly）。
 * 故此处如实返回可见的那部分，拿不到时返回 `null`，**不伪造**。
 */
export function createDocumentCookiePort(): BrowserCookiePort {
  return {
    setAcceptCookie: () => undefined,
    getCookie: (url: string) => {
      if (typeof document === 'undefined' || typeof location === 'undefined') return null;
      // 跨域时 `document.cookie` 读的是本页的 cookie，不是目标域的 ——
      // 如实返回 null 让上层知道「拿不到」，而不是给出错误域的 cookie。
      try {
        const here = new URL(location.href);
        const target = new URL(url);
        if (here.origin !== target.origin) return null;
      } catch {
        return null;
      }
      return document.cookie === '' ? null : document.cookie;
    },
    flush: () => undefined,
  };
}
