/**
 * comicPageLayout.test.ts — 钉死 Android `ComicPageLayout.kt` 的边界行为。
 * 端口：`src/core/comic/comicPageLayout.ts`（逐行移植 ComicPageLayout.kt L1-L251）。
 */
import { describe, expect, it } from 'vitest';
import {
  HARD_WIDE_ASPECT,
  WIDE_ASPECT,
  buildComicLayout,
  comicModeLabel,
  comicDirectionLabel,
  comicLayout,
  comicPageRefLocal,
  comicPageRefRemote,
  comicScrollStrategyForConfig,
  engineFadeAlpha,
  isWidePage,
  sizeI,
  spreadIndexOf,
  spreadOfRawPage,
  verticalPreloadIndices,
  type ComicReaderConfig,
} from '@core/comic/comicPageLayout';

function cfg(over: Partial<ComicReaderConfig> = {}): ComicReaderConfig {
  return {
    mode: 'SINGLE',
    direction: 'LTR',
    splitWide: true,
    splitReverse: false,
    doubleFirstAlone: false,
    pageSpacingDp: 8,
    webtoonSnap: true,
    manualCrop: null,
    showThumbPreview: true,
    ...over,
  }
}

const p = (id: string) => comicPageRefLocal(id, `/tmp/${id}.jpg`)

describe('label 表（ComicReaderConfig.kt L244/L249/L291 逐字）', () => {
  it('mode / direction 中文标签与 Kotlin 一致', () => {
    expect(comicModeLabel('SINGLE')).toBe('单页')
    expect(comicModeLabel('DOUBLE')).toBe('双页')
    expect(comicModeLabel('WEBTOON')).toBe('条漫')
    expect(comicModeLabel('CONTINUOUS')).toBe('无缝滚动')
    expect(comicModeLabel('MAGNETIC')).toBe('磁吸')
    expect(comicDirectionLabel('LTR')).toBe('左 → 右')
    expect(comicDirectionLabel('RTL')).toBe('右 → 左')
    expect(comicDirectionLabel('TTB')).toBe('上 → 下')
  })
})

describe('ComicPageRef / SizeI', () => {
  it('Local 默认无 headers；Remote 默认 headers={} referer=null', () => {
    const local = comicPageRefLocal('a', '/a.jpg')
    expect(local.kind).toBe('local')
    const remote = comicPageRefRemote('b', 'https://x/b.jpg')
    expect(remote.kind).toBe('remote')
    if (remote.kind === 'remote') {
      expect(remote.headers).toEqual({})
      expect(remote.referer).toBeNull()
    }
  })

  it('aspect: height>0 → w/h；height=0 → 0（L31）', () => {
    expect(sizeI(1000, 500).aspect).toBe(2)
    expect(sizeI(1000, 0).aspect).toBe(0)
    expect(sizeI(1000, -5).aspect).toBe(0)
  })
})

describe('isWidePage（L148-L154）', () => {
  it('null 尺寸 → false', () => {
    expect(isWidePage(null)).toBe(false)
  })

  it('aspect < 1.35 → false', () => {
    expect(isWidePage(sizeI(1000, 800))).toBe(false)
    expect(WIDE_ASPECT).toBe(1.35)
  })

  it('aspect >= 1.8 → 无条件 true（无需 gutter 佐证）', () => {
    expect(HARD_WIDE_ASPECT).toBe(1.8)
    expect(isWidePage(sizeI(1800, 1000))).toBe(true)
    expect(isWidePage(sizeI(1800, 1000, false))).toBe(true)
  })

  it('1.35 <= aspect < 1.8：有 gutter 结果按结果定；无结果按旧版直接拆', () => {
    expect(isWidePage(sizeI(1350, 1000, true))).toBe(true)
    expect(isWidePage(sizeI(1350, 1000, false))).toBe(false)
    expect(isWidePage(sizeI(1350, 1000, null))).toBe(true)
  })
})

describe('verticalPreloadIndices（L117-L123）', () => {
  it('count<=0 → 空', () => {
    expect(verticalPreloadIndices(0, 4, 0)).toEqual([])
    expect(verticalPreloadIndices(3, 4, -1)).toEqual([])
  })

  it('顺序：当前页 → 前瞻近→远 → 上一页', () => {
    expect(verticalPreloadIndices(2, 4, 20)).toEqual([2, 3, 4, 5, 6, 1])
  })

  it('全部钳制到 [0, count)', () => {
    expect(verticalPreloadIndices(0, 4, 20)).toEqual([0, 1, 2, 3, 4])
    expect(verticalPreloadIndices(19, 4, 20)).toEqual([19, 18])
    expect(verticalPreloadIndices(5, 0, 20)).toEqual([5, 4])
  })
})

describe('engineFadeAlpha（L129-L132）', () => {
  it('起点 0.35、终点 1.0，中点为 smoothstep(0.5)=0.675', () => {
    expect(engineFadeAlpha(0)).toBeCloseTo(0.35, 10)
    expect(engineFadeAlpha(240)).toBeCloseTo(1, 10)
    expect(engineFadeAlpha(120)).toBeCloseTo(0.35 + 0.65 * 0.5, 10)
  })

  it('durationMs<=0 → 1；超时长钳 1', () => {
    expect(engineFadeAlpha(10, 0)).toBe(1)
    expect(engineFadeAlpha(9999)).toBe(1)
  })
})

describe('comicScrollStrategyForConfig（L101-L106）', () => {
  it('CONTINUOUS → 强制 0 间距 / 无磁吸 / 窗口 4', () => {
    const s = comicScrollStrategyForConfig(cfg({ mode: 'CONTINUOUS', pageSpacingDp: 20, webtoonSnap: true }))
    expect(s.kind).toBe('continuous')
    expect(s.spacingDp).toBe(0)
    expect(s.snapToPage).toBe(false)
    expect(s.prefetchWindow).toBe(4)
    expect(s.pixelProgress).toBe(true)
  })

  it('其余模式（含 WEBTOON）→ Webtoon，沿用用户间距/磁吸，窗口 4', () => {
    const s = comicScrollStrategyForConfig(cfg({ mode: 'WEBTOON', pageSpacingDp: 20, webtoonSnap: true }))
    expect(s.kind).toBe('webtoon')
    expect(s.spacingDp).toBe(20)
    expect(s.snapToPage).toBe(true)
    expect(s.prefetchWindow).toBe(4)
  })
})

describe('buildComicLayout —— 单页模式（L162-L250）', () => {
  it('空 pages → 空 layout', () => {
    const layout = buildComicLayout([], new Map(), cfg())
    expect(layout.spreadCount).toBe(0)
    expect(spreadOfRawPage(layout, 0)).toBe(0)
    expect(spreadIndexOf(layout, 0)).toBe(0)
  })

  it('SINGLE + splitWide=false：一页一 spread', () => {
    const pages = [p('0'), p('1'), p('2')]
    const layout = buildComicLayout(pages, new Map(), cfg({ splitWide: false }))
    expect(layout.spreadCount).toBe(3)
    expect(layout.spreads.map((s) => s.slots.map((sl) => sl.rawIndex))).toEqual([[0], [1], [2]])
    expect(layout.spreads[0]?.isDouble).toBe(false)
    expect(layout.spreads[0]?.firstRawIndex).toBe(0)
  })

  it('rawToSpread 首个所在 spread 优先（putIfAbsent，L246）', () => {
    const pages = [p('0'), p('1')]
    const layout = buildComicLayout(pages, new Map(), cfg({ splitWide: false }))
    expect(spreadOfRawPage(layout, 1)).toBe(1)
    expect(spreadIndexOf(layout, 1)).toBe(1)
    expect(spreadIndexOf(layout, 99)).toBe(0)
  })
})

describe('buildComicLayout —— 宽页拆分（L180-L191）', () => {
  const wideSizes = new Map([
    ['w', sizeI(1600, 1000)], // aspect 1.6 → 疑似跨页（无 gutter → 直接拆）
    ['n', sizeI(800, 1000)], // aspect 0.8 → 正常单页
  ])

  it('LTR 默认左半在前；RTL 右半在前（L183-L186）', () => {
    const ltr = buildComicLayout([p('w')], wideSizes, cfg({ direction: 'LTR' }))
    expect(ltr.spreads.map((s) => s.slots.map((sl) => sl.half))).toEqual([['LEFT'], ['RIGHT']])

    const rtl = buildComicLayout([p('w')], wideSizes, cfg({ direction: 'RTL' }))
    expect(rtl.spreads.map((s) => s.slots.map((sl) => sl.half))).toEqual([['RIGHT'], ['LEFT']])
  })

  it('splitReverse 反转拆分顺序（L183）', () => {
    const rtlRev = buildComicLayout([p('w')], wideSizes, cfg({ direction: 'RTL', splitReverse: true }))
    expect(rtlRev.spreads.map((s) => s.slots.map((sl) => sl.half))).toEqual([['LEFT'], ['RIGHT']])
  })

  it('半页各自成组，rawIndex 都是原始页索引', () => {
    const layout = buildComicLayout([p('w')], wideSizes, cfg())
    expect(layout.spreads.map((s) => s.slots[0]?.rawIndex)).toEqual([0, 0])
    // putIfAbsent → 两半页都指向第一个 spread
    expect(spreadOfRawPage(layout, 0)).toBe(0)
  })

  it('合页锚点命中时跳过拆分（L179/L180）', () => {
    const layout = buildComicLayout([p('w')], wideSizes, cfg(), { mergeAnchors: new Set([0]) })
    expect(layout.spreadCount).toBe(1)
    expect(layout.spreads[0]?.slots.map((sl) => sl.half)).toEqual(['FULL'])
  })

  it('splitWide=false 时宽页不拆（L180）', () => {
    const layout = buildComicLayout([p('w')], wideSizes, cfg({ splitWide: false }))
    expect(layout.spreadCount).toBe(1)
  })
})

describe('buildComicLayout —— 临时合页锚点（L193-L212）', () => {
  it('锚点 + 下一组各自单页且非拆分 → 合成一个 spread', () => {
    const pages = [p('0'), p('1'), p('2')]
    const sizes = new Map([
      ['0', sizeI(800, 1000)],
      ['1', sizeI(800, 1000)],
      ['2', sizeI(800, 1000)],
    ])
    const layout = buildComicLayout(pages, sizes, cfg({ splitWide: false }), { mergeAnchors: new Set([0]) })
    expect(layout.spreads.map((s) => s.slots.map((sl) => sl.rawIndex))).toEqual([[0, 1], [2]])
    expect(layout.spreads[0]?.isDouble).toBe(true)
  })

  it('锚点在末尾时无处可合 → 独立 spread（L202 条件）', () => {
    const pages = [p('0'), p('1')]
    const sizes = new Map([
      ['0', sizeI(800, 1000)],
      ['1', sizeI(800, 1000)],
    ])
    const layout = buildComicLayout(pages, sizes, cfg({ splitWide: false }), { mergeAnchors: new Set([1]) })
    expect(layout.spreads.map((s) => s.slots.map((sl) => sl.rawIndex))).toEqual([[0], [1]])
  })
})

describe('buildComicLayout —— 双页模式（L214-L238）', () => {
  const sizes = new Map([
    ['0', sizeI(800, 1000)],
    ['1', sizeI(800, 1000)],
    ['2', sizeI(800, 1000)],
    ['3', sizeI(800, 1000)],
    ['4', sizeI(800, 1000)],
  ])

  it('DOUBLE：两两配对，末页单独（L222-L237）', () => {
    const pages = [p('0'), p('1'), p('2'), p('3'), p('4')]
    const layout = buildComicLayout(pages, sizes, cfg({ mode: 'DOUBLE', splitWide: false }))
    expect(layout.spreads.map((s) => s.slots.map((sl) => sl.rawIndex))).toEqual([[0, 1], [2, 3], [4]])
  })

  it('doubleFirstAlone：首页独占（L217-L221）', () => {
    const pages = [p('0'), p('1'), p('2'), p('3')]
    const layout = buildComicLayout(pages, sizes, cfg({ mode: 'DOUBLE', splitWide: false, doubleFirstAlone: true }))
    expect(layout.spreads.map((s) => s.slots.map((sl) => sl.rawIndex))).toEqual([[0], [1, 2], [3]])
  })

  it('doubleFirstAlone 只在 DOUBLE 生效（L217）', () => {
    const pages = [p('0'), p('1')]
    const layout = buildComicLayout(pages, sizes, cfg({ mode: 'SINGLE', splitWide: false, doubleFirstAlone: true }))
    expect(layout.spreads.map((s) => s.slots.map((sl) => sl.rawIndex))).toEqual([[0], [1]])
  })

  it('未拆分的宽页在双页模式下独占（L224）', () => {
    const wideNoSplit = new Map([
      ['0', sizeI(800, 1000)],
      ['w', sizeI(1600, 1000)],
      ['2', sizeI(800, 1000)],
      ['3', sizeI(800, 1000)],
    ])
    const pages = [p('0'), p('w'), p('2'), p('3')]
    const layout = buildComicLayout(pages, wideNoSplit, cfg({ mode: 'DOUBLE', splitWide: false }))
    expect(layout.spreads.map((s) => s.slots.map((sl) => sl.rawIndex))).toEqual([[0], [1], [2, 3]])
  })
})

describe('comicLayout helpers（L58-L63）', () => {
  it('空 spread 列表：spreadCount 0、spreadOfRawPage/spreadIndexOf 回 0', () => {
    const layout = comicLayout([])
    expect(layout.spreadCount).toBe(0)
    expect(spreadOfRawPage(layout, 5)).toBe(0)
    expect(spreadIndexOf(layout, 5)).toBe(0)
  })
})
