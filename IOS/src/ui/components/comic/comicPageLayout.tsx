/**
 * comicPageLayout.tsx — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicPageLayout.kt`（251 行 / 非空 224 行）。
 *
 * 本 Kotlin 文件**没有任何 Compose 依赖**（纯数据类 + 纯函数），因此实现全部落在
 * `src/core/comic/comicPageLayout.ts`（那里有逐行对照的完整文件头）。
 * 本 `.tsx` 是按「每个 Kotlin 文件一个 .tsx」约定保留的对齐入口，只做 re-export，
 * 不含任何实现——UI 层 `import … from './comicPageLayout'` 即可拿到全部符号。
 *
 * 重新导出的符号（与 Kotlin 同名）：
 *   · ComicPageRef / comicPageRefLocal / comicPageRefRemote（sealed interface + 两个实现，L12-L21）
 *   · SizeI / sizeI（L23-L32）
 *   · ComicSplitHalf（L35）
 *   · ComicSlot / comicSlot（L38-L42）
 *   · ComicSpread / comicSpread（L45-L51）
 *   · ComicLayout / comicLayout / spreadOfRawPage / spreadIndexOf（L53-L64）
 *   · ComicScrollStrategy / comicScrollStrategyWebtoon / comicScrollStrategyContinuous
 *     / comicScrollStrategyForConfig（L66-L107）
 *   · verticalPreloadIndices（L109-L123）
 *   · engineFadeAlpha（L125-L132）
 *   · ComicPageLayout 命名空间：WIDE_ASPECT / HARD_WIDE_ASPECT / isWidePage /
 *     Unit / buildComicLayout（L134-L251）
 *   · 外部类型端口：ComicMode / ComicDirection / ComicBgType / ComicReaderConfig /
 *     ComicBookState + label 表（owner: ComicReaderConfig.kt，另一 agent 拥有）
 *
 * 跳过说明：无（本文件是纯 re-export，实现见 core）。
 */
export * from '@core/comic/comicPageLayout'

import {
  buildComicLayout as buildPortedComicLayout,
  comicPageRefLocal,
  comicPageRefRemote,
  sizeI,
  type ComicBookState as PortedBookState,
  type ComicReaderConfig as PortedConfig,
} from '@core/comic/comicPageLayout'
import type {
  ComicBookState,
  ComicLayout,
  ComicPageRef,
  ComicReaderConfig,
  ComicSizeInfo,
} from '@core/comic/comicReaderCore'

/**
 * 页面的 `ComicPageRef`（LOCAL/REMOTE）→ `ComicPageLayout.kt` 移植模块的
 * `local/remote` 判别联合。两个模块是不同 agent 的端口，字段语义一致，
 * 这里只做大小写与工厂函数转换，不复制布局算法。
 */
function toPortedRef(ref: ComicPageRef): ReturnType<typeof comicPageRefRemote> {
  return ref.kind === 'LOCAL'
    ? comicPageRefLocal(ref.id, ref.path)
    : comicPageRefRemote(ref.id, ref.url, ref.headers, ref.referer)
}

/** 移植模块的 slot.ref → 页面读模型（只回传布局结果时使用）。 */
function toReaderRef(ref: ReturnType<typeof comicPageRefRemote>): ComicPageRef {
  return ref.kind === 'local'
    ? { kind: 'LOCAL', id: ref.id, path: ref.path }
    : { kind: 'REMOTE', id: ref.id, url: ref.url, headers: ref.headers, referer: ref.referer }
}

/**
 * 页面布局入口：调用 `src/core/comic/comicPageLayout.ts` 的逐行移植
 * `buildComicLayout`，再把结果收回 `ComicReaderCore` 的读模型。
 *
 * 为什么需要这层适配：页面与 `ComicReaderCore.ts` 使用大写 `LOCAL/REMOTE`
 * 与 `Record` 形式的 `rawToSpread`，而 `ComicPageLayout.kt` 的移植端口使用
 * Kotlin 原样的小写 sealed 名称与 `Map`。适配只发生在边界，拆分/合页/宽页
 * 判定仍全部由移植模块执行（避免页面里第二份布局实现）。
 */
export function buildComicLayoutForReader(
  pages: readonly ComicPageRef[],
  sizes: Readonly<Record<string, ComicSizeInfo>>,
  config: ComicReaderConfig,
  bookState: ComicBookState,
): ComicLayout {
  const portedPages = pages.map(toPortedRef)
  const portedSizes = new Map<string, ReturnType<typeof sizeI>>()
  for (const [id, size] of Object.entries(sizes)) {
    portedSizes.set(id, sizeI(size.width, size.height, size.gutter, size.gutterPos))
  }
  const ported = buildPortedComicLayout(
    portedPages,
    portedSizes,
    config as PortedConfig,
    bookState as PortedBookState,
  )
  const byId = new Map(pages.map((ref) => [ref.id, ref] as const))
  const spreads = ported.spreads.map((spread) => {
    const slots = spread.slots.map((slot) => ({
      ref: byId.get(slot.ref.id) ?? toReaderRef(slot.ref),
      rawIndex: slot.rawIndex,
      half: slot.half,
    }))
    return { index: spread.index, slots }
  })
  const rawToSpread: Record<number, number> = {}
  for (const [raw, spreadIndex] of ported.rawToSpread) rawToSpread[raw] = spreadIndex
  return { spreads, rawToSpread }
}
