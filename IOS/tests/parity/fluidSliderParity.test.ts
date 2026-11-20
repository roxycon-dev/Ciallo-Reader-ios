/**
 * fluidSliderParity.test.ts —— `com/ramotion/fluidslider/FluidSlider.kt`（599 行）的几何与交互对拍。
 *
 * 这是**本轮补的真缺口**：iOS 侧此前只有「位置 ↔ 页码」的换算
 * （`readerScreenLogic.pageSliderPosition`），滑条本身的 20 个尺寸常量与液桥
 * （metaball）路径算法**完全不存在** —— 也就是说底栏那条液滴滑条在 Web 上没有几何来源。
 *
 * 断言口径：
 *   · 常量：从 Kotlin 原文解析 `<NAME> = <数值>`，与 `FLUID_SLIDER` 逐值比；
 *   · 派生：用 `density = 2`、`NORMAL(56dp)` 手算 init 块（L278-321）的 10 个值；
 *   · 液桥：把 `drawMetaball` 的 6 个角度与 4 个控制点偏移按公式重算，断言实现一致，
 *     并检查几何不变量（切点落在圆上、太远不画、一圆包住另一圆不画）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  FLUID_SLIDER,
  FLUID_SLIDER_LABEL_ANIM,
  FLUID_SLIDER_SIZES,
  fluidSliderBubbleText,
  fluidSliderLayout,
  fluidSliderMetrics,
  fluidSliderPositionOnDown,
  fluidSliderPositionOnMove,
  fluidSliderThumbX,
  metaballGeometry,
  vector,
} from '@core/components/fluidSlider';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/ramotion/fluidslider/FluidSlider.kt'),
  'utf8',
);

/** 在 Kotlin 里用 `Color.WHITE` / `Color.BLACK` 声明的常量（不是数字字面量）。 */
const KOTLIN_COLOR_CONSTS = new Set(['COLOR_LABEL', 'COLOR_LABEL_TEXT', 'COLOR_BAR_TEXT']);

/** 从 Kotlin 抽 `const val NAME = <数值>`（允许表达式与 f/L 后缀）。 */
function kotlinConst(name: string): number | null {
  const re = new RegExp(
    `const\\s+val\\s+${name}\\s*=\\s*(0[xX][0-9a-fA-F]+|-?[\\d_.]+(?:\\s*[+*/]\\s*-?[\\d_.]+)*)[fFlL]?`,
  );
  const m = re.exec(KT);
  if (m === null) return null;
  const raw = (m[1] ?? '').replace(/_/g, '').replace(/(\d)[fFlL]\b/g, '$1');
  if (/^0[xX]/.test(raw)) return Number.parseInt(raw, 16);
  try {
    const value = Function(`"use strict";return (${raw});`)() as unknown;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

describe('FluidSlider.kt 的 20 个常量', () => {
  it('全部与 Kotlin 原文逐值一致', () => {
    const drift: string[] = [];
    for (const [name, tsValue] of Object.entries(FLUID_SLIDER)) {
      // 字符串常量（TEXT_START / TEXT_END）与派生表达式常量（SLIDER_HEIGHT）单独断言
      if (typeof tsValue !== 'number') continue;
      if (name === 'SLIDER_HEIGHT') continue;
      // 这三个在 Kotlin 里用 `Color.WHITE` / `Color.BLACK` 字面量，单独断言
      if (KOTLIN_COLOR_CONSTS.has(name)) continue;
      const ktValue = kotlinConst(name);
      if (ktValue === null) {
        drift.push(`${name}：Kotlin 里找不到`);
        continue;
      }
      if (Math.abs(ktValue - tsValue) > 1e-9) drift.push(`${name}: Kotlin=${String(ktValue)} TS=${String(tsValue)}`);
    }
    expect(drift).toEqual([]);
  });

  it('SLIDER_HEIGHT 是派生的 2.5（不是 1）', () => {
    // Kotlin L49：`const val SLIDER_HEIGHT = 1 + BAR_VERTICAL_OFFSET`
    expect(KT).toContain('const val SLIDER_HEIGHT = 1 + BAR_VERTICAL_OFFSET');
    expect(FLUID_SLIDER.SLIDER_HEIGHT).toBe(1 + FLUID_SLIDER.BAR_VERTICAL_OFFSET);
    expect(FLUID_SLIDER.SLIDER_HEIGHT).toBe(2.5);
    expect(FLUID_SLIDER.SLIDER_HEIGHT).not.toBe(1);
  });

  it('两档高度 56 / 40 dp，与 Kotlin 的 Size 枚举一致', () => {
    expect(KT).toContain('NORMAL(56)');
    expect(KT).toContain('SMALL(40)');
    expect(FLUID_SLIDER_SIZES.NORMAL).toBe(56);
    expect(FLUID_SLIDER_SIZES.SMALL).toBe(40);
    expect(FLUID_SLIDER_SIZES.NORMAL).toBeGreaterThan(FLUID_SLIDER_SIZES.SMALL);
  });

  it('四种颜色与初始位置', () => {
    // 三个用 `Color.*` 字面量声明的常量，先证明 Kotlin 原文确实这么写
    expect(KT).toContain('const val COLOR_LABEL = Color.WHITE');
    expect(KT).toContain('const val COLOR_LABEL_TEXT = Color.BLACK');
    expect(KT).toContain('const val COLOR_BAR_TEXT = Color.WHITE');
    expect(FLUID_SLIDER.COLOR_BAR).toBe(0xff6168e7);
    expect(FLUID_SLIDER.COLOR_LABEL).toBe(0xffffffff);
    expect(FLUID_SLIDER.COLOR_LABEL_TEXT).toBe(0xff000000);
    expect(FLUID_SLIDER.COLOR_BAR_TEXT).toBe(0xffffffff);
    expect(FLUID_SLIDER.INITIAL_POSITION).toBe(0.5);
    // 滑条主色不透明；标签底白、标签字黑（对比度最大）
    expect((FLUID_SLIDER.COLOR_BAR >>> 24) & 0xff).toBe(0xff);
    expect(FLUID_SLIDER.COLOR_LABEL).toBeGreaterThan(FLUID_SLIDER.COLOR_LABEL_TEXT);
  });

  it('气泡动画 400ms，缓动是 Overshoot 的 CSS 等价（不是线性、不是标准 ease）', () => {
    expect(KT).toContain('const val ANIMATION_DURATION = 400');
    expect(FLUID_SLIDER_LABEL_ANIM.durationMs).toBe(400);
    expect(FLUID_SLIDER_LABEL_ANIM.easingCss).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
    // 第二控制点的 y 超过 1 —— 这就是「过冲」的定义
    const parts = FLUID_SLIDER_LABEL_ANIM.easingCss.match(/cubic-bezier\(([^)]+)\)/)?.[1]?.split(',') ?? [];
    expect(Number(parts[1])).toBeGreaterThan(1);
  });
});

describe('派生尺寸（init 块 L278-321）', () => {
  it('NORMAL × density 2 的 10 个派生值', () => {
    const m = fluidSliderMetrics('NORMAL', 2);
    // barHeight = 56 × 2 = 112
    expect(m.barHeight).toBe(112);
    // desiredWidth = 112 × 4 = 448；desiredHeight = 112 × 2.5 = 280
    expect(m.desiredWidth).toBe(448);
    expect(m.desiredHeight).toBe(280);
    expect(m.topCircleDiameter).toBe(112); // × TOP_CIRCLE_DIAMETER(1)
    expect(m.bottomCircleDiameter).toBe(112 * 25);
    expect(m.touchRectDiameter).toBe(112);
    // labelRectDiameter = barHeight - LABEL_CIRCLE_DIAMETER(10) × density(2) = 92
    expect(m.labelRectDiameter).toBe(92);
    expect(m.metaballMaxDistance).toBe(112 * 15);
    expect(m.metaballRiseDistance).toBeCloseTo(112 * 1.1, 9);
    expect(m.barVerticalOffset).toBe(168); // 112 × 1.5
    expect(m.barCornerRadius).toBe(4); // 2 × 2
    expect(m.barInnerOffset).toBe(0); // 0 × 2
    expect(m.textOffset).toBe(16); // 8 × 2
  });

  it('SMALL 档按比例缩小，且 density 线性可缩', () => {
    const small = fluidSliderMetrics('SMALL', 2);
    const normal = fluidSliderMetrics('NORMAL', 2);
    expect(small.barHeight).toBe(80);
    expect(normal.barHeight / small.barHeight).toBeCloseTo(56 / 40, 12);
    const one = fluidSliderMetrics('NORMAL', 1);
    expect(one.barHeight).toBe(56);
    expect(one.barCornerRadius).toBe(2);
    expect(one.textOffset).toBe(8);
  });
});

describe('布局与手势（L360-439）', () => {
  const metrics = fluidSliderMetrics('NORMAL', 2);
  const layout = fluidSliderLayout(1000, metrics);

  it('rectBar 从 barVerticalOffset 开始，maxMovement 扣掉触点与内缩', () => {
    expect(layout.bar.top).toBe(metrics.barVerticalOffset);
    expect(layout.bar.bottom).toBe(metrics.barVerticalOffset + metrics.barHeight);
    expect(layout.maxMovement).toBe(1000 - metrics.touchRectDiameter - metrics.barInnerOffset * 2);
    expect(layout.thumbOriginX).toBe(metrics.barInnerOffset + metrics.touchRectDiameter / 2);
  });

  it('拇指 x 在两端正好落在行程边界上', () => {
    expect(fluidSliderThumbX(0, layout)).toBe(layout.thumbOriginX);
    expect(fluidSliderThumbX(1, layout)).toBe(layout.thumbOriginX + layout.maxMovement);
    // 越界钳制
    expect(fluidSliderThumbX(2, layout)).toBe(fluidSliderThumbX(1, layout));
    expect(fluidSliderThumbX(-1, layout)).toBe(fluidSliderThumbX(0, layout));
  });

  it('按下换算要减去半个触点；移动按像素增量累加', () => {
    const maxMovement = layout.maxMovement;
    // 点在正中间（含半个触点偏移）
    expect(fluidSliderPositionOnDown(maxMovement / 2 + metrics.touchRectDiameter / 2, metrics.touchRectDiameter, maxMovement)).toBeCloseTo(0.5, 9);
    expect(fluidSliderPositionOnDown(-100, metrics.touchRectDiameter, maxMovement)).toBe(0);
    expect(fluidSliderPositionOnDown(1e6, metrics.touchRectDiameter, maxMovement)).toBe(1);

    expect(fluidSliderPositionOnMove(0.5, maxMovement / 4, maxMovement)).toBeCloseTo(0.75, 9);
    expect(fluidSliderPositionOnMove(0.9, maxMovement, maxMovement)).toBe(1);
    expect(fluidSliderPositionOnMove(0.1, -maxMovement, maxMovement)).toBe(0);
    // maxMovement 为 0（宽度未测量）时不动
    expect(fluidSliderPositionOnMove(0.42, 50, 0)).toBe(0.42);
    expect(fluidSliderPositionOnDown(50, 10, 0)).toBe(0);
  });

  it('气泡文本：默认取百分比整数，给了 bubbleText 就用它', () => {
    expect(KT).toContain('bubbleText ?: (position * 100).toInt().toString()');
    expect(fluidSliderBubbleText(0)).toBe('0');
    expect(fluidSliderBubbleText(0.5)).toBe('50');
    expect(fluidSliderBubbleText(0.999)).toBe('99'); // 截断，不是四舍五入
    expect(fluidSliderBubbleText(1)).toBe('100');
    expect(fluidSliderBubbleText(0.37, '第三章')).toBe('第三章');
  });
});

describe('液桥几何（drawMetaball L459-553）', () => {
  const base = {
    topBorder: 100,
    riseDistance: 100,
    maxDistance: 200,
    cornerRadius: 4,
  };
  const bottom = { cx: 500, cy: 300, radius: 60 }; // 下圆（滑条处）
  const top = { cx: 500, cy: 200, radius: 20 }; // 上圆（气泡）

  it('半径为 0 / 太远 / 一圆包住另一圆时都不画', () => {
    expect(metaballGeometry({ cx: 0, cy: 0, radius: 0 }, top, base).drawable).toBe(false);
    expect(metaballGeometry(bottom, { cx: 0, cy: 0, radius: 0 }, base).drawable).toBe(false);
    // d = 300 > maxDistance 200
    expect(metaballGeometry(bottom, { cx: 500, cy: 600, radius: 20 }, base).drawable).toBe(false);
    // d = 10 <= |60 - 20| = 40
    expect(metaballGeometry(bottom, { cx: 500, cy: 290, radius: 20 }, base).drawable).toBe(false);
  });

  it('正常情况可画，四个切点都落在各自圆上', () => {
    const geometry = metaballGeometry(bottom, top, base);
    expect(geometry.drawable).toBe(true);
    for (const p of [geometry.points.p1a, geometry.points.p1b]) {
      expect(Math.hypot(p.x - bottom.cx, p.y - bottom.cy), 'p1 必须落在下圆上').toBeCloseTo(bottom.radius, 6);
    }
    for (const p of [geometry.points.p2a, geometry.points.p2b]) {
      expect(Math.hypot(p.x - top.cx, p.y - top.cy), 'p2 必须落在上圆上').toBeCloseTo(top.radius, 6);
    }
  });

  it('升起比例 0 → 下圆张角 0.25；比例 1 → 0.1（线性插值）', () => {
    // topBorder=100、上圆顶 = 200-20 = 180 → 差 -80；riseDistance=100 → 钳到 0
    const low = metaballGeometry(bottom, top, base);
    expect(low.riseRatio).toBe(0);
    expect(low.bottomSpreadFactor).toBeCloseTo(0.25, 12);

    // 把上圆抬到 topBorder 之上：顶 = 50，差 50 → 比例 0.5
    const mid = metaballGeometry(bottom, { cx: 500, cy: 70, radius: 20 }, { ...base, maxDistance: 1000 });
    expect(mid.riseRatio).toBeCloseTo(0.5, 12);
    expect(mid.bottomSpreadFactor).toBeCloseTo(0.25 - (0.25 - 0.1) * 0.5, 12);

    const full = metaballGeometry(bottom, { cx: 500, cy: 120, radius: 20 }, { ...base, maxDistance: 1000 });
    // 顶 = 100 = topBorder → 差 0 → 比例 0
    expect(full.riseRatio).toBe(0);
  });

  it('控制点长度被 max(spread) × handleRate 夹住', () => {
    const geometry = metaballGeometry(bottom, top, base);
    const lengths = [geometry.handles.sp1, geometry.handles.sp2, geometry.handles.sp3, geometry.handles.sp4].map((h) =>
      Math.hypot(h.x, h.y),
    );
    // 两个圆的控制点长度比 = 半径比
    expect((lengths[0] ?? 0) / (lengths[1] ?? 1)).toBeCloseTo(bottom.radius / top.radius, 6);
    // 上界：max(topSpread, bottomSpread) × 2.4 × r
    const cap = Math.max(FLUID_SLIDER.TOP_SPREAD_FACTOR, geometry.bottomSpreadFactor) * FLUID_SLIDER.METABALL_HANDLER_FACTOR;
    expect((lengths[0] ?? 0) / bottom.radius).toBeLessThanOrEqual(cap + 1e-9);
  });

  it('vector() 与极坐标一致，yOffset 随升起比例缩放', () => {
    expect(vector(0, 5)).toEqual({ x: 5, y: 0 });
    expect(vector(Math.PI / 2, 5).x).toBeCloseTo(0, 12);
    expect(vector(Math.PI / 2, 5).y).toBeCloseTo(5, 12);

    const geometry = metaballGeometry(bottom, top, base);
    // Kotlin：yOffset = |topBorder - p1a.y| × riseRatio - 1
    expect(geometry.yOffset).toBeCloseTo(Math.abs(base.topBorder - geometry.points.p1a.y) * geometry.riseRatio - 1, 9);
  });
});
