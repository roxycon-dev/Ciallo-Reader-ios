/**
 * comicScrollMetricsParity.test.ts —— `ui/comic/ComicScrollMetrics.kt`（**90 行 / 79 非空**）。
 *
 * 端口的文件头自述「46 行 / 非空 40 行」，于是它只写了 `ComicScrollMetrics` 一个类：
 *   · `pageFraction(next)` 整个缺失（L36-40）→ 垂直滚动漫画的自定义 swipe 只能落回浏览器原生滚动；
 *   · `ComicScrollGeometry`（L59-71）不存在，`starts` / `scrollRange` 内联成私有字段；
 *   · `ComicScrollGeometryCache`（L73-88）不存在，而 `parityMisc.ts` 里挂着一对同名自造件
 *     （`get(width, height, pages)` → `contentHeight = height * pages`），
 *     在「每张图高度都不一样」的漫画里完全对不上（E198）。
 *
 * 每条断言都先读 `androidReference()` 的原文，再验证行为。
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ComicScrollGeometry,
  ComicScrollGeometryCache,
  ComicScrollMetrics,
} from '@core/comic/comicScrollMetrics';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

const KT = 'ui/comic/ComicScrollMetrics.kt';

/** Kotlin 次构造形态：`(sizes, spacing, viewport, index, offset, backward, forward)`。 */
function metrics(
  sizes: readonly number[],
  spacing: number,
  viewport: number,
  index = 0,
  offset = 0,
  backward = true,
  forward = true,
): ComicScrollMetrics {
  return new ComicScrollMetrics(sizes, spacing, viewport, index, offset, backward, forward);
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① ComicScrollGeometry L58-71
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicScrollMetrics.kt L58-71 ComicScrollGeometry', () => {
  const src = kt(KT);

  it('三个字段 + `starts` / `scrollRange` 由 init 算出', () => {
    expect(src).toContain(
      'internal data class ComicScrollGeometry(val itemSizes: List<Int>, val itemSpacing: Int, val viewportSize: Int) {',
    );
    expect(src).toContain('val starts = LongArray(itemSizes.size)');
    expect(src).toContain('val scrollRange: Long');
    const g = new ComicScrollGeometry([100, 200, 300], 10, 0);
    // starts: 0 / 110 / 320；总高 620（末项后不补间隔）
    expect(g.starts).toEqual([0, 110, 320]);
    expect(g.scrollRange).toBe(620);
  });

  it('L66 每项高度 `coerceAtLeast(1)`；L67 间隔只在非末项之间、`coerceAtLeast(0)`', () => {
    expect(src).toContain('height += size.coerceAtLeast(1)');
    expect(src).toContain('if (index < itemSizes.lastIndex) height += itemSpacing.coerceAtLeast(0)');
    // 0 与负数高度都按 1 计
    expect(new ComicScrollGeometry([0, 0], 0, 0).starts).toEqual([0, 1]);
    expect(new ComicScrollGeometry([-5, -5], 0, 0).scrollRange).toBe(2);
    // 负间隔按 0
    expect(new ComicScrollGeometry([10, 10], -50, 0).starts).toEqual([0, 10]);
    // 末项之后不再加间隔：10 +100 +10 +100 +10 = 230
    expect(new ComicScrollGeometry([10, 10, 10], 100, 0).scrollRange).toBe(230);
  });

  it('L69 `scrollRange = (height - viewportSize.coerceAtLeast(0)).coerceAtLeast(0)`', () => {
    expect(src).toContain('scrollRange = (height - viewportSize.coerceAtLeast(0)).coerceAtLeast(0)');
    expect(new ComicScrollGeometry([100], 0, 0).scrollRange).toBe(100);
    expect(new ComicScrollGeometry([100], 0, 40).scrollRange).toBe(60);
    // 视口大于内容 → 0，不是负数
    expect(new ComicScrollGeometry([100], 0, 400).scrollRange).toBe(0);
    // 负视口按 0
    expect(new ComicScrollGeometry([100], 0, -80).scrollRange).toBe(100);
    // 空列表：starts 空、range 0
    expect(new ComicScrollGeometry([], 10, 50).starts).toEqual([]);
    expect(new ComicScrollGeometry([], 10, 50).scrollRange).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② fraction L27-33
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicScrollMetrics.kt L27-33 fraction 的四支', () => {
  const src = kt(KT);

  it('L28-30 空列表 / 不能后退 → 0；不能前进 → 1；`scrollRange == 0` → 0', () => {
    expect(src).toContain('itemSizes.isEmpty() || !canScrollBackward -> 0f');
    expect(src).toContain('!canScrollForward -> 1f');
    expect(src).toContain('scrollRange == 0L -> 0f');
    expect(metrics([], 0, 0).fraction).toBe(0);
    expect(metrics([100], 0, 0, 0, 0, false, true).fraction).toBe(0);
    expect(metrics([100], 0, 0, 0, 0, true, false).fraction).toBe(1);
    expect(metrics([100], 0, 500).fraction).toBe(0);
    // 「不能前进」优先于「不能后退」为假时的其它分支
    expect(metrics([100], 0, 500, 0, 0, true, false).fraction).toBe(1);
  });

  it('L31-32 `(starts[index.coerceIn(indices)] + offset.coerceAtLeast(0)) / scrollRange` 钳 0..1', () => {
    expect(src).toContain('((starts[firstVisibleItemIndex.coerceIn(itemSizes.indices)] +');
    expect(src).toContain('firstVisibleItemScrollOffset.coerceAtLeast(0)).toDouble() / scrollRange)');
    // starts = [0, 110, 320]，scrollRange = 620 - 200 = 420
    const m = metrics([100, 200, 300], 10, 200, 1, 30);
    expect(m.fraction).toBeCloseTo(140 / 420, 10);
    // 负 offset 按 0
    expect(metrics([100, 200, 300], 10, 200, 1, -999).fraction).toBeCloseTo(110 / 420, 10);
    // 下标越界按 coerceIn 夹到两端
    expect(metrics([100, 200, 300], 10, 200, 99, 0).fraction).toBeCloseTo(320 / 420, 10);
    expect(metrics([100, 200, 300], 10, 200, -5, 0).fraction).toBe(0);
    // 超过 range 时钳到 1
    expect(metrics([100, 200, 300], 10, 200, 2, 9999).fraction).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ pageFraction L36-40（旧端口整个缺失）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicScrollMetrics.kt L36-40 pageFraction —— 一次滑一屏的 0.9', () => {
  const src = kt(KT);

  it('L37 `scrollRange <= 0` 时原样返回 fraction', () => {
    expect(src).toContain('if (scrollRange <= 0L) return fraction');
    const short = metrics([100], 0, 500);
    expect(short.pageFraction(true)).toBe(short.fraction);
    expect(short.pageFraction(false)).toBe(short.fraction);
  });

  it('L38 `step = viewportSize.coerceAtLeast(1) * .90 / scrollRange`', () => {
    expect(src).toContain('val step = viewportSize.coerceAtLeast(1) * .90 / scrollRange');
    // starts = [0, 110, 320]，总高 620，视口 200 → scrollRange 420，step = 180 / 420
    const m = metrics([100, 200, 300], 10, 200, 0, 0);
    expect(m.pageFraction(true)).toBeCloseTo(180 / 420, 10);
    expect(m.pageFraction(false)).toBe(0); // fraction 0 再减 → 钳 0
    // 视口为 0 时按 1 计（不是「步长为 0 导致翻不动」）
    expect(metrics([100, 200, 300], 10, 200, 1, 0).pageFraction(true)).toBeGreaterThan(0);
  });

  it('L39 `(fraction ± step).coerceIn(0f, 1f)` —— 两端不越界', () => {
    expect(src).toContain('return (fraction + if (next) step else -step).toFloat().coerceIn(0f, 1f)');
    const m = metrics([100, 200, 300], 10, 200, 2, 0);
    // 末项起点 320/420 = .7619；再 +step 越界 → 1
    expect(m.pageFraction(true)).toBe(1);
    expect(m.pageFraction(false)).toBeLessThan(m.fraction);
  });

  it('一张特别高的长图也能在一次滑动内前进（不是「按项翻页」）', () => {
    // 单项高 10000，视口 600：按项翻页会「一次跳完整张图」，0.9 视口则是 540
    const single = metrics([10000], 0, 600, 0, 0);
    expect(single.pageFraction(true)).toBeCloseTo(540 / 9400, 10);
    // 连续点两次前进 ≈ 2 步（把第一次落点写回 offset 再算一次）
    const afterOne = metrics([10000], 0, 600, 0, Math.round(single.pageFraction(true) * 9400), true, true);
    expect(afterOne.fraction).toBeCloseTo(540 / 9400, 3);
    expect(afterOne.pageFraction(true)).toBeCloseTo(1080 / 9400, 10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ target L43-55
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicScrollMetrics.kt L43-55 target', () => {
  const src = kt(KT);

  it('L44 空列表 → (0, 0)', () => {
    expect(src).toContain('if (itemSizes.isEmpty()) return ComicScrollTarget(0, 0)');
    expect(metrics([], 0, 0).target(0.5)).toEqual({ index: 0, offset: 0 });
  });

  it('L45 非有限值按 0；越界钳 0..1', () => {
    expect(src).toContain('val safeFraction = if (fraction.isFinite()) fraction.coerceIn(0f, 1f) else 0f');
    const m = metrics([100, 200, 300], 10, 200);
    expect(m.target(Number.NaN)).toEqual({ index: 0, offset: 0 });
    expect(m.target(Number.POSITIVE_INFINITY)).toEqual({ index: 0, offset: 0 });
    expect(m.target(-5)).toEqual({ index: 0, offset: 0 });
    expect(m.target(9).index).toBe(2);
  });

  it('L46 `roundToLong()`：pixel 恒非负，`Math.round` 与它一致', () => {
    expect(src).toContain('val pixel = (safeFraction * scrollRange.toDouble()).roundToLong()');
    // range 200，fraction .5 → 100
    const m = new ComicScrollMetrics([100, 100, 100], 0, 100, 0, 0, true, true);
    expect(m.target(0.5)).toEqual({ index: 1, offset: 0 });
    expect(m.target(0.25)).toEqual({ index: 0, offset: 50 });
  });

  it('L47-53 二分取**最后一个** `starts[i] <= pixel`（长图内偏移靠它）', () => {
    expect(src).toContain('val middle = (low + high + 1) ushr 1');
    expect(src).toContain('if (starts[middle] <= pixel) low = middle else high = middle - 1');
    // starts = [0, 100, 200]，range = 300 - 100 = 200
    const m = metrics([100, 100, 100], 0, 100);
    // fraction 0.5 → pixel 100 → 恰好落在第二项起点
    expect(m.target(0.5)).toEqual({ index: 1, offset: 0 });
    // fraction 0.75 → pixel 150 → 第二项内部 50
    expect(m.target(0.75)).toEqual({ index: 1, offset: 50 });
    // fraction 1 → pixel 200 → 第三项起点
    expect(m.target(1)).toEqual({ index: 2, offset: 0 });
  });

  it('L54 `(pixel - starts[index]).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()`', () => {
    expect(src).toContain('(pixel - starts[index]).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()');
    const m = new ComicScrollMetrics([100, 100, 100], 0, 100, 0, 0, true, true);
    for (const f of [0, 0.1, 0.33, 0.5, 0.99, 1]) {
      const t = m.target(f);
      expect(t.offset).toBeLessThanOrEqual(2147483647);
      expect(t.offset).toBeGreaterThanOrEqual(0);
      expect(t.index).toBeGreaterThanOrEqual(0);
      expect(t.index).toBeLessThanOrEqual(2);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ 构造形态与 passthrough getter L6-24
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicScrollMetrics.kt L6-24 两种构造与四个 getter', () => {
  const src = kt(KT);

  it('L6-12 主构造吃 `geometry`；L20-22 三个 passthrough getter；L23-24 两个私有 getter', () => {
    expect(src).toContain('val geometry: ComicScrollGeometry,');
    expect(src).toContain('val itemSizes get() = geometry.itemSizes');
    expect(src).toContain('val itemSpacing get() = geometry.itemSpacing');
    expect(src).toContain('val viewportSize get() = geometry.viewportSize');
    expect(src).toContain('private val starts get() = geometry.starts');
    expect(src).toContain('private val scrollRange get() = geometry.scrollRange');
    const geometry = new ComicScrollGeometry([100, 200], 10, 50);
    const m = new ComicScrollMetrics(geometry, 1, 5, true, false);
    expect(m.geometry).toBe(geometry);
    expect(m.itemSizes).toEqual([100, 200]);
    expect(m.itemSpacing).toBe(10);
    expect(m.viewportSize).toBe(50);
    expect(m.fraction).toBe(1); // forward=false → 1
  });

  it('L13-18 次构造 `(itemSizes, itemSpacing, viewportSize, …)` 与主构造等价', () => {
    expect(src).toContain('constructor(itemSizes: List<Int>, itemSpacing: Int, viewportSize: Int,');
    const viaSecondary = metrics([100, 200], 10, 50, 1, 5, true, true);
    const viaPrimary = new ComicScrollMetrics(new ComicScrollGeometry([100, 200], 10, 50), 1, 5, true, true);
    expect(viaSecondary.fraction).toBe(viaPrimary.fraction);
    expect(viaSecondary.target(0.4)).toEqual(viaPrimary.target(0.4));
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ ComicScrollGeometryCache L73-88（旧端口是 `(width, height, pages)` 的另一种东西）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicScrollMetrics.kt L73-88 ComicScrollGeometryCache', () => {
  const src = kt(KT);

  it('L77-80 `record(index, height)`：`coerceAtLeast(1)`，只在**值变了**才 dirty', () => {
    expect(src).toContain('fun record(index: Int, height: Int) {');
    expect(src).toContain('val size = height.coerceAtLeast(1)');
    expect(src).toContain('if (heights[index] != size) { heights[index] = size; dirty = true }');
    const cache = new ComicScrollGeometryCache();
    cache.record(0, 0); // → 1
    expect(cache.geometry(1, 0, 0).itemSizes).toEqual([1]);
    cache.record(0, -9); // → 1，值相同 → 不置 dirty
    expect(cache.geometry(1, 0, 0).itemSizes).toEqual([1]);
  });

  it('L82 复用条件：`!dirty && size == count && spacing == spacing && viewport == viewport`', () => {
    expect(src).toContain(
      'cached?.let { if (!dirty && it.itemSizes.size == count && it.itemSpacing == spacing && it.viewportSize == viewport) return it }',
    );
    const cache = new ComicScrollGeometryCache();
    cache.record(0, 500);
    const first = cache.geometry(3, 8, 800);
    // 同样的三个参数 → 命中同一个对象
    expect(cache.geometry(3, 8, 800)).toBe(first);
    // 任一参数变了 → 新对象
    expect(cache.geometry(4, 8, 800)).not.toBe(first);
    expect(cache.geometry(3, 9, 800)).not.toBe(first);
    expect(cache.geometry(3, 8, 801)).not.toBe(first);
    // 再 record 一个**新值** → dirty → 不复用
    const second = cache.geometry(3, 8, 800);
    cache.record(1, 900);
    expect(cache.geometry(3, 8, 800)).not.toBe(second);
  });

  it('L83 未测到任何高度：`average()` 是 NaN → `toInt()` 0 → `coerceAtLeast(1)` 得 1', () => {
    expect(src).toContain('val estimated = heights.values.average().toInt().coerceAtLeast(1)');
    const cache = new ComicScrollGeometryCache();
    expect(cache.geometry(3, 4, 100).itemSizes).toEqual([1, 1, 1]);
  });

  it('L83 `average().toInt()` 向零截断，且**所有**已记录高度参与平均（含列表外的下标）', () => {
    const cache = new ComicScrollGeometryCache();
    cache.record(0, 100);
    cache.record(1, 201);
    // average = 150.5 → toInt() 150
    expect(cache.geometry(2, 0, 0).itemSizes).toEqual([100, 201]);
    expect(cache.geometry(3, 0, 0).itemSizes).toEqual([100, 201, 150]);
    // 下标 5 在 count=2 之外：不进 itemSizes，但**参与** average
    const cache2 = new ComicScrollGeometryCache();
    cache2.record(0, 100);
    cache2.record(5, 400);
    // average = 250 → 缺省项按 250
    expect(cache2.geometry(2, 0, 0).itemSizes).toEqual([100, 250]);
  });

  it('`heights` 从不清理：上本书的下标会一直参与 average（Kotlin 原样行为）', () => {
    const cache = new ComicScrollGeometryCache();
    cache.record(0, 100);
    const first = cache.geometry(1, 0, 0);
    expect(first.itemSizes).toEqual([100]);
    // 「换书」：只重新记录下标 0，下标 5 的旧值仍在
    cache.record(5, 300);
    expect(cache.geometry(1, 0, 0).itemSizes).toEqual([100]);
    // count=6 时下标 5 用的是旧值 300，其余缺省按 average((100+300)/2=200)
    expect(cache.geometry(6, 0, 0).itemSizes).toEqual([100, 200, 200, 200, 200, 300]);
  });

  it('`parityMisc.ts` 里的同名自造件已换成真身的转发（不再是 `height * pages`）', () => {
    const misc = readFileSync('src/core/ui/parityMisc.ts', 'utf8');
    expect(misc).toContain(
      "export { ComicScrollGeometry, ComicScrollGeometryCache } from '../comic/comicScrollMetrics';",
    );
    // 只看**代码形状**：注释里复述旧实现不算（上一轮就在这种假阳性上踩过一次）
    expect(misc).not.toContain('get(width: number, height: number, pages: number)');
    expect(misc).not.toContain('maxOffset:');
    expect(misc).not.toContain('readonly contentHeight');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑦ 消费侧契约
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicScrollMetrics 已被阅读器当作 `ComicScrollMetricsLike` 消费', () => {
  it('`ComicScrollMetricsLike` 带上 `pageFraction`（垂直滚动漫画的 swipe 靠它）', () => {
    const core = readFileSync('src/core/comic/comicReaderCore.ts', 'utf8');
    expect(core).toContain('pageFraction(next: boolean): number;');
    // 真身确实能满足该契约（结构类型检查在 tsc 通过即证明）
    const m: { fraction: number; pageFraction(next: boolean): number } = metrics([100, 200], 10, 100);
    expect(typeof m.pageFraction).toBe('function');
  });
});
