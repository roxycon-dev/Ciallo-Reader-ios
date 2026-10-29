/**
 * comicPixOps.ts — SHARED SUPPORT FILE (not a 1:1 Kotlin mapping)
 *
 * The rasterisation seam (`PixImage` / `PixCodec` / `StripeRunner`) plus the three
 * numeric helpers that must behave identically in every consumer of it. It lives
 * apart from `comicImagePipeline.ts` purely to keep the module graph acyclic:
 *
 *   comicPixOps  ←─ comicImagePipeline  ←─ anime4KCnn
 *        ↑                ↑                   ↑
 *   comicPageLoader   comicHarismCurl      (anime4KCnnWeights)
 *
 * EVERY method below corresponds to exactly one Android graphics call; the concrete
 * adapter (OffscreenCanvas / ImageData / ImageBitmap / react-native-skia / a pure-JS
 * reference implementation for tests) is NOT part of src/core and is not written here.
 */

import type { RectF } from './comicPortTypes'

/**
 * A rasterised page. `data` is row-major packed 0xAARRGGBB (Bitmap.Config.ARGB_8888
 * semantics), owned by whoever produced it — never mutated in place by this module.
 */
export interface PixImage {
  readonly width: number
  readonly height: number
  readonly data: Uint32Array
}

/** Rasterisation seam. Every method mirrors exactly one Android Bitmap/Canvas call. */
export interface PixCodec {
  /** `Bitmap.createBitmap(w, h, ARGB_8888)` + `setPixels(pixels, 0, w, 0, 0, w, h)` */
  createBitmap(w: number, h: number, pixels: Uint32Array): PixImage
  /** `Bitmap.createScaledBitmap(src, w, h, true)` */
  createScaledBitmap(src: PixImage, w: number, h: number): PixImage
  /** `Bitmap.createBitmap(src, x, y, w, h)` */
  createBitmapRegion(src: PixImage, x: number, y: number, w: number, h: number): PixImage
  /** `Bitmap.createBitmap(src, 0, 0, src.width, src.height, Matrix(postRotate(deg)), true)` */
  createBitmapRotated(src: PixImage, degrees: number): PixImage
  /** `Canvas.drawBitmap(src, 0f, 0f, paint)` with an optional alpha paint */
  drawBitmap(dst: PixImage, src: PixImage, dx: number, dy: number, alpha?: number): void
  /** `Canvas.drawBitmap(src, null, RectF, paint)` — `filter` = `Paint.isFilterBitmap` */
  drawBitmapRect(
    dst: PixImage,
    src: PixImage,
    rect: RectF,
    alpha: number,
    filter: boolean,
  ): void
  /** `Canvas.drawBitmap(src, …, Paint(colorFilter = ColorMatrixColorFilter(m)))` */
  drawBitmapColorMatrix(dst: PixImage, src: PixImage, m: Float32Array): void
  /** `Bitmap.byteCount` */
  byteCount(src: PixImage): number
  /**
   * `Bitmap.createBitmap(src, 0, 0, w, h, Matrix().apply { setScale(-1f, 1f) }, true)`
   * Horizontal mirror — used to pre-mirror the CURL back-face texture.
   */
  createBitmapMirroredX(src: PixImage): PixImage
  /**
   * `canvas.scale(-1f, 1f, w/2, h/2)` for RTL renderer mirroring, and the matching
   * `canvas.reset()`. The draw calls that follow honour the active transform.
   */
  setMirrorX(dst: PixImage, enabled: boolean): void
}

/** `ComicImagePipeline.parallelStripes` execution backend. */
export type StripeRunner = (rows: number, body: (y0: number, y1: number) => void) => void

/**
 * Rasterisation + row-splitting bundle threaded through every pixel-level entry point.
 * `cnn` carries the parsed Anime4K networks — Kotlin reaches them through the
 * `object Anime4KCnn`'s `by lazy` delegates; here they are resolved once at app start
 * and passed down, which keeps every pixel kernel synchronous.
 */
export interface PixOps {
  readonly codec: PixCodec
  readonly stripes: StripeRunner
  /** Only the networks the current session's enhance mode needs; others may be empty. */
  readonly cnn?: {
    readonly restore: ReadonlyArray<CnnLayer>
    readonly upscale: ReadonlyArray<CnnLayer>
  }
}

/** Anime4K forward layer + group shape (declared here to keep the module graph acyclic). */
export interface CnnGroup {
  readonly tex: number
  readonly act: number
  readonly ox: number
  readonly oy: number
  readonly w: Float32Array
}

export interface CnnLayer {
  readonly groups: ReadonlyArray<CnnGroup>
  readonly bias: Float32Array
}

/**
 * `kotlin.math.roundToInt()` — JVM `Math.round(float)` = `floor(v + 0.5)`, i.e. ties
 * round towards **positive infinity**, which is exactly what JS `Math.round` does
 * (`Math.round(-2.5) === -2`). Do NOT "fix" this to `-Math.round(-v)`: that rounds
 * ties away from zero (`roundToInt(-2.5) === -3`) and disagrees with Kotlin.
 * (`src/core/mangatranslate/pageRegionTiling.ts` uses the plain `Math.round` form.)
 */
export function roundToInt(v: number): number {
  return Math.round(v)
}

/**
 * `kotlin.Float.toString()` for the cache-key templates (`ComicPageLoader.loadPreview`).
 * Kotlin's `Float.toString` always keeps a fractional part (`1.0f` → `"1.0"`), while
 * JS `String(1)` is `"1"`. Only the decimal representation matters here — the keys are
 * never shared with the Android build, but the template must stay verbatim so a value
 * round-trips to the same key on both sides.
 */
export function kotlinFloatToString(v: number): string {
  const s = String(v)
  return /[.eE]/.test(s) ? s : `${s}.0`
}

/** Kotlin `coerceIn(lo, hi)` for numbers. `lo <= hi` is assumed at every call site. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** `parallelStripes` 的串行后端：与 Kotlin 小任务回退路径逐行等价。 */
export const serialStripes: StripeRunner = (rows, body) => {
  body(0, rows)
}

/**
 * 行条带并行（第六轮第 5 条性能）：重像素核按行分片多核执行。调用约束：body 只写
 * [y0,y1) 行、只读共享输入（越界±1行读取安全——输入缓冲在处理期间不可变）。
 *
 * Kotlin's `Runtime.getRuntime().availableProcessors()` becomes an injected core count;
 * the default here reports 1 (synchronous, single-threaded), which routes every image
 * through the `rows < 768 || cores <= 1` serial cut-over — i.e. identical output, no
 * work-stealing. A worker-pool `StripeRunner` can be injected by the platform layer.
 */
export function defaultParallelStripes(rows: number, body: (y0: number, y1: number) => void): void {
  serialStripes(rows, body)
}

/**
 * Row-stripe splitter with an explicit core count — the literal Kotlin algorithm, for
 * callers that already know the core budget. Identical split points to Kotlin.
 */
export function stripedSplit(
  rows: number,
  cores: number,
  minChunk: number,
  body: (y0: number, y1: number) => void,
): void {
  // 小任务串行：协程调度开销在小图上会倒挂（实测 CAS 1000x1400 +135ms）
  if (rows < 768 || cores <= 1) {
    body(0, rows)
    return
  }
  const stripes = Math.min(cores, Math.trunc(rows / minChunk))
  if (stripes <= 1) {
    body(0, rows)
    return
  }
  const per = Math.trunc((rows + stripes - 1) / stripes)
  for (let i = 0; i < stripes; i++) {
    const y0 = i * per
    const y1 = Math.min(y0 + per, rows)
    if (y0 < y1) body(y0, y1)
  }
}

/** The exact Kotlin constant block (L101–103 of ComicImagePipeline.kt). */
export const STRIPE_MIN_CHUNK = 96
export const STRIPE_SERIAL_ROW_CUTOFF = 768