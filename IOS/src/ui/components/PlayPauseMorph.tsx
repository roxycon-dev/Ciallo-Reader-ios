import { useEffect, useRef, useState } from 'react';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/PlayPauseMorph.kt` (104 non-blank lines) — FULL PORT
 *   lines 34-76  `PlayPauseMorph(progress, iconBoxDp)`   → PlayPauseMorph
 *   line 78      `private fun lerp(start, end, fraction)` → `lerp` (core)
 *   lines 82-111 `PlayPauseMorphButton(isPlaying, onClick, sizeDp)` → PlayPauseMorphButton
 *
 * ADAPTATION — Compose Canvas Path → SVG `<path>`
 * ───────────────────────────────────────────────────
 * The two morphing polygons are pure `moveTo/lineTo/close` on interpolated points,
 * so the SVG `d` attribute is byte-for-byte equivalent to the Kotlin Path builder.
 * `animateFloatAsState(tween(500))` + `animateColorAsState(tween(500))` → a
 * requestAnimationFrame-driven numeric spring (see `useMorphValue`) so the two
 * channels stay exactly in lockstep with the Kotlin behaviour.
 */

/** PlayPauseMorph.kt line 78 — `start + (end - start) * fraction`. */
function lerp(start: number, end: number, fraction: number): number {
  return start + (end - start) * fraction;
}

/**
 * 播放/暂停形态动画（skydoves/compose-animations 原版实现）。
 *
 * @param progress 0 = play triangle, 1 = pause bars.
 * @param iconBoxDp Kotlin canvas is `(iconBoxDp / 2).dp`; the SVG viewBox matches.
 */
export function PlayPauseMorph(props: { progress: number; iconBoxDp: number }) {
  const { progress } = props;
  // Canvas size = iconBoxDp / 2 dp. The Kotlin maths is all in that unit space,
  // so we use a 100×100 viewBox and scale the same constants by 1/50.
  const w = 100;
  const h = 100;
  const cx = w / 2;
  const cy = h / 2;
  const triHalf = w * 0.32;
  const barHalfW = w * 0.12;
  const barGap = w * 0.18;

  const triTopX = cx - triHalf * 0.65;
  const triTopY = cy - triHalf;
  const triBotX = cx - triHalf * 0.65;
  const triBotY = cy + triHalf;
  const triRightX = cx + triHalf;
  const triRightY = cy;

  const leftBarL = cx - barGap - barHalfW;
  const leftBarR = cx - barGap + barHalfW;
  const rightBarL = cx + barGap - barHalfW;
  const rightBarR = cx + barGap + barHalfW;
  const barTop = cy - triHalf;
  const barBot = cy + triHalf;

  const leftPath =
    `M${lerp(triTopX, leftBarL, progress)},${lerp(triTopY, barTop, progress)} ` +
    `L${lerp(triRightX, leftBarR, progress)},${lerp(triRightY, barTop, progress)} ` +
    `L${lerp(triRightX, leftBarR, progress)},${lerp(triRightY, barBot, progress)} ` +
    `L${lerp(triBotX, leftBarL, progress)},${lerp(triBotY, barBot, progress)} Z`;

  const rightPath =
    `M${lerp(triRightX, rightBarL, progress)},${lerp(triRightY, barTop, progress)} ` +
    `L${lerp(triRightX, rightBarR, progress)},${lerp(triRightY, barTop, progress)} ` +
    `L${lerp(triRightX, rightBarR, progress)},${lerp(triRightY, barBot, progress)} ` +
    `L${lerp(triRightX, rightBarL, progress)},${lerp(triRightY, barBot, progress)} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={props.iconBoxDp / 2}
      height={props.iconBoxDp / 2}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path d={leftPath} fill="#FFFFFF" />
      <path d={rightPath} fill="#FFFFFF" />
    </svg>
  );
}

/**
 * PlayPauseMorph.kt lines 88-101 — `tween(durationMillis = 500)` for both the
 * morph progress and the background colour.
 *
 * `animateFloatAsState` / `animateColorAsState` share one tween spec, so a single
 * rAF loop drives both channels and they stay in lockstep exactly as on Android.
 */
function useMorphTween(isPlaying: boolean, durationMs = 500): number {
  const target = isPlaying ? 1 : 0;
  const [progress, setProgress] = useState(target);
  // Read only inside the effect below (an external-system subscription), never
  // during render — the React 19 `react-hooks/refs` rule.
  const progressRef = useRef(target);

  useEffect(() => {
    const from = progressRef.current;
    if (from === target) return;
    const start = typeof performance !== 'undefined' ? performance.now() : 0;
    let raf = 0;
    // FastOutSlowInEasing — the Compose `tween(500)` default.
    const ease = cubicBezierEase(0.4, 0, 0.2, 1);
    const step = (): void => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const t = Math.min(1, (now - start) / durationMs);
      const next = from + (target - from) * ease(t);
      progressRef.current = next;
      setProgress(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return progress;
}

/** Cubic-bezier easing solver (x1,y1,x2,y2) for t ∈ 0..1. */
function cubicBezierEase(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton iteration on x(u) = t
    let u = t;
    for (let i = 0; i < 6; i++) {
      const x = bezier1(u, x1, x2) - t;
      const dx = bezier1d(u, x1, x2);
      if (Math.abs(x) < 1e-6) break;
      if (Math.abs(dx) < 1e-6) break;
      u -= x / dx;
    }
    return bezier1(u, y1, y2);
  };
}

function bezier1(u: number, p1: number, p2: number): number {
  const mu = 1 - u;
  return 3 * mu * mu * u * p1 + 3 * mu * u * u * p2 + u * u * u;
}

function bezier1d(u: number, p1: number, p2: number): number {
  const mu = 1 - u;
  return 3 * mu * mu * p1 + 6 * mu * u * (p2 - p1) + 3 * u * u * (1 - p2);
}

/** 圆形播放/暂停按钮：点击时播放键与暂停键随背景色一起形变。 */
export function PlayPauseMorphButton(props: {
  isPlaying: boolean;
  onClick: () => void;
  sizeDp?: number;
  /** Theme tokens — Compose read `MaterialTheme.colorScheme.primary/secondary`. */
  primary?: string;
  secondary?: string;
}) {
  const sizeDp = props.sizeDp ?? 40;
  const primary = props.primary ?? '#059669';
  const secondary = props.secondary ?? '#10B981';
  // One tween drives both the morph progress and the colour, exactly as the
  // Kotlin pair of `animate*AsState(tween(500))` calls sharing a spec did.
  const morphProgress = useMorphTween(props.isPlaying, 500);
  const colorFrom = props.isPlaying ? secondary : primary;
  const colorTo = props.isPlaying ? primary : secondary;
  // `animateColorAsState` in M3 interpolates in Oklab.
  const background = oklabMix(colorFrom, colorTo, morphProgress);

  return (
    <button
      type="button"
      className="play-pause-button"
      style={{ background, width: sizeDp, height: sizeDp, borderRadius: '50%' }}
      onClick={props.onClick}
      aria-label={props.isPlaying ? '暂停' : '播放'}
    >
      <PlayPauseMorph progress={morphProgress} iconBoxDp={sizeDp} />
    </button>
  );
}

/** Oklab interpolation, matching Material3's `animateColorAsState` colour space. */
function oklabMix(a: string, b: string, t: number): string {
  const ca = srgbToOklab(a);
  const cb = srgbToOklab(b);
  const mixed = {
    L: ca.L + (cb.L - ca.L) * t,
    a: ca.a + (cb.a - ca.a) * t,
    b: ca.b + (cb.b - ca.b) * t,
  };
  return oklabToCss(mixed);
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
  const bb = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const lr = lin(r);
  const lg = lin(g);
  const lb = lin(bb);
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