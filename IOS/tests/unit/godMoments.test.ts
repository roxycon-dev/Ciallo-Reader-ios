import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyGodMomentPatch,
  clearGodMoments,
  countGodMoments,
  deleteGodMoment,
  deleteGodMomentFrom,
  deleteGodMomentsForBook,
  deleteGodMomentsForChapter,
  findGodMoment,
  getGodMoment,
  listGodMoments,
  listGodMomentsRanked,
  peekGodEditTarget,
  resetGodMoments,
  saveGodMoment,
  seedGodMomentsIfEmpty,
  setGodEditTarget,
  takeGodEditTarget,
  updateGodMoment,
  upsertGodMomentIn,
} from '../../src/core/god/godMoments';
import {
  DEFAULT_CROP_PARAMS,
  GOD_RATING_MAX,
  GOD_RATING_MIN,
  type GodMoment,
  clampGodRating,
  coverSourceToTag,
  cropParamsToTag,
  defaultCoverSource,
  defaultGodTitle,
  effectiveGodTitle,
  formatGodRating,
  parseCoverSource,
  parseCropParams,
  rankGodMoments,
  sortGodMoments,
} from '../../src/core/god/godTypes';

function makeMoment(overrides: Partial<GodMoment> = {}): GodMoment {
  return {
    id: 1,
    contentType: 'comic',
    bookId: 'local_1',
    chapterId: 'c1',
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
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  resetGodMoments();
});

describe('clampGodRating', () => {
  it('rounds to the 0.5 step and clamps to the allowed range', () => {
    expect(clampGodRating(5)).toBe(5);
    expect(clampGodRating(5.4)).toBe(GOD_RATING_MAX);
    expect(clampGodRating(4.74)).toBe(4.5);
    expect(clampGodRating(4.26)).toBe(4.5);
    expect(clampGodRating(0)).toBe(GOD_RATING_MIN);
    expect(clampGodRating(0.2)).toBe(GOD_RATING_MIN);
  });

  it('formats ratings with one decimal like Android', () => {
    expect(formatGodRating(5)).toBe('5.0');
    expect(formatGodRating(4.5)).toBe('4.5');
  });
});

describe('titles', () => {
  it('builds the default title as book + chapter number', () => {
    expect(defaultGodTitle('书名', '终章', 12)).toBe('书名 第12话');
  });

  it('falls back to chapter title or chapter number when book title is blank', () => {
    expect(defaultGodTitle('', '终章', 12)).toBe('终章');
    expect(defaultGodTitle('', '', 3)).toBe('第3话');
  });

  it('uses a custom title only when flagged and non-blank', () => {
    expect(
      effectiveGodTitle(
        makeMoment({ title: '自定义', titleIsCustom: true, bookTitle: '书名', chapterNumber: 9 }),
      ),
    ).toBe('自定义');
    expect(
      effectiveGodTitle(
        makeMoment({ title: '  ', titleIsCustom: true, bookTitle: '书名', chapterNumber: 9 }),
      ),
    ).toBe('书名 第9话');
    expect(
      effectiveGodTitle(
        makeMoment({ title: '自定义', titleIsCustom: false, bookTitle: '书名', chapterNumber: 9 }),
      ),
    ).toBe('书名 第9话');
  });
});

describe('sortGodMoments / rankGodMoments', () => {
  const a = makeMoment({
    id: 1,
    bookId: 'b',
    chapterId: 'c1',
    bookTitle: '斗破苍穹',
    chapterNumber: 10,
    rating: 4,
    createdAt: 2000,
  });
  const b = makeMoment({
    id: 2,
    bookId: 'b',
    chapterId: 'c2',
    bookTitle: '诡秘之主',
    chapterNumber: 2,
    rating: 5,
    createdAt: 1000,
  });
  const c = makeMoment({
    id: 3,
    bookId: 'b',
    chapterId: 'c3',
    bookTitle: '诡秘之主',
    chapterNumber: 1,
    rating: 5,
    createdAt: 3000,
  });

  it('sorts by rating desc then createdAt desc for ranking', () => {
    const sorted = sortGodMoments([a, b, c], 'rating');
    expect(sorted.map((item) => item.id)).toEqual([3, 2, 1]);
  });

  it('sorts by createdAt desc for recent', () => {
    const sorted = sortGodMoments([a, b, c], 'recent');
    expect(sorted.map((item) => item.id)).toEqual([3, 1, 2]);
  });

  it('sorts by book title, chapter number, then rating desc for book', () => {
    const sorted = sortGodMoments([a, b, c], 'book');
    expect(sorted.map((item) => item.id)).toEqual([1, 3, 2]);
  });

  it('ranks with 1-based positions', () => {
    const ranked = rankGodMoments([a, b, c]);
    expect(ranked.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(ranked[0]?.entity.id).toBe(3);
  });

  it('does not mutate the input list', () => {
    const input = [a, b, c];
    sortGodMoments(input, 'rating');
    expect(input.map((item) => item.id)).toEqual([1, 2, 3]);
  });
});

describe('coverSource tags', () => {
  it('serializes comic page, album, and novel excerpt sources', () => {
    expect(coverSourceToTag({ kind: 'comicPage', pageIndex: 3, pageId: 'abc' })).toBe(
      'page|3|abc',
    );
    expect(coverSourceToTag({ kind: 'album', uri: 'content://x' })).toBe('album|content://x');
    expect(
      coverSourceToTag({ kind: 'novelExcerpt', chapterId: 'ch', start: 1, end: 5 }),
    ).toBe('novel|ch|1|5');
  });

  it('parses tags back and defaults on blank or garbage input', () => {
    expect(parseCoverSource('page|2|abc')).toEqual({
      kind: 'comicPage',
      pageIndex: 2,
      pageId: 'abc',
    });
    expect(parseCoverSource('album|content://x')).toEqual({
      kind: 'album',
      uri: 'content://x',
    });
    expect(parseCoverSource('novel|ch|1|5')).toEqual({
      kind: 'novelExcerpt',
      chapterId: 'ch',
      start: 1,
      end: 5,
    });
    expect(parseCoverSource('')).toEqual(defaultCoverSource());
    expect(parseCoverSource(null)).toEqual(defaultCoverSource());
    expect(parseCoverSource('zzz')).toEqual(defaultCoverSource());
    expect(parseCoverSource('page|notanumber|')).toEqual({
      kind: 'comicPage',
      pageIndex: 0,
      pageId: '',
    });
  });
});

describe('cropParams tags', () => {
  it('round-trips default and custom crop params', () => {
    expect(parseCropParams(cropParamsToTag(DEFAULT_CROP_PARAMS))).toEqual(DEFAULT_CROP_PARAMS);
    const custom = {
      scale: 1.5,
      offsetX: 0.25,
      offsetY: -0.1,
      rotationDeg: 90,
      cropL: 0.1,
      cropT: 0.2,
      cropR: 0.9,
      cropB: 0.8,
    };
    expect(parseCropParams(cropParamsToTag(custom))).toEqual(custom);
  });

  it('normalizes inverted and out-of-range rectangles', () => {
    const parsed = parseCropParams('1,0,0,0,0.8,0.7,0.2,0.1');
    expect(parsed.cropL).toBeCloseTo(0.2);
    expect(parsed.cropR).toBeCloseTo(0.8);
    expect(parsed.cropT).toBeCloseTo(0.1);
    expect(parsed.cropB).toBeCloseTo(0.7);
    const degenerate = parseCropParams('1,0,0,0,0.5,0.5,0.5,0.5');
    expect(degenerate.cropR - degenerate.cropL).toBeGreaterThanOrEqual(0.02 - 1e-9);
  });

  it('returns defaults for blank tags', () => {
    expect(parseCropParams('')).toEqual(DEFAULT_CROP_PARAMS);
    expect(parseCropParams(undefined)).toEqual(DEFAULT_CROP_PARAMS);
  });
});

describe('upsertGodMomentIn (pure)', () => {
  it('creates a moment with id 1 on an empty list', () => {
    const result = upsertGodMomentIn(
      [],
      { bookId: 'b1', chapterId: 'c1', bookTitle: '书', rating: 4.2 },
      5000,
    );
    expect(result.list).toHaveLength(1);
    expect(result.saved.id).toBe(1);
    expect(result.saved.rating).toBe(4);
    expect(result.saved.createdAt).toBe(5000);
    expect(result.saved.updatedAt).toBe(5000);
    expect(result.saved.contentType).toBe('comic');
    expect(result.saved.coverPath).toBeNull();
  });

  it('updates in place on the same (bookId, chapterId) key and reuses the id', () => {
    const first = upsertGodMomentIn(
      [],
      { bookId: 'b1', chapterId: 'c1', bookTitle: '书', rating: 3, note: '旧' },
      1000,
    );
    const second = upsertGodMomentIn(
      first.list,
      { bookId: 'b1', chapterId: 'c1', bookTitle: '书', rating: 5, note: '新' },
      2000,
    );
    expect(second.list).toHaveLength(1);
    expect(second.saved.id).toBe(first.saved.id);
    expect(second.saved.rating).toBe(5);
    expect(second.saved.note).toBe('新');
    expect(second.saved.createdAt).toBe(1000);
    expect(second.saved.updatedAt).toBe(2000);
  });

  it('allocates increasing ids for distinct chapter keys', () => {
    const first = upsertGodMomentIn(
      [],
      { bookId: 'b1', chapterId: 'c1', bookTitle: '书' },
      1000,
    );
    const second = upsertGodMomentIn(
      first.list,
      { bookId: 'b1', chapterId: 'c2', bookTitle: '书' },
      1000,
    );
    expect(second.saved.id).toBe(first.saved.id + 1);
    expect(second.list).toHaveLength(2);
  });
});

describe('applyGodMomentPatch (pure)', () => {
  it('merges patch fields, clamps rating, and bumps updatedAt', () => {
    const base = makeMoment({ rating: 4, note: 'a', updatedAt: 1000 });
    const merged = applyGodMomentPatch(base, { rating: 9, note: 'b' }, 4000);
    expect(merged.rating).toBe(GOD_RATING_MAX);
    expect(merged.note).toBe('b');
    expect(merged.updatedAt).toBe(4000);
    expect(merged.createdAt).toBe(base.createdAt);
    expect(merged.id).toBe(base.id);
  });

  it('clears the note when patched to an empty string', () => {
    const base = makeMoment({ note: 'a' });
    const merged = applyGodMomentPatch(base, { note: '' }, 4000);
    expect(merged.note).toBe('');
  });
});

describe('in-memory store facade', () => {
  it('saves, lists, and finds moments', () => {
    saveGodMoment({ bookId: 'b1', chapterId: 'c2', bookTitle: '甲', rating: 3 });
    saveGodMoment({ bookId: 'b1', chapterId: 'c1', bookTitle: '甲', rating: 5 });
    expect(countGodMoments()).toBe(2);
    const ranked = listGodMomentsRanked('rating');
    expect(ranked.map((item) => item.entity.chapterId)).toEqual(['c1', 'c2']);
    expect(listGodMoments()[0]?.chapterId).toBe('c1');
    const found = findGodMoment('b1', 'c2');
    expect(found?.rating).toBe(3);
    const byId = getGodMoment(ranked[0]?.entity.id ?? -1);
    expect(byId?.chapterId).toBe('c1');
  });

  it('keeps unique (bookId, chapterId) rows on repeated saves', () => {
    saveGodMoment({ bookId: 'b1', chapterId: 'c1', bookTitle: '书', rating: 2, note: 'one' });
    const saved = saveGodMoment({
      bookId: 'b1',
      chapterId: 'c1',
      bookTitle: '书',
      rating: 4.5,
      note: 'two',
    });
    expect(countGodMoments()).toBe(1);
    expect(saved.note).toBe('two');
    expect(findGodMoment('b1', 'c1')?.rating).toBe(4.5);
  });

  it('updates by id and returns undefined for unknown ids', () => {
    const saved = saveGodMoment({ bookId: 'b1', chapterId: 'c1', bookTitle: '书' });
    const updated = updateGodMoment(saved.id, { note: '补记', rating: 3.5 });
    expect(updated?.note).toBe('补记');
    expect(updated?.rating).toBe(3.5);
    expect(updateGodMoment(9999, { note: 'x' })).toBeUndefined();
  });

  it('deletes by id, book, and chapter', () => {
    saveGodMoment({ bookId: 'b1', chapterId: 'c1', bookTitle: '书' });
    saveGodMoment({ bookId: 'b1', chapterId: 'c2', bookTitle: '书' });
    saveGodMoment({ bookId: 'b2', chapterId: 'c1', bookTitle: '别集' });

    expect(deleteGodMomentsForChapter('b1', 'c1')).toBe(1);
    expect(countGodMoments()).toBe(2);
    expect(deleteGodMoment(findGodMoment('b1', 'c2')?.id ?? -1)).toBe(true);
    expect(countGodMoments()).toBe(1);
    expect(deleteGodMoment(9999)).toBe(false);
    expect(deleteGodMomentsForBook('b2')).toBe(1);
    expect(countGodMoments()).toBe(0);
  });

  it('clears the store', () => {
    saveGodMoment({ bookId: 'b1', chapterId: 'c1', bookTitle: '书' });
    clearGodMoments();
    expect(countGodMoments()).toBe(0);
  });

  it('deleteGodMomentFrom is pure and leaves unknown ids untouched', () => {
    const list = [makeMoment({ id: 1 }), makeMoment({ id: 2, chapterId: 'c2' })];
    const removed = deleteGodMomentFrom(list, 1);
    expect(removed.deleted?.id).toBe(1);
    expect(removed.list.map((item) => item.id)).toEqual([2]);
    const untouched = deleteGodMomentFrom(list, 99);
    expect(untouched.deleted).toBeNull();
    expect(untouched.list).toHaveLength(2);
    expect(list).toHaveLength(2);
  });
});

describe('edit target beacon', () => {
  it('hands out the target once and then clears it', () => {
    setGodEditTarget(7);
    expect(peekGodEditTarget()).toBe(7);
    expect(takeGodEditTarget()).toBe(7);
    expect(takeGodEditTarget()).toBeNull();
    setGodEditTarget(null);
    expect(takeGodEditTarget()).toBeNull();
  });

  it('is cleared by resetGodMoments', () => {
    setGodEditTarget(3);
    resetGodMoments();
    expect(takeGodEditTarget()).toBeNull();
  });
});

describe('seedGodMomentsIfEmpty', () => {
  it('seeds demo moments once and never overwrites existing data', () => {
    seedGodMomentsIfEmpty(10_000);
    const seededCount = countGodMoments();
    expect(seededCount).toBeGreaterThan(0);
    seedGodMomentsIfEmpty(20_000);
    expect(countGodMoments()).toBe(seededCount);

    saveGodMoment({ bookId: 'own', chapterId: 'c', bookTitle: '我的' });
    seedGodMomentsIfEmpty(30_000);
    expect(findGodMoment('own', 'c')).toBeDefined();
    expect(countGodMoments()).toBe(seededCount + 1);
  });

  it('seeds distinct createdAt values so ranking order is stable', () => {
    seedGodMomentsIfEmpty(10_000);
    const ranked = listGodMomentsRanked('rating');
    expect(ranked[0]?.entity.rating).toBe(5);
    for (let i = 1; i < ranked.length; i += 1) {
      const prev = ranked[i - 1]?.entity;
      const curr = ranked[i]?.entity;
      expect((prev?.rating ?? 0) >= (curr?.rating ?? 0)).toBe(true);
    }
  });
});
