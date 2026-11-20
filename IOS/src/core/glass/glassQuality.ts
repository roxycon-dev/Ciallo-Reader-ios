/**
 * 渲染画质档位 —— `ui/components/GlassQuality.kt` 的逐行移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L17-22  `enum class RenderQuality(val id: Int, val label: String)`：
 *             MINIMAL(-1,"极简") / LOW(0,"流畅") / MID(1,"均衡") / HIGH(2,"高") / MAX(3,"极致")
 *                                                        → `RENDER_QUALITIES`
 *   L25     `val realtimeGlass: Boolean get() = id >= HIGH.id && supportsRealtimeBlur`
 *                                                        → `renderQualityRealtimeGlass()`
 *   L28     `val enhancedMotion: Boolean get() = id >= HIGH.id` → `renderQualityEnhancedMotion()`
 *   L30     `val minimal: Boolean get() = this == MINIMAL`      → `renderQualityMinimal()`
 *   L31     `val decorativeEffects: Boolean get() = id > LOW.id` → `renderQualityDecorativeEffects()`
 *
 * 为什么要有这个文件：这 4 个派生属性决定「开不开实时模糊、跑不跑装饰动画、用不用
 * 增强动效」，此前分散在 `navigation.ts`（只看 EXTREME/HIGH）与 `liquidGlass.ts`
 * （只看 `supportsRealtimeBlur()`）里，**没有任何一处按完整 5 档判定** ——
 * `MID`（均衡）会被当成「有装饰效果」，与 Kotlin 的 `id > LOW.id` 碰巧一致，
 * 但 `MINIMAL` 的 `enhancedMotion=false` 与 `realtimeGlass=false` 无处分叉。
 *
 * `PARITY_EXCEPTIONS.md` **E140** 登记了本文件的平台差异：
 * `supportsRealtimeBlur` 在 Web 侧是「CSS backdrop-filter 可用」（用户关掉透明效果时为 false），
 * 判定口径与 Android 的 `SDK_INT >= S` 不同，但 `realtimeGlass` 的语义（HIGH 及以上 + 系统支持）保留。
 */

/** `L17-22` 的一档。 */
export interface RenderQualityEntry {
  /** `id`：持久化进 `render_quality` 的整数（MINIMAL 是 **-1**，不是 0）。 */
  readonly id: number;
  /** `label`（中文原文，读取时再走 `tr()`）。 */
  readonly label: string;
  /** Kotlin 的枚举项名（`MINIMAL` / `LOW` / …），日志与设置页按它分派。 */
  readonly name: RenderQualityName;
}

/**
 * `L17-22` 五档，**声明顺序即 Kotlin 的 ordinal**。
 *
 * 注意 `MINIMAL` 的 id 是 `-1`：`homeRenderRecovery` 与启动看门狗都靠这个负值
 * 与「没设置过」（默认 2）区分开。
 */
export const RENDER_QUALITIES = [
  { id: -1, label: '极简', name: 'MINIMAL' },
  { id: 0, label: '流畅', name: 'LOW' },
  { id: 1, label: '均衡', name: 'MID' },
  { id: 2, label: '高', name: 'HIGH' },
  { id: 3, label: '极致', name: 'MAX' },
] as const satisfies readonly RenderQualityEntry[];

export type RenderQualityName = 'MINIMAL' | 'LOW' | 'MID' | 'HIGH' | 'MAX';

/** 档位名 → 条目。 */
export const RENDER_QUALITY_BY_NAME: Readonly<Record<RenderQualityName, RenderQualityEntry>> = {
  MINIMAL: RENDER_QUALITIES[0],
  LOW: RENDER_QUALITIES[1],
  MID: RENDER_QUALITIES[2],
  HIGH: RENDER_QUALITIES[3],
  MAX: RENDER_QUALITIES[4],
};

/** `L25` 的 `HIGH.id`（实时模糊的门槛）。 */
export const RENDER_QUALITY_HIGH_ID = 2;
/** `L30` 的 `MINIMAL.id`。 */
export const RENDER_QUALITY_MINIMAL_ID = -1;
/** `L31` 的 `LOW.id`（装饰效果的门槛，需要 `> LOW`）。 */
export const RENDER_QUALITY_LOW_ID = 0;

/** 由持久化的整数取档位；未知值按 Kotlin 的 `entries.firstOrNull { it.id == id }` 回落 HIGH。 */
export function renderQualityOf(id: number): RenderQualityEntry {
  for (const entry of RENDER_QUALITIES) if (entry.id === id) return entry;
  return RENDER_QUALITY_BY_NAME.HIGH;
}

/** `L25` `realtimeGlass = id >= HIGH.id && supportsRealtimeBlur`。 */
export function renderQualityRealtimeGlass(id: number, supportsRealtimeBlur: boolean): boolean {
  return id >= RENDER_QUALITY_HIGH_ID && supportsRealtimeBlur;
}

/** `L28` `enhancedMotion = id >= HIGH.id`（抽纸变形、水滴选择、液态滑条、挤压开关）。 */
export function renderQualityEnhancedMotion(id: number): boolean {
  return id >= RENDER_QUALITY_HIGH_ID;
}

/** `L30` `minimal = this == MINIMAL`。 */
export function renderQualityMinimal(id: number): boolean {
  return id === RENDER_QUALITY_MINIMAL_ID;
}

/** `L31` `decorativeEffects = id > LOW.id`。 */
export function renderQualityDecorativeEffects(id: number): boolean {
  return id > RENDER_QUALITY_LOW_ID;
}
