/**
 * comicScrollMetrics.test.ts — 逐条移植 Android
 * `app/src/test/java/com/example/ui/comic/ComicScrollMetricsTest.kt`（5 个 @Test）。
 *
 * 被测实现：`src/core/comic/comicScrollMetrics.ts`（ComicScrollMetrics / ComicScrollTarget）
 *
 * 行号对照见每个 it() 的注释。
 */
import { describe, expect, it } from 'vitest'

import { ComicScrollMetrics } from '@core/comic/comicScrollMetrics'

/**
 * Kotlin `metrics(...)`（L7-L9）：
 * ComicScrollMetrics(sizes, spacing, viewport, index, offset, backward, forward)
 */
function metrics(
  sizes: readonly number[],
  index = 0,
  offset = 0,
  spacing = 0,
  viewport = 600,
  backward = true,
  forward = true,
): ComicScrollMetrics {
  return new ComicScrollMetrics(sizes, spacing, viewport, index, offset, backward, forward)
}

/** Kotlin `data class` 的 `copy(...)`。 */
function copy(
  m: ComicScrollMetrics,
  patch: {
    firstVisibleItemIndex?: number
    firstVisibleItemScrollOffset?: number
    canScrollBackward?: boolean
    canScrollForward?: boolean
  },
): ComicScrollMetrics {
  return new ComicScrollMetrics(
    m.itemSizes,
    m.itemSpacing,
    m.viewportSize,
    patch.firstVisibleItemIndex ?? m.firstVisibleItemIndex,
    patch.firstVisibleItemScrollOffset ?? m.firstVisibleItemScrollOffset,
    patch.canScrollBackward ?? m.canScrollBackward,
    patch.canScrollForward ?? m.canScrollForward,
  )
}

describe('ComicScrollMetricsTest（Android ComicScrollMetricsTest.kt，5 个测试）', () => {
  it('singleLongImageProgressChangesWithoutChangingThePage — 长图内滚动进度变化但不换页（Kotlin L11-L18）', () => {
    const start = metrics([1800], 0, 0, 0, 600, false, true)
    expect(start.fraction).toBe(0)
    expect(copy(start, { firstVisibleItemScrollOffset: 300, canScrollBackward: true }).fraction).toBe(0.25)
    expect(copy(start, { firstVisibleItemScrollOffset: 600, canScrollBackward: true }).fraction).toBe(0.5)
    expect(
      copy(start, {
        firstVisibleItemScrollOffset: 1200,
        canScrollBackward: true,
        canScrollForward: false,
      }).fraction,
    ).toBe(1)
  })

  it('lastImageDoesNotReportCompletionUntilItsBottomIsVisible — 末图底部可见前不报完成（Kotlin L20-L25）', () => {
    const last = metrics([600, 1800], 1)
    expect(last.fraction).toBeCloseTo(1 / 3, 5)
    expect(copy(last, { firstVisibleItemScrollOffset: 600 }).fraction).toBeCloseTo(2 / 3, 5)
    expect(
      copy(last, { firstVisibleItemScrollOffset: 1200, canScrollForward: false }).fraction,
    ).toBe(1)
  })

  it('mixedHeightsAndSpacingHaveContinuousProgressAcrossItemBoundaries — 混合高度+间距跨项边界连续（Kotlin L27-L34）', () => {
    const before = metrics([400, 1200, 800], 0, 419, 20)
    const after = copy(before, { firstVisibleItemIndex: 1, firstVisibleItemScrollOffset: 0 })
    expect(after.fraction).toBeGreaterThan(before.fraction)
    expect(after.fraction).toBeCloseTo(420 / 1840, 5)
    expect(before.target(after.fraction)).toEqual({ index: 1, offset: 0 })
    expect(before.target(1)).toEqual({ index: 2, offset: 200 })
  })

  it('sliderSeeksWithinOneImageAndCanReturnToEitherBoundary — 滑条在单图内定位且可回到两端（Kotlin L36-L43）', () => {
    const scroll = metrics([1800], 0, 0, 0, 600, false, true)
    expect(scroll.target(0)).toEqual({ index: 0, offset: 0 })
    expect(scroll.target(0.75)).toEqual({ index: 0, offset: 900 })
    expect(scroll.target(1)).toEqual({ index: 0, offset: 1200 })
    expect(scroll.target(Number.NaN)).toEqual({ index: 0, offset: 0 })
    expect(scroll.target(2)).toEqual({ index: 0, offset: 1200 })
  })

  it('emptyAndShortChaptersHaveFiniteProgressAndSafeSeekTargets — 空/短章节进度有限且落点安全（Kotlin L45-L51）', () => {
    for (const sizes of [[], [300], [100, 150]] as const) {
      const scroll = metrics(sizes as readonly number[], 0, 0, 0, 600, false, false)
      expect(scroll.fraction).toBe(0)
      expect(scroll.target(1)).toEqual({ index: 0, offset: 0 })
    }
  })
})