/**
 * Unit tests for `@core/god/godChapterCard` — 神回态章节卡片的展示规格。
 *
 * Kotlin 行号映射（novel-reader/app/src/main/java/com/example/god/GodChapterCard.kt，
 * 257 行 / 248 非空）：
 *   - 51/76   高度 96dp / 圆角 CARD_CORNER = 18
 *   - 79-90   高亮脉冲（`delay(900)` + `tween(240 / 520)`，峰值 0.42）
 *   - 93-103  流光描边角（0 → 360，BORDER_SWEEP_MS = 4200，Linear，Restart）
 *   - 160-187 描边渐变几何（`r = maxOf(w, h)`，start/end 沿 (cos a, sin a)）
 *   - 172-178 5 停靠点描边配色
 *   - 119-132 封面底图（有 coverPath → 图；无 → gold 横向渐变）
 *   - 139-143 可读性渐变三档
 *   - 197     `moment.effectiveTitle()`
 *   - 206     `chapterTitle.ifBlank { "第N话" }`
 *   - 214-217 星级 13dp + `String.format("%.1f")`
 *   - 222     `if (!subtitle.isNullOrBlank())`
 *   - 113-114 onClickLabel = "阅读" / onLongClickLabel = "编辑神回"
 *   - 260-261 徽章文案「神回 ✦」+ 色 #3B2A08
 */
import { describe, expect, it } from 'vitest';
import {
  GOD_BORDER_SWEEP_MS,
  GOD_CHAPTER_BADGE_GLYPH,
  GOD_CHAPTER_BADGE_INK,
  GOD_CHAPTER_BADGE_TEXT,
  GOD_CHAPTER_CARD_CORNER,
  GOD_CHAPTER_CARD_HEIGHT_PX,
  GOD_CHAPTER_LONG_PRESS_MS,
  GOD_CHAPTER_PULSE_IN_MS,
  GOD_CHAPTER_PULSE_MS,
  GOD_CHAPTER_PULSE_OUT_MS,
  GOD_CHAPTER_PULSE_PEAK,
  GOD_CHAPTER_STAR_SIZE,
  GOD_CHAPTER_STROKE_PX,
  GOD_CHAPTER_SWEEP_STOPS,
  GOD_CHAPTER_TEXT_PAD_LEFT,
  GOD_CHAPTER_TEXT_PAD_RIGHT,
  godChapterBackdrop,
  godChapterCardSpec,
  godChapterHasSubtitle,
  godChapterPulseSpec,
  godChapterSubtitle,
  godChapterSweepAngle,
  godChapterSweepGradient,
} from '@core/god/godChapterCard';
import type { GodMoment } from '@core/god/godTypes';

const GOLD: [string, string, string] = ['#FFE29A', '#F5B942', '#D98E1F'];

function moment(overrides: Partial<GodMoment> = {}): GodMoment {
  return {
    id: 1,
    contentType: 'comic',
    bookId: 'local_1',
    chapterId: 'c120',
    bookTitle: '诡秘之主',
    chapterTitle: '第一百二十章 夜色下的祷告',
    chapterNumber: 120,
    title: '克莱恩成神之夜',
    titleIsCustom: true,
    rating: 4.5,
    note: '',
    coverPath: null,
    coverSource: 'page|0|',
    cropParams: '1,0,0,0,0,0,1,1',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('layout constants (GodChapterCard.kt L51 / L76 / L194 / L214 / L185)', () => {
  it('keeps the Android values', () => {
    expect(GOD_CHAPTER_CARD_HEIGHT_PX).toBe(96);
    expect(GOD_CHAPTER_CARD_CORNER).toBe(18);
    expect(GOD_CHAPTER_TEXT_PAD_LEFT).toBe(16);
    expect(GOD_CHAPTER_TEXT_PAD_RIGHT).toBe(92);
    expect(GOD_CHAPTER_STAR_SIZE).toBe(13);
    expect(GOD_CHAPTER_STROKE_PX).toBe(2);
    expect(GOD_CHAPTER_LONG_PRESS_MS).toBe(500);
  });
});

describe('godChapterPulseSpec (GodChapterCard.kt L80-90)', () => {
  it('peaks at 0.42 inside the 900ms window and fades after it', () => {
    const inside = godChapterPulseSpec(0);
    expect(inside.pulse).toBe(true);
    expect(inside.alpha).toBe(GOD_CHAPTER_PULSE_PEAK);
    expect(inside.durationMs).toBe(GOD_CHAPTER_PULSE_IN_MS);

    const after = godChapterPulseSpec(GOD_CHAPTER_PULSE_MS);
    expect(after.pulse).toBe(false);
    expect(after.alpha).toBe(0);
    expect(after.durationMs).toBe(GOD_CHAPTER_PULSE_OUT_MS);
  });

  it('treats a negative elapsed time as not pulsing', () => {
    expect(godChapterPulseSpec(-1).pulse).toBe(false);
  });

  it('uses the documented 240/520/900 timings', () => {
    expect(GOD_CHAPTER_PULSE_IN_MS).toBe(240);
    expect(GOD_CHAPTER_PULSE_OUT_MS).toBe(520);
    expect(GOD_CHAPTER_PULSE_MS).toBe(900);
  });
});

describe('godChapterSweepAngle (GodChapterCard.kt L96-103)', () => {
  it('wraps 0 → 360 over BORDER_SWEEP_MS', () => {
    expect(GOD_BORDER_SWEEP_MS).toBe(4200);
    expect(godChapterSweepAngle(0, false)).toBe(0);
    expect(godChapterSweepAngle(1050, false)).toBe(90);
    expect(godChapterSweepAngle(2100, false)).toBe(180);
    expect(godChapterSweepAngle(3150, false)).toBe(270);
    expect(godChapterSweepAngle(4200, false)).toBe(0);
    expect(godChapterSweepAngle(5250, false)).toBe(90);
  });

  it('is pinned to 0 when reduceMotion is on (L103)', () => {
    expect(godChapterSweepAngle(2000, true)).toBe(0);
  });

  it('is 0 for invalid input', () => {
    expect(godChapterSweepAngle(-5, false)).toBe(0);
    expect(godChapterSweepAngle(Number.NaN, false)).toBe(0);
  });
});

describe('godChapterSweepGradient (GodChapterCard.kt L160-187)', () => {
  it('offsets the angle by 90° (CSS 0deg points up, Kotlin starts at +x)', () => {
    expect(godChapterSweepGradient(0, 300, 96).angleDeg).toBe(90);
    expect(godChapterSweepGradient(90, 300, 96).angleDeg).toBe(180);
  });

  it('uses max(width, height) as the gradient radius (L165)', () => {
    expect(godChapterSweepGradient(0, 300, 96).radiusPx).toBe(300);
    expect(godChapterSweepGradient(0, 96, 400).radiusPx).toBe(400);
  });

  it('declares the 5-stop sweep gradient with the gold tints (L172-178)', () => {
    expect(GOD_CHAPTER_SWEEP_STOPS).toBe(
      'rgba(255, 226, 154, 0) 0%, rgba(255, 226, 154, 0.9) 25%, rgba(245, 185, 66, 1) 50%, rgba(255, 226, 154, 0.9) 75%, rgba(255, 226, 154, 0) 100%',
    );
  });
});

describe('godChapterBackdrop (GodChapterCard.kt L119-132)', () => {
  it('uses the composited cover image when present', () => {
    const result = godChapterBackdrop(moment({ coverPath: '/covers/a.jpg' }), GOLD);
    expect(result.kind).toBe('image');
    expect(result.src).toBe('/covers/a.jpg');
    expect(result.css).toBe('');
  });

  it('falls back to the gold gradient for a null / blank path', () => {
    for (const coverPath of [null, '', '   ']) {
      const result = godChapterBackdrop(moment({ coverPath }), GOLD);
      expect(result.kind).toBe('gradient');
      expect(result.src).toBeNull();
      expect(result.css).toBe(
        'linear-gradient(90deg, #FFE29A, #F5B942, #D98E1F)',
      );
    }
  });
});

describe('godChapterSubtitle (GodChapterCard.kt L206)', () => {
  it('uses the chapter title when non-blank', () => {
    expect(godChapterSubtitle('夜色下的祷告', 120)).toBe('夜色下的祷告');
  });

  it('falls back to 第N话 (ifBlank)', () => {
    expect(godChapterSubtitle('', 120)).toBe('第120话');
    expect(godChapterSubtitle('   ', 7)).toBe('第7话');
  });
});

describe('godChapterHasSubtitle (GodChapterCard.kt L222)', () => {
  it('rejects null, undefined and blank', () => {
    expect(godChapterHasSubtitle(null)).toBe(false);
    expect(godChapterHasSubtitle(undefined)).toBe(false);
    expect(godChapterHasSubtitle('')).toBe(false);
    expect(godChapterHasSubtitle('  ')).toBe(false);
    expect(godChapterHasSubtitle('好看')).toBe(true);
  });
});

describe('godChapterCardSpec (GodChapterCard.kt L197-231)', () => {
  it('assembles the whole card copy', () => {
    const spec = godChapterCardSpec({
      moment: moment(),
      chapterTitle: '夜色下的祷告',
      subtitle: '120话 · 完',
    });
    expect(spec.title).toBe('克莱恩成神之夜');
    expect(spec.subtitle).toBe('夜色下的祷告');
    // String.format(Locale.ROOT, "%.1f", 4.5) → "4.5"
    expect(spec.ratingText).toBe('4.5');
    expect(spec.hasSubtitle).toBe(true);
    expect(spec.clickLabel).toBe('阅读');
    expect(spec.longClickLabel).toBe('编辑神回');
  });

  it('uses effectiveTitle() when the title is not custom (L197)', () => {
    const spec = godChapterCardSpec({
      moment: moment({ titleIsCustom: false, title: '' }),
      chapterTitle: '',
      subtitle: null,
    });
    expect(spec.title).toBe('诡秘之主 第120话');
    expect(spec.subtitle).toBe('第120话');
    expect(spec.hasSubtitle).toBe(false);
  });

  it('always prints exactly one decimal', () => {
    expect(
      godChapterCardSpec({ moment: moment({ rating: 5 }), chapterTitle: 'x', subtitle: null })
        .ratingText,
    ).toBe('5.0');
    expect(
      godChapterCardSpec({ moment: moment({ rating: 3 }), chapterTitle: 'x', subtitle: null })
        .ratingText,
    ).toBe('3.0');
  });
});

describe('badge copy (GodChapterCard.kt L260-261)', () => {
  it('keeps 「神回 ✦」on the dark gold ink', () => {
    expect(GOD_CHAPTER_BADGE_TEXT).toBe('神回');
    expect(GOD_CHAPTER_BADGE_GLYPH).toBe('✦');
    expect(GOD_CHAPTER_BADGE_INK).toBe('#3B2A08');
  });
});
