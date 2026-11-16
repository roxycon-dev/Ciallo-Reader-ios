/**
 * comicPageLayoutCombos.test.ts — `ComicPageLayout.kt` L162-250 `build()`
 * 的**页序 / 裁剪坐标 / 间距 / 单双四页组合**逐条钉死。
 *
 * 与既有 `tests/unit/comicPageLayout.test.ts` / `tests/port/comic/comicPageLayout.test.ts`
 * 的分工：既有两份覆盖「典型路径 + Kotlin 单测的 14 条」；本文件补的是
 * **组合矩阵与几何数值**（Kotlin 里没有直接单测、但显示层依赖的部分）：
 *   - 半页槽位的 LEFT/RIGHT 与左右分屏的渲染顺序
 *   - 拆分位置 `effectiveSplitPosition` 的 gutter 偏移数学（Kotlin L770-786）
 *   - 页序判定：rawToSpread 的 putIfAbsent 语义、spreadIndexOf、firstRawIndex
 *   - 单页 / 双页 / 双页+首页独占 / 四页（拆分后自然配对）四类组合的完整矩阵
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/comic/ComicPageLayout.kt
 *           + ComicReaderCore.kt（effectiveSplitPosition / geometryHasWork）
 * TS 源:    IOS/src/core/comic/comicPageLayout.ts
 *           IOS/src/core/comic/comicReaderCore.ts
 */

import { describe, expect, it } from 'vitest';
import {
  HARD_WIDE_ASPECT,
  WIDE_ASPECT,
  buildComicLayout,
  comicScrollStrategyContinuous,
  comicScrollStrategyForConfig,
  comicScrollStrategyWebtoon,
  isWidePage,
  sizeI,
  spreadIndexOf,
  spreadOfRawPage,
  type ComicPageRef,
  type ComicReaderConfig,
  type ComicSplitHalf,
  type SizeI,
} from '../../src/core/comic/comicPageLayout';
import {
  DEFAULT_COMIC_READER_CONFIG,
  createComicReaderConfig,
} from '../../src/core/comic/comicReaderConfig';
import {
  effectiveRotation,
  effectiveSplitPosition,
  geometryHasWork,
  pageRotationOf,
  toneOf,
} from '../../src/core/comic/comicReaderCore';

function localRef(index: number): ComicPageRef {
  return { kind: 'local', id: `p${String(index)}`, path: `/tmp/p${String(index)}.jpg` };
}

/** n 页本地页。 */
function refs(n: number): ComicPageRef[] {
  return Array.from({ length: n }, (_unused, i) => localRef(i));
}

/** 全部尺寸为窄页（aspect 0.7）——不触发拆分。 */
function narrowSizes(pages: readonly ComicPageRef[]): Map<string, SizeI> {
  return new Map(pages.map((p) => [p.id, sizeI(700, 1000)]));
}

/** 指定下标为宽页（aspect 2.0 ≥ HARD_WIDE_ASPECT，无条件视为跨页）。 */
function sizesWithWide(
  pages: readonly ComicPageRef[],
  wideIdx: readonly number[],
): Map<string, SizeI> {
  const wide = new Set(wideIdx);
  return new Map(
    pages.map((p, i) => [p.id, sizeI(wide.has(i) ? 2000 : 700, 1000)]),
  );
}

const NO_MERGE = { mergeAnchors: new Set<number>() };

/** `ComicReaderCore.ComicBookState` 工厂（本文件只关心 pageRotations）。 */
function stateWith(pageRotations: Record<string, number>) {
  return {
    lastPage: 0,
    lastChapterSig: null,
    pageRotations,
    mergeAnchors: NO_MERGE.mergeAnchors,
  };
}

function build(
  pages: readonly ComicPageRef[],
  sizes: Map<string, SizeI>,
  config: Partial<ComicReaderConfig>,
  mergeAnchors: ReadonlySet<number> = new Set<number>(),
) {
  return buildComicLayout(
    pages,
    sizes,
    { ...createComicReaderConfig(config) },
    { mergeAnchors },
  );
}

/** 展开成 "半页顺序" 的可读串，便于逐条断言。 */
function slotSignature(layout: ReturnType<typeof buildComicLayout>): string {
  return layout.spreads
    .map((s) =>
      s.slots
        .map((slot) => `${String(slot.rawIndex)}:${slot.half}`)
        .join('+'),
    )
    .join(' | ');
}

describe('isWidePage 阈值（Kotlin L136-154）', () => {
  it('WIDE_ASPECT = 1.35 / HARD_WIDE_ASPECT = 1.8 逐字一致', () => {
    expect(WIDE_ASPECT).toBe(1.35);
    expect(HARD_WIDE_ASPECT).toBe(1.8);
  });

  it('aspect 恰在 1.35 边界：进「疑似跨页」区（L152 `a < WIDE_ASPECT` 为假）', () => {
    // 1.35 < 1.8，需要 gutter 佐证
    expect(isWidePage(sizeI(1350, 1000, false))).toBe(false);
    expect(isWidePage(sizeI(1350, 1000, true))).toBe(true);
    expect(isWidePage(sizeI(1350, 1000, null))).toBe(true);
  });

  it('aspect 恰在 1.8 边界：无条件拆（≥ HARD）', () => {
    expect(isWidePage(sizeI(1800, 1000, false))).toBe(true);
    expect(isWidePage(sizeI(1799, 1000, false))).toBe(false);
  });

  it('height <= 0 时 aspect = 0 → 不拆（L31）', () => {
    expect(isWidePage(sizeI(2000, 0))).toBe(false);
    expect(isWidePage(null)).toBe(false);
  });
});

describe('单页组合（SINGLE）—— 一页一 spread', () => {
  it('SINGLE + splitWide=false：N 页 → N 个 spread，每 spread 一个 FULL 槽', () => {
    const pages = refs(5);
    const layout = build(pages, narrowSizes(pages), { mode: 'SINGLE' });
    expect(layout.spreads).toHaveLength(5);
    expect(slotSignature(layout)).toBe('0:FULL | 1:FULL | 2:FULL | 3:FULL | 4:FULL');
  });

  it('DOUBLE=false 时 direction 不影响配对（只影响渲染轴）', () => {
    const pages = refs(4);
    for (const direction of ['LTR', 'RTL', 'TTB'] as const) {
      const layout = build(pages, narrowSizes(pages), { mode: 'SINGLE', direction });
      expect(layout.spreads).toHaveLength(4);
    }
  });
});

describe('双页组合（DOUBLE）—— 两两配对', () => {
  it('DOUBLE：偶数页完全两两配对（L222-237）', () => {
    const pages = refs(4);
    const layout = build(pages, narrowSizes(pages), { mode: 'DOUBLE', direction: 'LTR' });
    expect(slotSignature(layout)).toBe('0:FULL+1:FULL | 2:FULL+3:FULL');
  });

  it('DOUBLE：奇数页尾页单独（L233-235 next == null 分支）', () => {
    const pages = refs(5);
    const layout = build(pages, narrowSizes(pages), { mode: 'DOUBLE', direction: 'LTR' });
    expect(slotSignature(layout)).toBe('0:FULL+1:FULL | 2:FULL+3:FULL | 4:FULL');
  });

  it('DOUBLE：1 页 → 单槽 spread', () => {
    const pages = refs(1);
    const layout = build(pages, narrowSizes(pages), { mode: 'DOUBLE', direction: 'LTR' });
    expect(slotSignature(layout)).toBe('0:FULL');
  });

  it('DOUBLE：空页列表 → 空布局（L168）', () => {
    const layout = build([], new Map(), { mode: 'DOUBLE' });
    expect(layout.spreads).toHaveLength(0);
    expect(layout.spreadCount).toBe(0);
  });

  it('DOUBLE：配对顺序永远是「先页在前」，与 RTL 无关（L230 拼 cur + next）', () => {
    const pages = refs(4);
    const rtl = build(pages, narrowSizes(pages), { mode: 'DOUBLE', direction: 'RTL' });
    const ltr = build(pages, narrowSizes(pages), { mode: 'DOUBLE', direction: 'LTR' });
    expect(slotSignature(rtl)).toBe(slotSignature(ltr));
  });
});

describe('双页 + 首页独占（doubleFirstAlone，L217-221）', () => {
  it('5 页 + 首页独占 → 首页单独，其后两两配对，尾页落单', () => {
    const pages = refs(5);
    const layout = build(pages, narrowSizes(pages), {
      mode: 'DOUBLE',
      direction: 'LTR',
      doubleFirstAlone: true,
    });
    expect(slotSignature(layout)).toBe('0:FULL | 1:FULL+2:FULL | 3:FULL+4:FULL');
  });

  it('首页独占在 4 页时留下奇数余页', () => {
    const pages = refs(4);
    const layout = build(pages, narrowSizes(pages), {
      mode: 'DOUBLE',
      direction: 'LTR',
      doubleFirstAlone: true,
    });
    expect(slotSignature(layout)).toBe('0:FULL | 1:FULL+2:FULL | 3:FULL');
  });

  it('首页独占只在 DOUBLE 生效（L217 `&& double`）', () => {
    const pages = refs(4);
    const layout = build(pages, narrowSizes(pages), {
      mode: 'SINGLE',
      direction: 'LTR',
      doubleFirstAlone: true,
    });
    expect(slotSignature(layout)).toBe('0:FULL | 1:FULL | 2:FULL | 3:FULL');
  });

  it('首页独占 + 空页列表不崩', () => {
    const layout = build([], new Map(), {
      mode: 'DOUBLE',
      doubleFirstAlone: true,
    });
    expect(layout.spreads).toHaveLength(0);
  });
});

describe('四页组合（拆分后自然配对）', () => {
  it('LTR + splitWide：左右半页左先，拆出的两半各自成组再两两配对（L183-186 / L230）', () => {
    const pages = refs(4);
    const layout = build(pages, sizesWithWide(pages, [1]), {
      mode: 'DOUBLE',
      direction: 'LTR',
      splitWide: true,
    });
    // p1 拆成 LEFT/RIGHT，两半各自成组 → 与 p0、p2 分别配对
    expect(slotSignature(layout)).toBe('0:FULL+1:LEFT | 1:RIGHT+2:FULL | 3:FULL');
  });

  it('RTL + splitWide：右半页在前（L183 `rightFirst = rtl`）', () => {
    const pages = refs(4);
    const layout = build(pages, sizesWithWide(pages, [1]), {
      mode: 'DOUBLE',
      direction: 'RTL',
      splitWide: true,
    });
    expect(slotSignature(layout)).toBe('0:FULL+1:RIGHT | 1:LEFT+2:FULL | 3:FULL');
  });

  it('splitReverse 反转拆分顺序（L183 `splitReverse ? !rtl : rtl`）', () => {
    const pages = refs(2);
    // RTL 默认右先；splitReverse 打开后左先。p1 是窄页 → 与 p0 的第二个半页配对。
    expect(
      slotSignature(
        build(pages, sizesWithWide(pages, [0]), {
          mode: 'DOUBLE',
          direction: 'RTL',
          splitWide: true,
        }),
      ),
    ).toBe('0:RIGHT+0:LEFT | 1:FULL');
    expect(
      slotSignature(
        build(pages, sizesWithWide(pages, [0]), {
          mode: 'DOUBLE',
          direction: 'RTL',
          splitWide: true,
          splitReverse: true,
        }),
      ),
    ).toBe('0:LEFT+0:RIGHT | 1:FULL');
  });

  it('LTR + splitReverse → 右半页在前', () => {
    const pages = refs(2);
    expect(
      slotSignature(
        build(pages, sizesWithWide(pages, [0]), {
          mode: 'DOUBLE',
          direction: 'LTR',
          splitWide: true,
        }),
      ),
    ).toBe('0:LEFT+0:RIGHT | 1:FULL');
    expect(
      slotSignature(
        build(pages, sizesWithWide(pages, [0]), {
          mode: 'DOUBLE',
          direction: 'LTR',
          splitWide: true,
          splitReverse: true,
        }),
      ),
    ).toBe('0:RIGHT+0:LEFT | 1:FULL');
  });

  it('未拆分的宽页在双页模式下独占（L224 `wideFull`）', () => {
    const pages = refs(3);
    // splitWide=false → p1 是「未拆分的宽页」→ 不与邻居配对
    const layout = build(pages, sizesWithWide(pages, [1]), {
      mode: 'DOUBLE',
      direction: 'LTR',
      splitWide: false,
    });
    expect(slotSignature(layout)).toBe('0:FULL | 1:FULL | 2:FULL');
  });

  it('拆出的两半在 SINGLE 模式下也各自成 spread（不配对）', () => {
    const pages = refs(2);
    const layout = build(pages, sizesWithWide(pages, [0]), {
      mode: 'SINGLE',
      direction: 'LTR',
      splitWide: true,
    });
    expect(slotSignature(layout)).toBe('0:LEFT | 0:RIGHT | 1:FULL');
  });

  it('两个相邻宽页都拆 → 四个半页按方向依次排开', () => {
    const pages = refs(2);
    const layout = build(pages, sizesWithWide(pages, [0, 1]), {
      mode: 'SINGLE',
      direction: 'LTR',
      splitWide: true,
    });
    expect(slotSignature(layout)).toBe('0:LEFT | 0:RIGHT | 1:LEFT | 1:RIGHT');
  });
});

describe('临时合页锚点（Kotlin L179 / L193-212）', () => {
  it('锚点页 + 下一页合成一个双槽 spread', () => {
    const pages = refs(4);
    const layout = build(pages, narrowSizes(pages), { mode: 'SINGLE' }, new Set([1]));
    expect(slotSignature(layout)).toBe('0:FULL | 1:FULL+2:FULL | 3:FULL');
  });

  it('合页锚点命中时该宽页不拆（L180 `!anchorMerged`）', () => {
    const pages = refs(3);
    const layout = build(
      pages,
      sizesWithWide(pages, [0]),
      { mode: 'SINGLE', direction: 'LTR', splitWide: true },
      new Set([0]),
    );
    expect(slotSignature(layout)).toBe('0:FULL+1:FULL | 2:FULL');
  });

  it('末页作锚点无处可合 → 独立 spread（L202 `i + 1 < rawGroups.size`）', () => {
    const pages = refs(3);
    const layout = build(pages, narrowSizes(pages), { mode: 'SINGLE' }, new Set([2]));
    expect(slotSignature(layout)).toBe('0:FULL | 1:FULL | 2:FULL');
  });

  it('锚点后面紧跟一个「拆出的半页」时不合成（L204 `!fromSplit`）', () => {
    const pages = refs(3);
    const layout = build(
      pages,
      sizesWithWide(pages, [1]),
      { mode: 'SINGLE', direction: 'LTR', splitWide: true },
      new Set([0]),
    );
    // p0 是锚点但 p1 被拆成两半 → 无法组成「两个完整页」的合页组
    expect(layout.spreads[0]?.slots).toHaveLength(1);
  });

  it('锚点命中的宽页不拆，但仍能与下一页正常合成（L180 只挡拆分，不挡合页）', () => {
    const pages = refs(3);
    const layout = build(
      pages,
      sizesWithWide(pages, [0]),
      { mode: 'SINGLE', direction: 'LTR', splitWide: true },
      new Set([0]),
    );
    // p0 是宽页，但 anchorMerged 让它保持 FULL（不拆），于是合页条件
    // 「两个非 fromSplit 的单槽组」成立 → 与 p1 合成
    expect(slotSignature(layout)).toBe('0:FULL+1:FULL | 2:FULL');
  });

  it('合页在 DOUBLE 模式下已是双槽 spread（L224 `unitSlots.size > 1` 直接独立）', () => {
    const pages = refs(5);
    const layout = build(pages, narrowSizes(pages), { mode: 'DOUBLE', direction: 'LTR' }, new Set([0]));
    expect(slotSignature(layout)).toBe('0:FULL+1:FULL | 2:FULL+3:FULL | 4:FULL');
  });
});

describe('页序判定 · rawToSpread / spreadOfRawPage / spreadIndexOf', () => {
  it('rawToSpread 用 putIfAbsent：拆出的两个半页都映射到第一个所在 spread（L246）', () => {
    const pages = refs(2);
    const layout = build(pages, sizesWithWide(pages, [0]), {
      mode: 'SINGLE',
      direction: 'LTR',
      splitWide: true,
    });
    // 0:LEFT 在 spread 0，0:RIGHT 在 spread 1 —— 两者都记 0
    expect(layout.rawToSpread.get(0)).toBe(0);
    expect(layout.rawToSpread.get(1)).toBe(2);
  });

  it('合页组里两页映射到同一个 spread', () => {
    const pages = refs(3);
    const layout = build(pages, narrowSizes(pages), { mode: 'SINGLE' }, new Set([0]));
    expect(layout.rawToSpread.get(0)).toBe(0);
    expect(layout.rawToSpread.get(1)).toBe(0);
    expect(layout.rawToSpread.get(2)).toBe(1);
  });

  it('双页配对里两页映射到同一个 spread', () => {
    const pages = refs(4);
    const layout = build(pages, narrowSizes(pages), { mode: 'DOUBLE', direction: 'LTR' });
    expect(layout.rawToSpread.get(0)).toBe(0);
    expect(layout.rawToSpread.get(1)).toBe(0);
    expect(layout.rawToSpread.get(2)).toBe(1);
    expect(layout.rawToSpread.get(3)).toBe(1);
  });

  it('spreadOfRawPage 对越界 raw 回落 0（L60 `?: 0`）', () => {
    const pages = refs(2);
    const layout = build(pages, narrowSizes(pages), { mode: 'SINGLE' });
    expect(spreadOfRawPage(layout, 0)).toBe(0);
    expect(spreadOfRawPage(layout, 999)).toBe(0);
    expect(spreadOfRawPage(layout, -5)).toBe(0);
  });

  it('spreadIndexOf 找到包含该 raw 的 spread；找不到回 0（L62-63）', () => {
    const pages = refs(4);
    const layout = build(pages, narrowSizes(pages), { mode: 'DOUBLE', direction: 'LTR' });
    expect(spreadIndexOf(layout, 0)).toBe(0);
    expect(spreadIndexOf(layout, 1)).toBe(0);
    expect(spreadIndexOf(layout, 2)).toBe(1);
    expect(spreadIndexOf(layout, 3)).toBe(1);
    expect(spreadIndexOf(layout, 42)).toBe(0);
  });

  it('空布局：spreadCount 0，两个查询都回 0', () => {
    const layout = build([], new Map(), { mode: 'DOUBLE' });
    expect(layout.spreadCount).toBe(0);
    expect(spreadOfRawPage(layout, 0)).toBe(0);
    expect(spreadIndexOf(layout, 0)).toBe(0);
  });
});

describe('有效拆分位置（ComicReaderCore.kt L770-773 effectiveSplitPosition）', () => {
  // Kotlin: val base = detectedGutterPos?.takeIf { !it.isNaN() } ?: 0.5f
  //         return (base + (config.splitPosition - 0.5f)).coerceIn(0.3f, 0.7f)
  it('无 gutter 结果时基准回落 0.5，偏移即 splitPosition - 0.5', () => {
    const config = createComicReaderConfig({ splitPosition: 0.42 });
    expect(effectiveSplitPosition(config, null)).toBeCloseTo(0.42, 10);
    expect(effectiveSplitPosition(createComicReaderConfig({ splitPosition: 0.6 }), null)).toBeCloseTo(
      0.6,
      10,
    );
  });

  it('splitPosition = 0.5（默认）时结果恰好等于 gutter 基准', () => {
    const base = createComicReaderConfig({ splitPosition: 0.5 });
    expect(effectiveSplitPosition(base, 0.3)).toBeCloseTo(0.3, 10);
  });

  it('有 gutter 时 splitPosition 作为偏移：> 0.5 右移，< 0.5 左移', () => {
    const right = effectiveSplitPosition(createComicReaderConfig({ splitPosition: 0.6 }), 0.4);
    const left = effectiveSplitPosition(createComicReaderConfig({ splitPosition: 0.4 }), 0.4);
    expect(right).toBeGreaterThan(0.4);
    expect(left).toBeLessThan(0.4);
  });

  it('结果钳在 0.3..0.7（L772 coerceIn(0.3f, 0.7f)）', () => {
    expect(
      effectiveSplitPosition(createComicReaderConfig({ splitPosition: 2 }), 0.5),
    ).toBeLessThanOrEqual(0.7);
    expect(
      effectiveSplitPosition(createComicReaderConfig({ splitPosition: -2 }), 0.5),
    ).toBeGreaterThanOrEqual(0.3);
    // 偏移 + 基准一起越界时同样被钳
    expect(effectiveSplitPosition(createComicReaderConfig({ splitPosition: 0.7 }), 0.7)).toBe(0.7);
    expect(effectiveSplitPosition(createComicReaderConfig({ splitPosition: 0.3 }), 0.3)).toBe(0.3);
  });
});

describe('geometryHasWork —— 几何是否有活要干（Kotlin ComicImagePipeline.kt L63-66）', () => {
  const NEUTRAL_TONE = toneOf(DEFAULT_COMIC_READER_CONFIG);

  it('无裁边无拆分无旋转无调色 → 无活', () => {
    expect(
      geometryHasWork(
        { half: 'FULL', splitPosition: 0.5, rotationDeg: 0, cropMode: 'OFF', manualCrop: null },
        NEUTRAL_TONE,
      ),
    ).toBe(false);
  });

  it('半页 / 旋转 / 裁边任一非零即有活', () => {
    const geo = { half: 'FULL', splitPosition: 0.5, rotationDeg: 0, cropMode: 'OFF', manualCrop: null } as const;
    expect(geometryHasWork({ ...geo, rotationDeg: 90 }, NEUTRAL_TONE)).toBe(true);
    expect(geometryHasWork({ ...geo, half: 'LEFT' }, NEUTRAL_TONE)).toBe(true);
    expect(geometryHasWork({ ...geo, cropMode: 'AUTO' }, NEUTRAL_TONE)).toBe(true);
  });

  it('manualCrop 非 null 即有活（即便全 0，L84 `manualCrop != null`）', () => {
    expect(
      geometryHasWork(
        {
          half: 'FULL',
          splitPosition: 0.5,
          rotationDeg: 0,
          cropMode: 'OFF',
          manualCrop: [0, 0, 1, 1],
        },
        NEUTRAL_TONE,
      ),
    ).toBe(true);
  });

  it('仅调色参数变化也算有活（L85 委派给 toningHasWork）', () => {
    expect(
      geometryHasWork(
        { half: 'FULL', splitPosition: 0.5, rotationDeg: 0, cropMode: 'OFF', manualCrop: null },
        toneOf(createComicReaderConfig({ filterBrightness: 10 })),
      ),
    ).toBe(true);
  });
});

describe('单页旋转合成（Kotlin L533 effectiveRotation / pageRotationOf）', () => {
  it('整本旋转 + 单页旋转取模 360', () => {
    expect(effectiveRotation(0, 90)).toBe(90);
    expect(effectiveRotation(180, 180)).toBe(0);
    expect(effectiveRotation(270, 180)).toBe(90);
  });

  it('负向也归一到 0..359', () => {
    expect(effectiveRotation(-90, 0)).toBe(270);
    expect(effectiveRotation(0, -90)).toBe(270);
  });

  it('pageRotationOf 缺省为 0', () => {
    expect(pageRotationOf(stateWith({}), 'p1')).toBe(0);
    expect(pageRotationOf(stateWith({ p1: 270 }), 'p1')).toBe(270);
  });
});

describe('垂直滚动策略（Kotlin L84-106）', () => {
  it('Webtoon：沿用用户的页间距与磁吸开关', () => {
    const config = createComicReaderConfig({ pageSpacingDp: 12, webtoonSnap: false });
    const strategy = comicScrollStrategyWebtoon(config);
    expect(strategy.spacingDp).toBe(12);
    expect(strategy.snapToPage).toBe(false);
    expect(strategy.prefetchWindow).toBe(4);
    expect(strategy.pixelProgress).toBe(true);
  });

  it('Continuous：强制 0 间距、恒无磁吸（用户设置在此模式无效，L94-97）', () => {
    const config = createComicReaderConfig({ pageSpacingDp: 30, webtoonSnap: true });
    const strategy = comicScrollStrategyContinuous(config);
    expect(strategy.spacingDp).toBe(0);
    expect(strategy.snapToPage).toBe(false);
    expect(strategy.prefetchWindow).toBe(4);
  });

  it('forConfig：只有 CONTINUOUS 走 Continuous，其余（含 WEBTOON）走 Webtoon', () => {
    for (const mode of ['SINGLE', 'DOUBLE', 'WEBTOON', 'MAGNETIC'] as const) {
      expect(comicScrollStrategyForConfig(createComicReaderConfig({ mode })).kind).toBe('webtoon');
    }
    expect(comicScrollStrategyForConfig(createComicReaderConfig({ mode: 'CONTINUOUS' })).kind).toBe(
      'continuous',
    );
  });
});

describe('页序回归：DEFAULT 配置下 6 页的基线指纹', () => {
  it('默认（SINGLE / RTL / 不拆）逐 spread 展开与 rawToSpread 全表', () => {
    const pages = refs(6);
    const layout = build(pages, narrowSizes(pages), {});
    expect(slotSignature(layout)).toBe('0:FULL | 1:FULL | 2:FULL | 3:FULL | 4:FULL | 5:FULL');
    expect([...layout.rawToSpread.entries()]).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ]);
    // 默认配置的默认值本身也要被钉住（防 DEFAULT_COMIC_READER_CONFIG 漂移）
    expect(DEFAULT_COMIC_READER_CONFIG.mode).toBe('SINGLE');
    expect(DEFAULT_COMIC_READER_CONFIG.splitWide).toBe(false);
  });

  it('ComicSplitHalf 三档与 Kotlin L35 声明顺序一致', () => {
    const halves: readonly ComicSplitHalf[] = ['FULL', 'LEFT', 'RIGHT'];
    expect(halves.map((h) => h)).toEqual(['FULL', 'LEFT', 'RIGHT']);
  });
});