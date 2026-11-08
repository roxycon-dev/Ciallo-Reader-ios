/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/LiquidGlass.kt` (456 non-blank lines)
 *
 *   line  55 `LocalGlassBackdrop`                  → `GlassBackdropProvider` (components/LiquidGlass.tsx)
 *   line  68 `supportsRealtimeBlur`               → `supportsRealtimeBlur()`
 *   line  72 `GLASS_FALLBACK_ALPHA_BOOST`         → `GLASS_FALLBACK_ALPHA_BOOST`
 *   lines 79-107 `Modifier.frostedGlassFallback`   → `frostedGlassFallbackCss()`
 *   line 114 `LocalPreBlurredGlass`               → `PreBlurredGlass` type + context
 *   lines 129/136/149 backdrop factories          → SKIPPED (see report: CanvasBackdrop has no web analogue)
 *   lines 178-211 `GlassDialogWindowEffect`        → SKIPPED (RenderEffect / WindowManager; the CSS
 *                                                     equivalent lives in AcrylicDialog.tsx)
 *   lines 217-264 `Modifier.liquidGlass`          → `liquidGlassStyle()`
 *   lines 267-283 `drawThemeGradient`              → `themeGradientCss()`
 *   lines 289-301 `rememberGlassFxChain`           → `glassFxChainCss()`
 *   lines 308-338 `Modifier.liquidGlassStatic`     → `liquidGlassStyle({ preBaked: true })`
 *   lines 340-369 grain bitmap + `filmGrain`       → `filmGrainDataUrl()` + `filmGrainCss()`
 *                                                      / `filmGrainLayerCss()`
 *   lines 372-397 `Modifier.iridescentBorder`      → `iridescentBorderCss()`
 *   lines 403-432 `Modifier.crystalInnerBevel`     → `crystalInnerBevelCss()`
 *   lines 435-446 `Modifier.radialGlassScrim`      → `radialGlassScrimCss()`
 *   lines 449-461 `rememberIridescentColors`       → `core/glass/color.ts#iridescentColors`
 *   lines 468-480 `rememberCrystalPrismColors`     → `core/glass/color.ts#crystalPrismColors`
 *
 * REVIEW FIXES (glass / motion review)
 * ────────────────────────────────
 * ① `frostedGlassFallbackCss` no longer merges `filmGrainCss()` into the host
 *    element — that emitted `opacity: 0.05` on the panel itself (the whole
 *    frosted surface went 5% opaque instead of only the noise). The grain is now
 *    the topmost background layer with its 0.05 alpha baked into the tile and
 *    `background-blend-mode: overlay` for the Overlay composite.
 * ② `filmGrainCss()` stopped emitting `opacity` for the same reason; the alpha
 *    now travels inside `filmGrainDataUrl(alpha)`.
 * ③ `crystalInnerBevelCss()` now masks its gradient down to a `width`-thick
 *    ring (Compose `Stroke`) instead of painting the whole box — and it no
 *    longer overwrites a caller's `background-image` (the prism sweep).
 * ④ `radialGlassScrimCss()` takes a CSS length and defaults to
 *    `max(100vw, 100vh)`; the previous `radialGlassScrimCss(2000)` call sites
 *    hard-coded a 2000 px radius and flattened the scrim.
 *
 * ADAPTATION — GPU → CSS
 * ──────────────────────
 * `drawBackdrop{ colorControls / vibrancy / blur / lens }` is a per-pixel AGSL
 * pipeline with a real-time backdrop capture layer.  The web equivalent chain is
 *   backdrop-filter: blur(Npx) saturate(1.3) brightness(1.04) contrast(1.02)
 * which reproduces blur + vibrancy + colorControls in one declaration.
 * `lens()` (SDF refraction, API 33+) has **no** CSS counterpart — it is
 * approximated by an inset 1px light rim + a conic-gradient edge ring
 * (`lensApproxCss`), which is a documented visual approximation, not a match.
 */

import { withAlpha } from './color';
import { getBitmapSource } from './bitmapSource';
import { getMediaQuerySource } from './mediaQuerySource';

/** LiquidGlass.kt line 72 — 降级时给半透明基底额外加厚的 alpha。 */
export const GLASS_FALLBACK_ALPHA_BOOST = 0.2;

/** LiquidGlass.kt line 80 — `supportsRealtimeBlur` was `SDK_INT >= S` (API 31). */
let realtimeBlurOverride: boolean | null = null;

/**
 * Web capability probe replacing `Build.VERSION.SDK_INT >= S`.
 * - `CSS.supports('backdrop-filter', 'blur(1px)')` is the exact analogue of the
 *   Android RenderEffect gate: no support ⇒ every blur/vibrancy shader is a
 *   silent no-op on Android, and the CSS filter declaration is dropped by the
 *   browser, so both need the same "thickened translucent base" fallback.
 * - `prefers-reduced-transparency` mirrors the 系统「降低透明度 / 高对比度」 setting
 *   that `GlassKit.kt` reads from `Settings.Secure`.
 */
export function supportsRealtimeBlur(): boolean {
  if (realtimeBlurOverride !== null) return realtimeBlurOverride;
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return true;
  return CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
}

/** Test seam — lets unit tests pin the Android-style degradation branch. */
export function __setRealtimeBlurOverride(value: boolean | null): void {
  realtimeBlurOverride = value;
}

/**
 * `prefers-reduced-transparency` — GlassKit.kt line 300 `flag("reduce_transparency")`.
 *
 * E61：原先直接调 `window.matchMedia`，让 `src/core/**` 依赖 DOM 全局。
 * 现走注入的媒体查询源；兜底恒 false，与原「无 matchMedia / 抛错」分支一致。
 */
export function prefersReducedTransparency(): boolean {
  const mq = getMediaQuerySource();
  return (
    mq.matches('(prefers-reduced-transparency: reduce)') ||
    mq.matches('(prefers-contrast: more)')
  );
}

export interface LiquidGlassOptions {
  /** LiquidGlass.kt line 221 `surfaceColor: Color` — the tint drawn over the backdrop. */
  surfaceColor?: string;
  /** LiquidGlass.kt line 260 — default blur radius in dp. */
  blurRadius?: number;
  /** LiquidGlass.kt line 244 — AGSL `lens()` refraction (no CSS equivalent, approximated). */
  refraction?: boolean;
  /** LiquidGlass.kt line 223 — `colorControls(saturation = …)`. */
  saturation?: number;
  /** LiquidGlass.kt line 224 — `lens(refractionHeight = …)` dp. */
  refractionHeight?: number;
  /** LiquidGlass.kt line 225 — `lens(refractionAmount = …)` dp. */
  refractionAmount?: number;
  /**
   * LiquidGlass.kt lines 308-338 `liquidGlassStatic` — the effects are already
   * baked into the PreBlurredBackdrop bitmap, so only the blur padding is kept.
   */
  preBaked?: boolean;
  /** Border radius in px (web-only; Kotlin passes a `Shape`). */
  radius?: number;
}

/**
 * LiquidGlass.kt lines 217-264 `Modifier.liquidGlass` → a CSSProperties fragment.
 *
 * `colorControls(brightness = 0.04f, contrast = 1.02f, saturation = saturation)`
 * → `brightness() contrast() saturate()` inside the same `backdrop-filter`.
 * `blur(radius)` → `blur(Npx)`.
 * `Highlight(width = 1.2.dp, blurRadius = 1.dp, alpha = 0.8f)` → the inner ring.
 * `Shadow(radius = 24.dp, color = black@0.16)` + `InnerShadow(5.dp, black@0.10)`
 * → two `box-shadow` layers.
 */
export function liquidGlassStyle(options: LiquidGlassOptions = {}): Record<string, string> {
  const surfaceColor = options.surfaceColor ?? 'transparent';
  const blurRadius = options.blurRadius ?? 18;
  const saturation = options.saturation ?? 1.3;
  const radius = options.radius ?? 0;

  if (!supportsRealtimeBlur()) {
    return frostedGlassFallbackCss({ shapeRadius: radius, surfaceColor });
  }

  const filter = options.preBaked
    ? `blur(${Math.max(0, blurRadius)}px)`
    : `brightness(1.04) contrast(1.02) saturate(${saturation}) blur(${blurRadius}px)`;

  const out: Record<string, string> = {
    WebkitBackdropFilter: filter,
    backdropFilter: filter,
    background: surfaceColor,
    boxShadow:
      'inset 0 0 5px rgba(0, 0, 0, 0.10), 0 24px 24px rgba(0, 0, 0, 0.16)',
  };
  if (radius > 0) out.borderRadius = `${radius}px`;

  if (options.refraction === true) {
    // AGSL `lens()` → approximate with a light inner rim + faint conic edge ring.
    Object.assign(out, lensApproxCss(options, radius));
  } else {
    // Highlight.Default (1.2dp / blur 1dp / alpha 0.8)
    out.border = '1.2px solid rgba(255, 255, 255, 0.8)';
  }
  return out;
}

/**
 * AGSL `lens()` refraction approximation.
 * Android bends pixels along the shape edge (SDF based, `depthEffect = true`).
 * CSS cannot re-sample the backdrop with an offset, so we approximate with:
 *   1) a 1px inset white rim (the "edge catches light" cue)
 *   2) a conic-gradient ring whose brightness follows the fixed LIGHT_DIR
 *      (upper-left lit, lower-right dark) — the directional cue of a real lens.
 */
function lensApproxCss(
  options: LiquidGlassOptions,
  radius: number,
): Record<string, string> {
  const height = options.refractionHeight ?? 16;
  const amount = options.refractionAmount ?? 28;
  const strength = Math.max(0, Math.min(1, amount / 48));
  const out: Record<string, string> = {
    border: `${Math.max(1, height / 16)}px solid rgba(255, 255, 255, ${0.35 + 0.45 * strength})`,
    boxShadow:
      `inset 0 0 ${height}px rgba(255, 255, 255, ${0.30 * strength}), ` +
      'inset 0 0 5px rgba(0, 0, 0, 0.10), 0 24px 24px rgba(0, 0, 0, 0.16)',
  };
  if (radius > 0) out.borderRadius = `${radius}px`;
  return out;
}

/**
 * LiquidGlass.kt lines 79-107 `Modifier.frostedGlassFallback` →
 * 「加厚的半透明基底 + 柔和透光渐变 + 噪点纹理」近似磨砂介质。
 *
 * ① 全域介质渐变：左上受光提亮 → 右下轻微压暗
 * ② 顶部受光带：磨砂玻璃上沿的亮边（22% 高）
 */
export function frostedGlassFallbackCss(options: {
  shapeRadius?: number;
  surfaceColor?: string;
}): Record<string, string> {
  const surfaceColor = options.surfaceColor ?? '#FFFFFF';
  const boosted = Math.min(
    1,
    (parseAlpha(surfaceColor) ?? 1) + GLASS_FALLBACK_ALPHA_BOOST,
  );
  const base = surfaceColor.startsWith('#')
    ? withAlpha(surfaceColor, boosted)
    : surfaceColor;
  // Kotlin draws three stacked `drawRect`s (line 86 the 全域介质渐变, line 97 the
  // 顶部受光带) and then `filmGrain(alpha = 0.05f)` with `BlendMode.Overlay`.
  //
  // FIX (BUG): the grain used to be merged with `filmGrainCss()`, which sets
  // `opacity: 0.05` **on the host element** — that faded the whole frosted panel
  // to 5% opacity instead of blending only the noise. The grain is now the
  // topmost background layer, its 0.05 alpha baked into the tile pixels, and
  // `background-blend-mode: overlay` performs the same composite Compose's
  // `drawRect(alpha = 0.05f, blendMode = BlendMode.Overlay)` did.
  const grain = filmGrainDataUrl(0.05);
  const out: Record<string, string> = {
    background: base,
    backgroundImage:
      (grain === '' ? 'none' : `url(${grain})`) +
      // ① 全域介质渐变：左上受光提亮 → 右下轻微压暗
      ', linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 40%, ' +
      'rgba(255,255,255,0) 60%, rgba(0,0,0,0.05) 100%)' +
      // ② 顶部受光带：磨砂玻璃上沿的亮边（22% 高）
      ', linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 22%)',
    backgroundRepeat: 'repeat, no-repeat, no-repeat',
    backgroundSize: '64px 64px, 100% 100%, 100% 100%',
  };
  if (grain !== '') out.backgroundBlendMode = 'overlay, normal, normal';
  if (options.shapeRadius !== undefined && options.shapeRadius > 0) {
    out.borderRadius = `${options.shapeRadius}px`;
  }
  return out;
}

function parseAlpha(color: string): number | null {
  const m = /rgba\([^)]*?,\s*([0-9.]+)\s*\)$/.exec(color);
  if (m && m[1] !== undefined) return Number(m[1]);
  if (color === 'transparent') return 0;
  return color.startsWith('#') ? 1 : null;
}

/**
 * LiquidGlass.kt lines 267-283 `drawThemeGradient(surface, primary, secondary)` →
 * the CanvasBackdrop contents used by `rememberThemedGlassBackdrop()`.
 */
export function themeGradientCss(
  surface: string,
  primary: string,
  secondary: string,
): string {
  return (
    `linear-gradient(${surface}, ${surface}), ` +
    `linear-gradient(135deg, ${withAlpha(primary, 0.14)} 0%, rgba(0,0,0,0) 40%, ` +
    `${withAlpha(secondary, 0.1)} 65%, ${withAlpha(primary, 0.12)} 100%)`
  );
}

/**
 * LiquidGlass.kt lines 289-301 `rememberGlassFxChain(blurRadiusPx)` — the
 * pre-baked path's effect chain, kept identical to the realtime one so the two
 * outputs match.  Returns the CSS `backdrop-filter` value.
 */
export function glassFxChainCss(blurRadiusPx: number): string {
  return `brightness(1.04) contrast(1.02) saturate(1.30) blur(${blurRadiusPx}px)`;
}

/**
 * LiquidGlass.kt lines 149-169 `rememberGlassPanelBackdrop()` — glass-panel
 * gradient, deliberately **not** painting an opaque base so the real content
 * behind the dialog shows through.
 */
export function glassPanelBackdropCss(primary: string, secondary: string): string {
  return (
    `linear-gradient(135deg, ${withAlpha(primary, 0.06)} 0%, rgba(0,0,0,0) 40%, ` +
    `${withAlpha(secondary, 0.05)} 65%, ${withAlpha(primary, 0.06)} 100%)`
  );
}

/* ── film grain ──────────────────────────────────────────────────────────── */

/**
 * `java.util.Random(42)` LCG reproduced exactly so the grain bitmap is the same
 * pixels as Android's `createGrainBitmap()` (LiquidGlass.kt lines 342-352).
 * Java: seed = (seed ^ 0x5DEECE66) & ((1<<48)-1); next(bits) = seed >> (48-bits)
 * next(32) = next(31)*2 + nextInt(1) implemented by the standard two-call formula.
 */
function javaRandom(seed: number): {
  nextInt: (bound: number) => number;
  nextDouble: () => number;
} {
  let s = BigInt.asUintN(48, BigInt(seed) ^ 0x5deece66n);
  const mask = (1n << 48n) - 1n;
  const mul = 0x5deece66n;
  const add = 0xbn;
  const next = (bits: bigint): bigint => {
    s = BigInt.asUintN(48, (s * mul + add) & mask);
    return s >> (48n - bits);
  };
  return {
    // java.util.Random.nextInt(bound) — rejection sampling for non powers of two.
    nextInt(bound: number): number {
      if (bound <= 0) return 0;
      if ((bound & -bound) === bound) {
        return (bound * Number(next(31n))) >>> 31;
      }
      for (;;) {
        const bits = Number(next(31n));
        const val = bits % bound;
        if (bits - val + (bound - 1) < 0) continue;
        return val;
      }
    },
    // java.util.Random.nextDouble() = ((next(26) << 27) + next(27)) / 2^53
    nextDouble(): number {
      const hi = next(26n);
      const lo = next(27n);
      return Number(((hi << 27n) + lo) / 9007199254740992n);
    },
  };
}

let grainDataUrl: string | null = null;
const grainDataUrlCache = new Map<string, string>();

/**
 * 清空噪点贴图缓存。
 *
 * E61 引入依赖注入后**必须**提供：位图源是后装配的，若在装配前调用过
 * `filmGrainDataUrl()`，会把空串 `''` 永久 memoize 下来。装配完成后调一次
 * 本函数即可让下次调用用真实画布重新生成。
 *
 * 单测切换 `withBitmapSource` 时也应调用，否则拿到的是上一个源的缓存。
 */
export function resetFilmGrainCache(): void {
  grainDataUrl = null;
  grainDataUrlCache.clear();
}

/**
 * LiquidGlass.kt lines 340-369 — 64×64 ARGB grain, `v = 128 + rnd.nextInt(56) - 28`,
 * tiled and blended with `BlendMode.Overlay`.
 *
 * Compose Canvas → CSS: the tile becomes a `data:` PNG and `BlendMode.Overlay`
 * becomes either `mix-blend-mode: overlay` on a dedicated pseudo-layer
 * (`filmGrainLayerCss`) or `background-blend-mode: overlay` on a background layer
 * (`frostedGlassFallbackCss`). The bitmap is built once per alpha and memoised.
 *
 * `alphaValue` is Compose's `drawRect(alpha = …)`: it is baked into the tile's
 * alpha channel so one element can host the grain without an extra compositing
 * layer (used by `frostedGlassFallbackCss`).
 *
 * E61：原先直接 `document.createElement('canvas')`，让 `src/core/**` 依赖 DOM
 * 全局。现走注入的 `BitmapSource`；宿主没有画布能力时返回 `''`（与原
 * `typeof document === 'undefined'` 分支一致），不抛错。
 */
export function filmGrainDataUrl(alphaValue = 1): string {
  if (alphaValue === 1 && grainDataUrl !== null) return grainDataUrl;
  const cached = grainDataUrlCache.get(String(alphaValue));
  if (cached !== undefined) return cached;
  const size = 64;
  const rnd = javaRandom(42);
  const alpha = Math.round(Math.max(0, Math.min(1, alphaValue)) * 255);
  const url = getBitmapSource().createDataUrl(size, (set) => {
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        // createGrainBitmap(): v = 128 + rnd.nextInt(56) - 28
        const v = 128 + rnd.nextInt(56) - 28;
        // `drawRect(alpha = alphaValue)` baked into the tile so the Overlay blend
        // reproduces the exact coverage Compose used.
        set(x, y, v, v, v, alpha);
      }
    }
  });
  const result = url ?? '';
  grainDataUrlCache.set(String(alphaValue), result);
  if (alphaValue === 1) grainDataUrl = result;
  return result;
}

/**
 * LiquidGlass.kt line 355 `Modifier.filmGrain(alpha = 0.04f)`.
 *
 * ⚠️ The alpha is baked into the tile, **not** emitted as `opacity` — an
 * `opacity` here would fade the whole element instead of only the noise (that
 * was a real bug in the frosted-glass fallback).
 */
export function filmGrainCss(alphaValue = 0.04): Record<string, string> {
  const url = filmGrainDataUrl(alphaValue);
  if (url === '') return {};
  return {
    backgroundImage: `url(${url})`,
    backgroundRepeat: 'repeat',
    backgroundSize: '64px 64px',
    mixBlendMode: 'overlay',
  };
}

/**
 * `BlendMode.Overlay` needs its own compositing layer when it is the element's
 * own background; returns the ::after / child-layer rule body instead.
 */
export function filmGrainLayerCss(alphaValue = 0.04): string {
  const url = filmGrainDataUrl(1);
  if (url === '') return '';
  return `background-image:url(${url});background-repeat:repeat;background-size:64px 64px;opacity:${alphaValue};mix-blend-mode:overlay;`;
}

/* ── edges ───────────────────────────────────────────────────────────────── */

/**
 * LiquidGlass.kt lines 372-397 `Modifier.iridescentBorder` —
 * `Brush.sweepGradient` 描边。CSS has no conic *border* gradient on arbitrary
 * radius, but a `background-image: conic-gradient` clipped by a transparent
 * inner border reproduces the sweep ring exactly.
 */
export function iridescentBorderCss(options: {
  colors: readonly string[];
  /** LiquidGlass.kt line 375 — default 2.dp */
  width?: number;
  /** LiquidGlass.kt line 376 — default 0.22f */
  alpha?: number;
  radius?: number;
}): Record<string, string> {
  const width = options.width ?? 2;
  const a = options.alpha ?? 0.22;
  const stops = options.colors.map((c, i, arr) => {
    const pct = (i / Math.max(1, arr.length - 1)) * 100;
    return `${withAlpha(c, a)} ${pct.toFixed(2)}%`;
  });
  const out: Record<string, string> = {
    border: 'none',
    backgroundImage: `conic-gradient(from 0deg, ${stops.join(', ')})`,
    WebkitMask:
      `linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)`,
    mask: `linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)`,
    WebkitMaskComposite: 'xor',
    maskComposite: 'exclude',
    padding: `${width}px`,
  };
  if (options.radius !== undefined) out.borderRadius = `${options.radius}px`;
  return out;
}

/**
 * LiquidGlass.kt lines 403-432 `Modifier.crystalInnerBevel` —
 * 左上受光面珍珠白柔光，右下背光面暗调接触线（物理厚度倒角高光）。
 *
 * Kotlin strokes the outline with `Stroke(width)`, so the gradient is confined
 * to a `width`-thick ring on the boundary. CSS `border: Npx solid transparent`
 * + a full-box `background-image` would paint the gradient across the whole
 * element (and would clobber any `background-image` a caller had already set,
 * e.g. the prism sweep in `AcrylicDialog`), so the same
 * `mask-composite: exclude` ring trick as `iridescentBorderCss` is used here.
 */
export function crystalInnerBevelCss(options: {
  /** LiquidGlass.kt line 404 — default 1.dp */
  width?: number;
  radius?: number;
}): Record<string, string> {
  const width = options.width ?? 1;
  const out: Record<string, string> = {
    border: 'none',
    padding: `${width}px`,
    backgroundImage:
      'linear-gradient(135deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.12) 33.3333%, ' +
      'rgba(255,255,255,0) 66.6667%, rgba(0,0,0,0.08) 100%)',
    WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    maskComposite: 'exclude',
  };
  if (options.radius !== undefined) out.borderRadius = `${options.radius}px`;
  return out;
}

/**
 * LiquidGlass.kt lines 435-446 `Modifier.radialGlassScrim` —
 * 径向渐变背景遮罩：中心（弹窗位置）亮、四周暗，模拟聚光灯。
 * center = (size.width*0.5, size.height*0.78), radius = size.maxDimension * 0.95.
 *
 * The scrim always covers the whole viewport (both call sites fill the screen),
 * so `maxDimension` is `max(100vw, 100vh)`.  Callers used to hard-code 2000 px
 * which pushed the 0.65 stop far outside the viewport and left the scrim almost
 * uniformly at the 0.25 centre value — see the review report.
 */
export function radialGlassScrimCss(maxDimension: string = 'max(100vw, 100vh)'): string {
  return (
    `radial-gradient(circle calc(${maxDimension} * 0.95) at 50% 78%, ` +
    'rgba(0, 0, 0, 0.25) 0%, rgba(0, 0, 0, 0.65) 100%)'
  );
}

/**
 * `GlassCard.kt` lines 355-362 — CSS `perspective()` distance from
 * `cardCameraDistance()` in core/glass/cardTweaks.ts.  The outer tilt layer sets
 * `transform: perspective(Npx) rotateX(..) rotateY(..)`; the content parallax
 * layer uses half that distance (GlassCard.kt line 986).
 */
export function cardPerspective(shortSidePx: number, cameraDistMult: number, half = false): number {
  const d = shortSidePx * (0.42 + 3.8 * Math.max(0, Math.min(1, (cameraDistMult - 3) / 9)));
  return half ? d * 0.5 : d;
}