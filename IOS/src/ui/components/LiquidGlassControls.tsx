import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';

import { enhancedMotion } from '@core/glass/renderQuality';
import {
  APP_LIQUID_BUTTON_SPEC,
  GLASS_SOURCE_VISIBLE,
  dialogLiquidGlassPlan,
  dialogLiquidGlassSize,
  glassSourceGradient,
  type LiquidGlassBackend,
} from '@core/ui/liquidGlassControls';

import { AppButton } from './AppButton';
import { useRenderQuality } from './GlassQuality';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/LiquidGlassControls.kt`（**89 行 / 78 非空**）
 *
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `val LocalLiquidGlassState: ProvidableCompositionLocal<…?>` | L29-30 | `LiquidGlassStateContext`（真 React context） |
 * | `private val LocalGlassWindowOwner` | L31 | `LiquidGlassOwnerContext` |
 * | `DialogLiquidGlass(fillMaxSize, content)` | L38-66 | `DialogLiquidGlass` |
 * | `AppLiquidButton(text, onClick, …)` | L72-89 | `AppLiquidButton` |
 *
 * 头部注释（Kotlin L1-8）逐字保留：
 *   液态玻璃按钮 —— 基于 Abdullajon1881/LiquidGlass 实现：
 *   SDF 透镜 + AGSL 边缘折射 + gel-press 凝胶按压 + 液体流动切换。
 *   按钮统一走 AppButton 四变体；开关已统一到 AppSwitch（见 AppSwitch.kt，
 *   第十一轮第 3 条：全局只保留一套开关组件），本文件不再承载开关实现。
 *   所有颜色取自主题 token（primary / primaryLight / accent / rimMid），
 *   组件内不硬编码主题色。
 *
 * 三处此前没搬的语义（现在都在 `@core/ui/liquidGlassControls`）
 * ─────────────────────────────────────────────────────────────
 * 1. **L43-46 画质门**：`!enhancedMotion` 时**不建 Provider**，`content` 原样渲染。
 *    旧端口一律挂 `data-liquid-glass-backend="backdrop-filter"`，低画质档照样整屏采样。
 * 2. **L48-53 同窗复用**：同一个窗口里再次请求玻璃时共用已有的 Provider
 *    （"Existing call sites may request glass again inside the same modal"）。
 * 3. **L60-62 光学源**：`matchParentSize()` 的兄弟层，`visible = false`，
 *    底色是 `linearGradient(surface, primary@.08f, secondary@.06f)`。
 *
 * 平台差异
 * ────────
 * - `dev.liquidglass.compose.liquidGlassProvider(state)` 的 AGSL/SDF 跨窗口纹理采样
 *   → CSS `backdrop-filter`（浏览器自己合成背景）。所以 CompositionLocal 的值退化成
 *   `'backdrop-filter' | null` 一个标记，但仍必须是**真 context**：旧端口把它写成模块级
 *   可变对象，"在子树里 provide null" 表达不出来（一改全局生效）。
 * - `LocalGlassWindowOwner` 的 `android.view.View` → `windowId: string`
 *   （modal 挂载时由调用方给一个稳定 id）。
 */

/** L29-30 `LocalLiquidGlassState`。默认 `null` = 这棵子树里没有玻璃。 */
export const LiquidGlassStateContext = createContext<LiquidGlassBackend>(null);

/** L31 `LocalGlassWindowOwner`。 */
export const LiquidGlassOwnerContext = createContext<string | null>(null);

/** 读取当前子树的玻璃后端（`null` = 无）。 */
export function useLiquidGlassBackend(): LiquidGlassBackend {
  return useContext(LiquidGlassStateContext);
}

/**
 * 弹窗/底部弹层专用：为独立窗口创建属于该窗口自己的 Liquid Glass Provider。
 * 不能复用主窗口的 Provider（不同 view hierarchy 会抛
 * "layouts are not part of the same hierarchy"），必须每个窗口单独一个。
 */
export function DialogLiquidGlass(props: {
  fillMaxSize?: boolean;
  /** 窗口标识（`LocalView.current` 的 Web 替身）。 */
  windowId: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** 主题三色，`glassSourceGradient` 用（Kotlin 从 `MaterialTheme.colorScheme` 取）。 */
  colors: { readonly surface: string; readonly primary: string; readonly secondary: string };
}) {
  const quality = useRenderQuality();
  const ownerWindowId = useContext(LiquidGlassOwnerContext);
  const plan = dialogLiquidGlassPlan({
    enhancedMotion: enhancedMotion(quality),
    windowId: props.windowId,
    ownerWindowId,
  });
  const sizeToParent = dialogLiquidGlassSize(plan.mode, props.fillMaxSize === true);

  // L43-46：低画质档直接渲染内容，不建 Provider、不画光学源。
  if (plan.mode === 'plain') {
    return <LiquidGlassStateContext.Provider value={null}>{props.children}</LiquidGlassStateContext.Provider>;
  }

  const boxStyle: CSSProperties = {
    ...(sizeToParent ? { width: '100%', height: '100%' } : {}),
    ...(props.style ?? {}),
  };

  // L48-53：同窗复用 —— 保留调用方的布局，共用已有 Provider（不再画第二份光学源）。
  if (plan.mode === 'reuse') {
    return (
      <div className={['liquid-glass-provider', props.className ?? ''].filter(Boolean).join(' ')} style={boxStyle}>
        {props.children}
      </div>
    );
  }

  // L54-65：建 Provider，光学源是**兄弟层**而不是祖先（否则 display list 成环）。
  const gradient = glassSourceGradient(props.colors);
  return (
    <LiquidGlassStateContext.Provider value={plan.backend}>
      <LiquidGlassOwnerContext.Provider value={props.windowId}>
        <div
          className={['liquid-glass-provider', props.className ?? ''].filter(Boolean).join(' ')}
          style={boxStyle}
          data-liquid-glass-backend={plan.backend ?? 'none'}
          data-liquid-glass-source-visible={String(GLASS_SOURCE_VISIBLE)}
        >
          <div
            className="liquid-glass-provider__source"
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background: `linear-gradient(135deg, ${gradient[0]} 0%, ${gradient[1]} 50%, ${gradient[2]} 100%)`,
              // L60 `liquidGlassProvider(glass, visible = false)` —— 光学源自己不可见
              opacity: GLASS_SOURCE_VISIBLE ? 1 : 0,
            }}
          />
          {props.children}
        </div>
      </LiquidGlassOwnerContext.Provider>
    </LiquidGlassStateContext.Provider>
  );
}

/**
 * 液态玻璃按钮兼容入口：统一走 AppActionButton Primary 变体
 * （实心渐变 + 液态玻璃高光 + gel-press + 双层阴影）。
 *
 * L80-88 固定 `variant = Primary` / `buttonSize = Medium`，`icon` / `enabled` 透传。
 */
export function AppLiquidButton(props: {
  text: string;
  onClick: () => void;
  className?: string;
  icon?: ReactNode;
  enabled?: boolean;
  'data-testid'?: string;
}) {
  return (
    <AppButton
      onClick={props.onClick}
      variant={APP_LIQUID_BUTTON_SPEC.variant}
      size={APP_LIQUID_BUTTON_SPEC.size}
      disabled={props.enabled === false}
      {...(props.icon !== undefined ? { icon: props.icon } : {})}
      {...(props['data-testid'] !== undefined ? { 'data-testid': props['data-testid'] } : {})}
      className={['app-liquid-button', props.className ?? ''].filter(Boolean).join(' ')}
    >
      {props.text}
    </AppButton>
  );
}
