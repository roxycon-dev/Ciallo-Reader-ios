/**
 * Port of Android `god/GodPull.kt` (line by line) — **纯逻辑部分**。
 *
 * Kotlin 行号映射（`novel-reader/app/src/main/java/com/example/god/GodPull.kt`，378 行 / 348 非空）：
 *   - 51      `enum class GodPullEdge { LEFT, RIGHT, TOP, BOTTOM }` → `GodPullEdge`
 *   - 63-67   `class GodPullState(scope, spanPx)` 字段声明          → `GodPullMachine`
 *   - 69      `val offset = Animatable(0f)`                        → `GodPullMachine.offset`（数字）
 *   - 72      `var armed by mutableStateOf(false)`                  → `GodPullMachine.armed`
 *   - 76      `var thresholdPx: Float = 1f`                        → `GodPullMachine.thresholdPx`
 *   - 79/82   `internal var onArm / onTrigger`                     → `GodPullMachine.onArm/onTrigger`
 *   - 84      `private var raw: Float = 0f`                        → `GodPullMachine.raw`
 *   - 87      `val progress`                                       → `godPullProgress()`
 *   - 89-94   `private fun damp(rawPx)`                           → `godPullDamp()`
 *   - 97-105  `fun setRaw(rawPx)`                                 → `GodPullMachine.setRaw()`
 *   - 107     `fun addRaw(deltaPx)`                               → `GodPullMachine.addRaw()`
 *   - 110-116 `fun release(onTriggered)`                          → `GodPullMachine.release()`
 *   - 119-123 `fun reset()`                                       → `GodPullMachine.reset()`
 *   - 87      `thresholdPx <= 0f -> 0f`                           → `godPullProgress()`
 *   - 329-366 `fun godPullConnection(...)` 三个回调                → `godPullPreScroll()` /
 *                                                                  `godPullPostScroll()` /
 *                                                                  `godPullPostFling()`
 *   - 383-389 `private fun GodPullState.dampedToRaw(damped)`       → `godPullDampedToRaw()`
 *   - 392     `fun isAtEnd(current, count)`                       → `isAtEnd()`
 *   - 395     `fun godAbs(f)`                                     → `godAbs()`
 *   - 76/78   `GodMotion.PULL_THRESHOLD_DP` / `PULL_DAMPING`      → 本文件常量（GodMotion.kt L76-78）
 *
 * 跳过的 Kotlin 部分（全部在 UI 层，落在 `src/ui/components/god/GodPull.tsx`）：
 *   - 50-51   `GodPullEdge` 枚举本体 → 保留为同名 TS 联合类型（值与顺序一致）。
 *   - 126-163 `rememberGodPullState(...)`（含 `LocalDensity`/`SideEffect`/触觉）→ `useGodPullState()`，
 *             阈值换算与回调刷新在 React 层；触觉无 Web 等价（见下）。
 *   - 165-291 `GodPullOverlay`（Canvas 绘制）→ SVG ring + CSS 径向渐变，见 GodPull.tsx 头注。
 *   - 293-320 `GodHintCapsule`（Surface + animateFloatAsState）→ CSS 透明度过渡，见 GodPull.tsx。
 *   - 368-380 `Modifier.godPullScroll`（`nestedScroll` 挂载）→ 由宿主在滚动容器上装
 *             `onScroll`/`touchmove` 转发到 `GodPullMachine`，见 GodPull.tsx 导出的绑定 helper。
 *
 * 适配与跳过（原因）：
 *   - `Animatable` / `scope.launch` → 本文件只做**纯状态转移**（同步、可测）；
 *     弹簧动画在 React 层用 CSS cubic-bezier 表达（`GOD_SPRING_MAIN_CSS` 等），
 *     因为 `src/core` 禁止 import React / DOM。
 *   - `HapticsGate.enabled` + `view.performHapticFeedback(LONG_PRESS)`（L145-147）
 *     → **跳过**：Web 无此 API。`onArm` 回调仍保留（宿主可自行接 `navigator.vibrate`）。
 *   - `NestedScrollConnection`（L329-366）→ 拆成三个纯函数；`NestedScrollSource` /
 *     `Velocity` 参数在 TS 侧不参与判定（Kotlin 实现里也未使用），故签名只留数值。
 *   - `LocalConfiguration`（L151，`metrics.screenWidthDp/HeightDp`）→ 由 React 层
 *     用 `window.innerWidth/innerHeight` 换算后注入 `spanPx`。
 *
 * 本文件是 `src/core`，因此不 import React / DOM / Capacitor（eslint 强制）。
 */

/** 拉拽方向：决定光晕出现在哪条边。（GodPull.kt L51） */
export type GodPullEdge = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';

/** GodMotion.PULL_DAMPING = 0.55f —— 橡胶带阻尼系数（越大越费力）。（GodMotion.kt L78） */
export const GOD_PULL_DAMPING = 0.55;

/** GodMotion.PULL_THRESHOLD_DP = 96f —— 阻尼拉伸触发阈值（dp 等效）。（GodMotion.kt L76） */
export const GOD_PULL_THRESHOLD_DP = 96;

/**
 * GodPullState 的纯 TS 状态机。
 *
 * Kotlin 用 `Animatable` + `mutableStateOf` 让 `offset` 在 draw 阶段读取、
 * `armed` 触发重组（GodPull.kt L62-124）。这里把两者都变成普通字段：
 * `offset` 由调用方在每帧从 `snapTo` / `animateTo` 的当前值写回。
 */
export interface GodPullMachine {
  /** 阻尼基准长度（屏幕宽或高，px）— Kotlin `spanPx`（L66） */
  spanPx: number;
  /** 阻尼后的位移（px，≥0）— Kotlin `offset`（L69） */
  offset: number;
  /** 是否已过阈值（过阈瞬间触发一次强触觉）— Kotlin `armed`（L72） */
  armed: boolean;
  /** 触发阈值（px）— Kotlin `thresholdPx`（L76） */
  thresholdPx: number;
  /** 过阈回调（触觉）— Kotlin `onArm`（L79） */
  onArm: (() => void) | null;
  /** 触发回调（松手过阈时调用）— Kotlin `onTrigger`（L82） */
  onTrigger: (() => void) | null;
  /** 累计的原始越界量（px，≥0）— Kotlin `raw`（L84） */
  raw: number;
}

/** GodPullState 初始值（Kotlin `GodPullState(scope, 1f)`：spanPx = 1f，L143）。 */
export function createGodPullMachine(init?: { spanPx?: number }): GodPullMachine {
  return {
    spanPx: init?.spanPx ?? 1,
    offset: 0,
    armed: false,
    // Kotlin `var thresholdPx: Float = 1f`（L76）—— 初值 1f，不是 96dp
    thresholdPx: 1,
    onArm: null,
    onTrigger: null,
    raw: 0,
  };
}

/** 0..1 进度（圆环用）— Kotlin `progress`（GodPull.kt L87）。 */
export function godPullProgress(offset: number, thresholdPx: number): number {
  if (thresholdPx <= 0) return 0;
  return Math.min(1, Math.max(0, offset / thresholdPx));
}

/**
 * 橡胶带阻尼 — Kotlin `private fun damp(rawPx)`（GodPull.kt L89-94）。
 *
 * iOS UIScrollView 公式 `d = (1 - 1/(raw·c/span + 1))·(span/c)`。
 */
export function godPullDamp(rawPx: number, spanPx: number): number {
  if (spanPx <= 0) return 0;
  const c = GOD_PULL_DAMPING;
  const maxY = spanPx / c;
  return (1 - 1 / (rawPx * c / spanPx + 1)) * maxY;
}

/**
 * 阻尼值 → 原始越界量（反向推导，用于 onPreScroll 回退）——
 * Kotlin `private fun GodPullState.dampedToRaw(damped)`（GodPull.kt L383-389）。
 */
export function godPullDampedToRaw(damped: number, spanPx: number): number {
  const c = GOD_PULL_DAMPING;
  if (spanPx <= 0) return 0;
  const ratio = Math.min(0.999, Math.max(0, damped / (spanPx / c)));
  return (1 / (1 - ratio) - 1) * spanPx / c;
}

/**
 * 设置累计的原始越界量（px，≥0）— Kotlin `fun setRaw(rawPx)`（GodPull.kt L97-105）。
 *
 * Kotlin L104 `scope.launch { offset.snapTo(d) }` 是协程里的瞬时跳转；
 * 这里同步写 `offset`，由调用方决定何时触发 CSS 过渡（snap = 不加过渡）。
 */
export function godPullSetRaw(
  state: GodPullMachine,
  rawPx: number,
  onDamped?: (damped: number) => void,
): void {
  const next = Math.max(0, rawPx);
  state.raw = next;
  const d = godPullDamp(next, state.spanPx);
  const nowArmed = d >= state.thresholdPx;
  if (nowArmed && !state.armed) state.onArm?.();
  state.armed = nowArmed;
  state.offset = d;
  onDamped?.(d);
}

/** `addRaw(deltaPx) = setRaw(raw + deltaPx)`（GodPull.kt L107）。 */
export function godPullAddRaw(
  state: GodPullMachine,
  deltaPx: number,
  onDamped?: (damped: number) => void,
): void {
  godPullSetRaw(state, state.raw + deltaPx, onDamped);
}

/**
 * 松手：过阈就触发；随后弹簧回正。传 null 时用 `onTrigger`。
 * Kotlin `fun release(onTriggered)`（GodPull.kt L110-116）。
 *
 * ⚠️ 与 Kotlin 同款陷阱（L334-336 注释）：`onTriggered` 传空 lambda 而非 null
 * 会被当成"宿主自己处理"，**永远打不开神回窗口**。
 */
export function godPullRelease(
  state: GodPullMachine,
  onTriggered?: (() => void) | null,
  onSettle?: () => void,
): void {
  const wasArmed = state.armed;
  state.armed = false;
  state.raw = 0;
  if (wasArmed) (onTriggered ?? state.onTrigger)?.();
  onSettle?.();
}

/** 直接归零（取消手势 / 页面切换）— Kotlin `fun reset()`（GodPull.kt L119-123）。 */
export function godPullReset(state: GodPullMachine, onSettle?: () => void): void {
  state.armed = false;
  state.raw = 0;
  onSettle?.();
}

/** 把 `offset` 直接归零（对应 `Animatable.animateTo(0f, springMain())` 的**结果**）。 */
export function godPullSettleOffset(state: GodPullMachine): void {
  state.offset = 0;
}

/* ══════════════ NestedScrollConnection 的三个回调（纯函数） ══════════════ */

/**
 * `onPreScroll` — Kotlin L341-350。
 *
 * 反向滚动先把拉拽收回，再交给列表。返回本次消费的 y 分量。
 */
export function godPullPreScroll(
  state: GodPullMachine,
  availableY: number,
  onDamped?: (damped: number) => void,
): number {
  const cur = state.offset;
  if (cur > 0.5 && availableY > 0) {
    const consume = Math.min(availableY, cur);
    // 反向消化：把已阻尼的位移按原路退回（近似用线性映射回 raw）
    godPullSetRaw(state, godPullDampedToRaw(cur - consume, state.spanPx), onDamped);
    return consume;
  }
  return 0;
}

/**
 * `onPostScroll` — Kotlin L352-360。
 *
 * 手指继续上拉（availableY < 0）且列表已到底 → 累计进拉拽。
 * 返回本次消费的 y 分量。
 */
export function godPullPostScroll(
  state: GodPullMachine,
  availableY: number,
  canPullForward: () => boolean,
  onDamped?: (damped: number) => void,
): number {
  if (!canPullForward()) return 0;
  if (availableY < 0) {
    godPullAddRaw(state, -availableY, onDamped);
    return availableY;
  }
  return 0;
}

/**
 * `onPostFling` — Kotlin L362-365。
 *
 * 惯性结束 → 判定触发 / 弹簧回弹。返回是否走了 release。
 */
export function godPullPostFling(
  state: GodPullMachine,
  onTriggered?: (() => void) | null,
  onSettle?: () => void,
): boolean {
  if (state.offset > 0) {
    godPullRelease(state, onTriggered, onSettle);
    return true;
  }
  return false;
}

/** 供阅读器判断"是否在末页"用的小工具（GodPull.kt L392）。 */
export function isAtEnd(current: number, count: number): boolean {
  return count > 0 && current >= count - 1;
}

/** 保留：绝对值工具（阅读器计算拉拽方向时避免符号错误）。（GodPull.kt L395） */
export function godAbs(f: number): number {
  return Math.abs(f);
}

/* ══════════════ Compose spring → CSS cubic-bezier 等价 ══════════════ */

/**
 * 四个弹簧的 dampingRatio / stiffness（GodMotion.kt L34/L37/L40/L43）、解析解、
 * 静止时间与 CSS 控制点都在 `@core/god/godEasing` —— 那里是唯一真值，本文件只做转出，
 * 以保持既有 import 路径（`GodPull.tsx` / `GodStarRatingEditable.tsx` / `GodCoverCropPage.tsx`）不变。
 *
 * - `GOD_SPRING_SPECS`：damping / stiffness / 时长 / 控制点
 * - `godSpringDisplacement(key, tMs)`：Compose `SpringSimulation.valueAtTime()` 的解析解
 * - `godSpringPeak(key)`：峰值过冲量与到达时刻
 * - `godSpringRestTimeMs(key)`：按 Compose 静止判据求动画时长
 * - `godCubicBezierAt(cp, x)`：CSS cubic-bezier 求值（与浏览器同解法）
 *
 * 固定时长的 CSS 等价：
 * - main   380ms（damping 0.72 / stiffness 380，欠阻尼，末端越过目标值再回落）
 * - light  260ms（0.85 / 520，接近临界阻尼）
 * - soft   460ms（0.90 / 220，过冲最弱）
 * - bouncy 420ms（0.55 / 260，明显回弹）
 */
export {
  GOD_SPRING_SPECS,
  GOD_SPRING_MAIN_CSS,
  GOD_SPRING_LIGHT_CSS,
  GOD_SPRING_SOFT_CSS,
  GOD_SPRING_BOUNCY_CSS,
  godCubicBezierAt,
  godSpringDisplacement,
  godSpringPeak,
  godSpringRestTimeMs,
  godSpringVelocity,
  type GodSpringKey,
} from './godEasing';
