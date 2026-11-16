/**
 * comicScrollMetrics.ts — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicScrollMetrics.kt`（46 行 / 非空 40 行）。
 *
 * 纯逻辑模块（无 Compose 依赖）→ 放在 `src/core`，可被单测直接引用。
 *
 * Kotlin 行号 → TS 对照：
 *   L1        package/import（仅 kotlin.math.roundToLong）→ 略
 *   L5        KDoc「列表实测高度对应的滚动范围」→ 保留在类上方
 *   L6-L14    data class ComicScrollMetrics 7 个构造参数 → 同名接口 + 构造函数
 *   L15-L16   private val starts: LongArray / scrollRange: Long（由 init 计算）
 *             → private 字段，在构造函数体内按同一顺序计算
 *   L18-L26   init { 逐项累加 starts，间隔只加到非末项；scrollRange = height - viewport 钳 0 }
 *             → 逐行移植
 *   L28-L34   val fraction: Float get() = when { … } → `get fraction()`
 *   L36       KDoc「滑条落点反算到项内像素偏移」→ 保留在 target() 上方
 *   L37-L43   fun target(fraction: Float): ComicScrollTarget → 逐行移植
 *   L46       internal data class ComicScrollTarget(val index: Int, val offset: Int)
 *             → 同名接口（构造走对象字面量）
 *
 * 跳过说明：
 *   · 无。所有 Kotlin 逻辑均已移植。`internal` 可见性在 TS 中不存在（导出即可）。
 *
 * 适配说明：
 *   · Kotlin `Int`/`Long` → `number`（本模块跨度远小于 2^53，与 64 位整数结果一致）。
 *   · `coerceAtLeast(x)` → `Math.max(v, x)`；`coerceAtMost(x)` → `Math.min(v, x)`。
 *   · `coerceIn(0, n)` → `Math.min(Math.max(v, 0), n)`。
 *   · `LongArray` → `number[]`；`starts.indexOfLast { it <= pixel }` → 反向 for 循环。
 *   · `roundToLong()` → `Math.round()`（Kotlin roundToLong 向远离零取整，与 Math.round 一致）。
 *   · `itemSizes.indices` → `0 .. itemSizes.length - 1`（闭区间钳制写成 clamp 表达式）。
 */

/** 列表实测高度对应的滚动范围；尚未进入视口的图片由调用方估算高度。 */
export interface ComicScrollTarget {
  readonly index: number
  readonly offset: number
}

export class ComicScrollMetrics {
  private readonly starts: number[]
  private readonly scrollRange: number

  constructor(
    readonly itemSizes: readonly number[],
    readonly itemSpacing: number,
    readonly viewportSize: number,
    readonly firstVisibleItemIndex: number,
    readonly firstVisibleItemScrollOffset: number,
    readonly canScrollBackward: boolean,
    readonly canScrollForward: boolean,
  ) {
    // ── Kotlin L15-L26：init 块，逐行移植 ──
    this.starts = new Array<number>(itemSizes.length).fill(0)
    let height = 0
    for (let index = 0; index < itemSizes.length; index++) {
      this.starts[index] = height
      height += Math.max(itemSizes[index] as number, 1)
      if (index < itemSizes.length - 1) height += Math.max(itemSpacing, 0)
    }
    this.scrollRange = Math.max(height - Math.max(viewportSize, 0), 0)
  }

  /** ── Kotlin L28-L34：`val fraction: Float get() = when { … }` ── */
  get fraction(): number {
    const empty = this.itemSizes.length === 0 || !this.canScrollBackward
    const atEnd = !this.canScrollForward
    if (empty) return 0
    if (atEnd) return 1
    if (this.scrollRange === 0) return 0
    const idx = Math.min(Math.max(this.firstVisibleItemIndex, 0), this.itemSizes.length - 1)
    const numerator =
      (this.starts[idx] as number) + Math.max(this.firstVisibleItemScrollOffset, 0)
    const raw = numerator / this.scrollRange
    return Math.min(Math.max(raw, 0), 1)
  }

  /** 滑条落点反算到项内像素偏移，长图和末图都能精确定位。 */
  target(fraction: number): ComicScrollTarget {
    // ── Kotlin L38-L43 ──
    if (this.itemSizes.length === 0) return { index: 0, offset: 0 }
    const safeFraction = Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0
    const pixel = Math.round(safeFraction * this.scrollRange)
    // `starts.indexOfLast { it <= pixel }.coerceAtLeast(0)`
    let index = 0
    for (let i = this.starts.length - 1; i >= 0; i--) {
      if ((this.starts[i] as number) <= pixel) {
        index = i
        break
      }
    }
    // `coerceAtMost(Int.MAX_VALUE.toLong()).toInt()` → 先钳到 2^31-1（与 Kotlin 逐字一致）
    const offset = Math.min(pixel - (this.starts[index] as number), 2147483647)
    return { index, offset }
  }
}
