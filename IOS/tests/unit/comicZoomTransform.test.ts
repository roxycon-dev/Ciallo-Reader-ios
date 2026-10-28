import { describe, expect, it } from 'vitest'

import {
  ComicZoomState,
  type ComicZoomEnv,
  limitScaleWithRubberBand,
  resolvePanArbitration,
  rubberPan,
  type ZoomAnimator,
} from '../../src/core/comic/comicZoomGesture'
import { fittedSize, type OffsetF, type SizeF } from '../../src/core/comic/comicPortTypes'

/* ── instant test doubles ────────────────────────────────────────────────────────── */

/** Resolves the tween/spring immediately with linear interpolation. */
function instantAnimator(): ZoomAnimator {
  return {
    tween: async (from, to, _ms, onFrame) => {
      onFrame(to)
      void from
    },
    spring: async (from, to, _dr, _k, onFrame) => {
      onFrame(to)
      void from
    },
    decay: async (_vx, _vy, onFrame) => {
      onFrame(0, 0)
      return true
    },
  }
}

function testEnv(container: SizeF): ComicZoomEnv {
  return {
    source: {
      down: () => {
        throw new Error('not used')
      },
      next: () => {
        throw new Error('not used')
      },
      touchSlop: 8,
    },
    anim: instantAnimator(),
    sleep: () => Promise.resolve(),
    dpToPx: (dp) => dp * 2,
    density: 2,
    size: () => container,
    createVelocityTracker: () => ({
      addPosition: () => {},
      calculateVelocity: () => null,
    }),
  }
}

/** A 1000x800 container displaying a 2000x1600 page (scale 1 → 0.5 of the pixels). */
function zoomedState(min = 1, max = 5): ComicZoomState {
  const container: SizeF = { width: 1000, height: 800 }
  const z = new ComicZoomState(min, max)
  z.attach(testEnv(container))
  z.containerSize = container
  z.contentSize = { width: 1000, height: 800 }
  z.intrinsicSize = { width: 2000, height: 1600 }
  return z
}

/* ── limitScaleWithRubberBand (Kotlin L345–363) ──────────────────────────────────── */

describe('limitScaleWithRubberBand', () => {
  it('passes through unchanged inside [min, max] (inclusive)', () => {
    expect(limitScaleWithRubberBand(1, 1, 1, 5)).toBe(1)
    expect(limitScaleWithRubberBand(2, 3.5, 1, 5)).toBe(3.5)
    expect(limitScaleWithRubberBand(2, 5, 1, 5)).toBe(5)
  })

  it('above max: halves the overshoot and hard-caps at max*ratio', () => {
    // current 5, target 6, max 5, ratio 2 → over 1, progress (6-5)/(10-5) = 0.2
    // 5 + 1*(1-0.2)*0.5 = 5.4
    expect(limitScaleWithRubberBand(5, 6, 1, 5)).toBeCloseTo(5.4, 6)
    // at the hard max the value is exactly max*ratio
    expect(limitScaleWithRubberBand(5, 10, 1, 5)).toBe(10)
    expect(limitScaleWithRubberBand(5, 99, 1, 5)).toBe(10)
  })

  it('below min: halves the overshoot and hard-caps at min/ratio', () => {
    // current 1, target 0.75, min 1, ratio 2 → hardMin 0.5, over -0.25,
    // progress (1-0.75)/(1-0.5) = 0.5 → 1 + (-0.25)*0.5*0.5 = 0.9375
    expect(limitScaleWithRubberBand(1, 0.75, 1, 5)).toBeCloseTo(0.9375, 6)
    // at the hard min the value is exactly min/ratio
    expect(limitScaleWithRubberBand(1, 0.5, 1, 5)).toBe(0.5)
    expect(limitScaleWithRubberBand(3, 0.25, 1, 5)).toBe(0.5)
    expect(limitScaleWithRubberBand(3, -9, 1, 5)).toBe(0.5)
  })

  it('the ratio parameter scales the hard stop', () => {
    expect(limitScaleWithRubberBand(5, 99, 1, 5, 1.2)).toBe(6)
    expect(limitScaleWithRubberBand(1, 0, 1, 5, 4)).toBe(0.25)
  })

  it('rubber band output stays strictly inside [min/ratio, max*ratio]', () => {
    for (const target of [-2, 0, 0.2, 0.9, 1, 3, 5.01, 7, 20]) {
      const r = limitScaleWithRubberBand(1, target, 1, 5)
      expect(r).toBeGreaterThanOrEqual(0.5 - 1e-9)
      expect(r).toBeLessThanOrEqual(10 + 1e-9)
    }
  })
})

/* ── rubberPan (Kotlin L195–203) ─────────────────────────────────────────────────── */

describe('rubberPan', () => {
  it('in-bounds: full 1:1 tracking', () => {
    expect(rubberPan(10, 5, 100)).toBe(15)
    expect(rubberPan(-10, -5, 100)).toBe(-15)
    expect(rubberPan(95, 5, 100)).toBe(100)
    expect(rubberPan(-95, -5, 100)).toBe(-100)
  })

  it('out-of-bounds: 0.35 damping, hard stop at 1.6*limit', () => {
    expect(rubberPan(99, 10, 100)).toBeCloseTo(99 + 3.5, 6)
    expect(rubberPan(160, 10, 100)).toBe(160)
    expect(rubberPan(-161, -10, 100)).toBe(-160)
  })

  it('repeated out-of-bounds drags keep growing (no fixed point)', () => {
    let cur = 99
    for (let i = 0; i < 10; i++) cur = rubberPan(cur, 10, 100)
    expect(cur).toBeCloseTo(99 + 10 * 3.5, 6)
  })

  it('no-margin axis: 0.3 damping drift clamped to ±96', () => {
    expect(rubberPan(0, 10, 0)).toBe(3)
    expect(rubberPan(0, -10, 0)).toBe(-3)
    expect(rubberPan(95, 10, 0.4)).toBe(96)
    expect(rubberPan(-95, -10, 0.4)).toBe(-96)
  })
})

/* ── pan limits / edge detection (Kotlin L100–114, L93–97) ──────────────────────── */

describe('pan limits and edge detection', () => {
  it('panLimitX/Y are half the overflow', () => {
    const z = zoomedState()
    z.scale = 1
    expect(z.panLimitX()).toBe(0)
    expect(z.panLimitY()).toBe(0)
    z.scale = 2
    expect(z.panLimitX()).toBe((1000 * 2 - 1000) / 2)
    expect(z.panLimitY()).toBe((800 * 2 - 800) / 2)
  })

  it('canPan / isZoomed', () => {
    const z = zoomedState()
    z.scale = 1
    expect(z.canPan).toBe(false)
    expect(z.isZoomed).toBe(false)
    // 1.02 is exactly at the zoom threshold, but the content already overflows the
    // container at that scale, so canPan (and therefore isZoomed) is true
    z.scale = 1.02
    expect(z.panLimitX()).toBeCloseTo(10, 6)
    expect(z.canPan).toBe(true)
    expect(z.isZoomed).toBe(true)
    const fitting = new ComicZoomState()
    fitting.attach(testEnv({ width: 1000, height: 800 }))
    fitting.containerSize = { width: 1000, height: 800 }
    fitting.contentSize = { width: 980, height: 784 } // slight letterbox → no margin
    fitting.scale = 1.02
    expect(fitting.panLimitX()).toBe(0)
    expect(fitting.canPan).toBe(false)
    expect(fitting.isZoomed).toBe(false)
    fitting.scale = 1.03
    expect(fitting.isZoomed).toBe(true)
  })

  it('horizontalPanEdge: zero margin always reports an edge', () => {
    const z = zoomedState()
    z.scale = 1
    expect(z.horizontalPanEdge(1)).toBe(true)
    expect(z.horizontalPanEdge(-1)).toBe(true)
  })

  it('horizontalPanEdge: ±1px tolerance per direction', () => {
    const z = zoomedState()
    z.scale = 2
    const lx = z.panLimitX()
    z.offsetX = lx
    expect(z.horizontalPanEdge(1)).toBe(true)
    z.offsetX = lx - 1.5
    expect(z.horizontalPanEdge(1)).toBe(false)
    z.offsetX = -lx
    expect(z.horizontalPanEdge(-1)).toBe(true)
    z.offsetX = -lx + 1.5
    expect(z.horizontalPanEdge(-1)).toBe(false)
  })
})

/* ── dynamic double-tap steps (Kotlin L119–154) ──────────────────────────────────── */

describe('dynamic double-tap steps', () => {
  it('mediumScale: at least 2.5x, at most 4x, clamped to [min,max]', () => {
    const z = zoomedState()
    // container 1000x800 vs content 1000x800 → fill = 1 → max(2.5, min(1,4)) = 2.5
    expect(z.mediumScale()).toBe(2.5)
    const tall = zoomedState()
    tall.contentSize = { width: 100, height: 100 }
    tall.containerSize = { width: 1000, height: 800 }
    // fill = max(10, 8) = 10 → min(10, 4) = 4
    expect(tall.mediumScale()).toBe(4)
    const capped = zoomedState(1, 3)
    capped.contentSize = { width: 100, height: 100 }
    expect(capped.mediumScale()).toBe(3)
    // degenerate sizes fall back to 2.5 before clamping
    const degenerate = zoomedState()
    degenerate.contentSize = { width: 0, height: 0 }
    expect(degenerate.mediumScale()).toBe(2.5)
  })

  it('oneToOneScale only exists when the raw page is meaningfully bigger', () => {
    const z = zoomedState()
    // intrinsic 2000 / content 1000 = 2 → not > medium*1.1 (2.75)
    expect(Number.isNaN(z.oneToOneScale())).toBe(true)
    z.intrinsicSize = { width: 3000, height: 2400 } // s = 3 > 2.75 and <= 5
    expect(z.oneToOneScale()).toBeCloseTo(3, 6)
    // above maxScale → NaN
    z.intrinsicSize = { width: 9000, height: 7200 }
    expect(Number.isNaN(z.oneToOneScale())).toBe(true)
    // no intrinsic size → NaN
    z.intrinsicSize = { width: 0, height: 0 }
    expect(Number.isNaN(z.oneToOneScale())).toBe(true)
  })

  it('stepScales: deduped by (scale*100) and sorted ascending', () => {
    const z = zoomedState()
    z.contentSize = { width: 100, height: 100 }
    z.intrinsicSize = { width: 480, height: 480 } // 1:1 step = 4.8 (> 4.4, <= 5)
    const steps = z.stepScales()
    expect(steps).toEqual([1, 4, 4.8])
    const noIntrinsic = zoomedState()
    expect(noIntrinsic.stepScales()).toEqual([1, 2.5])
  })

  it('nextStepScale walks up with the 0.35 tolerance and wraps at the top', () => {
    const z = zoomedState()
    z.contentSize = { width: 100, height: 100 }
    z.intrinsicSize = { width: 480, height: 480 } // steps [1, 4, 4.8]
    // gaps 1→4 = 3, 4→4.8 = 0.8
    z.scale = 1
    expect(z.nextStepScale()).toBe(4) // 1 < 4 - 0.35*3 = 2.95
    z.scale = 4
    expect(z.nextStepScale()).toBe(4.8) // 4 < 4.8 - 0.35*0.8 = 4.52
    z.scale = 4.8
    expect(z.nextStepScale()).toBe(1) // at the top → wrap to min
  })
})

/* ── transform math (Kotlin L158–260) ───────────────────────────────────────────── */

describe('updateTransform / snapZoomTo', () => {
  it('keeps the focal content point pinned under the finger', () => {
    const z = zoomedState()
    z.scale = 1
    const focal: OffsetF = { x: 250, y: 150 }
    const before = {
      x: (focal.x - z.containerSize.width / 2 - z.offsetX) / z.scale,
      y: (focal.y - z.containerSize.height / 2 - z.offsetY) / z.scale,
    }
    z.updateTransform(2.5, { x: 0, y: 0 }, focal)
    expect(z.scale).toBe(2.5)
    const after = {
      x: (focal.x - z.containerSize.width / 2 - z.offsetX) / z.scale,
      y: (focal.y - z.containerSize.height / 2 - z.offsetY) / z.scale,
    }
    expect(after.x).toBeCloseTo(before.x, 5)
    expect(after.y).toBeCloseTo(before.y, 5)
  })

  it('pan is added on top of the focal-preserving transform', () => {
    const z = zoomedState()
    z.scale = 1
    z.updateTransform(2, { x: 30, y: -20 }, { x: 500, y: 400 })
    const noPan = zoomedState()
    noPan.scale = 1
    noPan.updateTransform(2, { x: 0, y: 0 }, { x: 500, y: 400 })
    expect(z.offsetX - noPan.offsetX).toBeCloseTo(30, 6)
    expect(z.offsetY - noPan.offsetY).toBeCloseTo(-20, 6)
  })

  it('zero scale initialises from the raw zoom and pan', () => {
    const z = zoomedState()
    z.scale = 0
    z.updateTransform(3, { x: 11, y: 22 }, { x: 500, y: 400 })
    expect(z.scale).toBe(3)
    expect(z.offsetX).toBe(11)
    expect(z.offsetY).toBe(22)
  })

  it('updateTransform clamps the offset to the pan limits', () => {
    const z = zoomedState()
    z.scale = 1.1
    z.updateTransform(1, { x: 99999, y: -99999 }, { x: 500, y: 400 })
    expect(z.offsetX).toBeLessThanOrEqual(z.panLimitX() + 1e-6)
    expect(z.offsetY).toBeGreaterThanOrEqual(-z.panLimitY() - 1e-6)
  })

  it('snapZoomTo pins the focal and clamps (long-press path)', () => {
    const z = zoomedState()
    z.scale = 1
    const focal: OffsetF = { x: 300, y: 200 }
    const before = {
      x: (focal.x - 500 - z.offsetX) / z.scale,
      y: (focal.y - 400 - z.offsetY) / z.scale,
    }
    z.snapZoomTo(4, focal)
    expect(z.scale).toBe(4)
    const after = {
      x: (focal.x - 500 - z.offsetX) / z.scale,
      y: (focal.y - 400 - z.offsetY) / z.scale,
    }
    expect(after.x).toBeCloseTo(before.x, 5)
    expect(after.y).toBeCloseTo(before.y, 5)
    expect(Math.abs(z.offsetX)).toBeLessThanOrEqual(z.panLimitX() + 1e-6)
  })

  it('snapZoomTo defaults the focal to the container centre and clamps the scale', () => {
    const z = zoomedState()
    z.snapZoomTo(99)
    expect(z.scale).toBe(5)
    expect(z.offsetX).toBe(0)
    expect(z.offsetY).toBe(0)
  })

  it('snapReset returns to identity and clears holdZoomActive', () => {
    const z = zoomedState()
    z.snapZoomTo(3, { x: 100, y: 100 })
    z.holdZoomActive = true
    z.snapReset()
    expect([z.scale, z.offsetX, z.offsetY, z.holdZoomActive]).toEqual([1, 0, 0, false])
  })
})

/* ── panBy + clampOffsets (Kotlin L177–210) ──────────────────────────────────────── */

describe('panBy', () => {
  it('tracks 1:1 while inside the limits', () => {
    const z = zoomedState()
    z.scale = 2
    z.panBy({ x: 40, y: -30 })
    expect(z.offsetX).toBe(40)
    expect(z.offsetY).toBe(-30)
  })

  it('damps while outside the limits instead of hard-stopping', () => {
    const z = zoomedState()
    z.scale = 1.2
    const limit = z.panLimitX()
    z.offsetX = limit
    z.panBy({ x: 20, y: 0 })
    expect(z.offsetX).toBeCloseTo(limit + 7, 6) // 20 * 0.35
  })

  it('clampOffsets pulls everything back inside', () => {
    const z = zoomedState()
    z.scale = 2
    z.offsetX = 1e6
    z.offsetY = -1e6
    z.clampOffsets()
    expect(z.offsetX).toBeCloseTo(z.panLimitX(), 6)
    expect(z.offsetY).toBeCloseTo(-z.panLimitY(), 6)
  })
})

/* ── pan / page arbitration (Kotlin L598–633) ───────────────────────────────────── */

describe('resolvePanArbitration', () => {
  const base = {
    panLimitX: 200,
    panLimitY: 0,
    scale: 2,
    offsetX: 0,
    offsetY: 0,
    delta: { x: 20, y: 0 },
    direction: 'LTR' as const,
    zoomWhileTurn: false,
  }

  it('mid-page horizontal pan is consumed', () => {
    const r = resolvePanArbitration(base)
    expect(r.pan).toEqual({ x: 20, y: 0 })
    expect(r.consumed).toBe(true)
  })

  it('at the horizontal edge while zoomed the pan keeps damping (no yield)', () => {
    // 放大态到边是否交还翻页由 zoomWhileTurn 决定
    const r = resolvePanArbitration({ ...base, offsetX: 200 })
    expect(r.pan.x).toBe(20)
    expect(r.consumed).toBe(true)
  })

  it('zoomWhileTurn=true hands the page axis back at the edge', () => {
    const r = resolvePanArbitration({ ...base, offsetX: 200, zoomWhileTurn: true })
    expect(r.pan.x).toBe(0)
    expect(r.consumed).toBe(false)
  })

  it('a zero-margin axis is always yielded to the page turner', () => {
    const r = resolvePanArbitration({ ...base, panLimitX: 0, panLimitY: 0 })
    expect(r.pan).toEqual({ x: 20, y: 0 })
    expect(r.consumed).toBe(false)
  })

  it('TTB with a vertical layout overflow yields the vertical page axis', () => {
    const t = resolvePanArbitration({
      panLimitX: 200,
      panLimitY: 100,
      scale: 1, // not zoomed → the vertical overflow must yield to the pager
      offsetX: 0,
      offsetY: 100,
      delta: { x: 15, y: 12 },
      direction: 'TTB',
      zoomWhileTurn: false,
    })
    expect(t.pan).toEqual({ x: 15, y: 0 })
    expect(t.consumed).toBe(false)
  })

  it('TTB while zoomed keeps the vertical axis (non-page axis stays damped)', () => {
    const t = resolvePanArbitration({
      panLimitX: 200,
      panLimitY: 100,
      scale: 2,
      offsetX: 0,
      offsetY: 0,
      delta: { x: 15, y: 12 },
      direction: 'TTB',
      zoomWhileTurn: false,
    })
    expect(t.pan).toEqual({ x: 15, y: 12 })
    expect(t.consumed).toBe(true)
  })

  it('not zoomed (layout overflow only) always yields at the edge', () => {
    const r = resolvePanArbitration({ ...base, scale: 1.0, offsetX: 200 })
    expect(r.pan.x).toBe(0)
    expect(r.consumed).toBe(false)
  })
})

/* ── fling / settle ─────────────────────────────────────────────────────────────── */

describe('fling and settle', () => {
  it('fling refuses below the 150dp/s floor and clamps to 8000dp/s', async () => {
    const z = zoomedState()
    z.scale = 2
    // density 2 → minSpeed 300 px/s, vCap 16000 px/s
    const dp = (d: number): number => d * 2
    expect(await z.fling({ x: 100, y: 0 }, dp)).toBe(false) // |v| = 100 < 300
    expect(await z.fling({ x: 299, y: 0 }, dp)).toBe(false)
    expect(await z.fling({ x: 400, y: 0 }, dp)).toBe(true)
    // diagonal fling above the cap still runs (the magnitude clamp lives in the
    // animator seam, which keeps the direction)
    expect(await z.fling({ x: 30000, y: 30000 }, dp)).toBe(true)
  })

  it('fling refuses when nothing can pan', async () => {
    const z = zoomedState()
    z.scale = 1
    expect(await z.fling({ x: 5000, y: 0 }, () => 2)).toBe(false)
  })

  it('settle aligns an out-of-range scale to the nearest bound', async () => {
    const z = zoomedState()
    z.scale = 6
    await z.settle()
    expect(z.scale).toBe(5)
    const low = zoomedState()
    low.scale = 0.1
    await low.settle()
    expect(low.scale).toBe(1)
  })

  it('settle leaves an in-range scale untouched', async () => {
    const z = zoomedState()
    z.scale = 2
    await z.settle()
    expect(z.scale).toBe(2)
  })

  it('settle springs out-of-bounds offsets back inside', async () => {
    const z = zoomedState()
    z.scale = 2
    z.offsetX = z.panLimitX() + 120
    await z.settle()
    expect(Math.abs(z.offsetX)).toBeLessThanOrEqual(z.panLimitX() + 1e-6)
  })
})

/* ── zoom/fit interop with the layout engine ────────────────────────────────────── */

describe('content size interop', () => {
  it('fittedSize(FIT_PAGE) gives scale-1 content whose medium step is fill-derived', () => {
    const container: SizeF = { width: 1080, height: 1920 }
    const content = fittedSize({ width: 1600, height: 2400 }, container, 'FIT_PAGE')
    const z = new ComicZoomState()
    z.attach(testEnv(container))
    z.containerSize = container
    z.contentSize = content
    z.intrinsicSize = { width: 1600, height: 2400 }
    // intrinsic / content === 1 for FIT_PAGE → no 1:1 step offered
    expect(Number.isNaN(z.oneToOneScale())).toBe(true)
    expect(z.stepScales()).toEqual([1, 2.5])
  })

  it('FIT_WIDTH overflows vertically and therefore enables panning at scale 1', () => {
    const container: SizeF = { width: 1080, height: 1920 }
    // tall page: the width fits exactly, the height overflows the viewport
    const content = fittedSize({ width: 1600, height: 3600 }, container, 'FIT_WIDTH')
    const z = new ComicZoomState()
    z.attach(testEnv(container))
    z.containerSize = container
    z.contentSize = content
    expect(content.width).toBeCloseTo(1080, 6)
    expect(content.height).toBeCloseTo(2430, 6)
    expect(z.panLimitY()).toBeCloseTo((2430 - 1920) / 2, 6)
    expect(z.panLimitX()).toBe(0)
    expect(z.canPan).toBe(true)
    expect(z.isZoomed).toBe(true)
  })
})
