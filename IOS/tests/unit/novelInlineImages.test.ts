/**
 * `novelInlineImages.ts` ↔ Android `ui/reader/NovelInlineImages.kt` (41-288)
 *
 * REVIEW-2026-10-06：本文件原先断言的是一个 Kotlin 里**根本不存在**的函数
 * `imageHeightPx(pageHeightPx) = pageHeightPx * 0.6`，而 `splitIntoBlocks`
 * 又没有 Kotlin `InlineBlock.Image` 的 `path` / `widthPx` / `heightPx`。
 * 现已按 Kotlin 原文 `displaySize` 断言（下面每一行都对着 NovelInlineImages.kt:276-287）。
 */
import { describe, expect, it } from 'vitest';
import {
  TOKEN_REGEX,
  displaySize,
  hasImages,
  normalizeTokenBreaks,
  splitIntoBlocks,
  stripTokens,
} from '../../src/core/reader/novelInlineImages';

describe('TOKEN_REGEX (NovelInlineImages.kt:43)', () => {
  it('is exactly the Kotlin regex — one path group plus two digit groups', () => {
    expect(TOKEN_REGEX.source).toBe('\\[IMG:([^|\\]]+)\\|(\\d+)\\|(\\d+)]');
    const m = new RegExp(TOKEN_REGEX.source).exec('[IMG:epzip:/a/b.epub!OEBPS/x.png|800|1600]');
    expect(m?.[1]).toBe('epzip:/a/b.epub!OEBPS/x.png');
    expect(m?.[2]).toBe('800');
    expect(m?.[3]).toBe('1600');
  });

  it('rejects a path containing a pipe, matching Kotlin [^|\\]]+', () => {
    expect(new RegExp(TOKEN_REGEX.source).test('[IMG:a|b|1|2]')).toBe(false);
  });
});

describe('displaySize (NovelInlineImages.kt:276-287)', () => {
  it('fills the content width and keeps the aspect ratio', () => {
    // dw = contentWidthPx; dh = dw * ih / iw
    expect(displaySize(800, 400, 400, 600)).toEqual({ width: 400, height: 200 });
  });

  it('shrinks a tall illustration proportionally so it fits one page', () => {
    // dh(1600) > maxHeight(600) → dh = 600; dw = 600 * 400 / 1600
    expect(displaySize(400, 1600, 400, 600)).toEqual({ width: 150, height: 600 });
  });

  it('coerces both dimensions with coerceAtLeast(1)', () => {
    expect(displaySize(0, 0, 400, 600)).toEqual({ width: 400, height: 400 });
    expect(displaySize(-5, -5, 400, 600)).toEqual({ width: 400, height: 400 });
  });

  it('scroll mode passes Float.MAX_VALUE, so the ratio is never clamped', () => {
    expect(displaySize(800, 1600, 400, Number.MAX_VALUE)).toEqual({
      width: 400,
      height: 800,
    });
  });
});

describe('splitIntoBlocks (NovelInlineImages.kt:254-274)', () => {
  it('returns a single text block when there are no tokens', () => {
    expect(splitIntoBlocks('纯文本内容', 400, 600)).toEqual([
      { kind: 'text', text: '纯文本内容' },
    ]);
  });

  it('returns an empty list for empty input', () => {
    // Kotlin returns listOf(InlineBlock.Text("")); the web measurement port must
    // measure an empty paragraph as 0px, so the empty block is dropped here.
    expect(splitIntoBlocks('', 400, 600)).toEqual([]);
  });

  it('splits text around an image token and carries path / display size', () => {
    const chunk = '前文\n[IMG:/a/pic.png|800|400]\n后文';
    const blocks = splitIntoBlocks(chunk, 400, 600);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ kind: 'text', text: '前文\n' });
    expect(blocks[1]).toEqual({
      kind: 'image',
      path: '/a/pic.png',
      raw: '[IMG:/a/pic.png|800|400]',
      widthPx: 400,
      heightPx: 200,
    });
    expect(blocks[2]).toEqual({ kind: 'text', text: '\n后文' });
  });

  it('concatenating raw block text reproduces the input', () => {
    const chunk = '开头[IMG:/x/1.png|100|100]中段[IMG:/y/2.png|200|200]结尾';
    const blocks = splitIntoBlocks(chunk, 400, 600);
    const rebuilt = blocks
      .map((b) => (b.kind === 'text' ? b.text : b.raw))
      .join('');
    expect(rebuilt).toBe(chunk);
  });

  it('handles adjacent image tokens as separate blocks', () => {
    const chunk = '[IMG:/a/1.png|800|1600][IMG:/a/2.png|800|1600]';
    const blocks = splitIntoBlocks(chunk, 1000, 2000);
    expect(blocks.filter((b) => b.kind === 'image')).toHaveLength(2);
    const rebuilt = blocks.map((b) => (b.kind === 'text' ? b.text : b.raw)).join('');
    expect(rebuilt).toBe(chunk);
  });

  it('scales a tall token down to the page height instead of a flat 60% rule', () => {
    // 800x1600 into a 1000x2000 page: dh = 1000 * 1600 / 800 = 2000, which is
    // exactly maxHeightPx → `dh > maxHeightPx` is false, so no shrink happens.
    const exact = splitIntoBlocks('[IMG:/a.png|800|1600]', 1000, 2000);
    expect(exact[0]).toMatchObject({ kind: 'image', widthPx: 1000, heightPx: 2000 });

    // One pixel less of page height and the token shrinks proportionally.
    const clipped = splitIntoBlocks('[IMG:/a.png|800|1600]', 1000, 1999);
    expect(clipped[0]).toMatchObject({ kind: 'image', widthPx: 999.5, heightPx: 1999 });
  });

  it('falls back to 1x1 when the token dimensions are not parseable', () => {
    // Kotlin: `m.groupValues[2].toIntOrNull()?.coerceAtLeast(1) ?: 1` — the regex
    // only ever captures digits, so this path is unreachable via splitIntoBlocks;
    // assert the ratio maths for the degenerate 1x1 token instead.
    expect(displaySize(1, 1, 400, 600)).toEqual({ width: 400, height: 400 });
  });
});

describe('helpers (NovelInlineImages.kt:45 / 53-57)', () => {
  it('hasImages / stripTokens / normalizeTokenBreaks', () => {
    const chunk = 'a[IMG:/p.png|1|1]b';
    expect(hasImages(chunk)).toBe(true);
    expect(hasImages('plain')).toBe(false);
    expect(stripTokens(chunk)).toBe('ab');
    expect(normalizeTokenBreaks('x][IMG:/p.png|1|1]y')).toBe('x]\n[IMG:/p.png|1|1]y');
    expect(normalizeTokenBreaks('plain')).toBe('plain');
  });

  it('stripTokens is repeatable (no lastIndex state leaks across calls)', () => {
    const chunk = 'a[IMG:/p.png|1|1]b[IMG:/q.png|2|2]c';
    expect(stripTokens(chunk)).toBe('abc');
    expect(stripTokens(chunk)).toBe('abc');
  });
});