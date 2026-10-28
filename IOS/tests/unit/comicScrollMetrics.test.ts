/**
 * comicScrollMetrics.test.ts — 钉死 Android `ComicScrollMetrics.kt`（L1-L46）边界行为。
 * 端口：`src/core/comic/comicScrollMetrics.ts`。
 */
import { describe, expect, it } from 'vitest';
import { ComicScrollMetrics } from '@core/comic/comicScrollMetrics';

interface MetricsOverrides {
  itemSizes: readonly number[]
  itemSpacing: number
  viewportSize: number
  firstVisibleItemIndex: number
  firstVisibleItemScrollOffset: number
  canScrollBackward: boolean
  canScrollForward: boolean
}

function metrics(over: Partial<MetricsOverrides> = {}) {
  const itemSizes = over.itemSizes ?? [100, 200, 300]
  const itemSpacing = over.itemSpacing ?? 10
  const viewportSize = over.viewportSize ?? 250
  const firstVisibleItemIndex = over.firstVisibleItemIndex ?? 0
  const firstVisibleItemScrollOffset = over.firstVisibleItemScrollOffset ?? 0
  const canScrollBackward = over.canScrollBackward ?? true
  const canScrollForward = over.canScrollForward ?? true
  return new ComicScrollMetrics(
    itemSizes,
    itemSpacing,
    viewportSize,
    firstVisibleItemIndex,
    firstVisibleItemScrollOffset,
    canScrollBackward,
    canScrollForward,
  )
}

describe('init 的 starts / scrollRange 计算（L18-L26）', () => {
  it('高度按 实测高 + 间距（末项不加间距）累加', () => {
    const m = metrics({ itemSizes: [100, 200, 300], itemSpacing: 10, viewportSize: 0 })
    // total = 100 + 10 + 200 + 10 + 300 = 620；viewport 0 → scrollRange 620
    expect(m.fraction).toBe(0)
  })

  it('itemSpacing < 0 时按 0 处理（L23 coerceAtLeast(0)）', () => {
    const m = metrics({ itemSizes: [100, 100], itemSpacing: -50, viewportSize: 0 })
    // total = 100 + 0 + 100 = 200；scrollRange 200 → 中点 pixel 100 落在第二项
    expect(m.target(0.5)).toEqual({ index: 1, offset: 0 })
    // 第二项起点 pixel = 100
    expect(m.target(100 / 200)).toEqual({ index: 1, offset: 0 })
    // 第一项内部 pixel 50
    expect(m.target(50 / 200)).toEqual({ index: 0, offset: 50 })
  })

  it('itemSizes 含 0 高度时按 1 处理（L22 coerceAtLeast(1)）', () => {
    const m = metrics({ itemSizes: [0, 100], itemSpacing: 0, viewportSize: 0 })
    // total = 1 + 100 = 101；starts = [0, 1]
    expect(m.target(0)).toEqual({ index: 0, offset: 0 })
    // pixel 1 → 第二项起点
    expect(m.target(1 / 101)).toEqual({ index: 1, offset: 0 })
  })

  it('viewportSize < 0 → 按 0；内容短于视口 → scrollRange 0', () => {
    const m = metrics({ itemSizes: [100], itemSpacing: 0, viewportSize: -10 })
    expect(m.fraction).toBe(0)
    // scrollRange = max(100 - 0, 0) = 100 → 中点 pixel 50 仍落在唯一一项内
    expect(m.target(0.5)).toEqual({ index: 0, offset: 50 })
  })

  it('内容短于视口 → scrollRange 0 → target 恒为 (0,0)', () => {
    const m = metrics({ itemSizes: [50], itemSpacing: 0, viewportSize: 500 })
    expect(m.fraction).toBe(0)
    expect(m.target(0.5)).toEqual({ index: 0, offset: 0 })
  })
})

describe('fraction（L28-L34）', () => {
  it('itemSizes 为空 → 0', () => {
    const m = metrics({ itemSizes: [] })
    expect(m.fraction).toBe(0)
  })

  it('不能向后滚 → 0（顶部）', () => {
    const m = metrics({ canScrollBackward: false })
    expect(m.fraction).toBe(0)
  })

  it('不能向前滚 → 1（已到底）', () => {
    const m = metrics({ canScrollForward: false })
    expect(m.fraction).toBe(1)
  })

  it('首项顶部 → 0；末项底部 → 1', () => {
    const base = { itemSizes: [100, 200, 300], itemSpacing: 10, viewportSize: 200 }
    expect(metrics({ ...base, firstVisibleItemIndex: 0, firstVisibleItemScrollOffset: 0 }).fraction).toBe(0)
    const m = metrics({ ...base, firstVisibleItemIndex: 2, firstVisibleItemScrollOffset: 300 })
    // scrollRange = 420；末项底部 = starts[2] 320 + 300 = 620 → 620/420 > 1 → 钳 1
    expect(m.fraction).toBe(1)
  })

  it('中段按像素线性', () => {
    const base = { itemSizes: [100, 200, 300], itemSpacing: 10, viewportSize: 200 }
    const m = metrics({ ...base, firstVisibleItemIndex: 1, firstVisibleItemScrollOffset: 0 })
    // starts[1] = 110；scrollRange = 620 - 200 = 420 → 110/420
    expect(m.fraction).toBeCloseTo(110 / 420, 10)
  })

  it('firstVisibleItemIndex 越界被钳制；负 offset 按 0', () => {
    const base = { itemSizes: [100, 200, 300], itemSpacing: 10, viewportSize: 200 }
    const m = metrics({ ...base, firstVisibleItemIndex: 99, firstVisibleItemScrollOffset: -50 })
    // starts = [0, 110, 320]（间距 10 加在非末项）；钳到 index 2 → 320，offset 0
    // scrollRange = 620 - 200 = 420 → 320/420
    expect(m.fraction).toBeCloseTo(320 / 420, 10)
  })
})

describe('target（L37-L43）', () => {
  it('空列表 → (0, 0)', () => {
    const m = metrics({ itemSizes: [] })
    expect(m.target(0.5)).toEqual({ index: 0, offset: 0 })
  })

  it('fraction 非有限（NaN）→ 按 0 处理', () => {
    const m = metrics({ itemSizes: [100, 200], itemSpacing: 0, viewportSize: 0 })
    expect(m.target(Number.NaN)).toEqual({ index: 0, offset: 0 })
    expect(m.target(Number.POSITIVE_INFINITY)).toEqual({ index: 0, offset: 0 })
  })

  it('fraction 出界被钳制', () => {
    const m = metrics({ itemSizes: [100, 200], itemSpacing: 0, viewportSize: 0 })
    expect(m.target(-5)).toEqual({ index: 0, offset: 0 })
    expect(m.target(5)).toEqual({ index: 1, offset: 200 })
  })

  it('落点反算到项内像素偏移（indexOfLast { it <= pixel }）', () => {
    const m = metrics({ itemSizes: [100, 200, 300], itemSpacing: 10, viewportSize: 0 })
    // starts = [0, 110, 320]；total = 620；scrollRange = 620
    expect(m.target(0)).toEqual({ index: 0, offset: 0 })
    expect(m.target(99 / 620)).toEqual({ index: 0, offset: 99 })
    // pixel 110 = starts[1] → 落在第二项起点
    expect(m.target(110 / 620)).toEqual({ index: 1, offset: 0 })
    expect(m.target(200 / 620)).toEqual({ index: 1, offset: 90 })
    // pixel 620 → index 2，offset = 620 - 320 = 300
    expect(m.target(1)).toEqual({ index: 2, offset: 300 })
  })

  it('roundToLong：像素取整到最近整数（Math.round 与 Kotlin roundToLong 同为远离零）', () => {
    const m = metrics({ itemSizes: [100, 200], itemSpacing: 0, viewportSize: 0 })
    // starts = [0, 100]；total = 300；pixel = round(0.335 * 300) = round(100.5) = 101
    // → index 1，offset 1
    expect(m.target(0.335)).toEqual({ index: 1, offset: 1 })
  })
})
