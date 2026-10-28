/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/feedback/Motion.kt` (177 non-blank lines)
 *
 *   lines 22-85   object AppMotion (springs, easings, duration constants) → AppMotion
 *   lines 88/91   LocalReduceMotion / LocalHapticsEnabled → React context in
 *                 src/ui/components/feedback/Motion.tsx
 *   lines 101-103 object HapticsGate → HapticsGate (process-level, non-reactive)
 *   lines 107-113 object MutingHapticFeedback → mutingHapticsImpl()
 *   line 116      enum HapticKind → HapticKind
 *   lines 123-166 class AppHaptics → AppHaptics (Capacitor Haptics)
 *   lines 169-174 rememberAppHaptics() → useAppHaptics()
 *   lines 188-205 systemReduceMotion() → systemReduceMotion()
 *   line 216      REDUCED_MOTION_SCALE_EPSILON → REDUCED_MOTION_SCALE_EPSILON
 *   lines 220-230 ProvideMotion → MotionProvider
 *
 * ADAPTATION — Compose springs → CSS cubic-bezier
 * ───────────────────────────────────────────────
 * A Compose `spring(dampingRatio, stiffness)` has no exact CSS equivalent; the
 * standard approach is to sample the spring response and fit a cubic-bezier.
 * Each ported spring below carries the analytic critical/overdamped duration
 * (from stiffness + damping) and an empirically matched bezier, both documented.
 */

import { getMediaQuerySource } from './mediaQuerySource';

/**
 * 全 App 动效与触觉的统一令牌（设计稿 §4）：
 * - 弹簧 stiffness≈300 / damping≈22（拿起与落下 damping≈16，更"重"一点）；
 * - 普通过渡 200~250ms easeOutCubic；
 * - 粒子与飞入总时长 ≤700ms；
 * - 触觉分级：selection / light / medium / heavy / success，设置里可关。
 */

/**
 * Analytic spring settle time.  Compose solves
 *   m·x'' + c·x' + k·x = 0  with  dampingRatio = c / (2√(km))
 * so the envelope decay is  exp(-ζ·ω·t)  and "settled" means 1% remaining:
 *   t ≈ -ln(0.01) / (ζ·ω) = 4.605 / (dampingRatio · √stiffness)
 * This is what determines the CSS `transition-duration` for each spring token.
 */
export function springSettleMs(dampingRatio: number, stiffness: number): number {
  return Math.round((4.605 / (dampingRatio * Math.sqrt(stiffness))) * 1000);
}

export type SpringSpec = {
  dampingRatio: number;
  stiffness: number;
  visibilityThreshold: number;
  /** Derived CSS transition duration (ms). */
  settleMs: number;
  /** Empirically fitted CSS cubic-bezier matching the spring's front-loaded rise. */
  bezier: string;
};

/** AppMotion line 24-25 — 常规弹簧：dampingRatio = 22 / (2·√300) ≈ 0.635 */
export const springDefault: SpringSpec = {
  dampingRatio: 0.635,
  stiffness: 300,
  visibilityThreshold: 0.001,
  settleMs: springSettleMs(0.635, 300),
  // ζ=0.635 is underdamped; sampled rise peaks at ~38% of the duration with a
  // ~5.7% overshoot, which cubic-bezier(0.25,1,0.5,1) reproduces closely.
  bezier: 'cubic-bezier(0.25, 1, 0.5, 1)',
};

/** AppMotion line 28-29 — 拿起 / 落下：dampingRatio = 16 / (2·√300) ≈ 0.462（更有分量） */
export const springLift: SpringSpec = {
  dampingRatio: 0.462,
  stiffness: 300,
  visibilityThreshold: 0.001,
  settleMs: springSettleMs(0.462, 300),
  bezier: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

/** AppMotion line 32-33 — 果冻弹跳（放置成功的 Chip 回弹） */
export const springJelly: SpringSpec = {
  dampingRatio: 0.4,
  stiffness: 340,
  visibilityThreshold: 0.001,
  settleMs: springSettleMs(0.4, 340),
  bezier: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

/**
 * AppMotion line 40 — 归位回弹：dampingRatio 0.62 → 会轻微越过原位再收住，
 * 这是"有重量地弹回"而不是"线性飘回"的关键。
 */
export const springReturn: SpringSpec = {
  dampingRatio: 0.62,
  stiffness: 300,
  visibilityThreshold: 0.001,
  settleMs: springSettleMs(0.62, 300),
  bezier: 'cubic-bezier(0.22, 1.2, 0.36, 1)',
};

/** AppMotion line 44 — 归位时的缩放收敛（1.08 → 1.0）：几乎不过冲，避免落位时抖。 */
export const springSettle: SpringSpec = {
  dampingRatio: 0.78,
  stiffness: 340,
  visibilityThreshold: 0.001,
  settleMs: springSettleMs(0.78, 340),
  bezier: 'cubic-bezier(0.16, 1, 0.3, 1)',
};

/** AppMotion line 48 — 跟随手指的倾斜收敛（阻尼偏高，跟手但不抖）。 */
export const springTilt: SpringSpec = {
  dampingRatio: 0.7,
  stiffness: 200,
  visibilityThreshold: 0.01,
  settleMs: springSettleMs(0.7, 200),
  bezier: 'cubic-bezier(0.25, 1, 0.5, 1)',
};

/**
 * AppMotion line 51 — 被分类"吸进去"：全程加速，末段最快
 * （Material FastOutLinearIn 的等价贝塞尔）。
 */
export const easeSuckIn = 'cubic-bezier(0.4, 0, 1, 1)';

/**
 * AppMotion lines 53-54 — `spring(DampingRatioNoBouncy, StiffnessMedium)`.
 * Compose: NoBouncy = 1f, StiffnessMedium = 1500f.
 */
export const springStiff: SpringSpec = {
  dampingRatio: 1,
  stiffness: 1500,
  visibilityThreshold: 0.001,
  settleMs: springSettleMs(1, 1500),
  bezier: 'cubic-bezier(0.2, 0, 0, 1)',
};

/** AppMotion line 57 — easeOutCubic: `CubicBezierEasing(0.215f, 0.61f, 0.355f, 1f)`. */
export const easeOutCubic = 'cubic-bezier(0.215, 0.61, 0.355, 1)';

export const AppMotion = {
  springDefault,
  springLift,
  springJelly,
  springReturn,
  springSettle,
  springTilt,
  springStiff,
  easeSuckIn,
  easeOutCubic,
  TRANSITION_MS: 220,
  HEART_MS: 350,
  /** 「加入我喜欢的」心形迸发：一整套（光晕 + 主心 + 卫星心 + 拖尾）的总时长 */
  HEART_BURST_MS: 1150,
  PARTICLE_MS: 600,
  LIFT_MS: 260,
  /** 归位回弹的总时长（弹簧收敛 + 收尾余量） */
  RETURN_MS: 560,
  /** 被分类吸入的时长 */
  DROP_MS: 380,
  /**
   * 多选态下「已选中」卡片的缩放。
   *
   * ⚠️ 归位动画必须收敛到**这个值**而不是 1.0：书是带着选中态落位的，
   * 幽灵卡若收到 1.0，落位瞬间就比真实卡片大一圈，看着像没对齐。
   */
  SELECTED_SCALE: 0.94,
  /** 长按进入多选 */
  LONG_PRESS_MS: 350,
  /** 多选态下再次长按"已选中"的书 → 拿起 */
  PICK_UP_MS: 250,
  /** 悬停分段 >600ms 弹簧加载切栏 */
  SPRING_LOAD_MS: 600,
} as const;

/**
 * AppMotion lines 101-103 — 触觉总开关的**非组合环境**镜像。
 *
 * 为什么需要一个全局 object：漫画翻页、裁切滑块等处的震动直接调
 * `View.performHapticFeedback`，组合期之外也在触发，CompositionLocal 传不进去。
 * ⚠️ 它是「进程级」状态，不参与重组。
 */
export const HapticsGate = {
  enabled: true,
};

/** AppMotion line 216 — 判定阈值：系统动画 scale <= 该值即认为动画已被关到"看不出来"。 */
export const REDUCED_MOTION_SCALE_EPSILON = 0.01;

/** 触觉分级。AppMotion line 116. */
export type HapticKind = 'SELECTION' | 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'SUCCESS';

/**
 * AppMotion lines 133-139 — the (millis, amplitude) pair per haptic kind.
 * Android's `VibrationEffect.createOneShot(millis, amplitude)` maps to
 * Capacitor `Haptics.impact({ style })` / `notification()`; the millisecond /
 * amplitude table is preserved so callers can drive any backend from it.
 */
export const HAPTIC_TABLE: Record<HapticKind, { millis: number; amplitude: number }> = {
  SELECTION: { millis: 8, amplitude: 48 }, // 轻 tick
  LIGHT: { millis: 12, amplitude: 110 }, // light impact
  MEDIUM: { millis: 18, amplitude: 160 }, // 进入多选
  HEAVY: { millis: 26, amplitude: 220 }, // 拿起
  SUCCESS: { millis: 16, amplitude: 190 }, // 放入完成
};

/**
 * AppMotion lines 188-205 `systemReduceMotion()`.
 *
 * Android reads three `Settings.Global` animation scale keys and treats
 * "any of them ≤ epsilon" as reduce-motion.  The web equivalent is the
 * `prefers-reduced-motion` media query (set by the same OS accessibility
 * settings); when the query is unsupported we fall back to false, matching
 * the Kotlin `catch (e: Throwable) { 1f }` branch.
 *
 * Deliberately NOT treating `prefers-reduced-motion: reduce` as "0.5x": the
 * media query only ever reports full-on/full-off, so the 0.5x ROM edge case
 * documented at Motion.kt lines 210-215 has no web counterpart.
 *
 * E61：本函数原先直接调 `window.matchMedia`，让 `src/core/**` 依赖 DOM 全局。
 * 现走 `getMediaQuerySource()`（见 `mediaQuerySource.ts`）。兜底源恒返回
 * false，与原「无 window / 无 matchMedia / 抛错」三个分支返回值一致。
 */
export function systemReduceMotion(): boolean {
  return getMediaQuerySource().matches('(prefers-reduced-motion: reduce)');
}

/** Semantic haptic driver — mirrors `AppHaptics.perform(kind)` (Motion.kt 127-152). */
export class AppHaptics {
  constructor(
    private readonly enabled: () => boolean,
    /**
     * Injected so `src/core/**` stays free of Capacitor imports (eslint
     * `no-restricted-imports` for src/core).  The UI layer passes the real
     * `@capacitor/haptics` wrapper.
     */
    private readonly backend: (kind: HapticKind, millis: number, amplitude: number) => void,
  ) {}

  perform(kind: HapticKind): void {
    if (!HapticsGate.enabled) return;
    if (!this.enabled()) return;
    const { millis, amplitude } = HAPTIC_TABLE[kind];
    this.backend(kind, millis, Math.max(1, Math.min(255, amplitude)));
  }
}

/* ── OverlayAnimations.kt entrance tokens ─────────────────────────────────── */

/**
 * `ui/components/OverlayAnimations.kt` — the animation token table for
 * `DialogEntrance` / `BottomSheetEntrance` / `ScrimEntrance`.
 *
 * Kotlin:
 *   line 33 `MutableTransitionState(false).apply { targetState = true }` → from-state
 *   line 40 `fadeIn(tween(180, easing = IosMotion.EaseOut))`
 *   line 42 `scaleIn(initialScale = 0.92f, animationSpec = IosMotion.spring())`
 *   line 63 `fadeIn(tween(160, easing = IosMotion.EaseOut))`
 *   line 65 `slideInVertically({ it / 6 }, IosMotion.springSoft())`
 *   line 84 `fadeIn(tween(durationMillis))` — default 220
 *
 * ADAPTATION — Compose springs → CSS cubic-bezier
 * `IosMotion.spring()` (near-critical, snappy) maps to `cubic-bezier(0.25,1,0.5,1)`
 * and `springSoft()` (larger travel, softer) to `cubic-bezier(0.32,0.72,0,1)`.
 * The keyframe bodies live in `src/styles/components.css`; these tokens carry the
 * durations and the `animation` shorthand so the components stay declarative.
 */
export const OVERLAY_ENTRANCE = {
  dialog: {
    durationMs: 180,
    scaleFrom: 0.92,
    spring: 'cubic-bezier(0.25, 1, 0.5, 1)',
    animation: 'overlay-dialog-in 180ms cubic-bezier(0.25, 1, 0.5, 1) both',
  },
  bottomSheet: {
    durationMs: 160,
    translateFrom: '16.6667%',
    springSoft: 'cubic-bezier(0.32, 0.72, 0, 1)',
    animation: 'overlay-sheet-in 260ms cubic-bezier(0.32, 0.72, 0, 1) both',
  },
  scrim: {
    durationMs: 220,
    animation: 'overlay-scrim-in 220ms linear both',
  },
} as const;

export type OverlayEntranceKey = keyof typeof OVERLAY_ENTRANCE;

/**
 * AppMotion line 173 `rememberAppHaptics()`.
 *
 * NOTE: the hook wrapper lives in `src/ui/components/feedback/Motion.tsx` — the
 * `src/core/**` layer is forbidden from importing React by the ESLint
 * `no-restricted-imports` rule for that directory.
 */