/**
 * `ui/components/OverlayAnimations.kt`（86 行 / 79 非空）→ 四个入场组件。
 *
 * 行映射
 * ──────
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `DialogEntrance` | L14-18 | `DialogEntrance`（`kind = 'dialog'`） |
 * | `BottomSheetEntrance` | L20-24 | `BottomSheetEntrance`（`kind = 'sheet'`） |
 * | `OverlayEntrance`（私有） | L26-59 | 两个组件的公共实现 + `overlayEntranceFrame()` |
 * | `ScrimEntrance` | L61-78 | `ScrimEntrance` |
 * | `PullOutScrim` | L80-86 | `PullOutScrim` |
 *
 * 所有可判定数值都在 `@core/ui/overlayEntrance`（那里逐条标注了 Kotlin 行号），
 * 本文件只把数值变成 DOM；帧表落在 `src/styles/components.css`。
 *
 * 这个文件此前是**旧版 73 行**的移植：`fadeIn(tween(180))` + `scaleIn(0.92)` +
 * `slideInVertically({ it / 6 })` + 遮罩 `tween(220) linear`，注释还写着「Android
 * hard-codes the durations inside tween(...), ignoring the parameter」——而当前原文
 * L40 明确用 `durationMillis`（默认 420）做入场、`EXIT_MS`（320）做出场。
 *
 * 四条平台差异
 * ────────────
 * 1. `graphicsLayer { alpha / translationX / translationY }` → CSS `opacity` + `transform`；
 *    曲线 × 线性进度的映射用「采样帧 + `linear` 时间函数」逐帧复现（13 个采样点），
 *    而不是塞一条 `cubic-bezier` —— 因为位移是**两条不同曲线**（`plane` 与 `settle`）
 *    分别作用在 X / Y 上，单条 bezier 表达不了。
 * 2. `AnimatedVisibility(enter = None, exit = None)` 的「首帧即目标态」→ CSS
 *    `animation` 无 `fill-mode` 时挂载即播一次，等价。
 * 3. `WenkuContentClock(progress, content)`（内容按 `LIST_*` 错峰浮现）→
 *    `.overlay-entrance__content` 的 `animation-delay` 阶梯，见 `overlayContentDelayMs()`。
 * 4. `LocalPaperVisibility` / `LocalReadOnlyComposition` 之类 CompositionLocal →
 *    props（`open` / `reduceMotion`）。
 */

import { type ReactNode } from 'react';

import {
  OVERLAY_ENTER_MS,
  OVERLAY_EXIT_MS,
  OVERLAY_SCRIM_STANDALONE_INITIAL,
  OVERLAY_SETTLE_CSS,
  overlayContentDelayMs,
  overlayEntranceFrame,
  overlayEntranceSpec,
  overlayScrimSpec,
  pullOutScrimSpec,
  type OverlayEntranceKind,
} from '../../core/ui/overlayEntrance';

export interface EntranceProps {
  children: ReactNode;
  className?: string;
  /**
   * L15 / L21 `durationMillis: Int = WenkuMotion.ENTER_MS` —— **真的在用**（入场时长）。
   * 出场恒为 `WenkuMotion.EXIT_MS`（L40-42），不受此参数影响。
   */
  durationMillis?: number;
  /** `LocalReduceMotion` 等价物：为 true 时一切时长归零（L39/L56 的 `snap()`）。 */
  reduceMotion?: boolean;
  /** 退场中：把动画反向播一遍（L40 的 `EXIT_MS` 分支）。 */
  exiting?: boolean;
  style?: React.CSSProperties;
}

/** 一处共用的内联 token：曲线与时长写进自定义属性，CSS 只消费。 */
function entranceStyle(kind: OverlayEntranceKind, props: EntranceProps): React.CSSProperties {
  const spec = overlayEntranceSpec(kind);
  const enterMs = props.reduceMotion === true ? 0 : (props.durationMillis ?? spec.enterMs);
  return {
    animationName: kind === 'sheet' ? 'overlay-sheet-in' : 'overlay-dialog-in',
    animationDuration: `${String(enterMs)}ms`,
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
    animationDirection: props.exiting === true ? 'reverse' : 'normal',
    '--overlay-enter-ms': `${String(enterMs)}ms`,
    '--overlay-exit-ms': `${String(props.reduceMotion === true ? 0 : OVERLAY_EXIT_MS)}ms`,
    '--overlay-settle': OVERLAY_SETTLE_CSS,
    ...(props.style ?? {}),
  } as React.CSSProperties;
}

/** 内容错峰：第 `index` 个子块的 `animation-delay`（`WenkuContentClock`）。 */
function contentDelayStyle(index: number, reduceMotion: boolean): React.CSSProperties {
  return {
    animationDelay: `${String(reduceMotion ? 0 : overlayContentDelayMs(index, OVERLAY_ENTER_MS))}ms`,
  };
}

/**
 * L26-59 `OverlayEntrance(…, fromBottom)` 的公共实现。
 * 居中对话框（`kind = 'dialog'`）：淡入 + 8dp 左侧归位 + 20dp 纵向（`settle` 曲线，带回弹）。
 */
export function DialogEntrance(props: EntranceProps) {
  return (
    <div
      className={['overlay-entrance', 'overlay-entrance--dialog', props.className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={entranceStyle('dialog', props)}
      data-duration-millis={props.durationMillis ?? overlayEntranceSpec('dialog').enterMs}
      data-overlay-frame="dialog"
    >
      <div
        className="overlay-entrance__content"
        style={contentDelayStyle(0, props.reduceMotion === true)}
      >
        {props.children}
      </div>
    </div>
  );
}

/**
 * L20-24 / L50-54 `fromBottom = true`：**不淡入**（alpha 恒 1），
 * 横向 −18dp、纵向 `(容器高度 + 24dp) × planeRemaining`。
 */
export function BottomSheetEntrance(props: EntranceProps) {
  return (
    <div
      className={['overlay-entrance', 'overlay-entrance--sheet', props.className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={entranceStyle('sheet', props)}
      data-duration-millis={props.durationMillis ?? overlayEntranceSpec('sheet').enterMs}
      data-overlay-frame="sheet"
    >
      <div
        className="overlay-entrance__content"
        style={contentDelayStyle(0, props.reduceMotion === true)}
      >
        {props.children}
      </div>
    </div>
  );
}

/**
 * L61-78 `ScrimEntrance`：
 * - `open` 由共享的 `MutableTransitionState.targetState` 决定；**没有共享状态时**
 *   首帧为 false、`LaunchedEffect` 之后才置 true（`OVERLAY_SCRIM_STANDALONE_INITIAL`），
 *   否则遮罩会直接以 alpha=1 出现，没有淡入。
 * - 缓动是 `WenkuMotion.plane`，不是 `ease`；入场 420ms、出场 320ms。
 */
export interface ScrimEntranceProps {
  children?: ReactNode;
  className?: string;
  /** `visibility?.targetState`；`undefined` = 走 standalone 分支。 */
  open?: boolean;
  durationMillis?: number;
  reduceMotion?: boolean;
  style?: React.CSSProperties;
}

export function ScrimEntrance(props: ScrimEntranceProps) {
  const standalone = props.open === undefined;
  const open = standalone ? !OVERLAY_SCRIM_STANDALONE_INITIAL : props.open === true;
  const scrim = overlayScrimSpec(open, props.durationMillis ?? OVERLAY_ENTER_MS);
  const duration = props.reduceMotion === true ? 0 : scrim.durationMs;
  return (
    <div
      className={['overlay-entrance', 'overlay-entrance--scrim', props.className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={{
        animationName: 'overlay-scrim-in',
        animationDuration: `${String(duration)}ms`,
        animationTimingFunction: scrim.easingCss,
        animationFillMode: 'both',
        animationDirection: scrim.target === 1 ? 'normal' : 'reverse',
        opacity: scrim.target,
        '--overlay-scrim-ms': `${String(duration)}ms`,
        ...(props.style ?? {}),
      } as React.CSSProperties}
      data-scrim-standalone={standalone ? 'true' : 'false'}
      data-scrim-target={String(scrim.target)}
    >
      {props.children}
    </div>
  );
}

/**
 * L80-86 `PullOutScrim`。
 *
 * ⚠️ 形参 `enter` / `exit` 在 Kotlin 里**声明了但没被使用**（函数体直接
 * `fadeIn(PullOutConfig.spring(true))` / `fadeOut(PullOutConfig.spring(false))`）。
 * 端口保留同签名、同样忽略，并在 `pullOutScrimSpec()` 里写明来源弹簧
 * （`OPEN_K = 140 / OPEN_D = 24`、`CLOSE_K = 260 / CLOSE_D = 34`，阻尼比 ≈ 1.014/1.054）。
 */
export interface PullOutScrimProps {
  visible: boolean;
  children?: ReactNode;
  className?: string;
  /** Kotlin 声明但未使用 —— 传了也不生效（见上）。 */
  enter?: string;
  /** Kotlin 声明但未使用 —— 传了也不生效（见上）。 */
  exit?: string;
  reduceMotion?: boolean;
  style?: React.CSSProperties;
}

export function PullOutScrim(props: PullOutScrimProps) {
  const spec = pullOutScrimSpec(props.visible);
  const duration = props.reduceMotion === true ? 0 : OVERLAY_ENTER_MS;
  return (
    <div
      className={['overlay-entrance', 'overlay-entrance--pull-out', props.className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={{
        animationName: 'overlay-pull-out-in',
        animationDuration: `${String(duration)}ms`,
        animationTimingFunction: spec.easingCss,
        animationFillMode: 'both',
        animationDirection: spec.opening ? 'normal' : 'reverse',
        '--overlay-pull-out-ms': `${String(duration)}ms`,
        ...(props.style ?? {}),
      } as React.CSSProperties}
      data-pull-out-visible={spec.opening ? 'true' : 'false'}
    >
      {props.children}
    </div>
  );
}

/**
 * 供测试与调用方复用的帧查询（与 CSS keyframes 同源）。
 * 返回 `[opacity, translateX, translateY]`，单位与 `overlayEntranceFrame` 一致。
 */
export function entranceFrameAt(kind: OverlayEntranceKind, progress: number) {
  return overlayEntranceFrame(kind, progress);
}
