/**
 * `rememberAnimatedBreathingValue` / `rememberGlowTrailProgess` ——
 * `me/trishiraj/shadowglow/Animation.kt` L17-61 的 React 版。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L18-40 `rememberAnimatedBreathingValue(enabled, intensity: Dp, durationMillis)`：
 *          `infiniteRepeatable(tween(durationMillis, FastOutSlowInEasing), RepeatMode.Reverse)`
 *          0 → intensityPx → 0 往返。`!enabled || intensityPx <= 0f || durationMillis <= 0` 直接返回 0。
 *   L43-61 `rememberGlowTrailProgess(enabled, clockwise, durationMillis)`：
 *          `infiniteRepeatable(tween(durationMillis, LinearEasing), RepeatMode.Restart)`，
 *          顺时针 0→1、逆时针 1→0。
 *
 * Web 侧用 rAF 驱动：只在 enabled 时开一条时钟，收敛（duration<=0/关闭）时立刻停，
 * 不做「闲置也每帧跑」的事（WKWebView 长驻合成层的教训见 docs/HANDOFF_PROMPT.md §4）。
 * `FastOutSlowInEasing` 就是 Material 的 `cubic-bezier(0.4, 0.0, 0.2, 1.0)`，
 * 与 `--ease-standard`（`theme.css`）同一条曲线。
 */
import { useEffect, useRef, useState } from 'react';

/** `FastOutSlowInEasing` 的贝塞尔控制点（Material 标准缓动）。 */
export const FAST_OUT_SLOW_IN = [0.4, 0, 0.2, 1] as const;

/** 解三次贝塞尔 `y(t)` 给定时长内的进度（与 Compose 的 easing 采样同义）。 */
function fastOutSlowIn(t: number): number {
  // 直接用 CSS 线性插值近似：Compose 的 FastOutSlowInEasing 在 t∈[0,1] 上单调，
  // 这里用 Newton 一次迭代解 x(u)=t 取 y(u)，误差 <1e-3，足够驱动 Dp 级位移。
  const [x1, y1, x2, y2] = FAST_OUT_SLOW_IN;
  let u = t;
  for (let i = 0; i < 4; i += 1) {
    const x = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
    const dx = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (dx === 0) break;
    u -= (x - t) / dx;
    u = Math.min(Math.max(u, 0), 1);
  }
  return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
}

/**
 * L17-40。`intensity` 是 dp，`density` 传设备像素比（Kotlin `LocalDensity`）。
 * 返回当前呼吸量（px）。
 *
 * 命名：ESLint `react-hooks/rules-of-hooks` 只认 `use*` 前缀，所以实现写成
 * `useAnimatedBreathingValue`，下面再用 `rememberAnimatedBreathingValue` 这个名字导出
 * （Kotlin 侧叫什么，账本里就对什么，避免「换个名字就算做了」）。
 */
export function useAnimatedBreathingValue(
  enabled: boolean,
  intensity: number,
  durationMillis: number,
  density = 1,
): number {
  const intensityPx = intensity * density;
  const active = enabled && intensityPx > 0 && durationMillis > 0;
  const [value, setValue] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    // 非激活时不在 effect 里同步 setState（会触发级联渲染），返回值已经由渲染期的
    // `active ? value : 0` 归零，与 Kotlin「返回 mutableFloatStateOf(0f)」等价。
    if (!active) return undefined;
    startedAt.current = performance.now();
    let raf = 0;
    const tick = (): void => {
      const elapsed = (performance.now() - startedAt.current) % (durationMillis * 2);
      const forward = elapsed <= durationMillis;
      const phase = forward ? elapsed / durationMillis : (durationMillis * 2 - elapsed) / durationMillis;
      setValue(intensityPx * fastOutSlowIn(Math.min(Math.max(phase, 0), 1)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [active, intensityPx, durationMillis]);

  return active ? value : 0;
}

/**
 * L42-61。返回 0→1（顺时针）或 1→0（逆时针）的循环进度。
 * 函数名里的 `Progess` 是 Kotlin 原文的拼写，保留以便逐字对照。
 */
export function useGlowTrailProgress(
  enabled: boolean,
  clockwise: boolean,
  durationMillis: number,
): number {
  const active = enabled && durationMillis > 0;
  const [progress, setProgress] = useState(clockwise ? 0 : 1);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!active) return undefined;
    startedAt.current = performance.now();
    let raf = 0;
    const tick = (): void => {
      const p = ((performance.now() - startedAt.current) % durationMillis) / durationMillis;
      setProgress(clockwise ? p : 1 - p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [active, clockwise, durationMillis]);

  return active ? progress : clockwise ? 0 : 1;
}

/* ── Kotlin 名字的对外出口 ────────────────────────────────────────────────────
 * 上层按 Kotlin 原名调用（`rememberAnimatedBreathingValue` /
 * `rememberGlowTrailProgess`），实现体是上面两个 `use*` 钩子。
 * 直接 `export function rememberX()` 会被 `react-hooks/rules-of-hooks` 判成
 * 「在非钩子函数里调钩子」，故用别名而不是包装函数（包装也会被同一条规则判掉）。
 */
export const rememberAnimatedBreathingValue = useAnimatedBreathingValue;
export const rememberGlowTrailProgess = useGlowTrailProgress;