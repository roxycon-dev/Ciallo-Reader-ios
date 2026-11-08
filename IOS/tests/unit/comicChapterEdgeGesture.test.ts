/**
 * comicChapterEdgeGesture.test.ts — 钉死 Android `ComicChapterEdgeGesture.kt`（L1-L109）
 * 的纯逻辑部分。端口：`src/core/comic/comicChapterEdgeGesture.ts`。
 */
import { describe, expect, it } from 'vitest';
import {
  CHAPTER_EDGE_THRESHOLD_DP,
  COMIC_CHAPTER_EDGE_SPRING,
  TOUCH_SLOP_PX,
  comicChapterEdgeAxisDecision,
  comicChapterEdgeDelta,
  comicChapterEdgeDampedOffset,
  comicChapterEdgeSign,
  comicChapterEdgeTarget,
} from '@core/comic/comicChapterEdgeGesture';

describe('comicChapterEdgeTarget（L21-L25）', () => {
  it('在首页且拖动 ≥ 阈值 → -1（回退上一章）', () => {
    expect(comicChapterEdgeTarget(CHAPTER_EDGE_THRESHOLD_DP, true, false, CHAPTER_EDGE_THRESHOLD_DP)).toBe(-1)
    expect(comicChapterEdgeTarget(200, true, false, 48)).toBe(-1)
  })

  it('在末页且拖动 ≤ -阈值 → 1（前进下一章）', () => {
    expect(comicChapterEdgeTarget(-CHAPTER_EDGE_THRESHOLD_DP, false, true, CHAPTER_EDGE_THRESHOLD_DP)).toBe(1)
    expect(comicChapterEdgeTarget(-200, false, true, 48)).toBe(1)
  })

  it('阈值是闭区间（边界值即触发）', () => {
    expect(comicChapterEdgeTarget(48, true, false, 48)).toBe(-1)
    expect(comicChapterEdgeTarget(-48, false, true, 48)).toBe(1)
  })

  it('不足阈值 → 0', () => {
    expect(comicChapterEdgeTarget(10, true, false, 48)).toBe(0)
    expect(comicChapterEdgeTarget(-10, false, true, 48)).toBe(0)
  })

  it('不在首末页 → 0', () => {
    expect(comicChapterEdgeTarget(200, false, false, 48)).toBe(0)
    expect(comicChapterEdgeTarget(-200, false, false, 48)).toBe(0)
  })

  it('同时在首末页（单页书）：当判据 `when` 顺序，先命中 atStart → -1；反向 → 1（L21-L25）', () => {
    // Kotlin 的 `when { a -> … ; b -> … }` 顺序求值，首个为真即返回
    expect(comicChapterEdgeTarget(200, true, true, 48)).toBe(-1)
    expect(comicChapterEdgeTarget(-200, true, true, 48)).toBe(1)
  })
})

describe('comicChapterEdgeSign（L46）', () => {
  it('RTL → -1，其余 → +1', () => {
    expect(comicChapterEdgeSign(true)).toBe(-1)
    expect(comicChapterEdgeSign(false)).toBe(1)
  })
})

describe('comicChapterEdgeDelta（L68-L70）', () => {
  it('vertical（TTB）：axis 取 y×sign，cross 取 x', () => {
    expect(comicChapterEdgeDelta(30, -70, true, 1)).toEqual({ axis: -70, cross: 30 })
    expect(comicChapterEdgeDelta(30, -70, true, -1)).toEqual({ axis: 70, cross: 30 })
  })

  it('horizontal：axis 取 x×sign，cross 取 y', () => {
    expect(comicChapterEdgeDelta(70, 30, false, 1)).toEqual({ axis: 70, cross: 30 })
    expect(comicChapterEdgeDelta(70, 30, false, -1)).toEqual({ axis: -70, cross: 30 })
  })
})

describe('comicChapterEdgeAxisDecision（L71-L79）', () => {
  it('已 active → 继续接管', () => {
    expect(
      comicChapterEdgeAxisDecision({ active: true, axis: 1, cross: 999, slop: 8, start: true, end: false }),
    ).toBe('active')
  })

  it('跨轴占优 → cross-axis（让位，L72）', () => {
    expect(
      comicChapterEdgeAxisDecision({ active: false, axis: 20, cross: 60, slop: 8, start: true, end: false }),
    ).toBe('cross-axis')
  })

  it('未过 slop → too-small（继续等，L73-L75）', () => {
    expect(
      comicChapterEdgeAxisDecision({ active: false, axis: 3, cross: 1, slop: 8, start: true, end: false }),
    ).toBe('too-small')
    expect(
      comicChapterEdgeAxisDecision({ active: false, axis: 8, cross: 0, slop: 8, start: true, end: false }),
    ).toBe('too-small')
  })

  it('方向不符 → wrong-way（让位，L77）', () => {
    // start 但往负方向拖
    expect(
      comicChapterEdgeAxisDecision({ active: false, axis: -60, cross: 2, slop: 8, start: true, end: false }),
    ).toBe('wrong-way')
    // end 但往正方向拖
    expect(
      comicChapterEdgeAxisDecision({ active: false, axis: 60, cross: 2, slop: 8, start: false, end: true }),
    ).toBe('wrong-way')
    // 中间页（既非首也非末）一律 wrong-way
    expect(
      comicChapterEdgeAxisDecision({ active: false, axis: 60, cross: 2, slop: 8, start: false, end: false }),
    ).toBe('wrong-way')
  })

  it('首页外翻 / 末页外翻 → active', () => {
    expect(
      comicChapterEdgeAxisDecision({ active: false, axis: 60, cross: 2, slop: 8, start: true, end: false }),
    ).toBe('active')
    expect(
      comicChapterEdgeAxisDecision({ active: false, axis: -60, cross: 2, slop: 8, start: false, end: true }),
    ).toBe('active')
  })

  it('TOUCH_SLOP_PX = 8（Android 默认 touchSlop 8dp）', () => {
    expect(TOUCH_SLOP_PX).toBe(8)
  })
})

describe('comicChapterEdgeDampedOffset（L90-L97）', () => {
  it('首页向外拖（axis>0）→ 正向阻尼位移 × sign', () => {
    const off = comicChapterEdgeDampedOffset({ axis: 100, start: true, end: false, span: 1000, sign: 1 })
    // damped = 100 / (1 + 100/1000) = 100 / 1.1 = 90.909…
    expect(off).toBeCloseTo(90.909, 3)
  })

  it('末页向外拖（axis<0）→ 负向阻尼位移 × sign', () => {
    const off = comicChapterEdgeDampedOffset({ axis: -100, start: false, end: true, span: 1000, sign: 1 })
    expect(off).toBeCloseTo(-90.909, 3)
  })

  it('sign = -1（RTL）时方向翻转', () => {
    const off = comicChapterEdgeDampedOffset({ axis: -100, start: false, end: true, span: 1000, sign: -1 })
    expect(off).toBeCloseTo(90.909, 3)
  })

  it('非外翻方向（首页往内拖 / 中间页）→ 0（L91-L95）', () => {
    expect(comicChapterEdgeDampedOffset({ axis: -100, start: true, end: false, span: 1000, sign: 1 })).toBe(0)
    expect(comicChapterEdgeDampedOffset({ axis: 100, start: false, end: true, span: 1000, sign: 1 })).toBe(0)
    expect(comicChapterEdgeDampedOffset({ axis: 0, start: true, end: true, span: 1000, sign: 1 })).toBe(0)
  })

  it('span < 1 时按 1 处理（L96 coerceAtLeast(1f)）', () => {
    const a = comicChapterEdgeDampedOffset({ axis: 100, start: true, end: false, span: 0, sign: 1 })
    const b = comicChapterEdgeDampedOffset({ axis: 100, start: true, end: false, span: 1, sign: 1 })
    expect(a).toBe(b)
    // damped = 100 / (1 + 100/1) = 100/101 = 0.990…
    expect(a).toBeCloseTo(100 / 101, 6)
  })

  it('阻尼恒小于原始位移（渐近趋近 span/2）', () => {
    for (const axis of [10, 50, 100, 500, 5000]) {
      const off = comicChapterEdgeDampedOffset({ axis, start: true, end: false, span: 1000, sign: 1 })
      expect(off).toBeGreaterThanOrEqual(0)
      expect(off).toBeLessThan(axis)
    }
  })
})

describe('常量', () => {
  it('阈值 48dp；回弹 spring(0.85, 380)（L48/L102）', () => {
    expect(CHAPTER_EDGE_THRESHOLD_DP).toBe(48)
    expect(COMIC_CHAPTER_EDGE_SPRING.dampingRatio).toBe(0.85)
    expect(COMIC_CHAPTER_EDGE_SPRING.stiffness).toBe(380)
  })
})
