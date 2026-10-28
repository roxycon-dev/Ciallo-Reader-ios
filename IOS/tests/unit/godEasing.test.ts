/**
 * 神回动效数值层的回归测试 —— `@core/god/godEasing`。
 *
 * Kotlin 行号映射（`novel-reader/app/src/main/java/com/example/god/GodMotion.kt`）：
 *   - 34/37/40/43 四条 `SpringSpec`（dampingRatio / stiffness）
 *   - 46-49 FAST_MS / NORMAL_MS / SLOW_MS / SHEET_MS，52 STAGGER_MS，59 SHINE_MS
 *   - 70-72 SHEET_CORNER / CARD_CORNER / BUTTON_CORNER，81-82 PRESS_SCALE / PRESS_ALPHA
 *   - 164-165 `godSpec(reduce, …) = tween(120)`
 *   - 191 `staggerDelay(index, base)`
 *
 * 本文件的价值：**把「关键时间点的位移」钉死**。
 * `godSpringDisplacement()` 是 Compose `SpringSimulation.valueAtTime()` 欠阻尼解析解的
 * 同构式（1 − e^(−ζω0·t)·[cos(ωd·t) + (ζω0/ωd)·sin(ωd·t)]，ω0 = √k、ωd = ω0·√(1−ζ²)），
 * 下面每一组 `toBeCloseTo` 都是把它与手算值对齐；任何人改了 damping / stiffness
 * 都会在这里红。CSS 侧的 cubic-bezier 只做单峰拟合（复现不了第二次振荡），
 * 因此断言的是「与解析解的偏差上界」而不是逐点相等。
 */
import { describe, expect, it } from 'vitest';
import {
  GOD_BUTTON_CORNER,
  GOD_CARD_CORNER,
  GOD_DEAD_MOTION_CONSTANTS,
  GOD_EASE_LINEAR,
  GOD_FAST_MS,
  GOD_FAST_OUT_SLOW_IN_CSS,
  GOD_NORMAL_MS,
  GOD_PRESS_ALPHA,
  GOD_PRESS_SCALE,
  GOD_REDUCE_TWEEN_MS,
  GOD_SHEET_CORNER,
  GOD_SHEET_MS,
  GOD_SHINE_MS,
  GOD_SLOW_MS,
  GOD_SPRING_BOUNCY_CSS,
  GOD_SPRING_LIGHT_CSS,
  GOD_SPRING_MAIN_CSS,
  GOD_SPRING_SOFT_CSS,
  GOD_SPRING_SPECS,
  GOD_STAGGER_MS,
  godCubicBezierAt,
  godFastOutSlowIn,
  godSpringDisplacement,
  godSpringPeak,
  godSpringRestTimeMs,
  godSpringVelocity,
  godStaggerDelay,
  type GodSpringKey,
} from '@core/god/godEasing';

describe('GodMotion 常量（GodMotion.kt L46-82）', () => {
  it('时长逐字一致', () => {
    expect(GOD_FAST_MS).toBe(180); // L46 FAST_MS
    expect(GOD_NORMAL_MS).toBe(260); // L47 NORMAL_MS
    expect(GOD_SLOW_MS).toBe(380); // L48 SLOW_MS
    expect(GOD_SHEET_MS).toBe(420); // L49 SHEET_MS
    expect(GOD_SHINE_MS).toBe(2600); // L59 SHINE_MS
    expect(GOD_REDUCE_TWEEN_MS).toBe(120); // L165 godSpec(reduce) = tween(120)
  });

  it('尺寸 / 按压 token 逐字一致', () => {
    expect(GOD_STAGGER_MS).toBe(60); // L52 STAGGER_MS
    expect(GOD_SHEET_CORNER).toBe(28); // L70
    expect(GOD_CARD_CORNER).toBe(18); // L71
    expect(GOD_BUTTON_CORNER).toBe(14); // L72
    expect(GOD_PRESS_SCALE).toBe(0.96); // L81
    expect(GOD_PRESS_ALPHA).toBe(0.92); // L82
  });

  it('staggerDelay(index, base) = base + index · STAGGER_MS（L191）', () => {
    expect(godStaggerDelay(0)).toBe(0); // Kotlin 默认 base = 0
    expect(godStaggerDelay(3)).toBe(180);
    expect(godStaggerDelay(4, 60)).toBe(300); // GodMomentSheet.kt:714 的调用形态
    expect(godStaggerDelay(1, 60)).toBe(120);
  });

  it('Android 侧零调用方的死常量如实记录（不导出成 API）', () => {
    // 全 Android 源码树 grep：`SWING_STAGGER_MS` / `BREATH_MS` / `VINYL_SPIN_MS`
    // 只有 GodMotion.kt 里的定义行，没有任何引用。
    expect(GOD_DEAD_MOTION_CONSTANTS).toEqual({
      swingStaggerMs: 60,
      breathMs: 3200,
      vinylSpinMs: 6000,
    });
  });
});

describe('FastOutSlowInEasing（tween() 的默认缓动）', () => {
  it('CSS 常量就是 Compose 的 CubicBezierEasing(0.4f, 0f, 0.2f, 1f)', () => {
    expect(GOD_FAST_OUT_SLOW_IN_CSS).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
    expect(GOD_EASE_LINEAR).toBe('linear');
  });

  it('数值曲线与 CSS cubic-bezier(0.4, 0, 0.2, 1) 逐点一致（钉住关键进度）', () => {
    expect(godFastOutSlowIn(0)).toBe(0);
    expect(godFastOutSlowIn(1)).toBe(1);
    expect(godFastOutSlowIn(0.25)).toBeCloseTo(0.2366, 4);
    expect(godFastOutSlowIn(0.5)).toBeCloseTo(0.7756, 4);
    expect(godFastOutSlowIn(0.75)).toBeCloseTo(0.9594, 4);
  });

  it('FastOutSlowIn 明显「前快后慢」，与 Linear 不同（这就是 GodSparks 的手感来源）', () => {
    expect(godFastOutSlowIn(0.5)).toBeGreaterThan(0.5);
    expect(godFastOutSlowIn(0.5)).toBeLessThan(0.85);
  });

  it('两端夹紧', () => {
    expect(godFastOutSlowIn(-1)).toBe(0);
    expect(godFastOutSlowIn(2)).toBe(1);
    expect(godFastOutSlowIn(Number.NaN)).toBe(1);
  });
});

describe('SpringSpec 逐条（GodMotion.kt L34 / L37 / L40 / L43）', () => {
  it('dampingRatio / stiffness 与 Kotlin 字面量一致', () => {
    expect(GOD_SPRING_SPECS.main).toMatchObject({ dampingRatio: 0.72, stiffness: 380 });
    expect(GOD_SPRING_SPECS.light).toMatchObject({ dampingRatio: 0.85, stiffness: 520 });
    expect(GOD_SPRING_SPECS.soft).toMatchObject({ dampingRatio: 0.9, stiffness: 220 });
    expect(GOD_SPRING_SPECS.bouncy).toMatchObject({ dampingRatio: 0.55, stiffness: 260 });
  });

  it('四条规格全部欠阻尼（ζ < 1），解析解走 Compose 的欠阻尼分支', () => {
    for (const key of Object.keys(GOD_SPRING_SPECS) as GodSpringKey[]) {
      expect(GOD_SPRING_SPECS[key].dampingRatio).toBeLessThan(1);
      expect(GOD_SPRING_SPECS[key].mass).toBe(1); // SpringSimulation 默认 mass = 1f
    }
  });
});

describe('godSpringDisplacement —— Compose 解析解的关键时间点位移', () => {
  it('t = 0 时位移为 0、速度为 0（Compose 的 initialOffset / initialVelocity）', () => {
    for (const key of Object.keys(GOD_SPRING_SPECS) as GodSpringKey[]) {
      expect(godSpringDisplacement(key, 0)).toBe(0);
      expect(godSpringDisplacement(key, -1)).toBe(0);
      expect(godSpringVelocity(key, 0)).toBe(0);
    }
  });

  // 数值来自 x(t) = 1 − e^(−ζω0·t)·[cos(ωd·t) + (ζω0/ωd)·sin(ωd·t)]
  const TABLE: Array<[GodSpringKey, Array<[number, number]>]> = [
    [
      'main',
      [
        [25, 0.0935],
        [50, 0.2915],
        [100, 0.6979],
        [150, 0.9406],
        [200, 1.0283],
        [250, 1.0365],
        [300, 1.0212],
        [380, 1.0026],
      ],
    ],
    [
      'light',
      [
        [25, 0.1176],
        [50, 0.341],
        [100, 0.7314],
        [150, 0.9267],
        [200, 0.9928],
        [260, 1.0063],
      ],
    ],
    [
      'soft',
      [
        [25, 0.0551],
        [50, 0.1771],
        [100, 0.4626],
        [150, 0.6937],
        [200, 0.8435],
        [250, 0.9283],
        [300, 0.9715],
        [460, 1.0014],
      ],
    ],
    [
      'bouncy',
      [
        [25, 0.0695],
        [50, 0.2347],
        [100, 0.6439],
        [150, 0.958],
        [200, 1.1045],
        [250, 1.1222],
        [300, 1.0796],
        [420, 0.9898],
      ],
    ],
  ];

  for (const [key, points] of TABLE) {
    it(`${key}：位移钉在关键时间点`, () => {
      for (const [tMs, expected] of points) {
        expect(godSpringDisplacement(key, tMs)).toBeCloseTo(expected, 3);
      }
    });
  }

  it('欠阻尼的过冲与回落形状（ζ 越小过冲越大）', () => {
    expect(godSpringDisplacement('bouncy', 200)).toBeGreaterThan(1.1); // 明显过冲
    expect(godSpringDisplacement('main', 200)).toBeGreaterThan(1); // 轻微过冲
    expect(godSpringDisplacement('soft', 200)).toBeLessThan(1); // 尚未到 1
    // 过冲后回落：main 在 250ms 之后回落，380ms 时已贴近 1
    expect(godSpringDisplacement('main', 380)).toBeLessThan(godSpringDisplacement('main', 250));
  });
});

describe('godSpringPeak / godSpringRestTimeMs', () => {
  it('峰值过冲量 e^(−πζ/√(1−ζ²)) 与到达时刻 π/ωd', () => {
    const main = godSpringPeak('main');
    expect(main.overshoot).toBeCloseTo(0.03841, 4);
    expect(main.atMs).toBeCloseTo(232.2, 0);
    expect(godSpringPeak('bouncy').overshoot).toBeCloseTo(0.12632, 4);
    expect(godSpringPeak('light').overshoot).toBeCloseTo(0.00629, 4);
    expect(godSpringPeak('soft').overshoot).toBeCloseTo(0.00152, 4);
  });

  it('按 Compose 静止判据（|x−1| ≤ 0.01 且 |v| ≤ 0.1）求时长', () => {
    expect(godSpringRestTimeMs('main')).toBeGreaterThan(300);
    expect(godSpringRestTimeMs('light')).toBeLessThan(godSpringRestTimeMs('main'));
    expect(godSpringRestTimeMs('bouncy')).toBeGreaterThan(godSpringRestTimeMs('main'));
  });

  it('静止时间与 CSS 时长同量级（否则过渡要么截断要么拖沓）', () => {
    for (const key of Object.keys(GOD_SPRING_SPECS) as GodSpringKey[]) {
      const rest = godSpringRestTimeMs(key);
      const css = GOD_SPRING_SPECS[key].durationMs;
      expect(rest / css).toBeGreaterThan(0.5);
      expect(rest / css).toBeLessThan(2);
    }
  });
});

describe('CSS cubic-bezier 拟合（GodMotion.kt 四条弹簧）', () => {
  it('控制点与时长固化在 godEasing 里，导出串随之确定', () => {
    expect(GOD_SPRING_MAIN_CSS).toBe('380ms cubic-bezier(0.342, 0.554, 0.107, 1.21)');
    expect(GOD_SPRING_LIGHT_CSS).toBe('260ms cubic-bezier(0.241, 0.161, 0.244, 1.098)');
    expect(GOD_SPRING_SOFT_CSS).toBe('460ms cubic-bezier(0.232, 0.181, 0.169, 1.096)');
    expect(GOD_SPRING_BOUNCY_CSS).toBe('420ms cubic-bezier(0.414, 0.708, 0.107, 1.363)');
  });

  it('曲线两端精确落在 0 / 1', () => {
    for (const key of Object.keys(GOD_SPRING_SPECS) as GodSpringKey[]) {
      const cp = GOD_SPRING_SPECS[key].controlPoints;
      expect(godCubicBezierAt(cp, 0)).toBe(0);
      expect(godCubicBezierAt(cp, 1)).toBe(1);
      // 单调 x 分量（CSS 要求 x1 / x2 ∈ [0,1]，否则浏览器会当 linear 处理）
      expect(cp[0]).toBeGreaterThanOrEqual(0);
      expect(cp[0]).toBeLessThanOrEqual(1);
      expect(cp[2]).toBeGreaterThanOrEqual(0);
      expect(cp[2]).toBeLessThanOrEqual(1);
    }
  });

  const FIT: Array<[GodSpringKey, Array<[number, number]>]> = [
    [
      'main',
      [
        [0.25, 0.6747],
        [0.5, 1.0042],
        [0.75, 1.0389],
      ],
    ],
    [
      'light',
      [
        [0.25, 0.4768],
        [0.5, 0.8611],
        [0.75, 0.9918],
      ],
    ],
    [
      'soft',
      [
        [0.25, 0.549],
        [0.5, 0.8917],
        [0.75, 0.9962],
      ],
    ],
    [
      'bouncy',
      [
        [0.25, 0.6745],
        [0.5, 1.09],
        [0.75, 1.0833],
      ],
    ],
  ];

  for (const [key, points] of FIT) {
    it(`${key}：CSS 曲线在 25/50/75% 处的取值`, () => {
      const cp = GOD_SPRING_SPECS[key].controlPoints;
      for (const [x, expected] of points) {
        expect(godCubicBezierAt(cp, x)).toBeCloseTo(expected, 3);
      }
    });

    it(`${key}：过冲幅度与 Compose 弹簧同量级（|Δ| ≤ 0.03）`, () => {
      const cp = GOD_SPRING_SPECS[key].controlPoints;
      let peak = 0;
      for (let i = 0; i <= 400; i += 1) {
        peak = Math.max(peak, godCubicBezierAt(cp, i / 400));
      }
      const springPeak = godSpringPeak(key).overshoot;
      expect(Math.abs((peak - 1) - springPeak)).toBeLessThanOrEqual(0.03);
    });

    it(`${key}：与解析解的最大偏差在登记的残差内（单条贝塞尔复现不了第二次振荡）`, () => {
      const spec = GOD_SPRING_SPECS[key];
      const cp = spec.controlPoints;
      let maxErr = 0;
      for (let i = 0; i <= 200; i += 1) {
        const f = i / 200;
        const err = Math.abs(
          godCubicBezierAt(cp, f) - godSpringDisplacement(key, f * spec.durationMs),
        );
        if (err > maxErr) maxErr = err;
      }
      // 登记值：main 0.032 / light 0.011 / soft 0.011 / bouncy 0.042
      expect(maxErr).toBeLessThanOrEqual(0.05);
    });
  }
});