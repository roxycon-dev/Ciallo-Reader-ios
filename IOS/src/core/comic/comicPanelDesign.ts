/**
 * comicPanelDesign.ts — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicPanelDesign.kt`（339 行 / 非空 323 行）中
 * **不依赖 Compose 的纯逻辑部分**。React 组件部分见 `comicPanelDesign.tsx`。
 *
 * Kotlin 行号 → TS 对照：
 *   L53-L60   文件级 KDoc「漫画面板设计系统（第七轮第 3 条）」→ 保留在 .tsx 文件头
 *   L62-L63   internal val PanelCardBg = Color(0x0DFFFFFF) → PANEL_CARD_BG（8 位十六进制，顺序改为 RRGGBBAA）
 *   L64       internal val PanelCardStroke = Color(0x26FFFFFF) → PANEL_CARD_STROKE
 *   L66-L72   @Composable selectedBg()/selectedStroke()（MintPrimary.copy(alpha=…)）
 *             → 纯函数 panelSelectedBg(mintPrimary) / panelSelectedStroke(mintPrimary)（mint 由调用方注入）
 *   L108-L109 internal data class PanelTabData(val label: String, val icon: ImageVector)
 *             → PanelTabData 接口（icon 改 ReactNode，放 .tsx 侧；此处只留纯数据形状）
 *   L171-L184 PanelSlider 的 fraction 计算 → panelSliderFraction(value, range)
 *   L189-L192 PanelSlider 内的局部 fun snap(f) → panelSliderSnap(f, steps)
 *   L194-L205 PanelSlider 内的局部 fun posToValue(x) → panelSliderPosToValue(...)
 *   L286-L298 PanelSwitch 的 travel / trackColor → panelSwitchTravelDp + comicPanelLerpColor
 *   L323-L328 private fun lerpColor(a, b, t) → comicPanelLerpColor
 *   L330-L332 @Composable internal fun panelSelectedBg() → panelSelectedBg（见上）
 *   L334-L336 @Composable internal fun panelSelectedStroke() → panelSelectedStroke（见上）
 *   L338-L339 internal data class PanelBgSwatch(label, fill, gradient: Brush?)
 *             → PanelBgSwatch 接口（Brush → CSS 渐变字符串）
 *
 * 跳过说明：
 *   · `Color(0x…)` → CSS `#RRGGBBAA` 字符串。注意 Kotlin 是 **AARRGGBB**，
 *     本文件的常量按 **RRGGBBAA** 书写以便直接喂给 CSS；每个常量上方注明原 0x 值，
 *     便于逐字核对。`Color.copy(alpha=)` → `comicPanelWithAlpha(color, alpha)`。
 *   · `MintPrimary` 是 `@Composable getter`（MaterialTheme 动态取色），core 不能读
 *     Composition → 由 .tsx 侧解析为具体色值后作为参数传入。函数体内 `copy(alpha=…)`
 *     的语义（替换 alpha、保留 RGB）逐字保留在 comicPanelWithAlpha 中。
 *   · `Brush`（L339 的可选渐变）→ CSS 渐变字符串（`linear-gradient(...)` / `radial-gradient(...)`）。
 *   · `ImageVector`（L109）→ Material 图标矢量路径，与本项目其它模块一致改为 ReactNode，
 *     放在 .tsx；core 侧只保留 label 字段形状。
 *   · `@Composable` 标记的 UI（PanelSectionCard L79-L106 / PanelTabRow L116-L163 /
 *     PanelSlider L172-L280 / PanelSwitch L287-L321）→ .tsx。
 *   · Compose Canvas 绘制（L246-L278）→ .tsx 的 SVG/CSS（核心几何常量在此文件导出）。
 *
 * 适配说明：
 *   · `BoxWithConstraints`/`LocalDensity` 的 dp→px 换算：Web 端 CSS px 与 dp 1:1
 *     （与本项目其它模块同一换算），因此所有 `X.dp` 直接是 `X` px。
 *   · Kotlin `Float` → `number`；`coerceIn(0f,1f)` → Math.min/max。
 *   · `ClosedFloatingPointRange<Float>` → `[number, number]` 二元组（start / endInclusive）。
 */

/** 玻璃卡片内层：极淡的白雾填充 + 细描边（模块化区块分隔的"玻璃描边"）。
 *  Kotlin: `Color(0x0DFFFFFF)`（AARRGGBB）→ CSS `#FFFFFF0D`（RRGGBBAA）。 */
export const PANEL_CARD_BG = '#FFFFFF0D'

/** Kotlin: `Color(0x26FFFFFF)`（AARRGGBB）→ CSS `#FFFFFF26`。 */
export const PANEL_CARD_STROKE = '#FFFFFF26'

/** `Color.copy(alpha = a)`（L69/L72）——替换 alpha、保留 RGB。 */
export function comicPanelWithAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '')
  const r = hex.slice(0, 2)
  const g = hex.slice(2, 4)
  const b = hex.slice(4, 6)
  return `#${r}${g}${b}${comicPanelAlphaHex(alpha)}`
}

/** alpha → 2 位大写 hex（0.18 → `2E`，与 Kotlin `Color.copy(alpha=)` 的 8 位 ARGB 尾字节一致）。 */
export function comicPanelAlphaHex(alpha: number): string {
  return Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, '0')
}

/** 选中背景（品牌薄荷绿 18% 透明度填充）——明确但克制的选中反馈。 */
export function panelSelectedBg(mintPrimary: string): string {
  return comicPanelWithAlpha(mintPrimary, 0.18)
}

/** 选中描边（品牌薄荷绿 55%）。 */
export function panelSelectedStroke(mintPrimary: string): string {
  return comicPanelWithAlpha(mintPrimary, 0.55)
}

/** Tab 定义（图标 + 文字）。icon 在 .tsx 侧为 ReactNode，这里只留标签。 */
export interface PanelTabData {
  readonly label: string
}

/** 背景类型色卡（阅读背景的可视化选择）。gradient 对应 Kotlin 的 `Brush?`。 */
export interface PanelBgSwatch {
  readonly label: string
  readonly fill: string
  readonly gradient: string | null
}

//
// ── PanelSlider 的纯计算（L171-L205）
//

/** `valueRange: ClosedFloatingPointRange<Float>` 的 TS 表示（start / endInclusive）。 */
export type FloatRange = readonly [number, number]

/**
 * 逐行移植 L182-L184：
 * `val fraction = if (endInclusive > start) ((value - start) / (endInclusive - start)).coerceIn(0f, 1f) else 0f`
 */
export function panelSliderFraction(value: number, valueRange: FloatRange): number {
  const [start, endInclusive] = valueRange
  if (endInclusive > start) {
    return Math.min(Math.max((value - start) / (endInclusive - start), 0), 1)
  }
  return 0
}

/**
 * 逐行移植 L189-L192 的局部函数：
 * `fun snap(f: Float): Float = if (steps > 0) { val st = 1f / (steps + 1); (round(f / st) * st).coerceIn(0f, 1f) } else f`
 */
export function panelSliderSnap(f: number, steps: number): number {
  if (steps > 0) {
    const st = 1 / (steps + 1)
    return Math.min(Math.max(Math.round(f / st) * st, 0), 1)
  }
  return f
}

/**
 * 逐行移植 L201-L205 的局部函数：
 * `fun posToValue(x: Float): Float { val physical = (x / size.width).coerceIn(0f,1f);
 *   val f = snap(if (reverse) 1f - physical else physical);
 *   return start + f * (endInclusive - start) }`
 * `size.width` 由调用方传入（.tsx 用 getBoundingClientRect / offsetWidth 取得）。
 */
export function panelSliderPosToValue(
  x: number,
  trackWidth: number,
  valueRange: FloatRange,
  steps: number,
  reverse: boolean,
): number {
  const [start, endInclusive] = valueRange
  const physical = Math.min(Math.max(x / trackWidth, 0), 1)
  const f = panelSliderSnap(reverse ? 1 - physical : physical, steps)
  return start + f * (endInclusive - start)
}

//
// ── PanelSwitch 的纯计算（L286-L298 / L323-L328）
//

/** `val travel = with(LocalDensity.current) { 18.dp.toPx() }`（L298）→ 18px。 */
export const PANEL_SWITCH_TRAVEL_DP = 18

/** `PanelSwitch` 胶囊初始位移 `3.dp.toPx()`（L315）。 */
export const PANEL_SWITCH_BASE_OFFSET_DP = 3

/**
 * 逐行移植 L323-L328：
 * `private fun lerpColor(a, b, t) = Color(a.red + (b.red - a.red) * t, …, a.alpha + (b.alpha - a.alpha) * t)`
 * 输入 `#RRGGBB` 或 `#RRGGBBAA`（缺 alpha 视为 1），输出 `#RRGGBBAA`。
 */
export function comicPanelLerpColor(a: string, b: string, t: number): string {
  const pa = parseComicPanelColor(a)
  const pb = parseComicPanelColor(b)
  const ch = (x: number, y: number): number => Math.round(Math.min(Math.max(x + (y - x) * t, 0), 255))
  const r = ch(pa[0], pb[0])
  const g = ch(pa[1], pb[1])
  const bl = ch(pa[2], pb[2])
  const al = Math.round(Math.min(Math.max(pa[3] + (pb[3] - pa[3]) * t, 0), 255))
  const hex = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(bl)}${hex(al)}`
}

/** 解析 `#RGB` / `#RRGGBB` / `#RRGGBBAA` → [r, g, b, a]（0-255）。 */
function parseComicPanelColor(color: string): [number, number, number, number] {
  let hex = color.replace('#', '').trim()
  if (hex.length === 3) {
    // `hex.length === 3` 守卫保证下标 0/1/2 一定存在（逐字符重复展开为 RRGGBB）。
    hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!
  }
  if (hex.length === 6) hex += 'FF'
  if (hex.length !== 8) throw new Error(`comicPanelLerpColor: 不支持的色值 ${color}`)
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    Number.parseInt(hex.slice(6, 8), 16),
  ]
}

//
// ── PanelSlider 绘制常量（L238-L245）——Compose Canvas → SVG/CSS 的尺寸依据
//

/** `val trackH = with(density) { 5.dp.toPx() }`（L241）。 */
export const PANEL_SLIDER_TRACK_H_DP = 5
/** `val thumbR = with(density) { 8.dp.toPx() }`（L239）。 */
export const PANEL_SLIDER_THUMB_R_DP = 8
/** `val pressRingR = with(density) { (if (enabled) 12.dp else 10.dp).toPx() }`（L240）。 */
export const PANEL_SLIDER_PRESS_RING_R_DP = 12
/** 禁用态光环半径（`else 10.dp`，L240）。 */
export const PANEL_SLIDER_PRESS_RING_R_DISABLED_DP = 10
/** 光环描边 `Stroke(width = 1.dp.toPx())`（L269）。 */
export const PANEL_SLIDER_RING_STROKE_DP = 1
/** `BoxWithConstraints(… .height(30.dp))`（L196）。 */
export const PANEL_SLIDER_HEIGHT_DP = 30
