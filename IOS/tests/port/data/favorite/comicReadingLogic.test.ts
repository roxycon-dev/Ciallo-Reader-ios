/**
 * Port of `novel-reader/app/src/test/java/com/example/data/favorite/ComicReadingLogicTest.kt`
 * (241 lines / 18 `@Test` functions) to `src/core/library/comicReadingLogic.ts`
 * (port of `com/example/data/favorite/ComicReadingLogic.kt`).
 *
 * Every Android `@Test` is reproduced one-for-one; Kotlin `assertEquals(expected, actual)`
 * becomes `expect(actual).toBe(expected)`, i.e. the ARGUMENTS ARE FLIPPED on purpose.
 */

import { describe, expect, it } from 'vitest';
import {
  continueLabel,
  isFinished,
  isNewChapterObserved,
  navigation,
  newChapterIds,
  ordered,
  readRatio,
  resolveContinue,
  chapterNumber,
  unreadCount,
  type ContinueTarget,
} from '../../../../src/core/library/comicReadingLogic';
import { ChapterReadState, type ChapterReadStateCode } from '../../../../src/core/library/favoriteTypes';
import type { ComicProgressEntity } from '../../../../src/core/library/favoriteTypes';
// `ComicChapter` 声明在 `comicSourceTypes.ts`（favoriteTypes 只是 import 它、
// 没有再导出），所以这里必须从真正的声明处导入。
import type { ComicChapter } from '../../../../src/core/library/comicSourceTypes';

/** Kotlin L14-15 `private fun ch(id, title, order = 0f) = ComicChapter(id, title, order)`. */
function ch(id: string, title: string, order = 0): ComicChapter {
  return {
    id,
    title,
    volume: null,
    order,
    external: false,
    externalUrl: null,
  };
}

function progress(overrides: Partial<ComicProgressEntity>): ComicProgressEntity {
  return {
    sourceId: 's',
    comicId: 'c',
    lastChapterId: null,
    lastChapterIndex: -1,
    lastPageIndex: 0,
    lastPageCount: 0,
    lastReadAt: 0,
    seenTopChapterId: null,
    seenChapterCount: 0,
    ...overrides,
  };
}

function stateMap(
  entries: Array<[string, ChapterReadStateCode]>,
): Map<string, ChapterReadStateCode> {
  return new Map(entries);
}

describe('ComicReadingLogicTest — ordered', () => {
  // Kotlin L18 `ordered 把倒序列表归一化成阅读顺序`
  it('ordered 把倒序列表归一化成阅读顺序', () => {
    const chapters = [
      ch('c3', '第 3 话', 3),
      ch('c1', '第 1 话', 1),
      ch('c2', '第 2 话', 2),
    ];
    const seq = ordered(chapters);
    expect(seq.map((it) => it.chapter.id)).toEqual(['c1', 'c2', 'c3']);
    expect(seq.map((it) => it.order)).toEqual([0, 1, 2]);
  });

  // Kotlin L30 `源没给 order 时退化为列表下标`
  it('源没给 order 时退化为列表下标', () => {
    const chapters = [ch('a', '第 1 话'), ch('b', '第 2 话')];
    const seq = ordered(chapters);
    expect(seq.map((it) => it.chapter.id)).toEqual(['a', 'b']);
  });
});

describe('ComicReadingLogicTest — navigation', () => {
  // Kotlin L36 `readerNavigationFollowsSourceOrderIncludingZeroAndFractionalChapters`
  it('readerNavigationFollowsSourceOrderIncludingZeroAndFractionalChapters', () => {
    const sequence = [
      ch('c0', '序章', 0),
      ch('c1', '第1话', 1),
      ch('extra', '番外', 1.5),
      ch('c4', '第4话', 4),
    ];
    // Kotlin L39: the same sequence in three different source layouts.
    for (const sourceList of [
      sequence,
      [...sequence].reverse(),
      [sequence[2] as ComicChapter, sequence[3] as ComicChapter, sequence[0] as ComicChapter, sequence[1] as ComicChapter],
    ]) {
      sequence.forEach((chapter, index) => {
        const nav = navigation(sourceList, chapter.id);
        expect(nav.chapters).toEqual(sequence);
        expect(nav.currentIndex).toBe(index);
        expect(nav.previous).toEqual(sequence[index - 1] ?? null);
        expect(nav.next).toEqual(sequence[index + 1] ?? null);
        expect(nav.chapters[index]).toEqual(chapter);
      });
    }
  });

  // Kotlin L51 `readerNavigationCannotSwitchFromAnUnknownChapter`
  it('readerNavigationCannotSwitchFromAnUnknownChapter', () => {
    for (const sourceList of [[], [ch('c1', '第1话', 1)]]) {
      for (const id of [null, 'missing']) {
        const nav = navigation(sourceList, id);
        expect(nav.currentIndex).toBe(-1);
        expect(nav.previous).toBeNull();
        expect(nav.next).toBeNull();
      }
    }
  });

  // Kotlin L62 `readerNavigationPreservesSourcesWithoutOrderMetadata`
  it('readerNavigationPreservesSourcesWithoutOrderMetadata', () => {
    const chapters = [ch('a', '序章'), ch('b', '第一话'), ch('c', '番外')];
    const nav = navigation(chapters, 'b');
    expect(nav.chapters).toEqual(chapters);
    expect(nav.previous).toEqual(chapters[0] as ComicChapter);
    expect(nav.next).toEqual(chapters[2] as ComicChapter);
  });
});

describe('ComicReadingLogicTest — resolveContinue', () => {
  // Kotlin L71 `缺章时下一话按源顺序索引计算`
  it('缺章时下一话按源顺序索引计算', () => {
    // order 1、2、5（中间 3、4 被删）——下一话必须是 5 而不是"下标+1"
    const chapters = [ch('c5', '第 5 话', 5), ch('c2', '第 2 话', 2), ch('c1', '第 1 话', 1)];
    const target = resolveContinue(
      chapters,
      stateMap([['c2', ChapterReadState.READ]]),
      progress({
        lastChapterId: 'c2',
        lastChapterIndex: 1,
        lastPageIndex: 0,
        lastPageCount: 10,
      }),
    );
    expect(target.kind).toBe('next');
    expect((target as Extract<ContinueTarget, { kind: 'next' }>).chapterIndex).toBe(2);
    expect(ordered(chapters)[(target as Extract<ContinueTarget, { kind: 'next' }>).chapterIndex]?.chapter.id).toBe('c5');
  });

  // Kotlin L93 `未读完回到上次章节与页码`
  it('未读完回到上次章节与页码', () => {
    const chapters = [ch('c1', '第 1 话', 1), ch('c2', '第 2 话', 2)];
    const target = resolveContinue(
      chapters,
      stateMap([['c1', ChapterReadState.READING]]),
      progress({
        lastChapterId: 'c1',
        lastChapterIndex: 0,
        lastPageIndex: 7,
        lastPageCount: 20,
      }),
    );
    expect(target.kind).toBe('resume');
    const resume = target as Extract<ContinueTarget, { kind: 'resume' }>;
    expect(resume.chapterIndex).toBe(0);
    expect(resume.pageIndex).toBe(7);
    expect(continueLabel(target, chapters)).toContain('第8页');
  });

  // Kotlin L108 `读到最后一话后返回已读到最新`
  it('读到最后一话后返回已读到最新', () => {
    const chapters = [ch('c1', '第 1 话', 1), ch('c2', '第 2 话', 2)];
    const target = resolveContinue(
      chapters,
      stateMap([['c2', ChapterReadState.READ]]),
      progress({
        lastChapterId: 'c2',
        lastChapterIndex: 1,
        lastPageIndex: 9,
        lastPageCount: 10,
      }),
    );
    expect(target).toEqual({ kind: 'upToDate' });
    expect(continueLabel(target, chapters)).toBe('已读到最新');
  });

  // Kotlin L120 `没读过则是开始阅读`
  it('没读过则是开始阅读', () => {
    const chapters = [ch('c1', '第 1 话', 1)];
    const target = resolveContinue(chapters, new Map(), null);
    expect(target).toEqual({ kind: 'start' });
    expect(continueLabel(target, chapters)).toBe('开始阅读');
  });

  // Kotlin L128 `上次章节被源删除时退化到第一条未读`
  it('上次章节被源删除时退化到第一条未读', () => {
    const chapters = [ch('c1', '第 1 话', 1), ch('c2', '第 2 话', 2)];
    const target = resolveContinue(
      chapters,
      stateMap([['c1', ChapterReadState.READ]]),
      progress({
        lastChapterId: 'gone',
        lastChapterIndex: 0,
        lastPageIndex: 0,
        lastPageCount: 0,
      }),
    );
    expect(target.kind).toBe('next');
    expect((target as Extract<ContinueTarget, { kind: 'next' }>).chapterIndex).toBe(1);
  });
});

describe('ComicReadingLogicTest — isFinished / newChapterIds / chapterNumber', () => {
  // Kotlin L142 `已读判定为最后一页或进度九成`
  it('已读判定为最后一页或进度九成', () => {
    expect(isFinished(9, 10)).toBe(true);
    expect(isFinished(8, 10)).toBe(true); // 9/10 = 90%
    expect(isFinished(6, 10)).toBe(false);
    expect(isFinished(0, 0)).toBe(false);
  });

  // Kotlin L150 `新章节按快照 id 之后的部分判定`
  it('新章节按快照 id 之后的部分判定', () => {
    const chapters = [ch('c1', '第 1 话', 1), ch('c2', '第 2 话', 2), ch('c3', '第 3 话', 3)];
    expect(newChapterIds(chapters, progress({ seenTopChapterId: 'c1', seenChapterCount: 1 }))).toEqual(
      new Set(['c2', 'c3']),
    );
  });

  // Kotlin L159 `快照失效时按章节数增量兜底`
  it('快照失效时按章节数增量兜底', () => {
    const chapters = [ch('c1', '第 1 话', 1), ch('c2', '第 2 话', 2), ch('c3', '第 3 话', 3)];
    expect(newChapterIds(chapters, progress({ seenTopChapterId: 'gone', seenChapterCount: 2 }))).toEqual(
      new Set(['c3']),
    );
  });

  // Kotlin L168 `话数解析用于继续阅读文案`
  it('话数解析用于继续阅读文案', () => {
    expect(chapterNumber('第 12 话')).toBe(12);
    expect(chapterNumber('第12话')).toBe(12);
    expect(chapterNumber('Chapter 7')).toBe(7);
    expect(chapterNumber('番外')).toBeNull();
  });
});

describe('ComicReadingLogicTest — isNewChapterObserved', () => {
  // Kotlin L176 `更新检测 话数相同不算新话（id 不稳定源）`
  it('更新检测 话数相同不算新话（id 不稳定源）', () => {
    // 有的源每次拉取 chapterId 都不同：id 变了但话数没涨 = 同一话，不算更新
    const top = ordered([ch('c12-v2', '第 12 话')]).at(-1) ?? null;
    expect(isNewChapterObserved('c12-v1', '第 12 话', top)).toBe(false);
  });

  // Kotlin L187 `更新检测 话数涨了算新话`
  it('更新检测 话数涨了算新话', () => {
    const top = ordered([ch('c13', '第 13 话')]).at(-1) ?? null;
    expect(isNewChapterObserved('c12', '第 12 话', top)).toBe(true);
  });

  // Kotlin L197 `更新检测 id 相同不算新话`
  it('更新检测 id 相同不算新话', () => {
    const top = ordered([ch('c12', '第 12 话')]).at(-1) ?? null;
    expect(isNewChapterObserved('c12', '第 12 话', top)).toBe(false);
  });

  // Kotlin L207 `更新检测 话数解析不到时退回 id 比较`
  it('更新检测 话数解析不到时退回 id 比较', () => {
    // 新旧标题都解析不出话数：id 不同只能当更新（宁可误报不可漏报）
    const top = ordered([ch('x2', '番外')]).at(-1) ?? null;
    expect(isNewChapterObserved('x1', '番外篇', top)).toBe(true);
  });

  // Kotlin L218 `更新检测 首次观察与空章节`
  it('更新检测 首次观察与空章节', () => {
    // 从没抓到过快照 → 首次观察到算"有"（要推进更新时间）
    const top = ordered([ch('c1', '第 1 话')]).at(-1) ?? null;
    expect(isNewChapterObserved(null, null, top)).toBe(true);
    // 源没返回章节 → 算没有
    expect(isNewChapterObserved('c1', '第 1 话', null)).toBe(false);
  });
});

// Kotlin L235 `未读话数与已读占比`
it('未读话数与已读占比', () => {
  const chapters = [ch('c1', '第 1 话', 1), ch('c2', '第 2 话', 2), ch('c3', '第 3 话', 3)];
  const states = stateMap([
    ['c1', ChapterReadState.READ],
    ['c2', ChapterReadState.READING],
  ]);
  expect(unreadCount(chapters, states)).toBe(2);
  // Kotlin `assertEquals(1f / 3f, readRatio(...), 1e-5f)` → the third arg is the delta.
  expect(readRatio(chapters, states)).toBeCloseTo(1 / 3, 5);
});
