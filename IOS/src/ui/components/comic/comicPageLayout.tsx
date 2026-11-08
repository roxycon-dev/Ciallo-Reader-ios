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
