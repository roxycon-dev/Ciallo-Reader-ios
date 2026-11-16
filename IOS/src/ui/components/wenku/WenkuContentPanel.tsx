/**
 * WenkuContentPanel.tsx — `ui/wenku/WenkuGlass.kt` L679-712 的 React 版。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L681-686  `WenkuContentPanel(modifier, onClick, contentPadding = PaddingValues(16.dp),
 *             content: @Composable ColumnScope.() -> Unit)`
 *                                                              → `WenkuContentPanelProps`
 *   L687-690  `wenkuColors()` / `rememberWenkuAccessibility()` / `MutableInteractionSource` /
 *             `collectIsPressedAsState()`                        → `wenkuColors(isDark)` + `:active` + `data-pressed`
 *   L691-695  `scale = animateFloatAsState(
 *                targetValue = if (pressed && onClick != null && !a11y.reduceMotion) 0.975f else 1f,
 *                animationSpec = if (pressed) WenkuMotion.contactSpec() else WenkuMotion.settleSpec())`
 *                                                              → `.wenku-content-panel--interactive:active`
 *                                                                `transition: transform 120ms cubic-bezier(.215,.61,.355,1)`（contact）
 *                                                                与释放 `420ms cubic-bezier(.2,1.08,.34,1)`（settle）
 *   L696-711  `Column(modifier.graphicsLayer{scale}.clip(WenkuTokens.shapes.Panel)
 *                .background(if (highContrast) panel else panel@.82)
 *                .border(.7.dp, outline@.42, Panel)
 *                .then(if (onClick != null) pullOutClickable(…) else Modifier)
 *                .padding(contentPadding))`
 *                                                              → `.wenku-content-panel` + 内联 `background` / `border-color` / `padding`
 *
 * 常量来源
 * ───────
 *   `WenkuTokens.PanelRadius` = 4.dp（`WenkuTokens.kt` L49）→ `WENKU_PANEL_RADIUS_PX`
 *   `panel` 亮 `0xFFFDFCFA` / 暗 `0xFF242424`（L33 / L40）→ `WENKU_TOKENS.panelLight` / `panelDark`
 *   `outline` 亮 `0xFFD9D5CA` / 暗 `0xFF3C3C3C`（`wenkuColors()` L260 / `OutlineDark` L43）
 *   `.82f` 底色 alpha（L700）、`.42f` 描边 alpha（L701）、`0.7.dp` 描边宽（L701）
 *   `contactSpec()` = 120ms + `WenkuMotion.ease`；`settleSpec()` = 420ms + `WenkuMotion.settle`
 *   （`WenkuTokens.kt` L179-197）→ `WENKU_MOTION.contactMs` / `enterMs` + 两条 `WENKU_CURVE_POINTS`
 *
 * 与 Kotlin 的差异
 * ───────────────
 *  * `Modifier` → `className` / `style`。
 *  * `a11y.highContrast` 在 Web 端没有系统级读取（`WenkuTokens.kt` L283-313 未移植），
 *    这里提升成显式 prop `highContrast`；不传时按 `.82f` 半透明面板（Kotlin 默认分支）。
 *  * 按压缩放走 CSS `:active`（与 `WenkuGlass.tsx` L95 同一做法），不额外跑 rAF：
 *    这样 11 个生产调用点各挂一个面板时也不会各自开一条时钟。
 *  * `pullOutClickable` 的"按下即响应、移出取消"语义用原生 `onClick` 等价表达。
 */

import type { CSSProperties, ReactNode } from 'react';

import { WENKU_MOTION, WENKU_RADII_DP, WENKU_TOKENS } from '@core/wenku/tokens';
import { useWenkuReducedMotion } from './WenkuGlass';
import { tintCss, useDocumentDark } from './WenkuLoadingHandoff';
import '../../../styles/wenku.css';

/** `WenkuTokens.PanelRadius`（`WenkuTokens.kt` L49）。 */
export const WENKU_PANEL_RADIUS_PX = WENKU_RADII_DP.panel;
/** `WenkuGlass.kt` L701 `border(0.7.dp, …)`。 */
export const WENKU_PANEL_BORDER_PX = 0.7;
/** `WenkuGlass.kt` L700 `colors.panel.copy(alpha = 0.82f)`。 */
export const WENKU_PANEL_BACKGROUND_ALPHA = 0.82;
/** `WenkuGlass.kt` L701 `colors.outline.copy(alpha = 0.42f)`。 */
export const WENKU_PANEL_BORDER_ALPHA = 0.42;
/** `WenkuGlass.kt` L684 `contentPadding: PaddingValues = PaddingValues(16.dp)`。 */
export const WENKU_PANEL_DEFAULT_PADDING_PX = 16;
/** `WenkuGlass.kt` L692 按压缩放。 */
export const WENKU_PANEL_PRESS_SCALE = 0.975;
/** `WenkuMotion.contactSpec()` 时长（`WenkuTokens.kt` L122）。 */
export const WENKU_PANEL_PRESS_MS = WENKU_MOTION.contactMs;
/** `WenkuMotion.settleSpec()` 时长（`WenkuTokens.kt` L123 `ENTER_MS`）。 */
export const WENKU_PANEL_SETTLE_MS = WENKU_MOTION.enterMs;

/** `WenkuMotion.ease` 的 CSS 写法：`CubicBezierEasing(0.215, 0.61, 0.355, 1)`。 */
export const WENKU_PANEL_PRESS_EASING = 'cubic-bezier(0.215, 0.61, 0.355, 1)';
/** `WenkuMotion.settle` 的 CSS 写法：`CubicBezierEasing(0.2, 1.08, 0.34, 1)`。 */
export const WENKU_PANEL_SETTLE_EASING = 'cubic-bezier(0.2, 1.08, 0.34, 1)';

export interface WenkuContentPanelProps {
  /** Kotlin `content: @Composable ColumnScope.() -> Unit`。 */
  readonly children?: ReactNode;
  /** Kotlin `onClick: (() -> Unit)? = null` —— 非空时整块可点并带 0.975 按压缩放。 */
  readonly onClick?: () => void;
  /** Kotlin `contentPadding: PaddingValues = PaddingValues(16.dp)`；数字按 px。 */
  readonly contentPadding?: number | string;
  /** Kotlin `a11y.highContrast`（Web 端没有系统级来源，改成显式开关）。 */
  readonly highContrast?: boolean;
  /** Kotlin `modifier` 的 className 部分。 */
  readonly className?: string;
  /** Kotlin `modifier` 的布局部分。 */
  readonly style?: CSSProperties;
  readonly testId?: string;
}

/**
 * 纸面内容面板：4px 圆角 / `panel@.82` 底 / 0.7px `outline@.42` 描边 / 16px 内边距，
 * 可点时按下缩放 0.975（contact 120ms → settle 420ms）。
 *
 * Kotlin: `ui/wenku/WenkuGlass.kt` L679-712（11 处生产引用）。
 */
export function WenkuContentPanel(props: WenkuContentPanelProps) {
  const reduceMotion = useWenkuReducedMotion();
  const dark = useDocumentDark();

  // 说明：iOS 的 `wenkuColors(isDark)`（`tokens.ts` L469-485）只带 milk/outline/ink/inkSecondary
  // 四个字段，`panel` 不在里面，所以这里直接取 `WENKU_TOKENS`（`WenkuTokens.kt` L33 / L40）。
  const panel = dark ? WENKU_TOKENS.panelDark : WENKU_TOKENS.panelLight;
  const outline = dark ? WENKU_TOKENS.outlineDark : WENKU_TOKENS.outlineLight;
  /** Kotlin L700：高对比走不透明 `panel`，否则 `panel@.82`。 */
  const background =
    props.highContrast === true ? tintCss(panel, 1) : tintCss(panel, WENKU_PANEL_BACKGROUND_ALPHA);

  const interactive = typeof props.onClick === 'function';
  const pressable = interactive && !reduceMotion;

  const classNames = ['wenku-content-panel'];
  if (pressable) classNames.push('wenku-content-panel--interactive');
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  const padding =
    props.contentPadding === undefined
      ? `${String(WENKU_PANEL_DEFAULT_PADDING_PX)}px`
      : typeof props.contentPadding === 'number'
        ? `${String(props.contentPadding)}px`
        : props.contentPadding;

  const style = {
    // `--wenku-*` 自定义属性是 CSS 侧的钩子；直接内联 background/border 是为了
    // 在没有 `.wenku-root` 祖先的调用点（如详情页弹层）也拿得到正确纸色。
    '--wenku-panel-press': `${String(WENKU_PANEL_PRESS_SCALE)}`,
    '--wenku-panel-press-ms': `${String(WENKU_PANEL_PRESS_MS)}ms`,
    '--wenku-panel-settle-ms': `${String(WENKU_PANEL_SETTLE_MS)}ms`,
    '--wenku-panel-press-ease': WENKU_PANEL_PRESS_EASING,
    '--wenku-panel-settle-ease': WENKU_PANEL_SETTLE_EASING,
    background,
    border: `${String(WENKU_PANEL_BORDER_PX)}px solid ${tintCss(outline, WENKU_PANEL_BORDER_ALPHA)}`,
    padding,
    ...props.style,
  } as CSSProperties;

  if (!interactive) {
    return (
      <div
        className={classNames.join(' ')}
        style={style}
        data-wenku-content-panel=""
        data-testid={props.testId}
      >
        {props.children}
      </div>
    );
  }

  return (
    <div
      className={classNames.join(' ')}
      style={style}
      data-wenku-content-panel=""
      data-testid={props.testId}
      role="button"
      tabIndex={0}
      onClick={() => {
        props.onClick?.();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        props.onClick?.();
      }}
    >
      {props.children}
    </div>
  );
}

/** 供需要"跟随系统减少动效"的调用点复用：`WenkuGlass.kt` 的 `a11y.reduceMotion` 同一个判定。 */
export { useWenkuReducedMotion as useWenkuPanelReduceMotion };

export default WenkuContentPanel;
