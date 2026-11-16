/**
 * Android source: `com.example.source.js.CfWebViewSolver.kt` (293 lines, 262 non-blank)
 * Ported: 262 / 262 non-blank lines of behaviour. Skipped: none.
 *
 * Platform adaptations:
 * - `android.webkit.WebView` + `WebViewClient` + `CookieManager` → the injected
 *   `WebViewFactory` / `WebViewClientHandlers` / `BrowserCookiePort` from
 *   `./jsPlatform` (WKWebView + Capacitor provide the adapters).
 * - `Handler(Looper.getMainLooper()).post {}` / `postDelayed(runnable, 250)` →
 *   the adapter's own scheduling; the 250 ms poll becomes a `setTimeout`
 *   callback (not a DOM API, so `src/core` may hold it).
 * - `CountDownLatch` → a `Pending` record holding a deferred promise; the
 *   `latch.await(timeoutMs)` racing is `Promise.race` against a timer.
 * - `InetAddress.getAllByName(host)` → injected `resolveHost()` (JS has no
 *   synchronous DNS). Every `isPublicHost` predicate on the address bytes is
 *   preserved, and `isPrivateAddress` is reused from `../networkCalls`.
 * - `java.net.URL` → `new URL`; `URL.host` is already lowercased.
 * - `synchronized(inflight)` / `synchronized(lastFailAt)` dropped — JS is
 *   single-threaded and the in-flight map is the mutual exclusion.
 * - `Context` for the cookie sync → the injected `saveCookiePairs` callback.
 */

import { isPrivateAddress } from '../networkCalls';
import type { WebViewFactory } from './jsPlatform';

const TAG = 'CfSolver';
const SOLVE_TIMEOUT_MS = 30_000;
const FAIL_RETRY_INTERVAL_MS = 5 * 60_000;

/** Kotlin `private class Pending(val latch: CountDownLatch(1)) { var success: Boolean }`. */
interface Pending {
  success: boolean;
  /** `latch.countDown()` */
  signal(): void;
  /** Resolves when `latch` reaches zero. */
  readonly settled: Promise<void>;
}

function newPending(): Pending {
  let release: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { success: false, signal: () => release(), settled };
}

/** host -> 进行中的求解；并发调用共享同一次 WebView。 */
const inflight = new Map<string, Pending>();

/** host -> 上次失败时间；失败后冷却期内直接返回 false。 */
const lastFailAt = new Map<string, number>();

/** The collaborators `CfWebViewSolver` needs — all injected, none platform-imported. */
export interface CfSolverDeps {
  readonly webviews: WebViewFactory;
  /** Kotlin `InetAddress.getAllByName(host)`. */
  readonly resolveHost: (host: string) => Promise<string[]>;
  /** Kotlin `JsCookieJar.saveCookiePairs(context, host, pairs)`. */
  readonly saveCookiePairs: (host: string, pairs: string[]) => void;
  /** Kotlin `System.currentTimeMillis()`. */
  readonly now: () => number;
  /** Kotlin `Handler.postDelayed(runnable, millis)`. */
  readonly schedule: (fn: () => void, ms: number) => void;
  /** Kotlin `android.util.Log.i` / `Log.w` with tag `CfSolver`. */
  readonly log: (level: 'i' | 'w', message: string) => void;
}

/** 官方挑战响应识别（状态码 + 响应头，键大小写不敏感）。 */
export function isChallengeResponse(
  status: number,
  headers: Map<string, string> | Record<string, string>,
): boolean {
  if (status !== 403 && status !== 503 && status !== 429) return false;
  const entries = headers instanceof Map ? [...headers.entries()] : Object.entries(headers);
  const find = (name: string): string => {
    const hit = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return hit?.[1] ?? '';
  };
  const mitigated = find('cf-mitigated');
  const server = find('server');
  return mitigated.toLowerCase().includes('challenge') && server.toLowerCase().includes('cloudflare');
}

/** Kotlin `private fun hostOf(url: String): String?`. */
export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.host.toLowerCase();
    return null;
  } catch {
    return null;
  }
}

/** 仅允许公网主机（拒绝环回/私有/保留地址解析结果）。 */
export function isPublicHost(host: string, addresses: string[]): boolean {
  if (host.trim() === '' || host === 'localhost') return false;
  try {
    return addresses.every((addr) => {
      if (isPrivateAddress(addr)) return false;
      // IPv6 unique-local (fc00::/7) 无内建标记，手动判首字节
      const bare = addr.toLowerCase().replace(/^\[|\]$/g, '');
      if (bare.includes(':')) {
        const first = Number.parseInt(bare.split(':')[0]?.slice(0, 2) ?? '', 16);
        if (Number.isFinite(first) && (first & 0xfe) === 0xfc) return false;
      }
      return true;
    });
  } catch {
    // Kotlin `InetAddress.getAllByName` throwing UnknownHostException → false.
    return false;
  }
}

/** Kotlin `private fun clearanceOf(cookieHeader: String?): String?`. */
export function clearanceOf(cookieHeader: string | null): string | null {
  if (cookieHeader === null) return null;
  for (const item of cookieHeader.split(';').map((it) => it.trim())) {
    if (item.startsWith('cf_clearance=')) return item;
  }
  return null;
}

/**
 * 无头求解并把 Cookie 同步进 JS 源共享存储。阻塞调用线程，最多 [timeoutMs]。
 * @return true 表示拿到了新的 cf_clearance（或本次求解期间已由并发调用完成）。
 */
export async function solveAndSync(
  deps: CfSolverDeps,
  url: string,
  userAgent: string,
  extraHeaders: Record<string, string> = {},
  timeoutMs: number = SOLVE_TIMEOUT_MS,
): Promise<boolean> {
  const host = hostOf(url);
  if (host === null) return false;
  // Kotlin `InetAddress.getAllByName(host)` inside `try`; a DNS failure → false.
  const addresses = await deps.resolveHost(host).catch(() => null);
  if (addresses === null || !isPublicHost(host, addresses)) {
    deps.log('w', `refuse to solve non-public host: ${host}`);
    return false;
  }
  const lastFail = lastFailAt.get(host);
  if (lastFail !== undefined && deps.now() - lastFail < FAIL_RETRY_INTERVAL_MS) return false;
  const existing = inflight.get(host);
  if (existing !== undefined) {
    // 其它线程已在解同一个 host：等待其结果，不重复起 WebView。
    return sharedWait(deps, existing, timeoutMs);
  }
  const pending = newPending();
  inflight.set(host, pending);
  try {
    const ok = await runSolver(deps, url, userAgent, extraHeaders, timeoutMs, pending);
    pending.success = ok;
    return ok;
  } finally {
    inflight.delete(host);
  }
}

/** Kotlin `private fun sharedWait(pending: Pending, timeoutMs: Long): Boolean`. */
async function sharedWait(deps: CfSolverDeps, pending: Pending, timeoutMs: number): Promise<boolean> {
  await raceTimeout(deps, pending, timeoutMs);
  return pending.success;
}

/** Kotlin `pending.latch.await(timeoutMs, TimeUnit.MILLISECONDS)`. */
function raceTimeout(deps: CfSolverDeps, pending: Pending, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    deps.schedule(() => resolve(), timeoutMs);
    void pending.settled.then(() => resolve());
  });
}

/** Kotlin `private fun runSolver(...)`. */
async function runSolver(
  deps: CfSolverDeps,
  url: string,
  userAgent: string,
  extraHeaders: Record<string, string>,
  timeoutMs: number,
  pending: Pending,
): Promise<boolean> {
  const host = hostOf(url);
  if (host === null) return false;
  let finished = false;
  let challengeSeen = false;
  let webview: ReturnType<CfSolverDeps['webviews']['create']> | null = null;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    pending.signal();
  };
  try {
    const cookieManager = deps.webviews.cookies;
    cookieManager.setAcceptCookie(true);
    const oldClearance = clearanceOf(cookieManager.getCookie(url));

    try {
      const wv = deps.webviews.create(url, userAgent);
      webview = wv;
      wv.exposeInterface('easyReaderSolver', {
        interactiveDetected: () => finish(),
      });
      wv.setHandlers({
        onPageFinished: (view, viewUrl) => {
          const current = clearanceOf(cookieManager.getCookie(url));
          if (current !== null && current !== oldClearance) {
            // Cloudflare 解完会自动重载页面并写入新 cf_clearance
            pending.success = true;
            finish();
            return;
          }
          void view.evaluateJavascript(`
addEventListener("message", ({data}) => {
    if (data?.source === "cloudflare-challenge" && data?.event === "interactiveBegin") {
        easyReaderSolver.interactiveDetected();
    }
})
`);
          if (viewUrl === url && current === null && oldClearance === null && !challengeSeen) {
            // Finishing the challenge document does not mean its async
            // verification has finished. Check the page before stopping.
            void view
              .evaluateJavascript(`
Boolean(document.querySelector('script[src*="challenge-platform"],#challenge-running,#challenge-stage') ||
    /Just a moment|Checking your browser/i.test(document.title))
`)
              .then((result) => {
                if (result === 'true') challengeSeen = true;
                else finish();
              });
          }
        },
        onReceivedHttpError: (_view, _errorUrl, isMainFrame, headers) => {
          if (!isMainFrame) return;
          const hit = Object.entries(headers).find(
            ([key]) => key.toLowerCase() === 'cf-mitigated',
          );
          const mitigated = hit?.[1] ?? '';
          if (mitigated.toLowerCase().includes('challenge')) {
            challengeSeen = true;
          } else {
            // 主帧报错且不是挑战页：等不到结果
            finish();
          }
        },
      });
      wv.setSize(1080, 1920);
      // 只带安全的头（对齐 Mihon parseHeaders 的保守做法）
      const safeHeaders = filterSafeHeaders(extraHeaders);
      wv.loadUrl(url, safeHeaders);
      // Some sites set the cookie asynchronously without navigating again.
      const poll = (): void => {
        if (finished) return;
        const current = clearanceOf(cookieManager.getCookie(url));
        if (current !== null && current !== oldClearance) {
          pending.success = true;
          finish();
        } else deps.schedule(poll, 250);
      };
      deps.schedule(poll, 250);
    } catch (e) {
      deps.log('w', `webview solve setup failed: ${messageOf(e)}`);
      finish();
    }

    await raceTimeout(deps, pending, timeoutMs);
    finish();

    try {
      webview?.stopLoading();
      webview?.destroy();
    } catch {
      // Kotlin `catch (_: Exception) {}` around stopLoading/destroy.
    }

    if (pending.success) {
      syncToJsCookieJar(deps, url);
      deps.log('i', `cloudflare solved for ${host}`);
    } else {
      lastFailAt.set(host, deps.now());
      deps.log('w', `cloudflare solve failed for ${host}`);
    }
    return pending.success;
  } finally {
    inflight.delete(host);
  }
}

/** Kotlin `extraHeaders.filterKeys { k -> … && !n.startsWith("proxy-") }`. */
export function filterSafeHeaders(extraHeaders: Record<string, string>): Record<string, string> {
  const blocked = new Set([
    'content-length', 'host', 'cookie', 'cookie2',
    'transfer-encoding', 'upgrade', 'te', 'trailer',
  ]);
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(extraHeaders)) {
    const n = k.toLowerCase();
    if (blocked.has(n) || n.startsWith('proxy-')) continue;
    safe[k] = v;
  }
  return safe;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 把 android.webkit.CookieManager 的 Cookie 合并进 JS 源共享存储（ck_<host>，"k=v; ..."）。 */
export function syncToJsCookieJar(deps: CfSolverDeps, url: string): void {
  try {
    const host = hostOf(url);
    if (host === null) return;
    const raw = deps.webviews.cookies.getCookie(url);
    if (raw === null) return;
    const pairs = raw
      .split(';')
      .map((it) => it.trim())
      .filter((it) => it.includes('='));
    if (pairs.length === 0) return;
    deps.saveCookiePairs(host, pairs);
  } catch (e) {
    deps.log('w', `cookie sync failed: ${messageOf(e)}`);
  }
}

/** Kotlin `object CfWebViewSolver` call-site namespace. */
export const CfWebViewSolver = {
  isChallengeResponse,
  solveAndSync,
  syncToJsCookieJar,
  hostOf,
  isPublicHost,
  clearanceOf,
  filterSafeHeaders,
  SOLVE_TIMEOUT_MS,
  FAIL_RETRY_INTERVAL_MS,
  TAG,
};
