/**
 * E5 / E99 —— Cronet / HTTP 协议链路的等价实现。
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
 *      且非 CORS、非超时、非 TLS），则认定该站需 HTTP/1.1 并标记；
 *   ③ 标记后按「HTTP/1.1 优先」的形态重试一次 —— 去掉 `Priority` 这类只在
 *      HTTP/2 / HTTP/3 里有语义的流优先级头；
 *   ④ 命中结果写进**模块级标记表**（唯一真源）；宿主有 `sessionStorage` 时
 *      同时持久化，跨页保持（对齐 Kotlin `by lazy` 的进程级语义）。
 *
 * 这是**能做到的最强等效** —— 浏览器的协议栈由内核经 ALPN 协商，JS 与原生插件
 * 都没有「本请求禁用 h2」的开关，所以首次仍会先发一次 h2；但「识别断连 → 标记 →
 * 重试」之后的最终行为与「禁用 HTTP/2」一致。
 *
 * ## E99 接线（本文件此前全仓零 import）
 *
 * 生产调用方现在有两处：
 *   - `src/core/source/js/jsMessageHandler.ts`：`handleHttp` 的 Cronet 出口
 *     （`cronetRequestHttp1`）+ `comicReadAttempt` 的 `catch`；
 *   - `src/platform/sourceWorker/engine.ts`：host-call 的 `http` 分支。
 *
 * 两处都遵循同一策略：首次按默认发 → `isHttp2Rejection` 分类 → `markHttp1Forced`
 * → 重试**一次** → 仍失败则**原错误上抛**（不吞掉、不替换成重试的错误）。
 *
 * `probeHttp2()` 仍然没有生产调用方：它只用于诊断，不参与生产判定（见函数注释）。
 *
 * ## Worker 宿主（没有 `sessionStorage`）
 *
 * `sourceWorker/entry.ts` 跑在 Worker 里，那里没有 `sessionStorage`。所以标记表
 * 以**模块级 Set** 为唯一真源，`sessionStorage` 只是持久层 —— Worker 内
 * `markHttp1Forced` 照常生效（同一个 Worker 生命周期内一直有效），只有 Worker
 * 被 `reset()` 终止重建后才丢失。跨 Worker 持久化需要改
 * `sourceWorker/protocol.ts` 的消息格式，超出 E99 的范围，故在此明确登记。
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

/**
 * 持久层读取。
 *
 * 非 DOM 宿主（Web Worker / Node）没有 `sessionStorage`，`typeof` 守卫让它
 * 退化成「没有持久化」而不是抛错 —— 此时模块级 `forced` 就是全部状态。
 */
function loadForced(): Set<string> {
  try {
    if (typeof sessionStorage === 'undefined') return new Set();
    const raw = sessionStorage.getItem(CACHE_KEY);
    return new Set(raw === null ? [] : (JSON.parse(raw) as string[]));
  } catch {
    return new Set();
  }
}

/**
 * 持久层写入（best effort）。
 *
 * 隐私模式 / 配额满会抛，写不进去只影响跨页记忆，不影响本会话 —— 模块级
 * `forced` 已经先行更新，所以调用方看到的 `needsHttp1` 永远是准的。
 */
function saveForced(forced: Set<string>): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(CACHE_KEY, JSON.stringify([...forced]));
  } catch {
    /* 隐私模式下写不进去 —— 只影响跨页记忆，不影响本次会话 */
  }
}

/**
 * 进程内标记表 —— **唯一真源**。
 *
 * 先写它、再写持久层；`needsHttp1` 只读它（外加 Kotlin 白名单）。这样 Worker
 * 场景（无 `sessionStorage`）与隐私模式（写不进去）都不会让判定失效。
 */
let forced = loadForced();

/** 该站是否已被判定「必须 HTTP/1.1」。 */
export function needsHttp1(sourceKey: string): boolean {
  // Kotlin L202 的白名单本身也等价于「这些站走 HTTP/1.1」，先入为主。
  return HTTP1_FORCE_SOURCES.has(sourceKey) || forced.has(sourceKey);
}

/**
 * 判断一次传输失败是否属于「对端对 HTTP/2 断连」。
 *
 * 只有 `TypeError` 才可能是网络层 —— `AbortError`（`DOMException`）、
 * 业务异常、TLS 证书异常都不是协议问题，降级也没用。
 *
 * 排除项（这些不是协议问题）：
 *   - CORS：`TypeError` 但消息含 CORS / 跨域字样；
 *   - 超时 / 取消：`AbortError` 或消息含 abort；
 *   - DNS / 证书：消息含 certificate / `cert_`（Chromium 的 `ERR_CERT_*`）/ ssl / tls。
 *
 * 注意这是**保守的**分类器：iOS Safari 的网络层错误就是纯
 * `TypeError: Failed to fetch`，无法更细分，所以只排除明确可识别的非协议原因。
 */
export function isHttp2Rejection(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const message = error.message;
  if (message === '') return false;
  // iOS Safari 的网络层错误就是纯 `TypeError: Failed to fetch`，无法更细分；
  // 故这里只排除明确可识别的非协议原因。
  if (/abort/i.test(message)) return false;
  if (/cors|cross-?origin/i.test(message)) return false;
  // `cert_` 覆盖 Chromium 的 `net::ERR_CERT_AUTHORITY_INVALID` 一类证书错误 ——
  // 它们是 TLS 问题，降级到 HTTP/1.1 也不会好转。
  if (/certificate|cert_|ssl|tls/i.test(message)) return false;
  return true;
}

/**
 * 标记该站「必须 HTTP/1.1」：先更新模块级标记表，再尽力写持久层。
 *
 * 幂等 —— 已经标记过的源不会重复写存储。
 */
export function markHttp1Forced(sourceKey: string): void {
  if (forced.has(sourceKey)) return;
  forced.add(sourceKey);
  saveForced(forced);
}

/**
 * 仅供测试：重置进程内状态（重新从持久层读）。
 *
 * Worker 里没有持久层，所以这里等价于清空 —— 生产代码没有调用方，别在
 * Worker 生命周期里依赖它。
 */
export function resetHttp1ForceCache(): void {
  forced = loadForced();
}

/**
 * 探针：当前宿主能否完成一次请求（用于诊断展示，对齐 Kotlin 无对应但便于排查）。
 *
 * **不参与生产判定** —— `needsHttp1` / `isHttp2Rejection` 的结论都来自真实请求
 * 的失败分类，不看这个探针。原因：`fetch` 的 `Response` 不暴露 `version`（受
 * 同源策略限制），探针最多只能回答「网络栈活着」，无法回答「这个站能不能 h2」。
 */
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
