/**
 * comicPageLayout.test.ts — 逐条移植 Android
 * `app/src/test/java/com/example/ui/comic/ComicPageLayoutTest.kt`（14 个 @Test）。
 *
 * 被测实现：`src/core/comic/comicPageLayout.ts`
 *   - buildComicLayout  ← Kotlin `ComicPageLayout.build`
 *   - spreadOfRawPage   ← Kotlin `ComicLayout.spreadOfRawPage`
 *   - sizeI / comicSpread / comicSlot / comicPageRefLocal ← 对应 data class 工厂
 */
import { describe, expect, it } from 'vitest'

import {
  ComicSplitHalf,
  buildComicLayout,
  comicPageRefLocal,
  sizeI,
  spreadOfRawPage,
  type ComicBookState,
  type ComicPageRef,
  type ComicReaderConfig,
  type ComicSpread,
  type SizeI,
} from '@core/comic/comicPageLayout'

/** Kotlin `private fun pages(n)`（L14-L15）。 */
function pages(n: number): ComicPageRef[] {
  return Array.from({ length: n }, (_unused, it) => comicPageRefLocal(`p${it}`, `/mock/${it}.jpg`))
}

/** Kotlin `private fun sizes(n, aspect)`（L17-L18）。 */
function sizesOf(n: number, aspect: (i: number) => number): Map<string, SizeI> {
  const out = new Map<string, SizeI>()
  for (let i = 0; i < n; i++) out.set(`p${i}`, sizeI(Math.trunc(aspect(i) * 1000), 1000))
  return out
}

/** Kotlin `ComicReaderConfig(mode = …, …)` 的具名构造 → 局部补默认值。 */
function cfg(patch: Partial<ComicReaderConfig>): ComicReaderConfig {
  return {
    mode: 'SINGLE',
    direction: 'RTL',
    splitWide: false,
    splitReverse: false,
    doubleFirstAlone: false,
    pageSpacingDp: 8,
    webtoonSnap: true,
    manualCrop: null,
    showThumbPreview: true,
    ...patch,
  }
}

/** Kotlin `ComicBookState(mergeAnchors = setOf(…))`。 */
function bookState(mergeAnchors: number[]): ComicBookState {
  return { mergeAnchors: new Set(mergeAnchors) }
}

/** Kotlin `layout.spreads[i].slots.map { it.rawIndex }`。 */
function rawIndices(spread: ComicSpread): number[] {
  return spread.slots.map((s) => s.rawIndex)
}

describe('ComicPageLayoutTest（Android ComicPageLayoutTest.kt，14 个测试）', () => {
  it('single mode - every page is its own spread — 单页模式每页各自一跨（Kotlin L20-L25）', () => {
    const layout = buildComicLayout(pages(7), new Map(), cfg({ mode: 'SINGLE' }))
    expect(layout.spreadCount).toBe(7)
    layout.spreads.forEach((s, i) => {
      expect((s.slots[0] as { rawIndex: number }).rawIndex).toBe(i)
    })
  })

  it('double mode - pages pair into spreads — 双页模式两两配对（Kotlin L27-L34）', () => {
    const layout = buildComicLayout(pages(6), new Map(), cfg({ mode: 'DOUBLE' }))
    expect(layout.spreadCount).toBe(3)
    expect(layout.spreads.every((s) => s.isDouble)).toBe(true)
    expect(rawIndices(layout.spreads[0] as ComicSpread)).toEqual([0, 1])
    expect(rawIndices(layout.spreads[2] as ComicSpread)).toEqual([4, 5])
  })

  it('double mode - odd tail becomes single spread — 双页奇数尾页变单槽跨（Kotlin L36-L42）', () => {
    const layout = buildComicLayout(pages(5), new Map(), cfg({ mode: 'DOUBLE' }))
    expect(layout.spreadCount).toBe(3)
    expect((layout.spreads[2] as ComicSpread).isDouble).toBe(false)
    expect((layout.spreads[2] as ComicSpread).firstRawIndex).toBe(4)
  })

  it('double mode - first page alone when enabled — 首页单独开关（Kotlin L44-L53）', () => {
    const layout = buildComicLayout(
      pages(5),
      new Map(),
      cfg({ mode: 'DOUBLE', doubleFirstAlone: true }),
    )
    expect(layout.spreadCount).toBe(3)
    expect((layout.spreads[0] as ComicSpread).isDouble).toBe(false)
    expect((layout.spreads[1] as ComicSpread).isDouble).toBe(true)
  })

  it('wide split RTL - right half first — RTL 拆分右半在前（Kotlin L55-L65）', () => {
    const sizes = new Map([['p0', sizeI(2000, 1000)]])
    const layout = buildComicLayout(
      pages(1),
      sizes,
      cfg({ mode: 'SINGLE', direction: 'RTL', splitWide: true }),
    )
    expect(layout.spreadCount).toBe(2)
    expect((layout.spreads[0] as ComicSpread).slots[0]?.half).toBe(ComicSplitHalf.RIGHT)
    expect((layout.spreads[1] as ComicSpread).slots[0]?.half).toBe(ComicSplitHalf.LEFT)
  })

  it('wide split LTR - left half first — LTR 拆分左半在前（Kotlin L67-L77）', () => {
    const sizes = new Map([['p0', sizeI(2000, 1000)]])
    const layout = buildComicLayout(
      pages(1),
      sizes,
      cfg({ mode: 'SINGLE', direction: 'LTR', splitWide: true }),
    )
    expect(layout.spreadCount).toBe(2)
    expect((layout.spreads[0] as ComicSpread).slots[0]?.half).toBe(ComicSplitHalf.LEFT)
    expect((layout.spreads[1] as ComicSpread).slots[0]?.half).toBe(ComicSplitHalf.RIGHT)
  })

  it('wide split - splitReverse flips order — splitReverse 反转拆分顺序（Kotlin L79-L87）', () => {
    const sizes = new Map([['p0', sizeI(2000, 1000)]])
    const layout = buildComicLayout(
      pages(1),
      sizes,
      cfg({ mode: 'SINGLE', direction: 'RTL', splitWide: true, splitReverse: true }),
    )
    expect((layout.spreads[0] as ComicSpread).slots[0]?.half).toBe(ComicSplitHalf.LEFT)
  })

  it('wide page without split occupies own spread in double mode — 未拆分的宽页在双页模式独占（Kotlin L89-L100）', () => {
    const sizes = new Map([['p1', sizeI(2000, 1000)]])
    const layout = buildComicLayout(pages(3), sizes, cfg({ mode: 'DOUBLE', splitWide: false }))
    expect(layout.spreadCount).toBe(3)
    expect((layout.spreads[0] as ComicSpread).isDouble).toBe(false)
    expect((layout.spreads[1] as ComicSpread).isDouble).toBe(false)
  })

  it('merge anchors combine two pages into one spread — 合页锚点合并两页（Kotlin L102-L114）', () => {
    const layout = buildComicLayout(
      pages(4),
      new Map(),
      cfg({ mode: 'SINGLE' }),
      bookState([1]),
    )
    expect(layout.spreadCount).toBe(3)
    expect((layout.spreads[0] as ComicSpread).isDouble).toBe(false)
    expect((layout.spreads[1] as ComicSpread).isDouble).toBe(true)
    expect(rawIndices(layout.spreads[1] as ComicSpread)).toEqual([1, 2])
  })

  it('merge anchor on last page is ignored — 末页合页锚点被忽略（Kotlin L116-L124）', () => {
    const layout = buildComicLayout(
      pages(4),
      new Map(),
      cfg({ mode: 'SINGLE' }),
      bookState([3]),
    )
    expect(layout.spreadCount).toBe(4)
  })

  it('rawToSpread maps every raw page — 原始页→跨页映射覆盖全部页（Kotlin L126-L136）', () => {
    const layout = buildComicLayout(pages(6), new Map(), cfg({ mode: 'DOUBLE' }))
    expect(spreadOfRawPage(layout, 0)).toBe(0)
    expect(spreadOfRawPage(layout, 1)).toBe(0)
    expect(spreadOfRawPage(layout, 4)).toBe(2)
    expect(spreadOfRawPage(layout, 5)).toBe(2)
  })

  it('split pages in double mode pair naturally — 双页模式下拆出的两半自然配成组（Kotlin L138-L151）', () => {
    const sizes = new Map([['p0', sizeI(2000, 1000)]])
    const layout = buildComicLayout(
      pages(3),
      sizes,
      cfg({ mode: 'DOUBLE', direction: 'RTL', splitWide: true }),
    )
    expect(layout.spreadCount).toBe(2)
    expect((layout.spreads[0] as ComicSpread).isDouble).toBe(true)
    expect((layout.spreads[0] as ComicSpread).slots[0]?.rawIndex).toBe(0)
    expect((layout.spreads[1] as ComicSpread).isDouble).toBe(true)
  })

  it('empty pages produce empty layout — 空页列表产出空布局（Kotlin L153-L158）', () => {
    const layout = buildComicLayout([], new Map(), cfg({}))
    expect(layout.spreadCount).toBe(0)
    expect(layout).not.toBeNull()
  })

  it('narrow page never splits even when splitWide on — 窄页开启拆分也不拆（Kotlin L160-L169）', () => {
    const sizes = new Map([['p0', sizeI(700, 1000)]]) // aspect 0.7
    const layout = buildComicLayout(pages(1), sizes, cfg({ splitWide: true }))
    expect(layout.spreadCount).toBe(1)
    expect((layout.spreads[0] as ComicSpread).slots[0]?.half).toBe(ComicSplitHalf.FULL)
  })
})

// `sizes(...)` 辅助函数本身也参与 Kotlin 语义（aspect→SizeI 换算），显式钉一条以免被误删。
describe('ComicPageLayoutTest.sizes 辅助（Kotlin L17-L18）', () => {
  it('sizes(n, aspect) 按 aspect*1000×1000 生成 SizeI', () => {
    const sizes = sizesOf(3, () => 2)
    expect(sizes.get('p0')).toEqual(sizeI(2000, 1000))
    expect(sizes.get('p2')).toEqual(sizeI(2000, 1000))
  })
})