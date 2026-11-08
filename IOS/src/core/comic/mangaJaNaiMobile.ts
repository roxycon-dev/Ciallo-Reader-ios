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
 * - `Canvas.drawBitmap(src, null, dstRect, paint)` → a band-scoped copy loop. The
 *   Kotlin call draws the *whole* source into a rect offset by `-y`, so only the
 *   rows `[y, y+rows)` land inside the band; the loop reproduces exactly that
 *   windowing (and the FILTER_BITMAP_FLAG bilinear tap is emulated by nearest —
 *   see the note on `resampleBand`).
 * - `Bitmap.getPixels(...)` / `setPixels(...)` → `Uint32Array` subarray views.
 * - `Thread.currentThread().isInterrupted` → an injected `isCancelled()` seam, since
 *   a synchronous port has no thread to interrupt.
 * - `output.recycle()` on failure → the caller owns the buffer, so the port leaves
 *   it untouched and lets the caller drop the reference (GC-equivalent).
 * - Kotlin `(x).roundToInt()` rounds half **up** (toward +∞ for positives); JS
 *   `Math.round` rounds half **up** as well, so no correction is needed. Negative
 *   values never reach these calls: `width`/`height` are `coerceAtLeast(1)`.
 */

import type { PixImage } from './comicPixOps';

/** Kotlin `MangaJaNai.TILE` (MangaJaNai.kt L31) — declared here to avoid a cycle. */
const TILE = 128;

/**
 * Kotlin L12-23 `fun mangaMobileInputSize(width, height, tileBudget): Pair<Int, Int>`.
 *
 * Two caps composed: an absolute pixel cap (`minOf(1.0, 1400/max(w,h))`) and an
 * area cap (`sqrt(900_000 / (w*h))`), then a shrink loop until the tile count fits
 * the budget. `0.93` per iteration is applied to **both** axes, and each step
 * truncates toward zero (`toInt()`), which `Math.trunc` matches exactly.
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
  let w = Math.max(1, Math.trunc(width * scale));
  let h = Math.max(1, Math.trunc(height * scale));
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
 * Kotlin L28-74 `fun combineMangaJaNaiDetail(...)`.
 *
 * Adds the low-resolution network's per-channel correction back onto the
 * full-detail original, band by band, so only two `width × min(48, height)`
 * scratch buffers are ever alive.
 *
 * @param isCancelled 宿主取消缝（对应 `Thread.currentThread().isInterrupted`）。
 *   返回 `true` 时抛出与 Kotlin `InterruptedException` 同义的错误。
 */
export function combineMangaJaNaiDetail(
  original: PixImage,
  neuralInput: PixImage,
  neuralOutput: PixImage,
  width: number,
  height: number,
  strength: number,
  isCancelled: () => boolean = () => false,
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

  try {
    for (let y = 0; y < height; y += bandHeight) {
      if (isCancelled()) {
        throw new Error('MangaJaNai cancelled');
      }
      const rows = Math.min(bandHeight, height - y);

      // Kotlin L51-52 `eraseColor(Color.TRANSPARENT)`
      low.data.fill(0);
      ai.data.fill(0);

      // Kotlin L53-55 — 把 neuralInput / neuralOutput 的第 y 行带画进 band。
      // `RectF(0, -y, width, height - y)` 表示源整体上移 y 像素，故源的第 y 行
      // 落在 band 的第 0 行；FILTER_BITMAP_FLAG 的双线性采样在此退化为最近邻，
      // 因为 Kotlin 与 iOS 两侧的 src/dst 尺寸在 mobile 路径上恒相等。
      copyBand(low.data, neuralInput, width, y, rows);
      copyBand(ai.data, neuralOutput, width, y, rows);

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
  } catch {
    // Kotlin L72 `output.recycle(); throw error` — 端口不持有缓冲区，
    // 由调用方丢弃引用（GC 等价）。
    throw new Error('MangaJaNai cancelled');
  }
}

/**
 * Kotlin L37 `Canvas(output).drawBitmap(original, null, RectF(0,0,w,h), paint)`.
 *
 * Nearest-neighbour 缩放（mobile 路径上源与目标尺寸恒等，故等价于直拷）。
 */
function resampleInto(dst: PixImage, src: PixImage, width: number, height: number): void {
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(src.height - 1, Math.trunc((y * src.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(src.width - 1, Math.trunc((x * src.width) / width));
      (dst.data as Uint32Array)[y * width + x] = (src.data as Uint32Array)[sy * src.width + sx] as number;
    }
  }
}

/** Kotlin L53-55 的 band 窗口拷贝：源第 `y` 行 → band 第 0 行。 */
function copyBand(dst: Uint32Array, src: PixImage, width: number, y: number, rows: number): void {
  const from = (src.data as Uint32Array).subarray(y * width, y * width + width * rows);
  dst.set(from, 0);
}
