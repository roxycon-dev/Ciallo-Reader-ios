/**
 * Unit tests for `@core/god/godPull` — 神回拉拽的橡胶带阻尼与状态机。
 *
 * Kotlin 行号映射（novel-reader/app/src/main/java/com/example/god/GodPull.kt）：
 *   - 63-124 GodPullState 字段与三个状态转移（setRaw / addRaw / release / reset）
 *   - 87      progress（offset / thresholdPx，夹紧 0..1）
 *   - 89-94   damp：`(1 - 1/(raw·c/span + 1))·(span/c)`，c = GodMotion.PULL_DAMPING
 *   - 97-105  setRaw 的 armed 翻转 + onArm 只在过阈瞬间触发一次
 *   - 110-116 release：`onTriggered ?: onTrigger` 的 null 陷阱
 *   - 119-123 reset
 *   - 329-366 godPullConnection 的三个回调
 *   - 383-389 dampedToRaw
 *   - 392     isAtEnd
 *   - 395     godAbs
 *   - 76/78   GodMotion.PULL_THRESHOLD_DP = 96f / PULL_DAMPING = 0.55f
 */
import { describe, expect, it, vi } from 'vitest';
import {
  GOD_PULL_DAMPING,
  GOD_PULL_THRESHOLD_DP,
  createGodPullMachine,
  godAbs,
  godPullAddRaw,
  godPullDamp,
  godPullDampedToRaw,
  godPullPostFling,
  godPullPostScroll,
  godPullPreScroll,
  godPullProgress,
  godPullRelease,
  godPullReset,
  godPullSetRaw,
  godPullSettleOffset,
  isAtEnd,
  type GodPullMachine,
} from '@core/god/godPull';

function machine(spanPx: number, thresholdPx: number): GodPullMachine {
  const m = createGodPullMachine({ spanPx });
  m.thresholdPx = thresholdPx;
  return m;
}

describe('GodMotion constants (GodMotion.kt L76-78)', () => {
  it('keeps PULL_THRESHOLD_DP = 96 and PULL_DAMPING = 0.55', () => {
    expect(GOD_PULL_THRESHOLD_DP).toBe(96);
    expect(GOD_PULL_DAMPING).toBe(0.55);
  });
});

describe('godPullDamp (GodPull.kt L89-94)', () => {
  it('is 0 for a zero (or negative) span', () => {
    expect(godPullDamp(500, 0)).toBe(0);
    expect(godPullDamp(500, -10)).toBe(0);
  });

  it('matches the iOS rubber-band formula', () => {
    const span = 1000;
    const c = GOD_PULL_DAMPING;
    const raw = 300;
    const expected = (1 - 1 / (raw * c / span + 1)) * (span / c);
    expect(godPullDamp(raw, span)).toBeCloseTo(expected, 10);
  });

  it('is monotonically increasing and never reaches span / c', () => {
    const span = 800;
    const ceiling = span / GOD_PULL_DAMPING;
    let prev = -1;
    for (const raw of [0, 1, 10, 100, 500, 5000, 100000]) {
      const d = godPullDamp(raw, span);
      expect(d).toBeGreaterThan(prev);
      expect(d).toBeLessThan(ceiling);
      prev = d;
    }
  });

  it('damps harder than the raw distance (越拉越费力)', () => {
    const span = 1000;
    expect(godPullDamp(200, span)).toBeLessThan(200);
    expect(godPullDamp(2000, span)).toBeLessThan(2000);
  });
});

describe('godPullProgress (GodPull.kt L87)', () => {
  it('returns 0 when the threshold is non-positive', () => {
    expect(godPullProgress(50, 0)).toBe(0);
    expect(godPullProgress(50, -1)).toBe(0);
  });

  it('clamps to 0..1', () => {
    expect(godPullProgress(-30, 96)).toBe(0);
    expect(godPullProgress(48, 96)).toBe(0.5);
    expect(godPullProgress(999, 96)).toBe(1);
  });
});

describe('godPullSetRaw / godPullAddRaw (GodPull.kt L97-107)', () => {
  it('stores the damped value in `offset` and the raw value in `raw`', () => {
    const m = machine(1000, 96);
    godPullSetRaw(m, 400);
    expect(m.raw).toBe(400);
    expect(m.offset).toBeCloseTo(godPullDamp(400, 1000), 10);
  });

  it('clamps negative raw input to 0 (coerceAtLeast(0f), L98)', () => {
    const m = machine(1000, 96);
    godPullSetRaw(m, -250);
    expect(m.raw).toBe(0);
    expect(m.offset).toBe(0);
  });

  it('arms once when crossing the threshold and stays armed', () => {
    const m = machine(1000, 96);
    const onArm = vi.fn();
    m.onArm = onArm;

    godPullSetRaw(m, 0);
    expect(m.armed).toBe(false);

    // 96px damped needs a raw well past 96 (rubber band), find the crossing
    let crossing = 0;
    for (let raw = 1; raw < 2000; raw += 1) {
      const probe = machine(1000, 96);
      godPullSetRaw(probe, raw);
      if (probe.armed) {
        crossing = raw;
        break;
      }
    }
    expect(crossing).toBeGreaterThan(96);

    godPullSetRaw(m, crossing - 1);
    expect(m.armed).toBe(false);
    expect(onArm).not.toHaveBeenCalled();

    godPullSetRaw(m, crossing);
    expect(m.armed).toBe(true);
    expect(onArm).toHaveBeenCalledTimes(1);

    // 已经在 armed 状态继续拉 → 不再重复触觉
    godPullSetRaw(m, crossing + 500);
    expect(onArm).toHaveBeenCalledTimes(1);

    // 缩回阈值以下 → 解除
    godPullSetRaw(m, 0);
    expect(m.armed).toBe(false);
  });

  it('addRaw accumulates on top of the stored raw value', () => {
    const m = machine(1000, 96);
    godPullSetRaw(m, 100);
    godPullAddRaw(m, 150);
    expect(m.raw).toBe(250);
  });

  it('reports the damped value through the optional callback', () => {
    const m = machine(1000, 96);
    const seen: number[] = [];
    godPullSetRaw(m, 320, (d) => seen.push(d));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeCloseTo(godPullDamp(320, 1000), 10);
  });
});

describe('godPullRelease / godPullReset / godPullSettleOffset (L110-123)', () => {
  it('fires the trigger only when armed was true', () => {
    const armed = machine(1000, 96);
    const onTrigger = vi.fn();
    armed.onTrigger = onTrigger;
    godPullSetRaw(armed, 3000);
    expect(armed.armed).toBe(true);
    godPullRelease(armed);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(armed.armed).toBe(false);
    expect(armed.raw).toBe(0);

    const notArmed = machine(1000, 96);
    const onTrigger2 = vi.fn();
    notArmed.onTrigger = onTrigger2;
    godPullSetRaw(notArmed, 10);
    godPullRelease(notArmed);
    expect(onTrigger2).not.toHaveBeenCalled();
  });

  it('prefers the explicit callback and falls back to state.onTrigger (L114)', () => {
    const m = machine(1000, 96);
    const fallback = vi.fn();
    const explicit = vi.fn();
    m.onTrigger = fallback;
    godPullSetRaw(m, 3000);

    godPullRelease(m, explicit);
    expect(explicit).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('⚠️ an empty lambda is NOT null — it swallows the trigger (Kotlin L334-336 注释)', () => {
    const m = machine(1000, 96);
    const fallback = vi.fn();
    m.onTrigger = fallback;
    godPullSetRaw(m, 3000);
    // 传 `{}` 而不是 null：release 会把它当成"宿主自己处理"，onTrigger 永远不触发
    godPullRelease(m, () => undefined);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('reset clears armed/raw without triggering', () => {
    const m = machine(1000, 96);
    const onTrigger = vi.fn();
    m.onTrigger = onTrigger;
    godPullSetRaw(m, 3000);
    godPullReset(m);
    expect(m.armed).toBe(false);
    expect(m.raw).toBe(0);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('settleOffset writes 0 without touching raw/armed', () => {
    const m = machine(1000, 96);
    godPullSetRaw(m, 500);
    const rawBefore = m.raw;
    godPullSettleOffset(m);
    expect(m.offset).toBe(0);
    expect(m.raw).toBe(rawBefore);
  });
});

describe('godPullDampedToRaw (GodPull.kt L383-389)', () => {
  it('inverts godPullDamp for ratios below the 0.999 clamp', () => {
    const span = 1000;
    for (const raw of [1, 10, 100, 400, 900]) {
      const damped = godPullDamp(raw, span);
      const back = godPullDampedToRaw(damped, span);
      // dampedToRaw 是「近似用线性映射回 raw」（Kotlin L345 注释），容差放宽
      expect(back).toBeGreaterThan(0);
      expect(Math.abs(back - raw) / raw).toBeLessThan(0.05);
    }
  });

  it('is 0 for a non-positive span', () => {
    expect(godPullDampedToRaw(100, 0)).toBe(0);
  });

  it('never diverges for the saturated end of the curve (ratio clamp 0.999)', () => {
    const span = 1000;
    const maxDamped = span / GOD_PULL_DAMPING;
    const back = godPullDampedToRaw(maxDamped, span);
    expect(Number.isFinite(back)).toBe(true);
    expect(back).toBeGreaterThan(0);
  });
});

describe('godPullPreScroll (GodPull.kt L341-350)', () => {
  it('ignores deltas while the pull is at rest', () => {
    const m = machine(1000, 96);
    expect(godPullPreScroll(m, 40)).toBe(0);
    expect(m.offset).toBe(0);
  });

  it('ignores downward (negative) deltas while pulled', () => {
    const m = machine(1000, 96);
    godPullSetRaw(m, 600);
    const before = m.offset;
    expect(godPullPreScroll(m, -40)).toBe(0);
    expect(m.offset).toBe(before);
  });

  it('consumes at most the current damped offset and shrinks the pull', () => {
    const m = machine(1000, 96);
    godPullSetRaw(m, 600);
    const before = m.offset;
    const consumed = godPullPreScroll(m, 1000);
    expect(consumed).toBeCloseTo(before, 6);
    expect(m.offset).toBeLessThan(before);
    expect(m.offset).toBeGreaterThanOrEqual(0);
  });

  it('only consumes what is available (deltaY smaller than the offset)', () => {
    const m = machine(1000, 96);
    godPullSetRaw(m, 600);
    expect(godPullPreScroll(m, 5)).toBe(5);
  });
});

describe('godPullPostScroll (GodPull.kt L352-360)', () => {
  it('does nothing when canPullForward is false (列表还没到底)', () => {
    const m = machine(1000, 96);
    expect(godPullPostScroll(m, -50, () => false)).toBe(0);
    expect(m.raw).toBe(0);
  });

  it('does nothing for a positive (finger-down) delta', () => {
    const m = machine(1000, 96);
    expect(godPullPostScroll(m, 50, () => true)).toBe(0);
    expect(m.raw).toBe(0);
  });

  it('accumulates upward pull and reports the available amount as consumed', () => {
    const m = machine(1000, 96);
    expect(godPullPostScroll(m, -50, () => true)).toBe(-50);
    expect(m.raw).toBe(50);
    expect(m.offset).toBeCloseTo(godPullDamp(50, 1000), 10);
  });
});

describe('godPullPostFling (GodPull.kt L362-365)', () => {
  it('releases only when a pull is in flight', () => {
    const idle = machine(1000, 96);
    expect(godPullPostFling(idle)).toBe(false);

    const pulled = machine(1000, 96);
    const onTrigger = vi.fn();
    godPullSetRaw(pulled, 3000);
    expect(godPullPostFling(pulled, onTrigger)).toBe(true);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });
});

describe('isAtEnd / godAbs (GodPull.kt L392, L395)', () => {
  it('isAtEnd requires a non-empty list', () => {
    expect(isAtEnd(0, 0)).toBe(false);
    expect(isAtEnd(3, 0)).toBe(false);
  });

  it('isAtEnd is true from the last index onwards (current >= count - 1)', () => {
    expect(isAtEnd(3, 5)).toBe(false);
    expect(isAtEnd(4, 5)).toBe(true);
    expect(isAtEnd(5, 5)).toBe(true);
    expect(isAtEnd(6, 5)).toBe(true);
    expect(isAtEnd(0, 1)).toBe(true);
  });

  it('godAbs mirrors kotlin.math.abs', () => {
    expect(godAbs(-3.5)).toBe(3.5);
    expect(godAbs(3.5)).toBe(3.5);
    expect(godAbs(0)).toBe(0);
  });
});

describe('createGodPullMachine (GodPull.kt L143 / L76)', () => {
  it('starts with spanPx 1, thresholdPx 1, offset 0, raw 0, armed false', () => {
    const m = createGodPullMachine();
    expect(m.spanPx).toBe(1);
    expect(m.thresholdPx).toBe(1);
    expect(m.offset).toBe(0);
    expect(m.raw).toBe(0);
    expect(m.armed).toBe(false);
    expect(m.onArm).toBeNull();
    expect(m.onTrigger).toBeNull();
  });

  it('honours the span override', () => {
    expect(createGodPullMachine({ spanPx: 640 }).spanPx).toBe(640);
  });
});
