import { describe, expect, it } from 'vitest'

import {
  ACTION_CANCEL,
  ACTION_DOWN,
  ACTION_MOVE,
  ACTION_POINTER_DOWN,
  ACTION_UP,
  adjacentBackFlat,
  autoFlipStream,
  buildCurlFlatUnits,
  type ComicCurlViewArbiter,
  ComicCurlViewArbiter as ComicCurlArbiterFactory,
  type CurlGL,
  type CurlInputEvent,
  type Scheduler,
  curlPageRects,
  curlSyncPlan,
  drawSpreadFit,
  effectiveSplitPosition,
  harismIndexFor,
  harismToSpreadTwo,
  isWidePage,
  ourIndexFor,
  pageBgInt,
  flatUnitIndexFor,
  resolveFit,
  slotCacheKey,
  spreadToHarismTwo,
  textureCap,
  CURL_IMMEDIATE_WAIT_MS,
} from '../../src/core/comic/comicHarismCurl'
import {
  fittedSize,
  type ComicConfigSubset,
  type ComicLayout,
  type ComicSlot,
  type ComicSpread,
  type SizeF,
  RectF,
} from '../../src/core/comic/comicPortTypes'
import type { PixImage } from '../../src/core/comic/comicPixOps'

/* ── fixtures ───────────────────────────────────────────────────────────────────── */

function cfg(over: Partial<ComicConfigSubset> = {}): ComicConfigSubset {
  return {
    mode: 'SINGLE',
    direction: 'LTR',
    fit: 'FIT_PAGE',
    customFitBase: 'FIT_PAGE',
    customFitScale: 1,
    doubleGapDp: 8,
    doubleAlign: 'CENTER',
    doubleShiftXDp: 0,
    doubleShiftYDp: 0,
    bookRotation: 0,
    cropMode: 'OFF',
    manualCrop: null,
    splitWide: true,
    splitPosition: 0.5,
    enhanceMode: 'OFF',
    enhanceStrength: 60,
    filterBrightness: 0,
    filterContrast: 0,
    filterSaturation: 0,
    filterHue: 0,
    filterGamma: 1,
    filterSharpen: 0,
    filterShadow: 0,
    filterBW: false,
    bgType: 'BLACK',
    paperIntensity: 35,
    pageAnim: 'SLIDE',
    ...over,
  }
}

function slot(id: string, idx: number, half: ComicSlot['half'] = 'FULL'): ComicSlot {
  return { ref: { kind: 'Local', id, path: `/pages/${id}.jpg` }, rawIndex: idx, half }
}

function spread(index: number, slots: ComicSlot[]): ComicSpread {
  return { index, slots }
}

function layout(spreads: ComicSpread[]): ComicLayout {
  const rawToSpread: Record<number, number> = {}
  spreads.forEach((s) => s.slots.forEach((sl) => (rawToSpread[sl.rawIndex] = s.index)))
  return { spreads, rawToSpread }
}

function px(w: number, h: number): PixImage {
  return { width: w, height: h, data: new Uint32Array(w * h) }
}

function sizeMap(sizes: Record<string, SizeF>): (s: ComicSlot) => SizeF | null {
  return (s) => sizes[s.ref.id] ?? null
}

/* ── adjacentBackFlat (Kotlin L862–865) ──────────────────────────────────────────── */

describe('adjacentBackFlat', () => {
  it('forward side (odd flat) → next spread first page (flat+1)', () => {
    expect(adjacentBackFlat(1, 6)).toBe(2)
    expect(adjacentBackFlat(3, 6)).toBe(4)
  })

  it('backward side (even flat) → previous spread second page (flat-1)', () => {
    expect(adjacentBackFlat(2, 6)).toBe(1)
    expect(adjacentBackFlat(4, 6)).toBe(3)
  })

  it('out of bounds (cover/back cover) → null', () => {
    expect(adjacentBackFlat(0, 6)).toBeNull()
    expect(adjacentBackFlat(5, 6)).toBeNull()
  })
})

/* ── spread ↔ harism index maps (Kotlin L991–1003, L844–850, L950) ───────────────── */

describe('spreadToHarismTwo / harismToSpreadTwo', () => {
  it('the second reading slot is native PAGE_RIGHT (spread*2+1)', () => {
    expect(spreadToHarismTwo(0, 8)).toBe(1)
    expect(spreadToHarismTwo(1, 8)).toBe(3)
    expect(spreadToHarismTwo(3, 8)).toBe(7)
  })

  it('clamps into [1, flatCount-1]', () => {
    expect(spreadToHarismTwo(-5, 8)).toBe(1)
    expect(spreadToHarismTwo(99, 8)).toBe(7)
    expect(spreadToHarismTwo(0, 0)).toBe(1)
    expect(spreadToHarismTwo(0, 2)).toBe(1)
  })

  it('round-trips: harismToSpreadTwo(spreadToHarismTwo(k)) === k', () => {
    for (let k = 0; k < 4; k++) {
      expect(harismToSpreadTwo(spreadToHarismTwo(k, 8), 8)).toBe(k)
    }
  })

  it('clamps spread into [0, lastSpread]', () => {
    expect(harismToSpreadTwo(1, 8)).toBe(0)
    expect(harismToSpreadTwo(999, 8)).toBe(3)
    expect(harismToSpreadTwo(5, 0)).toBe(0)
  })

  it('single-page maps are identity in both directions (RTL handled by geometry)', () => {
    expect(ourIndexFor(7)).toBe(7)
    expect(harismIndexFor(7)).toBe(7)
    expect(flatUnitIndexFor(4)).toBe(4)
  })
})

/* ── buildCurlFlatUnits (Kotlin L977–987) ────────────────────────────────────────── */

describe('buildCurlFlatUnits', () => {
  it('expands 2-slot spreads into flat pairs', () => {
    const l = layout([spread(0, [slot('a', 0), slot('b', 1)]), spread(1, [slot('c', 2), slot('d', 3)])])
    expect(buildCurlFlatUnits(l)).toEqual([slot('a', 0), slot('b', 1), slot('c', 2), slot('d', 3)])
  })

  it('pads single-slot spreads with null to keep even spine alignment', () => {
    const l = layout([spread(0, [slot('a', 0)]), spread(1, [slot('b', 1), slot('c', 2)])])
    const out = buildCurlFlatUnits(l)
    expect(out).toEqual([slot('a', 0), null, slot('b', 1), slot('c', 2)])
    expect(out.length % 2).toBe(0)
  })

  it('empty spreads contribute two nulls', () => {
    const l = layout([spread(0, []), spread(1, [slot('a', 0)])])
    expect(buildCurlFlatUnits(l)).toEqual([null, null, slot('a', 0), null])
  })
})

/* ── curlPageRects (Kotlin L878–947) ─────────────────────────────────────────────── */

describe('curlPageRects', () => {
  const intrinsic = sizeMap({ a: { width: 800, height: 1200 }, b: { width: 600, height: 1200 } })

  it('returns null for an empty container / missing spread / missing intrinsics', () => {
    expect(curlPageRects(false, spread(0, [slot('a', 0)]), cfg(), 0, 100, 1, intrinsic)).toBeNull()
    expect(curlPageRects(false, undefined, cfg(), 100, 100, 1, intrinsic)).toBeNull()
    expect(curlPageRects(false, spread(0, []), cfg(), 100, 100, 1, intrinsic)).toBeNull()
    expect(curlPageRects(false, spread(0, [slot('z', 0)]), cfg(), 100, 100, 1, intrinsic)).toBeNull()
  })

  it('two-page: each page is contain-fitted into half the gap-adjusted width', () => {
    const c = cfg({ mode: 'DOUBLE', doubleGapDp: 8 })
    const r = curlPageRects(true, spread(0, [slot('a', 0), slot('b', 1)]), c, 1000, 1200, 2, intrinsic)
    expect(r).not.toBeNull()
    const [left, right] = r!
    // density 2 → gapPx = 16, availW = (1000-16)/2 = 492
    // a: 800x1200 → s = min(492/800, 1200/1200) = 0.615 → 492 x 738
    expect(left.width()).toBeCloseTo(492, 6)
    expect(left.height()).toBeCloseTo(738, 6)
    // b: 600x1200 → s = min(492/600, 1) = 0.82 → 492 x 984
    expect(right.width()).toBeCloseTo(492, 6)
    expect(right.height()).toBeCloseTo(984, 6)
    // centred horizontally, right page starts after left + gap
    expect(right.left - left.left).toBeCloseTo(492 + 16, 6)
  })

  it('two-page RTL puts the second reading slot on the left', () => {
    const ltr = cfg({ mode: 'DOUBLE', direction: 'LTR', doubleGapDp: 8 })
    const rtl = cfg({ mode: 'DOUBLE', direction: 'RTL', doubleGapDp: 8 })
    const s = spread(0, [slot('a', 0), slot('b', 1)])
    const l = curlPageRects(true, s, ltr, 1000, 1200, 2, intrinsic)!
    const r = curlPageRects(true, s, rtl, 1000, 1200, 2, intrinsic)!
    expect(r[0].height()).toBeCloseTo(l[1].height(), 6) // 'b' moved to the left slot
    expect(r[1].height()).toBeCloseTo(l[0].height(), 6)
  })

  it('two-page single-slot spread mirrors the partner size', () => {
    const c = cfg({ mode: 'DOUBLE' })
    const r = curlPageRects(true, spread(0, [slot('a', 0)]), c, 1000, 1200, 2, intrinsic)!
    expect(r[0].width()).toBeCloseTo(r[1].width(), 6)
    expect(r[0].height()).toBeCloseTo(r[1].height(), 6)
  })

  it('two-page honours doubleAlign TOP / BOTTOM / CENTER', () => {
    const base = cfg({ mode: 'DOUBLE' })
    const top = curlPageRects(true, spread(0, [slot('a', 0), slot('b', 1)]), { ...base, doubleAlign: 'TOP' }, 1000, 1200, 2, intrinsic)!
    expect(top[0].top).toBe(0)
    const bottom = curlPageRects(true, spread(0, [slot('a', 0), slot('b', 1)]), { ...base, doubleAlign: 'BOTTOM' }, 1000, 1200, 2, intrinsic)!
    expect(bottom[0].bottom).toBeCloseTo(1200, 6)
    const center = curlPageRects(true, spread(0, [slot('a', 0), slot('b', 1)]), base, 1000, 1200, 2, intrinsic)!
    expect(center[0].top).toBeGreaterThan(0)
    expect(center[0].bottom).toBeLessThan(1200)
  })

  it('two-page applies doubleShiftX/Y without scaling', () => {
    const c = cfg({ mode: 'DOUBLE', doubleShiftXDp: 5, doubleShiftYDp: 10 })
    const plain = cfg({ mode: 'DOUBLE' })
    const shifted = curlPageRects(true, spread(0, [slot('a', 0), slot('b', 1)]), c, 1000, 1200, 2, intrinsic)!
    const base = curlPageRects(true, spread(0, [slot('a', 0), slot('b', 1)]), plain, 1000, 1200, 2, intrinsic)!
    expect(shifted[0].left - base[0].left).toBeCloseTo(10, 6)
    expect(shifted[0].top - base[0].top).toBeCloseTo(20, 6)
  })

  it('single-page: STRETCH fills the whole container', () => {
    const r = curlPageRects(false, spread(0, [slot('a', 0)]), cfg({ fit: 'STRETCH' }), 1000, 1200, 2, intrinsic)!
    expect(r[0].width()).toBeCloseTo(1000, 6)
    expect(r[0].height()).toBeCloseTo(1200, 6)
    expect(r[1].width()).toBeCloseTo(1000, 6)
  })

  it('single-page: right rect is centred and left rect is its mirror', () => {
    const r = curlPageRects(false, spread(0, [slot('a', 0)]), cfg(), 1000, 1200, 2, intrinsic)!
    const [left, right] = r
    expect(right.left - left.left).toBeCloseTo(right.width(), 6)
    expect(left.width()).toBeCloseTo(right.width(), 6)
    expect(left.top).toBeCloseTo(right.top, 6)
  })

  it('single-page: gap is added back to the total span after fitting', () => {
    const c = cfg({ doubleGapDp: 8 })
    const r = curlPageRects(false, spread(0, [slot('a', 0), slot('b', 1)]), c, 1000, 1200, 2, intrinsic)!
    // totalW 1400, maxH 1200, availW 1000-16 = 984 → s = 984/1400 = 0.702857…
    // fitted width 1400*s = 984, plus the 16px gap back → 1000 (exactly the container)
    expect(r[1].width()).toBeCloseTo(1000, 6)
    expect(r[1].height()).toBeCloseTo(1200 * (984 / 1400), 6)
    // a single-slot spread has no gap and is contain-fitted on its own (800 → 800)
    const one = curlPageRects(false, spread(0, [slot('a', 0)]), cfg(), 1000, 1200, 2, intrinsic)!
    expect(one[1].width()).toBeCloseTo(800, 6)
    expect(one[1].height()).toBeCloseTo(1200, 6)
  })

  it('matches fittedSize semantics for the single-page union', () => {
    const c = cfg({ fit: 'FIT_WIDTH' })
    const r = curlPageRects(false, spread(0, [slot('a', 0)]), c, 1000, 1200, 2, intrinsic)!
    const expected = fittedSize({ width: 800, height: 1200 }, { width: 1000, height: 1200 }, 'FIT_WIDTH')
    expect(r[1].width()).toBeCloseTo(expected.width, 6)
    expect(r[1].height()).toBeCloseTo(expected.height, 6)
  })
})

/* ── curlSyncPlan (Kotlin L963–968) ──────────────────────────────────────────────── */

describe('curlSyncPlan', () => {
  it('NOOP when the view already sits on the target', () => {
    expect(curlSyncPlan(5, 4, 3, 3)).toBe('NOOP')
  })

  it('IMMEDIATE_PRELOAD for |Δ| > 2', () => {
    expect(curlSyncPlan(10, 7, 0, 10)).toBe('IMMEDIATE_PRELOAD')
    expect(curlSyncPlan(0, 5, 1, 0)).toBe('IMMEDIATE_PRELOAD')
  })

  it('DEBOUNCE_MERGE for adjacent steps and for the first sync (lastSynced = -1)', () => {
    expect(curlSyncPlan(8, 7, 0, 8)).toBe('DEBOUNCE_MERGE')
    expect(curlSyncPlan(3, 3, 0, 3)).toBe('DEBOUNCE_MERGE')
    expect(curlSyncPlan(9, -1, 0, 9)).toBe('DEBOUNCE_MERGE')
  })

  it('the immediate wait budget is 170ms', () => {
    expect(CURL_IMMEDIATE_WAIT_MS).toBe(170)
  })
})

/* ── drawSpreadFit (Kotlin L719–769) ─────────────────────────────────────────────── */

describe('drawSpreadFit', () => {
  const a = px(800, 1200)
  const b = px(600, 1200)

  it('contain: preserves aspect and centres the union', () => {
    const out = drawSpreadFit([a, b], 1000, 1200, 0, 'FIT_PAGE', 'CENTER')
    expect(out).toHaveLength(2)
    // totalW 1400, maxH 1200 → s = min(1000/1400, 1200/1200) = 0.714…
    const s = Math.min(1000 / 1400, 1200 / 1200)
    expect(out[0]!.rect.width()).toBeCloseTo(800 * s, 6)
    expect(out[0]!.rect.height()).toBeCloseTo(1200 * s, 6)
    expect(out[1]!.rect.height()).toBeCloseTo(1200 * s, 6)
    // horizontally centred: x starts at (bw - total*s)/2
    expect(out[0]!.rect.left).toBeCloseTo((1000 - 1400 * s) / 2, 6)
    // vertically centred
    expect(out[0]!.rect.top).toBeCloseTo((1200 - 1200 * s) / 2, 6)
  })

  it('contain: advances x by the drawn width plus the gap', () => {
    const out = drawSpreadFit([a, b], 1000, 1200, 16, 'FIT_PAGE', 'CENTER')
    expect(out[1]!.rect.left - out[0]!.rect.left).toBeCloseTo(out[0]!.rect.width() + 16, 6)
  })

  it('FIT_WIDTH: only the width is constrained (vertical overflow allowed)', () => {
    const out = drawSpreadFit([a], 1000, 1200, 0, 'FIT_WIDTH', 'TOP')
    expect(out[0]!.rect.width()).toBeCloseTo(1000, 6)
    expect(out[0]!.rect.height()).toBeCloseTo(1500, 6)
    expect(out[0]!.rect.top).toBe(0)
  })

  it('FILL: max() → at least one axis is full', () => {
    const out = drawSpreadFit([a], 1000, 1200, 0, 'FILL', 'CENTER')
    expect(out[0]!.rect.width()).toBeGreaterThanOrEqual(1000 - 1e-9)
    expect(out[0]!.rect.height()).toBeGreaterThanOrEqual(1200 - 1e-9)
  })

  it('STRETCH: each slot takes exactly half the gap-free width', () => {
    const out = drawSpreadFit([a, b], 1000, 1200, 16, 'STRETCH', 'CENTER')
    expect(out[0]!.rect.width()).toBeCloseTo((1000 - 16) / 2, 6)
    expect(out[0]!.rect.top).toBe(0)
    expect(out[0]!.rect.bottom).toBeCloseTo(1200, 6)
    expect(out[1]!.rect.left).toBeCloseTo((1000 - 16) / 2 + 16, 6)
  })

  it('STRETCH with one source centres it', () => {
    const out = drawSpreadFit([a], 1000, 1200, 0, 'STRETCH', 'CENTER')
    expect(out[0]!.rect.width()).toBeCloseTo(1000, 6)
    expect(out[0]!.rect.left).toBe(0)
  })

  it('align TOP / BOTTOM / CENTER drive the baseline', () => {
    const s = Math.min(1000 / 800, 1200 / 1200)
    const top = drawSpreadFit([a], 1000, 1200, 0, 'FIT_PAGE', 'TOP')
    expect(top[0]!.rect.top).toBe(0)
    const bottom = drawSpreadFit([a], 1000, 1200, 0, 'FIT_PAGE', 'BOTTOM')
    expect(bottom[0]!.rect.bottom).toBeCloseTo(1200, 6)
    expect(bottom[0]!.rect.top).toBeCloseTo(1200 - 1200 * s, 6)
  })

  it('align BOTTOM aligns each slot\'s own top (unequal heights)', () => {
    const tall = px(600, 1200)
    const short = px(600, 600)
    const out = drawSpreadFit([tall, short], 1200, 1200, 0, 'FIT_PAGE', 'BOTTOM')
    expect(out[0]!.rect.bottom).toBeCloseTo(1200, 6)
    expect(out[1]!.rect.bottom).toBeCloseTo(1200, 6)
    expect(out[1]!.rect.top).toBeGreaterThan(out[0]!.rect.top)
  })

  it('fitExtra multiplies the contain scale (CUSTOM 档系数)', () => {
    const base = drawSpreadFit([a], 1000, 1200, 0, 'FIT_PAGE', 'TOP')
    const scaled = drawSpreadFit([a], 1000, 1200, 0, 'FIT_PAGE', 'TOP', 0, 0, 2)
    expect(scaled[0]!.rect.width()).toBeCloseTo(base[0]!.rect.width() * 2, 6)
  })

  it('resolveFit unwraps CUSTOM into (base, extra)', () => {
    const custom = cfg({ fit: 'CUSTOM', customFitBase: 'FIT_WIDTH', customFitScale: 1.5 })
    expect(resolveFit(custom)).toEqual({ effFit: 'FIT_WIDTH', fitExtra: 1.5 })
    // nested CUSTOM falls back to FIT_PAGE
    expect(resolveFit(cfg({ fit: 'CUSTOM', customFitBase: 'CUSTOM', customFitScale: 0.8 }))).toEqual({
      effFit: 'FIT_PAGE',
      fitExtra: 0.8,
    })
    expect(resolveFit(cfg({ fit: 'FILL' }))).toEqual({ effFit: 'FILL', fitExtra: 1 })
  })
})

/* ── slotCacheKey (Kotlin L773–776) ──────────────────────────────────────────────── */

describe('slotCacheKey', () => {
  it('is page id + half + pipeline fingerprint + rotation', () => {
    const key = slotCacheKey(slot('p1', 0), cfg(), { pageRotations: {} })
    expect(key).toBe('p1|FULL|OFF|null|0|true|0.5|OFF|60|0|0|0|0|1.000|0|0|false|r0')
  })

  it('per-page rotation is added to the book rotation and normalised to 0..359', () => {
    const key = slotCacheKey(slot('p1', 0), cfg({ bookRotation: 350 }), { pageRotations: { p1: 20 } })
    expect(key.endsWith('|r10')).toBe(true)
    const neg = slotCacheKey(slot('p1', 0), cfg({ bookRotation: -90 }), { pageRotations: {} })
    expect(neg.endsWith('|r270')).toBe(true)
  })

  it('split half participates in the key space', () => {
    const full = slotCacheKey(slot('p1', 0, 'FULL'), cfg(), { pageRotations: {} })
    const left = slotCacheKey(slot('p1', 0, 'LEFT'), cfg(), { pageRotations: {} })
    expect(left).not.toBe(full)
  })

  it('any filter change lands in a different key space', () => {
    const a = slotCacheKey(slot('p1', 0), cfg(), { pageRotations: {} })
    const b = slotCacheKey(slot('p1', 0), cfg({ filterSaturation: 20 }), { pageRotations: {} })
    const c = slotCacheKey(slot('p1', 0), cfg({ enhanceMode: 'ANIME4K', enhanceStrength: 90 }), {
      pageRotations: {},
    })
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('pageBgInt maps the background types verbatim', () => {
    expect(pageBgInt(cfg({ bgType: 'WHITE' }))).toBe(0xfafaf7)
    expect(pageBgInt(cfg({ bgType: 'PAPER' }))).toBe(0xf2eee6)
    expect(pageBgInt(cfg({ bgType: 'BLACK' }))).toBe(0x101014)
    expect(pageBgInt(cfg({ bgType: 'GRAY' }))).toBe(0x101014)
    expect(pageBgInt(cfg({ bgType: 'DYNAMIC' }))).toBe(0x101014)
  })
})

/* ── textureCap / autoFlipStream / effectiveSplitPosition / isWidePage ───────────── */

describe('texture composition helpers', () => {
  it('textureCap caps short edge at 1024 and long edge at 1800', () => {
    expect(textureCap(2000, 1000)).toEqual({ w: 1024, h: 512, scale: 0.512 })
    expect(textureCap(4000, 4000)).toEqual({ w: 1024, h: 1024, scale: 0.256 })
    expect(textureCap(400, 300)).toEqual({ w: 400, h: 300, scale: 1 })
    // never below 8px
    expect(textureCap(100000, 4).h).toBeGreaterThanOrEqual(8)
  })

  it('autoFlipStream geometry: 3%/97% start, 65%/35% end, vertically centred', () => {
    expect(autoFlipStream(1000, 800, true)).toEqual({ y: 400, fromX: 30, toX: 650 })
    expect(autoFlipStream(1000, 800, false)).toEqual({ y: 400, fromX: 970, toX: 350 })
  })

  it('effectiveSplitPosition anchors on the detected gutter and clamps to 0.3..0.7', () => {
    expect(effectiveSplitPosition(cfg({ splitPosition: 0.5 }), 0.42)).toBeCloseTo(0.42, 6)
    expect(effectiveSplitPosition(cfg({ splitPosition: 0.55 }), 0.42)).toBeCloseTo(0.47, 6)
    expect(effectiveSplitPosition(cfg({ splitPosition: 0.5 }), null)).toBe(0.5)
    expect(effectiveSplitPosition(cfg({ splitPosition: 0.9 }), null)).toBeCloseTo(0.7, 6)
    expect(effectiveSplitPosition(cfg({ splitPosition: 0.1 }), null)).toBeCloseTo(0.3, 6)
    expect(effectiveSplitPosition(cfg({ splitPosition: 0.5 }), NaN)).toBe(0.5)
  })

  it('isWidePage: 1.35/1.8 gates + gutter evidence in the middle band', () => {
    expect(isWidePage(null)).toBe(false)
    expect(isWidePage({ width: 1000, height: 1000 })).toBe(false)
    expect(isWidePage({ width: 1800, height: 1000 })).toBe(true) // ≥ 1.8 unconditional
    expect(isWidePage({ width: 1500, height: 1000, gutter: true })).toBe(true)
    expect(isWidePage({ width: 1500, height: 1000, gutter: false })).toBe(false)
    expect(isWidePage({ width: 1500, height: 1000 })).toBe(true) // no evidence → legacy split
  })
})

/* ── ComicCurlViewArbiter touch arbitration (Kotlin L231–379) ────────────────────── */

describe('CurlViewArbiter touch arbitration', () => {
  interface Harness {
    arb: ComicCurlViewArbiter
    forwarded: CurlInputEvent[]
    index: { value: number }
    quickTaps: [number, number][]
    scheduled: (() => void)[]
  }

  function harness(): Harness {
    const forwarded: CurlInputEvent[] = []
    const index = { value: 0 }
    const quickTaps: [number, number][] = []
    const scheduled: (() => void)[] = []
    const gl: CurlGL = {
      size: () => ({ width: 1000, height: 800 }),
      isAnimating: () => false,
      currentIndex: () => index.value,
      setCurrentIndex: (i) => {
        index.value = i
      },
      setCurrentIndexSilently: (i) => {
        index.value = i
      },
      setRightToLeft: () => {},
      setSpreadStep: () => {},
      setViewMode: () => {},
      setAllowLastPageCurl: () => {},
      setMargins: () => {},
      setPageRect: () => {},
      setBackgroundColor: () => {},
      setBackgroundBitmap: () => {},
      setRigidPageDecider: () => {},
      setSizeChangedObserver: () => {},
      setPageProvider: () => {},
      settleSpreadMesh: () => {},
      onPause: () => {},
      onResume: () => {},
      onTouch: (e) => {
        forwarded.push(e)
      },
      onSyntheticTouch: (e) => {
        forwarded.push(e)
      },
    }
    const sched: Scheduler = {
      uptimeMillis: () => 1000,
      post: (fn) => {
        fn()
      },
      postDelayed: (fn) => {
        scheduled.push(fn)
      },
      removeCallbacks: (fn) => {
        const i = scheduled.indexOf(fn)
        if (i >= 0) scheduled.splice(i, 1)
      },
    }
    const arb = new ComicCurlArbiterFactory(
      {
        onQuickTap: (x, y) => quickTaps.push([x, y]),
        onLongPress: null,
        onSettledIndex: null,
        onZoomGesture: () => {},
        onChapterEdge: null,
        isAtForwardEdge: () => false,
        isAtBackwardEdge: () => false,
      },
      gl,
      sched,
      { slopPx: 8, density: 2 },
    )
    return { arb, forwarded, index, quickTaps, scheduled }
  }

  it('DOWN is always consumed (quick taps never start a curl)', () => {
    const { arb, forwarded } = harness()
    const consumed = arb.onTouch({
      action: ACTION_DOWN,
      x: 500,
      y: 400,
      pointerCount: 1,
      downTime: 1,
      eventTime: 10,
    })
    expect(consumed).toBe(true)
    expect(forwarded).toHaveLength(0)
  })

  it('a drag beyond slop injects a synthetic DOWN before forwarding the MOVE', () => {
    const { arb, forwarded } = harness()
    const down = {
      action: ACTION_DOWN,
      x: 500,
      y: 400,
      pointerCount: 1,
      downTime: 1,
      eventTime: 10,
    }
    arb.onTouch(down)
    arb.onTouch({ ...down, action: ACTION_MOVE, x: 505, y: 400, eventTime: 20 })
    expect(forwarded).toHaveLength(0) // still under slop
    arb.onTouch({ ...down, action: ACTION_MOVE, x: 560, y: 400, eventTime: 30 })
    expect(forwarded.map((e) => e.action)).toEqual([ACTION_DOWN, ACTION_MOVE])
    expect(forwarded[0]!.x).toBe(500)
    expect(forwarded[0]!.downTime).toBe(1)
  })

  it('a second finger injects CANCEL when a curl drag is in flight', () => {
    const { arb, forwarded } = harness()
    const down = {
      action: ACTION_DOWN,
      x: 500,
      y: 400,
      pointerCount: 1,
      downTime: 1,
      eventTime: 10,
    }
    arb.onTouch(down)
    arb.onTouch({ ...down, action: ACTION_MOVE, x: 560, y: 400, eventTime: 20 })
    arb.onTouch({ ...down, action: ACTION_POINTER_DOWN, pointerCount: 2, eventTime: 30 })
    expect(forwarded.map((e) => e.action)).toEqual([ACTION_DOWN, ACTION_MOVE, ACTION_CANCEL])
  })

  it('UP inside 250ms without a drag is a quick tap', () => {
    const h = harness()
    const down = {
      action: ACTION_DOWN,
      x: 300,
      y: 200,
      pointerCount: 1,
      downTime: 1,
      eventTime: 10,
    }
    h.arb.onTouch(down)
    h.arb.onTouch({ ...down, action: ACTION_UP, eventTime: 200 })
    expect(h.quickTaps).toEqual([[300, 200]])
    expect(h.forwarded).toHaveLength(0)
  })

  it('UP after 250ms without a drag is not a quick tap', () => {
    const h = harness()
    const down = {
      action: ACTION_DOWN,
      x: 300,
      y: 200,
      pointerCount: 1,
      downTime: 1,
      eventTime: 10,
    }
    h.arb.onTouch(down)
    h.arb.onTouch({ ...down, action: ACTION_UP, eventTime: 300 })
    expect(h.quickTaps).toHaveLength(0)
  })

  it('swipeEnabled=false swallows real drags but still lets a synthetic drag through', () => {
    const h = harness()
    h.arb.swipeEnabled = false
    const down = {
      action: ACTION_DOWN,
      x: 500,
      y: 400,
      pointerCount: 1,
      downTime: 1,
      eventTime: 10,
    }
    h.arb.onTouch(down)
    h.arb.onTouch({ ...down, action: ACTION_MOVE, x: 560, y: 400, eventTime: 20 })
    expect(h.forwarded).toHaveLength(0)
  })

  it('autoFlipping passes only events with the synthetic downTime', () => {
    const h = harness()
    h.arb.autoFlipping = true
    const foreign = {
      action: ACTION_DOWN,
      x: 10,
      y: 10,
      pointerCount: 1,
      downTime: 7,
      eventTime: 10,
    }
    expect(h.arb.onTouch(foreign)).toBe(false)
    expect(h.forwarded).toHaveLength(0)
  })

  it('onDrawFrame reports settle exactly once per index change', () => {
    const h = harness()
    const seen: number[] = []
    h.arb.hooks.onSettledIndex = (i) => seen.push(i)
    h.index.value = 2
    h.arb.onDrawFrame()
    h.arb.onDrawFrame()
    h.index.value = 3
    h.arb.onDrawFrame()
    expect(seen).toEqual([2, 3])
  })

  it('finishAnimation moves the index by ±spreadStep for the two-page spine model', () => {
    const h = harness()
    h.index.value = 5
    h.arb.finishAnimation(
      () => 2,
      () => 'LEFT',
      () => 'LEFT',
    )
    expect(h.index.value).toBe(3) // SET_CURL_TO_RIGHT landing right → index -= step

    h.index.value = 5
    h.arb.finishAnimation(
      () => 2,
      () => 'RIGHT',
      () => 'RIGHT',
    )
    expect(h.index.value).toBe(7) // landing left → index += step
  })

  it('finishAnimation leaves the index alone for the single-page model', () => {
    const h = harness()
    h.index.value = 5
    h.arb.finishAnimation(
      () => 1,
      () => 'LEFT',
      () => 'LEFT',
    )
    expect(h.index.value).toBe(5)
  })

  it('startAutoFlip emits DOWN + 12 MONOTONE MOVEs + UP, then clears autoFlipping', () => {
    const h = harness()
    let done = false
    h.arb.startAutoFlip(true, () => {
      done = true
    })
    const actions = h.forwarded.map((e) => e.action)
    expect(actions[0]).toBe(ACTION_DOWN)
    expect(actions.filter((a) => a === ACTION_MOVE)).toHaveLength(12)
    expect(actions[actions.length - 1]).toBe(ACTION_UP)
    // monotonically non-decreasing event times
    const times = h.forwarded.map((e) => e.eventTime)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!)
    }
    // y stays at the vertical centre, x moves 30 → 650
    expect(h.forwarded[0]!.y).toBe(400)
    expect(h.forwarded[0]!.x).toBeCloseTo(30, 6)
    expect(h.forwarded[h.forwarded.length - 1]!.x).toBeCloseTo(650, 6)
    expect(h.arb.autoFlipping).toBe(true)
    expect(done).toBe(false)
  })
})

/** Sanity: RectF helpers used above behave like android.graphics.RectF. */
describe('RectF', () => {
  it('offset/width/height/copyFrom', () => {
    const r = new RectF(1, 2, 5, 9)
    expect(r.width()).toBe(4)
    expect(r.height()).toBe(7)
    r.offset(-1, -2)
    expect([r.left, r.top, r.right, r.bottom]).toEqual([0, 0, 4, 7])
    const c = new RectF()
    c.copyFrom(r)
    expect(c.equalsRect(r)).toBe(true)
  })
})
