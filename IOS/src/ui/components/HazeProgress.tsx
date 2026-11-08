import { type CSSProperties } from 'react';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/HazeProgress.kt` (64 non-blank lines) — FULL PORT
 *   lines 23-68 `@Composable FlowingGradientProgressBar(progress, color, modifier)`
 *              → FlowingGradientProgressBar
 *
 * Kotlin body:
 *   offset: 0f → 1000f, tween(2000, LinearEasing), Restart, label "flow_offset"
 *   Canvas height 12.dp, fillMaxWidth
 *   track  = drawRoundRect(color.copy(alpha = 0.15f), height/2 corner)
 *   brush  = Brush.linearGradient(listOf(color@0.7, color, color@0.7),
 *                                  start = Offset(offset - 1000f, 0f),
 *                                  end   = Offset(offset, 0f))
 *   fill   = drawRoundRect(brush, Size(width * progress.coerceIn(0,1), height))
 *
 * ADAPTATION — Compose Canvas → CSS gradients
 * The two rounded rects become two absolutely-stacked divs with
 * `border-radius: 999px`; the flowing gradient animates its `background-position`
 * on a 2000ms linear loop.  Progress width is `width * coerceIn(0f, 1f)`.
 */
export interface FlowingGradientProgressBarProps {
  progress: number;
  color: string;
  className?: string;
  style?: CSSProperties;
}

export function FlowingGradientProgressBar(props: FlowingGradientProgressBarProps) {
  const progress = Math.max(0, Math.min(1, props.progress));
  return (
    <div
      className={['flowing-progress', props.className ?? ''].filter(Boolean).join(' ')}
      role="progressbar"
      aria-valuenow={Math.round(progress * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={props.style}
    >
      <div
        className="flowing-progress__track"
        style={{ background: rgba(props.color, 0.15) }}
      />
      {progress > 0 ? (
        <div
          className="flowing-progress__fill"
          style={{
            width: `${(progress * 100).toFixed(3)}%`,
            backgroundImage:
              `linear-gradient(90deg, ${rgba(props.color, 0.7)} 0%, ${props.color} 50%, ` +
              `${rgba(props.color, 0.7)} 100%)`,
            backgroundSize: '200px 100%',
            animation: 'flowing-progress-sweep 2000ms linear infinite',
          }}
        />
      ) : null}
    </div>
  );
}

function rgba(hex: string, alpha: number): string {
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
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}