import { useEffect, useMemo, useState } from 'react';
import { hslToHex, hexToHsl, parseHex, strokeTintOf, withAlpha } from '../../core/glass/color';
import { rescaleCornerRadius } from '../../core/glass/cardTweaks';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/GlassCard.kt` (950 non-blank lines) — the MAX-quality layer maths.
 *
 * The existing shared `src/ui/components/GlassCard.tsx` (imported by the
 * Home / Statistics / Settings pages) renders the visible surface; this module
 * carries the full GlassCard.kt derivation set so that component can consume it
 * through ADDITIVE optional props (see the report for the exact list).
 *
 * PORTED
 *   lines  64-77  GlassDecoKey                     → GlassDecoKey / glassDecoKey()
 *   lines  80-83  ScaledCornerSize                 → rescaleCornerRadius (core/glass/cardTweaks)
 *   lines  94-128 buildIndentUnitPath(seed)        → buildIndentUnitPath()
 *   line  131     PI_F                            → PI_F
 *   lines 134-135 LIGHT_DIR_X / LIGHT_DIR_Y       → LIGHT_DIR
 *   line  138     DENT_AMBIENT                     → DENT_AMBIENT
 *   lines 202-214 rescaleCorners                   → rescaleCornerRadius
 *   lines 216-236 glassDecoKey() DrawScope ext.    → glassDecoKey()
 *   lines 280-284 themedTint / strokeTint          → themedTint()/strokeTintOf() (core color)
 *   lines 300-307 pressScale                       → pressScale()
 *   lines 320-348 press tracking + pressAnim       → PressState / usePressTracking()
 *   lines 353-366 tiltSpec / tiltX / tiltY         → (inside usePressTracking)
 *   lines 383-388 pressLift                        → pressLiftPx()
 *   lines 391-397 C2 entrance                      → entranceCss()
 *   lines 408-411 indentSeed / dentOutline         → newIndentSeed() / buildIndentUnitPath()
 *   lines 427-437 cameraDistance                   → cameraDistancePx()
 *   lines 443-465 AGSL uniform upload              → SKIP (see report)
 *   lines 476-513 pointerInput press observer      → pressHandlers()
 *   lines 516-543 shadow branches                  → glassShadowCss()
 *   lines 546-557 MAX auroraSecondary              → auroraSecondary()
 *   lines 558-588 clip / surface branches          → glassSurfaceCss()
 *   lines 600-673 indent layer                     → indentCss()
 *   lines 675-787 B1 tilt lighting                  → tiltLightCss()
 *   lines 789-808 B2 top rim                       → topRimCss()
 *   lines 810-880 light path layers                → lightPathCss()
 *   lines 881-888 film grain                       → filmGrainCss (core/glass/liquidGlass)
 *   lines 889-961 prism border + inner bevel       → prismBorderCss() / bevelCss()
 *   lines 977-994 content parallax                 → contentParallaxCss()
 *
 * SKIPPED — AGSL (see report)
 * lines 146-187 `DENT_LIGHT_AGLS` + lines 443-465 the RuntimeShader uniform upload.
 * This is a per-pixel AGSL Lambert-shading pass gated on API 33+.
 * APPROXIMATION: `indentCss()` reproduces the *documented API<33 fallback path*
 * (GlassCard.kt lines 655-668) — a radial gradient whose centre is offset by the
 * live tilt angle — while `tiltLightCss()` preserves the directional wall shading
 * with the same coefficients and the same mirror symmetry (the shader's only other
 * visible contribution). The result is visually equivalent, not pixel-identical.
 */

/** GlassCard.kt line 131 — π 的浮点常量。 */
export const PI_F = Math.PI;

/**
 * GlassCard.kt lines 133-135 — 全局固定光源方向（任务书「光源固定修正」指定）：
 * 恒为屏幕上方偏后，全 App 所有光照效果共用同一光源保证自洽。
 */
export const LIGHT_DIR = { x: 0, y: -0.6 } as const;

/** GlassCard.kt line 138 — 环境光底（任务书建议 0.75~0.85 取中）。 */
export const DENT_AMBIENT = 0.8;

/** GlassCard.kt lines 64-77 — 性能优化用的装饰层签名。 */
export interface GlassDecoKey {
  width: number;
  height: number;
  pressed: boolean;
  primary: string;
  secondary: string;
  radius: number;
  qualityId: number;
  tintMix: number;
  /** 毛玻璃厚度归一值（−1 更薄 … 0 默认 22dp … +1 最厚）。 */
  thickness: number;
}

/** GlassCard.kt lines 216-236 `DrawScope.glassDecoKey()`. */
export function glassDecoKey(o: {
  width: number;
  height: number;
  pressed: boolean;
  primary: string;
  secondary: string;
  radius: number;
  qualityId: number;
  tintMix: number;
  thickness: number;
}): GlassDecoKey {
  return { ...o };
}

/**
 * GlassCard.kt lines 94-128 `buildIndentUnitPath(seed)` —
 * 压痕轮廓（单位域）—— 指腹接触斑形态：
 *  低频瓣状起伏（2/3 次谐波 ±6%/±4%）+ 高频微扰白噪声 ±3%，
 *  再做长短轴比 0.87 的椭圆各向异性，消除"圆规圆"。
 * 24 点极坐标采样，相邻点以「顶点作控制点、中点作锚点」的二次贝塞尔衔接。
 * 每次按下（DOWN）传入新 seed 重建一次并缓存，同一次按压内形状固定不变。
 *
 * React 19: `Math.random()` must not run during render. The seed is produced inside
 * a pointerdown handler via `newIndentSeed()`; the PRNG below is deterministic, so
 * the same seed always yields the same outline (matching Kotlin's `Random(seed)`).
 */
export function buildIndentUnitPath(seed: number): string {
  const points = 24;
  const random = mulberry32(seed);
  const phaseLobe1 = random() * 2 * PI_F;
  const phaseLobe2 = random() * 2 * PI_F;
  const microAmplitude = 0.03;
  // 各向异性：指腹接触斑近似椭圆（短/长轴 ≈ 0.87），轴向 ±0.4rad 弱随机
  const axisAngle = (random() - 0.5) * 0.8;
  const cosA = Math.cos(axisAngle);
  const sinA = Math.sin(axisAngle);
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 2 * PI_F;
    const r =
      1 +
      0.06 * Math.sin(2 * angle + phaseLobe1) +
      0.04 * Math.sin(3 * angle + phaseLobe2) +
      (random() - 0.5) * 2 * microAmplitude;
    const xr = Math.cos(angle) * r;
    const yr = Math.sin(angle) * r;
    // 绕原点旋转轴向并对一根轴压扁成椭圆
    px[i] = xr * cosA - yr * sinA;
    py[i] = (xr * sinA + yr * cosA) * 0.87;
  }
  const midX = (i: number): number => ((px[i] ?? 0) + (px[(i + 1) % points] ?? 0)) / 2;
  const midY = (i: number): number => ((py[i] ?? 0) + (py[(i + 1) % points] ?? 0)) / 2;
  let d = `M${midX(points - 1).toFixed(5)},${midY(points - 1).toFixed(5)}`;
  for (let i = 0; i < points; i++) {
    const j = (i + 1) % points;
    d += ` Q${(px[j] ?? 0).toFixed(5)},${(py[j] ?? 0).toFixed(5)} ${midX(i).toFixed(5)},${midY(i).toFixed(5)}`;
  }
  return `${d} Z`;
}

/** Deterministic PRNG (mulberry32) standing in for `kotlin.random.Random(seed)`. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** GlassCard.kt line 408 — 每次 DOWN 刷新 seed（`System.currentTimeMillis()`）。 */
export function newIndentSeed(): number {
  return Math.round(
    typeof performance !== 'undefined' ? performance.now() * 1000 : Date.now() * 1000,
  );
}

/* ── press / tilt interaction state ──────────────────────────────────────── */

export interface PressState {
  handDown: boolean;
  /** 压痕强度 0..1（pressAnim.value） */
  indentIntensity: number;
  /** 归一化偏移 −1..1 */
  pressNorm: { x: number; y: number };
  /** 触点位置（px，相对卡片） */
  pressPos: { x: number; y: number };
  /** 每按一次刷新一次（pressHandlers.onCommitDown）。 */
  indentSeed: number;
  /** 按压起始时刻（ms） */
  pressStartAt: number;
  /** tiltX / tiltY（度） */
  tiltX: number;
  tiltY: number;
}

export const IDLE_PRESS: PressState = {
  handDown: false,
  indentIntensity: 0,
  pressNorm: { x: 0, y: 0 },
  pressPos: { x: 0, y: 0 },
  indentSeed: 0,
  pressStartAt: 0,
  tiltX: 0,
  tiltY: 0,
};

/** GlassCard.kt lines 335-337 — 按下硬弹簧（高刚度、无回弹）干脆落底。 */
export const PRESS_IN_SPRING = {
  dampingRatio: 1,
  stiffness: 1500,
  bezier: 'cubic-bezier(0.2, 0, 0, 1)',
  ms: Math.round((4.605 / Math.sqrt(1500)) * 1000),
};

/**
 * GlassCard.kt lines 339-346 — 松手软弹簧缓慢原地回弹，
 * 且按住越久刚度越低（应力松弛）：relaxStiffness = 200 − 110·relaxT。
 */
export function releaseSpring(relaxT: number): {
  dampingRatio: number;
  stiffness: number;
  bezier: string;
  ms: number;
} {
  const stiffness = 200 - 110 * relaxT;
  const dampingRatio = 0.5; // Spring.DampingRatioLowBouncy
  return {
    dampingRatio,
    stiffness,
    bezier: 'cubic-bezier(0.34, 1.2, 0.5, 1)',
    ms: Math.round((4.605 / (dampingRatio * Math.sqrt(Math.max(1, stiffness)))) * 1000),
  };
}

/** GlassCard.kt lines 340-341 — `relaxT = ((heldMs - 300L) / 600f).coerceIn(0f,1f)`. */
export function relaxFactor(heldMs: number): number {
  return Math.max(0, Math.min(1, (heldMs - 300) / 600));
}

/**
 * GlassCard.kt lines 476-513 — the MAX-only press observer.
 * - 落卡即响应；松手后各自动画缓慢收尾 —— 划过卡片也是一次真实的轻按。
 * - 滚动门控：列表开始消费移动事件后立即熄灭全套按压特效（consumedStreak ≥ 3）。
 * - 归一化偏移钳制在 ±1：长按拖出卡外时倾斜/视差不随距离无限放大。
 *
 * Returns pointer handlers for the card element (Compose `pointerInput(Unit)`).
 */
export function pressHandlers(options: {
  onChange: (next: PressState) => void;
}): {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
} {
  let consumedStreak = 0;
  let startMs = 0;
  let seed = 0;

  const local = (
    e: React.PointerEvent<HTMLElement>,
  ): { lx: number; ly: number; nx: number; ny: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;
    const nx = rect.width === 0 ? 0 : lx / rect.width;
    const ny = rect.height === 0 ? 0 : ly / rect.height;
    return { lx, ly, nx: clamp((nx - 0.5) * 2, -1, 1), ny: clamp((ny - 0.5) * 2, -1, 1) };
  };

  return {
    onPointerDown: (e) => {
      consumedStreak = 0;
      startMs = typeof performance !== 'undefined' ? performance.now() : 0;
      seed = newIndentSeed();
      const p = local(e);
      options.onChange({
        handDown: true,
        indentIntensity: 1,
        pressNorm: { x: p.nx, y: p.ny },
        pressPos: { x: p.lx, y: p.ly },
        indentSeed: seed,
        pressStartAt: startMs,
        tiltX: 0,
        tiltY: 0,
      });
    },
    onPointerMove: (e) => {
      const p = local(e);
      // 滚动门控：事件被列表消费即视为滚动接管，3 帧后熄灭全套按压特效
      if (e.defaultPrevented) consumedStreak += 1;
      else consumedStreak = 0;
      if (consumedStreak >= 3) {
        options.onChange({ ...IDLE_PRESS, pressStartAt: startMs });
        return;
      }
      if (!e.currentTarget.matches(':active')) return;
      options.onChange({
        handDown: true,
        indentIntensity: 1,
        pressNorm: { x: p.nx, y: p.ny },
        pressPos: { x: p.lx, y: p.ly },
        indentSeed: seed,
        pressStartAt: startMs,
        tiltX: 0,
        tiltY: 0,
      });
    },
    onPointerUp: () => {
      options.onChange({ ...IDLE_PRESS, pressStartAt: startMs });
    },
    onPointerCancel: () => {
      options.onChange({ ...IDLE_PRESS, pressStartAt: startMs });
    },
    onPointerLeave: () => {
      options.onChange({ ...IDLE_PRESS, pressStartAt: startMs });
    },
  };
}

/**
 * GlassCard.kt lines 332-366 — pressAnim + tiltX/tiltY, driven on rAF so scrolling
 * and continuous press never synchronously re-render the whole page.
 *
 * Time constants mirror the Kotlin springs via their analytic settle times:
 *  - press down   spring(NoBouncy, StiffnessHigh=1500) → τ ≈ 119 ms
 *  - release      spring(LowBouncy, stiffness 200…90)  → τ ≈ 130…193 ms
 *  - tilt         spring(LowBouncy, StiffnessMedium)    → τ ≈ 130 ms
 */
export function usePressTracking(
  enabled: boolean,
  tiltMaxDeg: number,
): {
  press: PressState;
  handlers: ReturnType<typeof pressHandlers>;
} {
  const [press, setPress] = useState<PressState>(IDLE_PRESS);

  // 熄灭开关（`enabled === false`）时整套按压/倾斜立刻归位，等价 Kotlin 的
  // `if (!enabled) { snapTo(IDLE); return }` 分支。原先写在 effect 里同步 setPress，
  // 现改为 React 官方的「渲染期派生 state」：复位在同一次渲染内完成（少一次级联
  // 渲染），effect 体内只剩 rAF 驱动，因此不再是 set-state-in-effect。
  if (!enabled && press !== IDLE_PRESS) setPress(IDLE_PRESS);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let last = typeof performance !== 'undefined' ? performance.now() : 0;
    let alive = true;
    const step = (): void => {
      if (!alive) return;
      const t = typeof performance !== 'undefined' ? performance.now() : 0;
      const dt = Math.max(1, t - last);
      last = t;

      // 逐帧在「最近一次 commit 的 press」上推进（函数式更新）。语义与原先
      // 「ref 镜像 + setPress(next)」完全一致：未过阈值时返回同一引用，React 直接
      // 跳过重渲染；不同之处是渲染期不再读写 ref（React 19 `react-hooks/refs`）。
      setPress((cur) => {
        const relaxT = cur.handDown ? 0 : relaxFactor(t - cur.pressStartAt);
        const outTau =
          cur.handDown
            ? PRESS_IN_SPRING.ms / 3
            : (4.605 / (0.5 * Math.sqrt(200 - 110 * relaxT)) * 1000) / 3;
        const kIn = 1 - Math.exp(-dt / outTau);
        const target = cur.handDown ? 1 : 0;
        let indent = cur.indentIntensity + (target - cur.indentIntensity) * kIn;
        if (!cur.handDown && indent < 0.004) indent = 0;

        const tiltTargetX = cur.handDown ? -cur.pressNorm.y * tiltMaxDeg : 0;
        const tiltTargetY = cur.handDown ? cur.pressNorm.x * tiltMaxDeg : 0;
        const kTilt = 1 - Math.exp(-dt / (4.605 / (0.5 * Math.sqrt(1500)) * 1000 / 3));
        const tiltX = cur.tiltX + (tiltTargetX - cur.tiltX) * kTilt;
        const tiltY = cur.tiltY + (tiltTargetY - cur.tiltY) * kTilt;

        if (
          Math.abs(indent - cur.indentIntensity) <= 0.0005 &&
          Math.abs(tiltX - cur.tiltX) <= 0.005 &&
          Math.abs(tiltY - cur.tiltY) <= 0.005
        ) {
          return cur;
        }
        return { ...cur, indentIntensity: indent, tiltX, tiltY };
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [enabled, tiltMaxDeg]);

  // 指针回调只写 state —— 不再把 ref 交给 `pressHandlers`（React 19 要求 ref 只能在
  // 事件/Effect 中触碰，渲染期把捕获 ref 的函数传进函数即判违规）。`setPress` 引用
  // 恒定，所以 handlers 依旧每次挂载只创建一次，内部计数状态（consumedStreak 等）不丢。
  const handlers = useMemo(() => pressHandlers({ onChange: setPress }), [setPress]);

  return { press, handlers };
}

/* ── visual layer maths ──────────────────────────────────────────────────── */

/** GlassCard.kt lines 300-307 — 极致档专属：按压凝胶弹性缩放（其余档位恒为 1）。 */
export function pressScale(isPressed: boolean, isMax: boolean): number {
  return isMax && isPressed ? 0.97 : 1;
}

/**
 * GlassCard.kt lines 383-388 — v3 深度线索：按压倾斜时环境光阴影随之抬升/增强。
 * 倾角越大（即手指越靠边）卡片"离桌面越高"，投影范围与强度同步增长。
 */
export function pressLiftPx(isMax: boolean, handDown: boolean, tiltMag: number): number {
  return isMax && handDown ? 12 + tiltMag * 1.2 : 12;
}

/** GlassCard.kt lines 391-397 — C2 入场动画（首次组合弹入；非 MAX 恒为 1）。 */
export function entranceCss(
  entered: boolean,
  isMax: boolean,
  cardAlpha: number,
): { opacity: number; transform: string } {
  const e = isMax ? (entered ? 1 : 0) : 1;
  return {
    opacity: e * cardAlpha,
    transform: `translateY(${((1 - e) * 12).toFixed(3)}px) scale(${(0.96 + 0.04 * e).toFixed(4)})`,
  };
}

/** GlassCard.kt lines 547-553 — MAX 档 auroraSecondary: secondary 与 tertiary 混合 45%。 */
export function auroraSecondary(secondary: string, tertiary: string): string {
  const a = parseHex(secondary);
  const b = parseHex(tertiary);
  if (a === null || b === null) return secondary;
  const k = 0.45;
  const to = (x: number, y: number): string =>
    Math.round(Math.max(0, Math.min(255, x + (y - x) * k)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${to(a.r, b.r)}${to(a.g, b.g)}${to(a.b, b.b)}`;
}

/**
 * GlassCard.kt lines 516-543 — the shadow branches.
 * LOW: 单层轻阴影（双层 HWUI 投影是低端机大项）。
 * else: Layer 7A 宽域环境扩散彩色柔光（Atmospheric Bloom）+
 *       Layer 7B 近距离接触暗部阴影（Ambient Occlusion）。
 */
export function glassShadowCss(o: {
  qualityId: number;
  isMax: boolean;
  elevationPx: number;
  primary: string;
  tiltMag: number;
}): string {
  if (o.qualityId === 0) {
    return '0 4px 12px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.12)';
  }
  const spotAlpha = o.isMax ? Math.min(0.3, 0.2 + (0.1 * o.tiltMag) / 12) : 0.14;
  const ambientAlpha = o.isMax ? 0.16 : 0.1;
  const e = o.elevationPx.toFixed(1);
  const spread = (o.elevationPx * 2).toFixed(1);
  return (
    `0 ${e}px ${spread}px ${withAlpha(o.primary, ambientAlpha)}, ` +
    `0 ${e}px ${spread}px ${withAlpha(o.primary, spotAlpha)}, ` +
    '0 4px 8px rgba(0,0,0,0.08), 0 4px 8px rgba(0,0,0,0.15)'
  );
}

/**
 * GlassCard.kt lines 600-673 — 手指按压"材质压痕"（任务书规格版：静态凹陷 ≠ 水波）。
 * ① 范围固定 ② 只有 intensity 在动 ③ HSL 明度下移（≤20%）
 * ④ 渐变为单调凹面衰减，无环形波带。
 */
export function indentCss(o: {
  width: number;
  height: number;
  press: PressState;
  themedTint: string;
  pressStrength: number;
  pressRadius: number;
  tiltMaxDeg: number;
}): string | null {
  if (o.press.indentIntensity <= 0.004 || o.pressStrength <= 0) return null;
  const minDim = Math.min(o.width, o.height);
  if (minDim <= 0) return null;
  const indentIntensity = clamp(o.press.indentIntensity, 0, 1);
  const strengthMult = clamp(o.pressStrength, 0, 2);

  const cx =
    o.press.pressPos.x === 0 ? o.width / 2 : clamp(o.press.pressPos.x, 0, o.width);
  const cy =
    o.press.pressPos.y === 0 ? o.height / 2 : clamp(o.press.pressPos.y, 0, o.height);

  // 静态物理基准半径（整个按压过程保持不变）
  const pressRadiusSafe = clamp(o.pressRadius, 0.25, 2.5);
  const R = Math.min(minDim * 0.52 * pressRadiusSafe, minDim * 0.78);

  // HSL 明度位移 lightnessDelta = −0.12 × intensity × 强度倍率（钳制在 −20% 以内）
  const lightnessDelta = Math.max(-0.2, -0.12 * indentIntensity * strengthMult);
  const peakAlpha = Math.min(0.46, 0.21 * indentIntensity * strengthMult);
  const dent = hslDarken(o.themedTint, lightnessDelta);

  // 光源固定：API 33+ 的 AGSL 路径把暗核偏向光源背侧（略向下）；
  // web 无着色器 → 走 GlassCard.kt 655-668 明确指定的 API<33 回退：
  // 实时倾斜角驱动中心偏移，暗核偏向「沉入侧」。
  const safeTilt = Math.max(0.01, o.tiltMaxDeg);
  const fx = clamp(o.press.tiltY / safeTilt, -1, 1) * 0.1;
  const fy = clamp(-o.press.tiltX / safeTilt, -1, 1) * 0.1;

  return (
    `position:absolute;left:${(cx - R).toFixed(2)}px;top:${(cy - R).toFixed(2)}px;` +
    `width:${(R * 2).toFixed(2)}px;height:${(R * 2).toFixed(2)}px;pointer-events:none;` +
    `background-image:radial-gradient(circle closest-side,` +
    `${withAlpha(dent, peakAlpha)} 0%,` +
    `${withAlpha(dent, peakAlpha * 0.36)} 42%,` +
    `${withAlpha(dent, peakAlpha * 0.12)} 72%,` +
    `${withAlpha(dent, peakAlpha * 0.02)} 92%,` +
    `rgba(0,0,0,0) 100%);` +
    `background-position:${(50 + fx * 100).toFixed(3)}% ${(50 + fy * 100).toFixed(3)}%;`
  );
}

/** GlassCard.kt lines 628-631 — `colorToHSL(tinted) → L += delta → HSLToColor`. */
function hslDarken(hex: string, delta: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s, clamp(l + delta, 0, 1));
}

/**
 * GlassCard.kt lines 675-787 — B1 光学反馈：倾转受光面响应（镜像对称版）。
 * 固定顶光（LIGHT_DIR）+ 跷跷板倾斜 → 沉入屏幕的远缘背离光收暗、
 * 翘向观察者的近缘迎光提亮。按左/按右、按上/按下严格镜像。
 * 幅度由倾角直接驱动（/15f 固定基准）。
 */
export function tiltLightCss(o: {
  width: number;
  height: number;
  tiltX: number;
  tiltY: number;
  isMax: boolean;
}): string | null {
  if (!o.isMax) return null;
  const tDeg = Math.abs(o.tiltX) + Math.abs(o.tiltY);
  if (tDeg <= 0.15) return null;
  const w = o.width;
  const h = o.height;
  const lit = clamp(tDeg / 15, 0, 1);
  const fx = clamp(o.tiltX / 15, -1, 1); // X 轴俯仰（>0 = 顶缘沉入）
  const fy = clamp(o.tiltY / 15, -1, 1); // Y 轴左右（>0 = 右缘沉入）
  const pitchDown = Math.max(fx, 0);
  const pitchUp = Math.max(-fx, 0);
  const rollRight = Math.max(fy, 0);
  const rollLeft = Math.max(-fy, 0);

  const layers: string[] = [];
  // 垂直向：fx>0（顶沉）→ 底亮 + 顶暗；fx<0（底沉）→ 顶亮 + 底暗
  layers.push(
    `linear-gradient(180deg, rgba(255,255,255,0) 55%, ${withAlpha(
      '#FFFFFF',
      Math.min(0.16, 0.18 * lit * pitchDown),
    )} 100%)`,
  );
  layers.push(
    `linear-gradient(180deg, ${withAlpha('#000000', Math.min(0.14, 0.14 * lit * pitchDown))} 0%, rgba(0,0,0,0) 45%)`,
  );
  layers.push(
    `linear-gradient(180deg, ${withAlpha('#FFFFFF', Math.min(0.16, 0.18 * lit * pitchUp))} 0%, rgba(255,255,255,0) 45%)`,
  );
  layers.push(
    `linear-gradient(180deg, rgba(255,255,255,0) 55%, ${withAlpha(
      '#000000',
      Math.min(0.14, 0.14 * lit * pitchUp),
    )} 100%)`,
  );
  // 水平向：fy>0（右沉）→ 左亮 + 右暗；fy<0（左沉）→ 右亮 + 左暗
  layers.push(
    `linear-gradient(90deg, ${withAlpha('#FFFFFF', Math.min(0.14, 0.16 * lit * rollRight))} 0%, rgba(255,255,255,0) 45%)`,
  );
  layers.push(
    `linear-gradient(90deg, rgba(255,255,255,0) 55%, ${withAlpha(
      '#000000',
      Math.min(0.12, 0.12 * lit * rollRight),
    )} 100%)`,
  );
  layers.push(
    `linear-gradient(90deg, rgba(255,255,255,0) 55%, ${withAlpha(
      '#FFFFFF',
      Math.min(0.14, 0.16 * lit * rollLeft),
    )} 100%)`,
  );
  layers.push(
    `linear-gradient(90deg, ${withAlpha('#000000', Math.min(0.12, 0.12 * lit * rollLeft))} 0%, rgba(0,0,0,0) 45%)`,
  );
  void w;
  void h;
  return `background-image:${layers.join(',')};`;
}

/**
 * GlassCard.kt lines 789-808 — B2：顶棱聚光带中心随触点 x 偏移。
 * 静态几何：固定 4dp 高光带，无任何扩散/增长。
 */
export function topRimCss(o: {
  width: number;
  press: PressState;
  isMax: boolean;
}): string | null {
  if (!o.isMax) return null;
  const b2Fade = clamp(o.press.indentIntensity, 0, 1);
  if (b2Fade <= 0.02) return null;
  const bandCx =
    o.press.pressPos.x === 0 ? 0.5 : clamp(o.press.pressPos.x / o.width, 0, 1);
  return (
    `height:4px;pointer-events:none;` +
    `background-image:linear-gradient(90deg, rgba(255,255,255,0) 0%, ${withAlpha(
      '#FFFFFF',
      0.16 * b2Fade,
    )} 50%, rgba(255,255,255,0) 100%);` +
    `background-size:${(o.width * 0.7).toFixed(2)}px 4px;` +
    `background-repeat:no-repeat;` +
    `background-position:${(bandCx * 100).toFixed(2)}% 0;`
  );
}

/**
 * GlassCard.kt lines 810-880 — Layer 2/3/4: 物理光路
 *  2. 对角镜面光束  3. 顶部倒角抛光边缘反光带  4. 底部次表面焦散色散光晕
 * 毛玻璃厚度感知补偿：thick/bevelGain 以出厂默认 22dp 为中性零点双向映射。
 */
export function lightPathCss(o: {
  height: number;
  isPressed: boolean;
  qualityId: number;
  strokeTint: string;
  primary: string;
  secondary: string;
  beamGain: number;
  bevelGain: number;
}): string {
  const h = o.height;
  const { beamGain, bevelGain } = o;
  const isMax = o.qualityId === 3;
  const beamAlpha = (o.isPressed ? 0.3 : isMax ? 0.27 : 0.2) * beamGain;

  // 2. 对角镜面光束
  const beam =
    `linear-gradient(135deg, ${withAlpha(o.strokeTint, beamAlpha)} 0%, ` +
    `${withAlpha(o.strokeTint, 0.06 * beamGain)} 35%, rgba(0,0,0,0) 55%, ` +
    `${withAlpha(o.strokeTint, 0.025 * beamGain)} 75%, rgba(0,0,0,0) 100%)`;
  // 3. 顶部倒角抛光边缘反光带
  const bevel =
    `linear-gradient(90deg, ${withAlpha(o.strokeTint, 0.06 * bevelGain)} 0%, ` +
    `${withAlpha(o.strokeTint, 0.45 * bevelGain)} 25%, ` +
    `${withAlpha(o.strokeTint, 0.68 * bevelGain)} 50%, ` +
    `${withAlpha(o.strokeTint, 0.45 * bevelGain)} 75%, ` +
    `${withAlpha(o.strokeTint, 0.06 * bevelGain)} 100%)`;
  // 4. 底部次表面焦散色散光晕（Sub-surface Caustic Pool）
  const caustic =
    `linear-gradient(180deg, rgba(0,0,0,0) 55%, ` +
    `${withAlpha(o.primary, 0.035)} 80%, ${withAlpha(o.secondary, 0.065)} 100%)`;
  void h;
  return (
    `background-image:${bevel},${beam},${caustic};` +
    `background-size:100% 2.5px,100% 100%,100% 100%;` +
    `background-repeat:no-repeat;`
  );
}

/**
 * GlassCard.kt lines 889-961 — Layer 6 + 内倒角：水晶棱镜色散边框 + 物理倒角内凹高光边。
 * 流畅档降级为单色细描边（省掉 sweep 渐变与双层描边录制）。
 */
export function prismBorderCss(o: {
  radius: number;
  isPressed: boolean;
  qualityId: number;
  strokeTint: string;
  prismColors: readonly string[];
}): string {
  if (o.qualityId === 0) {
    return `border:1px solid ${withAlpha(o.strokeTint, 0.28)};border-radius:${o.radius}px;`;
  }
  const borderAlpha = Math.min(
    0.8,
    (o.isPressed ? 0.55 : 0.4) * (o.qualityId === 3 ? 1.35 : 1),
  );
  const stops = o.prismColors
    .map((c, i, arr) => `${withAlpha(c, borderAlpha)} ${((i / Math.max(1, arr.length - 1)) * 100).toFixed(2)}%`)
    .join(',');
  return (
    `border:1.3px solid transparent;border-radius:${o.radius}px;` +
    `background-image:conic-gradient(from 0deg,${stops});` +
    `-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);` +
    `mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);` +
    `-webkit-mask-composite:xor;mask-composite:exclude;padding:1.3px;`
  );
}

/** GlassCard.kt lines 932-954 — 物理倒角内凹高光边（白 × 主题色混合）。 */
export function bevelCss(o: { radius: number; strokeTint: string }): string {
  return (
    `border:1px solid transparent;border-radius:${o.radius}px;` +
    `background-image:linear-gradient(135deg, ${withAlpha(o.strokeTint, 0.35)} 0%, ` +
    `${withAlpha(o.strokeTint, 0.12)} 32%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.08) 100%);` +
    `-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);` +
    `mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);` +
    `-webkit-mask-composite:xor;mask-composite:exclude;padding:1px;`
  );
}

/**
 * GlassCard.kt lines 977-994 — C1 内容视差：卡内内容像悬浮在玻璃下的字膜 ——
 * 跟随触点向内沉降，并以更近的相机反向轻旋，与外层倾斜构成双层视差景深。
 */
export function contentParallaxCss(o: {
  press: PressState;
  tiltX: number;
  tiltY: number;
  isMax: boolean;
  cameraDistance: number;
}): string {
  if (!o.isMax) return 'transform:none;';
  const k = clamp(o.press.indentIntensity, 0, 1); // 低弹过冲为负时防止视差反向
  const tx = o.press.pressNorm.x * 3 * k;
  const ty = o.press.pressNorm.y * 3 * k;
  const rx = -o.tiltX * 0.22;
  const ry = -o.tiltY * 0.22;
  return (
    `transform:perspective(${Math.max(1, o.cameraDistance * 0.5).toFixed(1)}px) ` +
    `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) ` +
    `rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg);`
  );
}

/**
 * GlassCard.kt lines 416-437 — the outer 3D tilt layer: press tilt + scroll inertia,
 * summed then clamped (按压上限 + 滚动上限); press wins when the finger is down.
 */
export function outerTransformCss(o: {
  press: PressState;
  scrollTiltDeg: number;
  tiltMaxDeg: number;
  scrollTiltMaxDeg: number;
  pressScale: number;
  entrance: number;
  cameraDistance: number;
  isMax: boolean;
}): string {
  if (!o.isMax) {
    return `transform:scale(${(o.pressScale * (0.96 + 0.04 * o.entrance)).toFixed(4)});`;
  }
  const scrollTiltDeg = o.press.handDown ? 0 : o.scrollTiltDeg;
  const maxTotal = o.tiltMaxDeg + o.scrollTiltMaxDeg;
  const rotX = clamp(o.press.tiltX + scrollTiltDeg, -maxTotal, maxTotal);
  const rotY = clamp(o.press.tiltY, -maxTotal, maxTotal);
  const s = o.pressScale * (0.96 + 0.04 * o.entrance);
  return (
    `perspective(${Math.max(1, o.cameraDistance).toFixed(1)}px) ` +
    `scale(${s.toFixed(4)}) rotateX(${rotX.toFixed(3)}deg) rotateY(${rotY.toFixed(3)}deg);`
  );
}

/** GlassCard.kt lines 436-437 — 相机距离与卡体尺寸绑定（设备无关的物理光学基准）。 */
export function cameraDistancePx(shortSide: number, cameraDistMult: number): number {
  return shortSide * (0.42 + 3.8 * clamp((cameraDistMult - 3) / 9, 0, 1));
}

/**
 * GlassCard.kt lines 560-588 — Layer 1: 真实背景采样模糊（高/极致）｜半透明基底（流畅/均衡）。
 */
export function glassSurfaceCss(o: {
  qualityId: number;
  themedTint: string;
  blurRadiusDp: number;
  hasBackdrop: boolean;
}): Record<string, string> {
  if (o.qualityId <= 1) {
    return {
      background: withAlpha(o.themedTint, o.qualityId === 0 ? 0.92 : 0.78),
    };
  }
  if (!o.hasBackdrop) return { background: o.themedTint };
  // 极致档开启折射透镜：参数已驯化（10/18dp），并提高色彩饱和（1.45 vs 1.30）
  const filter =
    o.qualityId === 3
      ? `brightness(1.04) contrast(1.02) saturate(1.45) blur(${o.blurRadiusDp}px)`
      : `brightness(1.04) contrast(1.02) saturate(1.30) blur(${o.blurRadiusDp}px)`;
  return {
    WebkitBackdropFilter: filter,
    backdropFilter: filter,
    background: withAlpha(o.themedTint, 0.7),
  };
}

/** GlassCard.kt line 284 — `lerp(Color.White, primary, 0.38f)`. */
export { rescaleCornerRadius, strokeTintOf };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}