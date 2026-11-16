/**
 * comicScrollMetrics.tsx — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicScrollMetrics.kt`（46 行 / 非空 40 行）。
 *
 * 本 Kotlin 文件**没有任何 Compose 依赖**（纯 data class + 纯计算），
 * 因此实现全部落在 `src/core/comic/comicScrollMetrics.ts`（那里有逐行对照的完整文件头）。
 * 本 `.tsx` 是按「每个 Kotlin 文件一个 .tsx」约定保留的对齐入口，只做 re-export，
 * 不含任何实现。
 *
 * 重新导出的符号（与 Kotlin 同名）：
 *   · ComicScrollTarget（L46，internal data class）
 *   · ComicScrollMetrics（L6-L44，含 7 个构造参数、私有 `starts` / `scrollRange`、
 *     `fraction` 计算属性与 `target(fraction)` 方法）
 *
 * 跳过说明：无（本文件是纯 re-export，实现见 core）。
 */
export * from '@core/comic/comicScrollMetrics'
