/**
 * 神回评分条的几何 —— `god/GodStarRating.kt` L51-283 的移植。
 *
 * 三块：
 *   · `GOD_RATING_MIN/MAX/STEP` + `Float.coerceRating()`（L51-58）——
 *     0.5 步长、范围 0.5~5.0，**不允许 0 分**（打了神回却零分自相矛盾）；
 *   · `starPath(radius, center)`（L270-283）—— 五角星：外半径 R、内半径 `0.46R`、
 *     10 个顶点、起始角 `-π/2`（尖朝上）、步进 `π/5`；
 *   · `GodSparks(key, color)`（L242-268）—— 6 颗小金粒，`520ms`，距离 `0.55w·p`、
 *     透明度 `(1-p)·0.9`、半径 `0.055w·(1-0.5p)`。
 *
 * 评分本身的钳制已在 `@core/god/godTypes` 的 `clampGodRating()`（本文件只重导出语义），
 * 但**星星路径与小金粒的几何**此前 iOS 侧完全没有 —— 榜单/卡片画不出同一颗星。
 *
 * `PARITY_EXCEPTIONS.md` **E150** 登记了本文件：Compose `Path` → SVG `d`；
 * `Canvas.drawCircle` → 绝对定位的 `<circle>` / `border-radius` 小点；
 * `animate(0f, 1f, tween(520))` → CSS/WAAPI（时长逐值保留）。
 */

import { GOD_RATING_MAX, GOD_RATING_MIN, GOD_RATING_STEP } from './godTypes';

export { GOD_RATING_MAX, GOD_RATING_MIN, GOD_RATING_STEP };

/** Kotlin `L52-54` 三个常量（已在 godTypes 端口，这里再导出便于对拍）。 */
export const GOD_RATING = {
  min: GOD_RATING_MIN,
  max: GOD_RATING_MAX,
  step: GOD_RATING_STEP,
} as const;

/**
 * Kotlin `L56-58`：
 * `((this / STEP).roundToInt() * STEP).coerceIn(MIN, MAX)`
 *
 * 注意 `roundToInt` 是**四舍五入**（`.5` 向上），不是截断 —— 2.25 会落到 2.5、2.24 落到 2.0。
 */
export function coerceRating(value: number): number {
  const stepped = Math.round(value / GOD_RATING_STEP) * GOD_RATING_STEP;
  return Math.min(Math.max(stepped, GOD_RATING_MIN), GOD_RATING_MAX);
}

/** 五角星的 10 个顶点（`x, y` 交替展开，便于直接拼 SVG `d`）。 */
export interface StarPoint {
  readonly x: number;
  readonly y: number;
}

/** Kotlin `L272` 的内半径比例。 */
export const STAR_INNER_RADIUS_RATIO = 0.46;

/** Kotlin `L274` 的顶点数（5 个尖 + 5 个凹）。 */
export const STAR_POINT_COUNT = 10;

/**
 * Kotlin `L270-283` `starPath(radius, center)`：
 *
 * ```kotlin
 * val inner = radius * 0.46f
 * for (i in 0 until 10) {
 *     val r = if (i % 2 == 0) radius else inner
 *     val angle = (-PI / 2) + i * (PI / 5)
 *     ...
 * }
 * ```
 *
 * 第 0 个点（i=0）在正上方（`-π/2`），因此**尖朝上**；偶数下标在外圈、奇数在内圈。
 */
export function starPathPoints(radius: number, center: StarPoint): readonly StarPoint[] {
  const inner = radius * STAR_INNER_RADIUS_RATIO;
  const points: StarPoint[] = [];
  for (let i = 0; i < STAR_POINT_COUNT; i += 1) {
    const r = i % 2 === 0 ? radius : inner;
    const angle = -Math.PI / 2 + i * (Math.PI / 5);
    points.push({
      x: center.x + Math.cos(angle) * r,
      y: center.y + Math.sin(angle) * r,
    });
  }
  return points;
}

/** 把 `starPathPoints()` 的结果拼成 SVG `d`（闭合路径）。 */
export function starPathD(radius: number, center: StarPoint): string {
  const points = starPathPoints(radius, center);
  const head = points[0];
  if (head === undefined) return '';
  const fmt = (v: number): string => String(Number(v.toFixed(3)));
  const rest = points
    .slice(1)
    .map((p) => `L${fmt(p.x)} ${fmt(p.y)}`)
    .join(' ');
  return `M${fmt(head.x)} ${fmt(head.y)} ${rest} Z`;
}

/** 一颗粒子小金点的某一帧。 */
export interface GodSparkParticle {
  readonly index: number;
  /** Kotlin `L258` \`angle = (-π/2) + i·(2π/6)\` —— 第一颗在正上方。 */
  readonly angle: number;
  /** 相对中心的位移（px）。 */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Kotlin `L260` \`alpha = (1-p).coerceIn(0,1) * 0.9\`。 */
  readonly alpha: number;
  /** Kotlin `L263` \`r = w·0.055·(1 - p·0.5)\`。 */
  readonly radius: number;
}

/** Kotlin `L257` 的粒子数。 */
export const GOD_SPARK_COUNT = 6;

/** Kotlin `L250` \`tween(520)\`。 */
export const GOD_SPARK_MS = 520;

/** Kotlin `L259` \`dist = w·0.55·p\`。 */
export const GOD_SPARK_DISTANCE_RATIO = 0.55;

/** Kotlin `L260` 的透明度上限（不是 1，而是 0.9）。 */
export const GOD_SPARK_ALPHA_MAX = 0.9;

/** Kotlin `L263` \`radius = w·0.055·(1 - p·0.5)\`。 */
export const GOD_SPARK_RADIUS_RATIO = 0.055;

/** Kotlin `L263` 的收缩系数。 */
export const GOD_SPARK_RADIUS_DECAY = 0.5;

/**
 * Kotlin `L242-268` `GodSparks(key, color)` 的一帧几何。
 *
 * `progress` 钳到 `[0,1]`；Kotlin 在 `progress <= 0 || >= 1` 时**整帧不画**（L254），
 * 所以这里返回空数组，调用方据此跳过渲染。
 */
export function godSparkParticles(progress: number, width: number): readonly GodSparkParticle[] {
  const p = Math.min(Math.max(progress, 0), 1);
  if (p <= 0 || p >= 1) return [];
  const distance = width * GOD_SPARK_DISTANCE_RATIO * p;
  const alpha = Math.min(Math.max(1 - p, 0), 1) * GOD_SPARK_ALPHA_MAX;
  const radius = width * GOD_SPARK_RADIUS_RATIO * (1 - p * GOD_SPARK_RADIUS_DECAY);
  const out: GodSparkParticle[] = [];
  for (let i = 0; i < GOD_SPARK_COUNT; i += 1) {
    const angle = -Math.PI / 2 + i * ((2 * Math.PI) / GOD_SPARK_COUNT);
    out.push({
      index: i,
      angle,
      offsetX: Math.cos(angle) * distance,
      offsetY: Math.sin(angle) * distance,
      alpha,
      radius,
    });
  }
  return out;
}
