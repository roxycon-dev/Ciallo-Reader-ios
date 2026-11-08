/**
 * comicLoadSupport.ts — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicLoadSupport.kt`（54 行 / 非空 49 行）。
 *
 * 纯逻辑模块（无 Compose 依赖）→ 放在 `src/core`，可被单测直接引用。
 *
 * Kotlin 行号 → TS 对照：
 *   L1        package/import（MutableStateFlow / StateFlow / Mutex / MessageDigest）→ 适配见下
 *   L8        KDoc「Includes authorization/referer in cache identity…」→ 保留
 *   L9-L24    internal fun comicRemoteCacheKey(url, headers, referer)
 *             → 拆成同步 `comicRemoteCacheIdentity`（归一化+拼接，逐行等价）
 *               + 异步 `comicRemoteCacheKey`（SHA-256 hex，见适配说明）
 *   L26-L28   internal data class ComicTransferProgress(bytes=0, total=-1) + fraction
 *             → 同名接口 + comicTransferProgress() 工厂 + comicTransferFraction()
 *   L30-L41   internal object ComicTransfers（LinkedHashMap(128,.75f,true) LRU + StateFlow）
 *             → 同名对象：Map 保序 + 128 上限 + 命中即移到末尾（accessOrder=true），
 *               StateFlow → 订阅式 `ComicTransferHandle`（value + subscribe）
 *   L43       KDoc「Waiters keep their lock registered…」→ 保留
 *   L44-L53   internal class ComicLoadLocks（Entry{mutex, users} + acquire/release）
 *             → 同名类：Mutex → promise 链（`withLock` 串行化），users 引用计数不变
 *
 * 跳过说明：
 *   · `java.security.MessageDigest`（L18）在 Web 端只有异步 `crypto.subtle.digest`，
 *     没有同步等价物。因此**同步**入口改为返回未摘要的 identity 字符串
 *     （`comicRemoteCacheIdentity`，字符串拼接部分与 Kotlin 逐字节一致），
 *     摘要入口 `comicRemoteCacheKey` 改为 `async`，用 Web Crypto SHA-256 产出同样的
 *     小写 hex。identity 本身可单测，摘要由浏览器保证与 MessageDigest 同算法同输出。
 *   · `kotlinx.coroutines.flow.StateFlow`（L32-L33）无 DOM/React 等价物：
 *     用「取值 + subscribe 回调」的最小可观察对象表达，订阅者收到的仍是同一进度快照。
 *   · `kotlinx.coroutines.sync.Mutex`（L45）：用 promise 链实现互斥，
 *     `acquire(key)` 返回的句柄带 `withLock(fn)`，语义等价于 `mutex.withLock { … }`。
 *   · `@Synchronized`（L33/L34/L47/L51）→ 单线程 JS 事件循环下无并发写，无需显式锁；
 *     但保留 LRU 顺序维护逻辑（这是有语义的，见 L36）。
 *
 * 适配说明：
 *   · Kotlin `Long` → `number`；`Float` → `number`；`coerceIn(0f,1f)` → Math.min/max。
 *   · `headers.entries.associate { it.key.lowercase() to it.value }.toMutableMap()`
 *     → `Map` + `toLowerCase()`（注意：不能用 `toLocaleLowerCase`，土耳其语 I 问题）。
 *   · `normalized.toSortedMap()` → 键按 UTF-16 码元升序排序（Kotlin String.compareTo 同序）。
 *   · `digest.forEach { b -> … }` hex 编码逐字节保留 `v shr 4` / `v and 15` 语义。
 */

/** Includes authorization/referer in cache identity; never exposes header values in keys. */
export function comicRemoteCacheIdentity(
  url: string,
  headers: Readonly<Record<string, string>>,
  referer: string | null = null,
): string {
  // ── Kotlin L10 ──
  const normalized = new Map<string, string>()
  for (const [k, v] of Object.entries(headers)) normalized.set(k.toLowerCase(), v)
  // ── Kotlin L11 ──
  if (referer !== null && referer.trim() !== '') normalized.set('referer', referer)

  // ── Kotlin L12-L17：identity 拼接，长度前缀保证无歧义 ──
  const parts: string[] = []
  parts.push(`${url.length}:${url}`)
  const sortedKeys = [...normalized.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  for (const k of sortedKeys) {
    const v = normalized.get(k) as string
    parts.push(`${k.length}:${k}${v.length}:${v}`)
  }
  return parts.join('')
}

const HEX_DIGITS = '0123456789abcdef'

/**
 * SHA-256(identity) 的小写 hex。Kotlin 侧是同步 MessageDigest，Web 端只有异步
 * `crypto.subtle.digest` —— 本函数因此返回 Promise，调用方 await 即可（值与 Kotlin 一致）。
 */
export async function comicRemoteCacheKey(
  url: string,
  headers: Readonly<Record<string, string>>,
  referer: string | null = null,
): Promise<string> {
  const identity = comicRemoteCacheIdentity(url, headers, referer)
  const bytes = new TextEncoder().encode(identity)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let out = ''
  // ── Kotlin L20-L23：`buildString(64) { digest.forEach { … } }` 逐字节 hex ──
  for (const b of digest) {
    const v = b & 255
    out += HEX_DIGITS[v >> 4]
    out += HEX_DIGITS[v & 15]
  }
  return out
}

//
// ── L26-L28  ComicTransferProgress
//

export interface ComicTransferProgress {
  readonly bytes: number
  readonly total: number
}

/** `internal data class ComicTransferProgress(val bytes: Long = 0, val total: Long = -1)`（L26）。 */
export function comicTransferProgress(bytes = 0, total = -1): ComicTransferProgress {
  return { bytes, total }
}

/** `val fraction: Float? get() = if (total > 0) (bytes/total).coerceIn(0f,1f) else null`（L27）。 */
export function comicTransferFraction(progress: ComicTransferProgress): number | null {
  return progress.total > 0 ? Math.min(Math.max(progress.bytes / progress.total, 0), 1) : null
}

/** 订阅式进度句柄（对应 Kotlin 的 `StateFlow<ComicTransferProgress>`）。 */
export interface ComicTransferHandle {
  /** 当前值（StateFlow 的 `.value`） */
  value(): ComicTransferProgress
  /** 订阅变化，返回退订函数 */
  subscribe(listener: (progress: ComicTransferProgress) => void): () => void
}

/** Bounded telemetry only: no image bytes or credentials are retained. */
export const ComicTransfers = {
  /** LinkedHashMap<String, StateFlow<ComicTransferProgress>>(128, .75f, true) 的等价物。
   *  `true` = accessOrder：每次读取把条目移到末尾，于是溢出时淘汰最久未访问的那条。 */
  states: new Map<string, { value: ComicTransferProgress; listeners: Set<(p: ComicTransferProgress) => void> }>(),

  /** `fun state(url: String): StateFlow<ComicTransferProgress> = mutable(url)`（L33）。 */
  state(url: string): ComicTransferHandle {
    const { state: entry } = ComicTransfers.mutable(url)
    return {
      value: () => entry.value,
      subscribe: (listener) => {
        entry.listeners.add(listener)
        return () => {
          entry.listeners.delete(listener)
        }
      },
    }
  },

  /** `@Synchronized private fun mutable(url)`（L34-L39）。 */
  mutable(url: string): { state: { value: ComicTransferProgress; listeners: Set<(p: ComicTransferProgress) => void> } } {
    const existing = ComicTransfers.states.get(url)
    if (existing !== undefined) {
      // accessOrder = true：命中即移到 Map 末尾（最近使用）
      ComicTransfers.states.delete(url)
      ComicTransfers.states.set(url, existing)
      return { state: existing }
    }
    if (ComicTransfers.states.size >= 128) {
      const oldest = ComicTransfers.states.keys().next()
      if (oldest.done !== true) ComicTransfers.states.delete(oldest.value)
    }
    const created = { value: comicTransferProgress(), listeners: new Set<(p: ComicTransferProgress) => void>() }
    ComicTransfers.states.set(url, created)
    return { state: created }
  },

  /** `fun update(url: String, bytes: Long, total: Long)`（L40）。 */
  update(url: string, bytes: number, total: number): void {
    const { state } = ComicTransfers.mutable(url)
    const next = comicTransferProgress(bytes, total)
    state.value = next
    state.listeners.forEach((listener) => {
      listener(next)
    })
  },
}

//
// ── L44-L53  ComicLoadLocks
//

/** Kotlin `Mutex` 的最小等价物：promise 链保证临界区串行。 */
export interface ComicMutex {
  /** 等价于 `mutex.withLock { … }` */
  withLock<T>(block: () => T | Promise<T>): Promise<T>
}

function makeMutex(): ComicMutex {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    withLock<T>(block: () => T | Promise<T>): Promise<T> {
      const run = tail.then(block, block)
      // 无论成功失败都把链推下去，避免异常卡死后续等待者
      tail = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    },
  }
}

/** Waiters keep their lock registered until the last caller leaves, including cancellation. */
export class ComicLoadLocks {
  /** `private class Entry(val mutex: Mutex = Mutex(), var users: Int = 0)`（L45）。 */
  private entries = new Map<string, { mutex: ComicMutex; users: number }>()

  /** `fun acquire(key: String): Mutex = entries.getOrPut(key) { Entry() }.let { it.users++; it.mutex }`（L47-L50）。 */
  acquire(key: string): ComicMutex {
    let entry = this.entries.get(key)
    if (entry === undefined) {
      entry = { mutex: makeMutex(), users: 0 }
      this.entries.set(key, entry)
    }
    entry.users += 1
    return entry.mutex
  }

  /** `fun release(key: String) { entries[key]?.let { if (--it.users == 0) entries.remove(key) } }`（L51-L53）。 */
  release(key: string): void {
    const entry = this.entries.get(key)
    if (entry !== undefined) {
      entry.users -= 1
      if (entry.users === 0) this.entries.delete(key)
    }
  }

  /** 仅供单测观察内部状态（Kotlin 无对应物，测试辅助）。 */
  entryCount(): number {
    return this.entries.size
  }

  /** 仅供单测观察 users 计数（Kotlin 无对应物，测试辅助）。 */
  usersOf(key: string): number {
    return this.entries.get(key)?.users ?? 0
  }
}
