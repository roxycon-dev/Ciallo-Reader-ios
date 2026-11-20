/**
 * cardTweaksAndShadowAnimationParity.test.ts —— 毛玻璃卡片参数 + 影子辉光动画。
 *
 * 覆盖 2 个 Kotlin 文件：
 *   `ui/components/CardTweaks.kt`            9 个默认参数（含已停用的 `rippleAlpha`）
 *   `me/trishiraj/shadowglow/Animation.kt`   呼吸值（0→intensity，Reverse）与光尾进度（Linear，Restart）
 *
 * 这两处都是「默认值/缓动错了只会觉得『手感怪』」的类型：
 * 卡片参数漂一档就视觉变差；呼吸动画用错 RepeatMode 会「闪一下停住」。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CARD_TWEAKS,
  FALLBACK_CARD_TWEAKS,
  cardCameraDistance,
  glassThicknessGains,
  rescaleCornerRadius,
  type CardTweaks,
} from '@core/glass/cardTweaks';
import { FAST_OUT_SLOW_IN } from '@ui/components/feedback/shadowGlowAnimation';

import { androidReference } from '../helpers/androidReference';

const KT = 'app/src/main/java/com/example';
const SHADOW_KT = 'app/src/main/java/me/trishiraj/shadowglow';

function kt(rel: string): string {
  return readFileSync(androidReference(`${KT}/${rel}`), 'utf8');
}

function shadowKt(rel: string): string {
  return readFileSync(androidReference(`${SHADOW_KT}/${rel}`), 'utf8');
}

/** 从 Kotlin 解析 `val <name>: Float = <数值>f`（data class 的主构造参数）。 */
function ktDefault(source: string, name: string): number | null {
  const m = new RegExp(`val\\s+${name}\\s*:\\s*Float\\s*=\\s*(-?[\\d.]+)f`).exec(source);
  if (m === null) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
}

describe('CardTweaks.kt：9 个默认参数', () => {
  const source = kt('ui/components/CardTweaks.kt');

  it('全部与 Kotlin 主构造默认值逐值一致', () => {
    const keys: readonly (readonly [string, keyof CardTweaks])[] = [
      ['blurRadiusDp', 'blurRadiusDp'],
      ['cornerRadiusDp', 'cornerRadiusDp'],
      ['tiltMaxDeg', 'tiltMaxDeg'],
      ['cameraDistMult', 'cameraDistMult'],
      ['rippleAlpha', 'rippleAlpha'],
      ['tintMix', 'tintMix'],
      ['pressStrength', 'pressStrength'],
      ['pressRadius', 'pressRadius'],
      ['cardAlpha', 'cardAlpha'],
    ];
    const drift: string[] = [];
    for (const [ktName, tsKey] of keys) {
      const ktValue = ktDefault(source, ktName);
      if (ktValue === null) {
        drift.push(`${ktName}：Kotlin 里没解析到`);
        continue;
      }
      if (Math.abs(ktValue - DEFAULT_CARD_TWEAKS[tsKey]) > 1e-9) {
        drift.push(`${ktName}: Kotlin=${String(ktValue)} TS=${String(DEFAULT_CARD_TWEAKS[tsKey])}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('v2 出厂值的关键三项：tilt 6° / 相机 5× / 压力 125%', () => {
    expect(DEFAULT_CARD_TWEAKS.tiltMaxDeg).toBe(6);
    expect(DEFAULT_CARD_TWEAKS.cameraDistMult).toBe(5);
    expect(DEFAULT_CARD_TWEAKS.pressStrength).toBe(1.25);
    // 注释里也写明了这三项是「整体上探一档」的结果
    expect(source).toContain('（tilt 6° / 相机 5× / 压力 125%）');
  });

  it('rippleAlpha 已停用但字段保留（兼容既有持久化数据）', () => {
    expect(source).toContain('已停用：触点涟漪扩散层已按「按压不得出现任何扩大圆环」的验收标准整体移除');
    expect(DEFAULT_CARD_TWEAKS.rippleAlpha).toBe(0.42);
    // 字段仍在（9 个），不能因为停用就删掉——删了旧数据会读不出来
    expect(Object.keys(DEFAULT_CARD_TWEAKS)).toHaveLength(9);
    expect(Object.keys(DEFAULT_CARD_TWEAKS)).toContain('rippleAlpha');
  });

  it('默认实例就是这 9 个值（LocalCardTweaks 的回退）', () => {
    expect(FALLBACK_CARD_TWEAKS).toEqual(DEFAULT_CARD_TWEAKS);
    // 与 Kotlin `compositionLocalOf { CardTweaks() }` 的默认构造一致
    expect(source).toContain('val LocalCardTweaks = compositionLocalOf { CardTweaks() }');
  });
});

describe('GlassCard.kt 的三条派生公式（经 cardTweaks.ts）', () => {
  it('rescaleCornerRadius：null 回落自身，factor = corner/16，等于 16 时原样', () => {
    expect(rescaleCornerRadius(null, 16)).toBe(16);
    expect(rescaleCornerRadius(null, 24)).toBe(24);
    expect(rescaleCornerRadius(12, 16)).toBe(12); // factor = 1 原样
    expect(rescaleCornerRadius(12, 8)).toBe(6); // 0.5×
    expect(rescaleCornerRadius(12, 32)).toBe(24); // 2×
  });

  it('glassThicknessGains：以 22dp 为中性零点，thick 被夹到 ±1', () => {
    const [thickAt22, beamAt22, bevelAt22] = glassThicknessGains(22);
    expect(thickAt22).toBe(0);
    expect(beamAt22).toBeCloseTo(1, 9);
    expect(bevelAt22).toBeCloseTo(1, 9);
    // 更模糊 = thick 正 => 增益下降；更清晰 = 负 => 增益上升
    const [thickHigh, beamHigh] = glassThicknessGains(40);
    const [thickLow, beamLow] = glassThicknessGains(4);
    expect(thickHigh).toBeGreaterThan(0);
    expect(thickLow).toBeLessThan(0);
    expect(beamHigh).toBeLessThan(beamAt22);
    expect(beamLow).toBeGreaterThan(beamAt22);
    // 极值被夹住（不越界到负亮度）
    const [thickMax] = glassThicknessGains(1000);
    const [thickMin] = glassThicknessGains(-1000);
    expect(thickMax).toBe(1);
    expect(thickMin).toBe(-1);
    expect(beamHigh).toBeGreaterThanOrEqual(0.42);
    expect(beamLow).toBeLessThanOrEqual(1.3);
  });

  it('cardCameraDistance：shortSide × (0.42 + 3.8 × clamp((mult-3)/9))', () => {
    // 出厂 5× → (5-3)/9 = 0.2222 → 0.42 + 0.8444 = 1.2644
    expect(cardCameraDistance(100, 5)).toBeCloseTo(100 * (0.42 + 3.8 * (2 / 9)), 9);
    // 上限：mult >= 12 → 系数 4.22
    expect(cardCameraDistance(100, 12)).toBeCloseTo(422, 9);
    expect(cardCameraDistance(100, 99)).toBeCloseTo(422, 9);
    // 下限：mult <= 3 → 系数 0.42
    expect(cardCameraDistance(100, 3)).toBeCloseTo(42, 9);
    expect(cardCameraDistance(100, 0)).toBeCloseTo(42, 9);
  });
});

describe('Animation.kt：呼吸与光尾动画', () => {
  const source = shadowKt('Animation.kt');

  it('呼吸：0 → intensityPx，FastOutSlowIn + Reverse；任一前置条件不满足直接返回 0', () => {
    expect(source).toContain('initialValue = 0f');
    expect(source).toContain('targetValue = intensityPx');
    expect(source).toContain('animation = tween(durationMillis = durationMillis, easing = FastOutSlowInEasing)');
    expect(source).toContain('repeatMode = RepeatMode.Reverse');
    // 三个短路条件：未启用 / 强度 <= 0 / 时长 <= 0
    expect(source).toContain('if (!enabled || intensityPx <= 0f || durationMillis <= 0)');
    // 短路时返回恒 0，而不是「跑一个空动画」
    expect(source).toContain('return remember { mutableFloatStateOf(0f) }');
  });

  it('光尾：顺时针 0→1、逆时针 1→0，Linear + Restart', () => {
    expect(source).toContain('initialValue = if (clockwise) 0f else 1f');
    expect(source).toContain('targetValue = if (clockwise) 1f else 0f');
    expect(source).toContain('tween(durationMillis, easing = LinearEasing)');
    expect(source).toContain('RepeatMode.Restart');
    expect(source).toContain('if (!enabled || durationMillis <= 0)');
  });

  it('两种动画的 RepeatMode 不同：Reverse（来回呼吸）vs Restart（一圈重来）', () => {
    const reverse = source.indexOf('RepeatMode.Reverse');
    const restart = source.indexOf('RepeatMode.Restart');
    expect(reverse).toBeGreaterThan(-1);
    expect(restart).toBeGreaterThan(-1);
    expect(reverse).toBeLessThan(restart);
    // 呼吸在呼吸函数里、光尾在光尾函数里（不混用）
    expect(source.indexOf('rememberAnimatedBreathingValue')).toBeLessThan(reverse);
    expect(source.indexOf('rememberGlowTrailProgess')).toBeLessThan(restart);
  });

  it('FastOutSlowIn 的贝塞尔控制点与 Material 标准一致', () => {
    expect([...FAST_OUT_SLOW_IN]).toEqual([0.4, 0, 0.2, 1]);
  });
});
