/**
 * Page memory budget — port of Android
 * `novel-reader/app/src/main/java/com/example/mangatranslate/PageMemoryBudget.kt`
 * (30 lines total, 28 non-blank).
 *
 * SCOPE: manga translation is deliberately excluded from the iOS port (see `index.ts`).
 * The *guard* is pure arithmetic over (width, height, available heap) so it is fully
 * ported; the *fingerprint* reads bitmap pixels and is stubbed.
 *
 * Line map (Kotlin line → TS):
 *   1        `package com.example.mangatranslate` → module header.
 *   2        (blank)
 *   3        `import android.graphics.Bitmap` → `width`/`height` are injected as numbers.
 *   4        `import kotlinx.coroutines.sync.Mutex` → {@link AsyncMutex} from
 *            `@core/data/contentMutationGate` (already-ported minimal FIFO mutex).
 *   5        `import kotlinx.coroutines.sync.withLock` → `mutex.withLock(fn)`.
 *   6        (blank)
 *   7        `internal object PageMemoryBudget {` → {@link PageMemoryBudget}.
 *   8        `val gate = Mutex()` → {@link PageMemoryBudget.gate}.
 *   9        `fun check(bitmap: Bitmap) {` → {@link PageMemoryBudget.check}(width, height, maxMemoryBytes).
 *   10       `val pixels = bitmap.width.toLong() * bitmap.height` → identical
 *            (`width * height`, coerced to a safe integer).
 *   11       `val allowed = minOf(32L*1024*1024, Runtime.getRuntime().maxMemory()/8)`
 *            → {@link PageMemoryBudget.allowedPixelBudget}(maxMemoryBytes):
 *              `Math.min(32 * 1024 * 1024, Math.floor(maxMemoryBytes / 8))`.
 *              Kotlin `Long` division truncates toward zero, hence `Math.floor`.
 *   12       `require(pixels <= allowed/4) { "页面过大，请降低图片清晰度后翻译" }`
 *            → identical comparison and **identical message**.
 *   13       `}` → end of `check`.
 *   14       `fun fingerprint(bitmap: Bitmap): String {` → **STUB**.
 *   15       `check(bitmap)` → the stub still calls {@link PageMemoryBudget.check} first
 *            so a caller that only wanted the guard gets the same rejection.
 *   16       `val digest = MessageDigest.getInstance("SHA-256")` → ONNX-adjacent pixel digest; stubbed.
 *   17       `val rows = maxOf(1, minOf(32, 16384/bitmap.width.coerceAtLeast(1)))`
 *            → preserved as {@link PageMemoryBudget.sampleRows}(width):
 *              `Math.max(1, Math.min(32, Math.floor(16384 / Math.max(1, width))))`.
 *              Kotlin `Int` division truncates, hence `Math.floor`.
 *   18       `val pixels = IntArray(bitmap.width * rows)` → pixel buffer; stubbed.
 *   19       `val buffer = ByteBuffer.allocate(pixels.size * 4)` → big-endian RGBA
 *            packing; stubbed (would need the bitmap).
 *   20..27   `bitmap.getPixels(...)` sampling loop + `digest.update(...)` → stubbed.
 *            The sampling geometry (16 384-px-wide rows, ≤32 rows, stride = height)
 *            and the 4-bytes-per-pixel packing order are documented above.
 *   28       `return digest.digest().joinToString("") { "%02x".format(it) }` → stubbed.
 *   29       `}` → end of `fingerprint`.
 *   30       `}` → end of object.
 *
 * Skipped lines and why:
 *   - Kotlin lines 16, 18..28 (`MessageDigest`, `IntArray`, `ByteBuffer`,
 *     `bitmap.getPixels`): all require an `android.graphics.Bitmap` pixel buffer.
 *     Replaced by {@link MangaTranslateUnsupportedError} — the fingerprint is a cache
 *     key for the translation cache, which does not exist on iOS.
 *   - Kotlin `Runtime.getRuntime().maxMemory()` → injected `maxMemoryBytes` so the
 *     arithmetic is testable and deterministic; iOS has no JVM heap ceiling of this shape.
 *
 * Every magic number (32 MiB, /8, /4, 16384, 32, 1, 4) and the Chinese message are
 * byte-identical to the Kotlin source. No U+3000 in the Android file.
 *
 * ── R20-audit additions (2026-10-06) ────────────────────────────────────────────
 * `fingerprint` itself stays a stub (the SHA-256 needs the pixels), but its **sampling
 * walk** — which is the part that defines the cache key — is pure arithmetic and is now
 * implemented over an injected row reader:
 *   · `planFingerprintRows(width, height)` — Kotlin lines 17..27: `rows` from
 *     `sampleRows`, then the `while (y < bitmap.height) { height = minOf(rows, …) ; … }`
 *     loop with its `count = bitmap.width * height`.
 *   · `packFingerprintRows(getPixels, width, height)` — Kotlin lines 25..26:
 *     `ByteBuffer.putInt` is **big-endian**, so A, R, G, B per pixel.
 *   · `fingerprintBitmap(bitmap, maxMemoryBytes, getPixels, sha256Hex)` — Kotlin lines
 *     14..29 end to end: `check(bitmap)` first, then the packed bytes, then the hex digest
 *     (the digest function is injected because `MessageDigest` is JVM-only).
 * This is 缓存键构造, which the audit checklist requires and which does not need ONNX.
 */

import { AsyncMutex } from '@core/data/contentMutationGate';
import { MangaTranslateUnsupportedError } from './index';

/** `import android.graphics.Bitmap` — the only thing {@link PageMemoryBudget} needs from Android. */
export interface BitmapSize {
  width: number;
  height: number;
}

export const PageMemoryBudget = {
  /** `val gate = Mutex()` — `TranslationCoordinator` uses it to serialize OCR. */
  gate: new AsyncMutex(),

  /**
   * `val pixels = bitmap.width.toLong() * bitmap.height`
   */
  pixelCount(bitmap: BitmapSize): number {
    return bitmap.width * bitmap.height;
  },

  /**
   * `val allowed = minOf(32L*1024*1024, Runtime.getRuntime().maxMemory()/8)`
   * Kotlin `Long / Int` truncates toward zero.
   */
  allowedPixelBudget(maxMemoryBytes: number): number {
    return Math.min(32 * 1024 * 1024, Math.floor(maxMemoryBytes / 8));
  },

  /**
   * `fun check(bitmap: Bitmap) { … require(pixels<=allowed/4) { "页面过大，请降低图片清晰度后翻译" } }`
   */
  check(bitmap: BitmapSize, maxMemoryBytes: number): void {
    const pixels = PageMemoryBudget.pixelCount(bitmap);
    const allowed = PageMemoryBudget.allowedPixelBudget(maxMemoryBytes);
    if (!(pixels <= Math.floor(allowed / 4))) {
      throw new Error('页面过大，请降低图片清晰度后翻译');
    }
  },

  /**
   * `val rows = maxOf(1, minOf(32, 16384/bitmap.width.coerceAtLeast(1)))`
   * Kotlin `Int / Int` truncates toward zero.
   */
  sampleRows(width: number): number {
    return Math.max(1, Math.min(32, Math.floor(16384 / Math.max(1, width))));
  },

  /**
   * `fun fingerprint(bitmap: Bitmap): String` — STUB for the digest.
   *
   * Android: SHA-256 over 4-bytes-per-pixel big-endian RGBA rows, sampling
   * `sampleRows(width)` pixel rows per stride (16 384-px-wide band, at most 32 rows),
   * and calling {@link PageMemoryBudget.check} first.
   *
   * The guard runs (so a too-large page is still rejected with the same message); the
   * digest itself requires an `android.graphics.Bitmap` and is out of scope.
   */
  fingerprint(bitmap: BitmapSize, maxMemoryBytes: number): string {
    PageMemoryBudget.check(bitmap, maxMemoryBytes);
    throw new MangaTranslateUnsupportedError(
      'PageMemoryBudget.fingerprint',
      'bitmap-input',
      '需要对 android.graphics.Bitmap 像素做 SHA-256 采样指纹',
    );
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * R20-audit (2026-10-06): the **sampling walk** of `fingerprint` is pure arithmetic
 * over (width, height) + an injected pixel reader — it does not need a `Bitmap`. Only
 * the SHA-256 call at Kotlin line 16 stays a stub, and it is now injectable so the whole
 * cache-key derivation (which the translation cache depends on) is exercisable.
 * ──────────────────────────────────────────────────────────────────────────── */

/** One iteration of Kotlin's `while (y < bitmap.height)` loop (lines 20..27). */
export interface FingerprintRowPlan {
  /** Kotlin `y` — the row offset handed to `getPixels`. */
  y: number;
  /** Kotlin `height` = `minOf(rows, bitmap.height - y)`. */
  height: number;
  /** Kotlin's loop bound `bitmap.width * height`. */
  count: number;
}

/** Kotlin lines 17..27 — the row/stride plan, verbatim. */
export function planFingerprintRows(width: number, height: number): FingerprintRowPlan[] {
  const rows = PageMemoryBudget.sampleRows(width);
  const out: FingerprintRowPlan[] = [];
  let y = 0;
  while (y < height) {
    const h = Math.min(rows, height - y);
    out.push({ y, height: h, count: width * h });
    y += h;
  }
  return out;
}

/**
 * Kotlin lines 25..26 — `for (i in 0 until bitmap.width*height) buffer.putInt(pixels[i])`.
 * `ByteBuffer.allocate(...).putInt` writes **big-endian** RGBA bytes of the packed
 * 0xAARRGGBB int, so the byte order is A, R, G, B.
 */
export function packFingerprintRows(
  getPixels: (x: number, y: number, width: number, height: number) => number[],
  width: number,
  height: number,
): Uint8Array {
  const plan = planFingerprintRows(width, height);
  const out = new Uint8Array(plan.reduce((sum, r) => sum + r.count * 4, 0));
  let offset = 0;
  for (const row of plan) {
    const pixels = getPixels(0, row.y, width, row.height);
    for (let i = 0; i < row.count; i += 1) {
      const p = pixels[i] as number;
      out[offset] = (p >>> 24) & 0xff;
      out[offset + 1] = (p >>> 16) & 0xff;
      out[offset + 2] = (p >>> 8) & 0xff;
      out[offset + 3] = p & 0xff;
      offset += 4;
    }
  }
  return out;
}

/**
 * Kotlin lines 14..29 in full, with the digest injected (Android:
 * `MessageDigest.getInstance("SHA-256")`, `digest.digest().joinToString("") { "%02x".format(it) }`).
 * `check(bitmap)` runs first, exactly as on Android.
 */
export function fingerprintBitmap(
  bitmap: BitmapSize,
  maxMemoryBytes: number,
  getPixels: (x: number, y: number, width: number, height: number) => number[],
  sha256Hex: (bytes: Uint8Array) => string,
): string {
  PageMemoryBudget.check(bitmap, maxMemoryBytes);
  return sha256Hex(packFingerprintRows(getPixels, bitmap.width, bitmap.height));
}