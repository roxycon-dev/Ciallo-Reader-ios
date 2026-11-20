/**
 * `ui/components/StateIcons.kt`（93 行 / 89 非空）→ `@core/ui/stateIcons`。
 *
 * 行映射
 * ──────
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `AnimatedStateIcon` 的三段动效 | L38-45 | `stateIconTransition()` / `STATE_ICON_*` |
 * | `AnimatedChevron` 的旋转 | L61-64 | `chevronRotation()` / `CHEVRON_*` |
 * | `AnimatedSelectionMark` 的几何 | L74-92 | `selectionMarkGeometry()` / `SELECTION_MARK_*` |
 *
 * 为什么值得单独一个模块：这三个图标在 Kotlin 里是**全站统一的状态反馈**（加载→成功、
 * 折叠箭头、多选勾），它们的时长/缩放/描边全部读 `AppMotion` 与 `DesignTokens`，没有
 * 一处是随手写的字面量。端口此前只有 `src/core/ui/parityMisc.ts` L401-412 三个
 * `interface`，字段是 `state: 'idle'|'active'|'done'` 这种自造的形状 —— 与 Kotlin 的
 * `(imageVector, contentDescription, modifier, tint)` 毫无关系，等于没移植。
 *
 * 关键取值（全部来自 Kotlin，不是近似）
 * ─────────────────────────────────────
 * - `AppMotion.icon()` 是 **tween**，不是弹簧：`Motion.kt` L30
 *   `fun <T> icon() = tween<T>(ICON_MS, easing = easeOutCubic)`，`ICON_MS = 240`（L24）。
 *   图标切换的 240 ms 与「颜色渐变」共用同一条曲线，所以三处动画的时长必须一致，
 *   写成 `240/200/150` 之类会让图标和它自己的颜色脱节。
 * - 进出场的**缩放**时长也是 `AppMotion.icon()`（L43-44 的两个 `scaleIn/scaleOut`），
 *   只有淡出用的是 `tween(AppMotion.PRESS_MS)` = 110 ms（L44）—— 出场比入场快一倍多，
 *   这是「状态图标消失要干脆」的手感来源。
 * - `initialScale = .82f` / `targetScale = .92f`（L43-44）：入场从 82% 放大到 100%，
 *   出场缩到 92% 再淡出（不是缩到 0）。
 * - `AnimatedChevron` 默认 `0f ↔ 180f`（L58-59），走 `graphicsLayer { rotationZ }`
 *   —— 只转自身，不参与布局。
 * - `AnimatedSelectionMark`：22 dp 画布（L80）、`1.5.dp` 描边（L79）、未选中圈
 *   `onBackground.copy(alpha = .35f)`（L72）、内圆 `min/2 * (.8 + .2p)`（L86）、
 *   勾的折线 `(6,11) → (9,14) → (9+7p, 14-7p)`（L89-90）、线宽 `1.8 * unit`（L89-90）、
 *   `unit = min/22`（L82）。
 *
 * 平台差异（不影响可判定部分）
 * ───────────────────────────
 * - Canvas 的 `drawCircle`/`drawLine` 在 Web 侧由 `StateIcons.tsx` 的内联 SVG 承担；
 *   本模块只给出**几何数值**，不碰 DOM。
 * - `clearAndSetSemantics { }`（L41）把 icon 自身的语义清空，描述只留在外层 Box（L40）
 *   ——Web 侧对应 `aria-hidden` 的内层 SVG + 外层 `role="img" aria-label`。
 * - `snap()`（reduce motion 档）→ 时长为 0（`stateIconTransition(true)`）。
 */

import { easeOutCubic } from '@core/glass/motion';

/* ── AnimatedStateIcon L32-49 ───────────────────────────────────────────── */

/** `AppMotion.ICON_MS`（`Motion.kt` L24）—— `AppMotion.icon()` 的补间时长。 */
export const STATE_ICON_DURATION_MS = 240;

/** `AppMotion.PRESS_MS`（`Motion.kt` L31）—— 出场淡出用这一档，比入场快。 */
export const STATE_ICON_EXIT_FADE_MS = 110;

/** L43 `scaleIn(AppMotion.icon(), initialScale = .82f)`。 */
export const STATE_ICON_ENTER_SCALE_FROM = 0.82;

/** L44 `scaleOut(AppMotion.icon(), targetScale = .92f)` —— 缩到 92% 再淡，不是缩到 0。 */
export const STATE_ICON_EXIT_SCALE_TO = 0.92;

/** L39 `easeOutCubic` —— `AppMotion.icon()` 的曲线，颜色与缩放共用。 */
export const STATE_ICON_EASING = easeOutCubic;

export interface StateIconTransition {
  /** 颜色补间时长（L39 `animateColorAsState(tint, …)`）。 */
  readonly colorMs: number;
  /** 入场淡入时长（L43 `fadeIn(tween(AppMotion.ICON_MS))`）。 */
  readonly enterFadeMs: number;
  /** 入场缩放起点（L43 `initialScale = .82f`）。 */
  readonly enterScaleFrom: number;
  /** 入场缩放时长 = `AppMotion.icon()`。 */
  readonly enterScaleMs: number;
  /** 出场淡出时长（L44 `fadeOut(tween(AppMotion.PRESS_MS))`）。 */
  readonly exitFadeMs: number;
  /** 出场缩放终点（L44 `targetScale = .92f`）。 */
  readonly exitScaleTo: number;
  /** 出场缩放时长 = `AppMotion.icon()`。 */
  readonly exitScaleMs: number;
  /** 缓动曲线（CSS 形式）。 */
  readonly easing: string;
}

/**
 * L41-45 `transitionSpec`：reduce motion 时 `EnterTransition.None togetherWith
 * ExitTransition.None` —— 一切时长归零，缩放恒等。
 */
export function stateIconTransition(reduceMotion: boolean): StateIconTransition {
  if (reduceMotion) {
    return {
      colorMs: 0,
      enterFadeMs: 0,
      enterScaleFrom: 1,
      enterScaleMs: 0,
      exitFadeMs: 0,
      exitScaleTo: 1,
      exitScaleMs: 0,
      easing: STATE_ICON_EASING,
    };
  }
  return {
    colorMs: STATE_ICON_DURATION_MS,
    enterFadeMs: STATE_ICON_DURATION_MS,
    enterScaleFrom: STATE_ICON_ENTER_SCALE_FROM,
    enterScaleMs: STATE_ICON_DURATION_MS,
    exitFadeMs: STATE_ICON_EXIT_FADE_MS,
    exitScaleTo: STATE_ICON_EXIT_SCALE_TO,
    exitScaleMs: STATE_ICON_DURATION_MS,
    easing: STATE_ICON_EASING,
  };
}

/* ── AnimatedChevron L53-65 ─────────────────────────────────────────────── */

/** L58 `collapsedRotation: Float = 0f`。 */
export const CHEVRON_COLLAPSED_ROTATION = 0;

/** L59 `expandedRotation: Float = 180f`。 */
export const CHEVRON_EXPANDED_ROTATION = 180;

/**
 * L62 `animateFloatAsState(if (expanded) expandedRotation else collapsedRotation, …)`
 * —— 目标角度；补间本身由调用方的 CSS transition 承担（时长 `stateIconTransition()`）。
 */
export function chevronRotation(
  expanded: boolean,
  collapsedRotation: number = CHEVRON_COLLAPSED_ROTATION,
  expandedRotation: number = CHEVRON_EXPANDED_ROTATION,
): number {
  return expanded ? expandedRotation : collapsedRotation;
}

/* ── AnimatedSelectionMark L69-93 ───────────────────────────────────────── */

/** L80 `Canvas(modifier.size(22.dp) …)`。 */
export const SELECTION_MARK_SIZE_DP = 22;

/** L79 `Stroke(with(density) { 1.5.dp.toPx() })`。 */
export const SELECTION_MARK_STROKE_DP = 1.5;

/** L72 `onBackground.copy(alpha = .35f)`。 */
export const SELECTION_MARK_UNCHECKED_ALPHA = 0.35;

/** L89-90 `1.8f * unit` —— 勾的线宽按 `unit` 缩放，不是固定 dp。 */
export const SELECTION_MARK_CHECK_STROKE_UNITS = 1.8;

/** L75 `animateFloatAsState(if (checked) 1f else 0f, …)` —— 目标进度。 */
export function selectionMarkProgress(checked: boolean): 0 | 1 {
  return checked ? 1 : 0;
}

/**
 * L80 `semantics { contentDescription = if (checked) "已选中" else "未选中" }`
 * —— Kotlin 这里是**裸字面量**，没有包 `tr()`，所以逐字保留中文。
 */
export function selectionMarkLabel(checked: boolean): '已选中' | '未选中' {
  return checked ? '已选中' : '未选中';
}

export interface SelectionMarkGeometry {
  /** L82 `unit = size.minDimension / 22f`。 */
  readonly unit: number;
  /** L84 `(min - outline.width) / 2f`。 */
  readonly outerRadius: number;
  /** L83 `uncheckedColor.alpha * (1f - p)`。 */
  readonly outerAlpha: number;
  /** L86 `min / 2f * (.8f + .2f * p)`。 */
  readonly innerRadius: number;
  /** L86 `primary.copy(alpha = p)`。 */
  readonly innerAlpha: number;
  /** L87 `onPrimary.copy(alpha = p)`。 */
  readonly inkAlpha: number;
  /** L89-90 线宽：`1.8f * unit`。 */
  readonly checkStroke: number;
  /** L89-90 折线三点：`(6,11) → (9,14) → (9+7p, 14-7p)`，已乘 `unit`。 */
  readonly check: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
}

/**
 * L80-91 的整套绘制几何。`p` 是补间中的当前进度（0..1），不是布尔值 ——
 * 勾的**末端**随进度生长（`9 + 7p`, `14 - 7p`），中点 `(9, 14)` 不动。
 *
 * @param progress 0..1（调用方传补间值；静态渲染传 0 或 1）
 * @param minDimension 画布短边（dp 或 px，与 `strokePx` 同单位）
 * @param strokePx L79 的 `1.5.dp.toPx()`
 * @param uncheckedAlpha L72 的 `.35f`
 */
export function selectionMarkGeometry(
  progress: number,
  minDimension: number,
  strokePx: number,
  uncheckedAlpha: number = SELECTION_MARK_UNCHECKED_ALPHA,
): SelectionMarkGeometry {
  const p = Math.max(0, Math.min(1, progress));
  const unit = minDimension / SELECTION_MARK_SIZE_DP;
  return {
    unit,
    outerRadius: (minDimension - strokePx) / 2,
    outerAlpha: uncheckedAlpha * (1 - p),
    innerRadius: (minDimension / 2) * (0.8 + 0.2 * p),
    innerAlpha: p,
    inkAlpha: p,
    checkStroke: SELECTION_MARK_CHECK_STROKE_UNITS * unit,
    check: [
      [6 * unit, 11 * unit],
      [9 * unit, 14 * unit],
      [(9 + 7 * p) * unit, (14 - 7 * p) * unit],
    ],
  };
}

/**
 * L85 `if (p > 0f)` —— 进度为 0 时**整段前景都不画**（连内圆都没有）。
 * 独立导出是因为 Web 侧要在 SVG 里据此跳过 `<circle>`/`<path>`。
 */
export function selectionMarkForegroundVisible(progress: number): boolean {
  return progress > 0;
}
