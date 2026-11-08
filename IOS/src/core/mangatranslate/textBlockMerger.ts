/**
 * Text-line → text-block merging — port of Android
 * `novel-reader/app/src/main/java/com/example/mangatranslate/TextBlockMerger.kt`
 * (499 lines total, 451 non-blank).
 *
 * SCOPE: manga translation is deliberately excluded from the iOS port (see `index.ts`).
 * This file is **entirely pure rect geometry** — no ONNX, no Bitmap pixels, no Canvas
 * drawing — so it is ported in full. (`RectF` is four floats; `Float` arithmetic maps to
 * JS doubles.)
 *
 * Line map (Kotlin line → TS):
 *   1..12    package + imports (`android.graphics.RectF`, `kotlin.math.{abs,max,min}`)
 *            → no imports; `RectF` from `./index`.
 *   13..18   KDoc `文字行 → 文本块合并（第十九轮，完整复刻
 *            jedzqer/manga-translator-android detection/TextBlockMerger.kt,
 *            MIT License, Copyright (c) 2026 jedzqer）。`
 *            `合并评分针对整个候选组评估，避免一串各自接近的对角线框链式长成一个块。`
 *            → kept verbatim on {@link TextBlockMerger}.
 *   19..21   `enum class TextLineOrientation { HORIZONTAL, VERTICAL, AMBIGUOUS }` →
 *            {@link TextLineOrientation}.
 *   22..32   `data class TextBlock(rect, lines, orientation, maskContour)` with the custom
 *            `equals` (incl. `maskContour.contentEquals`) and `hashCode`
 *            (`rect.hashCode() * 31 + lines.size`) → {@link TextBlock}. The TS object
 *            identity is the structural equivalent of the Kotlin `equals`; `maskContour`
 *            stays a `number[]` so the structural `equals` is only about the fields the
 *            Android override compared.
 *   33..80   `object TextBlockMerger { fun merge(lineRects, imageWidth, imageHeight) }` →
 *            {@link TextBlockMerger}.merge. Preserved exactly: the
 *            `imageWidth <= 0 || imageHeight <= 0` early return, the
 *            dedupe → per-orientation bucket → `mergeOriented(horizontal)` +
 *            `mergeOriented(vertical)` + `ambiguous` → `absorbContainedSingletons` →
 *            `absorbAdjacentSingletons` → `mergeOverlappingGroups` pipeline, the
 *            `TextBlock(rect = group.bounds(), lines = sortedLines, …)` construction with
 *            `buildMaskContour`, and the final
 *            `suppressOverlappingBlocks(blocks).sortedWith(compareBy({ it.rect.top }, { it.rect.left }))`.
 *   81..96   `private fun suppressOverlappingBlocks(blocks)` — `compareByDescending { lines.size }
 *            .thenBy { rect.width()*rect.height() }` candidate ordering and the
 *            `intersectionOverSmaller(existing, candidate) >= BLOCK_OVERLAP_THRESHOLD`
 *            duplicate test → {@link suppressOverlappingBlocks} (exported for tests).
 *   97..107  `fun deduplicateLines(lineRects, imageWidth, imageHeight)` — public in Android,
 *            also public here (used by `PageRegionDetector`). Same
 *            `sortedWith(compareBy({ it.top }, { it.left }))` tail.
 *   108..130 `private fun mergeOriented(initial)` — the greedy best-pair loop with
 *            `bestScore = Float.NEGATIVE_INFINITY`, the `score > bestScore` tie rule and the
 *            `if (bestFirst < 0 || bestScore < MIN_MERGE_SCORE) break` termination →
 *            {@link mergeOriented} (exported for tests).
 *   131..186 `private fun mergeScore(first, second): Float?` — reproduced 1:1, including the
 *            `first.orientation != second.orientation → null`, the AMBIGUOUS `null`, the
 *            `sortedBy { primaryCenter }` re-order, the `median(...).coerceAtLeast(1f)`
 *            thickness, the `edgeSpread > MAX_EDGE_SPREAD_RATIO → null` gate, the
 *            `zipWithNext` neighbour stats, the two `any { … } → null` gates, the five
 *            weighted terms and their exact weights (3.5 / 3 / 1.5 / 1 / 5), and
 *            `spacingConsistency` only when `neighborStats.size >= 2` (else `0f`).
 *   187..193 `private fun spacingConsistency(distances, thickness)` → ported.
 *   194..213 `private fun absorbContainedSingletons(groups)` — the `while (changed)` loop
 *            with `minByOrNull { bounds.width()*bounds.height() }` and the `break` that
 *            restarts the sweep → ported.
 *   214..238 `private fun absorbAdjacentSingletons(groups)` — the
 *            `filter { orientation == }` + `mapNotNull { adjacentSingletonScore }` +
 *            `minByOrNull { it.second }?.first` chain → ported.
 *   239..266 `private fun adjacentSingletonScore(line, block): Float?` — ported, including
 *            the KDoc 「居中标题/首行常比下方行宽或窄…」 and the final
 *            `primaryGap + centerDistance * 0.15f`.
 *   267..285 `private fun mergeOverlappingGroups(groups)` — the `loop@ for` / `break@loop`
 *            restart → ported.
 *   286..310 `private fun shouldMergeOverlappingGroups(a, b)` → ported.
 *   311..328 `private fun deduplicateClampedLines(lines)` — `sortedByDescending { w*h }` and
 *            the larger-wins replacement → ported.
 *   329..337 `private fun orientationOf(rect)` — `ratio >= 1.35 → HORIZONTAL`,
 *            `ratio <= 1/1.35 → VERTICAL`, else AMBIGUOUS → ported, including
 *            `rect.height().coerceAtLeast(1f)`.
 *   338..374 `private fun buildMaskContour(lines, orientation, imageWidth, imageHeight)` —
 *            the two directional polygon walks (vertical: top edge left→right then reversed
 *            bottom edge right→left; horizontal: left edge then reversed right edge) and the
 *            `coerceIn(0f, 1f)` normalization → ported.
 *   375..384 `private fun RectF.clampTo(imageWidth, imageHeight): RectF?` — the four
 *            `coerceIn` clamps and the `width() >= MIN_LINE_SIZE && height() >= MIN_LINE_SIZE`
 *            rejection (MIN_LINE_SIZE = 2f) → ported.
 *   385..412 the eight `RectF` axis helpers (`primaryStart/End/Center/Thickness`,
 *            `crossCenter/Start/End/Size`, `leadingEdge`, `trailingEdge`) → ported as
 *            free functions taking `(rect, orientation)`.
 *   413..420 `private fun intersectionOverSmaller(first, second)` → ported.
 *   421..423 `private fun overlapLength(fStart, fEnd, sStart, sEnd)` → ported.
 *   424..427 `private fun containsRect(container, candidate)` → ported.
 *   428..430 `private fun spread(values) = maxOrNull ?: 0f - (minOrNull ?: 0f)` → ported.
 *   431..437 `private fun gapBetween(startA, endA, startB, endB)` → ported.
 *   438..448 `private fun median(values)` — the even/odd split preserved → ported.
 *   449..466 `private class LineGroup(lines: MutableList<RectF>, orientation)` with
 *            `bounds()` (minOf/maxOf over the four edges) and
 *            `sortedLines()` (`sortedBy { primaryCenter }.map(::RectF)` copy) → ported.
 *   467..473 `private data class NeighborStats(gapRatio, crossOverlapRatio, centerDistance,
 *            thicknessRatio)` → {@link NeighborStats}.
 *   474..498 the 25 tuning constants (`ORIENTATION_ASPECT_RATIO = 1.35f` …
 *            `OVERLAPPING_BLOCK_MIN_CROSS_RATIO = 0.12f`) → identical values, same names.
 *   499      `}` → end of object.
 *
 * Skipped lines and why: none. This file has no inference, no IO and no Android graphics
 * beyond `RectF`'s four floats.
 *
 * Kotlin `Float` is a 32-bit float; TS uses doubles. All inputs here are pixel coordinates
 * (integers in practice), so the difference is unobservable; it is noted rather than emulated.
 * Kotlin `sortedWith` is a stable sort; JS `Array.prototype.sort` is stable since ES2019.
 * `sortedBy { it.first }` on `(Int, ComicChapter)` pairs maps to sorting an
 * `{ index, chapter }` decoration array (see `pageRegionTiling.ts` for the same pattern).
 * No U+3000 in the Android file; Chinese comments are byte-identical.
 */

import { copyRect, type RectF, rectF, rectHeight, rectWidth } from './index';

/** Kotlin lines 14..18. */
export enum TextLineOrientation {
  HORIZONTAL = 'HORIZONTAL',
  VERTICAL = 'VERTICAL',
  AMBIGUOUS = 'AMBIGUOUS',
}

/** Kotlin lines 20..30. */
export interface TextBlock {
  rect: RectF;
  lines: RectF[];
  orientation: TextLineOrientation;
  maskContour: number[];
}

/** Kotlin lines 467..473. */
interface NeighborStats {
  gapRatio: number;
  crossOverlapRatio: number;
  centerDistance: number;
  thicknessRatio: number;
}

/** Kotlin lines 449..466. */
class LineGroup {
  constructor(
    readonly lines: RectF[],
    readonly orientation: TextLineOrientation,
  ) {}

  bounds(): RectF {
    return rectF(
      Math.min(...this.lines.map((l) => l.left)),
      Math.min(...this.lines.map((l) => l.top)),
      Math.max(...this.lines.map((l) => l.right)),
      Math.max(...this.lines.map((l) => l.bottom)),
    );
  }

  sortedLines(): RectF[] {
    return this.lines
      .slice()
      .sort((a, b) => primaryCenter(a, this.orientation) - primaryCenter(b, this.orientation))
      .map(copyRect);
  }
}

const coerceIn = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/* ── Kotlin lines 474..498, verbatim ── */
const ORIENTATION_ASPECT_RATIO = 1.35;
const MIN_LINE_SIZE = 2;
const DUPLICATE_OVERLAP_THRESHOLD = 0.72;
const BLOCK_OVERLAP_THRESHOLD = 0.55;
const MAX_EDGE_SPREAD_RATIO = 1.15;
const MAX_GAP_RATIO = 1.8;
const MIN_CROSS_OVERLAP_RATIO = 0.3;
const SPACING_TOLERANCE_RATIO = 0.22;
const SPACING_TOLERANCE_THICKNESS = 0.55;
const ALIGNMENT_WEIGHT = 3.5;
const CONNECTION_WEIGHT = 3;
const OVERLAP_WEIGHT = 1.5;
const THICKNESS_WEIGHT = 1;
const SPACING_WEIGHT = 5;
const MIN_MERGE_SCORE = 5.4;
const ADJACENT_MAX_GAP_RATIO = 2.2;
const ADJACENT_MAX_GAP_PAD = 12;
const ADJACENT_MIN_CROSS_OVERLAP_RATIO = 0.1;
const ADJACENT_MAX_CENTER_DISTANCE_RATIO = 0.45;
const ADJACENT_MAX_CENTER_DISTANCE_PAD = 36;
const OVERLAPPING_BLOCK_MIN_RATIO = 0.2;
const OVERLAPPING_BLOCK_MAX_GAP_RATIO = 2.5;
const OVERLAPPING_BLOCK_MAX_GAP_PAD = 20;
const OVERLAPPING_BLOCK_MIN_CROSS_RATIO = 0.12;

/* ── Kotlin lines 376..412 — RectF axis helpers ── */

function primaryStart(r: RectF, o: TextLineOrientation): number {
  return o === TextLineOrientation.HORIZONTAL ? r.top : r.left;
}
function primaryEnd(r: RectF, o: TextLineOrientation): number {
  return o === TextLineOrientation.HORIZONTAL ? r.bottom : r.right;
}
function primaryCenter(r: RectF, o: TextLineOrientation): number {
  return (primaryStart(r, o) + primaryEnd(r, o)) / 2;
}
function primaryThickness(r: RectF, o: TextLineOrientation): number {
  return o === TextLineOrientation.HORIZONTAL ? rectHeight(r) : rectWidth(r);
}
function crossCenter(r: RectF, o: TextLineOrientation): number {
  return (crossStart(r, o) + crossEnd(r, o)) / 2;
}
function crossStart(r: RectF, o: TextLineOrientation): number {
  return o === TextLineOrientation.HORIZONTAL ? r.left : r.top;
}
function crossEnd(r: RectF, o: TextLineOrientation): number {
  return o === TextLineOrientation.HORIZONTAL ? r.right : r.bottom;
}
function crossSize(r: RectF, o: TextLineOrientation): number {
  return crossEnd(r, o) - crossStart(r, o);
}
function leadingEdge(r: RectF, o: TextLineOrientation): number {
  return crossStart(r, o);
}
function trailingEdge(r: RectF, o: TextLineOrientation): number {
  return crossEnd(r, o);
}

/* ── Kotlin lines 413..448 — geometry helpers ── */

function intersectionOverSmaller(first: RectF, second: RectF): number {
  const intersectionWidth = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const intersectionHeight = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  const intersection = intersectionWidth * intersectionHeight;
  const smaller = Math.min(rectWidth(first) * rectHeight(first), rectWidth(second) * rectHeight(second));
  return smaller <= 0 ? 0 : intersection / smaller;
}

function overlapLength(fStart: number, fEnd: number, sStart: number, sEnd: number): number {
  return Math.max(0, Math.min(fEnd, sEnd) - Math.max(fStart, sStart));
}

function containsRect(container: RectF, candidate: RectF): boolean {
  return (
    candidate.left >= container.left &&
    candidate.top >= container.top &&
    candidate.right <= container.right &&
    candidate.bottom <= container.bottom
  );
}

function spread(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

function gapBetween(startA: number, endA: number, startB: number, endB: number): number {
  if (endA < startB) return startB - endA;
  if (endB < startA) return startA - endB;
  return 0;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number);
}

/* ── Kotlin lines 329..337 ── */

function orientationOf(rect: RectF): TextLineOrientation {
  const ratio = rectWidth(rect) / Math.max(rectHeight(rect), 1);
  if (ratio >= ORIENTATION_ASPECT_RATIO) return TextLineOrientation.HORIZONTAL;
  if (ratio <= 1 / ORIENTATION_ASPECT_RATIO) return TextLineOrientation.VERTICAL;
  return TextLineOrientation.AMBIGUOUS;
}

/* ── Kotlin lines 375..384 ── */

function clampTo(r: RectF, imageWidth: number, imageHeight: number): RectF | null {
  const clamped = rectF(
    coerceIn(r.left, 0, imageWidth),
    coerceIn(r.top, 0, imageHeight),
    coerceIn(r.right, 0, imageWidth),
    coerceIn(r.bottom, 0, imageHeight),
  );
  return rectWidth(clamped) >= MIN_LINE_SIZE && rectHeight(clamped) >= MIN_LINE_SIZE
    ? clamped
    : null;
}

/* ── Kotlin lines 311..328 ── */

function deduplicateClampedLines(lines: readonly RectF[]): RectF[] {
  const kept: RectF[] = [];
  const sorted = lines
    .slice()
    .sort((a, b) => rectWidth(b) * rectHeight(b) - (rectWidth(a) * rectHeight(a)));
  for (const candidate of sorted) {
    const duplicateIndex = kept.findIndex(
      (existing) => intersectionOverSmaller(existing, candidate) >= DUPLICATE_OVERLAP_THRESHOLD,
    );
    if (duplicateIndex < 0) {
      kept.push(copyRect(candidate));
    } else {
      const existing = kept[duplicateIndex] as RectF;
      if (rectWidth(candidate) * rectHeight(candidate) > rectWidth(existing) * rectHeight(existing)) {
        kept[duplicateIndex] = copyRect(candidate);
      }
    }
  }
  return kept;
}

/* ── Kotlin lines 131..193 ── */

function mergeScore(first: LineGroup, second: LineGroup): number | null {
  if (first.orientation !== second.orientation) return null;
  const orientation = first.orientation;
  if (orientation === TextLineOrientation.AMBIGUOUS) return null;
  const lines = first.lines
    .concat(second.lines)
    .sort((a, b) => primaryCenter(a, orientation) - primaryCenter(b, orientation));
  const thickness = Math.max(
    median(lines.map((l) => primaryThickness(l, orientation))),
    1,
  );

  const leadingSpread = spread(lines.map((l) => leadingEdge(l, orientation))) / thickness;
  const trailingSpread = spread(lines.map((l) => trailingEdge(l, orientation))) / thickness;
  const edgeSpread = Math.min(leadingSpread, trailingSpread);
  if (edgeSpread > MAX_EDGE_SPREAD_RATIO) return null;

  const neighborStats: NeighborStats[] = [];
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const current = lines[i] as RectF;
    const next = lines[i + 1] as RectF;
    const gap = Math.max(0, primaryStart(next, orientation) - primaryEnd(current, orientation));
    const overlap = overlapLength(
      crossStart(current, orientation),
      crossEnd(current, orientation),
      crossStart(next, orientation),
      crossEnd(next, orientation),
    );
    const minCrossSize = Math.max(
      Math.min(crossSize(current, orientation), crossSize(next, orientation)),
      1,
    );
    neighborStats.push({
      gapRatio: gap / thickness,
      crossOverlapRatio: overlap / minCrossSize,
      centerDistance: primaryCenter(next, orientation) - primaryCenter(current, orientation),
      thicknessRatio:
        Math.min(primaryThickness(current, orientation), primaryThickness(next, orientation)) /
        Math.max(Math.max(primaryThickness(current, orientation), primaryThickness(next, orientation)), 1),
    });
  }
  if (neighborStats.some((s) => s.gapRatio > MAX_GAP_RATIO)) return null;
  if (neighborStats.some((s) => s.crossOverlapRatio < MIN_CROSS_OVERLAP_RATIO)) return null;

  const alignmentScore = 1 - edgeSpread / MAX_EDGE_SPREAD_RATIO;
  const connectionScore = 1 - Math.max(...neighborStats.map((s) => s.gapRatio)) / MAX_GAP_RATIO;
  const overlapScore = coerceIn(Math.min(...neighborStats.map((s) => s.crossOverlapRatio)), 0, 1);
  const thicknessScore = coerceIn(Math.min(...neighborStats.map((s) => s.thicknessRatio)), 0, 1);
  const spacingScore =
    neighborStats.length >= 2
      ? spacingConsistency(
          neighborStats.map((s) => s.centerDistance),
          thickness,
        )
      : 0;
  return (
    ALIGNMENT_WEIGHT * alignmentScore +
    CONNECTION_WEIGHT * connectionScore +
    OVERLAP_WEIGHT * overlapScore +
    THICKNESS_WEIGHT * thicknessScore +
    SPACING_WEIGHT * spacingScore
  );
}

function spacingConsistency(distances: readonly number[], thickness: number): number {
  const typical = Math.max(median(distances), 1);
  const maxDeviation = Math.max(...distances.map((d) => Math.abs(d - typical)));
  const allowedDeviation = Math.max(
    thickness * SPACING_TOLERANCE_THICKNESS,
    typical * SPACING_TOLERANCE_RATIO,
  );
  return coerceIn(1 - maxDeviation / Math.max(allowedDeviation, 1), 0, 1);
}

/* ── Kotlin lines 108..130 ── */

function mergeOriented(initial: readonly LineGroup[]): LineGroup[] {
  const groups = initial.slice();
  while (groups.length > 1) {
    let bestFirst = -1;
    let bestSecond = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let first = 0; first < groups.length - 1; first += 1) {
      for (let second = first + 1; second < groups.length; second += 1) {
        const score = mergeScore(groups[first] as LineGroup, groups[second] as LineGroup);
        if (score === null) continue;
        if (score > bestScore) {
          bestScore = score;
          bestFirst = first;
          bestSecond = second;
        }
      }
    }
    if (bestFirst < 0 || bestScore < MIN_MERGE_SCORE) break;
    (groups[bestFirst] as LineGroup).lines.push(...(groups[bestSecond] as LineGroup).lines);
    groups.splice(bestSecond, 1);
  }
  return groups;
}

/* ── Kotlin lines 194..238 ── */

function absorbContainedSingletons(groups: LineGroup[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    const blocks = groups.filter((g) => g.lines.length >= 2);
    const singletons = groups.filter((g) => g.lines.length === 1);
    for (const singleton of singletons) {
      const line = singleton.lines[0] as RectF;
      let owner: LineGroup | undefined;
      let ownerArea = Number.POSITIVE_INFINITY;
      for (const block of blocks) {
        const b = block.bounds();
        if (!containsRect(b, line)) continue;
        const area = rectWidth(b) * rectHeight(b);
        if (area < ownerArea) {
          owner = block;
          ownerArea = area;
        }
      }
      if (owner === undefined) continue;
      owner.lines.push(line);
      groups.splice(groups.indexOf(singleton), 1);
      changed = true;
      break;
    }
  }
}

/** 居中标题/首行常比下方行宽或窄，矩形不完全包含于块内；主轴间距与交叉轴重叠仍识别为一段时吸附。 */
function absorbAdjacentSingletons(groups: LineGroup[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    const blocks = groups.filter((g) => g.lines.length >= 2);
    const singletons = groups.filter((g) => g.lines.length === 1);
    for (const singleton of singletons) {
      const line = singleton.lines[0] as RectF;
      let owner: LineGroup | undefined;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const block of blocks) {
        if (block.orientation !== singleton.orientation) continue;
        const score = adjacentSingletonScore(line, block);
        if (score === null) continue;
        if (score < bestScore) {
          bestScore = score;
          owner = block;
        }
      }
      if (owner === undefined) continue;
      owner.lines.push(line);
      groups.splice(groups.indexOf(singleton), 1);
      changed = true;
      break;
    }
  }
}

function adjacentSingletonScore(line: RectF, block: LineGroup): number | null {
  if (block.orientation === TextLineOrientation.AMBIGUOUS) return null;
  const orientation = block.orientation;
  const blockBounds = block.bounds();
  let primaryGap: number;
  if (orientation === TextLineOrientation.HORIZONTAL) {
    primaryGap = gapBetween(line.top, line.bottom, blockBounds.top, blockBounds.bottom);
  } else if (orientation === TextLineOrientation.VERTICAL) {
    primaryGap = gapBetween(line.left, line.right, blockBounds.left, blockBounds.right);
  } else {
    return null;
  }
  const lineThickness = Math.max(primaryThickness(line, orientation), 1);
  const blockThickness = Math.max(
    median(block.lines.map((l) => primaryThickness(l, orientation))),
    1,
  );
  if (primaryGap > Math.max(lineThickness, blockThickness) * ADJACENT_MAX_GAP_RATIO + ADJACENT_MAX_GAP_PAD) {
    return null;
  }
  const overlap = overlapLength(
    crossStart(line, orientation),
    crossEnd(line, orientation),
    crossStart(blockBounds, orientation),
    crossEnd(blockBounds, orientation),
  );
  const minCross = Math.max(
    Math.min(crossSize(line, orientation), crossSize(blockBounds, orientation)),
    1,
  );
  if (overlap / minCross < ADJACENT_MIN_CROSS_OVERLAP_RATIO) return null;
  const centerDistance = Math.abs(crossCenter(line, orientation) - crossCenter(blockBounds, orientation));
  const maxCross = Math.max(
    Math.max(crossSize(line, orientation), crossSize(blockBounds, orientation)),
    1,
  );
  if (
    centerDistance >
    maxCross * ADJACENT_MAX_CENTER_DISTANCE_RATIO + ADJACENT_MAX_CENTER_DISTANCE_PAD
  ) {
    return null;
  }
  return primaryGap + centerDistance * 0.15;
}

/* ── Kotlin lines 267..310 ── */

/** 合并行分组后仍重复的块（常见于重叠的检测切片）。 */
function mergeOverlappingGroups(groups: LineGroup[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let first = 0; first < groups.length - 1; first += 1) {
      for (let second = first + 1; second < groups.length; second += 1) {
        const a = groups[first] as LineGroup;
        const b = groups[second] as LineGroup;
        if (!shouldMergeOverlappingGroups(a, b)) continue;
        a.lines.push(...b.lines);
        groups.splice(second, 1);
        changed = true;
        break outer;
      }
    }
  }
}

function shouldMergeOverlappingGroups(a: LineGroup, b: LineGroup): boolean {
  if (a.orientation !== b.orientation || a.orientation === TextLineOrientation.AMBIGUOUS) return false;
  const first = a.bounds();
  const second = b.bounds();
  const intersection = intersectionOverSmaller(first, second);
  if (intersection < OVERLAPPING_BLOCK_MIN_RATIO) return false;
  const orientation = a.orientation;
  let primaryGap: number;
  if (orientation === TextLineOrientation.HORIZONTAL) {
    primaryGap = gapBetween(first.top, first.bottom, second.top, second.bottom);
  } else if (orientation === TextLineOrientation.VERTICAL) {
    primaryGap = gapBetween(first.left, first.right, second.left, second.right);
  } else {
    return false;
  }
  const thickness = Math.max(
    median(a.lines.map((l) => primaryThickness(l, orientation))),
    median(b.lines.map((l) => primaryThickness(l, orientation))),
    1,
  );
  if (primaryGap > thickness * OVERLAPPING_BLOCK_MAX_GAP_RATIO + OVERLAPPING_BLOCK_MAX_GAP_PAD) return false;
  const crossOverlap = overlapLength(
    crossStart(first, orientation),
    crossEnd(first, orientation),
    crossStart(second, orientation),
    crossEnd(second, orientation),
  );
  const minCross = Math.max(Math.min(crossSize(first, orientation), crossSize(second, orientation)), 1);
  return crossOverlap / minCross >= OVERLAPPING_BLOCK_MIN_CROSS_RATIO;
}

/* ── Kotlin lines 338..374 ── */

/**
 * 页面归一化多边形：连接每条文字行的原始角点。横排块描左右边，竖排块描上下边。
 */
function buildMaskContour(
  lines: readonly RectF[],
  orientation: TextLineOrientation,
  imageWidth: number,
  imageHeight: number,
): number[] {
  const points: number[] = [];
  const addPoint = (x: number, y: number): void => {
    points.push(coerceIn(x / imageWidth, 0, 1), coerceIn(y / imageHeight, 0, 1));
  };

  if (orientation === TextLineOrientation.VERTICAL) {
    for (const line of lines) {
      addPoint(line.left, line.top);
      addPoint(line.right, line.top);
    }
    for (const line of lines.slice().reverse()) {
      addPoint(line.right, line.bottom);
      addPoint(line.left, line.bottom);
    }
  } else {
    for (const line of lines) {
      addPoint(line.left, line.top);
      addPoint(line.left, line.bottom);
    }
    for (const line of lines.slice().reverse()) {
      addPoint(line.right, line.bottom);
      addPoint(line.right, line.top);
    }
  }
  return points;
}

/* ── Kotlin lines 81..107 ── */

/** 切片推理可能留下两个覆盖同一段文字的独立块；保留覆盖面积更大者。 */
function suppressOverlappingBlocks(blocks: readonly TextBlock[]): TextBlock[] {
  if (blocks.length <= 1) return [...blocks];
  const kept: TextBlock[] = [];
  const candidates = blocks
    .slice()
    .sort((a, b) => {
      if (a.lines.length !== b.lines.length) return b.lines.length - a.lines.length;
      const aa = rectWidth(a.rect) * rectHeight(a.rect);
      const bb = rectWidth(b.rect) * rectHeight(b.rect);
      return aa - bb;
    });
  for (const candidate of candidates) {
    const isDuplicate = kept.some(
      (existing) => intersectionOverSmaller(existing.rect, candidate.rect) >= BLOCK_OVERLAP_THRESHOLD,
    );
    if (!isDuplicate) kept.push(candidate);
  }
  return kept;
}

/** Kotlin `sortedWith(compareBy({ it.top }, { it.left }))` over plain `RectF`. */
function sortRectsByTopLeft(rects: readonly RectF[]): RectF[] {
  return rects.slice().sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    return a.left - b.left;
  });
}

/** Same comparator applied to `TextBlock.rect` (Kotlin line 78). */
function sortBlocksByTopLeft(blocks: readonly TextBlock[]): TextBlock[] {
  return blocks.slice().sort((a, b) => {
    if (a.rect.top !== b.rect.top) return a.rect.top - b.rect.top;
    return a.rect.left - b.rect.left;
  });
}

/** Kotlin lines 97..107 — public on Android; also consumed by `PageRegionDetector`. */
function deduplicateLines(
  lineRects: readonly RectF[],
  imageWidth: number,
  imageHeight: number,
): RectF[] {
  if (imageWidth <= 0 || imageHeight <= 0) return [];
  const clamped = lineRects
    .map((r) => clampTo(r, imageWidth, imageHeight))
    .filter((r): r is RectF => r !== null);
  return sortRectsByTopLeft(deduplicateClampedLines(clamped));
}

/**
 * 文字行 → 文本块合并（第十九轮，完整复刻 jedzqer/manga-translator-android
 * detection/TextBlockMerger.kt，MIT License, Copyright (c) 2026 jedzqer）。
 *
 * 合并评分针对整个候选组评估，避免一串各自接近的对角线框链式长成一个块。
 */
export const TextBlockMerger = {
  /** Kotlin lines 33..80. */
  merge(lineRects: readonly RectF[], imageWidth: number, imageHeight: number): TextBlock[] {
    if (imageWidth <= 0 || imageHeight <= 0) return [];
    const lines = deduplicateLines(lineRects, imageWidth, imageHeight);
    if (lines.length === 0) return [];

    const horizontal: LineGroup[] = [];
    const vertical: LineGroup[] = [];
    const ambiguous: LineGroup[] = [];
    for (const rect of lines) {
      const group = new LineGroup([rect], orientationOf(rect));
      if (group.orientation === TextLineOrientation.HORIZONTAL) horizontal.push(group);
      else if (group.orientation === TextLineOrientation.VERTICAL) vertical.push(group);
      else ambiguous.push(group);
    }

    const groups: LineGroup[] = [
      ...mergeOriented(horizontal),
      ...mergeOriented(vertical),
      ...ambiguous,
    ];
    absorbContainedSingletons(groups);
    absorbAdjacentSingletons(groups);
    mergeOverlappingGroups(groups);

    const blocks: TextBlock[] = groups.map((group) => {
      const sortedLines = group.sortedLines();
      return {
        rect: group.bounds(),
        lines: sortedLines,
        orientation: group.orientation,
        maskContour: buildMaskContour(sortedLines, group.orientation, imageWidth, imageHeight),
      };
    });
    return sortBlocksByTopLeft(suppressOverlappingBlocks(blocks));
  },

  /** Kotlin lines 97..107. */
  deduplicateLines,

  /** Kotlin lines 81..96. */
  suppressOverlappingBlocks,

  /** Kotlin lines 108..130. */
  mergeOriented,

  /** Kotlin lines 329..337. */
  orientationOf,

  /** Kotlin lines 338..374. */
  buildMaskContour,

  /** Kotlin lines 438..448. */
  median,

  /** Kotlin lines 413..420. */
  intersectionOverSmaller,

  /** Kotlin lines 187..193. */
  spacingConsistency,
};