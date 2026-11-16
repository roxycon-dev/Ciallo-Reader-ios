/**
 * PullOutHosts.kt 的 Web 等价层 —— 全站纸质层的**关闭 / 前递交 / 触发**语义。
 *
 * 权威源码（只读）：`novel-reader/app/src/main/java/com/example/ui/components/PullOutHosts.kt`
 * （436 行，19 个公开/内部 API + 5 个 CompositionLocal），配套时钟与来源表在同目录
 * `PullOutMotion.kt`（`PullOutConfig` / `PullOutSource` / `PullOutSources` / `PaperLifecycle`）。
 *
 * 为什么需要这一层：`PullOutHosts.kt` 不是死代码。排除定义文件后，生产引用计数是
 *
 *   | 符号                  | 引用 | 代表调用点                                     |
 *   |----------------------|-----:|-----------------------------------------------|
 *   | `rememberPaperClose`  |    4 | `AcrylicDialog.kt:40`、`NovelImageFullscreen.kt:184` |
 *   | `rememberPaperHandoff`|    2 | `AcrylicDialog.kt:93/163`                     |
 *   | `paperOpen`           |   10 | `DiscoverPanels.kt:74`、`ReaderScreen.kt:3197` |
 *   | `openPaperPage`       |   21 | `MainActivity.kt:5/709/711`                   |
 *   | `replacePaperPage`    |    2 | `MainActivity.kt:11/1343`                     |
 *   | `dismissPaperPage`    |   22 | `MainActivity.kt:10/465/1276`                 |
 *
 * 它是**全站导航与弹窗的转场宿主**。iOS 侧此前只有两处零散等价物：
 *   - `src/ui/shared/paperRouteHost.ts` —— 整页纸质路由的挂载/关闭/修剪；
 *   - `src/ui/components/library/DownloadCenter.tsx:149-151` —— 「退场 promise 结算为
 *     `finished` 之后才提交」这一个点的正确写法。
 * 本文件把缺的部分补齐，且**不挂 UI、不改页面**：
 *
 *   - `PULL_OUT_*`      —— `PullOutConfig` 的常量（遮罩 / 拖拽 / 来源寿命）；
 *   - `PaperSource`     —— `PullOutSource` 的来源快照（`freezeForHandoff` / `returnSource`）；
 *   - `claimPaperSource`—— `PullOutSources.claim()`（几何 + 900ms 寿命 + 只领一次）；
 *   - `createPaperCloseController`   —— `rememberPaperClose`（退场→dismiss→跟随动作）；
 *   - `createPaperHandoffController` —— `rememberPaperHandoff`（前递交冻结来源）；
 *   - `createPaperDisposalQueue`     —— `WindowPaperFinalizer` 的 `hostAttached`/`afterDismiss`；
 *   - `PaperLayerContext` + `usePaperDismiss` / `usePaperClick` / `usePaperOpen`
 *     —— `LocalPaperButtonAction` / `LocalPaperHandoff` / `paperClick` / `paperDismiss` /
 *     `paperOpen` 的 React 形态；
 *   - `PAPER_SHEET_DRAG_STYLE` —— `Modifier.paperSheetDragHandle()` 的 Web 落点。
 *
 * 接线方式（本次**不改**页面，见 `docs/PARITY_EXCEPTIONS.md` E111 的接线清单）：
 * 宿主在 layout effect 里 `registerPaperLayer({ key, close })` 并把
 * `PaperLayerContext` 的 value 包到子树，页面里的关闭按钮从 `onClose` 换成
 * `usePaperDismiss()` 即可获得「退场后提交」与「先关最上层」两条语义。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import {
  dismissPaperLayer,
  PAPER_TRANSITION_CONFIG,
  type PaperRect,
  type PaperTransitionResult,
} from './paperPageTransition';

/** 本文件对外只用 `PaperRect` / `PaperTransitionResult` 两种过渡类型，直接透出，调用方无需再 import 一次。 */
export type { PaperRect, PaperTransitionResult } from './paperPageTransition';

/* ══════════════════════════════════════════════════════════════════════════════
 * 1. `PullOutConfig`（PullOutMotion.kt L25-59）里 PullOutHosts.kt 直接消费的常量
 * ══════════════════════════════════════════════════════════════════════════════ */

/** `PullOutConfig.SCRIM = .35f` —— 纸质层遮罩终点透明度。 */
export const PULL_OUT_SCRIM = 0.35;

/**
 * `PullOutConfig.DISMISS_DISTANCE = 64f`。
 *
 * ⚠️ Android 侧只定义不消费：`grep -rn DISMISS_DISTANCE novel-reader/app/src` 仅命中
 * `PullOutMotion.kt:27` 的定义行。iOS 的活阈值在
 * `src/ui/components/wenku/WenkuActionSheet.tsx:166-167`
 * （velocity + 面板高度比例），与本值不同 —— 见 E111 残留差异第 2 条。
 */
export const PULL_OUT_DISMISS_DISTANCE = 64;

/** `PullOutConfig.DRAG_TRAVEL = 300f`，同上：Android 侧零消费方。 */
export const PULL_OUT_DRAG_TRAVEL = 300;

/** `PullOutConfig.SOURCE_LIFETIME_MS = 900L` —— 点击来源的存活窗口（`claim()` 判据）。 */
export const PULL_OUT_SOURCE_LIFETIME_MS = 900;

/** `PullOutSource.returnSource()` 的 `repeat(8)` —— 向上找活来源的层数上限。 */
export const PULL_OUT_RETURN_DEPTH = 8;

/** `LocalPaperVisibleTarget` 的默认值（`compositionLocalOf { 1f }`，L394）。 */
export const PAPER_VISIBLE_TARGET_SETTLED = 1;

/**
 * 弹簧系数与 `paperPageTransition.PAPER_TRANSITION_CONFIG` 同源
 * （`PullOutConfig.OPEN_K=140 / OPEN_D=24 / CLOSE_K=260 / CLOSE_D=34`）。
 * 这里只是重新导出，避免两处各写一份数字。
 */
export const PULL_OUT_SPRING = Object.freeze({
  openStiffness: PAPER_TRANSITION_CONFIG.openStiffness,
  openDamping: PAPER_TRANSITION_CONFIG.openDamping,
  closeStiffness: PAPER_TRANSITION_CONFIG.closeStiffness,
  closeDamping: PAPER_TRANSITION_CONFIG.closeDamping,
});

/** 单调时钟（Kotlin `SystemClock.uptimeMillis()`）。测试可注入。 */
export function paperSourceClock(): number {
  return Date.now();
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 2. `PullOutSource` / `PullOutSources`（PullOutMotion.kt L61-92）
 * ══════════════════════════════════════════════════════════════════════════════ */

export interface PaperSourceOptions {
  /** 屏幕坐标矩形（与 `paperPageTransition.computePaperGeometry` 同一坐标系）。 */
  bounds?: PaperRect | null;
  /** 触发元素；`freezeForHandoff()` 会把它一起搬进快照。 */
  element?: Element | null;
  /** `true` = 触点虚拟来源（`recordPaperTouch` 的 12dp 方块），不是真实控件。 */
  virtual?: boolean;
  /** 承载这一来源的父面板来源（`rememberPaperTrigger` 的 `LocalPaperOrigin`）。 */
  parent?: PaperSource | null;
}

/**
 * 一次点击/打开动作的来源几何。
 *
 * 与 Kotlin 一样，**几何是唯一被登记的东西**（`pullOutAnchor()` 的注释：
 * "Registration is geometry only. The reference frontend has no paper-source raster path."）。
 */
export class PaperSource {
  bounds: PaperRect | null;
  element: Element | null;
  parent: PaperSource | null;
  /** `recordPaperTouch` 生成的点来源。 */
  virtual: boolean;
  /** 宿主卸载后置位；`returnSource()` 会跳过它继续向上找。 */
  disposed = false;
  /** 前递交快照：`claim()` 不会对它再走 `returnSource()`。 */
  frozenOpening = false;
  /** 已被某一层领走 —— 保证一次点击只开一层。 */
  claimed = false;
  /** 最近一次 `activatePaperSource()` 的时钟值。 */
  activatedAt = 0;

  constructor(options: PaperSourceOptions = {}) {
    this.bounds = options.bounds ?? null;
    this.element = options.element ?? null;
    this.parent = options.parent ?? null;
    this.virtual = options.virtual ?? false;
  }

  /**
   * `PullOutSource.freezeForHandoff()`（PullOutMotion.kt L70-74）：
   * 拷一份不能再动的快照，并把「关闭时该回到哪」提前算好 —— 原控件在交接过程中
   * 通常已经被替换/卸载，不能等到关闭时再读。
   */
  freezeForHandoff(): PaperSource {
    const snapshot = new PaperSource({
      bounds: this.bounds,
      element: this.element,
      virtual: this.virtual,
      parent: this.parent === null ? this.returnSource() : this.parent.returnSource(),
    });
    snapshot.disposed = true;
    snapshot.frozenOpening = true;
    return snapshot;
  }

  /**
   * `PullOutSource.returnSource()`（L75-84）：沿 `parent` 向上找到第一个「活」来源。
   * 最多回溯 `PULL_OUT_RETURN_DEPTH` 层，且永远不回到自己（防环）。
   */
  returnSource(): PaperSource {
    return resolveReturnSource(this);
  }
}

/** `returnSource()` 的实体（独立函数，避免把 `this` 复制到局部变量）。 */
function resolveReturnSource(start: PaperSource): PaperSource {
  let origin = start;
  for (let hop = 0; hop < PULL_OUT_RETURN_DEPTH; hop += 1) {
    if (!origin.disposed || origin.virtual) return origin;
    const next = origin.parent;
    if (next === null) return origin;
    if (next === start) return origin;
    origin = next;
  }
  return origin;
}

let latestSource: PaperSource | null = null;

/** `PullOutSources.activate(source)` —— 记下最近一次点击来源并重置 `claimed`。 */
export function activatePaperSource(source: PaperSource, nowMs: number = paperSourceClock()): void {
  latestSource = source;
  source.activatedAt = nowMs;
  source.claimed = false;
}

/** `PullOutSources.latest` —— 最近一次被激活的来源（可能已被领走）。 */
export function latestPaperSource(): PaperSource | null {
  return latestSource;
}

/**
 * `PullOutSources.claim()`（L89-92）：领走最近一次点击来源。
 *
 * 四个判据逐条照抄：几何非零、`!claimed`、距 `activate` ≤ 900ms；
 * 领走后置 `claimed`；返回 `frozenOpening ? 自身 : returnSource()`。
 */
export function claimPaperSource(nowMs: number = paperSourceClock()): PaperSource | null {
  const source = latestSource;
  if (source === null) return null;
  const bounds = source.bounds;
  const measurable =
    bounds !== null && bounds.width > 0 && bounds.height > 0 &&
    Number.isFinite(bounds.width) && Number.isFinite(bounds.height);
  if (!measurable) return null;
  if (source.claimed) return null;
  if (nowMs - source.activatedAt > PULL_OUT_SOURCE_LIFETIME_MS) return null;
  source.claimed = true;
  return source.frozenOpening ? source : source.returnSource();
}

/** 清空来源表。仅供单元测试与 HMR 复原使用。 */
export function resetPaperSources(): void {
  latestSource = null;
}

/**
 * `paperBackdropProgress(progress)`（PullOutMotion.kt L97-100）：
 * `p * p * (3 - 2p)` 的端点平滑 —— 遮罩 alpha 与窗口 dim 共用同一条曲线
 * （消费方：`PullOutHosts.kt:204`、`WindowBackdrop.kt:51`）。
 */
export function paperBackdropProgress(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return p * p * (3 - 2 * p);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 3. `WindowPaperFinalizer`（PullOutHosts.kt L236-248）的宿主侧等价物
 * ══════════════════════════════════════════════════════════════════════════════ */

/**
 * `PaperLifecycle.hostAttached` / `afterDismiss` 的最小模型。
 *
 * Kotlin 的整页宿主是独立 Dialog 窗口：`rememberPaperClose` 在窗口销毁前不能跑
 * 跟随动作，否则 Compose 会把 `null -> next` 合批、复用旧的 remember 状态。
 * Web 没有窗口销毁，但 React 卸载同样有「同一批更新里旧组件状态被复用」的问题，
 * 因此保留同一个闸门：`attach()` 之前 `defer()` 的动作会立刻排队，`dispose()`
 * 时才真正执行一次。
 */
export interface PaperDisposalQueue {
  readonly attached: boolean;
  /** 单槽（Kotlin `var afterDismiss: (() -> Unit)?`）：后写覆盖前写。 */
  defer(run: () => void): void;
  /** 宿主挂载（`WindowPaperFinalizer` 的 `DisposableEffect` 体）。 */
  attach(): void;
  /** 宿主卸载（`onDispose`）：把排队的动作跑掉，且只跑一次。 */
  dispose(): void;
}

export function createPaperDisposalQueue(): PaperDisposalQueue {
  let attached = false;
  let pending: (() => void) | null = null;
  return {
    get attached(): boolean {
      return attached;
    },
    defer(run: () => void): void {
      pending = run;
    },
    attach(): void {
      attached = true;
    },
    dispose(): void {
      attached = false;
      const action = pending;
      pending = null;
      action?.();
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 4. `rememberPaperClose`（PullOutHosts.kt L44-81）
 * ══════════════════════════════════════════════════════════════════════════════ */

export interface PaperCloseOptions {
  /** `state.targetState` —— 这一层现在是否处于打开状态。 */
  isOpen(): boolean;
  /** `dismiss` 形参（`rememberUpdatedState(dismiss)` 的那一个）。 */
  dismiss(): void;
  /** `state.targetState = false` —— 真正起播退场；返回退场 promise（可省略 = 同步退场）。 */
  requestExit(): Promise<PaperTransitionResult> | void;
  /** `life.origin` —— 打开这一层时的来源快照（用于关闭后把来源重新激活）。 */
  origin?(): PaperSource | null;
  /** `life.hostAttached` 闸门；省略 = 无窗口宿主要等（内联覆盖层）。 */
  disposal?(): PaperDisposalQueue | null;
  /** `life.handingOff` —— 前递交已接管，本次关闭不再走完整退场。 */
  handingOff?(): boolean;
}

export interface PaperCloseController {
  /**
   * 关闭动作。语义与 Kotlin 返回的 lambda 一致：
   * - `executing` 期间调用 → 立刻执行 `action`（不在退场里再排一次）；
   * - 已经不在打开态（`targetState == false`，含已开始退场）→ **丢弃** `action`；
   * - 打开态 → 记 `pending`（同一帧内后写覆盖前写）、起播退场；退场 `finished`
   *   之后先跑 `dismiss()`，再激活 `origin.returnSource()`，最后跑 `action`。
   */
  close(action?: () => void): void;
  /** 正在执行 `dismiss`（Kotlin `var executing`）。 */
  readonly executing: boolean;
  /** 已记住、等退场结束才跑的跟随动作（Kotlin `var pending`）。 */
  readonly pending: (() => void) | null;
}

export function createPaperCloseController(options: PaperCloseOptions): PaperCloseController {
  let pending: (() => void) | null = null;
  let executing = false;
  let wasOpen = options.isOpen();
  let closedOnce = false;

  const active = (): boolean => options.handingOff?.() !== true;

  const complete = (): void => {
    if (!wasOpen || !active()) return;
    const action = pending;
    pending = null;
    wasOpen = false;
    closedOnce = true;
    let followedUp = false;
    const followUp = (): void => {
      if (followedUp) return;
      followedUp = true;
      executing = true;
      try {
        if (action !== null) {
          const origin = options.origin?.() ?? null;
          if (origin !== null) activatePaperSource(origin.returnSource());
        }
        action?.();
      } finally {
        executing = false;
      }
    };
    const queue = options.disposal?.() ?? null;
    const awaitWindowDisposal = queue !== null && queue.attached;
    if (awaitWindowDisposal) queue.defer(followUp);
    executing = true;
    try {
      options.dismiss();
    } finally {
      executing = false;
    }
    if (!awaitWindowDisposal) followUp();
  };

  return {
    close(action?: () => void): void {
      if (executing) {
        action?.();
        return;
      }
      if (!options.isOpen() || !active()) return;
      wasOpen = true;
      pending = action === undefined || action === options.dismiss ? null : action;
      const exit = options.requestExit();
      if (exit === undefined) {
        // 同步退场（reduced motion / 测试替身）：仍然走完整完成路径。
        complete();
        return;
      }
      void exit.then(
        (result) => {
          if (result === 'finished') complete();
          else if (!closedOnce) pending = null;
        },
        () => {
          pending = null;
        },
      );
    },
    get executing(): boolean {
      return executing;
    },
    get pending(): (() => void) | null {
      return pending;
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 5. `rememberPaperHandoff`（PullOutHosts.kt L87-112）
 * ══════════════════════════════════════════════════════════════════════════════ */

export interface PaperHandoffOptions {
  /** `state.targetState` —— 起手时这一层必须仍在打开态。 */
  isOpen(): boolean;
  /** `life.origin`。 */
  origin(): PaperSource | null;
  /** 真正的导航/替换动作（Kotlin 形参 `action`）。 */
  forward(action: () => void): void;
  /** `life.retained = false; life.closed = true; latest()` —— 立刻退役本层窗口。 */
  retire?(): void;
  /** `life.hostAttached` 闸门。 */
  disposal?(): PaperDisposalQueue | null;
  /** `life.handingOff` —— 已经交接过就不再重复。 */
  handingOff?(): boolean;
  /** `life.handingOff = true; life.inputBlocked = true`。 */
  beginHandoff?(): void;
}

/**
 * `rememberPaperHandoff(state, dismiss)`：换面板/换页面是**前向动作**，不是「先关再开」。
 *
 * 与 `rememberPaperClose` 的差别（逐条对齐 Kotlin）：
 * 1. 先 `claim()` 领走点击来源并 `freezeForHandoff()` 冻结几何；
 * 2. 目标动作要等窗口退役后才跑（`afterDismiss` 槽），否则新旧两层会在同一批更新里
 *    互相覆盖；
 * 3. 不跑任何退场动画（`state.targetState = false` 之后立即 `closed = true`）。
 */
export function createPaperHandoffController(
  options: PaperHandoffOptions,
): (action: () => void) => void {
  return (action: () => void): void => {
    if (!options.isOpen()) return;
    if (options.handingOff?.() === true) return;
    options.beginHandoff?.();
    const claimed = claimPaperSource();
    const source = claimed !== null && claimed.bounds !== null
      ? claimed.freezeForHandoff()
      : options.origin()?.freezeForHandoff() ?? null;
    let forwarded = false;
    const forward = (): void => {
      if (forwarded) return;
      forwarded = true;
      if (source !== null) activatePaperSource(source);
      options.forward(action);
    };
    const queue = options.disposal?.() ?? null;
    const waitForWindow = queue !== null && queue.attached;
    if (waitForWindow) queue.defer(forward);
    options.retire?.();
    if (!waitForWindow) forward();
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 6. React 形态：`LocalPaperButtonAction` / `LocalPaperHandoff` / `paperClick` /
 *    `paperDismiss` / `paperOpen`（PullOutHosts.kt L114-126、L391-437）
 * ══════════════════════════════════════════════════════════════════════════════ */

/**
 * 一个纸质层向子树下发的三件事：
 * - `close`   ← `LocalOverlayClose` + `LocalPaperButtonAction`（L392）
 * - `forward` ← `LocalPaperHandoff`（L115）
 * - `visibleTarget` ← `LocalPaperVisibility` + `LocalPaperVisibleTarget`（L393-394）
 */
export interface PaperLayerContextValue {
  close(action?: () => void): void;
  forward(action: () => void): void;
  /** 0..1，1 = 全展开（`LocalPaperVisibleTarget` 的默认值）。 */
  readonly visibleTarget: number;
}

export const PaperLayerContext = createContext<PaperLayerContextValue | null>(null);

/** `LocalPaperButtonAction`（L392）—— 同一个 context 的 `close` 槽，单独导出便于逐项核对。 */
export const PaperButtonActionContext = PaperLayerContext;

/** 读当前纸质层的 context；不在任何纸质层里时为 `null`（= Kotlin 的 compositionLocal 默认值）。 */
export function usePaperLayer(): PaperLayerContextValue | null {
  return useContext(PaperLayerContext);
}

const PAPER_OPEN_BRAND = Symbol('ciallo.paperOpenAction');

/** `paperOpen` 返回的标记动作：`paperClick` 见到它就直接执行，不再走关闭拦截。 */
export interface PaperOpenAction {
  (): void;
  readonly [PAPER_OPEN_BRAND]: true;
}

/** 把普通动作包成 `PaperOpenAction`（= Kotlin `private class PaperOpenAction`，L121-123）。 */
export function paperOpenAction(run: () => void): PaperOpenAction {
  const wrapped = (): void => {
    run();
  };
  const branded = Object.assign(wrapped, { [PAPER_OPEN_BRAND]: true as const });
  return branded as PaperOpenAction;
}

export function isPaperOpenAction(value: unknown): value is PaperOpenAction {
  if (typeof value !== 'function') return false;
  const brand = (value as unknown as Record<symbol, boolean | undefined>)[PAPER_OPEN_BRAND];
  return brand === true;
}

/** `trigger?.parent?.returnSource() ?: trigger?.returnSource()`（L426）。 */
function returnOriginFor(trigger: PaperSource | null): PaperSource | null {
  if (trigger === null) return null;
  const parent = trigger.parent;
  return parent === null ? trigger.returnSource() : parent.returnSource();
}

/**
 * `paperDismiss(action)`（L432-436）：关掉当前纸质层，`action` 在退场后执行。
 *
 * 没有 context 时回落到 `dismissPaperLayer()`（注册表最上层）；注册表也空则直接
 * 执行 `action` —— 相当于 Kotlin 里 `LocalOverlayClose.current` 的默认实现（直接调用）。
 */
export function usePaperDismiss(): (action?: () => void) => void {
  const layer = useContext(PaperLayerContext);
  return useCallback(
    (action?: () => void): void => {
      if (layer !== null) {
        layer.close(action);
        return;
      }
      if (!dismissPaperLayer(action)) action?.();
    },
    [layer],
  );
}

/**
 * `paperClick(action, source)`（L415-430）：
 * 先激活来源，再判断是否被 `LocalPaperButtonAction` 拦截。
 * 被拦截时把动作改成「回到触发元素的父来源之后再执行」，避免关闭动画期间来源已失效。
 */
export function usePaperClick(
  action: () => void,
  source: PaperSource | null = null,
): () => void {
  const layer = useContext(PaperLayerContext);
  return useCallback((): void => {
    if (source !== null) activatePaperSource(source);
    if (isPaperOpenAction(action)) {
      action();
      return;
    }
    if (layer === null) {
      action();
      return;
    }
    const returnOrigin = returnOriginFor(source ?? latestPaperSource());
    layer.close(() => {
      if (returnOrigin !== null) activatePaperSource(returnOrigin);
      action();
    });
  }, [action, layer, source]);
}

/** `paperOpen(action)`（L116-120）：有 handoff 时走前递交，否则直接执行。 */
export function usePaperOpen(action: () => void): () => void {
  const layer = useContext(PaperLayerContext);
  return useMemo(
    () =>
      paperOpenAction(() => {
        if (layer === null) action();
        else layer.forward(action);
      }),
    [action, layer],
  );
}

/** `LocalPaperVisibleTarget`（L394）：纸质层当前可见目标，默认 1（全展开）。 */
export function usePaperVisibleTarget(): number {
  const layer = useContext(PaperLayerContext);
  return layer?.visibleTarget ?? PAPER_VISIBLE_TARGET_SETTLED;
}

/**
 * `Modifier.paperSheetDragHandle()`（L398-399）+ `LocalPaperSheetDrag`（L395）的 Web 落点。
 *
 * ⚠️ Android 侧 `LocalPaperSheetDrag` **从未被 provide**（全仓只有定义行 L395），
 * 所以 `paperSheetDragHandle()` 在 Android 上等于 `Modifier`（空操作），
 * `LibraryScreen.kt:2917` 的两个调用点拿到的就是空 Modifier。iOS 的
 * `WenkuActionSheet.tsx:134-174` 反而真的实现了 pointer 拖拽 + `--wenku-sheet-drag`，
 * 这里只需要补上 CSS 侧的 `touch-action`。
 */
export const PAPER_SHEET_DRAG_STYLE = Object.freeze({ touchAction: 'none' as const });

/** 便捷 hook：把 `PAPER_SHEET_DRAG_STYLE` 摊到把手元素上。 */
export function usePaperSheetDragHandle(): Readonly<{ touchAction: 'none' }> {
  return PAPER_SHEET_DRAG_STYLE;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 7. React hooks（把上面两个控制器接到生命周期上）
 * ══════════════════════════════════════════════════════════════════════════════ */

/**
 * `rememberPaperClose(state, dismiss)` 的 hook 形态。
 *
 * 控制器在挂载后的副作用里建一次，入参用 ref 跟进最新值（= Kotlin `rememberUpdatedState`）。
 * 这样 render 期既不读也不写 ref（React 19 的 `react-hooks/refs` 禁止 render 期碰 ref）。
 */
export function usePaperClose(options: PaperCloseOptions): (action?: () => void) => void {
  const latest = useRef(options);
  const controllerRef = useRef<PaperCloseController | null>(null);
  useEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    controllerRef.current = createPaperCloseController({
      isOpen: () => latest.current.isOpen(),
      dismiss: () => {
        latest.current.dismiss();
      },
      requestExit: () => latest.current.requestExit(),
      origin: () => latest.current.origin?.() ?? null,
      disposal: () => latest.current.disposal?.() ?? null,
      handingOff: () => latest.current.handingOff?.() === true,
    });
    return () => {
      controllerRef.current = null;
    };
  }, []);
  return useCallback((action?: () => void): void => {
    controllerRef.current?.close(action);
  }, []);
}

/** `rememberPaperHandoff(state, dismiss)` 的 hook 形态（同上的 ref 纪律）。 */
export function usePaperHandoff(options: PaperHandoffOptions): (action: () => void) => void {
  const latest = useRef(options);
  const controllerRef = useRef<((action: () => void) => void) | null>(null);
  useEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    controllerRef.current = createPaperHandoffController({
      isOpen: () => latest.current.isOpen(),
      origin: () => latest.current.origin(),
      forward: (action) => {
        latest.current.forward(action);
      },
      retire: () => {
        latest.current.retire?.();
      },
      disposal: () => latest.current.disposal?.() ?? null,
      handingOff: () => latest.current.handingOff?.() === true,
      beginHandoff: () => {
        latest.current.beginHandoff?.();
      },
    });
    return () => {
      controllerRef.current = null;
    };
  }, []);
  return useCallback((action: () => void): void => {
    controllerRef.current?.(action);
  }, []);
}

/** `paperReplacePage` 需要的 NavOptions（PullOutHosts.kt L133-140）。 */
export interface PaperReplaceOptions {
  readonly popUpTo: string;
  readonly inclusive: true;
  readonly launchSingleTop: true;
}

/**
 * `NavController.replacePaperPage(route)` 的**参数**部分：
 * `outgoing = currentDestination?.id` → `popUpTo(outgoing) { inclusive = true }` + `launchSingleTop`。
 *
 * iOS 的 `NavStack.navigate()`（`src/core/app/navigation.ts:291-304`）已经支持这两个
 * 选项，缺的是「用它们做原子前向替换」的调用点 —— 见 E111 接线清单第 2 条。
 */
export function paperReplaceOptions(outgoing: string): PaperReplaceOptions {
  return { popUpTo: outgoing, inclusive: true, launchSingleTop: true };
}

/**
 * `NavController.openPaperPage(route)` 的选项：`launchSingleTop = true`（L129）。
 * 顺序：先冻结来源，再导航 —— 与 `replacePaperPage` 的 L134 同理。
 */
export function paperOpenOptions(): Readonly<{ launchSingleTop: true }> {
  return { launchSingleTop: true };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 8. `paperPageEnter/Exit/PopEnter/PopExit`（PullOutHosts.kt L151-175）
 *
 * ⚠️ 二轮复核补正：这四个函数**不是死代码**。它们由 `MainActivity.kt:629-662` 的
 * `NavHost(enterTransition = …, exitTransition = …, popEnterTransition = …,
 * popExitTransition = …)` 直接调用，就是**全站路由转场的默认值**（各目的地里只有
 * `composable("god_editor", …)` 用 `None` 覆盖，其余全部走这四个）。
 * 首轮复核误以为 `paperComposable`(L177-188) 该负责 enter/exit —— 它的签名里只有
 * `revealContent`，从来不负责转场。
 *
 * Kotlin 原文（L151-175，`pageEase` 是 `CubicBezierEasing(.18f, 1f, .04f, 1f)`，
 * 注释「Cupertino push/pop timing from app_ui.dart; the covered page moves one third」）：
 *   paperPageEnter    = slideInHorizontally(tween(420, pageEase)) { it }      // 从右边缘整幅滑入
 *   paperPageExit     = slideOutHorizontally(tween(420, pageEase)) { -it / 3 } // 被覆盖页左移 1/3
 *   paperPagePopEnter = slideInHorizontally(tween(320, pageEase)) { -it / 3 }  // 从左侧 1/3 回位
 *   paperPagePopExit  = slideOutHorizontally(tween(320, pageEase)) { it }      // 整幅退出到右侧
 * `reduce == true` 时四个分支都是 `EnterTransition.None` / `ExitTransition.None`。
 *
 * iOS 侧**尚未实现**（`src/core/app/navigation.ts:89-94 DEFAULT_ROUTE_TRANSITION`
 * 仍是四向 250ms 线性淡入淡出，`src/App.tsx:628-647` 只播入场、没有退场/回退），
 * 这里先把四个方向的时长/缓动/位移比例钉成数据，接线点见 E111 接线清单第 7 条。
 * ══════════════════════════════════════════════════════════════════════════════ */

/** `pageEase = CubicBezierEasing(.18f, 1f, .04f, 1f)`（PullOutHosts.kt L152）。 */
export const PAPER_PAGE_EASE = 'cubic-bezier(0.18, 1, 0.04, 1)';

/** 「被覆盖页只移动三分之一」—— `{ -it / 3 }` 里的 `1/3`。 */
export const PAPER_PAGE_COVERED_FRACTION = 1 / 3;

export type PaperPageDirection = 'enter' | 'exit' | 'popEnter' | 'popExit';

export interface PaperPageDirectionSpec {
  /** `tween(ms, pageEase)` 的时长。 */
  readonly ms: number;
  readonly easing: typeof PAPER_PAGE_EASE;
  /** 起始横向位移，按视口宽度取比例：`1` = 右边缘外，`-1/3` = 左侧三分之一，`0` = 原位。 */
  readonly fromFraction: number;
  /** 结束横向位移，同上。 */
  readonly toFraction: number;
}

/** 四个方向的位移量与时长（`reduce` 分支由调用方直接跳过动画，不在此表内）。 */
export function paperPageDirectionSpec(direction: PaperPageDirection): PaperPageDirectionSpec {
  switch (direction) {
    case 'enter':
      return { ms: 420, easing: PAPER_PAGE_EASE, fromFraction: 1, toFraction: 0 };
    case 'exit':
      return { ms: 420, easing: PAPER_PAGE_EASE, fromFraction: 0, toFraction: -PAPER_PAGE_COVERED_FRACTION };
    case 'popEnter':
      return { ms: 320, easing: PAPER_PAGE_EASE, fromFraction: -PAPER_PAGE_COVERED_FRACTION, toFraction: 0 };
    case 'popExit':
      return { ms: 320, easing: PAPER_PAGE_EASE, fromFraction: 0, toFraction: 1 };
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 9. `paperComposable(..., revealContent = true)` → `WenkuPageEntrance(transition)`
 *    （PullOutHosts.kt L177-188 / ui/wenku/WenkuPageEntrance.kt L18-44）
 * ══════════════════════════════════════════════════════════════════════════════ */

/**
 * `WenkuPageEntrance(route: Transition<EnterExitState>, content)` 的时钟规格：
 * - 只有**首次呈现**才播（`rememberSaveable presented` 的 `firstPresentation`）；
 * - 还要 `rememberWenkuAccessibility().decorativeMotion` **且** `LocalWenkuDecorativeMotion.current` 都为真；
 * - 驱动源是路由自己的 `PreEnter → Visible`（`animateFloat(tween(WenkuMotion.ENTER_MS, LinearEasing))`，
 *   `WenkuMotion.ENTER_MS = WenkuTokens.kt:123 = 420`），其余相位 `snap()`；
 * - 进度交给 `WenkuContentClock(progress, content)`，页面用 `Modifier.wenkuPagePart(order)`
 *   （= `wenkuReveal(order)`）错峰浮现。
 *
 * iOS 现状：`src/ui/shared/paperRouteHost.ts:14` 的 `mountLibraryPaperRoute` 只覆盖了
 * 「首次呈现 vs 复访」这一半（`presented` 集合 ↔ `rememberSaveable presented`），
 * **没有**内容时钟、没有 `wenkuReveal(order)` 错峰、没有 `decorativeMotion` 闸门；
 * `core/wenku/flight.ts:837` 导出的 `WENKU_ENTER_MS` 目前零消费方。
 */
export interface PaperPageRevealSpec {
  readonly durationMs: number;
  readonly easing: 'linear';
  readonly firstPresentationOnly: true;
  readonly requiresDecorativeMotion: true;
}

/** `WenkuMotion.ENTER_MS = 420`（`WenkuTokens.kt:123`）+ `LinearEasing`。 */
export function paperPageRevealSpec(): PaperPageRevealSpec {
  return {
    durationMs: 420,
    easing: 'linear',
    firstPresentationOnly: true,
    requiresDecorativeMotion: true,
  };
}