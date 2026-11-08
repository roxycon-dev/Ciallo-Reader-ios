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

/** GlassKit.kt lines 83-144 — design tokens for the GlassKit family. */
export const GlassTokens = {
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

/** GlassKit.kt lines 339-343 — press scale 0.98 ↔ 1.0, spring(0.6, 400). */
export const GLASSKIT_PRESS_MIN_SCALE = 0.98;
export const GLASSKIT_PRESS_BEZIER = 'cubic-bezier(0.2, 1.4, 0.4, 1)';
export const GLASSKIT_PRESS_MS = springSettleMsLocal(0.6, 400);

function springSettleMsLocal(dampingRatio: number, stiffness: number): number {
  return Math.round((4.605 / (dampingRatio * Math.sqrt(stiffness))) * 1000);
}

/** GlassKit.kt lines 399-411 — interactive highlight follows the finger. */
export function pressHighlightCss(xPx: number, yPx: number, minDimensionPx: number): string {
  const r = minDimensionPx * 0.55;
  return (
    `background-image:radial-gradient(circle ${r.toFixed(1)}px at ${xPx.toFixed(1)}px ${yPx.toFixed(1)}px,` +
    `rgba(255,255,255,0.20) 0%,rgba(255,255,255,0) 100%);` +
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