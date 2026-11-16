/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/glasskit/GlassKit.kt` (497 lines / 469 non-blank) — components + context
 *   lines 65-81   the package doc（「与既有 GlassCard / liquidGlass 完全并行」）→ ADAPTATION note
 *   lines 83-144  object GlassTokens              → core/glass/glassKit#GlassTokens
 *   lines 158-203 SquircleShape / squirclePath   → core/glass/glassKit#squirclePath
 *   line 182      GlassCardShape                  → GLASS_CARD_RADIUS
 *   line 208      LocalGlassKitBackdrop           → REMOVED, see 「REMOVED ①」
 *   lines 222-281 `GlassKitHost(topGradientHeight, modifier, content)` → GlassKitHost
 *   lines 291-302 `rememberReduceTransparency()`  → core prefersReducedTransparency()
 *   lines 315-443 `GlassKitCard(...)`             → GlassKitCard
 *   lines 454-496 `GlassTopBarStrip(collapsedFraction, modifier)` → GlassTopBarStrip
 *   line 465-469  `cs.background.copy(alpha = 0.92f / 0.60f)` → core/glass/color#withAlpha
 *   line 493      `cs.onSurface.copy(alpha = 0.10f * f)`       → core/glass/color#withAlpha
 *
 * ADAPTATION — `layerBackdrop` (GPU texture capture) → CSS stacking
 * ────────────────────────────────────────────────────────────────
 * Kotlin records the whole subtree into a texture and samples it from the glass
 * cards, so the page overlay (GlassKit.kt lines 212-219) ends up *inside* the
 * sampled backdrop and the cards therefore blur an already-darkened background.
 *
 * The web has `backdrop-filter`, which samples the real composited backdrop for
 * free — but it samples only what is *painted behind the element*, which is
 * exactly the requirement. So the host keeps the same DOM order
 * (wallpaper → overlay → cards) and `backdrop-filter` produces the same result
 * without a capture layer. This is a documented equivalence, not an approximation.
 *
 * `lens()` (per-pixel SDF refraction, API 33+) has **no** CSS counterpart — CSS
 * cannot re-sample the backdrop with an offset, so it is NOT emulated here. Same
 * policy as `core/glass/liquidGlass.ts`. See 「KNOWN GAP」 below.
 *
 * The vendored `:backdrop` `drawBackdrop` slots map like this:
 *   * `effects { colorControls / vibrancy / blur }` → one `backdrop-filter` chain.
 *     `GlassKitHost` calls `Modifier.liquidGlass(...)` (LiquidGlass.kt L217-264), so
 *     the host reuses that port verbatim; `GlassKitCard` calls `drawBackdrop` directly
 *     and builds its own chain from `vibrancy()`'s real value (see below).
 *   * `highlight = { … }` → one `inset` box-shadow ring (Kotlin numbers kept).
 *   * `shadow = { … }`     → one drop `box-shadow` (Kotlin numbers kept).
 *   * `layerBlock { scaleX/scaleY }` → `transform: scale()` + a spring-matched transition.
 *   * `onDrawSurface { drawRect(tint) }` → `background`.
 *   * `clip(shape)` / `drawBackdrop(shape = …)` → `border-radius` on the first paint,
 *     then `clip-path: path(…)` once the element has been measured (the squircle).
 *
 * KNOWN GAP (registered by the reviewer, not invented):
 *   `lens(refractionHeight = 14dp, refractionAmount = 22dp, depthEffect = true)` is a
 *   per-pixel AGSL SDF refraction; `HighlightStyle.Default`'s 45° angular sweep is an
 *   AGSL sweep too. Neither has a CSS counterpart, so only the ring's **width** and
 *   **alpha** are reproduced. Kotlin's own comment calls the refraction the feature
 *   that separates this kit from the older one (L77), so this is a real, visible
 *   difference — not a silent approximation.
 *
 * 2026-10-06 修复 pass（速率限制中断后的半成品收尾 + 逐行复核）
 * ────────────────────────────────────────────────────────────────────────────────
 * FIXED (this file did not compile: the React hooks were used but never imported):
 *   ① `useState` / `useRef` / `useEffect` were missing from the import list (11 tsc
 *      errors) — the interrupted agent had rewritten `GlassKitCard` for the React 19
 *      `ref.current` rule and never finished the import block.
 *   ② `withAlpha` was used in `GlassTopBarStrip` but never imported **and never
 *      existed in this file**. It is `core/glass/color.ts#withAlpha`, whose own header
 *      documents it as the port of Kotlin `Color.copy(alpha = …)` — i.e. exactly what
 *      Kotlin L466/L468/L483/L493 do. Imported, not re-implemented.
 *
 * FIXED (behaviour, found by re-reading the Kotlin):
 *   ③ `pressPoint` was set on `pointerdown` and **never cleared**, so the finger
 *      highlight stayed painted after the finger lifted. Kotlin L346-354 resets it to
 *      `Offset.Unspecified` on *every* non-`Press` interaction (`Release`/`Cancel`, and
 *      a press cancelled by leaving the bounds). Now cleared on `pointerup`,
 *      `pointerleave` and `pointercancel`.
 *   ④ `pressHighlightCss(...)` was assigned to the `background` property, but it
 *      returns a whole CSS **declaration block** (`"background-image:…;mix-blend-mode:…;"`).
 *      `background: background-image:…` is not valid CSS, so the declaration was
 *      dropped and the highlight never painted at all. Now split back into the
 *      `CSSProperties` keys it contains (`pressHighlightStyle`); the core helper keeps
 *      owning the values.
 *   ⑤ `GlassTopBarStrip`'s fallback branch folded nothing into the colour and instead
 *      put `opacity: f` on the element. Kotlin L483 bakes the fraction into the fill
 *      (`tint.copy(alpha = tint.alpha * collapsedFraction)`) and applies **no** layer
 *      alpha, so the hairline (L493, already `0.10f * f`) must not be faded a second
 *      time. The realtime branch keeps `opacity: f` because Kotlin L479 really does
 *      apply it (`layerBlock { alpha = collapsedFraction }`).
 *   ⑥ `collapsedFraction` was clamped to 0…1 before use. Kotlin L478/L493 use it raw;
 *      the only caller (`SourceManagementScreen.kt` L424) feeds Material3's
 *      `collapsedFraction`, which is 0…1 by contract, so the clamp could only ever
 *      hide a caller bug. Removed for parity.
 *   ⑦ `useSquircleClip()`'s return value was discarded, so the squircle outline the
 *      header documents was measured and thrown away — every card was a plain
 *      `border-radius` rect, i.e. Kotlin's `SquircleShape` was not honoured. The path
 *      is now applied as `clip-path` once measured (`border-radius` still covers the
 *      first paint).
 *   ⑧ `GlassKitCard`'s realtime filter used `saturate(1.15)`. Kotlin L376 calls
 *      `vibrancy()`, whose saturation is 1.5 (vendored `effects/ColorFilter.kt` L50-54,
 *      `colorControlsColorFilter(saturation = 1.5f)`); 1.15 is `GlassKitHost`'s
 *      `liquidGlass(saturation = 1.15f)` (Kotlin L255), a different call site. Now 1.5.
 *   ⑨ `GlassKitCard`'s realtime branch used `GLASSKIT_FALLBACK_SHADOW`, which core
 *      documents as the **fallback** branch's `consistentShadow(2.dp, …)` (Kotlin
 *      L416-421). The realtime branch passes `shadow = { Shadow.Default }` (Kotlin L389),
 *      and `Highlight.Default` (Kotlin L388) had no CSS at all. Both are now emitted
 *      with the vendored library's own numbers (see the two constants below).
 *   ⑩ `GlassKitHost` emitted only `blur(16px) saturate(1.15)`, dropping the rest of
 *      `Modifier.liquidGlass`'s slots — `colorControls(brightness 0.04, contrast 1.02)`,
 *      `Highlight(width 1.2dp, blur 1dp, alpha 0.8)`, `Shadow(radius 24dp, black@0.16)`
 *      and `InnerShadow(radius 5dp, black@0.10)` (Kotlin L236-262). The host now
 *      delegates to the existing `liquidGlassStyle()` port of those exact lines.
 *
 * REMOVED (EXTRA — no Android counterpart, no consumer in the repo):
 *   ① `GlassKitBackdropContext`, the "port" of `LocalGlassKitBackdrop`. Kotlin L208 is a
 *      `staticCompositionLocalOf<Backdrop?>` that carries a GPU texture handle from the
 *      host (L277) to the card (L329). `backdrop-filter` needs no such handle — the
 *      browser samples whatever is painted behind — so the mirror was a mutable module
 *      object that nothing provided, nothing read, and no caller imported. A module
 *      object that claims to be a "Context" but carries no value is worse than nothing.
 *   ② `GlassKitHost`'s `surface` prop and its `<span className="sr-only"
 *      data-glasskit-surface>` carrier. Kotlin's host reads `cs.surface` for exactly one
 *      thing: `dark = cs.surface.luminance() < 0.5f` (L231), which the port already takes
 *      as the `dark` prop. The extra prop existed only to give the invented span
 *      something to print; nothing reads `data-glasskit-surface`.
 *
 * Earlier fixes kept from the previous pass:
 *   • `GlassKitCard`'s press scale is gated on `clickable`, not on
 *     `interactiveHighlight`: Kotlin attaches its `MutableInteractionSource` whenever
 *     `onClick != null` (L431-439) and drives `press` from that source (L337-343), so a
 *     non-clickable card never scales (`SourceManagementScreen.kt` L831-835 is exactly
 *     that case — `interactiveHighlight = true` with no `onClick`). `interactiveHighlight`
 *     only gates `onDrawFront` (L392) and the `pressPoint` collection (L345).
 *   • The press transition duration is derived from Kotlin's
 *     `spring(dampingRatio = 0.6f, stiffness = 400f)` → `GLASSKIT_PRESS_MS` (≈384 ms),
 *     not a hard-coded 340 ms.
 *   * `minDimension` is measured into state because React 19 forbids reading
 *     `ref.current` during render, and the finger-following gradient needs it per move.
 */
import { useEffect, useRef, useState } from 'react';
import {
  GLASSKIT_FALLBACK_SHADOW,
  GLASSKIT_PRESS_BEZIER,
  GLASSKIT_PRESS_MIN_SCALE,
  GLASSKIT_PRESS_MS,
  GlassTokens,
  glassKitTint,
  pageOverlayColor,
  pressHighlightCss,
  squirclePath,
  squircleRadiusFor,
  topGradientStops,
} from '../../../core/glass/glassKit';
import { withAlpha } from '../../../core/glass/color';
import {
  liquidGlassStyle,
  prefersReducedTransparency,
  supportsRealtimeBlur,
} from '../../../core/glass/liquidGlass';

/** GlassKit.kt line 182 — `GlassCardShape = SquircleShape(CornerSize(GlassTokens.Radius))`. */
export const GLASS_CARD_RADIUS = GlassTokens.Radius;

/**
 * Kotlin L389 `shadow = { Shadow.Default }` on `GlassKitCard`'s realtime branch —
 * vendored `backdrop/shadow/Shadow.kt`: `radius = 24.dp`,
 * `offset = DpOffset(0.dp, radius / 6f)`, `color = Color.Black.copy(alpha = 0.1f)`.
 * (Not `GLASSKIT_FALLBACK_SHADOW`, which is the *fallback* branch's `consistentShadow`.)
 */
const GLASSKIT_CARD_SHADOW = '0px 4px 24px rgba(0, 0, 0, 0.1)';

/**
 * Kotlin L388 `highlight = { Highlight.Default }` — vendored
 * `backdrop/highlight/Highlight.kt` (`width = 0.5.dp`, `blurRadius = width / 2f`,
 * `alpha = 1f`) plus `HighlightStyle.Default` (`Color.White.copy(alpha = 0.5f)`,
 * `BlendMode.Plus`, `angle = 45°`). The 45° angular sweep and the additive blend are
 * AGSL shader features; the ring's width and alpha are reproduced exactly.
 */
const GLASSKIT_CARD_HIGHLIGHT = 'inset 0 0 0.5px rgba(255, 255, 255, 0.5)';

/**
 * 玻璃宿主：铺一层「壁纸采样模糊 + 全局遮罩 + 顶部渐变」。
 *
 * 关键点：
 * - 遮罩与渐变必须画在玻璃**之前**（被录制的层里），因此卡片采样到的是
 *   「已经压暗并保护过标题的背景」，而不是原始壁纸 —— 卡内文字的对比度不再
 *   取决于用户选了哪张壁纸。
 * - 卡片必须作为这一层的**兄弟节点**，放进被录制的层里会采样到自己（递归）。
 *
 * @param topGradientHeightDp 顶部渐变高度（= 状态栏 + 大标题区 + 24）。
 */
export function GlassKitHost(props: {
  topGradientHeightDp: number;
  className?: string;
  style?: React.CSSProperties;
  /** Kotlin `MaterialTheme.colorScheme.background`. */
  background?: string;
  /** Kotlin `cs.surface.luminance() < 0.5f`. */
  dark?: boolean;
  qualityRealtimeGlass?: boolean;
  children?: React.ReactNode;
}) {
  const background = props.background ?? '#FFFFFF';
  const dark = props.dark === true;
  const overlay = pageOverlayColor(dark);
  const topH = props.topGradientHeightDp;
  // Kotlin L238 `global != null && quality.realtimeGlass && supportsRealtimeBlur`.
  // There is no `global` backdrop to test for: `backdrop-filter` samples whatever the
  // wallpaper layer painted behind this host, so only the two portable gates remain.
  const realtime = props.qualityRealtimeGlass !== false && supportsRealtimeBlur();

  return (
    <div
      className={['glasskit-host', props.className ?? ''].filter(Boolean).join(' ')}
      style={props.style}
    >
      <div className="glasskit-host__layer">
        {/* Kotlin L241-260: `.layerBackdrop(pageBackdrop)` around `liquidGlass(...)`
            (realtime) or `Modifier.background(overlay)` (L258). `liquidGlassStyle` is
            the port of Kotlin L236-263 — same blur radius, same saturation 1.15f, same
            surface colour — so all of its slots travel with it. */}
        <div
          className="glasskit-host__backdrop"
          style={
            realtime
              ? (liquidGlassStyle({
                  surfaceColor: overlay,
                  blurRadius: GlassTokens.Blur,
                  saturation: 1.15,
                }) as React.CSSProperties)
              : { background: overlay }
          }
        />
        {/* 顶部渐变作为**子节点**才会被一起录制进 pageBackdrop — Kotlin L263-275,
            `Brush.verticalGradient(listOf(bg.copy(alpha = TopGradientAlpha), Transparent))`. */}
        <div
          className="glasskit-host__top-gradient"
          style={{
            height: topH,
            backgroundImage: topGradientStops(background),
          }}
        />
      </div>
      {props.children}
    </div>
  );
}

export interface GlassKitCardProps {
  className?: string;
  style?: React.CSSProperties;
  /** Kotlin default `GlassCardShape` (24dp squircle). */
  radius?: number;
  onClick?: (() => void) | null;
  /**
   * 可点卡片可开启「高光跟随手指」。库的 Highlight 只支持固定方向，
   * 列表大卡（分组卡 / 搜索历史卡）不要开 —— 会和滚动手势抢按压。
   */
  interactiveHighlight?: boolean;
  /**
   * 轻量档：**只跑 blur(8)**，去掉 vibrancy 与 lens。
   * 用于卡片正在做显隐/尺寸动画的那些帧。
   */
  lightweight?: boolean;
  /** Theme tokens. */
  dark?: boolean;
  /** Kotlin `MaterialTheme.colorScheme.surface` — the dark tint's base colour. */
  surface?: string;
  qualityRealtimeGlass?: boolean;
  children?: React.ReactNode;
}

/**
 * 玻璃卡：[radius] 默认 24dp 连续曲率，中心通透、边缘折射 + 左上方向性高光。
 * 卡片内部一律**不再**有第二层玻璃、渐变或描边（玻璃套玻璃会让边缘出现两圈轮廓）。
 */
export function GlassKitCard(props: GlassKitCardProps) {
  const radius = props.radius ?? GLASS_CARD_RADIUS;
  const dark = props.dark === true;
  const surface = props.surface ?? '#FFFFFF';
  const reduce = prefersReducedTransparency();
  // Kotlin L367 `backdrop != null && quality.realtimeGlass && supportsRealtimeBlur`.
  const realtime = props.qualityRealtimeGlass !== false && supportsRealtimeBlur();
  const { tint, solidTint } = glassKitTint({ dark, surface, reduceTransparency: reduce });
  const [pressed, setPressed] = useState(false);
  // minDimension is measured into state (React 19 forbids ref.current reads
  // during render); the finger-following highlight gradient needs it on every move.
  const [minDimension, setMinDimension] = useState(0);
  const [pressPoint, setPressPoint] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // Kotlin L373-386: `lightweight` drops vibrancy **and** lens, leaving `blur(8)` only.
  // `vibrancy()` is `colorControlsColorFilter(saturation = 1.5f)` in the vendored
  // `effects/ColorFilter.kt` L50-54; the `lens(...)` below it has no CSS counterpart
  // (see KNOWN GAP in the header). `filter` order follows Kotlin's effect order.
  const lightweight = props.lightweight === true;
  const filter = lightweight
    ? `blur(${GlassTokens.BlurLightweight}px)`
    : `saturate(1.5) blur(${GlassTokens.Blur}px)`;

  // FIX ⑦ — Kotlin clips to `SquircleShape` (L371 `shape = { shape }` realtime, L422
  // `.clip(shape)` in the fallback); the path this returns is now actually applied.
  const squircle = useSquircleClip(ref, radius);

  useEffect(() => {
    const el = ref.current;
    if (null === el) return;
    const measure = (): void => setMinDimension(Math.min(el.clientWidth, el.clientHeight));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const style: React.CSSProperties = {
    borderRadius: `${radius}px`,
    position: 'relative',
    overflow: 'hidden',
    // Kotlin L390 `layerBlock = { scaleX = press; scaleY = press }` (and L424's
    // `graphicsLayer` in the fallback branch) — same scale, both branches.
    transform: pressed ? `scale(${GLASSKIT_PRESS_MIN_SCALE})` : 'scale(1)',
    transition: `transform ${GLASSKIT_PRESS_MS}ms ${GLASSKIT_PRESS_BEZIER}`,
    ...(realtime
      ? {
          WebkitBackdropFilter: filter,
          backdropFilter: filter,
          // Kotlin L391 `onDrawSurface = { drawRect(tint) }` (L356-363).
          background: tint,
          // Kotlin L388-389 `highlight = { Highlight.Default }`, `shadow = { Shadow.Default }`.
          boxShadow: `${GLASSKIT_CARD_SHADOW}, ${GLASSKIT_CARD_HIGHLIGHT}`,
        }
      : {
          // Kotlin L416-423 `consistentShadow(2.dp, …).clip(shape).background(solidTint)`
          // — the fallback branch paints NO highlight ring, so none is emitted here.
          background: solidTint,
          boxShadow: GLASSKIT_FALLBACK_SHADOW,
        }),
    // FIX ⑦ — the measured squircle replaces the circular `border-radius` it stands in
    // for; until the first measurement `border-radius` above is the whole outline.
    ...(squircle !== '' ? { WebkitClipPath: squircle, clipPath: squircle } : {}),
    ...props.style,
  };

  const clickable = props.onClick != null;
  // Kotlin attaches `MutableInteractionSource` whenever `onClick != null`; only
  // `onDrawFront`（手指高光）is gated behind `interactiveHighlight`.
  const fingerHighlight = props.interactiveHighlight === true && clickable;
  // Kotlin L344-354 — `pressPoint` goes back to `Offset.Unspecified` on **every**
  // non-`Press` interaction (`Release` / `Cancel`, including a press cancelled by the
  // pointer leaving the bounds), and `collectIsPressedAsState` drops `pressed` on the
  // same events. There is no interaction source at all when `onClick == null` (L431-439),
  // so nothing may fire on a non-clickable card.
  const releasePress = (): void => {
    if (!clickable) return;
    setPressed(false);
    setPressPoint(null);
  };

  return (
    <div
      ref={ref}
      className={['glasskit-card', props.className ?? ''].filter(Boolean).join(' ')}
      style={style}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={props.onClick ?? undefined}
      onPointerDown={(e) => {
        if (!clickable) return;
        setPressed(true);
        if (!fingerHighlight) return;
        const rect = e.currentTarget.getBoundingClientRect();
        setPressPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onPointerUp={releasePress}
      onPointerCancel={releasePress}
      onPointerLeave={releasePress}
      onKeyDown={(e) => {
        if (props.onClick == null) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onClick();
        }
      }}
    >
      {fingerHighlight && pressPoint !== null ? (
        <span
          aria-hidden="true"
          className="glasskit-card__highlight"
          style={pressHighlightStyle(pressPoint.x, pressPoint.y, minDimension)}
        />
      ) : null}
      {props.children}
    </div>
  );
}

/**
 * The squircle outline. `paint()` (Houdini worklet) is not universally available,
 * so the shape is emitted as a `clip-path: path(...)` SVG string once the element has
 * been measured; the `border-radius` on the style object covers the first paint.
 */
function useSquircleClip(ref: React.RefObject<HTMLElement | null>, radius: number): string {
  const [path, setPath] = useState('');
  useEffect(() => {
    const el = ref.current;
    if (null === el) return;
    const measure = (): void => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w === 0 || h === 0) return;
      const r = squircleRadiusFor(w, h, radius);
      setPath(`path('${squirclePath(w, h, r)}')`);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, radius]);
  return path;
}

/**
 * Kotlin L399-411 — the `onDrawFront` radial light:
 * `Brush.radialGradient(listOf(Color.White.copy(alpha = 0.20f), Color.Transparent),
 * center = pressPoint, radius = size.minDimension * 0.55f)` drawn with
 * `blendMode = BlendMode.Screen`.
 *
 * FIX ④: `pressHighlightCss` (core/glass/glassKit.ts) owns those numbers but returns a
 * whole CSS **declaration block** (`"background-image:…;mix-blend-mode:screen;"`).
 * React's `style` prop only accepts an object, and `background: <declaration block>` is
 * not valid CSS, so the previous call site made the whole declaration disappear and the
 * highlight never painted. The block is split back into its declarations here — the core
 * helper stays the single source of the values, nothing is re-derived and nothing is cast.
 */
function pressHighlightStyle(
  xPx: number,
  yPx: number,
  minDimensionPx: number,
): React.CSSProperties {
  const style: React.CSSProperties = {};
  for (const declaration of pressHighlightCss(xPx, yPx, minDimensionPx).split(';')) {
    const colon = declaration.indexOf(':');
    if (colon <= 0) continue;
    const property = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    // Only the gradient travels back. The block's second declaration is
    // `mix-blend-mode: screen`, which `.glasskit-card__highlight`
    // (`src/styles/components.css`) already declares on the very same element —
    // and React types `mixBlendMode` as the closed `csstype` `MixBlendMode` union, so
    // forwarding an arbitrary `string` would need a cast to be accepted.
    if (property === 'background-image') style.backgroundImage = value;
  }
  return style;
}

/**
 * 折叠后的顶栏玻璃条：只有 blur(8) + 轻着色，**不加 lens**（顶栏是薄片，折射会显脏），
 * 透明度随 [collapsedFraction] 淡入，底部一条 0.5dp 分割线。
 */
export function GlassTopBarStrip(props: {
  collapsedFraction: number;
  className?: string;
  style?: React.CSSProperties;
  /** Kotlin `MaterialTheme.colorScheme.background`. */
  background?: string;
  /** Kotlin `MaterialTheme.colorScheme.onSurface`（L493 分割线用的就是它）。 */
  onSurface?: string;
  qualityRealtimeGlass?: boolean;
}) {
  const reduce = prefersReducedTransparency();
  const background = props.background ?? '#FFFFFF';
  const onSurface = props.onSurface ?? '#18191C';
  const realtime = props.qualityRealtimeGlass !== false && supportsRealtimeBlur();
  // Kotlin L465-469 — `cs.background.copy(alpha = 0.92f)` when reduce-transparency is on,
  // otherwise `0.60f`. `Color.copy(alpha = …)` is exactly `core/glass/color#withAlpha`.
  const tintAlpha = reduce ? 0.92 : 0.6;
  const f = props.collapsedFraction;

  return (
    <div
      className={['glass-top-bar-strip', props.className ?? ''].filter(Boolean).join(' ')}
      style={{
        position: 'relative',
        ...(realtime
          ? {
              WebkitBackdropFilter: `blur(${GlassTokens.TopBarBlur}px)`,
              backdropFilter: `blur(${GlassTokens.TopBarBlur}px)`,
              background: withAlpha(background, tintAlpha),
              // Kotlin L479 `layerBlock = { alpha = collapsedFraction }` — a real layer
              // alpha, so it also scales the hairline child (which is why Kotlin can
              // leave the hairline's own alpha at `0.10f * collapsedFraction`).
              opacity: f,
            }
          : {
              // Kotlin L483 `Modifier.background(tint.copy(alpha = tint.alpha * f))` —
              // the fraction is baked into the fill and there is NO layer alpha here.
              background: withAlpha(background, tintAlpha * f),
            }),
        ...props.style,
      }}
    >
      {/* 底部分割线：随折叠进度淡入，避免展开时顶栏出现一条硬边 —
          Kotlin L488-494 `cs.onSurface.copy(alpha = 0.10f * collapsedFraction)`。 */}
      <span
        aria-hidden="true"
        className="glass-top-bar-strip__hairline"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: `${GlassTokens.Hairline}px`,
          background: withAlpha(onSurface, 0.1 * f),
        }}
      />
    </div>
  );
}

export {
  GlassTokens,
  squirclePath,
  squircleRadiusFor,
  pageOverlayColor,
  glassKitTint,
  topGradientStops,
} from '../../../core/glass/glassKit';
export { adaptivePageWidthStyle } from '../../../core/glass/adaptiveSpec';
export { hsvToHex } from '../../../core/glass/color';