/**
 * tabScreenHeaderParity.test.ts —— 折叠头部的判定状态机（`ui/components/TabScreenHeader.kt`，283 行）。
 *
 * 本轮补的真缺口：iOS 侧此前只有折叠**视觉**（6/10、7/12、19/24、220ms），
 * 判定逻辑（单阈值 20dp + 双阈值迟滞 32/8）**没有任何实现** ——
 * `parityMisc.ts` 里的 `HeaderCollapseGate` 只是个 `{ collapsed: boolean }` 接口占位。
 *
 * 迟滞为什么必须有（Kotlin L45 原文）：
 * 「Separate thresholds prevent repeated collapse/expand when a finger hovers near the boundary.」
 * 单阈值下手指在 20dp 附近抖动会让头部每帧翻转一次。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  HEADER_COLLAPSE_THRESHOLD_DP,
  HEADER_GATE_CLOSE_DP,
  HEADER_GATE_OPEN_DP,
  HeaderCollapseGate,
  createHeaderCollapsedSource,
  headerCollapsed,
} from '@core/ui/tabScreenHeader';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/TabScreenHeader.kt'),
  'utf8',
);

describe('TabScreenHeader.kt：单阈值版本（20dp）', () => {
  it('阈值 20dp；index > 0 或 offset > 20dp 即收起', () => {
    expect(KT).toContain('val thresholdPx = with(LocalDensity.current) { 20.dp.toPx() }');
    expect(KT).toContain('derivedStateOf { state.firstVisibleItemIndex > 0 || state.firstVisibleItemScrollOffset > thresholdPx');
    expect(HEADER_COLLAPSE_THRESHOLD_DP).toBe(20);

    expect(headerCollapsed(0, 0, 20)).toBe(false);
    expect(headerCollapsed(0, 20, 20)).toBe(false); // 严格大于
    expect(headerCollapsed(0, 21, 20)).toBe(true);
    expect(headerCollapsed(1, 0, 20)).toBe(true); // 滚过首项即收起
  });

  it('三个重载（List / Grid / StaggeredGrid）语义完全一致', () => {
    // 同一段逻辑在三个重载里各出现一次
    const occurrences = KT.split('state.firstVisibleItemIndex > 0 || state.firstVisibleItemScrollOffset > thresholdPx').length - 1;
    expect(occurrences).toBe(3);
    // 也各有一处 20.dp
    expect(KT.split('20.dp.toPx()').length - 1).toBe(3);
  });
});

describe('TabScreenHeader.kt：双阈值迟滞（32 / 8）', () => {
  it('closeAt = 32dp、openAt = 8dp', () => {
    expect(KT).toContain('HeaderCollapseGate(with(density) { 32.dp.toPx() }, with(density) { 8.dp.toPx() })');
    expect(HEADER_GATE_CLOSE_DP).toBe(32);
    expect(HEADER_GATE_OPEN_DP).toBe(8);
    // 迟滞带必须存在：open < close
    expect(HEADER_GATE_OPEN_DP).toBeLessThan(HEADER_GATE_CLOSE_DP);
  });

  it('收起：offset > 32 才收；展开：offset ≤ 8 才展；中间是死区', () => {
    expect(KT).toContain('collapsed = if (forced || index > 0) true else if (collapsed) offset > openAt else offset > closeAt');

    const gate = new HeaderCollapseGate(32, 8);
    // 未收起 → 用 closeAt
    expect(gate.update(0, 32, false)).toBe(false);
    expect(gate.update(0, 33, false)).toBe(true);
    // 已收起 → 用 openAt（死区 8..32 内保持收起）
    expect(gate.update(0, 20, false)).toBe(true);
    expect(gate.update(0, 9, false)).toBe(true);
    expect(gate.update(0, 8, false)).toBe(false);
    expect(gate.update(0, 0, false)).toBe(false);
  });

  it('index > 0 时无条件保持收起（offset 归零也不展开）', () => {
    const gate = new HeaderCollapseGate(32, 8);
    expect(gate.update(0, 100, false)).toBe(true);
    expect(gate.update(1, 0, false)).toBe(true);
    // 回到首项且 offset = 0 才展开
    expect(gate.update(0, 0, false)).toBe(false);
  });

  it('forced 优先级最高：即使 offset = 0 也收起', () => {
    const gate = new HeaderCollapseGate(32, 8);
    expect(gate.update(0, 0, true)).toBe(true);
    // 取消 forced 后按迟滞规则回落
    expect(gate.update(0, 9, false)).toBe(true);
    expect(gate.update(0, 0, false)).toBe(false);
  });

  it('状态是持久的（同一实例连续 update 才有迟滞效果）', () => {
    const gate = new HeaderCollapseGate(32, 8);
    // 在死区内反复抖动：状态不变
    for (const offset of [25, 12, 30, 9, 20]) expect(gate.update(0, offset, false)).toBe(false);
    gate.update(0, 40, false);
    for (const offset of [25, 12, 30, 9, 20]) expect(gate.update(0, offset, false)).toBe(true);
  });
});

describe('TabScreenHeader.kt：lambda 版折叠信号', () => {
  it('按密度换算两个阈值，并在每次求值时现取 force()', () => {
    expect(KT).toContain('val force by rememberUpdatedState(forceCollapsed)');
    expect(KT).toContain('gate.update(state.firstVisibleItemIndex, state.firstVisibleItemScrollOffset, force())');

    const index = 0;
    let offset = 0;
    let forced = false;
    const source = createHeaderCollapsedSource({
      density: 2,
      force: () => forced,
      readIndex: () => index,
      readOffset: () => offset,
    });
    // density = 2 → closeAt = 64px、openAt = 16px
    expect(source()).toBe(false);
    offset = 65;
    expect(source()).toBe(true);
    // 死区 16..64 内保持收起
    offset = 40;
    expect(source()).toBe(true);
    offset = 16;
    expect(source()).toBe(false);
    // forced 立即生效
    forced = true;
    offset = 0;
    expect(source()).toBe(true);
  });

  it('「页面体零订阅」的动机写在注释里（重组范围收缩到头部）', () => {
    expect(KT).toContain('折叠状态每次翻转都会重组');
    expect(KT).toContain('页面体零订阅');
    expect(KT).toContain('与 LibraryScreen 的 `headerFractionSource` 同一手法');
  });
});

describe('TabScreenHeader.kt：折叠视觉参数', () => {
  it('密度无关的尺寸与时长（与 TabScreenHeader.tsx 的视觉层一致）', () => {
    const tsx = readFileSync('src/ui/components/TabScreenHeader.tsx', 'utf8');
    // outer/inner 垂直内边距、标题字号、动画时长
    expect(tsx).toContain('collapsed ? 6 : 10');
    expect(tsx).toContain('collapsed ? 7 : 12');
    expect(tsx).toContain('collapsed ? 19 : 24');
    // Kotlin 侧的动画时长（220ms 高度 / 180ms 透明度）也在 TSX 里
    expect(KT).toContain('220ms');
    expect(tsx).toContain('MOTION.headerCollapse');
  });
});
