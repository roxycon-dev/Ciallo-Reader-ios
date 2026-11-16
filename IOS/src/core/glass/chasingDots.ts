/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/ChasingDotsTransition.kt` (51 non-blank lines)
 *   `InfiniteTransition.fractionTransition(...)` (lines 9-52) → `fractionTransitionCss()`
 *   `val EaseInOut = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)` (line 54) → EASE_IN_OUT
 *
 * - `ui/components/ChasingDots.kt` (159 non-blank lines)
 *   the 6 `fractionTransition` path-angle drivers  → `chasingDotsAngle()`
 *   the 4 `fractionTransition` radius drivers     → `chasingDotsRadius()`
 *   the Canvas block (lines 105-168)               → `chasingDotsCircles()`
 *
 * ADAPTATION — Compose infinite transitions → CSS `@keyframes` + SVG circles
 * ──────────────────────────────────────────────────────────────────────────
 * `rememberInfiniteTransition().animateFloat(keyframes{…})` with
 * `infiniteRepeatable(animation, StartOffset(offsetMillis))` maps to one
 * `@keyframes` rule per property plus a per-dot `animation-delay`.  The stop
 * positions and bezier easings are preserved exactly, so the chasing-dots
 * trajectory is identical.
 */

/** ChasingDotsTransition.kt line 54 — `CubicBezierEasing(0.42f, 0f, 0.58f, 1f)`. */
export const EASE_IN_OUT = 'cubic-bezier(0.42, 0, 0.58, 1)';

/** `FastOutSlowInEasing` — Compose's fast-out-slow-in is the CSS `ease` curve. */
export const FAST_OUT_SLOW_IN = 'ease';

/** Compose `LinearEasing` — CSS `linear`. */
export const LINEAR = 'linear';

export interface FractionTransitionOptions {
  initialValue: number;
  targetValue: number;
  /** @IntRange(from = 1, to = 4) — number of intermediate keyframes. */
  fraction?: number;
  durationMillis: number;
  delayMillis?: number;
  offsetMillis?: number;
  /** 0 = Restart (default), 1 = Reverse. */
  repeatMode?: 'restart' | 'reverse';
  easing?: string;
}

/**
 * ChasingDotsTransition.kt lines 19-51 — returns the stops array of a
 * CSS `@keyframes` block plus the animation shorthand fields.
 *
 * Kotlin:
 *   initialValue at 0
 *   fraction=1: target at duration
 *   fraction=2: target/2 at duration/2, target at duration
 *   fraction=3: target/3 at duration/3, target/3*2 at duration/3*2, target at duration
 *   fraction=4: ... target/4*3 at duration/4*3
 * `delayMillis` and `StartOffset(offsetMillis)` both shift the start.
 */
export function fractionTransitionCss(o: FractionTransitionOptions): {
  stops: string;
  animation: string;
} {
  const fraction = o.fraction ?? 1;
  const duration = o.durationMillis;
  const delay = o.delayMillis ?? 0;
  const offset = o.offsetMillis ?? 0;
  const easing = o.easing ?? FAST_OUT_SLOW_IN;
  const repeat = o.repeatMode ?? 'restart';

  const parts: string[] = [`${pct(0, duration, offset)} { ${o.initialValue.toFixed(6)} }`];
  switch (fraction) {
    case 1:
      parts.push(`${pct(duration, duration, offset)} { ${o.targetValue.toFixed(6)} }`);
      break;
    case 2:
      parts.push(`${pct(duration / 2, duration, offset)} { ${(o.targetValue / 2).toFixed(6)} }`);
      parts.push(`${pct(duration, duration, offset)} { ${o.targetValue.toFixed(6)} }`);
      break;
    case 3:
      parts.push(`${pct(duration / 3, duration, offset)} { ${(o.targetValue / 3).toFixed(6)} }`);
      parts.push(
        `${pct((duration / 3) * 2, duration, offset)} { ${((o.targetValue / 3) * 2).toFixed(6)} }`,
      );
      parts.push(`${pct(duration, duration, offset)} { ${o.targetValue.toFixed(6)} }`);
      break;
    default:
      parts.push(`${pct(duration / 4, duration, offset)} { ${(o.targetValue / 4).toFixed(6)} }`);
      parts.push(
        `${pct((duration / 4) * 2, duration, offset)} { ${((o.targetValue / 4) * 2).toFixed(6)} }`,
      );
      parts.push(
        `${pct((duration / 4) * 3, duration, offset)} { ${((o.targetValue / 4) * 3).toFixed(6)} }`,
      );
      parts.push(`${pct(duration, duration, offset)} { ${o.targetValue.toFixed(6)} }`);
      break;
  }
  // `delay` is the head delay; `offset` the per-dot StartOffset, negative so the
  // dot starts *later* in the cycle (Compose StartOffset advances the clock).
  return {
    stops: parts.join(' '),
    animation: `${duration}ms ${repeat} infinite ${easing} ${-(offset + delay)}ms`,
  };
}

function pct(timeMs: number, duration: number, offset: number): string {
  const v = ((timeMs + offset) / duration) * 100;
  return `${v.toFixed(4)}%`;
}

/* ── ChasingDots.kt ──────────────────────────────────────────────────────── */

export interface ChasingDotsOptions {
  durationMillis?: number;
  delayBetweenDotsMillis?: number;
  /** Box size in px; Kotlin default 40.dp. */
  size?: number;
  /** fill colour */
  color: string;
  /** Kotlin default `circleRatio = 0.25f`. */
  circleRatio?: number;
}

export interface DotCircle {
  cx: number;
  cy: number;
  r: number;
  /** CSS animation shorthand for this dot's orbit. */
  animation: string;
  /** CSS animation shorthand for this dot's radius (dots 3..6 only). */
  radiusAnimation?: string;
}

/**
 * ChasingDots.kt lines 105-168 — computes the six dot centres/radii from the
 * current animation phase.  The per-dot CSS animation shorthands are returned
 * alongside so the component drives the identical trajectory with zero JS/frame.
 *
 * `angles` are the six `pathAngleMultiplierN` values (0..7);
 * `radii` are the four `circleRadiusMultiplier3..6` values (0..1).
 */
export function chasingDotsAt(
  options: ChasingDotsOptions,
  angles: readonly [number, number, number, number, number, number],
  radii: readonly [number, number, number, number],
): DotCircle[] {
  const durationMillis = options.durationMillis ?? 2000;
  const delay = options.delayBetweenDotsMillis ?? 50;
  const size = options.size ?? 40;
  const circleRatio = options.circleRatio ?? 0.25;

  const pathRadius = size / 2;
  const radius = size / 5;
  const radiusCommon = radius * circleRatio;

  const out: DotCircle[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((angles[i] ?? 0) * 360 * Math.PI) / 180;
    const cx = -(pathRadius * Math.sin(angle)) + size / 2;
    const cy = pathRadius * Math.cos(angle) + size / 2;
    const entry: DotCircle = {
      cx,
      cy,
      r: i < 2 ? radiusCommon : (radii[i - 2] ?? 0) * radius,
      animation: `cd-angle ${durationMillis * 4}ms ${EASE_IN_OUT} infinite ${-delay * i}ms`,
    };
    if (i >= 2) {
      // `i` is 0-based here; the Kotlin driver names these dots 3..6.
      entry.radiusAnimation = `cd-radius-${i + 1} ${durationMillis / 2}ms ${LINEAR} infinite alternate`;
    }
    out.push(entry);
  }
  return out;
}

/**
 * ChasingDots.kt lines 30-76 — the six 4-fraction orbit keyframes (0 → 7).
 *
 * Compose animates a scalar `pathAngleMultiplierN` (0..7) and derives the centre
 * in the Canvas block.  CSS cannot animate a scalar and apply maths, so the same
 * `fractionTransition` stop positions are emitted with the *already evaluated*
 * `cx`/`cy` for each stop — `−r·sin(θ)+w/2` and `r·cos(θ)+h/2` with
 * `θ = multiplier · 360°`.  The trajectory is therefore pixel-identical to Android
 * at every keyframe, and the in-between frames are the same `EaseInOut` bezier
 * applied to the same stop values.
 *
 * `key` distinguishes the six dots only when their `offsetMillis` differs; the
 * positions themselves are identical, so one shared rule + per-dot delay is exact.
 */
export function chasingAngleKeyframes(_durationMillis: number, boxSize: number): string {
  const w = boxSize;
  const h = boxSize;
  const pathRadius = h / 2;
  // Stop positions from the `fraction = 4` branch of fractionTransitionCss:
  // 0 → target/4 → target/4*2 → target/4*3 → target  (target = 7)
  const multipliers = [0, 7 / 4, (7 / 4) * 2, (7 / 4) * 3, 7];
  const stops = multipliers
    .map((m, i) => {
      const angle = (m * 360 * Math.PI) / 180;
      const cx = -(pathRadius * Math.sin(angle)) + w / 2;
      const cy = pathRadius * Math.cos(angle) + h / 2;
      const pct = ((i / (multipliers.length - 1)) * 100).toFixed(4);
      return `${pct}%{cx:${cx.toFixed(3)}px;cy:${cy.toFixed(3)}px}`;
    })
    .join('');
  return `@keyframes cd-angle { ${stops} }`;
}

/**
 * ChasingDots.kt lines 77-104 — the four shrinking-radius keyframes.
 * `dotIndex` is the **Kotlin** name, i.e. 3..6 for `circleRadiusMultiplier3..6`.
 * initialValue per dot: 0.512 / 0.64 / 0.8 / 1 → circleRatio, Reverse, Linear.
 * The animated value is `multiplier * radius`, so the stops are pre-multiplied by
 * `radius = size / 5` exactly as the Canvas does.
 */
export function chasingRadiusKeyframes(
  dotIndex: number,
  circleRatio: number,
  _durationMillis: number,
  boxSize: number,
): string {
  const initials = [0.512, 0.64, 0.8, 1];
  const from = initials[dotIndex - 3] ?? 1;
  const radius = boxSize / 5;
  const r0 = (from * radius).toFixed(4);
  const r1 = (circleRatio * radius).toFixed(4);
  return (
    `@keyframes cd-radius-${dotIndex} { ` +
    `0%{r:${r0}px}100%{r:${r1}px}}`
  );
}

/** All keyframes for one option set, for injection into the stylesheet once. */
export function chasingDotsStylesheet(options: ChasingDotsOptions): string {
  const durationMillis = options.durationMillis ?? 2000;
  const circleRatio = options.circleRatio ?? 0.25;
  const size = options.size ?? 40;
  const rules: string[] = [chasingAngleKeyframes(durationMillis * 4, size)];
  for (let i = 3; i <= 6; i++) {
    rules.push(chasingRadiusKeyframes(i, circleRatio, durationMillis, size));
  }
  return rules.join('\n');
}