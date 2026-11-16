/**
 * Bubble region assembly + baked-overlay rendering — pure parts ported, rendering stubbed,
 * from Android `novel-reader/app/src/main/java/com/example/mangatranslate/BubblePipeline.kt`
 * (447 lines total, 416 non-blank).
 *
 * SCOPE: manga translation is deliberately excluded from the iOS port (see `index.ts`).
 * `Region`, the two bubble/line predicates, `buildRegions`, `anchorRect`,
 * `medianLineHeight`, `findLargestFilledRect`, `sampleBackgroundColor` and
 * `contrastingTextColor` are all pure over rects / pixel buffers and are ported in full.
 * Everything that draws (`bake`, `drawBubbleShape`, `drawFreeBlock`, `drawTextHorizontal`,
 * `drawTextVertical`, `insetTextBounds`'s rasterisation) is stubbed — it needs
 * `android.graphics.Canvas` / `Paint` / `StaticLayout` / `Path`.
 *
 * Line map (Kotlin line → TS):
 *   1..18    package + imports (`Bitmap`, `Canvas`, `Color`, `Matrix`, `Paint`, `Path`,
 *            `RectF`, `Typeface`, `Layout`, `StaticLayout`, `TextPaint`, `kotlin.math.*`)
 *            → no imports; `Path` becomes a normalised contour, `Canvas` a stub.
 *   19..32   KDoc `气泡区域检测与归并（第十六轮，精准复刻原仓库 PageRegionDetector 语义）：`
 *            (3 bullets) + `译文渲染（BubbleRenderer 语义）：` (2 bullets) → kept verbatim.
 *   33       `object BubblePipeline {` → {@link BubblePipeline}.
 *   34..35   (blank)
 *   36..43   `data class Region(rect, maskContour, lines, vertical)` with the three
 *            per-field KDocs → {@link BubbleRegion} (renamed to avoid clashing with
 *            `pageRegionTiling`'s types).
 *   44..51   `internal fun lineBelongsToRegion(line, bubble)` → {@link lineBelongsToRegion},
 *            **ported**: `contains(bubble, line)` first, then
 *            `lineArea <= 0 → false`, then `interArea(line, bubble)/lineArea >= 0.5f`.
 *   52..60   `internal fun shouldFilterTextRectByBubble(line, bubble)` →
 *            {@link shouldFilterTextRectByBubble}, **ported**: the `inter <= 0 → false`
 *            guard, then `union > 0 && inter/union >= 0.2f`, then `contains(bubble, line)`.
 *   61..90   `fun buildRegions(bubbles, textLines)` → {@link buildRegions}, **ported**:
 *            the `firstOrNull { lineBelongsToRegion }` host lookup, the `suppressed` check,
 *            the per-bubble `own` filter with the
 *            `own.count { it.height() > it.width()*1.5f } > own.size/2` vertical heuristic
 *            (integer division!), and the trailing `TextBlockGrouper.group(free)` mapping.
 *   91..101  the section KDoc 「形状渲染（原仓库 BubbleShapePaths/BubbleColorSampler/
 *            BubbleTextScaling）」 → kept.
 *   102..122 `fun bake(base, regions, textScale)` → STUB (Canvas); the
 *            `region.maskContour != null && size >= 6` shape-vs-rect branch decision and the
 *            un-polluted `sampling` snapshot requirement are preserved in
 *            {@link BubblePipeline.bakeDecision}.
 *   123..152 `private fun drawBubbleShape(...)` — `contourToPath`,
 *            `path.computeBounds`, `sampleBackgroundColor(sampling, bounds) ?: Color.WHITE`,
 *            `insetTextBounds`, `anchorRect(textRect, region.lines)`,
 *            `contrastingTextColor(bg)`, `medianLineHeight(region.lines)` → the pure
 *            helpers are ported, the drawing is stubbed.
 *   153..178 `internal fun anchorRect(safe, lines)` → {@link anchorRect}, **ported**:
 *            the `lines.isEmpty() → safe`, the union box, the intersection rect,
 *            the `width() <= 4f || height() <= 4f → safe`, the
 *            `coverage < 0.4f → safe` fallback, and the 10 % grow clamped back inside
 *            `safe`. KDoc 「排版锚定：原文行包围盒与安全区求交；交集过小（<40%）时退回安全区居中。」 kept.
 *   179..193 `private fun drawFreeBlock(...)` → stubbed; the padding/corner arithmetic
 *            (`pad = min(w,h)*0.06f`, `corner = min(10f, min(w,h)*0.14f)`,
 *            `BG_COLOR = 0xFFFDFBF7`, `OUTLINE_COLOR = 0x14262626`) → preserved as
 *            {@link FREE_BLOCK_BG_COLOR} / {@link OUTLINE_COLOR} / {@link freeBlockGeometry}.
 *   194..200 `internal fun medianLineHeight(lines)` → {@link medianLineHeight}, **ported**:
 *            the Kotlin `sorted()[size/2]` upper-median (NOT an average) is preserved.
 *   201..212 `internal fun contourToPath(contour, w, h)` → {@link contourToPagePoints},
 *            **ported** as a point list (a `Path` has no TS analogue); the
 *            `moveTo(contour[0]*w, contour[1]*h)` + `lineTo` walk and the implicit
 *            `close()` are preserved.
 *   213..256 `internal fun insetTextBounds(path, pathBounds)` — the rasterisation to a
 *            ≤96 px mask, the `(pixels[i] ushr 24) >= 224` alpha threshold, the
 *            `findLargestFilledRect` call and the 0.35×-extra shrink / 0.18×-acceptance
 *            fallback → the *scoring* half is ported ({@link findLargestFilledRect},
 *            {@link insetFromLargestRect}); the rasterisation is stubbed.
 *   257..291 `internal fun findLargestFilledRect(filled, width, height)` →
 *            {@link findLargestFilledRect}, **ported**: the per-row histogram update, the
 *            monotonic-stack walk `while (x <= width)`, the `cur >= heights[top]` push rule,
 *            the `if (rectH <= 0) continue`, the `left = stackSize == 0 ? 0 : stack[stackSize-1]+1`,
 *            and the `score = wRect*rectH * (minSide/maxSide).coerceIn(0.35f, 1f)` ranking.
 *   292..336 `internal fun sampleBackgroundColor(bitmap, bounds)` → **ported**:
 *            the `SAMPLE_STEP = 4` stride, the `v = max(r, max(g, b))` value histogram,
 *            the three per-value channel sums, the `dark * 2 >= samples` dark-background
 *            decision, the median search `for (v in 0..255) { seen += histogram[v]; if (seen > mid) { median = v; break } }`,
 *            the two cutoffs (`DARK_BACKGROUND_MAX_CHANNEL = 72` vs
 *            `(median - INK_VALUE_GAP).coerceIn(0, MAX_INK_VALUE)` with `INK_VALUE_GAP = 32`,
 *            `MAX_INK_VALUE = 160`) and the `(r/cnt).toInt()` average. The `Bitmap[x, y]`
 *            pixel access is an injected `getPixel`.
 *   337..344 `internal fun contrastingTextColor(background)` → **ported**:
 *            `luminance = 0.299f*r + 0.587f*g + 0.114f*b`, `> 127f` → dark else light.
 *   345..397 `internal fun drawTextHorizontal(...)` — the `rect.height() > rect.width()*1.6f`
 *            vertical dispatch, `MIN_TEXT_SIZE_PX = 0.5f`, `TEXT_SIZE_PRECISION_PX = 0.25f`,
 *            the binary search, and the round-19 `high = (refLineHeight*1.15f*textScale)
 *            .coerceIn(MIN_ANCHORED_SIZE_PX, high)` cap with `MIN_ANCHORED_SIZE_PX = 10f`
 *            → the constants and the upper-bound computation are ported
 *            ({@link horizontalTextSizeBounds}); the layout/draw is stubbed.
 *   398..401 `private const val MIN_ANCHORED_SIZE_PX = 10f` → {@link MIN_ANCHORED_SIZE_PX}.
 *   402..434 `private fun drawTextVertical(...)` — `chars = text.replace(Regex("\\s+"), "")`,
 *            `step = size*1.18f`, `perCol = max(1, (maxH/step).toInt())`,
 *            `cols = ceil(chars.size/perCol)`, `size -= max(1f, size*0.08f)` and
 *            `startX = rect.right - step/2f` → the **fit search** is ported
 *            ({@link fitVerticalText}); the glyph loop is stubbed.
 *   435..447 the three geometry helpers (`area`, `interArea`, `contains`) → ported.
 *
 * Skipped lines and why:
 *   - Kotlin lines 102..122, 129..152, 181..193, 347..397, 403..434: Canvas / Paint /
 *     Path / StaticLayout rendering. Replaced by typed stubs; the layout *arithmetic*
 *     is kept so it stays testable.
 *   - Kotlin `Typeface.DEFAULT_BOLD`, `Paint.Align.CENTER`, `StaticLayout.Builder`
 *     (`setAlignment(ALIGN_CENTER)`, `setIncludePad(false)`, `setLineSpacing(0f, 1f)` /
 *     `1.05f`) → recorded in {@link BAKED_LAYOUT_NOTES} as the exact layout the renderer
 *     must reproduce if it is ever implemented.
 *
 * Every constant, threshold and Chinese comment is byte-identical. No U+3000 in the file.
 */

import { MangaTranslateUnsupportedError, type RectF, copyRect, rectF, rectHeight, rectWidth } from './index';
import type { BubbleDetection } from './bubbleDetector';
import { TextBlockGrouper, type TextBlockGroup } from './translationCore';

/* ────────────────────────────────────────────────────────────────────────────
 * R20-audit additions (2026-10-06, subagent "mangatranslate" line-by-line review)
 *
 * The Android code in this file splits into two classes:
 *   (1) ONNX / Canvas / Bitmap work → out of scope (E1, see `index.ts`).
 *   (2) pure geometry, colour and layout arithmetic → MUST exist in TS.
 * The 2026-10-06 audit re-read BubblePipeline.kt line by line and found that three
 * class-(2) bodies had been left as stubs or half-ported:
 *
 *   · `insetTextBounds` — the rasterisation half. It looked like Canvas work, but the
 *     only Canvas call is `canvas.drawPath(maskPath, whitePaint)` into a ≤96 px bitmap.
 *     A `Path` built from a simple polygon is exactly a point list, and rasterising it
 *     is a scanline fill — pure JS. Now implemented as {@link rasterizeContourMask} +
 *     {@link insetTextBoundsFromContour}, and `insetFromLargestRect` was FIXED (BUG).
 *   · `drawTextHorizontal`'s binary search — the loop only needs a `fits(size)` predicate
 *     (Android: `StaticLayout.height` / `getLineWidth`). The wrap algorithm itself is
 *     `StaticLayout`, i.e. a platform text engine; the *search over it* is now
 *     {@link binarySearchHorizontalFontSize}.
 *   · `drawTextVertical`'s glyph loop — pure column arithmetic. Now
 *     {@link layoutVerticalColumns} ({@link fitVerticalText}'s `perCol`/`step` were
 *     already ported).
 *
 * Still stubbed (class 1): `BubblePipeline.bake` — it needs `Bitmap.copy` + `Canvas`.
 * ──────────────────────────────────────────────────────────────────────────── */

const coerceIn = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/* ── region model ── */

/** Kotlin lines 36..43 — 一个翻译区域：气泡（带形状）或游离文字块（矩形）。 */
export interface BubbleRegion {
  rect: RectF;
  /** 归一化多边形（气泡）；null=游离文字块 */
  maskContour: number[] | null;
  /** 归属的文字行（OCR 用） */
  lines: RectF[];
  /** 文字排布方向（行形状启发式） */
  vertical: boolean;
}

/* ── constants (Kotlin lines 94..100, 188..191, 401) ── */
export const SAMPLE_STEP = 4;
export const DARK_BACKGROUND_MAX_CHANNEL = 72;
export const INK_VALUE_GAP = 32;
export const MAX_INK_VALUE = 160;
export const DEFAULT_TEXT_COLOR = 0xff1b1b1b;
export const MIN_TEXT_SIZE_PX = 0.5;
export const TEXT_SIZE_PRECISION_PX = 0.25;
/** 锚定模式下的字号下限（原文行高很小时译文仍需可读）。 */
export const MIN_ANCHORED_SIZE_PX = 10;
/** Kotlin line 188. */
export const FREE_BLOCK_BG_COLOR = 0xfffdfbf7;
/** Kotlin line 190: `0x14262626`. */
export const OUTLINE_COLOR = 0x14262626;
/** Kotlin line 343: `0xFFF4F4F2`. */
export const LIGHT_ON_DARK_TEXT_COLOR = 0xfff4f4f2;
/** Kotlin lines 112 / 224 / 225: the rasterisation bounds of `insetTextBounds`. */
export const INSET_MASK_MAX = 96;
export const INSET_MASK_MIN = 16;
export const INSET_ALPHA_THRESHOLD = 224;
export const INSET_MIN_ACCEPT_RATIO = 0.18;
export const INSET_EXTRA_RATIO = 0.12;
export const INSET_EXTRA_APPLY = 0.35;
/** Kotlin line 188..191 padding/corner factors. */
export const FREE_BLOCK_PADDING_FRACTION = 0.06;
export const FREE_BLOCK_CORNER_MAX = 10;
export const FREE_BLOCK_CORNER_RATIO = 0.14;
/** Kotlin lines 240 / 330: `minSide/maxSide` score shaping. */
export const LARGEST_RECT_SCORE_MIN_SHAPE = 0.35;
/** Kotlin lines 337..343. */
export const TEXT_COLOR_LUMINANCE_THRESHOLD = 127;
export const LUMINANCE_R = 0.299;
export const LUMINANCE_G = 0.587;
export const LUMINANCE_B = 0.114;
/** Kotlin line 380: the anchor multiplier. */
export const ANCHORED_SIZE_MULTIPLIER = 1.15;
/** Kotlin line 356: `if (rect.height() > rect.width() * 1.6f) → vertical`. */
export const HORIZONTAL_TO_VERTICAL_ASPECT = 1.6;
/** Kotlin lines 185 / 194: the vertical heuristic in `buildRegions`. */
export const VERTICAL_LINE_ASPECT = 1.5;

/**
 * The exact Android text-layout configuration the renderer must reproduce if it is ever
 * implemented. Kotlin lines 323..330 (OverlayRenderer, ALIGN_CENTER / spacing 1.05) and
 * 365..369 (BubblePipeline, setIncludePad(false) / spacing 1f).
 */
export const BAKED_LAYOUT_NOTES = {
  bubbleText: { alignment: 'ALIGN_CENTER', includePad: false, lineSpacingMultiplier: 1 },
  freeBlockText: { alignment: 'ALIGN_CENTER', lineSpacingMultiplier: 1.05 },
  typeface: 'Typeface.DEFAULT_BOLD',
} as const;

/* ── geometry helpers (Kotlin lines 436..446) ── */

function area(r: RectF): number {
  return Math.max(rectWidth(r), 0) * Math.max(rectHeight(r), 0);
}

function interArea(a: RectF, b: RectF): number {
  return (
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  );
}

function contains(outer: RectF, inner: RectF): boolean {
  return (
    outer.left <= inner.left &&
    outer.top <= inner.top &&
    outer.right >= inner.right &&
    outer.bottom >= inner.bottom
  );
}

/* ── pure predicates ── */

/** 气泡内行归属（原仓库 lineBelongsToRegion）：包含 或 相交面积≥50%。 — Kotlin lines 44..51. */
export function lineBelongsToRegion(line: RectF, bubble: RectF): boolean {
  if (contains(bubble, line)) return true;
  const lineArea = area(line);
  if (lineArea <= 0) return false;
  return interArea(line, bubble) / lineArea >= 0.5;
}

/** 行与气泡的抑制判定（shouldFilterTextRectByBubble）：IoU≥0.2 或被包含。 — Kotlin lines 52..60. */
export function shouldFilterTextRectByBubble(line: RectF, bubble: RectF): boolean {
  const inter = interArea(line, bubble);
  if (inter <= 0) return false;
  const union = area(line) + area(bubble) - inter;
  if (union > 0 && inter / union >= 0.2) return true;
  return contains(bubble, line);
}

/**
 * 归并：气泡（YOLO）+ 文字行（Paddle）→ 区域列表。
 * 游离行（不属于任何气泡、不被气泡抑制）按行带聚类。
 * Kotlin lines 61..90 — FULLY PORTED.
 */
export function buildRegions(
  bubbles: readonly BubbleDetection[],
  textLines: readonly RectF[],
): BubbleRegion[] {
  const regions: BubbleRegion[] = [];
  const free: RectF[] = [];
  for (const line of textLines) {
    const host = bubbles.find((b) => lineBelongsToRegion(line, b.rect));
    if (host === undefined) {
      // 不被任何气泡抑制（IoU/包含）才保留为游离行
      const suppressed = bubbles.some((b) => shouldFilterTextRectByBubble(line, b.rect));
      if (!suppressed) free.push(line);
    }
  }
  for (const bubble of bubbles) {
    const own = textLines.filter((line) => lineBelongsToRegion(line, bubble.rect));
    const vertical =
      own.length > 0 &&
      own.filter((r) => rectHeight(r) > rectWidth(r) * VERTICAL_LINE_ASPECT).length >
        Math.floor(own.length / 2);
    regions.push({ rect: bubble.rect, maskContour: bubble.maskContour, lines: own, vertical });
  }
  for (const block of TextBlockGrouper.group(free)) {
    regions.push({ rect: block.rect, maskContour: null, lines: block.lines, vertical: block.vertical });
  }
  return regions;
}

/** 排版锚定：原文行包围盒与安全区求交；交集过小（<40%）时退回安全区居中。 — Kotlin lines 153..178. */
export function anchorRect(safe: RectF, lines: readonly RectF[]): RectF {
  if (lines.length === 0) return safe;
  const box = copyRect(lines[0] as RectF);
  for (let i = 1; i < lines.length; i += 1) {
    const r = lines[i] as RectF;
    if (r.left < box.left) box.left = r.left;
    if (r.top < box.top) box.top = r.top;
    if (r.right > box.right) box.right = r.right;
    if (r.bottom > box.bottom) box.bottom = r.bottom;
  }
  const inter = rectF(
    Math.max(safe.left, box.left),
    Math.max(safe.top, box.top),
    Math.min(safe.right, box.right),
    Math.min(safe.bottom, box.bottom),
  );
  if (rectWidth(inter) <= 4 || rectHeight(inter) <= 4) return safe;
  const boxArea = rectWidth(box) * rectHeight(box);
  if (boxArea <= 0) return safe;
  const coverage = (rectWidth(inter) * rectHeight(inter)) / boxArea;
  if (coverage < 0.4) return safe;
  // 交集略外扩（原文行紧贴时译文太挤），但仍限制在安全区内
  const growX = rectWidth(inter) * 0.1;
  const growY = rectHeight(inter) * 0.1;
  return rectF(
    Math.max(inter.left - growX, safe.left),
    Math.max(inter.top - growY, safe.top),
    Math.min(inter.right + growX, safe.right),
    Math.min(inter.bottom + growY, safe.bottom),
  );
}

/** 原文行高中位数（第十九轮）：译文字号的锚——译文不得比原文显眼得多。 — Kotlin lines 194..200. */
export function medianLineHeight(lines: readonly RectF[]): number {
  if (lines.length === 0) return 0;
  const heights = lines.map((l) => rectHeight(l)).sort((a, b) => a - b);
  // Kotlin `sorted()[heights.size / 2]` is the UPPER median for even sizes, not an average.
  return heights[Math.floor(heights.length / 2)] as number;
}

/**
 * `contourToPath(contour, w, h)` — Kotlin lines 201..212.
 * A `Path` has no TS analogue; the equivalent polyline is returned (the Android
 * `path.close()` closes the loop implicitly for fill purposes).
 */
export function contourToPagePoints(
  contour: readonly number[],
  w: number,
  h: number,
): number[] {
  const points: number[] = [];
  if (contour.length < 2) return points;
  points.push((contour[0] as number) * w, (contour[1] as number) * h);
  let i = 2;
  while (i + 1 < contour.length) {
    points.push((contour[i] as number) * w, (contour[i + 1] as number) * h);
    i += 2;
  }
  return points;
}

/** Kotlin lines 257..291 — the largest filled rectangle in a binary mask (monotonic stack). */
export function findLargestFilledRect(
  filled: readonly boolean[],
  width: number,
  height: number,
): RectF | null {
  const heights = new Array<number>(width).fill(0);
  const stack = new Array<number>(width + 1).fill(0);
  let best: RectF | null = null;
  let bestScore = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      heights[x] = filled[y * width + x] === true ? (heights[x] as number) + 1 : 0;
    }
    let stackSize = 0;
    let x = 0;
    while (x <= width) {
      const cur = x === width ? 0 : (heights[x] as number);
      if (stackSize === 0 || cur >= (heights[stack[stackSize - 1] as number] as number)) {
        stack[stackSize] = x;
        stackSize += 1;
        x += 1;
      } else {
        stackSize -= 1;
        const top = stack[stackSize] as number;
        const rectH = heights[top] as number;
        if (rectH <= 0) continue;
        const right = x;
        const left = stackSize === 0 ? 0 : (stack[stackSize - 1] as number) + 1;
        const wRect = right - left;
        const minSide = Math.min(wRect, rectH);
        const maxSide = Math.max(Math.max(wRect, rectH), 1);
        const score = wRect * rectH * coerceIn(minSide / maxSide, LARGEST_RECT_SCORE_MIN_SHAPE, 1);
        if (score > bestScore) {
          bestScore = score;
          best = rectF(left, y - rectH + 1, right, y + 1);
        }
      }
    }
  }
  return best;
}

/**
 * Kotlin lines 244..245 — `val wScale = pathBounds.width() / maskW.toFloat()` /
 * `hScale = pathBounds.height() / maskH.toFloat()`.
 *
 * R20-audit BUG FIX: `wScale`/`hScale` were previously `width / 1` and `height / 1`
 * because `maskW`/`maskH` were never accepted as parameters. For every mask whose
 * dimensions differ from 1 the safe rect was therefore scaled by the wrong factor.
 * `maskW`/`maskH` are now required arguments (Kotlin reads them from the local
 * `val maskW = pathBounds.width().toInt().coerceIn(16, maxMask)` / `maskH`).
 */
export function insetFromLargestRect(
  pathBounds: RectF,
  rectMask: RectF,
  fallbackPad: number,
  maskW: number,
  maskH: number,
): RectF {
  const wScale = rectWidth(pathBounds) / maskW;
  const hScale = rectHeight(pathBounds) / maskH;
  const extraX = Math.min(fallbackPad, rectWidth(pathBounds) * INSET_EXTRA_RATIO);
  const extraY = Math.min(fallbackPad, rectHeight(pathBounds) * INSET_EXTRA_RATIO);
  const safe = rectF(
    pathBounds.left + rectMask.left * wScale + extraX * INSET_EXTRA_APPLY,
    pathBounds.top + rectMask.top * hScale + extraY * INSET_EXTRA_APPLY,
    pathBounds.left + rectMask.right * wScale - extraX * INSET_EXTRA_APPLY,
    pathBounds.top + rectMask.bottom * hScale - extraY * INSET_EXTRA_APPLY,
  );
  return rectWidth(safe) > rectWidth(pathBounds) * INSET_MIN_ACCEPT_RATIO &&
    rectHeight(safe) > rectHeight(pathBounds) * INSET_MIN_ACCEPT_RATIO
    ? safe
    : insetRectCopy(pathBounds, fallbackPad);
}

/** Kotlin line 219: `val fallbackPad = (min(w, h) * 0.08f).coerceAtLeast(6f)`. */
export function insetFallbackPad(pathBounds: RectF): number {
  return Math.max(Math.min(rectWidth(pathBounds), rectHeight(pathBounds)) * 0.08, 6);
}

/** Kotlin lines 225..226: `maskW`/`maskH` — `toInt()` truncation then `coerceIn(16, 96)`. */
export function insetMaskSize(pathBounds: RectF): { maskW: number; maskH: number } {
  return {
    maskW: Math.min(Math.max(Math.floor(rectWidth(pathBounds)), INSET_MASK_MIN), INSET_MASK_MAX),
    maskH: Math.min(Math.max(Math.floor(rectHeight(pathBounds)), INSET_MASK_MIN), INSET_MASK_MAX),
  };
}

/** Axis-aligned bounds of a normalised contour scaled into a `w × h` page. */
export function contourPageBounds(
  contour: readonly number[],
  w: number,
  h: number,
): RectF | null {
  if (contour.length < 2) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < contour.length; i += 2) {
    const x = (contour[i] as number) * w;
    const y = (contour[i + 1] as number) * h;
    if (x < left) left = x;
    if (y < top) top = y;
    if (x > right) right = x;
    if (y > bottom) bottom = y;
  }
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return rectF(left, top, right, bottom);
}

/**
 * Kotlin lines 227..241 — the rasterisation half of `insetTextBounds`.
 *
 * Android builds a `Matrix` (`postTranslate(-pathBounds.left, -pathBounds.top)` then
 * `postScale((maskW-1)/pathBounds.width(), (maskH-1)/pathBounds.height())`), fills the
 * transformed path white into an `ARGB_8888` bitmap and reads back
 * `(pixels[i] ushr 24) >= 224`. A `Path` built by `contourToPath` is a closed polygon, so
 * the equivalent is an even-odd scanline fill sampled at pixel centres; for the simple
 * (non self-intersecting) polygons a bubble contour produces, even-odd and Android's
 * non-zero winding agree exactly.
 *
 * Kotlin line 241 is the only alpha read, hence {@link INSET_ALPHA_THRESHOLD}.
 */
export function rasterizeContourMask(
  contour: readonly number[],
  pageW: number,
  pageH: number,
  pathBounds: RectF,
  maskW: number,
  maskH: number,
): boolean[] {
  const filled = new Array<boolean>(maskW * maskH).fill(false);
  const boundsW = rectWidth(pathBounds);
  const boundsH = rectHeight(pathBounds);
  if (boundsW <= 0 || boundsH <= 0) return filled;
  const sx = (maskW - 1) / boundsW;
  const sy = (maskH - 1) / boundsH;

  // transform the polygon into mask space (Android's postTranslate then postScale)
  const points: number[] = [];
  for (let i = 0; i + 1 < contour.length; i += 2) {
    points.push(
      ((contour[i] as number) * pageW - pathBounds.left) * sx,
      ((contour[i + 1] as number) * pageH - pathBounds.top) * sy,
    );
  }
  const pointCount = points.length / 2;
  if (pointCount < 3) return filled;

  for (let py = 0; py < maskH; py += 1) {
    // Android samples the pixel centre.
    const rayY = py + 0.5;
    for (let px = 0; px < maskW; px += 1) {
      const rayX = px + 0.5;
      let inside = false;
      for (let k = 0, j = pointCount - 1; k < pointCount; j = k, k += 1) {
        const xi = points[k * 2] as number;
        const yi = points[k * 2 + 1] as number;
        const xj = points[j * 2] as number;
        const yj = points[j * 2 + 1] as number;
        if (yi > rayY !== yj > rayY) {
          const t = (rayY - yi) / (yj - yi);
          if (rayX < xi + (xj - xi) * t) inside = !inside;
        }
      }
      filled[py * maskW + px] = inside;
    }
  }
  return filled;
}

/**
 * 气泡内文字安全矩形（原仓库 estimateSafeTextRect）：把 Path 光栅化到
 * ≤96px 蒙版，找最大内接矩形（柱状图法），按面积×长短边平衡评分。
 *
 * Kotlin lines 218..256, fully implemented (R20-audit). `contour` is the normalised
 * polygon that Android turns into a `Path` via `contourToPath(maskContour, w, h)`.
 */
export function insetTextBoundsFromContour(
  contour: readonly number[],
  pageW: number,
  pageH: number,
): RectF {
  const pathBounds = contourPageBounds(contour, pageW, pageH);
  if (pathBounds === null) return rectF(0, 0, 0, 0);
  const fallbackPad = insetFallbackPad(pathBounds);
  // Kotlin L220..222: `inset = RectF(pathBounds).inset(fallbackPad, fallbackPad)` and
  // `if (inset.width() <= 0f || inset.height() <= 0f) return RectF(pathBounds)` —
  // `insetRectCopy` already applies that fallback, so `inset` is the L222 `return inset`
  // value in the normal case and the L222 `return RectF(pathBounds)` value when degenerate.
  const inset = insetRectCopy(pathBounds, fallbackPad);

  const { maskW, maskH } = insetMaskSize(pathBounds);
  const filled = rasterizeContourMask(contour, pageW, pageH, pathBounds, maskW, maskH);
  const rectMask = findLargestFilledRect(filled, maskW, maskH);
  if (rectMask === null) return inset;
  return insetFromLargestRect(pathBounds, rectMask, fallbackPad, maskW, maskH);
}

/** Kotlin lines 219..222 — `RectF(pathBounds).inset(fallbackPad, fallbackPad)` + the ≤0 guard. */
export function insetRectCopy(pathBounds: RectF, fallbackPad: number): RectF {
  const inset = rectF(
    pathBounds.left + fallbackPad,
    pathBounds.top + fallbackPad,
    pathBounds.right - fallbackPad,
    pathBounds.bottom - fallbackPad,
  );
  return rectWidth(inset) <= 0 || rectHeight(inset) <= 0 ? copyRect(pathBounds) : inset;
}

/** Kotlin lines 179..191 — the free-block padding / corner geometry. */
export function freeBlockGeometry(rect: RectF): {
  ok: boolean;
  inner: RectF;
  corner: number;
  pad: number;
} {
  if (rectWidth(rect) < 6 || rectHeight(rect) < 6) return { ok: false, inner: rect, corner: 0, pad: 0 };
  const pad = Math.min(rectWidth(rect), rectHeight(rect)) * FREE_BLOCK_PADDING_FRACTION;
  const inner = rectF(rect.left + pad, rect.top + pad, rect.right - pad, rect.bottom - pad);
  if (rectWidth(inner) < 4 || rectHeight(inner) < 4) return { ok: false, inner, corner: 0, pad };
  const corner = Math.min(
    FREE_BLOCK_CORNER_MAX,
    Math.min(rectWidth(rect), rectHeight(rect)) * FREE_BLOCK_CORNER_RATIO,
  );
  return { ok: true, inner, corner, pad };
}

/**
 * 气泡背景色采样（原仓库 averagePixels）：直方图去墨，暗底/亮底双策略。
 * Kotlin lines 292..336 — FULLY PORTED. `getPixel(x, y)` returns a packed 0xAARRGGBB int.
 */
export function sampleBackgroundColor(
  getPixel: (x: number, y: number) => number,
  bitmapWidth: number,
  bitmapHeight: number,
  bounds: RectF,
): number | null {
  const bw = bitmapWidth;
  const bh = bitmapHeight;
  if (bw <= 0 || bh <= 0) return null;
  const left = coerceInInt(Math.floor(bounds.left), 0, bw - 1);
  const top = coerceInInt(Math.floor(bounds.top), 0, bh - 1);
  const right = coerceInInt(Math.floor(bounds.right), left + 1, bw);
  const bottom = coerceInInt(Math.floor(bounds.bottom), top + 1, bh);
  if (right <= left || bottom <= top) return null;

  const histogram = new Array<number>(256).fill(0);
  const rSum = new Array<number>(256).fill(0);
  const gSum = new Array<number>(256).fill(0);
  const bSum = new Array<number>(256).fill(0);
  let samples = 0;
  let dark = 0;
  for (let y = top; y < bottom; y += SAMPLE_STEP) {
    for (let x = left; x < right; x += SAMPLE_STEP) {
      const p = getPixel(x, y);
      const r = (p >> 16) & 0xff;
      const g = (p >> 8) & 0xff;
      const b = p & 0xff;
      const v = Math.max(r, Math.max(g, b));
      histogram[v] = (histogram[v] as number) + 1;
      rSum[v] = (rSum[v] as number) + r;
      gSum[v] = (gSum[v] as number) + g;
      bSum[v] = (bSum[v] as number) + b;
      samples += 1;
      if (v <= DARK_BACKGROUND_MAX_CHANNEL) dark += 1;
    }
  }
  if (samples === 0) return null;
  const darkBackground = dark * 2 >= samples;
  let cutoff: number;
  if (darkBackground) {
    cutoff = DARK_BACKGROUND_MAX_CHANNEL;
  } else {
    let seen = 0;
    const mid = Math.floor((samples - 1) / 2);
    let median = 0;
    for (let v = 0; v <= 255; v += 1) {
      seen += histogram[v] as number;
      if (seen > mid) {
        median = v;
        break;
      }
    }
    cutoff = coerceInInt(median - INK_VALUE_GAP, 0, MAX_INK_VALUE);
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let cnt = 0;
  for (let v = 0; v <= 255; v += 1) {
    const include = darkBackground ? v <= cutoff : v > cutoff;
    if (include) {
      r += rSum[v] as number;
      g += gSum[v] as number;
      b += bSum[v] as number;
      cnt += histogram[v] as number;
    }
  }
  if (cnt === 0) return null;
  return packRgb(Math.floor(r / cnt), Math.floor(g / cnt), Math.floor(b / cnt));
}

/**
 * Kotlin line 335: `Color.rgb(r, g, b)`.
 *
 * `android.graphics.Color.rgb` is `0xFF000000 or (r shl 16) or (g shl 8) or b` — an
 * **ARGB** packing. {@link contrastingTextColor} (and `sampleBackgroundColor`'s
 * `getPixel`) read that same layout: `(c shr 16) and 0xFF` is R.
 *
 * R20-audit BUG FIX: this used to emit `(b << 16) | (g << 8) | r` (ABGR). The packed
 * value then disagreed with `contrastingTextColor`, which weighted 0.299 against what
 * it believed was R but was actually B — the luminance test could return the wrong
 * text colour for any non-grey bubble background (e.g. sampled RGB(200,120,30):
 * Kotlin luminance 133.66 → dark text; the ABGR value decoded to 102.21 → light text).
 */
export function packRgb(r: number, g: number, b: number): number {
  return ((0xff << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) | 0;
}

/** Kotlin lines 337..343. */
export function contrastingTextColor(background: number): number {
  const r = (background >> 16) & 0xff;
  const g = (background >> 8) & 0xff;
  const b = background & 0xff;
  const luminance = LUMINANCE_R * r + LUMINANCE_G * g + LUMINANCE_B * b;
  return luminance > TEXT_COLOR_LUMINANCE_THRESHOLD ? DEFAULT_TEXT_COLOR : LIGHT_ON_DARK_TEXT_COLOR;
}

/** Kotlin line 358: `rect.height() > rect.width() * 1.6f` ⇒ vertical column layout. */
export function prefersVerticalText(rect: RectF): boolean {
  return rectHeight(rect) > rectWidth(rect) * HORIZONTAL_TO_VERTICAL_ASPECT;
}

/**
 * Kotlin lines 377..389 — the binary-search bracket `[low, high]`.
 * `high = max(maxW, maxH)` unless `refLineHeight > 4f`, in which case the round-19 cap
 * `high = (refLineHeight * 1.15f * textScale).coerceIn(MIN_ANCHORED_SIZE_PX, high)` applies.
 */
export function horizontalTextSizeBounds(
  rect: RectF,
  textScale: number,
  refLineHeight: number,
): { low: number; high: number } {
  const maxW = Math.max(Math.floor(rectWidth(rect)), 1);
  const maxH = rectHeight(rect);
  const low = MIN_TEXT_SIZE_PX;
  let high = Math.max(maxW, maxH);
  if (refLineHeight > 4) {
    high = coerceIn(refLineHeight * ANCHORED_SIZE_MULTIPLIER * textScale, MIN_ANCHORED_SIZE_PX, high);
  }
  return { low, high };
}

/**
 * Kotlin lines 371..390 — the binary search over the fit predicate.
 *
 * ```kotlin
 * fun fits(size: Float): Boolean {
 *     val l = layoutAt(size)
 *     if (l.height > maxH) return false
 *     for (i in 0 until l.lineCount) if (l.getLineWidth(i) > maxW + 0.5f) return false
 *     return true
 * }
 * var low = MIN_TEXT_SIZE_PX
 * if (!fits(low)) return
 * var bestSize = low
 * while (high - low > TEXT_SIZE_PRECISION_PX) {
 *     val mid = (low + high) / 2f
 *     if (fits(mid)) { bestSize = mid; low = mid } else high = mid
 * }
 * ```
 *
 * R20-audit: the loop itself is pure — only `fits` needs the platform text engine
 * (`StaticLayout` on Android, the browser's line breaker in the web reader), so it is
 * injected. Returns the chosen size, or `null` for Kotlin's bare `return` (the text
 * does not fit even at {@link MIN_TEXT_SIZE_PX}, i.e. nothing is drawn).
 *
 * NOTE (Kotlin line 358): `drawTextHorizontal` dispatches to the vertical column layout
 * *before* any of this, when `rect.height() > rect.width() * 1.6f`
 * ({@link prefersVerticalText}). Callers must check that first.
 */
export function binarySearchHorizontalFontSize(
  rect: RectF,
  textScale: number,
  refLineHeight: number,
  fits: (size: number) => boolean,
): number | null {
  const { low: lowInit, high: highInit } = horizontalTextSizeBounds(rect, textScale, refLineHeight);
  let low = lowInit;
  let high = highInit;
  if (!fits(low)) return null;
  let bestSize = low;
  while (high - low > TEXT_SIZE_PRECISION_PX) {
    const mid = (low + high) / 2;
    if (fits(mid)) {
      bestSize = mid;
      low = mid;
    } else {
      high = mid;
    }
  }
  return bestSize;
}

/**
 * Kotlin line 364: `paint.textSize = size * textScale` — the platform text size the
 * layout predicate is queried with. Kept separate so a caller can mirror
 * `layoutAt(size)` exactly.
 */
export function appliedTextSize(size: number, textScale: number): number {
  return size * textScale;
}

/** Kotlin lines 381..392 — the `size -= max(1f, size * 0.08f)` shrink step. */
export function shrinkTextSize(size: number): number {
  return size - Math.max(1, size * 0.08);
}

/**
 * 竖排：字自上而下叠成列，列自右向左（中文漫画习惯）。
 * Kotlin lines 402..434 — the fit search only; the glyph loop is stubbed.
 */
export function fitVerticalText(
  charCount: number,
  maxW: number,
  maxH: number,
): { size: number; perCol: number; step: number } | null {
  let size = Math.min(maxW * 0.9, maxH * 0.5);
  const minSize = 7;
  while (size >= minSize) {
    const step = size * 1.18;
    const perCol = Math.max(1, Math.floor(maxH / step));
    const cols = Math.ceil(charCount / perCol);
    if (cols * step <= maxW) return { size, perCol, step };
    size = shrinkTextSize(size);
  }
  return null;
}

/** Kotlin line 404: `text.replace(Regex("\\s+"), "")` — whitespace stripped for column layout. */
export function stripWhitespaceForVertical(text: string): string {
  return text.replace(/\s+/g, '');
}

/** One glyph's draw position, as produced by {@link layoutVerticalColumns}. */
export interface VerticalGlyphPosition {
  /** Kotlin `idx` — index into the whitespace-stripped character array. */
  charIndex: number;
  /** Kotlin `col` — column ordinal, 0 = rightmost. */
  column: number;
  /** Kotlin `x` (the draw anchor; `Paint.Align.CENTER`). */
  x: number;
  /** Kotlin `y` (the baseline). */
  y: number;
}

/**
 * 竖排（细高区域）：字上到下、列右到左（第十五轮实现迁移） — Kotlin lines 418..433.
 *
 * ```kotlin
 * val startX = rect.right - step / 2f
 * var idx = 0; var col = 0
 * while (idx < chars.size) {
 *     val x = startX - col * step
 *     var y = rect.top + chosenSize
 *     var inCol = 0
 *     while (idx < chars.size && inCol < perCol) {
 *         canvas.drawText(chars, idx, 1, x, y, paint)
 *         y += step; idx++; inCol++
 *     }
 *     col++
 * }
 * ```
 *
 * R20-audit: this is pure arithmetic (`drawText` is the only Canvas call), so the whole
 * column/row plan is now produced here and the renderer only has to paint it.
 *
 * `fit` must be the result of {@link fitVerticalText} (its `size` is used as
 * `chosenSize` and its `perCol`/`step` as the column metrics). Returns `null` for
 * Kotlin line 417's `if (chosenSize <= 0f) return` — i.e. no vertical fit was found.
 *
 * NOTE (checked line by line against Kotlin): there is **no kinsoku / 避头尾 rule**
 * anywhere in `drawTextVertical` or `OverlayRenderer.drawVertical` — whitespace is
 * stripped and every character is emitted unconditionally, so there is nothing to port.
 */
export function layoutVerticalColumns(
  chars: readonly string[],
  rect: RectF,
  fit: { size: number; perCol: number; step: number },
): VerticalGlyphPosition[] | null {
  if (fit.size <= 0) return null;
  if (chars.length === 0) return [];
  const startX = rect.right - fit.step / 2;
  const out: VerticalGlyphPosition[] = [];
  let idx = 0;
  let col = 0;
  while (idx < chars.length) {
    const x = startX - col * fit.step;
    let y = rect.top + fit.size;
    let inCol = 0;
    while (idx < chars.length && inCol < fit.perCol) {
      out.push({ charIndex: idx, column: col, x, y });
      y += fit.step;
      idx += 1;
      inCol += 1;
    }
    col += 1;
  }
  return out;
}

function coerceInInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 气泡区域检测与归并（第十六轮，精准复刻原仓库 PageRegionDetector 语义）：
 *
 * - YOLO 气泡分割给出"气泡级"区域（形状轮廓 maskContour）；
 * - PP-OCR 文字行检测给出"文字行级"矩形；
 * - 行归属：行完整落在气泡内（或 ≥50% 面积相交）→ 归属该气泡（lineBelongsToRegion）；
 *   与任何气泡相交的行从"游离文字"中剔除（shouldFilterTextRectByBubble，IoU≥0.2）；
 * - 游离文字行按第十五轮的行带聚类成块。
 *
 * 译文渲染（BubbleRenderer 语义）：
 * - 气泡：maskContour → Path 填充（背景色采样），文字排在气泡内最大内接矩形；
 * - 游离文字块：圆角矩形覆盖（第十五轮逻辑）。
 */
export const BubblePipeline = {
  /** Which branch {@link BubblePipeline.bake} would take for a region. */
  bakeDecision(region: BubbleRegion): 'bubble-shape' | 'free-block' {
    return region.maskContour !== null && region.maskContour.length >= 6
      ? 'bubble-shape'
      : 'free-block';
  },

  /** Kotlin lines 61..90. */
  buildRegions,

  /**
   * Kotlin lines 102..122 — STUB (needs `android.graphics.Canvas` + `Bitmap.copy`).
   * The two copies Android makes are worth recording: `out = base.copy(ARGB_8888, true)`
   * (mutable) and `sampling = base.copy(ARGB_8888, false)` (the un-polluted snapshot so
   * overlapping bubbles never sample a previously filled bubble).
   */
  bake(_base: unknown, _regions: ReadonlyArray<readonly [BubbleRegion, string]>, _textScale: number): never {
    throw new MangaTranslateUnsupportedError(
      'BubblePipeline.bake',
      'canvas-rendering',
      '需要 android.graphics.Canvas / Paint / StaticLayout 烘焙译文',
    );
  },

  /**
   * Kotlin lines 213..256 — 气泡内文字安全矩形.
   *
   * R20-audit: the whole function is now implemented ({@link insetTextBoundsFromContour});
   * it was previously a stub on the grounds that rasterising a `Path` needs Canvas. A
   * `Path` produced by {@link contourToPagePoints} is a closed polygon, so the
   * rasterisation is a scanline fill over an injected point list — pure JS.
   */
  insetTextBounds(contour: readonly number[], pageW: number, pageH: number): RectF {
    return insetTextBoundsFromContour(contour, pageW, pageH);
  },

  /** Kotlin line 218: `val fallbackPad = (min(w, h) * 0.08f).coerceAtLeast(6f)`. */
  insetFallbackPad,

  /** Kotlin lines 225..226: `maskW`/`maskH` = `toInt().coerceIn(16, 96)`. */
  insetMaskSize,

  /** Axis-aligned bounds of a normalised contour in page pixels. */
  contourPageBounds,

  /** Kotlin lines 227..241 — the ≤96 px even-odd rasterisation. */
  rasterizeContourMask,

  /** Kotlin lines 244..255 — the post-rasterisation half. */
  insetFromLargestRect,
};

export type { TextBlockGroup };