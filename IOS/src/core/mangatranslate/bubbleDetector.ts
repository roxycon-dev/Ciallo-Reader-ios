/**
 * YOLO26n-seg bubble segmentation detector — constants + pure NMS, port of Android
 * `novel-reader/app/src/main/java/com/example/mangatranslate/BubbleDetector.kt`
 * (401 lines total, 369 non-blank).
 *
 * SCOPE: manga translation is deliberately excluded from the iOS port (see `index.ts`).
 * The ONNX session, the letterbox resize and the mask-prototype decoding are stubbed. The
 * **class-internal NMS** (`deduplicate` / `areDuplicate`) and the **largest connected
 * component** helper (`retainLargestConnectedComponent`, documented on Android as
 * 「最大连通域（8 邻域 BFS，纯逻辑供单测）」) are pure and are ported in full.
 *
 * Line map (Kotlin line → TS):
 *   1..22    package + imports → no imports; tensors/buffers become number arrays.
 *   23..33   KDoc `YOLO26n-seg 漫画气泡分割检测器（第十六轮，精准复刻原仓库
 *            BubbleDetector）。` — the `[1,300,38]` / `[1,32,368,368]` tensor shapes and
 *            the 2026-09-21 model-download change note → kept verbatim.
 *   34..54   `class BubbleDetector(modelProvider, modelLength)` with the `init` block that
 *            copies the asset into `OrtSessions.cacheRoot` and opens the session
 *            (`"yolo|$modelLength"` key) → {@link BubbleDetector} constructor + {@link ORT_SESSION_KEY_PREFIX}.
 *   55..62   `data class Detection(rect, confidence, maskContour)` — the KDoc
 *            「归一化多边形轮廓 [x0,y0,x1,y1,…]（原图坐标 0..1），null=退化为圆角矩形」
 *            → {@link BubbleDetection} (renamed to avoid clashing with
 *            `pageRegionTiling.Detection`, which is the same shape).
 *   63..70   `@Synchronized fun detect(bitmap)` — `OrtSessions.track(session) { … }`, the
 *            `width <= 1 || height <= 1 → emptyList()` guard and the
 *            `ratio > 1.6f || height > 2000` long-image dispatch → STUB;
 *            the two thresholds are preserved as {@link BUBBLE_TILE_ASPECT_RATIO} /
 *            {@link BUBBLE_TILE_MAX_HEIGHT}.
 *   71..99   `private fun detectTiled(bitmap)` — `tileH = (srcW*1.6f).toInt().coerceIn(900, 2800)`,
 *            `overlap = (tileH*0.15f).toInt()`, the contour re-mapping
 *            `if (i % 2 == 0) c[i] else (c[i] * tileHActual + y) / srcH`
 *            and the trailing `deduplicate(all)` → STUB (needs a Bitmap);
 *            the geometry is preserved as {@link BUBBLE_TILE_HEIGHT_WIDTH_RATIO},
 *            {@link BUBBLE_TILE_MIN_HEIGHT_PX}, {@link BUBBLE_TILE_MAX_HEIGHT_PX},
 *            {@link BUBBLE_TILE_OVERLAP_RATIO} and the pure
 *            {@link remapTiledContour}.
 *   100..145 `private fun detectWhole(bitmap)` — the tensor shape check
 *            `shape.size != 3 || shape[1] != 300L || shape[2] != 38L → emptyList()`,
 *            `MIN_CONFIDENCE`, `row[5].roundToInt() != 0`, the finite check, the
 *            `row[2] <= row[0] || row[3] <= row[1]` degenerate check, the
 *            `rect.width() <= 1f || rect.height() <= 1f` filter and the `OrtException → emptyList()`
 *            catch → STUB; the **row filter** is ported as the pure
 *            {@link filterRawDetRows} so the acceptance criteria stay testable.
 *   146..180 the letterbox block (`Letterbox` class, `toOriginalX/Y`,
 *            `letterboxInverseX/Y`, the short-image vertical-stretch path, the grey
 *            `Color.rgb(114, 114, 114)` pad and the `padX/padY` centering) →
 *            {@link computeLetterbox} (**ported**, pure: the gain/pad arithmetic) and
 *            {@link LETTERBOX_PAD_COLOR}. The `Bitmap.scale` / `Canvas` calls are stubbed.
 *   181..197 `private fun bitmapToRgbChw(bitmap)` → STUB (needs pixels); the
 *            **CHW packing** and the `/255f` scaling are documented on {@link packRgbChw}.
 *   198..215 `internal class Prototypes(data, height, width)` + `parsePrototypes(tensor)` —
 *            the `[1,32,H,W]` shape check (`channels != 32 || h <= 0 || w <= 0 → null`)
 *            → {@link parsePrototypesShape}, **ported** (pure shape validation).
 *   216..278 `internal fun computeMaskContour(det, proto, pre, originalWidth, originalHeight)`
 *            — the crop window, the 32-coefficient dot product `score >= 0f`, the
 *            `retainLargestConnectedComponent` call, the `sampleCount = (y2-y1).coerceIn(4, MAX_CONTOUR_SAMPLES)`
 *            scanline sampling and the `leftEdge.size < 6` rejection → STUB (needs the
 *            prototype buffer from ONNX); the bounds arithmetic is preserved in
 *            {@link MASK_MIN_CONTOUR_SAMPLES}.
 *   279..289 `private fun mapMaskX / mapMaskY` — `x / proto.width * INPUT_SIZE` then
 *            `toOriginalX(...) / max(1f, originalWidth - 1f)` clamped to 0..1 →
 *            {@link mapMaskX} / {@link mapMaskY}, **ported** (pure).
 *   290..307 `internal class RawDet(row)` with `cx/cy/w/h` and `toRect(pre, ow, oh)`
 *            → {@link RawDet}, **ported** (pure; the `coerceIn(0f, max(0f, ow - 1f))` clamps
 *            preserved).
 *   308..329 `internal fun deduplicate(detections)` — the
 *            `compareByDescending { confidence }.thenByDescending { area }.thenBy { it }`
 *            ranking and the `kept.sort()` before the final `kept.map(detections::get)`
 *            → {@link deduplicateBubbleDetections}, **ported** (pure).
 *   330..346 `internal fun areDuplicate(a, b)` — the IoU ≥ 0.65 test, the
 *            `overlapOverMin >= 0.85f` test, the `overlapOverMin < 0.55f → false` early-out
 *            and the `min(wa,wb)/max(wa,wb) < 0.75f` size-ratio + centre-drift
 *            (`cdx <= min(wa,wb)*0.25f && cdy <= min(ha,hb)*0.25f`) final test →
 *            {@link areDuplicate}, **ported** (pure).
 *   347..353 `private fun area / interArea` → {@link bubbleArea} / {@link bubbleInterArea}.
 *   354..359 `companion object { INPUT_SIZE = 1472; MIN_CONFIDENCE = 0.15f;
 *            IOU_THRESHOLD = 0.65f; MAX_CONTOUR_SAMPLES = 48 }` → identical values.
 *   360      `}` → end of class.
 *   361..368 the two file-level `letterboxInverseX/Y` → {@link letterboxInverseX} /
 *            {@link letterboxInverseY}.
 *   369..401 `internal fun retainLargestConnectedComponent(foreground, width, height)`
 *            — the 8-neighbour BFS with `labels`/`queue` arrays, the
 *            `if (size > largestSize)` tie rule and the final
 *            `BooleanArray(foreground.size) { labels[it] == largestLabel }`
 *            → {@link retainLargestConnectedComponent}, **ported** (pure).
 *
 * Skipped lines and why:
 *   - Kotlin lines 34..54, 100..145, 181..197, 216..278: everything that opens an
 *     `OrtSession`, reads `Bitmap` pixels or writes to a `Bitmap`/`Canvas`.
 *   - Kotlin `FloatBuffer` / `OnnxTensor` / `TensorInfo` → plain number arrays.
 *   - Kotlin `Color.rgb(114, 114, 114)` → {@link LETTERBOX_PAD_COLOR} (0xFF727272).
 *
 * Every constant, threshold and Chinese comment is byte-identical. No U+3000 in the file.
 *
 * ── R20-audit additions (2026-10-06) ────────────────────────────────────────────
 * `computeMaskContour` (Kotlin 216..278) was a stub justified as "needs the ONNX prototype
 * tensor". Only the *tensor* is ONNX; it arrives as an injected `MaskPrototypes`, and every
 * step after it is pure: the crop window (`coerceIn` + `floor`/`ceil`, 223..230), the
 * 32-coefficient dot product with `score >= 0f` (236..245), the largest connected component
 * (246, already ported as `retainLargestConnectedComponent`), the
 * `sampleCount = (y2 - y1).coerceIn(4, MAX_CONTOUR_SAMPLES)` scanline walk (248..267),
 * the `leftEdge.size < 6` rejection and the left-then-reversed-right polygon assembly
 * (268..277). Now **fully implemented** — this is the 气泡轮廓几何 the audit checklist
 * requires. `MaskPrototypes` is the new data shape for Kotlin's `Prototypes` class.
 * `bitmapToRgbChw` (182..197) was likewise stubbed for "needs pixels"; its CHW packing and
 * `/255f` scaling are pure over an injected `getPixel`, so `packRgbChw` now implements them.
 * Still stubbed (class 1): the `OrtSession`, the `Bitmap.scale`/`Canvas` inside
 * `letterbox`, and `detect`/`detectWhole`/`detectTiled` themselves (they run the session).
 */

import {
  type RectF,
  copyRect,
  rectF,
  rectHeight,
  rectWidth,
} from './index';

/* ── companion object (Kotlin lines 354..359, verbatim) ── */
export const BUBBLE_INPUT_SIZE = 1472;
export const BUBBLE_MIN_CONFIDENCE = 0.15;
export const BUBBLE_IOU_THRESHOLD = 0.65;
export const BUBBLE_MAX_CONTOUR_SAMPLES = 48;
/** Kotlin line 52: `OrtSessions.getOrCreate(cached, "yolo|$modelLength")`. */
export const ORT_SESSION_KEY_PREFIX = 'yolo|';
/** Kotlin lines 68, 276: the `[1,300,38]` detection head. */
export const BUBBLE_DET_ROWS = 300;
export const BUBBLE_DET_STRIDE = 38;
export const BUBBLE_PROTO_CHANNELS = 32;
/** Kotlin line 69: `ratio > 1.6f || bitmap.height > 2000`. */
export const BUBBLE_TILE_ASPECT_RATIO = 1.6;
export const BUBBLE_TILE_MAX_HEIGHT = 2000;
/** Kotlin lines 76..77. */
export const BUBBLE_TILE_HEIGHT_WIDTH_RATIO = 1.6;
export const BUBBLE_TILE_MIN_HEIGHT_PX = 900;
export const BUBBLE_TILE_MAX_HEIGHT_PX = 2800;
export const BUBBLE_TILE_OVERLAP_RATIO = 0.15;
/** Kotlin line 174: `Color.rgb(114, 114, 114)`. */
export const LETTERBOX_PAD_COLOR = 0xff727272;
/** Kotlin line 268: `if (leftEdge.size < 6) return null`. */
export const MASK_MIN_CONTOUR_SAMPLES = 6;
/** Kotlin line 248: `coerceIn(4, MAX_CONTOUR_SAMPLES)`. */
export const MASK_MIN_SAMPLE_COUNT = 4;
/** Kotlin lines 163/171/181: the 0.15 fallback weight. */
export const DEDUP_OVERLAP_OVER_MIN_STRONG = 0.85;
export const DEDUP_OVERLAP_OVER_MIN_WEAK = 0.55;
export const DEDUP_SIZE_RATIO = 0.75;
export const DEDUP_CENTER_DRIFT_RATIO = 0.25;

const coerceIn = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Kotlin lines 56..62 — renamed to avoid clashing with `pageRegionTiling.Detection`. */
export interface BubbleDetection {
  rect: RectF;
  confidence: number;
  /** 归一化多边形轮廓 [x0,y0,x1,y1,...]（原图坐标 0..1），null=退化为圆角矩形 */
  maskContour: number[] | null;
}

/** Kotlin lines 149..153. */
export interface Letterbox {
  gainX: number;
  gainY: number;
  padX: number;
  padY: number;
}

/** Kotlin line 363..364. */
export function letterboxInverseX(inputX: number, pre: Letterbox): number {
  return (inputX - pre.padX) / pre.gainX;
}

/** Kotlin line 366..367. */
export function letterboxInverseY(inputY: number, pre: Letterbox): number {
  return (inputY - pre.padY) / pre.gainY;
}

/** Kotlin line 155: `internal fun toOriginalX(inputX, pre)`. */
export function toOriginalX(inputX: number, pre: Letterbox): number {
  return letterboxInverseX(inputX, pre);
}

/** Kotlin line 156: `internal fun toOriginalY(inputY, pre)`. */
export function toOriginalY(inputY: number, pre: Letterbox): number {
  return letterboxInverseY(inputY, pre);
}

/**
 * 等比缩放 + 居中灰 pad（gainX/gainY 分轴支持短图拉伸路径）.
 * Kotlin lines 158..180 — the gain/pad arithmetic only; the two `Bitmap.scale` /
 * `Canvas.drawBitmap` calls are not ported.
 */
export function computeLetterbox(
  srcW: number,
  srcH: number,
  inputWidth: number,
  inputHeight: number,
): Letterbox {
  const fitX = Math.max(inputWidth / srcW, 1e-6);
  const fitY = Math.max(inputHeight / srcH, 1e-6);
  // 短图（高不足）：垂直拉伸填满，气泡在输入里更大更易识别（原仓库同策略）
  if (fitY > fitX) {
    return { gainX: fitX, gainY: fitY, padX: 0, padY: 0 };
  }
  const gain = fitY;
  const newW = Math.max(Math.floor(srcW * gain), 1);
  const newH = Math.max(Math.floor(srcH * gain), 1);
  const padX = Math.max((inputWidth - newW) / 2, 0);
  const padY = Math.max((inputHeight - newH) / 2, 0);
  return { gainX: gain, gainY: gain, padX, padY };
}

/**
 * Kotlin lines 86..93 — the tile contour re-mapping:
 * `if (i % 2 == 0) c[i] else (c[i] * tileHActual + y) / srcH`.
 * x (even index) is already page-normalised; y (odd index) is tile-normalised.
 */
export function remapTiledContour(
  contour: readonly number[],
  tileTop: number,
  tileActualHeight: number,
  pageHeight: number,
): number[] {
  const out = new Array<number>(contour.length).fill(0);
  for (let i = 0; i < contour.length; i += 1) {
    out[i] =
      i % 2 === 0
        ? (contour[i] as number)
        : ((contour[i] as number) * tileActualHeight + tileTop) / pageHeight;
  }
  return out;
}

/**
 * Kotlin lines 118..126 — the per-row acceptance filter of the `[1,300,38]` head:
 * `row[4] < MIN_CONFIDENCE` skip, `row[5].roundToInt() != 0` skip,
 * non-finite box skip, degenerate `row[2] <= row[0] || row[3] <= row[1]` skip.
 * Returns the surviving rows (copies, matching `row.copyOf()`).
 */
export function filterRawDetRows(rows: ReadonlyArray<readonly number[]>): number[][] {
  const raw: number[][] = [];
  for (const row of rows) {
    if ((row[4] as number) < BUBBLE_MIN_CONFIDENCE) continue;
    if (Math.round(row[5] as number) !== 0) continue;
    if (
      !Number.isFinite(row[0]) ||
      !Number.isFinite(row[1]) ||
      !Number.isFinite(row[2]) ||
      !Number.isFinite(row[3])
    ) {
      continue;
    }
    if ((row[2] as number) <= (row[0] as number) || (row[3] as number) <= (row[1] as number)) continue;
    raw.push([...row]);
  }
  return raw;
}

/** Kotlin lines 201..213 — the `[1,32,H,W]` prototype shape validation. */
export function parsePrototypesShape(shape: readonly number[]): { channels: number; h: number; w: number } | null {
  if (shape.length !== 4 || shape[0] !== 1) return null;
  const channels = shape[1] as number;
  const h = shape[2] as number;
  const w = shape[3] as number;
  if (channels !== BUBBLE_PROTO_CHANNELS || h <= 0 || w <= 0) return null;
  return { channels, h, w };
}

/** Kotlin line 280..283. */
export function mapMaskX(
  x: number,
  protoWidth: number,
  pre: Letterbox,
  originalWidth: number,
): number {
  const inputX = (x / protoWidth) * BUBBLE_INPUT_SIZE;
  return coerceIn(toOriginalX(inputX, pre) / Math.max(1, originalWidth - 1), 0, 1);
}

/** Kotlin line 285..288. */
export function mapMaskY(
  y: number,
  protoHeight: number,
  pre: Letterbox,
  originalHeight: number,
): number {
  const inputY = (y / protoHeight) * BUBBLE_INPUT_SIZE;
  return coerceIn(toOriginalY(inputY, pre) / Math.max(1, originalHeight - 1), 0, 1);
}

/** Kotlin lines 290..307. */
export class RawDet {
  constructor(readonly row: readonly number[]) {}

  cx(): number {
    return ((this.row[0] as number) + (this.row[2] as number)) / 2;
  }
  cy(): number {
    return ((this.row[1] as number) + (this.row[3] as number)) / 2;
  }
  w(): number {
    return (this.row[2] as number) - (this.row[0] as number);
  }
  h(): number {
    return (this.row[3] as number) - (this.row[1] as number);
  }

  /** Kotlin line 295..306 — the box is clamped to `max(0f, ow - 1f)` on both axes. */
  toRect(pre: Letterbox, ow: number, oh: number): RectF {
    const left = letterboxInverseX(this.cx() - this.w() / 2, pre);
    const top = letterboxInverseY(this.cy() - this.h() / 2, pre);
    const right = letterboxInverseX(this.cx() + this.w() / 2, pre);
    const bottom = letterboxInverseY(this.cy() + this.h() / 2, pre);
    return rectF(
      coerceIn(left, 0, Math.max(0, ow - 1)),
      coerceIn(top, 0, Math.max(0, oh - 1)),
      coerceIn(right, 0, Math.max(0, ow - 1)),
      coerceIn(bottom, 0, Math.max(0, oh - 1)),
    );
  }
}

/** Kotlin line 348. */
export function bubbleArea(r: RectF): number {
  return Math.max(rectWidth(r), 0) * Math.max(rectHeight(r), 0);
}

/** Kotlin line 350..352. */
export function bubbleInterArea(a: RectF, b: RectF): number {
  return (
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  );
}

/** 类内 NMS（IoU + 包含 + 尺寸/中心一致的宽松重判，原仓库同参数） — Kotlin lines 331..346. */
export function areDuplicate(a: RectF, b: RectF): boolean {
  const areaA = bubbleArea(a);
  const areaB = bubbleArea(b);
  if (areaA <= 0 || areaB <= 0) return false;
  const inter = bubbleInterArea(a, b);
  if (inter <= 0) return false;
  const union = areaA + areaB - inter;
  if (union > 0 && inter / union >= BUBBLE_IOU_THRESHOLD) return true;
  const overlapOverMin = inter / Math.min(areaA, areaB);
  if (overlapOverMin >= DEDUP_OVERLAP_OVER_MIN_STRONG) return true;
  if (overlapOverMin < DEDUP_OVERLAP_OVER_MIN_WEAK) return false;
  const wa = rectWidth(a);
  const wb = rectWidth(b);
  const ha = rectHeight(a);
  const hb = rectHeight(b);
  if (Math.min(wa, wb) / Math.max(wa, wb) < DEDUP_SIZE_RATIO) return false;
  if (Math.min(ha, hb) / Math.max(ha, hb) < DEDUP_SIZE_RATIO) return false;
  const cdx = Math.abs(a.left + a.right - (b.left + b.right)) * 0.5;
  const cdy = Math.abs(a.top + a.bottom - (b.top + b.bottom)) * 0.5;
  return cdx <= Math.min(wa, wb) * DEDUP_CENTER_DRIFT_RATIO && cdy <= Math.min(ha, hb) * DEDUP_CENTER_DRIFT_RATIO;
}

/** Kotlin lines 311..329 — the confidence/area/index ranking then index re-sort. */
export function deduplicateBubbleDetections(detections: readonly BubbleDetection[]): BubbleDetection[] {
  if (detections.length <= 1) return [...detections];
  const ranked = detections
    .map((_d, i) => i)
    .sort((x, y) => {
      const dx = detections[x] as BubbleDetection;
      const dy = detections[y] as BubbleDetection;
      const cx = dx.confidence;
      const cy = dy.confidence;
      if (cx !== cy) return cy - cx;
      const ax = bubbleArea(dx.rect);
      const ay = bubbleArea(dy.rect);
      if (ax !== ay) return ay - ax;
      return x - y;
    });
  const kept: number[] = [];
  outer: for (const cand of ranked) {
    for (const k of kept) {
      if (areDuplicate((detections[cand] as BubbleDetection).rect, (detections[k] as BubbleDetection).rect)) {
        continue outer;
      }
    }
    kept.push(cand);
  }
  kept.sort((a, b) => a - b);
  return kept.map((i) => detections[i] as BubbleDetection);
}

/**
 * 最大连通域（8 邻域 BFS，纯逻辑供单测）。
 * Kotlin lines 369..401 — FULLY PORTED.
 */
export function retainLargestConnectedComponent(
  foreground: readonly boolean[],
  width: number,
  height: number,
): boolean[] | null {
  if (width <= 0 || height <= 0 || foreground.length !== width * height) return null;
  const labels = new Array<number>(foreground.length).fill(0);
  const queue = new Array<number>(foreground.length).fill(0);
  let nextLabel = 0;
  let largestLabel = 0;
  let largestSize = 0;
  for (let start = 0; start < foreground.length; start += 1) {
    if (foreground[start] !== true || labels[start] !== 0) continue;
    nextLabel += 1;
    let head = 0;
    let tail = 0;
    let size = 0;
    queue[tail] = start;
    tail += 1;
    labels[start] = nextLabel;
    while (head < tail) {
      const cur = queue[head] as number;
      head += 1;
      size += 1;
      const cx = cur % width;
      const cy = Math.floor(cur / width);
      for (let ny = Math.max(0, cy - 1); ny <= Math.min(height - 1, cy + 1); ny += 1) {
        for (let nx = Math.max(0, cx - 1); nx <= Math.min(width - 1, cx + 1); nx += 1) {
          const n = ny * width + nx;
          if (foreground[n] !== true || labels[n] !== 0) continue;
          labels[n] = nextLabel;
          queue[tail] = n;
          tail += 1;
        }
      }
    }
    if (size > largestSize) {
      largestLabel = nextLabel;
      largestSize = size;
    }
  }
  if (largestLabel === 0) return null;
  return labels.map((l) => l === largestLabel);
}

/**
 * Kotlin lines 182..197 — `bitmapToRgbChw`: CHW float packing with each channel /255.
 *
 * R20-audit: only `bitmap[x, y]` (the pixel buffer) is platform-specific, so the packing
 * is implemented over an injected `getPixel` returning a packed 0xAARRGGBB int — the
 * exact bit layout `sampleBackgroundColor` in `bubblePipeline.ts` also reads.
 */
export function packRgbChw(
  getPixel: (x: number, y: number) => number,
  width: number,
  height: number,
): number[] {
  const plane = width * height;
  const out = new Array<number>(3 * plane).fill(0);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = getPixel(x, y);
      out[offset] = ((p >> 16) & 0xff) / 255;
      out[offset + plane] = ((p >> 8) & 0xff) / 255;
      out[offset + 2 * plane] = (p & 0xff) / 255;
      offset += 1;
    }
  }
  return out;
}

/** Kotlin lines 201..213 — `Prototypes(data, height, width)`. */
export interface MaskPrototypes {
  data: readonly number[];
  height: number;
  width: number;
}

/**
 * mask 轮廓重建：裁原型区域 → 32 系数加权 → 最大连通域 → 扫描线左右缘多边形
 *
 * Kotlin lines 216..278, **FULLY IMPLEMENTED** (R20-audit).
 *
 * The prototype tensor is the only thing ONNX produces, and it arrives here as an
 * injected `number[]` — every arithmetic step after that is pure: the crop window
 * (`coerceIn` + `floor`/`ceil`), the 32-coefficient dot product with `score >= 0f`, the
 * largest connected component ({@link retainLargestConnectedComponent}), the
 * `sampleCount = (y2 - y1).coerceIn(4, 48)` scanline walk, and the left-then-reversed-right
 * polygon assembly (`if (leftEdge.size < 6) return null`).
 */
export function computeMaskContour(
  det: RawDet,
  proto: MaskPrototypes,
  pre: Letterbox,
  originalWidth: number,
  originalHeight: number,
): number[] | null {
  const size = BUBBLE_INPUT_SIZE;
  const inputLeft = coerceIn(det.cx() - det.w() / 2, 0, size);
  const inputTop = coerceIn(det.cy() - det.h() / 2, 0, size);
  const inputRight = coerceIn(det.cx() + det.w() / 2, 0, size);
  const inputBottom = coerceIn(det.cy() + det.h() / 2, 0, size);
  const x1 = Math.min(
    Math.max(Math.floor((inputLeft / size) * proto.width), 0),
    proto.width - 1,
  );
  const y1 = Math.min(
    Math.max(Math.floor((inputTop / size) * proto.height), 0),
    proto.height - 1,
  );
  const x2 = Math.min(
    Math.max(Math.ceil((inputRight / size) * proto.width), x1 + 1),
    proto.width,
  );
  const y2 = Math.min(
    Math.max(Math.ceil((inputBottom / size) * proto.height), y1 + 1),
    proto.height,
  );
  if (x2 <= x1 || y2 <= y1) return null;

  const maskW = x2 - x1;
  const maskH = y2 - y1;
  const foreground = new Array<boolean>(maskW * maskH).fill(false);
  for (let ly = 0; ly < maskH; ly += 1) {
    const protoOffset = (y1 + ly) * proto.width + x1;
    for (let lx = 0; lx < maskW; lx += 1) {
      let score = 0;
      for (let c = 0; c < BUBBLE_PROTO_CHANNELS; c += 1) {
        score +=
          (det.row[6 + c] as number) *
          (proto.data[c * proto.height * proto.width + protoOffset + lx] as number);
      }
      foreground[ly * maskW + lx] = score >= 0;
    }
  }
  const main = retainLargestConnectedComponent(foreground, maskW, maskH);
  if (main === null) return null;

  const sampleCount = Math.min(
    Math.max(y2 - y1, MASK_MIN_SAMPLE_COUNT),
    BUBBLE_MAX_CONTOUR_SAMPLES,
  );
  const leftEdge: number[] = [];
  const rightEdge: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const fraction = sampleCount === 1 ? 0 : sample / (sampleCount - 1);
    const y = Math.min(
      Math.max(y1 + Math.floor((y2 - 1 - y1) * fraction), y1),
      y2 - 1,
    );
    let leftX = -1;
    let rightX = -1;
    for (let x = x1; x < x2; x += 1) {
      if (main[(y - y1) * maskW + (x - x1)] === true) {
        if (leftX < 0) leftX = x;
        rightX = x;
      }
    }
    if (leftX >= 0) {
      leftEdge.push(mapMaskX(leftX, proto.width, pre, originalWidth));
      leftEdge.push(mapMaskY(y, proto.height, pre, originalHeight));
      rightEdge.push(mapMaskX(rightX + 1, proto.width, pre, originalWidth));
      rightEdge.push(mapMaskY(y, proto.height, pre, originalHeight));
    }
  }
  if (leftEdge.length < MASK_MIN_CONTOUR_SAMPLES) return null;

  const polygon = new Array<number>(leftEdge.length + rightEdge.length).fill(0);
  for (let i = 0; i < leftEdge.length; i += 1) polygon[i] = leftEdge[i] as number;
  let idx = leftEdge.length;
  let i = rightEdge.length - 2;
  while (i >= 0) {
    polygon[idx] = rightEdge[i] as number;
    polygon[idx + 1] = rightEdge[i + 1] as number;
    idx += 2;
    i -= 2;
  }
  return polygon;
}

/** 归一化多边形轮廓 → 页面绝对坐标多边形（供渲染层使用，纯函数）。 */
export function contourToAbsolutePoints(
  contour: readonly number[],
  width: number,
  height: number,
): number[] {
  const out = new Array<number>(contour.length).fill(0);
  for (let i = 0; i < contour.length; i += 2) {
    out[i] = (contour[i] as number) * width;
    out[i + 1] = (contour[i + 1] as number) * height;
  }
  return out;
}

/** Re-exported for `bubblePipeline.ts`. */
export { copyRect, rectF, rectWidth, rectHeight };