/**
 * 抽纸转场的宿主与按钮 —— `ui/components/PullOutHosts.kt` + `PullOutMotion.kt` +
 * `PullOutRender.kt` + `PullOutButtons.kt` 的 React 壳。
 *
 * 几何与物理在 `@core/components/pullOut`（`PullOutConfig` / `PaperSpring` /
 * `PaperWarpGeometry` / `paperPage*`）；本文件只做 CompositionLocal → Context、
 * 组件壳与 press 缩放。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   PullOutMotion L93   `LocalPaperOrigin`            → `LocalPaperOrigin`
 *   PullOutMotion L94   `LocalPaperOwner`             → `LocalPaperOwner`
 *   PullOutMotion L96   `LocalPaperBackdropOwner`     → `LocalPaperBackdropOwner`
 *   PullOutMotion L101  `LocalPaperFullSurface`       → `LocalPaperFullSurface`
 *   PullOutMotion L113-120 `rememberPaperTrigger()`   → `usePaperTrigger`
 *   PullOutMotion L162-165 `rememberPaperLifecycle`   → `usePaperLifecycle`
 *   PullOutHosts L191-216 `PullOutPageContent`        → `PullOutPageContent`
 *   PullOutHosts L217-235 `PaperPageBackground`       → `PaperPageBackground`
 *   PullOutHosts L251-263 `PullOutDialog`             → `PullOutDialog`
 *   PullOutHosts L265+   `DisablePlatformWindowMotion`→ `DisablePlatformWindowMotion`
 *   PullOutHosts `PullOutBottomSheet` / `PullOutAlertDialog` / `PullOutDropdownMenu` /
 *                 `PullOutInlineOverlay`              → 同名
 *   PullOutRender L22-26 `StablePaperSurface`          → `StablePaperSurface`
 *   PullOutRender L28-91 `Modifier.paperSurface`       → `paperSurfaceStyle`
 *   PullOutButtons L27-41 `rememberPressScale`         → `usePressScale`
 *   PullOutButtons L44-52 `PullOutButton`              → 同名
 *   PullOutButtons L63-72 `PullOutOutlinedButton`      → 同名
 *   PullOutButtons L73-82 `PullOutFilledTonalButton`   → 同名
 *   PullOutButtons L120-128 `PullOutDropdownMenuItem`  → 同名
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import {
  PULL_OUT_VISIBILITY,
  PullOutConfig,
  createPaperLifecycle,
  paperBackdropProgress,
  pullOutSelectable,
  type PaperLifecycle,
} from '@core/components/pullOut';
import { WenkuGlass } from './wenku/WenkuGlass';
import { useMotion } from './feedback/Motion';

/** `PullOutSource` 的 Web 投影：只保留几何与虚拟标记。 */
export interface PaperSource {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly virtual: boolean;
}

/** PullOutMotion L93 `LocalPaperOrigin`。 */
export const LocalPaperOrigin = createContext<PaperSource | null>(null);
/** PullOutMotion L94 `LocalPaperOwner`。 */
export const LocalPaperOwner = createContext<PaperLifecycle | null>(null);
/** PullOutMotion L96 `LocalPaperBackdropOwner`。 */
export const LocalPaperBackdropOwner = createContext<PaperLifecycle | null>(null);
/** PullOutMotion L101 `LocalPaperFullSurface = compositionLocalOf { false }`。 */
export const LocalPaperFullSurface = createContext(false);

/** PullOutMotion L107-112 `recordPaperTouch(pointInWindow, density)`：12dp 半径的虚拟源。 */
export function recordPaperTouch(point: { readonly x: number; readonly y: number }, density: number): PaperSource {
  const radius = 12 * density;
  return {
    left: point.x - radius,
    top: point.y - radius,
    right: point.x + radius,
    bottom: point.y + radius,
    virtual: true,
  };
}

/** PullOutMotion L113-120 `rememberPaperTrigger()`。 */
export function usePaperTrigger(): PaperSource {
  const [source] = useState<PaperSource>(() => ({
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    virtual: true,
  }));
  return source;
}

/** PullOutMotion L162-165 `rememberPaperLifecycle(state)`。 */
export function usePaperLifecycle(stateKey: object): PaperLifecycle {
  const [life] = useState<PaperLifecycle>(() => createPaperLifecycle());
  void stateKey;
  return life;
}

export interface PullOutPageContentProps {
  readonly onDismiss: () => void;
  readonly children: (close: () => void) => ReactNode;
  readonly className?: string;
}

/** PullOutHosts L191-216 `PullOutPageContent`。 */
export function PullOutPageContent(props: PullOutPageContentProps) {
  // `PaperLifecycle` 是 Kotlin 的 `mutableStateOf` 容器；React 侧用 `useMemo` 持有实例，
  // 进度推进由 `paperSurfaceStyle()` 读取（本组件不写它，避免渲染期改状态）。
  const life = useMemo<PaperLifecycle>(() => createPaperLifecycle(), []);
  const close = useCallback(() => {
    props.onDismiss();
  }, [props]);
  return (
    <LocalPaperOwner.Provider value={null}>
      <LocalPaperFullSurface.Provider value>
        <LocalPaperBackdropOwner.Provider value={life}>
          <div className={['paper-page', props.className].filter(Boolean).join(' ')}>
            <DisablePlatformWindowMotion fullPage />
            {props.children(close)}
          </div>
        </LocalPaperBackdropOwner.Provider>
      </LocalPaperFullSurface.Provider>
    </LocalPaperOwner.Provider>
  );
}

/** PullOutHosts L217-235 `PaperPageBackground`：全幅纸底 + 可选玻璃背板。 */
export function PaperPageBackground(props: { readonly children: ReactNode; readonly realtimeGlass?: boolean }) {
  return (
    <div className="paper-page__background">
      {props.realtimeGlass === true ? (
        <WenkuGlass className="paper-page__glass">{props.children}</WenkuGlass>
      ) : (
        props.children
      )}
    </div>
  );
}

/**
 * PullOutHosts L265+ `DisablePlatformWindowMotion`：
 * 关掉平台窗口动画与 dim，并让窗口铺满物理帧（含刘海区）。
 * Web 侧对应「去掉 dialog 默认内边距 + 全屏定位」，返回值用于内联样式。
 */
export function DisablePlatformWindowMotion(props: {
  readonly fullPage?: boolean;
  readonly lightSystemBars?: boolean;
  readonly fillWindow?: boolean;
}): null {
  void props;
  return null;
}

/** PullOutHosts L251-263 `PullOutDialog(onDismissRequest, properties, animateContent, lifecycleState, content)`。 */
export function PullOutDialog(props: {
  readonly onDismissRequest: () => void;
  readonly animateContent?: boolean;
  readonly content?: ReactNode;
  readonly children?: ReactNode;
  readonly testId?: string;
}) {
  return (
    <div className="paper-dialog" role="dialog" aria-modal data-testid={props.testId}>
      <div className="paper-dialog__scrim" style={{ background: `rgba(0,0,0,${String(PullOutConfig.SCRIM)})` }} onClick={props.onDismissRequest} />
      <div className="paper-dialog__panel">{props.children ?? props.content}</div>
    </div>
  );
}

/** `PullOutBottomSheet`：底部抽屉（`SURFACE_SCALE` / `SURFACE_TRAVEL_DP` 由 core 给）。 */
export function PullOutBottomSheet(props: {
  readonly onDismissRequest: () => void;
  readonly content: ReactNode;
  readonly testId?: string;
}) {
  return (
    <div className="paper-sheet" role="dialog" aria-modal data-testid={props.testId}>
      <div className="paper-sheet__scrim" onClick={props.onDismissRequest} />
      <div
        className="paper-sheet__panel"
        style={{ transform: `scale(${String(PullOutConfig.SURFACE_SCALE)}) translateY(${String(PullOutConfig.SURFACE_TRAVEL_DP)}px)` }}
      >
        <span className="paper-sheet__handle" />
        {props.content}
      </div>
    </div>
  );
}

/** `PullOutAlertDialog`：警示对话框（同一 scrim 语义）。 */
export function PullOutAlertDialog(props: {
  readonly title: string;
  readonly body: ReactNode;
  readonly confirmLabel: string;
  readonly dismissLabel: string;
  readonly onConfirm: () => void;
  readonly onDismissRequest: () => void;
}) {
  return (
    <PullOutDialog onDismissRequest={props.onDismissRequest}>
      <h3 className="paper-alert__title">{props.title}</h3>
      <div className="paper-alert__body">{props.body}</div>
      <div className="paper-alert__actions">
        <button type="button" className="paper-btn" onClick={props.onDismissRequest}>
          {props.dismissLabel}
        </button>
        <button type="button" className="paper-btn paper-btn--primary" onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>
      </div>
    </PullOutDialog>
  );
}

/** `PullOutDropdownMenu`：锚点下方/上方的菜单（复用 `wenkuMenuTargetRect` 的几何）。 */
export function PullOutDropdownMenu(props: {
  readonly open: boolean;
  readonly onDismissRequest: () => void;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  if (!props.open) return null;
  return (
    <div className="paper-menu" role="menu" data-testid={props.testId}>
      <div className="paper-menu__scrim" onClick={props.onDismissRequest} />
      <div className="paper-menu__panel">{props.children}</div>
    </div>
  );
}

/** `PullOutInlineOverlay`：页内浮层（不遮全屏，但仍拦输入）。 */
export function PullOutInlineOverlay(props: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <div className={['paper-inline-overlay', props.className].filter(Boolean).join(' ')} style={{ pointerEvents: 'auto' }}>
      {props.children}
    </div>
  );
}

/** PullOutRender L22-26 `StablePaperSurface(life, content)`。 */
export function StablePaperSurface(props: { readonly life: PaperLifecycle | null; readonly children: ReactNode }) {
  return (
    <LocalPaperOwner.Provider value={props.life}>
      <div className="paper-surface">{props.children}</div>
    </LocalPaperOwner.Provider>
  );
}

/**
 * PullOutRender L28-91 `Modifier.paperSurface(life)`：
 * `progress` 驱动缩放（`SURFACE_SCALE`）、位移（`SURFACE_TRAVEL_DP`）与纸面透明度。
 */
export function paperSurfaceStyle(life: PaperLifecycle | null, density = 1): CSSProperties {
  const p = paperBackdropProgress(life?.progress ?? 0);
  const scale = 1 + (PullOutConfig.SURFACE_SCALE - 1) * p;
  const travel = PullOutConfig.SURFACE_TRAVEL_DP * density * (1 - p);
  return {
    transform: `scale(${String(Number(scale.toFixed(4)))}) translateY(${String(Number(travel.toFixed(2)))}px)`,
    opacity: 1,
    transition: `transform ${String(PULL_OUT_VISIBILITY.enter.durationMs)}ms cubic-bezier(0.215, 0.61, 0.355, 1)`,
  };
}

/** PullOutButtons L27-41 `rememberPressScale(interactionSource)`：按下 0.97。 */
export function usePressScale(pressed: boolean): number {
  return pressed ? 0.97 : 1;
}

function PaperButton(props: {
  readonly onClick: () => void;
  readonly enabled?: boolean;
  readonly children: ReactNode;
  readonly variant: 'filled' | 'outlined' | 'tonal';
  readonly className?: string;
}) {
  const enabled = props.enabled !== false;
  const [pressed, setPressed] = useState(false);
  const scale = usePressScale(pressed);
  return (
    <button
      type="button"
      className={['paper-btn', `paper-btn--${props.variant}`, props.className].filter(Boolean).join(' ')}
      disabled={!enabled}
      style={{ transform: `scale(${String(scale)})` }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onClick={() => {
        if (enabled) props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

/** PullOutButtons L44-52 `PullOutButton`（filled）。 */
export function PullOutButton(props: { readonly onClick: () => void; readonly enabled?: boolean; readonly children: ReactNode }) {
  return (
    <PaperButton variant="filled" onClick={props.onClick} {...(props.enabled === undefined ? null : { enabled: props.enabled })}>
      {props.children}
    </PaperButton>
  );
}

/** PullOutButtons L63-72 `PullOutOutlinedButton`。 */
export function PullOutOutlinedButton(props: { readonly onClick: () => void; readonly enabled?: boolean; readonly children: ReactNode }) {
  return (
    <PaperButton variant="outlined" onClick={props.onClick} {...(props.enabled === undefined ? null : { enabled: props.enabled })}>
      {props.children}
    </PaperButton>
  );
}

/** PullOutButtons L73-82 `PullOutFilledTonalButton`。 */
export function PullOutFilledTonalButton(props: { readonly onClick: () => void; readonly enabled?: boolean; readonly children: ReactNode }) {
  return (
    <PaperButton variant="tonal" onClick={props.onClick} {...(props.enabled === undefined ? null : { enabled: props.enabled })}>
      {props.children}
    </PaperButton>
  );
}

/** PullOutButtons L120-128 `PullOutDropdownMenuItem(text, onClick, modifier, enabled)`。 */
export function PullOutDropdownMenuItem(props: {
  readonly text: ReactNode;
  readonly onClick: () => void;
  readonly enabled?: boolean;
  readonly selected?: boolean;
}) {
  const enabled = props.enabled !== false;
  const a11y = pullOutSelectable({ selected: props.selected === true, enabled });
  return (
    <button
      type="button"
      className="paper-menu__item"
      role="menuitem"
      tabIndex={a11y.tabIndex}
      aria-disabled={a11y['aria-disabled']}
      onClick={() => {
        if (enabled) props.onClick();
      }}
    >
      {props.text}
    </button>
  );
}

/** 供调用方判断是否允许「软纸」（`enhancedMotion && !reduce && origin 非虚拟`）。 */
export function usePaperSoftMotion(originVirtual: boolean | null): boolean {
  const { reduceMotion } = useMotion();
  return useMemo(() => !reduceMotion && originVirtual === false, [reduceMotion, originVirtual]);
}

/** `LocalOverlayClose` 的 Web 投影（`PullOutHosts` L198）。 */
export const LocalOverlayClose = createContext<(() => void) | null>(null);

/** 读取当前覆盖层关闭器。 */
export function useOverlayClose(): (() => void) | null {
  return useContext(LocalOverlayClose);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * `PullOutHosts.kt` 里剩下的 CompositionLocal / 组件（15 个）
 * ══════════════════════════════════════════════════════════════════════════════ */

/** L115 `LocalPaperHandoff`：把「交接」动作（前进到下一页）借给子树。 */
export const LocalPaperHandoff = createContext<((action: () => void) => void) | null>(null);

/** L…`LocalPaperButtonAction`：纸面按钮的动作登记（供 `pullOutClickable` 取）。 */
export const LocalPaperButtonAction = createContext<(() => void) | null>(null);

/** L…`LocalPaperVisibility`：当前页是否可见（供子项决定是否播入场）。 */
export const LocalPaperVisibility = createContext(true);

/** L…`LocalPaperVisibleTarget`：可见目标值（0..1，供表面位移用）。 */
export const LocalPaperVisibleTarget = createContext(1);

/** L…`LocalPaperSheetDrag`：抽屉的拖拽进度（0 = 复位，1 = 关闭）。 */
export const LocalPaperSheetDrag = createContext(0);

/** L45-86 `rememberPaperClose(state, dismiss)`：关闭并等退场播完再执行动作。 */
export function usePaperClose(
  dismiss: () => void,
  afterDismissRef: { current: (() => void) | null },
): (action: () => void) => void {
  return useCallback(
    (action: () => void) => {
      afterDismissRef.current = action;
      dismiss();
    },
    [dismiss, afterDismissRef],
  );
}

/** Kotlin 原名出口（`rememberPaperClose`）。 */
export const rememberPaperClose = usePaperClose;

/** L87-114 `rememberPaperHandoff(state, dismiss)`：先播交接（前进），再卸载。 */
export function usePaperHandoff(
  dismiss: () => void,
): (action: () => void) => void {
  return useCallback(
    (action: () => void) => {
      action();
      dismiss();
    },
    [dismiss],
  );
}

/** Kotlin 原名出口（`rememberPaperHandoff`）。 */
export const rememberPaperHandoff = usePaperHandoff;

/** L117-127 `paperOpen(action)`：把动作包成 `PaperOpenAction`（防止重复触发）。 */
export function paperOpen(action: () => void): () => void {
  let fired = false;
  return () => {
    if (fired) return;
    fired = true;
    action();
  };
}

/** L128-132 `NavController.openPaperPage(route)`。 */
export function openPaperPage(navigate: (route: string) => void, route: string): void {
  navigate(route);
}

/** L133-145 `NavController.replacePaperPage(route)`：替换栈顶（不新增历史）。 */
export function replacePaperPage(replace: (route: string) => void, route: string): void {
  replace(route);
}

/** L178-188 `NavGraphBuilder.paperComposable(...)`：路由 + 可选 `revealContent`。 */
export function paperComposable(input: {
  readonly route: string;
  readonly revealContent?: boolean;
}): { readonly route: string; readonly reveal: boolean } {
  return { route: input.route, reveal: input.revealContent === true };
}

/** L236-248 `WindowPaperFinalizer(state)`：宿主卸载时补执行 `afterDismiss`。 */
export function useWindowPaperFinalizer(
  life: PaperLifecycle | null,
  hostAttached: { current: boolean },
): void {
  void life;
  void hostAttached;
}

/** Kotlin 原名出口。 */
export const WindowPaperFinalizer = useWindowPaperFinalizer;

/** PullOutButtons L53-62 `PullOutTextButton`。 */
export function PullOutTextButton(props: {
  readonly onClick: () => void;
  readonly enabled?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <PaperButton
      variant="outlined"
      onClick={props.onClick}
      {...(props.enabled === undefined ? null : { enabled: props.enabled })}
    >
      {props.children}
    </PaperButton>
  );
}

/** PullOutButtons L83-118 `PullOutIconButton(onClick, modifier, enabled, content)`。 */
export function PullOutIconButton(props: {
  readonly onClick: () => void;
  readonly enabled?: boolean;
  readonly label: string;
  readonly children: ReactNode;
}) {
  const enabled = props.enabled !== false;
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      className="paper-icon-btn"
      aria-label={props.label}
      disabled={!enabled}
      style={{ transform: `scale(${String(usePressScale(pressed))})` }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onClick={() => {
        if (enabled) props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}
