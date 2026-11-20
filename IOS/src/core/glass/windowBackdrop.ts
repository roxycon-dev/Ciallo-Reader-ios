/**
 * 窗口级毛玻璃 —— `ui/components/WindowBackdrop.kt` L21-118 的数学层。
 *
 * Kotlin 用 `RenderEffect.createBlurEffect` 给整个 Activity 的 decorView 施加一次模糊，
 * 并按「纸张时钟」的进度同时缩放模糊半径与窗口 dim。Web 侧等价物是
 * `backdrop-filter` + 覆盖层 `opacity`，但**量化规则与 dim 数值必须一致**，否则
 * 弹窗开合时的观感会与 Android 分叉。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L21 `BLUR_STEPS_PER_PIXEL = 2f`                            → 同名
 *   L22 `BLUR_CACHE_CAPACITY = 128`                            → 同名
 *   L23 `WINDOW_DIM_STEPS = 64f`                               → 同名
 *   L24 `GLASS_WINDOW_DIM = .12f`                              → 同名
 *   L25 `FALLBACK_WINDOW_DIM = .42f`                           → 同名
 *   L31-63 `GlassDialogWindowEffect(activity, blurRadiusPx)`：
 *          `supportsRealtimeBlur` 决定 dim 上限（.12 / .42）；
 *          `dim = maximumDim * (progress * 64).roundToInt() / 64`，只在变化时下发
 *                                                              → `windowEffectProgress`
 *   L68-80 `object GlassWindowBlur`：每个 View 一个 Host，按 owner 记 radiusStep，
 *          `radius = appliedStep / BLUR_STEPS_PER_PIXEL`        → `blurStepFor` / `blurRadiusForStep`
 *
 * 平台差异（已登记 E133）：`WeakHashMap<View, Host>` + `RenderEffect` → CSS 变量
 * （`--window-blur-px` / `--window-dim`）；取值与量化逐位一致，接线在
 * `src/ui/components/WindowBackdrop.tsx`。
 */

/** L21 每像素的模糊档数（整数档位避免每帧替换装箱 Float）。 */
export const BLUR_STEPS_PER_PIXEL = 2;
/** L22 模糊效果 LRU 容量。 */
export const BLUR_CACHE_CAPACITY = 128;
/** L23 窗口 dim 的量化档数。 */
export const WINDOW_DIM_STEPS = 64;
/** L24 支持实时模糊时的 dim 上限。 */
export const GLASS_WINDOW_DIM = 0.12;
/** L25 不支持实时模糊时的 dim 上限。 */
export const FALLBACK_WINDOW_DIM = 0.42;

/** `paperBackdropProgress(progress)`（`PullOutMotion.kt` 的端点平滑）在本模块的投影。 */
export function paperBackdropProgress(progress: number): number {
  const t = Math.min(Math.max(progress, 0), 1);
  return t * t * (3 - 2 * t);
}

export interface WindowEffectState {
  /** 写给窗口的模糊半径（px，已量化到 1/BLUR_STEPS_PER_PIXEL）。 */
  readonly blurRadiusPx: number;
  /** 写给窗口的 dim（已量化到 1/64）。 */
  readonly dim: number;
  /** 是否发生了可见变化（Kotlin 只在 `dim != previousDim` 时下发）。 */
  readonly dimChanged: boolean;
}

/**
 * L49-62 `LaunchedEffect(...) { collect { progress -> … } }` 的单帧计算。
 *
 * @param progress `paperBackdropProgress(lifecycle.progress)` 的当前值
 * @param blurRadiusPx `blurRadiusPx * progress` 的基数
 * @param supportsRealtimeBlur 是否有 `RenderEffect`（Web 侧 = `backdrop-filter` 可用）
 * @param previousDim 上一帧下发的 dim（首帧传 -1）
 */
export function windowEffectProgress(
  progress: number,
  blurRadiusPx: number,
  supportsRealtimeBlur: boolean,
  previousDim = -1,
): WindowEffectState {
  const p = paperBackdropProgress(progress);
  // L53 `GlassWindowBlur.acquire(background, owner, blurRadiusPx * progress)`
  const radius = Math.round(blurRadiusPx * p * BLUR_STEPS_PER_PIXEL) / BLUR_STEPS_PER_PIXEL;
  const maximumDim = supportsRealtimeBlur ? GLASS_WINDOW_DIM : FALLBACK_WINDOW_DIM;
  // L56 `maximumDim * (progress * WINDOW_DIM_STEPS).roundToInt() / WINDOW_DIM_STEPS`
  const dim = (maximumDim * Math.round(p * WINDOW_DIM_STEPS)) / WINDOW_DIM_STEPS;
  return { blurRadiusPx: radius, dim, dimChanged: dim !== previousDim };
}

/** `Float.roundToInt()` 的等价（Kotlin 对 .5 取偶方向无关，这里按四舍五入）。 */
export function roundToInt(value: number): number {
  return Math.round(value);
}

/** L80 `radius = appliedStep / BLUR_STEPS_PER_PIXEL`。 */
export function blurRadiusForStep(appliedStep: number): number {
  return appliedStep / BLUR_STEPS_PER_PIXEL;
}

/** `GlassWindowBlur.acquire(view, owner, radius)` 的档位换算（半径 → 整数档）。 */
export function blurStepFor(radiusPx: number): number {
  return Math.round(radiusPx * BLUR_STEPS_PER_PIXEL);
}

/**
 * L65-118 `object GlassWindowBlur` 的 Web 形态：
 * 「每个宿主只保留一次模糊；子级淡出不会抹掉父级的模糊」。
 * 同一 `hostId` 上多个 owner 的档位取最大（任一 owner 需要更强模糊即取更强）。
 */
export class GlassWindowBlur {
  private readonly owners = new Map<string, number>();

  /** `acquire(view, owner, radius)`。 */
  acquire(hostId: string, ownerId: string, radiusPx: number): void {
    this.owners.set(`${hostId}::${ownerId}`, blurStepFor(radiusPx));
  }

  /** `release(view, owner)`。 */
  release(hostId: string, ownerId: string): void {
    this.owners.delete(`${hostId}::${ownerId}`);
  }

  /** L79 `radius(view)`：该宿主当前的生效半径。 */
  radius(hostId: string): number {
    let step = 0;
    const prefix = `${hostId}::`;
    for (const [key, value] of this.owners) {
      if (key.startsWith(prefix) && value > step) step = value;
    }
    return blurRadiusForStep(step);
  }

  /** 有多少个宿主正在使用模糊（调试/测试用）。 */
  get hostCount(): number {
    const hosts = new Set<string>();
    for (const key of this.owners.keys()) hosts.add(key.split('::')[0] ?? key);
    return hosts.size;
  }
}
