/**
 * Kotlin → TS map
 * ──────────────
 * Tests for `src/core/glass/cardTweaks.ts`, `renderQuality.ts`, `adaptiveSpec.ts`
 * and `motion.ts` — the four token/derivation modules ported from
 * `ui/components/CardTweaks.kt`, `ui/components/GlassQuality.kt`,
 * `ui/adaptive/AdaptiveSpec.kt` + `ui/design/DesignTokens.kt`, and
 * `ui/feedback/Motion.kt`.
 *
 * Nothing skipped — every assertion targets a ported Kotlin expression.
 */
import { describe, expect, it } from 'vitest';

import {
  AdaptiveSpec,
  DESIGN_SPEC,
  adaptiveDialogWidthStyle,
  adaptivePageWidthStyle,
  adaptiveSheetWidthStyle,
  adaptiveWidthCss,
  resolveAdaptiveSizing,
  shapeRadius,
  windowWidthClass,
} from '../../src/core/glass/adaptiveSpec';
import {
  DEFAULT_CARD_TWEAKS,
  cardCameraDistance,
  glassThicknessGains,
  rescaleCornerRadius,
} from '../../src/core/glass/cardTweaks';
import {
  AppMotion,
  HAPTIC_TABLE,
  HapticsGate,
  REDUCED_MOTION_SCALE_EPSILON,
  springSettleMs,
} from '../../src/core/glass/motion';
import {
  RENDER_QUALITY_LIST,
  RenderQuality,
  isLow,
  isMax,
  realtimeGlass,
  renderQualityOf,
} from '../../src/core/glass/renderQuality';

describe('CardTweaks.kt', () => {
  it('v2 factory defaults are preserved verbatim', () => {
    expect(DEFAULT_CARD_TWEAKS).toEqual({
      blurRadiusDp: 22,
      cornerRadiusDp: 16,
      tiltMaxDeg: 6,
      cameraDistMult: 5,
      rippleAlpha: 0.42,
      tintMix: 0.08,
      pressStrength: 1.25,
      pressRadius: 1.1,
      cardAlpha: 1,
    });
  });
});

describe('rescaleCornerRadius (GlassCard.kt lines 202-214)', () => {
  it('a null explicit radius yields the global cornerRadiusDp unchanged', () => {
    expect(rescaleCornerRadius(null, 24)).toBe(24);
  });

  it('the 16dp anchor is a no-op — the default global radius must not move explicit radii', () => {
    expect(rescaleCornerRadius(20, 16)).toBe(20);
  });

  it('scales proportionally about the 16dp anchor', () => {
    expect(rescaleCornerRadius(20, 32)).toBe(40);
    expect(rescaleCornerRadius(20, 8)).toBe(10);
  });
});

describe('glassThicknessGains (GlassCard.kt lines 816-818)', () => {
  it('the 22dp factory value is the neutral zero point', () => {
    expect(glassThicknessGains(22)).toEqual([0, 1, 1]);
  });

  it('thicker glass dims the light beam and the bevel', () => {
    const [thick, beam, bevel] = glassThicknessGains(40);
    expect(thick).toBeCloseTo(1, 6);
    expect(beam).toBeLessThan(1);
    expect(bevel).toBeLessThan(1);
  });

  it('thinner glass brightens them', () => {
    const [thick, beam, bevel] = glassThicknessGains(4);
    expect(thick).toBeCloseTo(-1, 6);
    expect(beam).toBeGreaterThan(1);
    expect(bevel).toBeGreaterThan(1);
  });

  it('clamps the gains to the documented [0.42,1.3] / [0.48,1.26] bands', () => {
    const [thick, beam, bevel] = glassThicknessGains(-999);
    expect(thick).toBe(-1);
    expect(beam).toBeCloseTo(1.3, 6);
    expect(bevel).toBeCloseTo(1.26, 6);
    const [thick2, beam2, bevel2] = glassThicknessGains(999);
    expect(thick2).toBe(1);
    expect(beam2).toBeCloseTo(0.48, 6);
    expect(bevel2).toBeCloseTo(0.55, 6);
  });
});

describe('cardCameraDistance (GlassCard.kt lines 436-437)', () => {
  it('cameraDistMult = 3 maps to the 0.42x floor', () => {
    expect(cardCameraDistance(1000, 3)).toBeCloseTo(420, 6);
    expect(cardCameraDistance(1000, -5)).toBeCloseTo(420, 6);
  });

  it('cameraDistMult = 12 maps to the 0.42 + 3.8 ceiling', () => {
    expect(cardCameraDistance(1000, 12)).toBeCloseTo(4220, 6);
    expect(cardCameraDistance(1000, 99)).toBeCloseTo(4220, 6);
  });

  it('is linear in between and scales with the short side', () => {
    // (7.5 - 3) / 9 = 0.5 → 0.42 + 3.8·0.5 = 2.32
    expect(cardCameraDistance(1000, 7.5)).toBeCloseTo(2320, 6);
    expect(cardCameraDistance(2000, 7.5)).toBeCloseTo(4640, 6);
  });
});

describe('GlassQuality.kt', () => {
  it('enum ids and labels are preserved', () => {
    expect(RenderQuality.LOW).toEqual({ id: 0, label: '流畅', realtimeGlass: false });
    expect(RenderQuality.MID).toEqual({ id: 1, label: '均衡', realtimeGlass: false });
    expect(RenderQuality.HIGH).toEqual({ id: 2, label: '高', realtimeGlass: true });
    expect(RenderQuality.MAX).toEqual({ id: 3, label: '极致', realtimeGlass: true });
  });

  it('entries order is LOW → MAX', () => {
    expect(RENDER_QUALITY_LIST).toEqual(['LOW', 'MID', 'HIGH', 'MAX']);
  });

  it('of(id) resolves every valid id, and falls back to HIGH otherwise', () => {
    expect(RENDER_QUALITY_LIST.map((n) => renderQualityOf(RenderQuality[n].id))).toEqual([
      'LOW',
      'MID',
      'HIGH',
      'MAX',
    ]);
    expect(renderQualityOf(99)).toBe('HIGH');
    expect(renderQualityOf(-1)).toBe('HIGH');
  });

  it('realtimeGlass is id >= HIGH.id', () => {
    expect(realtimeGlass('LOW')).toBe(false);
    expect(realtimeGlass('MID')).toBe(false);
    expect(realtimeGlass('HIGH')).toBe(true);
    expect(realtimeGlass('MAX')).toBe(true);
  });

  it('isMax / isLow', () => {
    expect(isMax('MAX')).toBe(true);
    expect(isMax('HIGH')).toBe(false);
    expect(isLow('LOW')).toBe(true);
    expect(isLow('MID')).toBe(false);
  });
});

describe('DesignTokens.kt', () => {
  it('radius / space / elevation tables are verbatim', () => {
    expect(DESIGN_SPEC.radius).toEqual({ xs: 8, sm: 12, md: 16, lg: 20, xl: 24 });
    expect(DESIGN_SPEC.space).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, page: 16 });
    expect(DESIGN_SPEC.cardElevation).toBe(2);
    expect(DESIGN_SPEC.floatingElevation).toBe(8);
  });

  it('fun shape(radius) → a CSS length', () => {
    expect(shapeRadius(24)).toBe('24px');
  });
});

describe('AdaptiveSpec.kt', () => {
  it('M3 breakpoints: <600 COMPACT / 600-839 MEDIUM / >=840 EXPANDED', () => {
    expect(windowWidthClass(0)).toBe('COMPACT');
    expect(windowWidthClass(599)).toBe('COMPACT');
    expect(windowWidthClass(600)).toBe('MEDIUM');
    expect(windowWidthClass(839)).toBe('MEDIUM');
    expect(windowWidthClass(840)).toBe('EXPANDED');
    expect(windowWidthClass(2000)).toBe('EXPANDED');
  });

  it('the four canonical max widths are preserved', () => {
    expect(AdaptiveSpec.dialogMaxWidth).toBe(560);
    expect(AdaptiveSpec.sheetMaxWidth).toBe(560);
    expect(AdaptiveSpec.sheetMaxWidthLandscape).toBe(840);
    expect(AdaptiveSpec.pageContentMaxWidth).toBe(720);
  });

  it('resolveAdaptiveSizing widens the sheet only in landscape', () => {
    expect(resolveAdaptiveSizing(400, 800)).toEqual({
      dialogMaxWidth: 560,
      sheetMaxWidth: 560,
      sheetMaxWidthLandscape: 560,
      pageContentMaxWidth: 720,
    });
    expect(resolveAdaptiveSizing(900, 500).sheetMaxWidthLandscape).toBe(840);
  });

  it('adaptiveDialogWidthStyle keeps the phone fraction but clamps the max', () => {
    expect(adaptiveDialogWidthStyle()).toEqual({
      width: '86.00%',
      maxWidth: '560px',
      marginInline: 'auto',
    });
    expect(adaptiveDialogWidthStyle(0.92).width).toBe('92.00%');
  });

  it('adaptiveSheetWidthStyle switches on landscape', () => {
    expect(adaptiveSheetWidthStyle(false).maxWidth).toBe('560px');
    expect(adaptiveSheetWidthStyle(true).maxWidth).toBe('840px');
    expect(adaptiveSheetWidthStyle().width).toBe('100%');
  });

  it('adaptivePageWidthStyle clamps content pages to 720px', () => {
    expect(adaptivePageWidthStyle()).toEqual({
      maxWidth: '720px',
      width: '100%',
      marginInline: 'auto',
    });
  });

  it('adaptiveWidthCss reproduces the sw600dp / sw840dp res/dimen breakpoints', () => {
    const css = adaptiveWidthCss();
    expect(css).toContain('@media (min-width:600px)');
    expect(css).toContain('@media (min-width:840px)');
    expect(css).toContain('@media (min-width:840px) and (orientation:landscape)');
    expect(css).toContain('max-width:720px');
    expect(css).toContain('max-width:840px');
  });
});

describe('Motion.kt', () => {
  it('springSettleMs solves 4.605 / (ζ·√k)', () => {
    expect(springSettleMs(1, 1500)).toBe(Math.round((4.605 / Math.sqrt(1500)) * 1000));
    expect(springSettleMs(0.635, 300)).toBe(AppMotion.springDefault.settleMs);
  });

  it('stiffer / better-damped springs settle faster', () => {
    expect(springSettleMs(1, 1500)).toBeLessThan(springSettleMs(0.4, 340));
    expect(springSettleMs(0.4, 340)).toBeLessThan(springSettleMs(0.4, 200));
  });

  it('every spring token carries a matching settleMs and a bezier', () => {
    const springs = [
      AppMotion.springDefault,
      AppMotion.springLift,
      AppMotion.springJelly,
      AppMotion.springReturn,
      AppMotion.springSettle,
      AppMotion.springTilt,
      AppMotion.springStiff,
    ];
    for (const s of springs) {
      expect(s.settleMs).toBe(springSettleMs(s.dampingRatio, s.stiffness));
      expect(s.bezier).toMatch(/^cubic-bezier\(/);
      expect(s.settleMs).toBeGreaterThan(0);
    }
  });

  it('the duration constants are preserved verbatim', () => {
    expect(AppMotion.TRANSITION_MS).toBe(220);
    expect(AppMotion.HEART_MS).toBe(350);
    expect(AppMotion.HEART_BURST_MS).toBe(1150);
    expect(AppMotion.PARTICLE_MS).toBe(600);
    expect(AppMotion.LIFT_MS).toBe(260);
    expect(AppMotion.RETURN_MS).toBe(560);
    expect(AppMotion.DROP_MS).toBe(380);
    expect(AppMotion.SELECTED_SCALE).toBe(0.94);
    expect(AppMotion.LONG_PRESS_MS).toBe(350);
    expect(AppMotion.PICK_UP_MS).toBe(250);
    expect(AppMotion.SPRING_LOAD_MS).toBe(600);
  });

  it('the haptics table is verbatim', () => {
    expect(HAPTIC_TABLE).toEqual({
      SELECTION: { millis: 8, amplitude: 48 },
      LIGHT: { millis: 12, amplitude: 110 },
      MEDIUM: { millis: 18, amplitude: 160 },
      HEAVY: { millis: 26, amplitude: 220 },
      SUCCESS: { millis: 16, amplitude: 190 },
    });
  });

  it('HapticsGate is the non-composable process-level switch (default on)', () => {
    expect(HapticsGate.enabled).toBe(true);
  });

  it('REDUCED_MOTION_SCALE_EPSILON matches Motion.kt line 216', () => {
    expect(REDUCED_MOTION_SCALE_EPSILON).toBe(0.01);
  });
});