/**
 * `ui/components/LiquidGlassControls.kt`（89 行 / 78 非空）→ `@core/ui/liquidGlassControls`。
 *
 * 为什么值得单独一个模块：这个文件里有三件**可判定**的事，端口一件都没搬：
 *
 *   1. **画质门**（L43-46）。`if (!LocalRenderQuality.current.enhancedMotion) {
 *      CompositionLocalProvider(LocalLiquidGlassState provides null) { content() }; return }`
 *      —— 低画质档**整块不建 Provider**（也就不画那层光学源）。端口一律声明
 *      `data-liquid-glass-backend="backdrop-filter"`，低端机上照样全屏采样背景。
 *   2. **同窗复用**（L48-53）。`if (LocalGlassWindowOwner.current === view)` —— 同一个窗口里
 *      再次请求玻璃时**共用**已有的 Provider，不再录一份（否则 SDF 透镜会重复采样）。
 *   3. **光学源的三个色标**（L60-62）。`Brush.linearGradient(listOf(surface,
 *      primary.copy(alpha = .08f), secondary.copy(alpha = .06f)))` —— 两个 alpha 是 0.08 / 0.06，
 *      而且**第一个色标用的是 surface 全不透明**（工具条底下那层"素材"）。
 *
 * 端口此前只有一个可变的模块级对象 `LiquidGlassStateContext = { backend: null }`：
 * 它不是 React context，"在子树里 provide null" 这件事根本表达不出来（一改就全局生效），
 * 所以上面的第 1 条不是"忘了写"，而是**结构上做不到**。
 *
 * 行映射
 * ──────
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `LocalLiquidGlassState: ProvidableCompositionLocal<…?>` | L29-30 | `LiquidGlassBackend` + 组件里的 `createContext` |
 * | `private val LocalGlassWindowOwner` | L31 | `LiquidGlassOwner`（同窗复用的键） |
 * | `if (!enhancedMotion) { provide null; content() }` | L43-46 | `dialogLiquidGlassPlan({...}).mode === 'plain'` |
 * | `if (LocalGlassWindowOwner.current === view)` | L48-53 | `mode === 'reuse'` |
 * | 光学源 `matchParentSize().liquidGlassProvider(visible = false)` | L60 | `mode === 'provider'` + `visible: false` |
 * | `linearGradient(surface, primary@.08f, secondary@.06f)` | L61-62 | `glassSourceGradient()` |
 * | `AppLiquidButton` 固定 `Primary` + `Medium` | L80-88 | `APP_LIQUID_BUTTON_SPEC` |
 *
 * 平台差异
 * ────────
 * - `dev.liquidglass.compose.liquidGlassProvider(state)` 是 AGSL/SDF 的**跨窗口纹理采样**；
 *   Web 侧由 CSS `backdrop-filter` 承担（浏览器自己合成背景），所以这里只需要
 *   "这棵子树有没有玻璃"这一个状态，不需要 Provider 对象。
 * - `AndroidView` 的 `view hierarchy` 是 Compose 窗口概念；Web 里每个 modal 是独立 React 子树，
 *   但**同窗复用**仍然要判（同一个 DOM 子树里再包一层会重复挂 `backdrop-filter` 层）。
 * - `LocalRenderQuality` → `useRenderQuality()` + `@core/glass/renderQuality#enhancedMotion`。
 */

/** L29-30 `LocalLiquidGlassState: ProvidableCompositionLocal<LiquidGlassProviderState?>` 的 Web 取值。 */
export type LiquidGlassBackend = 'backdrop-filter' | null;

/** L31 `LocalGlassWindowOwner` —— 只用来判断「是不是同一个窗口」，不携带 Provider。 */
export interface LiquidGlassOwner {
  readonly windowId: string;
}

/** L60 `liquidGlassProvider(glass, visible = false)` —— 光学源自己**不显示**，只作为兄弟层被采样。 */
export const GLASS_SOURCE_VISIBLE = false;

/** L61-62 的两个 alpha。 */
export const GLASS_SOURCE_PRIMARY_ALPHA = 0.08;
export const GLASS_SOURCE_SECONDARY_ALPHA = 0.06;

/** L61-62 `listOf(colors.surface, colors.primary.copy(alpha = .08f), colors.secondary.copy(alpha = .06f))`。 */
export function glassSourceGradient(colors: {
  readonly surface: string;
  readonly primary: string;
  readonly secondary: string;
}): readonly [string, string, string] {
  return [
    colors.surface,
    withAlpha(colors.primary, GLASS_SOURCE_PRIMARY_ALPHA),
    withAlpha(colors.secondary, GLASS_SOURCE_SECONDARY_ALPHA),
  ];
}

/** `Color.copy(alpha = a)` 的 CSS 形式；`withAlpha` 在 core 里已有一份同值实现，这里只做委托。 */
function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return `color-mix(in srgb, ${hex} ${String(alpha * 100)}%, transparent)`;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}

/**
 * L43-53 的三条分支，**顺序即优先级**：
 *
 * ```
 * 1. !enhancedMotion                        -> plain   （不建 Provider，content 原样）
 * 2. owner === view                         -> reuse   （共用已有的，不再录一份）
 * 3. 其余                                    -> provider（建 Provider + 画光学源）
 * ```
 */
export type LiquidGlassMode = 'plain' | 'reuse' | 'provider';

export interface DialogLiquidGlassInput {
  /** `LocalRenderQuality.current.enhancedMotion`（`GlassQuality.kt` L28 `id >= HIGH.id`）。 */
  readonly enhancedMotion: boolean;
  /** 当前子树的窗口 ID。 */
  readonly windowId: string;
  /** `LocalGlassWindowOwner.current`（祖先 Provider 的窗口 ID），没有则 `null`。 */
  readonly ownerWindowId: string | null;
}

export function dialogLiquidGlassPlan(input: DialogLiquidGlassInput): {
  readonly mode: LiquidGlassMode;
  /** L44 / L55 `LocalLiquidGlassState provides null | glass`。 */
  readonly backend: LiquidGlassBackend;
  /** L51 / L56 `Modifier.then(if (fillMaxSize) fillMaxSize() else Modifier)`。 */
  readonly sizeToParent: boolean;
} {
  if (!input.enhancedMotion) return { mode: 'plain', backend: null, sizeToParent: false };
  if (input.ownerWindowId !== null && input.ownerWindowId === input.windowId) {
    return { mode: 'reuse', backend: 'backdrop-filter', sizeToParent: false };
  }
  return { mode: 'provider', backend: 'backdrop-filter', sizeToParent: false };
}

/**
 * L51 / L56 的 `if (fillMaxSize) Modifier.fillMaxSize() else Modifier`。
 * `plain` 分支**没有** Box 包裹（L44-45 直接 `content()`），所以尺寸交给调用方。
 */
export function dialogLiquidGlassSize(mode: LiquidGlassMode, fillMaxSize: boolean): boolean {
  if (mode === 'plain') return false;
  return fillMaxSize;
}

/**
 * L80-88 `AppLiquidButton` 只是 `AppActionButton` 的固定组合：
 * `variant = AppButtonVariant.Primary`、`buttonSize = AppButtonSize.Medium`，
 * `icon` / `enabled` 透传。端口三个参数一致即可，**不要**再加别的变体。
 */
export const APP_LIQUID_BUTTON_SPEC = {
  variant: 'primary',
  size: 'md',
} as const;
