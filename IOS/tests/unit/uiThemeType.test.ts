/**
 * `ui/theme/Type.kt` (140 lines, 133 non-blank) → `src/core/ui-theme/type.ts`.
 *
 * Focus: the 15 slots, every sp value verbatim, and the two iOS traits the KDoc calls out
 * (bigger type tracks tighter; body line-height ≈ 1.45× the size).
 */

import { describe, expect, it } from 'vitest';

import { APP_FONTS } from '../../src/core/ui-theme/appFonts';
import {
  FONT_WEIGHT_CSS,
  TYPOGRAPHY,
  TYPOGRAPHY_SLOTS,
  lineHeightRatio,
  textStyleCss,
  typography,
} from '../../src/core/ui-theme/type';
import type { TextStyle } from '../../src/core/ui-theme/type';

/** Kotlin L25-L138, transcribed slot by slot. Index = position in `Type.kt`. */
const KOTLIN_TABLE: ReadonlyArray<[string, string, number, number, number]> = [
  // slot,          weight,     fontSize, lineHeight, letterSpacing
  ['displayLarge', 'Bold', 34, 41, -0.4],
  ['displayMedium', 'Bold', 28, 34, -0.3],
  ['displaySmall', 'SemiBold', 24, 30, -0.25],
  ['headlineLarge', 'Bold', 22, 28, -0.25],
  ['headlineMedium', 'SemiBold', 20, 26, -0.2],
  ['headlineSmall', 'SemiBold', 18, 24, -0.2],
  ['titleLarge', 'SemiBold', 17, 24, -0.2],
  ['titleMedium', 'Medium', 16, 22, -0.15],
  ['titleSmall', 'Medium', 14, 20, -0.1],
  ['bodyLarge', 'Normal', 16, 23, -0.1],
  ['bodyMedium', 'Normal', 14, 21, 0],
  ['bodySmall', 'Normal', 13, 19, 0],
  ['labelLarge', 'SemiBold', 15, 20, -0.1],
  ['labelMedium', 'Medium', 13, 18, 0],
  ['labelSmall', 'Medium', 11, 16, 0.06],
];

describe('Type.kt — the 15 slots', () => {
  it('declares exactly the Material3 slot list, in source order', () => {
    expect([...TYPOGRAPHY_SLOTS]).toEqual(KOTLIN_TABLE.map(([slot]) => slot));
    expect(TYPOGRAPHY_SLOTS).toHaveLength(15);
  });

  it.each(KOTLIN_TABLE)('%s keeps its exact weight / size / line-height / tracking', (
    slot,
    weight,
    fontSize,
    lineHeight,
    letterSpacing,
  ) => {
    expect(typography(slot as keyof typeof TYPOGRAPHY)).toEqual({
      fontFamily: APP_FONTS.Default,
      fontWeight: weight,
      fontSize,
      lineHeight,
      letterSpacing,
    });
  });

  it('uses AppFonts.Default on every slot (Type.kt L26-L137)', () => {
    for (const slot of TYPOGRAPHY_SLOTS) {
      expect(TYPOGRAPHY[slot].fontFamily).toBe(APP_FONTS.Default);
      expect(TYPOGRAPHY[slot].fontFamily).toContain('Noto Sans SC');
    }
  });

  it('maps FontWeight to the CSS numbers Compose resolves to', () => {
    expect(FONT_WEIGHT_CSS).toEqual({ Normal: 400, Medium: 500, SemiBold: 600, Bold: 700 });
  });
});

describe('Type.kt — the two iOS traits named in the KDoc (L17-L21)', () => {
  it('trait 1: bigger type tracks tighter, and only 11sp opens up', () => {
    // 34sp → -0.4 and 11sp → +0.06, exactly as the KDoc states.
    expect(TYPOGRAPHY.displayLarge.letterSpacing).toBe(-0.4);
    expect(TYPOGRAPHY.labelSmall.letterSpacing).toBe(0.06);

    const negative = TYPOGRAPHY_SLOTS.filter((s) => TYPOGRAPHY[s].letterSpacing < 0);
    const zero = TYPOGRAPHY_SLOTS.filter((s) => TYPOGRAPHY[s].letterSpacing === 0);
    const positive = TYPOGRAPHY_SLOTS.filter((s) => TYPOGRAPHY[s].letterSpacing > 0);
    expect(negative).toHaveLength(11);
    expect(zero).toEqual(['bodyMedium', 'bodySmall', 'labelMedium']);
    expect(positive).toEqual(['labelSmall']);
  });

  it('trait 1: the whole display/headline/title scale tracks negatively', () => {
    // The KDoc's "字号越大，字距越紧" is a tendency, not a strict law: bodyMedium (14sp, 0)
    // and bodySmall (13sp, 0) sit looser than titleSmall (14sp, -0.1). Assert the actual rule
    // rather than an over-strong one.
    for (const slot of [
      'displayLarge',
      'displayMedium',
      'displaySmall',
      'headlineLarge',
      'headlineMedium',
      'headlineSmall',
      'titleLarge',
      'titleMedium',
      'titleSmall',
    ] as const) {
      expect(TYPOGRAPHY[slot].letterSpacing).toBeLessThan(0);
    }
    // Mean tracking tightens as the type scale grows.
    const meanOf = (slots: readonly string[]): number =>
      slots.reduce((sum, s) => sum + TYPOGRAPHY[s as keyof typeof TYPOGRAPHY].letterSpacing, 0) /
      slots.length;
    expect(meanOf(['displayLarge', 'displayMedium', 'displaySmall'])).toBeLessThan(
      meanOf(['titleLarge', 'titleMedium', 'titleSmall']),
    );
    expect(meanOf(['titleLarge', 'titleMedium', 'titleSmall'])).toBeLessThan(
      meanOf(['bodyLarge', 'bodyMedium', 'bodySmall']),
    );
  });

  it('trait 2: body line-height ≈ 1.45×, headings 1.2~1.25×', () => {
    for (const slot of ['bodyLarge', 'bodyMedium', 'bodySmall'] as const) {
      const ratio = lineHeightRatio(TYPOGRAPHY[slot]);
      expect(ratio).toBeGreaterThanOrEqual(1.43);
      expect(ratio).toBeLessThanOrEqual(1.5);
    }
    expect(lineHeightRatio(TYPOGRAPHY.bodyLarge)).toBeCloseTo(23 / 16, 12);
    expect(lineHeightRatio(TYPOGRAPHY.displayLarge)).toBeCloseTo(41 / 34, 12);
  });

  it('bodyLarge is 23sp, not the 26sp the inline comment at L98 replaced', () => {
    expect(TYPOGRAPHY.bodyLarge.lineHeight).toBe(23);
    expect(TYPOGRAPHY.bodyLarge.lineHeight).not.toBe(26);
  });
});

describe('textStyleCss()', () => {
  const style: TextStyle = TYPOGRAPHY.displayLarge;

  it('emits px longhands at scale 1', () => {
    expect(textStyleCss(style)).toEqual({
      fontFamily: APP_FONTS.Default,
      fontWeight: 700,
      fontSize: '34px',
      lineHeight: '41px',
      letterSpacing: '-0.4px',
    });
  });

  it('scales every length by the Android font scale', () => {
    expect(textStyleCss(TYPOGRAPHY.bodyLarge, 1.3)).toEqual({
      fontFamily: APP_FONTS.Default,
      fontWeight: 400,
      fontSize: '20.8px',
      lineHeight: '29.9px',
      letterSpacing: '-0.13px',
    });
  });

  it('emits 0 tracking as "0px" rather than dropping it, so "0" ≠ "unset"', () => {
    expect(textStyleCss(TYPOGRAPHY.bodySmall).letterSpacing).toBe('0px');
  });

  it('emits the positive labelSmall tracking verbatim', () => {
    expect(textStyleCss(TYPOGRAPHY.labelSmall).letterSpacing).toBe('0.06px');
  });
});

describe('Type.kt vs src/styles/theme.css — declared divergences', () => {
  it('theme.css has no .page-title letter-spacing of -0.3px; it uses +0.5px', async () => {
    const css = await readThemeCss();
    // theme.css L145: `.page-title { … letter-spacing: 0.5px; }`
    expect(css).toMatch(/\.page-title\s*\{[^}]*letter-spacing:\s*0\.5px/);
    // …while displayMedium (the 28px slot) tracks -0.3px.
    expect(TYPOGRAPHY.displayMedium.letterSpacing).toBe(-0.3);
  });

  it('theme.css adds +1px tracking to a 13px subtitle whose Kotlin slot tracks 0', async () => {
    const css = await readThemeCss();
    expect(css).toMatch(/\.page-subtitle\s*\{[^}]*font-size:\s*13px/);
    expect(css).toMatch(/\.page-subtitle\s*\{[^}]*letter-spacing:\s*1px/);
    expect(TYPOGRAPHY.bodySmall.letterSpacing).toBe(0);
  });

  it('theme.css tab-bar label matches AppBottomTabBar.kt L511-516 (10sp, no spacing/weight)', async () => {
    const css = await readThemeCss();
    // Kotlin: Text(text = item.label, fontSize = 10.sp, color = iconColor,
    //               modifier = Modifier.padding(top = 2.dp))
    // 没有 fontWeight / letterSpacing / lineHeight → 全走 Compose 默认
    //（Weight = Normal、spacing = 0、lineHeight = Unspecified）。
    // 旧 CSS 的 12px 行高 / 500 字重 / 0.4px 字距是凭空加的。
    expect(css).toMatch(/\.app-tabbar-label\s*\{[^}]*font-size:\s*10px/);
    expect(css).toMatch(/\.app-tabbar-label\s*\{[^}]*line-height:\s*normal/);
    expect(css).toMatch(/\.app-tabbar-label\s*\{[^}]*font-weight:\s*400/);
    expect(css).toMatch(/\.app-tabbar-label\s*\{[^}]*letter-spacing:\s*0;/);
    // labelSmall 是另一个槽位（Type.kt L132-137），别拿来当这里的值
    expect(TYPOGRAPHY.labelSmall.fontSize).toBe(11);
    expect(TYPOGRAPHY.labelSmall.lineHeight).toBe(16);
    expect(TYPOGRAPHY.labelSmall.letterSpacing).toBe(0.06);
  });

  it('theme.css tab-screen header title uses line-height 1.25, Kotlin says 28/22 = 1.2727…', async () => {
    const css = await readThemeCss();
    expect(css).toMatch(/\.tab-screen-header__title\s*\{[^}]*line-height:\s*1\.25/);
    expect(lineHeightRatio(TYPOGRAPHY.headlineLarge)).toBeCloseTo(28 / 22, 12);
    expect(lineHeightRatio(TYPOGRAPHY.headlineLarge)).not.toBeCloseTo(1.25, 6);
  });
});

/** Read `src/styles/theme.css` from disk via the raw-import-free fs shim vitest provides. */
async function readThemeCss(): Promise<string> {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  return readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8');
}
