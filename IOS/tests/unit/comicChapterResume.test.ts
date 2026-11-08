import { describe, expect, it } from 'vitest';
import {
  comicChapterResumeFromJson,
  comicChapterResumeToJson,
  comicChapterStartPage,
  createComicChapterResume,
  LAST_PAGE_REQUEST,
} from '@core/comic/comicChapterResume';

/**
 * 期望值按 Kotlin 源码字面量推演。Kotlin 源：ui/comic/ComicChapterResume.kt L6-25。
 */

describe('comicChapterResume (Kotlin ComicChapterResume.kt)', () => {
  describe('toJson / fromJson round-trip (L11, L20-24)', () => {
    it('round-trips the three fields', () => {
      const resume = createComicChapterResume(7, 3, 120);
      expect(comicChapterResumeToJson(resume)).toEqual({ page: 7, scrollPage: 3, scrollOffset: 120 });
      expect(comicChapterResumeFromJson({ page: 7, scrollPage: 3, scrollOffset: 120 })).toEqual(resume);
    });

    it('defaults to {0, -1, 0} for a missing / empty object', () => {
      expect(comicChapterResumeFromJson({})).toEqual({ page: 0, scrollPage: -1, scrollOffset: 0 });
      expect(comicChapterResumeFromJson(null)).toEqual({ page: 0, scrollPage: -1, scrollOffset: 0 });
      expect(comicChapterResumeFromJson(undefined)).toEqual({ page: 0, scrollPage: -1, scrollOffset: 0 });
    });

    it('coerces each field to its own floor (optInt + coerceAtLeast)', () => {
      // page floor 0, scrollPage floor -1, scrollOffset floor 0
      expect(comicChapterResumeFromJson({ page: -5, scrollPage: -9, scrollOffset: -3 })).toEqual({
        page: 0,
        scrollPage: -1,
        scrollOffset: 0,
      });
    });

    it('treats a non-numeric value as the default (JSONObject.optInt)', () => {
      expect(comicChapterResumeFromJson({ page: 'abc', scrollPage: null, scrollOffset: {} })).toEqual({
        page: 0,
        scrollPage: -1,
        scrollOffset: 0,
      });
    });
  });

  describe('startPage (L13-17)', () => {
    const count = 10;

    it('LAST_PAGE_REQUEST jumps to the last page', () => {
      const resume = createComicChapterResume(2, -1, 0);
      expect(comicChapterStartPage(resume, LAST_PAGE_REQUEST, count, false)).toBe(9);
      expect(LAST_PAGE_REQUEST).toBe(2147483647);
    });

    it('an explicit request different from the stored page wins', () => {
      const resume = createComicChapterResume(2, -1, 0);
      expect(comicChapterStartPage(resume, 5, count, false)).toBe(5);
      expect(comicChapterStartPage(resume, 5, count, true)).toBe(5);
    });

    it('falls back to scrollPage in vertical mode when the request matches the stored page', () => {
      // requested == page → rule 2 does not fire → vertical → scrollPage
      const resume = createComicChapterResume(4, 6, 0);
      expect(comicChapterStartPage(resume, 4, count, true)).toBe(6);
      // …but not in horizontal mode, where rule 4 re-applies the request
      expect(comicChapterStartPage(resume, 4, count, false)).toBe(4);
    });

    it('uses the stored page when nothing else applies', () => {
      const resume = createComicChapterResume(3, -1, 0);
      expect(comicChapterStartPage(resume, 0, count, false)).toBe(3);
      expect(comicChapterStartPage(resume, 0, count, true)).toBe(3);
    });

    it('ignores an unrecorded scrollPage (scrollPage == -1)', () => {
      const resume = createComicChapterResume(3, -1, 0);
      // requested == page → rule 2 no; vertical && scrollPage >= 0 → no;
      // requested > 0 → no → stored page
      expect(comicChapterStartPage(resume, 3, count, true)).toBe(3);
    });

    it('clamps the result into [0, max(0, count - 1)]', () => {
      const resume = createComicChapterResume(0, -1, 0);
      expect(comicChapterStartPage(resume, 99, count, false)).toBe(9);
      expect(comicChapterStartPage(resume, -7, count, false)).toBe(0);
      // count == 0 → hi = max(0, -1) = 0
      expect(comicChapterStartPage(resume, 5, 0, false)).toBe(0);
    });
  });
});
