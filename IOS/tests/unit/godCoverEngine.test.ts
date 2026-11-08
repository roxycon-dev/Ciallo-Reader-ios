import { describe, expect, it } from 'vitest';
import {
  coverLayerRect,
  coverSourceToTag,
  normalizeCropParams,
  resolveCoverSource,
} from '@core/god/godCoverEngine';
import { DEFAULT_CROP_PARAMS } from '@core/god/godTypes';

describe('resolveCoverSource / coverSourceToTag', () => {
  it('round-trips comic page, album, and novel excerpt tags', () => {
    expect(
      coverSourceToTag({ kind: 'comicPage', pageIndex: 3, pageId: 'abc' }),
    ).toBe('page|3|abc');
    expect(coverSourceToTag({ kind: 'album', uri: 'content://x' })).toBe('album|content://x');
    expect(
      coverSourceToTag({ kind: 'novelExcerpt', chapterId: 'ch', start: 1, end: 5 }),
    ).toBe('novel|ch|1|5');

    expect(resolveCoverSource('page|3|abc')).toEqual({
      kind: 'comicPage',
      pageIndex: 3,
      pageId: 'abc',
    });
    expect(resolveCoverSource('album|content://x')).toEqual({
      kind: 'album',
      uri: 'content://x',
    });
    expect(resolveCoverSource('novel|ch|1|5')).toEqual({
      kind: 'novelExcerpt',
      chapterId: 'ch',
      start: 1,
      end: 5,
    });
  });

  it('defaults blank or garbage tags to comic page 0', () => {
    expect(resolveCoverSource('')).toEqual({ kind: 'comicPage', pageIndex: 0, pageId: '' });
    expect(resolveCoverSource(null)).toEqual({ kind: 'comicPage', pageIndex: 0, pageId: '' });
    expect(resolveCoverSource(undefined)).toEqual({ kind: 'comicPage', pageIndex: 0, pageId: '' });
    expect(resolveCoverSource('zzz')).toEqual({ kind: 'comicPage', pageIndex: 0, pageId: '' });
    expect(resolveCoverSource('page|notanumber|')).toEqual({
      kind: 'comicPage',
      pageIndex: 0,
      pageId: '',
    });
  });
});

describe('normalizeCropParams', () => {
  it('keeps valid rectangles unchanged', () => {
    const params = { ...DEFAULT_CROP_PARAMS, cropL: 0.1, cropT: 0.2, cropR: 0.9, cropB: 0.8 };
    expect(normalizeCropParams(params)).toEqual(params);
  });

  it('swaps inverted edges and enforces min span 0.02', () => {
    const inverted = normalizeCropParams({
      ...DEFAULT_CROP_PARAMS,
      cropL: 0.8,
      cropT: 0.7,
      cropR: 0.2,
      cropB: 0.1,
    });
    expect(inverted.cropL).toBeCloseTo(0.2);
    expect(inverted.cropR).toBeCloseTo(0.8);
    expect(inverted.cropT).toBeCloseTo(0.1);
    expect(inverted.cropB).toBeCloseTo(0.7);

    const degenerate = normalizeCropParams({
      ...DEFAULT_CROP_PARAMS,
      cropL: 0.5,
      cropT: 0.5,
      cropR: 0.5,
      cropB: 0.5,
    });
    expect(degenerate.cropR - degenerate.cropL).toBeGreaterThanOrEqual(0.02 - 1e-9);
    expect(degenerate.cropB - degenerate.cropT).toBeGreaterThanOrEqual(0.02 - 1e-9);
  });

  it('clamps out-of-range edges into 0..1', () => {
    const clamped = normalizeCropParams({
      ...DEFAULT_CROP_PARAMS,
      cropL: -0.4,
      cropT: 1.4,
      cropR: 2,
      cropB: -1,
    });
    expect(clamped.cropL).toBeGreaterThanOrEqual(0);
    expect(clamped.cropR).toBeLessThanOrEqual(1);
    expect(clamped.cropT).toBeGreaterThanOrEqual(0);
    expect(clamped.cropB).toBeLessThanOrEqual(1);
  });
});

describe('coverLayerRect (GodCoverEngine.kt L347-359 centerCrop)', () => {
  it('crops horizontally when the source is wider than the target ratio', () => {
    // 1600×900（16:9）→ 900×1200（3:4）：srcRatio(1.777) > dstRatio(0.75) ⇒ 横向裁
    // nw = round(900 × 0.75) = 675，x = round((1600-675)/2) = round(462.5) = 463
    expect(coverLayerRect(1600, 900, 900, 1200)).toEqual({
      x: 463,
      y: 0,
      width: 675,
      height: 900,
    });
  });

  it('crops vertically when the source is taller than the target ratio', () => {
    // 900×1600 → 900×1200：srcRatio < dstRatio ⇒ 纵向裁
    // nh = round(900 / 0.75) = 1200，y = round((1600-1200)/2) = 200
    expect(coverLayerRect(900, 1600, 900, 1200)).toEqual({
      x: 0,
      y: 200,
      width: 900,
      height: 1200,
    });
  });

  it('is a no-op when the ratios already match', () => {
    expect(coverLayerRect(900, 1200, 450, 600)).toEqual({
      x: 0,
      y: 0,
      width: 900,
      height: 1200,
    });
  });

  it('never exceeds the source bounds', () => {
    for (const [w, h] of [
      [1600, 900],
      [900, 1600],
      [1000, 999],
      [999, 1000],
    ] as Array<[number, number]>) {
      const rect = coverLayerRect(w, h, 900, 1200);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(w);
      expect(rect.y + rect.height).toBeLessThanOrEqual(h);
    }
  });
});
