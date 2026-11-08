/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/adaptive/AdaptiveSpec.kt` (148 non-blank lines)
 * - `ui/design/DesignTokens.kt` (53 non-blank lines)
 *
 *   AdaptiveSpec.kt line 50  enum WindowWidthClass     → WindowWidthClass
 *   AdaptiveSpec.kt lines 54-63 rememberWindowWidthClass → windowWidthClass()
 *   AdaptiveSpec.kt lines 65-77 object AdaptiveSpec (4 dp constants) → AdaptiveSpec
 *   AdaptiveSpec.kt lines 81-86 data class AdaptiveSizing → AdaptiveSizing
 *   AdaptiveSpec.kt lines 97-119 rememberAdaptiveSizing → resolveAdaptiveSizing()
 *   AdaptiveSpec.kt lines 122-123 Modifier.adaptiveDialogWidth → adaptiveDialogWidthStyle()
 *   AdaptiveSpec.kt lines 127-133 Modifier.adaptiveSheetWidth → adaptiveSheetWidthStyle()
 *   AdaptiveSpec.kt lines 141-142 Modifier.adaptivePageWidth  → adaptivePageWidthStyle()
 *   AdaptiveSpec.kt lines 149-169 AdaptiveSheetContent      → src/ui/components/adaptive/AdaptiveSpec.tsx
 *   AdaptiveSpec.kt lines 173-184 AdaptivePageContent      → src/ui/components/adaptive/AdaptiveSpec.tsx
 *
 *   DesignTokens.kt lines 40-56 (Radius/Space/Elevation) → DESIGN_SPEC
 *   DesignTokens.kt line 57 `fun shape(radius)`           → `shapeRadius()` helper
 *
 * ADAPTATION — res/dimen + Configuration → CSS media queries
 * ────────────────────────────────────────────────────────────
 * Kotlin reads four max widths from `res/dimen` (overridable per
 * `values-sw600dp/` / `values-sw840dp/` breakpoint folders) with the
 * `AdaptiveSpec` constants as compile-time fallback.  CSS already expresses
 * exactly this: a base rule plus `@media (min-width: 600px)` / `(min-width: 840px)`
 * overrides.  The values below are the `AdaptiveSpec` constants (the fallback and
 * therefore the canonical source), emitted as a media-query-aware stylesheet by
 * `adaptiveWidthCss()`.
 *
 * NOTE: no `react` import — `src/core/**` must stay pure TypeScript (ESLint
 * `no-restricted-imports`), so the style helpers return plain records that are
 * structurally compatible with `CSSProperties`.
 */

/**
 * Style fragment returned by the helpers below. Declared locally so this module
 * has zero imports.
 */
export type StyleProps = Record<string, string>;

/* ── E61：视口依赖注入 ────────────────────────────────────────────────────── */

/**
 * 视口端口的**最小形状**（与 `src/platform/interfaces.ts` 的 `ViewportPort`
 * 结构兼容）。这里就地声明而非 import，是为了保持本模块「零 import」。
 *
 * 为什么零 import：ESLint 的 `no-restricted-imports` 禁的是 React/DOM/Capacitor，
 * 允许 import `@platform/interfaces`；但本模块历史上是纯函数集合，被单测直接
 * import 而不装配平台。保持零 import 可以让「用哪个端口实现」完全由装配层决定。
 */
export interface ViewportSource {
  width(): number;
  height(): number;
}

/**
 * 兜底实现：无宿主视口（Node worker / 小程序壳 / 单测未装配）时返回 0。
 *
 * `width() === 0` 会让 `windowWidthClass(0)` 得到 `'COMPACT'` —— 与原实现
 * `typeof window === 'undefined' → 'COMPACT'` 完全一致；
 * `isLandscapeViewport()` 得到 `false` —— 也与原实现一致。
 */
const NO_VIEWPORT: ViewportSource = {
  width: () => 0,
  height: () => 0,
};

let viewportSource: ViewportSource = NO_VIEWPORT;

/**
 * 装配处注入真实视口。传 `null` 恢复兜底（单测用）。
 *
 * Android 对照：`Configuration.screenWidthDp / screenHeightDp`
 * （`AdaptiveSpec.kt` 的 `rememberWindowWidthClass()` 读的就是它）。
 */
export function setViewportSource(source: ViewportSource | null): void {
  viewportSource = source ?? NO_VIEWPORT;
}

function viewport(): ViewportSource {
  return viewportSource;
}

/* ── DesignTokens.kt ─────────────────────────────────────────────────────── */

/**
 * Ciallo Reader 设计规范（全局统一）。
 * 圆角：XS 8 / SM 12 / MD 16 / LG 20 / XL 24
 * 间距：4 / 8 / 12 / 16 / 20 / 24
 * 阴影：普通卡片 elevation 2dp、浮动层 8dp
 */
export const DESIGN_SPEC = {
  radius: { xs: 8, sm: 12, md: 16, lg: 20, xl: 24 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, page: 16 },
  cardElevation: 2,
  floatingElevation: 8,
} as const;

/* ── AdaptiveSpec.kt ─────────────────────────────────────────────────────── */

/** AdaptiveSpec.kt line 50 — `@Immutable enum class WindowWidthClass`. */
export type WindowWidthClass = 'COMPACT' | 'MEDIUM' | 'EXPANDED';

/**
 * AdaptiveSpec.kt lines 54-63 `rememberWindowWidthClass()` —
 * 仿 M3 断点：<600dp 手机 / 600-839dp 折叠展开与小平板 / >=840dp 平板与横屏。
 * `configuration.screenWidthDp` → `window.innerWidth` (CSS px ≈ dp).
 */
export function windowWidthClass(widthDp: number): WindowWidthClass {
  if (widthDp >= 840) return 'EXPANDED';
  if (widthDp >= 600) return 'MEDIUM';
  return 'COMPACT';
}

/** AdaptiveSpec.kt lines 65-77 — the four canonical max widths in dp. */
export const AdaptiveSpec = {
  /** 居中弹窗最大宽（手机 0.86~0.92f 比例宽不受影响，平板钳到 560dp）。 */
  dialogMaxWidth: 560,
  /** 底部面板最大宽（竖屏/窄窗）；与漫画阅读器设置面板一致。 */
  sheetMaxWidth: 560,
  /** 底部面板横屏最大宽；横屏纵向空间宝贵，放宽换并排内容。 */
  sheetMaxWidthLandscape: 840,
  /** 全屏滚动页（设置/统计/缓存管理）在平板上的内容最大宽，居中呈现。 */
  pageContentMaxWidth: 720,
} as const;

/** AdaptiveSpec.kt lines 81-86 — `data class AdaptiveSizing`. */
export interface AdaptiveSizing {
  dialogMaxWidth: number;
  sheetMaxWidth: number;
  sheetMaxWidthLandscape: number;
  pageContentMaxWidth: number;
}

/** AdaptiveViewport — the `LocalConfiguration` snapshot the sizing above reads. */
export interface AdaptiveViewport {
  widthClass: WindowWidthClass;
  landscape: boolean;
  width: number;
  height: number;
}

/**
 * AdaptiveSpec.kt lines 97-119 `rememberAdaptiveSizing()` —
 * 数值来自 res/dimen（可被 values-sw600dp/、values-sw840dp/ 覆盖），读取失败时
 * 回退 AdaptiveSpec 同名常量，保证永不抛异常。
 */
export function resolveAdaptiveSizing(widthDp: number, heightDp: number): AdaptiveSizing {
  const landscape = widthDp > heightDp;
  return {
    dialogMaxWidth: AdaptiveSpec.dialogMaxWidth,
    sheetMaxWidth: AdaptiveSpec.sheetMaxWidth,
    // 横屏纵向空间宝贵，放宽换并排内容（漫画设置面板第 11 条同源）
    sheetMaxWidthLandscape: landscape
      ? AdaptiveSpec.sheetMaxWidthLandscape
      : AdaptiveSpec.sheetMaxWidth,
    pageContentMaxWidth: AdaptiveSpec.pageContentMaxWidth,
  };
}

/**
 * AdaptiveSpec.kt lines 122-123 `Modifier.adaptiveDialogWidth(fraction = 0.86f)` —
 * 弹窗内容宽：保留调用方比例宽的手机观感，平板/横屏钳到 560dp 居中。
 */
export function adaptiveDialogWidthStyle(fraction = 0.86): StyleProps {
  return {
    width: `${(fraction * 100).toFixed(2)}%`,
    maxWidth: `${AdaptiveSpec.dialogMaxWidth}px`,
    marginInline: 'auto',
  };
}

/**
 * AdaptiveSpec.kt lines 127-133 `Modifier.adaptiveSheetWidth()` —
 * 贴底面板内容宽：竖屏 560dp、横屏 840dp（须挂在 BottomCenter 宿主内）。
 */
export function adaptiveSheetWidthStyle(landscape = false): StyleProps {
  return {
    maxWidth: `${landscape ? AdaptiveSpec.sheetMaxWidthLandscape : AdaptiveSpec.sheetMaxWidth}px`,
    width: '100%',
    marginInline: 'auto',
  };
}

/**
 * AdaptiveSpec.kt lines 141-142 `Modifier.adaptivePageWidth()` —
 * 页面内容宽：给全屏滚动页/页头等内容级容器钳制最大宽度，须挂在居中宿主内。
 */
export function adaptivePageWidthStyle(): StyleProps {
  return {
    maxWidth: `${AdaptiveSpec.pageContentMaxWidth}px`,
    width: '100%',
    marginInline: 'auto',
  };
}

/**
 * NOTE: the `AdaptiveSheetContent` / `AdaptivePageContent` composables from
 * AdaptiveSpec.kt lines 149-169 / 173-184 live in
 * `src/ui/components/adaptive/AdaptiveSpec.tsx` — `src/core/**` stays JSX-free
 * so it can be unit-tested without a DOM.
 */

/**
 * The res/dimen breakpoint table as CSS. Emitted once into the stylesheet so the
 * sw600dp / sw840dp overrides stay declarative (matching the Android
 * "数值真源下沉到 res/dimen" discipline) rather than computed in JS.
 */
export function adaptiveWidthCss(): string {
  return (
    `@media (min-width:600px){` +
    `.adaptive-dialog{width:100%;max-width:${AdaptiveSpec.dialogMaxWidth}px;}` +
    `.adaptive-sheet__inner{width:100%;}` +
    `}` +
    `@media (min-width:840px){` +
    `.adaptive-dialog{width:100%;max-width:${AdaptiveSpec.dialogMaxWidth}px;}` +
    `.adaptive-page__inner{width:100%;max-width:${AdaptiveSpec.pageContentMaxWidth}px;}` +
    `}` +
    `@media (min-width:840px) and (orientation:landscape){` +
    `.adaptive-sheet__inner{width:100%;max-width:${AdaptiveSpec.sheetMaxWidthLandscape}px;}` +
    `}`
  );
}

/**
 * Breakpoint helper matching AdaptiveSpec's `WindowWidthClass` for components that
 * need the class in JS (e.g. the compact PIN keyboard at < 560dp height).
 *
 * E61：原实现直接读 `window.innerWidth`，会让 `src/core/**` 依赖 DOM 全局
 * （核心层因此无法在 Node worker / 小程序壳里跑）。现改为走 `ViewportPort`。
 *
 * 语义保持不变：拿不到视口时返回 `'COMPACT'` —— 对应 Kotlin 拿不到
 * `Configuration` 时的最窄断点兜底，也是移动优先的安全侧。
 */
export function currentWindowWidthClass(): WindowWidthClass {
  return windowWidthClass(viewport().width());
}

/**
 * Whether the viewport is landscape — `configuration.screenWidthDp > screenHeightDp`.
 *
 * ⚠️ 端口的方法**必须带括号调用**：`vp.width` 取到的是函数本身，
 * 两个函数比较会被 JS 隐式转成字符串再按字典序比大小，结果与宽高毫无关系
 * （`"() => 600" > "() => 1000"` 为 `true`，因为 `'6' > '1'`）。
 * 正确写法是 `vp.width() > vp.height()`。
 */
export function isLandscapeViewport(): boolean {
  const vp = viewport();
  return vp.width() > vp.height();
}

/** DesignTokens.kt line 57 — `fun shape(radius: Dp) = RoundedCornerShape(radius)`. */
export function shapeRadius(dp: number): string {
  return `${dp}px`;
}