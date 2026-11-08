/**
 * Android source: `com.example.source.js.JsUiDialogs.kt` (171 lines, 164 non-blank)
 * Ported: 164 / 164 non-blank lines of behaviour. Skipped: none of the logic;
 * every Android View/Activity/Handler call sits behind an injected port.
 *
 * Platform adaptations:
 * - `JsActivityTracker` (`WeakReference<Activity>` + `ActivityLifecycleCallbacks`)
 *   → an opaque foreground token (`ActivityHandle`) updated by the platform
 *   adapter (Capacitor `AppStateChange` / UIKit scene delegate). `register` and
 *   `currentActivity` keep their contracts.
 * - `AlertDialog.Builder` + `LinearLayout`/`EditText`/`ImageView` → the
 *   `DialogHostPort` interface below, implemented by the React layer outside
 *   `src/core` (no DOM/React import here).
 * - `WebView` + `WebViewClient` + `CookieManager` → `WebViewFactory` /
 *   `WebViewClientHandlers` from `./jsPlatform`.
 * - `suspendCancellableCoroutine { … }` → a `Promise` settled by `complete()`,
 *   with `invokeOnCancellation` mapped to the caller's `AbortSignal`.
 * - `withContext(Dispatchers.Main)` dropped — the platform adapter resolves on
 *   the UI scheduler.
 * - `Handler(Looper.getMainLooper()).post { … }` → the adapter's own scheduling.
 */

import type {
  BrowserCookiePort,
  CancellationSignal,
  WebViewFactory,
  WebViewSession,
} from './jsPlatform';

/** The foreground UI token — Kotlin `Activity` on Android. */
export type ActivityHandle = object;

/** Kotlin `AlertDialog` + the view tree `awaitJsInputDialog` builds. */
export interface DialogHandle {
  /** Kotlin `dialog.dismiss()`. */
  dismiss(): void;
  /** Resolves when the dialog goes away (user cancel / programmatic dismiss). */
  dismissed: Promise<void>;
  /** Kotlin `input.requestFocus()`. */
  focusInput(): void;
}

/**
 * A modal dialog host — Kotlin `AlertDialog.Builder` plus its view tree.
 * Implemented by the React layer; `src/core` never touches the DOM.
 */
export interface DialogHostPort {
  /**
   * Kotlin `AlertDialog.Builder(activity).setTitle(title).setView(container)`
   * with `setPositiveButton("确定")` / `setNegativeButton("取消")`.
   * Resolves with the entered text; cancellation resolves with `""`.
   */
  showInput(params: {
    activity: ActivityHandle;
    title: string;
    /** Kotlin `imageBase64` — a data URL; the adapter decodes and shows it. */
    imageBase64: string | null;
    /** Kotlin `(180 * density).toInt()` — advisory height for the ImageView. */
    imageHeight: number;
    /** Kotlin `pad = (24 * density).toInt()`. */
    padding: number;
    /** Kotlin `BitmapFactory.decodeByteArray(…)` for the captcha, or null. */
    imageBytes: Uint8Array | null;
  }): Promise<string>;
  /**
   * Kotlin `AlertDialog.Builder(activity).setTitle("站点验证").setView(browser)`
   * `.setNegativeButton("取消")`, sized `MATCH_PARENT` × `heightPixels * 0.85`.
   */
  showWebView(params: {
    activity: ActivityHandle;
    title: string;
    negativeText: string;
    height: number;
    webView: WebViewSession;
  }): DialogHandle;
  /** Kotlin `activity.resources.displayMetrics.density`. */
  densityOf(activity: ActivityHandle): number;
  /** Kotlin `activity.resources.displayMetrics.heightPixels`. */
  heightPixelsOf(activity: ActivityHandle): number;
  /** Kotlin `android.webkit.WebSettings.getDefaultUserAgent(context)`. */
  defaultUserAgent(): string;
}

/** Kotlin `android.util.Base64.decode(imageBase64.substringAfter("base64,"), DEFAULT)`. */
export function decodeBase64Payload(dataUrl: string): Uint8Array {
  const payload = dataUrl.includes('base64,') ? dataUrl.slice(dataUrl.indexOf('base64,') + 7) : dataUrl;
  const binary = atob(payload);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * 追踪当前前台 Activity，供 JS 源的 UI 对话框使用。
 * 通过 applicationContext 注册生命周期回调，无需修改 Manifest。
 * The adapter registers app-state listeners once; no Manifest change.
 */
export class JsActivityTracker {
  private current: WeakRef<ActivityHandle> | null = null;
  private registered = false;

  /** Kotlin `fun register(context: Context)` — guarded by `AtomicBoolean`. */
  register(handle: ActivityHandle | null): void {
    if (this.registered) return;
    this.registered = true;
    this.current = handle === null ? null : new WeakRef(handle);
  }

  /** Kotlin `onActivityResumed(activity)`. */
  onResumed(handle: ActivityHandle): void {
    this.current = new WeakRef(handle);
  }

  /** Kotlin `onActivityPaused(activity)` / `onActivityDestroyed(activity)`. */
  onPaused(handle: ActivityHandle): void {
    if (this.current?.deref() === handle) this.current = null;
  }

  /** Kotlin `fun currentActivity(): Activity?`. */
  currentActivity(): ActivityHandle | null {
    return this.current?.deref() ?? null;
  }
}

export const jsActivityTracker = new JsActivityTracker();

/**
 * 挂起式输入对话框：实现 Venera 契约的 UI.showInputDialog。
 * 支持展示图片（验证码），返回用户输入文本；取消返回空串。
 */
export async function awaitJsInputDialog(
  dialogs: DialogHostPort,
  title: string,
  imageBase64: string | null = null,
  signal?: CancellationSignal,
): Promise<string> {
  const activity = jsActivityTracker.currentActivity();
  if (activity === null) throw new Error('无可用界面（请回到 App 后重试）');
  if (signal?.aborted === true) throw new DOMException('JS request cancelled', 'AbortError');
  // Kotlin `runCatching { Base64.decode(...); BitmapFactory.decodeByteArray(…) }`:
  // an undecodable captcha leaves the ImageView empty instead of failing.
  let imageBytes: Uint8Array | null = null;
  if (imageBase64 !== null && imageBase64.trim() !== '') {
    try {
      imageBytes = decodeBase64Payload(imageBase64);
    } catch {
      imageBytes = null;
    }
  }
  const density = dialogs.densityOf(activity);
  return dialogs.showInput({
    activity,
    title,
    imageBase64,
    // Kotlin `val pad = (24 * density).toInt()`
    padding: Math.trunc(24 * density),
    // Kotlin `LinearLayout.LayoutParams(MATCH_PARENT, (180 * density).toInt())`
    imageHeight: Math.trunc(180 * density),
    imageBytes,
  });
}

/** A user-operated site verification, with cookies kept in the app's browser jar. */
export async function awaitWebsiteVerification(
  webviews: WebViewFactory,
  dialogs: DialogHostPort,
  url: string,
  userAgent: string,
  signal?: CancellationSignal,
  /** Kotlin `CfWebViewSolver.syncToJsCookieJar(context, url)`. */
  syncCookies: (target: string) => void = () => undefined,
): Promise<boolean> {
  // Kotlin `require(Uri.parse(url).host in setOf("mycomic.com", "nhentai.net"))`
  // — a message-less `require` throws IllegalArgumentException("Check failed.").
  if (!new Set(['mycomic.com', 'nhentai.net']).has(new URL(url).host)) {
    throw new Error('Check failed.');
  }
  const activity = jsActivityTracker.currentActivity();
  if (activity === null) throw new Error('请回到应用后打开站点验证');

  const cookies: BrowserCookiePort = webviews.cookies;
  cookies.setAcceptCookie(true);
  let mainPageOk = false;
  let settled = false;
  let resolveContinuation: ((value: boolean) => void) | null = null;
  const settledPromise = new Promise<boolean>((resolve) => {
    resolveContinuation = resolve;
  });

  const browser: WebViewSession = webviews.create(url, userAgent);
  browser.setFullSize();
  const dialog = dialogs.showWebView({
    activity,
    title: '站点验证',
    negativeText: '取消',
    // Kotlin `dialog.window?.setLayout(MATCH_PARENT, (heightPixels * 0.85).toInt())`
    height: Math.trunc(dialogs.heightPixelsOf(activity) * 0.85),
    webView: browser,
  });

  const complete = (success: boolean): void => {
    if (settled) return;
    settled = true;
    if (success) {
      cookies.flush();
      syncCookies(url);
    }
    resolveContinuation?.(success);
    dialog.dismiss();
  };

  browser.setHandlers({
    shouldOverrideUrlLoading: (destination, isMainFrame) => {
      const target = new URL(destination);
      if (!isMainFrame) {
        return target.protocol !== 'https:' && destination !== 'about:blank';
      }
      return target.protocol !== 'https:' || target.host !== new URL(url).host;
    },
    onPageStarted: () => {
      mainPageOk = true;
    },
    onReceivedHttpError: (_view, _errorUrl, isMainFrame) => {
      if (isMainFrame) mainPageOk = false;
    },
    onPageFinished: (view, currentUrl) => {
      // Kotlin: `if (!mainPageOk || Uri.parse(currentUrl.orEmpty()).host != Uri.parse(url).host) return`
      if (!mainPageOk) return;
      let currentHost = '';
      try {
        currentHost = new URL(currentUrl === '' ? 'about:blank' : currentUrl).host;
      } catch {
        return;
      }
      if (currentHost !== new URL(url).host) return;
      void view
        .evaluateJavascript(
          `Boolean(document.querySelector('a[href*="/cn/comics/"],a[href^="/g/"],div.gallery'))`,
        )
        .then((value) => {
          if (value === 'true') complete(true);
        });
    },
  });

  // Kotlin `dialog.setOnDismissListener { … if (continuation.isActive) resume(false) }`
  void dialog.dismissed.then(() => {
    browser.stopLoading();
    browser.destroy();
    if (!settled) {
      settled = true;
      resolveContinuation?.(false);
    }
  });

  // Kotlin `continuation.invokeOnCancellation { main.post { dialog.dismiss() } }`
  const onAbort = (): void => complete(false);
  signal?.addEventListener('abort', onAbort, { once: true });

  browser.loadUrl(url, {});
  try {
    return await settledPromise;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
