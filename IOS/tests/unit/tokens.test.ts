import { describe, expect, it } from 'vitest';
import { DESIGN_TOKENS } from '../../src/ui/tokens';

describe('design tokens (Phase-0 extraction)', () => {
  it('keeps MintGold and DarkCharcoal', () => {
    expect(DESIGN_TOKENS.color.mintGold).toBe('#E8C97A');
    expect(DESIGN_TOKENS.color.darkCharcoal).toBe('#18191C');
  });

  it('keeps reader themes', () => {
    expect(DESIGN_TOKENS.color.reader.sepia.background).toBe('#FBF0D9');
    expect(DESIGN_TOKENS.color.reader.oled.background).toBe('#000000');
  });

  it('keeps glass blur/alpha parameters', () => {
    expect(DESIGN_TOKENS.glass.tabBlur).toBe(8);
    expect(DESIGN_TOKENS.glass.cardBlur).toBe(24);
    expect(DESIGN_TOKENS.glass.cardSurfaceAlpha).toBe(0.78);
  });

  it('keeps radius/spacing/elevation scale', () => {
    // Android `ui/design/DesignTokens.kt` L40-44:
    //   RadiusXs 8 / RadiusSm 12 / RadiusMd 16 / RadiusLg 20 / RadiusXl 24
    // （2026-10-06 修正：原断言 `radius.sm === 8` / `radius.xxl === 24` 把键名整体
    //   错位了一档 —— Kotlin 没有 RadiusXxl，24 就是 RadiusXl。）
    expect(DESIGN_TOKENS.radius.xs).toBe(8);
    expect(DESIGN_TOKENS.radius.sm).toBe(12);
    expect(DESIGN_TOKENS.radius.md).toBe(16);
    expect(DESIGN_TOKENS.radius.lg).toBe(20);
    expect(DESIGN_TOKENS.radius.xl).toBe(24);
    expect(Object.keys(DESIGN_TOKENS.radius)).toHaveLength(5);
    // 与 `src/styles/theme.css` L40-45 的 --radius-* 一致
    expect(DESIGN_TOKENS.radius).toEqual({
      xs: 8,
      sm: 12,
      md: 16,
      lg: 20,
      xl: 24,
    });
    expect(DESIGN_TOKENS.spacing['1']).toBe(4);
    expect(DESIGN_TOKENS.spacing['6']).toBe(24);
    expect(DESIGN_TOKENS.elevation.card).toBe(2);
    expect(DESIGN_TOKENS.elevation.floating).toBe(8);
  });

  it('radius scale matches core/glass DESIGN_SPEC (same Kotlin source)', async () => {
    const { DESIGN_SPEC } = await import('../../src/core/glass/adaptiveSpec');
    expect(DESIGN_TOKENS.radius).toEqual(DESIGN_SPEC.radius);
  });
});
