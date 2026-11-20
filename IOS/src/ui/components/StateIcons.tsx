/**
 * `ui/components/StateIcons.kt`（93 行）→ 三个状态图标组件。
 *
 * 行映射
 * ──────
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `AnimatedStateIcon` | L32-49 | `AnimatedStateIcon` |
 * | `AnimatedChevron` | L53-65 | `AnimatedChevron` |
 * | `AnimatedSelectionMark` | L69-93 | `AnimatedSelectionMark` |
 *
 * 所有可判定数值都来自 `@core/ui/stateIcons`（那里逐条标注了 Kotlin 行号），
 * 本文件只负责把它们变成 DOM。样式在 `src/styles/stateIcons.css`。
 *
 * 三个平台差异
 * ────────────
 * 1. `AnimatedContent(imageVector)` 的「保留旧内容直到出场结束」在 React 里没有内建
 *    等价物。这里用一层绝对定位的 `.state-icon__glyph--out` 承载上一枚图标，并在
 *    `onAnimationEnd` 时清掉 —— 出场结束就卸载，不会越积越多。
 * 2. `clearAndSetSemantics { }`（L41）把 `Icon` 自身的语义清空，描述只留在外层 Box
 *    （L40）。Web 侧对应内层 `aria-hidden="true"` + 外层 `role="img"`。
 * 3. `Canvas` 的 `drawCircle`/`drawLine`（L83-90）→ 内联 `<svg>`；`Stroke(1.5.dp)`
 *    与 `size(22.dp)` 直接作为 `strokeWidth` / `width|height`（viewBox 单位 = dp）。
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import {
  CHEVRON_COLLAPSED_ROTATION,
  CHEVRON_EXPANDED_ROTATION,
  SELECTION_MARK_SIZE_DP,
  SELECTION_MARK_STROKE_DP,
  SELECTION_MARK_UNCHECKED_ALPHA,
  chevronRotation,
  selectionMarkForegroundVisible,
  selectionMarkGeometry,
  selectionMarkLabel,
  selectionMarkProgress,
} from '@core/ui/stateIcons';

import '../../../styles/stateIcons.css';

function joinClass(base: string, extra: string | undefined): string {
  return extra ? `${base} ${extra}` : base;
}

interface RenderedIcon {
  readonly key: string;
  readonly icon: ReactNode;
}

export interface AnimatedStateIconProps {
  /**
   * 图标身份。值变化 → 走一次「旧图标淡出 + 新图标淡入」（Kotlin 的
   * `AnimatedContent(imageVector)` 以 `ImageVector` 相等性判定内容变化）。
   */
  readonly iconKey: string;
  readonly icon: ReactNode;
  /** L34 `contentDescription: String?` —— 为 `null` 时不设语义（L40 `?.let`）。 */
  readonly contentDescription?: string | null;
  /** L36 `tint: Color = LocalContentColor.current`。 */
  readonly tint?: string;
  /** L38 `LocalReduceMotion.current` —— 对应 `snap()`。 */
  readonly reduceMotion?: boolean;
  readonly className?: string;
}

/** L32-49。 */
export function AnimatedStateIcon(props: AnimatedStateIconProps): ReactNode {
  const [shown, setShown] = useState<RenderedIcon>({
    key: props.iconKey,
    icon: props.icon,
  });
  const [leaving, setLeaving] = useState<RenderedIcon | null>(null);

  /*
   * React 官方允许在渲染期间按 props 调整 state（"adjusting state when a prop
   * changes"）：本次渲染会立即被丢弃并重来，不会产生额外的提交。用 effect 做会
   * 先画一帧旧图标再切，那一帧正是要避免的闪动。
   */
  if (shown.key !== props.iconKey) {
    setLeaving(shown);
    setShown({ key: props.iconKey, icon: props.icon });
  }

  const leavingNode: ReactNode =
    leaving !== null && leaving.key !== shown.key ? (
      <span
        className="state-icon__glyph--out"
        aria-hidden="true"
        onAnimationEnd={() => setLeaving(null)}
      >
        {leaving.icon}
      </span>
    ) : null;

  return (
    <span
      className={joinClass('state-icon', props.className)}
      role="img"
      aria-label={props.contentDescription ?? undefined}
      style={props.tint === undefined ? undefined : { color: props.tint }}
    >
      {leavingNode}
      <span className="state-icon__glyph" aria-hidden="true">
        {shown.icon}
      </span>
    </span>
  );
}

export interface AnimatedChevronProps {
  readonly expanded: boolean;
  /** L55 `contentDescription: String?`。 */
  readonly contentDescription?: string | null;
  /** L57 `tint: Color = LocalContentColor.current`。 */
  readonly tint?: string;
  /** L58 `collapsedRotation: Float = 0f`。 */
  readonly collapsedRotation?: number;
  /** L59 `expandedRotation: Float = 180f`。 */
  readonly expandedRotation?: number;
  readonly className?: string;
}

/** `Icons.Default.ExpandMore` 的 Material 路径（L64 唯一使用的图标）。 */
const EXPAND_MORE_PATH = 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z';

/** L53-65。 */
export function AnimatedChevron(props: AnimatedChevronProps): ReactNode {
  const rotation = chevronRotation(
    props.expanded,
    props.collapsedRotation ?? CHEVRON_COLLAPSED_ROTATION,
    props.expandedRotation ?? CHEVRON_EXPANDED_ROTATION,
  );
  return (
    <span
      className={joinClass('state-chevron', props.className)}
      role="img"
      aria-label={props.contentDescription ?? undefined}
      style={{
        transform: `rotate(${rotation}deg)`,
        color: props.tint,
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={EXPAND_MORE_PATH} fill="currentColor" />
      </svg>
    </span>
  );
}

export interface AnimatedSelectionMarkProps {
  /** L70 `checked: Boolean`。 */
  readonly checked: boolean;
  /** L86 `colors.primary`。 */
  readonly primary: string;
  /** L87 `colors.onPrimary`。 */
  readonly onPrimary: string;
  /** L72 `uncheckedColor = onBackground.copy(alpha = .35f)` —— 这里传色相。 */
  readonly uncheckedColor?: string;
  /** L72 的 `.35f`；单独暴露便于派生主题覆盖。 */
  readonly uncheckedAlpha?: number;
  /** L80 `size(22.dp)`；仅供布局微调，默认取 Kotlin 值。 */
  readonly sizeDp?: number;
  readonly className?: string;
}

/** L69-93。 */
export function AnimatedSelectionMark(props: AnimatedSelectionMarkProps): ReactNode {
  const size = props.sizeDp ?? SELECTION_MARK_SIZE_DP;
  const strokePx = SELECTION_MARK_STROKE_DP;
  const progress = selectionMarkProgress(props.checked);
  const geometry = selectionMarkGeometry(
    progress,
    size,
    strokePx,
    props.uncheckedAlpha ?? SELECTION_MARK_UNCHECKED_ALPHA,
  );
  const center = size / 2;
  const points = geometry.check.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <svg
      className={joinClass('state-selection-mark', props.className)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={selectionMarkLabel(props.checked)}
    >
      {/* L83-84 未选中圈：半径 (min - stroke)/2，alpha = .35 * (1 - p) */}
      <circle
        className="state-selection-mark__outer"
        cx={center}
        cy={center}
        r={geometry.outerRadius}
        fill="none"
        stroke={props.uncheckedColor ?? props.onPrimary}
        strokeOpacity={geometry.outerAlpha}
        strokeWidth={strokePx}
      />
      {/* L85 `if (p > 0f)` —— 进度为 0 时整段前景都不画 */}
      {selectionMarkForegroundVisible(progress) ? (
        <>
          {/* L86 内圆：半径 min/2 * (.8 + .2p)，alpha = p */}
          <circle
            className="state-selection-mark__inner"
            cx={center}
            cy={center}
            r={geometry.innerRadius}
            fill={props.primary}
            fillOpacity={geometry.innerAlpha}
          />
          {/* L88-90 勾：(6,11) → (9,14) → (9+7p, 14-7p)，宽 1.8 * unit，圆角端点 */}
          <polyline
            className="state-selection-mark__check"
            points={points}
            fill="none"
            stroke={props.onPrimary}
            strokeOpacity={geometry.inkAlpha}
            strokeWidth={geometry.checkStroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
    </svg>
  );
}
