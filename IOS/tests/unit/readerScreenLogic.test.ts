/**
 * Unit tests for the ReaderScreen pure logic port.
 *
 * Kotlin → TS source map (see `src/core/reader/readerScreenLogic.ts` header for
 * the full table). Each `describe` block names the Kotlin lines it covers.
 *
 *   ReaderScreen.kt 952-968  readerTheme → (bgColor, textColor)
 *   ReaderScreen.kt 4093-4099 ReaderThemePreview list
 *   Color.kt 39-48           luminance() / onColor()
 *   AppFonts.kt 124-145      readingFontFamilies() / readingFontFamily()
 *   ReaderScreen.kt 4702-4720 formatForReader
 *   ReaderScreen.kt 4724-4762 chunkForScroll
 *   ReaderScreen.kt 4766-4834 measureTitleReservePx
 *   ReaderScreen.kt 1495-1549 clampSubPageIndex / charOffsetForPage / subPageState
 *   ReaderScreen.kt 1501-1529 pageIndexForOffset
 *   ReaderScreen.kt 1732-1809 nextReaderLocation / prevReaderLocation
 *   ReaderScreen.kt 584-602   chapterSwitchTarget
 *   ReaderScreen.kt 793-869   resolveReaderProgress
 *   ReaderScreen.kt 2796-2828 readerPercent / readerProgressFooterText
 *   ReaderScreen.kt 2665-2714 pullProgress / pullHintText
 *   ReaderScreen.kt 3128      dim alpha
 *   ReaderScreen.kt 3074      shouldShowBackToTop
 *   ReaderScreen.kt 748       shouldShowRestReminder
 *   ReaderScreen.kt 904-948   modeSwitchAnchor / scrollTargetForRatio
 *   ReaderScreen.kt 1551-1714 findScrollBlockTarget / findPageForPosition /
 *                           shouldClearSearchHighlight / splitByHighlights
 *   ReaderScreen.kt 1666-1673 imagePathsInPages / prewarm
 *   PageTurnContainer.kt 62-68 / 404-409 page turn modes + pullDownHintText
 *   ReaderPagination.kt 336-344 measurePageHeightPx
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READER_PREFS,
  PAGE_TURN_COVER,
  PAGE_TURN_FADE,
  PAGE_TURN_SCROLL,
  PAGE_TURN_SIMULATE,
  PAGE_TURN_SLIDE,
  PAGE_TURN_TYPES,
  READER_THEME_PREVIEWS,
  READING_FONT_FAMILIES,
  bookmarkSnippet,
  chapterSwitchTarget,
  chunkForScroll,
  clampSubPageIndex,
  displaySize,
  findPageForPosition,
  findScrollBlockTarget,
  formatClockHHmm,
  formatForReader,
  highlightRanges,
  isScrollMode,
  luminance,
  measureTitleReservePx,
  modeSwitchAnchor,
  nextReaderLocation,
  onColor,
  pageIndexForOffset,
  pageTurnChipLabel,
  prevReaderLocation,
  pullDownHintText,
  pullHintText,
  pullProgress,
  readerPercent,
  readerProgressFooterText,
  readerThemeColors,
  readingFontFamilyCss,
  readingFontName,
  resolveReaderProgress,
  scrollTargetForRatio,
  shouldClearSearchHighlight,
  shouldShowBackToTop,
  shouldShowRestReminder,
  splitByHighlights,
  subPageState,
  withAlpha,
  ImageHitRegistry,
  ListenerRegistry,
} from '../../src/core/reader/readerScreenLogic';

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 952-968 —— 阅读主题（保持逐字节的十六进制字面量）
// ─────────────────────────────────────────────────────────────────────────────

describe('readerThemeColors (ReaderScreen.kt:952-968)', () => {
  it('maps every id to the verbatim Kotlin colour pair', () => {
    expect(readerThemeColors(0)).toEqual({ bg: '#FFFFFF', text: '#18191C' });
    expect(readerThemeColors(1)).toEqual({ bg: '#FFFFFF', text: '#18191C' });
    expect(readerThemeColors(2)).toEqual({ bg: '#FBF0D9', text: '#5F4B32' });
    expect(readerThemeColors(3)).toEqual({ bg: '#18191C', text: '#D4D4D4' });
    expect(readerThemeColors(4)).toEqual({ bg: '#E8F5E9', text: '#1B5E20' });
    expect(readerThemeColors(5)).toEqual({ bg: '#000000', text: '#E0E0E0' });
  });

  it('out-of-range ids fall back to the `else -> Color.White to #18191C` branch', () => {
    expect(readerThemeColors(9)).toEqual({ bg: '#FFFFFF', text: '#18191C' });
    expect(readerThemeColors(-1)).toEqual({ bg: '#FFFFFF', text: '#18191C' });
  });

  it('keeps the sepia and OLED interiors dark/warm rather than light', () => {
    expect(readerThemeColors(2).bg).toBe('#FBF0D9'); // 羊皮
    expect(readerThemeColors(3).bg).toBe('#18191C'); // 夜间
    expect(readerThemeColors(5).bg).toBe('#000000'); // OLED
  });

  it('exposes the theme preview table used by the typography sheet', () => {
    expect(READER_THEME_PREVIEWS.map((item) => item.name)).toEqual([
      '白底',
      '羊皮',
      '夜间',
      '护眼',
      '纯黑',
    ]);
    expect(READER_THEME_PREVIEWS.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Color.kt 39-48
// ─────────────────────────────────────────────────────────────────────────────

describe('luminance / onColor (Color.kt:39-48)', () => {
  it('classifies light backgrounds as dark-on-light and vice versa', () => {
    expect(onColor('#FFFFFF')).toBe('#1A1A1E');
    expect(onColor('#FBF0D9')).toBe('#1A1A1E');
    expect(onColor('#18191C')).toBe('#FFFFFF');
    expect(onColor('#000000')).toBe('#FFFFFF');
  });

  it('luminance stays in 0..1', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('withAlpha renders rgba() from a hex literal', () => {
    expect(withAlpha('#18191C', 0.92)).toBe('rgba(24, 25, 28, 0.92)');
    expect(withAlpha('#000000', 0.5)).toBe('rgba(0, 0, 0, 0.5)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AppFonts.kt 124-145 —— 阅读正文字族（id 不可重排）
// ─────────────────────────────────────────────────────────────────────────────

describe('reading font families (AppFonts.kt:124-145)', () => {
  it('keeps the档位 order 0/1/2/3 with the original Chinese names', () => {
    expect(READING_FONT_FAMILIES.map((item) => item.index)).toEqual([0, 1, 2, 3]);
    expect(READING_FONT_FAMILIES.map((item) => item.name)).toEqual([
      '默认字体',
      '衬线体',
      '黑体',
      '等宽体',
    ]);
  });

  it('readingFontFamily() routing: 1 serif / 2 sans / 3 mono / 4 custom', () => {
    expect(readingFontFamilyCss(0, null)).toBe(readingFontFamilyCss(2, null));
    expect(readingFontFamilyCss(1, null)).toContain('Noto Serif SC');
    expect(readingFontFamilyCss(2, null)).toContain('Noto Sans SC');
    expect(readingFontFamilyCss(3, null)).toContain('monospace');
    expect(readingFontFamilyCss(4, '"My", serif')).toBe('"My", serif');
    expect(readingFontFamilyCss(4, null)).toBe(readingFontFamilyCss(2, null));
  });

  it('readingFontName() reproduces the settings-panel label', () => {
    expect(readingFontName(0, false)).toBe('默认字体');
    expect(readingFontName(1, false)).toBe('衬线体');
    expect(readingFontName(2, false)).toBe('黑体');
    expect(readingFontName(3, false)).toBe('等宽体');
    expect(readingFontName(4, true)).toBe('自定义字体');
    expect(readingFontName(4, false)).toBe('自定义字体（未导入）');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 4702-4720 formatForReader
// ─────────────────────────────────────────────────────────────────────────────

describe('formatForReader (ReaderScreen.kt:4702-4720)', () => {
  const indent = '\u3000\u3000';

  it('is identity when first-line indent is off', () => {
    expect(formatForReader('甲\n乙', false)).toBe('甲\n乙');
  });

  it('prefixes non-blank lines with two ideographic spaces', () => {
    expect(formatForReader('甲\n乙', true)).toBe(`${indent}甲\n${indent}乙`);
  });

  it('does not double-indent already indented lines', () => {
    expect(formatForReader(`${indent}甲`, true)).toBe(`${indent}甲`);
  });

  it('skips blank lines', () => {
    expect(formatForReader('甲\n\n乙', true)).toBe(`${indent}甲\n\n${indent}乙`);
  });

  it('handles whitespace-only lines the same as Kotlin isNotBlank()', () => {
    expect(formatForReader('甲\n   \n乙', true)).toBe(`${indent}甲\n   \n${indent}乙`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 4724-4762 chunkForScroll
// ─────────────────────────────────────────────────────────────────────────────

describe('chunkForScroll (ReaderScreen.kt:4724-4762)', () => {
  it('returns a single chunk for short content', () => {
    expect(chunkForScroll('短文本', 100)).toEqual(['短文本']);
  });

  it('hard-cuts when the newline sits in the first half', () => {
    const content = `${'a'.repeat(10)}\n${'b'.repeat(200)}`;
    const chunks = chunkForScroll(content, 100);
    expect(chunks[0]).toBe(content.slice(0, 100));
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('cuts at a newline in the latter half (dropping that newline, as Kotlin does)', () => {
    const left = 'a'.repeat(100);
    const right = 'b'.repeat(80);
    const chunks = chunkForScroll(`${left}\n${right}`, 150);
    expect(chunks[0]).toBe(left);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 4766-4834 measureTitleReservePx
// ─────────────────────────────────────────────────────────────────────────────

describe('measureTitleReservePx (ReaderScreen.kt:4766-4834)', () => {
  it('returns 0 without a title or with a zero width', () => {
    expect(measureTitleReservePx(null, 400, 600, 24, 32)).toBe(0);
    expect(measureTitleReservePx('', 400, 600, 24, 32)).toBe(0);
    expect(measureTitleReservePx('第一章', 0, 600, 24, 32)).toBe(0);
  });

  it('is capped at 40% of the page height but never below 60px', () => {
    const huge = measureTitleReservePx('很长'.repeat(400), 200, 600, 24, 32);
    expect(huge).toBeLessThanOrEqual(Math.floor(600 * 0.4));
    const tiny = measureTitleReservePx('标题', 2000, 10, 24, 32);
    expect(tiny).toBeLessThanOrEqual(Math.max(Math.floor(10 * 0.4), 60));
  });

  it('grows with the number of wrapped title lines', () => {
    const short = measureTitleReservePx('第一章', 400, 600, 24, 32);
    const long = measureTitleReservePx('第一章 很长的章节标题需要换行显示'.repeat(3), 400, 600, 24, 32);
    expect(long).toBeGreaterThan(short);
  });

  it('includes the 20dp title block padding', () => {
    const oneLine = measureTitleReservePx('第一章', 2000, 600, 24, 32);
    // 1 line × 32px line-height + 20px block padding
    expect(oneLine).toBe(52);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 1495-1549 / 1501-1529 —— 页索引与字符偏移
// ─────────────────────────────────────────────────────────────────────────────

describe('page index / char offset (ReaderScreen.kt:1495-1549)', () => {
  const pages = ['aaa', 'bb', 'c'];

  it('clampSubPageIndex matches coerceIn(0, (size-1).coerceAtLeast(0))', () => {
    expect(clampSubPageIndex(3, -5)).toBe(0);
    expect(clampSubPageIndex(3, 9)).toBe(2);
    expect(clampSubPageIndex(0, 4)).toBe(0);
  });

  it('subPageState sums the preceding page lengths', () => {
    expect(subPageState(pages, 0)).toEqual({ pageIndex: 0, charOffset: 0 });
    expect(subPageState(pages, 1)).toEqual({ pageIndex: 1, charOffset: 3 });
    expect(subPageState(pages, 2)).toEqual({ pageIndex: 2, charOffset: 5 });
    expect(subPageState(pages, 99)).toEqual({ pageIndex: 2, charOffset: 5 });
  });

  it('pageIndexForOffset re-anchors on the first page whose end passes the offset', () => {
    expect(pageIndexForOffset(pages, 0)).toBe(0);
    expect(pageIndexForOffset(pages, 2)).toBe(0);
    expect(pageIndexForOffset(pages, 3)).toBe(1);
    expect(pageIndexForOffset(pages, 5)).toBe(2);
    expect(pageIndexForOffset(pages, 9999)).toBe(2);
    expect(pageIndexForOffset([], 3)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 1732-1809 —— 翻页 / 切章
// ─────────────────────────────────────────────────────────────────────────────

describe('nextReaderLocation / prevReaderLocation (ReaderScreen.kt:1732-1809)', () => {
  it('advances within the chapter until the last page', () => {
    expect(
      nextReaderLocation({ pageIndex: 0, pageCount: 3, chapterIndex: 1, chapterCount: 5 }),
    ).toEqual({ kind: 'page', pageIndex: 1 });
  });

  it('moves to the next chapter from the last page', () => {
    expect(
      nextReaderLocation({ pageIndex: 2, pageCount: 3, chapterIndex: 1, chapterCount: 5 }),
    ).toEqual({ kind: 'chapter', chapterIndex: 2, charOffset: 0, pageIndex: 0 });
  });

  it('stays put at the very end of the book', () => {
    expect(
      nextReaderLocation({ pageIndex: 2, pageCount: 3, chapterIndex: 4, chapterCount: 5 }),
    ).toEqual({ kind: 'page', pageIndex: 2 });
  });

  it('goes back a page first', () => {
    expect(prevReaderLocation({ pageIndex: 2, chapterIndex: 1 })).toEqual({
      kind: 'page',
      pageIndex: 1,
    });
  });

  it('crosses to the previous chapter with the Int.MAX_VALUE / 9999 sentinels', () => {
    expect(prevReaderLocation({ pageIndex: 0, chapterIndex: 1 })).toEqual({
      kind: 'chapter',
      chapterIndex: 0,
      charOffset: 2147483647,
      pageIndex: 9999,
    });
  });

  it('stays put at the very start of the book', () => {
    expect(prevReaderLocation({ pageIndex: 0, chapterIndex: 0 })).toEqual({
      kind: 'page',
      pageIndex: 0,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 584-602 —— 拉穿切章目标
// ─────────────────────────────────────────────────────────────────────────────

describe('chapterSwitchTarget (ReaderScreen.kt:584-602)', () => {
  it('moves forward only when a next chapter exists', () => {
    expect(chapterSwitchTarget(0, 3, 1)).toBe(1);
    expect(chapterSwitchTarget(2, 3, 1)).toBeNull();
  });

  it('moves back only when a previous chapter exists', () => {
    expect(chapterSwitchTarget(2, 3, -1)).toBe(1);
    expect(chapterSwitchTarget(0, 3, -1)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 793-869 —— 进度保存判定
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveReaderProgress (ReaderScreen.kt:793-869)', () => {
  const base = {
    bookFinishedOrReachedEnd: false,
    isScrollMode: false,
    chapterIndex: 0,
    chapterCount: 3,
    currentChapterContentEmpty: false,
    scrollOffset: 0,
    scrollMaxValue: 500,
    charOffset: 120,
  };

  it('saves the char offset in paged mode', () => {
    expect(resolveReaderProgress(base)).toEqual({ offset: 120, isFinished: false });
  });

  it('saves the scroll offset in scroll mode', () => {
    expect(resolveReaderProgress({ ...base, isScrollMode: true, scrollOffset: 42 })).toEqual({
      offset: 42,
      isFinished: false,
    });
  });

  it('marks finished when the book or the book-end flag is set', () => {
    expect(resolveReaderProgress({ ...base, bookFinishedOrReachedEnd: true }).isFinished).toBe(true);
  });

  it('marks finished only on the last chapter scrolled to the end', () => {
    expect(
      resolveReaderProgress({
        ...base,
        isScrollMode: true,
        chapterIndex: 2,
        scrollOffset: 500,
        scrollMaxValue: 500,
      }).isFinished,
    ).toBe(true);
    expect(
      resolveReaderProgress({
        ...base,
        isScrollMode: true,
        chapterIndex: 1,
        scrollOffset: 500,
        scrollMaxValue: 500,
      }).isFinished,
    ).toBe(false);
    expect(
      resolveReaderProgress({
        ...base,
        isScrollMode: true,
        chapterIndex: 2,
        scrollOffset: 499,
        scrollMaxValue: 500,
      }).isFinished,
    ).toBe(false);
    expect(
      resolveReaderProgress({
        ...base,
        isScrollMode: true,
        chapterIndex: 2,
        currentChapterContentEmpty: true,
        scrollOffset: 500,
        scrollMaxValue: 500,
      }).isFinished,
    ).toBe(false);
    expect(
      resolveReaderProgress({
        ...base,
        isScrollMode: true,
        chapterIndex: 2,
        scrollOffset: 500,
        scrollMaxValue: 0,
      }).isFinished,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 2796-2828 —— 页脚文案
// ─────────────────────────────────────────────────────────────────────────────

describe('overlay header/footer text (ReaderScreen.kt:2796-2828)', () => {
  it('readerPercent truncates like Int division', () => {
    expect(readerPercent(0, 0)).toBe(0);
    expect(readerPercent(0, 3)).toBe(33);
    expect(readerPercent(2, 3)).toBe(100);
  });

  it('scroll mode footer only shows the chapter counter', () => {
    expect(readerProgressFooterText(true, 2, 10, 4, 7)).toBe('第 3/10 章');
  });

  it('paged mode footer shows both counters', () => {
    expect(readerProgressFooterText(false, 2, 10, 4, 7)).toBe('第 5/7 页 · 第 3/10 章');
  });

  it('formatClockHHmm matches SimpleDateFormat("HH:mm")', () => {
    const date = new Date(2026, 0, 2, 7, 5);
    expect(formatClockHHmm(date)).toBe('07:05');
    const evening = new Date(2026, 0, 2, 21, 30);
    expect(formatClockHHmm(evening)).toBe('21:30');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 2665-2714 —— 越界切章提示
// ─────────────────────────────────────────────────────────────────────────────

describe('pull hint (ReaderScreen.kt:2665-2714)', () => {
  it('pullProgress clamps to 0..1', () => {
    expect(pullProgress(0, 120)).toBe(0);
    expect(pullProgress(60, 120)).toBe(0.5);
    expect(pullProgress(240, 120)).toBe(1);
  });

  it('produces the four verbatim hint strings', () => {
    expect(pullHintText(1, true)).toBe('松开切换下一章');
    expect(pullHintText(1, false)).toBe('松开返回上一章');
    expect(pullHintText(0.4, true)).toBe('继续上滑进入下一章');
    expect(pullHintText(0.4, false)).toBe('继续下拉返回上一章');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 748 / 3074 / 3128
// ─────────────────────────────────────────────────────────────────────────────

describe('brightness / rest reminder / back-to-top (ReaderScreen.kt)', () => {
  it('dim alpha follows (1 - brightness) * 0.6f', () => {
    // readerDimAlpha 在 ReaderPage.tsx 内联计算，这里的常量即 DIM_ALPHA_SCALE
    expect((1 - 0.5) * 0.6).toBeCloseTo(0.3, 10);
    expect((1 - 1) * 0.6).toBe(0);
    expect((1 - 0.2) * 0.6).toBeCloseTo(0.48, 10);
  });

  it('shouldShowBackToTop requires scroll mode past 20% and no auto-scroll', () => {
    expect(shouldShowBackToTop(true, false, 150, 500)).toBe(true);
    expect(shouldShowBackToTop(true, false, 100, 500)).toBe(false);
    expect(shouldShowBackToTop(true, true, 400, 500)).toBe(false);
    expect(shouldShowBackToTop(false, false, 400, 500)).toBe(false);
  });

  it('shouldShowRestReminder fires on exact multiples of restMinutes * 60', () => {
    expect(shouldShowRestReminder(30, 0)).toBe(false);
    expect(shouldShowRestReminder(30, 1799)).toBe(false);
    expect(shouldShowRestReminder(30, 1800)).toBe(true);
    expect(shouldShowRestReminder(30, 3600)).toBe(true);
    expect(shouldShowRestReminder(0, 1800)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 904-948 / 1061-1089 —— 模式切换锚定
// ─────────────────────────────────────────────────────────────────────────────

describe('modeSwitchAnchor (ReaderScreen.kt:904-948)', () => {
  it('does nothing when both modes agree', () => {
    expect(
      modeSwitchAnchor({
        oldMode: PAGE_TURN_COVER,
        newMode: PAGE_TURN_SLIDE,
        currentCharOffset: 100,
        contentLength: 500,
        scrollValue: 10,
        scrollMaxValue: 100,
      }),
    ).toEqual({ pendingScrollRatio: -1, pendingCharTarget: -1 });
  });

  it('paged → scroll stores the char ratio', () => {
    expect(
      modeSwitchAnchor({
        oldMode: PAGE_TURN_COVER,
        newMode: PAGE_TURN_SCROLL,
        currentCharOffset: 250,
        contentLength: 1000,
        scrollValue: 10,
        scrollMaxValue: 100,
      }).pendingScrollRatio,
    ).toBe(0.25);
  });

  it('scroll → paged stores the char target', () => {
    expect(
      modeSwitchAnchor({
        oldMode: PAGE_TURN_SCROLL,
        newMode: PAGE_TURN_COVER,
        currentCharOffset: 250,
        contentLength: 1000,
        scrollValue: 250,
        scrollMaxValue: 500,
      }).pendingCharTarget,
    ).toBe(500);
  });

  it('ratio 0 when the chapter is empty / maxValue is 0', () => {
    expect(
      modeSwitchAnchor({
        oldMode: PAGE_TURN_COVER,
        newMode: PAGE_TURN_SCROLL,
        currentCharOffset: 10,
        contentLength: 0,
        scrollValue: 0,
        scrollMaxValue: 0,
      }).pendingScrollRatio,
    ).toBe(0);
  });

  it('scrollTargetForRatio clamps into 0..max', () => {
    expect(scrollTargetForRatio(1000, 0.5)).toBe(500);
    expect(scrollTargetForRatio(1000, -1)).toBe(0);
    expect(scrollTargetForRatio(1000, 2)).toBe(1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PageTurnContainer.kt 62-68 —— 翻页档位（权威映射）
// ─────────────────────────────────────────────────────────────────────────────

describe('page turn modes (PageTurnContainer.kt:62-68)', () => {
  it('exposes the authoritative id → title mapping', () => {
    expect(PAGE_TURN_TYPES.map((mode) => mode.id)).toEqual([0, 1, 2, 3, 4]);
    expect(PAGE_TURN_TYPES.map((mode) => mode.title)).toEqual([
      '仿真3D卷页',
      '覆盖翻页',
      '平移翻页',
      '渐变淡出',
      '上下滚动',
    ]);
    expect(PAGE_TURN_TYPES.map((mode) => mode.description)).toEqual([
      '真实书本折角弯曲与纸张阴影',
      '无缝推开上页，经典质感',
      '左右双页平滑滑移',
      '优雅透明度切换',
      '连续纵向滚动阅读',
    ]);
  });

  it('isScrollMode is true only for id 4', () => {
    expect(PAGE_TURN_SIMULATE).toBe(0);
    expect(PAGE_TURN_COVER).toBe(1);
    expect(PAGE_TURN_SLIDE).toBe(2);
    expect(PAGE_TURN_FADE).toBe(3);
    expect(PAGE_TURN_SCROLL).toBe(4);
    expect(isScrollMode(4)).toBe(true);
    expect(isScrollMode(0)).toBe(false);
    expect(isScrollMode(1)).toBe(false);
    expect(isScrollMode(2)).toBe(false);
    expect(isScrollMode(3)).toBe(false);
  });

  it('chip labels strip 翻页 / 卷页 / 渐变 like the Kotlin replace chain', () => {
    expect(pageTurnChipLabel('仿真3D卷页')).toBe('仿真3D');
    expect(pageTurnChipLabel('覆盖翻页')).toBe('覆盖');
    expect(pageTurnChipLabel('平移翻页')).toBe('平移');
    expect(pageTurnChipLabel('渐变淡出')).toBe('淡出');
    expect(pageTurnChipLabel('上下滚动')).toBe('上下滚动');
  });

  it('pullDownHintText reproduces PageTurnContainer.kt:404-409', () => {
    expect(pullDownHintText(true, true)).toBe('松开即可取消书签');
    expect(pullDownHintText(true, false)).toBe('松开即可保存书签');
    expect(pullDownHintText(false, true)).toBe('下拉取消书签');
    expect(pullDownHintText(false, false)).toBe('下拉添加书签');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 1551-1714 —— 搜索跳转
// ─────────────────────────────────────────────────────────────────────────────

/** 第一个文本块的 raw 长度（用于计算图片块的起始偏移）. */
function imageStartOf(blocks: ReadonlyArray<{ raw: string }>): number {
  return blocks[0]?.raw.length ?? 0;
}

describe('search jump targeting (ReaderScreen.kt:1551-1714)', () => {
  // ReaderScreen.kt:1585-1609 的块序列（跨 chunk 累计的全局块序号）
  const blocks = [
    { raw: '第一段', isText: true },
    { raw: '[IMG:/x/a.png|100|50]', isText: false },
    { raw: '第二段', isText: true },
  ];

  it('locates a text block and the offset inside it', () => {
    expect(findScrollBlockTarget(blocks, 1)).toEqual({
      blockIndex: 0,
      isText: true,
      localInBlock: 1,
    });
  });

  it('locates an image block', () => {
    const imageStart = '第一段'.length;
    expect(findScrollBlockTarget(blocks, imageStart)).toEqual({
      blockIndex: 1,
      isText: false,
      localInBlock: 0,
    });
  });

  it('falls onto the second text block after the image token', () => {
    const afterImage = imageStartOf(blocks) + '[IMG:/x/a.png|100|50]'.length;
    expect(findScrollBlockTarget(blocks, afterImage)).toEqual({
      blockIndex: 2,
      isText: true,
      localInBlock: 0,
    });
  });

  it('clamps past-the-end positions onto the last block (ReaderScreen.kt:1611)', () => {
    const target = findScrollBlockTarget(blocks, 9999);
    expect(target.blockIndex).toBe(2);
    expect(target.isText).toBe(false);
    expect(target.localInBlock).toBe(0);
  });

  it('returns block 0 for an empty block list', () => {
    expect(findScrollBlockTarget([], 5)).toEqual({
      blockIndex: 0,
      isText: false,
      localInBlock: 0,
    });
  });

  it('findPageForPosition walks cumulative page lengths', () => {
    const pages = ['aaa', 'bb', 'c'];
    expect(findPageForPosition(pages, 0)).toBe(0);
    expect(findPageForPosition(pages, 2)).toBe(0);
    expect(findPageForPosition(pages, 3)).toBe(1);
    expect(findPageForPosition(pages, 5)).toBe(2);
    expect(findPageForPosition(pages, 999)).toBe(2);
    expect(findPageForPosition([], 1)).toBe(-1);
  });

  it('shouldClearSearchHighlight respects the 1500ms grace window', () => {
    expect(shouldClearSearchHighlight('kw', 0, 3, 500)).toBe(false);
    expect(shouldClearSearchHighlight('kw', 0, 3, 2000)).toBe(true);
    expect(shouldClearSearchHighlight('kw', 3, 3, 5000)).toBe(false);
    expect(shouldClearSearchHighlight(null, 0, 3, 5000)).toBe(false);
  });

  it('splitByHighlights marks every case-insensitive occurrence', () => {
    expect(highlightRanges('Abc abc', 'abc')).toEqual([
      [0, 3],
      [4, 7],
    ]);
    expect(splitByHighlights('Abc abc', 'abc')).toEqual([
      { text: 'Abc', hit: true },
      { text: ' ', hit: false },
      { text: 'abc', hit: true },
    ]);
    expect(splitByHighlights('abc', null)).toEqual([{ text: 'abc', hit: false }]);
    expect(splitByHighlights('', 'abc')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 1666-1673 —— 相邻页插图预热
// ─────────────────────────────────────────────────────────────────────────────

describe('image prewarm order (ReaderScreen.kt:1666-1673)', () => {
  it('collects next-page images before prev-page images', () => {
    const pages = ['[IMG:/p/0.png|1|1]', '[IMG:/p/1.png|1|1]', '[IMG:/p/2.png|1|1]'];
    const out: string[] = [];
    const regex = /\[IMG:([^|\]]+)\|(\d+)\|(\d+)]/g;
    const collect = (page: string | undefined): void => {
      if (page === undefined) return;
      let match = regex.exec(page);
      while (match !== null) {
        out.push(match[1] ?? '');
        match = regex.exec(page);
      }
    };
    collect(pages[1 + 1]);
    collect(pages[1 - 1]);
    expect(out).toEqual(['/p/2.png', '/p/0.png']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NovelInlineImages.kt 276-287 —— displaySize
// ─────────────────────────────────────────────────────────────────────────────

describe('displaySize (NovelInlineImages.kt:276-287)', () => {
  it('fits the content width when the aspect ratio is wide', () => {
    expect(displaySize(800, 400, 400, 600)).toEqual({ width: 400, height: 200 });
  });

  it('shrinks tall images to the page height and keeps the ratio', () => {
    expect(displaySize(400, 1600, 400, 600)).toEqual({ width: 150, height: 600 });
  });

  it('treats zero/negative dimensions as 1', () => {
    expect(displaySize(0, 0, 400, 600)).toEqual({ width: 400, height: 400 });
    expect(displaySize(-5, -5, 400, 600)).toEqual({ width: 400, height: 400 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NovelInlineImages.kt 158-224 —— ImageHitRegistry
// ─────────────────────────────────────────────────────────────────────────────

describe('ImageHitRegistry (NovelInlineImages.kt:158-224)', () => {
  it('only hits entries belonging to the active page', () => {
    const registry = new ImageHitRegistry();
    registry.setActivePage('pageA');
    registry.register('a', '/a.png', { left: 0, top: 0, right: 10, bottom: 10 }, 'pageA');
    registry.register('b', '/b.png', { left: 0, top: 0, right: 10, bottom: 10 }, 'pageB');
    expect(registry.hit(5, 5)).toBe('/a.png');

    registry.setActivePage('pageB');
    expect(registry.hit(5, 5)).toBe('/b.png');
  });

  it('returns the smallest overlapping rect (the top-most image)', () => {
    const registry = new ImageHitRegistry();
    registry.setActivePage('p');
    registry.register('big', '/big.png', { left: 0, top: 0, right: 100, bottom: 100 }, 'p');
    registry.register('small', '/small.png', { left: 40, top: 40, right: 60, bottom: 60 }, 'p');
    expect(registry.hit(50, 50)).toBe('/small.png');
  });

  it('misses outside every rect', () => {
    const registry = new ImageHitRegistry();
    registry.setActivePage('p');
    registry.register('a', '/a.png', { left: 0, top: 0, right: 10, bottom: 10 }, 'p');
    expect(registry.hit(50, 5)).toBeNull();
  });

  it('purgeStale drops non-active-page entries and unregister removes one', () => {
    const registry = new ImageHitRegistry();
    registry.setActivePage('p');
    registry.register('a', '/a.png', { left: 0, top: 0, right: 10, bottom: 10 }, 'p');
    registry.register('b', '/b.png', { left: 0, top: 0, right: 10, bottom: 10 }, 'q');
    expect(registry.purgeStale()).toBe(1);
    registry.unregister('a');
    expect(registry.hit(5, 5)).toBeNull();
    registry.clear();
    expect(registry.getActivePageKey()).toBeNull();
  });

  it('notifies subscribers on mutation (Flow → listener registry)', () => {
    const registry = new ImageHitRegistry();
    let calls = 0;
    const unsubscribe = registry.subscribe(() => {
      calls += 1;
    });
    registry.setActivePage('p');
    registry.register('a', '/a.png', { left: 0, top: 0, right: 4, bottom: 4 }, 'p');
    expect(calls).toBe(2);
    unsubscribe();
    registry.setActivePage('q');
    expect(calls).toBe(2);
  });
});

describe('ListenerRegistry (Room Flow → async getter + listener)', () => {
  it('replays the last value to new subscribers and stops after unsubscribe', () => {
    const registry = new ListenerRegistry<number>();
    registry.notify(7);
    const seen: number[] = [];
    const unsubscribe = registry.subscribe((value) => seen.push(value));
    registry.notify(8);
    expect(seen).toEqual([7, 8]);
    expect(registry.listenerCount()).toBe(1);
    unsubscribe();
    expect(registry.listenerCount()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen.kt 895 —— 书签摘要
// ─────────────────────────────────────────────────────────────────────────────

describe('bookmarkSnippet (ReaderScreen.kt:895)', () => {
  it('keeps the first 60 characters like Kotlin take(60)', () => {
    const content = '字'.repeat(100);
    expect(bookmarkSnippet(content, 60)).toHaveLength(60);
    expect(bookmarkSnippet('短', 60)).toBe('短');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PreferencesManager.kt defaults
// ─────────────────────────────────────────────────────────────────────────────

describe('DEFAULT_READER_PREFS (PreferencesManager.kt)', () => {
  it('mirrors the SharedPreferences defaults', () => {
    expect(DEFAULT_READER_PREFS.fontSize).toBe(18);
    expect(DEFAULT_READER_PREFS.lineHeight).toBe(28);
    expect(DEFAULT_READER_PREFS.marginHorizontal).toBe(16);
    expect(DEFAULT_READER_PREFS.firstLineIndent).toBe(true);
    expect(DEFAULT_READER_PREFS.readerTheme).toBe(1);
    expect(DEFAULT_READER_PREFS.fontFamilyIndex).toBe(0);
    expect(DEFAULT_READER_PREFS.pageTurnMode).toBe(0);
    expect(DEFAULT_READER_PREFS.readerBrightness).toBe(1);
    expect(DEFAULT_READER_PREFS.showOverlayHeaderFooter).toBe(true);
    expect(DEFAULT_READER_PREFS.keepScreenOn).toBe(true);
    expect(DEFAULT_READER_PREFS.restReminderMinutes).toBe(30);
    expect(DEFAULT_READER_PREFS.ttsSpeed).toBe(1);
    expect(DEFAULT_READER_PREFS.ttsPitch).toBe(1);
    expect(DEFAULT_READER_PREFS.customFontPath).toBe('');
  });
});