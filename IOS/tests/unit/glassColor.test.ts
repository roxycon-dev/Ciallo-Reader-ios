/**
 * Kotlin → TS map
 * ──────────────
 * Tests for `src/core/glass/color.ts`, the pure colour port shared by
 * `ui/pageturn/PaperPalette.kt`, `ui/glasskit/GlassKit.kt`,
 * `ui/components/MaxFx.kt`, `ui/components/LiquidGlass.kt`,
 * `ui/components/SourceAvatar.kt` and `ui/theme/Color.kt`.
 *
 * Nothing skipped — every assertion targets a ported Kotlin expression.
 */
import { describe, expect, it } from 'vitest';

import {
  crystalPrismColors,
  desaturateHex,
  hexToHsl,
  hslToHex,
  hsvToHex,
  iridescentColors,
  lerpColor,
  luminance,
  mixHex,
  onColor,
  parseHex,
  strokeTintOf,
  themedTint,
  withAlpha,
} from '../../src/core/glass/color';

describe('parseHex', () => {
  it('parses #RRGGBB', () => {
    expect(parseHex('#1A2B3C')).toEqual({ r: 26, g: 43, b: 60 });
  });

  it('expands the #RGB shorthand (SourceAvatar tint literals)', () => {
    expect(parseHex('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it('tolerates a missing # prefix and surrounding whitespace', () => {
    expect(parseHex('  00FF00 ')).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('returns null for malformed input (no crash — Kotlin Color() throws, here it degrades)', () => {
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('rebeccapurple')).toBeNull();
  });
});

describe('withAlpha', () => {
  it('Color.copy(alpha = a) → rgba() with the hue preserved exactly', () => {
    expect(withAlpha('#1A2B3C', 0.42)).toBe('rgba(26, 43, 60, 0.42)');
  });

  it('degrades to the AppSwitch fallback colour on malformed input', () => {
    expect(withAlpha('nope', 0.5)).toBe('rgba(24, 25, 28, 0.5)');
  });
});

describe('mixHex (PaperPalette.kt line 79 Color.mix)', () => {
  it('ratio 0 returns the first colour', () => {
    expect(mixHex('#000000', '#FFFFFF', 0)).toBe('#000000');
  });

  it('ratio 1 returns the second colour', () => {
    expect(mixHex('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
  });

  it('clamps out-of-range ratios instead of extrapolating', () => {
    expect(mixHex('#000000', '#FFFFFF', -5)).toBe('#000000');
    expect(mixHex('#000000', '#FFFFFF', 5)).toBe('#FFFFFF');
  });

  it('interpolates per channel in sRGB', () => {
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});

describe('desaturateHex (PaperPalette.kt line 90 Color.desaturate)', () => {
  it('fully desaturates a saturated colour to its Rec.709 luma', () => {
    // #FF0000 → luma = 0.2126 * 255 = 54.2 → 0x36 → grey #363636
    expect(desaturateHex('#FF0000', 1)).toBe('#363636');
    // #00FF00 → luma = 0.7152 * 255 = 182.4 → 0xB6
    expect(desaturateHex('#00FF00', 1)).toBe('#B6B6B6');
    // #0000FF → luma = 0.0722 * 255 = 18.4 → 0x12
    expect(desaturateHex('#0000FF', 1)).toBe('#121212');
  });

  it('amount 0 is a no-op', () => {
    expect(desaturateHex('#FF0000', 0)).toBe('#FF0000');
  });

  it('returns the input unchanged when it cannot be parsed', () => {
    expect(desaturateHex('zzz', 0.5)).toBe('zzz');
  });
});

describe('lerpColor (MaxFx.kt line 192)', () => {
  it('matches mixHex', () => {
    expect(lerpColor('#101010', '#F0F0F0', 0.5)).toBe(mixHex('#101010', '#F0F0F0', 0.5));
  });
});

describe('luminance / onColor (theme/Color.kt lines 39 / 48)', () => {
  it('white is 1 and black is 0', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 6);
    expect(luminance('#000000')).toBeCloseTo(0, 6);
  });

  it('onColor picks near-black on light backgrounds and white on dark ones', () => {
    expect(onColor('#F5F0E6')).toBe('#1A1A1E');
    expect(onColor('#0B0C0E')).toBe('#FFFFFF');
  });

  it('PaperPalette.kt line 50 threshold: luminance < 0.25 selects the dark palette', () => {
    // Mid grey #767676 sits at WCAG luminance ≈ 0.185 → dark branch.
    expect(luminance('#767676')).toBeLessThan(0.25);
    // Paper #F5F0E6 → ≈ 0.895 → light branch.
    expect(luminance('#F5F0E6')).toBeGreaterThan(0.25);
  });
});

describe('hsvToHex (Compose Color.hsv)', () => {
  it('reproduces the six standard hue sectors at full saturation', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#FF0000');
    expect(hsvToHex(60, 1, 1)).toBe('#FFFF00');
    expect(hsvToHex(120, 1, 1)).toBe('#00FF00');
    expect(hsvToHex(180, 1, 1)).toBe('#00FFFF');
    expect(hsvToHex(240, 1, 1)).toBe('#0000FF');
    expect(hsvToHex(300, 1, 1)).toBe('#FF00FF');
  });

  it('wraps hues outside 0..360 (iridescentColors adds ±28°)', () => {
    expect(hsvToHex(360, 1, 1)).toBe(hsvToHex(0, 1, 1));
    expect(hsvToHex(-60, 1, 1)).toBe(hsvToHex(300, 1, 1));
    expect(hsvToHex(420, 1, 1)).toBe(hsvToHex(60, 1, 1));
  });

  it('zero value collapses to black regardless of hue', () => {
    expect(hsvToHex(210, 0.52, 0)).toBe('#000000');
  });

  it('SourceAvatar.kt line 39 literal: Color.hsv(hue, 0.52f, 0.86f)', () => {
    // hue 0 → c = 0.86*0.52 = 0.4472, x = 0, m = 0.86 - 0.4472 = 0.4128
    // r = (c + m)·255 = 0.86·255 = 219 (0xDB); g = b = m·255 = 105 (0x69)
    expect(hsvToHex(0, 0.52, 0.86)).toBe('#DB6969');
  });
});

describe('hslToHex / hexToHsl round-trip', () => {
  it('round-trips primaries', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#FF0000');
    expect(hslToHex(1 / 3, 1, 0.5)).toBe('#00FF00');
    expect(hslToHex(2 / 3, 1, 0.5)).toBe('#0000FF');
  });

  it('round-trips an arbitrary colour back to itself', () => {
    const [h, s, l] = hexToHsl('#6F42C1');
    expect(hslToHex(h, s, l)).toBe('#6F42C1');
  });

  it('achromatic input returns hue/saturation 0 (GlassCard.kt colorToHSL path)', () => {
    expect(hexToHsl('#808080')).toEqual([0, 0, expect.closeTo(0.5019607, 5)]);
  });

  it('malformed input degrades to [0,0,0]', () => {
    expect(hexToHsl('nope')).toEqual([0, 0, 0]);
  });
});

describe('iridescentColors (LiquidGlass.kt lines 449-461)', () => {
  it('is a closed 5-stop ring starting and ending on the primary', () => {
    const colors = iridescentColors('#2E7D32', '#1565C0');
    expect(colors).toHaveLength(5);
    expect(colors[0]).toBe('#2E7D32');
    expect(colors[4]).toBe('#2E7D32');
  });

  it('places the warm/cool neighbours at ±28° of the primary hue', () => {
    const primary = '#2E7D32';
    const [h] = hexToHsl(primary);
    const hue = h * 360;
    const colors = iridescentColors(primary, '#1565C0');
    expect(colors[1]).toBe(hsvToHex((hue + 28) % 360, 0.45, 1));
    expect(colors[3]).toBe(hsvToHex((hue - 28 + 360) % 360, 0.42, 1));
  });

  it('carries the secondary colour at index 2', () => {
    expect(iridescentColors('#2E7D32', '#1565C0')[2]).toBe('#1565C0');
  });
});

describe('crystalPrismColors (LiquidGlass.kt lines 468-480)', () => {
  it('is a closed 6-stop dispersion ring with the pearl highlight at index 2', () => {
    const colors = crystalPrismColors('#2E7D32', '#1565C0');
    expect(colors).toHaveLength(6);
    expect(colors[0]).toBe('#2E7D32');
    expect(colors[5]).toBe('#2E7D32');
    expect(colors[2]).toBe('#EAF5F8');
    expect(colors[3]).toBe('#1565C0');
  });
});

describe('strokeTintOf / themedTint (GlassCard.kt lines 284 / 280-282)', () => {
  it('strokeTintOf = lerp(White, primary, 0.38)', () => {
    expect(strokeTintOf('#000000')).toBe(mixHex('#FFFFFF', '#000000', 0.38));
  });

  it('themedTint clamps tintMix into 0..1', () => {
    expect(themedTint('#F0F0F0', '#FF0000', 0)).toBe('#F0F0F0');
    expect(themedTint('#F0F0F0', '#FF0000', 1)).toBe('#FF0000');
    expect(themedTint('#F0F0F0', '#FF0000', 9)).toBe('#FF0000');
  });
});