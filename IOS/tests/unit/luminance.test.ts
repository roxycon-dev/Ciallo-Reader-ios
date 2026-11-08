import { describe, expect, it } from 'vitest';
import {
  COLORS,
  glassTitleColor,
  luminance,
  onColor,
  readerTheme,
} from '../../src/ui/theme/tokens';

describe('luminance', () => {
  it('is ≈1 for white', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('is ≈0 for black', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5);
  });

  it('is ≈0.5-ish for mid gray under WCAG curve', () => {
    const mid = luminance('#808080');
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.5);
  });
});

describe('onColor', () => {
  it('white → dark ink', () => {
    expect(onColor('#FFFFFF')).toBe('#1A1A1E');
  });

  it('black → white ink', () => {
    expect(onColor('#000000')).toBe('#FFFFFF');
  });

  it('keeps mintGold on light surfaces legible (dark ink)', () => {
    expect(onColor(COLORS.mintGold)).toBe('#1A1A1E');
  });
});

describe('readerTheme', () => {
  it('index 2 is sepia (羊皮纸)', () => {
    const t = readerTheme(2);
    expect(t.bg).toBe('#FBF0D9');
    expect(t.text).toBe('#5F4B32');
    expect(t.label).toBe('羊皮纸');
  });

  it('index 3 is night', () => {
    const t = readerTheme(3);
    expect(t.bg).toBe('#18191C');
    expect(t.text).toBe('#D4D4D4');
  });

  it('falls back to default white on invalid index', () => {
    const t = readerTheme(99);
    expect(t.bg).toBe('#FFFFFF');
    expect(t.text).toBe('#18191C');
  });
});

describe('glassTitleColor', () => {
  it('picks dark ink for white surface over dark bg', () => {
    expect(glassTitleColor(COLORS.darkCharcoal, COLORS.pureWhite)).toBe(
      '#1A1A1E',
    );
  });

  it('picks white ink for black surface over light bg', () => {
    expect(glassTitleColor(COLORS.pureWhite, COLORS.darkCharcoal)).toBe(
      '#FFFFFF',
    );
  });
});
