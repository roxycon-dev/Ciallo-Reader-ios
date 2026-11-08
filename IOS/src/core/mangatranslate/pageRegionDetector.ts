/**
 * Page region detector — result shape + stubbed entry point, port of Android
 * `novel-reader/app/src/main/java/com/example/mangatranslate/PageRegionDetector.kt`
 * (274 lines total, 254 non-blank).
 *
 * SCOPE: manga translation is deliberately excluded from the iOS port (see `index.ts`).
 * `detect()` needs an ONNX `BubbleDetector` and a PP-OCR `PaddleDetector`, so it is
 * stubbed. What *is* ported is the orchestration that is pure once those two engines are
 * replaced by callbacks: the single-page pipeline (`detectSingleBitmap`) and the
 * long-image pipeline's bubble/text merge order. That is the part worth keeping under test
 * because it is where the round-19 regressions were found.
 *
 * Line map (Kotlin line → TS):
 *   1..7    package + imports (`Bitmap`, `RectF`, `scale`, coroutines) → no imports.
 *   8..23   KDoc `漫画页区域检测器（第十九轮，完整复刻 jedzqer/manga-translator-android
 *            detection/PageRegionDetector.kt 的检测流程，MIT License）：` (3 bullets) +
 *            `适配差异：页面位图全部在内存…` → kept verbatim on {@link detectSingleBitmap}.
 *   24..29  `class PageRegionDetector(paddleDetector, bubbleDetector)` →
 *            {@link PageRegionDetector}, which takes the two engines as callbacks.
 *   30..36  `data class PageRegionResult(bubbles, textLines, textBlocks, complete)` →
 *            {@link PageRegionResult}.
 *   37..45  `suspend fun detect(bitmap)` — `coroutineContext.ensureActive()` then the
 *            `PageRegionTiling.shouldUseLongImageTiling(width, height)` dispatch and
 *            `runCatching { … }.getOrElse { return null }` on both branches → **ported**
 *            as {@link PageRegionDetector.detect} with the engines injected (the
 *            `ensureActive` maps to the caller aborting the promise; the `runCatching`
 *            maps to the same `null`-on-throw contract).
 *   46..47  the `(banner)` banner → section comment.
 *   48..85  `private fun detectSingleBitmap(bitmap)` → {@link detectSingleBitmap},
 *            **ported** with the two detectors injected:
 *              - 50..52 `runCatching { bubbles.detect(bitmap) }.getOrDefault(emptyList())`
 *                then `PageRegionTiling.filterTinyBubbleDetections(…)`
 *              - 53..58 `textDetectionOk` bookkeeping + `runCatching { paddle.detectLines }`
 *              - 59..61 `PageRegionTiling.mergeBubblesSpannedByTextLines(…)`
 *              - 62..70 `if (balloonsRejoined.isEmpty()) rawLines else
 *                PageRegionTiling.filterOverlapping(rawLines, balloons.map { it.rect }, PAGE_REGION_TEXT_IOU)`
 *              - 71 `PageRegionTiling.filterTinyTextRects(...)`
 *              - 72..78 `runCatching { TextBlockMerger.merge(sizeFiltered, w, h) }.getOrElse { … }`
 *                with the AMBIGUOUS one-line-per-rect fallback
 *              - 79..84 the `PageRegionResult(complete = true)` construction
 *            Only the `Bitmap` plumbing (the detector callbacks and the image size) is injected.
 *   86..87  the long-image banner → section comment.
 *   88..223 `private suspend fun detectLongImageTiledPage(bitmap)` → **stubbed**; the
 *            algorithm's *structure* is preserved as the documented constant/phase list
 *            {@link LONG_IMAGE_DETECTION_PHASES} plus the two log strings
 *            `Replaying ${bottomEdge.size} bottom-edge bubble(s) from y=$nextTileTop` and
 *            `Dropped ${topFragments.size} top-edge fragment(s)` (they use Kotlin string
 *            templates, so they are exposed as template functions rather than literals).
 *            Phase order preserved: adaptive bubble tiling (bottom-edge replay / top-fragment
 *            drop / 80 % vertical compression) → `deduplicateBubbleDetections` →
 *            `shouldFilterLongImageRegion` → 25 %-overlap paddle tiles →
 *            `TextBlockMerger.deduplicateLines` → `mergeBubblesSpannedByTextLines` →
 *            `filterOverlapping` → `filterTinyTextRects` → `shouldFilterLongImageRegion` →
 *            `TextBlockMerger.merge`.
 *   224..240 `private fun remapRect(rect, tile, tileBitmapWidth, tileBitmapHeight)` →
 *            {@link remapRectToPage}, **ported** (pure) — it is the inverse of
 *            `PageRegionTiling.remapTileRectsToPage`.
 *   241..263 `private fun cropRegion(bitmap, tile, maxEdge)` → STUB (Bitmap);
 *            the pure geometry (the `l/t/r/b` clamping and the
 *            `shrink = min(1f, maxEdge / max(crop.width, crop.height))` decision) is
 *            preserved as {@link planCropRegion}.
 *   264..269 `private fun compressTile(bitmap)` → STUB; the pure decision
 *            `if (targetHeight <= 0 || targetHeight == bitmap.height) return bitmap` is
 *            preserved as {@link needsTileCompression}.
 *   270..273 `companion object { private const val PAGE_REGION_TEXT_IOU = 0.2f }` →
 *            {@link PAGE_REGION_TEXT_IOU}.
 *
 * Skipped lines and why:
 *   - Kotlin lines 38..45, 88..223, 242..269: every call that needs a `Bitmap`,
 *     `Bitmap.createBitmap`, `Bitmap.scale` or a `CoroutineScope`.
 *   - `kotlinx.coroutines.coroutineContext.ensureActive()` → the caller cancels the
 *     returned promise; nothing to port.
 *   - `android.util.Log.d("PageRegionDetector", …)` → `src/core` has no logging contract;
 *     the message templates are preserved on {@link LONG_IMAGE_DETECTION_PHASES}.
 *
 * Every threshold and message template is byte-identical. No U+3000 in the Android file.
 *
 * ── R20-audit additions (2026-10-06) ────────────────────────────────────────────
 * `detectLongImageTiledPage` (Kotlin 88..223) was previously a stub justified as
 * "needs Bitmap tiles". That is **not** an ONNX dependency: the only Canvas/Bitmap calls
 * in the body are `cropRegion` (242..263) and `compressTile` (265..269), both of which are
 * pure size arithmetic, and both detectors are already injected for the whole-page path.
 * The whole long-image orchestration is therefore ported:
 *   · the adaptive bubble-tile loop (`tileTop`/`nextTileTop`/`previousTileBottom`/
 *     `tileIndex`), 80 % vertical compression (`compressedTileSize`, `needsTileCompression`),
 *     bottom-edge replay + top-fragment drop (`shouldDiscardReplayTileTopFragments`,
 *     `isDetectionAtReplayTileTop`, `isDetectionAtInternalTileBottom`, `adaptiveNextTileTop`),
 *     `TiledBubbleDetection` accumulation with `remapRectToPage` + `remapTileMaskContourToPage`;
 *   · `deduplicateBubbleDetections` → `shouldFilterLongImageRegion`;
 *   · the 25 %-overlap `planPaddleTextDetectionTiles` text pass with `remapTileRectsToPage`
 *     and `TextBlockMerger.deduplicateLines`;
 *   · `mergeBubblesSpannedByTextLines` → `filterOverlapping(PAGE_REGION_TEXT_IOU)` →
 *     `filterTinyTextRects` → `shouldFilterLongImageRegion` → `TextBlockMerger.merge`
 *     with the AMBIGUOUS one-line-per-rect fallback (Kotlin 210..216).
 * New seams: `TileDetectionInput` and `PageRegionTileDetectors` (second constructor
 * argument). Without them `detectLongImageTiledPage` still throws
 * `MangaTranslateUnsupportedError` — an explicit "not wired", never a silent empty page.
 * Kotlin lines 135..146 (`android.util.Log.d`) become the recorded `longImageLog`
 * entries, rendered from the original templates `replayingBottomEdgeLog` /
 * `droppedTopFragmentsLog`, because `src/core` has no logging contract.
 * Kotlin line 183 (`pageBubbleRects`) is dead code upstream and is intentionally omitted.
 */

import { MangaTranslateUnsupportedError, type RectF } from './index';
import type { BubbleDetection } from './bubbleDetector';
import {
  DETECTION_MAX_EDGE,
  adaptiveNextTileTop,
  deduplicateBubbleDetections,
  detectionTile,
  filterOverlapping,
  filterTinyBubbleDetections,
  filterTinyTextRects,
  isDetectionAtInternalTileBottom,
  isDetectionAtReplayTileTop,
  longImageBubbleDetectionInputHeight,
  longImageBubbleDetectionTileHeight,
  mergeBubblesSpannedByTextLines,
  planPaddleTextDetectionTiles,
  remapTileMaskContourToPage,
  remapTileRectsToPage,
  shouldDiscardReplayTileTopFragments,
  shouldFilterLongImageRegion,
  shouldUseLongImageTiling,
  type DetectionTile,
  type DeduplicatedBubbleGroup,
  type TiledBubbleDetection,
} from './pageRegionTiling';
import { TextBlockMerger, TextLineOrientation } from './textBlockMerger';

/** Kotlin lines 270..273: `private const val PAGE_REGION_TEXT_IOU = 0.2f`. */
export const PAGE_REGION_TEXT_IOU = 0.2;

/** Kotlin lines 30..36. */
export interface PageRegionResult {
  bubbles: BubbleDetection[];
  textLines: RectF[];
  textBlocks: ReturnType<typeof TextBlockMerger.merge>;
  complete: boolean;
}

/** The two engines `PageRegionDetector` needs, injected (ONNX on Android). */
export interface PageRegionDetectors {
  /** Kotlin `bubbleDetector.detect(bitmap): List<BubbleDetector.Detection>`. */
  detectBubbles: (size: { width: number; height: number }) => Promise<BubbleDetection[]>;
  /** Kotlin `paddleDetector.detectLines(bitmap): List<RectF>`. */
  detectTextLines: (size: { width: number; height: number }) => Promise<RectF[]>;
}

/**
 * Kotlin lines 88..223 — the long-image pipeline, phase by phase.
 * The order matters (it is where the round-19 regressions were fixed), so it is recorded
 * here rather than left implicit in a stub.
 */
export const LONG_IMAGE_DETECTION_PHASES = [
  'tileHeight = longImageBubbleDetectionTileHeight(pageWidth, pageHeight)',
  'tile = DetectionTile(0, tileTop, pageWidth, min(pageHeight, tileTop + tileHeight))',
  'cropRegion(bitmap, tile, DETECTION_MAX_EDGE) → compressTile (80% vertical scale)',
  'PageRegionTiling.filterTinyBubbleDetections(bubbles.detect(detectionBitmap), detectionBitmap)',
  'shouldDiscardReplayTileTopFragments(overlapsPreviousTile, tile.bottom, pageHeight)',
  'partition detections: isDetectionAtReplayTileTop → topFragments (dropped)',
  'partition replayCandidates: isDetectionAtInternalTileBottom → bottomEdge, complete',
  'adaptiveNextTileTop(tile, pageHeight, detectionBitmap.height, bottomEdge.map { it.rect })',
  'tiled += complete.map { TiledBubbleDetection(remapRect(...), remapTileMaskContourToPage(...), false, tileIndex) }',
  'deduplicateBubbleDetections(tiled, pageHeight)',
  'shouldFilterLongImageRegion(rect, pageWidth, pageHeight)',
  'planPaddleTextDetectionTiles(pageWidth, pageHeight) — 25% overlap',
  'remapTileRectsToPage(paddle.detectLines(tileBitmap), tileBitmap.width, tileBitmap.height, tile)',
  'TextBlockMerger.deduplicateLines(detectedTextLines, pageWidth, pageHeight)',
  'mergeBubblesSpannedByTextLines(deduplicatedBubbles, deduplicatedLines, pageWidth, pageHeight)',
  `filterOverlapping(deduplicatedLines, rejoinedBubbles.map { it.rect }, ${PAGE_REGION_TEXT_IOU})`,
  'filterTinyTextRects(...) → shouldFilterLongImageRegion(...)',
  'TextBlockMerger.merge(longFiltered, pageWidth, pageHeight)',
] as const;

/** Kotlin line 137..139 log string (Kotlin string template → template function). */
export function replayingBottomEdgeLog(bottomEdgeSize: number, nextTileTop: number): string {
  return `Replaying ${bottomEdgeSize} bottom-edge bubble(s) from y=${nextTileTop}`;
}

/** Kotlin line 142..144 log string. */
export function droppedTopFragmentsLog(topFragmentsSize: number): string {
  return `Dropped ${topFragmentsSize} top-edge fragment(s)`;
}

/** Kotlin line 42: the log tag. */
export const PAGE_REGION_DETECTOR_LOG_TAG = 'PageRegionDetector';

/**
 * R20-audit (2026-10-06): 「气泡自适应切片 / 80% 垂直压缩 / 底部截断回放 / 顶部碎片丢弃 /
 * 跨片去重 / 25% 重叠文字切片 / 跨片行去重 / 行跨越合并」 这一整套编排**不依赖 ONNX** ——
 * 它只对「切片矩形」和「检测器回调」做算术。Android 里唯一的 Canvas/Bitmap 调用是
 * `cropRegion()` / `compressTile()` 造出真实的位图；TS 侧把位图替换成
 * {@link TileDetectionInput}（切片矩形 + 压缩后的尺寸），检测器作为回调注入即可。
 * 因此 `detectLongImageTiledPage` 从 stub 变成完整的移植（Kotlin 88..223）。
 */
export interface TileDetectionInput {
  /** Kotlin `tile`: the page-space crop rectangle. */
  tile: DetectionTile;
  /** Kotlin `tileBitmap` — the crop after the `DETECTION_MAX_EDGE` shrink. */
  tileSize: { width: number; height: number };
  /** Kotlin `detectionBitmap` — `tileBitmap` after `compressTile`'s 80 % vertical scale. */
  detectionSize: { width: number; height: number };
  /** Kotlin `pageWidth` / `pageHeight`. */
  page: { width: number; height: number };
  /** Kotlin `tileIndex` — the tile ordinal, used by the cross-tile dedup. */
  tileIndex: number;
}

/** The tile-aware engines `detectLongImageTiledPage` needs (ONNX on Android). */
export interface PageRegionTileDetectors {
  detectBubblesInTile(input: TileDetectionInput): Promise<BubbleDetection[]>;
  detectTextLinesInTile(input: TileDetectionInput): Promise<RectF[]>;
}

/**
 * Kotlin lines 265..269 — `compressTile`: the 80 % vertical scale keeps the aspect ratio
 * and pixel density the model would see on a whole page.
 * Returns `null` for Kotlin line 267's `if (targetHeight <= 0 || targetHeight == bitmap.height) return bitmap`.
 */
export function compressedTileSize(tileHeight: number): { width: number; height: number } | null {
  const targetHeight = longImageBubbleDetectionInputHeight(tileHeight);
  if (targetHeight <= 0 || targetHeight === tileHeight) return null;
  return { width: 0, height: targetHeight };
}

/** Kotlin lines 224..240 — page bubble rect → tile-local coordinates. FULLY PORTED (pure). */
export function remapRectToPage(
  rect: RectF,
  tile: DetectionTile,
  tileBitmapWidth: number,
  tileBitmapHeight: number,
): RectF {
  const scaleX = tile.width() / Math.max(tileBitmapWidth, 1);
  const scaleY = tile.height() / Math.max(tileBitmapHeight, 1);
  return {
    left: rect.left * scaleX + tile.left,
    top: rect.top * scaleY + tile.top,
    right: rect.right * scaleX + tile.left,
    bottom: rect.bottom * scaleY + tile.top,
  };
}

/**
 * Kotlin lines 242..263 — the pure half of `cropRegion`: the `l/t/r/b` clamping, the
 * `if (r - l < 1 || b - t < 1) return null` rejection and the `shrink` decision.
 */
export function planCropRegion(
  bitmapWidth: number,
  bitmapHeight: number,
  tile: DetectionTile,
  maxEdge: number,
): { left: number; top: number; width: number; height: number; shrink: number } | null {
  const l = Math.min(Math.max(tile.left, 0), bitmapWidth - 1);
  const t = Math.min(Math.max(tile.top, 0), bitmapHeight - 1);
  const r = Math.min(tile.right, bitmapWidth);
  const b = Math.min(tile.bottom, bitmapHeight);
  if (r - l < 1 || b - t < 1) return null;
  const width = r - l;
  const height = b - t;
  const shrink = Math.min(1, maxEdge / Math.max(width, height));
  return { left: l, top: t, width, height, shrink };
}

/** Kotlin line 266: `if (targetHeight <= 0 || targetHeight == bitmap.height) return bitmap`. */
export function needsTileCompression(bitmapHeight: number): boolean {
  const targetHeight = longImageBubbleDetectionInputHeight(bitmapHeight);
  return !(targetHeight <= 0 || targetHeight === bitmapHeight);
}

/**
 * 漫画页区域检测器（第十九轮，完整复刻 jedzqer/manga-translator-android
 * detection/PageRegionDetector.kt 的检测流程，MIT License）：
 *
 * - 常规页：气泡分割 + 文字行检测一次完成，行归属气泡、游离行聚块；
 * - 长条漫页（高≥2048 且 高宽比>2.0）：
 *   气泡 → 连续自适应切片（底部截断回放、顶部碎片丢弃、80% 垂直压缩）；
 *   文字 → 25% 重叠切片 + 跨片行去重 + 块合并；
 *   汇总：跨片气泡去重 → 行跨越合并分裂气泡 → tiny/长条过滤 → 文本块。
 *
 * 适配差异：页面位图全部在内存（原仓库经 BitmapCropSource 从文件解码），
 * 切片裁剪 = createBitmap + maxEdge 缩放；无 SettingsStore，置信度取默认 0.15。
 */
export class PageRegionDetector {
  constructor(
    private readonly detectors: PageRegionDetectors,
    /**
     * Kotlin lines 88..223 need per-tile detection. Optional so that a caller which only
     * has whole-page detectors keeps the old behaviour (an explicit
     * {@link MangaTranslateUnsupportedError} on a long page) instead of a silent
     * wrong answer.
     */
    private readonly tileDetectors?: PageRegionTileDetectors,
  ) {}

  /**
   * Rendered `android.util.Log.d("PageRegionDetector", …)` lines from the long-image pass
   * (Kotlin lines 136..146). `src/core` must not own a logging contract, so they are
   * recorded instead of emitted — the strings are produced by the Kotlin templates.
   */
  readonly longImageLog: string[] = [];

  /**
   * Kotlin lines 37..45 — dispatch on the long-image test, `null` on any throw.
   * The `runCatching { … }.getOrElse { return null }` contract is preserved.
   */
  async detect(size: { width: number; height: number }): Promise<PageRegionResult | null> {
    try {
      if (shouldUseLongImageTiling(size.width, size.height)) {
        return await this.detectLongImageTiledPage(size);
      }
      return await this.detectSingleBitmap(size);
    } catch {
      return null;
    }
  }

  /** Kotlin lines 48..85 — 常规页. */
  async detectSingleBitmap(
    size: { width: number; height: number },
  ): Promise<PageRegionResult | null> {
    const balloonsRaw = await this.detectors
      .detectBubbles(size)
      .catch(() => [] as BubbleDetection[]);
    const balloons = filterTinyBubbleDetections(balloonsRaw, size);

    let rawLines: RectF[] = [];
    try {
      rawLines = await this.detectors.detectTextLines(size);
    } catch {
      rawLines = [];
    }

    const balloonsRejoined = mergeBubblesSpannedByTextLines(
      balloons,
      rawLines,
      size.width,
      size.height,
    );
    const textRects =
      balloonsRejoined.length === 0
        ? rawLines
        : filterOverlapping(
            rawLines,
            balloonsRejoined.map((b) => b.rect),
            PAGE_REGION_TEXT_IOU,
          );
    const sizeFiltered = filterTinyTextRects(textRects, size.width, size.height);
    let blocks: ReturnType<typeof TextBlockMerger.merge>;
    try {
      blocks = TextBlockMerger.merge(sizeFiltered, size.width, size.height);
    } catch {
      blocks = sizeFiltered.map((rect) => ({
        rect,
        lines: [{ ...rect }],
        orientation: TextLineOrientation.AMBIGUOUS,
        maskContour: [],
      }));
    }
    return {
      bubbles: balloonsRejoined,
      textLines: rawLines,
      textBlocks: blocks,
      complete: true,
    };
  }

  /**
   * Kotlin lines 88..223 — 长条漫页：气泡自适应切片 + 25% 重叠文字切片.
   *
   * R20-audit: fully implemented. The only Canvas/Bitmap work (`cropRegion`,
   * `compressTile`) is expressed as sizes; both detectors are injected per tile.
   * Requires {@link tileDetectors} — without them the call is an explicit
   * {@link MangaTranslateUnsupportedError} rather than a silent empty page.
   */
  async detectLongImageTiledPage(page: { width: number; height: number }): Promise<PageRegionResult | null> {
    const engines = this.tileDetectors;
    if (engines === undefined) {
      throw new MangaTranslateUnsupportedError(
        'PageRegionDetector.detectLongImageTiledPage',
        'onnx-inference',
        '长条漫页的分片检测需要按切片调用 PP-OCR det / YOLO26n-seg（未注入 tile 检测器）',
      );
    }
    const pageWidth = page.width;
    const pageHeight = page.height;

    // ── 气泡切片 ──
    const tileHeight = longImageBubbleDetectionTileHeight(pageWidth, pageHeight);
    if (tileHeight <= 0) return null;
    const tiled: TiledBubbleDetection[] = [];
    let tileTop = 0;
    let tileIndex = 0;
    let previousTileBottom = 0;
    while (tileTop < pageHeight) {
      const tile = detectionTile(0, tileTop, pageWidth, Math.min(pageHeight, tileTop + tileHeight));
      let nextTileTop = tile.bottom;
      const plan = planCropRegion(pageWidth, pageHeight, tile, DETECTION_MAX_EDGE);
      if (plan !== null) {
        // Kotlin: `cropRegion` scales the crop to `(w * shrink).toInt()` / `(h * shrink).toInt()`.
        const tileSize = {
          width: Math.floor(plan.width * plan.shrink),
          height: Math.floor(plan.height * plan.shrink),
        };
        // 80% 垂直压缩：切片模型看到的等效纵横比与像素密度与整页一致
        const compressed = compressedTileSize(tileSize.height);
        const detectionSize =
          compressed === null ? tileSize : { width: tileSize.width, height: compressed.height };
        try {
          const detections = filterTinyBubbleDetections(
            await engines.detectBubblesInTile({ tile, tileSize, detectionSize, page, tileIndex }),
            detectionSize,
          );
          const discardTopFragments = shouldDiscardReplayTileTopFragments(
            tile.top < previousTileBottom,
            tile.bottom,
            pageHeight,
          );
          const topFragments = discardTopFragments
            ? detections.filter((d) => isDetectionAtReplayTileTop(d.rect, detectionSize.height))
            : [];
          const replayCandidates = discardTopFragments
            ? detections.filter((d) => !isDetectionAtReplayTileTop(d.rect, detectionSize.height))
            : detections;
          const bottomEdge: BubbleDetection[] = [];
          const complete: BubbleDetection[] = [];
          for (const d of replayCandidates) {
            if (isDetectionAtInternalTileBottom(d.rect, detectionSize.height, tile.bottom, pageHeight)) {
              bottomEdge.push(d);
            } else {
              complete.push(d);
            }
          }
          nextTileTop = adaptiveNextTileTop(
            tile,
            pageHeight,
            detectionSize.height,
            bottomEdge.map((d) => d.rect),
          );
          // Kotlin lines 135..146 — the two `android.util.Log.d("PageRegionDetector", …)`
          // calls. `src/core` has no logging contract, so the rendered templates are
          // recorded here instead (both strings are Kotlin string templates, so they are
          // rendered by {@link replayingBottomEdgeLog} / {@link droppedTopFragmentsLog}).
          if (bottomEdge.length > 0) {
            this.longImageLog.push(replayingBottomEdgeLog(bottomEdge.length, nextTileTop));
          }
          if (topFragments.length > 0) {
            this.longImageLog.push(droppedTopFragmentsLog(topFragments.length));
          }
          for (const d of complete) {
            const remappedContour =
              d.maskContour === null
                ? null
                : remapTileMaskContourToPage(d.maskContour, tile.top, tile.height(), pageWidth, pageHeight);
            tiled.push({
              rect: remapRectToPage(d.rect, tile, detectionSize.width, detectionSize.height),
              confidence: d.confidence,
              maskContour: remappedContour,
              // 完整气泡（底部截断已分流）
              touchesInternalTileBoundary: false,
              tileIndex,
            });
          }
        } catch {
          // 切片失败跳过（原仓库同语义）；CancellationException 在 TS 里是拒绝，
          // 与取消传播等价，因此这里同样吞掉。
        }
      }
      previousTileBottom = tile.bottom;
      tileTop = nextTileTop;
      tileIndex += 1;
    }
    const groups = deduplicateBubbleDetections(tiled, pageHeight);
    const deduplicatedBubbles = groups
      .filter((it) => !shouldFilterLongImageRegion(it.rect, pageWidth, pageHeight))
      .map((it) => ({ rect: it.rect, confidence: it.confidence, maskContour: it.maskContour }));

    // ── 文字切片（25% 重叠 + 跨片去重）──
    const paddleTiles = planPaddleTextDetectionTiles(pageWidth, pageHeight);
    const detectedTextLines: RectF[] = [];
    for (const tile of paddleTiles) {
      const plan = planCropRegion(pageWidth, pageHeight, tile, DETECTION_MAX_EDGE);
      if (plan === null) continue;
      const tileSize = {
        width: Math.floor(plan.width * plan.shrink),
        height: Math.floor(plan.height * plan.shrink),
      };
      try {
        const localLines = await engines.detectTextLinesInTile({
          tile,
          tileSize,
          // 文字切片不做垂直压缩（Kotlin 189 行只对气泡切片调用 compressTile）
          detectionSize: tileSize,
          page,
          tileIndex,
        });
        for (const line of remapTileRectsToPage(localLines, tileSize.width, tileSize.height, tile)) {
          detectedTextLines.push(line);
        }
      } catch {
        // 同上：单片失败跳过
      }
    }
    const deduplicatedLines = TextBlockMerger.deduplicateLines(detectedTextLines, pageWidth, pageHeight);
    const rejoinedBubbles = mergeBubblesSpannedByTextLines(
      deduplicatedBubbles,
      deduplicatedLines,
      pageWidth,
      pageHeight,
    );
    const supplementLines = filterOverlapping(
      deduplicatedLines,
      rejoinedBubbles.map((b) => b.rect),
      PAGE_REGION_TEXT_IOU,
    );
    const sizeFiltered = filterTinyTextRects(supplementLines, pageWidth, pageHeight);
    const longFiltered = sizeFiltered.filter(
      (it) => !shouldFilterLongImageRegion(it, pageWidth, pageHeight),
    );
    let blocks: ReturnType<typeof TextBlockMerger.merge>;
    try {
      blocks = TextBlockMerger.merge(longFiltered, pageWidth, pageHeight);
    } catch {
      blocks = longFiltered.map((rect) => ({
        rect,
        lines: [{ ...rect }],
        orientation: TextLineOrientation.AMBIGUOUS,
        maskContour: [],
      }));
    }
    return {
      bubbles: rejoinedBubbles,
      textLines: deduplicatedLines,
      textBlocks: blocks,
      complete: true,
    };
  }

  /** Kotlin lines 94 / 182 / 196 — the exported tiling helpers, re-exported for callers. */
  static readonly DETECTION_MAX_EDGE = DETECTION_MAX_EDGE;
  static readonly longImageBubbleDetectionTileHeight = longImageBubbleDetectionTileHeight;
  static readonly longImageBubbleDetectionInputHeight = longImageBubbleDetectionInputHeight;
  static readonly shouldUseLongImageTiling = shouldUseLongImageTiling;
  static readonly shouldDiscardReplayTileTopFragments = shouldDiscardReplayTileTopFragments;
  static readonly shouldFilterLongImageRegion = shouldFilterLongImageRegion;
  static readonly deduplicateBubbleDetections = deduplicateBubbleDetections;
  static readonly detectionTile = detectionTile;
}

export const LONG_IMAGE_DETECTOR_STUB_REASON =
  'Bitmap.createBitmap + Bitmap.scale + YOLO26n-seg/PP-OCR ONNX 会话';

export type { DeduplicatedBubbleGroup };