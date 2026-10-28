/**
 * comicPageLayout.ts — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicPageLayout.kt`（251 行 / 非空 224 行）。
 *
 * 纯逻辑模块（无 Compose 依赖）→ 放在 `src/core`，可被单测直接引用。
 *
 * Kotlin 行号 → TS 对照：
 *   L1        package/import（仅 kotlin 依赖，无外部 API）→ 略
 *   L3-L9     文件级 KDoc「漫画页面布局引擎（纯逻辑，可测试）」→ 保留（见本文件头）
 *   L12-L21   sealed interface ComicPageRef → ComicPageRef 判别联合（kind: 'local' | 'remote'）
 *   L23-L32   data class SizeI（aspect 计算属性）→ SizeI 接口 + sizeI() 工厂（保留 .aspect 访问）
 *   L35       enum class ComicSplitHalf → ComicSplitHalf 常量对象 + 同名联合类型
 *   L38-L42   data class ComicSlot → ComicSlot 接口 + comicSlot() 工厂
 *   L45-L51   data class ComicSpread（isDouble / firstRawIndex 计算属性）→ 接口 + comicSpread()
 *   L53-L64   data class ComicLayout（spreadCount / spreadOfRawPage / spreadIndexOf）→ 接口 + comicLayout()
 *   L66-L107  sealed class ComicScrollStrategy（Webtoon / Continuous / companion forConfig）
 *              → ComicScrollStrategy 联合类型 + comicScrollStrategyForConfig()
 *   L109-L123 internal fun verticalPreloadIndices → 逐行移植
 *   L125-L132 internal fun engineFadeAlpha → 逐行移植
 *   L134-L251 object ComicPageLayout（WIDE_ASPECT / HARD_WIDE_ASPECT / isWidePage /
 *              Unit / build）→ 同名常量 + 导出函数 isWidePage / buildComicLayout
 *
 * 跳过说明：
 *   · `data class` 的 `copy()`/`equals()`/`componentN()` 未生成：本项目内这些数据
 *     结构全部以「构造函数参数 + 显式展开」方式使用，无需结构化相等。
 *     唯一用到 copy() 的地方在 ComicReaderChrome.kt L302（`config.copy(manualCrop=…)`），
 *     已在 comicReaderChrome.tsx 里用对象展开 `{ ...config, manualCrop: [...] }` 等价实现。
 *   · `private data class RawUnitGroup`（L173）/ `PendingSpread`（L194）/ `Unit`（L156）：
 *     Kotlin 局部类 → TS 普通接口，命名与字段一字不改（`Unit` 保持 `Unit` 名，不改名以免丢标识符）。
 *   · 声明于本文件之外、由别的 agent 拥有的类型（ComicReaderConfig.kt / ComicReaderCore.kt）：
 *     `ComicMode`、`ComicDirection`、`ComicBgType`、`ComicReaderConfig`、`ComicBookState`
 *     在此以「结构子集端口」重新声明，见下方注释。不改动对方文件。
 *
 * 适配说明：
 *   · Kotlin `Float` → `number`；`Int` → `number`；`coerceIn/coerceAtLeast` → Math.min/max。
 *   · Kotlin `Map<Int,Int>` → `Map<number, number>`（结构键为 number，JS Map 与之等价）。
 *   · Kotlin `Set<Int>.contains` → `Set<number>.has`。
 *   · Kotlin `List.getOrNull` → `?? undefined`。
 */

//
// ── 外部类型端口（owner: ComicReaderConfig.kt / ComicReaderCore.kt，另一 agent 拥有）
//    这里只声明本模块实际用到的字段子集；等对方落地后替换 import 即可，字段名保持一致。
//

/** 阅读模式：单页/双页/条漫/无缝滚动/磁吸（ComicReaderConfig.kt L243-245）。 */
export type ComicMode = 'SINGLE' | 'DOUBLE' | 'WEBTOON' | 'CONTINUOUS' | 'MAGNETIC'

/** 阅读方向（ComicReaderConfig.kt L248-250）。 */
export type ComicDirection = 'LTR' | 'RTL' | 'TTB'

/** 阅读背景（ComicReaderConfig.kt L290-292）。 */
export type ComicBgType = 'BLACK' | 'WHITE' | 'GRAY' | 'PAPER' | 'DYNAMIC'

/** ComicReaderConfig 中本模块用到的字段子集（其余字段由设置面板 agent 补齐）。 */
export interface ComicReaderConfig {
  readonly mode: ComicMode
  readonly direction: ComicDirection
  /** 宽页拆分开关（ComicPageLayout.kt L180） */
  readonly splitWide: boolean
  /** 手动纠正扫描顺序（ComicPageLayout.kt L183） */
  readonly splitReverse: boolean
  /** 双页模式下首页单独显示（ComicPageLayout.kt L217） */
  readonly doubleFirstAlone: boolean
  /** 条漫页间距 dp（ComicPageLayout.kt L85） */
  readonly pageSpacingDp: number
  /** 条漫磁吸（ComicPageLayout.kt L86） */
  readonly webtoonSnap: boolean
  /** 手动裁边 [l, t, r, b]，null = 未设置（ComicReaderChrome.kt L302） */
  readonly manualCrop: readonly number[] | null
  /** 滑条缩略图预览开关（ComicReaderChrome.kt L229） */
  readonly showThumbPreview: boolean
}

/** 每本漫画的阅读状态（ComicReaderConfig.kt L316-324），本模块只用到 mergeAnchors。 */
export interface ComicBookState {
  /** 临时合页：以该页为左页与下一页组成跨页（显示层行为） */
  readonly mergeAnchors: ReadonlySet<number>
}

/** ComicMode.label（ComicReaderConfig.kt L244，原样搬字符串）。 */
export const COMIC_MODE_LABEL: Readonly<Record<ComicMode, string>> = {
  SINGLE: '单页',
  DOUBLE: '双页',
  WEBTOON: '条漫',
  CONTINUOUS: '无缝滚动',
  MAGNETIC: '磁吸',
}

/** ComicDirection.label（ComicReaderConfig.kt L249）。 */
export const COMIC_DIRECTION_LABEL: Readonly<Record<ComicDirection, string>> = {
  LTR: '左 → 右',
  RTL: '右 → 左',
  TTB: '上 → 下',
}

/** ComicBgType.label（ComicReaderConfig.kt L291）。 */
export const COMIC_BG_TYPE_LABEL: Readonly<Record<ComicBgType, string>> = {
  BLACK: '纯黑',
  WHITE: '纯白',
  GRAY: '深灰',
  PAPER: '纸张纹理',
  DYNAMIC: '沉浸动态',
}

/** config.mode.label（ComicReaderChrome.kt L348）。 */
export function comicModeLabel(mode: ComicMode): string {
  return COMIC_MODE_LABEL[mode]
}

/** config.direction.label（ComicReaderChrome.kt L348）。 */
export function comicDirectionLabel(direction: ComicDirection): string {
  return COMIC_DIRECTION_LABEL[direction]
}

//
// ── L12-L21  一张漫画图片的引用：本地文件或在线 URL
//

/**
 * Kotlin `sealed interface ComicPageRef` 有两个实现：`ComicPageRef.Local(id, path)` 与
 * `ComicPageRef.Remote(id, url, headers, referer)`。TS 用 `kind` 判别联合表达同一形状。
 * Kotlin `when (ref)` 的 `is Local` / `is Remote` → `ref.kind === 'local' | 'remote'`。
 */
export type ComicPageRef =
  | {
      readonly kind: 'local'
      readonly id: string
      readonly path: string
    }
  | {
      readonly kind: 'remote'
      readonly id: string
      readonly url: string
      readonly headers: Readonly<Record<string, string>>
      readonly referer: string | null
    }

/** `ComicPageRef.Local(override val id: String, val path: String)`（L14）。 */
export function comicPageRefLocal(id: string, path: string): ComicPageRef {
  return { kind: 'local', id, path }
}

/** `ComicPageRef.Remote(...)`（L15-L20），headers 默认 emptyMap()、referer 默认 null。 */
export function comicPageRefRemote(
  id: string,
  url: string,
  headers: Readonly<Record<string, string>> = {},
  referer: string | null = null,
): ComicPageRef {
  return { kind: 'remote', id, url, headers, referer }
}

//
// ── L23-L32  data class SizeI
//

export interface SizeI {
  readonly width: number
  readonly height: number
  /** 中央装订缝探测结论：null=未探测（在线页/未加载），true/false=已探测有无 */
  readonly gutter: boolean | null
  /** 缝中心归一化 x（第 19 条：拆分位置精确落在装订缝上）；仅 gutter=true 时有效 */
  readonly gutterPos: number | null
  /** `val aspect: Float get() = if (height > 0) width.toFloat() / height else 0f`（L31） */
  readonly aspect: number
}

/** 构造 `SizeI`（Kotlin data class 的具名参数构造 → TS 工厂函数）。 */
export function sizeI(
  width: number,
  height: number,
  gutter: boolean | null = null,
  gutterPos: number | null = null,
): SizeI {
  return {
    width,
    height,
    gutter,
    gutterPos,
    aspect: height > 0 ? width / height : 0,
  }
}

//
// ── L35  拆分半页
//

export const ComicSplitHalf = {
  FULL: 'FULL',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
} as const

export type ComicSplitHalf = (typeof ComicSplitHalf)[keyof typeof ComicSplitHalf]

//
// ── L38-L42  一个显示槽位：完整页或拆分后的半页
//

export interface ComicSlot {
  readonly ref: ComicPageRef
  readonly rawIndex: number
  readonly half: ComicSplitHalf
}

export function comicSlot(ref: ComicPageRef, rawIndex: number, half: ComicSplitHalf = ComicSplitHalf.FULL): ComicSlot {
  return { ref, rawIndex, half }
}

//
// ── L45-L51  一个跨页：1 或 2 个槽位（slots 为阅读顺序）
//

export interface ComicSpread {
  readonly index: number
  readonly slots: readonly ComicSlot[]
  /** `val isDouble: Boolean get() = slots.size == 2`（L49） */
  readonly isDouble: boolean
  /** `val firstRawIndex: Int get() = slots.first().rawIndex`（L50） */
  readonly firstRawIndex: number
}

export function comicSpread(index: number, slots: readonly ComicSlot[]): ComicSpread {
  // Kotlin `slots.first()` 在空列表上抛 NoSuchElementException；这里显式抛同义错误。
  const first = slots[0]
  if (first === undefined) {
    throw new Error('ComicSpread.slots must not be empty (Kotlin slots.first())')
  }
  return { index, slots, isDouble: slots.length === 2, firstRawIndex: first.rawIndex }
}

//
// ── L53-L64  data class ComicLayout
//

export interface ComicLayout {
  readonly spreads: readonly ComicSpread[]
  /** 原始页 → 首个所在 spread 索引 */
  readonly rawToSpread: ReadonlyMap<number, number>
  /** `val spreadCount: Int get() = spreads.size`（L58） */
  readonly spreadCount: number
}

export function comicLayout(
  spreads: readonly ComicSpread[],
  rawToSpread: ReadonlyMap<number, number> = new Map<number, number>(),
): ComicLayout {
  return { spreads, rawToSpread, spreadCount: spreads.length }
}

/** `fun spreadOfRawPage(raw: Int): Int = rawToSpread[raw] ?: 0`（L60） */
export function spreadOfRawPage(layout: ComicLayout, raw: number): number {
  return layout.rawToSpread.get(raw) ?? 0
}

/**
 * `fun spreadIndexOf(raw: Int): Int = spreads.indexOfFirst { s -> s.slots.any { it.rawIndex == raw } }`
 * `.takeIf { it >= 0 } ?: 0`（L62-L63）
 */
export function spreadIndexOf(layout: ComicLayout, raw: number): number {
  const index = layout.spreads.findIndex((s) => s.slots.some((slot) => slot.rawIndex === raw))
  return index >= 0 ? index : 0
}

//
// ── L66-L107  垂直阅读策略
//

/**
 * Kotlin `sealed class ComicScrollStrategy` 有两个子类 Webtoon / Continuous，各暴露
 * spacingDp / snapToPage / prefetchWindow / pixelProgress 四个抽象属性。
 * TS 用 `kind` 判别联合表达。
 */
export type ComicScrollStrategy =
  | {
      readonly kind: 'webtoon'
      /** 页与页间距（dp） */
      readonly spacingDp: number
      /** 松手是否吸附到页边界 */
      readonly snapToPage: boolean
      /** 视口外双向预加载页数（保证滚动连续性） */
      readonly prefetchWindow: number
      /** 进度语义：两种列表均跟随项内像素偏移，长图滚动时也更新 */
      readonly pixelProgress: boolean
    }
  | {
      readonly kind: 'continuous'
      readonly spacingDp: number
      readonly snapToPage: boolean
      readonly prefetchWindow: number
      readonly pixelProgress: boolean
    }

/** `data class Webtoon(private val config: ComicReaderConfig)`（L84-L91）。 */
export function comicScrollStrategyWebtoon(config: ComicReaderConfig): ComicScrollStrategy {
  return {
    kind: 'webtoon',
    spacingDp: config.pageSpacingDp,
    snapToPage: config.webtoonSnap,
    // 在线阅读冷启动：窗口 2→4，提前两页取图/解码，滚动追图概率大降；
    // 驻留预算按优先级序自动丢尾部，不会无界涨内存
    prefetchWindow: 4,
    pixelProgress: true,
  }
}

/** `data class Continuous(private val config: ComicReaderConfig)`（L93-L99）。 */
export function comicScrollStrategyContinuous(_config: ComicReaderConfig): ComicScrollStrategy {
  // 无缝滚动强制 0 间距：用户间距设置在此模式无效（连续性是本模式定义）
  return {
    kind: 'continuous',
    spacingDp: 0,
    snapToPage: false,
    prefetchWindow: 4,
    pixelProgress: true,
  }
}

/** `companion object { fun forConfig(config) }`（L101-L106）。 */
export function comicScrollStrategyForConfig(config: ComicReaderConfig): ComicScrollStrategy {
  // WEBTOON 及其余垂直形态
  return config.mode === 'CONTINUOUS' ? comicScrollStrategyContinuous(config) : comicScrollStrategyWebtoon(config)
}

//
// ── L109-L123  垂直模式前瞻预载索引
//

/**
 * 返回 **预载驻留优先级序**：当前页 → 前瞻 +1..+window（近→远）→ 上一页，全部钳制到
 * [0, count)。抽纯函数供单测钉死边界行为。
 */
export function verticalPreloadIndices(current: number, window: number, count: number): number[] {
  if (count <= 0) return []
  const fwd: number[] = []
  for (let it = 1; it <= window; it++) {
    const v = current + it
    if (v >= 0 && v < count) fwd.push(v)
  }
  const back = current - 1 >= 0 && current - 1 < count ? [current - 1] : []
  const head = current >= 0 && current < count ? [current] : []
  return head.concat(fwd, back)
}

//
// ── L125-L132  引擎/布局切换淡入 alpha（补1）
//

/** 240ms smoothstep（≈FastOutSlowIn），起始 0.35 不全黑。 */
export function engineFadeAlpha(elapsedMs: number, durationMs = 240): number {
  const t = durationMs <= 0 ? 1 : Math.min(Math.max(elapsedMs / durationMs, 0), 1)
  return 0.35 + 0.65 * (t * t * (3 - 2 * t))
}

//
// ── L134-L251  object ComicPageLayout
//

/** 宽高比超过该值进入「疑似跨页」区间（需 gutter 佐证）（L136-L137）。 */
export const WIDE_ASPECT = 1.35

/** 宽高比超过该值无条件视为跨页扫描图（KCC BISECT_THRESHOLD 经验值）（L139-L140）。 */
export const HARD_WIDE_ASPECT = 1.8

/**
 * 宽页拆分判定（二次精修：中央装订缝佐证，降低误拆/漏拆）：
 * - aspect ≥ 1.8 → 无条件拆（超宽必是跨页）；
 * - 1.35 ≤ aspect < 1.8 → 本地页有 gutter 探测结果时按结果定（有缝 → 拆，无缝 → 不拆，
 *   避免把宽幅单页插画误拆）；无探测结果（在线页）保持旧版行为直接拆。
 */
export function isWidePage(size: SizeI | null): boolean {
  if (size === null) return false
  const a = size.aspect
  if (a < WIDE_ASPECT) return false
  if (a >= HARD_WIDE_ASPECT) return true
  return size.gutter ?? true
}

/** `data class Unit(val slot, val fromSplit, val wideFull)`（L156-L160）。 */
export interface Unit {
  readonly slot: ComicSlot
  readonly fromSplit: boolean
  /** 未拆分的宽页（双页模式下应独占） */
  readonly wideFull: boolean
}

/** `private data class RawUnitGroup(val rawIndex: Int, val units: List<Unit>)`（L173）。 */
interface RawUnitGroup {
  readonly rawIndex: number
  readonly units: Unit[]
}

/** `private data class PendingSpread(val unitSlots: List<Unit>)`（L194）。 */
interface PendingSpread {
  readonly unitSlots: Unit[]
}

/** `ComicPageLayout.build(pages, sizes, config, bookState)`（L162-L250）。 */
export function buildComicLayout(
  pages: readonly ComicPageRef[],
  sizes: ReadonlyMap<string, SizeI>,
  config: ComicReaderConfig,
  bookState: ComicBookState = { mergeAnchors: new Set<number>() },
): ComicLayout {
  if (pages.length === 0) return comicLayout([], new Map<number, number>())
  const rtl = config.direction === 'RTL'
  const double = config.mode === 'DOUBLE'

  // 1. 展开为显示单元：宽页按需拆分（记录原始页索引，合页锚点按原始索引判断）
  const rawGroups: RawUnitGroup[] = []
  pages.forEach((page, idx) => {
    const size = sizes.get(page.id)
    const isWide = isWidePage(size ?? null)
    const anchorMerged = bookState.mergeAnchors.has(idx)
    if (config.splitWide && isWide && !anchorMerged) {
      // 拆分顺序：默认 RTL 先右半边；splitReverse 反转手动纠正扫描顺序。
      // 拆分半页各自成组，参与后续配对/合页流程。
      const rightFirst = config.splitReverse ? !rtl : rtl
      const left: Unit = {
        slot: comicSlot(page, idx, ComicSplitHalf.LEFT),
        fromSplit: true,
        wideFull: false,
      }
      const right: Unit = {
        slot: comicSlot(page, idx, ComicSplitHalf.RIGHT),
        fromSplit: true,
        wideFull: false,
      }
      const ordered = rightFirst ? [right, left] : [left, right]
      ordered.forEach((it) => rawGroups.push({ rawIndex: idx, units: [it] }))
    } else {
      rawGroups.push({
        rawIndex: idx,
        units: [
          { slot: comicSlot(page, idx, ComicSplitHalf.FULL), fromSplit: false, wideFull: isWide },
        ],
      })
    }
  })

  // 2. 临时合页锚点 → 两页组成一个 spread（显示层行为，不破坏原始数据）
  const pending: PendingSpread[] = []
  let i = 0
  while (i < rawGroups.length) {
    const group = rawGroups[i] as RawUnitGroup
    const isAnchor = bookState.mergeAnchors.has(group.rawIndex)
    const groupUnits = group.units
    if (isAnchor && i + 1 < rawGroups.length && groupUnits.length === 1 && !(groupUnits[0] as Unit).fromSplit) {
      const nextUnits = (rawGroups[i + 1] as RawUnitGroup).units
      if (nextUnits.length === 1 && !(nextUnits[0] as Unit).fromSplit) {
        pending.push({ unitSlots: groupUnits.concat(nextUnits) })
        i += 2
        continue
      }
    }
    pending.push({ unitSlots: groupUnits })
    i++
  }

  // 3. 分组为 spread
  const groups: Unit[][] = []
  let cursor = 0
  const firstAlone = config.doubleFirstAlone && double
  if (firstAlone && pending.length > 0) {
    groups.push((pending[0] as PendingSpread).unitSlots)
    cursor = 1
  }
  while (cursor < pending.length) {
    const cur = pending[cursor] as PendingSpread
    if (!double || cur.unitSlots.length > 1 || (cur.unitSlots[0] as Unit).wideFull) {
      // 单页模式 / 已是合页组 / 未拆分宽页 → 独立 spread
      groups.push(cur.unitSlots)
      cursor++
    } else {
      const next = pending[cursor + 1]
      if (next !== undefined && next.unitSlots.length === 1 && !(next.unitSlots[0] as Unit).wideFull) {
        groups.push(cur.unitSlots.concat(next.unitSlots))
        cursor += 2
      } else {
        groups.push(cur.unitSlots)
        cursor++
      }
    }
  }

  const spreadList = groups.map((units, si) => comicSpread(si, units.map((it) => it.slot)))
  const rawMap = new Map<number, number>()
  spreadList.forEach((s) => {
    s.slots.forEach((slot) => {
      // `rawMap.putIfAbsent(slot.rawIndex, s.index)`（L246）：已存在则不覆盖
      if (!rawMap.has(slot.rawIndex)) rawMap.set(slot.rawIndex, s.index)
    })
  })
  return comicLayout(spreadList, rawMap)
}
