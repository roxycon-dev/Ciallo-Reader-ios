/**
 * glassFxParity.test.ts —— 玻璃 / 特效层的数值与派生属性对拍。
 *
 * 覆盖 4 个 Kotlin 文件：
 *   · `GlassQuality.kt`     —— 5 档画质、`MINIMAL` 的 **-1** id、4 个派生属性（含门槛）
 *   · `ScrollTilt.kt`       —— 6 个常量 + `k = 1 - exp(-dtMs / tau)` 的指数平滑
 *   · `MaxFx.kt`            —— 4 个 aura 常量 + 呼吸插值端点
 *   · `WindowBackdrop.kt`   —— 5 个常量 + 步进/反算 blur 半径
 *
 * 每条期望值都从 Kotlin 原文读出（`androidReference()`），不是抄文档。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  RENDER_QUALITIES,
  RENDER_QUALITY_BY_NAME,
  RENDER_QUALITY_HIGH_ID,
  RENDER_QUALITY_LOW_ID,
  RENDER_QUALITY_MINIMAL_ID,
  renderQualityDecorativeEffects,
  renderQualityEnhancedMotion,
  renderQualityMinimal,
  renderQualityOf,
  renderQualityRealtimeGlass,
} from '@core/glass/glassQuality';
import {
  FOLLOW_TAU_MS,
  IDLE_TIMEOUT_MS,
  RELEASE_TAU_MS,
  SCROLL_TILT_MAX_DEG,
  SCROLL_VELOCITY_REFERENCE_PX_MS,
  ScrollTiltController,
} from '@core/glass/scrollTilt';
import {
  AURA_ALPHA_MAX,
  AURA_ALPHA_MIN,
  AURA_BREATHE_DURATION_MS,
  AURA_HUE_DURATION_MS,
  AURA_INSET_DP,
  AURA_WIDTH_DP,
} from '@core/glass/maxFx';
import {
  BLUR_CACHE_CAPACITY,
  BLUR_STEPS_PER_PIXEL,
  FALLBACK_WINDOW_DIM,
  GLASS_WINDOW_DIM,
  WINDOW_DIM_STEPS,
  blurRadiusForStep,
  blurStepFor,
  roundToInt,
} from '@core/glass/windowBackdrop';

import { androidReference } from '../helpers/androidReference';

const COMPONENTS_KT = 'app/src/main/java/com/example/ui/components';

function readComponent(name: string): string {
  return readFileSync(androidReference(`${COMPONENTS_KT}/${name}`), 'utf8');
}

/** 取 `const val NAME = 12.3f` / `val NAME = 120_000_000L` 的数值（去下划线、去 f/L 后缀）。 */
function constValue(source: string, name: string): number | null {
  const m = new RegExp(`(?:const\\s+)?val\\s+${name}\\s*(?::\\s*[\\w<>?.]+)?\\s*=\\s*(-?[\\d_.]+)`).exec(source);
  if (m === null) return null;
  const raw = (m[1] ?? '').replace(/_/g, '').replace(/\.+$/, '');
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

describe('GlassQuality.kt 的五档与派生属性', () => {
  const source = readComponent('GlassQuality.kt');

  it('五档的 id 与文案逐值一致（MINIMAL 是 -1）', () => {
    const parsed: { name: string; id: number; label: string }[] = [];
    const re = /([A-Z]+)\(\s*(-?\d+)\s*,\s*"([^"]*)"\s*\)/g;
    let m;
    while ((m = re.exec(source)) !== null) {
      parsed.push({ name: m[1] ?? '', id: Number(m[2]), label: m[3] ?? '' });
    }
    expect(parsed.map((p) => p.name)).toEqual(['MINIMAL', 'LOW', 'MID', 'HIGH', 'MAX']);
    expect(parsed.map((p) => p.id)).toEqual([-1, 0, 1, 2, 3]);
    expect(parsed.map((p) => p.label)).toEqual(['极简', '流畅', '均衡', '高', '极致']);

    expect(RENDER_QUALITIES.map((q) => q.name)).toEqual(parsed.map((p) => p.name));
    expect(RENDER_QUALITIES.map((q) => q.id)).toEqual(parsed.map((p) => p.id));
    expect(RENDER_QUALITIES.map((q) => q.label)).toEqual(parsed.map((p) => p.label));
  });

  it('realtimeGlass 的门槛是 HIGH（≥2）且依赖系统支持', () => {
    expect(source).toContain('val realtimeGlass: Boolean get() = id >= HIGH.id && supportsRealtimeBlur');
    expect(RENDER_QUALITY_HIGH_ID).toBe(2);
    expect(renderQualityRealtimeGlass(-1, true)).toBe(false);
    expect(renderQualityRealtimeGlass(0, true)).toBe(false);
    expect(renderQualityRealtimeGlass(1, true)).toBe(false);
    expect(renderQualityRealtimeGlass(2, true)).toBe(true);
    expect(renderQualityRealtimeGlass(3, true)).toBe(true);
    // 系统不支持时，再高的档位也不开实时模糊
    expect(renderQualityRealtimeGlass(3, false)).toBe(false);
  });

  it('enhancedMotion 门槛同 HIGH；decorativeEffects 是「严格大于 LOW」；minimal 只认 -1', () => {
    expect(source).toContain('val enhancedMotion: Boolean get() = id >= HIGH.id');
    expect(source).toContain('val decorativeEffects: Boolean get() = id > LOW.id');
    expect(source).toContain('val minimal: Boolean get() = this == MINIMAL');
    expect(RENDER_QUALITY_LOW_ID).toBe(0);
    expect(RENDER_QUALITY_MINIMAL_ID).toBe(-1);

    expect(['MINIMAL', 'LOW', 'MID', 'HIGH', 'MAX'].map((n) => renderQualityEnhancedMotion(RENDER_QUALITY_BY_NAME[n as 'MINIMAL'].id))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
    // MID 的 id=1 > LOW 的 0 —— 装饰效果从「均衡」就开始有，这与 enhancedMotion 不同
    expect(['MINIMAL', 'LOW', 'MID', 'HIGH', 'MAX'].map((n) => renderQualityDecorativeEffects(RENDER_QUALITY_BY_NAME[n as 'MINIMAL'].id))).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(renderQualityMinimal(-1)).toBe(true);
    expect(renderQualityMinimal(0)).toBe(false);
  });

  it('未知 id 回落 HIGH（与 Kotlin 的 firstOrNull { … } ?: HIGH 一致）', () => {
    expect(renderQualityOf(2).name).toBe('HIGH');
    expect(renderQualityOf(99).name).toBe('HIGH');
    expect(renderQualityOf(-1).name).toBe('MINIMAL');
  });
});

describe('ScrollTilt.kt 的 6 个常量与指数平滑', () => {
  const source = readComponent('ScrollTilt.kt');

  it('参考速度 / 上限角 / 闲置阈值 / 两条 tau 全部相等', () => {
    expect(constValue(source, 'SCROLL_VELOCITY_REFERENCE_PX_MS')).toBe(2.2);
    expect(SCROLL_VELOCITY_REFERENCE_PX_MS).toBe(2.2);

    expect(constValue(source, 'SCROLL_TILT_MAX_DEG')).toBe(4.5);
    expect(SCROLL_TILT_MAX_DEG).toBe(4.5);

    // Kotlin 用纳秒：120_000_000L → 120ms
    expect(constValue(source, 'IDLE_TIMEOUT_NANOS')).toBe(120_000_000);
    expect(IDLE_TIMEOUT_MS).toBe(120);

    expect(constValue(source, 'FOLLOW_TAU_MS')).toBe(55);
    expect(FOLLOW_TAU_MS).toBe(55);

    expect(constValue(source, 'RELEASE_TAU_MS')).toBe(260);
    expect(RELEASE_TAU_MS).toBe(260);
  });

  it('一帧推进用 k = 1 - exp(-dt/tau)：跟随 τ=55、闲置后切释放 τ=260', () => {
    expect(source).toContain('val k = 1f - exp(-dtMs / tau)');
    // Kotlin 侧按 idle 在两条 tau 之间切换
    expect(source).toContain('if (idle) RELEASE_TAU_MS else FOLLOW_TAU_MS');

    // 跟随：submitVelocity 带 0.5 低通，从 0 出发一帧后 target = 0.5 × 4.5 = 2.25
    const follow = new ScrollTiltController();
    follow.submitVelocity(SCROLL_VELOCITY_REFERENCE_PX_MS, 1_000);
    expect(follow.targetDeg).toBeCloseTo(SCROLL_TILT_MAX_DEG / 2, 12);
    follow.step(16, 1_010);
    expect(follow.tiltDeg).toBeCloseTo(follow.targetDeg * (1 - Math.exp(-16 / FOLLOW_TAU_MS)), 12);

    // 释放：闲置超过 120ms 后目标归零，改用 RELEASE_TAU_MS（更软、无过冲）
    const before = follow.tiltDeg;
    follow.step(16, 1_000 + IDLE_TIMEOUT_MS + 1);
    const afterRelease = before + (0 - before) * (1 - Math.exp(-16 / RELEASE_TAU_MS));
    expect(follow.tiltDeg).toBeCloseTo(afterRelease, 12);
    // 释放比跟随慢得多：同样的 dt，走掉的比例更小
    expect(1 - Math.exp(-16 / RELEASE_TAU_MS)).toBeLessThan(1 - Math.exp(-16 / FOLLOW_TAU_MS));
  });
});

describe('MaxFx.kt 的 aura 常量与呼吸端点', () => {
  const source = readComponent('MaxFx.kt');

  it('4 个 aura 常量相等', () => {
    expect(constValue(source, 'AURA_INSET_DP')).toBe(1.0);
    expect(AURA_INSET_DP).toBe(1.0);
    expect(constValue(source, 'AURA_WIDTH_DP')).toBe(1.8);
    expect(AURA_WIDTH_DP).toBe(1.8);
    expect(constValue(source, 'AURA_ALPHA_MIN')).toBe(0.22);
    expect(AURA_ALPHA_MIN).toBe(0.22);
    expect(constValue(source, 'AURA_ALPHA_MAX')).toBe(0.34);
    expect(AURA_ALPHA_MAX).toBe(0.34);
    // 恒定亮度关系：MAX > MIN，且都在 (0,1)
    expect(AURA_ALPHA_MIN).toBeLessThan(AURA_ALPHA_MAX);
    expect(AURA_ALPHA_MAX).toBeLessThan(1);
  });

  it('呼吸 / 色相周期是有理数且互不整除（避免同频闪烁）', () => {
    expect(AURA_BREATHE_DURATION_MS).toBe(3000);
    expect(AURA_HUE_DURATION_MS).toBe(8000);
    expect(AURA_HUE_DURATION_MS % AURA_BREATHE_DURATION_MS).not.toBe(0);
  });
});

describe('WindowBackdrop.kt 的 5 个常量与 blur 换算', () => {
  const source = readComponent('WindowBackdrop.kt');

  it('每像素步数 / 缓存容量 / 调暗步数 / 两种 dim 全部相等', () => {
    expect(constValue(source, 'BLUR_STEPS_PER_PIXEL')).toBe(2);
    expect(BLUR_STEPS_PER_PIXEL).toBe(2);
    expect(constValue(source, 'BLUR_CACHE_CAPACITY')).toBe(128);
    expect(BLUR_CACHE_CAPACITY).toBe(128);
    expect(constValue(source, 'WINDOW_DIM_STEPS')).toBe(64);
    expect(WINDOW_DIM_STEPS).toBe(64);
    expect(constValue(source, 'GLASS_WINDOW_DIM')).toBe(0.12);
    expect(GLASS_WINDOW_DIM).toBe(0.12);
    expect(constValue(source, 'FALLBACK_WINDOW_DIM')).toBe(0.42);
    expect(FALLBACK_WINDOW_DIM).toBe(0.42);
    // 玻璃态比回落态**更暗得少**（真实毛玻璃能透出背景，回落用更重的调暗补偿）
    expect(GLASS_WINDOW_DIM).toBeLessThan(FALLBACK_WINDOW_DIM);
  });

  it('步进与半径互为逆运算（量化到 1/2 px）', () => {
    for (const radius of [0, 1, 2.5, 7, 16, 24.5, 48]) {
      const step = blurStepFor(radius);
      expect(Number.isInteger(step), `step(${String(radius)}) 必须是整数`).toBe(true);
      // 反算回去与原始半径的误差不超过半个量化步长
      expect(Math.abs(blurRadiusForStep(step) - radius)).toBeLessThanOrEqual(1 / BLUR_STEPS_PER_PIXEL);
    }
    expect(blurStepFor(0)).toBe(0);
    expect(blurRadiusForStep(0)).toBe(0);
    // 2 steps/px ⇒ 半径 10 对应 20 步
    expect(blurStepFor(10)).toBe(20);
    expect(blurRadiusForStep(20)).toBe(10);
  });

  it('roundToInt 与 Kotlin 的 roundToInt 同语义（.5 向上）', () => {
    expect(roundToInt(0.5)).toBe(1);
    expect(roundToInt(1.5)).toBe(2);
    expect(roundToInt(2.4)).toBe(2);
    // Kotlin `round(-0.5)` 得到 -0.0、`toInt()` 得 0；JS 的 Math.round(-0.5) 是 -0，
    // 数值相等但 Object.is 区分符号，因此用绝对值比较。
    expect(Math.abs(roundToInt(-0.5))).toBe(0);
    expect(roundToInt(-1.5)).toBe(-1);
  });
});
