/**
 * godStarRatingParity.test.ts —— 神回评分条：0.5 步长钳制 + 五角星路径 + 小金粒几何。
 *
 * `god/GodStarRating.kt`（319 行）被榜单卡片、神回详情、只读小星级三处共用。
 * 本轮补的缺口：`starPath()` 与 `GodSparks()` 的几何此前 iOS 侧完全没有 ——
 * 榜单画不出同一颗「尖朝上、内半径 0.46R」的星，点亮时也没有小金粒。
 *
 * 评分钳制本身早已在 `godTypes.clampGodRating()`，本文件再断言一次语义（四舍五入 + 双端钳制）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  GOD_RATING,
  GOD_RATING_MAX,
  GOD_RATING_MIN,
  GOD_RATING_STEP,
  GOD_SPARK_ALPHA_MAX,
  GOD_SPARK_COUNT,
  GOD_SPARK_DISTANCE_RATIO,
  GOD_SPARK_MS,
  GOD_SPARK_RADIUS_DECAY,
  GOD_SPARK_RADIUS_RATIO,
  STAR_INNER_RADIUS_RATIO,
  STAR_POINT_COUNT,
  coerceRating,
  godSparkParticles,
  starPathD,
  starPathPoints,
} from '@core/god/godStarRating';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/god/GodStarRating.kt'),
  'utf8',
);

describe('GodStarRating.kt：评分范围与步长', () => {
  it('0.5 ~ 5.0、步长 0.5，且**不允许 0 分**', () => {
    expect(KT).toContain('const val GOD_RATING_MIN = 0.5f');
    expect(KT).toContain('const val GOD_RATING_MAX = 5f');
    expect(KT).toContain('const val GOD_RATING_STEP = 0.5f');
    expect(KT).toContain('不允许 0 分：打了神回却零分自相矛盾');
    expect(GOD_RATING_MIN).toBe(0.5);
    expect(GOD_RATING_MAX).toBe(5);
    expect(GOD_RATING_STEP).toBe(0.5);
    expect(GOD_RATING).toEqual({ min: 0.5, max: 5, step: 0.5 });
  });

  it('coerceRating：四舍五入到 0.5，再钳到 [0.5, 5]', () => {
    expect(KT).toContain('((this / GOD_RATING_STEP).roundToInt() * GOD_RATING_STEP)');
    expect(KT).toContain('.coerceIn(GOD_RATING_MIN, GOD_RATING_MAX)');

    // 精确值原样
    for (const v of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) expect(coerceRating(v)).toBe(v);
    // 四舍五入（不是截断）：2.25 → 2.5、2.24 → 2
    expect(coerceRating(2.25)).toBe(2.5);
    expect(coerceRating(2.24)).toBe(2);
    expect(coerceRating(2.74)).toBe(2.5);
    expect(coerceRating(2.76)).toBe(3);
    // 钳制：0 分不存在
    expect(coerceRating(0)).toBe(0.5);
    expect(coerceRating(-3)).toBe(0.5);
    expect(coerceRating(0.1)).toBe(0.5);
    // 上限
    expect(coerceRating(9)).toBe(5);
    expect(coerceRating(5.4)).toBe(5);
  });
});

describe('GodStarRating.kt：五角星路径', () => {
  it('内半径 0.46R、10 个顶点、起始 -90°（尖朝上）、步进 π/5', () => {
    expect(KT).toContain('val inner = radius * 0.46f');
    expect(KT).toContain('for (i in 0 until 10)');
    expect(KT).toContain('val angle = (-PI / 2) + i * (PI / 5)');
    expect(STAR_INNER_RADIUS_RATIO).toBe(0.46);
    expect(STAR_POINT_COUNT).toBe(10);

    const points = starPathPoints(10, { x: 0, y: 0 });
    expect(points).toHaveLength(10);
    // 第 0 点（尖）在正上方
    expect(points[0]?.x).toBeCloseTo(0, 9);
    expect(points[0]?.y).toBeCloseTo(-10, 9);
    // 第 1 点（凹）在内圈 0.46R，angle = -π/2 + π/5
    const innerAngle = -Math.PI / 2 + Math.PI / 5;
    expect(points[1]?.x).toBeCloseTo(Math.cos(innerAngle) * 4.6, 9);
    expect(points[1]?.y).toBeCloseTo(Math.sin(innerAngle) * 4.6, 9);
    // 偶数下标在外圈、奇数在内圈
    for (let i = 0; i < 10; i += 1) {
      const r = Math.hypot(points[i]?.x ?? 0, points[i]?.y ?? 0);
      expect(r).toBeCloseTo(i % 2 === 0 ? 10 : 4.6, 6);
    }
    // 中心偏移生效
    const shifted = starPathPoints(10, { x: 100, y: 200 });
    expect(shifted[0]?.x).toBeCloseTo(100, 9);
    expect(shifted[0]?.y).toBeCloseTo(190, 9);
  });

  it('starPathD 生成闭合 SVG 路径（M + 9×L + Z）', () => {
    const d = starPathD(10, { x: 50, y: 50 });
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.split('L')).toHaveLength(10); // 9 个 L → split 出 10 段
    expect(d).toContain('50 40'); // 第一个点 (50, 40)
  });
});

describe('GodStarRating.kt：小金粒', () => {
  it('6 颗、520ms、距离 0.55w·p、alpha (1-p)·0.9、半径 0.055w·(1-0.5p)', () => {
    expect(KT).toContain('for (i in 0 until 6)');
    expect(KT).toContain('animationSpec = tween(520)');
    expect(KT).toContain('val dist = size.width * 0.55f * progress');
    expect(KT).toContain('val alpha = (1f - progress).coerceIn(0f, 1f) * 0.9f');
    expect(KT).toContain('radius = size.width * 0.055f * (1f - progress * 0.5f)');
    expect(GOD_SPARK_COUNT).toBe(6);
    expect(GOD_SPARK_MS).toBe(520);
    expect(GOD_SPARK_DISTANCE_RATIO).toBe(0.55);
    expect(GOD_SPARK_ALPHA_MAX).toBe(0.9);
    expect(GOD_SPARK_RADIUS_RATIO).toBe(0.055);
    expect(GOD_SPARK_RADIUS_DECAY).toBe(0.5);
  });

  it('端点整帧不画（progress ≤ 0 或 ≥ 1）', () => {
    expect(KT).toContain('if (progress <= 0f || progress >= 1f) return@Canvas');
    expect(godSparkParticles(0, 100)).toEqual([]);
    expect(godSparkParticles(1, 100)).toEqual([]);
    expect(godSparkParticles(1.5, 100)).toEqual([]);
    expect(godSparkParticles(-0.2, 100)).toEqual([]);
  });

  it('中间帧：6 颗、第一颗正上方、距离与半径随 p 变化', () => {
    const mid = godSparkParticles(0.5, 100);
    expect(mid).toHaveLength(6);
    // 第一颗：angle = -π/2 → offsetX ≈ 0、offsetY ≈ -27.5（0.55×100×0.5）
    expect(mid[0]?.offsetX).toBeCloseTo(0, 9);
    expect(mid[0]?.offsetY).toBeCloseTo(-27.5, 9);
    // alpha = (1-0.5)×0.9 = 0.45
    expect(mid[0]?.alpha).toBeCloseTo(0.45, 9);
    // radius = 100×0.055×(1-0.25) = 4.125
    expect(mid[0]?.radius).toBeCloseTo(4.125, 9);
    // 角度间隔 = 2π/6
    expect((mid[1]?.angle ?? 0) - (mid[0]?.angle ?? 0)).toBeCloseTo(Math.PI / 3, 9);
    // 距离随 p 线性增长
    expect(godSparkParticles(0.25, 100)[0]?.offsetY).toBeCloseTo(-0.55 * 100 * 0.25, 9);
    expect(godSparkParticles(0.75, 100)[0]?.offsetY).toBeCloseTo(-0.55 * 100 * 0.75, 9);
  });
});

describe('GodStarRating.kt：交互与半星渲染', () => {
  it('半星用 clipRect 只画左半边（不拼两个 path）', () => {
    expect(KT).toContain('半星用 [clipRect] 只绘制左半边（避免两个 path 拼接的错位）');
    expect(KT).toContain('clipRect');
  });

  it('每跨过一个半星步进触发一次轻触觉（不是每帧）', () => {
    expect(KT).toContain('每跨过一个半星步进触发一次轻触觉');
    expect(KT).toContain('HapticsGate');
  });

  it('只读小星级默认 14dp', () => {
    expect(KT).toContain('starSize: Dp = 14.dp');
    expect(KT).toContain('fun GodStarsReadonly(');
  });
});
