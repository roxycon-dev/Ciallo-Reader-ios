/**
 * 底部 Dock 的状态与几何 —— `ui/components/AppBottomTabBar.kt` L90-130 / L377-541 的移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L90-98 `data class AppTabItem(label, icon, selectedIcon = icon, badgeCount = null,
 *          wenkuSymbol = null, wenkuSelectedSymbol = wenkuSymbol)`   → `AppTabItem`
 *   L100-114 `class TabBarCollapseState`：`onPreScroll` 里 `available.y < -4f → collapsed = true`、
 *          `> 4f → false`，返回 `Offset.Zero`（不吃滚动）           → `TabBarCollapseState`
 *   L116-117 `rememberTabBarCollapseState()`                         → `useTabBarCollapseState`（原名出口）
 *   L119-131 的 Dock 交互参数（跟手 80%、形变 `speed*.028` clamp ±24、lerp .55、100ms 归零、
 *          投射 `velocity*.055` clamp ±.22、胶囊 `translate(flow*.16, -pressure*.6)`、
 *          `scaleX = 1 + p*.022 + |flow|*.00125`、玻璃厚度 `16 + pressure*2`）
 *                                                                    → `DOCK_MOTION`
 *   L377 `internal val AppRailWidth = 96.dp`                          → 同名
 *   L381-414 `AppNavigationRail(items, selectedIndex, onTabSelected)`：宽窗用同一套动画字形；
 *          `position = animateDpAsState(56.dp * selectedIndex, WenkuMotion.spring())`、
 *          玻璃面 `RoundedCornerShape(28.dp)`、内边距 6dp、指示块 56dp 高 + 20dp 圆角 +
 *          `ink@.09`                                                 → `railMetrics`
 *   L416-539 `DockTab(item, selected, labelFraction, ink, onClick)`：
 *          `iconScale = if (selected) 1.10f else 1f` 走 `WenkuMotion.spring()` → `dockTabMetrics`
 *   L541 `Float.roundToIntCompat() = round(this).toInt()`              → 同名
 */

export interface AppTabItem {
  readonly label: string;
  /** Kotlin `icon: ImageVector` → Web 侧是 `WenkuSymbol` 或图标名。 */
  readonly icon: string;
  /** `selectedIcon: ImageVector = icon`。 */
  readonly selectedIcon: string;
  /** `badgeCount: Int? = null`。 */
  readonly badgeCount: number | null;
  /** `wenkuSymbol: WenkuSymbol? = null`。 */
  readonly wenkuSymbol: string | null;
  /** `wenkuSelectedSymbol: WenkuSymbol? = wenkuSymbol`。 */
  readonly wenkuSelectedSymbol: string | null;
}

/** L90-98 的默认值填充（`selectedIcon = icon`、`wenkuSelectedSymbol = wenkuSymbol`）。 */
export function appTabItem(input: {
  readonly label: string;
  readonly icon: string;
  readonly selectedIcon?: string;
  readonly badgeCount?: number | null;
  readonly wenkuSymbol?: string | null;
  readonly wenkuSelectedSymbol?: string | null;
}): AppTabItem {
  return {
    label: input.label,
    icon: input.icon,
    selectedIcon: input.selectedIcon ?? input.icon,
    badgeCount: input.badgeCount ?? null,
    wenkuSymbol: input.wenkuSymbol ?? null,
    wenkuSelectedSymbol: input.wenkuSelectedSymbol ?? input.wenkuSymbol ?? null,
  };
}

/** L108-110 的折叠阈值（±4f 像素）。 */
export const TAB_BAR_COLLAPSE_THRESHOLD_PX = 4;

/** L100-114 `class TabBarCollapseState`。 */
export class TabBarCollapseState {
  private collapsedState = false;
  private readonly listeners = new Set<() => void>();

  get collapsed(): boolean {
    return this.collapsedState;
  }

  /**
   * L104-113 `connection().onPreScroll(available, source)`：
   * 只更新折叠态，**不消费**滚动（返回 `Offset.Zero`）。
   */
  onPreScroll(availableY: number): void {
    if (availableY < -TAB_BAR_COLLAPSE_THRESHOLD_PX) this.set(true);
    if (availableY > TAB_BAR_COLLAPSE_THRESHOLD_PX) this.set(false);
  }

  private set(next: boolean): void {
    if (this.collapsedState === next) return;
    this.collapsedState = next;
    for (const l of this.listeners) l();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** L116-117 `rememberTabBarCollapseState()`。 */
export function useTabBarCollapseState(): TabBarCollapseState {
  return new TabBarCollapseState();
}

/** Kotlin 原名出口。 */
export const rememberTabBarCollapseState = useTabBarCollapseState;

/** L119-131 的 Dock 交互常量。 */
export const DOCK_MOTION = {
  /** 按下立即响应（120ms，`WenkuMotion.contactSpec()`）。 */
  contactMs: 120,
  /** 跟手比例。 */
  follow: 0.8,
  /** 形变系数。 */
  stretchFactor: 0.028,
  /** 形变上限（px）。 */
  stretchLimit: 24,
  /** 形变回正的 lerp 系数。 */
  stretchLerp: 0.55,
  /** 无输入多久回 0（ms）。 */
  idleMs: 100,
  /** 松手投射系数。 */
  project: 0.055,
  /** 投射上限（比例）。 */
  projectLimit: 0.22,
  /** 胶囊横向位移系数。 */
  capsuleX: 0.16,
  /** 胶囊纵向位移系数（乘 pressure）。 */
  capsuleY: 0.6,
  /** 胶囊缩放基准。 */
  capsuleScaleBase: 0.022,
  /** 胶囊缩放对 |flow| 的系数。 */
  capsuleScaleFlow: 0.00125,
  /** 玻璃厚度基准（dp）。 */
  glassThicknessDp: 16,
  /** 玻璃厚度对 pressure 的系数。 */
  glassThicknessPressure: 2,
} as const;

/** L377 `AppRailWidth = 96.dp`。 */
export const AppRailWidth = 96;

/** L381-414 `AppNavigationRail` 的几何。 */
export const railMetrics = {
  /** `targetValue = 56.dp * selectedIndex`。 */
  stepPx: 56,
  /** 玻璃面圆角 28dp、左右各 10dp、上下各 8dp、内容内边距 6dp。 */
  radiusPx: 28,
  paddingHeaderPx: 10,
  paddingVerticalPx: 8,
  contentPaddingPx: 6,
  /** 指示块：56dp 高 + 20dp 圆角 + `ink@.09`。 */
  indicatorHeightPx: 56,
  indicatorRadiusPx: 20,
  indicatorAlpha: 0.09,
  /** `testTag("app_tab_rail")`。 */
  testTag: 'app_tab_rail',
} as const;

/** L416-539 `DockTab` 的几何。 */
export const dockTabMetrics = {
  /** `iconScale = if (selected) 1.10f else 1f`。 */
  selectedIconScale: 1.1,
  /** `labelFraction` 的开合区间（1 = 完全展开）。 */
  labelFullFraction: 1,
} as const;

/** L541 `Float.roundToIntCompat() = kotlin.math.round(this).toInt()`。 */
export function roundToIntCompat(value: number): number {
  return Math.round(value);
}

/** Dock 当前帧的形变量（`speed * .028` clamp ±24、lerp .55）。 */
export function dockStretch(previous: number, speed: number): number {
  const raw = Math.min(Math.max(speed * DOCK_MOTION.stretchFactor, -DOCK_MOTION.stretchLimit), DOCK_MOTION.stretchLimit);
  return previous + (raw - previous) * DOCK_MOTION.stretchLerp;
}

/** 胶囊的当前变换（`translate(flow*.16, -pressure*.6)` + `scaleX = 1 + p*.022 + |flow|*.00125`）。 */
export function dockCapsuleTransform(flow: number, pressure: number): {
  readonly translateX: number;
  readonly translateY: number;
  readonly scaleX: number;
  readonly glassThicknessDp: number;
} {
  return {
    translateX: flow * DOCK_MOTION.capsuleX,
    translateY: -pressure * DOCK_MOTION.capsuleY,
    scaleX: 1 + pressure * DOCK_MOTION.capsuleScaleBase + Math.abs(flow) * DOCK_MOTION.capsuleScaleFlow,
    glassThicknessDp: DOCK_MOTION.glassThicknessDp + pressure * DOCK_MOTION.glassThicknessPressure,
  };
}

/** 松手后的投射速度（`velocity * .055` clamp ±.22）。 */
export function dockProjection(velocity: number): number {
  return Math.min(Math.max(velocity * DOCK_MOTION.project, -DOCK_MOTION.projectLimit), DOCK_MOTION.projectLimit);
}
