/**
 * Wenku 无障碍作用域 —— `ui/wenku/WenkuTokens.kt` L268-313 的 React 版。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L269 `val LocalWenkuMainSurface = compositionLocalOf { true }`   → `LocalWenkuMainSurface`（Context）
 *   L272 `LocalWenkuHighContrast = compositionLocalOf { false }`     → `LocalWenkuHighContrast`
 *   L275 `LocalWenkuReduceMotion = compositionLocalOf { false }`     → `LocalWenkuReduceMotion`
 *   L278 `LocalWenkuBlurEnabled = compositionLocalOf { true }`       → `LocalWenkuBlurEnabled`
 *   L281 `LocalWenkuDecorativeMotion = compositionLocalOf { true }`  → `LocalWenkuDecorativeMotion`
 *   L291-305 `rememberWenkuAccessibility()`：
 *             `highContrast = readHighContrast(context)`、
 *             `reduceMotion = LocalReduceMotion.current`、
 *             `blurEnabled = quality.realtimeGlass`、`decorativeMotion = !reduce && !quality.minimal`
 *             → `useWenkuAccessibility()`（Kotlin 原名出口 `rememberWenkuAccessibility`）
 *
 * 平台差异（已登记 E123）
 * ─────────────────────
 *  * `CompositionLocal` → React Context。
 *  * `Settings.Secure.high_text_contrast_enabled` → `prefers-contrast: more` / `forced-colors: active`
 *    （同一个系统级无障碍开关；实现在 `@core/wenku/tokens` 的 `readHighContrast`）。
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { readHighContrast, type WenkuAccessibility } from '@core/wenku/tokens';
import { RenderQuality, realtimeGlass } from '@core/glass/renderQuality';
import { useRenderQuality } from '../GlassQuality';
import { useMotion } from '../feedback/Motion';

/** L269。 */
export const LocalWenkuMainSurface = createContext(true);
/** L272。 */
export const LocalWenkuHighContrast = createContext(false);
/** L275。 */
export const LocalWenkuReduceMotion = createContext(false);
/** L278。 */
export const LocalWenkuBlurEnabled = createContext(true);
/** L281。 */
export const LocalWenkuDecorativeMotion = createContext(true);

/** L88 `LocalWenkuSequence`（`WenkuMotion.kt`）= 内容时钟 0..1；null 表示不在任何序列里。 */
export const LocalWenkuSequence = createContext<number | null>(null);
/** L82 `LocalWenkuSceneSequence`。 */
export const LocalWenkuSceneSequence = createContext<number | null>(null);
/** L83 `LocalWenkuPaneVisible`。 */
export const LocalWenkuPaneVisible = createContext(true);

export interface WenkuAccessibilityProviderProps {
  readonly mainSurface?: boolean;
  readonly highContrast?: boolean;
  readonly reduceMotion?: boolean;
  readonly blurEnabled?: boolean;
  readonly decorativeMotion?: boolean;
  readonly children: ReactNode;
}

/** 一次性覆盖整棵子树的 CompositionLocal 值（预览 / 测试 / 阅读器路由用）。 */
export function WenkuAccessibilityProvider(props: WenkuAccessibilityProviderProps) {
  return (
    <LocalWenkuMainSurface.Provider value={props.mainSurface ?? true}>
      <LocalWenkuHighContrast.Provider value={props.highContrast ?? false}>
        <LocalWenkuReduceMotion.Provider value={props.reduceMotion ?? false}>
          <LocalWenkuBlurEnabled.Provider value={props.blurEnabled ?? true}>
            <LocalWenkuDecorativeMotion.Provider value={props.decorativeMotion ?? true}>
              {props.children}
            </LocalWenkuDecorativeMotion.Provider>
          </LocalWenkuBlurEnabled.Provider>
        </LocalWenkuReduceMotion.Provider>
      </LocalWenkuHighContrast.Provider>
    </LocalWenkuMainSurface.Provider>
  );
}

function matchMediaOrFalse(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/** L291-305 `rememberWenkuAccessibility()`。 */
export function useWenkuAccessibility(): WenkuAccessibility {
  const quality = useRenderQuality();
  const { reduceMotion: systemReduce } = useMotion();
  const localHighContrast = useContext(LocalWenkuHighContrast);
  const localReduce = useContext(LocalWenkuReduceMotion);
  const localBlur = useContext(LocalWenkuBlurEnabled);
  const reduce = systemReduce || localReduce;
  return useMemo(() => {
    const highContrast = localHighContrast || readHighContrast(matchMediaOrFalse);
    return {
      highContrast,
      reduceMotion: reduce,
      blurEnabled: localBlur && realtimeGlass(quality),
      decorativeMotion: !reduce && quality !== 'MINIMAL' && RenderQuality[quality].id > RenderQuality.LOW.id,
    };
  }, [localHighContrast, localBlur, reduce, quality]);
}

/** Kotlin 原名出口。 */
export const rememberWenkuAccessibility = useWenkuAccessibility;
