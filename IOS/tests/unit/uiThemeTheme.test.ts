/**
 * `ui/theme/Theme.kt` (92 lines, 83 non-blank) → `src/core/ui-theme/theme.ts`,
 * `ui/theme/AppFonts.kt` (147 lines, 130 non-blank) → `src/core/ui-theme/appFonts.ts`,
 * `ui/theme/AppInsets.kt` (33 lines, 29 non-blank) → `src/core/ui-theme/appInsets.ts`.
 *
 * Focus: the two accent palettes and the `getOrElse → index 2` fallback, the light/dark
 * scheme slots, the persisted reading-font ids, and the bottom-inset arithmetic per
 * window-size class.
 */

import { describe, expect, it } from 'vitest';

import {
  APP_INSETS_DEFAULT,
  FLOATING_TAB_BAR_TOTAL_DP,
  INSET_DEFAULT_DP,
  TAB_BAR_BODY_DP,
  TAB_BAR_MARGIN_BOTTOM_DP,
  TAB_BAR_MARGIN_DP,
  TAB_BAR_MARGIN_TOP_DP,
  VISUAL_GAP_DP,
  appInsetsPaddingBottomCss,
  appInsetsWidthClass,
  resolveAppInsets,
} from '../../src/core/ui-theme/appInsets';
import {
  APP_FONTS,
  FONT_RESOURCE_STRIPPED,
  MONOSPACE_STACK,
  NOTO_SANS_SC_FACES,
  NOTO_SANS_SC_FILE,
  NOTO_SANS_SC_STACK,
  NOTO_SERIF_SC_FACES,
  NOTO_SERIF_SC_FILE,
  NOTO_SERIF_SC_STACK,
  assertReadingFontIds,
  readingFontFamilies,
  readingFontFamily,
} from '../../src/core/ui-theme/appFonts';
import {
  BASE_PRIMARY_COLORS,
  BASE_SECONDARY_COLORS,
  DARK_SURFACE,
  DEFAULT_PRIMARY_INDEX,
  DEFAULT_SECONDARY_INDEX,
  THEME_COLOR_TRANSITION_MS,
  darkColorScheme,
  lightColorScheme,
  resolveAccent,
  resolveAccentColors,
  resolveColorScheme,
  themeColorTransitionCss,
} from '../../src/core/ui-theme/theme';

// ── Theme.kt L16-L30 — the two palettes ──────────────────────────────────────

describe('Theme.kt — accent palettes', () => {
  it('matches all ten Kotlin hexes in order', () => {
    expect([...BASE_PRIMARY_COLORS]).toEqual(['#2563EB', '#7C3AED', '#059669', '#DB2777', '#EA580C']);
    expect([...BASE_SECONDARY_COLORS]).toEqual(['#3B82F6', '#8B5CF6', '#10B981', '#EC4899', '#F97316']);
  });

  it('agrees with src/ui/theme/tokens.ts on every entry and both defaults', async () => {
    const { COLORS } = await import('../../src/ui/theme/tokens');
    expect([...COLORS.primaryPalette]).toEqual([...BASE_PRIMARY_COLORS]);
    expect([...COLORS.secondaryPalette]).toEqual([...BASE_SECONDARY_COLORS]);
    expect(COLORS.defaultPrimaryIndex).toBe(DEFAULT_PRIMARY_INDEX);
    expect(COLORS.defaultSecondaryIndex).toBe(DEFAULT_SECONDARY_INDEX);
    expect(DEFAULT_PRIMARY_INDEX).toBe(2);
    expect(DEFAULT_SECONDARY_INDEX).toBe(2);
  });
});

// ── Theme.kt L43-L44 — getOrElse → index 2 ──────────────────────────────────

describe('Theme.kt — resolveAccent() getOrElse fallback', () => {
  it('returns the requested entry inside the palette', () => {
    for (let i = 0; i < BASE_PRIMARY_COLORS.length; i += 1) {
      expect(resolveAccent(BASE_PRIMARY_COLORS, i)).toBe(BASE_PRIMARY_COLORS[i]);
    }
  });

  it('falls back to entry 2 for every out-of-range index', () => {
    for (const index of [5, 6, 99, -1, -999, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveAccent(BASE_PRIMARY_COLORS, index)).toBe('#059669');
      expect(resolveAccent(BASE_SECONDARY_COLORS, index)).toBe('#10B981');
    }
  });

  it('resolves both accents through the same rule', () => {
    expect(resolveAccentColors({ darkTheme: false })).toEqual({ primary: '#059669', secondary: '#10B981' });
    expect(resolveAccentColors({ darkTheme: false, colorPrimaryIndex: 3, colorSecondaryIndex: 0 })).toEqual({
      primary: '#DB2777',
      secondary: '#3B82F6',
    });
  });
});

// ── Theme.kt L58-L78 — the two colour schemes ────────────────────────────────

describe('Theme.kt — light / dark colour schemes', () => {
  it('light: white background, pure-white surface, charcoal on-surface', () => {
    expect(lightColorScheme('#059669', '#10B981')).toEqual({
      primary: '#059669',
      secondary: '#10B981',
      tertiary: '#059669', // tertiary = primaryColor (L61)
      background: '#FFFFFF', // LightBg (L62)
      surface: '#FFFFFF', // PureWhite (L63)
      onBackground: '#18191C', // DarkCharcoal (L64)
      onSurface: '#18191C', // DarkCharcoal (L65)
    });
  });

  it('dark: charcoal background, #222428 surface, #D4D4D4 on-surface', () => {
    expect(darkColorScheme('#059669', '#10B981')).toEqual({
      primary: '#059669',
      secondary: '#10B981',
      tertiary: '#059669',
      background: '#18191C', // DarkCharcoal (L72)
      surface: '#222428', // Color(0xFF222428) (L73)
      onBackground: '#D4D4D4', // NightText (L74)
      onSurface: '#D4D4D4', // NightText (L75)
    });
  });

  it('theme.css now carries the dark surface #222428', async () => {
    expect(DARK_SURFACE).toBe('#222428');
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8');
    // 浅色仍是默认值
    expect(css).toContain('--color-surface: #ffffff;');
    // 深色 token 由 [data-theme='dark'] 提供 —— 不是 @media，因为
    // MainActivity.kt L213 用的是设置项 autoNightMode，不是 isSystemInDarkTheme()。
    expect(css).toMatch(/\[data-theme='dark'\]/);
    // 断言的是「没有 @media at-rule」——先把注释剥掉，否则文件里解释
    // 「为什么不能用 prefers-color-scheme」的那段注释自己就会命中。
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(cssNoComments).not.toMatch(/@media[^{]*prefers-color-scheme/);
    const darkBlock = css.slice(css.indexOf("[data-theme='dark']"));
    expect(darkBlock).toContain('--color-surface: #222428;');
    expect(darkBlock).toContain('--color-light-bg: #18191c;');
    // Theme.kt L74-75 onBackground = onSurface = NightText #D4D4D4
    expect(darkBlock).toContain('--color-on-light: #d4d4d4;');
  });

  it('resolveColorScheme picks by darkTheme (Kotlin L78)', () => {
    expect(resolveColorScheme({ darkTheme: false }).colorScheme.surface).toBe('#FFFFFF');
    expect(resolveColorScheme({ darkTheme: true }).colorScheme.surface).toBe(DARK_SURFACE);
    expect(resolveColorScheme({ darkTheme: true }).colorScheme.background).toBe('#18191C');
  });

  it('carries the Kotlin animateColorAsState labels through', () => {
    const theme = resolveColorScheme({ darkTheme: false });
    expect(theme.labels).toEqual({ primary: 'themePrimary', secondary: 'themeSecondary' });
    expect(theme.typography).toBeDefined();
    expect(Object.keys(theme.typography)).toHaveLength(15);
  });
});

// ── Theme.kt L42 / L49 — the 600 ms colour cross-fade ────────────────────────

describe('Theme.kt — the 600 ms theme-colour transition', () => {
  it('is 600 ms on IosMotion.EaseOut', () => {
    expect(THEME_COLOR_TRANSITION_MS).toBe(600);
    expect(themeColorTransitionCss).toBe('600ms cubic-bezier(0, 0, 0.58, 1)');
    expect(resolveColorScheme({ darkTheme: false }).colorTransitionCss).toBe(themeColorTransitionCss);
  });

  it('is now wired into both tokens.ts MOTION and theme.css', async () => {
    const { DESIGN_TOKENS } = await import('../../src/ui/tokens');
    expect(DESIGN_TOKENS.motion.colorTransitionMs).toBe(600);
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8');
    expect(css).toContain('--motion-color-transition: 600ms;');
    expect(css).toMatch(/var\(--motion-color-transition\) var\(--ease-out\)/);
  });
});

// ── AppFonts.kt L84-L103 — the family registry ───────────────────────────────

describe('AppFonts — the family registry', () => {
  it('puts the bundled Noto subsets first, matching theme.css L66-L67', async () => {
    expect(NOTO_SANS_SC_STACK).toBe('"Noto Sans SC", "PingFang SC", "Helvetica Neue", sans-serif');
    expect(NOTO_SERIF_SC_STACK).toBe('"Noto Serif SC", "Songti SC", Georgia, serif');
    expect(MONOSPACE_STACK).toContain('monospace');

    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8');
    // theme.css spells the stacks with SINGLE quotes; the family names and order are identical.
    const singleQuoted = (stack: string): string => stack.replace(/"/g, "'");
    expect(css).toContain(`--font-sans: ${singleQuoted(NOTO_SANS_SC_STACK)};`);
    expect(css).toContain(`--font-serif: ${singleQuoted(NOTO_SERIF_SC_STACK)};`);
    expect(css).toMatch(/@font-face\s*\{\s*font-family:\s*'Noto Sans SC';/);
    expect(css).toMatch(/url\('\/fonts\/noto_sans_sc_regular\.otf'\)/);
    expect(css).toMatch(/url\('\/fonts\/noto_serif_sc_regular\.otf'\)/);
  });

  it('aliases the six public families exactly as Kotlin does', () => {
    // L84  Default = uiSans        L103 ReadingSansSerif = uiSans
    expect(APP_FONTS.Default).toBe(NOTO_SANS_SC_STACK);
    expect(APP_FONTS.SansSerif).toBe(APP_FONTS.Default);
    expect(APP_FONTS.ReadingSansSerif).toBe(APP_FONTS.Default);
    // L87  Serif = uiSerif          L100 ReadingSerif = uiSerif
    expect(APP_FONTS.Serif).toBe(NOTO_SERIF_SC_STACK);
    expect(APP_FONTS.ReadingSerif).toBe(APP_FONTS.Serif);
    expect(APP_FONTS.Monospace).toBe(MONOSPACE_STACK);
  });

  it('keeps the Android asset names verbatim', () => {
    expect(NOTO_SANS_SC_FILE).toBe('noto_sans_sc_regular.otf');
    expect(NOTO_SERIF_SC_FILE).toBe('noto_serif_sc_regular.otf');
  });

  it('registers one file at both weights, i.e. faux bold (L49-L52, L58-L61)', () => {
    expect(NOTO_SANS_SC_FACES).toEqual([
      { file: NOTO_SANS_SC_FILE, weight: 400 },
      { file: NOTO_SANS_SC_FILE, weight: 700 },
    ]);
    expect(NOTO_SERIF_SC_FACES).toEqual([
      { file: NOTO_SERIF_SC_FILE, weight: 400 },
      { file: NOTO_SERIF_SC_FILE, weight: 700 },
    ]);
    // No 500 / 600 face exists, so Type.kt's Medium / SemiBold are also synthesised.
    const weights = NOTO_SANS_SC_FACES.map((f) => f.weight);
    expect(weights).not.toContain(500);
    expect(weights).not.toContain(600);
  });

  it('preserves the "font resource stripped" literal from L48', () => {
    expect(FONT_RESOURCE_STRIPPED).toBe('font resource stripped');
  });
});

// ── AppFonts.kt L124-L145 — the reading-font tiers ───────────────────────────

describe('AppFonts — reading font tiers', () => {
  it('keeps the four ids and Chinese labels in their persisted order', () => {
    expect(readingFontFamilies()).toEqual([
      { id: 0, label: '默认字体', family: NOTO_SANS_SC_STACK },
      { id: 1, label: '衬线体', family: NOTO_SERIF_SC_STACK },
      { id: 2, label: '黑体', family: NOTO_SANS_SC_STACK },
      { id: 3, label: '等宽体', family: MONOSPACE_STACK },
    ]);
    expect(() => assertReadingFontIds()).not.toThrow();
  });

  it('the guard trips if an id or label is reordered or renamed', () => {
    const drifted = [...readingFontFamilies()];
    drifted[1] = { ...drifted[1]!, id: 2 };
    expect(() => assertReadingFontIds(drifted)).toThrow(/drifted/);
    const renamed = readingFontFamilies().map((f) => (f.id === 3 ? { ...f, label: '等宽' } : f));
    expect(() => assertReadingFontIds(renamed)).toThrow(/drifted/);
    expect(() => assertReadingFontIds(readingFontFamilies().slice(0, 3))).toThrow(/drifted/);
  });

  it('resolves every branch of the Kotlin when (L139-L144)', () => {
    expect(readingFontFamily(0, null)).toBe(NOTO_SANS_SC_STACK); // else ->
    expect(readingFontFamily(1, null)).toBe(NOTO_SERIF_SC_STACK); // 1 ->
    expect(readingFontFamily(2, null)).toBe(NOTO_SANS_SC_STACK); // 2 ->
    expect(readingFontFamily(3, null)).toBe(MONOSPACE_STACK); // 3 ->
    expect(readingFontFamily(4, '"MyFont", serif')).toBe('"MyFont", serif'); // 4 -> custom
    expect(readingFontFamily(4, null)).toBe(NOTO_SANS_SC_STACK); // 4 -> custom ?:
    expect(readingFontFamily(99, null)).toBe(NOTO_SANS_SC_STACK); // else ->
    expect(readingFontFamily(-1, null)).toBe(NOTO_SANS_SC_STACK); // else ->
  });

  it('matches the already-ported src/core/reader/readerScreenLogic.ts table', async () => {
    const reader = await import('../../src/core/reader/readerScreenLogic');
    expect(reader.READING_FONT_FAMILIES.map((f) => f.index)).toEqual(readingFontFamilies().map((f) => f.id));
    expect(reader.READING_FONT_FAMILIES.map((f) => f.name)).toEqual(readingFontFamilies().map((f) => f.label));
    expect(reader.CUSTOM_FONT_INDEX).toBe(4);
    for (const index of [0, 1, 2, 3]) {
      expect(readingFontFamily(index, null)).toBe(reader.readingFontFamilyCss(index, null));
    }
    expect(readingFontFamily(4, '"X"')).toBe(reader.readingFontFamilyCss(4, '"X"'));
  });
});

// ── AppInsets.kt L20-L32 + MainActivity.kt L302-L343 ────────────────────────

describe('AppInsets — the 92 dp pill decomposition', () => {
  it('12 + 68 + 12 = 92, exactly as the MainActivity comment states', () => {
    expect(TAB_BAR_MARGIN_DP).toBe(12);
    expect(TAB_BAR_MARGIN_TOP_DP).toBe(12);
    expect(TAB_BAR_MARGIN_BOTTOM_DP).toBe(12);
    expect(TAB_BAR_BODY_DP).toBe(68);
    expect(FLOATING_TAB_BAR_TOTAL_DP).toBe(92);
    expect(TAB_BAR_MARGIN_TOP_DP + TAB_BAR_BODY_DP + TAB_BAR_MARGIN_BOTTOM_DP).toBe(FLOATING_TAB_BAR_TOTAL_DP);
    expect(VISUAL_GAP_DP).toBe(8);
  });

  it('defaults both composition locals to 0', () => {
    expect(INSET_DEFAULT_DP).toBe(0);
    expect(APP_INSETS_DEFAULT.bottomInset).toBe(0);
    expect(APP_INSETS_DEFAULT.bottomInsetNoTabBar).toBe(0);
    expect(APP_INSETS_DEFAULT.active).toBe(0);
  });
});

describe('AppInsets — resolution per window-size class', () => {
  // Kotlin has no width-class branch, so all three classes must resolve identically.
  const CLASSES = [
    ['COMPACT', 411],
    ['MEDIUM', 700],
    ['EXPANDED', 1280],
  ] as const;

  it.each(CLASSES)('%s (width %i) resolves the same two numbers', (_class, width) => {
    for (const navBarBottom of [0, 24, 34, 48]) {
      const spec = resolveAppInsets({ navBarBottom, width });
      expect(spec.widthClass).toBe(_class);
      expect(spec.bottomInset).toBe(navBarBottom + 92 + 8);
      expect(spec.bottomInsetNoTabBar).toBe(navBarBottom + 8);
      expect(spec.bottomInset - spec.bottomInsetNoTabBar).toBe(92);
    }
  });

  it('gesture nav (0) gives 100; three-button nav (48) gives 148', () => {
    expect(resolveAppInsets({ navBarBottom: 0, width: 411 }).bottomInset).toBe(100);
    expect(resolveAppInsets({ navBarBottom: 48, width: 411 }).bottomInset).toBe(148);
    expect(resolveAppInsets({ navBarBottom: 48, width: 411 }).bottomInsetNoTabBar).toBe(56);
  });

  it('switches `active` on tabBarVisible, dropping exactly the 92 dp pill', () => {
    const shown = resolveAppInsets({ navBarBottom: 0, width: 411, tabBarVisible: true });
    const hidden = resolveAppInsets({ navBarBottom: 0, width: 411, tabBarVisible: false });
    expect(shown.active).toBe(100);
    expect(hidden.active).toBe(8);
    expect(shown.active - hidden.active).toBe(92);
    // Default is visible.
    expect(resolveAppInsets({ navBarBottom: 0, width: 411 }).active).toBe(100);
  });

  it('classifies widths on the M3 breakpoints', () => {
    expect(appInsetsWidthClass(0)).toBe('COMPACT');
    expect(appInsetsWidthClass(599)).toBe('COMPACT');
    expect(appInsetsWidthClass(600)).toBe('MEDIUM');
    expect(appInsetsWidthClass(839)).toBe('MEDIUM');
    expect(appInsetsWidthClass(840)).toBe('EXPANDED');
  });

  it('reproduces theme.css L119 total (68 + 32) but not its decomposition', () => {
    const spec = resolveAppInsets({ navBarBottom: 0, width: 411 });
    expect(appInsetsPaddingBottomCss(spec, 0)).toBe('calc(100px + 0px)');
    // Kotlin: 92 (pill incl. its own 24 px of margin) + 8 (visual gap) = 100
    expect(FLOATING_TAB_BAR_TOTAL_DP + VISUAL_GAP_DP).toBe(100);
    // CSS:   68 (body) + 32 (gap that already swallows the 24 px margin) = 100
    expect(TAB_BAR_BODY_DP + 32).toBe(100);
    // …so the 8 px visual gap has no independent CSS knob.
    expect(appInsetsPaddingBottomCss(spec, 34)).toBe('calc(100px + 34px)');
  });

  it('theme.css no longer hardcodes the 96 px that AppInsets.kt was written to remove', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8');
    // AppInsets.kt L11-13 names 96 / 104 / 120 / 24 / 60 as the magic numbers to remove.
    // 现在统一走 --app-bottom-inset（= navBarBottom + 92 + 8）。
    expect(css).toContain('--app-bottom-inset: 100px;');
    expect(css).toContain('--app-bottom-inset-no-tab-bar: 8px;');
    expect(css).not.toMatch(/calc\(96px \+ var\(--safe-bottom/);
    expect(css).toMatch(/bottom:\s*calc\(var\(--app-bottom-inset, 100px\)/);
  });
});
