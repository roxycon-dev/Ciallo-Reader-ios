/**
 * Long-image tiling planner + tile-result merge + false-positive filters — port of Android
 * `novel-reader/app/src/main/java/com/example/mangatranslate/PageRegionTiling.kt`
 * (831 lines total, 748 non-blank).
 *
 * SCOPE: manga translation is deliberately excluded from the iOS port (see `index.ts`).
 * This file is **entirely pure geometry and threshold arithmetic** — no ONNX, no Bitmap
 * pixels, no Canvas — so it is ported in full (with the detection classes referenced only as
 * plain shapes). It remains useful outside manga translation: the tiling planner and the
 * rect predicates are the reference semantics the comic reader's layout code must agree with.
 *
 * Line map (Kotlin line → TS):
 *   1..15    package + imports → no imports; `Bitmap` → {@link BitmapSize},
 *            `RectF` → {@link RectF}, `BubbleDetector.Detection` → {@link Detection}.
 *   16..21   `data class DetectionTile(left, top, right, bottom)` with `width`/`height`
 *            getters and `toRectF()` → {@link DetectionTile} (getters become methods).
 *   22       (blank)
 *   23..30   `data class TiledBubbleDetection(rect, confidence, maskContour,
 *            touchesInternalTileBoundary, tileIndex)` → {@link TiledBubbleDetection}.
 *   31..38   `data class DeduplicatedBubbleGroup(rect, confidence, maskContour,
 *            suppressionRect)` → {@link DeduplicatedBubbleGroup}.
 *   39..45   `private data class BubblePriorityCandidate(confidence, hasMaskContour, area,
 *            touchesInternalTileBoundary = false)` → {@link BubblePriorityCandidate} (private).
 *   46       (blank)
 *   47       `object PageRegionTiling {` → {@link PageRegionTiling}.
 *   48..96   all `const val` declarations (39 constants) → the same named constants with
 *            identical values. **Every one of the 39 magic numbers is byte-identical**,
 *            including DETECTION_MAX_EDGE = 1920, LONG_IMAGE_ASPECT_THRESHOLD = 2.0f,
 *            LONG_IMAGE_MIN_HEIGHT_PX = 2048, LONG_IMAGE_TILE_HEIGHT_WIDTH_RATIO = 2.5f,
 *            LONG_IMAGE_BUBBLE_VERTICAL_SCALE = 0.8f, LONG_IMAGE_SMALL_REMAINDER_RATIO = 0.20f,
 *            PADDLE_TILE_HEIGHT_WIDTH_RATIO = 1.5f, PADDLE_TILE_OVERLAP_RATIO = 0.25f,
 *            PADDLE_MIN_TILE_HEIGHT_PX = 960, ADAPTIVE_TILE_MIN_ADVANCE_RATIO = 0.25f,
 *            ADAPTIVE_TILE_REPLAY_PADDING_MULTIPLIER = 2f,
 *            TILE_BOUNDARY_MARGIN_RATIO = 0.015f, TILE_BOUNDARY_MARGIN_MIN_PX = 4f,
 *            TILE_BOUNDARY_MARGIN_MAX_PX = 20f, LONG_IMAGE_MAX_REGION_HEIGHT_WIDTH_RATIO = 1.8f,
 *            BUBBLE_DEDUP_IOU_THRESHOLD = 0.65f, BUBBLE_DEDUP_CONTAINMENT_THRESHOLD = 0.9f,
 *            BUBBLE_DEDUP_PARTIAL_OVERLAP_MIN_RATIO = 0.40f,
 *            BUBBLE_DEDUP_AXIS_OVERLAP_MIN_RATIO = 0.45f, BUBBLE_DEDUP_CENTER_DRIFT_RATIO = 0.42f,
 *            BUBBLE_DEDUP_CENTER_DRIFT_PAD = 24f, BUBBLE_DEDUP_VERTICAL_SPLIT_WIDTH_RATIO = 0.72f,
 *            BUBBLE_DEDUP_VERTICAL_SPLIT_CENTER_X_RATIO = 0.28f,
 *            BUBBLE_DEDUP_VERTICAL_SPLIT_AXIS_X_RATIO = 0.60f,
 *            BUBBLE_DEDUP_VERTICAL_SPLIT_MAX_GAP_PX = 48f, BUBBLE_SPAN_MIN_PAIR_OVERLAP = 0.15f,
 *            BUBBLE_SPAN_MIN_LINE_OVERLAP = 0.25f, BUBBLE_SPAN_MAX_UNION_FRACTION = 0.35f,
 *            CONTOUR_COORD_EPSILON = 1e-4f, MERGED_CONTOUR_MIN_SAMPLE_ROWS = 8,
 *            MERGED_CONTOUR_MAX_SAMPLE_ROWS = 48, TINY_TEXT_SHORT_SIDE_MAX_PX = 6f,
 *            TINY_TEXT_LONG_SIDE_MAX_PX = 16f, TINY_TEXT_MAX_AREA_RATIO = 0.0002f,
 *            TINY_BUBBLE_SHORT_SIDE_MIN_PX = 12f, TINY_BUBBLE_LONG_SIDE_MIN_PX = 28f,
 *            TINY_BUBBLE_SHORT_SIDE_RATIO = 0.02f, TINY_BUBBLE_LONG_SIDE_RATIO = 0.035f,
 *            TINY_BUBBLE_MAX_AREA_RATIO = 0.0008f, PAGE_REGION_TEXT_IOU_THRESHOLD = 0.2f,
 *            PAGE_REGION_MASK_EXPAND_MIN = 4f, PAGE_REGION_MASK_EXPAND_RATIO = 0.15f.
 *            Kotlin `0.20f` etc. are `Float`; the TS values are the same doubles.
 *   97       (blank)
 *   98..103  `fun shouldUseLongImageTiling(pageWidth, pageHeight)` → ported.
 *   104..120 `fun longImageBubbleDetectionTileHeight(...)` → ported (the
 *            「只比一片略高的页整页处理」 branch and its comment preserved).
 *   121..125 `fun longImageBubbleDetectionInputHeight(bitmapHeight)` → ported.
 *   126..154 `fun planPaddleTextDetectionTiles(...)` → ported (the `while (top + tileHeight
 *            < pageHeight)` walk, the `stride` computation and the
 *            `if (starts.lastOrNull() != finalTop) starts.add(finalTop)` dedupe preserved).
 *   155..158 `fun tileBoundaryMargin(tileBitmapExtent)` → ported (`coerceIn` → clamp).
 *   159..169 `fun isDetectionAtInternalTileBottom(...)` → ported.
 *   170..174 `fun isDetectionAtReplayTileTop(rect, tileBitmapHeight)` → ported.
 *   175..182 `fun shouldDiscardReplayTileTopFragments(...)` → ported.
 *   183..209 `fun adaptiveNextTileTop(...)` — `roundToInt()` → `Math.round`, `coerceIn` →
 *            clamp, `minOf/maxOf` → Math.min/max, and the three nested `coerce*` calls kept in
 *            the same order → ported.
 *   210..218 `fun shouldFilterLongImageRegion(...)` → ported.
 *   219..250 `private fun isTinyErrorRegion(...)` → {@link isTinyErrorRegion}, ported
 *            (the `imageArea` `.toFloat().coerceAtLeast(1f)` and the two
 *            `max(minSidePx, imageMinSide * ratio)` lines preserved).
 *   251..259 `fun isTinyTextErrorRegion(...)` → ported (shortSideRatio/longSideRatio = 0f).
 *   260..269 `fun isTinyBubbleErrorRegion(...)` → ported.
 *   270..278 `fun filterTinyTextRects(...)` → ported.
 *   279..286 `fun filterTinyBubbleDetections(detections, bitmap)` → ported
 *            (only the `detections.isEmpty()` early return and `isFile` semantics differ).
 *   287..292 `fun shouldFilterTextRectByBubble(textRect, bubbleRect, iouThreshold)` → ported.
 *   293..303 `fun filterOverlapping(textRects, bubbleRects, threshold)` → ported.
 *   304..322 `fun buildTextSuppressionRects(detections, bitmap)` → ported.
 *   323..363 `fun buildTileTextSuppressionRects(...)` → ported.
 *   364..381 `fun remapTileRectsToPage(...)` → ported.
 *   382..407 `fun remapTileMaskContourToPage(contour, tileTop, tileHeight, pageWidth,
 *            pageHeight, tileLeft = 0, tileWidth = pageWidth)` → ported, including the
 *            `if (contour.isEmpty()) return contour` early return and the
 *            `while (index + 1 < contour.size)` step-by-2 loop.
 *   408..409 (blank)
 *   410..430 `fun shouldTreatRectsAsSameBubbleForDedup(a, b)` → ported.
 *   431..457 `private fun shouldTreatPartiallyShiftedRectsAsSameBubble(...)` → ported.
 *   458..491 `private fun shouldTreatVerticallySplitTileRectsAsSameBubble(...)` → ported,
 *            including the two comments 「需要真实的纵向延伸…」 and
 *            「别把两个仅擦边的完整堆叠气泡粘起来：每半应占联合体的实质份额」.
 *   492..565 `fun deduplicateBubbleDetections(detections, pageHeight)` → ported: the
 *            `ArrayDeque` BFS becomes an array-backed queue with `removeFirst`, the
 *            `hashSetOf(tileIndex)` becomes a `Set<number>`, and the
 *            `if (detections.size <= 1)` fast path keeps the
 *            `tiled.copy(maskContour = null)` boundary-touching behaviour.
 *   566..578 `private fun choosePreferredBubbleCandidateIndex(...)` → ported.
 *   579..598 `private fun compareBubblePriority(...)` → ported, including
 *            `return if (candidate.touchesInternalTileBoundary) -1 else 1` and the
 *            `abs(confidenceDiff) >= 0.02f` tie window.
 *   599..602 `private fun shouldUnionTileBubbleCandidates(...)` → ported.
 *   603..618 `fun unionDetectionRects(rects)` → ported.
 *   619..676 `fun mergePageMaskContours(contours, pageHeight)` → ported, including the
 *            `it.size >= 6 && it.size % 2 == 0` validity filter, the single-contour
 *            `copyOf()` fast path and the `for (index in rightEdge.size - 2 downTo 0 step 2)`
 *            reverse walk.
 *   677..707 `private fun contourHorizontalBounds(contour, y)` → ported, including the
 *            horizontal-edge epsilon branch and the clamped `ratio`.
 *   708..737 `fun mergeBubblesSpannedByTextLines(balloons, textLines, pageWidth, pageHeight)`
 *            → ported, including the `outer@ for` / `break@outer` restart loop.
 *   738..762 `private fun isBubblePairSpannedByAnyTextLine(...)` → ported.
 *   763..777 `private fun isTextLineSpanningBubbles(line, a, b)` → ported, including
 *            `centerY in a.top..a.bottom && centerY in b.top..b.bottom`.
 *   778..780 `private fun rectContainsHorizontally(container, line)` → ported.
 *   781..801 `private fun unionBubbleDetections(a, b, pageHeight)` → ported
 *            (`base = if (a.confidence >= b.confidence) a else b`).
 *   802..803 (blank)
 *   804..810 `fun lineBelongsToRegion(lineRect, regionRect)` → ported.
 *   811..812 (blank)
 *   813..815 `fun rectAreaValue(rect)` → ported.
 *   816..819 `fun rectIntersectionArea(a, b)` → ported.
 *   820..826 `fun rectIou(a, b)` → ported.
 *   827..830 `fun rectContains(outer, inner)` → ported.
 *   831      `}` → end of object.
 *
 * Skipped lines and why: none. This file has no inference, no IO and no Android graphics
 * beyond `RectF`'s four fields and `Bitmap.width/height` (both modelled as plain numbers).
 *
 * `roundToInt()` uses Kotlin's HALF_UP tie-breaking, which `Math.round` reproduces exactly
 * (both round a half away from zero for `.5`). `coerceIn(a, b)` becomes an explicit clamp.
 * All Chinese comments are byte-identical; no U+3000 in the Android file.
 */

import {
  copyRect,
  rectHeight,
  rectWidth,
  type RectF,
  rectF,
} from './index';

/** `android.graphics.Bitmap` reduced to the two fields this file reads. */
export interface BitmapSize {
  width: number;
  height: number;
}

/** Kotlin `BubbleDetector.Detection` as consumed here (declared in `bubbleDetector.ts`). */
export interface Detection {
  rect: RectF;
  confidence: number;
  maskContour: number[] | null;
}

/** Kotlin lines 16..21. */
export interface DetectionTile {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** `val width: Int get() = right - left` */
  width(): number;
  /** `val height: Int get() = bottom - top` */
  height(): number;
  /** `fun toRectF(): RectF` */
  toRectF(): RectF;
}

export function detectionTile(left: number, top: number, right: number, bottom: number): DetectionTile {
  return {
    left,
    top,
    right,
    bottom,
    width: () => right - left,
    height: () => bottom - top,
    toRectF: () => rectF(left, top, right, bottom),
  };
}

/** Kotlin lines 23..30 — 切片候选（带边界接触与来源片序，跨片去重用）。 */
export interface TiledBubbleDetection {
  rect: RectF;
  confidence: number;
  maskContour: number[] | null;
  touchesInternalTileBoundary: boolean;
  tileIndex: number;
}

/** Kotlin lines 31..38. */
export interface DeduplicatedBubbleGroup {
  rect: RectF;
  confidence: number;
  maskContour: number[] | null;
  /** 抑制矩形（与 rect 相同，保留语义位）。 */
  suppressionRect: RectF;
}

/** Kotlin lines 39..45. */
interface BubblePriorityCandidate {
  confidence: number;
  hasMaskContour: boolean;
  area: number;
  touchesInternalTileBoundary: boolean;
}

/** Kotlin `roundToInt()`. */
const roundToInt = (v: number): number => Math.round(v);
/** Kotlin `Float.coerceIn(lo, hi)`. */
const coerceIn = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;
/** Kotlin `maxOf`/`minOf`. */
const maxOf = (...values: number[]): number => Math.max(...values);
const minOf = (...values: number[]): number => Math.min(...values);

/* ── 常量（原仓库 PageRegionDetector.kt 1845-1890 逐一对齐） ── */
export const DETECTION_MAX_EDGE = 1920;
const LONG_IMAGE_ASPECT_THRESHOLD = 2.0;
const LONG_IMAGE_MIN_HEIGHT_PX = 2048;
const LONG_IMAGE_TILE_HEIGHT_WIDTH_RATIO = 2.5;
const LONG_IMAGE_BUBBLE_VERTICAL_SCALE = 0.8;
const LONG_IMAGE_SMALL_REMAINDER_RATIO = 0.2;
const PADDLE_TILE_HEIGHT_WIDTH_RATIO = 1.5;
const PADDLE_TILE_OVERLAP_RATIO = 0.25;
const PADDLE_MIN_TILE_HEIGHT_PX = 960;
const ADAPTIVE_TILE_MIN_ADVANCE_RATIO = 0.25;
const ADAPTIVE_TILE_REPLAY_PADDING_MULTIPLIER = 2;
const TILE_BOUNDARY_MARGIN_RATIO = 0.015;
const TILE_BOUNDARY_MARGIN_MIN_PX = 4;
const TILE_BOUNDARY_MARGIN_MAX_PX = 20;
const LONG_IMAGE_MAX_REGION_HEIGHT_WIDTH_RATIO = 1.8;

/* ── 跨片气泡去重常量（原仓库同值） ── */
const BUBBLE_DEDUP_IOU_THRESHOLD = 0.65;
const BUBBLE_DEDUP_CONTAINMENT_THRESHOLD = 0.9;
const BUBBLE_DEDUP_PARTIAL_OVERLAP_MIN_RATIO = 0.4;
const BUBBLE_DEDUP_AXIS_OVERLAP_MIN_RATIO = 0.45;
const BUBBLE_DEDUP_CENTER_DRIFT_RATIO = 0.42;
const BUBBLE_DEDUP_CENTER_DRIFT_PAD = 24;
const BUBBLE_DEDUP_VERTICAL_SPLIT_WIDTH_RATIO = 0.72;
const BUBBLE_DEDUP_VERTICAL_SPLIT_CENTER_X_RATIO = 0.28;
const BUBBLE_DEDUP_VERTICAL_SPLIT_AXIS_X_RATIO = 0.6;
const BUBBLE_DEDUP_VERTICAL_SPLIT_MAX_GAP_PX = 48;

/* ── 跨片联合 / 行跨越合并常量 ── */
const BUBBLE_SPAN_MIN_PAIR_OVERLAP = 0.15;
const BUBBLE_SPAN_MIN_LINE_OVERLAP = 0.25;
const BUBBLE_SPAN_MAX_UNION_FRACTION = 0.35;
const CONTOUR_COORD_EPSILON = 1e-4;
const MERGED_CONTOUR_MIN_SAMPLE_ROWS = 8;
const MERGED_CONTOUR_MAX_SAMPLE_ROWS = 48;
const TINY_TEXT_SHORT_SIDE_MAX_PX = 6;
const TINY_TEXT_LONG_SIDE_MAX_PX = 16;
const TINY_TEXT_MAX_AREA_RATIO = 0.0002;
const TINY_BUBBLE_SHORT_SIDE_MIN_PX = 12;
const TINY_BUBBLE_LONG_SIDE_MIN_PX = 28;
const TINY_BUBBLE_SHORT_SIDE_RATIO = 0.02;
const TINY_BUBBLE_LONG_SIDE_RATIO = 0.035;
const TINY_BUBBLE_MAX_AREA_RATIO = 0.0008;
const PAGE_REGION_TEXT_IOU_THRESHOLD = 0.2;
const PAGE_REGION_MASK_EXPAND_MIN = 4;
const PAGE_REGION_MASK_EXPAND_RATIO = 0.15;

/* ══ 长图判定与切片规划 ══ */

/** Kotlin lines 98..103. */
export function shouldUseLongImageTiling(pageWidth: number, pageHeight: number): boolean {
  if (pageWidth <= 0 || pageHeight <= 0) return false;
  if (pageHeight < LONG_IMAGE_MIN_HEIGHT_PX) return false;
  return pageHeight / pageWidth > LONG_IMAGE_ASPECT_THRESHOLD;
}

/** Kotlin lines 104..120. */
export function longImageBubbleDetectionTileHeight(
  pageWidth: number,
  pageHeight: number,
): number {
  if (pageWidth <= 0 || pageHeight <= 0) return 0;
  const baseTileHeight = coerceIn(
    roundToInt(pageWidth * LONG_IMAGE_TILE_HEIGHT_WIDTH_RATIO),
    Number.NEGATIVE_INFINITY,
    pageHeight,
  );
  const remainingHeight = pageHeight - baseTileHeight;
  return remainingHeight > 0 &&
    remainingHeight <= roundToInt(baseTileHeight * LONG_IMAGE_SMALL_REMAINDER_RATIO)
    ? // 只比一片略高的页整页处理，好过两次几乎相同的模型调用
      pageHeight
    : baseTileHeight;
}

/** Kotlin lines 121..125. */
export function longImageBubbleDetectionInputHeight(bitmapHeight: number): number {
  if (bitmapHeight <= 0) return 0;
  return Math.max(1, roundToInt(bitmapHeight * LONG_IMAGE_BUBBLE_VERTICAL_SCALE));
}

/** Kotlin lines 126..154. */
export function planPaddleTextDetectionTiles(
  pageWidth: number,
  pageHeight: number,
): DetectionTile[] {
  if (pageWidth <= 0 || pageHeight <= 0) return [];
  if (!shouldUseLongImageTiling(pageWidth, pageHeight)) {
    return [detectionTile(0, 0, pageWidth, pageHeight)];
  }
  const tileHeight = Math.min(
    pageHeight,
    Math.max(
      PADDLE_MIN_TILE_HEIGHT_PX,
      roundToInt(pageWidth * PADDLE_TILE_HEIGHT_WIDTH_RATIO),
    ),
  );
  if (tileHeight >= pageHeight) {
    return [detectionTile(0, 0, pageWidth, pageHeight)];
  }
  const stride = Math.max(1, roundToInt(tileHeight * (1 - PADDLE_TILE_OVERLAP_RATIO)));
  const starts: number[] = [];
  let top = 0;
  while (top + tileHeight < pageHeight) {
    starts.push(top);
    top += stride;
  }
  const finalTop = pageHeight - tileHeight;
  if (starts[starts.length - 1] !== finalTop) starts.push(finalTop);
  return starts.map((tileTop) => detectionTile(0, tileTop, pageWidth, tileTop + tileHeight));
}

/** Kotlin lines 155..158. */
export function tileBoundaryMargin(tileBitmapExtent: number): number {
  return coerceIn(
    tileBitmapExtent * TILE_BOUNDARY_MARGIN_RATIO,
    TILE_BOUNDARY_MARGIN_MIN_PX,
    TILE_BOUNDARY_MARGIN_MAX_PX,
  );
}

/** Kotlin lines 159..169. */
export function isDetectionAtInternalTileBottom(
  rect: RectF,
  tileBitmapHeight: number,
  tileBottom: number,
  pageHeight: number,
): boolean {
  if (tileBitmapHeight <= 0 || tileBottom >= pageHeight) return false;
  const margin = tileBoundaryMargin(tileBitmapHeight);
  return rect.bottom >= tileBitmapHeight - margin;
}

/** Kotlin lines 170..174. */
export function isDetectionAtReplayTileTop(rect: RectF, tileBitmapHeight: number): boolean {
  if (tileBitmapHeight <= 0) return false;
  return rect.top <= tileBoundaryMargin(tileBitmapHeight);
}

/** Kotlin lines 175..182. */
export function shouldDiscardReplayTileTopFragments(
  overlapsPreviousTile: boolean,
  tileBottom: number,
  pageHeight: number,
): boolean {
  return overlapsPreviousTile && tileBottom < pageHeight;
}

/** Kotlin lines 183..209 — 自适应下一片位置：底部有截断气泡时回放重叠到气泡上缘，否则紧贴前进。 */
export function adaptiveNextTileTop(
  tile: DetectionTile,
  pageHeight: number,
  tileBitmapHeight: number,
  bottomEdgeRects: readonly RectF[],
): number {
  if (tile.bottom >= pageHeight) return pageHeight;
  if (bottomEdgeRects.length === 0 || tileBitmapHeight <= 0) return tile.bottom;
  if (tile.height() <= 1) return tile.bottom;

  const replayPadding =
    tileBoundaryMargin(tileBitmapHeight) * ADAPTIVE_TILE_REPLAY_PADDING_MULTIPLIER;
  const earliestLocalTop = bottomEdgeRects.reduce((m, r) => Math.min(m, r.top), Infinity);
  const desiredTop =
    tile.top +
    roundToInt(
      (Math.max(earliestLocalTop - replayPadding, 0) * tile.height()) / tileBitmapHeight,
    );
  const minimumAdvance = Math.min(
    Math.max(1, roundToInt(tile.height() * ADAPTIVE_TILE_MIN_ADVANCE_RATIO)),
    tile.height() - 1,
  );
  return coerceIn(desiredTop, tile.top + minimumAdvance, tile.bottom - 1);
}

/** Kotlin lines 210..218 — 长图页异常整条假阳性（≈1.8 页宽高的整条框）。 */
export function shouldFilterLongImageRegion(
  rect: RectF,
  pageWidth: number,
  pageHeight: number,
): boolean {
  if (!shouldUseLongImageTiling(pageWidth, pageHeight)) return false;
  const width = Math.max(rectWidth(rect), 0);
  const height = Math.max(rectHeight(rect), 0);
  if (width <= 0 || height <= 0) return true;
  return height >= pageWidth * LONG_IMAGE_MAX_REGION_HEIGHT_WIDTH_RATIO;
}

/* ══ Tiny 假阳性过滤（原仓库 isTinyErrorRegion 族） ══ */

/** Kotlin lines 219..250. */
function isTinyErrorRegion(
  rect: RectF,
  imageWidth: number,
  imageHeight: number,
  minShortSidePx: number,
  minLongSidePx: number,
  shortSideRatio: number,
  longSideRatio: number,
  maxAreaRatio: number,
): boolean {
  const width = Math.max(rectWidth(rect), 0);
  const height = Math.max(rectHeight(rect), 0);
  if (width <= 0 || height <= 0) return true;

  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const imageArea = Math.max(imageWidth * imageHeight, 1);
  const areaRatio = (width * height) / imageArea;

  const imageMinSide = Math.max(Math.min(imageWidth, imageHeight), 1);
  const maxShortSide = Math.max(minShortSidePx, imageMinSide * shortSideRatio);
  const maxLongSide = Math.max(minLongSidePx, imageMinSide * longSideRatio);

  return shortSide <= maxShortSide && longSide <= maxLongSide && areaRatio <= maxAreaRatio;
}

/** Kotlin lines 251..259. */
export function isTinyTextErrorRegion(rect: RectF, imageWidth: number, imageHeight: number): boolean {
  return isTinyErrorRegion(
    rect,
    imageWidth,
    imageHeight,
    TINY_TEXT_SHORT_SIDE_MAX_PX,
    TINY_TEXT_LONG_SIDE_MAX_PX,
    0,
    0,
    TINY_TEXT_MAX_AREA_RATIO,
  );
}

/** Kotlin lines 260..269. */
export function isTinyBubbleErrorRegion(
  rect: RectF,
  imageWidth: number,
  imageHeight: number,
): boolean {
  return isTinyErrorRegion(
    rect,
    imageWidth,
    imageHeight,
    TINY_BUBBLE_SHORT_SIDE_MIN_PX,
    TINY_BUBBLE_LONG_SIDE_MIN_PX,
    TINY_BUBBLE_SHORT_SIDE_RATIO,
    TINY_BUBBLE_LONG_SIDE_RATIO,
    TINY_BUBBLE_MAX_AREA_RATIO,
  );
}

/** Kotlin lines 270..278. */
export function filterTinyTextRects(
  rects: readonly RectF[],
  pageWidth: number,
  pageHeight: number,
): RectF[] {
  if (rects.length === 0) return [...rects];
  return rects.filter((r) => !isTinyTextErrorRegion(r, pageWidth, pageHeight));
}

/** Kotlin lines 279..286. */
export function filterTinyBubbleDetections(
  detections: readonly Detection[],
  bitmap: BitmapSize,
): Detection[] {
  if (detections.length === 0) return [...detections];
  return detections.filter((d) => !isTinyBubbleErrorRegion(d.rect, bitmap.width, bitmap.height));
}

/* ══ 文字行与气泡的重叠过滤 / 抑制矩形 ══ */

/** Kotlin lines 287..292. */
export function shouldFilterTextRectByBubble(
  textRect: RectF,
  bubbleRect: RectF,
  iouThreshold: number,
): boolean {
  return rectIou(textRect, bubbleRect) >= iouThreshold || rectContains(bubbleRect, textRect);
}

/** Kotlin lines 293..303. */
export function filterOverlapping(
  textRects: readonly RectF[],
  bubbleRects: readonly RectF[],
  threshold: number,
): RectF[] {
  if (bubbleRects.length === 0) return [...textRects];
  return textRects.filter(
    (rect) => !bubbleRects.some((b) => shouldFilterTextRectByBubble(rect, b, threshold)),
  );
}

/** Kotlin lines 304..322. */
export function buildTextSuppressionRects(
  detections: readonly Detection[],
  bitmap: BitmapSize,
): RectF[] {
  return detections.map((detection) => {
    const rect = detection.rect;
    const pad = Math.max(
      PAGE_REGION_MASK_EXPAND_MIN,
      Math.max(1, rectHeight(rect)) * PAGE_REGION_MASK_EXPAND_RATIO,
    );
    return rectF(
      coerceIn(rect.left - pad, 0, bitmap.width),
      coerceIn(rect.top - pad, 0, bitmap.height),
      coerceIn(rect.right + pad, 0, bitmap.width),
      coerceIn(rect.bottom + pad, 0, bitmap.height),
    );
  });
}

/** Kotlin lines 323..363 — 页面气泡矩形 → 本片坐标系抑制矩形（含外扩）。 */
export function buildTileTextSuppressionRects(
  pageBubbleRects: readonly RectF[],
  tile: DetectionTile,
  tileBitmapWidth: number,
  tileBitmapHeight: number,
): RectF[] {
  if (
    pageBubbleRects.length === 0 ||
    tile.width() <= 0 ||
    tile.height() <= 0 ||
    tileBitmapWidth <= 0 ||
    tileBitmapHeight <= 0
  ) {
    return [];
  }
  const scaleX = tileBitmapWidth / tile.width();
  const scaleY = tileBitmapHeight / tile.height();
  const out: RectF[] = [];
  for (const pageRect of pageBubbleRects) {
    const intersectsTile =
      pageRect.right > tile.left &&
      pageRect.left < tile.right &&
      pageRect.bottom > tile.top &&
      pageRect.top < tile.bottom;
    if (!intersectsTile) continue;

    const localRect = rectF(
      (pageRect.left - tile.left) * scaleX,
      (pageRect.top - tile.top) * scaleY,
      (pageRect.right - tile.left) * scaleX,
      (pageRect.bottom - tile.top) * scaleY,
    );
    const pad = Math.max(
      PAGE_REGION_MASK_EXPAND_MIN,
      Math.max(1, rectHeight(localRect)) * PAGE_REGION_MASK_EXPAND_RATIO,
    );
    out.push(
      rectF(
        coerceIn(localRect.left - pad, 0, tileBitmapWidth),
        coerceIn(localRect.top - pad, 0, tileBitmapHeight),
        coerceIn(localRect.right + pad, 0, tileBitmapWidth),
        coerceIn(localRect.bottom + pad, 0, tileBitmapHeight),
      ),
    );
  }
  return out;
}

/** Kotlin lines 364..381. */
export function remapTileRectsToPage(
  rects: readonly RectF[],
  tileBitmapWidth: number,
  tileBitmapHeight: number,
  tile: DetectionTile,
): RectF[] {
  const scaleX = tile.width() / Math.max(tileBitmapWidth, 1);
  const scaleY = tile.height() / Math.max(tileBitmapHeight, 1);
  return rects.map((rect) =>
    rectF(
      rect.left * scaleX + tile.left,
      rect.top * scaleY + tile.top,
      rect.right * scaleX + tile.left,
      rect.bottom * scaleY + tile.top,
    ),
  );
}

/** Kotlin lines 382..407. */
export function remapTileMaskContourToPage(
  contour: number[],
  tileTop: number,
  tileHeight: number,
  pageWidth: number,
  pageHeight: number,
  tileLeft = 0,
  tileWidth = pageWidth,
): number[] {
  if (contour.length === 0) return contour;
  const result = new Array<number>(contour.length);
  const safePageWidth = Math.max(pageWidth, 1);
  const safePageHeight = Math.max(pageHeight, 1);
  const safeTileWidth = Math.max(tileWidth, 1);
  const safeTileHeight = Math.max(tileHeight, 1);
  let index = 0;
  while (index + 1 < contour.length) {
    const x = coerceIn(contour[index] as number, 0, 1);
    const y = coerceIn(contour[index + 1] as number, 0, 1);
    result[index] = coerceIn((tileLeft + x * safeTileWidth) / safePageWidth, 0, 1);
    result[index + 1] = coerceIn((tileTop + y * safeTileHeight) / safePageHeight, 0, 1);
    index += 2;
  }
  return result;
}

/* ══ 跨片气泡去重（连通分量 → 择优/联合） ══ */

/** Kotlin lines 410..430. */
export function shouldTreatRectsAsSameBubbleForDedup(a: RectF, b: RectF): boolean {
  const areaA = rectAreaValue(a);
  const areaB = rectAreaValue(b);
  if (areaA <= 0 || areaB <= 0) return false;
  if (rectIou(a, b) >= BUBBLE_DEDUP_IOU_THRESHOLD) return true;

  const minArea = Math.max(Math.min(areaA, areaB), 1);
  const overlapOverMin = rectIntersectionArea(a, b) / minArea;
  if (
    overlapOverMin >= BUBBLE_DEDUP_CONTAINMENT_THRESHOLD &&
    (rectContains(a, b) || rectContains(b, a))
  ) {
    return true;
  }

  if (shouldTreatPartiallyShiftedRectsAsSameBubble(a, b, overlapOverMin)) {
    return true;
  }
  // 切片接缝常产生纵向堆叠的半个气泡
  return shouldTreatVerticallySplitTileRectsAsSameBubble(a, b);
}

/** Kotlin lines 431..457. */
function shouldTreatPartiallyShiftedRectsAsSameBubble(
  a: RectF,
  b: RectF,
  overlapOverMin: number,
): boolean {
  if (overlapOverMin < BUBBLE_DEDUP_PARTIAL_OVERLAP_MIN_RATIO) return false;

  const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const minWidth = Math.max(Math.min(rectWidth(a), rectWidth(b)), 1);
  const minHeight = Math.max(Math.min(rectHeight(a), rectHeight(b)), 1);
  if (overlapX / minWidth < BUBBLE_DEDUP_AXIS_OVERLAP_MIN_RATIO) return false;
  if (overlapY / minHeight < BUBBLE_DEDUP_AXIS_OVERLAP_MIN_RATIO) return false;

  const maxWidth = Math.max(Math.max(rectWidth(a), rectWidth(b)), 1);
  const maxHeight = Math.max(Math.max(rectHeight(a), rectHeight(b)), 1);
  const centerAX = (a.left + a.right) * 0.5;
  const centerAY = (a.top + a.bottom) * 0.5;
  const centerBX = (b.left + b.right) * 0.5;
  const centerBY = (b.top + b.bottom) * 0.5;
  const maxCenterDx = maxWidth * BUBBLE_DEDUP_CENTER_DRIFT_RATIO + BUBBLE_DEDUP_CENTER_DRIFT_PAD;
  const maxCenterDy = maxHeight * BUBBLE_DEDUP_CENTER_DRIFT_RATIO + BUBBLE_DEDUP_CENTER_DRIFT_PAD;

  return Math.abs(centerAX - centerBX) <= maxCenterDx && Math.abs(centerAY - centerBY) <= maxCenterDy;
}

/** Kotlin lines 458..491. */
function shouldTreatVerticallySplitTileRectsAsSameBubble(a: RectF, b: RectF): boolean {
  const widthA = Math.max(rectWidth(a), 1);
  const widthB = Math.max(rectWidth(b), 1);
  const heightA = Math.max(rectHeight(a), 1);
  const heightB = Math.max(rectHeight(b), 1);
  const widthRatio = Math.min(widthA, widthB) / Math.max(widthA, widthB);
  if (widthRatio < BUBBLE_DEDUP_VERTICAL_SPLIT_WIDTH_RATIO) return false;

  const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  if (overlapX / Math.min(widthA, widthB) < BUBBLE_DEDUP_VERTICAL_SPLIT_AXIS_X_RATIO) return false;

  const centerAX = (a.left + a.right) * 0.5;
  const centerBX = (b.left + b.right) * 0.5;
  if (Math.abs(centerAX - centerBX) > Math.max(widthA, widthB) * BUBBLE_DEDUP_VERTICAL_SPLIT_CENTER_X_RATIO) {
    return false;
  }

  const verticalGap =
    a.bottom <= b.top ? b.top - a.bottom : b.bottom <= a.top ? a.top - b.bottom : 0;
  if (verticalGap > BUBBLE_DEDUP_VERTICAL_SPLIT_MAX_GAP_PX) return false;

  const unionTop = Math.min(a.top, b.top);
  const unionBottom = Math.max(a.bottom, b.bottom);
  const unionHeight = Math.max(unionBottom - unionTop, 1);
  // 需要真实的纵向延伸，不是两个几乎相同的重复
  if (unionHeight <= Math.max(heightA, heightB) * 1.08) return false;
  // 别把两个仅擦边的完整堆叠气泡粘起来：每半应占联合体的实质份额
  if (heightA / unionHeight < 0.28 || heightB / unionHeight < 0.28) return false;
  return true;
}

/**
 * 跨片去重：同气泡候选做连通分量；分量内跨片才去重（同片信任模型内建 NMS）。
 * 全部候选都触边界 → 联合（并合并轮廓），否则选优先级最高者。
 * Kotlin lines 492..565.
 */
export function deduplicateBubbleDetections(
  detections: readonly TiledBubbleDetection[],
  pageHeight: number,
): DeduplicatedBubbleGroup[] {
  if (detections.length <= 1) {
    return detections.map((tiled) => {
      const maskContour = tiled.touchesInternalTileBoundary ? null : tiled.maskContour;
      return {
        rect: copyRect(tiled.rect),
        confidence: tiled.confidence,
        maskContour,
        suppressionRect: copyRect(tiled.rect),
      };
    });
  }
  const visited = new Array<boolean>(detections.length).fill(false);
  const result: DeduplicatedBubbleGroup[] = [];
  for (let start = 0; start < detections.length; start += 1) {
    if (visited[start] === true) continue;
    const queue: number[] = [start];
    let head = 0;
    const component: number[] = [];
    const componentTileIndices = new Set<number>([detections[start]?.tileIndex ?? 0]);
    visited[start] = true;
    while (head < queue.length) {
      const current = queue[head] as number;
      head += 1;
      component.push(current);
      for (let next = 0; next < detections.length; next += 1) {
        if (visited[next] === true) continue;
        const nextDet = detections[next] as TiledBubbleDetection;
        if (componentTileIndices.has(nextDet.tileIndex)) continue;
        const same = shouldTreatRectsAsSameBubbleForDedup(
          (detections[current] as TiledBubbleDetection).rect,
          nextDet.rect,
        );
        if (!same) continue;
        visited[next] = true;
        componentTileIndices.add(nextDet.tileIndex);
        queue.push(next);
      }
    }
    const candidates: BubblePriorityCandidate[] = component.map((index) => {
      const d = detections[index] as TiledBubbleDetection;
      return {
        confidence: d.confidence,
        hasMaskContour: d.maskContour !== null,
        area: rectAreaValue(d.rect),
        touchesInternalTileBoundary: d.touchesInternalTileBoundary,
      };
    });
    const bestOffset = Math.max(choosePreferredBubbleCandidateIndex(candidates), 0);
    const best = detections[component[bestOffset] as number] as TiledBubbleDetection;
    const useUnion = shouldUnionTileBubbleCandidates(candidates);
    let outputRect: RectF;
    if (useUnion) {
      outputRect = unionDetectionRects(component.map((i) => (detections[i] as TiledBubbleDetection).rect)) as RectF;
    } else {
      outputRect = copyRect(best.rect);
    }
    const outputContour = useUnion
      ? mergePageMaskContours(
          component.map((i) => (detections[i] as TiledBubbleDetection).maskContour).filter((c): c is number[] => c !== null),
          pageHeight,
        )
      : best.maskContour;
    result.push({
      rect: outputRect,
      confidence: best.confidence,
      maskContour: outputContour,
      suppressionRect: copyRect(outputRect),
    });
  }
  return result;
}

/** Kotlin lines 566..578. */
function choosePreferredBubbleCandidateIndex(candidates: readonly BubblePriorityCandidate[]): number {
  if (candidates.length === 0) return -1;
  let bestIndex = 0;
  for (let index = 1; index < candidates.length; index += 1) {
    if (compareBubblePriority(candidates[index] as BubblePriorityCandidate, candidates[bestIndex] as BubblePriorityCandidate) > 0) {
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** Kotlin lines 579..598. */
function compareBubblePriority(
  candidate: BubblePriorityCandidate,
  currentBest: BubblePriorityCandidate,
): number {
  if (candidate.touchesInternalTileBoundary !== currentBest.touchesInternalTileBoundary) {
    return candidate.touchesInternalTileBoundary ? -1 : 1;
  }
  const confidenceDiff = candidate.confidence - currentBest.confidence;
  if (Math.abs(confidenceDiff) >= 0.02) {
    return confidenceDiff > 0 ? 1 : -1;
  }
  if (candidate.hasMaskContour !== currentBest.hasMaskContour) {
    return candidate.hasMaskContour ? 1 : -1;
  }
  if (confidenceDiff !== 0) {
    return confidenceDiff > 0 ? 1 : -1;
  }
  return candidate.area - currentBest.area;
}

/** Kotlin lines 599..602. */
function shouldUnionTileBubbleCandidates(candidates: readonly BubblePriorityCandidate[]): boolean {
  return candidates.length > 1 && candidates.every((c) => c.touchesInternalTileBoundary);
}

/** Kotlin lines 603..618. */
export function unionDetectionRects(rects: readonly RectF[]): RectF | null {
  const first = rects[0];
  if (first === undefined) return null;
  let left = first.left;
  let top = first.top;
  let right = first.right;
  let bottom = first.bottom;
  for (let index = 1; index < rects.length; index += 1) {
    const rect = rects[index] as RectF;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return rectF(left, top, right, bottom);
}

/* ══ 轮廓合并（水平包络采样，原仓库 mergePageMaskContours） ══ */

/** Kotlin lines 619..676. */
export function mergePageMaskContours(
  contours: readonly number[][],
  pageHeight: number,
): number[] | null {
  const validContours = contours.filter((c) => c.length >= 6 && c.length % 2 === 0);
  if (validContours.length === 0) return null;
  if (validContours.length === 1) return [...(validContours[0] as number[])];

  let minY = 1;
  let maxY = 0;
  for (const contour of validContours) {
    let index = 1;
    while (index < contour.length) {
      const y = coerceIn(contour[index] as number, 0, 1);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      index += 2;
    }
  }
  if (maxY - minY <= CONTOUR_COORD_EPSILON) return null;

  const estimatedPixelRows = roundToInt((maxY - minY) * Math.max(pageHeight, 1));
  const sampleCount = coerceIn(
    estimatedPixelRows,
    MERGED_CONTOUR_MIN_SAMPLE_ROWS,
    MERGED_CONTOUR_MAX_SAMPLE_ROWS,
  );
  const leftEdge: number[] = [];
  const rightEdge: number[] = [];
  for (let sample = 0; sample <= sampleCount; sample += 1) {
    const y = minY + ((maxY - minY) * sample) / sampleCount;
    let rowLeft = Number.POSITIVE_INFINITY;
    let rowRight = Number.NEGATIVE_INFINITY;
    for (const contour of validContours) {
      const bounds = contourHorizontalBounds(contour, y);
      if (bounds === null) continue;
      rowLeft = Math.min(rowLeft, bounds[0]);
      rowRight = Math.max(rowRight, bounds[1]);
    }
    if (!Number.isFinite(rowLeft) || !Number.isFinite(rowRight) || rowRight <= rowLeft) continue;
    leftEdge.push(coerceIn(rowLeft, 0, 1), coerceIn(y, 0, 1));
    rightEdge.push(coerceIn(rowRight, 0, 1), coerceIn(y, 0, 1));
  }
  if (leftEdge.length < 4) return null;

  const polygon = new Array<number>(leftEdge.length + rightEdge.length).fill(0);
  for (let i = 0; i < leftEdge.length; i += 1) polygon[i] = leftEdge[i] as number;
  let outputIndex = leftEdge.length;
  for (let index = rightEdge.length - 2; index >= 0; index -= 2) {
    polygon[outputIndex] = rightEdge[index] as number;
    polygon[outputIndex + 1] = rightEdge[index + 1] as number;
    outputIndex += 2;
  }
  return polygon;
}

/** Kotlin lines 677..707. */
function contourHorizontalBounds(contour: number[], y: number): [number, number] | null {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  const pointCount = contour.length / 2;
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const nextPointIndex = (pointIndex + 1) % pointCount;
    const x1 = contour[pointIndex * 2] as number;
    const y1 = contour[pointIndex * 2 + 1] as number;
    const x2 = contour[nextPointIndex * 2] as number;
    const y2 = contour[nextPointIndex * 2 + 1] as number;
    const deltaY = y2 - y1;
    if (Math.abs(deltaY) <= CONTOUR_COORD_EPSILON) {
      if (Math.abs(y - y1) <= CONTOUR_COORD_EPSILON) {
        minX = Math.min(minX, Math.min(x1, x2));
        maxX = Math.max(maxX, Math.max(x1, x2));
      }
      continue;
    }
    const edgeMinY = Math.min(y1, y2);
    const edgeMaxY = Math.max(y1, y2);
    if (y < edgeMinY - CONTOUR_COORD_EPSILON || y > edgeMaxY + CONTOUR_COORD_EPSILON) {
      continue;
    }
    const ratio = coerceIn((y - y1) / deltaY, 0, 1);
    const x = x1 + (x2 - x1) * ratio;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  return Number.isFinite(minX) && Number.isFinite(maxX) ? [minX, maxX] : null;
}

/* ══ 文字行跨越合并被切开的气泡 ══ */

/** Kotlin lines 708..737. */
export function mergeBubblesSpannedByTextLines(
  balloons: readonly Detection[],
  textLines: readonly RectF[] | null,
  pageWidth: number,
  pageHeight: number,
): Detection[] {
  if (balloons.length <= 1 || textLines === null || textLines.length === 0) return [...balloons];
  const imageArea = Math.max(pageWidth * pageHeight, 1);
  const working = [...balloons];
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < working.length; i += 1) {
      let j = i + 1;
      while (j < working.length) {
        if (
          isBubblePairSpannedByAnyTextLine(
            working[i] as Detection,
            working[j] as Detection,
            textLines,
            imageArea,
          )
        ) {
          working[i] = unionBubbleDetections(working[i] as Detection, working[j] as Detection, pageHeight);
          working.splice(j, 1);
          merged = true;
          break outer;
        }
        j += 1;
      }
    }
  }
  return working;
}

/** Kotlin lines 738..762. */
function isBubblePairSpannedByAnyTextLine(
  a: Detection,
  b: Detection,
  textLines: readonly RectF[],
  imageArea: number,
): boolean {
  const rectA = a.rect;
  const rectB = b.rect;
  // 真相邻气泡几乎不重叠；同一气泡的碎片共享真实面积
  if (
    rectIntersectionArea(rectA, rectB) / Math.max(Math.min(rectAreaValue(rectA), rectAreaValue(rectB)), 1) <
    BUBBLE_SPAN_MIN_PAIR_OVERLAP
  ) {
    return false;
  }
  const union = rectF(
    Math.min(rectA.left, rectB.left),
    Math.min(rectA.top, rectB.top),
    Math.max(rectA.right, rectB.right),
    Math.max(rectA.bottom, rectB.bottom),
  );
  if (rectAreaValue(union) / imageArea > BUBBLE_SPAN_MAX_UNION_FRACTION) return false;
  return textLines.some((line) => isTextLineSpanningBubbles(line, rectA, rectB));
}

/** Kotlin lines 763..777. */
function isTextLineSpanningBubbles(line: RectF, a: RectF, b: RectF): boolean {
  const lineWidth = rectWidth(line);
  if (lineWidth <= 0 || rectHeight(line) <= 0) return false;
  // 已在某个框内的行说明不了这对的关系
  if (rectContainsHorizontally(a, line) || rectContainsHorizontally(b, line)) return false;
  const overlapA = Math.max(0, Math.min(line.right, a.right) - Math.max(line.left, a.left)) / lineWidth;
  const overlapB = Math.max(0, Math.min(line.right, b.right) - Math.max(line.left, b.left)) / lineWidth;
  if (overlapA < BUBBLE_SPAN_MIN_LINE_OVERLAP || overlapB < BUBBLE_SPAN_MIN_LINE_OVERLAP) {
    return false;
  }
  // 行必须位于两个框都覆盖的高度（排除仅共列的堆叠气泡）
  const centerY = (line.top + line.bottom) * 0.5;
  return centerY >= a.top && centerY <= a.bottom && centerY >= b.top && centerY <= b.bottom;
}

/** Kotlin lines 778..780. */
function rectContainsHorizontally(container: RectF, line: RectF): boolean {
  return container.left <= line.left && line.right <= container.right;
}

/** Kotlin lines 781..801. */
function unionBubbleDetections(a: Detection, b: Detection, pageHeight: number): Detection {
  const base = a.confidence >= b.confidence ? a : b;
  return {
    rect: rectF(
      Math.min(a.rect.left, b.rect.left),
      Math.min(a.rect.top, b.rect.top),
      Math.max(a.rect.right, b.rect.right),
      Math.max(a.rect.bottom, b.rect.bottom),
    ),
    confidence: base.confidence,
    maskContour: mergePageMaskContours(
      [a.maskContour, b.maskContour].filter((c): c is number[] => c !== null),
      pageHeight,
    ),
  };
}

/* ══ 行归属（原仓库 lineBelongsToRegion） ══ */

/** Kotlin lines 804..810. */
export function lineBelongsToRegion(lineRect: RectF, regionRect: RectF): boolean {
  if (rectContains(regionRect, lineRect)) return true;
  const lineArea = rectAreaValue(lineRect);
  if (lineArea <= 0) return false;
  return rectIntersectionArea(lineRect, regionRect) / lineArea >= 0.5;
}

/* ══ 基础几何 ══ */

/** Kotlin lines 813..815. */
export function rectAreaValue(rect: RectF): number {
  return Math.max(rectWidth(rect), 0) * Math.max(rectHeight(rect), 0);
}

/** Kotlin lines 816..819. */
export function rectIntersectionArea(a: RectF, b: RectF): number {
  return (
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  );
}

/** Kotlin lines 820..826. */
export function rectIou(a: RectF, b: RectF): number {
  const inter = rectIntersectionArea(a, b);
  if (inter <= 0) return 0;
  const union = rectAreaValue(a) + rectAreaValue(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Kotlin lines 827..830. */
export function rectContains(outer: RectF, inner: RectF): boolean {
  return (
    outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom
  );
}

/** Kotlin line 293 default threshold reference — `PageRegionDetector.PAGE_REGION_TEXT_IOU = 0.2f`. */
export const PAGE_REGION_TEXT_IOOU = PAGE_REGION_TEXT_IOU_THRESHOLD;

/** Re-exported so `pageRegionDetector.ts` and `bubblePipeline.ts` share one RectF model. */
export { rectF, copyRect, rectWidth, rectHeight };
export type { RectF };
export { maxOf, minOf, coerceIn, roundToInt };