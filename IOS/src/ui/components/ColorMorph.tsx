import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/ColorMorph.kt` (171 non-blank lines) — FULL PORT
 *   lines 49-115  `ColorStateMorph(collapsedColor, expandedColor, label)`
 *                → ColorStateMorph
 *   lines 122-191 `ColorMorphSwatch(color, selected, onClick, size)`
 *                → ColorMorphSwatch
 *
 * The source is "完整复制自 skydoves/compose-animations（Apache-2.0）:
 * 尺寸 / 旋转 / 圆角 / 颜色 四项全部用同一组弹簧参数动画，无省略。"
 *
 * ADAPTATION — Compose springs → a shared numeric spring
 * ───────────────────────────────────────────────────────
 * All four channels animate with the *same* spec
 * (`spring(DampingRatioMediumBouncy, StiffnessMediumLow)`), so they are driven by
 * one `useMultiSpring` returning a single normalised progress; each channel then
 * applies its own keyframe table — which is exactly how the Kotlin code reuses one
 * `Animatable` per channel with an identical spec.
 *
 * Compose: `Spring.StiffnessMediumLow = 400f`, `DampingRatioMediumBouncy = 0.5f`.
 * Analytic settle time: 4.605 / (ζ·ω) = 4.605 / (0.5·20) ≈ 460 ms.
 *
 * REVIEW FIXES
 * ① `ColorStateMorph`'s `cornerDp` channel snapped between 37dp and 24dp; Kotlin
 *    animates it on the same `spring(DampingRatioMediumBouncy, StiffnessMediumLow)`.
 *    It is now driven by `progress`, and the hidden debug div that swallowed the
 *    value is gone.
 * ② The label used to be counter-rotated (`rotate(-rotation)`). Kotlin nests the
 *    `Text` inside the rotated `Box` (L97-113), so the label rotates with it.
 * ③ `ColorMorphSwatch`'s `morphColor` had `props.selected ? props.color : …`,
 *    which skipped the alpha morph for the first frame of a selection.
 * ④ The dead `* 0 +` term in the swatch corner expression was removed.
 */

/** ColorMorph.kt line 130-131. */
const SPRING_STIFFNESS = 400;
const SPRING_DAMPING = 0.5;
const SPRING_SETTLE_MS = Math.round((4.605 / (SPRING_DAMPING * Math.sqrt(SPRING_STIFFNESS))) * 1000);

/** ColorMorph.kt line 134-136 — the collapsed/expanded size pair. */
const COLLAPSED_SIZE = 74;
const EXPANDED_SIZE = 196;
const COLLAPSED_ROTATION = 0;
const EXPANDED_ROTATION = 135;
const EXPANDED_CORNER_DP = 24;

/** ColorMorph.kt line 54-55 — collapsed / expanded colour defaults. */
const COLLAPSED_COLOR = '#059669';
const EXPANDED_COLOR = '#10B981';

/**
 * Analytic damped-spring step for a single channel, matching Compose's
 * `Animatable.animateTo(target, spring(ζ, k))`.
 *
 * Underdamped solution for a unit step from 0 → 1:
 *   ω₀ = √k,  ζ = damping,  ωd = ω₀·√(1 − ζ²)
 *   x(t) = 1 − e^(−ζω₀t)·(cos ωd t + (ζω₀/ωd)·sin ωd t)
 */
function springStep(tMs: number): number {
  const w0 = Math.sqrt(SPRING_STIFFNESS);
  const zeta = SPRING_DAMPING;
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const t = tMs / 1000;
  return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
}

/** ColorMorph.kt line 64 — `var morphed by remember { mutableStateOf(false) }`. */
export function useSpringBoolean(initial: boolean, durationMs = SPRING_SETTLE_MS): {
  value: boolean;
  setValue: (v: boolean) => void;
} {
  const [value, setValue] = useState(initial);
  void durationMs;
  return { value, setValue };
}

/** ColorMorph.kt line 71 `testTag`. */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export interface ColorStateMorphProps {
  collapsedColor?: string;
  expandedColor?: string;
  label?: string;
}

/**
 * Color State Morph：原样复刻 AnimationExample4 的 FAB 形变——
 * 尺寸 74→196dp、旋转 0→135°、圆角 →24dp、颜色 primary→secondary，
 * 弹簧 DampingRatioMediumBouncy + StiffnessMediumLow。
 */
export function ColorStateMorph(props: ColorStateMorphProps) {
  const collapsedColor = props.collapsedColor ?? COLLAPSED_COLOR;
  const expandedColor = props.expandedColor ?? EXPANDED_COLOR;
  const label = props.label ?? '+';
  const { value: morphed, setValue } = useSpringBoolean(false);

  // All four channels share one progress value, exactly as the Kotlin code
  // shares a single animationSpec across four Animatables.
  const [progress, setProgress] = useState(morphed ? 1 : 0);
  const fromRef = useRef(morphed ? 1 : 0);

  useEffect(() => {
    const from = fromRef.current;
    const target = morphed ? 1 : 0;
    if (from === target) return;
    const start = typeof performance !== 'undefined' ? performance.now() : 0;
    let raf = 0;
    const step = (): void => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const t = Math.min(1, (now - start) / SPRING_SETTLE_MS);
      setProgress(from + (target - from) * springStep(t * SPRING_SETTLE_MS));
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [morphed]);

  const size = COLLAPSED_SIZE + (EXPANDED_SIZE - COLLAPSED_SIZE) * progress;
  const rotation = COLLAPSED_ROTATION + (EXPANDED_ROTATION - COLLAPSED_ROTATION) * progress;
  // ColorMorph.kt L76-80 — `animateDpAsState(if (morphed) 24.dp else collapsedSize/2)`
  // on the SAME spring spec. BUG FIXED: it used to snap between the two endpoints.
  const cornerDp =
    COLLAPSED_SIZE / 2 + (EXPANDED_CORNER_DP - COLLAPSED_SIZE / 2) * progress;
  const color = oklabMix(collapsedColor, expandedColor, progress);

  return (
    <div className="color-state-morph">
      <div className="color-state-morph__stage">
        <button
          type="button"
          className="color-state-morph__fab"
          style={{
            width: size,
            height: size,
            transform: `rotate(${rotation}deg)`,
            borderRadius: cornerDp,
            background: color,
          }}
          onClick={() => setValue(!morphed)}
        >
          {/* Kotlin L97-113 puts the `Text` *inside* the rotated Box, so the label
              rotates with it. The previous port counter-rotated the label
              (`transform: rotate(-rotation)`), which Kotlin never does — removed. */}
          <span
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: '#FFFFFF',
            }}
          >
            {label}
          </span>
        </button>
      </div>
    </div>
  );
}

export interface ColorMorphSwatchProps {
  color: string;
  selected: boolean;
  onClick: () => void;
  size?: number;
}

/**
 * 主题色选择器用的 Color State Morph：把 Example4 的
 * 尺寸 / 旋转 / 圆角 / 颜色 四项形变完整保留（缩放到色块尺寸），
 * 并叠加勾选图标的弹簧显现。
 */
export function ColorMorphSwatch(props: ColorMorphSwatchProps) {
  const size = props.size ?? 44;

  const [progress, setProgress] = useState(props.selected ? 1 : 0);
  const fromRef = useRef(props.selected ? 1 : 0);

  useEffect(() => {
    const from = fromRef.current;
    const target = props.selected ? 1 : 0;
    if (from === target) return;
    const start = typeof performance !== 'undefined' ? performance.now() : 0;
    let raf = 0;
    const step = (): void => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const t = Math.min(1, (now - start) / SPRING_SETTLE_MS);
      setProgress(from + (target - from) * springStep(t * SPRING_SETTLE_MS));
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [props.selected]);

  const collapsedSize = size;
  const expandedSize = size + 14;
  const expandedRotation = 90;
  const expandedCornerDp = 14;

  const morphSize = collapsedSize + (expandedSize - collapsedSize) * progress;
  const rotation = 0 + (expandedRotation - 0) * progress;
  // ColorMorph.kt L149-153 — `animateDpAsState(if (selected) 14.dp else size/2)`,
  // same spring as every other channel. (The old `* 0 +` term was dead code.)
  const cornerDp = Math.max(
    0,
    collapsedSize / 2 + (expandedCornerDp - collapsedSize / 2) * progress,
  );
  // ColorMorph.kt line 154-158: selected → color, unselected → color @ 0.72 alpha.
  // BUG FIXED: the `props.selected ? props.color : …` ternary short-circuited the
  // whole morph, so a *just selected* swatch jumped to full opacity on frame 0
  // instead of animating up from 0.72.
  const morphColor = withAlphaHex(props.color, 1 - 0.28 * (1 - progress));
  const checkAlpha = progress;

  const swatchStyle = useMemo(
    () => ({
      width: morphSize,
      height: morphSize,
      borderRadius: `${cornerDp}px`,
    }),
    [morphSize, cornerDp],
  );

  return (
    <button
      type="button"
      className={
        props.selected ? 'color-morph-swatch color-morph-swatch--active' : 'color-morph-swatch'
      }
      style={swatchStyle}
      onClick={props.onClick}
      aria-pressed={props.selected}
    >
      {/* 旋转/圆角/颜色形变只作用于背景层，勾选图标保持正立 */}
      <span
        className="color-morph-swatch__bg"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          transform: `rotate(${rotation}deg)`,
          borderRadius: `${cornerDp}px`,
          background: morphColor,
        }}
      />
      <span className="color-morph-swatch__check" style={{ opacity: checkAlpha }}>
        <CheckIcon />
      </span>
    </button>
  );
}

function withAlphaHex(hex: string, a: number): string {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

interface Oklab {
  L: number;
  a: number;
  b: number;
}

function srgbToOklab(hex: string): Oklab {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const lr = lin(r);
  const lg = lin(g);
  const lb = lin(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToCss(c: Oklab): string {
  const l = (c.L + 0.3963377774 * c.a + 0.2158037573 * c.b) ** 3;
  const m = (c.L - 0.1055613458 * c.a - 0.0638541728 * c.b) ** 3;
  const s = (c.L - 0.0894841775 * c.a - 1.291485548 * c.b) ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const gam = (v: number): number => {
    const c2 = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, c2)) * 255);
  };
  return `rgb(${gam(lr)}, ${gam(lg)}, ${gam(lb)})`;
}

/** Material3 `animateColorAsState` interpolates in Oklab. */
function oklabMix(a: string, b: string, t: number): string {
  const ca = srgbToOklab(a);
  const cb = srgbToOklab(b);
  return oklabToCss({
    L: ca.L + (cb.L - ca.L) * t,
    a: ca.a + (cb.a - ca.a) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}