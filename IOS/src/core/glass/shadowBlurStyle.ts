/**
 * `ShadowBlurStyle` —— `me/trishiraj/shadowglow/ShadowBlurStyle.kt` L8-20 的 TS 版。
 *
 * Kotlin 是 `enum class { NORMAL, SOLID, OUTER, INNER }` + `toAndroidBlurStyle()` 映射到
 * `android.graphics.BlurMaskFilter.Blur`。Web 端没有 `MaskFilter`，等价物是
 * Canvas2D 的 `filter = 'blur(Npx)'` 与合成顺序：
 *
 *   NORMAL → 先模糊再盖原形（`ctx.filter = blur` 后画整个形状）
 *   SOLID  → 只盖原形，模糊层用实心（`spread` 撑大后不模糊）
 *   OUTER  → 只画模糊层、形状内部挖空（`globalCompositeOperation = 'destination-out'`）
 *   INNER  → 模糊层裁进形状内部（`clip()` 后画模糊）
 *
 * 顺序与枚举序数照抄（序数进 `ShadowBlurStyle.NORMAL === 0` 这类断言）。
 */
export const ShadowBlurStyle = ['NORMAL', 'SOLID', 'OUTER', 'INNER'] as const;

export type ShadowBlurStyle = (typeof ShadowBlurStyle)[number];

/** 枚举序数（Kotlin `enum class` 声明顺序，用于跨语言断言）。 */
export const SHADOW_BLUR_STYLE_ORDINAL: Record<ShadowBlurStyle, number> = {
  NORMAL: 0,
  SOLID: 1,
  OUTER: 2,
  INNER: 3,
};

/** Canvas2D 侧的模糊策略（`toAndroidBlurStyle` 的 Web 等价物）。 */
export interface ShadowBlurPlan {
  /** 是否给 `ctx.filter` 设 blur。 */
  readonly blur: boolean;
  /** 是否在模糊层之后重画实心形状。 */
  readonly solidOverlay: boolean;
  /** 是否把结果挖到形状外（`destination-out`）。 */
  readonly clipOuter: boolean;
  /** 是否把结果裁进形状内。 */
  readonly clipInner: boolean;
}

/** L13-19 `toAndroidBlurStyle()` 的同构映射。 */
export function toAndroidBlurStyle(style: ShadowBlurStyle): ShadowBlurPlan {
  switch (style) {
    case 'NORMAL':
      return { blur: true, solidOverlay: true, clipOuter: false, clipInner: false };
    case 'SOLID':
      return { blur: false, solidOverlay: true, clipOuter: false, clipInner: false };
    case 'OUTER':
      return { blur: true, solidOverlay: false, clipOuter: true, clipInner: false };
    case 'INNER':
      return { blur: true, solidOverlay: false, clipOuter: false, clipInner: true };
  }
}
