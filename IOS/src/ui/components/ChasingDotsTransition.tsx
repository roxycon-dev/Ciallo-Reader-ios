/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/ChasingDotsTransition.kt` (51 non-blank lines) — FULL PORT
 *   lines 9-52  `InfiniteTransition.fractionTransition(...)` → `fractionTransitionCss`
 *                (core/glass/chasingDots.ts) re-exported here
 *   line 54     `val EaseInOut = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)` → EASE_IN_OUT
 *
 * `animateFloat(keyframes{…})` + `infiniteRepeatable(animation, StartOffset(offsetMillis))`
 * has no React equivalent, so this module ships the keyframe builder that the
 * ChasingDots component injects into the stylesheet.
 */

export {
  EASE_IN_OUT,
  FAST_OUT_SLOW_IN,
  LINEAR,
  chasingAngleKeyframes,
  chasingDotsStylesheet,
  chasingRadiusKeyframes,
  fractionTransitionCss,
} from '../../core/glass/chasingDots';
export type { FractionTransitionOptions } from '../../core/glass/chasingDots';