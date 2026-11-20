/**
 * `ui/reader/ReadingSettingsPanel.kt`（92 行 / 89 非空）→ `@core/reader/readingSettingsPanel`。
 *
 * 为什么单独抽出来：这个面板的**每一个**数值都写死在 Kotlin 里且分散在四处
 * （`DesignTokens` / `PullOutConfig` / 字面量 / `RenderQuality`），端口把它们内联进了
 * `reader.css` 的一个 `:has()` 块，注释又声称来自 `ReadingGlass.kt` —— 而
 * `ReadingSettingsPanel` **根本不用 `ReadingGlass`**：它自己 `drawPlainBackdrop(blur = 8dp)`、
 * 自己叠 `themeColor @ .56`、自己画 `1dp @ .12` 的描边。把 `ReadingGlass` 的
 * （`saturate(1.1) blur(16px)` + 三段高光 + `0.7px @ .13`）套上来是 2026-11 之前
 * 就留下的错，`tests/unit/diagnosticsGlassWindowWiring.test.tsx` 还把它钉住了。
 *
 * 行映射
 * ──────
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `MutableTransitionState(false).apply { targetState = true }` | L48 | `READING_SETTINGS_ENTER_FROM` |
 * | `BoxWithConstraints` + `wide` 判定 | L58-59 | `readingSettingsPanelLayout()` |
 * | `RoundedCornerShape(DesignTokens.RadiusOverlay)` | L60 | `READING_SETTINGS_RADIUS_PX` |
 * | `PullOutConfig.SCRIM` 遮罩 | L62 | `READING_SETTINGS_SCRIM_ALPHA` |
 * | `.align(if (wide) CenterEnd else BottomCenter)` | L66 | `readingSettingsPanelLayout().align` |
 * | `.padding(horizontal = if (wide) SpaceXl else SpaceTight, vertical = SpaceTight)` | L67 | `....sidePaddingPx` / `....edgePaddingPx` |
 * | `.widthIn(max = if (wide) 440.dp else 560.dp)` | L70 | `....maxWidthPx` |
 * | `.heightIn(max = maxHeight * if (wide) 0.94f else 0.80f)` | L71 | `....maxHeightFactor` |
 * | `.shadow(SpaceTight, shape, ambientColor = Black@.08f, spotColor = Black@.10f)` | L72 | `READING_SETTINGS_SHADOW` |
 * | `drawPlainBackdrop { blur(SpaceSm.toPx()) }` | L74-77 | `READING_SETTINGS_BLUR_PX` |
 * | `.background(themeColor.copy(alpha = .56f))` | L78 | `READING_SETTINGS_TINT_ALPHA` |
 * | `.background(verticalGradient(white@.10f, Transparent))` | L79 | `READING_SETTINGS_SHEEN_ALPHA` |
 * | `.border(1.dp, contentColor.copy(alpha = .12f), shape)` | L80 | `READING_SETTINGS_BORDER_*` |
 * | `CompositionLocalProvider(LocalContentColor provides contentColor)` | L83-87 | 由 `--rd-on-surface` 承担 |
 *
 * 平台差异
 * ────────
 * - `drawPlainBackdrop` 采样的 `LayerBackdrop`（RenderEffect + 上层图层的离屏位图）在 Web 侧
 *   由 `backdrop-filter` 承担。`blur(8px)` 是**唯一**效果 —— Kotlin 的 `effects` 只调了
 *   `blur`，没有 `colorControls(saturation)`；端口此前多加了 `saturate(1.1)` 是错的。
 * - `.shadow(elevation = 10.dp, ambientColor, spotColor)` 是 Android 的 RenderNode
 *   双层阴影，CSS 没有同构模型。这里保留三个可判定量（高度 10、ambient .08、spot .10），
 *   CSS 侧用两层 `box-shadow` 近似，改数值不会漂。
 * - `SideEffect { window.setDimAmount(0f) }`（L57）：Android 的 Dialog 默认会给窗口加
 *   dim，Kotlin 显式关掉并用 `ScrimEntrance` 自己画。Web 侧没有系统 dim，天然等价。
 */

/** L59 `maxWidth >= 600.dp || maxWidth > maxHeight`。 */
export const READING_SETTINGS_BREAKPOINT_PX = 600;

/** L70 `widthIn(max = 560.dp)`（窄屏）。 */
export const READING_SETTINGS_NARROW_MAX_WIDTH_PX = 560;

/** L70 `widthIn(max = 440.dp)`（宽屏）。 */
export const READING_SETTINGS_WIDE_MAX_WIDTH_PX = 440;

/** L71 `heightIn(max = maxHeight * 0.80f)`（窄屏）。 */
export const READING_SETTINGS_NARROW_MAX_HEIGHT = 0.8;

/** L71 `heightIn(max = maxHeight * 0.94f)`（宽屏）。 */
export const READING_SETTINGS_WIDE_MAX_HEIGHT = 0.94;

/** L60 `RoundedCornerShape(DesignTokens.RadiusOverlay)` = 28 dp。 */
export const READING_SETTINGS_RADIUS_PX = 28;

/** L67 `DesignTokens.SpaceTight` = 10 dp（同时用作 L72 的 elevation）。 */
export const READING_SETTINGS_SPACE_TIGHT_PX = 10;

/** L67 `DesignTokens.SpaceXl` = 20 dp（宽屏的水平内边距）。 */
export const READING_SETTINGS_SPACE_XL_PX = 20;

/** L76 `blur(DesignTokens.SpaceSm.toPx())` = 8 px —— 只有模糊，没有饱和度。 */
export const READING_SETTINGS_BLUR_PX = 8;

/** L62 `Color.Black.copy(alpha = PullOutConfig.SCRIM)` = `PullOutMotion.kt` L26 `.35f`。 */
export const READING_SETTINGS_SCRIM_ALPHA = 0.35;

/** L78 `themeColor.copy(alpha = 0.56f)`。 */
export const READING_SETTINGS_TINT_ALPHA = 0.56;

/** L79 `Color.White.copy(alpha = 0.10f)` → 第二段是 `Color.Transparent`（透明黑，alpha 0）。 */
export const READING_SETTINGS_SHEEN_ALPHA = 0.1;

/** L80 `border(1.dp, contentColor.copy(alpha = 0.12f), shape)`。 */
export const READING_SETTINGS_BORDER_WIDTH_PX = 1;

/** L80 的 `.12f`。 */
export const READING_SETTINGS_BORDER_ALPHA = 0.12;

/**
 * L72 `.shadow(DesignTokens.SpaceTight, shape, clip = false,
 * ambientColor = Color.Black.copy(alpha = 0.08f), spotColor = Color.Black.copy(alpha = 0.10f))`
 * —— 三个可判定量；CSS 的两层 `box-shadow` 是平台近似。
 */
export const READING_SETTINGS_SHADOW = {
  elevationPx: READING_SETTINGS_SPACE_TIGHT_PX,
  ambientAlpha: 0.08,
  spotAlpha: 0.1,
} as const;

export interface ReadingSettingsPanelLayout {
  /** L59 的 `wide` 判定结果。 */
  readonly wide: boolean;
  /** L66 `.align(if (wide) Alignment.CenterEnd else Alignment.BottomCenter)`。 */
  readonly align: 'bottom-center' | 'center-end';
  /** L70 `widthIn(max = …)`。 */
  readonly maxWidthPx: number;
  /** L71 `heightIn(max = maxHeight * …)` 的系数。 */
  readonly maxHeightFactor: number;
  /** L67 的水平内边距。 */
  readonly sidePaddingPx: number;
  /** L67 的垂直内边距（两档都是 `SpaceTight`）。 */
  readonly edgePaddingPx: number;
}

/**
 * L58-71 的整套几何。`maxWidth` / `maxHeight` 是 `BoxWithConstraints` 给的**可用区域**
 * dp 值，不是窗口尺寸 —— Android 在 `safeDrawingPadding()` 之后测量，端口必须传同样
 * 扣掉安全区后的值。
 */
export function readingSettingsPanelLayout(
  maxWidth: number,
  maxHeight: number,
): ReadingSettingsPanelLayout {
  const wide = maxWidth >= READING_SETTINGS_BREAKPOINT_PX || maxWidth > maxHeight;
  return {
    wide,
    align: wide ? 'center-end' : 'bottom-center',
    maxWidthPx: wide ? READING_SETTINGS_WIDE_MAX_WIDTH_PX : READING_SETTINGS_NARROW_MAX_WIDTH_PX,
    maxHeightFactor: wide ? READING_SETTINGS_WIDE_MAX_HEIGHT : READING_SETTINGS_NARROW_MAX_HEIGHT,
    sidePaddingPx: wide ? READING_SETTINGS_SPACE_XL_PX : READING_SETTINGS_SPACE_TIGHT_PX,
    edgePaddingPx: READING_SETTINGS_SPACE_TIGHT_PX,
  };
}

/**
 * L79 `Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.10f), Color.Transparent))`
 * → 两段竖直渐变。第二段**不带任何 ink 色**：`Color.Transparent` 是 `#00000000`，
 * 在预乘插值下与「白色 alpha 0」视觉相同但色值不同，`ReadingGlass` 的第三段
 * `ink@.045` 在这里没有对应物。
 */
export const READING_SETTINGS_SHEEN_GRADIENT = [
  `rgb(255 255 255 / ${String(READING_SETTINGS_SHEEN_ALPHA)})`,
  'transparent',
] as const;
