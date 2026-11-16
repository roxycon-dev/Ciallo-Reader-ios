/**
 * comicTurnGesture.ts  ←  novel-reader/app/src/main/java/com/example/ui/comic/ComicTurnGesture.kt
 *
 * Kotlin source: 28 lines / 27 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1-6     package + imports                     — package decl / android imports │
 * │ L8-13    `comicPagerThreshold` @Composable     — became a pure `pagerThreshold` │
 * │           (LocalConfiguration.current)            + a host-side span reader;     │
 * │                                                        `src/core` may not touch  │
 * │                                                        the DOM (E61), so the     │
 * │                                                        screen span is injected.  │
 * │ L15-17   `comicTurnTravel`                     — ported verbatim                 │
 * │ L19-27   `comicTurnIntent`                     — ported verbatim                 │
 * └────────────────────────────────────────────────────────────────────────────────┘
 *
 * Numbers lifted verbatim: `spanPx * 0.18f` clamped to `64f*density .. 104f*density`,
 * threshold clamped to `0.04f .. 0.35f`, velocity gate `850f * density`,
 * flick minimum `18f * density`.
 */

/** Kotlin `kotlin.math.abs` — identical semantics in JS. */
const abs = Math.abs;
/** Kotlin `kotlin.math.sign(x).toInt()` — note `sign(0f) == 0f`, hence `0`. */
function signInt(value: number): number {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

/**
 * Kotlin L12 `(comicTurnTravel(span, 1f) / span).coerceIn(0.04f, 0.35f)`.
 *
 * `density` is fixed at `1f` on both sides: the ratio is scale-invariant, so
 * cancelling it keeps the Kotlin result bit-identical (Kotlin computes
 * `travel/density ÷ span/density`, we compute `travel(1f)/span`).
 */
export function pagerThreshold(spanPx: number): number {
  const span = Math.max(1, spanPx);
  return clamp(comicTurnTravel(span, 1) / span, 0.04, 0.35);
}

/**
 * Kotlin L16-17 `(spanPx * 0.18f).coerceIn(64f * density, 104f * density)`.
 *
 * Doc comment kept verbatim: "Physical travel stays bounded on tablets; velocity
 * only helps intentional swipes."
 */
export function comicTurnTravel(spanPx: number, density: number): number {
  return clamp(spanPx * 0.18, 64 * density, 104 * density);
}

/**
 * Kotlin L19-27 `comicTurnIntent`.
 *
 * Returns the signed direction (-1 / +1) when the gesture should commit a page
 * turn, or `0` when it should not. Kept branch-for-branch identical:
 *   ① guard on non-finite / non-positive inputs,
 *   ② reject gestures that reverse against their own velocity,
 *   ③ accept when either the distance reached `comicTurnTravel` (a *far* drag)
 *      or the velocity gate fired with matching direction (a *flick*).
 */
export function comicTurnIntent(
  distancePx: number,
  velocityPx: number,
  spanPx: number,
  density: number,
): number {
  if (!Number.isFinite(distancePx) || !Number.isFinite(velocityPx)) return 0;
  if (spanPx <= 0 || density <= 0) return 0;
  const distance = abs(distancePx);
  const reversed = velocityPx * distancePx < 0 && abs(velocityPx) >= 850 * density;
  if (reversed) return 0;
  const far = distance >= comicTurnTravel(spanPx, density);
  const flick =
    distance >= 18 * density && abs(velocityPx) >= 850 * density && velocityPx * distancePx > 0;
  return far || flick ? signInt(distancePx) : 0;
}

/** Kotlin `Float.coerceIn(min, max)` — NaN falls through to `min` on both sides. */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}
