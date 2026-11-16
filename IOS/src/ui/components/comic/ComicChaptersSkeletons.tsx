/**
 * ComicChaptersSkeletons.tsx — `ui/ComicChaptersScreen.kt` L681-697 的两个目录骨架。
 *
 * Kotlin 原文（逐行）
 * ─────────────────
 *   L681-686
 *     @Composable private fun DirectoryHeadingSkeleton() {
 *         Box(Modifier.fillMaxWidth().height(32.dp), contentAlignment = Alignment.CenterStart) {
 *             WenkuSkeletonBlock(Modifier.fillMaxWidth(.36f).height(14.dp))
 *         }
 *     }
 *   L688-697
 *     @Composable private fun ComicDirectorySkeleton() {
 *         Column(
 *             Modifier.fillMaxWidth().padding(top = 16.dp),
 *             verticalArrangement = Arrangement.spacedBy(8.dp),
 *         ) {
 *             DirectoryHeadingSkeleton()
 *             repeat(4) { WenkuSkeletonBlock(Modifier.fillMaxWidth().height(56.dp)) }
 *         }
 *     }
 *
 * 生产调用点
 * ─────────
 *   `ComicChaptersScreen.kt:458`  `ComicDirectorySkeleton()`（`loadingDirectory == true` 时整块目录占位）
 *   `ComicChaptersScreen.kt:493`  `WenkuLoadingHandoff(loaded = true, skeleton = { DirectoryHeadingSkeleton() })`
 *   `ComicChaptersScreen.kt:694`  `ComicDirectorySkeleton()` 内部对 `DirectoryHeadingSkeleton()` 的调用
 *
 * 静态性
 * ─────
 * Kotlin `WenkuSkeletonBlock` 的注释（`WenkuMotion.kt` L567-568）写明骨架是**纯静态**占位：
 * 无 shimmer / 无重复 ticker / 无滤镜。这里 `comicChrome.css` 的 `.cc-skel-*` 同样只有
 * 尺寸、间距、圆角与底色，没有任何 `@keyframes` 或 animation。
 *
 * 元素计数（供 `tests/unit/loadingHandoffSkeletons.test.tsx` 对齐）
 * ────────────────────────────────────────────────────────
 *   DirectoryHeadingSkeleton : 1 个 `WenkuSkeletonBlock`
 *   ComicDirectorySkeleton   : 1 个标题骨架 + 4 个 56px 块 = 5 个 `WenkuSkeletonBlock`
 */

import { WenkuSkeletonBlock } from '@ui/components/wenku/WenkuLoadingHandoff';
import '../../../styles/comicChrome.css';

/** `WenkuSkeletonBlock` 在 DOM 上的计数锚点（`data-wenku-skeleton`），避免测试依赖 class 名。 */
export const COMIC_DIRECTORY_SKELETON_ROWS = 4;
/** `ComicChaptersScreen.kt` L695 `height(56.dp)`。 */
export const COMIC_DIRECTORY_SKELETON_ROW_HEIGHT_PX = 56;
/** `ComicChaptersScreen.kt` L691 `padding(top = 16.dp)`。 */
export const COMIC_DIRECTORY_SKELETON_TOP_PADDING_PX = 16;
/** `ComicChaptersScreen.kt` L692 `spacedBy(8.dp)`。 */
export const COMIC_DIRECTORY_SKELETON_GAP_PX = 8;
/** `ComicChaptersScreen.kt` L683 `height(32.dp)`。 */
export const DIRECTORY_HEADING_SKELETON_HEIGHT_PX = 32;
/** `ComicChaptersScreen.kt` L684 `fillMaxWidth(.36f)`。 */
export const DIRECTORY_HEADING_SKELETON_BAR_WIDTH = 0.36;
/** `ComicChaptersScreen.kt` L684 `height(14.dp)`。 */
export const DIRECTORY_HEADING_SKELETON_BAR_HEIGHT_PX = 14;

export interface SkeletonProps {
  /** Kotlin `modifier` 的 className 部分（调用点可加 `wenkuPagePart(n)` 之类）。 */
  readonly className?: string;
}

/**
 * 目录区块头（`"02 / CONTENTS"` 那一行）的骨架：32px 高容器内，左侧 36% 宽 × 14px 的块。
 *
 * Kotlin: `ui/ComicChaptersScreen.kt` L681-686。
 */
export function DirectoryHeadingSkeleton(props: SkeletonProps) {
  const classNames = ['cc-skel-heading'];
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);
  return (
    <div className={classNames.join(' ')} data-cc-skeleton="heading" aria-hidden="true">
      <WenkuSkeletonBlock className="cc-skel-heading__bar" />
    </div>
  );
}

/**
 * 漫画目录加载骨架：标题骨架 + 4 条 56px 章节卡片占位，间距 8px，顶部内边距 16px。
 *
 * Kotlin: `ui/ComicChaptersScreen.kt` L688-697（调用点 L458 / L694）。
 */
export function ComicDirectorySkeleton(props: SkeletonProps) {
  const classNames = ['cc-skel-directory'];
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);
  return (
    <div className={classNames.join(' ')} data-cc-skeleton="directory" aria-hidden="true">
      <DirectoryHeadingSkeleton />
      {Array.from({ length: COMIC_DIRECTORY_SKELETON_ROWS }, (_unused, index) => (
        <WenkuSkeletonBlock
          key={`cc-skel-row-${String(index)}`}
          className="cc-skel-directory__row"
        />
      ))}
    </div>
  );
}

export default ComicDirectorySkeleton;
