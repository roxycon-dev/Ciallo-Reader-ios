/**
 * PP-OCR ONNX engines — shapes + pure DB/CTC post-processing, port of Android
 * `novel-reader/app/src/main/java/com/example/mangatranslate/MangaOcr.kt`
 * (488 lines total, 454 non-blank).
 *
 * SCOPE: manga translation is deliberately excluded from the iOS port (see `index.ts`).
 * The ONNX sessions and the pixel preprocessing are stubbed. The **DB post-processing**
 * (`extractLineRects`), the **reading-order sort** (`sortBoxesReadingOrder`) and the
 * **CTC decoder** (`ctcDecode`) are pure numeric code over caller-supplied probability
 * buffers and are ported so the semantics remain testable and auditable.
 *
 * Line map (Kotlin line → TS):
 *   1..18    package + imports → no imports; tensors become nested number arrays.
 *   19..31   KDoc `PP-OCR ONNX 推理引擎（漫画翻译用）。` (5 paragraphs incl. the
 *            jedzqer MIT attribution and the 18710-class charset note) → kept.
 *   32..109  `object OrtSessions { cacheRoot / ensureCacheRoot / env / cache / lock /
 *            globalInFlight / track / getOrCreate / createSession / closeAll }`
 *            → {@link OrtSessions}. All members are **stubs**:
 *              - `cacheRoot` → {@link ORT_CACHE_DIR_NAME} ('mt_models_cache');
 *              - `globalInFlight` (AtomicInteger, Kotlin lines 50..51) → a plain counter
 *                ({@link OrtSessions.globalInFlight}) so `MangaPageTranslator.release()`
 *                can still ask "is inference in flight?";
 *              - `track(session, block)` — the `check(cache.values.any { it === session })
 *                { "翻译会话已释放，请重新开启翻译" }` guard message is preserved verbatim
 *                in {@link ORT_RELEASED_MESSAGE};
 *              - `createSession` — `setIntraOpNumThreads(2)`, `setInterOpNumThreads(1)`,
 *                `OptLevel.BASIC_OPT`, `setMemoryPatternOptimization(false)` preserved as
 *                {@link ORT_SESSION_OPTIONS};
 *              - `closeAll()` — the 60 s deadline (`System.currentTimeMillis() + 60_000`),
 *                the 150 ms wait slice and the "closeAll: inference still in flight, skip
 *                session close" log tag preserved in {@link ORT_CLOSE_DEADLINE_MS} /
 *                {@link ORT_CLOSE_POLL_MS}.
 *   110..352 `class PaddleDetector(modelFile: File)` →
 *            {@link PaddleDetector}:
 *              - 113 `OrtSessions.getOrCreate(modelFile, "det|${modelFile.length()}")` → stub.
 *              - 114 `session.inputInfo.keys.first()` → stub.
 *              - 116..130 `detectLines(bitmap)` — `width < MIN_CROP_SIZE || height <
 *                MIN_CROP_SIZE → emptyList()`, the `ratio > 1.8f || srcH > 1600` long-image
 *                dispatch, and the whole-page/tile split → stub. The two dispatch
 *                thresholds are preserved as {@link DETECT_LONG_IMAGE_ASPECT} /
 *                {@link DETECT_LONG_IMAGE_MAX_HEIGHT}.
 *              - 132..161 `detectLinesTiled` — `tileH = (srcW*1.4f).toInt().coerceIn(600, 2400)`,
 *                `overlap = (tileH*0.12f).toInt()`, and the overlap dedup with
 *                `inter / minArea > 0.6f` → preserved as the pure helpers
 *                {@link DETECT_TILE_HEIGHT_WIDTH_RATIO}, {@link DETECT_TILE_MIN_HEIGHT_PX},
 *                {@link DETECT_TILE_MAX_HEIGHT_PX}, {@link DETECT_TILE_OVERLAP_RATIO},
 *                {@link DETECT_TILE_DEDUP_RATIO} and {@link dedupeTileLineRects} (ported).
 *              - 163..187 `detectLinesWhole` — `shrink = min(1f, DETECTION_MAX_EDGE / max(w,h))`
 *                → preserved; the session run is stubbed.
 *              - 189..226 `preprocess` — `scale = min(INPUT/w, INPUT/h).coerceAtLeast(1e-6f)`,
 *                black padding, and the BGR mean/std normalisation
 *                (`MEAN = [0.485f, 0.456f, 0.406f]`, `STD = [0.229f, 0.224f, 0.225f]`,
 *                note the **BGR order**: b uses MEAN[0], g MEAN[1], r MEAN[2])
 *                → preserved as {@link normalizeBgrPixel} (ported, pure).
 *              - 228..287 `internal fun extractLineRects(prob, pre)` — **DB 后处理**,
 *                explicitly documented on Android as 「DB 后处理（纯逻辑，供单测直接调用）」
 *                → {@link extractLineRects}, **FULLY PORTED** (pure). Every threshold is
 *                identical: PROB_THRESHOLD 0.2f, BOX_THRESHOLD 0.45f, UNCLIP_RATIO 1.4f,
 *                MIN_COMPONENT_PIXELS 3, MIN_SIZE 3, MIN_ORIGINAL_SIZE 3f. The 8-neighbour
 *                flood fill, the `stack[sp++] = i` iterative DFS, the
 *                `distance = (boxW*boxH)/(2f*(boxW+boxH)) * UNCLIP_RATIO` unclip and the
 *                four `((x - pre.padW) / pre.ratioW).coerceIn(0f, pre.originalWidth)` lines
 *                are preserved verbatim.
 *              - 289..303 `internal fun sortBoxesReadingOrder(rects)` — explicitly
 *                documented on Android as 「阅读序排序（纯逻辑，供单测）」
 *                → {@link sortBoxesReadingOrder},
 *                **FULLY PORTED**, including the `compareBy({ yCoords[it] }, { it })` sort,
 *                the `lineIds[i] = lineIds[i-1] + if (dy >= BOX_SORT_Y_THRESHOLD) 1 else 0`
 *                banding and the final `compareBy({ lineIds[it.index] }, { rects[it.value].left })`.
 *              - 305..310 `internal class PreResult(tensor, ratioW, ratioH, padW, padH,
 *                originalWidth, originalHeight)` → {@link PreResult} (the `tensor` field is
 *                dropped and the omission documented — it is never read).
 *              - 312..336 `private fun extractProbMap(raw, shape)` — the 4-D / 3-D shape
 *                dispatch and the null guards → {@link extractProbMap} (ported, pure).
 *              - 338..351 `companion object` — all 11 constants → identical values.
 *   353..488 `class PaddleRecognizer(modelFile, charsetLines)` →
 *            {@link PaddleRecognizer}:
 *              - 359..364 the `charset` builder — `add("blank")`, all non-empty
 *                `charsetLines`, then `if (lastOrNull() != " ") add(" ")` →
 *                {@link buildRecognizerCharset}, **FULLY PORTED** (pure).
 *              - 366 `data class RecResult(text, score)` → {@link RecResult}.
 *              - 368..409 `recognize(bitmap)` — `IMG_H = 48`, `IMG_W = 320`,
 *                `targetW = (imgH*ratio).toInt().coerceIn(1, imgW)`, the `(v - 0.5f)/0.5f`
 *                normalisation → stubbed (needs a Bitmap); the geometry constants are kept.
 *              - 411..482 `internal fun ctcDecode(raw, shape)` — explicitly documented on
 *                Android as 「CTC 解码（纯逻辑，供单测直接调用）」
 *                → {@link ctcDecode},
 *                **FULLY PORTED**. Preserved exactly: the `append(maxIdx, prob)` blank /
 *                repeat-suppression logic, the `argmax` tie rule (`>` so the first max wins),
 *                the `looksLikeClasses(v) = v == charset.size || v == charset.size - 1 ||
 *                v == charset.size + 1` heuristic, and all four shape branches in the same
 *                order (`dim1 == 1 && dim0 > 1`, `dim0 == 1 && looksLikeClasses(dim2)`,
 *                `dim0 == 1 && looksLikeClasses(dim1)`, `else`). The final
 *                `if (scores.isEmpty()) 0f else scores.sum() / scores.size` is preserved.
 *              - 484..487 `companion object { IMG_H = 48; IMG_W = 320 }` → identical.
 *
 * Skipped lines and why:
 *   - Kotlin lines 39..43 (`OrtEnvironment.getEnvironment()`), 69..81 (`createSession`),
 *     91..108 (`closeAll` bodies), 104..145 (`session.run(...)`), 189..226 (pixel loops),
 *     368..409 (pixel loops): all require the ONNX Runtime and/or an `android.graphics.Bitmap`.
 *   - Kotlin `OnnxTensor` / `FloatBuffer` / `TensorInfo` → plain `number[][][]` buffers with
 *     an explicit shape tuple.
 *   - Kotlin `Bitmap.getPixels` / `scale` / `createBitmap` → not ported (bitmap pipeline).
 *
 * Every constant, threshold and Chinese comment is byte-identical. No U+3000 in the file.
 *
 * ── R20-audit additions (2026-10-06) ────────────────────────────────────────────
 * The two pixel loops were stubbed as "needs Bitmap". Both are pure arithmetic over an
 * injected `getPixel` returning a packed 0xAARRGGBB int (the same layout
 * `sampleBackgroundColor` reads), and only the `Bitmap.scale`/`Canvas` that *produce* the
 * pixels plus the `OnnxTensor.createTensor` that *consumes* the buffer need the platform:
 *   · `buildDetInputTensor` — Kotlin lines 204..217, the `[1,3,960,960]` CHW buffer with the
 *     **BGR** mean/std order (`b - MEAN[0]`, `g - MEAN[1]`, `r - MEAN[2]`).
 *   · `recognizerTargetWidth` — Kotlin lines 375..376,
 *     `targetW = (imgH * ratio).toInt().coerceIn(1, imgW)`.
 *   · `buildRecInputTensor` — Kotlin lines 379..391, the `[1,3,48,320]` CHW buffer with the
 *     `(v - 0.5f)/0.5f` normalisation (the `0 until targetW` column bound is preserved).
 * Nothing here fabricates inference: the emitted float buffers are the tensor *inputs*,
 * and running them still requires an ONNX session (`PaddleDetector.detectLines` /
 * `PaddleRecognizer.recognize` remain typed stubs).
 */

import { MangaTranslateUnsupportedError } from './index';
import type { RectF } from './index';
import { rectF } from './index';

/* ── OrtSessions constants (Kotlin lines 34, 73..80, 92, 95, 56) ── */
export const ORT_CACHE_DIR_NAME = 'mt_models_cache';
export const ORT_RELEASED_MESSAGE = '翻译会话已释放，请重新开启翻译';
export const ORT_CLOSE_DEADLINE_MS = 60_000;
export const ORT_CLOSE_POLL_MS = 150;
export const ORT_SESSION_OPTIONS = {
  /** Kotlin line 74: `setIntraOpNumThreads(2)`. */
  intraOpNumThreads: 2,
  /** Kotlin line 75: `setInterOpNumThreads(1)`. */
  interOpNumThreads: 1,
  /** Kotlin line 77: `OptLevel.BASIC_OPT` — 大图全量优化易 OOM（上游实测）. */
  optimizationLevel: 'BASIC_OPT',
  /** Kotlin line 78: `setMemoryPatternOptimization(false)`. */
  memoryPatternOptimization: false,
} as const;

/**
 * PP-OCR ONNX 推理引擎（漫画翻译用）— session bookkeeping only.
 * Every ONNX operation is out of scope (see `index.ts`); the in-flight counter is kept
 * because the release protocol (`closeAll` must not close a live session) is a real
 * invariant that the coordinator code depends on.
 */
export const OrtSessions = {
  /** Kotlin line 49..51: `globalInFlight` (`AtomicInteger(0)`). */
  globalInFlight: 0,

  /** Kotlin line 34: `File(context.cacheDir, "mt_models_cache")`. */
  cacheRoot(): string {
    return ORT_CACHE_DIR_NAME;
  },

  /** Kotlin lines 54..67: `track(session, block)` — STUB (needs a live session). */
  track<T>(_session: unknown, _block: () => T): T {
    throw new MangaTranslateUnsupportedError(
      'OrtSessions.track',
      'onnx-inference',
      '需要 ai.onnxruntime.OrtSession',
    );
  },

  /** Kotlin lines 69..70: `getOrCreate(modelFile, key)` — STUB. */
  getOrCreate(_modelPath: string, _key: string): unknown {
    throw new MangaTranslateUnsupportedError(
      'OrtSessions.getOrCreate',
      'onnx-inference',
      '需要 ai.onnxruntime.OrtSession 与本地 .onnx 模型文件',
    );
  },

  /** Kotlin lines 91..108: `closeAll()` — STUB. */
  closeAll(): void {
    throw new MangaTranslateUnsupportedError(
      'OrtSessions.closeAll',
      'onnx-inference',
      '需要 ai.onnxruntime.OrtSession.close()',
    );
  },
};

/* ── PaddleDetector constants (Kotlin lines 338..351, verbatim) ── */
export const DET_INPUT = 960;
export const DETECTION_MAX_EDGE = 1920;
/** Kotlin line 341: `MEAN = floatArrayOf(0.485f, 0.456f, 0.406f)` — **BGR order**. */
export const DET_MEAN = [0.485, 0.456, 0.406] as const;
/** Kotlin line 342: `STD = floatArrayOf(0.229f, 0.224f, 0.225f)` — **BGR order**. */
export const DET_STD = [0.229, 0.224, 0.225] as const;
export const PROB_THRESHOLD = 0.2;
export const BOX_THRESHOLD = 0.45;
export const UNCLIP_RATIO = 1.4;
export const MIN_COMPONENT_PIXELS = 3;
export const MIN_SIZE = 3;
export const MIN_ORIGINAL_SIZE = 3;
export const BOX_SORT_Y_THRESHOLD = 10;
export const MIN_CROP_SIZE = 32;
/** Kotlin line 125: `ratio > 1.8f || srcH > 1600` → tiled detection. */
export const DETECT_LONG_IMAGE_ASPECT = 1.8;
export const DETECT_LONG_IMAGE_MAX_HEIGHT = 1600;
/** Kotlin lines 136..137. */
export const DETECT_TILE_HEIGHT_WIDTH_RATIO = 1.4;
export const DETECT_TILE_MIN_HEIGHT_PX = 600;
export const DETECT_TILE_MAX_HEIGHT_PX = 2400;
export const DETECT_TILE_OVERLAP_RATIO = 0.12;
/** Kotlin line 156: `inter / minArea > 0.6f`. */
export const DETECT_TILE_DEDUP_RATIO = 0.6;

/** Kotlin lines 305..310 (the `tensor` field is never read and is omitted). */
export interface PreResult {
  ratioW: number;
  ratioH: number;
  padW: number;
  padH: number;
  originalWidth: number;
  originalHeight: number;
}

/** Kotlin lines 190..201: the letterbox scale + padding. */
export function computePreResult(
  srcW: number,
  srcH: number,
): PreResult {
  const scale = Math.max(Math.min(DET_INPUT / srcW, DET_INPUT / srcH), 1e-6);
  const newW = Math.max(Math.floor(srcW * scale), 1);
  const newH = Math.max(Math.floor(srcH * scale), 1);
  const padX = Math.max((DET_INPUT - newW) / 2, 0);
  const padY = Math.max((DET_INPUT - newH) / 2, 0);
  return {
    ratioW: newW / srcW,
    ratioH: newH / srcH,
    padW: padX,
    padH: padY,
    originalWidth: srcW,
    originalHeight: srcH,
  };
}

/**
 * Kotlin lines 209..215: `b = ((pixel shr 16) and 0xFF)/255f` then
 * `input[offset] = (b - MEAN[0]) / STD[0]`, i.e. **BGR** channel order for a packed
 * 0xAARRGGBB int. FULLY PORTED (pure).
 */
export function normalizeBgrPixel(pixel: number, channel: 0 | 1 | 2): number {
  const shift = channel === 0 ? 16 : channel === 1 ? 8 : 0;
  const raw = ((pixel >> shift) & 0xff) / 255;
  const mean = DET_MEAN[channel] as number;
  const std = DET_STD[channel] as number;
  return (raw - mean) / std;
}

const coerceIn = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/* ────────────────────────────────────────────────────────────────────────────
 * R20-audit (2026-10-06): the two **pixel loops** in MangaOcr.kt are pure arithmetic over
 * an injected `getPixel`; only the `Bitmap.scale` / `Canvas` calls that produce the source
 * pixels and the `OnnxTensor.createTensor` that consume the float buffer need the platform.
 * `buildDetInputTensor` / `buildRecInputTensor` below are the faithful ports; the shapes
 * they emit are Kotlin's `longArrayOf(1, 3, INPUT, INPUT)` / `longArrayOf(1, 3, 48, 320)`.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Kotlin lines 204..217 — the `[1,3,960,960]` CHW buffer (BGR normalised).
 *
 * Kotlin's loop reads the ALREADY-padded 960×960 bitmap, so `pre.ratioW`/`padW` are not
 * referenced here either — `computePreResult` + the resize/pad are the caller's job
 * (they need `Bitmap.scale` / `Canvas`).
 */
export function buildDetInputTensor(getPixel: (x: number, y: number) => number): number[] {
  const plane = DET_INPUT * DET_INPUT;
  const input = new Array<number>(3 * plane).fill(0);
  let offset = 0;
  for (let y = 0; y < DET_INPUT; y += 1) {
    for (let x = 0; x < DET_INPUT; x += 1) {
      const pixel = getPixel(x, y);
      // Kotlin L209..211: `b`, `g`, `r` come off a packed 0xAARRGGBB int — **BGR order**.
      const b = ((pixel >> 16) & 0xff) / 255;
      const g = ((pixel >> 8) & 0xff) / 255;
      const r = (pixel & 0xff) / 255;
      input[offset] = (b - (DET_MEAN[0] as number)) / (DET_STD[0] as number);
      input[offset + plane] = (g - (DET_MEAN[1] as number)) / (DET_STD[1] as number);
      input[offset + 2 * plane] = (r - (DET_MEAN[2] as number)) / (DET_STD[2] as number);
      offset += 1;
    }
  }
  return input;
}

/** Kotlin line 375..376: `ratio = w/h`, `targetW = (imgH * ratio).toInt().coerceIn(1, imgW)`. */
export function recognizerTargetWidth(width: number, height: number): number {
  if (height < 1 || width < 1) return 1;
  const ratio = width / height;
  return Math.min(Math.max(Math.floor(REC_IMG_H * ratio), 1), REC_IMG_W);
}

/** Kotlin lines 379..391 — the `[1,3,48,320]` CHW buffer (`(v - 0.5f)/0.5f`). */
export function buildRecInputTensor(
  getPixel: (x: number, y: number) => number,
  targetW: number,
): number[] {
  const plane = REC_IMG_H * REC_IMG_W;
  const input = new Array<number>(3 * plane).fill(0);
  for (let y = 0; y < REC_IMG_H; y += 1) {
    for (let x = 0; x < targetW; x += 1) {
      const pixel = getPixel(x, y);
      const b = ((pixel >> 16) & 0xff) / 255;
      const g = ((pixel >> 8) & 0xff) / 255;
      const r = (pixel & 0xff) / 255;
      const base = y * REC_IMG_W + x;
      input[base] = normalizeRecPixel(b);
      input[base + REC_IMG_H * REC_IMG_W] = normalizeRecPixel(g);
      input[base + 2 * REC_IMG_H * REC_IMG_W] = normalizeRecPixel(r);
    }
  }
  return input;
}

/**
 * DB 后处理（纯逻辑，供单测直接调用）。
 * Kotlin lines 228..287 — FULLY PORTED.
 */
export function extractLineRects(prob: readonly number[], pre: PreResult): RectF[] {
  const width = DET_INPUT;
  const height = DET_INPUT;
  const total = width * height;
  if (prob.length < total) return [];
  const visited = new Array<boolean>(total).fill(false);
  const stack = new Array<number>(total).fill(0);
  const results: RectF[] = [];

  for (let i = 0; i < total; i += 1) {
    if (visited[i] === true || (prob[i] as number) <= PROB_THRESHOLD) continue;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let count = 0;
    let sum = 0;
    let sp = 0;
    stack[sp] = i;
    sp += 1;
    visited[i] = true;
    while (sp > 0) {
      sp -= 1;
      const idx = stack[sp] as number;
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      count += 1;
      sum += prob[idx] as number;
      for (let ny = y - 1; ny <= y + 1; ny += 1) {
        if (ny < 0 || ny >= height) continue;
        const rowOffset = ny * width;
        for (let nx = x - 1; nx <= x + 1; nx += 1) {
          if (nx < 0 || nx >= width) continue;
          const nidx = rowOffset + nx;
          if (visited[nidx] !== true && (prob[nidx] as number) > PROB_THRESHOLD) {
            visited[nidx] = true;
            stack[sp] = nidx;
            sp += 1;
          }
        }
      }
    }
    if (count < MIN_COMPONENT_PIXELS) continue;
    if (sum / count < BOX_THRESHOLD) continue;
    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    if (boxW < MIN_SIZE || boxH < MIN_SIZE) continue;

    const distance = ((boxW * boxH) / (2 * (boxW + boxH))) * UNCLIP_RATIO;
    const left = coerceIn(minX - distance, 0, width);
    const top = coerceIn(minY - distance, 0, height);
    const right = coerceIn(maxX + 1 + distance, 0, width);
    const bottom = coerceIn(maxY + 1 + distance, 0, height);

    const leftOrig = coerceIn((left - pre.padW) / pre.ratioW, 0, pre.originalWidth);
    const topOrig = coerceIn((top - pre.padH) / pre.ratioH, 0, pre.originalHeight);
    const rightOrig = coerceIn((right - pre.padW) / pre.ratioW, 0, pre.originalWidth);
    const bottomOrig = coerceIn((bottom - pre.padH) / pre.ratioH, 0, pre.originalHeight);
    if (rightOrig - leftOrig <= MIN_ORIGINAL_SIZE || bottomOrig - topOrig <= MIN_ORIGINAL_SIZE) continue;
    results.push(rectF(leftOrig, topOrig, rightOrig, bottomOrig));
  }
  return results;
}

/**
 * 阅读序排序（纯逻辑，供单测）：按行带分组，行内按 x。竖排文字另行在块合并时处理。
 * Kotlin lines 289..303 — FULLY PORTED.
 */
export function sortBoxesReadingOrder(rects: readonly RectF[]): RectF[] {
  if (rects.length === 0) return [];
  const yCoords = rects.map((r) => r.top);
  const indices = yCoords.map((_, i) => i).sort((a, b) => {
    if (yCoords[a] !== yCoords[b]) return (yCoords[a] as number) - (yCoords[b] as number);
    return a - b;
  });
  const ySorted = indices.map((i) => yCoords[i] as number);
  const lineIds = new Array<number>(indices.length).fill(0);
  for (let i = 1; i < indices.length; i += 1) {
    const dy = (ySorted[i] as number) - (ySorted[i - 1] as number);
    lineIds[i] = (lineIds[i - 1] as number) + (dy >= BOX_SORT_Y_THRESHOLD ? 1 : 0);
  }
  return indices
    .map((index, i) => ({ index, lineId: lineIds[i] as number }))
    .sort((a, b) => {
      if (a.lineId !== b.lineId) return a.lineId - b.lineId;
      return (rects[a.index] as RectF).left - (rects[b.index] as RectF).left;
    })
    .map(({ index }) => rects[index] as RectF);
}

/**
 * Kotlin lines 312..336: the 4-D / 3-D probability-map shape dispatch.
 * `rows` is the innermost `[h][w]` float array; Kotlin returned null on any mismatch.
 */
export function extractProbMap(
  shape: readonly number[],
  /** Kotlin `raw`: the tensor value. 4-D => [batch][channel][h][w], 3-D => [batch][h][w]. */
  raw: readonly unknown[],
): number[] | null {
  let h = 0;
  let w = 0;
  let resolvedRows: readonly (readonly number[])[];
  if (shape.length === 4) {
    h = shape[2] ?? 0;
    w = shape[3] ?? 0;
    // Kotlin: raw as? Array<*> -> batch; batch.firstOrNull() as? Array<*> -> channel
    const channel = raw[0];
    if (!Array.isArray(channel)) return null;
    const rows = channel[0];
    if (!Array.isArray(rows)) return null;
    resolvedRows = rows as readonly (readonly number[])[];
  } else if (shape.length === 3) {
    h = shape[1] ?? 0;
    w = shape[2] ?? 0;
    // Kotlin: batch.firstOrNull() as? Array<*> -> rows
    const rows = raw[0];
    if (!Array.isArray(rows)) return null;
    resolvedRows = rows as readonly (readonly number[])[];
  } else {
    return null;
  }
  if (h <= 0 || w <= 0 || resolvedRows.length < h) return null;
  const prob = new Array<number>(h * w).fill(0);
  for (let y = 0; y < h; y += 1) {
    const row = resolvedRows[y];
    if (row === undefined || row.length < w) return null;
    for (let x = 0; x < w; x += 1) prob[y * w + x] = row[x] as number;
  }
  return prob;
}

/**
 * Kotlin lines 149..160: the overlap-region dedup of the tiled detection pass.
 * `inter / minArea > 0.6f` ⇒ duplicate.
 */
export function dedupeTileLineRects(rects: readonly RectF[]): RectF[] {
  const kept: RectF[] = [];
  for (const r of rects) {
    const dup = kept.some((k) => {
      const inter =
        Math.max(0, Math.min(r.right, k.right) - Math.max(r.left, k.left)) *
        Math.max(0, Math.min(r.bottom, k.bottom) - Math.max(r.top, k.top));
      const minArea = Math.min(rectW(r) * rectH(r), rectW(k) * rectH(k));
      return minArea > 0 && inter / minArea > DETECT_TILE_DEDUP_RATIO;
    });
    if (!dup) kept.push(r);
  }
  return kept;
}

const rectW = (r: RectF): number => r.right - r.left;
const rectH = (r: RectF): number => r.bottom - r.top;

/** 文字行检测器：整页 Bitmap → 文字行矩形（原图坐标系，阅读序）。 */
export class PaddleDetector {
  /** Kotlin lines 118..130 — STUB (needs a Bitmap). */
  detectLines(_bitmap: { width: number; height: number }): Promise<RectF[]> {
    throw new MangaTranslateUnsupportedError(
      'PaddleDetector.detectLines',
      'onnx-inference',
      '需要 PP-OCRv6 det ONNX 会话与 android.graphics.Bitmap',
    );
  }
}

/** Kotlin line 366. */
export interface RecResult {
  text: string;
  score: number;
}

/** Kotlin lines 484..487. */
export const REC_IMG_H = 48;
export const REC_IMG_W = 320;

/**
 * Kotlin lines 359..364:
 * `buildList { add("blank"); addAll(charsetLines.filter { it.isNotEmpty() }); if (lastOrNull() != " ") add(" ") }`
 * FULLY PORTED (pure).
 */
export function buildRecognizerCharset(charsetLines: readonly string[]): string[] {
  const out: string[] = ['blank'];
  for (const line of charsetLines) if (line !== '') out.push(line);
  if (out[out.length - 1] !== ' ') out.push(' ');
  return out;
}

/** Kotlin lines 377..379: `(v - 0.5f)/0.5f` for the recognizer input. */
export function normalizeRecPixel(raw: number): number {
  return (raw - 0.5) / 0.5;
}

/**
 * CTC 解码（纯逻辑，供单测直接调用）。
 * Kotlin lines 411..482 — FULLY PORTED.
 *
 * @param steps the time axis; each entry is either a class-probability vector
 *              (`number[]`) or, in the `looksLikeClasses(dim1)` branch, one class's
 *              per-step vector. The four-branch shape dispatch mirrors Android exactly.
 */
export function ctcDecode(
  steps: ReadonlyArray<unknown>,
  charset: readonly string[],
): RecResult {
  let chars = '';
  const scores: number[] = [];
  let prevIdx = -1;

  const append = (maxIdx: number, prob: number): void => {
    if (maxIdx === prevIdx) {
      prevIdx = maxIdx;
      return;
    }
    prevIdx = maxIdx;
    if (maxIdx === 0) return;
    if (maxIdx < charset.length) {
      chars += charset[maxIdx] as string;
      scores.push(prob);
    }
  };

  const argmax = (probs: readonly number[]): [number, number] => {
    if (probs.length === 0) return [0, Number.NEGATIVE_INFINITY];
    let mi = 0;
    let mp = probs[0] ?? Number.NEGATIVE_INFINITY;
    for (let i = 1; i < probs.length; i += 1) {
      const v = probs[i] as number;
      if (v > mp) {
        mp = v;
        mi = i;
      }
    }
    return [mi, mp];
  };

  const dim0 = steps.length;
  const dim1 = Array.isArray(steps[0]) ? (steps[0] as unknown[]).length : 0;
  const dim2 =
    Array.isArray(steps[0]) && Array.isArray((steps[0] as unknown[])[0])
      ? ((steps[0] as unknown[])[0] as unknown[]).length
      : 0;
  const looksLikeClasses = (v: number): boolean =>
    v === charset.length || v === charset.length - 1 || v === charset.length + 1;

  if (dim1 === 1 && dim0 > 1) {
    for (let t = 0; t < dim0; t += 1) {
      const inner = steps[t];
      if (!Array.isArray(inner)) continue;
      const probs = (inner as unknown[])[0];
      if (!Array.isArray(probs)) continue;
      const [mi, mp] = argmax(probs as number[]);
      append(mi, mp);
    }
  } else if (dim0 === 1 && looksLikeClasses(dim2)) {
    // Kotlin: `for (step in first) { val probs = step as? FloatArray; ... }` — here
    // `step` IS the class-probability vector, not a wrapper around one.
    for (const probs of steps) {
      if (!Array.isArray(probs)) continue;
      const [mi, mp] = argmax(probs as number[]);
      append(mi, mp);
    }
  } else if (dim0 === 1 && looksLikeClasses(dim1)) {
    // Kotlin: `val classArrays = first.mapNotNull { it as? FloatArray }` — one vector per class.
    const classArrays = steps.filter((c): c is number[] => Array.isArray(c)) as number[][];
    const timeCount = classArrays[0]?.length ?? 0;
    for (let t = 0; t < timeCount; t += 1) {
      let mi = 0;
      let mp = Number.NEGATIVE_INFINITY;
      for (let c = 0; c < classArrays.length; c += 1) {
        const arr = classArrays[c] as number[];
        if (t >= arr.length) continue;
        const v = arr[t] as number;
        if (v > mp) {
          mp = v;
          mi = c;
        }
      }
      append(mi, mp);
    }
  } else {
    // Kotlin: `for (step in first) { val probs = step as? FloatArray; ... }`
    for (const probs of steps) {
      if (!Array.isArray(probs)) continue;
      const [mi, mp] = argmax(probs as number[]);
      append(mi, mp);
    }
  }
  const score = scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length;
  return { text: chars, score };
}

/** 文字识别器：裁剪行 Bitmap → 文本 + 置信度（CTC 解码）。 */
export class PaddleRecognizer {
  /** blank 头 + 字符表 + 空格尾 = 与模型 18710 输出类对齐 */
  readonly charset: string[];

  constructor(charsetLines: readonly string[]) {
    this.charset = buildRecognizerCharset(charsetLines);
  }

  /** Kotlin lines 368..409 — STUB (needs a Bitmap). */
  recognize(_bitmap: { width: number; height: number }): Promise<RecResult> {
    throw new MangaTranslateUnsupportedError(
      'PaddleRecognizer.recognize',
      'onnx-inference',
      '需要 PP-OCRv6 rec ONNX 会话与 android.graphics.Bitmap',
    );
  }
}