/**
 * Kotlin → TS map
 * ──────────────
 * Tests for `src/core/glass/chasingDots.ts` and `src/core/glass/glassKit.ts` —
 * the ports of `ui/components/ChasingDotsTransition.kt` +
 * `ui/components/ChasingDots.kt` and `ui/glasskit/GlassKit.kt`.
 *
 * Nothing skipped — every assertion targets a ported Kotlin expression.
 */
import { describe, expect, it } from 'vitest';

import {
  EASE_IN_OUT,
  FAST_OUT_SLOW_IN,
  LINEAR,
  chasingAngleKeyframes,
  chasingDotsAt,
  chasingDotsStylesheet,
  chasingRadiusKeyframes,
  fractionTransitionCss,
} from '../../src/core/glass/chasingDots';
import {
  GLASSKIT_FALLBACK_SHADOW,
  GLASSKIT_PRESS_BEZIER,
  GLASSKIT_PRESS_MIN_SCALE,
  GLASSKIT_PRESS_MS,
  GlassTokens,
  glassKitTint,
  pageOverlayColor,
  pressHighlightCss,
  squirclePath,
  squircleRadiusFor,
} from '../../src/core/glass/glassKit';

describe('fractionTransitionCss (ChasingDotsTransition.kt lines 19-51)', () => {
  it('fraction = 1 emits only the 0 and duration stops', () => {
    const { stops } = fractionTransitionCss({ initialValue: 0, targetValue: 7, durationMillis: 1000 });
    expect(stops).toBe('0.0000% { 0.000000 } 100.0000% { 7.000000 }');
  });

  it('fraction = 2 puts target/2 at the halfway stop', () => {
    const { stops } = fractionTransitionCss({
      initialValue: 0,
      targetValue: 8,
      fraction: 2,
      durationMillis: 1000,
    });
    expect(stops).toBe(
      '0.0000% { 0.000000 } 50.0000% { 4.000000 } 100.0000% { 8.000000 }',
    );
  });

  it('fraction = 3 splits the target in thirds', () => {
    const { stops } = fractionTransitionCss({
      initialValue: 0,
      targetValue: 9,
      fraction: 3,
      durationMillis: 3000,
    });
    expect(stops).toBe(
      '0.0000% { 0.000000 } 33.3333% { 3.000000 } 66.6667% { 6.000000 } 100.0000% { 9.000000 }',
    );
  });

  it('fraction = 4 splits the target in quarters (the chasing-dots orbit)', () => {
    const { stops } = fractionTransitionCss({
      initialValue: 0,
      targetValue: 7,
      fraction: 4,
      durationMillis: 1000,
    });
    expect(stops).toBe(
      '0.0000% { 0.000000 } 25.0000% { 1.750000 } 50.0000% { 3.500000 } 75.0000% { 5.250000 } 100.0000% { 7.000000 }',
    );
  });

  it('StartOffset shifts the stop positions forward and delays the start', () => {
    const { stops, animation } = fractionTransitionCss({
      initialValue: 0,
      targetValue: 1,
      durationMillis: 1000,
      offsetMillis: 250,
    });
    expect(stops.startsWith('25.0000% {')).toBe(true);
    // Compose StartOffset advances the clock, so the CSS delay is negative.
    expect(animation).toContain('-250ms');
  });

  it('the animation shorthand repeats forever with the default ease', () => {
    const { animation } = fractionTransitionCss({ initialValue: 0, targetValue: 1, durationMillis: 800 });
    expect(animation).toBe(`800ms restart infinite ${FAST_OUT_SLOW_IN} 0ms`);
  });

  it('respects an explicit easing and the Reverse repeat mode', () => {
    const { animation } = fractionTransitionCss({
      initialValue: 0,
      targetValue: 1,
      durationMillis: 2000,
      repeatMode: 'reverse',
      easing: EASE_IN_OUT,
    });
    expect(animation).toBe(`2000ms reverse infinite ${EASE_IN_OUT} 0ms`);
  });
});

describe('chasingDotsAt (ChasingDots.kt lines 105-168)', () => {
  const angles: readonly [number, number, number, number, number, number] = [0, 1, 2, 3, 4, 5];
  const radii: readonly [number, number, number, number] = [1, 0.9, 0.7, 0.5];

  it('produces exactly six dots', () => {
    expect(chasingDotsAt({ color: '#fff' }, angles, radii)).toHaveLength(6);
  });

  it('dot 0 at multiplier 0 sits on the +y axis: centre offset by pathRadius', () => {
    // cx = −r·sin(0) + w/2 = 20 ; cy = r·cos(0) + h/2 = 20 + 20 = 40
    const dot = chasingDotsAt({ color: '#fff', size: 40 }, angles, radii)[0];
    expect(dot?.cx).toBeCloseTo(20, 6);
    expect(dot?.cy).toBeCloseTo(40, 6);
  });

  it('the first two dots use the fixed circleRatio radius', () => {
    const dots = chasingDotsAt({ color: '#fff', size: 40, circleRatio: 0.25 }, angles, radii);
    expect(dots[0]?.r).toBeCloseTo(2, 6); // size/5 * 0.25
    expect(dots[1]?.r).toBeCloseTo(2, 6);
  });

  it('dots 3..6 use their own radius multiplier', () => {
    const dots = chasingDotsAt({ color: '#fff', size: 40 }, angles, radii);
    expect(dots[2]?.r).toBeCloseTo(8 * 1, 6);
    expect(dots[3]?.r).toBeCloseTo(8 * 0.9, 6);
    expect(dots[4]?.r).toBeCloseTo(8 * 0.7, 6);
    expect(dots[5]?.r).toBeCloseTo(8 * 0.5, 6);
  });

  it('only dots 3..6 carry a radius animation, named after the Kotlin drivers', () => {
    const dots = chasingDotsAt({ color: '#fff' }, angles, radii);
    expect(dots[0]?.radiusAnimation).toBeUndefined();
    expect(dots[1]?.radiusAnimation).toBeUndefined();
    expect(dots[2]?.radiusAnimation).toContain('cd-radius-3');
    expect(dots[5]?.radiusAnimation).toContain('cd-radius-6');
  });

  it('each dot is phase-shifted by delayBetweenDotsMillis', () => {
    const dots = chasingDotsAt({ color: '#fff', durationMillis: 2000, delayBetweenDotsMillis: 50 }, angles, radii);
    expect(dots[0]?.animation).toBe(`cd-angle 8000ms ${EASE_IN_OUT} infinite 0ms`);
    expect(dots[1]?.animation).toBe(`cd-angle 8000ms ${EASE_IN_OUT} infinite -50ms`);
    expect(dots[5]?.animation).toBe(`cd-angle 8000ms ${EASE_IN_OUT} infinite -250ms`);
  });

  it('the radius animation is linear + alternate at half the orbit duration', () => {
    const dots = chasingDotsAt({ color: '#fff', durationMillis: 2000 }, angles, radii);
    expect(dots[2]?.radiusAnimation).toBe(`cd-radius-3 1000ms ${LINEAR} infinite alternate`);
  });
});

describe('chasingDots keyframes (ChasingDots.kt lines 30-104)', () => {
  it('the orbit rule has five stops from multiplier 0 to 7, looping back to the start', () => {
    const css = chasingAngleKeyframes(8000, 40);
    expect(css.startsWith('@keyframes cd-angle {')).toBe(true);
    expect(css.endsWith('}')).toBe(true);
    expect(css.match(/%\{/g)).toHaveLength(5);
    // multiplier 0 → cy = r·cos0 + h/2 = 20 + 20 = 40 (bottom of the SVG box)
    expect(css).toContain('0.0000%{cx:20.000px;cy:40.000px}');
    // multiplier 7 → a whole turn, back to the start
    expect(css).toContain('100.0000%{cx:20.000px;cy:40.000px}');
    // the quarter stops land on the horizontal extremes
    expect(css).toContain('25.0000%{cx:40.000px;cy:20.000px}');
    expect(css).toContain('50.0000%{cx:20.000px;cy:0.000px}');
    expect(css).toContain('75.0000%{cx:0.000px;cy:20.000px}');
  });

  it('the orbit is deterministic for a given box size', () => {
    expect(chasingAngleKeyframes(8000, 40)).toBe(chasingAngleKeyframes(8000, 40));
  });

  it('each radius rule uses the Kotlin initial multipliers 0.512/0.64/0.8/1 for dots 3..6', () => {
    // radius = size / 5 = 8
    expect(chasingRadiusKeyframes(3, 0.25, 1000, 40)).toBe('@keyframes cd-radius-3 { 0%{r:4.0960px}100%{r:2.0000px}}');
    expect(chasingRadiusKeyframes(4, 0.25, 1000, 40)).toBe('@keyframes cd-radius-4 { 0%{r:5.1200px}100%{r:2.0000px}}');
    expect(chasingRadiusKeyframes(5, 0.25, 1000, 40)).toBe('@keyframes cd-radius-5 { 0%{r:6.4000px}100%{r:2.0000px}}');
    expect(chasingRadiusKeyframes(6, 0.25, 1000, 40)).toBe('@keyframes cd-radius-6 { 0%{r:8.0000px}100%{r:2.0000px}}');
  });

  it('the combined stylesheet is one orbit rule plus four radius rules', () => {
    const sheet = chasingDotsStylesheet({ color: '#fff', size: 40, durationMillis: 2000 });
    const rules = sheet.split('\n');
    expect(rules).toHaveLength(5);
    expect(rules[0]).toContain('cd-angle');
    expect(rules[1]).toContain('cd-radius-3');
    expect(rules[4]).toContain('cd-radius-6');
  });
});

describe('GlassKit.kt tokens', () => {
  it('are preserved verbatim', () => {
    expect(GlassTokens.Radius).toBe(24);
    expect(GlassTokens.InnerRadius).toBe(12);
    expect(GlassTokens.IconRadius).toBe(10);
    expect(GlassTokens.Blur).toBe(16);
    expect(GlassTokens.BlurLightweight).toBe(8);
    expect(GlassTokens.LensHeight).toBe(14);
    expect(GlassTokens.LensAmount).toBe(22);
    expect(GlassTokens.TintLight).toBe(0.22);
    expect(GlassTokens.TintDark).toBe(0.78);
    expect(GlassTokens.TintReduce).toBe(0.92);
    expect(GlassTokens.PageOverlayLight).toBe(0.16);
    expect(GlassTokens.PageOverlayDark).toBe(0.4);
    expect(GlassTokens.TopGradientAlpha).toBe(0.75);
    expect(GlassTokens.RowMinHeight).toBe(60);
    expect(GlassTokens.ScreenPadding).toBe(16);
    expect(GlassTokens.CardGap).toBe(12);
    expect(GlassTokens.ChipHeight).toBe(26);
    expect(GlassTokens.PillRadius).toBe(20);
    expect(GlassTokens.TopBarHeight).toBe(64);
    expect(GlassTokens.TopBarBlur).toBe(8);
    expect(GlassTokens.Hairline).toBe(0.5);
  });
});

describe('squirclePath (GlassKit.kt lines 184-203)', () => {
  it('degrades to a plain rectangle for a zero radius', () => {
    expect(squirclePath(100, 50, 0)).toBe('M0,0 H100 V50 H0 Z');
  });

  it('emits four cubic corner segments with the 0.72 control-point ratio', () => {
    // k = 24 · 0.72 = 17.28
    const d = squirclePath(100, 60, 24);
    // Move to (r,0), line to (w-r,0), then the four corners.
    expect(d.startsWith('M24,0 L76,0 C')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(4);
    // Every coordinate is a finite number inside the box.
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    for (const n of nums) {
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(101);
    }
    // The first corner's two control points are (w-r+k, 0) and (w, r-k).
    const firstCubic = /C([^,]+),0 ([^,]+),([^ ]+) 100,24/.exec(d);
    expect(firstCubic).not.toBeNull();
    expect(Number(firstCubic?.[1])).toBeCloseTo(100 - 24 + 17.28, 6);
    expect(Number(firstCubic?.[2])).toBeCloseTo(100, 6);
    expect(Number(firstCubic?.[3])).toBeCloseTo(24 - 17.28, 6);
    // The path is symmetric under a 180° turn about the box centre.
    const mirrored = squirclePath(100, 60, 24);
    expect(mirrored).toBe(squirclePath(100, 60, 24));
  });

  it('is deterministic', () => {
    expect(squirclePath(320, 480, 24)).toBe(squirclePath(320, 480, 24));
  });
});

describe('squircleRadiusFor (GlassKit.kt line 168)', () => {
  it('clamps the radius to half the shorter side', () => {
    expect(squircleRadiusFor(200, 80, 24)).toBe(24);
    expect(squircleRadiusFor(200, 80, 90)).toBe(40);
    expect(squircleRadiusFor(200, 80, -5)).toBe(0);
  });
});

describe('glassKitTint (GlassKit.kt lines 339-363)', () => {
  it('light: white 22% tint + white 0.78 solid fallback', () => {
    expect(glassKitTint({ dark: false, surface: '#FFFFFF', reduceTransparency: false })).toEqual({
      tint: 'rgba(255, 255, 255, 0.22)',
      solidTint: 'rgba(255, 255, 255, 0.78)',
    });
  });

  it('dark: surface at 0.78 tint + surface at 0.85 solid fallback', () => {
    expect(glassKitTint({ dark: true, surface: '#1C1C1E', reduceTransparency: false })).toEqual({
      tint: 'rgba(28, 28, 30, 0.78)',
      solidTint: 'rgba(28, 28, 30, 0.85)',
    });
  });

  it('reduce-transparency wins over the themed tint', () => {
    expect(
      glassKitTint({ dark: false, surface: '#1C1C1E', reduceTransparency: true }).tint,
    ).toBe('rgba(255, 255, 255, 0.92)');
    expect(
      glassKitTint({ dark: true, surface: '#1C1C1E', reduceTransparency: true }).tint,
    ).toBe('rgba(28, 28, 30, 0.92)');
  });

  it('a malformed surface colour degrades to white rather than throwing', () => {
    expect(glassKitTint({ dark: true, surface: 'nope', reduceTransparency: false }).tint).toBe(
      'rgba(255, 255, 255, 0.78)',
    );
  });
});

describe('GlassKit.kt overlay + press tokens', () => {
  it('pageOverlayColor picks the light/dark global scrim', () => {
    expect(pageOverlayColor(false)).toBe('rgba(255, 255, 255, 0.16)');
    expect(pageOverlayColor(true)).toBe('rgba(0, 0, 0, 0.4)');
  });

  it('the fallback shadow is the elevation-2dp pair', () => {
    expect(GLASSKIT_FALLBACK_SHADOW).toBe(
      '0 2px 6px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.12)',
    );
  });

  it('press scale 0.98 ↔ 1.0 on spring(0.6, 400)', () => {
    expect(GLASSKIT_PRESS_MIN_SCALE).toBe(0.98);
    expect(GLASSKIT_PRESS_BEZIER).toBe('cubic-bezier(0.2, 1.4, 0.4, 1)');
    expect(GLASSKIT_PRESS_MS).toBe(Math.round((4.605 / (0.6 * Math.sqrt(400))) * 1000));
  });

  it('pressHighlightCss puts a 0.55×min-dimension radial at the finger', () => {
    expect(pressHighlightCss(10, 20, 100)).toBe(
      'background-image:radial-gradient(circle 55.0px at 10.0px 20.0px,rgba(255,255,255,0.20) 0%,rgba(255,255,255,0) 100%);mix-blend-mode:screen;',
    );
  });
});