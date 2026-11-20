/**
 * mangaJaNaiMobile.ts  ←  novel-reader/app/src/main/java/com/example/ui/comic/MangaJaNaiMobile.kt
 *
 * Kotlin source: 75 lines / 57 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1-9     package + android.graphics imports   — package decl / imports         │
 * │ L11      doc comment                          — kept verbatim                 │
 * │ L12-23   `fun mangaMobileInputSize(...)`      — ported verbatim               │
 * │ L25-27   doc comment                          — kept verbatim                 │
 * │ L28-74   `fun combineMangaJaNaiDetail(...)`   — ported verbatim               │
 * └────────────────────────────────────────────────────────────────────────────────┘
 *
 * Doc comments kept verbatim:
 *   "Bounds neural work using measured tile throughput. Original page/detail never
 *    enters this cap."
 *   "Add the low-resolution network's correction to the full-detail original.
 *    Only two small row bands are allocated, rather than two more full-resolution pages."
 *
 * ADAPTATIONS
 * - `Bitmap` → `PixImage` (Uint32Array ARGB, row-major) — the same packing the rest
 *   of `core/comic` already uses (`comicPixOps.ts`).
 * - `Bitmap.createBitmap(w, h, ARGB_8888)` → `createPixImage(w, h)`.
 * - `Canvas.drawBitmap(src, null, dstRect, paint)` → `drawPixTileFiltered`：**双线性**
 *   (= `Paint.FILTER_BITMAP_FLAG`) + 边缘 clamp。Kotlin 在 mobile 路径上确实会缩放：
 *   `neuralInput` 是 `iw×ih`（可能已被 `mangaMobileInputSize` 缩小），
 *   `neuralOutput` 是 `2iw×2ih`，而 band 的坐标系是 `outputSize(src)` 的 `ow×oh`。
 *   旧版此处用「源/目标尺寸恒等」的最近邻近似，仅在 `iw == width` 时成立；
 *   现改为对任意比例都成立的采样（`MangaJaNai.kt` L227 传入的 `src`/`reduced`
 *   在大页预算下并不相等）。
 * - `Bitmap.getPixels(...)` / `setPixels(...)` → `Uint32Array` 子视图 + `set`。
 * - `Thread.currentThread().isInterrupted` → 注入的 `isCancelled()` 缝；
 *   `throw InterruptedException("MangaJaNai cancelled")` → 由调用方传入的
 *   `cancelled()` 工厂（`MangaJaNai.ts` 传 `MangaJaNaiCancelledError`），消息保持原样。
 * - `output.recycle()` on failure → the caller owns the buffer, so the port leaves
 *   it untouched and lets the caller drop the reference (GC-equivalent).
 * - Kotlin `(x).roundToInt()` rounds half **up** (toward +∞ for positives); JS
 *   `Math.round` rounds half **up** as well, so no correction is needed. Negative
 *   values never reach these calls: `width`/`height` are `coerceAtLeast(1)`.
 *
 * ADDED EXPORTS（`MangaJaNai.kt` / `MangaJaNaiFull.kt` 里由 `android.graphics.Bitmap`
 * 直接提供、Web 侧必须复用同一份实现的两个光栅化原语）:
 *   - `bilinearPixel` — `Canvas` 的 FILTER_BITMAP 采样核
 *   - `drawPixTileFiltered` — `Canvas.drawBitmap(src, srcRect, dstRect, paint)`
 */

import { clamp, roundToInt } from './comicPixOps';
import type { PixImage } from './comicPixOps';

/** Kotlin `MangaJaNai.TILE` (MangaJaNai.kt L31) — declared here to avoid a cycle. */
const TILE = 128;

/**
 * Kotlin L12-23 `fun mangaMobileInputSize(width, height, tileBudget): Pair<Int, Int>`.
 *
 * Two caps composed: an absolute pixel cap (`minOf(1.0, 1400/max(w,h))`) and an
 * area cap (`sqrt(900_000 / (w*h))`), then a shrink loop until the tile count fits
 * the budget. 初始尺寸是 `roundToInt()`（四舍五入），循环里每步的 `0.93` 才是
 * `toInt()`（截断）—— 两者不能混用：1400×1400/预算 512 时四舍五入得 949，截断得 948。
 */
export function mangaMobileInputSize(
  width: number,
  height: number,
  tileBudget: number,
): [number, number] {
  const scale = Math.min(
    1.0,
    1400.0 / Math.max(width, height),
    Math.sqrt(900_000.0 / (width * height)),
  );
  let w = Math.max(1, roundToInt(width * scale));
  let h = Math.max(1, roundToInt(height * scale));
  const tiles = Math.max(1, tileBudget);
  // Kotlin uses `Long` arithmetic for the tile product — a 64-bit multiply. JS
  // numbers are exact up to 2^53, and `w`/`h` are bounded by 1400, so the product
  // stays far inside the safe range and the comparison is identical.
  while ((Math.trunc((w + TILE - 1) / TILE) * Math.trunc((h + TILE - 1) / TILE)) > tiles) {
    w = Math.max(1, Math.trunc(w * 0.93));
    h = Math.max(1, Math.trunc(h * 0.93));
  }
  return [w, h];
}

/** Kotlin L32 `Bitmap.createBitmap(width, height, ARGB_8888)`. */
function createPixImage(width: number, height: number): PixImage {
  return { width, height, data: new Uint32Array(width * height) };
}

/**
 * `Canvas` + `Paint(FILTER_BITMAP_FLAG)` 的采样核：双线性，越界按最近边缘 clamp。
 *
 * @param src    像素源（行主序 `src.width` 为**跨距**）。
 * @param width  本次采样允许的源宽（切片时 < `src.width`，例如 `tw`）。
 * @param height 本次采样允许的源高。
 * @param fx     源坐标（可为小数，-0.5 表示目标像素中心对齐源像素中心）。
 */
export function bilinearPixel(
  src: PixImage,
  width: number,
  height: number,
  fx: number,
  fy: number,
): number {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = clamp(x0, 0, width - 1);
  const xb = clamp(x0 + 1, 0, width - 1);
  const ya = clamp(y0, 0, height - 1);
  const yb = clamp(y0 + 1, 0, height - 1);
  const p00 = src.data[ya * src.width + xa] ?? 0;
  const p10 = src.data[ya * src.width + xb] ?? 0;
  const p01 = src.data[yb * src.width + xa] ?? 0;
  const p11 = src.data[yb * src.width + xb] ?? 0;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const channel = (shift: number): number => {
    const value =
      ((p00 >>> shift) & 255) * w00 +
      ((p10 >>> shift) & 255) * w10 +
      ((p01 >>> shift) & 255) * w01 +
      ((p11 >>> shift) & 255) * w11;
    return clamp(roundToInt(value), 0, 255);
  };
  return (
    ((channel(24) << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0)) >>> 0
  );
}

/**
 * `Canvas.drawBitmap(src, srcRect(0,0,srcWidth,srcHeight), dstRect, Paint(FILTER_BITMAP_FLAG))`.
 *
 * 目标像素中心反查源坐标；`dstRect` 超出目标位图的部分被裁掉（Android 同样裁）。
 * 源矩形只取 `[0, srcWidth) × [0, srcHeight)`，跨距仍是 `src.width`。
 */
export function drawPixTileFiltered(
  dst: PixImage,
  src: PixImage,
  srcWidth: number,
  srcHeight: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  const dstWidth = right - left;
  const dstHeight = bottom - top;
  if (!(dstWidth > 0) || !(dstHeight > 0) || srcWidth <= 0 || srcHeight <= 0) return;
  const x0 = Math.max(0, Math.ceil(left - 0.5));
  const x1 = Math.min(dst.width, Math.ceil(right - 0.5));
  const y0 = Math.max(0, Math.ceil(top - 0.5));
  const y1 = Math.min(dst.height, Math.ceil(bottom - 0.5));
  const scaleX = srcWidth / dstWidth;
  const scaleY = srcHeight / dstHeight;
  for (let dy = y0; dy < y1; dy += 1) {
    const fy = (dy + 0.5 - top) * scaleY - 0.5;
    for (let dx = x0; dx < x1; dx += 1) {
      const fx = (dx + 0.5 - left) * scaleX - 0.5;
      dst.data[dy * dst.width + dx] = bilinearPixel(src, srcWidth, srcHeight, fx, fy);
    }
  }
}

/** Kotlin L32 `Bitmap.createBitmap(width, height, ARGB_8888)`. */
/** Kotlin L37 `Canvas(output).drawBitmap(original, null, RectF(0,0,w,h), paint)`. */
export function resampleInto(dst: PixImage, src: PixImage, width: number, height: number): void {
  drawPixTileFiltered(dst, src, src.width, src.height, 0, 0, width, height);
}

/**
 * Kotlin L28-74 `fun combineMangaJaNaiDetail(...)`.
 *
 * Adds the low-resolution network's per-channel correction back onto the
 * full-detail original, band by band, so only two `width × min(48, height)`
 * scratch buffers are ever alive.
 *
 * @param isCancelled 宿主取消缝（对应 `Thread.currentThread().isInterrupted`）。
 * @param cancelled   取消时抛出的错误工厂（Kotlin `InterruptedException("MangaJaNai cancelled")`）。
 */
export function combineMangaJaNaiDetail(
  original: PixImage,
  neuralInput: PixImage,
  neuralOutput: PixImage,
  width: number,
  height: number,
  strength: number,
  isCancelled: () => boolean = () => false,
  cancelled: () => Error = () => new Error('MangaJaNai cancelled'),
): PixImage {
  const output = createPixImage(width, height);
  const bandHeight = Math.min(48, height);
  if (strength <= 0) {
    // Kotlin L37-38: draw the original (scaled to width×height) and return early.
    resampleInto(output, original, width, height);
    return output;
  }

  const low = createPixImage(width, bandHeight);
  const ai = createPixImage(width, bandHeight);
  const blend = Math.min(Math.max(strength, 0), 1);

  // Kotlin L37 — 底图：原图缩放到 width×height
  resampleInto(output, original, width, height);

  // Kotlin L72 `catch { output.recycle(); throw error }` 在端口里无需等价物：
  // 缓冲区由调用方持有，异常原样上抛（取消错误由 `cancelled()` 决定）。
  for (let y = 0; y < height; y += bandHeight) {
    if (isCancelled()) {
      throw cancelled();
    }
    const rows = Math.min(bandHeight, height - y);

    // Kotlin L51-52 `eraseColor(Color.TRANSPARENT)`
    low.data.fill(0);
    ai.data.fill(0);

    // Kotlin L53-55 — 把 neuralInput / neuralOutput 的第 y 行带画进 band。
    // `RectF(0, -y, width, height - y)` 表示源整体上移 y 像素，故源的第 y 行
    // 落在 band 的第 0 行；采样核 = FILTER_BITMAP_FLAG（双线性）。
    drawPixTileFiltered(low, neuralInput, neuralInput.width, neuralInput.height, 0, -y, width, height - y);
    drawPixTileFiltered(ai, neuralOutput, neuralOutput.width, neuralOutput.height, 0, -y, width, height - y);

    // Kotlin L56-58 — 读回 detail / low / ai 三段像素
    const detail = output.data.subarray(y * width, y * width + width * rows);
    const lowBand = low.data.subarray(0, width * rows);
    const aiBand = ai.data.subarray(0, width * rows);

    // Kotlin L59-68 — 逐像素：保留 alpha，按通道叠加 (ai - low) * blend
    for (let i = 0; i < width * rows; i += 1) {
      let pixel = (detail[i] as number) & -0x1000000;
      for (let channel = 0; channel <= 2; channel += 1) {
        const shift = 16 - channel * 8;
        const from = ((detail[i] as number) >>> shift) & 255;
        const delta = (((aiBand[i] as number) >>> shift) & 255) - (((lowBand[i] as number) >>> shift) & 255);
        const value = Math.round(from + delta * blend);
        const clamped = value < 0 ? 0 : value > 255 ? 255 : value;
        pixel = pixel | (clamped << shift);
      }
      (detail as Uint32Array)[i] = pixel;
    }
  }
  return output;
}
