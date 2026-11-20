/**
 * dragGestureAndParallaxParity.test.ts
 *   ├ `eu/wewox/pagecurl/page/DragGesture.kt`（81 行）→ `@core/pagecurl/pageCurl` 的 `dragGestureConfig`
 *   └ `me/trishiraj/shadowglow/Parallax.kt`（81 行）→ `@core/ui/gyroParallax`
 *
 * 两个文件都是「端口看起来有、判定是另一回事」：
 *
 *   · `DragGesture.kt` 与刚做过的 `DragStartEnd.kt` **看着像、判定相反**：前者
 *     `getConfig` 用 `target` 矩形 **+ 方向**，`isDragSucceed` **只看方向**；
 *     后者 `getConfig` 用 `start` 矩形、`isDragSucceed` **看落点矩形**。
 *     端口只有一句 `dragGestureSucceeds(config, start, end)`，拿哪套配置喂它决定了行为。
 *   · `Parallax.kt` 在端口里是一个凭空公式 `{gamma/45*s, beta/90*s}`：没有基线、
 *     没有 `sin`、X 没有负号、`sensitivity` 也没转 px（E205）。
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { dragGestureConfig, dragStartEndConfig, dragGestureSucceeds } from '@core/pagecurl/pageCurl';
import {
  GYRO_OFFSET_ZERO,
  GYRO_SENSOR_DELAY_UI_MS,
  GyroParallaxSampler,
  gyroParallaxOffset,
  gyroParallaxSample,
  gyroSensitivityPx,
  gyroWithoutSensor,
} from '@core/ui/gyroParallax';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(rel, 'utf8');
}

const DRAG_KT = 'eu/wewox/pagecurl/page/DragGesture.kt';
const PARALLAX_KT = 'me/trishiraj/shadowglow/Parallax.kt';

/* ══════════════════════════════════════════════════════════════════════════════
   ① DragGesture.kt L36-51 两份配置的 isDragSucceed 是**纯方向**
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DragGesture.kt L36-51 isDragSucceed 只看方向', () => {
  const src = kt(DRAG_KT);

  it('L39 `isDragSucceed = { start, end -> end.x < start.x }`（前翻）', () => {
    expect(src).toContain('isDragSucceed = { start, end -> end.x < start.x },');
    const config = dragGestureConfig({
      width: 1000,
      height: 800,
      pointerBehavior: 'Default',
      dragInteraction: {
        forward: { target: { left: 0.5, top: 0, right: 1, bottom: 1 } },
        backward: { target: { left: 0, top: 0, right: 0.5, bottom: 1 } },
      },
      policy: null,
      enabledForward: true,
      enabledBackward: true,
      onChange: () => {},
    });
    expect(config.forward.isDragSucceed({ x: 500, y: 0 }, { x: 499, y: 0 })).toBe(true);
    // 相等不算「小于」
    expect(config.forward.isDragSucceed({ x: 500, y: 0 }, { x: 500, y: 0 })).toBe(false);
    expect(config.forward.isDragSucceed({ x: 500, y: 0 }, { x: 501, y: 0 })).toBe(false);
  });

  it('L48 `end.x > start.x`（后翻）', () => {
    expect(src).toContain('isDragSucceed = { start, end -> end.x > start.x },');
    const config = dragGestureConfig({
      width: 1000,
      height: 800,
      pointerBehavior: 'Default',
      dragInteraction: {
        forward: { target: { left: 0.5, top: 0, right: 1, bottom: 1 } },
        backward: { target: { left: 0, top: 0, right: 0.5, bottom: 1 } },
      },
      policy: null,
      enabledForward: true,
      enabledBackward: true,
      onChange: () => {},
    });
    expect(config.backward.isDragSucceed({ x: 500, y: 0 }, { x: 501, y: 0 })).toBe(true);
    expect(config.backward.isDragSucceed({ x: 500, y: 0 }, { x: 499, y: 0 })).toBe(false);
  });

  it('与 `DragStartEnd` 的区别：**拖回原点**在方向拖拽里算失败，在起止点手势里算……看落点', () => {
    const gesture = dragGestureConfig({
      width: 1000,
      height: 800,
      pointerBehavior: 'Default',
      dragInteraction: {
        forward: { target: { left: 0.5, top: 0, right: 1, bottom: 1 } },
        backward: { target: { left: 0, top: 0, right: 0.5, bottom: 1 } },
      },
      policy: null,
      enabledForward: true,
      enabledBackward: true,
      onChange: () => {},
    });
    const startEnd = dragStartEndConfig({
      width: 1000,
      height: 800,
      pointerBehavior: 'Default',
      dragInteraction: {
        forward: {
          start: { left: 0.8, top: 0, right: 1, bottom: 1 },
          end: { left: 0, top: 0, right: 0.2, bottom: 1 },
        },
        backward: {
          start: { left: 0, top: 0, right: 0.2, bottom: 1 },
          end: { left: 0.8, top: 0, right: 1, bottom: 1 },
        },
      },
      policy: null,
      enabledForward: true,
      enabledBackward: true,
      onChange: () => {},
    });
    // 起点 (900,400) 拖回 (880,400)：方向拖拽「成功」（x 变小），起止点手势「失败」（落点不在左 20%）
    expect(dragGestureSucceeds(gesture.forward, { x: 900, y: 400 }, { x: 880, y: 400 })).toBe(true);
    expect(startEnd.forward.isDragSucceed({ x: 900, y: 400 }, { x: 880, y: 400 })).toBe(false);
  });

  it('L38 / L47 `isEnabled` 读 `rememberUpdatedState` 的那个值', () => {
    expect(src).toContain('isEnabled = { isEnabledForward.value },');
    expect(src).toContain('isEnabled = { isEnabledBackward.value },');
    const disabled = dragGestureConfig({
      width: 1000,
      height: 800,
      pointerBehavior: 'Default',
      dragInteraction: {
        forward: { target: { left: 0.5, top: 0, right: 1, bottom: 1 } },
        backward: { target: { left: 0, top: 0, right: 0.5, bottom: 1 } },
      },
      policy: null,
      enabledForward: false,
      enabledBackward: true,
      onChange: () => {},
    });
    expect(disabled.forward.isEnabled()).toBe(false);
    // `dragGestureSucceeds` 把 isEnabled 也算进去
    expect(dragGestureSucceeds(disabled.forward, { x: 900, y: 0 }, { x: 800, y: 0 })).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② DragGesture.kt L59-78 getConfig 的三重门
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DragGesture.kt L59-78 getConfig 的起点 + 方向双判', () => {
  const src = kt(DRAG_KT);
  const base = {
    width: 1000,
    height: 800,
    pointerBehavior: 'Default' as const,
    dragInteraction: {
      forward: { target: { left: 0.5, top: 0, right: 1, bottom: 1 } },
      backward: { target: { left: 0, top: 0, right: 0.5, bottom: 1 } },
    },
    policy: null,
    enabledForward: true,
    enabledBackward: true,
    onChange: () => {},
  };

  it('L61 `forwardTargetRect.contains(start) && end.x < start.x`', () => {
    expect(src).toContain('val config = if (forwardTargetRect.contains(start) && end.x < start.x) {');
    const config = dragGestureConfig(base);
    // 起点在右半 + 向左拖 → forward
    expect(config.getConfig({ x: 800, y: 400 }, { x: 700, y: 400 })).toBe(config.forward);
    // 起点在右半但向右拖 → 不匹配
    expect(config.getConfig({ x: 800, y: 400 }, { x: 900, y: 400 })).toBeNull();
    // 起点在左半 → 不是 forward 的 target
    expect(config.getConfig({ x: 200, y: 400 }, { x: 100, y: 400 })).toBeNull();
  });

  it('L63 `backwardTargetRect.contains(start) && end.x > start.x`', () => {
    expect(src).toContain('} else if (backwardTargetRect.contains(start) && end.x > start.x) {');
    const config = dragGestureConfig(base);
    expect(config.getConfig({ x: 200, y: 400 }, { x: 300, y: 400 })).toBe(config.backward);
    expect(config.getConfig({ x: 200, y: 400 }, { x: 100, y: 400 })).toBeNull();
  });

  it('L60 `startAllowed` 否决优先于一切', () => {
    expect(src).toContain('if (allowed.value?.invoke(start, size) == false) return@getConfig null');
    const config = dragGestureConfig({
      ...base,
      policy: { onCustomTap: () => false, dragStartAllowed: (start) => start.x < 400 },
    });
    expect(config.getConfig({ x: 800, y: 400 }, { x: 700, y: 400 })).toBeNull();
    expect(config.getConfig({ x: 200, y: 400 }, { x: 300, y: 400 })).toBe(config.backward);
  });

  it('L69 该方向被禁用 → null（即使起点与方向都匹配）', () => {
    expect(src).toContain('if (config != null && !config.isEnabled()) return@getConfig null');
    const config = dragGestureConfig({ ...base, enabledForward: false });
    expect(config.getConfig({ x: 800, y: 400 }, { x: 700, y: 400 })).toBeNull();
    expect(config.getConfig({ x: 200, y: 400 }, { x: 300, y: 400 })).toBe(config.backward);
  });

  it('L70-75 命中即 `animateJob.cancel()` + `reset()`（端口用 onMatched 回调）', () => {
    expect(src).toContain('scope.launch {');
    expect(src).toContain('state.animateJob?.cancel()');
    expect(src).toContain('state.reset()');
    let matched = 0;
    const config = dragGestureConfig({ ...base, onMatched: () => (matched += 1) });
    config.getConfig({ x: 800, y: 400 }, { x: 700, y: 400 });
    expect(matched).toBe(1);
    // 没命中时不复位
    config.getConfig({ x: 500, y: 400 }, { x: 500, y: 400 });
    expect(matched).toBe(1);
  });

  it('L55-58 `PointerBehavior` 映射（与 dragStartEnd 同一函数）', () => {
    expect(src).toContain('PointerBehavior.Default -> NewEdgeCreator.Default()');
    expect(src).toContain('PointerBehavior.PageEdge -> NewEdgeCreator.PageEdge()');
    // 两处配置的 edge 与 DragStartEnd 一致（state.forward / state.backward 的两端）
    const gesture = dragGestureConfig(base);
    const startEnd = dragStartEndConfig({
      width: 1000,
      height: 800,
      pointerBehavior: 'Default',
      dragInteraction: {
        forward: {
          start: { left: 0.8, top: 0, right: 1, bottom: 1 },
          end: { left: 0, top: 0, right: 0.2, bottom: 1 },
        },
        backward: {
          start: { left: 0, top: 0, right: 0.2, bottom: 1 },
          end: { left: 0.8, top: 0, right: 1, bottom: 1 },
        },
      },
      policy: null,
      enabledForward: true,
      enabledBackward: true,
      onChange: () => {},
    });
    expect(gesture.forward.edge).toEqual(startEnd.forward.edge);
    expect(gesture.backward.edge).toEqual(startEnd.backward.edge);
  });

  it('L43 / L50 `release` 与 DragStartEnd 同构（`policy?.invoke(…) ?: native`）', () => {
    expect(src).toContain('release = { start, end, velocity, native -> releasePolicy.value?.invoke(start, end, velocity, size, native) ?: native }');
    const config = dragGestureConfig(base);
    expect(config.forward.release?.({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }, true)).toBe(true);
    expect(config.forward.release?.({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }, false)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ Parallax.kt L22-56 四处算术
   ══════════════════════════════════════════════════════════════════════════════ */

describe('Parallax.kt L51-56 相对基线 + sin + X 取负', () => {
  const src = kt(PARALLAX_KT);

  it('L51-52 相对基线求差', () => {
    expect(src).toContain('val deltaPitch = currentPitch - basePitch');
    expect(src).toContain('val deltaRoll = currentRoll - baseRoll');
    const first = gyroParallaxSample(null, 0.3, -0.2, 40);
    expect(first.established).toBe(true);
    expect(first.offset).toEqual(GYRO_OFFSET_ZERO);
    expect(first.baseline).toEqual({ pitch: 0.3, roll: -0.2 });
    // 同一姿态再采一次 → 零偏移（若拿绝对值算，这里会是 sin(0.3)*40）
    const same = gyroParallaxSample(first.baseline, 0.3, -0.2, 40);
    expect(same.offset.x).toBeCloseTo(0, 12);
    expect(same.offset.y).toBeCloseTo(0, 12);
  });

  it('L54 `-sin(deltaRoll) * px` —— X **取负**', () => {
    expect(src).toContain('val newOffsetX = -sin(deltaRoll) * sensitivityPx');
    const px = 40;
    const offset = gyroParallaxOffset(0, 0.5, px);
    expect(offset.x).toBeCloseTo(-Math.sin(0.5) * px, 12);
    // 向右倾（roll 正）→ x 为负
    expect(offset.x).toBeLessThan(0);
    // 端口此前的线性式会给出正数
    expect((0.5 * 180) / Math.PI / 45 * px).toBeGreaterThan(0);
  });

  it('L55 `sin(deltaPitch) * px` —— Y 不取负', () => {
    expect(src).toContain('val newOffsetY = sin(deltaPitch) * sensitivityPx');
    const px = 40;
    expect(gyroParallaxOffset(0.5, 0, px).y).toBeCloseTo(Math.sin(0.5) * px, 12);
    expect(gyroParallaxOffset(0.5, 0, px).y).toBeGreaterThan(0);
  });

  it('`sin` 的幅度上限是 ±1×px（线性归一化会无限增长）', () => {
    const px = 30;
    // 90° 时 sin = 1 → 正好一个 px
    expect(gyroParallaxOffset(0, Math.PI / 2, px).x).toBeCloseTo(-px, 10);
    // 180° 时 sin = 0 → 回到零（线性式会给 4 倍）
    expect(gyroParallaxOffset(0, Math.PI, px).x).toBeCloseTo(0, 10);
    for (const angle of [0.1, 0.7, 1.4, 2.2, 3.0]) {
      expect(Math.abs(gyroParallaxOffset(0, angle, px).x)).toBeLessThanOrEqual(px + 1e-9);
    }
  });

  it('L22 `sensitivity.toPx()` —— 同一 Dp 在不同 density 下幅度不同', () => {
    expect(src).toContain('with(density) { sensitivity.toPx() }');
    expect(gyroSensitivityPx(12, 1)).toBe(12);
    expect(gyroSensitivityPx(12, 2)).toBe(24);
    expect(gyroSensitivityPx(12, 3)).toBe(36);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ Parallax.kt L25-78 基线只建一次、无传感器、dispose
   ══════════════════════════════════════════════════════════════════════════════ */

describe('Parallax.kt L45-46 基线只在首帧建立', () => {
  const src = kt(PARALLAX_KT);

  it('L45-49 `if (baselineOrientation.value == null) { … } else { … }` —— 之后不再改写基线', () => {
    expect(src).toContain('if (baselineOrientation.value == null) {');
    expect(src).toContain('baselineOrientation.value = floatArrayOf(currentPitch, currentRoll)');
    const sampler = new GyroParallaxSampler(40);
    sampler.sample(0.2, 0.1); // 建基线
    const baseline = sampler.currentBaseline;
    sampler.sample(0.6, 0.9); // 只算偏移
    sampler.sample(-0.4, -0.7);
    expect(sampler.currentBaseline).toEqual(baseline);
  });

  it('「换个姿势拿手机」不会变成永久偏移 —— 基线不跟着走', () => {
    const sampler = new GyroParallaxSampler(40);
    sampler.sample(0.2, 0.1);
    // 把手机整体转了 20°，然后**保持不动**
    const held = sampler.sample(0.2 + 0.35, 0.1 + 0.35);
    expect(held.x).not.toBeCloseTo(0, 3);
    // 再采几次（姿态没变）→ 偏移稳定，不会归零也不会漂移
    const again = sampler.sample(0.2 + 0.35, 0.1 + 0.35);
    expect(again).toEqual(held);
  });

  it('L68-70 没有旋转传感器 → 基线清空、偏移恒零', () => {
    expect(src).toContain('} else {');
    expect(src).toContain('baselineOrientation.value = null');
    const sampler = new GyroParallaxSampler(40, false);
    expect(sampler.sample(1, 1)).toEqual(GYRO_OFFSET_ZERO);
    expect(sampler.currentBaseline).toBeNull();
    expect(gyroWithoutSensor().offset).toEqual(GYRO_OFFSET_ZERO);
    // 中途拔掉传感器也清基线
    const live = new GyroParallaxSampler(40);
    live.sample(0.5, 0.5);
    expect(live.currentBaseline).not.toBeNull();
    live.setSensorPresent(false);
    expect(live.currentBaseline).toBeNull();
    expect(live.sample(0.5, 0.5)).toEqual(GYRO_OFFSET_ZERO);
  });

  it('L72-78 `onDispose`：偏移归零 + 基线清空', () => {
    expect(src).toContain('parallaxOffset.value = 0f to 0f');
    const sampler = new GyroParallaxSampler(40);
    sampler.sample(0.1, 0.1);
    sampler.sample(0.4, 0.4);
    expect(sampler.value).not.toEqual(GYRO_OFFSET_ZERO);
    sampler.dispose();
    expect(sampler.value).toEqual(GYRO_OFFSET_ZERO);
    expect(sampler.currentBaseline).toBeNull();
    // dispose 之后下一帧重新建基线
    expect(sampler.sample(0.9, 0.9)).toEqual(GYRO_OFFSET_ZERO);
  });

  it('L66 `SENSOR_DELAY_UI` —— 端口给同档节流常量', () => {
    expect(src).toContain('SensorManager.SENSOR_DELAY_UI');
    expect(GYRO_SENSOR_DELAY_UI_MS).toBeCloseTo(1000 / 60, 10);
  });

  it('`parityMisc.ts` 里那个凭空公式已删除（改成转发真身）', () => {
    const misc = repoText('src/core/ui/parityMisc.ts');
    expect(misc).toContain("from './gyroParallax'");
    expect(misc).not.toContain('gamma / 45');
    expect(misc).not.toContain('beta / 90');
  });
});
