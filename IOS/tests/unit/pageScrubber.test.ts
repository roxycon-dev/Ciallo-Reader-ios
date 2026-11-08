/**
 * Kotlin → TS map
 * ──────────────
 * Tests for `src/core/pageturn/pageScrubber.ts` — the port of the pure
 * geometry / inertia maths of `ui/pageturn/PageScrubber.kt`
 * (lines 166-202, 249, 269-288, 330-345, 377-385, 404-424).
 *
 * Nothing skipped — every assertion targets a ported Kotlin expression.
 */
import { describe, expect, it } from 'vitest';

import {
  ENTER_SPRING,
  SETTLE_STIFFNESS,
  centerIndexOf,
  rubberBandOffset,
  scrubberGeometry,
  scrubberPageTransform,
  scrubberRenderOrder,
  settleDamping,
  settleTarget,
} from '../../src/core/pageturn/pageScrubber';

const W = 400;
const H = 800;

describe('scrubberGeometry (PageScrubber.kt lines 166-195)', () => {
  it('page scale is fixed at 0.60 (content aspect must match)', () => {
    const g = scrubberGeometry(W, H, 10, 0);
    expect(g.pageScale).toBe(0.6);
    expect(g.pageW).toBe(240);
    expect(g.pageH).toBe(480);
  });

  it('centres the page vertically and horizontally', () => {
    const g = scrubberGeometry(W, H, 10, 0);
    expect(g.topY).toBe((H - g.pageH) / 2);
    expect(g.baseX).toBe((W - g.pageW) / 2);
  });

  it('the slot angle is 30° and the ring radius is 1.24× the screen width', () => {
    const g = scrubberGeometry(W, H, 10, 0);
    expect(g.slotAngle).toBe(30);
    expect(g.kR).toBe(W * 1.24);
    expect(g.stride).toBeCloseTo(g.kR * ((30 * Math.PI) / 180), 9);
  });

  it('offsets are negative strides, maxOff = 0', () => {
    const g = scrubberGeometry(W, H, 5, 0);
    expect(g.maxOff).toBeCloseTo(0, 9);
    expect(g.minOff).toBeCloseTo(-4 * g.stride, 9);
  });

  it('the initial offset follows the initial page', () => {
    const g = scrubberGeometry(W, H, 5, 3);
    expect(g.initialOffset).toBeCloseTo(-3 * g.stride, 9);
  });

  it('clamps an out-of-range initial page instead of throwing', () => {
    expect(scrubberGeometry(W, H, 5, 99).initialOffset).toBeCloseTo(-4 * scrubberGeometry(W, H, 5, 0).stride, 9);
    expect(scrubberGeometry(W, H, 5, -3).initialOffset).toBeCloseTo(0, 9);
  });
});

describe('centerIndexOf (PageScrubber.kt lines 198-202)', () => {
  const stride = 100;
  it('maps an offset to the nearest page and clamps the ends', () => {
    expect(centerIndexOf(0, stride, 5)).toBe(0);
    expect(centerIndexOf(-149, stride, 5)).toBe(1);
    expect(centerIndexOf(-150, stride, 5)).toBe(2);
    expect(centerIndexOf(-10_000, stride, 5)).toBe(4);
    expect(centerIndexOf(10_000, stride, 5)).toBe(0);
  });
});

describe('settleTarget (PageScrubber.kt lines 269-288)', () => {
  const stride = 100;
  it('a forward flick (negative offset velocity) advances pages', () => {
    // 400px/s · 0.7s = 280px → round(2.8) = 3 pages forward.
    expect(settleTarget(-400, 5, stride, 20)).toBe(8);
  });

  it('a backward flick (positive offset velocity) retreats pages', () => {
    expect(settleTarget(400, 5, stride, 20)).toBe(2);
  });

  it('only snaps, never enters: a sub-half-page release stays put', () => {
    // 100px/s · 0.7s = 70px → round(0.7) = 1 page.
    expect(settleTarget(100, 5, stride, 20)).toBe(4);
    // 40px/s · 0.7s = 28px → round(0.28) = 0 pages.
    expect(settleTarget(40, 5, stride, 20)).toBe(5);
  });

  it('a ~6000px/s flick is already past the 12-page cap at the real ring stride', () => {
    // The Kotlin comment claims "用力甩（~6000px/s）→ 6 页"; with kR = 1.24·w and a
    // 30° slot the raw page count is 16, so the documented 12-page cap wins.
    // The port reproduces the *code*, not the rounded comment.
    const real = scrubberGeometry(400, 800, 40, 0).stride;
    expect(settleTarget(-6000, 0, real, 40)).toBe(12);
  });

  it('clamps at 12 pages however violent the flick', () => {
    expect(settleTarget(-100_000, 0, stride, 500)).toBe(12);
    expect(settleTarget(100_000, 20, stride, 500)).toBe(8);
  });

  it('clamps to the valid page range', () => {
    expect(settleTarget(100_000, 3, stride, 20)).toBe(0);
    expect(settleTarget(-100_000, 16, stride, 20)).toBe(19);
  });
});

describe('settleDamping (PageScrubber.kt line 284)', () => {
  it('edge targets get the heavier damping so the arc never overshoots into blank air', () => {
    expect(settleDamping(0, 10)).toBe(0.95);
    expect(settleDamping(9, 10)).toBe(0.95);
    expect(settleDamping(5, 10)).toBe(0.85);
  });
});

describe('scrubberRenderOrder (PageScrubber.kt lines 377-385)', () => {
  it('composes only ±6 pages around the centre', () => {
    const order = scrubberRenderOrder(40, 20, null);
    expect(order).toHaveLength(13);
    expect(Math.min(...order)).toBe(14);
    expect(Math.max(...order)).toBe(26);
  });

  it('paints farthest-first so the centre page lands on top', () => {
    const order = scrubberRenderOrder(9, 4, null);
    expect(order[order.length - 1]).toBe(4);
    expect(Math.abs((order[0] as number) - 4)).toBeGreaterThanOrEqual(
      Math.abs((order[order.length - 1] as number) - 4),
    );
  });

  it('the committed page is forced last so it flies on top', () => {
    const order = scrubberRenderOrder(9, 4, 6);
    expect(order[order.length - 1]).toBe(6);
    expect(order.filter((i) => i === 6)).toHaveLength(1);
  });

  it('a committed page outside the ±6 window is ignored', () => {
    expect(scrubberRenderOrder(40, 20, 0)).toEqual(scrubberRenderOrder(40, 20, null));
  });
});

describe('scrubberPageTransform (PageScrubber.kt lines 404-424, 437-448)', () => {
  const geometry = scrubberGeometry(W, H, 20, 0);

  it('the centred page has rotationY ≈ 0 and no x translation at enter = 1', () => {
    const t = scrubberPageTransform({
      index: 5,
      offset: -5 * geometry.stride,
      enter: 1,
      geometry,
      committed: null,
      specialPage: 5,
      inWindow: true,
    });
    expect(t.d).toBeCloseTo(0, 9);
    expect(t.phi).toBeCloseTo(0, 6);
    expect(t.rotationY).toBeCloseTo(0, 6);
    expect(t.translationX).toBeCloseTo(0, 6);
    expect(t.perspective).toBe(geometry.kR);
  });

  it('rotationY is exactly -phi', () => {
    const t = scrubberPageTransform({
      index: 8,
      offset: -5 * geometry.stride,
      enter: 1,
      geometry,
      committed: null,
      specialPage: 5,
      inWindow: true,
    });
    expect(t.rotationY).toBeCloseTo(-t.phi, 9);
    expect(t.phi).toBeCloseTo(3 * 30, 6);
  });

  it('the centred page gets the 3.5% pop and nothing else', () => {
    const t = scrubberPageTransform({
      index: 5,
      offset: -5 * geometry.stride,
      enter: 1,
      geometry,
      committed: null,
      specialPage: 5,
      inWindow: true,
    });
    expect(t.s).toBe(1);
    expect(t.pop).toBeCloseTo(1.035, 9);
    expect(t.k).toBeCloseTo(1.035, 9);
    expect(t.scaleX).toBe(t.k);
    expect(t.scaleY).toBe(t.k);
  });

  it('the flying special page shrinks toward pageScale as enter goes 1 → 0', () => {
    const at1 = scrubberPageTransform({ index: 5, offset: 0, enter: 1, geometry, committed: 5, specialPage: 5, inWindow: true });
    const at0 = scrubberPageTransform({ index: 5, offset: 0, enter: 0, geometry, committed: 5, specialPage: 5, inWindow: true });
    expect(at1.s).toBe(1);
    expect(at0.s).toBeCloseTo(1 + 1 / geometry.pageScale - 1, 6);
    expect(at0.s).toBeGreaterThan(at1.s);
  });

  it('a non-special page is never scaled', () => {
    const t = scrubberPageTransform({ index: 9, offset: 0, enter: 0.5, geometry, committed: 5, specialPage: 5, inWindow: true });
    expect(t.s).toBe(1);
  });

  it('the flying special page draws no cylinder shade', () => {
    const t = scrubberPageTransform({ index: 5, offset: 0, enter: 0.5, geometry, committed: 5, specialPage: 5, inWindow: true });
    expect(t.shade).toBeNull();
  });

  it('off-centre pages get a shade that saturates at 0.45', () => {
    const near = scrubberPageTransform({ index: 6, offset: -5 * geometry.stride, enter: 1, geometry, committed: null, specialPage: 5, inWindow: true });
    const far = scrubberPageTransform({ index: 10, offset: -5 * geometry.stride, enter: 1, geometry, committed: null, specialPage: 5, inWindow: true });
    expect(near.shade).not.toBeNull();
    expect(far.shade).toBeCloseTo(0.45, 6);
    expect(far.shade as number).toBeGreaterThan(near.shade as number);
  });

  it('a page right at the centre has no shade (below the 0.22 threshold)', () => {
    const t = scrubberPageTransform({ index: 5, offset: -5 * geometry.stride + 10, enter: 1, geometry, committed: null, specialPage: 5, inWindow: true });
    expect(t.shade).toBeNull();
  });

  it('is deterministic', () => {
    const args = { index: 3, offset: -123.4, enter: 0.7, geometry, committed: null, specialPage: 5, inWindow: true };
    expect(scrubberPageTransform(args)).toEqual(scrubberPageTransform(args));
  });
});

describe('rubberBandOffset (PageScrubber.kt lines 330-345)', () => {
  const maxOff = 0;
  const minOff = -400;

  it('passes in-range offsets straight through', () => {
    expect(rubberBandOffset(-100, maxOff, minOff)).toBe(-100);
    expect(rubberBandOffset(0, maxOff, minOff)).toBe(0);
    expect(rubberBandOffset(-400, maxOff, minOff)).toBe(-400);
  });

  it('resists past the upper bound at 32%', () => {
    expect(rubberBandOffset(100, maxOff, minOff)).toBeCloseTo(32, 9);
  });

  it('resists past the lower bound at 32%', () => {
    expect(rubberBandOffset(-500, maxOff, minOff)).toBeCloseTo(-432, 9);
  });
});

describe('PageScrubber.kt animation tokens', () => {
  it('the enter spring is spring(0.75, 380) with its fitted bezier', () => {
    expect(ENTER_SPRING.dampingRatio).toBe(0.75);
    expect(ENTER_SPRING.stiffness).toBe(380);
    expect(ENTER_SPRING.bezier).toBe('cubic-bezier(0.22, 1.2, 0.36, 1)');
  });

  it('SETTLE_STIFFNESS is 380', () => {
    expect(SETTLE_STIFFNESS).toBe(380);
  });
});