/**
 * mangaJaNai.ts  ←  novel-reader/app/src/main/java/com/example/ui/comic/MangaJaNai.kt
 *
 * Kotlin source: 261 lines / 243 non-blank（文件以 L261 `}` 结束，末尾带换行）。
 *
 * ┌─ Kotlin → TS 行号映射（逐段，TS 侧为本文件实际行号）───────────────────────────┐
 * │ Kotlin   │ TS                                               │ 说明                │
 * │ L1-21    │ L1-76   （文件头 + import 段）                     │ package/imports     │
 * │ L23      │ L129-134  `class MangaJaNaiBudgetExceeded`         │ IOException 子类    │
 * │ L25-27   │ L543-550  object 头注释                            │ doc 注释逐字保留    │
 * │ L29-34   │ L322-360  六个常量（MODEL_BYTES/SHA256/TILE/HALO/  │ 数值逐字核对        │
 * │          │           SIDE/DEADLINE_NS）                        │                     │
 * │ L35      │ L363-413  `internal val lock`                      │ 可重入页锁          │
 * │ L36-38   │ L559-591  context / _status / status               │ 宿主 + 状态流       │
 * │ L39-40   │ L593-607  silent ThreadLocal / isSilent            │ 静默作用域          │
 * │ L41-52   │ L560-580 + L652-668  runtime / tileCache / stamp / │ 代际 + 空闲释放     │
 * │          │           generation / idleRelease / releaseWhenIdle│                    │
 * │ L54-59   │ L597-613  withSilentStatus / report                │ 静默上报            │
 * │ L61-73   │ L615-635  configure(context)                       │ 组件回调注册        │
 * │ L75-79   │ L637-650  release()                                │ 清会话 + 缓存       │
 * │ L81-89   │ L652-668  releaseWhenIdle()                        │ 60s 空闲释放        │
 * │ L91-93   │ L670-672  checkCancelled()                         │ InterruptedException│
 * │ L95-108  │ L676-699  verify(file)                             │ 长度 + SHA-256      │
 * │ L110-131 │ L701-751  model()                                  │ 资产落盘 + 校验     │
 * │ L133-136 │ L529-540 + L753-756  outputSize(w, h)              │ 缩放倍率            │
 * │ L138-260 │ L758-964  enhance(src, strength)                    │ 全量管线            │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ── 与 `./mangaJaNaiMobile` / `./mangaJaNaiTiles`（既有部分实现）的关系 ────────────
 * 复用、不重写：
 *   • `mangaMobileInputSize`（MangaJaNaiMobile.kt L12-23）—— `enhance` 的 1 处调用点。
 *   • `combineMangaJaNaiDetail`（MangaJaNaiMobile.kt L28-74）—— `enhance` 的 1 处调用点。
 *     本次给该函数补了两个**取消缝**参数（`isCancelled` / `cancelled`）并把 band 重采样
 *     改成 `FILTER_BITMAP_FLAG` 的双线性等价（见该文件头部 ADAPTATIONS）；签名向后兼容。
 *   • `MangaJaNaiTileCache`（MangaJaNaiTiles.kt L9-39）—— `capacity = 1`，与 Kotlin 同。
 *   • `readMangaJaNaiTile`（MangaJaNaiTiles.kt L42-63）—— 本文件用 `readTileFromPix`
 *     把 `Bitmap.getPixels` 换成 `PixImage` 行拷贝后直接调用它。
 * 新增（Kotlin 里由 `android.*` 直接提供、Web 侧必须注入的部分）：宿主端口 `MangaJaNaiHost`
 * 及其子端口、可重入页锁、状态流、清理队列、i18n 文案拼接。**没有替换任何既有实现**。
 *
 * ── 未移植项（GPU 部分单独列明）────────────────────────────────────────────────────
 * 1. **GPU 推理本体**：`MangaJaNaiGpu.kt`（12 行）是 `System.loadLibrary("mangajanai")`
 *    + 4 个 `external fun`（create/run/save/destroy）。本文件不持有任何 GPU 句柄；
 *    GPU 只由 `./mangaJaNaiFullRuntime` 通过 `MangaJaNaiGpuPort` 使用。Web 端
 *    `gpu === null` 时走 Kotlin 缺失 `.so`（`UnsatisfiedLinkError`）的同一分支：
 *    `create` 抛 `MangaJaNaiLinkageError` → 记 warn → `close()` → **CPU FP32 重载**，
 *    并把 `gpu=false` 写回 prefs。**绝不会静默返回原图**（见 `mangaJaNaiFullRuntime.prepare`）。
 * 2. `android.content.ComponentCallbacks2`：`onLowMemory` / `onTrimMemory(level)` 由
 *    `MangaJaNaiMemoryPort` 注入；`TRIM_MEMORY_RUNNING_LOW = 10` 的阈值逐字保留。
 * 3. `ScheduledThreadPoolExecutor` 的两个具名线程（`mangajanai-release` /
 *    `mangajanai-deadline`）在同步端口里没有线程概念：空闲释放改用
 *    `MangaJaNaiSchedulerPort.schedule`，看门狗（`setTerminate`）同样由
 *    `scheduler.schedule` 投递，清理回调改用文件内 `MangaJaNaiCleanupQueue` 串行执行。
 * 4. `OutOfMemoryError`：JS 侧由 `MangaJaNaiOutOfMemoryError`（宿主/会话抛出）或
 *    `RangeError`（定长 TypedArray 分配失败）代表，二者都进 Kotlin L246-250 分支。
 * 5. `android.util.Log.i("MangaJaNai", "aiComplete=…")` 逐字保留，经 `MangaJaNaiLogPort`。
 * 6. `OrtEnvironment` / `OnnxTensor` 的**创建**在 `./mangaJaNaiRuntime`（注入端口）；
 *    本文件只把两块 `Float32Array`（`1×3×176×176` / `1×3×352×352`）交给它。
 *
 * ── 循环依赖（唯一一处）───────────────────────────────────────────────────────────
 * 本文件 ↔ `./mangaJaNaiRuntime`：彼此只在函数体内引用对方绑定，顶层只声明 class 与常量。
 * 与 `anime4KCnn.ts` ↔ `comicImagePipeline.ts` 的既有处理一致。
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { AppLanguage, getAppLanguage, tr } from '../i18n/locale'
import { clamp, roundToInt, type PixImage } from './comicPixOps'
import { combineMangaJaNaiDetail, mangaMobileInputSize } from './mangaJaNaiMobile'
import { MangaJaNaiTileCache, readMangaJaNaiTile } from './mangaJaNaiTiles'
import { MangaJaNaiRunOptions, MangaJaNaiRuntime } from './mangaJaNaiRuntime'
import type {
  MangaJaNaiLogPort,
  MangaJaNaiSessionFactory,
} from './mangaJaNaiRuntime'
import type { MangaJaNaiGpuPort } from './mangaJaNaiFullRuntime'

/* ══════════════════════ 文案（`com.example.i18n.tr` / `enhanceProgress` / …） ══════════ */

/**
 * Strings.kt L3089-3090 `fun enhanceProgress(percent: Int)`：
 * 中文「增强 42%」/ 英文「Enhancing 42%」。
 */
export function mangaJaNaiEnhanceProgress(percent: number): string {
  return getAppLanguage() === AppLanguage.EN ? `Enhancing ${percent}%` : `增强 ${percent}%`
}

/**
 * Strings.kt L3092-3093 `fun fullEnhanceProgress(percent: Int)`：
 * 中文「完整增强 42%」/ 英文「Full enhance 42%」。
 */
export function mangaJaNaiFullEnhanceProgress(percent: number): string {
  return getAppLanguage() === AppLanguage.EN ? `Full enhance ${percent}%` : `完整增强 ${percent}%`
}

/**
 * Strings.kt L3080-3082 `fun modelDownloadFailed(code: Int)`：
 * 中文「完整模型下载失败：HTTP 404」/ 英文「Model download failed: HTTP 404」。
 */
export function mangaJaNaiModelDownloadFailed(code: number): string {
  return getAppLanguage() === AppLanguage.EN
    ? `Model download failed: HTTP ${code}`
    : `完整模型下载失败：HTTP ${code}`
}

/**
 * Strings.kt L3085-3086 `fun modelSizeMb(mb: Long)`：
 * 中文「完整模型 42 MB」/ 英文「Full model 42 MB」。
 */
export function mangaJaNaiModelSizeMb(mb: number): string {
  return getAppLanguage() === AppLanguage.EN ? `Full model ${mb} MB` : `完整模型 ${mb} MB`
}

/* ══════════════════════ 错误类型（Kotlin 异常层级的 TS 等价物） ══════════════════════ */

/** `java.io.IOException`。全家族里所有「可读失败信息」都走它。 */
export class MangaJaNaiIoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MangaJaNaiIoError'
  }
}

/**
 * Kotlin L23 `internal class MangaJaNaiBudgetExceeded : IOException(tr("增强超时，已保留原图"))`。
 * 与 Kotlin 一致地**继承 IOException**，所以 `mangaJaNaiFull.model()` 的
 * `catch (IOException)` 会同时接住它。
 */
export class MangaJaNaiBudgetExceededError extends MangaJaNaiIoError {
  constructor() {
    super(tr('增强超时，已保留原图'))
    this.name = 'MangaJaNaiBudgetExceededError'
  }
}

/** `java.lang.InterruptedException("MangaJaNai cancelled")` —— 消息逐字保留。 */
export class MangaJaNaiCancelledError extends Error {
  constructor() {
    super('MangaJaNai cancelled')
    this.name = 'MangaJaNaiCancelledError'
  }
}

/**
 * `java.lang.LinkageError`：原生库/会话**装不上**（Kotlin 侧是
 * `System.loadLibrary` / JNI 解析失败）。它与「跑一半失败」不同：整条增强不可用。
 */
export class MangaJaNaiLinkageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MangaJaNaiLinkageError'
  }
}

/** `java.lang.OutOfMemoryError`：宿主会话或原生桥接在分配失败时抛它。 */
export class MangaJaNaiOutOfMemoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MangaJaNaiOutOfMemoryError'
  }
}

/* ══════════════════════ 宿主端口（`android.*` / `java.*` 的注入等价物） ═════════════ */

/** `java.io.InputStream`（`read` 返回 -1 表示 EOF）。 */
export interface MangaJaNaiByteReader {
  read(target: Uint8Array): number
  close(): void
}

/** `java.io.OutputStream`。 */
export interface MangaJaNaiByteWriter {
  write(source: Uint8Array, offset: number, length: number): void
  close(): void
}

/** `java.util.zip.ZipEntry`（只用到 name / isDirectory）。 */
export interface MangaJaNaiZipEntry {
  readonly name: string
  readonly isDirectory: boolean
}

/** `java.util.zip.ZipInputStream`：逐条目流式读取，`read` 返回 -1 表示本条目结束。 */
export interface MangaJaNaiZipReader {
  nextEntry(): MangaJaNaiZipEntry | null
  read(target: Uint8Array): number
  closeEntry(): void
  close(): void
}

/**
 * `java.io.File` + `Context.filesDir` / `cacheDir` + `AssetManager.open` + `ZipInputStream`。
 * 路径一律是宿主的绝对路径字符串（Kotlin `File.absolutePath`）。
 */
export interface MangaJaNaiFilePort {
  readonly filesDir: string
  readonly cacheDir: string
  /** `File(parent, child)`。 */
  join(parent: string, child: string): string
  /** `File.length()` */
  length(path: string): number
  /** `File.lastModified()`（毫秒） */
  lastModified(path: string): number
  /** `File.exists()` */
  exists(path: string): boolean
  /** `File.mkdirs()` */
  mkdirs(path: string): void
  /** `File.delete()` */
  delete(path: string): boolean
  /** `File.renameTo(other)` */
  rename(from: string, to: string): boolean
  /** `file.inputStream().buffered()` */
  openRead(path: string): MangaJaNaiByteReader
  /** `file.outputStream()` */
  openWrite(path: string): MangaJaNaiByteWriter
  /** `app.assets.open(assetPath)`（只读资产，Kotlin `assets.open("comic_enhancement/…")`） */
  openAsset(assetPath: string): MangaJaNaiByteReader
  /** `ZipInputStream(archive.inputStream().buffered())` */
  openZip(path: string): MangaJaNaiZipReader
}

/**
 * `SharedPreferences`。Kotlin 侧同步读写；Web/原生宿主用内存表 + 落盘即可。
 * 三个命名空间：`mangajanai-runtime` / `mangajanai-full-runtime` / `mangajanai-full-download`。
 */
export interface MangaJaNaiPrefsPort {
  getString(key: string): string | null
  getBoolean(key: string, fallback: boolean): boolean
  getLong(key: string, fallback: number): number
  putString(key: string, value: string): void
  putBoolean(key: string, value: boolean): void
  putLong(key: string, value: number): void
  remove(key: string): void
}

/** `context.getSharedPreferences(name, Context.MODE_PRIVATE)`。 */
export type MangaJaNaiPrefsFactory = (name: string) => MangaJaNaiPrefsPort

/** `okhttp3.Call` + `Response`（`execute()` 失败由 `newCall` 抛 `MangaJaNaiIoError`）。 */
export interface MangaJaNaiHttpCall {
  readonly statusCode: number
  readonly isSuccessful: boolean
  /** `response.body`（null = 空响应体，Kotlin L82 `?: throw IOException("完整模型为空")`）。 */
  readonly body: MangaJaNaiByteReader | null
  /** `call.cancel()` */
  cancel(): void
  /** `response.use { … }` */
  close(): void
}

/** `com.example.source.SharedHttpTransport.builder()` + `newCall(request)`。 */
export interface MangaJaNaiHttpPort {
  newCall(url: string): MangaJaNaiHttpCall
}

/** `ScheduledThreadPoolExecutor`（`schedule` / `scheduleAtFixedRate`，返回值 = `cancel(false)`）。 */
export interface MangaJaNaiSchedulerPort {
  schedule(delayMs: number, task: () => void): () => void
  scheduleAtFixedRate(initialDelayMs: number, periodMs: number, task: () => void): () => void
}

/** `Runtime.getRuntime().availableProcessors()` / `maxMemory()` / `Build.FINGERPRINT` / `SDK_INT`。 */
export interface MangaJaNaiDevicePort {
  readonly availableProcessors: number
  readonly maxMemoryBytes: number
  readonly fingerprint: string
  readonly sdkInt: number
}

/** `android.content.ComponentCallbacks2`（内存压力）。 */
export interface MangaJaNaiMemoryPort {
  onLowMemory(listener: () => void): () => void
  onTrimMemory(listener: (level: number) => void): () => void
}

/** `Bitmap.createScaledBitmap(src, w, h, true)` —— 唯一需要的位图原语。 */
export interface MangaJaNaiScalePort {
  createScaledBitmap(src: PixImage, width: number, height: number): PixImage
}

/**
 * `MangaJaNaiFull` 对象（Kotlin 同包直调：`MangaJaNai.configure` L65、
 * `onLowMemory` L68、`enhance` L141）。
 *
 * TS 侧把这对互引收成宿主注入的 peer：`./mangaJaNaiFull` 单方向 import 本文件，
 * 本文件**不** import 它（`MangaJaNaiGpuPort` 只做 `import type`，编译期擦除）。
 */
export interface MangaJaNaiFullPeer {
  configure(host: MangaJaNaiHost): void
  release(): void
}

/**
 * 整个 MangaJaNai 家族的平台能力束。一次 `configure` 注入，两个引擎共享
 * （对应 Kotlin 里同一个 `Context` / 同一个进程）。
 */
export interface MangaJaNaiHost {
  /** `System.nanoTime()`（纳秒）。 */
  readonly now: () => number
  /** `Thread.currentThread().isInterrupted`。 */
  readonly isCancelled: () => boolean
  readonly files: MangaJaNaiFilePort
  readonly prefs: MangaJaNaiPrefsFactory
  readonly http: MangaJaNaiHttpPort
  readonly scheduler: MangaJaNaiSchedulerPort
  readonly device: MangaJaNaiDevicePort
  readonly memory: MangaJaNaiMemoryPort
  /** `OrtEnvironment` / `OrtSession`（见 `./mangaJaNaiRuntime`）。 */
  readonly sessions: MangaJaNaiSessionFactory
  /** `MangaJaNaiGpu` JNI；`null` = 平台没有 GPU 探测能力（等价 `UnsatisfiedLinkError`）。 */
  readonly gpu: MangaJaNaiGpuPort | null
  /** `Bitmap.createScaledBitmap`。 */
  readonly codec: MangaJaNaiScalePort
  /** `MangaJaNaiFull` 对象。 */
  readonly full: MangaJaNaiFullPeer
  /** `android.util.Log`。 */
  readonly log: MangaJaNaiLogPort
}

/* ══════════════════════ 常量（Kotlin L29-L34，数值逐字） ═══════════════════════════ */

/** Kotlin L29 `const val MODEL_BYTES = 1_673_288L`。 */
export const MANGA_JANAI_MODEL_BYTES = 1_673_288
/** Kotlin L30 `const val SHA256 = "718b8670…"`（作者 mobile SPAN 权重）。 */
export const MANGA_JANAI_SHA256 =
  '718b8670ab396a5174e5b4b38f9d3947beaac3afbe9647d494d65925180a2a7b'
/** Kotlin L31 `const val TILE = 128`。 */
export const MANGA_JANAI_TILE = 128
/** Kotlin L32 `const val HALO = 24`。 */
export const MANGA_JANAI_HALO = 24
/** Kotlin L33 `private const val SIDE = TILE + HALO * 2` = 176。 */
export const MANGA_JANAI_SIDE = MANGA_JANAI_TILE + MANGA_JANAI_HALO * 2
/** Kotlin L34 `private const val DEADLINE_NS = 4_300_000_000L`（4.3s 硬截止）。 */
export const MANGA_JANAI_DEADLINE_NS = 4_300_000_000
/** Kotlin L179 `minOf(3_200_000_000L, …)` —— 神经工作的绝对上限。 */
export const MANGA_JANAI_NEURAL_BUDGET_NS = 3_200_000_000
/** Kotlin L179 `… - 700_000_000L` —— 留给合成与落盘。 */
export const MANGA_JANAI_NEURAL_RESERVE_NS = 700_000_000
/** Kotlin L181 `neuralBudget / (engine.tileNanoseconds * 1.4)`。 */
export const MANGA_JANAI_TILE_MARGIN = 1.4
/** Kotlin L113 `File(app.filesDir, "mangajanai")`。 */
export const MANGA_JANAI_DIRECTORY = 'mangajanai'
/** Kotlin L114 `File(directory, "janai-span-v3-f32.onnx")`。 */
export const MANGA_JANAI_MODEL_FILE = 'janai-span-v3-f32.onnx'
/** Kotlin L120 `File(directory, "mobile.part")`。 */
export const MANGA_JANAI_PART_FILE = 'mobile.part'
/** Kotlin L122 `app.assets.open("comic_enhancement/janai-span-mobile.onnx")`。 */
export const MANGA_JANAI_ASSET_FILE = 'comic_enhancement/janai-span-mobile.onnx'
/** Kotlin L99/L123 `ByteArray(64 * 1024)`。 */
export const MANGA_JANAI_IO_CHUNK = 64 * 1024
/** Kotlin L88 `}, 60, TimeUnit.SECONDS)`。 */
export const MANGA_JANAI_IDLE_RELEASE_MS = 60_000
/** Kotlin L134 `min(2.0, …)`。 */
export const MANGA_JANAI_MAX_OUTPUT_SCALE = 2.0
/** Kotlin L134 `3200.0 / maxOf(width, height)`。 */
export const MANGA_JANAI_MAX_OUTPUT_EDGE = 3200.0
/** Kotlin L134 `sqrt(4_000_000.0 / (width * height))`。 */
export const MANGA_JANAI_MAX_OUTPUT_PIXELS = 4_000_000.0
/** Kotlin L70 `TRIM_MEMORY_RUNNING_LOW`（android.content.ComponentCallbacks2）。 */
export const TRIM_MEMORY_RUNNING_LOW = 10

/* ══════════════════════ 页锁（Kotlin L35 `ReentrantLock`） ══════════════════════════ */

const PAGE_LOCK_DEFAULT_OWNER: object = Object.freeze({ token: 'mangajanai-page-lock' })

/** 跨任务重入时的显式报错文案（Kotlin 侧是阻塞等待，同步端口没有可等待的线程）。 */
export const MANGA_JANAI_PAGE_LOCK_HELD_MESSAGE =
  'MangaJaNai 页锁已被其它任务持有：同步端口没有可阻塞的线程，请把调用串行化'

/**
 * Kotlin L35 `internal val lock = java.util.concurrent.locks.ReentrantLock()`。
 *
 * Kotlin 用 `lockInterruptibly()` 串行化两个引擎；JS 端口是同步的，没有「另一线程
 * 阻塞等待」这回事，唯一需要保住的性质是**同任务重入**（`MangaJaNai.enhance` L141
 * 在自己持锁时调用 `MangaJaNaiFull.release()`，后者 L47 再 `lock()` 一次）。
 * 因此这里按 owner 计数：默认 owner 表示「当前任务」，显式传 token 可断言跨任务互斥。
 */
export class MangaJaNaiPageLock {
  private depth = 0
  private owner: object | null = null

  lock(owner: object = PAGE_LOCK_DEFAULT_OWNER): void {
    if (this.owner === owner) {
      this.depth += 1
      return
    }
    if (this.depth > 0) {
      throw new Error(MANGA_JANAI_PAGE_LOCK_HELD_MESSAGE)
    }
    this.owner = owner
    this.depth = 1
  }

  tryLock(owner: object = PAGE_LOCK_DEFAULT_OWNER): boolean {
    if (this.depth > 0) return false
    this.owner = owner
    this.depth = 1
    return true
  }

  unlock(owner: object = PAGE_LOCK_DEFAULT_OWNER): void {
    if (this.owner !== owner || this.depth === 0) {
      throw new Error('MangaJaNai 页锁解锁顺序错误')
    }
    this.depth -= 1
    if (this.depth === 0) this.owner = null
  }

  /** 供测试/诊断：当前是否被持有。 */
  get held(): boolean {
    return this.depth > 0
  }
}

/* ══════════════════════ 状态流（Kotlin L37-38 `MutableStateFlow`） ═════════════════ */

/** `MutableStateFlow<String>`：同值不重发，订阅时立即拿到当前值。 */
export class MangaJaNaiStatusFlow {
  private current = ''
  private readonly listeners = new Set<(value: string) => void>()

  get status(): string {
    return this.current
  }

  set(value: string): void {
    if (value === this.current) return
    this.current = value
    for (const listener of [...this.listeners]) listener(value)
  }

  subscribe(listener: (value: string) => void): () => void {
    this.listeners.add(listener)
    listener(this.current)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

/* ══════════════════════ 清理队列（Kotlin L46-48 `cleanup` 单线程执行器） ════════════ */

/**
 * `ScheduledThreadPoolExecutor(1, Thread(task, "mangajanai-release"))` 的同步等价：
 * 任务串行、按提交顺序执行（内存压力回调不能与自身交叉）。
 */
export class MangaJaNaiCleanupQueue {
  private readonly pending: Array<() => void> = []
  private draining = false

  execute(task: () => void): void {
    this.pending.push(task)
    this.drain()
  }

  private drain(): void {
    if (this.draining) return
    this.draining = true
    try {
      while (this.pending.length > 0) {
        const task = this.pending.shift()
        task?.()
      }
    } finally {
      this.draining = false
    }
  }
}

/* ══════════════════════ 位图读取缝（`Bitmap.getPixels`） ═══════════════════════════ */

/**
 * `Bitmap.getPixels(target, dstOffset, dstStride, left, top, width, height)`。
 * 与 `mangaJaNaiTiles.readMangaJaNaiTile` 的 `readRect` 参数一一对应。
 */
function pixReadRect(source: PixImage) {
  return (
    dst: Int32Array,
    dstOffset: number,
    dstStride: number,
    left: number,
    top: number,
    width: number,
    height: number,
  ): void => {
    for (let row = 0; row < height; row += 1) {
      const from = (top + row) * source.width + left
      const to = dstOffset + row * dstStride
      for (let col = 0; col < width; col += 1) {
        // `| 0` 复刻 Kotlin `IntArray` 的 32 位有符号打包（ARGB 首字节可能 ≥ 0x80）。
        dst[to + col] = (source.data[from + col] ?? 0) | 0
      }
    }
  }
}

/**
 * Kotlin `readMangaJaNaiTile(bitmap, x, y, target)` 的 `PixImage` 适配：
 * 一次行拷贝 + `mangaJaNaiTiles` 里逐字的边缘复制。
 */
export function readTileFromPix(
  source: PixImage,
  x: number,
  y: number,
  target: Int32Array,
  tileSize: number = MANGA_JANAI_TILE,
  halo: number = MANGA_JANAI_HALO,
): void {
  readMangaJaNaiTile(
    pixReadRect(source),
    source.width,
    source.height,
    x,
    y,
    target,
    tileSize,
    halo,
  )
}

/* ══════════════════════ 缩放倍率（Kotlin L133-136） ═══════════════════════════════ */

/**
 * Kotlin L133-136 `internal fun outputSize(width: Int, height: Int): Pair<Int, Int>`。
 *
 * 三重夹逼：最多 2×、长边不超过 3200、总像素不超过 4,000,000；再按最近取整并保底 1。
 * 大页（例如 4000×6000）拿到 < 1 的倍率，此时输出**小于**原图 —— 这是 Kotlin 的原样行为。
 */
export function mangaJaNaiOutputSize(width: number, height: number): [number, number] {
  const scale = Math.min(
    MANGA_JANAI_MAX_OUTPUT_SCALE,
    Math.min(
      MANGA_JANAI_MAX_OUTPUT_EDGE / Math.max(width, height),
      Math.sqrt(MANGA_JANAI_MAX_OUTPUT_PIXELS / (width * height)),
    ),
  )
  return [
    Math.max(1, roundToInt(width * scale)),
    Math.max(1, roundToInt(height * scale)),
  ]
}

/* ══════════════════════ MangaJaNai 引擎（Kotlin L28-261） ═════════════════════════ */

/**
 * Kotlin L28-261 `internal object MangaJaNai`。
 *
 * Author's mobile SPAN model, bundled for reliable offline operation.
 * Measured neural work budget, original-detail residual composition and one shared session.
 */
export class MangaJaNaiState {
  /** Kotlin L35 `internal val lock` —— 与 `MangaJaNaiFull` 共用同一把。 */
  readonly lock = new MangaJaNaiPageLock()

  /** Kotlin L37-38 `_status` / `status`。 */
  private readonly statusFlow = new MangaJaNaiStatusFlow()

  /** Kotlin L39 `private val silent = ThreadLocal<Boolean>()`。 */
  private silent = false

  /** Kotlin L41 `private var runtime: MangaJaNaiRuntime?`。 */
  private runtime: MangaJaNaiRuntime | null = null

  /** Kotlin L42 `private val tileCache = MangaJaNaiTileCache(1)`。 */
  private readonly tileCache = new MangaJaNaiTileCache(1)

  /** Kotlin L43 `private var verifiedStamp: String?`。 */
  private verifiedStamp: string | null = null

  /** Kotlin L44 `private var generation = 0L`。 */
  private generation = 0

  /** Kotlin L45 `private var idleRelease: ScheduledFuture<*>?`。 */
  private idleRelease: (() => void) | null = null

  /** Kotlin L46-48 `cleanup`。 */
  private readonly cleanup = new MangaJaNaiCleanupQueue()

  /** Kotlin L36 `@Volatile private var context: Context?`。 */
  private host: MangaJaNaiHost | null = null

  /** Kotlin L37-38 `val status = _status.asStateFlow()`。 */
  get status(): string {
    return this.statusFlow.status
  }

  /** 观察状态（`StateFlow` 语义：订阅即刻回调当前值，同值不重发）。 */
  onStatus(listener: (value: string) => void): () => void {
    return this.statusFlow.subscribe(listener)
  }

  /** Kotlin L40 `internal val isSilent get() = silent.get() == true`。 */
  get isSilent(): boolean {
    return this.silent
  }

  /** Kotlin L54-58 `internal fun <T> withSilentStatus(background: Boolean, work: () -> T): T`。 */
  withSilentStatus<T>(background: boolean, work: () => T): T {
    const previous = this.silent
    this.silent = background
    try {
      return work()
    } finally {
      this.silent = previous
    }
  }

  /** Kotlin L59 `private fun report(value: String) { if (silent.get() != true) … }`。 */
  private report(value: string): void {
    if (this.silent) return
    this.statusFlow.set(value)
  }

  /** Kotlin L61-73 `fun configure(context: Context)`。 */
  configure(host: MangaJaNaiHost): void {
    if (this.host === host) return
    this.host = host
    host.full.configure(host)
    // Kotlin L66-72：`registerComponentCallbacks` + 两个内存回调。
    host.memory.onLowMemory(() => {
      this.cleanup.execute(() => {
        this.release()
        host.full.release()
      })
    })
    host.memory.onTrimMemory((level) => {
      if (level >= TRIM_MEMORY_RUNNING_LOW) {
        this.cleanup.execute(() => {
          this.release()
          host.full.release()
        })
      }
    })
  }

  /** Kotlin L75-79 `fun release()`。 */
  release(): void {
    this.lock.lock()
    try {
      this.generation += 1
      this.idleRelease?.()
      this.idleRelease = null
      this.runtime?.close()
      this.runtime = null
      this.tileCache.clear()
    } finally {
      this.lock.unlock()
    }
  }

  /** Kotlin L81-89 `private fun releaseWhenIdle()`。 */
  private releaseWhenIdle(): void {
    const host = this.requireHost()
    const expected = this.generation
    this.idleRelease = host.scheduler.schedule(MANGA_JANAI_IDLE_RELEASE_MS, () => {
      if (!this.lock.tryLock()) return
      try {
        if (this.generation === expected) {
          this.runtime?.close()
          this.runtime = null
          this.tileCache.clear()
        }
      } finally {
        this.lock.unlock()
      }
    })
  }

  /** Kotlin L91-93 `private fun checkCancelled()`。 */
  private checkCancelled(): void {
    if (this.host?.isCancelled() === true) throw new MangaJaNaiCancelledError()
  }

  private requireHost(): MangaJaNaiHost {
    const host = this.host
    if (host === null) throw new MangaJaNaiIoError(tr('增强引擎尚未初始化'))
    return host
  }

  /** Kotlin L95-108 `internal fun verify(file: File): Boolean`。 */
  verify(path: string): boolean {
    const files = this.requireHost().files
    if (files.length(path) !== MANGA_JANAI_MODEL_BYTES) return false
    const digest = sha256.create()
    const reader = files.openRead(path)
    try {
      const buffer = new Uint8Array(MANGA_JANAI_IO_CHUNK)
      for (;;) {
        this.checkCancelled()
        const count = reader.read(buffer)
        if (count < 0) break
        digest.update(buffer.subarray(0, count))
      }
    } finally {
      reader.close()
    }
    return bytesToHex(digest.digest()) === MANGA_JANAI_SHA256
  }

  /** Kotlin L115/L128 `"${file.absolutePath}:${file.lastModified()}:${file.length()}"`。 */
  private fileStamp(path: string): string {
    const files = this.requireHost().files
    return `${path}:${files.lastModified(path)}:${files.length(path)}`
  }

  /**
   * Kotlin L110-131 `internal fun model(): File`。
   *
   * APK includes the lightweight weights; never wait for a network model download.
   */
  model(): string {
    const host = this.requireHost()
    const files = host.files
    const directory = files.join(files.filesDir, MANGA_JANAI_DIRECTORY)
    files.mkdirs(directory)
    const file = files.join(directory, MANGA_JANAI_MODEL_FILE)
    const stamp = this.fileStamp(file)
    if (this.verifiedStamp === stamp || this.verify(file)) {
      this.verifiedStamp = stamp
      return file
    }
    const part = files.join(directory, MANGA_JANAI_PART_FILE)
    try {
      const source = files.openAsset(MANGA_JANAI_ASSET_FILE)
      try {
        const target = files.openWrite(part)
        try {
          const buffer = new Uint8Array(MANGA_JANAI_IO_CHUNK)
          for (;;) {
            const count = source.read(buffer)
            if (count < 0) break
            target.write(buffer, 0, count)
          }
        } finally {
          target.close()
        }
      } finally {
        source.close()
      }
      if (!this.verify(part)) throw new MangaJaNaiIoError(tr('增强模型校验失败'))
      if (files.exists(file) && !files.delete(file)) {
        throw new MangaJaNaiIoError(tr('无法替换增强模型'))
      }
      if (!files.rename(part, file)) throw new MangaJaNaiIoError(tr('无法保存增强模型'))
      this.verifiedStamp = this.fileStamp(file)
      return file
    } finally {
      files.delete(part)
    }
  }

  /** Kotlin L133-136（实例方法形态，`MangaJaNai.outputSize`）。 */
  outputSize(width: number, height: number): [number, number] {
    return mangaJaNaiOutputSize(width, height)
  }

  /**
   * Kotlin L138-260 `fun enhance(src: Bitmap, strength: Float): Bitmap`。
   *
   * 全量管线：页锁 → 释放完整档 → 模型就绪 → 会话就绪 → 神经预算 → 降采样 →
   * 切片推理（带 1 片 LRU）→ 2× 神经图 → 原图细节残差合成。
   *
   * 失败语义与 Kotlin 逐条一致：超时**不缓存任何部分结果**，中断原样抛出，
   * OOM/链接错误/普通异常各自上报不同文案后抛出。
   */
  enhance(source: PixImage, strength: number): PixImage {
    const host = this.requireHost()
    this.lock.lock()
    try {
      // Kotlin L141 —— 单一驻留模型：完整档先释放。
      host.full.release()
      this.generation += 1
      this.idleRelease?.()
      this.idleRelease = null
      this.checkCancelled()
      const started = host.now()
      const deadline = started + MANGA_JANAI_DEADLINE_NS
      const file = this.model()
      let engine = this.runtime
      if (engine === null) {
        engine = new MangaJaNaiRuntime({
          device: host.device,
          prefs: host.prefs,
          sessions: host.sessions,
          now: host.now,
          isCancelled: host.isCancelled,
          log: host.log,
        })
        this.runtime = engine
      }
      const side = MANGA_JANAI_SIDE
      const area = side * side
      const coreSide = MANGA_JANAI_TILE * 2
      const coreArea = coreSide * coreSide
      // Kotlin L152-153：输入 `1×3×side×side`、输出 `1×3×2side×2side`（float 数）。
      const input = new Float32Array(area * 3)
      const output = new Float32Array(area * 12)
      const sourceTile = new Int32Array(area)
      const coreValues = new Float32Array(coreArea * 3)
      const packInput = (): void => {
        for (let i = 0; i < sourceTile.length; i += 1) {
          const p = sourceTile[i] ?? 0
          input[i] = ((p >>> 16) & 255) / 255
          input[area + i] = ((p >>> 8) & 255) / 255
          input[area * 2 + i] = (p & 255) / 255
        }
      }
      // Kotlin L166-167：首片先读入并打包，用作后端探针的真实输入。
      readTileFromPix(source, 0, 0, sourceTile)
      packInput()
      // Kotlin L171-175：RunOptions + 看门狗。
      const control = new MangaJaNaiRunOptions()
      const timer = host.scheduler.schedule(
        Math.max(0.001, (deadline - host.now()) / 1e6),
        () => {
          control.terminate()
        },
      )
      try {
        this.report(tr('引擎准备中…'))
        engine.prepare(file, input, output, control, deadline)
        // Kotlin L179-181：神经预算 → 切片预算。
        const neuralBudget = Math.min(
          MANGA_JANAI_NEURAL_BUDGET_NS,
          deadline - host.now() - MANGA_JANAI_NEURAL_RESERVE_NS,
        )
        if (neuralBudget <= 0) throw new MangaJaNaiBudgetExceededError()
        const countBudget = Math.max(
          1,
          Math.trunc(neuralBudget / (engine.tileNanoseconds * MANGA_JANAI_TILE_MARGIN)),
        )
        const [iw, ih] = mangaMobileInputSize(source.width, source.height, countBudget)
        const reduced =
          iw === source.width && ih === source.height
            ? source
            : host.codec.createScaledBitmap(source, iw, ih)
        const neural: PixImage = {
          width: iw * 2,
          height: ih * 2,
          data: new Uint32Array(iw * 2 * ih * 2),
        }
        const pixels = new Uint32Array(coreArea)
        const total =
          Math.trunc((iw + MANGA_JANAI_TILE - 1) / MANGA_JANAI_TILE) *
          Math.trunc((ih + MANGA_JANAI_TILE - 1) / MANGA_JANAI_TILE)
        let completed = 0
        let inferred = 0
        let lastPercent = -1
        // Kotlin L197：y 外层、x 内层（逐行从左到右）。
        for (let y = 0; y < ih; y += MANGA_JANAI_TILE) {
          for (let x = 0; x < iw; x += MANGA_JANAI_TILE) {
            this.checkCancelled()
            if (host.now() >= deadline) throw new MangaJaNaiBudgetExceededError()
            readTileFromPix(reduced, x, y, sourceTile)
            const cached = this.tileCache.find(sourceTile)
            let core: Float32Array
            if (cached !== null) {
              core = cached
            } else {
              packInput()
              engine.run(file, input, output, control, deadline)
              inferred += 1
              // Kotlin L206-209：从 2× 输出里抠出中心 coreSide×coreSide。
              for (let c = 0; c <= 2; c += 1) {
                for (let row = 0; row < coreSide; row += 1) {
                  const from =
                    c * area * 4 +
                    (row + MANGA_JANAI_HALO * 2) * side * 2 +
                    MANGA_JANAI_HALO * 2
                  coreValues.set(output.subarray(from, from + coreSide), c * coreArea + row * coreSide)
                }
              }
              this.tileCache.put(sourceTile, coreValues)
              core = coreValues
            }
            // Kotlin L214-222：裁到剩余尺寸后 2× 落位。
            const tw = Math.min(MANGA_JANAI_TILE, iw - x) * 2
            const th = Math.min(MANGA_JANAI_TILE, ih - y) * 2
            for (let ty = 0; ty < th; ty += 1) {
              for (let tx = 0; tx < tw; tx += 1) {
                const i = ty * coreSide + tx
                const channel = (c: number): number =>
                  roundToInt(clamp(core[c * coreArea + i] ?? 0, 0, 1) * 255)
                pixels[i] =
                  (0xff000000 | (channel(0) << 16) | (channel(1) << 8) | channel(2)) >>> 0
              }
            }
            // Kotlin L221-222 `canvas.drawBitmap(tile, Rect(0,0,tw,th), RectF(x*2, y*2, …))`
            // 在 mobile 路径上是 1:1 落位（源缩放恒为 1），因此是行拷贝。
            for (let ty = 0; ty < th; ty += 1) {
              const to = (y * 2 + ty) * neural.width + x * 2
              neural.data.set(pixels.subarray(ty * coreSide, ty * coreSide + tw), to)
            }
            // Kotlin L223-224：百分比变化才上报。
            completed += 1
            const percent = Math.trunc((completed * 100) / total)
            if (percent !== lastPercent) {
              lastPercent = percent
              this.report(mangaJaNaiEnhanceProgress(percent))
            }
          }
        }
        const [ow, oh] = this.outputSize(source.width, source.height)
        const combined = combineMangaJaNaiDetail(
          source,
          reduced,
          neural,
          ow,
          oh,
          strength,
          host.isCancelled,
          () => new MangaJaNaiCancelledError(),
        )
        this.report('')
        host.log.i(
          'MangaJaNai',
          `aiComplete=true source=${source.width}x${source.height} neural=${iw}x${ih} tiles=${total} inferred=${inferred} totalMs=${Math.trunc((host.now() - started) / 1e6)}`,
        )
        return combined
      } finally {
        // Kotlin L235-238：先撤看门狗，再关 options。
        timer()
        control.close()
      }
    } catch (error) {
      if (error instanceof MangaJaNaiBudgetExceededError) {
        // Kotlin L241-244：No partial/fallback bitmap is cached or counted as a completed AI page.
        this.runtime?.penalizeTimeout()
        this.report(tr('增强超时 · 已保留原图'))
        throw error
      }
      if (error instanceof MangaJaNaiCancelledError) throw error
      if (error instanceof MangaJaNaiOutOfMemoryError || error instanceof RangeError) {
        // Kotlin L246-250（`RangeError` = 定长 TypedArray 分配失败，等价 OOM）
        this.runtime?.close()
        this.runtime = null
        this.tileCache.clear()
        this.report(tr('内存不足 · 已保留原图'))
        throw new MangaJaNaiIoError(tr('增强内存不足'))
      }
      if (error instanceof MangaJaNaiLinkageError) {
        // Kotlin L251-254
        this.runtime?.close()
        this.runtime = null
        this.tileCache.clear()
        this.report(tr('增强不可用 · 已保留原图'))
        throw new MangaJaNaiIoError(tr('当前设备无法加载增强引擎'))
      }
      // Kotlin L255-258
      this.runtime?.close()
      this.runtime = null
      this.tileCache.clear()
      this.report(tr('增强失败 · 已保留原图'))
      throw error
    } finally {
      try {
        this.releaseWhenIdle()
      } finally {
        this.lock.unlock()
      }
    }
  }
}

/** Kotlin `internal object MangaJaNai` 的单例。 */
export const MangaJaNai = new MangaJaNaiState()
