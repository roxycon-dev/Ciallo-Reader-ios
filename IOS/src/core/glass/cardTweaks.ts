/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/CardTweaks.kt` (42 non-blank lines)
 *   `data class CardTweaks(...)` (lines 13-28) → `CardTweaks` + `DEFAULT_CARD_TWEAKS`
 *   `val LocalCardTweaks = staticCompositionLocalOf { CardTweaks() }` (line 31)
 *   → React context in `src/ui/components/CardTweaks.tsx`
 *
 * SKIPPED (data layer owned by the settings agent, documented in report):
 * - lines 34-44 `PreferencesManager.readCardTweaks()`
 * - lines 47-57 `PreferencesManager.writeCardTweaks(t)`
 *   These are extension functions on `com.example.data.PreferencesManager`
 *   (app persistence). They are pure *field copies*; the TS side reads the same
 *   9 keys through the settings store, so no ported code is lost.
 */

export interface CardTweaks {
  /** 毛玻璃模糊强度 */
  blurRadiusDp: number;
  /** 卡片圆角 */
  cornerRadiusDp: number;
  /** 3D 倾斜最大角度 */
  tiltMaxDeg: number;
  /** 相机距离倍率（越小透视越强） */
  cameraDistMult: number;
  /**
   * ⚠️ 已停用：触点涟漪扩散层已按「按压不得出现任何扩大圆环」的验收标准整体移除，
   * GlassCard 不再消费此值。字段保留仅为兼容既有持久化数据，请勿在新代码中引用。
   */
  rippleAlpha: number;
  /** 主题色调叠加比例 */
  tintMix: number;
  /** 压力形变光效强度 */
  pressStrength: number;
  /** 压力形变光效半径倍率 */
  pressRadius: number;
  /** 卡片本体透明度 */
  cardAlpha: number;
}

/**
 * v2 默认档：为让滑条开箱即有强可感知反馈，出厂值整体上探一档
 * （tilt 6° / 相机 5× / 压力 125%）；配合旧安装的一次性迁移。
 */
export const DEFAULT_CARD_TWEAKS: CardTweaks = {
  blurRadiusDp: 22,
  cornerRadiusDp: 16,
  tiltMaxDeg: 6,
  cameraDistMult: 5,
  rippleAlpha: 0.42,
  tintMix: 0.08,
  pressStrength: 1.25,
  pressRadius: 1.1,
  cardAlpha: 1,
};

/**
 * Kotlin `val LocalCardTweaks = staticCompositionLocalOf { CardTweaks() }` (line 31)
 * — 默认实例：未 provide 时 GlassCard 回退到历史视觉。
 */
export const FALLBACK_CARD_TWEAKS: CardTweaks = { ...DEFAULT_CARD_TWEAKS };

/**
 * `GlassCard.kt` lines 202-214 `rescaleCorners(shape, cornerRadiusDp)` —
 * 「卡片圆角」滑条语义 = 全局圆角缩放：默认锚点 16dp。
 * The Kotlin version returns a `Shape`; here it returns the numeric radius that
 * feeds the CSS `border-radius`, which is all the web renderer needs.
 */
export function rescaleCornerRadius(explicitRadiusDp: number | null, cornerRadiusDp: number): number {
  if (explicitRadiusDp === null) return cornerRadiusDp;
  const factor = cornerRadiusDp / 16;
  if (factor === 1) return explicitRadiusDp;
  return explicitRadiusDp * factor;
}

/**
 * `GlassCard.kt` lines 816-818 — 毛玻璃厚度感知补偿：以出厂默认 22dp 为中性零点双向映射。
 * Returns `[thick, beamGain, bevelGain]`.
 */
export function glassThicknessGains(
  blurRadiusDp: number,
): [thick: number, beamGain: number, bevelGain: number] {
  const thick = Math.max(-1, Math.min(1, (blurRadiusDp - 22) / 18));
  const beamGain = Math.max(0.42, Math.min(1.3, 1 - 0.52 * thick));
  const bevelGain = Math.max(0.48, Math.min(1.26, 1 - 0.45 * thick));
  return [thick, beamGain, bevelGain];
}

/**
 * `GlassCard.kt` lines 436-437 — 相机距离与卡体尺寸绑定（设备无关的物理光学基准）。
 * `shortSide * (0.42f + 3.8f * ((cameraDistMult - 3f) / 9f).coerceIn(0f, 1f))`
 * Kotlin `graphicsLayer.cameraDistance` has no CSS counterpart; the resulting
 * perspective strength is folded into the CSS `perspective()` distance used by
 * `core/glass/liquidGlass.ts` `cardPerspective()`.
 */
export function cardCameraDistance(shortSidePx: number, cameraDistMult: number): number {
  return (
    shortSidePx * (0.42 + 3.8 * Math.max(0, Math.min(1, (cameraDistMult - 3) / 9)))
  );
}