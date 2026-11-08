/**
 * comicLoadSupport.tsx — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicLoadSupport.kt`（54 行 / 非空 49 行）。
 *
 * 本 Kotlin 文件**没有任何 Compose 依赖**（纯函数 + data class + 同步容器），
 * 因此实现全部落在 `src/core/comic/comicLoadSupport.ts`（那里有逐行对照的完整文件头）。
 * 本 `.tsx` 是按「每个 Kotlin 文件一个 .tsx」约定保留的对齐入口，只做 re-export，
 * 不含任何实现。
 *
 * 重新导出的符号（与 Kotlin 同名）：
 *   · comicRemoteCacheIdentity / comicRemoteCacheKey（L9-L24）
 *     —— 注意 Web 端 SHA-256 只有异步 API，故 key 函数为 async，identity 为同步；
 *        详见 core 文件头的「跳过说明」。
 *   · ComicTransferProgress / comicTransferProgress / comicTransferFraction（L26-L28）
 *   · ComicTransfers + ComicTransferHandle（L30-L41；StateFlow → 订阅式句柄）
 *   · ComicLoadLocks + ComicMutex（L43-L53；Mutex → promise 链）
 *
 * 跳过说明：无（本文件是纯 re-export，实现见 core）。
 */
export * from '@core/comic/comicLoadSupport'
