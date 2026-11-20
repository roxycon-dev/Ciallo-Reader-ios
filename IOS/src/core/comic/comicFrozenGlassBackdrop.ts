/**
 * `ui/comic/ComicFrozenGlassBackdrop.kt`（89 行 / 78 非空）→ `@core/comic/comicFrozenGlassBackdrop`。
 *
 * 为什么值得单独一个模块：Kotlin 的那个 `Backdrop` 实现里，**除了 `drawRect` /
 * `drawImage` 两个绘制调用之外，全是可判定的数值与几何** ——
 * 五档背景色、RTL 反转、槽宽与间距、双页对齐、位移、纸张纹理的等比铺满与居中。
 * 端口此前只有 `parityMisc.ts` L246-249 的两行常量
 * `rememberComicGlassBackdrop = { blurRadiusDp: 24, surfaceAlpha: 0.78 }` ——
 * 那两个数**在 Kotlin 原文里一个都没有**（原文既没有 24，也没有 0.78），
 * 属于纯造出来的「占位常量」（E199）。
 *
 * 行映射
 * ──────
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `ordered = if (RTL) slots.reversed() else slots` | L32 | `orderedSlotsForDirection()` |
 * | 五档 `background` 的 `when` | L49-55 | `COMIC_BG_COLORS` + `frozenGlassBackgroundColor()` |
 * | 纸张等比铺满 + 居中 + `coerceAtLeast(1)` | L58-63 | `paperPlacement()` |
 * | `if (bitmaps.isEmpty()) return@withTransform` | L65 | `frozenGlassSlots([])` → `[]` |
 * | `gap = if (size > 1) doubleGapDp.dp.toPx() else 0f` | L66 | `frozenGlassGapPx()` |
 * | `width = ((vw - gap*(n-1)) / n).coerceAtLeast(1f)` | L67 | `frozenGlassSlotWidth()` |
 * | `fittedSize(...)` + 对齐 + 位移 + `clipRect` + `dstOffset/dstSize` | L70-83 | `frozenGlassSlots()` |
 *
 * 三处只有读原文才会发现的语义
 * ─────────────────────────────
 * 1. **`gap` 与 `shiftX/shiftY` 只在「多于一张图」时非零**（L66 / L78-79），
 *    单页时它们必须是 0 而不是「配置里写的值」——否则单页会被 `doubleGapDp` 挤偏。
 * 2. **单页的纵向对齐恒为居中**（L73 `if (bitmaps.size == 1) (vh - h) / 2f else when (align) …`），
 *    与 `doubleAlign` 无关。写死成「按 align」会让单页在 TOP 配置下贴顶。
 * 3. **纸张纹理是「等比铺满 + 居中裁切」**：`scale = max(vw/pw, vh/ph)`（取**大**的那个，
 *    所以一定盖满），再居中、再 `roundToInt().coerceAtLeast(1)`。取 `min` 会留白边。
 *
 * 平台差异
 * ────────
 * - `Backdrop.drawBackdrop` / `DrawScope` / `IntOffset` / `IntSize` 是 Compose-Skia 的绘制 API；
 *   这里只产出**绘制计划**（`clip` 矩形 + `dstOffset` + `dstSize`），由
 *   `src/ui/components/comic/*` 落到 `<img>` / `<canvas>` 上。
 * - `rememberPageBitmap` / `asImageBitmap` 是位图生命周期，属平台层；本模块只吃
 *   「每页的位图尺寸」。
 * - `coordinates.positionInWindow() - viewport.topLeft` 是窗口坐标系平移；Web 侧由
 *   `getBoundingClientRect()` 承担，本模块只接收已算好的 `offset`。
 */

/** `ComicBgType` 的五个取值（`ComicReaderConfig.kt`）。 */
export type ComicBgType = 'BLACK' | 'WHITE' | 'GRAY' | 'PAPER' | 'DYNAMIC';

/** L49-55 的五档背景色（含 DYNAMIC 的兜底色）。 */
export const COMIC_BG_COLORS = {
  BLACK: '#000000', // L50 Color.Black
  WHITE: '#F7F7F5', // L51 Color(0xFFF7F7F5)
  GRAY: '#232326', // L52 Color(0xFF232326)
  PAPER: '#F3ECDF', // L53 Color(0xFFF3ECDF)
  DYNAMIC_FALLBACK: '#101014', // L54 `dynamicColor ?: Color(0xFF101014)`
} as const;

/**
 * L49-55：
 * ```
 * val background = when (config.bgType) {
 *     BLACK -> Color.Black; WHITE -> Color(0xFFF7F7F5); GRAY -> Color(0xFF232326)
 *     PAPER -> Color(0xFFF3ECDF); DYNAMIC -> dynamicColor ?: Color(0xFF101014)
 * }
 * ```
 * 注意 DYNAMIC 档在**没有**取到主色时用 `#101014`，而不是黑。
 */
export function frozenGlassBackgroundColor(bgType: ComicBgType, dynamicColor?: string | null): string {
  switch (bgType) {
    case 'BLACK':
      return COMIC_BG_COLORS.BLACK;
    case 'WHITE':
      return COMIC_BG_COLORS.WHITE;
    case 'GRAY':
      return COMIC_BG_COLORS.GRAY;
    case 'PAPER':
      return COMIC_BG_COLORS.PAPER;
    case 'DYNAMIC':
      return dynamicColor ?? COMIC_BG_COLORS.DYNAMIC_FALLBACK;
  }
}

/** L32 `val ordered = if (config.direction == ComicDirection.RTL) slots.reversed() else slots`。 */
export function orderedSlotsForDirection<T>(slots: readonly T[], direction: 'LTR' | 'RTL' | 'TTB'): readonly T[] {
  return direction === 'RTL' ? [...slots].reverse() : slots;
}

/** L66 `val gap = if (bitmaps.size > 1) config.doubleGapDp.dp.toPx() else 0f`。 */
export function frozenGlassGapPx(count: number, doubleGapPx: number): number {
  return count > 1 ? doubleGapPx : 0;
}

/** L67 `val width = ((viewportSize.width - gap * (bitmaps.size - 1)) / bitmaps.size).coerceAtLeast(1f)`。 */
export function frozenGlassSlotWidth(viewportWidth: number, gapPx: number, count: number): number {
  if (count <= 0) return 1;
  return Math.max((viewportWidth - gapPx * (count - 1)) / count, 1);
}

/** L73-77 的纵向落点：单页恒居中，双页按 `doubleAlign`。 */
export function frozenGlassSlotTop(
  viewportHeight: number,
  fittedHeight: number,
  count: number,
  align: 'TOP' | 'CENTER' | 'BOTTOM',
): number {
  if (count === 1) return (viewportHeight - fittedHeight) / 2;
  switch (align) {
    case 'TOP':
      return 0;
    case 'CENTER':
      return (viewportHeight - fittedHeight) / 2;
    case 'BOTTOM':
      return viewportHeight - fittedHeight;
  }
}

/** 一页在背板上的落点。 */
export interface FrozenGlassSlotPlacement {
  /** L80 `clipRect(left, 0f, left + width, viewportSize.height)` 的四个边界。 */
  readonly clip: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  /** L81-82 `dstOffset = IntOffset(x.roundToInt(), y.roundToInt())`。 */
  readonly dstOffset: { readonly x: number; readonly y: number };
  /** L82 `dstSize = IntSize(w.roundToInt().coerceAtLeast(1), h.roundToInt().coerceAtLeast(1))`。 */
  readonly dstSize: { readonly width: number; readonly height: number };
}

export interface FrozenGlassInput {
  /** 已按方向排好序的每页「适配后尺寸」（`fittedSize()` 的产物，px）。 */
  readonly fitted: readonly { readonly width: number; readonly height: number }[];
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /** L66：`config.doubleGapDp.dp.toPx()`。 */
  readonly doubleGapPx: number;
  /** L73：`config.doubleAlign`。 */
  readonly align: 'TOP' | 'CENTER' | 'BOTTOM';
  /** L78-79：`config.doubleShiftXDp/YDp` 的 px 值（只在多于一页时生效）。 */
  readonly doubleShiftXPx: number;
  readonly doubleShiftYPx: number;
}

/**
 * L65-84 的整套槽位几何。空输入直接返回 `[]`（L65 的早退）。
 *
 * 注意 `fitted` 里保留 `null` 表示「这一页的位图还没加载好」—— Kotlin L69
 * `bitmap ?: return@forEachIndexed` 只是**跳过这一页**，不改变 `width` / `left` 的分配
 * （因为 `width` 是按 `bitmaps.size` 算的，含未加载页）。所以这里的入参用
 * `(Fitted|null)[]`，`null` 位不产出落点但**参与** count。
 */
export function frozenGlassSlots(
  input: FrozenGlassInput,
  fitted: readonly ({ readonly width: number; readonly height: number } | null)[],
): readonly FrozenGlassSlotPlacement[] {
  const count = fitted.length;
  if (count === 0) return [];
  const gap = frozenGlassGapPx(count, input.doubleGapPx);
  const width = frozenGlassSlotWidth(input.viewportWidth, gap, count);
  const shiftX = count > 1 ? input.doubleShiftXPx : 0;
  const shiftY = count > 1 ? input.doubleShiftYPx : 0;
  const out: FrozenGlassSlotPlacement[] = [];
  fitted.forEach((size, index) => {
    if (size === null) return;
    const left = index * (width + gap);
    const top = frozenGlassSlotTop(input.viewportHeight, size.height, count, input.align);
    out.push({
      clip: { left, top: 0, right: left + width, bottom: input.viewportHeight },
      dstOffset: {
        x: Math.round(left + (width - size.width) / 2 + shiftX),
        y: Math.round(top + shiftY),
      },
      dstSize: {
        width: Math.max(Math.round(size.width), 1),
        height: Math.max(Math.round(size.height), 1),
      },
    });
  });
  return out;
}

/** 纸张纹理的落点（L58-63）。 */
export interface PaperPlacement {
  readonly dstOffset: { readonly x: number; readonly y: number };
  readonly dstSize: { readonly width: number; readonly height: number };
}

/**
 * L58-63：
 * ```
 * val scale = maxOf(vw / paper.width, vh / paper.height)   // 取**大**者 → 一定盖满
 * val w = paper.width * scale; val h = paper.height * scale
 * clipRect(0, 0, vw, vh) {
 *     drawImage(paper, dstOffset = IntOffset(((vw - w) / 2).roundToInt(), ((vh - h) / 2).roundToInt()),
 *               dstSize = IntSize(w.roundToInt().coerceAtLeast(1), h.roundToInt().coerceAtLeast(1)))
 * }
 * ```
 * 纸张尺寸非法（0 或负）时返回 `null` —— Kotlin 那边会除以 0 得到 `Infinity`，
 * 这里不给一个 `NaN` 尺寸的绘制指令。
 */
export function paperPlacement(
  paperWidth: number,
  paperHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): PaperPlacement | null {
  if (!(paperWidth > 0) || !(paperHeight > 0)) return null;
  const scale = Math.max(viewportWidth / paperWidth, viewportHeight / paperHeight);
  const w = paperWidth * scale;
  const h = paperHeight * scale;
  return {
    dstOffset: { x: Math.round((viewportWidth - w) / 2), y: Math.round((viewportHeight - h) / 2) },
    dstSize: { width: Math.max(Math.round(w), 1), height: Math.max(Math.round(h), 1) },
  };
}
