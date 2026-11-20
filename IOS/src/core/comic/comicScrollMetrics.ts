/**
 * comicScrollMetrics.ts — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicScrollMetrics.kt`（**90 行 / 79 非空**）。
 *
 * ⚠️ 本文件此前自述「46 行 / 非空 40 行」并据此写成：只有 `ComicScrollMetrics` 一个类，
 * `starts` / `scrollRange` 内联成私有字段，`pageFraction(next)` 整个缺失，
 * `ComicScrollGeometry` 与 `ComicScrollGeometryCache` 两个类型从未存在
 * （`parityMisc.ts` 里挂着一对**同名但不同物**的 `(width, height, pages)` 缓存）。
 * 2026-11-17 按当前 90 行重写（`docs/PARITY_EXCEPTIONS.md` E198）。
 *
 * Kotlin 行号 → TS 对照
 * ─────────────────────
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `data class ComicScrollMetrics` 的五个属性 | L6-12 | `ComicScrollMetrics` 的五个只读属性 |
 * | 次构造函数 `(itemSizes, itemSpacing, viewportSize, …)` | L13-18 | 第二个 TS 重载（7 参形态） |
 * | `val itemSizes/itemSpacing/viewportSize get()` | L20-22 | getter，转发给 `geometry` |
 * | `private val starts/scrollRange get()` | L23-24 | 转发给 `geometry` |
 * | `val fraction: Float get() = when { … }` | L27-33 | `get fraction()` |
 * | `fun pageFraction(next: Boolean): Float` | L36-40 | `pageFraction(next)` |
 * | `fun target(fraction: Float): ComicScrollTarget` | L43-55 | `target(fraction)` |
 * | `data class ComicScrollGeometry` + `init` | L59-71 | `ComicScrollGeometry` |
 * | `class ComicScrollGeometryCache` | L73-88 | `ComicScrollGeometryCache` |
 * | `data class ComicScrollTarget` | L90 | `ComicScrollTarget` |
 *
 * 三处只有读原文才会发现的语义
 * ─────────────────────────────
 * 1. **`pageFraction` 是「一屏 0.9」而不是「一项」**。L38
 *    `val step = viewportSize.coerceAtLeast(1) * .90 / scrollRange` —— 自定义滑动翻页
 *    每次推进 **0.9 个视口**，所以一张特别高的长图也能在一次滑动内前进，
 *    而不是被「按项翻页」卡住。缺了它，垂直滚动漫画的 swipe 只能走浏览器原生滚动。
 * 2. **`target` 用二分查最后一个 `starts[i] <= pixel`**（L47-53 的 `(low + high + 1) ushr 1`）。
 *    等价于 `indexOfLast`，但决定了「一张图的内部偏移」能否被精确定位 ——
 *    线性反向扫也行，前提是**取最后一个**而不是第一个。
 * 3. **缓存的失效条件只有 `dirty` + 三个字段**（L82）。`record` 只在**尺寸变了**才置
 *    `dirty`（L79 `if (heights[index] != size)`），所以同一批高度重复测量不会让缓存失效；
 *    而 `heights` 里留着上本书的下标（`record` 从不清理），它们**参与 `average()`
 *    但不会被读进 `itemSizes`**（L83-84 只取 `0 until count`）。
 *
 * 适配说明
 * ────────
 * - `Int` / `Long` → `number`（本模块跨度远小于 2^53，与 64 位整数结果一致）。
 * - `coerceAtLeast` / `coerceAtMost` / `coerceIn` → `Math.max` / `Math.min` / 组合。
 * - `roundToLong()` → `Math.round()`：两者只在**负数**上不同（Kotlin 向远离零、JS 向 +∞），
 *   而 `safeFraction ∈ [0, 1]` 且 `scrollRange >= 0`，`pixel` 恒非负。
 * - `(low + high + 1) ushr 1` → `(low + high + 1) >>> 1`（非负整数，两者相等）。
 * - `heights.values.average().toInt()`：Kotlin 对空集返回 `NaN`、`NaN.toInt() == 0`、
 *   再 `coerceAtLeast(1) == 1`；这里显式写出这三步。
 * - `HashMap<Int, Int>` → `Map<number, number>`（插入序无关，`average` 与下标读取都不看序）。
 */

/** 滑条落点反算到项内像素偏移，长图和末图都能精确定位。 — Kotlin L90 */
export interface ComicScrollTarget {
  readonly index: number
  readonly offset: number
}

/**
 * 列表实测高度对应的滚动范围 — Kotlin L58-71。
 *
 * 「Geometry changes on measurement/viewport updates, not on every scroll pixel.」
 * 所以它是独立对象：一旦高度与视口定下来，滚动多少像素都不需要重算。
 */
export class ComicScrollGeometry {
  /** L60 `val starts = LongArray(itemSizes.size)` —— 每一项的起始像素。 */
  readonly starts: readonly number[]

  /** L61 / L69 `scrollRange = (height - viewportSize.coerceAtLeast(0)).coerceAtLeast(0)`。 */
  readonly scrollRange: number

  constructor(
    readonly itemSizes: readonly number[],
    readonly itemSpacing: number,
    readonly viewportSize: number,
  ) {
    const starts = new Array<number>(itemSizes.length).fill(0)
    let height = 0
    for (let index = 0; index < itemSizes.length; index += 1) {
      starts[index] = height
      // L66 `height += size.coerceAtLeast(1)`
      height += Math.max(itemSizes[index] as number, 1)
      // L67 `if (index < itemSizes.lastIndex) height += itemSpacing.coerceAtLeast(0)`
      if (index < itemSizes.length - 1) height += Math.max(itemSpacing, 0)
    }
    this.starts = starts
    this.scrollRange = Math.max(height - Math.max(viewportSize, 0), 0)
  }
}

/**
 * 列表实测高度对应的滚动范围；尚未进入视口的图片由调用方估算高度。 — Kotlin L5-56
 *
 * 注意 Kotlin 的**主**构造函数吃一个 `ComicScrollGeometry`（L6-12），次构造函数
 * （L13-18）才吃 `(itemSizes, itemSpacing, viewportSize)`。两个形态都保留：
 * 老调用点（7 参）不用改，新调用点可以直接复用算好的 geometry。
 */
export class ComicScrollMetrics {
  /** L7 `val geometry: ComicScrollGeometry` —— Kotlin 主构造的第一个参数。 */
  readonly geometry: ComicScrollGeometry

  readonly firstVisibleItemIndex: number
  readonly firstVisibleItemScrollOffset: number
  readonly canScrollBackward: boolean
  readonly canScrollForward: boolean

  /** Kotlin 主构造：`ComicScrollMetrics(geometry, …)`。 */
  constructor(
    geometry: ComicScrollGeometry,
    firstVisibleItemIndex: number,
    firstVisibleItemScrollOffset: number,
    canScrollBackward: boolean,
    canScrollForward: boolean,
  )
  /** Kotlin 次构造 L13-18：`ComicScrollMetrics(itemSizes, itemSpacing, viewportSize, …)`。 */
  constructor(
    itemSizes: readonly number[],
    itemSpacing: number,
    viewportSize: number,
    firstVisibleItemIndex: number,
    firstVisibleItemScrollOffset: number,
    canScrollBackward: boolean,
    canScrollForward: boolean,
  )
  constructor(
    a: ComicScrollGeometry | readonly number[],
    b: number,
    c: number,
    d: number | boolean,
    e: number | boolean,
    f?: boolean,
    g?: boolean,
  ) {
    if (a instanceof ComicScrollGeometry) {
      this.geometry = a
      this.firstVisibleItemIndex = b
      this.firstVisibleItemScrollOffset = c
      this.canScrollBackward = d === true
      this.canScrollForward = e === true
      return
    }
    this.geometry = new ComicScrollGeometry(a, b, c)
    this.firstVisibleItemIndex = d as number
    this.firstVisibleItemScrollOffset = e as number
    this.canScrollBackward = f === true
    this.canScrollForward = g === true
  }

  /* L20-22：三个 passthrough getter。 */
  get itemSizes(): readonly number[] {
    return this.geometry.itemSizes
  }

  get itemSpacing(): number {
    return this.geometry.itemSpacing
  }

  get viewportSize(): number {
    return this.geometry.viewportSize
  }

  /* L23-24：`private val starts` / `private val scrollRange`。 */
  private get starts(): readonly number[] {
    return this.geometry.starts
  }

  private get scrollRange(): number {
    return this.geometry.scrollRange
  }

  /** L27-33 `val fraction: Float get() = when { … }`。 */
  get fraction(): number {
    if (this.itemSizes.length === 0 || !this.canScrollBackward) return 0
    if (!this.canScrollForward) return 1
    if (this.scrollRange === 0) return 0
    const index = Math.min(Math.max(this.firstVisibleItemIndex, 0), this.itemSizes.length - 1)
    const numerator = (this.starts[index] as number) + Math.max(this.firstVisibleItemScrollOffset, 0)
    const raw = numerator / this.scrollRange
    return Math.min(Math.max(raw, 0), 1)
  }

  /**
   * L35-40 —— 「Custom swipe paging advances one viewport, including within a single very
   * tall image.」每次滑动推进 `0.9 × viewportSize`，**不是**一项。
   *
   * 内容不足一屏（`scrollRange <= 0`）时原样返回 `fraction`（L37），
   * 否则光靠这一步永远到不了两端。
   */
  pageFraction(next: boolean): number {
    if (this.scrollRange <= 0) return this.fraction
    const step = (Math.max(this.viewportSize, 1) * 0.9) / this.scrollRange
    return Math.min(Math.max(this.fraction + (next ? step : -step), 0), 1)
  }

  /** L42-55 `target(fraction)`：滑条落点 → (第几项, 项内偏移)。 */
  target(fraction: number): ComicScrollTarget {
    if (this.itemSizes.length === 0) return { index: 0, offset: 0 }
    const safeFraction = Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0
    const pixel = Math.round(safeFraction * this.scrollRange)
    // L47-53：二分查**最后一个** `starts[i] <= pixel`
    let low = 0
    let high = this.starts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >>> 1
      if ((this.starts[middle] as number) <= pixel) low = middle
      else high = middle - 1
    }
    const index = low
    const offset = Math.min(pixel - (this.starts[index] as number), 2147483647)
    return { index, offset }
  }
}

/**
 * L73-88 `ComicScrollGeometryCache` —— 按「已实测到的高度」拼一份几何，并缓存它。
 *
 * 三件容易写错的事：
 *   · `record` 只在**值变了**才置 `dirty`（L79）—— 同一高度反复测量不该让缓存失效；
 *   · `heights` 从不清理，所以上本书留下的下标会**参与 `average()`**，
 *     但不会被读进 `itemSizes`（L84 只取 `0 until count`）；
 *   · 一个高度都没测到过时 `average()` 是 `NaN` → `toInt()` 是 `0` → `coerceAtLeast(1)`
 *     得 **1**（不是 0，也不是 NaN 传播）。
 */
export class ComicScrollGeometryCache {
  private readonly heights = new Map<number, number>()

  private dirty = true

  private cached: ComicScrollGeometry | null = null

  /** L77-80：`height.coerceAtLeast(1)`，变了才 dirty。 */
  record(index: number, height: number): void {
    const size = Math.max(height, 1)
    if (this.heights.get(index) !== size) {
      this.heights.set(index, size)
      this.dirty = true
    }
  }

  /** L81-87。 */
  geometry(count: number, spacing: number, viewport: number): ComicScrollGeometry {
    const cached = this.cached
    if (
      cached !== null &&
      !this.dirty &&
      cached.itemSizes.length === count &&
      cached.itemSpacing === spacing &&
      cached.viewportSize === viewport
    ) {
      return cached
    }
    // L83 `heights.values.average().toInt().coerceAtLeast(1)`
    let sum = 0
    for (const value of this.heights.values()) sum += value
    const average = this.heights.size === 0 ? Number.NaN : sum / this.heights.size
    // Kotlin `NaN.toInt() == 0`，`Double.toInt()` 向零截断
    const truncated = Number.isNaN(average) ? 0 : Math.trunc(average)
    const estimated = Math.max(truncated, 1)
    // L84 `List(count) { heights[it] ?: estimated }`
    const sizes: number[] = []
    for (let index = 0; index < count; index += 1) {
      sizes.push(this.heights.get(index) ?? estimated)
    }
    const next = new ComicScrollGeometry(sizes, spacing, viewport)
    this.cached = next
    this.dirty = false
    return next
  }
}
