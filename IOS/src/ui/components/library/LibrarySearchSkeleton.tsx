/**
 * LibrarySearchSkeleton.tsx — `library/LibraryScreen.kt` L1169-1186 的搜索骨架。
 *
 * Kotlin 原文（逐行）
 * ─────────────────
 *   L1169-1186
 *     @Composable private fun LibrarySearchSkeleton() {
 *         Column(
 *             Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
 *             verticalArrangement = Arrangement.spacedBy(16.dp)
 *         ) {
 *             repeat(4) {
 *                 Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
 *                     WenkuSkeletonBlock(Modifier.size(66.dp, 96.dp))
 *                     Column(Modifier.weight(1f).padding(top = 10.dp),
 *                            verticalArrangement = Arrangement.spacedBy(10.dp)) {
 *                         WenkuSkeletonBlock(Modifier.fillMaxWidth(.72f).height(16.dp))
 *                         WenkuSkeletonBlock(Modifier.fillMaxWidth(.43f).height(10.dp))
 *                         WenkuSkeletonBlock(Modifier.fillMaxWidth(.85f).height(10.dp))
 *                     }
 *                 }
 *             }
 *         }
 *     }
 *
 * 生产调用点
 * ─────────
 *   `LibraryScreen.kt:741`  `WenkuLoadingHandoff(loading = isSearching, contentKey = Triple(…),
 *                              modifier = Modifier.fillMaxSize(), skeleton = { LibrarySearchSkeleton() })`
 *   （即 `WenkuMotion.kt` L581-601 的 alpha 版交接 → iOS `WenkuLoadingHandoffFade`）
 *
 * 元素计数（供测试对齐）：4 组 × (1 封面块 + 3 文本块) = **16** 个 `WenkuSkeletonBlock`。
 *
 * 静态性：同 `ComicChaptersSkeletons.tsx` —— Kotlin 骨架块是纯静态占位（`WenkuMotion.kt`
 * L567-568），`library.css` 的 `.lib-search-skel*` 不含任何 keyframes / 扫光 / 脉冲。
 */

import { WenkuSkeletonBlock } from '@ui/components/wenku/WenkuLoadingHandoff';
import '../../../styles/library.css';

/** `LibraryScreen.kt` L1175 `repeat(4)`。 */
export const LIBRARY_SEARCH_SKELETON_ROWS = 4;
/** `LibraryScreen.kt` L1172 `padding(horizontal = 20.dp, vertical = 8.dp)`。 */
export const LIBRARY_SEARCH_SKELETON_PADDING_X_PX = 20;
export const LIBRARY_SEARCH_SKELETON_PADDING_Y_PX = 8;
/** `LibraryScreen.kt` L1173 `spacedBy(16.dp)`。 */
export const LIBRARY_SEARCH_SKELETON_GAP_PX = 16;
/** `LibraryScreen.kt` L1176 `spacedBy(14.dp)`。 */
export const LIBRARY_SEARCH_SKELETON_ROW_GAP_PX = 14;
/** `LibraryScreen.kt` L1177 `size(66.dp, 96.dp)`。 */
export const LIBRARY_SEARCH_SKELETON_COVER_WIDTH_PX = 66;
export const LIBRARY_SEARCH_SKELETON_COVER_HEIGHT_PX = 96;
/** `LibraryScreen.kt` L1178 `padding(top = 10.dp)` 与 `spacedBy(10.dp)`。 */
export const LIBRARY_SEARCH_SKELETON_TEXT_TOP_PADDING_PX = 10;
export const LIBRARY_SEARCH_SKELETON_TEXT_GAP_PX = 10;
/** `LibraryScreen.kt` L1179-1181 三条文本块的宽度比例与高度。 */
export const LIBRARY_SEARCH_SKELETON_TITLE_WIDTH = 0.72;
export const LIBRARY_SEARCH_SKELETON_TITLE_HEIGHT_PX = 16;
export const LIBRARY_SEARCH_SKELETON_SOURCE_WIDTH = 0.43;
export const LIBRARY_SEARCH_SKELETON_META_WIDTH = 0.85;
export const LIBRARY_SEARCH_SKELETON_LINE_HEIGHT_PX = 10;

export interface LibrarySearchSkeletonProps {
  /** Kotlin `modifier` 的 className 部分。 */
  readonly className?: string;
}

/**
 * 书库搜索结果骨架：4 组「66×96 封面块 + 72%/43%/85% × 16/10/10 文本块」。
 *
 * Kotlin: `library/LibraryScreen.kt` L1169-1186 · 调用点 `LibraryScreen.kt:741`。
 */
export function LibrarySearchSkeleton(props: LibrarySearchSkeletonProps) {
  const classNames = ['lib-search-skel'];
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);
  return (
    <div className={classNames.join(' ')} data-lib-skeleton="search" aria-hidden="true">
      {Array.from({ length: LIBRARY_SEARCH_SKELETON_ROWS }, (_unused, index) => (
        <div className="lib-search-skel__row" key={`lib-search-skel-row-${String(index)}`}>
          <WenkuSkeletonBlock className="lib-search-skel__cover" />
          <div className="lib-search-skel__lines">
            <WenkuSkeletonBlock className="lib-search-skel__title" />
            <WenkuSkeletonBlock className="lib-search-skel__source" />
            <WenkuSkeletonBlock className="lib-search-skel__meta" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default LibrarySearchSkeleton;
