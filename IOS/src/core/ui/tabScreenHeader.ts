/**
 * 折叠头部的判定状态机 —— `ui/components/TabScreenHeader.kt` L45-130 的移植。
 *
 * 这个文件解决的是「滚动时头部什么时候收起」：
 *   · `rememberHeaderCollapsed`（L70-95）—— **单阈值 20dp**：`index > 0 || offset > 20dp`；
 *   · `rememberHeaderCollapsedSource`（L106-130）—— **双阈值迟滞**：`closeAt 32dp / openAt 8dp`，
 *     手指在边界附近来回时不会反复收起展开（Kotlin L45 的注释：「Separate thresholds prevent
 *     repeated collapse/expand when a finger hovers near the boundary.」）。
 *
 * 此前 iOS 侧只有 `TabScreenHeader.tsx` 的**折叠视觉**（6/10、7/12、19/24、220ms），
 * `core/ui/parityMisc.ts` 里的 `HeaderCollapseGate` 只是 `{ collapsed: boolean }` 的**接口占位** ——
 * 判定逻辑（含迟滞）根本没落。本文件把状态机补齐。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L46-52 `class HeaderCollapseGate(closeAt, openAt) { fun update(index, offset, forced): Boolean }`
 *                                                                  → `HeaderCollapseGate`
 *   L72/81/90 `val thresholdPx = with(LocalDensity.current) { 20.dp.toPx() }`
 *                                                                  → `HEADER_COLLAPSE_THRESHOLD_DP`
 *   L74 `derivedStateOf { index > 0 || offset > thresholdPx }`
 *                                                                  → `headerCollapsed()`
 *   L109 `HeaderCollapseGate(32.dp.toPx(), 8.dp.toPx())`             → `HEADER_GATE_CLOSE_DP` / `HEADER_GATE_OPEN_DP`
 *   L111 `{ gate.update(index, offset, force()) }`                   → `createHeaderCollapsedSource()`
 */

/** Kotlin `L72` 的 `20.dp`。 */
export const HEADER_COLLAPSE_THRESHOLD_DP = 20;

/** Kotlin `L109` 的 `closeAt = 32.dp` —— 超过它才收起。 */
export const HEADER_GATE_CLOSE_DP = 32;

/** Kotlin `L109` 的 `openAt = 8.dp` —— 回到它以下才展开（迟滞带 8~32dp）。 */
export const HEADER_GATE_OPEN_DP = 8;

/**
 * Kotlin `L46-52`：
 * ```kotlin
 * internal class HeaderCollapseGate(private val closeAt: Float, private val openAt: Float) {
 *     private var collapsed = false
 *     fun update(index: Int, offset: Int, forced: Boolean): Boolean {
 *         collapsed = if (forced || index > 0) true else if (collapsed) offset > openAt else offset > closeAt
 *         return collapsed
 *     }
 * }
 * ```
 *
 * 三个分支的顺序**不能换**：
 *   ① `forced || index > 0` —— 强制收起，或已经滚过首项（哪怕 offset 归零也保持收起）；
 *   ② 已收起 → 用**更小**的 `openAt` 判断是否展开（迟滞：8dp 以上仍算收起）；
 *   ③ 未收起 → 用**更大**的 `closeAt` 判断是否收起。
 */
export class HeaderCollapseGate {
  private collapsedState = false;

  constructor(
    readonly closeAtPx: number,
    readonly openAtPx: number,
  ) {}

  get collapsed(): boolean {
    return this.collapsedState;
  }

  update(index: number, offset: number, forced: boolean): boolean {
    this.collapsedState = forced || index > 0 ? true : this.collapsedState ? offset > this.openAtPx : offset > this.closeAtPx;
    return this.collapsedState;
  }
}

/** Kotlin `L74`：`index > 0 || offset > thresholdPx`（单阈值版本，无迟滞）。 */
export function headerCollapsed(index: number, offset: number, thresholdPx: number): boolean {
  return index > 0 || offset > thresholdPx;
}

/**
 * Kotlin `L106-112` `rememberHeaderCollapsedSource(...)` 的返回函数：
 * 把 `state.firstVisibleItemIndex` / `firstVisibleItemScrollOffset` 喂给同一个 gate 实例，
 * `forced` 每次求值时现取（Kotlin 用 `rememberUpdatedState`）。
 */
export function createHeaderCollapsedSource(input: {
  readonly density: number;
  readonly force: () => boolean;
  readonly readIndex: () => number;
  readonly readOffset: () => number;
}): () => boolean {
  const gate = new HeaderCollapseGate(
    HEADER_GATE_CLOSE_DP * input.density,
    HEADER_GATE_OPEN_DP * input.density,
  );
  return () => gate.update(input.readIndex(), input.readOffset(), input.force());
}
