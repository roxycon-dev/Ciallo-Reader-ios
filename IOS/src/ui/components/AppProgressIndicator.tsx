import { type CSSProperties, type ReactElement, useEffect, useState } from 'react';
import {
  AppMotion,
  PROGRESS_RING_SIZE_DP,
  PROGRESS_RING_STROKE_DP,
  PROGRESS_TRACK_ALPHA,
  appProgressRing,
  easeOutCubic,
  systemReduceMotion,
} from '@core/glass/motion';

/**
 * `ui/components/AppProgressIndicator.kt`（65 行 → 本组件 + `core/glass/motion` 的几何）
 *
 * 逐行对照：
 *   L28-31 `rememberProgressPhase(active, durationMillis)` —— 只在不确定进度时跑一条
 *          `infiniteRepeatable(tween(max(duration,600), LinearEasing))` 的时钟
 *          → `useEffect` + `requestAnimationFrame` 的 `phase`
 *   L33-41 `DrawScope.drawAppProgressRing(...)` → `appProgressRing()`（`@core/glass/motion`）
 *          轨道整圆 + `start = -90 + (unknown ? phase*360 : 0)`、
 *          `sweep = unknown ? 90 + 60*sin(phase*π) : 360*progress`
 *   L44-64 `AppProgressIndicator(...)` 的签名与语义：
 *          `size 40.dp`（L59）、`strokeWidth 2.dp`（L47）、`trackColor = color@0.13`（L48）、
 *          `progress: (() -> Float)?`（null = 不确定）、`durationMillis = PROGRESS_CYCLE_MS`（L50）
 *          `reduce = LocalReduceMotion || quality.minimal` → 不跑时钟、相位固定 0
 *          已知进度用 `tween(PROGRESS_MS, easeOutCubic)` 补间（L54-55）→ CSS 过渡
 *          `semantics { progressBarRangeInfo = ProgressBarRangeInfo(it, 0f..1f) | Indeterminate }`
 *          （L60）→ `role="progressbar"` + `aria-valuenow`（不确定时不带 valuenow）
 *
 * 适配：
 * - Compose 的 `DrawScope` 弧线 → SVG `<circle>` + `pathLength="100"`：把周长归一化成 100 之后
 *   `stroke-dasharray = sweep/360*100`，`rotate(start)` 用 SVG `transform`，两者角度约定一致
 *   （0° = 3 点钟、顺时针为正），因此 `appProgressRing()` 的输出可以原样喂进来。
 * - `animateFloatAsState` 的 220ms `easeOutCubic` 用 `transition: stroke-dasharray` 表达。
 * - `LocalRenderQuality.minimal` 在 iOS 没有对应档位（见 `core/glass/renderQuality.ts`：
 *   `reduce` 已覆盖"关动效"这一支），故只保留 `reduceMotion` 一个开关。
 */
export interface AppProgressIndicatorProps {
  /** 直径（px）。Kotlin L59 固定 `40.dp`。 */
  size?: number;
  /** 弧线颜色。Kotlin L46 默认 `MaterialTheme.colorScheme.primary`。 */
  color?: string;
  /** 线宽（px）。Kotlin L47 `2.dp`。 */
  strokeWidth?: number;
  /** 轨道颜色。Kotlin L48 默认 `color.copy(alpha = .13f)`。 */
  trackColor?: string;
  /** 已知进度 0…1；`null`/`undefined` = 不确定进度。Kotlin L49 `progress: (() -> Float)?`。 */
  progress?: number | null;
  /** 不确定进度转一圈的毫秒数。Kotlin L50 `AppMotion.PROGRESS_CYCLE_MS`。 */
  durationMillis?: number;
  /** Kotlin `LocalReduceMotion.current`（另有 `quality.minimal`）。 */
  reduceMotion?: boolean;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'data-testid'?: string;
}

/** Kotlin L53 `progress?.invoke()?.takeIf { it.isFinite() }?.coerceIn(0f, 1f)`。 */
function resolveTarget(progress: number | null | undefined): number | null {
  if (progress === null || progress === undefined) return null;
  if (!Number.isFinite(progress)) return null;
  return progress < 0 ? 0 : progress > 1 ? 1 : progress;
}

export function AppProgressIndicator(props: AppProgressIndicatorProps): ReactElement {
  const size = props.size ?? PROGRESS_RING_SIZE_DP;
  const strokeWidth = props.strokeWidth ?? PROGRESS_RING_STROKE_DP;
  const color = props.color ?? '#059669';
  const target = resolveTarget(props.progress);
  const indeterminate = target === null;
  const reduce = props.reduceMotion ?? systemReduceMotion();
  const durationMillis = Math.max(600, props.durationMillis ?? AppMotion.PROGRESS_CYCLE_MS);

  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!indeterminate || reduce) {
      setPhase(0);
      return;
    }
    if (typeof requestAnimationFrame !== 'function') return;
    const started = Date.now();
    let frame = requestAnimationFrame(function tick(): void {
      setPhase(((Date.now() - started) % durationMillis) / durationMillis);
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [indeterminate, reduce, durationMillis]);

  const frame = appProgressRing(indeterminate ? null : target, phase);
  const radius = Math.max(0, (size - strokeWidth) / 2);
  const center = size / 2;
  // pathLength=100 → 弧长 = 扫角占比 × 100（Kotlin `sweep` 以度计）。
  const dash = (frame.sweepDeg / 360) * 100;

  return (
    <svg
      className={props.className}
      style={props.style}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="progressbar"
      aria-label={props['aria-label']}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 1}
      aria-valuenow={indeterminate ? undefined : target}
      data-testid={props['data-testid']}
      aria-busy={indeterminate}
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={props.trackColor ?? color}
        strokeOpacity={props.trackColor === undefined ? PROGRESS_TRACK_ALPHA : 1}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${dash} 100`}
        transform={`rotate(${frame.startDeg} ${center} ${center})`}
        style={{
          transition: reduce
            ? 'none'
            : `stroke-dasharray ${AppMotion.PROGRESS_MS}ms ${easeOutCubic}`,
        }}
      />
    </svg>
  );
}
