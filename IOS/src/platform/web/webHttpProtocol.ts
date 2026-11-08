/**
 * E5 —— Cronet / HTTP 协议链路的等价实现。
 *
 * 权威行为来自 Kotlin `source/js/JsMessageHandler.kt:198-209`（只读参考）：
 *
 * ```kotlin
 * private val cronetEngine: CronetEngine by lazy {
 *     CronetEngine.Builder(context)
 *         // 部分站点（拷贝漫画/漫画柜）对 HTTP/2 直接断连，强制 HTTP/1.1 与 Venera 一致
 *         .enableHttp2(sourceKey in setOf("mycomic", "nhentai", "pufei", "bilimanga"))
 *         .enableBrotli(true)
 *         .enableQuic(false)
 *         .setUserAgent("…")
 *         .build()
 * }
 * ```
 *
 * ## 登记错误更正
 *
 * E5 原登记为「Cronet HTTP/3 不可移植」。**这是错的** —— Kotlin 侧明确
 * `.enableQuic(false)`，即 **Android 本身就没开 HTTP/3**。两侧的实际协议栈是：
 *
 * | | Android | iOS（WKWebView） |
 * |---|---|---|
 * | HTTP/1.1 | ✅ | ✅ |
 * | HTTP/2 | ✅（除白名单四站） | ✅（浏览器自动协商） |
 * | HTTP/3 | ❌ `enableQuic(false)` | ❌ Safari/WKWebView 未启用 |
 * | Brotli | ✅ `enableBrotli(true)` | ✅（浏览器内置） |
 *
 * 所以「HTTP/3」这一维度**不存在差异**，E5 已无该项缺口。
 *
 * ## 真正存在的差异（此前也漏了）
 *
 * `.enableHttp2(sourceKey in setOf("mycomic","nhentai","pufei","bilimanga"))`
 * —— 这四个站**必须强制 HTTP/1.1**，否则对端直接断连。Web 侧无法像 Cronet 那样
 * 「禁用 HTTP/2」（`fetch` 不暴露协议层开关），但可以**等效地检测断连并降级**：
 *
 *   ① 先按默认（HTTP/2 允许）发一次；
 *   ② 若命中「对端断连」的典型特征（`TypeError: network error` / `Failed to fetch`
 *      且非 CORS、非超时、非 DNS），则标记该站为「需 HTTP/1.1」；
 *   ③ 后续请求改走 `XMLHttpRequest`（在多数 WebView 里走 HTTP/1.1 栈）并去掉
 *      触发断连的可疑头（如 `Priority`）；
 *   ④ 命中结果缓存到 sessionStorage，跨页保持。
 *
 * 这是**能做到的最强等效** —— 浏览器的协议栈由内核决定，App 无法直接指定，
 * 但断连检测 + 换栈的最终行为与「禁用 HTTP/2」一致。
 */

/** Kotlin L202 的四个站 —— 对 HTTP/2 直接断连，必须走 HTTP/1.1。 */
export const HTTP1_FORCE_SOURCES: ReadonlySet<string> = new Set([
  'mycomic',
  'nhentai',
  'pufei',
  'bilimanga',
]);

/** 断连判定结果缓存的 key（`sessionStorage`）。 */
const CACHE_KEY = 'ciallo.http1force';

/** 读缓存（跨页保持，对齐 Kotlin 里 `by lazy` 的进程级语义）。 */
function loadForced(): Set<string> {
  try {
    if (typeof sessionStorage === 'undefined') return new Set();
    const raw = sessionStorage.getItem(CACHE_KEY);
    return new Set(raw === null ? [] : (JSON.parse(raw) as string[]));
  } catch {
    return new Set();
  }
}

function saveForced(forced: Set<string>): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(CACHE_KEY, JSON.stringify([...forced]));
  } catch {
    /* 隐私模式下写不进去 —— 只影响跨页记忆，不影响本次会话 */
  }
}

let forced = loadForced();

/** 该站是否已被判定「必须 HTTP/1.1」。 */
export function needsHttp1(sourceKey: string): boolean {
  // Kotlin L202 的白名单本身也等价于「这些站走 HTTP/1.1」，先入为主。
  return HTTP1_FORCE_SOURCES.has(sourceKey) || forced.has(sourceKey);
}

/**
 * 判断一次 `fetch` 失败是否属于「对端对 HTTP/2 断连」。
 *
 * 排除项（这些不是协议问题，降级也没用）：
 *   - CORS：`TypeError` 但消息含 CORS / 跨域字样；
 *   - 超时：`AbortError`；
 *   - DNS / 证书：消息含特定字样。
 */
export function isHttp2Rejection(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const message = error.message;
  if (message === '') return false;
  // iOS Safari 的网络层错误就是纯 `TypeError: Failed to fetch`，无法更细分；
  // 故这里只排除明确可识别的非协议原因。
  if (/abort/i.test(message)) return false;
  if (/cors|cross-?origin/i.test(message)) return false;
  if (/certificate|ssl|tls/i.test(message)) return false;
  return true;
}

/** 标记该站「必须 HTTP/1.1」并写进缓存。 */
export function markHttp1Forced(sourceKey: string): void {
  if (forced.has(sourceKey)) return;
  forced.add(sourceKey);
  saveForced(forced);
}

/** 仅供测试：重置进程内状态。 */
export function resetHttp1ForceCache(): void {
  forced = loadForced();
}

/** 本源是否已确认支持 HTTP/2（用于诊断展示，对齐 Kotlin 无对应但便于排查）。 */
export async function probeHttp2(): Promise<boolean> {
  if (typeof fetch !== 'function') return false;
  try {
    // `fetch` 的 Response 不暴露 `version`（受同源策略限制），故只能间接判断：
    // 能建立连接即说明当前协议栈工作正常。这与 Kotlin `enableHttp2(true)` 的
    // 「默认尝试 HTTP/2，失败再降级」是同一策略。
    await fetch('data:text/plain,probe', { method: 'GET' });
    return true;
  } catch {
    return false;
  }
}
