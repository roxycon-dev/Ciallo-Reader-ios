/**
 * comicStreamPreview.tsx — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicStreamPreview.kt`（115 行 / 非空 109 行）。
 *
 * Request-local JPEG preview: no second request, no partial bytes in the final cache.
 * （请求内 JPEG 预览：不发第二次请求，不把半截字节写进最终缓存。）
 *
 * 本文件是**纯逻辑 + 解码器端口**模块，不含 Compose UI，因此没有 JSX；
 * 仍是 `.tsx` 以与「每个 Kotlin 文件一个 .tsx」的约定对齐（文件名保持 camelCase 对应）。
 *
 * Kotlin 行号 → TS 对照：
 *   L1-L14   import（Bitmap / BitmapFactory / Matrix / ExifInterface / CoroutineScope /
 *            Dispatchers / Job / okio.Buffer / ByteArrayInputStream / AtomicBoolean / Semaphore）
 *            → 见「跳过说明」
 *   L16      KDoc「Request-local JPEG preview…」→ 保留
 *   L17-L20  internal class ComicStreamPreview(scope, publish) → 同名 class（端口注入版）
 *   L21-L24  companion object { decodeGate = Semaphore(1); MAX_PREFIX = 2 * 1024 * 1024 }
 *            → 模块级 decodeGate + MAX_PREFIX
 *   L25-L28  closed / rejected / nextBytes = 16L * 1024 / job → 同名私有字段
 *   L30      KDoc「Called by the download thread; decoding runs separately and never blocks
 *            the socket.」→ 保留
 *   L31-L47  fun offer(buffer: Buffer) → offer(buffer: Uint8Array)
 *   L32      门卫：closed / rejected / 缓冲不足 / 超过 MAX_PREFIX / 已有活跃 job → return
 *   L33-L36  JPEG SOI 校验（0xFF 0xD8），不过则 rejected = true 并丢弃
 *   L37      `if (!decodeGate.tryAcquire()) return` → 同名 tryAcquire
 *   L38      `val bytes = buffer.clone().readByteArray(minOf(buffer.size, MAX_PREFIX))`
 *            → 前缀快照（Uint8Array.slice），保证不与下载缓冲共享内存
 *   L39      `nextBytes = maxOf(nextBytes * 2, bytes.size + 1)` → 逐字移植
 *   L40      KDoc「A queued coroutine may be cancelled before it starts: its completion hook
 *            owns the permit.」→ 保留（finally 归还许可）
 *   L41-L46  scope.launch(Dispatchers.Default) { decode → publish } + invokeOnCompletion 释放许可
 *            → 注入的调度器（默认微任务）+ finally 释放许可
 *   L45      `catch (_: Exception) { … }`（原注释：Unsupported/truncated input stays on
 *            the normal full-image path.）→ try/catch 吞掉（注释原文保留）
 *   L49      fun close() { closed.set(true); job?.cancel() } → 逐行移植
 *   L51-L73  internal fun decode(bytes): Bitmap? → decode(bytes): Promise<string | null>
 *            （通过注入的解码器端口；几何/采样算法在本文件内逐行保留）
 *   L76      KDoc「Keep only COMPLETE entropy scans of progressive JPEGs. Baseline partial
 *            pages are rejected.」→ 保留
 *   L77-L115 internal fun completeProgressiveScan(bytes, onBaseline = {}) → 同名函数，逐行移植
 *
 * 跳过说明：
 *   · `android.graphics.Bitmap`（L20/L51/L59/L72）→ **注入的解码器端口**
 *     `ComicPreviewDecoder`：返回可放进 `<img src>` 的 URL（dataURL / objectURL）。
 *     调用方（ComicPageLoader 的负责人）提供真实解码（`<img>` + `createImageBitmap`）。
 *   · `BitmapFactory.Options{inJustDecodeBounds}` + `BitmapFactory.decodeByteArray`
 *     （L53-L59）：Android 侧的边界探测与采样解码 → 由解码器端口承担；
 *     但**采样倍数算法逐行保留**在本文件的 `previewSampleSize()`（`720` 阈值、×2 递进），
 *     作为对解码器的显式提示（decode 把 bounds 交给端口，端口按此倍数降采样）。
 *   · `android.media.ExifInterface` + `Matrix`（L60-L72）：Web 端 `<img>` / `createImageBitmap`
 *     默认已按 EXIF 方向呈现，浏览器端无需手工 `postScale/postRotate`。
 *     EXIF 常量表（2/3/4/5/6/7/8 → 翻转/旋转组合）保留为 `EXIF_ORIENTATION_NOTE` 常量表，
 *     供需要自己实现解码的适配层对照，不静默丢弃语义。
 *   · `okio.Buffer`（L20/L31/L38）：okio 的可增长缓冲 → `Uint8Array` 前缀。
 *     `buffer.size` → `buffer.length`；`buffer[0]` → `buffer[0]`（同义）；
 *     `buffer.clone().readByteArray(min(size, MAX_PREFIX))` → `buffer.slice(0, min(length, MAX_PREFIX))`
 *     （slice 是拷贝，与 clone 语义一致）。注意：下载线程若在 `Uint8Array` 尾部追加，
 *     必须走 `offer` 的新前缀快照，本类不会原地改写入参。
 *   · `CoroutineScope` + `Dispatchers.Default` + `Job`（L18/L41/L49）：
 *     → 注入的 `ComicPreviewScheduler`（`schedule(task): { cancel(): void }`）。
 *     默认实现走 `queueMicrotask`；解码本身是异步的（端口返回 Promise），
 *     故不阻塞调用线程 —— 与 Kotlin「never blocks the socket」一致。
 *   · `java.util.concurrent.atomic.AtomicBoolean`（L25-L26）：JS 单线程事件循环，
 *     读改写不会被打断 → 普通 `boolean` 字段（语义等价）。
 *   · `java.util.concurrent.Semaphore(1)`（L22）+ `tryAcquire()` / `release()`：
 *     → 模块级单许可门（同 core/comic/comicLoadSupport.ts 里 ComicMutex 的思路）。
 *     许可由**完成钩子**归还（Kotlin L40 注释要求的取消安全），Web 端用 `finally`。
 *
 * 适配说明：
 *   · Kotlin `ByteArray` → `Uint8Array`；`bytes[i].toInt() and 255` → `bytes[i]! & 0xff`。
 *   · Kotlin `Long`（`nextBytes`）→ `number`；`16L * 1024` = 16384 原样保留。
 *   · `2 * 1024 * 1024`（MAX_PREFIX）原样保留。
 *   · `minOf` / `maxOf` → `Math.min` / `Math.max`。
 */

//
// ── 解码器端口（Android Bitmap 的注入式替代）
//

/** 解码后的预览图：可直接喂给 `<img src>` 的 URL（dataURL 或 objectURL）。 */
export interface ComicPreviewDecodedImage {
  readonly src: string
  readonly width: number
  readonly height: number
}

/** 图片边界信息（Android `BitmapFactory.Options.outWidth/outHeight`）。 */
export interface ComicPreviewBounds {
  readonly width: number
  readonly height: number
}

/**
 * Android `BitmapFactory` + `ExifInterface` + `Matrix` 的注入端口。
 * 实现方负责：按 `bounds` 提示降采样、按 EXIF 方向摆正、产出可显示的 URL。
 */
export interface ComicPreviewDecoder {
  /** `BitmapFactory.Options{inJustDecodeBounds = true}; decodeByteArray(…, bounds)`（L53-L55） */
  bounds(bytes: Uint8Array): Promise<ComicPreviewBounds | null>
  /** `BitmapFactory.decodeByteArray(prefix, 0, prefix.size, options)`（L58-L59） */
  decode(
    bytes: Uint8Array,
    options: { inSampleSize: number; inPreferredConfig: 'ARGB_8888' },
  ): Promise<ComicPreviewDecodedImage | null>
  /** `ExifInterface.TAG_ORIENTATION`（L62）——实现方据此摆正方向。 */
  orientation(bytes: Uint8Array): Promise<number>
}

/** 调度器端口（Android `CoroutineScope` + `Dispatchers.Default`）。 */
export interface ComicPreviewScheduleHandle {
  cancel(): void
}

/** Android `CoroutineScope.launch(Dispatchers.Default) { }` 的等价端口。 */
export type ComicPreviewScheduler = (task: () => Promise<void>) => ComicPreviewScheduleHandle

/** 默认调度器：微任务队列（解码是 async，不会阻塞 socket）。 */
export const microTaskComicPreviewScheduler: ComicPreviewScheduler = (task) => {
  let cancelled = false
  queueMicrotask(() => {
    if (!cancelled) void task()
  })
  return {
    cancel: () => {
      cancelled = true
    },
  }
}

//
// ── L21-L24  companion object
//

/** `private val decodeGate = Semaphore(1)`（L22）——全局单许可（同 Kotlin 的 companion 级）。 */
let decodeGateHeld = false
function decodeGateTryAcquire(): boolean {
  if (decodeGateHeld) return false
  decodeGateHeld = true
  return true
}
function decodeGateRelease(): void {
  decodeGateHeld = false
}

/** `private const val MAX_PREFIX = 2 * 1024 * 1024`（L23）。 */
export const MAX_PREFIX = 2 * 1024 * 1024

/** ── Android L57-L59 的降采样倍数算法（供解码器端口按此提示降采样） ── */
/** `while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 720) sample *= 2`（L56-L57）。 */
export function previewSampleSize(width: number, height: number): number {
  let sample = 1
  while (Math.max(width, height) / sample > 720) sample *= 2
  return sample
}

/**
 * Android L60-L72 的 EXIF 方向映射表（保留语义，供实现解码器的适配层对照）。
 * Kotlin `Matrix` 组合 → Web 端 `<img>` / `createImageBitmap` 已自动摆正，
 * 故此处只作为**可核对的常量表**导出，不再驱动任何变换计算。
 */
export const EXIF_ORIENTATION_NOTE: Readonly<Record<number, string>> = {
  2: 'matrix.setScale(-1f, 1f)',
  3: 'matrix.setRotate(180f)',
  4: 'matrix.setRotate(180f); matrix.postScale(-1f, 1f)',
  5: 'matrix.setRotate(90f); matrix.postScale(-1f, 1f)',
  6: 'matrix.setRotate(90f)',
  7: 'matrix.setRotate(-90f); matrix.postScale(-1f, 1f)',
  8: 'matrix.setRotate(-90f)',
}

//
// ── L17-L74  internal class ComicStreamPreview
//

export interface ComicStreamPreviewOptions {
  /** 发布解码结果（Android `publish: (Bitmap) -> Unit`）。 */
  readonly publish: (image: ComicPreviewDecodedImage) => void
  /** Android `scope: CoroutineScope` + `Dispatchers.Default`。 */
  readonly scheduler?: ComicPreviewScheduler
  /** Android `BitmapFactory` / `ExifInterface` 的注入端口。 */
  readonly decoder: ComicPreviewDecoder
}

/** Request-local JPEG preview: no second request, no partial bytes in the final cache. */
export class ComicStreamPreview {
  private readonly publish: (image: ComicPreviewDecodedImage) => void
  private readonly scheduler: ComicPreviewScheduler
  private readonly decoder: ComicPreviewDecoder
  /** ── Android L25 ── */ private closed = false
  /** ── Android L26 ── */ private rejected = false
  /** ── Android L27: `private var nextBytes = 16L * 1024` ── */ private nextBytes = 16 * 1024
  /** ── Android L28: `private var job: Job?` ── */ private job: ComicPreviewScheduleHandle | null = null

  constructor(options: ComicStreamPreviewOptions) {
    this.publish = options.publish
    this.scheduler = options.scheduler ?? microTaskComicPreviewScheduler
    this.decoder = options.decoder
  }

  /** Called by the download thread; decoding runs separately and never blocks the socket. */
  offer(buffer: Uint8Array): void {
    // ── Android L32: 门卫（六个条件全部短路） ──
    if (this.closed || this.rejected || buffer.length < this.nextBytes || this.nextBytes > MAX_PREFIX) return
    if (this.job !== null) return

    // ── Android L33-L36: JPEG SOI 校验（0xFF 0xD8） ──
    if (
      buffer.length >= 2 &&
      (((buffer[0] as number) & 255) !== 255 || ((buffer[1] as number) & 255) !== 216)
    ) {
      this.rejected = true
      return
    }

    // ── Android L37: `if (!decodeGate.tryAcquire()) return` ──
    if (!decodeGateTryAcquire()) return

    // ── Android L38: 前缀快照（不与下载缓冲共享内存） ──
    const bytes = buffer.slice(0, Math.min(buffer.length, MAX_PREFIX))
    // ── Android L39: nextBytes = maxOf(nextBytes * 2, bytes.size + 1) ──
    this.nextBytes = Math.max(this.nextBytes * 2, bytes.length + 1)

    // ── Android L40: 排队的协程可能在启动前被取消：许可归完成钩子所有 ──
    // ── Android L41-L46 ──
    this.job = this.scheduler(async () => {
      try {
        // ── Android L43: `val bmp = decode(bytes) ?: return@launch` ──
        const bmp = await this.decode(bytes)
        if (bmp === null) return
        // ── Android L44: `if (!closed.get()) publish(bmp)` ──
        if (!this.closed) this.publish(bmp)
      } catch {
        /* Unsupported/truncated input stays on the normal full-image path. */
      } finally {
        // Kotlin L46: `.also { it.invokeOnCompletion { decodeGate.release() } }`
        decodeGateRelease()
        this.job = null
      }
    })
  }

  /** ── Android L49: `fun close() { closed.set(true); job?.cancel() }` ── */
  close(): void {
    this.closed = true
    this.job?.cancel()
    this.job = null
  }

  /**
   * ── Android L51-L73: `internal fun decode(bytes: ByteArray): Bitmap?` ──
   * Web 端解码委托给注入的端口；前缀裁剪、边界校验与采样倍数算法保持逐行一致。
   */
  private async decode(bytes: Uint8Array): Promise<ComicPreviewDecodedImage | null> {
    // ── L52: `val prefix = completeProgressiveScan(bytes) { rejected.set(true) } ?: return null` ──
    const prefix = completeProgressiveScan(bytes, () => {
      this.rejected = true
    })
    if (prefix === null) return null

    // ── L53-L55: 边界探测 ──
    const bounds = await this.decoder.bounds(prefix)
    if (bounds === null) return null
    if (bounds.width <= 0 || bounds.height <= 0) return null

    // ── L56-L57: 采样倍数 ──
    const sample = previewSampleSize(bounds.width, bounds.height)

    // ── L58-L59: `inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888` ──
    return this.decoder.decode(prefix, { inSampleSize: sample, inPreferredConfig: 'ARGB_8888' })
  }
}

//
// ── L76-L115  completeProgressiveScan
//

/** Keep only COMPLETE entropy scans of progressive JPEGs. Baseline partial pages are rejected. */
export function completeProgressiveScan(
  bytes: Uint8Array,
  // Android L77 的默认参数 `onBaseline: () -> Unit = {}` 是**空 lambda**（可调用），
  // TS 不能用 `{}`（那是个对象字面量，调用会抛 TypeError）。
  onBaseline: () => void = (): void => {},
): Uint8Array | null {
  // ── Android L78: `fun u(i: Int) = bytes[i].toInt() and 255` ──
  const u = (i: number): number => (bytes[i] as number) & 255

  // ── L79: SOI 校验 ──
  if (bytes.length < 4 || u(0) !== 255 || u(1) !== 216) return null

  let progressive = false
  let scan = false
  let completedEnd = -1
  let pos = 2

  // ── L84: `while (pos + 1 < bytes.size)` ──
  while (pos + 1 < bytes.length) {
    if (scan) {
      // ── L86-L94: 熵编码段内的字节跳过 + 标记前缀处理 ──
      if (u(pos) !== 255) {
        pos++
        continue
      }
      let codeAt = pos + 1
      // ── L88: `while (codeAt < bytes.size && u(codeAt) == 255) codeAt++` ──
      while (codeAt < bytes.length && u(codeAt) === 255) codeAt++
      if (codeAt >= bytes.length) break
      const marker = u(codeAt)
      // ── L91: `if (marker == 0 || marker in 208..215) { pos = codeAt + 1; continue }` ──
      if (marker === 0 || (marker >= 208 && marker <= 215)) {
        pos = codeAt + 1
        continue
      }
      // ── L92-L93: 段结束 → 记录完整段末尾、退出熵编码状态 ──
      completedEnd = pos
      scan = false
    }

    // ── L95: `if (u(pos) != 255) break` ──
    if (u(pos) !== 255) break

    let codeAt = pos + 1
    // ── L97: 跳过连续的 0xFF 填充 ──
    while (codeAt < bytes.length && u(codeAt) === 255) codeAt++
    if (codeAt >= bytes.length) break
    const marker = u(codeAt)

    // ── L100: `if (marker == 217) break` ──
    if (marker === 217) break
    // ── L101: `if (marker == 194) progressive = true` ──
    if (marker === 194) progressive = true
    // ── L102: `if (marker == 192 || marker == 193) { onBaseline(); return null }` ──
    if (marker === 192 || marker === 193) {
      onBaseline()
      return null
    }

    // ── L103-L104: 段长度字段存在性 ──
    const lengthAt = codeAt + 1
    if (lengthAt + 1 >= bytes.length) break
    // ── L105: `val length = (u(lengthAt) shl 8) or u(lengthAt + 1)` ──
    const length = (u(lengthAt) << 8) | u(lengthAt + 1)
    // ── L106: `if (length < 2 || lengthAt + length > bytes.size) break` ──
    if (length < 2 || lengthAt + length > bytes.length) break
    // ── L107: `pos = lengthAt + length` ──
    pos = lengthAt + length
    // ── L108: `if (marker == 218) scan = true` ──
    if (marker === 218) scan = true
  }

  // ── L110: `if (!progressive || completedEnd < 0) return null` ──
  if (!progressive || completedEnd < 0) return null

  // ── L111-L114: 截到最后一个完整熵编码段，并把 EOI 标记写回 ──
  const out = bytes.slice(0, completedEnd + 2)
  out[completedEnd] = 255
  out[completedEnd + 1] = 217
  return out
}
