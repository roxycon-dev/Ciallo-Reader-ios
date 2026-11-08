/**
 * Unit tests for `@core/god/godReaderBinding` — 阅读器 ↔ 神回绑定 + 可编辑星级 + Sheet 表单判定。
 *
 * Kotlin 行号映射（novel-reader/app/src/main/java/com/example/god/）：
 *
 * `GodReaderBinding.kt`：
 *   - 30      `enabled = onOpenCurrent != null`
 *   - 36-47   `openEdit(existing, pages)`（L45 只有 ComicPage 才带页号）
 *   - 64-82   `rememberGodMomentBinding` 的 `onOpenCurrent`
 *   - 70      `coerceIn(0, (pages.size - 1).coerceAtLeast(0))`
 *   - 100-105 加载门 key（`remember(bookId, chapterId)`）
 *   - 164-170 `request.pages.any { it.remote }` 才建远程 loader
 *   - 291-297 `godPageHeaders`（GodMomentModels.kt）
 *   - 250-262 `GodMomentContext.enabled`
 *
 * `GodStarRating.kt`（可交互半边）：
 *   - 52-54   0.5 / 5 / 0.5
 *   - 56-58   `coerceRating()`
 *   - 96-104  `commit`：相等则 return / haptic 去重
 *   - 113-123 `if (!enabled) return@pointerInput`
 *   - 117-119 / 129-131 `((x / w) * 5f).coerceIn(MIN, MAX)`
 *   - 138     `filled = (rating - (i - 1)).coerceIn(0f, 1f)`（半星判定）
 *   - 185     `target = if (filled > 0f) 1f else 0.82f`
 *   - 87-94   `sparkKey` 自增
 *   - 254-266 6 粒金屑
 *
 * `GodMomentSheet.kt`：
 *   - 221-223 TITLE_MAX / NOTE_MAX / SHEET_HEIGHT_FRACTION
 *   - 252-256 coverSourceTag 初值
 *   - 265-272 rating / titleCustom / titleText 初值
 *   - 274-275 defaultTitle / shownTitle
 *   - 337-346 dirty 判定
 *   - 278-281 封面加载 key
 *   - 483-487 onPickPage（含 coverRetry）
 *   - 523-528 名称输入（截断 + 清空回退）
 *   - 543     随笔截断
 *
 * `GodPull.kt` L293-320 提示胶囊门控。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  GOD_DECODE_MAX_EDGE,
  GOD_HINT_CAPSULE_TEXT,
  GOD_SHEET_HEIGHT_FRACTION,
  GOD_SHEET_NOTE_MAX,
  GOD_SHEET_TITLE_MAX,
  GOD_THUMB_MAX_EDGE,
  clampRating,
  createGodMomentRequest,
  createGodReaderBinding,
  godBindingBuildRequest,
  godBindingClampPageIndex,
  godBindingEnabled,
  godBindingLoadKey,
  godBindingNeedsRemoteLoader,
  godBindingOpenEdit,
  godContextEnabled,
  godHintCapsuleShouldRender,
  godPageHeaderMap,
  godPageHeaders,
  godPullOverlayText,
  godRatingCommit,
  godRatingFromX,
  godRatingIsInteractive,
  godSheetCoverLoadKey,
  godSheetDefaultTitle,
  godSheetInitialCoverTag,
  godSheetInitialRating,
  godSheetInitialTitleState,
  godSheetIsDirty,
  godSheetNoteChanged,
  godSheetPickPage,
  godSheetShouldRetryCover,
  godSheetShownTitle,
  godSheetTitleChanged,
  godSparkParticles,
  godStarFill,
  godStarIsHalfFilled,
  godStarScaleTarget,
  nextGodSparkKey,
  type GodMomentRequest,
  type GodPageRef,
} from '@core/god/godReaderBinding';
import { coverSourceToTag, resolveCoverSource } from '@core/god/godCoverEngine';
import { GOD_RATING_MAX, GOD_RATING_MIN, type GodMoment } from '@core/god/godTypes';

function moment(overrides: Partial<GodMoment> = {}): GodMoment {
  return {
    id: 1,
    contentType: 'comic',
    bookId: 'local_1',
    chapterId: 'c120',
    bookTitle: '诡秘之主',
    chapterTitle: '第一百二十章',
    chapterNumber: 120,
    title: '克莱恩成神之夜',
    titleIsCustom: true,
    rating: 5,
    note: '',
    coverPath: null,
    coverSource: 'page|3|abc',
    cropParams: '1,0,0,0,0,0,1,1',
    createdAt: 1_000,
    updatedAt: 2_000,
    ...overrides,
  };
}

const comicPageTag = (pageIndex: number): string =>
  coverSourceToTag({ kind: 'comicPage', pageIndex, pageId: '' });

/* ══════════════ 绑定（GodReaderBinding.kt） ══════════════ */

describe('godBindingEnabled (GodReaderBinding.kt L30)', () => {
  it('is false without an entry point', () => {
    expect(godBindingEnabled(null)).toBe(false);
    expect(godBindingEnabled(() => undefined)).toBe(true);
  });
});

describe('createGodReaderBinding (L62 / L134)', () => {
  it('starts closed', () => {
    expect(createGodReaderBinding().request).toBeNull();
  });
});

describe('godContextEnabled (GodMomentModels.kt L261)', () => {
  it('requires both bookId and chapterId', () => {
    expect(godContextEnabled(null)).toBe(false);
    expect(godContextEnabled({ bookId: '', chapterId: 'c', bookTitle: 't' })).toBe(false);
    expect(godContextEnabled({ bookId: 'b', chapterId: '', bookTitle: 't' })).toBe(false);
    expect(godContextEnabled({ bookId: 'b', chapterId: 'c', bookTitle: 't' })).toBe(true);
  });
});

describe('godBindingClampPageIndex (GodReaderBinding.kt L70)', () => {
  it('converges to 0 for an empty page list', () => {
    expect(godBindingClampPageIndex(5, 0)).toBe(0);
    expect(godBindingClampPageIndex(0, 0)).toBe(0);
  });

  it('clamps into [0, count-1]', () => {
    expect(godBindingClampPageIndex(-4, 5)).toBe(0);
    expect(godBindingClampPageIndex(2, 5)).toBe(2);
    expect(godBindingClampPageIndex(4, 5)).toBe(4);
    expect(godBindingClampPageIndex(9, 5)).toBe(4);
  });

  it('treats non-finite input as 0', () => {
    expect(godBindingClampPageIndex(Number.NaN, 5)).toBe(0);
  });
});

describe('godBindingBuildRequest (GodReaderBinding.kt L64-82)', () => {
  const pages: GodPageRef[] = [
    { id: 'p0', source: 'a.jpg', remote: false },
    { id: 'p1', source: 'b.jpg', remote: false },
    { id: 'p2', source: 'c.jpg', remote: false },
  ];
  const ctx = {
    bookId: 'local_1',
    chapterId: 'c120',
    bookTitle: '诡秘之主',
    chapterTitle: '第一百二十章',
    chapterNumber: 120,
  };

  it('returns null when the context is missing (L64 `if (ctx != null)`)', () => {
    expect(godBindingBuildRequest(null, pages, () => 1)).toBeNull();
  });

  it('always builds a COMIC request (L72)', () => {
    const req = godBindingBuildRequest(ctx, pages, () => 1);
    expect(req?.contentType).toBe('comic');
    expect(req?.bookId).toBe('local_1');
    expect(req?.chapterId).toBe('c120');
    expect(req?.chapterTitle).toBe('第一百二十章');
    expect(req?.chapterNumber).toBe(120);
    expect(req?.initialPageIndex).toBe(1);
    expect(req?.pages).toHaveLength(3);
  });

  it('clamps the current page and falls back to defaults', () => {
    expect(godBindingBuildRequest(ctx, pages, () => 99)?.initialPageIndex).toBe(2);
    expect(godBindingBuildRequest(ctx, [], () => 3)?.initialPageIndex).toBe(0);
    const bare = godBindingBuildRequest(
      { bookId: 'b', chapterId: 'c', bookTitle: 't' },
      [],
      () => 0,
    );
    expect(bare?.chapterTitle).toBe('');
    expect(bare?.chapterNumber).toBe(0);
  });
});

describe('godBindingOpenEdit (GodReaderBinding.kt L36-47)', () => {
  it('carries the page index only for comic-page sources (L45)', () => {
    const comic = godBindingOpenEdit(moment(), [], resolveCoverSource);
    expect(comic.initialPageIndex).toBe(3);
    expect(comic.contentType).toBe('comic');
    expect(comic.bookTitle).toBe('诡秘之主');
    expect(comic.chapterNumber).toBe(120);
  });

  it('falls back to page 0 for album / novel-excerpt sources', () => {
    const album = godBindingOpenEdit(
      moment({ coverSource: 'album|content://x' }),
      [],
      resolveCoverSource,
    );
    expect(album.initialPageIndex).toBe(0);

    const novel = godBindingOpenEdit(moment({ coverSource: 'novel|ch|1|5' }), [], resolveCoverSource);
    expect(novel.initialPageIndex).toBe(0);
  });

  it('passes the pages through', () => {
    const pages: GodPageRef[] = [{ id: 'p0', source: 'a', remote: true }];
    expect(godBindingOpenEdit(moment(), pages, resolveCoverSource).pages).toBe(pages);
  });
});

describe('godBindingLoadKey (GodReaderBinding.kt L100 / L153)', () => {
  it('keys the pre-first-frame load on (bookId, chapterId)', () => {
    const a = createGodMomentRequest({ bookId: 'b', chapterId: 'c', bookTitle: 't' });
    const b = createGodMomentRequest({ bookId: 'b', chapterId: 'c', bookTitle: 'other' });
    const c = createGodMomentRequest({ bookId: 'b', chapterId: 'd', bookTitle: 't' });
    expect(godBindingLoadKey(a)).toBe(godBindingLoadKey(b));
    expect(godBindingLoadKey(a)).not.toBe(godBindingLoadKey(c));
  });
});

describe('godBindingNeedsRemoteLoader (GodReaderBinding.kt L164-170)', () => {
  it('is false for purely local chapters (不为纯本地场景拉起整套加载器)', () => {
    expect(godBindingNeedsRemoteLoader([])).toBe(false);
    expect(
      godBindingNeedsRemoteLoader([
        { id: 'a', source: 'a.jpg', remote: false },
        { id: 'b', source: 'b.jpg', remote: false },
      ]),
    ).toBe(false);
  });

  it('is true when any page is remote', () => {
    expect(
      godBindingNeedsRemoteLoader([
        { id: 'a', source: 'a.jpg', remote: false },
        { id: 'b', source: 'https://x/b.jpg', remote: true },
      ]),
    ).toBe(true);
  });
});

describe('godPageHeaders (GodMomentModels.kt L291-297)', () => {
  it('returns the headers untouched for a blank referer', () => {
    expect(godPageHeaders({ A: '1' }, null)).toEqual({ A: '1' });
    expect(godPageHeaders({ A: '1' }, '   ')).toEqual({ A: '1' });
  });

  it('appends Referer when absent', () => {
    expect(godPageHeaders({ A: '1' }, 'https://host/')).toEqual({
      A: '1',
      Referer: 'https://host/',
    });
  });

  it('keeps an existing Referer (case-insensitive)', () => {
    expect(godPageHeaders({ referer: 'https://keep/' }, 'https://new/')).toEqual({
      referer: 'https://keep/',
    });
    expect(godPageHeaders({ REFERER: 'https://keep/' }, 'https://new/')).toEqual({
      REFERER: 'https://keep/',
    });
  });
});

describe('godPageHeaderMap (GodMomentModels.kt L286)', () => {
  it('defaults to an empty map', () => {
    expect(godPageHeaderMap({ id: 'a', source: 's', remote: false })).toEqual({});
    expect(godPageHeaderMap({ id: 'a', source: 's', remote: true, headers: { A: '1' } })).toEqual({
      A: '1',
    });
  });
});

describe('decode constants (GodCoverEngine.kt L79 / L214)', () => {
  it('keeps DECODE_MAX_EDGE = 1600 and THUMB_MAX_EDGE = 320', () => {
    expect(GOD_DECODE_MAX_EDGE).toBe(1600);
    expect(GOD_THUMB_MAX_EDGE).toBe(320);
  });
});

/* ══════════════ 可编辑星级（GodStarRating.kt 可交互半边） ══════════════ */

describe('clampRating / GodStarRating.kt L56-58', () => {
  it('snaps to the 0.5 step', () => {
    expect(clampRating(3.2)).toBe(3);
    expect(clampRating(3.3)).toBe(3.5);
    expect(clampRating(4.74)).toBe(4.5);
    expect(clampRating(4.76)).toBe(5);
  });

  it('clamps into [0.5, 5] — 0 分自相矛盾（L51 注释）', () => {
    expect(clampRating(-10)).toBe(GOD_RATING_MIN);
    expect(clampRating(0)).toBe(GOD_RATING_MIN);
    expect(clampRating(0.2)).toBe(0.5);
    expect(clampRating(99)).toBe(GOD_RATING_MAX);
  });

  it('never produces float noise', () => {
    expect(clampRating(2.5)).toBe(2.5);
    expect(String(clampRating(1 / 3))).toBe('0.5');
  });
});

describe('godRatingCommit (GodStarRating.kt L96-104)', () => {
  it('is a no-op when the value does not change (L98 `if (v == rating) return`)', () => {
    const result = godRatingCommit(3, 3.2, 3);
    expect(result.value).toBe(3);
    expect(result.changed).toBe(false);
    expect(result.haptic).toBe(false);
    expect(result.nextLastHaptic).toBe(3);
  });

  it('reports a haptic step only when the step differs from the last one (L99)', () => {
    const first = godRatingCommit(2.5, 3.0, 2.5);
    expect(first).toEqual({ value: 3, changed: true, haptic: true, nextLastHaptic: 3 });

    // 同一半星步进内再点 → 不再震动
    const same = godRatingCommit(2.5, 3.1, 3);
    expect(same.changed).toBe(true);
    expect(same.haptic).toBe(false);
    expect(same.value).toBe(3);
    expect(same.nextLastHaptic).toBe(3);
  });

  it('clamps before comparing', () => {
    expect(godRatingCommit(4.5, 99, 4.5).value).toBe(5);
    expect(godRatingCommit(1, -5, 1).value).toBe(0.5);
  });
});

describe('godRatingFromX (GodStarRating.kt L117-119 / L129-131)', () => {
  it('returns null for a zero-width row (L117 `if (w <= 0f) return`)', () => {
    expect(godRatingFromX(10, 0)).toBeNull();
    expect(godRatingFromX(10, -3)).toBeNull();
  });

  it('maps the row to 0.5..5', () => {
    const w = 350;
    expect(godRatingFromX(0, w)).toBe(GOD_RATING_MIN);
    expect(godRatingFromX(w, w)).toBe(GOD_RATING_MAX);
    expect(godRatingFromX(w / 2, w)).toBe(2.5);
    expect(godRatingFromX(w * 0.9, w)).toBe(4.5);
  });
});

describe('godRatingIsInteractive (GodStarRating.kt L113-114, L122-123)', () => {
  it('mirrors the enabled flag', () => {
    expect(godRatingIsInteractive(true)).toBe(true);
    expect(godRatingIsInteractive(false)).toBe(false);
  });
});

describe('godStarFill / half-star detection (GodStarRating.kt L138, L220)', () => {
  it('fills whole / half / empty stars', () => {
    expect(godStarFill(5, 1)).toBe(1);
    expect(godStarFill(5, 5)).toBe(1);
    expect(godStarFill(3.5, 4)).toBe(0.5);
    expect(godStarFill(3.5, 5)).toBe(0);
    expect(godStarFill(3.5, 1)).toBe(1);
  });

  it('detects the half star that clipRect draws as the left half only', () => {
    expect(godStarIsHalfFilled(3.5, 4)).toBe(true);
    expect(godStarIsHalfFilled(3.5, 3)).toBe(false);
    expect(godStarIsHalfFilled(3.5, 5)).toBe(false);
  });

  it('clamps out-of-range indices', () => {
    expect(godStarFill(5, 0)).toBe(1);
    expect(godStarFill(0, 1)).toBe(0);
  });
});

describe('godStarScaleTarget (GodStarRating.kt L185)', () => {
  it('is 1 when lit and 0.82 when not', () => {
    expect(godStarScaleTarget(1)).toBe(1);
    expect(godStarScaleTarget(0.5)).toBe(1);
    expect(godStarScaleTarget(0)).toBe(0.82);
  });
});

describe('nextGodSparkKey (GodStarRating.kt L87-94)', () => {
  it('increments only when the rating actually changed', () => {
    const bumped = nextGodSparkKey(3, 4, 3.5);
    expect(bumped).toEqual({ sparkKey: 4, lastRating: 4 });

    const same = nextGodSparkKey(4, 4, 4);
    expect(same).toEqual({ sparkKey: 4, lastRating: 4 });
  });
});

describe('godSparkParticles (GodStarRating.kt L254-266)', () => {
  it('draws nothing outside the 0..1 window (L254)', () => {
    expect(godSparkParticles(0, 34)).toEqual([]);
    expect(godSparkParticles(1, 34)).toEqual([]);
    expect(godSparkParticles(-0.1, 34)).toEqual([]);
  });

  it('emits 6 particles evenly spaced from -90°', () => {
    const particles = godSparkParticles(0.5, 40);
    expect(particles).toHaveLength(6);
    expect(particles[0]?.angle).toBeCloseTo(-Math.PI / 2, 10);
    expect(particles[5]?.angle).toBeCloseTo(-Math.PI / 2 + (5 * (2 * Math.PI)) / 6, 10);
  });

  it('follows the Kotlin geometry', () => {
    const w = 40;
    const p = 0.5;
    const particles = godSparkParticles(p, w);
    for (const particle of particles) {
      expect(particle.distance).toBeCloseTo(w * 0.55 * p, 10);
      expect(particle.alpha).toBeCloseTo(0.9 * 0.5, 10);
      expect(particle.radius).toBeCloseTo(w * 0.055 * (1 - p * 0.5), 10);
    }
  });
});

/* ══════════════ Sheet 表单（GodMomentSheet.kt） ══════════════ */

describe('GodMomentSheet constants (L221-223)', () => {
  it('keeps TITLE_MAX 30 / NOTE_MAX 500 / height fraction 0.92', () => {
    expect(GOD_SHEET_TITLE_MAX).toBe(30);
    expect(GOD_SHEET_NOTE_MAX).toBe(500);
    expect(GOD_SHEET_HEIGHT_FRACTION).toBeCloseTo(0.92, 10);
  });
});

describe('godSheetInitialCoverTag (L252-256)', () => {
  const request = createGodMomentRequest({
    bookId: 'b',
    chapterId: 'c',
    bookTitle: 't',
    initialPageIndex: -3,
  });

  it('uses the existing cover source when editing', () => {
    expect(godSheetInitialCoverTag(moment(), request, coverSourceToTag)).toBe('page|3|abc');
  });

  it('falls back to ComicPage(initialPageIndex) with coerceAtLeast(0)', () => {
    expect(godSheetInitialCoverTag(null, request, coverSourceToTag)).toBe('page|0|');
    expect(
      godSheetInitialCoverTag(
        null,
        createGodMomentRequest({
          bookId: 'b',
          chapterId: 'c',
          bookTitle: 't',
          initialPageIndex: 2,
        }),
        coverSourceToTag,
      ),
    ).toBe('page|2|');
  });
});

describe('godSheetInitialRating (L265-267)', () => {
  it('defaults to 5 and clamps to [0.5, 5]', () => {
    expect(godSheetInitialRating(null)).toBe(5);
    expect(godSheetInitialRating(moment({ rating: 3.5 }))).toBe(3.5);
    expect(godSheetInitialRating(moment({ rating: 99 }))).toBe(5);
    expect(godSheetInitialRating(moment({ rating: -1 }))).toBe(0.5);
  });
});

describe('godSheetInitialTitleState (L268-272)', () => {
  it('only seeds the text when the title is custom', () => {
    expect(godSheetInitialTitleState(moment({ titleIsCustom: true, title: 'X' }))).toEqual({
      titleCustom: true,
      titleText: 'X',
    });
    expect(
      godSheetInitialTitleState(moment({ titleIsCustom: false, title: 'ignored' })),
    ).toEqual({ titleCustom: false, titleText: '' });
    expect(godSheetInitialTitleState(null)).toEqual({ titleCustom: false, titleText: '' });
  });
});

describe('godSheetDefaultTitle / godSheetShownTitle (L274-275)', () => {
  const request = createGodMomentRequest({
    bookId: 'b',
    chapterId: 'c',
    bookTitle: '诡秘之主',
    chapterNumber: 120,
  });

  it('builds 「书名 第X话」', () => {
    expect(godSheetDefaultTitle(request)).toBe('诡秘之主 第120话');
  });

  it('prefers a non-blank custom title', () => {
    expect(godSheetShownTitle(true, '自定义', '默认')).toBe('自定义');
    expect(godSheetShownTitle(true, '   ', '默认')).toBe('默认');
    expect(godSheetShownTitle(false, '自定义', '默认')).toBe('默认');
  });
});

describe('godSheetTitleChanged / godSheetNoteChanged (L523-528 / L543)', () => {
  it('truncates the title at 30 chars and treats blank as "not custom"', () => {
    expect(godSheetTitleChanged('x'.repeat(40))).toEqual({
      titleText: 'x'.repeat(30),
      titleCustom: true,
    });
    expect(godSheetTitleChanged('  ')).toEqual({ titleText: '  ', titleCustom: false });
    expect(godSheetTitleChanged('')).toEqual({ titleText: '', titleCustom: false });
  });

  it('truncates the note at 500 chars', () => {
    expect(godSheetNoteChanged('y'.repeat(600))).toHaveLength(500);
    expect(godSheetNoteChanged('短')).toBe('短');
  });
});

describe('godSheetIsDirty (L337-346)', () => {
  const request = createGodMomentRequest({
    bookId: 'b',
    chapterId: 'c',
    bookTitle: 't',
    initialPageIndex: 2,
  });
  const base = {
    request,
    comicPageTag,
    cropTag: '1,0,0,0,0,0,1,1',
  };

  it('is clean for a brand-new sheet at defaults', () => {
    expect(
      godSheetIsDirty({
        ...base,
        existing: null,
        rating: 5,
        titleCustom: false,
        titleText: '',
        note: '',
        coverSourceTag: comicPageTag(2),
      }),
    ).toBe(false);
  });

  it('is dirty for a new sheet with any non-default field', () => {
    expect(
      godSheetIsDirty({
        ...base,
        existing: null,
        rating: 4.5,
        titleCustom: false,
        titleText: '',
        note: '',
        coverSourceTag: comicPageTag(2),
      }),
    ).toBe(true);
    expect(
      godSheetIsDirty({
        ...base,
        existing: null,
        rating: 5,
        titleCustom: true,
        titleText: 'x',
        note: '',
        coverSourceTag: comicPageTag(2),
      }),
    ).toBe(true);
    expect(
      godSheetIsDirty({
        ...base,
        existing: null,
        rating: 5,
        titleCustom: false,
        titleText: '',
        note: '   ',
        coverSourceTag: comicPageTag(2),
      }),
    ).toBe(false);
    expect(
      godSheetIsDirty({
        ...base,
        existing: null,
        rating: 5,
        titleCustom: false,
        titleText: '',
        note: '有内容',
        coverSourceTag: comicPageTag(2),
      }),
    ).toBe(true);
    expect(
      godSheetIsDirty({
        ...base,
        existing: null,
        rating: 5,
        titleCustom: false,
        titleText: '',
        note: '',
        coverSourceTag: comicPageTag(3),
      }),
    ).toBe(true);
  });

  it('compares every field when editing', () => {
    const existing = moment();
    const clean = {
      existing,
      rating: existing.rating,
      titleCustom: existing.titleIsCustom,
      titleText: existing.title,
      note: existing.note,
      coverSourceTag: existing.coverSource,
    };
    expect(godSheetIsDirty({ ...base, ...clean })).toBe(false);

    expect(godSheetIsDirty({ ...base, ...clean, rating: 4 })).toBe(true);
    expect(godSheetIsDirty({ ...base, ...clean, titleCustom: false })).toBe(true);
    expect(godSheetIsDirty({ ...base, ...clean, titleText: '别的' })).toBe(true);
    expect(godSheetIsDirty({ ...base, ...clean, note: '别的' })).toBe(true);
    expect(godSheetIsDirty({ ...base, ...clean, coverSourceTag: 'page|9|' })).toBe(true);
    expect(godSheetIsDirty({ ...base, ...clean, cropTag: '2,0,0,0,0,0,1,1' })).toBe(true);
  });

  it('compares the title text against "" when the entity is not custom', () => {
    const existing = moment({ titleIsCustom: false, title: '' });
    expect(
      godSheetIsDirty({
        ...base,
        existing,
        rating: existing.rating,
        titleCustom: false,
        titleText: '',
        note: existing.note,
        coverSourceTag: existing.coverSource,
        cropTag: existing.cropParams,
      }),
    ).toBe(false);
  });
});

describe('godSheetCoverLoadKey (L278-281)', () => {
  const pages: GodPageRef[] = [{ id: 'p0', source: 'a', remote: false }];

  it('changes when the source, retry counter, pages, or fallback change', () => {
    const args = {
      coverSourceTag: 'page|0|',
      coverRetry: 0,
      pages,
      fallbackCoverPath: null,
      hasRemoteLoader: false,
    };
    const key = godSheetCoverLoadKey(args);
    expect(godSheetCoverLoadKey({ ...args, coverSourceTag: 'page|1|' })).not.toBe(key);
    expect(godSheetCoverLoadKey({ ...args, coverRetry: 1 })).not.toBe(key);
    expect(
      godSheetCoverLoadKey({ ...args, pages: [{ id: 'pX', source: 'x', remote: true }] }),
    ).not.toBe(key);
    expect(godSheetCoverLoadKey({ ...args, fallbackCoverPath: '/c.jpg' })).not.toBe(key);
    expect(godSheetCoverLoadKey({ ...args, hasRemoteLoader: true })).not.toBe(key);
    expect(godSheetCoverLoadKey({ ...args })).toBe(key);
  });
});

describe('godSheetShouldRetryCover / godSheetPickPage (L483-487)', () => {
  it('retries only when re-picking the same page with no bitmap and no load in flight', () => {
    expect(
      godSheetShouldRetryCover({
        currentSource: { kind: 'comicPage', pageIndex: 1, pageId: '' },
        pageIndex: 1,
        loading: false,
        hasBitmap: false,
      }),
    ).toBe(true);

    expect(
      godSheetShouldRetryCover({
        currentSource: { kind: 'comicPage', pageIndex: 1, pageId: '' },
        pageIndex: 1,
        loading: true,
        hasBitmap: false,
      }),
    ).toBe(false);

    expect(
      godSheetShouldRetryCover({
        currentSource: { kind: 'comicPage', pageIndex: 1, pageId: '' },
        pageIndex: 1,
        loading: false,
        hasBitmap: true,
      }),
    ).toBe(false);

    expect(
      godSheetShouldRetryCover({
        currentSource: { kind: 'comicPage', pageIndex: 0, pageId: '' },
        pageIndex: 1,
        loading: false,
        hasBitmap: false,
      }),
    ).toBe(false);

    expect(
      godSheetShouldRetryCover({
        currentSource: { kind: 'album', uri: 'content://x' },
        pageIndex: 1,
        loading: false,
        hasBitmap: false,
      }),
    ).toBe(false);
  });

  it('switches to the picked page and resets the crop (L485-486)', () => {
    const result = godSheetPickPage({
      currentSource: { kind: 'album', uri: 'content://x' },
      pageIndex: 4,
      loading: false,
      hasBitmap: true,
    });
    expect(result.retry).toBe(0);
    expect(result.coverSource).toEqual({ kind: 'comicPage', pageIndex: 4, pageId: '' });
  });
});

/* ══════════════ 提示胶囊（GodPull.kt L293-320） ══════════════ */

describe('godHintCapsule (GodPull.kt L293-320)', () => {
  it('keeps the default copy', () => {
    expect(GOD_HINT_CAPSULE_TEXT).toBe('继续滑动 · 标记神回');
  });

  it('gates on alpha > 0.01 (L305)', () => {
    expect(godHintCapsuleShouldRender(0)).toBe(false);
    expect(godHintCapsuleShouldRender(0.01)).toBe(false);
    expect(godHintCapsuleShouldRender(0.011)).toBe(true);
    expect(godHintCapsuleShouldRender(1)).toBe(true);
  });
});

describe('godPullOverlayText (GodPull.kt L272-288)', () => {
  it('switches the three copy lines on the armed flag', () => {
    expect(godPullOverlayText(false)).toEqual({
      glyph: '◇',
      primary: '继续滑动',
      secondary: '标记为神回',
    });
    expect(godPullOverlayText(true)).toEqual({
      glyph: '✦',
      primary: '松手，收藏这一刻',
      secondary: '神回已就绪',
    });
  });
});

/* ══════════════ 请求模型默认值（GodMomentModels.kt L266-277） ══════════════ */

describe('createGodMomentRequest (GodMomentModels.kt L267-276)', () => {
  it('applies every documented default', () => {
    const req = createGodMomentRequest({ bookId: 'b', chapterId: 'c', bookTitle: 't' });
    expect(req).toEqual({
      contentType: 'comic',
      bookId: 'b',
      chapterId: 'c',
      bookTitle: 't',
      chapterTitle: '',
      chapterNumber: 0,
      pages: [],
      initialPageIndex: 0,
    });
  });

  it('keeps explicit values', () => {
    const req: GodMomentRequest = createGodMomentRequest({
      contentType: 'novel',
      bookId: 'b',
      chapterId: 'c',
      bookTitle: 't',
      chapterTitle: 'ch',
      chapterNumber: 3,
      initialPageIndex: 7,
    });
    expect(req.contentType).toBe('novel');
    expect(req.chapterTitle).toBe('ch');
    expect(req.chapterNumber).toBe(3);
    expect(req.initialPageIndex).toBe(7);
  });
});

describe('cover-source round trip through the binding helpers', () => {
  it('shares godCoverEngine resolvers with the sheet', () => {
    const onArm = vi.fn();
    expect(onArm).not.toHaveBeenCalled();
    expect(resolveCoverSource(comicPageTag(6))).toEqual({
      kind: 'comicPage',
      pageIndex: 6,
      pageId: '',
    });
  });
});
