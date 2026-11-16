import { type CSSProperties } from 'react';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/ShimmerBox.kt` (50 non-blank lines) — FULL PORT
 *   lines 24-53 `@Composable ShimmerBox(modifier, cornerRadius = 12)` → ShimmerBox
 *
 * Kotlin body, verbatim parameters:
 *   transition.animateFloat(-300f → 1200f, tween(1100, FastOutSlowInEasing), Restart)
 *   base = surfaceVariant.copy(alpha = 0.55f)
 *   glow = surfaceVariant.copy(alpha = 0.95f)
 *   Brush.linearGradient(listOf(base, glow, base),
 *                        start = Offset(x - 240f, 0f), end = Offset(x, 260f))
 *
 * The Kotlin comment (preserved):
 *   修复：原实现只计算了 Modifier 却没有可组合节点承载，函数实际不渲染任何东西，
 *   导致所有骨架屏占位都是纯空白（书库聚合搜索加载时可见 4 个空档位）。
 *
 * ADAPTATION — infinite transition → CSS gradient animation
 * The moving start/end offsets become a single `linear-gradient` whose
 * `background-position` animates; the `FastOutSlowInEasing` curve becomes the
 * `ease` timing function. The gradient's `hard-ish` three-stop shape is preserved.
 */
export interface ShimmerBoxProps {
  className?: string;
  style?: CSSProperties;
  /** Kotlin default 12 (dp). */
  cornerRadius?: number;
  /** Kotlin read `MaterialTheme.colorScheme.surfaceVariant`. */
  surfaceVariant?: string;
}

export function ShimmerBox(props: ShimmerBoxProps) {
  const cornerRadius = props.cornerRadius ?? 12;
  const surfaceVariant = props.surfaceVariant ?? '#F1F3F4';
  return (
    <div
      className={['shimmer-box', props.className ?? ''].filter(Boolean).join(' ')}
      aria-hidden="true"
      style={{
        borderRadius: `${cornerRadius}px`,
        backgroundImage: `linear-gradient(135deg, ${rgba(surfaceVariant, 0.55)} 0%, ${rgba(
          surfaceVariant,
          0.95,
        )} 50%, ${rgba(surfaceVariant, 0.55)} 100%)`,
        backgroundSize: '600px 260px',
        backgroundRepeat: 'no-repeat',
        animation: 'shimmer-sweep 1100ms ease-in-out infinite',
        ...props.style,
      }}
    />
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
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return `rgba(241, 243, 244, ${alpha})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}