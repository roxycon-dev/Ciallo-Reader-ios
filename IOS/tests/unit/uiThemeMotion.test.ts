/**
 * `ui/theme/IosMotion.kt` (80 lines, 69 non-blank) → `src/core/ui-theme/iosMotion.ts`,
 * plus the `Modifier` press-feedback specs from `ui/theme/ModifierExtensions.kt`
 * (152 lines, 139 non-blank) → `src/core/ui-theme/modifierExtensions.ts`.
 *
 * Focus: duration constants, cubic-bezier control points, spring → CSS timing, and the
 * per-frame values each `Modifier` helper animates toward.
 */

import { describe, expect, it } from 'vitest';

import {
  IOS_EASINGS,
  IOS_EASING_CSS,
  IOS_MOTION,
  SPRING,
  SPRING_SNAPPY,
  SPRING_SOFT,
  easeInOut,
  easeOut,
  easeOutQuart,
  easingCss,
  spring,
  springSettleMs,
  springSnappy,
  springSoft,
} from '../../src/core/ui-theme/iosMotion';
import {
  ALPHA_DEFAULT_MS,
  ALPHA_EASING,
  ALPHA_EASING_CSS,
  DIM_DOWN_MS,
  DIM_UP_MS,
  HAPTIC_TYPE_TEXT_HANDLE_MOVE,
  PRESS_DOWN_MS,
  PRESS_UP_MS,
  PRESSED_DIM_ALPHA,
  PRESSED_SCALE,
  RESTING_DIM_ALPHA,
  RESTING_SCALE,
  ROW_DOWN_MS,
  ROW_HIGHLIGHT_ALPHA,
  ROW_HIGHLIGHT_GRAY,
  ROW_HIGHLIGHT_OFF,
  ROW_HIGHLIGHT_ON,
  ROW_UP_MS,
  alphaTransition,
  onPressEdge,
  pressFeedback,
  rowPressFeedback,
} from '../../src/core/ui-theme/modifierExtensions';
import type { HapticFeedbackType } from '../../src/core/ui-theme/modifierExtensions';

// ── IosMotion.kt L25-L31 — durations ─────────────────────────────────────────

describe('IosMotion.kt — duration constants', () => {
  it('matches the Kotlin values', () => {
    expect(IOS_MOTION.FAST).toBe(150);
    expect(IOS_MOTION.NORMAL).toBe(250);
    expect(IOS_MOTION.TRANSITION).toBe(350);
    expect(IOS_MOTION.SHEET).toBe(400);
  });

  it('agrees with src/ui/theme/tokens.ts MOTION on all four', async () => {
    const { MOTION } = await import('../../src/ui/theme/tokens');
    expect(MOTION.fast).toBe(IOS_MOTION.FAST);
    expect(MOTION.normal).toBe(IOS_MOTION.NORMAL);
    expect(MOTION.transition).toBe(IOS_MOTION.TRANSITION);
    expect(MOTION.sheet).toBe(IOS_MOTION.SHEET);
  });

  it('reports MOTION.headerCollapse = 220 as having no IosMotion.kt source', async () => {
    const { MOTION } = await import('../../src/ui/theme/tokens');
    // The only 220 in IosMotion.kt-adjacent code is Modifier.animateAlpha's default.
    expect(MOTION.headerCollapse).toBe(220);
    expect(ALPHA_DEFAULT_MS).toBe(220);
  });
});

// ── IosMotion.kt L35-L39 — easings ───────────────────────────────────────────

describe('IosMotion.kt — cubic-bezier control points', () => {
  it('keeps the four Kotlin numbers per curve', () => {
    expect(IOS_EASINGS.EaseOut).toEqual({ x1: 0, y1: 0, x2: 0.58, y2: 1 }); // L35
    expect(IOS_EASINGS.EaseInOut).toEqual({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 }); // L37
    expect(IOS_EASINGS.EaseOutQuart).toEqual({ x1: 0.25, y1: 1, x2: 0.5, y2: 1 }); // L39
  });

  it('renders the literal CSS strings', () => {
    expect(IOS_EASING_CSS.easeOut).toBe('cubic-bezier(0, 0, 0.58, 1)');
    expect(IOS_EASING_CSS.easeInOut).toBe('cubic-bezier(0.42, 0, 0.58, 1)');
    expect(IOS_EASING_CSS.easeOutQuart).toBe('cubic-bezier(0.25, 1, 0.5, 1)');
    expect(easingCss(IOS_EASINGS.EaseOutQuart)).toBe(IOS_EASING_CSS.easeOutQuart);
  });

  it('matches tokens.ts and theme.css on the same bezier (modulo their spacing difference)', async () => {
    // tokens.ts L112-114 writes `cubic-bezier(0,0,0.58,1)` with NO spaces; theme.css L74-75
    // writes `cubic-bezier(0, 0, 0.58, 1)` WITH spaces. Same curve, different spelling —
    // reported to the main agent as a cosmetic divergence.
    const squeeze = (value: string): string => value.replace(/,\s*/g, ',');
    const { MOTION } = await import('../../src/ui/theme/tokens');
    expect(squeeze(MOTION.easeOut)).toBe(squeeze(IOS_EASING_CSS.easeOut));
    expect(squeeze(MOTION.easeInOut)).toBe(squeeze(IOS_EASING_CSS.easeInOut));
    expect(squeeze(MOTION.easeOutQuart)).toBe(squeeze(IOS_EASING_CSS.easeOutQuart));
    expect(MOTION.easeOut).not.toBe(IOS_EASING_CSS.easeOut); // literally different strings

    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8');
    expect(css).toContain(`--ease-out: ${IOS_EASING_CSS.easeOut};`);
    expect(css).toContain(`--ease-out-quart: ${IOS_EASING_CSS.easeOutQuart};`);
    // Declared gaps in theme.css, reported to the main agent:
    expect(css).not.toContain('--ease-in-out');
    expect(css).not.toContain('--motion-sheet');
  });
});

// ── IosMotion.kt L45-L66 — springs ───────────────────────────────────────────

describe('IosMotion.kt — springs', () => {
  it('keeps the verbatim Kotlin dampingRatio / stiffness pairs', () => {
    expect(SPRING.dampingRatio).toBe(0.85); // L46
    expect(SPRING.stiffness).toBe(320); // L47
    expect(SPRING_SNAPPY.dampingRatio).toBe(0.78); // L55
    expect(SPRING_SNAPPY.stiffness).toBe(520); // L56
    expect(SPRING_SOFT.dampingRatio).toBe(0.9); // L64
    expect(SPRING_SOFT.stiffness).toBe(220); // L65
  });

  it('is total and monotonically ordered: snappiest settles fastest', () => {
    // springSnappy 259ms < spring 303ms < springSoft 345ms
    expect(SPRING_SNAPPY.settleMs).toBeLessThan(SPRING.settleMs);
    expect(SPRING.settleMs).toBeLessThan(SPRING_SOFT.settleMs);
  });

  it('settleMs follows t ≈ 4.605 / (ζ·√k)', () => {
    expect(springSettleMs(0.85, 320)).toBe(303);
    expect(springSettleMs(0.78, 520)).toBe(259);
    expect(springSettleMs(0.9, 220)).toBe(345);
  });

  it('the three accessors return the hoisted constants', () => {
    expect(spring()).toBe(SPRING);
    expect(springSnappy()).toBe(SPRING_SNAPPY);
    expect(springSoft()).toBe(SPRING_SOFT);
  });

  it('builds a paste-able CSS timing string', () => {
    expect(SPRING.css).toBe('303ms cubic-bezier(0.25, 1, 0.5, 1)');
    expect(SPRING_SNAPPY.css).toBe('259ms cubic-bezier(0.16, 1, 0.3, 1)');
    expect(SPRING_SOFT.css).toBe('345ms cubic-bezier(0.32, 0.72, 0, 1)');
  });

  it('reuses the bezier fits already documented in src/core/glass/motion.ts', async () => {
    const glass = await import('../../src/core/glass/motion');
    // glass/motion.ts L258-259 documents these two mappings.
    expect(SPRING.bezier).toBe('cubic-bezier(0.25, 1, 0.5, 1)');
    expect(SPRING_SOFT.bezier).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
    expect(glass.springSettleMs(0.85, 320)).toBe(SPRING.settleMs);
    expect(glass.springSettleMs(0.78, 520)).toBe(SPRING_SNAPPY.settleMs);
  });

  it('DESIGN_TOKENS only carries spring(); snappy and soft are absent everywhere', async () => {
    const { DESIGN_TOKENS } = await import('../../src/ui/tokens');
    expect(DESIGN_TOKENS.motion.spring.damping).toBe(SPRING.dampingRatio);
    expect(DESIGN_TOKENS.motion.spring.stiffness).toBe(SPRING.stiffness);
    const { MOTION } = await import('../../src/ui/theme/tokens');
    expect(Object.keys(MOTION)).not.toContain('spring');
    expect(Object.keys(MOTION)).not.toContain('springSnappy');
    expect(Object.keys(MOTION)).not.toContain('springSoft');
  });
});

// ── IosMotion.kt L69-L78 — tweens ────────────────────────────────────────────

describe('IosMotion.kt — tween helpers', () => {
  it('defaults to NORMAL = 250 for easeOut / easeInOut', () => {
    expect(easeOut()).toEqual({ durationMillis: 250, easing: IOS_EASINGS.EaseOut, css: '250ms cubic-bezier(0, 0, 0.58, 1)' });
    expect(easeInOut()).toEqual({ durationMillis: 250, easing: IOS_EASINGS.EaseInOut, css: '250ms cubic-bezier(0.42, 0, 0.58, 1)' });
  });

  it('defaults easeOutQuart to SHEET = 400', () => {
    expect(easeOutQuart()).toEqual({ durationMillis: 400, easing: IOS_EASINGS.EaseOutQuart, css: '400ms cubic-bezier(0.25, 1, 0.5, 1)' });
  });

  it('honours an explicit duration', () => {
    expect(easeOut(220).css).toBe('220ms cubic-bezier(0, 0, 0.58, 1)');
    expect(easeInOut(180).css).toBe('180ms cubic-bezier(0.42, 0, 0.58, 1)');
    expect(easeOutQuart(160).css).toBe('160ms cubic-bezier(0.25, 1, 0.5, 1)');
  });
});

// ── ModifierExtensions.kt L28-L80 — clickableWithFeedback ────────────────────

describe('clickableWithFeedback → pressFeedback()', () => {
  const haptics = (): void => {};
  const onClick = (): void => {};

  it('encodes the 2026-09-21 fix: dim to 0.7, never a white rectangle', () => {
    expect(PRESSED_DIM_ALPHA).toBe(0.7);
    expect(RESTING_DIM_ALPHA).toBe(1);
    const pressed = pressFeedback({ isPressed: true, haptics, onClick });
    expect(pressed.dim).toBe(0.7);
    expect(pressed.style.opacity).toBe(0.7);
    expect(pressed.style.transform).toBe('scale(0.96)');
    expect(pressed.ripple).toBe(false);
  });

  it('keeps the 100 / 150 scale and 100 / 180 dim asymmetry', () => {
    expect([PRESS_DOWN_MS, PRESS_UP_MS]).toEqual([100, 150]);
    expect([DIM_DOWN_MS, DIM_UP_MS]).toEqual([100, 180]);
    const down = pressFeedback({ isPressed: true, haptics, onClick }).style.transition;
    const up = pressFeedback({ isPressed: false, haptics, onClick }).style.transition;
    expect(down).toContain('transform 100ms cubic-bezier(0, 0, 0.58, 1)');
    expect(down).toContain('opacity 100ms cubic-bezier(0, 0, 0.58, 1)');
    expect(up).toContain('transform 150ms cubic-bezier(0, 0, 0.58, 1)');
    expect(up).toContain('opacity 180ms cubic-bezier(0, 0, 0.58, 1)');
  });

  it('resting values are 1.0 scale and 1.0 opacity', () => {
    expect(PRESSED_SCALE).toBe(0.96);
    expect(RESTING_SCALE).toBe(1);
    const resting = pressFeedback({ isPressed: false, haptics, onClick });
    expect(resting.scale).toBe(1);
    expect(resting.dim).toBe(1);
  });

  it('defaults enabled and bounded to true and echoes onClick untouched', () => {
    const spec = pressFeedback({ isPressed: false, haptics, onClick });
    expect(spec.enabled).toBe(true);
    expect(spec.bounded).toBe(true);
    expect(spec.onClick).toBe(onClick);
    expect(spec.label).toBe('click_scale');
    expect(spec.haptic).toBe(HAPTIC_TYPE_TEXT_HANDLE_MOVE);
  });

  it('does not fire the haptic on release, only on the false→true hop', () => {
    const ticks: HapticFeedbackType[] = [];
    const tick = (type: HapticFeedbackType): void => {
      ticks.push(type);
    };
    expect(onPressEdge(false, true, tick)).toBe(true);
    expect(onPressEdge(true, true, tick)).toBe(false); // still held — no repeat
    expect(onPressEdge(true, false, tick)).toBe(false); // released
    expect(onPressEdge(false, false, tick)).toBe(false); // never pressed
    expect(ticks).toEqual(['TextHandleMove']);
  });
});

// ── ModifierExtensions.kt L90-L130 — clickableRowFeedback ────────────────────

describe('clickableRowFeedback → rowPressFeedback()', () => {
  const haptics = (): void => {};
  const onClick = (): void => {};

  it('never changes the row size — only the background', () => {
    const spec = rowPressFeedback({ isPressed: true, haptics, onClick });
    expect(spec).not.toHaveProperty('scale');
    expect(spec).not.toHaveProperty('style');
    expect(spec.backgroundRgba).toBe('rgba(128, 128, 128, 0.16)');
  });

  it('uses Compose Color.Gray (#808080) at 0.16 alpha', () => {
    expect(ROW_HIGHLIGHT_GRAY).toBe('#808080');
    expect(ROW_HIGHLIGHT_ALPHA).toBe(0.16);
    expect([ROW_HIGHLIGHT_ON, ROW_HIGHLIGHT_OFF]).toEqual([1, 0]);
  });

  it('keeps the 80 / 220 ms asymmetry that the KDoc calls the key to the feel', () => {
    expect([ROW_DOWN_MS, ROW_UP_MS]).toEqual([80, 220]);
    expect(rowPressFeedback({ isPressed: true, haptics, onClick }).transition).toBe(
      'background-color 80ms cubic-bezier(0, 0, 0.58, 1)',
    );
    expect(rowPressFeedback({ isPressed: false, haptics, onClick }).transition).toBe(
      'background-color 220ms cubic-bezier(0, 0, 0.58, 1)',
    );
  });

  it('is fully transparent at rest', () => {
    const rest = rowPressFeedback({ isPressed: false, haptics, onClick });
    expect(rest.highlightAlpha).toBe(0);
    expect(rest.backgroundRgba).toBe('rgba(128, 128, 128, 0)');
  });
});

// ── ModifierExtensions.kt L139-L150 — animateAlpha ───────────────────────────

describe('animateAlpha → alphaTransition()', () => {
  it('defaults durationMillis to 220 and label to "animateAlpha"', () => {
    const spec = alphaTransition({ target: 0 });
    expect(spec.durationMillis).toBe(220);
    expect(spec.label).toBe('animateAlpha');
    expect(spec.opacity).toBe(0);
    expect(spec.style.opacity).toBe(0);
  });

  it('uses Compose\'s DEFAULT (linear) easing, deliberately not IosMotion.EaseOut', () => {
    // Kotlin L146 `tween(durationMillis = durationMillis)` — no easing argument.
    expect(ALPHA_EASING).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(ALPHA_EASING_CSS).toBe('cubic-bezier(0, 0, 1, 1)');
    expect(alphaTransition({ target: 1 }).css).toBe('220ms cubic-bezier(0, 0, 1, 1)');
    expect(ALPHA_EASING_CSS).not.toBe(IOS_EASING_CSS.easeOut);
  });

  it('carries an explicit duration and label through', () => {
    const spec = alphaTransition({ target: 0.5, durationMillis: 120, label: 'chromeFade' });
    expect(spec.durationMillis).toBe(120);
    expect(spec.label).toBe('chromeFade');
    expect(spec.transition).toBe('opacity 120ms cubic-bezier(0, 0, 1, 1)');
  });
});
