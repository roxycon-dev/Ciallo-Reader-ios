/**
 * `ui/theme/Color.kt` (62 lines, 49 non-blank) → `src/core/ui-theme/color.ts`.
 *
 * Focus: the WCAG luminance transfer function's cut-off, the 0.5 / 0.4 contrast thresholds,
 * and the 30/70 "effective luminance" blend behind `glassTitleColor`.
 */

import { describe, expect, it } from 'vitest';

import {
  DARK_CHARCOAL,
  DIVIDER_GRAY,
  EYE_GREEN_BG,
  EYE_GREEN_TEXT,
  GLASS_TITLE_BG_WEIGHT,
  GLASS_TITLE_SURFACE_WEIGHT,
  GLASS_TITLE_THRESHOLD,
  LIGHT_BG,
  MEDIUM_GRAY,
  MINT_GOLD,
  NIGHT_BG,
  NIGHT_TEXT,
  OLED_BG,
  OLED_TEXT,
  ON_COLOR_THRESHOLD,
  ON_DARK_INK,
  PURE_WHITE,
  READER_PRESETS,
  SEPIA_BG,
  SEPIA_TEXT,
  WHITE,
  glassTitleColor,
  linearChannel,
  luminance,
  luminanceOfRgb,
  onColor,
  parseHexColor,
  resolveMintPrimary,
  resolveMintSecondary,
} from '../../src/core/ui-theme/color';
import type { MaterialColorScheme } from '../../src/core/ui-theme/color';

// ── Color.kt L17-L36 — the palette literals ──────────────────────────────────

describe('Color.kt palette literals', () => {
  it('matches every hard-coded hex in the Kotlin source', () => {
    expect(MINT_GOLD).toBe('#E8C97A'); // L17
    expect(DARK_CHARCOAL).toBe('#18191C'); // L19
    expect(MEDIUM_GRAY).toBe('#61666D'); // L20
    expect(DIVIDER_GRAY).toBe('#E3E5E7'); // L21
    expect(LIGHT_BG).toBe('#FFFFFF'); // L22  0xFFFFFFFF
    expect(PURE_WHITE).toBe('#FFFFFF'); // L23  0xFFFFFFFF
    expect(SEPIA_BG).toBe('#FBF0D9'); // L26
    expect(SEPIA_TEXT).toBe('#5F4B32'); // L27
    expect(EYE_GREEN_BG).toBe('#E8F5E9'); // L29
    expect(EYE_GREEN_TEXT).toBe('#1B5E20'); // L30
    expect(NIGHT_BG).toBe('#18191C'); // L32
    expect(NIGHT_TEXT).toBe('#D4D4D4'); // L33
    expect(OLED_BG).toBe('#000000'); // L35
    expect(OLED_TEXT).toBe('#E0E0E0'); // L36
  });

  it('groups the four reader presets the way Kotlin declares them', () => {
    expect(READER_PRESETS).toEqual({
      sepia: { background: '#FBF0D9', text: '#5F4B32' },
      eyeGreen: { background: '#E8F5E9', text: '#1B5E20' },
      night: { background: '#18191C', text: '#D4D4D4' },
      oled: { background: '#000000', text: '#E0E0E0' },
    });
  });

  it('agrees with src/ui/theme/tokens.ts COLORS on every shared hex', async () => {
    const { COLORS } = await import('../../src/ui/theme/tokens');
    expect(COLORS.mintGold).toBe(MINT_GOLD);
    expect(COLORS.darkCharcoal).toBe(DARK_CHARCOAL);
    expect(COLORS.mediumGray).toBe(MEDIUM_GRAY);
    expect(COLORS.dividerGray).toBe(DIVIDER_GRAY);
    expect(COLORS.pureWhite).toBe(PURE_WHITE);
    expect(COLORS.onDark).toBe(NIGHT_TEXT);
    expect(COLORS.onLight).toBe(DARK_CHARCOAL);
  });
});

// ── Color.kt L39-L41 — luminance ─────────────────────────────────────────────

describe('luminance() — Color.kt L39-L41', () => {
  it('returns 0 for black and 1 for white', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 10);
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 10);
  });

  it('uses the Kotlin 0.03928 cut-off, not tokens.ts\' 0.04045', () => {
    // The two constants only differ over channel values in (0.03928, 0.04045], i.e. an 8-bit
    // channel of 10.02..10.31 — no integer channel exists there, so both must agree.
    expect(linearChannel(10 / 255)).toBeCloseTo(10 / 255 / 12.92, 12);
    expect(linearChannel(11 / 255)).toBeCloseTo(Math.pow((11 / 255 + 0.055) / 1.055, 2.4), 12);
  });

  it('agrees with src/ui/theme/tokens.ts luminance() on all 8-bit channels', async () => {
    const { luminance: tokensLuminance } = await import('../../src/ui/theme/tokens');
    for (let value = 0; value <= 255; value += 1) {
      const hex = `#${value.toString(16).padStart(2, '0').repeat(3)}`;
      expect(luminance(hex)).toBeCloseTo(tokensLuminance(hex), 12);
    }
  });

  it('applies the 0.2126 / 0.7152 / 0.0722 weights', () => {
    const r = luminanceOfRgb({ r: 255, g: 0, b: 0 });
    const g = luminanceOfRgb({ r: 0, g: 255, b: 0 });
    const b = luminanceOfRgb({ r: 0, g: 0, b: 255 });
    expect(r).toBeCloseTo(0.2126, 10);
    expect(g).toBeCloseTo(0.7152, 10);
    expect(b).toBeCloseTo(0.0722, 10);
  });

  it('degrades a malformed hex to 0 instead of throwing', () => {
    expect(parseHexColor('#GGGGGG')).toBeNull();
    expect(parseHexColor('')).toBeNull();
    expect(luminance('not-a-colour')).toBe(0);
  });

  it('accepts the #RGB shorthand and a leading # or none', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor('18191C')).toEqual({ r: 24, g: 25, b: 28 });
  });
});

// ── Color.kt L48 — onColor() ─────────────────────────────────────────────────

describe('onColor() — Color.kt L48', () => {
  it('uses the 0.5 threshold', () => {
    expect(ON_COLOR_THRESHOLD).toBe(0.5);
    expect(onColor('#FFFFFF')).toBe(ON_DARK_INK);
    expect(onColor('#000000')).toBe(WHITE);
  });

  it('brackets the 0.5 threshold from both sides', () => {
    // #767676 is the classic 4.5:1-on-white grey but its luminance is only 0.184; the 0.5
    // boundary sits near #BCBCBC (luminance 0.497 / 0.503).
    expect(luminance('#767676')).toBeCloseTo(0.1812, 4);
    expect(luminance('#BBBBBB')).toBeLessThanOrEqual(0.5);
    expect(onColor('#BBBBBB')).toBe(WHITE);
    expect(luminance('#BCBCBC')).toBeGreaterThan(0.5);
    expect(onColor('#BCBCBC')).toBe(ON_DARK_INK);
  });

  it('returns near-black on light backgrounds and pure white on dark ones', () => {
    for (const preset of Object.values(READER_PRESETS)) {
      expect(['#1A1A1E', '#FFFFFF']).toContain(onColor(preset.background));
    }
  });

  it('picks the same ink for every light reader preset and the opposite for every dark one', () => {
    expect(onColor(READER_PRESETS.sepia.background)).toBe(ON_DARK_INK);
    expect(onColor(READER_PRESETS.eyeGreen.background)).toBe(ON_DARK_INK);
    expect(onColor(READER_PRESETS.night.background)).toBe(WHITE);
    expect(onColor(READER_PRESETS.oled.background)).toBe(WHITE);
  });
});

// ── Color.kt L56-L60 — glassTitleColor() ─────────────────────────────────────

describe('glassTitleColor() — Color.kt L56-L60', () => {
  it('keeps the 30 / 70 weights and the 0.4 threshold', () => {
    expect(GLASS_TITLE_BG_WEIGHT).toBe(0.3);
    expect(GLASS_TITLE_SURFACE_WEIGHT).toBe(0.7);
    expect(GLASS_TITLE_THRESHOLD).toBe(0.4);
    expect(GLASS_TITLE_BG_WEIGHT + GLASS_TITLE_SURFACE_WEIGHT).toBeCloseTo(1, 12);
  });

  it('blends in LINEAR-LUMINANCE space, not sRGB channel space', () => {
    // bgTone 1.0 (white wallpaper) + surface #6E6E6E (luminance 0.1559):
    //   Kotlin  : 0.3*1.0 + 0.7*0.1559 = 0.4091 > 0.4  → #1A1A1E
    //   tokens.ts: mixHex('#FFFFFF','#6E6E6E',0.78) = #BCBCBC → luminance 0.2699 → #FFFFFF
    const surfaceLum = luminance('#6E6E6E');
    expect(surfaceLum).toBeCloseTo(0.1559, 4);
    expect(glassTitleColor(1, surfaceLum)).toBe(ON_DARK_INK);
  });

  it('is a strict ">" comparison at the 0.4 boundary', () => {
    // effective = bgTone*0.30 + surfaceLum*0.70; with bgTone 0 the boundary is at
    // surfaceLum = 0.4 / 0.7 = 4/7. Bracket it either side of the double-precision edge.
    const boundary = GLASS_TITLE_THRESHOLD / GLASS_TITLE_SURFACE_WEIGHT;
    expect(glassTitleColor(0, boundary - 1e-6)).toBe(WHITE);
    expect(glassTitleColor(0, boundary + 1e-6)).toBe(ON_DARK_INK);
    // The blend is monotone in both inputs.
    expect(glassTitleColor(0, 0)).toBe(WHITE);
    expect(glassTitleColor(1, 1)).toBe(ON_DARK_INK);
  });

  it('is a 30/70 BLEND, and with the real theme surfaces the surface always wins', () => {
    const darkSurface = luminance('#222428'); // dark scheme, luminance ≈ 0.0177
    const lightSurface = luminance('#FFFFFF'); // light scheme, luminance 1.0

    // Light surface: effective ∈ [0.7, 1.0] for any bgTone ∈ [0, 1] → always dark ink.
    expect(glassTitleColor(0, lightSurface)).toBe(ON_DARK_INK);
    expect(glassTitleColor(1, lightSurface)).toBe(ON_DARK_INK);
    // Dark surface: effective ∈ [0.0124, 0.3124] for any bgTone → always white.
    expect(glassTitleColor(0, darkSurface)).toBe(WHITE);
    expect(glassTitleColor(1, darkSurface)).toBe(WHITE);

    // So for the two surfaces Theme.kt actually sets, the wallpaper tone cannot flip the ink.
    // The KDoc's "深色壁纸上白字、浅色壁纸上深字" only holds for a mid-luminance surface,
    // where 0.1429 < luminance ≤ 0.5714 puts the 30 % wallpaper term in charge:
    //   bgTone 0 → 0.7*0.35 = 0.245      ≤ 0.4 → white
    //   bgTone 1 → 0.3 + 0.7*0.35 = 0.545 > 0.4 → dark
    const midSurface = 0.35;
    expect(glassTitleColor(0, midSurface)).toBe(WHITE);
    expect(glassTitleColor(1, midSurface)).toBe(ON_DARK_INK);
  });

  it('differs from tokens.ts glassTitleColor() on at least one real input', async () => {
    const { glassTitleColor: tokensGlassTitleColor } = await import('../../src/ui/theme/tokens');
    const surface = '#6E6E6E';
    expect(glassTitleColor(1, luminance(surface))).toBe(ON_DARK_INK);
    expect(tokensGlassTitleColor('#FFFFFF', surface)).toBe(WHITE);
  });
});

// ── Color.kt L9-L15 — MintPrimary / MintSecondary ─────────────────────────────

describe('resolveMintPrimary / resolveMintSecondary — Color.kt L9-L15', () => {
  const scheme: MaterialColorScheme = {
    primary: '#2563EB',
    secondary: '#3B82F6',
    tertiary: '#2563EB',
    background: '#FFFFFF',
    surface: '#FFFFFF',
    onBackground: '#18191C',
    onSurface: '#18191C',
  };

  it('reads the live scheme rather than a fixed hex', () => {
    expect(resolveMintPrimary(scheme)).toBe('#2563EB');
    expect(resolveMintSecondary(scheme)).toBe('#3B82F6');
    expect(resolveMintPrimary({ ...scheme, primary: '#DB2777' })).toBe('#DB2777');
  });
});
