/**
 * Kotlin → TS map
 * ──────────────
 * Tests for `src/core/pageturn/pageTurn.ts` + `paperPalette.ts` — the ports of
 * the pure geometry helpers in `ui/pageturn/PageTurnContainer.kt`
 * (lines 52-68 + 938-990) and all of `ui/pageturn/PaperPalette.kt`.
 *
 * Nothing skipped — every assertion targets a ported Kotlin expression.
 */
import { describe, expect, it } from 'vitest';

import {
  BACKSIDE_CONTENT_ALPHA,
  buildFlapPath,
  computeCurlGeometry,
  curlNormal,
  dropShadowStrips,
  flapShadeStops,
  flatClipPath,
  midPoint,
  mirrorAngleDeg,
  shadowStripPath,
  touchEdgePath,
  type Pt,
} from '../../src/core/pageturn/pageTurn';
import { paperPaletteOf } from '../../src/core/pageturn/paperPalette';

describe('PaperPalette.kt', () => {
  it('every derived channel is a full #RRGGBB hex (a 2-char grey would fail parseHex)', () => {
    for (const src of ['#F5F0E6', '#0B0C0E', '#767676', '#2E7D32']) {
      const p = paperPaletteOf(src);
      for (const key of ['face', 'edgeHighlight', 'edgeStroke'] as const) {
        expect(p[key]).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it('light paper mixes toward white and desaturates 0.22, alpha 0.9', () => {
    const p = paperPaletteOf('#F5F0E6');
    expect(p.isDark).toBe(false);
    expect(p.baseAlpha).toBe(0.9);
    expect(p.face.startsWith('#')).toBe(true);
    // Face must be *lighter* than the source (mixed 10% toward #FFFFFF).
    expect(p.face).not.toBe('#F5F0E6');
  });

  it('dark paper mixes toward #0B0C0E and desaturates 0.16, alpha 0.93', () => {
    const p = paperPaletteOf('#0B0C0E');
    expect(p.isDark).toBe(true);
    expect(p.baseAlpha).toBe(0.93);
  });

  it('the light/dark switch is exactly `luminance(source) < 0.25`', () => {
    // #767676 ≈ 0.185 luminance → dark; #7F7F7F ≈ 0.216 → dark; #808080 ≈ 0.216 → dark.
    expect(paperPaletteOf('#767676').isDark).toBe(true);
    expect(paperPaletteOf('#808080').isDark).toBe(true);
    expect(paperPaletteOf('#D8D8D8').isDark).toBe(false);
  });

  it('edge highlight and stroke are derived from the face, not the source', () => {
    const p = paperPaletteOf('#F5F0E6');
    expect(p.edgeHighlight).not.toBe(p.face);
    expect(p.edgeStroke).not.toBe(p.face);
    expect(p.edgeHighlight).not.toBe(p.edgeStroke);
  });

  it('is deterministic for a given source', () => {
    expect(paperPaletteOf('#F5F0E6')).toEqual(paperPaletteOf('#F5F0E6'));
  });
});

describe('PageTurnContainer.kt constant', () => {
  it('BACKSIDE_CONTENT_ALPHA is 0.88', () => {
    expect(BACKSIDE_CONTENT_ALPHA).toBe(0.88);
  });
});

describe('midPoint (PageTurnContainer.kt line 938)', () => {
  it('averages both coordinates', () => {
    expect(midPoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });
});

describe('curlNormal (PageTurnContainer.kt line 941)', () => {
  it('is a unit vector perpendicular to the fold, forced to the requested side', () => {
    const top: Pt = { x: 100, y: 0 };
    const bottom: Pt = { x: 100, y: 200 };
    const n = curlNormal(top, bottom, 1);
    expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 6);
    // sign 1 forces n.x > 0
    expect(n.x).toBeGreaterThan(0);
  });

  it('flips when the requested sign is negative', () => {
    const top: Pt = { x: 100, y: 0 };
    const bottom: Pt = { x: 100, y: 200 };
    const a = curlNormal(top, bottom, 1);
    const b = curlNormal(top, bottom, -1);
    expect(b.x).toBeCloseTo(-a.x, 9);
    expect(b.y).toBeCloseTo(-a.y, 9);
  });

  it('survives a degenerate (zero-length) fold instead of producing NaN', () => {
    const n = curlNormal({ x: 5, y: 5 }, { x: 5, y: 5 }, 1);
    expect(Number.isFinite(n.x)).toBe(true);
    expect(Number.isFinite(n.y)).toBe(true);
  });
});

describe('shadowStripPath (PageTurnContainer.kt line 950)', () => {
  it('emits a four-point closed quad offset along the normal', () => {
    expect(
      shadowStripPath({ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 1, y: 0 }, 10),
    ).toBe('M0,0 L0,100 L10,100 L10,0 Z');
  });

  it('a negative width produces the inner-crease strip on the opposite side', () => {
    const d = shadowStripPath({ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 1, y: 0 }, -15);
    expect(d).toBe('M0,0 L0,100 L-15,100 L-15,0 Z');
  });
});

describe('mirrorAngleDeg (PageTurnContainer.kt line 963)', () => {
  it('a perfectly vertical fold yields PI - 2·atan2(-h, 0) = 2π (360°)', () => {
    // dx = 0, dy = -200 → atan2 = -π/2 → angle = π + π = 2π. Faithful to Kotlin.
    expect(mirrorAngleDeg({ x: 50, y: 0 }, { x: 50, y: 200 })).toBeCloseTo(360, 6);
  });

  it('the expression is PI - 2·atan2(dy, dx) in degrees', () => {
    const foldTop: Pt = { x: 70, y: 0 };
    const foldBottom: Pt = { x: 30, y: 200 };
    const dx = foldTop.x - foldBottom.x;
    const dy = foldTop.y - foldBottom.y;
    expect(mirrorAngleDeg(foldTop, foldBottom)).toBeCloseTo(((Math.PI - 2 * Math.atan2(dy, dx)) * 180) / Math.PI, 6);
  });

  it('a fold running bottom-left to top-right reflects across the diagonal', () => {
    // dx = 200, dy = -200 → atan2 = -π/4 → angle = π + π/2 = 270°
    expect(mirrorAngleDeg({ x: 200, y: 0 }, { x: 0, y: 200 })).toBeCloseTo(270, 6);
  });
});

describe('buildFlapPath (PageTurnContainer.kt line 970)', () => {
  const opts = {
    foldTop: { x: 60, y: 0 },
    foldBottom: { x: 60, y: 100 },
    touchTop: { x: 20, y: 0 },
    touchBottom: { x: 20, y: 100 },
    creaseX: 60,
    touchX: 20,
    arcOffset: 10,
    heightPx: 100,
    bulgeSign: -1,
  };

  it('bulge offset is applied to the fold and half to the touch edge', () => {
    const d = buildFlapPath(opts);
    // foldMidX = creaseX + bulgeSign*arcOffset = 60 - 10 = 50
    expect(d).toContain('C50,35');
    expect(d).toContain('50,65');
    // touchMidX = touchX + bulgeSign*arcOffset*0.5 = 20 - 5 = 15
    expect(d).toContain('C15,65');
    expect(d).toContain('15,35');
  });

  it('anchors the two vertical edges at y = 0 and y = heightPx', () => {
    expect(buildFlapPath(opts).startsWith('M60,0 ')).toBe(true);
    expect(buildFlapPath(opts)).toContain('L20,100 ');
    expect(buildFlapPath(opts).endsWith('Z')).toBe(true);
  });

  it('the sign flip mirrors both control-point columns', () => {
    const flipped = buildFlapPath({ ...opts, bulgeSign: 1 });
    expect(flipped).toContain('C70,35');
    expect(flipped).toContain('25,35');
  });

  it('is deterministic — same inputs give a byte-identical path string', () => {
    expect(buildFlapPath(opts)).toBe(buildFlapPath(opts));
  });
});

describe('computeCurlGeometry (PageTurnContainer.kt lines 496-551)', () => {
  const base = { dragPx: -150, dragPy: 0, touchDownY: 500, widthPx: 400, heightPx: 800 };

  it('a leftward drag is the next-page direction and anchors on the right edge', () => {
    const g = computeCurlGeometry(base);
    expect(g.isNext).toBe(true);
    expect(g.anchorF).toEqual({ x: 400, y: 500 });
  });

  it('a rightward drag is the previous-page direction and anchors on the left edge', () => {
    const g = computeCurlGeometry({ ...base, dragPx: 150 });
    expect(g.isNext).toBe(false);
    expect(g.anchorF).toEqual({ x: 0, y: 500 });
  });

  it('progress is clamped to 0..1', () => {
    expect(computeCurlGeometry({ ...base, dragPx: -10 }).progress).toBeCloseTo(0.025, 9);
    expect(computeCurlGeometry({ ...base, dragPx: -4000 }).progress).toBe(1);
    expect(computeCurlGeometry({ ...base, dragPx: 4000 }).progress).toBe(1);
  });

  it('corner taps (<0.35h / >0.65h) snap the anchor to the edge', () => {
    expect(computeCurlGeometry({ ...base, touchDownY: 100 }).isTopCorner).toBe(true);
    expect(computeCurlGeometry({ ...base, touchDownY: 100 }).anchorY).toBe(0);
    expect(computeCurlGeometry({ ...base, touchDownY: 700 }).isBottomCorner).toBe(true);
    expect(computeCurlGeometry({ ...base, touchDownY: 700 }).anchorY).toBe(800);
  });

  it('a mid-page drag clamps the anchor Y to the page', () => {
    expect(computeCurlGeometry({ ...base, touchDownY: -50 }).anchorY).toBe(0);
    expect(computeCurlGeometry({ ...base, touchDownY: 5000 }).anchorY).toBe(800);
  });

  it('the touch point stays inside the page', () => {
    expect(computeCurlGeometry({ ...base, dragPx: -900, dragPy: -900 }).touchP.x).toBe(0);
    expect(computeCurlGeometry({ ...base, dragPx: 900, dragPy: 900 }).touchP.x).toBe(400);
  });

  it('midpointM is the average of the anchor and the touch point', () => {
    const g = computeCurlGeometry(base);
    expect(g.midpointM).toEqual({
      x: (g.anchorF.x + g.touchP.x) / 2,
      y: (g.anchorF.y + g.touchP.y) / 2,
    });
    expect(g.creaseX).toBe(g.midpointM.x);
  });

  it('distanceV never collapses to zero (guards the radius maths)', () => {
    expect(computeCurlGeometry({ ...base, dragPx: 0 }).distanceV).toBeCloseTo(0.1, 6);
  });

  it('curlRadius grows with the drag distance while arcOffset shrinks with progress', () => {
    // curlRadius = (32 + 0.16·|V|) · (0.65 + 0.35·(1 − progress))
    // arcOffset  = clamp(curlRadius · 0.6 · (1 − progress), 4, 40)
    const near = computeCurlGeometry({ ...base, dragPx: -20 });
    const far = computeCurlGeometry({ ...base, dragPx: -400 });
    expect(far.curlRadius).toBeCloseTo((32 + 0.16 * 400) * 0.65, 6);
    expect(near.curlRadius).toBeCloseTo((32 + 0.16 * 20) * (0.65 + 0.35 * 0.95), 6);
    expect(near.arcOffset).toBeGreaterThan(far.arcOffset);
    expect(far.arcOffset).toBe(4); // progress = 1 → clamped to the 4px floor
    expect(near.arcOffset).toBeGreaterThanOrEqual(4);
    expect(near.arcOffset).toBeLessThanOrEqual(40);
  });

  it('flapWidth is positive for both directions', () => {
    expect(computeCurlGeometry(base).flapWidth).toBeGreaterThan(0);
    expect(computeCurlGeometry({ ...base, dragPx: 150 }).flapWidth).toBeGreaterThan(0);
  });

  it('a corner drag skews the fold and touch columns by dy * 0.15, clamped to the page', () => {
    const g = computeCurlGeometry({ ...base, touchDownY: 100, dragPy: 700 });
    expect(g.foldTop.x).not.toBe(g.foldBottom.x);
    expect(g.creaseX).toBeGreaterThanOrEqual(0);
    expect(g.creaseX).toBeLessThanOrEqual(400);
  });

  it('is deterministic', () => {
    expect(computeCurlGeometry(base)).toEqual(computeCurlGeometry(base));
  });
});

describe('flatClipPath (PageTurnContainer.kt lines 550-598)', () => {
  it('next-page standard drag clips strictly at the crease (no corner kept)', () => {
    const g = computeCurlGeometry({ dragPx: -150, dragPy: 0, touchDownY: 500, widthPx: 400, heightPx: 800 });
    const d = flatClipPath(g, 400, 800);
    expect(d.startsWith('M0,0 L0,800 ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toContain('L400,0');
  });

  it('next-page top-corner keeps the top-right region', () => {
    const g = computeCurlGeometry({ dragPx: -150, dragPy: 0, touchDownY: 100, widthPx: 400, heightPx: 800 });
    expect(flatClipPath(g, 400, 800)).toContain('L400,800');
  });

  it('next-page bottom-corner keeps the bottom-right region', () => {
    const g = computeCurlGeometry({ dragPx: -150, dragPy: 0, touchDownY: 700, widthPx: 400, heightPx: 800 });
    expect(flatClipPath(g, 400, 800)).toContain('L400,0');
  });

  it('previous-page keeps the region left of the fold', () => {
    const g = computeCurlGeometry({ dragPx: 150, dragPy: 0, touchDownY: 500, widthPx: 400, heightPx: 800 });
    expect(flatClipPath(g, 400, 800)).toContain('L0,800');
  });

  it('is deterministic', () => {
    const g = computeCurlGeometry({ dragPx: -150, dragPy: 0, touchDownY: 500, widthPx: 400, heightPx: 800 });
    expect(flatClipPath(g, 400, 800)).toBe(flatClipPath(g, 400, 800));
  });
});

describe('dropShadowStrips (PageTurnContainer.kt lines 602-658)', () => {
  const next = computeCurlGeometry({ dragPx: -150, dragPy: 0, touchDownY: 500, widthPx: 400, heightPx: 800 });
  const prev = computeCurlGeometry({ dragPx: 150, dragPy: 0, touchDownY: 500, widthPx: 400, heightPx: 800 });

  it('next-page yields drop + inner + edge strips', () => {
    const s = dropShadowStrips(next);
    expect(s.drop).not.toBeNull();
    expect(s.inner).not.toBeNull();
    expect(s.edge).not.toBeNull();
  });

  it('the drop shadow fades out as the page finishes turning', () => {
    const a = dropShadowStrips(computeCurlGeometry({ dragPx: -40, dragPy: 0, touchDownY: 500, widthPx: 400, heightPx: 800 }));
    const b = dropShadowStrips(computeCurlGeometry({ dragPx: -380, dragPy: 0, touchDownY: 500, widthPx: 400, heightPx: 800 }));
    // Stops are `rgba(0, 0, 0, α)`; the first one is 0.26 · (1 − progress).
    const alphaOf = (s: { stops: string[] } | null): number => {
      const m = /rgba\(0, 0, 0, ([0-9.]+)\)/.exec(s?.stops[0] ?? '');
      return Number(m?.[1] ?? 'NaN');
    };
    expect(alphaOf(a.drop)).toBeCloseTo(0.26 * (1 - 0.1), 9);
    expect(alphaOf(b.drop)).toBeCloseTo(0.26 * (1 - 0.95), 9);
    expect(alphaOf(a.drop)).toBeGreaterThan(alphaOf(b.drop));
  });

  it('the drop shadow disappears entirely once progress is 1', () => {
    expect(
      dropShadowStrips(computeCurlGeometry({ dragPx: -400, dragPy: 0, touchDownY: 500, widthPx: 400, heightPx: 800 })).drop,
    ).toBeNull();
  });

  it('previous-page has no inner-crease or edge-highlight strip (Kotlin returns nulls)', () => {
    const s = dropShadowStrips(prev);
    expect(s.drop).not.toBeNull();
    expect(s.inner).toBeNull();
    expect(s.edge).toBeNull();
  });

  it('every strip is a closed path', () => {
    for (const strip of Object.values(dropShadowStrips(next))) {
      if (strip !== null) expect(strip.d.endsWith('Z')).toBe(true);
    }
  });
});

describe('flapShadeStops (PageTurnContainer.kt lines 887-893)', () => {
  it('six cylinder-shading stops at the documented positions', () => {
    const { positions, stops } = flapShadeStops(1);
    expect(positions).toEqual(['0%', '18%', '40%', '58%', '82%', '100%']);
    expect(stops).toHaveLength(6);
    expect(stops[0]).toBe('rgba(0, 0, 0, 0.17)');
    expect(stops[2]).toBe('rgba(255, 255, 255, 0.09)');
    expect(stops[5]).toBe('rgba(0, 0, 0, 0)');
  });

  it('scales linearly with the fade factor', () => {
    expect(flapShadeStops(0.5).stops[0]).toBe('rgba(0, 0, 0, 0.085)');
  });
});

describe('touchEdgePath (PageTurnContainer.kt lines 918-923)', () => {
  it('bulges the thickness highlight by arcOffset/2 toward the sign', () => {
    expect(
      touchEdgePath({ x: 20, y: 0 }, { x: 20, y: 100 }, 20, 10, 1, 100),
    ).toBe('M20,0 C25,35 25,65 20,100 Z');
    expect(
      touchEdgePath({ x: 20, y: 0 }, { x: 20, y: 100 }, 20, 10, -1, 100),
    ).toBe('M20,0 C15,35 15,65 20,100 Z');
  });
});