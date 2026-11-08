import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  GLASS_FALLBACK_ALPHA_BOOST,
  cardPerspective,
  filmGrainLayerCss,
  frostedGlassFallbackCss,
  glassFxChainCss,
  glassPanelBackdropCss,
  iridescentBorderCss,
  crystalInnerBevelCss,
  liquidGlassStyle,
  prefersReducedTransparency,
  radialGlassScrimCss,
  supportsRealtimeBlur,
  themeGradientCss,
  type LiquidGlassOptions,
} from '../../core/glass/liquidGlass';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/LiquidGlass.kt` (456 non-blank lines)
 *   The entire pure/graphics side is ported in `src/core/glass/liquidGlass.ts`;
 *   this file carries the three CompositionLocals plus the CSS custom-property
 *   plumbing that replaces the `Modifier` chain.
 *
 *   line  55 `LocalGlassBackdrop`    → `GlassBackdropProvider` / `useGlassBackdrop`
 *   line 114 `LocalPreBlurredGlass`  → `PreBlurredGlassProvider` / `usePreBlurredGlass`
 *   line  68 `supportsRealtimeBlur`  → re-exported from core
 *
 * SKIPPED (Android-only, see report for detail):
 * - lines 129/136/149 `rememberLayerBackdrop()` / `rememberThemedGlassBackdrop()` /
 *   `rememberGlassPanelBackdrop()`: a GPU texture capture has no web analogue;
 *   `backdrop-filter` samples the real composited backdrop natively.
 * - lines 178-211 `GlassDialogWindowEffect`: `View.setRenderEffect` on the
 *   decorView. The web equivalent is a `filter: blur()` on the app root while a
 *   modal is open — implemented by `AcrylicDialog.tsx` via `dialogBackdropFilter()`.
 * - lines 289-301 `rememberGlassFxChain`: only used by the pre-baked raster path,
 *   which is an Android Bitmap optimisation; ported as a pure string helper
 *   (`glassFxChainCss`) but not wired into any component.
 */

export {
  GLASS_FALLBACK_ALPHA_BOOST,
  cardPerspective,
  crystalInnerBevelCss,
  filmGrainLayerCss,
  frostedGlassFallbackCss,
  glassFxChainCss,
  glassPanelBackdropCss,
  iridescentBorderCss,
  liquidGlassStyle,
  prefersReducedTransparency,
  radialGlassScrimCss,
  supportsRealtimeBlur,
  themeGradientCss,
};
export type { LiquidGlassOptions };

/**
 * LiquidGlass.kt line 55 — 当前窗口的玻璃采样源。
 *
 * The web `backdrop-filter` needs no explicit registration; this context exists so
 * a component can still *ask* whether a live backdrop was provided (the Android
 * `Backdrop?` nullability gates the realtime path), and so `GlassCard` can decide
 * between the realtime blur and the translucent-base fallback.
 */
export interface GlassBackdropDescriptor {
  /** The element whose painted content is sampled by `backdrop-filter`. */
  elementId: string;
}

const GlassBackdropContext = createContext<GlassBackdropDescriptor | null>(null);

export function GlassBackdropProvider(props: {
  descriptor: GlassBackdropDescriptor;
  children: ReactNode;
}) {
  const value = useMemo(() => props.descriptor, [props.descriptor]);
  return (
    <GlassBackdropContext.Provider value={value}>
      {props.children}
    </GlassBackdropContext.Provider>
  );
}

export function useGlassBackdrop(): GlassBackdropDescriptor | null {
  return useContext(GlassBackdropContext);
}

/**
 * LiquidGlass.kt line 114 — 静态背景的预烘焙模糊 backdrop。
 * Null on the web: `backdrop-filter` is always live, so the "pre-baked bitmap"
 * fast path has no reason to exist. The context is kept so GlassCard can branch
 * the same way the Kotlin `preBlurred != null && quality >= HIGH` did.
 */
const PreBlurredGlassContext = createContext<null>(null);

export function PreBlurredGlassProvider(props: { children: ReactNode }) {
  return (
    <PreBlurredGlassContext.Provider value={null}>
      {props.children}
    </PreBlurredGlassContext.Provider>
  );
}

export function usePreBlurredGlass(): null {
  return useContext(PreBlurredGlassContext);
}

/**
 * Compose `Modifier.liquidGlass(...)` → the CSS fragment a glass element uses.
 * `shape` maps to `radius` (px); everything else is forwarded to the core helper.
 */
export function liquidGlassCss(options: LiquidGlassOptions): CSSProperties {
  return liquidGlassStyle(options) as CSSProperties;
}

/**
 * LiquidGlass.kt lines 178-211 `GlassDialogWindowEffect` — web equivalent.
 *
 * Android sets a `RenderEffect.createBlurEffect` on the host Activity's decorView
 * so the content *behind* a Dialog window blurs.  On the web a modal is a DOM
 * overlay, so the page root itself gets the blur filter while the dialog is open.
 * Returns the filter string (or '' when there is no realtime blur support, in
 * which case `AcrylicDialog` falls back to a heavier scrim + thicker base).
 */
export function dialogBackdropFilter(blurRadiusDp: number): string {
  if (!supportsRealtimeBlur()) return '';
  return `blur(${blurRadiusDp}px)`;
}