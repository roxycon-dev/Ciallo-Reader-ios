/**
 * 手绘图标的手势/接触时钟 —— `ui/wenku/WenkuIcon.kt` L63-120 + L246-582 的数学层。
 *
 * Kotlin 里这层是 `@Immutable data class` + 私有 `Animatable`；Web 侧保留同样的数据与
 * 公式，时钟由 React（rAF / CSS transition）驱动。所有时长（380 / 140 / 240 / 640 /
 * 880 / 520 / 2600）与线宽（2.05 / 1.9 / 1.72）逐值照抄。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L71-75  `data class WenkuIconContact(pressed = false, activation = 0)`   → `WenkuIconContact`（本文件）
 *   L78     `LocalWenkuIconContact = staticCompositionLocalOf { WenkuIconContact() }`
 *                                                                          → `src/ui/components/wenku/WenkuIconContact.tsx`
 *   L85     `WenkuEaseOutCubic = CubicBezierEasing(0.215, 0.61, 0.355, 1)`   → `WENKU_EASE_OUT_CUBIC`
 *   L88     `WENKU_ENTRANCE_NONE = -1`                                     → 同名
 *   L91     `WENKU_AMBIENT_REST_MS = 2600L`                                → 同名
 *   L94-95  `gesturePhase(value, start, span)`                             → `gesturePhase`
 *   L100-103 `sampleGesture(phase, origin)`：前 24% 用 easeOutCubic 交还残余 → 同名
 *   L106-109 `pressGesture(contact)`：`easeOutCubic(contact) * .16` 三等分 → 同名
 *   L116-120 `baseStrokeWidth(contrast, sizeDp)`                            → 同名
 *   L126-140 `drawWenkuPose` 的 `t = stateCurve(change)`                    → `WENKU_STATE_CURVE`
 *   L246-260 `WenkuGlyphClock`：change / contact / gesture 三个 Animatable  → `WENKU_ICON_CLOCK`
 *   L494 / L496 `tween(140, LinearEasing)` / `tween(240, LinearEasing)`     → `CONTACT_IN_MS` / `CONTACT_OUT_MS`
 *   L520-533 手势 640ms、入场 880ms 窗口 + 520ms 有效跨度、常驻 2600ms      → `WENKU_ICON_CLOCK`
 *   L248-280 `WenkuMat`（2D 仿射子集）                                      → `WenkuMat`
 *   L285-300 `WenkuTrace` 的变换时机（写入即时套矩阵）                       → `WenkuTrace`
 *
 * 平台差异（已登记 E128）：`CompositionLocal` → React Context；`Animatable` → 调用方的时钟。
 */
import { cubicBezier } from './motion';

/** L85 `WenkuEaseOutCubic`。 */
export const WENKU_EASE_OUT_CUBIC = cubicBezier(0.215, 0.61, 0.355, 1);

/** L88 `WENKU_ENTRANCE_NONE = -1`（非入场重播的哨兵值）。 */
export const WENKU_ENTRANCE_NONE = -1;

/** L91 常驻图标两次手势之间完全静止的时长。 */
export const WENKU_AMBIENT_REST_MS = 2600;

/** L71-75 `WenkuIconContact`。 */
export interface WenkuIconContact {
  readonly pressed: boolean;
  readonly activation: number;
}

export const WENKU_ICON_CONTACT_REST: WenkuIconContact = { pressed: false, activation: 0 };

// L78 `LocalWenkuIconContact` 是 CompositionLocal（React Context），按目录纪律放在
// `src/ui/components/wenku/WenkuIconContact.tsx`（`src/core/**` 禁止 import React）。

/** 手势三通道（lead / follow / trail）的位移量。 */
export interface WenkuIconGesture {
  readonly lead: number;
  readonly follow: number;
  readonly trail: number;
}

/** `WenkuIconGesture.Rest`。 */
export const WENKU_ICON_GESTURE_REST: WenkuIconGesture = { lead: 0, follow: 0, trail: 0 };

/** `WenkuIconGesture.plus(other, weight)`：逐分量 `this + other * weight`。 */
export function plusGesture(a: WenkuIconGesture, b: WenkuIconGesture, weight = 1): WenkuIconGesture {
  return {
    lead: a.lead + b.lead * weight,
    follow: a.follow + b.follow * weight,
    trail: a.trail + b.trail * weight,
  };
}

/** L94-95 `gesturePhase(value, start, span)`。 */
export function gesturePhase(value: number, start: number, span: number): number {
  if (span <= 0) return 1;
  return Math.min(Math.max((value - start) / span, 0), 1);
}

/** L100-103 `sampleGesture(phase, origin)`。 */
export function sampleGesture(phase: number, origin: WenkuIconGesture): WenkuIconGesture {
  const carry = 1 - WENKU_EASE_OUT_CUBIC(Math.min(Math.max(phase / 0.24, 0), 1));
  return plusGesture(wenkuIconMotionFrame(phase), origin, carry);
}

/** L106-109 `pressGesture(contact)`。 */
export function pressGesture(contact: number): WenkuIconGesture {
  const press = WENKU_EASE_OUT_CUBIC(Math.min(Math.max(contact, 0), 1)) * 0.16;
  return { lead: press, follow: press, trail: press };
}

/** L116-120 `baseStrokeWidth(contrast, sizeDp)`。 */
export function baseStrokeWidth(contrast: boolean, sizeDp: number): number {
  if (contrast) return 2.05;
  if (sizeDp < 18) return 1.9;
  return 1.72;
}

/** L136 `t = WenkuIconMotion.stateCurve.transform(change.coerceIn(0f, 1f))` 的曲线。 */
export const WENKU_STATE_CURVE = cubicBezier(0.2, 0, 0, 1);

/**
 * L246-260 `WenkuGlyphClock` 的三个时钟时长：
 * `change`（380ms morph）、`contact`（按下 140ms / 抬起 240ms）、`gesture`（640ms 一次手势）。
 * 入场用 880ms 窗口 + 520ms 有效跨度；常驻图标静止 2600ms 后重播。
 */
export const WENKU_ICON_CLOCK = {
  changeMs: 380,
  contactInMs: 140,
  contactOutMs: 240,
  gestureMs: 640,
  entranceWindowMs: 880,
  entranceSpanMs: 520,
  ambientRestMs: WENKU_AMBIENT_REST_MS,
} as const;

/**
 * `WenkuIconMotion.frame(phase)` —— 真身在 `src/core/wenku/iconArt.ts`
 * （`WenkuIconArt.kt` L175-191 的 `spring` 关键帧采样）。
 *
 * 这里保留同名薄封装，避免 `sampleGesture` 与 art 层互相 import 造成环。
 * 周期 640ms、三段延迟 0 / .055 / .11、关键帧
 * t=[0,.10,.36,.64,.82,1] v=[0,-.12,1,-.20,.065,0]，与 Kotlin 逐值一致。
 */
export function wenkuIconMotionFrame(phase: number): WenkuIconGesture {
  const t = Math.min(Math.max(phase, 0), 1);
  const springAt = (x: number): number => {
    if (x <= 0 || x >= 1) return 0;
    const times = [0, 0.1, 0.36, 0.64, 0.82, 1];
    const values = [0, -0.12, 1, -0.2, 0.065, 0];
    for (let i = 1; i < times.length; i += 1) {
      const upper = times[i] ?? 1;
      if (x <= upper) {
        const lower = times[i - 1] ?? 0;
        const local = (x - lower) / (upper - lower);
        const eased = cubicBezier(0.645, 0.045, 0.355, 1)(local);
        const v0 = values[i - 1] ?? 0;
        const v1 = values[i] ?? 0;
        return v0 + (v1 - v0) * eased;
      }
    }
    return 0;
  };
  return {
    lead: springAt(t),
    follow: springAt(Math.min(Math.max((t - 0.055) / 0.945, 0), 1)),
    trail: springAt(Math.min(Math.max((t - 0.11) / 0.89, 0), 1)),
  };
}

/**
 * L248-280 `WenkuMat`：Matrix4 的 2D 仿射子集（a, b, c, d, e, f）。
 * Dart 端是 `previous * T(x+p, y+p) * Rz(angle) * S(scale) * T(-p, -p)`。
 */
export class WenkuMat {
  constructor(
    readonly a = 1,
    readonly b = 0,
    readonly c = 0,
    readonly d = 1,
    readonly e = 0,
    readonly f = 0,
  ) {}

  /** `this ∘ other`：先应用 other，再应用 this。 */
  times(other: WenkuMat): WenkuMat {
    return new WenkuMat(
      this.a * other.a + this.c * other.b,
      this.b * other.a + this.d * other.b,
      this.a * other.c + this.c * other.d,
      this.b * other.c + this.d * other.d,
      this.a * other.e + this.c * other.f + this.e,
      this.b * other.e + this.d * other.f + this.f,
    );
  }

  x(x: number, y: number): number {
    return this.a * x + this.c * y + this.e;
  }

  y(x: number, y: number): number {
    return this.b * x + this.d * y + this.f;
  }

  static translate(tx: number, ty: number): WenkuMat {
    return new WenkuMat(1, 0, 0, 1, tx, ty);
  }

  static rotate(angle: number): WenkuMat {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return new WenkuMat(cosA, sinA, -sinA, cosA);
  }

  static scale(s: number): WenkuMat {
    return new WenkuMat(s, 0, 0, s);
  }
}

/**
 * L285-300 `WenkuTrace` 的等价物：写入时即时套用当前矩阵，产出 SVG 路径字符串。
 * （Kotlin 直接写 `Path`；Web 侧产 `d` 属性，两者几何一致。）
 */
export class WenkuTrace {
  private parts: string[] = [];

  constructor(private readonly matrix: WenkuMat) {}

  m(x: number, y: number): this {
    this.parts.push(`M${fmt(this.matrix.x(x, y))} ${fmt(this.matrix.y(x, y))}`);
    return this;
  }

  l(x: number, y: number): this {
    this.parts.push(`L${fmt(this.matrix.x(x, y))} ${fmt(this.matrix.y(x, y))}`);
    return this;
  }

  q(x1: number, y1: number, x: number, y: number): this {
    this.parts.push(
      `Q${fmt(this.matrix.x(x1, y1))} ${fmt(this.matrix.y(x1, y1))} ${fmt(this.matrix.x(x, y))} ${fmt(
        this.matrix.y(x, y),
      )}`,
    );
    return this;
  }

  c(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.parts.push(
      `C${fmt(this.matrix.x(x1, y1))} ${fmt(this.matrix.y(x1, y1))} ${fmt(this.matrix.x(x2, y2))} ${fmt(
        this.matrix.y(x2, y2),
      )} ${fmt(this.matrix.x(x, y))} ${fmt(this.matrix.y(x, y))}`,
    );
    return this;
  }

  z(): this {
    this.parts.push('Z');
    return this;
  }

  toPathData(): string {
    return this.parts.join(' ');
  }
}

function fmt(v: number): string {
  return String(Number(v.toFixed(3)));
}

/**
 * `LocalWenkuForeground`（L567-582 `rememberWenkuForeground`）：
 * 进入后台等价于 Dart 端 `TickerMode.enabled == false`。
 */
export function isForeground(lifecycleState: string): boolean {
  return lifecycleState === 'RESUMED' || lifecycleState === 'visible' || lifecycleState === 'active';
}
