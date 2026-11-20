/**
 * 设置页「神回」分组的可判定部分 —— `god/GodSettingsSection.kt`（269 行）。
 *
 * 这个分区由三块组成（Kotlin L48-53 的 KDoc）：
 *   ① 「排行榜展示风格」三选一，每张卡片是**该风格的小型示意图**（Compose 现画，
 *      不引任何资源）—— 选中时弹簧缩放 1.04 + 金渐变描边 1.6dp；
 *   ② 「排行榜陀螺仪视差」开关（默认开；设备无旋转向量传感器时**整行隐藏**）；
 *   ③ 「查看神回排行榜 ✦」入口（可选，`onOpenRanking != null` 才渲染）。
 *
 * 为什么示意图要写成数据：三种风格的示意图共 11 个几何元素，全部是
 * `w * 0.xx / h * 0.xx` 的比例式（Kotlin L212-247）。散在 JSX 里手算成
 * `7.4 / 28.5 / 13.6 …` 之后，一旦画布尺寸或比例微调，没人会重算这些小数。
 * 这里保留**比例**，由 `godStylePreview()` 统一换算，UI 只负责画。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L70-77   标题 `13.sp / SemiBold / letterSpacing .1 / onSurface@.62` + `Spacer(8.dp)`
 *                                                            → `GOD_SETTINGS_SECTION`
 *   L80-86   `GlassCard(shape = RoundedCornerShape(16.dp))` + `padding(16.dp)` + `spacedBy(14.dp)`
 *                                                            → 同上
 *   L94-97   风格行 `spacedBy(10.dp)`                          → 同上
 *   L147-165 `GodSettingSwitchRow`                            → `GOD_SETTING_SWITCH_ROW`
 *   L180-209 `GodStyleCard`（缩放/描边/底/内边距）             → `GOD_STYLE_CARD`
 *   L212-249 三张示意图（Canvas 62×46）                        → `godStylePreview()`
 *   L260-269 `drawRoundRectStyleStep(..., cornerRadius = 4.dp)` → 预览元素的 `radius`
 *   L117-134 「查看神回排行榜 ✦」入口（r12 / secondary@.10 / v11 / 13.5sp）
 *                                                            → `GOD_SETTINGS_CTA`
 */

import type { GodRankingStyleCode } from './godRankingSettings';

/** Kotlin L70-97：分区容器与标题。 */
export const GOD_SETTINGS_SECTION = {
  /** L74 `fontSize = 13.sp`。 */
  titleSizeSp: 13,
  /** L75 `letterSpacing = 0.1.sp`。 */
  titleLetterSpacingSp: 0.1,
  /** L76 `onSurface.copy(alpha = 0.62f)`。 */
  titleAlpha: 0.62,
  /** L78 `Spacer(Modifier.height(8.dp))`。 */
  titleGapDp: 8,
  /** L82 `shape = RoundedCornerShape(16.dp)`。 */
  cardRadiusDp: 16,
  /** L85 `padding(16.dp)`。 */
  contentPaddingDp: 16,
  /** L86 `verticalArrangement = Arrangement.spacedBy(14.dp)`。 */
  contentGapDp: 14,
  /** L90 `fontSize = 14.sp`（「神回排行榜展示风格」）。 */
  sectionTitleSizeSp: 14,
  /** L96 风格行 `spacedBy(10.dp)`。 */
  styleRowGapDp: 10,
} as const;

/** Kotlin L147-165 `GodSettingSwitchRow`。 */
export const GOD_SETTING_SWITCH_ROW = {
  /** L152 `fontSize = 14.sp`。 */
  titleSizeSp: 14,
  /** L154 `Spacer(Modifier.height(2.dp))`。 */
  descGapDp: 2,
  /** L157 `fontSize = 11.5.sp`。 */
  descSizeSp: 11.5,
  /** L159 `lineHeight = 15.sp`。 */
  descLineHeightSp: 15,
  /** L163 `Spacer(Modifier.width(10.dp))`。 */
  trailingGapDp: 10,
} as const;

/** Kotlin L180-257 `GodStyleCard`。 */
export const GOD_STYLE_CARD = {
  /** L181 `if (selected) 1.04f else 1f`。 */
  selectedScale: 1.04,
  /** L186 `if (selected) 0.95f else 0.12f`（未选中描边 alpha）。 */
  borderAlphaSelected: 0.95,
  borderAlphaIdle: 0.12,
  /** L190 `surfaceVariant.copy(alpha = if (selected) 0.55f else 0.32f)`。 */
  surfaceAlphaSelected: 0.55,
  surfaceAlphaIdle: 0.32,
  /** L198 `width = if (selected) 1.6.dp else 1.dp`。 */
  borderWidthSelectedDp: 1.6,
  borderWidthIdleDp: 1,
  /** L195 / L206 `RoundedCornerShape(14.dp)`。 */
  radiusDp: 14,
  /** L209 `padding(8.dp)`。 */
  paddingDp: 8,
  /** L212 `Canvas(Modifier.size(width = 62.dp, height = 46.dp))`。 */
  artWidthDp: 62,
  artHeightDp: 46,
  /** L267 `CornerRadius(4.dp.toPx(), 4.dp.toPx())` —— 示意图里的圆角矩形。 */
  stepRadiusDp: 4,
  /** L250 `Spacer(Modifier.height(6.dp))`。 */
  labelGapDp: 6,
  /** L253 `fontSize = 11.5.sp`。 */
  labelSizeSp: 11.5,
  /** L254 `if (selected) FontWeight.Bold else FontWeight.Medium` → 700 / 500。 */
  labelWeightSelected: 700,
  labelWeightIdle: 500,
} as const;

/** Kotlin L117-134：「查看神回排行榜 ✦」入口。 */
export const GOD_SETTINGS_CTA = {
  /** L121 `clip(RoundedCornerShape(12.dp))`。 */
  radiusDp: 12,
  /** L122 `secondary.copy(alpha = 0.10f)`。 */
  backgroundAlpha: 0.1,
  /** L124 `padding(vertical = 11.dp)`。 */
  paddingVerticalDp: 11,
  /** L129 `fontSize = 13.5.sp`。 */
  labelSizeSp: 13.5,
} as const;

/** Kotlin L72/89/111-112/128 的五条文案（`tr(...)` 的原文）。 */
export const GOD_SETTINGS_STRINGS = {
  sectionTitle: '神回',
  styleTitle: '神回排行榜展示风格',
  gyroTitle: '排行榜陀螺仪视差',
  gyroDesc: '倾斜手机时封面与光环反向位移，形成景深',
  openRanking: '查看神回排行榜 ✦',
} as const;

/** 示意图里的一个几何元素。 */
export interface GodStylePreviewOp {
  readonly kind: 'roundRect' | 'rect' | 'circle' | 'path';
  /** 左上角 / 圆心 / 路径起点（px，画布坐标）。 */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 圆角矩形 / 圆点用。 */
  readonly radius: number;
  readonly fill: string;
  /** 只有 `path` 用：二次贝塞尔的控制点与终点。 */
  readonly path?: {
    readonly controlX: number;
    readonly controlY: number;
    readonly endX: number;
    readonly endY: number;
    readonly strokeWidth: number;
  };
}

/** Kotlin L227/L229 唱片套的固定灰。 */
export const GOD_PREVIEW_SLEEVE_GREY = '#5A5F6B';
/** Kotlin L230 黑胶盘面。 */
export const GOD_PREVIEW_VINYL_BLACK = '#121316';
/** Kotlin L233 搁板 `Color(0x33666666)`。 */
export const GOD_PREVIEW_SHELF = '#66666633';
/** Kotlin L243 麻绳 `Color(0xFFB79B72)`。 */
export const GOD_PREVIEW_ROPE = '#B79B72';
/** Kotlin L245-246 拍立得纸色 `Color.White`。 */
export const GOD_PREVIEW_POLAROID_WHITE = '#FFFFFF';

/**
 * Kotlin L212-249：三种风格的示意图，元素顺序即绘制顺序（后画的盖在上面）。
 *
 * `gold` 是 `GodGold.goldGradient(dark)` 的三色（Kotlin L68/L102）：
 * 亮色 `LightStart/Mid/End`、深色 `DarkStart/Mid/End`。
 */
export function godStylePreview(
  style: GodRankingStyleCode,
  gold: readonly [string, string, string],
  width: number = GOD_STYLE_CARD.artWidthDp,
  height: number = GOD_STYLE_CARD.artHeightDp,
): readonly GodStylePreviewOp[] {
  const w = width;
  const h = height;
  const r = GOD_STYLE_CARD.stepRadiusDp;
  const step = (x: number, y: number, bw: number, bh: number, fill: string): GodStylePreviewOp => ({
    kind: 'roundRect',
    x: w * x,
    y: h * y,
    width: w * bw,
    height: h * bh,
    radius: r,
    fill,
  });

  if (style === 'podium') {
    // L214-221 三个台阶 + 中间最高
    return [
      step(0.12, 0.62, 0.22, 0.38, gold[1]),
      step(0.39, 0.42, 0.22, 0.58, gold[0]),
      step(0.66, 0.7, 0.22, 0.3, gold[2]),
    ];
  }

  if (style === 'vinyl') {
    // L223-234 三张唱片套 + 一张抽出的黑胶 + 搁板
    const cx = w * 0.84;
    const cy = h * 0.52;
    return [
      step(0.06, 0.24, 0.16, 0.62, GOD_PREVIEW_SLEEVE_GREY),
      step(0.3, 0.18, 0.18, 0.68, gold[0]),
      step(0.58, 0.24, 0.16, 0.62, GOD_PREVIEW_SLEEVE_GREY),
      {
        kind: 'circle',
        x: cx,
        y: cy,
        width: 0,
        height: 0,
        radius: h * 0.24,
        fill: GOD_PREVIEW_VINYL_BLACK,
      },
      {
        kind: 'circle',
        x: cx,
        y: cy,
        width: 0,
        height: 0,
        radius: h * 0.08,
        fill: gold[0],
      },
      {
        kind: 'rect',
        x: 0,
        y: h * 0.88,
        width: w,
        height: h * 0.08,
        radius: 0,
        fill: GOD_PREVIEW_SHELF,
      },
    ];
  }

  // L235-247 麻绳 + 两张拍立得
  return [
    {
      kind: 'path',
      x: 0,
      y: h * 0.16,
      width: 0,
      height: 0,
      radius: 0,
      fill: GOD_PREVIEW_ROPE,
      path: {
        controlX: w / 2,
        controlY: h * 0.34,
        endX: w,
        endY: h * 0.16,
        strokeWidth: 2,
      },
    },
    step(0.1, 0.3, 0.32, 0.52, GOD_PREVIEW_POLAROID_WHITE),
    step(0.52, 0.34, 0.32, 0.52, GOD_PREVIEW_POLAROID_WHITE),
  ];
}

/** Kotlin L181 `if (selected) 1.04f else 1f`。 */
export function godStyleCardScale(selected: boolean): number {
  return selected ? GOD_STYLE_CARD.selectedScale : 1;
}

/** Kotlin L198 `if (selected) 1.6.dp else 1.dp`。 */
export function godStyleCardBorderWidth(selected: boolean): number {
  return selected ? GOD_STYLE_CARD.borderWidthSelectedDp : GOD_STYLE_CARD.borderWidthIdleDp;
}

/** Kotlin L190 `if (selected) 0.55f else 0.32f`。 */
export function godStyleCardSurfaceAlpha(selected: boolean): number {
  return selected ? GOD_STYLE_CARD.surfaceAlphaSelected : GOD_STYLE_CARD.surfaceAlphaIdle;
}

/** Kotlin L186 `if (selected) 0.95f else 0.12f`（未选中走这个 alpha；选中改金渐变）。 */
export function godStyleCardBorderAlpha(selected: boolean): number {
  return selected ? GOD_STYLE_CARD.borderAlphaSelected : GOD_STYLE_CARD.borderAlphaIdle;
}

/** Kotlin L254 `if (selected) FontWeight.Bold else FontWeight.Medium`。 */
export function godStyleCardLabelWeight(selected: boolean): number {
  return selected ? GOD_STYLE_CARD.labelWeightSelected : GOD_STYLE_CARD.labelWeightIdle;
}

/**
 * Kotlin L131 `color = if (dark) GodGold.DarkMid else GodGold.LightEnd`
 * （`GodMotion.kt` L93 `LightEnd = 0xFFD98E1F`、L96 `DarkMid = 0xFFC79A3E`）。
 */
export function godSettingsCtaColor(dark: boolean): string {
  return dark ? '#C79A3E' : '#D98E1F';
}
