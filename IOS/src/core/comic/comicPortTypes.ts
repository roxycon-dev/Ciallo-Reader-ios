/**
 * comicPortTypes.ts — SHARED SUPPORT FILE (not a 1:1 Kotlin mapping)
 *
 * WHY THIS FILE EXISTS
 * The nine files in this directory map 1:1 onto Kotlin sources in
 * `novel-reader/app/src/main/java/com/example/ui/comic/`. Several of those
 * sources reference *value types* declared in sibling Kotlin files that other
 * porting agents own:
 *
 *   - ComicReaderConfig.kt : ComicMode / ComicDirection / ComicFit /
 *                           ComicDoubleAlign / ComicCropMode / ComicEnhanceMode /
 *                           ComicBgType / ComicPageAnim / ComicScene /
 *                           ComicGestureAction / ComicBookState
 *   - ComicPageLayout.kt   : ComicPageRef / SizeI / ComicSplitHalf /
 *                           ComicSlot / ComicSpread / ComicLayout
 *   - ComicReaderCore.kt   : fittedSize(intrinsic, container, fit, …)
 *   - ComicChapterEdgeGesture.kt : comicChapterEdgeTarget(…)
 *
 * WHAT THIS FILE STILL OWNS
 *   • `RectF` / `SizeF` / `OffsetF` — Compose 几何（无 Kotlin 对应文件，纯适配层）
 *   • `ComicConfigSubset` / `ComicBookStateSubset` — 比全量记录更窄的只读视图
 *   • `fittedSize()` / `comicChapterEdgeTarget()` — 见下方各自的说明
 *
 * WHAT THIS FILE NO LONGER OWNS（已完成的合并）
 *   `ComicReaderConfig.kt` 的移植已落地为同目录下的 `./comicReaderConfig`（1143 行，
 *   逐行移植，带 `_VALUES` / `_ORDINAL` / `_LABEL` 表与 `toJson` / `fromJson`）。
 *   本文件原先手写的八个枚举镜像（ComicMode / ComicDirection / ComicFit /
 *   ComicDoubleAlign / ComicCropMode / ComicEnhanceMode / ComicBgType /
 *   ComicPageAnim）已删除，改为从 `./comicReaderConfig` **再导出**，单一数据源。
 *   逐成员核对结论见 `tests/unit/comicConfig.test.ts`
 *   （"structural compatibility with comicPortTypes.ts"）：八个枚举的名字集合与
 *   声明顺序（= ordinal）都与 Kotlin `ComicReaderConfig.kt` L242-311 逐字一致，
 *   故本次是纯类型层面去重，**没有任何运行时行为变化**，消费方
 *   （comicPageLoader / comicHarismCurl / comicZoomGesture / comicImagePipeline /
 *   comicProcessedDiskCache）不需要改一处调用。
 *
 *   仍在进行中的同类去重（本文件不碰，各文件自行保留声明）：
 *     • `./comicPageLayout`  → `ComicPageRef` / `SizeI` / `ComicSlot` /
 *                             `ComicSpread` / `ComicLayout`（注意那里的判别键是
 *                             小写 `'local' | 'remote'`，与 core 的
 *                             `'LOCAL' | 'REMOTE'` 不是同一个类型，不能直接换）
 *     • `./comicReaderCore`  → `fittedSize()` 的核心版本（L1642/L1649）
 */

/* ── 枚举：单一数据源 = ./comicReaderConfig（← ComicReaderConfig.kt L242-311） ── */

/**
 * 九个配置枚举（`ComicMode` / `ComicDirection` / `ComicFit` / `ComicDoubleAlign` /
 * `ComicCropMode` / `ComicEnhanceMode` / `ComicBgType` / `ComicScene` /
 * `ComicGestureAction`）的唯一权威声明在 `./comicReaderConfig`。
 *
 * 这里只做**类型再导出**（`export type`，编译期擦除，不产生运行时 import），
 * 以保持既有 import 路径 `from './comicPortTypes'` 不变。
 * 需要 `_VALUES` / `_ORDINAL` / `_LABEL` 表时请直接从 `./comicReaderConfig` 导入。
 *
 * 命名位置的一处历史差异：Kotlin 把 `ComicScene` / `ComicGestureAction` 声明在
 * 同一个文件里（`ComicReaderConfig.kt` L294-299 / L306-311），但本文件此前从未
 * 镜像过这两个（消费方当时直接引 `comicSceneFx` / `comicSceneEngine` /
 * `comicReaderSheets`），因此本次一并转正，call site 不变。
 */
import type {
  ComicBgType,
  ComicCropMode,
  ComicDirection,
  ComicDoubleAlign,
  ComicEnhanceMode,
  ComicFit,
  ComicGestureAction,
  ComicMode,
  ComicPageAnim,
  ComicScene,
} from './comicReaderConfig'

export type {
  ComicBgType,
  ComicCropMode,
  ComicDirection,
  ComicDoubleAlign,
  ComicEnhanceMode,
  ComicFit,
  ComicGestureAction,
  ComicMode,
  ComicPageAnim,
  ComicScene,
}

/** `enum class ComicSplitHalf { FULL, LEFT, RIGHT }` — declared in ComicPageLayout.kt. */
export type ComicSplitHalf = 'FULL' | 'LEFT' | 'RIGHT'

/** Declaration order of `enum class ComicSplitHalf` — `ordinal` is used by the FX engine seed. */
export const SPLIT_HALF_ORDINAL: Readonly<Record<ComicSplitHalf, number>> = {
  FULL: 0,
  LEFT: 1,
  RIGHT: 2,
}

/* ── Compose geometry mirrors (androidx.compose.ui.geometry / android.graphics.RectF) ── */

export interface SizeF {
  readonly width: number
  readonly height: number
}

export const ZERO_SIZE: SizeF = { width: 0, height: 0 }

export interface OffsetF {
  readonly x: number
  readonly y: number
}

export const ZERO_OFFSET: OffsetF = { x: 0, y: 0 }

export function offsetOf(x: number, y: number): OffsetF {
  return { x, y }
}

export function sizeOf(width: number, height: number): SizeF {
  return { width, height }
}

/** `Offset.getDistance()` — Euclidean length. */
export function offsetDistance(o: OffsetF): number {
  return Math.hypot(o.x, o.y)
}

/** `android.graphics.RectF` — mutable, exactly the operations this module calls. */
export class RectF {
  constructor(
    public left = 0,
    public top = 0,
    public right = 0,
    public bottom = 0,
  ) {}

  width(): number {
    return this.right - this.left
  }

  height(): number {
    return this.bottom - this.top
  }

  offset(dx: number, dy: number): void {
    this.left += dx
    this.right += dx
    this.top += dy
    this.bottom += dy
  }

  copyFrom(other: RectF): void {
    this.left = other.left
    this.top = other.top
    this.right = other.right
    this.bottom = other.bottom
  }

  equalsRect(other: RectF): boolean {
    return (
      this.left === other.left &&
      this.top === other.top &&
      this.right === other.right &&
      this.bottom === other.bottom
    )
  }
}

/* ── ComicPageLayout.kt mirrors ── */

/** `sealed interface ComicPageRef` */
export type ComicPageRef =
  | { readonly kind: 'Local'; readonly id: string; readonly path: string }
  | {
      readonly kind: 'Remote'
      readonly id: string
      readonly url: string
      readonly headers: Readonly<Record<string, string>>
      readonly referer: string | null
    }

/** `data class SizeI` */
export interface SizeI {
  readonly width: number
  readonly height: number
  /** 中央装订缝探测结论：null=未探测（在线页/未加载），true/false=已探测有无 */
  readonly gutter?: boolean | null
  /** 缝中心归一化 x（第 19 条：拆分位置精确落在装订缝上）；仅 gutter=true 时有效 */
  readonly gutterPos?: number | null
}

/** `val SizeI.aspect: Float` */
export function sizeIAspect(s: SizeI): number {
  return s.height > 0 ? s.width / s.height : 0
}

/** `data class ComicSlot` */
export interface ComicSlot {
  readonly ref: ComicPageRef
  readonly rawIndex: number
  readonly half: ComicSplitHalf
}

/** `data class ComicSpread` */
export interface ComicSpread {
  readonly index: number
  readonly slots: ReadonlyArray<ComicSlot>
}

/** `data class ComicLayout` */
export interface ComicLayout {
  readonly spreads: ReadonlyArray<ComicSpread>
  readonly rawToSpread: Readonly<Record<number, number>>
}

/** `val ComicLayout.spreadCount: Int` */
export function spreadCount(layout: ComicLayout): number {
  return layout.spreads.length
}

/* ── ComicReaderConfig.kt mirror (only the members this module reads) ── */

/**
 * Structural subset of `data class ComicReaderConfig` consumed by the loader /
 * curl / zoom modules. The full record is owned by another agent; this subset is
 * intentionally narrower so it stays assignable from the real port.
 */
export interface ComicConfigSubset {
  readonly mode: ComicMode
  readonly direction: ComicDirection
  readonly fit: ComicFit
  readonly customFitBase: ComicFit
  readonly customFitScale: number
  readonly doubleGapDp: number
  readonly doubleAlign: ComicDoubleAlign
  readonly doubleShiftXDp: number
  readonly doubleShiftYDp: number
  readonly bookRotation: number
  readonly cropMode: ComicCropMode
  readonly manualCrop: ReadonlyArray<number> | null
  readonly splitWide: boolean
  readonly splitPosition: number
  readonly enhanceMode: ComicEnhanceMode
  readonly enhanceStrength: number
  readonly filterBrightness: number
  readonly filterContrast: number
  readonly filterSaturation: number
  readonly filterHue: number
  readonly filterGamma: number
  readonly filterSharpen: number
  readonly filterShadow: number
  readonly filterBW: boolean
  readonly bgType: ComicBgType
  readonly paperIntensity: number
  readonly pageAnim: ComicPageAnim
}

/** `data class ComicBookState` — only `pageRotations` is read by this module. */
export interface ComicBookStateSubset {
  readonly pageRotations: Readonly<Record<string, number>>
}

/* ── borrowed pure functions (mirrors of files owned by other agents) ── */

/**
 * Mirror of `ComicReaderCore.kt:1649 fittedSize(intrinsic, container, fit, customScale, customBase)`.
 * Ported verbatim so `curlPageRects` (this module) and the zoom/curl readers agree on
 * fit maths. Swap for the import when `./comicReaderCore` lands.
 */
export function fittedSize(
  intrinsic: SizeF,
  container: SizeF,
  fit: ComicFit,
  customScale = 1,
  customBase: ComicFit = 'FIT_PAGE',
): SizeF {
  if (intrinsic.width <= 0 || intrinsic.height <= 0) return ZERO_SIZE
  switch (fit) {
    case 'FIT_PAGE':
      // 整页：fit-inside（完整可见，比例保持，短边贴合留白在长边）
      {
        const s = Math.min(container.width / intrinsic.width, container.height / intrinsic.height)
        return { width: intrinsic.width * s, height: intrinsic.height * s }
      }
    case 'FIT_WIDTH': {
      // 宽度贴合容器 + 竖向自然溢出（可平移/滚动）
      const s = container.width / intrinsic.width
      return { width: intrinsic.width * s, height: intrinsic.height * s }
    }
    case 'FIT_HEIGHT': {
      const s = container.height / intrinsic.height
      return { width: intrinsic.width * s, height: intrinsic.height * s }
    }
    case 'ORIGINAL':
      return intrinsic
    case 'FILL': {
      const s = Math.max(container.width / intrinsic.width, container.height / intrinsic.height)
      return { width: intrinsic.width * s, height: intrinsic.height * s }
    }
    case 'STRETCH':
      return container
    case 'CUSTOM': {
      // 自定义：用户选定的基础档 × 缩放系数（0.5..2.5）
      const base = fittedSize(
        intrinsic,
        container,
        customBase === 'CUSTOM' ? 'FIT_PAGE' : customBase,
      )
      return { width: base.width * customScale, height: base.height * customScale }
    }
  }
}

/**
 * Mirror of `ComicChapterEdgeGesture.kt:21 comicChapterEdgeTarget(drag, atStart, atEnd, threshold)`.
 * 正值回退、负值前进；只允许从起手时已停住的首末页跨章。
 * Swap for the import when `./comicChapterEdgeGesture` lands.
 */
export function comicChapterEdgeTarget(
  drag: number,
  atStart: boolean,
  atEnd: boolean,
  threshold: number,
): number {
  if (atStart && drag >= threshold) return -1
  if (atEnd && drag <= -threshold) return 1
  return 0
}