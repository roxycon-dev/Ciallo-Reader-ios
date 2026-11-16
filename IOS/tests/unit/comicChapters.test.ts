/**
 * Unit tests for `src/core/comic/comicChapters.ts` — port of Android
 * `com/example/ui/ComicChaptersScreen.kt` (1568 lines).
 *
 * Every assertion here maps to a specific Kotlin line in that file; the line
 * reference is in each test name so a reviewer can diff the two side by side.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  BOOKMARK_COMMIT_THRESHOLD,
  BOOKMARK_DRAG_LIMIT,
  ChapterVisual,
  ComicChaptersStore,
  ComicDownloadStore,
  ComicHighlightStore,
  DEFAULT_ESTIMATED_CHAPTER_SIZE_MB,
  GodGold,
  GodGoldStroke,
  GodScrimBase,
  LIST_HEADER_ITEMS,
  LONG_PRESS_TIMEOUT_MS,
  METADATA_ALIAS_PREVIEW,
  METADATA_TAG_PREVIEW,
  QUICK_SELECT_LAST,
  TOUCH_SLOP,
  allChapterIdsOf,
  chapterCardSpecOf,
  chapterCaptionOf,
  chapterNumberOf,
  chapterProgressOf,
  chapterSemanticsLabelOf,
  chaptersInSelection,
  comicDetailTargetFromKey,
  comicDownloadStore,
  comicHighlightStore,
  comicMetadataIsEmpty,
  comicMetadataModelOf,
  comicPagePath,
  continueButtonLabelOf,
  continueTargetChapterOf,
  continueTargetOf,
  descriptionNeedsToggle,
  displayChaptersOf,
  downloadButtonLabelOf,
  downloadOverlayPercentOf,
  downloadOverlayTitleOf,
  focusIndexOf,
  formatDecimal1,
  godCaptionOf,
  godChapterIdsOf,
  godChapterTitleOf,
  godListOf,
  godRatingTextOf,
  heroAuthorLineOf,
  heroBadgeOf,
  heroComicIdLineOf,
  heroDescriptionOf,
  heroTitleOf,
  imageExtensionOf,
  infoRowLabelOf,
  latestChapterListItemIndex,
  listItemIndexOf,
  metadataStatusLabelOf,
  metadataTagNameOf,
  newChapterIdSetOf,
  normalChaptersOf,
  orderedOf,
  quickInvert,
  quickSelectLastTen,
  quickSelectUnread,
  readCountOf,
  resolveComicDetailTarget,
  rowIndexOf,
  stateOnlyOf,
  takeComicDetailTarget,
  setComicDetailTarget,
  toVisualOf,
  toggleSelected,
  type ChapterCardSpecInput,
  type ComicChaptersPorts,
  type ComicDetailTarget,
} from '../../src/core/comic/comicChapters';
import type { ComicChapter, SearchBook } from '../../src/core/library/comicSourceTypes';
import { createSearchBook } from '../../src/core/library/comicSourceTypes';
import { ChapterReadState } from '../../src/core/library/favoriteTypes';
import type { ChapterReadEntity, ComicProgressEntity } from '../../src/core/library/favoriteTypes';
import type { OrderedChapter } from '../../src/core/library/comicReadingLogic';
import { cropParamsToTag, DEFAULT_CROP_PARAMS, type GodMoment } from '../../src/core/god/godTypes';

function chapter(id: string, title: string, overrides: Partial<ComicChapter> = {}): ComicChapter {
  return {
    id,
    title,
    volume: null,
    order: 0,
    external: false,
    externalUrl: null,
    ...overrides,
  };
}

/**
 * `chapterNumberOf(chapter, entry)` 只读 `entry.order`（见 comicChapters.ts L484
 * `chapterNumber(chapter.title) ?? entry.order + 1`），但 `OrderedChapter` 是完整结构，
 * 这里按 `comicReadingLogic.ordered()` 的同名字段填齐，其余字段与被测分支无关。
 */
function entry(chapter: ComicChapter, order: number): OrderedChapter {
  return { rawIndex: order, order, chapter, orderKey: order, displayNumber: order + 1 };
}

function chapters(count: number): ComicChapter[] {
  return Array.from({ length: count }, (_unused, index) =>
    chapter(`c${String(index + 1)}`, `第${String(index + 1)}话`),
  );
}

function readState(
  chapterId: string,
  status: number,
  overrides: Partial<ChapterReadEntity> = {},
): ChapterReadEntity {
  return {
    sourceId: 'src',
    comicId: 'cid',
    chapterId,
    status,
    pageIndex: 0,
    pageCount: 0,
    chapterIndex: 0,
    updatedAt: 0,
    bookmarked: false,
    ...overrides,
  };
}

function progress(overrides: Partial<ComicProgressEntity> = {}): ComicProgressEntity {
  return {
    sourceId: 'src',
    comicId: 'cid',
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

function moment(chapterId: string, createdAt: number, overrides: Partial<GodMoment> = {}): GodMoment {
  return {
    id: createdAt,
    contentType: 'comic',
    bookId: 'src::cid',
    chapterId,
    bookTitle: '书名',
    chapterTitle: '',
    chapterNumber: 1,
    title: '',
    titleIsCustom: false,
    rating: 5,
    note: '',
    coverPath: null,
    coverSource: 'page|0|',
    cropParams: cropParamsToTag(DEFAULT_CROP_PARAMS),
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

const book: SearchBook = createSearchBook({
  id: 'cid',
  sourceId: 'src',
  title: '测试漫画',
  author: '作者甲',
  cover: 'https://example.invalid/cover.jpg',
  comicId: ' 42 ',
  language: 'ja',
});

describe('Kotlin 93–100 / 159 — constants', () => {
  it('keeps the god-moment palette and LIST_HEADER_ITEMS = 3 verbatim', () => {
    expect(GodGold).toBe('#E8C56A');
    expect(GodGoldStroke).toBe('rgba(232, 197, 106, 0.55)');
    expect(GodScrimBase).toBe('#0E121E');
    expect(LIST_HEADER_ITEMS).toBe(3);
    expect(DEFAULT_ESTIMATED_CHAPTER_SIZE_MB).toBe(2.0);
  });

  it('keeps the gesture and preview constants verbatim', () => {
    expect(BOOKMARK_DRAG_LIMIT).toBe(140);
    expect(BOOKMARK_COMMIT_THRESHOLD).toBe(40);
    expect(LONG_PRESS_TIMEOUT_MS).toBe(500);
    expect(TOUCH_SLOP).toBe(8);
    expect(QUICK_SELECT_LAST).toBe(10);
    expect(METADATA_ALIAS_PREVIEW).toBe(3);
    expect(METADATA_TAG_PREVIEW).toBe(6);
  });
});

describe('Kotlin 67–73 — ChapterVisual / toVisualOf', () => {
  it('maps each read state to its visual (READ → READ)', () => {
    expect(toVisualOf(ChapterReadState.READ)).toBe(ChapterVisual.READ);
    expect(toVisualOf(ChapterReadState.READING)).toBe(ChapterVisual.READING);
    expect(toVisualOf(ChapterReadState.UNREAD)).toBe(ChapterVisual.UNREAD);
  });

  it('falls back to UNREAD for an unknown state', () => {
    expect(toVisualOf(undefined)).toBe(ChapterVisual.UNREAD);
    expect(toVisualOf(99 as never)).toBe(ChapterVisual.UNREAD);
  });
});

describe('Kotlin 163–191 — list model', () => {
  it('stateOnlyOf demotes entities to state codes', () => {
    const states = new Map([
      ['c1', readState('c1', ChapterReadState.READ)],
      ['c2', readState('c2', ChapterReadState.READING)],
    ]);
    const only = stateOnlyOf(states);
    expect(only.get('c1')).toBe(ChapterReadState.READ);
    expect(only.get('c2')).toBe(ChapterReadState.READING);
    expect(only.size).toBe(2);
  });

  it('displayChaptersOf reverses only when sortDesc (L173–175)', () => {
    const ordered = orderedOf(chapters(3));
    expect(displayChaptersOf(ordered, false).map((e) => e.chapter.id)).toEqual(['c1', 'c2', 'c3']);
    expect(displayChaptersOf(ordered, true).map((e) => e.chapter.id)).toEqual(['c3', 'c2', 'c1']);
  });

  it('godListOf sorts god moments by createdAt ascending (L187)', () => {
    const map = new Map([
      ['c3', moment('c3', 300)],
      ['c1', moment('c1', 100)],
      ['c2', moment('c2', 200)],
    ]);
    expect(godListOf(map).map((g) => g.chapterId)).toEqual(['c1', 'c2', 'c3']);
  });

  it('normalChaptersOf drops god chapters so they never render twice (L189–191)', () => {
    const godList = godListOf(new Map([['c2', moment('c2', 100)]]));
    const ids = godChapterIdsOf(godList);
    expect([...ids]).toEqual(['c2']);
    expect(normalChaptersOf(orderedOf(chapters(3)), ids).map((e) => e.chapter.id)).toEqual([
      'c1',
      'c3',
    ]);
  });

  it('rowIndexOf puts god rows first then normal rows, -1 when missing (L194–200)', () => {
    const godList = godListOf(new Map([['c2', moment('c2', 100)]]));
    const normal = normalChaptersOf(orderedOf(chapters(3)), godChapterIdsOf(godList));
    expect(rowIndexOf('c2', godList, normal)).toBe(0);
    expect(rowIndexOf('c1', godList, normal)).toBe(1);
    expect(rowIndexOf('nope', godList, normal)).toBe(-1);
  });

  it('listItemIndexOf adds the three fixed header items and returns -1 when absent (L206)', () => {
    const godList = godListOf(new Map([['c2', moment('c2', 100)]]));
    const normal = normalChaptersOf(orderedOf(chapters(3)), godChapterIdsOf(godList));
    expect(listItemIndexOf('c2', godList, normal)).toBe(LIST_HEADER_ITEMS);
    expect(listItemIndexOf('missing', godList, normal)).toBe(-1);
  });

  it('latestChapterListItemIndex jumps to the newest visible normal row (L551–553)', () => {
    const godList = godListOf(new Map([['c2', moment('c2', 100)]]));
    const normal = normalChaptersOf(orderedOf(chapters(4)), godChapterIdsOf(godList));
    // 倒序：下标 0（最新那话排在最前）
    expect(latestChapterListItemIndex(true, godList, normal)).toBe(1 + 0 + LIST_HEADER_ITEMS);
    // 正序：最后一条
    expect(latestChapterListItemIndex(false, godList, normal)).toBe(1 + 2 + LIST_HEADER_ITEMS);
  });

  it('readCountOf counts only READ chapters (L241)', () => {
    const ordered = orderedOf(chapters(4));
    const stateOnly = stateOnlyOf(
      new Map([
        ['c1', readState('c1', ChapterReadState.READ)],
        ['c2', readState('c2', ChapterReadState.READING)],
        ['c3', readState('c3', ChapterReadState.READ)],
      ]),
    );
    expect(readCountOf(ordered, stateOnly)).toBe(2);
  });

  it('focusIndexOf prefers the continue target, then a READING row, then 0 (L219–224)', () => {
    const ordered = orderedOf(chapters(4));
    const reading = stateOnlyOf(new Map([['c3', readState('c3', ChapterReadState.READING)]]));
    expect(focusIndexOf({ kind: 'resume', chapterIndex: 2, pageIndex: 4 }, ordered, reading)).toBe(2);
    expect(focusIndexOf({ kind: 'next', chapterIndex: 1 }, ordered, reading)).toBe(1);
    expect(focusIndexOf({ kind: 'upToDate' }, ordered, reading)).toBe(2);
    expect(focusIndexOf({ kind: 'start' }, ordered, new Map())).toBe(0);
  });
});

describe('Kotlin 255–258 / 607–626 / 708–712 — multi-select', () => {
  it('toggleSelected adds then removes, matching the Kotlin if/else', () => {
    const once = toggleSelected(new Set<string>(), 'c1');
    expect([...once]).toEqual(['c1']);
    expect([...toggleSelected(once, 'c1')]).toEqual([]);
  });

  it('allChapterIdsOf mirrors ordered.map { it.chapter.id } (L296)', () => {
    expect(allChapterIdsOf(orderedOf(chapters(3)))).toEqual(['c1', 'c2', 'c3']);
  });

  it('quickSelectUnread keeps every chapter that is not READ (L610–612)', () => {
    const ordered = orderedOf(chapters(4));
    const stateOnly = stateOnlyOf(
      new Map([
        ['c1', readState('c1', ChapterReadState.READ)],
        ['c3', readState('c3', ChapterReadState.READ)],
      ]),
    );
    expect(quickSelectUnread(ordered, stateOnly)).toEqual(['c2', 'c4']);
  });

  it('quickSelectLastTen takes the last ten of the reading order (L618)', () => {
    expect(quickSelectLastTen(orderedOf(chapters(3)))).toEqual(['c1', 'c2', 'c3']);
    const many = quickSelectLastTen(orderedOf(chapters(25)));
    expect(many).toHaveLength(QUICK_SELECT_LAST);
    expect(many[0]).toBe('c16');
    expect(many[QUICK_SELECT_LAST - 1]).toBe('c25');
  });

  it('quickInvert preserves reading order and excludes the selected set (L622–625)', () => {
    const ordered = orderedOf(chapters(4));
    expect(quickInvert(ordered, new Set(['c2', 'c4']))).toEqual(['c1', 'c3']);
  });

  it('chaptersInSelection keeps the source list order (L346)', () => {
    const list = chapters(3);
    expect(chaptersInSelection(list, new Set(['c3', 'c1'])).map((c) => c.id)).toEqual(['c1', 'c3']);
  });
});

describe('Kotlin 358–380 / 420–443 / 496–513 — button and row labels', () => {
  it('formatDecimal1 matches String.format(Locale.US, "%.1f") (L371 / L1218)', () => {
    expect(formatDecimal1(6)).toBe('6.0');
    expect(formatDecimal1(0.25)).toBe('0.3');
  });

  it('downloadButtonLabelOf switches on the selected count (L359–373)', () => {
    expect(downloadButtonLabelOf(0)).toEqual({ strong: '选择要下载的章节', soft: '' });
    expect(downloadButtonLabelOf(3)).toEqual({ strong: '下载 3 话', soft: '  约 6.0 MB' });
    expect(downloadButtonLabelOf(3, 1.25)).toEqual({ strong: '下载 3 话', soft: '  约 3.8 MB' });
  });

  it('continueButtonLabelOf shows 第 1 话 when there is nothing to read (L434)', () => {
    expect(continueButtonLabelOf({ kind: 'start' }, [])).toEqual({
      strong: '继续阅读 ',
      soft: '第 1 话',
    });
  });

  it('continueButtonLabelOf renders 第 N 话 · P M for a resume target (L430–432)', () => {
    const ordered = orderedOf(chapters(3));
    expect(continueButtonLabelOf({ kind: 'resume', chapterIndex: 1, pageIndex: 4 }, ordered)).toEqual({
      strong: '继续阅读 ',
      soft: '第 2 话 · P5',
    });
  });

  it('continueButtonLabelOf uses the list index when the title has no number (L431)', () => {
    const ordered = orderedOf([chapter('c1', '序章'), chapter('c2', '无数字标题')]);
    expect(continueButtonLabelOf({ kind: 'next', chapterIndex: 1 }, ordered).soft).toBe('第 2 话 · P1');
  });

  it('continueTargetChapterOf maps each ContinueTarget branch (L244–253)', () => {
    const ordered = orderedOf(chapters(3));
    expect(continueTargetChapterOf({ kind: 'start' }, ordered)).toEqual({
      chapter: ordered[0]?.chapter,
      page: 0,
    });
    const resumed = continueTargetChapterOf({ kind: 'resume', chapterIndex: 2, pageIndex: 7 }, ordered);
    expect(resumed?.chapter.id).toBe('c3');
    expect(resumed?.page).toBe(7);
    expect(continueTargetChapterOf({ kind: 'upToDate' }, ordered)?.chapter.id).toBe('c1');
    expect(continueTargetChapterOf({ kind: 'next', chapterIndex: 0 }, [])).toBeNull();
  });

  it('infoRowLabelOf falls back to book.sourceId when sourceName is null (L499)', () => {
    expect(infoRowLabelOf(null, book, 12, 5)).toEqual({
      base: 'src · 当前源共 12 话 · ',
      accent: '已读 5 话',
    });
    expect(infoRowLabelOf('扑飞漫画', book, 12, 5).base).toBe('扑飞漫画 · 当前源共 12 话 · ');
    expect(infoRowLabelOf(null, null, 0, 0).base).toBe(' · 当前源共 0 话 · ');
  });
});

describe('Kotlin 676–742 / 791–1055 — ChapterCardSpec', () => {
  const base: ChapterCardSpecInput = {
    number: 3,
    title: '第3话',
    visual: ChapterVisual.UNREAD,
    lastPage: 0,
    pageCount: 0,
    isNew: false,
    downloaded: false,
    downloading: false,
    downloadProgress: 0,
    external: false,
    selecting: false,
    checked: false,
    textMode: false,
    bookmarked: false,
  };

  it('chapterProgressOf prefers the chapter entity and falls back to progress (L680–683)', () => {
    const prog = progress({ lastChapterId: 'c2', lastPageIndex: 5, lastPageCount: 20 });
    expect(chapterProgressOf(readState('c2', ChapterReadState.READING, { pageIndex: 3, pageCount: 12 }), 'c2', prog)).toEqual({
      pageIndex: 3,
      pageCount: 12,
    });
    // 无章节实体 → 用漫画级进度
    expect(chapterProgressOf(undefined, 'c2', prog)).toEqual({ pageIndex: 5, pageCount: 20 });
    // pageCount = 0 不采纳（takeIf { it > 0 }）
    expect(chapterProgressOf(readState('c2', ChapterReadState.READING, { pageCount: 0 }), 'c2', prog)).toEqual({
      pageIndex: 0,
      pageCount: 20,
    });
    // 与 progress.lastChapterId 不符 → 0
    expect(chapterProgressOf(undefined, 'c9', prog)).toEqual({ pageIndex: 0, pageCount: 0 });
  });

  it('emphasizes the READING row only when not selecting (L826)', () => {
    expect(chapterCardSpecOf({ ...base, visual: ChapterVisual.READING }).emphasized).toBe(true);
    expect(
      chapterCardSpecOf({ ...base, visual: ChapterVisual.READING, selecting: true }).emphasized,
    ).toBe(false);
  });

  it('derives the row number from the title first, then the order (L685–686)', () => {
    // 标题里能解析出话号 → 用话号（不看 order）
    expect(chapterNumberOf(chapter('c1', '第 12 话 下'), entry(chapter('c1', '第 12 话 下'), 40))).toBe(12);
    // 标题里没有数字 → 回落到 order + 1
    expect(chapterNumberOf(chapter('c2', '番外 · 作者剪辑版'), entry(chapter('c2', '番外 · 作者剪辑版'), 6))).toBe(7);
    // order = 0 的第一话
    expect(chapterNumberOf(chapter('c3', '序章'), entry(chapter('c3', '序章'), 0))).toBe(1);
    // 小数话号取整（chapterNumber 内部 Math.trunc）
    expect(chapterNumberOf(chapter('c4', '第 12.7 话'), entry(chapter('c4', '第 12.7 话'), 99))).toBe(12);
  });

  it('marks the checked row as selected (L827)', () => {
    const spec = chapterCardSpecOf({ ...base, selecting: true, checked: true });
    expect(spec.isSelected).toBe(true);
    expect(chapterCardSpecOf({ ...base, selecting: true, checked: false }).isSelected).toBe(false);
  });

  it('computes the bottom progress fraction only for the current row with pages (L1037–1038)', () => {
    expect(
      chapterCardSpecOf({ ...base, visual: ChapterVisual.READING, lastPage: 9, pageCount: 10 })
        .progressFraction,
    ).toBe(1);
    expect(
      chapterCardSpecOf({ ...base, visual: ChapterVisual.READING, lastPage: 4, pageCount: 10 })
        .progressFraction,
    ).toBe(0.5);
    expect(chapterCardSpecOf({ ...base, visual: ChapterVisual.READ, lastPage: 4, pageCount: 10 }).progressFraction).toBe(0);
    expect(chapterCardSpecOf({ ...base, visual: ChapterVisual.READING, pageCount: 0 }).progressFraction).toBe(0);
  });

  it('picks the right column kind in the Kotlin when-order (L982–1015)', () => {
    expect(chapterCardSpecOf({ ...base, selecting: true }).rightKind).toBe('check');
    expect(chapterCardSpecOf({ ...base, downloading: true }).rightKind).toBe('downloading');
    expect(chapterCardSpecOf({ ...base, downloaded: true }).rightKind).toBe('downloaded');
    expect(chapterCardSpecOf({ ...base, external: true }).rightKind).toBe('hidden');
    expect(chapterCardSpecOf({ ...base, textMode: true }).rightKind).toBe('hidden');
    expect(chapterCardSpecOf(base).rightKind).toBe('downloadable');
    expect(chapterCardSpecOf({ ...base, downloaded: true }).rightLabel).toBe('已下载');
    expect(chapterCardSpecOf(base).rightLabel).toBe('下载');
    expect(chapterCardSpecOf({ ...base, external: true }).rightLabel).toBeNull();
  });

  it('clamps downloadProgress like coerceIn(0f, 1f) (L996)', () => {
    expect(chapterCardSpecOf({ ...base, downloadProgress: 1.4 }).downloadProgress).toBe(1);
    expect(chapterCardSpecOf({ ...base, downloadProgress: -3 }).downloadProgress).toBe(0);
  });

  it('builds the accessibility label in the Kotlin buildString order (L871–883)', () => {
    expect(
      chapterSemanticsLabelOf('第3话', ChapterVisual.READING, true, true),
    ).toBe('第3话，阅读中，已下载，已加书签');
    expect(chapterSemanticsLabelOf('第3话', ChapterVisual.READ, false, false)).toBe('第3话，已读');
    expect(chapterSemanticsLabelOf('第3话', ChapterVisual.UNREAD, false, false)).toBe('第3话，未读');
  });

  it('assembles the caption with the new-chapter suffix (L955–959)', () => {
    expect(chapterCaptionOf(3, ChapterVisual.READING, 20, 5, false)).toBe('第 3 话 · 读到 6 / 20 页');
    expect(chapterCaptionOf(3, ChapterVisual.READ, 20, 5, false)).toBe('第 3 话 · 已读');
    expect(chapterCaptionOf(3, ChapterVisual.UNREAD, 0, 0, true)).toBe('第 3 话 · 新');
    expect(chapterCaptionOf(3, ChapterVisual.UNREAD, 0, 0, false)).toBe('第 3 话');
    // 阅读中但总页数未知 → 走「未读」分支
    expect(chapterCaptionOf(3, ChapterVisual.READING, 0, 5, false)).toBe('第 3 话');
  });

  it('shows the ribbon only for a user-bookmarked row (L1020 / L1026)', () => {
    expect(chapterCardSpecOf({ ...base, bookmarked: true }).showRibbon).toBe(true);
    expect(chapterCardSpecOf(base).showRibbon).toBe(false);
  });
});

describe('Kotlin 632–675 / 1057–1242 — GodCardSpec', () => {
  it('godChapterTitleOf prefers the live chapter title (L635–637)', () => {
    const god = moment('c1', 100, { chapterTitle: '神回记的标题', chapterNumber: 7 });
    expect(godChapterTitleOf(god, chapter('c1', '第1话 正题'))).toBe('第1话 正题');
    expect(godChapterTitleOf(god, null)).toBe('神回记的标题');
  });

  it('godChapterTitleOf falls back to 第 N 话 when chapterTitle is blank (L637)', () => {
    expect(godChapterTitleOf(moment('c1', 100, { chapterNumber: 12 }), null)).toBe('第 12 话');
    expect(godChapterTitleOf(moment('c1', 100, { chapterTitle: '   ', chapterNumber: 3 }), null)).toBe(
      '第 3 话',
    );
  });

  it('godCaptionOf only shows a custom name when flagged and non-blank (L1170–1172)', () => {
    expect(godCaptionOf(moment('c1', 100))).toBe('神回');
    expect(godCaptionOf(moment('c1', 100, { title: '名场面', titleIsCustom: true }))).toBe('神回 · 名场面');
    expect(godCaptionOf(moment('c1', 100, { title: '名场面', titleIsCustom: false }))).toBe('神回');
    expect(godCaptionOf(moment('c1', 100, { title: '  ', titleIsCustom: true }))).toBe('神回');
  });

  it('godRatingTextOf formats with one decimal (L1218)', () => {
    expect(godRatingTextOf(moment('c1', 100, { rating: 4.5 }))).toBe('4.5');
    expect(godRatingTextOf(moment('c1', 100, { rating: 5 }))).toBe('5.0');
  });
});

describe('Kotlin 1276–1460 + ComicMetadataUi.kt — hero header', () => {
  it('heroTitleOf falls back to 漫画章节 (L325)', () => {
    expect(heroTitleOf(book)).toBe('测试漫画');
    expect(heroTitleOf(null)).toBe('漫画章节');
  });

  it('heroBadgeOf switches on textMode (L1402)', () => {
    expect(heroBadgeOf(false)).toBe('漫画');
    expect(heroBadgeOf(true)).toBe('小说');
  });

  it('heroAuthorLineOf uses the Android unknown-author rule (L1409–1422)', () => {
    expect(heroAuthorLineOf(book)).toBe('作者：作者甲');
    expect(heroAuthorLineOf(createSearchBook({ id: 'x', sourceId: 's', title: 't', author: '未知作者' }))).toBe(
      '源站未提供作者',
    );
    expect(heroAuthorLineOf(createSearchBook({ id: 'x', sourceId: 's', title: 't', author: '   ' }))).toBe(
      '源站未提供作者',
    );
  });

  it('heroComicIdLineOf trims and skips a blank id (L1424–1432)', () => {
    expect(heroComicIdLineOf(book)).toBe('编号：42');
    expect(heroComicIdLineOf(createSearchBook({ id: 'x', sourceId: 's', title: 't', author: 'a' }))).toBeNull();
  });

  it('heroDescriptionOf and descriptionNeedsToggle mirror L1440 / L1450', () => {
    expect(heroDescriptionOf(book)).toBeNull();
    const long = 'a'.repeat(60);
    expect(descriptionNeedsToggle(long)).toBe(false);
    expect(descriptionNeedsToggle(`${long}a`)).toBe(true);
  });

  it('comicMetadataModelOf builds the rows in the Kotlin buildList order', () => {
    const withInfo = createSearchBook({
      ...book,
      comicInfo: {
        alternateTitles: ['别名A', '别名B', '测试漫画', '别名A'],
        artists: ['画师甲', '画师乙'],
        tags: ['热血'],
        status: 'ONGOING',
        originalLanguage: 'ja',
        updatedAt: '2026-09-29',
      },
    });
    const model = comicMetadataModelOf(withInfo);
    expect(model.rows).toEqual([
      { label: '状态', value: '连载中' },
      { label: '源站标注语言', value: 'ja' },
      { label: '原作语言', value: expect.any(String) },
      { label: '画师', value: '画师甲、画师乙' },
      { label: '源站更新信息', value: '2026-09-29' },
    ]);
    // 别名去重 + 排除书名本身（L29）
    expect(model.aliases).toEqual(['别名A', '别名B']);
    expect(model.tags).toEqual(['热血']);
    expect(comicMetadataIsEmpty(model)).toBe(false);
  });

  it('comicMetadataIsEmpty hides the whole block when there is no data (L44)', () => {
    const bare = createSearchBook({ id: 'x', sourceId: 's', title: 't', author: 'a' });
    expect(comicMetadataIsEmpty(comicMetadataModelOf(bare))).toBe(true);
  });

  it('metadataStatusLabelOf maps the five known states (L32–38)', () => {
    expect(metadataStatusLabelOf('ongoing')).toBe('连载中');
    expect(metadataStatusLabelOf('COMPLETED')).toBe('已完结');
    expect(metadataStatusLabelOf('finished')).toBe('已完结');
    expect(metadataStatusLabelOf('hiatus')).toBe('休刊中');
    expect(metadataStatusLabelOf('canceled')).toBe('已中止');
    expect(metadataStatusLabelOf('cancelled')).toBe('已中止');
    expect(metadataStatusLabelOf('奇怪状态')).toBe('奇怪状态');
  });

  it('metadataTagNameOf uses substringAfter(：) then falls back to the whole tag (L63)', () => {
    expect(metadataTagNameOf('genre：热血')).toBe('热血');
    expect(metadataTagNameOf('热血')).toBe('热血');
    expect(metadataTagNameOf('genre：   ')).toBe('genre：   ');
  });
});

describe('Kotlin 1462–1541 — download overlay labels', () => {
  it('switches the title on the paused flag (L1500)', () => {
    expect(downloadOverlayTitleOf(false, '第3话')).toBe('正在下载：第3话');
    expect(downloadOverlayTitleOf(true, '第3话')).toBe('已暂停：第3话');
  });

  it('renders the truncated percentage (L1518)', () => {
    expect(downloadOverlayPercentOf(0.456)).toBe('45%');
    expect(downloadOverlayPercentOf(1)).toBe('100%');
    expect(downloadOverlayPercentOf(0)).toBe('0%');
    expect(downloadOverlayPercentOf(2)).toBe('100%');
  });

  it('imageExtensionOf and comicPagePath build the on-disk layout', () => {
    expect(imageExtensionOf('https://x.invalid/a/b.JPG?token=1')).toBe('jpg');
    expect(imageExtensionOf('https://x.invalid/a/b')).toBe('jpg');
    const target: ComicDetailTarget = { sourceId: 'src', comicId: 'cid', book: null };
    expect(comicPagePath(target, 'c1', 2, 'https://x.invalid/p.webp')).toBe(
      'Downloads/comic/src/cid/c1/2.webp',
    );
  });
});

describe('Kotlin 178 / 204–214 — highlight store', () => {
  beforeEach(() => {
    comicHighlightStore.clear();
  });

  it('pulses the id and clears it after the delay (L209–211)', async () => {
    const store = new ComicHighlightStore();
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    store.pulse('c1', 20);
    expect(store.getSnapshot()).toBe('c1');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(store.getSnapshot()).toBeNull();
    expect(notified).toBe(2);
    unsubscribe();
  });
});

describe('Kotlin 110–162 / 235–238 — ComicChaptersStore', () => {
  const list = chapters(3);
  const target: ComicDetailTarget = { sourceId: 'src', comicId: 'cid', book };

  function makePorts(overrides: Partial<ComicChaptersPorts> = {}): ComicChaptersPorts {
    return {
      loadChapters: async (_target, onCached) => {
        onCached(list.slice(0, 1));
        return list;
      },
      chapterStates: async () => [readState('c1', ChapterReadState.READ)],
      progress: async () => progress({ lastChapterId: 'c2', lastPageIndex: 4, lastPageCount: 20 }),
      favorite: async () => null,
      downloadedChapterIds: async () => [],
      sourceNameOf: async () => '扑飞漫画',
      textModeOf: () => false,
      markSeen: async () => undefined,
      setChapterBookmark: async () => undefined,
      toggleFavorite: async () => undefined,
      ...overrides,
    };
  }

  it('publishes the cached list first, then the network list (缓存秒开)', async () => {
    const store = new ComicChaptersStore();
    store.attachPorts(makePorts());
    const seen: number[] = [];
    store.subscribe(() => {
      seen.push(store.getSnapshot().chapters.length);
    });
    const pending = store.open(target);
    expect(store.getSnapshot().loading).toBe(true);
    expect(store.getSnapshot().book).toBe(book);
    await pending;
    expect(store.getSnapshot().loading).toBe(false);
    expect(store.getSnapshot().chapters).toHaveLength(3);
    expect(store.getSnapshot().chapterStates.get('c1')?.status).toBe(ChapterReadState.READ);
    expect(store.getSnapshot().sourceName).toBe('扑飞漫画');
    expect(seen).toEqual([0, 1, 3]);
  });

  it('surfaces the load error and keeps the target (L462–472)', async () => {
    const store = new ComicChaptersStore();
    store.attachPorts(
      makePorts({
        loadChapters: async () => {
          throw new Error('该漫画的书源已停用或不支持漫画');
        },
      }),
    );
    await store.open(target);
    expect(store.getSnapshot().error).toBe('该漫画的书源已停用或不支持漫画');
    expect(store.getSnapshot().loading).toBe(false);
    expect(store.getSnapshot().chapters).toEqual([]);
  });

  it('ignores a stale load when a newer target opens (requestSeq guard)', async () => {
    const store = new ComicChaptersStore();
    const otherList = [chapter('o1', '别源第1话')];
    store.attachPorts(
      makePorts({
        loadChapters: async (t) => {
          if (t.sourceId === 'src') {
            // 慢响应：等第二次 open 已经发出后才回来
            await new Promise((resolve) => setTimeout(resolve, 40));
            return list;
          }
          return otherList;
        },
      }),
    );
    const first = store.open(target);
    const second = store.open({ sourceId: 'other', comicId: 'x', book: null });
    await Promise.all([first, second]);
    expect(store.getSnapshot().target?.sourceId).toBe('other');
    // 第一次的响应被丢弃，没有覆盖第二次的结果
    expect(store.getSnapshot().chapters).toEqual(otherList);
  });

  it('markSeen is a no-op while the chapter list is empty (L237)', async () => {
    const store = new ComicChaptersStore();
    let marks = 0;
    store.attachPorts(
      makePorts({
        loadChapters: async () => [],
        markSeen: async () => {
          marks += 1;
        },
      }),
    );
    await store.open(target);
    await store.markSeen();
    expect(marks).toBe(0);
  });

  it('setChapterBookmark writes through and patches the local snapshot (L727–733)', async () => {
    const store = new ComicChaptersStore();
    const writes: Array<[string, number, boolean]> = [];
    store.attachPorts(
      makePorts({
        setChapterBookmark: async (_t, chapterId, chapterIndex, bookmarked) => {
          writes.push([chapterId, chapterIndex, bookmarked]);
        },
      }),
    );
    await store.open(target);
    await store.setChapterBookmark('c1', 0, true);
    expect(writes).toEqual([['c1', 0, true]]);
    expect(store.getSnapshot().chapterStates.get('c1')?.bookmarked).toBe(true);
  });

  it('toggleFavorite flips the local flag before persisting', async () => {
    const store = new ComicChaptersStore();
    const writes: boolean[] = [];
    store.attachPorts(
      makePorts({
        toggleFavorite: async (_t, _b, next) => {
          writes.push(next);
        },
      }),
    );
    await store.open(target);
    expect(store.getSnapshot().favorite).toBe(false);
    await store.toggleFavorite(true);
    expect(writes).toEqual([true]);
    expect(store.getSnapshot().favorite).toBe(true);
  });

  it('an empty target resets the snapshot', async () => {
    const store = new ComicChaptersStore();
    store.attachPorts(makePorts());
    await store.open(target);
    await store.open(null);
    expect(store.getSnapshot().chapters).toEqual([]);
    expect(store.getSnapshot().target).toBeNull();
  });
});

describe('Kotlin 163–170 / 235 — continue + new-chapter derivations', () => {
  it('continueTargetOf resolves Resume with the stored page (L167–169)', () => {
    const result = continueTargetOf(
      chapters(3),
      new Map([['c2', ChapterReadState.READING]]),
      progress({ lastChapterId: 'c2', lastPageIndex: 6, lastPageCount: 20 }),
    );
    expect(result).toEqual({ kind: 'resume', chapterIndex: 1, pageIndex: 6 });
  });

  it('continueTargetOf resolves Next once the last chapter is READ (ComicReadingLogic L149–152)', () => {
    const result = continueTargetOf(
      chapters(3),
      new Map([['c2', ChapterReadState.READ]]),
      progress({ lastChapterId: 'c2', lastPageIndex: 19, lastPageCount: 20 }),
    );
    expect(result).toEqual({ kind: 'next', chapterIndex: 2 });
  });

  it('newChapterIdSetOf returns nothing without progress (L180)', () => {
    expect(newChapterIdSetOf(chapters(3), null).size).toBe(0);
  });

  it('newChapterIdSetOf takes everything after the seen snapshot id (L183–185)', () => {
    const ids = newChapterIdSetOf(chapters(4), progress({ seenTopChapterId: 'c2' }));
    expect([...ids]).toEqual(['c3', 'c4']);
  });
});

describe('target resolution — MainActivity L1046–1062 / 1435', () => {
  beforeEach(() => {
    takeComicDetailTarget();
  });

  it('comicDetailTargetFromKey splits sourceId::comicId and rejects blanks', () => {
    expect(comicDetailTargetFromKey('src::cid', book)).toEqual({
      sourceId: 'src',
      comicId: 'cid',
      book,
    });
    expect(comicDetailTargetFromKey('local_1', book)).toBeNull();
    expect(comicDetailTargetFromKey('::', book)).toBeNull();
  });

  it('prefers the explicit target, then the god beacon, then the first favorite', () => {
    const explicit: ComicDetailTarget = { sourceId: 'e', comicId: 'e', book: null };
    const favorite: ComicDetailTarget = { sourceId: 'f', comicId: 'f', book: null };
    expect(resolveComicDetailTarget(explicit, 'src::cid', favorite)?.sourceId).toBe('e');
    expect(resolveComicDetailTarget(null, 'src::cid', favorite)?.sourceId).toBe('src');
    expect(resolveComicDetailTarget(null, 'local_1', favorite)?.sourceId).toBe('f');
    expect(resolveComicDetailTarget(null, null, null)).toBeNull();
  });

  it('setComicDetailTarget / takeComicDetailTarget is a read-once beacon', () => {
    setComicDetailTarget({ sourceId: 'a', comicId: 'b', book: null });
    expect(takeComicDetailTarget()?.comicId).toBe('b');
    expect(takeComicDetailTarget()).toBeNull();
  });
});

describe('comicDownloadStore — parallel to the ViewModel StateFlows', () => {
  it('starts empty and exposes the same shape as the Kotlin parameters', () => {
    const snapshot = comicDownloadStore.getSnapshot();
    expect(snapshot.downloading.size).toBe(0);
    expect(snapshot.paused.size).toBe(0);
    expect(snapshot.downloaded.size).toBe(0);
    expect(snapshot.progress.size).toBe(0);
  });

  it('getSnapshot returns a stable reference until the store notifies', async () => {
    const store = new ComicDownloadStore();
    const target: ComicDetailTarget = { sourceId: 'src', comicId: 'cid', book: null };
    const written: string[] = [];
    store.attachPorts({
      fetchPage: async () => new Uint8Array([1, 2, 3]),
      writePage: async (path) => {
        written.push(path);
      },
      deletePage: async () => undefined,
      resolveImages: async () => ['https://x.invalid/1.jpg'],
      resolveImageHeaders: async () => ({}),
    });
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    // start 是 fire-and-forget（对齐 Android 的 viewModelScope.launch），等它落盘
    await store.start(target, chapter('c1', '第1话'));
    for (let i = 0; i < 50 && !store.getSnapshot().downloaded.has('c1'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(written).toEqual(['Downloads/comic/src/cid/c1/0.jpg']);
    expect(store.getSnapshot().downloaded.has('c1')).toBe(true);
    expect(store.getSnapshot().downloading.size).toBe(0);
  });
});
