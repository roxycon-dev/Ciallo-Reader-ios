/**
 * `buildComicLayout`（`@core/comic/comicReaderCore` 版）的 **bookState 输入不变量** 护栏。
 *
 * ## 锁住什么
 *
 * `ComicReaderPage.tsx` 的 layout memo 只把 `mergeAnchors` 放进依赖，
 * 其余三个 `ComicBookState` 字段传 `EMPTY_COMIC_BOOK_STATE` 的默认值 ——
 * 这要求该 `buildComicLayout` **只读 `mergeAnchors`**。
 *
 * 依据是 Kotlin `ComicReaderCore.kt:359-362`：
 *
 * ```kotlin
 * val layout = remember(config.mode, ..., layoutBookState.mergeAnchors) {
 *     ComicPageLayout.build(pages, sizes, config, layoutBookState)
 * }
 * ```
 *
 * remember 的 key 只列 `mergeAnchors` —— 这**不是疏漏，是必需**：Kotlin 侧
 * L391 的 `LaunchedEffect(currentSpread, layout)` 会在 `bookKey != null` 时
 * `bookState = bookState.copy(lastPage = …)`，若 layout 的 key 含 `lastPage`
 * 就会 layout 重算 → effect 重跑 → 再 copy → 无限循环。
 *
 * TS 侧曾把整个 `bookState` 放进 `useMemo` 依赖，直接复现了这个死循环：
 * `ComicReaderPage` 一旦传入非空 `bookKey` 就在渲染中无限循环，
 * `comicSheetsWiring.test.tsx` 整个文件挂死 8 分钟。
 *
 * ## 注意：有两个同名函数，别搞混
 *
 * - `@core/comic/comicPageLayout` 的 `buildComicLayout(pages, Map, cfg, {mergeAnchors}?)`
 *   —— `sizes` 是 `ReadonlyMap<string, SizeI>`，`bookState` **可省**，
 *   由 `comicPageLayout.test.ts` 覆盖。
 * - `@core/comic/comicReaderCore` 的 `buildComicLayout(pages, Record, cfg, bookState)`
 *   —— `sizes` 是 `Readonly<Record<string, ComicSizeInfo>>`，`bookState` **必填**。
 *   **页面用的是这个**，本文件锁的是它。
 *
 * ## 为什么需要测试锁住
 *
 * 若将来有人给该函数加上对 `pageRotations` / `lastPage` / `lastChapterSig` 的读取，
 * **页面侧不会编译失败、也不会有任何 lint 报错**，只是布局在那些字段变化时
 * 不再更新（或再次陷入循环）。本文件把这种漂移变成红灯。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COMIC_READER_CONFIG,
  EMPTY_COMIC_BOOK_STATE,
  buildComicLayout,
  type ComicBookState,
  type ComicPageRef,
  type ComicSizeInfo,
} from '@core/comic/comicReaderCore';

function pages(n: number): ComicPageRef[] {
  return Array.from({ length: n }, (_unused, i) => ({
    kind: 'LOCAL' as const,
    id: `p${String(i + 1)}`,
    path: `local://p${String(i + 1)}`,
  }));
}

/** 4 张竖版页（800×1000，非宽页），让合页锚点有真实可观察的效果。 */
const SIZES: Readonly<Record<string, ComicSizeInfo>> = Object.fromEntries(
  Array.from({ length: 4 }, (_unused, i) => {
    const id = `p${String(i + 1)}`;
    return [id, { width: 800, height: 1000, gutter: false, gutterPos: null }];
  }),
);

const CONFIG = { ...DEFAULT_COMIC_READER_CONFIG, mode: 'DOUBLE' as const };

function layoutOf(bookState: ComicBookState) {
  return buildComicLayout(pages(4), SIZES, CONFIG, bookState);
}

/** 每个 spread 的槽 rawIndex 序列 —— 合页锚点会改变这个形状。 */
function shape(state: ComicBookState): (readonly number[])[] {
  return layoutOf(state).spreads.map((s) => s.slots.map((slot) => slot.rawIndex));
}

describe('buildComicLayout 只读 bookState.mergeAnchors（不变量护栏）', () => {
  it('改变 lastPage 不影响布局', () => {
    expect(shape({ ...EMPTY_COMIC_BOOK_STATE, lastPage: 3 })).toEqual(shape(EMPTY_COMIC_BOOK_STATE));
  });

  it('改变 lastChapterSig 不影响布局', () => {
    expect(shape({ ...EMPTY_COMIC_BOOK_STATE, lastChapterSig: 'p1' })).toEqual(
      shape(EMPTY_COMIC_BOOK_STATE),
    );
  });

  it('改变 pageRotations 不影响布局', () => {
    expect(shape({ ...EMPTY_COMIC_BOOK_STATE, pageRotations: { p1: 90, p2: 180 } })).toEqual(
      shape(EMPTY_COMIC_BOOK_STATE),
    );
  });

  it('三个字段同时改动也不影响布局', () => {
    expect(
      shape({
        lastPage: 2,
        lastChapterSig: 'p1',
        pageRotations: { p3: 270 },
        mergeAnchors: EMPTY_COMIC_BOOK_STATE.mergeAnchors,
      }),
    ).toEqual(shape(EMPTY_COMIC_BOOK_STATE));
  });

  it('对照：改变 mergeAnchors **确实**影响布局（证明上面几条不是恒真的空断言）', () => {
    // 必须在 **SINGLE** 模式：DOUBLE 下相邻两页本来就会配成一个 spread，
    // 合页与否的 rawIndex 序列恰好相同（实测 both = [[0,1],[2,3]]），
    // 那样这条断言就是恒真的、锁不住任何东西。
    // SINGLE 下每个原始页各占一个 spread，合页把它们并成一个 → 形状变化。
    const single = { ...CONFIG, mode: 'SINGLE' as const };
    const shapeOf = (bookState: ComicBookState): (readonly number[])[] =>
      buildComicLayout(pages(4), SIZES, single, bookState).spreads.map((s) =>
        s.slots.map((slot) => slot.rawIndex),
      );
    expect({
      without: shapeOf(EMPTY_COMIC_BOOK_STATE),
      withAnchor: shapeOf({ ...EMPTY_COMIC_BOOK_STATE, mergeAnchors: new Set([0]) }),
    }).toEqual({
      without: [[0], [1], [2], [3]],
      withAnchor: [[0, 1], [2], [3]],
    });
  });

  it('页面侧「只传 mergeAnchors」的构造方式与传完整 bookState 结果一致', () => {
    // 这条直接模拟 ComicReaderPage 的 memo 构造：非 mergeAnchors 字段取默认值。
    const full: ComicBookState = {
      lastPage: 3,
      lastChapterSig: 'p1',
      pageRotations: { p1: 90, p4: 270 },
      mergeAnchors: new Set([1]),
    };
    const minimized: ComicBookState = {
      ...EMPTY_COMIC_BOOK_STATE,
      mergeAnchors: full.mergeAnchors,
    };

    expect(buildComicLayout(pages(4), SIZES, CONFIG, minimized).spreads).toEqual(
      buildComicLayout(pages(4), SIZES, CONFIG, full).spreads,
    );
  });
});
