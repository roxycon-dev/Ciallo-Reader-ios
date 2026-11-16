/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/MaxFx.kt` (151 non-blank lines)
 * - `ui/components/MaxCardEffects.kt` (130 non-blank lines)
 *
 *   MaxFx.kt lines 35-40  GLASS_SHEEN_COLORS        → GLASS_SHEEN_COLORS
 *   MaxFx.kt lines 47-72  Modifier.glassSheen()     → glassSheenCss()
 *   MaxFx.kt lines 90-99  AURA_* constants          → AURA_INSET_DP / AURA_WIDTH_DP / AURA_ALPHA_MIN / AURA_ALPHA_MAX
 *   MaxFx.kt lines 135-190 Modifier.maxCardAura()   → maxCardAuraCss()
 *   MaxCardEffects.kt lines 40-88  chromaFlowEdge() → chromaFlowEdgeCss()
 *   MaxCardEffects.kt lines 94-136 shimmerPearl()   → shimmerPearlCss()
 *
 * ADAPTATION — Compose Canvas → CSS gradients
 * ───────────────────────────────────────────
 * All three effects are `drawBehind` overlays.  They become absolutely-positioned
 * pseudo-element layers (`.glass-sheen`, `.card-aura`, `.card-chroma`,
 * `.card-pearl`) whose animations are driven by CSS `@keyframes` instead of
 * `rememberInfiniteTransition`.  This keeps the "only in RenderQuality.MAX" gate
 * (an early `return this` on the Kotlin side) as a plain `if` at the call site.
 *
 * No AGSL/GPU shader is used by any of these three — they are Canvas draws, so the
 * port is pixel-faithful apart from sweep-gradient sampling differences
 * (`Brush.sweepGradient` vs `conic-gradient`, identical for a centred shape).
 *
 * REVIEW FIXES (glass / motion review) — the four infinite transitions are no
 * longer delegated to `src/styles/components.css` keyframes, because those keyframe
 * bodies do not carry the Kotlin numbers:
 *  ① `glass-sheen-sweep` moved `background-position` from -110% to 210% ⇒ a
 *     1.44·w sweep; Kotlin sweeps `-0.75w → -0.75w + (2w + h)`.
 * ② `shimmer-pearl-drift` used `translate(12%,4%) → translate(72%,19%)`, whose
 *     geometry resolves to `0.24·R … 1.44·R`; Kotlin centres the spot at
 *     `0.2w … 0.8w` horizontally and `0.3h … 0.45h` vertically.
 * ③ `card-aura-breathe` multiplied the baked 0.34 by 0.66 ⇒ 0.2244; Kotlin's floor
 *     is exactly 0.22.
 * ④ `card-aura-hue` used `filter: hue-rotate(0→360deg)`; Kotlin interpolates
 *     `lerpColor(primary, secondary, hueShift)`.
 * All four are now evaluated from the Kotlin expressions (`maxFxPhases`).
 */

/** The five infinite-transition phases, all derived from one clock reading. */
export interface MaxFxPhases {
  /** MaxFx.kt line 53 — tween(6000, Linear, Restart). */
  sheen: number;
  /** MaxFx.kt line 145 — tween(3000, Linear, Reverse). */
  auraBreathe: number;
  /** MaxFx.kt line 151 — tween(8000, Linear, Restart). */
  auraHue: number;
  /** MaxCardEffects.kt line 51 — tween(3500, Linear, Restart). */
  chroma: number;
  /** MaxCardEffects.kt line 113 — tween(4000, Linear, Reverse). */
  pearl: number;
}

export function maxFxPhases(tMs: number): MaxFxPhases {
  return {
    sheen: linearPhase(tMs, GLASS_SHEEN_DURATION_MS),
    auraBreathe: trianglePhase(tMs, AURA_BREATHE_DURATION_MS),
    auraHue: linearPhase(tMs, AURA_HUE_DURATION_MS),
    chroma: linearPhase(tMs, CHROMA_FLOW_DURATION_MS),
    pearl: trianglePhase(tMs, SHIMMER_PEARL_DURATION_MS),
  };
}

import { lerpColor, withAlpha } from './color';

/**
 * MaxFx.kt lines 35-40 — 高光带的四个色标：与 phase 无关，组合期常量化。
 * 原实现写在 drawBehind 里 → 每帧新建一次 listOf + 三次 Color.copy（纯浪费）。
 */
export const GLASS_SHEEN_COLORS: readonly string[] = [
  'transparent',
  withAlpha('#FFFFFF', 0.14),
  withAlpha('#FFFFFF', 0.22),
  'transparent',
];

/**
 * MaxFx.kt line 53 — tween(6000, easing = LinearEasing). */
export const GLASS_SHEEN_DURATION_MS = 6000;

/**
 * Compose `infiniteRepeatable(tween(d, LinearEasing), RepeatMode.Restart)` →
 * a linear ramp 0→1 with period `d`; `RepeatMode.Reverse` → a triangle wave with
 * period `2·d`. Both are evaluated from a wall-clock reading so the port needs
 * no stylesheet keyframes (and therefore reproduces the Kotlin values exactly).
 */
export function linearPhase(tMs: number, durationMs: number): number {
  const period = Math.max(1, durationMs);
  const t = ((tMs % period) + period) % period;
  return t / period;
}

export function trianglePhase(tMs: number, durationMs: number): number {
  const period = Math.max(1, durationMs) * 2;
  const half = period / 2;
  const t = ((tMs % period) + period) % period;
  return t <= half ? t / half : (period - t) / half;
}

/**
 * MaxFx.kt lines 47-72 `Modifier.glassSheen()` —
 * 每 ~6s 一道柔和光带斜向掠过卡面（rotate -24°，band width = size.width * 0.55）。
 *
 * BUG FIXED (two of them):
 * ① `Brush.horizontalGradient(colors = GLASS_SHEEN_COLORS, …)` spreads its four
 *    stops **evenly** across the band → 0% / 33.3333% / 66.6667% / 100%.  The old
 *    port used `0% 50% 50% 100%`, collapsing the 0.14→0.22 ramp into a hard step.
 * ② The band position is driven from Kotlin's own expression
 *    `x = -w·0.75 + phase·(2w + h)` instead of the stylesheet's
 *    `background-position: -110% → 210%`, whose percentage geometry gave a
 *    1.44·w sweep rather than Kotlin's 2w + h.
 */
export function glassSheenCss(width: number, height: number, phase: number): string {
  const bandWidth = width * 0.55;
  const x = -width * 0.75 + phase * glassSheenTravel(width, height);
  return (
    `transform:rotate(-24deg);` +
    `background-image:linear-gradient(90deg,` +
    `${GLASS_SHEEN_COLORS[0]} 0%,${GLASS_SHEEN_COLORS[1]} 33.3333%,` +
    `${GLASS_SHEEN_COLORS[2]} 66.6667%,${GLASS_SHEEN_COLORS[3]} 100%);` +
    `background-size:${bandWidth.toFixed(1)}px 100%;` +
    `background-position:${x.toFixed(2)}px center;` +
    `background-repeat:no-repeat;` +
    `will-change:transform;`
  );
}

/** MaxFx.kt line 57 — `travel = size.width * 2f + size.height`. */
export function glassSheenTravel(width: number, height: number): number {
  return width * 2 + height;
}

/** MaxFx.kt line 90 — 虹彩细边中心相对卡片边界向内缩进的距离（dp）。 */
export const AURA_INSET_DP = 1.0;
/** MaxFx.kt line 93 — 虹彩细边宽度（dp）。 */
export const AURA_WIDTH_DP = 1.8;
/** MaxFx.kt line 96 — 呼吸区间的最淡端（alpha 0..1）。 */
export const AURA_ALPHA_MIN = 0.22;
/** MaxFx.kt line 99 — 呼吸区间的最浓端（alpha 0..1）。 */
export const AURA_ALPHA_MAX = 0.34;
/** MaxFx.kt line 145 — tween(3000, easing = LinearEasing), RepeatMode.Reverse. */
export const AURA_BREATHE_DURATION_MS = 3000;
/** MaxFx.kt line 151 — tween(8000, easing = LinearEasing), Restart. */
export const AURA_HUE_DURATION_MS = 8000;

/** MaxFx.kt lines 168-169 — `breathT = |sin(breathe·π)|`, `glowAlpha = 0.22 + 0.12·breathT`. */
export function auraGlowAlpha(breathe: number): number {
  const breathT = Math.abs(Math.sin(breathe * Math.PI));
  return AURA_ALPHA_MIN + (AURA_ALPHA_MAX - AURA_ALPHA_MIN) * breathT;
}

/**
 * MaxFx.kt lines 135-190 `Modifier.maxCardAura()` —
 * 卡片**内缘**的虹彩呼吸细边（1 圈 sweep 描边，inset 1dp、宽 1.8dp、
 * alpha 在 0.22..0.34 之间 sin 往复、周期 ~3s；色相偏移周期 ~8s）。
 *
 * BUG FIXED: the old port baked `AURA_ALPHA_MAX` into the stops and leaned on the
 * stylesheet's `card-aura-breathe` (opacity 0.66→1), which lands on 0.2244 rather
 * than the Kotlin 0.22 floor, and used `filter: hue-rotate(0→360deg)` where Kotlin
 * interpolates `lerpColor(primary, secondary, hueShift)` — a totally different
 * colour path. Both are now computed from the Kotlin expressions.
 *
 * The Kotlin guard `if (w <= margin * 2f || h <= margin * 2f) return` is
 * preserved: extremely small cards draw nothing.
 */
export function maxCardAuraCss(options: {
  width: number;
  height: number;
  primary: string;
  secondary: string;
  cornerRadiusDp?: number;
  breathe?: number;
  hueShift?: number;
}): string {
  const inset = AURA_INSET_DP;
  const widthPx = AURA_WIDTH_DP;
  const margin = inset + widthPx / 2;
  if (options.width <= margin * 2 || options.height <= margin * 2) return '';
  const radius = Math.max(0, (options.cornerRadiusDp ?? 24) - inset);
  // Kotlin: c1 = lerpColor(primary, secondary, hueShift);
  //         c2 = lerpColor(secondary, primary, hueShift);
  const hueShift = options.hueShift ?? 0;
  const c1 = lerpColor(options.primary, options.secondary, hueShift);
  const c2 = lerpColor(options.secondary, options.primary, hueShift);
  const glowAlpha = auraGlowAlpha(options.breathe ?? 0);
  const stops = [c1, c2, c1].map((c) => withAlpha(c, glowAlpha));
  return (
    `position:absolute;inset:${inset}px;pointer-events:none;` +
    `border:none;padding:${widthPx}px;` +
    `border-radius:${radius}px;` +
    `background-image:conic-gradient(from 0deg,${stops.join(',')});` +
    `-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);` +
    `mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);` +
    `-webkit-mask-composite:xor;mask-composite:exclude;`
  );
}

/** MaxCardEffects.kt line 44 — default `durationMillis = 3500`. */
export const CHROMA_FLOW_DURATION_MS = 3500;
/** MaxCardEffects.kt line 107 — default `durationMillis = 4000`. */
export const SHIMMER_PEARL_DURATION_MS = 4000;

/**
 * MaxCardEffects.kt lines 40-88 `Modifier.chromaFlowEdge()` —
 * 边缘彩色光带巡游：沿卡片轮廓画一圈 sweep 描边，亮段沿周长匀速移动。
 * 极低 alpha + 多色过渡 → 柔和虹彩微光（非实色线条）。
 */
export function chromaFlowEdgeCss(options: {
  width: number;
  height: number;
  primary: string;
  secondary: string;
  cornerRadiusDp?: number;
  /** Stroke width in px; Kotlin uses 2.dp (line 62). */
  strokeWidth?: number;
}): string {
  if (options.width <= 0 || options.height <= 0) return '';
  const strokeW = options.strokeWidth ?? 2;
  const radius = options.cornerRadiusDp ?? 24;
  const colors = [
    'transparent',
    withAlpha(options.primary, 0.12),
    withAlpha(options.secondary, 0.18),
    withAlpha('#FFFFFF', 0.22),
    withAlpha(options.secondary, 0.18),
    withAlpha(options.primary, 0.12),
    'transparent',
  ];
  return (
    `position:absolute;inset:0;pointer-events:none;` +
    `border:${strokeW}px solid transparent;` +
    `border-radius:${radius}px;` +
    `background-image:conic-gradient(from 0deg,${colors.join(',')});` +
    `-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);` +
    `mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);` +
    `-webkit-mask-composite:xor;mask-composite:exclude;padding:${strokeW}px;` +
    `animation:chroma-flow-spin ${CHROMA_FLOW_DURATION_MS}ms linear infinite;`
  );
}

/**
 * MaxCardEffects.kt lines 94-96 — 珠光光斑的三个色标：与 phase 无关，组合期常量化。
 */
export const SHIMMER_PEARL_COLORS: readonly string[] = [
  withAlpha('#FFFFFF', 0.1),
  withAlpha('#FFFFFF', 0.04),
  'transparent',
];

/**
 * MaxCardEffects.kt lines 104-136 `Modifier.shimmerPearl()` —
 * 卡面上一块柔和的椭圆渐变光斑缓慢漂移。
 *
 * Kotlin per frame: `cx = w·(0.2 + 0.6·phase)`,
 * `cy = h·(0.3 + 0.15·sin(phase·π))`, `spotR = min(w,h)·0.55`.
 *
 * BUG FIXED: the previous port anchored the spot with `margin-left/-top: -spotR`
 * and let `shimmer-pearl-drift` (a stylesheet keyframe this module does not own)
 * drive `translate(12%,4%) → translate(72%,19%)`, which lands the centre at
 * `0.24·R … 1.44·R` horizontally instead of `0.2·w … 0.8·w` — off-card on any
 * non-square card. The phase is now computed here from the same
 * `RepeatMode.Reverse` triangle wave Kotlin's `infiniteTransition` produces, so
 * the drift is exactly the Kotlin trajectory and needs no stylesheet keyframe.
 */
export function shimmerPearlPhase(tMs: number): number {
  return trianglePhase(tMs, SHIMMER_PEARL_DURATION_MS);
}

export function shimmerPearlCss(
  width: number,
  height: number,
  phase: number,
): string {
  if (width <= 0 || height <= 0) return '';
  const spotR = Math.min(width, height) * 0.55;
  const cx = width * (0.2 + 0.6 * phase);
  const cy = height * (0.3 + 0.15 * Math.sin(phase * Math.PI));
  return (
    `position:absolute;left:${(cx - spotR).toFixed(2)}px;top:${(cy - spotR).toFixed(2)}px;` +
    `width:${(spotR * 2).toFixed(2)}px;height:${(spotR * 2).toFixed(2)}px;` +
    `border-radius:50%;pointer-events:none;` +
    `background-image:radial-gradient(circle ${spotR.toFixed(2)}px,` +
    `${SHIMMER_PEARL_COLORS[0]} 0%,${SHIMMER_PEARL_COLORS[1]} 50%,${SHIMMER_PEARL_COLORS[2]} 100%);`
  );
}

/** MaxCardEffects.kt lines 138-151 `Path.addRoundRect` — quadratic-bézier rounded rect. */
export function addRoundRectPath(w: number, h: number, r: number): string {
  const maxR = Math.min(w, h) / 2;
  const cr = Math.min(r, maxR);
  return (
    `M${cr},0 L${w - cr},0 Q${w},0 ${w},${cr} L${w},${h - cr} ` +
    `Q${w},${h} ${w - cr},${h} L${cr},${h} Q0,${h} 0,${h - cr} L0,${cr} ` +
    `Q0,0 ${cr},0 Z`
  );
}