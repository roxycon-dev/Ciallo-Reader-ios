/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/GlassQuality.kt` (19 non-blank lines)
 *   `enum class RenderQuality(id, label)` + `realtimeGlass` + `companion of(id)`
 *   → `RenderQuality` const object + `RENDER_QUALITY_LIST` + `renderQualityOf()`
 *   `val LocalRenderQuality = staticCompositionLocalOf { RenderQuality.HIGH }`
 *   → `RenderQualityProvider` / `useRenderQuality()` (see `src/ui/components/GlassQuality.tsx`).
 *
 * Nothing skipped — the file is a pure enum + a CompositionLocal.
 */

/**
 * 渲染画质档位：主要影响玻璃效果强度与前端动效数量。
 *
 * LOW  流畅 —— 极简质感：无实时模糊/噪点/棱镜描边，单层阴影，装饰性循环动画关闭；
 *              任何设备都能满帧滚动。
 * MID  均衡 —— 保留玻璃质感（色调/噪点/棱镜描边/缓存装饰层），但不做实时背景模糊；
 *              底栏用半透明底替代毛玻璃。
 * HIGH 高   —— 完整液态玻璃：22dp 实时背景模糊 + 全部七层光学装饰 + 底栏实时毛玻璃。
 *              与历史版本的默认视觉完全一致。
 * MAX  极致 —— 高画质之上追加：边缘折射透镜（AGSL，Android 13+ 自动降级）、
 *              更浓郁的色彩饱和、按压凝胶缩放。旗舰机专属。
 */
export const RenderQuality = {
  LOW: { id: 0, label: '流畅', realtimeGlass: false },
  MID: { id: 1, label: '均衡', realtimeGlass: false },
  HIGH: { id: 2, label: '高', realtimeGlass: true },
  MAX: { id: 3, label: '极致', realtimeGlass: true },
} as const;

export type RenderQualityName = keyof typeof RenderQuality;

/** Kotlin `RenderQuality.entries` → ordered LOW → MAX. */
export const RENDER_QUALITY_LIST: readonly RenderQualityName[] = [
  'LOW',
  'MID',
  'HIGH',
  'MAX',
];

/**
 * Kotlin `fun of(id: Int): RenderQuality = entries.firstOrNull { it.id == id } ?: HIGH`
 * (GlassQuality.kt line 27).
 */
export function renderQualityOf(id: number): RenderQualityName {
  const found = RENDER_QUALITY_LIST.find((name) => RenderQuality[name].id === id);
  return found ?? 'HIGH';
}

/** Kotlin `RenderQuality.realtimeGlass` (`id >= HIGH.id`). */
export function realtimeGlass(quality: RenderQualityName): boolean {
  return RenderQuality[quality].realtimeGlass;
}

/**
 * Kotlin `LiquidGlass.kt` line 68 `val supportsRealtimeBlur: Boolean`
 * (`Build.VERSION.SDK_INT >= Build.VERSION_CODES.S`).
 *
 * Adaptation: the web has no `RenderEffect`; every browser with `backdrop-filter`
 * support gets the realtime path.  The capability probe lives in
 * `src/core/glass/liquidGlass.ts` (`supportsRealtimeBlur()`), which also honours
 * `prefers-reduced-transparency` / no-`backdrop-filter` browsers.
 */
export function isMax(quality: RenderQualityName): boolean {
  return quality === 'MAX';
}

export function isLow(quality: RenderQualityName): boolean {
  return quality === 'LOW';
}