/**
 * Kotlin → TS 行号映射
 * ─────────────────────
 * `ui/wenku/ShelfVolumeRender.kt`
 *   L37-52    data class ShelfVolumePose                → ShelfVolumePose（types.ts）
 *   L55-65    RESTING_VOLUME_POSE                       → RESTING_VOLUME_POSE
 *   L102-176  object ShelfOpenTimeline（OPEN_MS/CLOSE_MS/CLOSE_COVER_IN_MS/GEOMETRY_END/
 *             smooth / poseAt / fillScale）              → OPEN_MS / CLOSE_MS / CLOSE_COVER_IN_MS /
 *                                                          poseAt / fillScale
 *   L182-242  ShelfVolumeArtist.draw / restPivotX / restPivotY → planVolumeDraw 的 pivot + scale
 *   L244-311  paintFor（书脊渐变、封面材质、纸页色）        → volumePaintPlan
 *   L313-317  Paint.tone                                 → toneColor（coverArt.ts）
 *   L319-495  drawVolume（顶面/纸页/书脊/封面/倒角/编号）   → planVolumeDraw
 *   L498-533  drawSpineDetails（堵头布/编号）              → planVolumeDraw().spine.details
 *   L543-549  MATERIAL_* / CLOTH_TILE_SEED / CODE_ALPHA    → WENKU_VOLUME（tokens.ts）
 *   L585-614  ShelfPalette                               → shelfPalette
 *   L617-621  volumeThicknessPx                          → volumeThicknessPx
 *   L624-627  volumeHeightScale                          → volumeHeightScale
 *   L630-635  volumeMaterial                             → volumeMaterial
 * `ui/wenku/ArchiveShelf.kt`
 *   L971-987  archiveSpineRuns                           → archiveSpineRuns
 *   L989-1020 ShelfVolume.of                             → shelfVolumeOf
 *   L1097-1102 fallbackTint                              → fallbackTint
 *   L1188-1211 artFor                                    → buildVolumeArt
 *   L1213-1238 buildFloor                                → floorPlan
 *   L1297-1300 地面路径绘制平移                            → floorOrigin（shelfMetrics.ts）
 *
 * 未移植（纯 Canvas/Typeface/BitmapShader 调用，只输出参数）：
 * - `canvas.save/translate/scale/concat/clipPath/drawPath/drawRect/drawLine/drawBitmap/drawText`
 *   —— 全部映射为 `VolumeDrawPlan` 里的 quad / matrix / rect / line / gradient / text 参数。
 * - `Paint.getFontMetrics` / `measureText`：由 UI 注入 `VolumeTextMetrics`；未注入时编号不画
 *   （对应 Kotlin `numberWidth < spine * .92f` 判定无法求值的分支）。
 * - `BitmapShader(clothTile())`：`clothTilePixels()` 输出像素，UI 建纹理后平铺。
 */

import {
  COLOR_BLACK,
  COLOR_WHITE,
  inkOn,
  shadeColor,
  toneColor,
  withAlpha,
} from './coverArt';
import { clamp, roundToInt, smoothStep, truncToInt } from './motion';
import {
  WENKU_OPEN_TIMELINE,
  WENKU_SHELF,
  WENKU_VOLUME,
  WENKU_FALLBACK_TINTS,
} from './tokens';
import type {
  BitmapSize,
  BookSource,
  ColorArgb,
  CoverTextureId,
  FillRectPlan,
  FloorPlan,
  LinearGradientPlan,
  Matrix3,
  Quad,
  RectF,
  ShelfColorsInput,
  ShelfPalette,
  ShelfVolume,
  ShelfVolumeArt,
  ShelfVolumePose,
  SpineRun,
  StrokeLinePlan,
  TextRunPlan,
  Vec2,
  VolumeDrawPlan,
} from './types';
import type { ShelfMetrics } from './shelfMetrics';

/** `ShelfOpenTimeline.OPEN_MS`。 */
export const OPEN_MS = WENKU_OPEN_TIMELINE.openMs;
/** `ShelfOpenTimeline.CLOSE_MS`。 */
export const CLOSE_MS = WENKU_OPEN_TIMELINE.closeMs;
/** `ShelfOpenTimeline.CLOSE_COVER_IN_MS`。 */
export const CLOSE_COVER_IN_MS = WENKU_OPEN_TIMELINE.closeCoverInMs;
/** `ShelfOpenTimeline.GEOMETRY_END`。 */
export const GEOMETRY_END = WENKU_OPEN_TIMELINE.geometryEnd;

/** 书架静止姿态：`p = 0` 必须与它逐参数相同。 */
export const RESTING_VOLUME_POSE: ShelfVolumePose = {
  ox: 0,
  oy: 0,
  depthX: 0.66,
  depthY: -0.16,
  skew: 0.1,
  thicknessScale: 1,
  detail: 1,
  alpha: 1,
  scale: 1,
};

export interface OpenTimelineInput {
  readonly p: number;
  readonly art: ShelfVolumeArt;
  readonly restOx: number;
  readonly restOy: number;
  readonly targetCenterX: number;
  readonly targetCenterY: number;
  readonly targetScale: number;
  /** 非 null 时直接用它当透明度（归位：封面从阅读器这一侧淡入）。 */
  readonly alphaOverride: number | null;
}

/**
 * `ShelfOpenTimeline.poseAt`：一个进度、一条路径。
 * 位置与缩放共用一条钟形曲线；转正（depthX/depthY/skew/书脊）在 p≈.02..64 与缩放重叠推进。
 */
export function poseAt(input: OpenTimelineInput): ShelfVolumePose {
  const progress = clamp(input.p, 0, 1);
  const moveT = smoothStep(progress / GEOMETRY_END);
  const flatT = smoothStep((progress - WENKU_OPEN_TIMELINE.flattenStart) / WENKU_OPEN_TIMELINE.flattenSpan);
  const depthX = 0.66 + (1 - 0.66) * flatT;
  const depthY = -0.16 * (1 - flatT);
  const skew = 0.1 * (1 - flatT);
  const thicknessScale = 1 - flatT;
  const detail = 1 - smoothStep((progress - WENKU_OPEN_TIMELINE.detailStart) / WENKU_OPEN_TIMELINE.detailSpan);
  const alpha =
    input.alphaOverride !== null
      ? input.alphaOverride
      : 1 - smoothStep((progress - WENKU_OPEN_TIMELINE.alphaStart) / WENKU_OPEN_TIMELINE.alphaSpan);

  const thickness = input.art.thickness * thicknessScale;
  const dx = input.art.coverWidth * depthX;
  const dy = input.art.coverWidth * depthY;
  const restPivotX = input.restOx + thickness + dx * 0.5;
  const restPivotY = input.restOy + input.art.topInset + dy * 0.5 + input.art.body * 0.5;
  const pivotX = restPivotX + (input.targetCenterX - restPivotX) * moveT;
  const pivotY = restPivotY + (input.targetCenterY - restPivotY) * moveT;
  const scale = 1 + (input.targetScale - 1) * moveT;
  // ox/oy 由"封面面中心必须落在 pivot 上"反解出来。
  const ox = pivotX - (thickness + dx * 0.5);
  const oy = pivotY - (input.art.topInset + dy * 0.5 + input.art.body * 0.5);
  return {
    ox,
    oy,
    depthX,
    depthY,
    skew,
    thicknessScale,
    detail,
    alpha: clamp(alpha, 0, 1),
    scale,
  };
}

/** 铺满 viewport 需要的缩放：用 max（裁切）而不是 min（留边）。 */
export function fillScale(art: ShelfVolumeArt, viewportWidth: number, viewportHeight: number): number {
  if (art.coverWidth <= 0 || art.body <= 0) return 1;
  return Math.max(viewportWidth / art.coverWidth, viewportHeight / art.body);
}

/** 本帧的封面面中心 x（`restPivotX`，L234-237）。 */
export function restPivotX(art: ShelfVolumeArt, pose: ShelfVolumePose): number {
  const thickness = art.thickness * pose.thicknessScale;
  return pose.ox + thickness + art.coverWidth * pose.depthX * 0.5;
}

/** 本帧的封面面中心 y（`restPivotY`，L239-242）。 */
export function restPivotY(art: ShelfVolumeArt, pose: ShelfVolumePose): number {
  const dy = art.coverWidth * pose.depthY;
  return pose.oy + art.topInset + dy * 0.5 + art.body * 0.5;
}

/* ───────────────────────────── 卷数据 ───────────────────────────── */

/** `archive_spine_title.dart` L5：拉丁连排、CJK 单字。Kotlin `for (glyph in title)` 走 UTF-16 码元，这里逐码元同步。 */
export function archiveSpineRuns(title: string): SpineRun[] {
  const runs: SpineRun[] = [];
  let latin = '';
  const flush = (): void => {
    const text = latin.trim();
    if (text.length > 0) runs.push({ text, latin: true });
    latin = '';
  };
  for (let i = 0; i < title.length; i += 1) {
    const code = title.charCodeAt(i);
    const glyph = title[i] ?? '';
    if (code >= 0x20 && code <= 0x7e) {
      latin += glyph;
    } else {
      flush();
      runs.push({ text: glyph, latin: false });
    }
  }
  flush();
  return runs;
}

/** `ShelfVolume.of`：书名拆段 + 前 7 段 + 拉丁段 > 24 字符截 23 + '…'（按 UTF-16 码元截）。 */
export function shelfVolumeOf(index: number, book: BookSource): ShelfVolume {
  const ordinal = index + 1;
  const all = archiveSpineRuns(book.title);
  const runs = all.slice(0, 7).map((run) =>
    run.latin && run.text.length > 24
      ? { text: `${run.text.slice(0, 23)}\u2026`, latin: true }
      : run,
  );
  const padded = ordinal.toString().padStart(2, '0');
  const codePad = ordinal.toString().padStart(3, '0');
  return {
    id: book.id,
    title: book.title,
    number: padded,
    coverCode: `NO.${codePad}`,
    fileCode: `${book.id < 0 ? 'FAV-' : 'WK-'}${Math.abs(book.id).toString().padStart(5, '0')}`,
    runs,
    truncated: all.length > 7,
    chapters: book.totalChapters,
  };
}

/** `fallbackTint`：没有贴图时的兜底色（必须纸色系，不能是深蓝灰）。 */
export function fallbackTint(id: number): ColorArgb {
  const tint = WENKU_FALLBACK_TINTS[Math.abs(id) % 4];
  return tint ?? WENKU_FALLBACK_TINTS[0] ?? 0xffefe9dc;
}

/* ───────────────────────────── 尺寸/材质 ───────────────────────────── */

/** 页数 → 厚度 px：`clamp(6 + sqrt(pages) * .40, 7.5, 25) * density`。 */
export function volumeThicknessPx(chapters: number, id: number, density: number): number {
  const pages =
    chapters > 0
      ? chapters * WENKU_VOLUME.pagesPerChapter
      : WENKU_VOLUME.fallbackPagesBase +
        (Math.abs(id * WENKU_VOLUME.fallbackPagesSeed) % WENKU_VOLUME.fallbackPagesModulus);
  const thicknessDp = clamp(
    WENKU_VOLUME.thicknessBaseDp + Math.sqrt(pages) * WENKU_VOLUME.thicknessSqrtRate,
    WENKU_VOLUME.thicknessMinDp,
    WENKU_VOLUME.thicknessMaxDp,
  );
  return thicknessDp * density;
}

/** 高度差 ±3.5%：`1 + swing * .07`。 */
export function volumeHeightScale(id: number): number {
  const swing = ((Math.abs(id * WENKU_VOLUME.heightSeed) % 100) / 100) - 0.5;
  return 1 + swing * WENKU_VOLUME.heightSwing;
}

/** 材质：`abs(id * 17 + titleLength) % 3`。 */
export function volumeMaterial(id: number, titleLength: number): 0 | 1 | 2 {
  const mod = Math.abs(id * WENKU_VOLUME.materialSeed + titleLength) % WENKU_VOLUME.materialModulus;
  return mod === 0 ? WENKU_VOLUME.materialCloth : mod === 1 ? WENKU_VOLUME.materialMatte : WENKU_VOLUME.materialGloss;
}

/* ───────────────────────────── 调色板 ───────────────────────────── */

/** `ShelfPalette(colors, density)`：一次算好，绘制期不再查主题。 */
export function shelfPalette(colors: ShelfColorsInput, density: number): ShelfPalette {
  const dark = colors.isDark;
  return {
    isDark: dark,
    densityUnit: density,
    floorInk: dark ? colors.milk : 0xff8a806b,
    border: colors.outline,
    ink: colors.ink,
    secondary: colors.inkSecondary,
    paper: dark ? 0xff3b3a34 : 0xfff4efe1,
    paperDeep: dark ? 0xff2a2925 : 0xffd8ceb8,
    pageLine: dark ? 0xff1c1b18 : 0xffb3a88f,
    highlight: dark ? 0xfff7f6f0 : 0xfffffef8,
    codeSize: 7.6 * density,
    codeLine: 7.6 * WENKU_VOLUME.codeLineHeightFactor * density,
    codeSpacing: 0.9 / 7.6,
    titleSize: 9 * density,
    titleLine: 9 * WENKU_VOLUME.titleLineHeightFactor * density,
    spinePadV: 9 * density,
    gapAfterNumber: 6 * density,
    gapBeforeDot: 5 * density,
    dotRadius: 2.4 * density,
    dotSize: 4.8 * density,
    hairline: 0.7 * density,
    pageInset: 2.1 * density,
    overhang: 1.6 * density,
    spineRadius: 4.4 * density,
    hingeWidth: 2.4 * density,
  };
}

/** `artFor(volume, metrics, covers, palette)`（ArchiveShelf.kt L1188-1211）。 */
export function buildVolumeArt(
  volume: ShelfVolume,
  metrics: ShelfMetrics,
  tint: ColorArgb,
  cover: CoverTextureId | null,
  palette: ShelfPalette,
): ShelfVolumeArt {
  const heightScale = volumeHeightScale(volume.id);
  return {
    id: volume.id,
    coverWidth: metrics.coverPx,
    body: metrics.bodyPx * heightScale,
    thickness: volumeThicknessPx(volume.chapters, volume.id, metrics.density),
    topInset: metrics.bodyPx * (heightScale - 1),
    tint,
    material: volumeMaterial(volume.id, volume.title.length),
    cover,
    number: volume.number,
    fileCode: volume.fileCode,
    runs: volume.runs,
    truncated: volume.truncated,
    palette,
    unit: metrics.density,
  };
}

/* ───────────────────────────── 画笔参数 ───────────────────────────── */

export interface VolumePaintPlan {
  readonly thickness: number;
  readonly height: number;
  readonly topInset: number;
  readonly material: number;
  readonly tint: ColorArgb;
  readonly spineFill: LinearGradientPlan;
  readonly spineShade: LinearGradientPlan;
  readonly boardTop: ColorArgb;
  readonly paper: ColorArgb;
  readonly pageLine: ColorArgb;
  readonly pageLineWidth: number;
}

const COLOR_TRANSPARENT = 0x00000000;

function gradient(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colors: readonly ColorArgb[],
  positions: readonly number[],
): LinearGradientPlan {
  return {
    x0,
    y0,
    x1,
    y1,
    stops: positions.map((position, index) => ({
      color: colors[index] ?? COLOR_TRANSPARENT,
      position,
    })),
  };
}

/** `paintFor(art)`：书脊柱面渐变 + 覆膜材质 + 纸页色（L244-311）。 */
export function volumePaintPlan(art: ShelfVolumeArt): VolumePaintPlan {
  const palette = art.palette;
  const thickness = art.thickness;
  const spineBase =
    art.material === WENKU_VOLUME.materialCloth
      ? shadeColor(art.tint, -0.06)
      : art.material === WENKU_VOLUME.materialMatte
        ? shadeColor(art.tint, 0.04)
        : shadeColor(art.tint, -0.14);
  const specular =
    art.material === WENKU_VOLUME.materialGloss
      ? 0.34
      : art.material === WENKU_VOLUME.materialCloth
        ? 0.12
        : 0.2;
  const spineFill = gradient(
    0,
    0,
    thickness,
    0,
    [
      shadeColor(spineBase, -0.16),
      shadeColor(spineBase, -0.04),
      shadeColor(spineBase, specular * 0.7),
      shadeColor(spineBase, 0.02),
      shadeColor(spineBase, -0.1),
      shadeColor(spineBase, -0.24),
    ],
    WENKU_VOLUME.spineFillPositions,
  );
  const spineShade = gradient(
    0,
    0,
    thickness,
    0,
    [
      0x6c000000,
      0x06000000,
      0x2cffffff,
      0x10000000,
      0x42000000,
      0x96000000,
    ],
    WENKU_VOLUME.spineShadePositions,
  );
  return {
    thickness,
    height: art.body,
    topInset: art.topInset,
    material: art.material,
    tint: art.tint,
    spineFill,
    spineShade,
    boardTop:
      art.material === WENKU_VOLUME.materialGloss
        ? shadeColor(spineBase, 0.1)
        : shadeColor(spineBase, -0.02),
    paper: palette.paper,
    pageLine: palette.pageLine,
    pageLineWidth: Math.max(0.55 * art.unit, thickness * 0.025),
  };
}

/* ───────────────────────────── 文本注入 ───────────────────────────── */

/** 平台文本度量（图书脊编号需要 `measureText` 与 `FontMetrics`）。 */
export interface VolumeTextMetrics {
  measure(text: string, sizePx: number, letterSpacing: number): number;
  ascent(sizePx: number): number;
  descent(sizePx: number): number;
}

/* ───────────────────────────── 单卷绘制计划 ───────────────────────────── */

function quad(points: [Vec2, Vec2, Vec2, Vec2]): Quad {
  return { points };
}

/**
 * `drawVolume` 的全部几何参数。返回 `visible: false` 等价于 Kotlin 的三个提前 return
 * （`cover < 4 || body < 4`、`ink <= 0`）。绘制顺序与 L337-494 完全一致：
 * 顶面 → 纸页 → 纸页线 → 纸页压影 → 前口高光 → 书脊 → 装订槽 → 封面。
 */
export function planVolumeDraw(
  art: ShelfVolumeArt,
  pose: ShelfVolumePose,
  coverPixels: BitmapSize | null,
  textMetrics: VolumeTextMetrics | null,
): VolumeDrawPlan {
  const paint = volumePaintPlan(art);
  const palette = art.palette;
  const unit = art.unit;
  const cover = art.coverWidth;
  const body = paint.height;
  const t = Math.max(paint.thickness * pose.thicknessScale, 2);
  const ink = clamp(pose.alpha, 0, 1);
  const detail = clamp(pose.detail, 0, 1);
  const alpha = clamp(roundToInt(255 * ink), 0, 255);
  const dx = cover * pose.depthX;
  const dy = cover * pose.depthY;
  const skew = pose.skew;
  const visible = cover >= WENKU_VOLUME.minFacePx && body >= WENKU_VOLUME.minFacePx && ink > 0;

  const inset = Math.min(t * 0.3, palette.pageInset);
  const fore = 1 - clamp(palette.overhang / cover, 0, 0.12);
  const pageTop = inset * skew;
  const topFace = quad([
    { x: 0, y: 0 },
    { x: t, y: t * skew },
    { x: t + dx, y: t * skew + dy },
    { x: dx, y: dy },
  ]);
  const pageFace = quad([
    { x: inset, y: pageTop },
    { x: t - inset, y: (t - inset) * skew },
    { x: t - inset + dx * fore, y: (t - inset) * skew + dy * fore },
    { x: inset + dx * fore, y: pageTop + dy * fore },
  ]);

  const pageLines: StrokeLinePlan[] = [];
  if (t - inset * 2 > unit * 2.4) {
    const lines = 6;
    const x0 = inset + t * 0.06;
    const x1 = t - inset - t * 0.05;
    for (let i = 1; i < lines; i += 1) {
      const p = i / lines;
      const bx = x0 + (x1 - x0) * p;
      const by = bx * skew;
      pageLines.push({
        segment: { x0: bx, y0: by, x1: bx + dx * fore, y1: by + dy * fore },
        color: palette.pageLine,
        alpha: clamp(roundToInt(86 * ink), 0, 255),
        width: paint.pageLineWidth,
      });
    }
  }

  const pageBottom = (t - inset) * skew + Math.abs(dy) + unit;
  const pageShades: FillRectPlan[] = [
    {
      rect: {
        left: inset,
        top: pageTop - unit,
        right: inset + dx * 0.2,
        bottom: pageBottom,
      },
      color: toneColor(palette.paperDeep, 0.45, ink),
      alpha: 1,
    },
    {
      rect: {
        left: inset + dx * fore * 0.82,
        top: pageTop - unit,
        right: inset + dx * fore,
        bottom: pageBottom,
      },
      color: toneColor(palette.highlight, 0.18, ink),
      alpha: 1,
    },
  ];

  const foreEdgeHairline: StrokeLinePlan = {
    segment: { x0: t, y0: t * skew, x1: t + dx, y1: t * skew + dy },
    color: toneColor(palette.highlight, 0.6, ink),
    alpha: 1,
    width: Math.max(0.6 * unit, t * 0.04),
  };

  const radius = Math.min(t * WENKU_VOLUME.spineRadiusFactor, palette.spineRadius);
  const spineMatrix: Matrix3 = {
    values: [1, 0, 0, skew, 1, 0, 0, 0, 1],
  };

  let wrapSource: RectF | null = null;
  let wrapDestination: RectF | null = null;
  if (art.cover !== null && coverPixels !== null && coverPixels.width > 8 && coverPixels.height > 8) {
    const wrapStart = truncToInt(coverPixels.width * 0.06);
    const wrapEnd = Math.max(truncToInt(coverPixels.width * 0.22), 2);
    wrapSource = { left: wrapStart, top: 0, right: wrapEnd, bottom: coverPixels.height };
    wrapDestination = {
      left: 0,
      top: 0,
      right: Math.max(roundToInt(t), 1),
      bottom: roundToInt(body),
    };
  }

  const headBands: FillRectPlan[] = [
    {
      rect: { left: 0, top: unit * 1.2, right: t, bottom: unit * 3.2 },
      color: toneColor(
        shadeColor(art.tint, palette.isDark ? 0.34 : 0.2),
        0.9,
        ink,
      ),
      alpha: 1,
    },
    {
      rect: { left: 0, top: body - unit * 3.4, right: t, bottom: body - unit * 1.4 },
      color: toneColor(
        shadeColor(art.tint, palette.isDark ? 0.34 : 0.2),
        0.9,
        ink,
      ),
      alpha: 1,
    },
  ];
  const separators: StrokeLinePlan[] = [
    {
      segment: { x0: 0, y0: unit * 3.2, x1: t, y1: unit * 3.2 },
      color: toneColor(COLOR_BLACK, 0.3, ink),
      alpha: 1,
      width: 0.5 * unit,
    },
    {
      segment: { x0: 0, y0: body - unit * 3.4, x1: t, y1: body - unit * 3.4 },
      color: toneColor(COLOR_BLACK, 0.3, ink),
      alpha: 1,
      width: 0.5 * unit,
    },
  ];

  let numberText: TextRunPlan | null = null;
  if (textMetrics !== null) {
    const numberWidth = textMetrics.measure(art.number, palette.codeSize, palette.codeSpacing);
    if (numberWidth < t * 0.92) {
      const textHeight = textMetrics.descent(palette.codeSize) - textMetrics.ascent(palette.codeSize);
      const baseline =
        unit * 6.2 + (palette.codeLine - textHeight) / 2 - textMetrics.ascent(palette.codeSize);
      numberText = {
        text: art.number,
        x: t * 0.5 - numberWidth / 2,
        y: baseline,
        size: palette.codeSize,
        letterSpacing: palette.codeSpacing,
        color: toneColor(inkOn(art.tint), 0.9, ink),
        alpha: 1,
        monospace: true,
        bold: false,
      };
    }
  }

  const coverMatrix: Matrix3 = {
    values: [pose.depthX, 0, t, pose.depthY, 1, t * skew, 0, 0, 1],
  };

  const shades: FillRectPlan[] = [
    {
      rect: { left: 0, top: 0, right: cover, bottom: body * 0.18 },
      color: toneColor(COLOR_BLACK, 0.045, ink * detail),
      alpha: 1,
    },
    {
      rect: { left: 0, top: body * 0.92, right: cover, bottom: body },
      color: toneColor(COLOR_BLACK, 0.035, ink * detail),
      alpha: 1,
    },
  ];
  const hingeRects: FillRectPlan[] = [
    {
      rect: { left: 0, top: 0, right: palette.hingeWidth, bottom: body },
      color: toneColor(COLOR_BLACK, 0.26, ink * detail),
      alpha: 1,
    },
    {
      rect: {
        left: palette.hingeWidth,
        top: 0,
        right: palette.hingeWidth + unit * 0.7,
        bottom: body,
      },
      color: toneColor(COLOR_WHITE, 0.1, ink * detail),
      alpha: 1,
    },
  ];
  const chamferWidth = Math.max(0.55 * unit, 0.55);
  const chamfers: StrokeLinePlan[] = [
    {
      segment: { x0: 0, y0: 0, x1: cover, y1: 0 },
      color: toneColor(palette.highlight, 0.22, ink * detail),
      alpha: 1,
      width: chamferWidth,
    },
    {
      segment: { x0: 0, y0: 0, x1: 0, y1: body },
      color: toneColor(palette.highlight, 0.22, ink * detail),
      alpha: 1,
      width: chamferWidth,
    },
    {
      segment: { x0: 0, y0: body - 0.5, x1: cover, y1: body - 0.5 },
      color: toneColor(COLOR_BLACK, 0.3, ink * detail),
      alpha: 1,
      width: chamferWidth,
    },
    {
      segment: { x0: cover - 0.5, y0: 0, x1: cover - 0.5, y1: body },
      color: toneColor(COLOR_BLACK, 0.3, ink * detail),
      alpha: 1,
      width: chamferWidth,
    },
  ];

  const gloss = art.material === WENKU_VOLUME.materialGloss;
  const sheen = gloss
    ? {
        rotationDeg: WENKU_VOLUME.glossSheenRotationDeg,
        rect: { left: -cover * 0.2, top: -body, right: cover * 1.2, bottom: body * 2 },
        gradient: gradient(
          0,
          0,
          cover * 0.85,
          0,
          [COLOR_TRANSPARENT, 0x2cffffff, 0x40ffffff, 0x14ffffff, COLOR_TRANSPARENT],
          [0, 0.26, 0.38, 0.46, 0.7],
        ),
        alpha: clamp(roundToInt(255 * 0.55 * ink * detail), 0, 255),
      }
    : null;
  const cloth =
    art.material === WENKU_VOLUME.materialCloth
      ? {
          alpha: clamp(roundToInt(WENKU_VOLUME.clothAlpha * ink * detail), 0, 255),
          tileScale: unit * 0.55,
        }
      : null;

  return {
    visible,
    pivotX: restPivotX(art, pose),
    pivotY: restPivotY(art, pose),
    scale: pose.scale,
    coverWidth: cover,
    body,
    thickness: t,
    ink,
    detail,
    alpha255: alpha,
    dx,
    dy,
    topFace: {
      quad: topFace,
      color: toneColor(paint.boardTop, 1, ink),
      alpha: 1,
    },
    pageFace: {
      quad: pageFace,
      color: toneColor(paint.paper, 1, ink),
      alpha: 1,
    },
    pageLines,
    pageShades,
    pageClip: pageFace,
    foreEdgeHairline,
    spine: {
      matrix: spineMatrix,
      rect: { left: 0, top: 0, right: t, bottom: body },
      radius,
      fillGradient: paint.spineFill,
      fillAlpha: alpha / 255,
      wrapSource,
      wrapDestination,
      wrapAlpha: alpha / 255,
      shadeGradient: paint.spineShade,
      shadeAlpha: clamp(roundToInt(235 * ink), 0, 255) / 255,
      details: { headBands, separators, numberText },
    },
    hingeCenterLine: {
      segment: { x0: t - 0.55 * unit, y0: 0, x1: t - 0.55 * unit, y1: body },
      color: toneColor(COLOR_BLACK, 0.55, ink),
      alpha: 1,
      width: Math.max(0.8 * unit, 1),
    },
    cover: {
      matrix: coverMatrix,
      rect: { left: 0, top: 0, right: cover, bottom: body },
      baseColor: toneColor(art.cover === null ? palette.paper : paint.boardTop, 1, ink),
      baseAlpha: 1,
      bitmap:
        art.cover !== null && coverPixels !== null
          ? {
              source: { left: 0, top: 0, right: coverPixels.width, bottom: coverPixels.height },
              destination: { left: 0, top: 0, right: roundToInt(cover), bottom: roundToInt(body) },
              alpha: alpha / 255,
            }
          : null,
      sheen,
      cloth,
      shades,
      hingeRects,
      chamfers,
      codeText: {
        text: art.fileCode,
        x: palette.hingeWidth + unit * 3,
        y: body - unit * 4.6,
        size: palette.codeSize,
        letterSpacing: palette.codeSpacing,
        color: toneColor(palette.highlight, WENKU_VOLUME.codeAlpha, ink * detail),
        alpha: 1,
        monospace: true,
        bold: false,
      },
    },
  };
}

/* ───────────────────────────── 地面 ───────────────────────────── */

/** `buildFloor`：六边形地面 + 右上 10% 墨水 → 左下的渐变。 */
export function floorPlan(metrics: ShelfMetrics, palette: ShelfPalette): FloorPlan {
  const depth: Vec2 = {
    x: metrics.coverPx * WENKU_SHELF.depthX,
    y: metrics.coverPx * WENKU_SHELF.depthY,
  };
  const front: Vec2 = { x: metrics.spinePx, y: 1.4 * metrics.density };
  const tail: Vec2 = { x: -10 * metrics.density, y: 10 * metrics.density };
  const points: Vec2[] = [
    { x: 0, y: 0 },
    { x: front.x, y: front.y },
    { x: front.x + depth.x, y: front.y + depth.y },
    { x: depth.x, y: depth.y },
    { x: depth.x + tail.x, y: depth.y + tail.y },
    { x: tail.x, y: tail.y },
  ];
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return {
    points,
    bounds: { left, top, right, bottom },
    gradient: {
      x0: right,
      y0: top,
      x1: left,
      y1: bottom,
      stops: [
        { color: withAlpha(palette.floorInk, 0.1), position: 0 },
        { color: withAlpha(palette.floorInk, 0), position: 1 },
      ],
    },
  };
}
