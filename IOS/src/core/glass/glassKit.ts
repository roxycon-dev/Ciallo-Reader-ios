/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/glasskit/GlassKit.kt` (423 non-blank lines)
 *
 *   lines 83-144  object GlassTokens (radius / blur / tint / spacing) → GlassTokens
 *   lines 158-179 class SquircleShape + lines 184-203 squirclePath → squirclePath()
 *   line 182      GlassCardShape → GLASS_CARD_SHAPE
 *   line 208      LocalGlassKitBackdrop → context in components/glasskit/GlassKit.tsx
 *   lines 222-281 GlassKitHost → GlassKitHost component
 *   lines 291-302 rememberReduceTransparency → prefersReducedTransparency() (liquidGlass.ts)
 *   lines 315-443 GlassKitCard → GlassKitCard component
 *   lines 454-496 GlassTopBarStrip → GlassTopBarStrip component
 *
 * ADAPTATION — continuous-curvature corner → SVG / CSS
 * ───────────────────────────────────────────────────
 * `SquircleShape` builds a three-segment bezier superellipse.  The web equivalent
 * is `paint()`/`clip-path` with an SVG `path` — the exact same control-point
 * ratio (k = r * 0.72) is reused so the corner curvature matches iOS.
 *
 * `drawBackdrop{vibrancy, blur, lens}` → `backdrop-filter: saturate() blur()`.
 * The `lens()` refraction is approximated (see core/glass/liquidGlass.ts).
 *
 * `rememberLayerBackdrop()` (a GPU texture capture of everything drawn behind) has
 * no web analogue.  CSS `backdrop-filter` samples the real composited backdrop for
 * free, so the *effect* is preserved without the capture layer — the one thing
 * lost is being able to composite the overlay mask *into* the captured texture
 * (GlassKit.kt lines 212-219), which CSS instead solves by nesting the overlay
 * outside the glass surface. Documented in the report.
 */

import type { RenderQualityName } from './renderQuality';

/** GlassKit.kt lines 83-144 — design tokens for the GlassKit family. */
export const GlassTokens = {
  /** Kotlin L89 `val ManagementTitleHeight = 152.dp` —— 管理页大标题区（不含状态栏）。 */
  ManagementTitleHeight: 152,
  /** 大卡圆角（连续曲率）。 */
  Radius: 24,
  /** 头像 / 输入框等小元素。 */
  InnerRadius: 12,
  /** 快捷入口的淡染图标底。 */
  IconRadius: 10,
  /** 玻璃模糊半径。 */
  Blur: 16,
  /**
   * 轻量档模糊（用于"正在做尺寸/显隐动画"的卡片）。
   * 展开/收起动画期间只保留 blur(8)，静止后再切回完整效果。
   */
  BlurLightweight: 8,
  /** 折射作用宽度（克制）。 */
  LensHeight: 14,
  /** 折射强度（过大会变成哈哈镜）。 */
  LensAmount: 22,
  /**
   * 着色：中性白 / 中性深，**不用强调色、不用渐变**。
   * - 亮色：白 22%（最坏纯黑壁纸 → 卡片有效亮度 ≈ 0.345 → onSurface 对比 ≈ 6.1:1 ✓）
   * - 深色：surface 中性深 0.78（最坏纯白壁纸 → 卡片亮度 ≈ 0.17 → 白字 ≈ 4.7:1 ✓）
   */
  TintLight: 0.22,
  TintDark: 0.78,
  /** 降低透明度 / 高对比度开启时的着色（几乎不透明）。 */
  TintReduce: 0.92,
  /** 壁纸全局遮罩（画在录制层内）。 */
  PageOverlayLight: 0.16,
  PageOverlayDark: 0.4,
  /** 顶部渐变遮罩（保护大标题与返回箭头）。 */
  TopGradientAlpha: 0.75,
  RowMinHeight: 60,
  ScreenPadding: 16,
  CardGap: 12,
  ChipHeight: 26,
  /** 导入行（虚线）圆角。 */
  PillRadius: 20,
  /** 折叠顶栏高度（不含状态栏，状态栏由调用方补）。 */
  TopBarHeight: 64,
  /** 折叠顶栏的玻璃模糊（比卡片弱，只是薄薄一层）。 */
  TopBarBlur: 8,
  /** 细分割线。 */
  Hairline: 0.5,
} as const;

/**
 * GlassKit.kt lines 184-203 `squirclePath(size, r)` —
 * 连续曲率圆角矩形（超椭圆近似）。
 * 控制点比例：0.5522 = 正圆；取 0.72 让曲线更"饱满"，接近超椭圆的连续曲率。
 */
export function squirclePath(width: number, height: number, r: number): string {
  if (r <= 0) {
    return `M0,0 H${width} V${height} H0 Z`;
  }
  const w = width;
  const h = height;
  // 控制点比例：0.5522 = 正圆；取 0.72 让曲线更"饱满"，接近超椭圆的连续曲率
  const k = r * 0.72;
  return (
    `M${r},0 ` +
    `L${w - r},0 ` +
    `C${w - r + k},0 ${w},${r - k} ${w},${r} ` +
    `L${w},${h - r} ` +
    `C${w},${h - r + k} ${w - r + k},${h} ${w - r},${h} ` +
    `L${r},${h} ` +
    `C${r - k},${h} 0,${h - r + k} 0,${h - r} ` +
    `L0,${r} ` +
    `C0,${r - k} ${r - k},0 ${r},0 Z`
  );
}

/**
 * GlassKit.kt line 168 `SquircleShape.createOutline` clamps the corner radius to
 * half the shorter side. Ported for parity with the Kotlin `minOf(w,h)/2`.
 */
export function squircleRadiusFor(width: number, height: number, r: number): number {
  const max = Math.min(width, height) / 2;
  return Math.max(0, Math.min(r, max));
}

/**
 * CSS `paint()` worklet source implementing the same squircle, used as
 * `border-radius` fallback + a drop shadow shape.  Kept as a string so it can be
 * injected once; browsers without `paint()` fall back to `border-radius: 24px`,
 * which is a documented approximation (loses the continuous curvature only).
 */
export const SQUIRCLE_PAINT_SOURCE = `
registerPaint('cialloSquircle', {
  ctx: '2d',
  props: {
    r: { syntax: '<length>', initialValue: '24px' },
  },
  paint(geom, props) {
    const r = Math.min(parseFloat(props.r), geom.width / 2, geom.height / 2);
    const k = r * 0.72;
    const w = geom.width, h = geom.height;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.bezierCurveTo(w - r + k, 0, w, r - k, w, r);
    ctx.lineTo(w, h - r);
    ctx.bezierCurveTo(w, h - r + k, w - r + k, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.bezierCurveTo(r - k, h, 0, h - r + k, 0, h - r);
    ctx.lineTo(0, r);
    ctx.bezierCurveTo(0, r - k, r - k, 0, r, 0);
    ctx.closePath();
    ctx.fill();
  },
});
`;

/**
 * GlassKit.kt lines 232-238 — the global overlay tint drawn *inside* the recorded
 * backdrop so cards sample an already-darkened background.
 * The web can't bake it into a capture layer, so it is a sibling element between
 * the wallpaper and the cards; see `GlassKitHost` in the component.
 */
export function pageOverlayColor(dark: boolean): string {
  return dark
    ? `rgba(0, 0, 0, ${GlassTokens.PageOverlayDark})`
    : `rgba(255, 255, 255, ${GlassTokens.PageOverlayLight})`;
}

/** GlassKit.kt lines 269-273 — 顶部渐变遮罩（保护大标题与返回箭头）。 */
export function topGradientCss(background: string, heightPx: number): string {
  const pct = Math.max(1, Math.min(100, (heightPx / Math.max(1, heightPx)) * 100));
  return (
    `linear-gradient(180deg, ` +
    `color-mix(in srgb, ${background} ${(GlassTokens.TopGradientAlpha * 100).toFixed(0)}%, transparent) 0%, ` +
    `rgba(255,255,255,0) ${pct.toFixed(1)}%)`
  );
}

/** GlassKit.kt lines 267-270 — solid gradient stops of the top scrim. */
export function topGradientStops(background: string): string {
  return (
    `rgba(from ${background} r g b / ${GlassTokens.TopGradientAlpha}) 0%, rgba(255,255,255,0) 100%`
  );
}

/**
 * GlassKit.kt lines 339-363 — tint selection.
 * `solidTint` (line 365) is the no-realtime-blur fallback: dark → surface 0.85,
 * light → white 0.78.
 */
export function glassKitTint(options: {
  dark: boolean;
  surface: string;
  reduceTransparency: boolean;
}): { tint: string; solidTint: string } {
  const { dark, surface, reduceTransparency } = options;
  let tint: string;
  if (reduceTransparency) {
    tint = dark ? rgbaOf(surface, GlassTokens.TintReduce) : `rgba(255, 255, 255, ${GlassTokens.TintReduce})`;
  } else if (dark) {
    tint = rgbaOf(surface, GlassTokens.TintDark);
  } else {
    tint = `rgba(255, 255, 255, ${GlassTokens.TintLight})`;
  }
  const solidTint = dark ? rgbaOf(surface, 0.85) : 'rgba(255, 255, 255, 0.78)';
  return { tint, solidTint };
}

/** GlassKit.kt lines 465-467 — the fallback branch shadow (elevation 2.dp). */
export const GLASSKIT_FALLBACK_SHADOW =
  '0 2px 6px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.12)';

/**
 * GlassKit.kt lines 355 — 满强度按压的缩放：`1f - 0.02f * 1.25f = 0.975`。
 *
 * 修正：此处原先写 `0.98`（等于 `pressStrength = 1.0`），而 `CardTweaks.kt` L23 的
 * 出厂值是 **1.25** —— 卡片实际比宣称的更深一点。保留常量给需要静态值的调用方，
 * 动态推导用 `glassKitCardPressScale()`。
 */
export const GLASSKIT_PRESS_MIN_SCALE = 1 - 0.02 * 1.25;
export const GLASSKIT_PRESS_BEZIER = 'cubic-bezier(0.2, 1.4, 0.4, 1)';
export const GLASSKIT_PRESS_MS = springSettleMsLocal(0.6, 400);

function springSettleMsLocal(dampingRatio: number, stiffness: number): number {
  return Math.round((4.605 / (dampingRatio * Math.sqrt(stiffness))) * 1000);
}

/* ── 可判定参数：宿主 / 卡片 / 顶栏 / 降级 ─────────────────────────────── */

/** Kotlin L198 `val k = r * 0.72f` —— 超椭圆控制点比例（0.5522 才是正圆）。 */
export const SQUIRCLE_CONTROL_K = 0.72;

/** Kotlin L255 `liquidGlass(…, saturation = 1.15f)` —— 宿主层的饱和度。 */
export const GLASSKIT_HOST_SATURATION = 1.15;

/**
 * Kotlin L355 `targetValue = if (pressed && !reduceMotion) 1f - 0.02f * tweaks.pressStrength else 1f`
 * —— 按压深度系数（满强度 0.02 → 0.98）。
 */
export const GLASSKIT_CARD_PRESS_DEPTH = 0.02;

/** Kotlin L356 `spring(dampingRatio = 0.6f, stiffness = 400f)`。 */
export const GLASSKIT_CARD_PRESS_SPRING = { dampingRatio: 0.6, stiffness: 400 } as const;

/**
 * Kotlin L393 `blur((tweaks.blurRadiusDp.dp * 0.5f).toPx())` ——
 * 轻量档是**卡片模糊的一半**，不是独立的 8dp 常量。
 */
export const GLASSKIT_LIGHTWEIGHT_BLUR_FACTOR = 0.5;

/**
 * Kotlin L416/L420：高光半径 `size.minDimension * 0.5f * tweaks.pressRadius`、
 * alpha `0.16f * tweaks.pressStrength`。两处都随外观设置联动。
 */
export const GLASSKIT_HIGHLIGHT_RADIUS_BASE = 0.5;
export const GLASSKIT_HIGHLIGHT_ALPHA_BASE = 0.16;

/** `CardTweaks.kt` L23-24 的出厂值（未 provide 时的回落）。 */
export const CARD_TWEAK_PRESS_STRENGTH = 1.25;
export const CARD_TWEAK_PRESS_RADIUS = 1.1;

/** Kotlin L488-491 顶栏着色 alpha：降低透明度 0.92 / 常态 0.60。 */
export const GLASSKIT_TOP_BAR_TINT_ALPHA = 0.6;
export const GLASSKIT_TOP_BAR_TINT_ALPHA_REDUCE = 0.92;

/** Kotlin L516 `cs.onSurface.copy(alpha = 0.10f * collapsedFraction)`。 */
export const GLASSKIT_TOP_BAR_DIVIDER_ALPHA = 0.1;

/**
 * Kotlin L300-306：
 * `Settings.Secure.getString(...)?.toFloatOrNull()?.let { it >= 0.5f } ?: false`，
 * 两个 key 任一为真即视为「降低透明度 / 高对比度」开启。
 */
export const GLASSKIT_REDUCE_TRANSPARENCY_KEYS = [
  'reduce_transparency',
  'high_text_contrast_enabled',
] as const;

/** Kotlin L302 的 `it >= 0.5f`。 */
export const GLASSKIT_REDUCE_THRESHOLD = 0.5;

/**
 * Kotlin `rememberReduceTransparency()` 的纯函数形态：读不到 / 解析失败一律 false
 * （Kotlin 的 `catch (_: Throwable) { false }`）。
 */
export function glassKitReducesTransparency(
  values: Readonly<Record<string, string | number | null | undefined>>,
): boolean {
  return GLASSKIT_REDUCE_TRANSPARENCY_KEYS.some((key) => {
    const raw = values[key];
    if (raw === null || raw === undefined || raw === '') return false;
    const parsed = typeof raw === 'number' ? raw : Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed >= GLASSKIT_REDUCE_THRESHOLD;
  });
}

/**
 * Kotlin L393/L396 —— 卡片这一帧的模糊半径（px）：
 * `lightweight ? tweaks.blurRadiusDp * 0.5 : tweaks.blurRadiusDp`。
 *
 * 出厂 `blurRadiusDp = 22`（`CardTweaks.kt` L12），所以轻量档是 **11**，
 * 不是 `GlassTokens.BlurLightweight` 那个 8（那个 token 在 Kotlin 里没被卡片消费）。
 */
export function glassCardBlurPx(blurRadiusDp: number, lightweight: boolean): number {
  return lightweight ? blurRadiusDp * GLASSKIT_LIGHTWEIGHT_BLUR_FACTOR : blurRadiusDp;
}

/** Kotlin L416 `radius = size.minDimension * 0.5f * tweaks.pressRadius`。 */
export function glassKitPressHighlightRadius(
  minDimensionPx: number,
  pressRadius: number = CARD_TWEAK_PRESS_RADIUS,
): number {
  return minDimensionPx * GLASSKIT_HIGHLIGHT_RADIUS_BASE * pressRadius;
}

/** Kotlin L420 `Color.White.copy(alpha = 0.16f * tweaks.pressStrength)`。 */
export function glassKitPressHighlightAlpha(
  pressStrength: number = CARD_TWEAK_PRESS_STRENGTH,
): number {
  return GLASSKIT_HIGHLIGHT_ALPHA_BASE * pressStrength;
}

/** Kotlin L355 `if (pressed && !reduceMotion) 1f - 0.02f * pressStrength else 1f`。 */
export function glassKitCardPressScale(
  pressed: boolean,
  reduceMotion: boolean,
  pressStrength: number = CARD_TWEAK_PRESS_STRENGTH,
): number {
  return pressed && !reduceMotion ? 1 - GLASSKIT_CARD_PRESS_DEPTH * pressStrength : 1;
}

/** Kotlin L488-492 `if (reduce) background@0.92 else background@0.60`。 */
export function glassTopBarTintAlpha(reduceTransparency: boolean): number {
  return reduceTransparency ? GLASSKIT_TOP_BAR_TINT_ALPHA_REDUCE : GLASSKIT_TOP_BAR_TINT_ALPHA;
}

/** Kotlin L516 `0.10f * collapsedFraction`（展开时分割线完全不可见）。 */
export function glassTopBarDividerAlpha(collapsedFraction: number): number {
  return GLASSKIT_TOP_BAR_DIVIDER_ALPHA * collapsedFraction;
}

/** GlassKit.kt lines 399-411 — interactive highlight follows the finger. */
export function pressHighlightCss(
  xPx: number,
  yPx: number,
  minDimensionPx: number,
  pressRadius: number = CARD_TWEAK_PRESS_RADIUS,
  pressStrength: number = CARD_TWEAK_PRESS_STRENGTH,
): string {
  const r = glassKitPressHighlightRadius(minDimensionPx, pressRadius);
  const alpha = glassKitPressHighlightAlpha(pressStrength);
  return (
    `background-image:radial-gradient(circle ${r.toFixed(1)}px at ${xPx.toFixed(1)}px ${yPx.toFixed(1)}px,` +
    `rgba(255,255,255,${alpha.toFixed(2)}) 0%,rgba(255,255,255,0) 100%);` +
    `mix-blend-mode:screen;`
  );
}

function rgbaOf(hex: string, a: number): string {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return `rgba(255, 255, 255, ${a})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * ui/reader/ReadingGlass.kt（46 行）—— 阅读层内表面的玻璃光学
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Kotlin `Modifier.readingGlass(shape, tint, strong)`：
 *   L35 `if (quality.minimal) return clip(shape).background(tint ?: style.tint)`
 *   L36 `surface = tint ?: style.tint.copy(alpha = if (strong) .72f else .60f)`
 *   L37 `radius = if (quality <= RenderQuality.LOW) 10f else if (strong) 22f else 16f`
 *   L38-41 `drawPlainBackdrop { colorControls(saturation = 1.10f); blur(radius.dp.toPx()) }`
 *   L43 `.background(if (backdrop == null) surface.copy(alpha = .84f) else surface)`
 *   L44 `.background(linearGradient(white@.13, white@.025, ink@.045))`
 *   L45 `.border(.7.dp, ink@.13f, shape)`
 *
 * `ReadingGlassStyle(backdrop, tint = 0xFF232329, ink = White)`（L23）与
 * `LocalReadingGlass`（L24）是 CompositionLocal —— Web 侧对应 `--rd-*` 自定义属性的继承，
 * 所以本文件只保留**可判定**的那半：档位 → 模糊半径 / 着色 alpha / 描边。
 * ⚠️ `ui/pages/ReaderPage.tsx` 的 `.rd-sheet--settings` 目前仍用 `--rd-surface-93`
 * 的平面半透明底（不是这一层光学），落差见 docs/PARITY_EXCEPTIONS.md E110。
 */

/** Kotlin L23 `ReadingGlassStyle.tint = Color(0xFF232329)`。 */
export const READING_GLASS_DEFAULT_TINT = '#232329';

/** Kotlin L36 `if (strong) .72f else .60f`。 */
export const READING_GLASS_STRONG_ALPHA = 0.72;
export const READING_GLASS_ALPHA = 0.6;

/** Kotlin L43 —— 没有 backdrop 可采样时，着色自己抬高到 .84。 */
export const READING_GLASS_NO_BACKDROP_ALPHA = 0.84;

/** Kotlin L40 `colorControls(saturation = 1.10f)`。 */
export const READING_GLASS_SATURATION = 1.1;

/** Kotlin L37 三档模糊半径（dp ≈ px）。 */
export const READING_GLASS_BLUR_LOW = 10;
export const READING_GLASS_BLUR = 16;
export const READING_GLASS_BLUR_STRONG = 22;

/** Kotlin L44 渐变三层 alpha：white .13 / white .025 / ink .045。 */
export const READING_GLASS_SHEEN_ALPHAS = [0.13, 0.025, 0.045] as const;

/** Kotlin L45 `.border(.7.dp, ink.copy(alpha = .13f), shape)`。 */
export const READING_GLASS_BORDER_WIDTH = 0.7;
export const READING_GLASS_BORDER_ALPHA = 0.13;

export interface ReadingGlassPaint {
  /** Kotlin L35 极简档：只有 `clip + background(tint)`，没有模糊/渐变/描边。 */
  readonly solid: boolean;
  /** 背景模糊半径（px）；0 = 不采样背景。 */
  readonly blurRadiusPx: number;
  /** `colorControls` 的饱和度倍数。 */
  readonly saturation: number;
  /** 着色 alpha（= tint 的 alpha，或 strong 档的 .72；无 backdrop 时 .84）。 */
  readonly tintAlpha: number;
  /** 高光渐变的三个 alpha（white / white / ink）。 */
  readonly sheenAlphas: readonly [number, number, number];
  readonly borderWidthPx: number;
  readonly borderAlpha: number;
}

/**
 * Kotlin `Modifier.readingGlass` 的纯数据形态：给定画质档 / `strong` / 是否有 backdrop，
 * 算出这一层要画什么。UI 侧据此拼 `backdrop-filter: saturate(1.1) blur(Npx)` +
 * 两段 `background` + `border`。
 */
export function readingGlassPaint(
  quality: RenderQualityName,
  strong: boolean,
  hasBackdrop: boolean,
): ReadingGlassPaint {
  if (quality === 'MINIMAL') {
    return {
      solid: true,
      blurRadiusPx: 0,
      saturation: 1,
      tintAlpha: 1,
      sheenAlphas: [0, 0, 0],
      borderWidthPx: 0,
      borderAlpha: 0,
    };
  }
  const blurRadiusPx =
    quality === 'LOW'
      ? READING_GLASS_BLUR_LOW
      : strong
        ? READING_GLASS_BLUR_STRONG
        : READING_GLASS_BLUR;
  const base = strong ? READING_GLASS_STRONG_ALPHA : READING_GLASS_ALPHA;
  return {
    solid: false,
    blurRadiusPx: hasBackdrop ? blurRadiusPx : 0,
    saturation: READING_GLASS_SATURATION,
    tintAlpha: hasBackdrop ? base : READING_GLASS_NO_BACKDROP_ALPHA,
    sheenAlphas: READING_GLASS_SHEEN_ALPHAS,
    borderWidthPx: READING_GLASS_BORDER_WIDTH,
    borderAlpha: READING_GLASS_BORDER_ALPHA,
  };
}