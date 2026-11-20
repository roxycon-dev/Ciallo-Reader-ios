/**
 * 翻页效果小预览 —— `ui/components/SettingsControls.kt` L324-465 `PageTurnPreview` 的几何移植。
 *
 * 设置页「翻页动画」五行各有一个 40×54dp 的迷你纸页，用**该效果自己的缓动**把一张纸
 * 从起始帧翻到结束帧；未选中的行定格在 `p = 0.55`（每种效果最具辨识度的相位）。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L360      `Canvas(modifier.size(width = 40.dp, height = 54.dp))`            → `PAGE_TURN_PREVIEW_SIZE`
 *   L366-371  纸面 `CornerRadius(6f)` + 描边 `1.dp`                             → `pageSurface()`
 *   L373-383  `drawLines(alpha, xShift, color)`：4 行、`lineW = w - 12 - (i==3 ? w*.28 : 0)`、
 *             `topLeft(6, 8 + i*(h-16)/4)`、`Size(lineW, 3f)`、圆角 1.5         → `previewLines()`
 *   L341-347  每型自己的缓动（SIMULATE 是纸张阻尼曲线，SLIDE/SCROLL 线性）      → `PAGE_TURN_PREVIEW_EASING`
 *   L352      `if (dimmed) progress.snapTo(0.55f)`                              → `PAGE_TURN_PREVIEW_DIM_PHASE`
 *   L357      `progress.animateTo(1f, tween(520, easing = easing))`             → `PAGE_TURN_PREVIEW_MS`
 *   L386-413  SIMULATE：行左移 `3p`、折角 `w*.62*p`、折痕暗带 `alpha .16p`、
 *             纸缘高光 `white alpha .55p` 宽 1.5                              → `simulatePreview()`
 *   L414-429  COVER：`sheetX = w*(1-p)`，暗带 7px（`alpha .22`，`startX=sheetX-5`）
 *                                                                              → `coverPreview()`
 *   L430-436  SLIDE：`-w*.85*p` 出、`w*(1-p)*.9` 入（第二层 `alpha .45`）       → `slidePreview()`
 *   L437-440  FADE：`1-p` / `p`，位移 `∓2p`                                     → `fadePreview()`
 *   L441-462  SCROLL：`gap=(h-16)/4`、`translate top = -p*gap*2.4`、6 行、
 *             滚动条 `(w-3, 6+p*(h-18))`、`2.5×10`、圆角 1.2                    → `scrollPreview()`
 *
 * 平台差异（`PARITY_EXCEPTIONS.md` **E143**）：Compose 的 `Canvas` + `DrawScope`
 * → Web 用 SVG / CSS transform；`Animatable + tween` → `Web Animations API`
 * （**时长与缓动逐值保留**；`FastOutSlowInEasing` → `cubic-bezier(.4,0,.2,1)`）。
 */

/** `L360` 的画布尺寸（dp）。 */
export const PAGE_TURN_PREVIEW_SIZE = { widthDp: 40, heightDp: 54 } as const;

/** `L352` 未选中行定格的相位。 */
export const PAGE_TURN_PREVIEW_DIM_PHASE = 0.55;

/** `L357` 单次试翻时长。 */
export const PAGE_TURN_PREVIEW_MS = 520;

/** 纸面与文字行的几何常量（`L366-383`）。 */
export const PAGE_TURN_PREVIEW_METRICS = {
  /** 纸面圆角 `CornerRadius(6f, 6f)`。 */
  surfaceCorner: 6,
  /** 描边 `1.dp.toPx()`（在 40×54 画布里按 px 处理）。 */
  strokeWidth: 1,
  /** 文字行左边距 `6f`。 */
  lineInsetX: 6,
  /** 文字行起始 y `8f`。 */
  lineInsetY: 8,
  /** 文字行高度 `3f`。 */
  lineHeight: 3,
  /** 文字行圆角 `1.5f`。 */
  lineCorner: 1.5,
  /** 行宽基数 `w - 12f` 里的 12。 */
  lineWidthInset: 12,
  /** 第四行（`i == 3`）短 `w * .28`。 */
  lastLineShortRatio: 0.28,
  /** 行数 `0..3`。 */
  lineCount: 4,
} as const;

/** `L341-347`：每型自己的缓动（CSS 等价）。 */
export const PAGE_TURN_PREVIEW_EASING = {
  SIMULATE: 'cubic-bezier(0.2, 0.7, 0.25, 1)',
  COVER: 'cubic-bezier(0.4, 0, 0.2, 1)',
  SLIDE: 'linear',
  FADE: 'cubic-bezier(0.4, 0, 0.2, 1)',
  SCROLL: 'linear',
} as const;

export type PageTurnPreviewType = keyof typeof PAGE_TURN_PREVIEW_EASING;

export interface PreviewLine {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
}

/**
 * `L373-383` 的 4 行文字。
 *
 * `xShift` 是整组平移（SIMULATE 的 `-3p`、FADE 的 `∓2p` 等由调用方叠加）。
 */
export function previewLines(width: number, height: number, xShift = 0): readonly PreviewLine[] {
  const gap = (height - PAGE_TURN_PREVIEW_METRICS.lineInsetY * 2) / PAGE_TURN_PREVIEW_METRICS.lineCount;
  const lines: PreviewLine[] = [];
  for (let i = 0; i < PAGE_TURN_PREVIEW_METRICS.lineCount; i += 1) {
    const isLast = i === PAGE_TURN_PREVIEW_METRICS.lineCount - 1;
    lines.push({
      x: PAGE_TURN_PREVIEW_METRICS.lineInsetX + xShift,
      y: PAGE_TURN_PREVIEW_METRICS.lineInsetY + i * gap,
      width:
        width -
        PAGE_TURN_PREVIEW_METRICS.lineWidthInset -
        (isLast ? width * PAGE_TURN_PREVIEW_METRICS.lastLineShortRatio : 0),
      height: PAGE_TURN_PREVIEW_METRICS.lineHeight,
      radius: PAGE_TURN_PREVIEW_METRICS.lineCorner,
    });
  }
  return lines;
}

/** 一帧要画的东西（UI 层转成 SVG/CSS）。 */
export interface PageTurnPreviewFrame {
  /** 文字行组；`alpha` 与 `xShift/yShift` 已算好。 */
  readonly layers: readonly {
    readonly alpha: number;
    readonly xShift: number;
    readonly yShift: number;
    readonly lines: readonly PreviewLine[];
    readonly role: 'front' | 'next';
  }[];
  /** SIMULATE 的右下折角（`null` = 不画）。 */
  readonly fold: {
    readonly size: number;
    readonly shadeAlpha: number;
    readonly edgeAlpha: number;
    readonly edgeWidth: number;
  } | null;
  /** COVER / SCROLL 的覆盖片或滚动条。 */
  readonly sheet: { readonly x: number; readonly width: number; readonly shadeAlpha: number } | null;
  /** SCROLL 的滚动条。 */
  readonly scrollbar: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly radius: number } | null;
}

/**
 * 某一帧的完整几何。
 *
 * `p` 会被钳到 `[0,1]`（Kotlin 的 `Animatable` 也只会在这个区间里）。
 */
export function pageTurnPreviewFrame(
  type: PageTurnPreviewType,
  width: number,
  height: number,
  p: number,
): PageTurnPreviewFrame {
  const progress = Math.min(Math.max(p, 0), 1);
  const empty = { layers: [], fold: null, sheet: null, scrollbar: null } satisfies PageTurnPreviewFrame;

  switch (type) {
    case 'SIMULATE': {
      // L387-412：行左移 3p；折角边长 w*.62*p，> 2 才画
      const fold = width * 0.62 * progress;
      return {
        layers: [{ alpha: 1, xShift: -3 * progress, yShift: 0, lines: previewLines(width, height), role: 'front' }],
        fold:
          fold > 2
            ? { size: fold, shadeAlpha: 0.16 * progress, edgeAlpha: 0.55 * progress, edgeWidth: 1.5 }
            : null,
        sheet: null,
        scrollbar: null,
      };
    }
    case 'COVER': {
      // L414-428：覆盖片从右向左盖住，左缘 7px 阴影
      const sheetX = width * (1 - progress);
      return {
        layers: [{ alpha: 1, xShift: 0, yShift: 0, lines: previewLines(width, height), role: 'front' }],
        fold: null,
        sheet: { x: sheetX, width: width - sheetX, shadeAlpha: sheetX > 1 ? 0.22 : 0 },
        scrollbar: null,
      };
    }
    case 'SLIDE': {
      // L430-436：前页左移 .85w，后页从右移入（.9 倍行程、alpha .45）
      return {
        layers: [
          { alpha: 1, xShift: -width * 0.85 * progress, yShift: 0, lines: previewLines(width, height), role: 'front' },
          {
            alpha: 0.45,
            xShift: width * (1 - progress) * 0.9,
            yShift: 0,
            lines: previewLines(width, height),
            role: 'next',
          },
        ],
        fold: null,
        sheet: null,
        scrollbar: null,
      };
    }
    case 'FADE': {
      // L437-440：透明度交叉淡出，位移 ±2p
      return {
        layers: [
          { alpha: 1 - progress, xShift: -2 * progress, yShift: 0, lines: previewLines(width, height), role: 'front' },
          { alpha: progress, xShift: 2 * progress, yShift: 0, lines: previewLines(width, height), role: 'next' },
        ],
        fold: null,
        sheet: null,
        scrollbar: null,
      };
    }
    case 'SCROLL': {
      // L441-461：整组上移 2.4 个行距（6 行铺满），右侧滚动条随 p 下移
      const gap = (height - PAGE_TURN_PREVIEW_METRICS.lineInsetY * 2) / PAGE_TURN_PREVIEW_METRICS.lineCount;
      const lines: PreviewLine[] = [];
      for (let i = 0; i < 6; i += 1) {
        const isShort = i % PAGE_TURN_PREVIEW_METRICS.lineCount === 3;
        lines.push({
          x: PAGE_TURN_PREVIEW_METRICS.lineInsetX,
          y: PAGE_TURN_PREVIEW_METRICS.lineInsetY + i * gap,
          width: width - PAGE_TURN_PREVIEW_METRICS.lineWidthInset - (isShort ? width * PAGE_TURN_PREVIEW_METRICS.lastLineShortRatio : 0),
          height: PAGE_TURN_PREVIEW_METRICS.lineHeight,
          radius: PAGE_TURN_PREVIEW_METRICS.lineCorner,
        });
      }
      return {
        layers: [{ alpha: 1, xShift: 0, yShift: -progress * gap * 2.4, lines, role: 'front' }],
        fold: null,
        sheet: null,
        scrollbar: {
          x: width - 3,
          y: 6 + progress * (height - 18),
          width: 2.5,
          height: 10,
          radius: 1.2,
        },
      };
    }
    default:
      return empty;
  }
}
