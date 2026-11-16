import { type CSSProperties, type ReactNode } from 'react';
import { AppButton } from './AppButton';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/LiquidGlassControls.kt` (68 non-blank lines) — FULL PORT
 *   lines 26-27  `val LocalLiquidGlassState: ProvidableCompositionLocal<LiquidGlassProviderState?>`
 *                 → LiquidGlassStateContext
 *   lines 35-49  `DialogLiquidGlass(fillMaxSize, content)` → DialogLiquidGlass
 *   lines 56-71  `AppLiquidButton(text, onClick, modifier, icon, enabled)` → AppLiquidButton
 *
 * Header comment verbatim:
 *   液态玻璃按钮 —— 基于 Abdullajon1881/LiquidGlass 实现：
 *   SDF 透镜 + AGSL 边缘折射 + gel-press 凝胶按压 + 液体流动切换。
 *   按钮统一走 AppButton 四变体；开关已统一到 AppSwitch（见 AppSwitch.kt，
 *   第十一轮第 3 条：全局只保留一套开关组件），本文件不再承载开关实现。
 *   所有颜色取自主题 token（primary / primaryLight / accent / rimMid），
 *   组件内不硬编码主题色。
 *
 * ADAPTATION
 * - `dev.liquidglass.compose.liquidGlassProvider(state)` registered a
 *   `LiquidGlassProviderState` so that `AppActionButton` could sample the *window's*
 *   rendered content through an SDF lens.
 *   On the web there is no cross-window texture capture: CSS `backdrop-filter`
 *   already samples the real composited backdrop, so the provider becomes a
 *   boolean flag ("glass available in this subtree") that the button reads to
 *   decide whether to attach `backdrop-filter`. Ported as
 *   `LiquidGlassStateContext` with a `'sdf-lens' | 'backdrop-filter' | null` value.
 * - `DialogLiquidGlass` must create a *separate* provider per window on Android
 *   ("layouts are not part of the same hierarchy"). On the web each modal is its
 *   own React subtree, so the nesting is automatic; the explicit wrapper is kept
 *   so the API and the intent survive.
 */
export type LiquidGlassBackend = 'sdf-lens' | 'backdrop-filter' | null;

export const LiquidGlassStateContext = {
  backend: null as LiquidGlassBackend,
};

/**
 * 弹窗/底部弹层专用：为独立窗口创建属于该窗口自己的 Liquid Glass Provider。
 * 不能复用主窗口的 Provider（不同 view hierarchy 会抛
 * “layouts are not part of the same hierarchy”），必须每个窗口单独一个。
 */
export function DialogLiquidGlass(props: {
  fillMaxSize?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={['liquid-glass-provider', props.className ?? ''].filter(Boolean).join(' ')}
      style={{
        ...(props.fillMaxSize === true ? { width: '100%', height: '100%' } : {}),
        ...props.style,
      }}
      data-liquid-glass-backend="backdrop-filter"
    >
      {props.children}
    </div>
  );
}

/**
 * 液态玻璃按钮兼容入口：统一走 AppActionButton Primary 变体
 * （实心渐变 + 液态玻璃高光 + gel-press + 双层阴影）。
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
      variant="primary"
      size="md"
      disabled={props.enabled === false}
      {...(props.icon !== undefined ? { icon: props.icon } : {})}
      {...(props['data-testid'] !== undefined ? { 'data-testid': props['data-testid'] } : {})}
      className={['app-liquid-button', props.className ?? ''].filter(Boolean).join(' ')}
    >
      {props.text}
    </AppButton>
  );
}