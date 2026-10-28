import { useEffect, useMemo, useRef } from 'react';
import {
  EASE_IN_OUT,
  LINEAR,
  chasingDotsStylesheet,
  type ChasingDotsOptions,
} from '../../core/glass/chasingDots';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/ChasingDots.kt` (159 non-blank lines) — FULL PORT
 *   lines 30-76  the six `transition.fractionTransition(initialValue = 0f,
 *              targetValue = 7f, fraction = 4, durationMillis = durationMillis * 4,
 *              easing = EaseInOut)` orbit drivers
 *              → one shared `@keyframes cd-angle` (the six differ only by
 *                `offsetMillis`, i.e. per-dot `animation-delay`)
 *   lines 77-104 the four `fractionTransition(initialValue = 0.512f / 0.64f /
 *              0.8f / 1f, targetValue = circleRatio, durationMillis = durationMillis / 2,
 *              repeatMode = Reverse, easing = LinearEasing)` radius drivers
 *              → `@keyframes cd-radius-3..6`
 *   lines 105-168 the Canvas body — six `drawCircle` calls, each positioned by
 *              `-(pathRadius * sin(θ)) + width/2` / `pathRadius * cos(θ) + height/2`
 *              → six SVG `<circle>` elements animated by those keyframes
 *
 * Android params (verbatim defaults):
 *   durationMillis = 2000, delayBetweenDotsMillis = 50, size = 40.dp,
 *   color = MaterialTheme.colorScheme.primary, circleRatio = 0.25f
 *
 * ADAPTATION — Compose infinite transitions → CSS `@keyframes`
 * `infiniteRepeatable(animation, StartOffset(offsetMillis))` maps to a negative
 * `animation-delay` (Compose's StartOffset *advances* the clock, CSS's delay
 * *postpones* the start, so the sign flips). The `RepeatMode.Reverse` maps to the
 * CSS `alternate` direction.
 *
 * Note the Kotlin body reads `this.size.height / 2` for `pathRadius` but mixes
 * `this.size.width` into the X placement — with the square default box both are
 * the same number, and the port reproduces the asymmetry verbatim.
 */
const DEFAULT_PRIMARY = '#059669';

export interface ChasingDotsProps {
  className?: string;
  style?: React.CSSProperties;
  durationMillis?: number;
  delayBetweenDotsMillis?: number;
  /** Box size in px; Kotlin default 40.dp. */
  size?: number;
  color?: string;
  /** Kotlin default `circleRatio = 0.25f`. */
  circleRatio?: number;
}

export function ChasingDots(props: ChasingDotsProps) {
  const options: ChasingDotsOptions = useMemo(
    () => ({
      durationMillis: props.durationMillis ?? 2000,
      delayBetweenDotsMillis: props.delayBetweenDotsMillis ?? 50,
      size: props.size ?? 40,
      color: props.color ?? DEFAULT_PRIMARY,
      circleRatio: props.circleRatio ?? 0.25,
    }),
    [
      props.durationMillis,
      props.delayBetweenDotsMillis,
      props.size,
      props.color,
      props.circleRatio,
    ],
  );

  const styleId = `chasing-dots-${options.durationMillis}-${options.delayBetweenDotsMillis}-${options.circleRatio}-${options.size}`;
  const injectedRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById(styleId) !== null) {
      injectedRef.current = styleId;
      return;
    }
    const el = document.createElement('style');
    el.id = styleId;
    el.textContent = chasingDotsStylesheet(options);
    document.head.appendChild(el);
    injectedRef.current = styleId;
  }, [styleId, options]);

  const size = options.size ?? 40;
  const delay = options.delayBetweenDotsMillis ?? 50;
  const angleMs = (options.durationMillis ?? 2000) * 4;
  const radiusMs = (options.durationMillis ?? 2000) / 2;
  const ratio = options.circleRatio ?? 0.25;
  const radius = size / 5;
  const radiusCommon = radius * ratio;
  const initials = [0.512, 0.64, 0.8, 1];

  return (
    <svg
      className={props.className}
      style={props.style}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      aria-hidden="true"
      role="presentation"
    >
      {[0, 1, 2, 3, 4, 5].map((i) => {
        // Dots 1 & 2 keep a constant radius (radiusCommon); 3..6 shrink.
        const isFixed = i < 2;
        const r = isFixed ? radiusCommon : (initials[i - 2] ?? 1) * radius;
        const animation = isFixed
          ? `cd-angle ${angleMs}ms ${EASE_IN_OUT} infinite ${-delay * i}ms`
          : `cd-angle ${angleMs}ms ${EASE_IN_OUT} infinite ${-delay * i}ms, ` +
            `cd-radius-${i + 1} ${radiusMs}ms ${LINEAR} infinite alternate`;
        return (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill={options.color}
            style={{ animation }}
          />
        );
      })}
    </svg>
  );
}