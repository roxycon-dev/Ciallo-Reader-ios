/**
 * mangaJaNaiFull.ts  ←  novel-reader/app/src/main/java/com/example/ui/comic/MangaJaNaiFull.kt
 *
 * Kotlin source: 246 lines / 223 non-blank（文件以 L246 `}` 结束，末尾带换行）。
 *
 * ┌─ Kotlin → TS 行号映射（逐段，TS 侧为本文件实际行号）───────────────────────────┐
 * │ Kotlin   │ TS                                                 │ 说明               │
 * │ L1-21    │ L1-76   （文件头 + import 段）                      │ package/imports    │
 * │ L23-24   │ L126-131  object 头注释                            │ doc 注释逐字保留   │
 * │ L25-29   │ L79-91    常量（MODEL_BYTES/SHA256/PACK_URL/        │ 数值/URL 逐字       │
 * │          │           MODEL_URL/HALO）                          │                    │
 * │ L30-45   │ L132-190  共享锁 / host / runtime / tileCache /     │ 状态字段            │
 * │          │           cacheCore / status / stamp / generation / │                    │
 * │          │           idle / cleanup                           │                    │
 * │ L44      │ L183-189  `report()`                               │ 静默门             │
 * │ L45-50   │ L191-210  configure / release                      │ 生命周期            │
 * │ L51-53   │ L212-214  cancelled()                              │ InterruptedException│
 * │ L54-62   │ L227-245  verified(file, bytes, hash)              │ 长度 + SHA-256     │
 * │ L63      │ L247-250  fileStamp(file)                          │ 路径:长度:时间      │
 * │ L64-72   │ L253-265  verifyNative(directory)                  │ param/bin 双校验    │
 * │ L73-94   │ L267-305  download(url, file, limit)               │ 100ms 取消轮询      │
 * │ L95-128  │ L307-392  unpack(archive, directory)               │ 条目白名单 + 限额   │
 * │ L129-158 │ L400-471  model()                                  │ 双重来源 + 重试节流 │
 * │ L159-235 │ L481-652  enhance(source, strength)                │ 全量管线            │
 * │ L236-245 │ L657-672  pack()（`packTile` / `packInto`）          │ NCHW 打包           │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ── 未移植项（GPU 部分必须列明）────────────────────────────────────────────────────
 * 1. **GPU 权重/探针路径的实际执行**：本文件只调用 `MangaJaNaiFullRuntime`；
 *    `MangaJaNaiGpu` 的 4 个 JNI 入口（`create/run/save/destroy`）见
 *    `./mangaJaNaiFullRuntime` 的 `MangaJaNaiGpuPort`。Web 无 GPU 时该端口为 `null`，
 *    `prepare` 抛 `MangaJaNaiLinkageError` → 走 Kotlin L111-117 的「记 warn + 关闭 +
 *    用 FP32 CPU 权重」分支；`gpu=false` 写回 `mangajanai-full-runtime`，`tile` 保持 48。
 *    **任何情况下都不会把原图当结果返回**：CPU 会话建不起来时抛
 *    `MangaJaNaiIoError('当前设备无法加载完整增强')`。
 * 2. `okhttp3` / `SharedHttpTransport`：收成 `MangaJaNaiHttpPort`（`newCall` 抛
 *    `MangaJaNaiIoError`），10 分钟 callTimeout / 45 秒 readTimeout 由宿主实现。
 * 3. `java.util.zip.ZipInputStream`：收成 `MangaJaNaiZipReader`（逐条目流式），
 *    Kotlin 的「条目名白名单 + 单条目限额 + 64KB 分块」逻辑逐行保留。
 * 4. `System.currentTimeMillis()` → `Math.trunc(host.now() / 1e6)`（同一时钟，
 *    只用于 1 小时重试节流）；`android.util.Log` → `MangaJaNaiLogPort`。
 * 5. `Bitmap.createBitmap` / `Canvas.drawBitmap(..., Paint(FILTER_BITMAP_FLAG))`：
 *    `PixImage` + `drawPixTileFiltered`（`./mangaJaNaiMobile`，双线性 + 边缘 clamp）。
 * 6. `MangaJaNaiFull` 与 `MangaJaNai` 在 Kotlin 里互相直调（L60 取锁、L141 release、
 *    L180 outputSize、L44 读 isSilent）。TS 侧方向固定为 本文件 → `./mangaJaNai`，
 *    反方向通过 `MangaJaNaiHost.full`（`MangaJaNaiFullPeer`）注入，避免 ESM 值环。
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { tr } from '../i18n/locale'
import { clamp, roundToInt, type PixImage } from './comicPixOps'
import {
  MANGA_JANAI_IDLE_RELEASE_MS,
  MANGA_JANAI_IO_CHUNK,
  MangaJaNai,
  MangaJaNaiCancelledError,
  MangaJaNaiCleanupQueue,
  MangaJaNaiIoError,
  MangaJaNaiLinkageError,
  mangaJaNaiFullEnhanceProgress,
  mangaJaNaiModelDownloadFailed,
  mangaJaNaiModelSizeMb,
  mangaJaNaiOutputSize,
  readTileFromPix,
  type MangaJaNaiFullPeer,
  type MangaJaNaiHost,
  type MangaJaNaiPrefsPort,
} from './mangaJaNai'
import { drawPixTileFiltered } from './mangaJaNaiMobile'
import { MangaJaNaiTileCache } from './mangaJaNaiTiles'
import {
  MangaJaNaiFullRuntime,
  mangaJaNaiFullPreferredTile,
} from './mangaJaNaiFullRuntime'

/* ══════════════════════ 常量（Kotlin L25-L29，数值/URL 逐字） ═══════════════════════ */

/** Kotlin L25 `const val MODEL_BYTES = 67_191_396L`。 */
export const MANGA_JANAI_FULL_MODEL_BYTES = 67_191_396
/** Kotlin L26 `const val SHA256 = "c985d6b7…"`。 */
export const MANGA_JANAI_FULL_SHA256 =
  'c985d6b78ed1a659867cd5697ce80743ad9ddd73868f463e69c824f15f169eb0'
/** Kotlin L27 `private const val PACK_URL = "…MangaJaNai-full-v1-fp32.zip"`。 */
export const MANGA_JANAI_FULL_PACK_URL =
  'https://github.com/roxycon-dev/Ciallo-Reader/releases/download/v1.3.6/MangaJaNai-full-v1-fp32.zip'
/** Kotlin L28 `private const val MODEL_URL = "…2x_MangaJaNai_1200p_V1_ESRGAN_70k.onnx"`。 */
export const MANGA_JANAI_FULL_MODEL_URL =
  'https://huggingface.co/haesslerian/MangaJaNai_V1_ONNX/resolve/2f67ff30209f2e0c75b7c55e6f3ffc3adbc960f7/2x_MangaJaNai_1200p_V1_ESRGAN_70k.onnx'
/** Kotlin L29 `private const val HALO = 16`（完整档比 mobile 档小：网络更大，重叠更省）。 */
export const MANGA_JANAI_FULL_HALO = 16
/** Kotlin L68 / L97 `full.param` 的字节数与 SHA-256（ncnn 结构文件）。 */
export const MANGA_JANAI_FULL_PARAM_BYTES = 102_736
export const MANGA_JANAI_FULL_PARAM_SHA256 =
  '92bb351b492ba789925b345710ad45c4d5e6cc696540a55348c5f82fb4c36cf8'
/** Kotlin L69 / L97 `full.bin` 的字节数与 SHA-256（ncnn 权重）。 */
export const MANGA_JANAI_FULL_BIN_BYTES = 66_814_088
export const MANGA_JANAI_FULL_BIN_SHA256 =
  'c0f66830e66bbc75ce45364bfef1317fa7b16813bc427ff6903aceafb757cb80'
/** Kotlin L141 `download(PACK_URL, archive, 90_000_000L)`。 */
export const MANGA_JANAI_FULL_PACK_LIMIT = 90_000_000
/** Kotlin L104 `entry.name in listOf("manifest.json", "NOTICE.txt") ? 8192L`。 */
export const MANGA_JANAI_FULL_META_LIMIT = 8192
/** Kotlin L135 `3_600_000L`（1 小时重试节流）。 */
export const MANGA_JANAI_FULL_RETRY_INTERVAL_MS = 3_600_000
/** Kotlin L131 `File(app.filesDir, "mangajanai/full")`。 */
export const MANGA_JANAI_FULL_DIRECTORY = 'mangajanai/full'
/** Kotlin L132 `full.onnx` / L146 `full.onnx.part` / L148 `mangajanai/2x-1200p-v1.onnx`。 */
export const MANGA_JANAI_FULL_ONNX_FILE = 'full.onnx'
export const MANGA_JANAI_FULL_ONNX_PART = 'full.onnx.part'
export const MANGA_JANAI_FULL_PREVIOUS_ONNX = 'mangajanai/2x-1200p-v1.onnx'
/** Kotlin L137 `download.zip.part`。 */
export const MANGA_JANAI_FULL_ARCHIVE_PART = 'download.zip.part'
/** Kotlin L134 `getSharedPreferences("mangajanai-full-download", MODE_PRIVATE)`。 */
export const MANGA_JANAI_FULL_DOWNLOAD_PREFS = 'mangajanai-full-download'
/** Kotlin L97 `"full.onnx" to MODEL_BYTES, "full.bin" to …, "full.param" to …`（包内条目 → 字节数）。 */
export const MANGA_JANAI_FULL_PACK_ENTRIES: ReadonlyArray<readonly [string, number]> = [
  ['full.onnx', MANGA_JANAI_FULL_MODEL_BYTES],
  ['full.bin', MANGA_JANAI_FULL_BIN_BYTES],
  ['full.param', MANGA_JANAI_FULL_PARAM_BYTES],
]
/** Kotlin L104 / L126 `manifest.json`、`NOTICE.txt`（允许存在，不参与模型校验）。 */
export const MANGA_JANAI_FULL_PACK_META: ReadonlyArray<string> = ['manifest.json', 'NOTICE.txt']

/* ══════════════════════ MangaJaNaiFull（Kotlin L23-246） ══════════════════════════ */

/**
 * Kotlin L23-246 `internal object MangaJaNaiFull`。
 *
 * Full original ESRGAN network and FP32 weights; never downsamples the neural input.
 */
export class MangaJaNaiFullState implements MangaJaNaiFullPeer {
  /** Kotlin L30 `private val lock get() = MangaJaNai.lock` —— 与 mobile 档同一把。 */
  private get lock() {
    return MangaJaNai.lock
  }

  /** Kotlin L31 `private var context: Context?`。 */
  private host: MangaJaNaiHost | null = null

  /** Kotlin L32 `private var runtime: MangaJaNaiFullRuntime?`。 */
  private runtime: MangaJaNaiFullRuntime | null = null

  /** Kotlin L33 `private val tileCache = MangaJaNaiTileCache(1)`。 */
  private readonly tileCache = new MangaJaNaiTileCache(1)

  /** Kotlin L34 `private var cacheCore = 0` —— 切片尺寸变了就要清缓存。 */
  private cacheCore = 0

  /** Kotlin L35-36 `_status` / `status`。 */
  private statusValue = ''
  private readonly statusListeners = new Set<(value: string) => void>()

  /** Kotlin L37 `private var stamp: String?`。 */
  private stamp: string | null = null

  /** Kotlin L38 `private var nativeStamp: String?`。 */
  private nativeStamp: string | null = null

  /** Kotlin L39 `private var generation = 0L`。 */
  private generation = 0

  /** Kotlin L40 `private var idle: ScheduledFuture<*>?`。 */
  private idle: (() => void) | null = null

  /** Kotlin L41-43 `cleanup` 执行器。 */
  private readonly cleanup = new MangaJaNaiCleanupQueue()

  /** Kotlin L35-36 `val status = _status.asStateFlow()`。 */
  get status(): string {
    return this.statusValue
  }

  onStatus(listener: (value: string) => void): () => void {
    this.statusListeners.add(listener)
    listener(this.statusValue)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  /** Kotlin L44 `private fun report(value: String) { if (!MangaJaNai.isSilent) … }`。 */
  private report(value: string): void {
    if (MangaJaNai.isSilent) return
    if (value === this.statusValue) return
    this.statusValue = value
    for (const listener of [...this.statusListeners]) listener(value)
  }

  /** Kotlin L45 `fun configure(app: Context) { context = app.applicationContext }`。 */
  configure(host: MangaJaNaiHost): void {
    this.host = host
  }

  /** Kotlin L46-50 `fun release()`。 */
  release(): void {
    this.lock.lock()
    try {
      this.generation += 1
      this.idle?.()
      this.idle = null
      this.runtime?.close()
      this.runtime = null
      this.tileCache.clear()
      this.cacheCore = 0
    } finally {
      this.lock.unlock()
    }
  }

  /** Kotlin L51-53 `private fun cancelled()`。 */
  private cancelled(): void {
    if (this.requireHost().isCancelled()) throw new MangaJaNaiCancelledError()
  }

  private requireHost(): MangaJaNaiHost {
    const host = this.host
    if (host === null) throw new MangaJaNaiIoError(tr('完整增强尚未初始化'))
    return host
  }

  private prefs(): MangaJaNaiPrefsPort {
    return this.requireHost().prefs(MANGA_JANAI_FULL_DOWNLOAD_PREFS)
  }

  /** Kotlin L54-62 `private fun verified(file, bytes, hash): Boolean`。 */
  private verified(path: string, bytes: number, hash: string): boolean {
    const host = this.requireHost()
    if (host.files.length(path) !== bytes) return false
    const digest = sha256.create()
    const source = host.files.openRead(path)
    try {
      const buffer = new Uint8Array(MANGA_JANAI_IO_CHUNK)
      for (;;) {
        this.cancelled()
        const count = source.read(buffer)
        if (count < 0) break
        digest.update(buffer.subarray(0, count))
      }
    } finally {
      source.close()
    }
    return bytesToHex(digest.digest()) === hash
  }

  /** Kotlin L63 `private fun fileStamp(file: File) = "${file.path}:${file.length()}:${file.lastModified()}"`。 */
  private fileStamp(path: string): string {
    const files = this.requireHost().files
    return `${path}:${files.length(path)}:${files.lastModified(path)}`
  }

  /** Kotlin L64-72 `internal fun verifyNative(directory: File): Boolean`。 */
  verifyNative(directory: string): boolean {
    const files = this.requireHost().files
    const param = files.join(directory, 'full.param')
    const bin = files.join(directory, 'full.bin')
    const current = this.fileStamp(param) + this.fileStamp(bin)
    if (this.nativeStamp === current) return true
    const valid =
      this.verified(param, MANGA_JANAI_FULL_PARAM_BYTES, MANGA_JANAI_FULL_PARAM_SHA256) &&
      this.verified(bin, MANGA_JANAI_FULL_BIN_BYTES, MANGA_JANAI_FULL_BIN_SHA256)
    if (valid) this.nativeStamp = current
    return valid
  }

  /** Kotlin L73-94 `private fun download(url, file, limit)`。 */
  download(url: string, path: string, limit: number): void {
    const host = this.requireHost()
    const call = host.http.newCall(url)
    // Kotlin L78：每 100ms 检查一次中断标志，命中就取消这次 HTTP 调用。
    const cancel = host.scheduler.scheduleAtFixedRate(100, 100, () => {
      if (host.isCancelled()) call.cancel()
    })
    try {
      if (!call.isSuccessful) {
        throw new MangaJaNaiIoError(mangaJaNaiModelDownloadFailed(call.statusCode))
      }
      const body = call.body
      if (body === null) throw new MangaJaNaiIoError(tr('完整模型为空'))
      const target = host.files.openWrite(path)
      try {
        const buffer = new Uint8Array(MANGA_JANAI_IO_CHUNK)
        let total = 0
        for (;;) {
          this.cancelled()
          const count = body.read(buffer)
          if (count < 0) break
          total += count
          if (total > limit) throw new MangaJaNaiIoError(tr('完整模型大小不符'))
          target.write(buffer, 0, count)
          this.report(mangaJaNaiModelSizeMb(Math.trunc(total / (1024 * 1024))))
        }
      } finally {
        target.close()
      }
    } finally {
      cancel()
      call.close()
    }
  }

  /**
   * Kotlin L95-128 `internal fun unpack(archive: File, directory: File)`。
   *
   * Only exact known entry names are accepted; streamed files are verified before replacement.
   */
  unpack(archive: string, directory: string): void {
    const host = this.requireHost()
    const files = host.files
    const expected = new Map<string, number>(MANGA_JANAI_FULL_PACK_ENTRIES)
    const seen = new Set<string>()
    try {
      const zip = files.openZip(archive)
      try {
        for (;;) {
          this.cancelled()
          const entry = zip.nextEntry()
          if (entry === null) break
          if (entry.isDirectory || seen.has(entry.name)) {
            throw new MangaJaNaiIoError(tr('完整模型包无效'))
          }
          seen.add(entry.name)
          const expectedBytes = expected.get(entry.name)
          const limit =
            expectedBytes ??
            (MANGA_JANAI_FULL_PACK_META.includes(entry.name)
              ? MANGA_JANAI_FULL_META_LIMIT
              : (() => {
                  throw new MangaJaNaiIoError(tr('完整模型包无效'))
                })())
          const part = files.join(directory, `${entry.name}.part`)
          const target = files.openWrite(part)
          try {
            const buffer = new Uint8Array(MANGA_JANAI_IO_CHUNK)
            let total = 0
            for (;;) {
              this.cancelled()
              const count = zip.read(buffer)
              if (count < 0) break
              total += count
              if (total > limit) throw new MangaJaNaiIoError(tr('完整模型包过大'))
              target.write(buffer, 0, count)
            }
            if (expectedBytes !== undefined && total !== limit) {
              throw new MangaJaNaiIoError(tr('完整模型包不完整'))
            }
          } finally {
            target.close()
          }
          zip.closeEntry()
        }
      } finally {
        zip.close()
      }
      // Kotlin L117-119：条目齐全 + 三份 `.part` 逐份 SHA-256，任一不满足都算「校验失败」。
      const complete = [...expected.keys()].every((name) => seen.has(name))
      if (
        !complete ||
        !this.verified(
          files.join(directory, 'full.onnx.part'),
          MANGA_JANAI_FULL_MODEL_BYTES,
          MANGA_JANAI_FULL_SHA256,
        ) ||
        !this.verified(
          files.join(directory, 'full.param.part'),
          MANGA_JANAI_FULL_PARAM_BYTES,
          MANGA_JANAI_FULL_PARAM_SHA256,
        ) ||
        !this.verified(
          files.join(directory, 'full.bin.part'),
          MANGA_JANAI_FULL_BIN_BYTES,
          MANGA_JANAI_FULL_BIN_SHA256,
        )
      ) {
        throw new MangaJaNaiIoError(tr('完整模型校验失败'))
      }
      for (const name of expected.keys()) {
        const target = files.join(directory, name)
        if (files.exists(target) && !files.delete(target)) {
          throw new MangaJaNaiIoError(tr('无法替换完整模型'))
        }
        if (!files.rename(files.join(directory, `${name}.part`), target)) {
          throw new MangaJaNaiIoError(tr('无法保存完整模型'))
        }
      }
    } finally {
      // Kotlin L125-127 `finally { for (name in expected.keys + listOf(...)) File(…).delete() }`
      for (const name of [...expected.keys(), ...MANGA_JANAI_FULL_PACK_META]) {
        files.delete(files.join(directory, `${name}.part`))
      }
    }
  }

  /**
   * Kotlin L129-158 `private fun model(): File`。
   *
   * 两级来源：优先离线包（Zip，含 ncnn 的 param/bin 供 GPU 用），失败退回单文件 ONNX
   * （先看本地已有副本 `mangajanai/2x-1200p-v1.onnx`，再走网络）。1 小时节流一次。
   */
  model(): string {
    const host = this.requireHost()
    const files = host.files
    const directory = files.join(files.filesDir, MANGA_JANAI_FULL_DIRECTORY)
    files.mkdirs(directory)
    const onnx = files.join(directory, MANGA_JANAI_FULL_ONNX_FILE)
    const valid =
      this.stamp === this.fileStamp(onnx) ||
      this.verified(onnx, MANGA_JANAI_FULL_MODEL_BYTES, MANGA_JANAI_FULL_SHA256)
    const prefs = this.prefs()
    const nowMs = Math.trunc(host.now() / 1e6)
    const retryAllowed = nowMs - prefs.getLong('lastAttempt', 0) >= MANGA_JANAI_FULL_RETRY_INTERVAL_MS
    if (valid && (this.verifyNative(directory) || !retryAllowed)) {
      this.stamp = this.fileStamp(onnx)
      return directory
    }
    const archive = files.join(directory, MANGA_JANAI_FULL_ARCHIVE_PART)
    try {
      this.report(tr('完整模型首次下载…'))
      prefs.putLong('lastAttempt', nowMs)
      try {
        this.download(MANGA_JANAI_FULL_PACK_URL, archive, MANGA_JANAI_FULL_PACK_LIMIT)
        this.report(tr('模型校验中…'))
        this.unpack(archive, directory)
      } catch (error) {
        if (!(error instanceof MangaJaNaiIoError)) throw error
        this.cancelled()
        host.log.w('MangaJaNaiFull', 'Model pack unavailable; trying original CPU weights', error)
        if (valid) {
          this.stamp = this.fileStamp(onnx)
          return directory
        }
        const part = files.join(directory, MANGA_JANAI_FULL_ONNX_PART)
        try {
          const previous = files.join(files.filesDir, MANGA_JANAI_FULL_PREVIOUS_ONNX)
          if (this.verified(previous, MANGA_JANAI_FULL_MODEL_BYTES, MANGA_JANAI_FULL_SHA256)) {
            const source = files.openRead(previous)
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
          } else {
            this.download(MANGA_JANAI_FULL_MODEL_URL, part, MANGA_JANAI_FULL_MODEL_BYTES)
          }
          if (!this.verified(part, MANGA_JANAI_FULL_MODEL_BYTES, MANGA_JANAI_FULL_SHA256)) {
            throw new MangaJaNaiIoError(tr('完整模型校验失败'))
          }
          if (files.exists(onnx) && !files.delete(onnx)) {
            throw new MangaJaNaiIoError(tr('无法替换完整模型'))
          }
          if (!files.rename(part, onnx)) throw new MangaJaNaiIoError(tr('无法保存完整模型'))
        } finally {
          files.delete(part)
        }
      }
      this.stamp = this.fileStamp(onnx)
      return directory
    } finally {
      files.delete(archive)
    }
  }

  /**
   * Kotlin L159-235 `fun enhance(source: Bitmap, strength: Float): Bitmap`。
   *
   * 与 mobile 档的差别（逐条照抄）：
   *   • 不降采样神经输入，切片直接取自**原始分辨率**；
   *   • 强度是「原图像素 → 网络像素」的线性混合（不是残差相加）；
   *   • 输出由每片的缩放矩形拼接（`x*sx` …），`sx = width/source.width`。
   */
  enhance(source: PixImage, strength: number): PixImage {
    const host = this.requireHost()
    this.lock.lock()
    try {
      MangaJaNai.release() // single shared lock, one resident neural model across both modes
      this.generation += 1
      this.idle?.()
      this.idle = null
      this.cancelled()
      const started = host.now()
      const directory = this.model()
      let engine = this.runtime
      if (engine === null) {
        engine = new MangaJaNaiFullRuntime({
          device: host.device,
          prefs: host.prefs,
          sessions: host.sessions,
          scheduler: host.scheduler,
          gpu: host.gpu,
          files: host.files,
          now: host.now,
          isCancelled: host.isCancelled,
          log: host.log,
          verifyNative: (dir: string) => this.verifyNative(dir),
          modelSha256: MANGA_JANAI_FULL_SHA256,
        })
        this.runtime = engine
      }
      this.report(tr('完整引擎准备中…'))
      // Kotlin L168-174：探针用「偏好切片」的真实首片数据。
      const probeTile = mangaJaNaiFullPreferredTile(host.device.maxMemoryBytes)
      const probeSide = probeTile + MANGA_JANAI_FULL_HALO * 2
      const probePixels = new Int32Array(probeSide * probeSide)
      readTileFromPix(source, 0, 0, probePixels, probeTile, MANGA_JANAI_FULL_HALO)
      engine.prepare(directory, packTile(probePixels))
      const tileSize = engine.tile
      const side = tileSize + MANGA_JANAI_FULL_HALO * 2
      const area = side * side
      const coreSide = tileSize * 2
      const coreArea = coreSide * coreSide
      if (this.cacheCore !== tileSize) {
        this.tileCache.clear()
        this.cacheCore = tileSize
      }
      const input = new Float32Array(area * 3)
      const outputBuffer = new Float32Array(area * 12)
      const sourceTile = new Int32Array(area)
      const coreValues = new Float32Array(coreArea * 3)
      const pixels = new Uint32Array(coreArea)
      const [width, height] = mangaJaNaiOutputSize(source.width, source.height)
      const output: PixImage = { width, height, data: new Uint32Array(width * height) }
      const tileImage: PixImage = { width: coreSide, height: coreSide, data: pixels }
      const sx = width / source.width
      const sy = height / source.height
      const total =
        Math.trunc((source.width + tileSize - 1) / tileSize) *
        Math.trunc((source.height + tileSize - 1) / tileSize)
      let completed = 0
      let inferred = 0
      const blend = clamp(strength, 0, 1)
      for (let y = 0; y < source.height; y += tileSize) {
        for (let x = 0; x < source.width; x += tileSize) {
          this.cancelled()
          readTileFromPix(source, x, y, sourceTile, tileSize, MANGA_JANAI_FULL_HALO)
          const cached = this.tileCache.find(sourceTile)
          let core: Float32Array
          if (cached !== null) {
            core = cached
          } else {
            packInto(sourceTile, input)
            engine.run(directory, input, outputBuffer, side)
            inferred += 1
            for (let c = 0; c <= 2; c += 1) {
              for (let row = 0; row < coreSide; row += 1) {
                const from =
                  c * area * 4 +
                  (row + MANGA_JANAI_FULL_HALO * 2) * side * 2 +
                  MANGA_JANAI_FULL_HALO * 2
                coreValues.set(
                  outputBuffer.subarray(from, from + coreSide),
                  c * coreArea + row * coreSide,
                )
              }
            }
            this.tileCache.put(sourceTile, coreValues)
            core = coreValues
          }
          const tw = Math.min(tileSize, source.width - x) * 2
          const th = Math.min(tileSize, source.height - y) * 2
          for (let row = 0; row < th; row += 1) {
            for (let col = 0; col < tw; col += 1) {
              const i = row * coreSide + col
              // Kotlin L202：原图像素取 core 对应位置（÷2 回到源坐标 + halo 偏移）。
              const original =
                (sourceTile[
                  (Math.trunc(row / 2) + MANGA_JANAI_FULL_HALO) * side +
                    Math.trunc(col / 2) +
                    MANGA_JANAI_FULL_HALO
                ] ?? 0) | 0
              const channel = (c: number): number => {
                const from = (original >>> ((2 - c) * 8)) & 255
                const value = core[c * coreArea + i] ?? 0
                if (!Number.isFinite(value)) {
                  throw new MangaJaNaiIoError(tr('完整增强输出无效'))
                }
                const to = clamp(value, 0, 1) * 255
                return clamp(roundToInt(from + (to - from) * blend), 0, 255)
              }
              pixels[i] =
                ((original & 0xff000000) |
                  (channel(0) << 16) |
                  (channel(1) << 8) |
                  channel(2)) >>>
                0
            }
          }
          // Kotlin L212-213：先落到 coreSide×coreSide 的 tile，再按缩放矩形拼接。
          drawPixTileFiltered(
            output,
            tileImage,
            tw,
            th,
            x * sx,
            y * sy,
            (x + tw / 2) * sx,
            (y + th / 2) * sy,
          )
          completed += 1
          this.report(mangaJaNaiFullEnhanceProgress(Math.trunc((completed * 100) / total)))
        }
      }
      this.report('')
      host.log.i(
        'MangaJaNaiFull',
        `engine=${engine.name} page=${source.width}x${source.height} core=${tileSize} tiles=${total} inferred=${inferred} totalMs=${Math.trunc((host.now() - started) / 1e6)}`,
      )
      return output
    } catch (error) {
      this.runtime?.close()
      this.runtime = null
      this.tileCache.clear()
      this.cacheCore = 0
      this.report(error instanceof MangaJaNaiCancelledError ? '' : tr('完整增强失败，点击重试'))
      if (error instanceof MangaJaNaiLinkageError) {
        throw new MangaJaNaiIoError(tr('当前设备无法加载完整增强'))
      }
      throw error
    } finally {
      try {
        const expected = this.generation
        this.idle = host.scheduler.schedule(MANGA_JANAI_IDLE_RELEASE_MS, () => {
          // Kotlin L229-232：经 `cleanup`（单线程）再 `tryLock`，不能与内存压力清理交叉。
          this.cleanup.execute(() => {
            if (!MangaJaNai.lock.tryLock()) return
            try {
              if (this.generation === expected) {
                this.runtime?.close()
                this.runtime = null
                this.tileCache.clear()
                this.cacheCore = 0
              }
            } finally {
              MangaJaNai.lock.unlock()
            }
          })
        })
      } finally {
        this.lock.unlock()
      }
    }
  }
}

/* ══════════════════════ NCHW 打包（Kotlin L236-245） ══════════════════════════════ */

/** Kotlin L237-245 `private fun pack(pixels: IntArray, buffer: ByteBuffer)` 的独立形态。 */
function packTile(pixels: Int32Array): Float32Array {
  const packed = new Float32Array(pixels.length * 3)
  packInto(pixels, packed)
  return packed
}

/** 把 ARGB 切片打成 `1×3×N×N` 的归一化浮点（R 平面 / G 平面 / B 平面依次排列）。 */
function packInto(pixels: Int32Array, out: Float32Array): void {
  const area = pixels.length
  for (let i = 0; i < area; i += 1) {
    const p = pixels[i] ?? 0
    out[i] = ((p >>> 16) & 255) / 255
    out[area + i] = ((p >>> 8) & 255) / 255
    out[area * 2 + i] = (p & 255) / 255
  }
}

/** Kotlin `internal object MangaJaNaiFull` 的单例。 */
export const MangaJaNaiFull = new MangaJaNaiFullState()
