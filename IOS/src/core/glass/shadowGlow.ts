/**
 * ShadowGlow —— `me/trishiraj/shadowglow/ShadowGlow.kt` L40-395 的 CSS 版。
 *
 * Kotlin 侧是 `Modifier` 扩展，最终落到 Canvas 的 `drawBehind`：两层（ambient / spot）
 * 确定性 CPU 模糊。Web 端 `box-shadow` 就是同一件事的合成层实现，所以本文件输出
 * **CSS 值**，由调用方塞进 `style.boxShadow`（`WenkuGlass.tsx` / `GlassCardLayers.tsx` 已在用）。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L216 `SHADOW_AMBIENT_BLUR_FACTOR = 0.22f`  → `SHADOW_AMBIENT_BLUR_FACTOR`
 *   L219 `SHADOW_SPOT_BLUR_FACTOR = 0.22f`     → `SHADOW_SPOT_BLUR_FACTOR`
 *   L222 `SHADOW_SPOT_OFFSET_FACTOR = 0.28f`   → `SHADOW_SPOT_OFFSET_FACTOR`
 *   L229/L230 `ALPHA_GAIN = 0.10f`             → `SHADOW_AMBIENT_ALPHA_GAIN` / `SHADOW_SPOT_ALPHA_GAIN`
 *   L233 `BLUR_RADIUS_TO_SIGMA = 0.577f`       → `BLUR_RADIUS_TO_SIGMA`
 *   L236-237 `blurRadiusToSigma(r) = (r*.577).coerceAtLeast(0)` → `blurRadiusToSigma`
 *   L256-309 `consistentShadow(elevation: () -> Dp, …)` → `consistentShadowLayers(...)` 返回两层 CSS
 *   L311-395 `consistentShadow(elevation: Dp, …)` → `consistentShadow(...)`（同上一层的薄封装）
 *   L40-87  `Modifier.shadowGlow(color, blurRadius, …, glowTrail*)` → `shadowGlow(...)`
 *   L96-149 `Modifier.shadowGlow(gradientColors, …)` → `shadowGlowGradient(...)`
 *   L151-185 `cachedShadowGlow(…)` → `cachedShadowGlow(...)`
 *
 * 平台差异（已登记 E118）
 * ─────────────────────
 *  * Kotlin 在绘制期用 `drawImage` 贴预烘焙掩码；CSS 由合成器做高斯模糊，视觉等价。
 *  * `consistentShadow` 的 `.graphicsLayer { clip = elevation > 0.dp }` 在 Web 侧对应
 *    `overflow: hidden` + `border-radius`，由调用方给（`WenkuGlass` 的 `.wenku-glass` 已带）。
 */

/** L216 `SHADOW_AMBIENT_BLUR_FACTOR`（σ / elevation）。 */
export const SHADOW_AMBIENT_BLUR_FACTOR = 0.22;
/** L219 `SHADOW_SPOT_BLUR_FACTOR`（σ / elevation）。 */
export const SHADOW_SPOT_BLUR_FACTOR = 0.22;
/** L222 `SHADOW_SPOT_OFFSET_FACTOR`（× elevation，向下为正）。 */
export const SHADOW_SPOT_OFFSET_FACTOR = 0.28;
/** L229 `SHADOW_AMBIENT_ALPHA_GAIN`。 */
export const SHADOW_AMBIENT_ALPHA_GAIN = 0.1;
/** L230 `SHADOW_SPOT_ALPHA_GAIN`。 */
export const SHADOW_SPOT_ALPHA_GAIN = 0.1;
/** L233 `BLUR_RADIUS_TO_SIGMA = 0.577f`（Skia: σ ≈ 0.577·r + 0.5，忽略常数项）。 */
export const BLUR_RADIUS_TO_SIGMA = 0.577;

/** L236-237 `blurRadiusToSigma(radiusPx)`。 */
export function blurRadiusToSigma(radiusPx: number): number {
  return Math.max(radiusPx * BLUR_RADIUS_TO_SIGMA, 0);
}

export interface ConsistentShadowOptions {
  /** Kotlin `elevation: Dp`（px 由调用方换算）。 */
  readonly elevationPx: number;
  /** Kotlin `ambientColor`；`rgba` 三元组 + alpha。 */
  readonly ambientRgb?: readonly [number, number, number];
  readonly ambientAlpha?: number;
  readonly spotRgb?: readonly [number, number, number];
  readonly spotAlpha?: number;
  /** Kotlin `offsetY: Dp`（px）。 */
  readonly offsetYPx?: number;
  /** Kotlin `alpha: Float = 1f` —— 整体倍率（按压态调淡用）。 */
  readonly alpha?: number;
}

/** 一层阴影的解析结果（`ResolvedBlurredShadow` 的 CSS 形态）。 */
export interface ShadowLayer {
  readonly color: string;
  readonly offsetXPx: number;
  readonly offsetYPx: number;
  /** CSS 的 blur 长度：高斯 σ → 视觉半径取 2σ（2 × 0.577 ≈ 1.154 × r）。 */
  readonly blurPx: number;
}

function rgba(rgb: readonly [number, number, number], alpha: number): string {
  return `rgba(${String(rgb[0])}, ${String(rgb[1])}, ${String(rgb[2])}, ${String(Number(alpha.toFixed(4)))})`;
}

/**
 * L311-395 `consistentShadow(elevation: Dp, shape, ambientColor, spotColor, offsetY, alpha)`。
 * 返回 ambient + spot 两层；用 `constantShadowCss()` 拼成 `box-shadow` 值。
 */
export function consistentShadowLayers(options: ConsistentShadowOptions): readonly ShadowLayer[] {
  const totalAlpha = Math.min(Math.max(options.alpha ?? 1, 0), 1);
  const ambientAlpha = (options.ambientAlpha ?? 0.08) * SHADOW_AMBIENT_ALPHA_GAIN * totalAlpha;
  const spotAlpha = (options.spotAlpha ?? 0.15) * SHADOW_SPOT_ALPHA_GAIN * totalAlpha;
  const baseOffsetY = options.offsetYPx ?? 0;
  const e = options.elevationPx;
  const out: ShadowLayer[] = [];
  if (e > 0 && ambientAlpha > 0.002) {
    out.push({
      color: rgba(options.ambientRgb ?? [0, 0, 0], ambientAlpha),
      offsetXPx: 0,
      offsetYPx: baseOffsetY,
      blurPx: 2 * blurRadiusToSigma(e * SHADOW_AMBIENT_BLUR_FACTOR),
    });
  }
  if (e > 0 && spotAlpha > 0.002) {
    out.push({
      color: rgba(options.spotRgb ?? [0, 0, 0], spotAlpha),
      offsetXPx: 0,
      offsetYPx: baseOffsetY + e * SHADOW_SPOT_OFFSET_FACTOR,
      blurPx: 2 * blurRadiusToSigma(e * SHADOW_SPOT_BLUR_FACTOR),
    });
  }
  return out;
}

/** 两层 → `box-shadow` 值；空数组返回 `none`（Kotlin `elevation <= 0.dp` 的早退分支）。 */
export function constantShadowCss(layers: readonly ShadowLayer[]): string {
  if (layers.length === 0) return 'none';
  return layers
    .map(
      (l) =>
        `${String(Number(l.offsetXPx.toFixed(2)))}px ${String(Number(l.offsetYPx.toFixed(2)))}px ${String(
          Number(l.blurPx.toFixed(2)),
        )}px ${l.color}`,
    )
    .join(', ');
}

/**
 * L311 `consistentShadow(elevation: Dp, …)` 的便捷形态：直接出 `box-shadow` 字符串。
 * Kotlin 的裁剪语义（L394 `.clip(shape)`）由调用方的 `overflow: hidden` + 圆角承担。
 */
export function consistentShadow(options: ConsistentShadowOptions): string {
  if (options.elevationPx <= 0) return 'none';
  return constantShadowCss(consistentShadowLayers(options));
}

export interface ShadowGlowOptions {
  /** L41 `color = Color.Black.copy(alpha = 0.4f)`。 */
  readonly rgb?: readonly [number, number, number];
  readonly alpha?: number;
  /** L42 `borderRadius`。 */
  readonly borderRadiusPx?: number;
  /** L43 `blurRadius = 8.dp`。 */
  readonly blurRadiusPx?: number;
  /** L44/L45 `offsetX = 0.dp` / `offsetY = 4.dp`。 */
  readonly offsetXPx?: number;
  readonly offsetYPx?: number;
  /** L46 `spread = 0.dp`。 */
  readonly spreadPx?: number;
  /** L73-77 呼吸动画的当前值（px，Kotlin `breathing.value`）。 */
  readonly breathingPx?: number;
  /** L181-182 陀螺仪视差（px）。 */
  readonly parallaxXPx?: number;
  readonly parallaxYPx?: number;
}

/**
 * L151-185 `cachedShadowGlow(color, alpha, empty, borderRadius, blurRadius, offsetX, offsetY,
 * spread, parallax, breathing, …)`：把呼吸量与视差迭进总模糊半径，再出 CSS。
 */
export function cachedShadowGlow(options: ShadowGlowOptions): string {
  const alpha = options.alpha ?? 0.4;
  if (alpha === 0) return 'none';
  const rgb = options.rgb ?? [0, 0, 0];
  const totalBlur = Math.max((options.blurRadiusPx ?? 8) + (options.breathingPx ?? 0), 0);
  const color = rgba(rgb, alpha);
  const x = (options.offsetXPx ?? 0) + (options.parallaxXPx ?? 0);
  const y = (options.offsetYPx ?? 4) + (options.parallaxYPx ?? 0);
  const spread = options.spreadPx ?? 0;
  // Kotlin 用 `blurRadiusToSigma` 把「半径」换成 σ 再走盒式模糊；
  // CSS 的 blur 长度同样按「视觉半径」计，直接取 2σ = 1.154·r 保持同一扩散量。
  const blur = 2 * blurRadiusToSigma(totalBlur);
  return `${String(Number(x.toFixed(2)))}px ${String(Number(y.toFixed(2)))}px ${String(
    Number(blur.toFixed(2)),
  )}px ${String(Number(spread.toFixed(2)))}px ${color}`;
}

/**
 * L40-87 `Modifier.shadowGlow(color, …)`。光尾（glow trail）在 Web 侧另由
 * `GlowTrailDrawCache`（`src/ui/components/feedback/glowDrawCache.ts`）画在 canvas 上，
 * 本函数只负责阴影本体。
 */
export function shadowGlow(options: ShadowGlowOptions = {}): string {
  return cachedShadowGlow(options);
}

/**
 * L96-149 `Modifier.shadowGlow(gradientColors, …)`。
 *
 * Kotlin 注释（L92-95）已说明：CPU 模糊掩码是单色 tint，无法承载线性渐变，
 * 该重载**无任何调用点**，因此以渐变首色渲染。这里照抄同一决策。
 */
export function shadowGlowGradient(
  gradientColors: readonly (readonly [number, number, number])[],
  options: ShadowGlowOptions = {},
): string {
  const first = gradientColors[0];
  if (first === undefined) return cachedShadowGlow({ ...options, alpha: 0 });
  return cachedShadowGlow({ ...options, rgb: first });
}
