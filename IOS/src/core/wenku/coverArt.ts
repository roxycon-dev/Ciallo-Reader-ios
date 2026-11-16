/**
 * Kotlin → TS 行号映射
 * ─────────────────────
 * `ui/wenku/ShelfCoverArt.kt`
 *   L43-50    blend(from, to, fraction)                 → blendColor
 *   L53-55    shade(color, fraction)                    → shadeColor
 *   L57-58    luminance(color)                          → luminance
 *   L61-62    inkOn(color)                              → inkOn
 *   L70-95    rasterizeShelfCover（centerCrop 光栅化）    → rasterizeShelfCoverPlan
 *   L101-224  generateShelfCover                        → generatedCoverPlan
 *   L225-234  buildShelfLayout（StaticLayout 参数）      → 计划里的 title.maxLines/lineSpacing + TextMeasure
 *   L236-237  withAlphaInt                              → withAlphaInt
 *   L240-261  dominantEdgeColor                         → dominantEdgeColorPlan
 * `ui/wenku/ShelfVolumeRender.kt`
 *   L314-317  Paint.tone(base, alpha, ink)              → toneColor
 *   L552-568  clothTile()（java.util.Random(11)）        → clothTilePixels
 * `ui/wenku/ArchiveShelf.kt`
 *   L1030-1056 ShelfCoverStore（LinkedHashMap LRU）      → ShelfCoverStore
 *   L1342-1345 withAlpha(color, alpha)                  → withAlpha
 *   L1097-1102 fallbackTint                             → fallbackTint（volumeRender.ts 里用）
 * `ui/wenku/WenkuFlightBridge.kt`
 *   L94-104   fitWenkuCover                             → fitWenkuCover
 *   L114-135  cropCoverToAspect                         → cropCoverToAspectPlan
 *
 * 未移植（纯平台绘制 API，只输出参数）：
 * - `Bitmap.createBitmap` / `Canvas.drawBitmap` / `drawable.setBounds`：本层输出
 *   `RasterCoverPlan`（目标尺寸、scale、平移、clip），由 UI 用 Canvas/OffscreenCanvas 执行。
 * - `StaticLayout.Builder` / `TextPaint.measureText` / `TextUtils.ellipsize`：本层输出
 *   `TextMeasure` / `MeasureTextWidth` 回调所需参数（字号、宽度、最多 4 行、行距 1.12）。
 * - `Bitmap.getPixel`：本层输出 `EdgeColorSamplePlan`，采样由 UI 读像素后交回 `averageRgb`。
 */

import { clamp, roundToInt, truncToInt } from './motion';
import { WENKU_COVER_ART, WENKU_VOLUME } from './tokens';
import type {
  BitmapSize,
  ColorArgb,
  CoverCropPlan,
  CoverTextureId,
  EdgeColorSamplePlan,
  GeneratedCoverInput,
  GeneratedCoverPlan,
  LinearGradientPlan,
  MeasureTextWidth,
  RasterCoverPlan,
  RectF,
  TextMeasure,
} from './types';

/** `Color.alpha`（0..255）。 */
export function alphaOf(color: ColorArgb): number {
  return (color >>> 24) & 0xff;
}

/** `Color.red`。 */
export function redOf(color: ColorArgb): number {
  return (color >>> 16) & 0xff;
}

/** `Color.green`。 */
export function greenOf(color: ColorArgb): number {
  return (color >>> 8) & 0xff;
}

/** `Color.blue`。 */
export function blueOf(color: ColorArgb): number {
  return color & 0xff;
}

/** `Color.argb(a, r, g, b)`；四通道按 Kotlin 语义截断到 0..255。 */
export function argb(a: number, r: number, g: number, b: number): ColorArgb {
  const aa = clamp(truncToInt(a), 0, 255);
  const rr = clamp(truncToInt(r), 0, 255);
  const gg = clamp(truncToInt(g), 0, 255);
  const bb = clamp(truncToInt(b), 0, 255);
  return ((aa << 24) | (rr << 16) | (gg << 8) | bb) >>> 0;
}

export const COLOR_WHITE = 0xffffffff;
export const COLOR_BLACK = 0xff000000;
export const COLOR_TRANSPARENT = 0x00000000;
export const COLOR_DKGRAY = 0xff444444;

/** `blend(from, to, fraction)`：四通道各自线性插值后 `toInt()`（向零截断）。 */
export function blendColor(from: ColorArgb, to: ColorArgb, fraction: number): ColorArgb {
  const f = clamp(fraction, 0, 1);
  const a = truncToInt(alphaOf(from) + (alphaOf(to) - alphaOf(from)) * f);
  const r = truncToInt(redOf(from) + (redOf(to) - redOf(from)) * f);
  const g = truncToInt(greenOf(from) + (greenOf(to) - greenOf(from)) * f);
  const b = truncToInt(blueOf(from) + (blueOf(to) - blueOf(from)) * f);
  return argb(a, r, g, b);
}

/** `fraction > 0` 提亮、`< 0` 压暗。 */
export function shadeColor(color: ColorArgb, fraction: number): ColorArgb {
  return fraction >= 0
    ? blendColor(color, COLOR_WHITE, fraction)
    : blendColor(color, COLOR_BLACK, -fraction);
}

/** `(0.2126 R + 0.7152 G + 0.0722 B) / 255`。 */
export function luminance(color: ColorArgb): number {
  return (
    (0.2126 * redOf(color) + 0.7152 * greenOf(color) + 0.0722 * blueOf(color)) / 255
  );
}

/** 亮底用墨色字，暗底用纸色字。 */
export function inkOn(color: ColorArgb): ColorArgb {
  return luminance(color) > 0.58 ? argb(255, 32, 30, 26) : argb(255, 246, 243, 236);
}

/** `(color and 0x00ffffff) or ((alpha * 255).toInt() shl 24)`。 */
export function withAlphaInt(color: ColorArgb, alpha: number): ColorArgb {
  const a = truncToInt(clamp(alpha, 0, 1) * 255);
  return (((color & 0x00ffffff) | (a << 24)) >>> 0) as ColorArgb;
}

/** `ArchiveShelf.kt` L1342：保留原 alpha 并按比例缩放。 */
export function withAlpha(color: ColorArgb, alpha: number): ColorArgb {
  const a = clamp(roundToInt(alphaOf(color) * alpha), 0, 255);
  return (((color & 0x00ffffff) | (a << 24)) >>> 0) as ColorArgb;
}

/** `Paint.tone(base, alpha, ink)`：`round(alpha * ink * 255)` 作为新的 alpha。 */
export function toneColor(base: ColorArgb, alpha: number, ink: number): ColorArgb {
  const combined = clamp(
    roundToInt(clamp(alpha, 0, 1) * clamp(ink, 0, 1) * 255),
    0,
    255,
  );
  return (((base & 0x00ffffff) | (combined << 24)) >>> 0) as ColorArgb;
}

/* ───────────────────────────── 封面栅格化 ───────────────────────────── */

/**
 * `rasterizeShelfCover` 的纯几何版本：`centerCrop` 到 `widthPx × heightPx`。
 * 返回 null 等价于 Kotlin 的"没有可画内容"分支（尺寸非法 / painter 未 Success / drawable 为空）。
 */
export function rasterizeShelfCoverPlan(
  intrinsic: BitmapSize | null,
  widthPx: number,
  heightPx: number,
): RasterCoverPlan | null {
  if (widthPx <= 0 || heightPx <= 0) return null;
  const intrinsicWidth = intrinsic !== null && intrinsic.width > 0 ? intrinsic.width : widthPx;
  const intrinsicHeight = intrinsic !== null && intrinsic.height > 0 ? intrinsic.height : heightPx;
  if (intrinsic === null) return null;
  const scale = Math.max(widthPx / intrinsicWidth, heightPx / intrinsicHeight);
  const drawnWidth = Math.max(truncToInt(intrinsicWidth * scale), 1);
  const drawnHeight = Math.max(truncToInt(intrinsicHeight * scale), 1);
  const translateX = (widthPx - drawnWidth) * 0.5;
  const translateY = (heightPx - drawnHeight) * 0.5;
  return {
    width: widthPx,
    height: heightPx,
    scale,
    drawnWidth,
    drawnHeight,
    translateX,
    translateY,
    clip: { left: 0, top: 0, right: widthPx, bottom: heightPx },
    bounds: { left: 0, top: 0, right: drawnWidth, bottom: drawnHeight },
  };
}

/**
 * `cropCoverToAspect` 的裁切计划。
 * 返回 null = Kotlin 里 "比例已经在 2% 以内，原图直接用" 的分支。
 */
export function cropCoverToAspectPlan(
  image: BitmapSize | null,
  bounds: { readonly width: number; readonly height: number },
): CoverCropPlan | null {
  if (image === null) return null;
  if (image.width <= 0 || image.height <= 0) return null;
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const targetAspect = bounds.width / bounds.height;
  const sourceAspect = image.width / image.height;
  if (Math.abs(targetAspect - sourceAspect) / sourceAspect < WENKU_COVER_ART.aspectTolerance) {
    return null;
  }
  const cropWidth =
    sourceAspect > targetAspect ? truncToInt(image.height * targetAspect) : image.width;
  const cropHeight =
    sourceAspect > targetAspect ? image.height : truncToInt(image.width / targetAspect);
  const width = clamp(cropWidth, 1, image.width);
  const height = clamp(cropHeight, 1, image.height);
  const x = truncToInt((image.width - width) / 2);
  const y = truncToInt((image.height - height) / 2);
  return { crop: { left: x, top: y, right: x + width, bottom: y + height } };
}

/** `fitWenkuCover`：等比塞进 bounds 并保持中心不动。 */
export function fitWenkuCover(bounds: RectF, cover: BitmapSize): RectF {
  if (cover.width <= 0 || cover.height <= 0) return bounds;
  const scale = Math.min(
    (bounds.right - bounds.left) / cover.width,
    (bounds.bottom - bounds.top) / cover.height,
  );
  const halfWidth = (cover.width * scale) / 2;
  const halfHeight = (cover.height * scale) / 2;
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  return {
    left: centerX - halfWidth,
    top: centerY - halfHeight,
    right: centerX + halfWidth,
    bottom: centerY + halfHeight,
  };
}

/* ───────────────────────────── 生成封面 ───────────────────────────── */

function coverPalette(dark: boolean): {
  readonly paperTop: ColorArgb;
  readonly paperBottom: ColorArgb;
  readonly tint: ColorArgb;
  readonly ink: ColorArgb;
  readonly muted: ColorArgb;
} {
  return dark
    ? {
        paperTop: WENKU_COVER_ART.backgroundTopDark,
        paperBottom: WENKU_COVER_ART.backgroundBottomDark,
        tint: WENKU_COVER_ART.tintDark,
        ink: WENKU_COVER_ART.inkDark,
        muted: WENKU_COVER_ART.mutedDark,
      }
    : {
        paperTop: WENKU_COVER_ART.backgroundTopLight,
        paperBottom: WENKU_COVER_ART.backgroundBottomLight,
        tint: WENKU_COVER_ART.tintLight,
        ink: WENKU_COVER_ART.inkLight,
        muted: WENKU_COVER_ART.mutedLight,
      };
}

/**
 * `generateShelfCover` 的完整绘制计划。
 *
 * `measure` / `measureTextWidth` 是平台文本测量的注入点：书名最多 4 行、放不下按 ×.88
 * 缩字号（最多 6 次），这个循环的判据（`height > h * .46 || lineCount > 4`）逐字照搬；
 * 文本宽度只用于居中（Kotlin 用 `Paint.measureText`）。
 */
export function generatedCoverPlan(
  input: GeneratedCoverInput,
  measure: TextMeasure,
  measureTextWidth: MeasureTextWidth,
): GeneratedCoverPlan {
  const width = Math.max(input.widthPx, WENKU_COVER_ART.minWidth);
  const height = Math.max(input.heightPx, WENKU_COVER_ART.minHeight);
  const unit = Math.max(width / WENKU_COVER_ART.unitBase, 1);
  const palette = coverPalette(input.dark);

  const backgroundGradient: LinearGradientPlan = {
    x0: 0,
    y0: 0,
    x1: width * 0.45,
    y1: height,
    stops: [
      { color: palette.paperTop, position: 0 },
      { color: palette.paperBottom, position: 1 },
    ],
  };
  const lightGradient: LinearGradientPlan = {
    x0: width,
    y0: 0,
    x1: 0,
    y1: height * 0.8,
    stops: [
      { color: withAlphaInt(palette.tint, WENKU_COVER_ART.brandGlowAlpha), position: 0 },
      { color: COLOR_TRANSPARENT, position: 1 },
    ],
  };

  const borderWidth = Math.max(WENKU_COVER_ART.borderMinWidth, unit * WENKU_COVER_ART.borderUnit);
  const borderColor = withAlphaInt(
    palette.ink,
    input.dark ? WENKU_COVER_ART.borderAlphaDark : WENKU_COVER_ART.borderAlphaLight,
  );

  const iconW = width * WENKU_COVER_ART.iconWidthRate;
  const iconH = iconW * WENKU_COVER_ART.iconHeightRate;
  const iconX = (width - iconW) * 0.5;
  const iconY = height * WENKU_COVER_ART.iconTopRate;
  const icon = {
    rect: { left: iconX, top: iconY, right: iconX + iconW, bottom: iconY + iconH },
    strokeWidth: Math.max(WENKU_COVER_ART.iconStrokeMin, unit * WENKU_COVER_ART.iconStrokeUnit),
    color: withAlphaInt(palette.tint, WENKU_COVER_ART.iconAlpha),
    radius: unit * WENKU_COVER_ART.iconRadiusUnit,
    spineLine: {
      x0: iconX + iconW * 0.5,
      y0: iconY + unit * 1.2,
      x1: iconX + iconW * 0.5,
      y1: iconY + iconH - unit * 1.2,
    },
  };

  const titleWidth = Math.max(
    truncToInt(width * WENKU_COVER_ART.titleWidthRate),
    WENKU_COVER_ART.titleMinWidth,
  );
  let textSize = unit * WENKU_COVER_ART.titleSizeUnit;
  let layout = measure(input.title, textSize, titleWidth, WENKU_COVER_ART.titleMaxLines);
  let attempts = 0;
  while (
    (layout.height > height * WENKU_COVER_ART.titleMaxHeightRate ||
      layout.lineCount > WENKU_COVER_ART.titleMaxLines) &&
    attempts < WENKU_COVER_ART.titleMaxAttempts
  ) {
    textSize *= WENKU_COVER_ART.titleShrink;
    layout = measure(input.title, textSize, titleWidth, WENKU_COVER_ART.titleMaxLines);
    attempts += 1;
  }

  const ruleY = height * WENKU_COVER_ART.ruleYRate;
  const authorText = input.author.length === 0 ? '\u2014' : input.author;
  const authorSize = unit * WENKU_COVER_ART.authorSizeUnit;
  const authorWidth = measureTextWidth(authorText, authorSize, WENKU_COVER_ART.authorLetterSpacing);
  const tagSize = unit * WENKU_COVER_ART.tagSizeUnit;
  const tagWidth = measureTextWidth(input.tag, tagSize, WENKU_COVER_ART.tagLetterSpacing);
  const tagColor = withAlphaInt(
    input.tag === 'COMIC' ? WENKU_COVER_ART.tagComicColor : palette.tint,
    WENKU_COVER_ART.tagAlpha,
  );

  return {
    width,
    height,
    unit,
    paperTop: palette.paperTop,
    paperBottom: palette.paperBottom,
    tint: palette.tint,
    ink: palette.ink,
    muted: palette.muted,
    backgroundGradient,
    lightGradient,
    border: {
      rect: { left: 0.5, top: 0.5, right: width - 0.5, bottom: height - 0.5 },
      width: borderWidth,
      color: borderColor,
    },
    icon,
    title: {
      text: input.title,
      textSize,
      widthPx: titleWidth,
      translateX: (width - titleWidth) * 0.5,
      translateY: height * WENKU_COVER_ART.titleTopRate,
      maxLines: WENKU_COVER_ART.titleMaxLines,
      lineSpacingMultiplier: WENKU_COVER_ART.titleLineSpacing,
      attempts,
      color: palette.ink,
    },
    rule: {
      segment: { x0: width * 0.18, y0: ruleY, x1: width * 0.82, y1: ruleY },
      width: Math.max(WENKU_COVER_ART.ruleMinWidth, unit * WENKU_COVER_ART.ruleUnit),
      color: withAlphaInt(palette.muted, WENKU_COVER_ART.ruleAlpha),
    },
    author: {
      text: authorText,
      textSize: authorSize,
      letterSpacing: WENKU_COVER_ART.authorLetterSpacing,
      color: withAlphaInt(palette.muted, WENKU_COVER_ART.authorAlpha),
      x: (width - authorWidth) * 0.5,
      y: ruleY + unit * WENKU_COVER_ART.authorBaselineUnit,
      maxWidthPx: width * WENKU_COVER_ART.authorWidthRate,
    },
    tag: {
      text: input.tag,
      textSize: tagSize,
      letterSpacing: WENKU_COVER_ART.tagLetterSpacing,
      color: tagColor,
      x: (width - tagWidth) * 0.5,
      y: height - height * WENKU_COVER_ART.tagBottomRate,
    },
  };
}

/* ───────────────────────────── 书脊取色 ───────────────────────────── */

/** `dominantEdgeColor` 的采样计划：左侧 16% 竖带、纵向 ≤24 步、横向 ≤6 步。 */
export function dominantEdgeColorPlan(width: number, height: number): EdgeColorSamplePlan {
  const sampleWidth = Math.max(truncToInt(width * WENKU_COVER_ART.edgeSampleWidthRate), 1);
  const stepY = Math.max(truncToInt(height / WENKU_COVER_ART.edgeSampleRows), 1);
  const stepX = Math.max(truncToInt(sampleWidth / WENKU_COVER_ART.edgeSampleColumns), 1);
  const rows = Math.ceil(height / stepY);
  const columns = Math.ceil(sampleWidth / stepX);
  return { sampleWidth, stepX, stepY, count: rows * columns };
}

/** 采样结果求均值（UI 读像素后调用）：没有样本时回 `Color.DKGRAY`。 */
export function averageEdgeColor(
  samples: readonly { readonly r: number; readonly g: number; readonly b: number }[],
): ColorArgb {
  if (samples.length === 0) return WENKU_COVER_ART.edgeFallbackColor;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const sample of samples) {
    r += sample.r;
    g += sample.g;
    b += sample.b;
  }
  return argb(255, truncToInt(r / samples.length), truncToInt(g / samples.length), truncToInt(b / samples.length));
}

/* ───────────────────────────── 布纹 ───────────────────────────── */

/**
 * `java.util.Random` 的 48 位 LCG（`java.util.Random(seed)` 的 `nextInt(bound)` 语义）。
 * 用它而不是 Math.random：`clothTile()` 的结果必须逐像素确定，才能和 Android 端对齐。
 */
class JavaRandom {
  private seed: bigint;

  constructor(seed: number) {
    this.seed = (BigInt(Math.trunc(seed)) ^ 0x5deece66dn) & 0xffffffffffffn;
  }

  private next(bits: number): number {
    this.seed = (this.seed * 0x5deece66dn + 0xbn) & 0xffffffffffffn;
    return Number(this.seed >> BigInt(48 - bits));
  }

  nextInt(bound: number): number {
    if (bound <= 0) throw new Error('bound must be positive');
    if ((bound & -bound) === bound) {
      return Math.trunc((bound * this.next(31)) / 0x80000000);
    }
    for (;;) {
      const bits = this.next(31);
      const value = bits % bound;
      if (((bits - value + (bound - 1)) | 0) >= 0) return value;
    }
  }
}

/**
 * `clothTile()`：48×48 的布纹 ARGB 像素（横竖交织，不是噪点）。
 * UI 层用 `putImageData` 一次性贴图，绘制期只做 BitmapShader 平铺。
 */
export function clothTilePixels(size: number = WENKU_VOLUME.clothTileSize): ColorArgb[] {
  const random = new JavaRandom(WENKU_VOLUME.clothTileSeed);
  const pixels: ColorArgb[] = new Array<ColorArgb>(size * size).fill(0);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const weave = (x + y) % 2 === 0 ? WENKU_VOLUME.clothTileWeaveEven : WENKU_VOLUME.clothTileWeaveOdd;
      const value = clamp(
        WENKU_VOLUME.clothTileBase +
          random.nextInt(WENKU_VOLUME.clothTileJitter) -
          WENKU_VOLUME.clothTileCenter +
          weave,
        0,
        255,
      );
      const alpha = WENKU_VOLUME.clothTileAlphaBase + random.nextInt(WENKU_VOLUME.clothTileAlphaJitter);
      pixels[y * size + x] = argb(alpha, value, value, value);
    }
  }
  return pixels;
}

/* ───────────────────────────── 封面 LRU ───────────────────────────── */

/**
 * `ShelfCoverStore`：访问序 LRU（Kotlin `LinkedHashMap(16, .75f, true)`）。
 * core 层不持有像素，只持有贴图身份与书脊色；容量 / 占位标记 / 淘汰顺序与原实现一致。
 */
export class ShelfCoverStore<T extends CoverTextureId = CoverTextureId> {
  private readonly capacity: number;
  private readonly entries = new Map<number, T>();
  private readonly tints = new Map<number, ColorArgb>();
  private readonly placeholders = new Set<number>();

  constructor(capacity = 64) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.entries.size;
  }

  get(bookId: number): T | null {
    const value = this.entries.get(bookId);
    if (value === undefined) return null;
    // LinkedHashMap 的 accessOrder：读一次就挪到队尾。
    this.entries.delete(bookId);
    this.entries.set(bookId, value);
    return value;
  }

  isPlaceholder(bookId: number): boolean {
    return this.placeholders.has(bookId);
  }

  tintOf(bookId: number): ColorArgb | null {
    return this.tints.get(bookId) ?? null;
  }

  /** `put(bookId, image, placeholder)`：书脊色由 UI 用 `dominantEdgeColorPlan` 采样后传入。 */
  put(bookId: number, image: T, tint: ColorArgb, placeholder = false): void {
    this.entries.set(bookId, image);
    if (placeholder) this.placeholders.add(bookId);
    else this.placeholders.delete(bookId);
    this.tints.set(bookId, tint);
    while (this.entries.size > this.capacity) {
      const eldest = this.entries.keys().next();
      if (eldest.done === true) break;
      const key = eldest.value;
      this.placeholders.delete(key);
      this.tints.delete(key);
      this.entries.delete(key);
    }
  }

  /** 只用于测试/诊断：按访问序返回键。 */
  keys(): number[] {
    return [...this.entries.keys()];
  }
}
