import { useEffect, useState, type ReactNode } from 'react';
import {
  AdaptiveSpec,
  adaptiveDialogWidthStyle,
  adaptivePageWidthStyle,
  adaptiveSheetWidthStyle,
  adaptiveWidthCss,
  currentWindowWidthClass,
  isLandscapeViewport,
  resolveAdaptiveSizing,
  windowWidthClass,
  type AdaptiveSizing,
  type AdaptiveViewport,
} from '../../../core/glass/adaptiveSpec';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/adaptive/AdaptiveSpec.kt` (148 non-blank lines)
 *   line  50 `enum class WindowWidthClass`                  → WindowWidthClass (core)
 *   lines 54-63 `rememberWindowWidthClass()`                → useWindowWidthClass()
 *   lines 65-77 `object AdaptiveSpec` (4 dp constants)      → AdaptiveSpec (core)
 *   lines 81-86 `data class AdaptiveSizing`                 → core resolveAdaptiveSizing()
 *   lines 97-119 `rememberAdaptiveSizing()`                → useAdaptiveSizing()
 *   lines 122-123 `Modifier.adaptiveDialogWidth(0.86f)`    → adaptiveDialogWidthStyle (core)
 *   lines 127-133 `Modifier.adaptiveSheetWidth()`          → adaptiveSheetWidthStyle (core)
 *   lines 141-142 `Modifier.adaptivePageWidth()`           → adaptivePageWidthStyle (core)
 *   lines 149-169 `AdaptiveSheetContent(...)`              → AdaptiveSheetContent
 *   lines 173-184 `AdaptivePageContent(...)`               → AdaptivePageContent
 * - `ui/design/DesignTokens.kt` (53 non-blank lines)
 *   lines 40-45 RadiusXs/Sm/Md/Lg/Xl                        → DESIGN_SPEC.radius (core)
 *   lines 46-52 SpaceXs..Xxl/SpacePage                      → DESIGN_SPEC.space (core)
 *   lines 54-55 CardElevation / FloatingElevation          → DESIGN_SPEC.elevation
 *   line 57    `fun shape(radius)`                          → shapeRadius()
 *
 * ADAPTATION — `res/dimen` + `LocalConfiguration` → media queries + resize
 * ──────────────────────────────────────────────────────────
 * Kotlin reads the four max widths from `res/dimen` (overridable per
 * `values-sw600dp/` / `values-sw840dp/`) with the `AdaptiveSpec` constants as the
 * compile-time fallback, and recomputes whenever `LocalConfiguration` changes
 * (MainActivity declares `configChanges` so rotation does not recreate).
 * CSS expresses the same thing declaratively: base rules plus
 * `@media (min-width: 600px)` / `(min-width: 840px)` overrides. The JS surface
 * therefore only needs to answer "which class am I in" for the few components that
 * branch on it (e.g. the compact PIN keyboard below 560dp height).
 */

export {
  AdaptiveSpec,
  adaptiveDialogWidthStyle,
  adaptivePageWidthStyle,
  adaptiveSheetWidthStyle,
  adaptiveWidthCss,
  currentWindowWidthClass,
  isLandscapeViewport,
  resolveAdaptiveSizing,
  windowWidthClass,
};
export { DESIGN_SPEC } from '../../../core/glass/adaptiveSpec';
export type { AdaptiveSizing, AdaptiveViewport, WindowWidthClass } from '../../../core/glass/adaptiveSpec';

/** Subscribe to `resize`; `LocalConfiguration` is live in the same way. */
function useViewport(): AdaptiveViewport {
  // The lazy initializer is `LocalConfiguration.current` at first composition.
  const [vp, setVp] = useState<AdaptiveViewport>(() => readViewport());

  useEffect(() => {
    const onResize = (): void => setVp(readViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return vp;
}

function readViewport(): AdaptiveViewport {
  const w = typeof window === 'undefined' ? 0 : window.innerWidth;
  const h = typeof window === 'undefined' ? 0 : window.innerHeight;
  return { widthClass: windowWidthClass(w), landscape: w > h, width: w, height: h };
}

/** 仿 M3 断点：<600dp 手机 / 600-839dp 折叠展开与小平板 / >=840dp 平板与横屏。 */
export function useWindowWidthClass(): AdaptiveViewport['widthClass'] {
  return useViewport().widthClass;
}

export function useIsLandscapeViewport(): boolean {
  return useViewport().landscape;
}

/** 组合期读取当前窗口适用的自适应宽度表。 */
export function useAdaptiveSizing(): AdaptiveSizing {
  const vp = useViewport();
  return resolveAdaptiveSizing(vp.width, vp.height);
}

/**
 * M3 ModalBottomSheet 内容宿主：sheet 窗口本身全宽，此包装让内容在宽屏设备上
 * 居中限宽，手机全宽不变。fillMaxHeight 的 sheet（0.6f/0.9f 高度型）传 fillHeight。
 */
export function AdaptiveSheetContent(props: {
  children: ReactNode;
  fillHeight?: boolean;
  maxInnerWidth?: number;
  className?: string;
}) {
  const maxInnerWidth = props.maxInnerWidth ?? AdaptiveSpec.sheetMaxWidth;
  return (
    <div className={`adaptive-sheet ${props.className ?? ''}`.trim()} style={{ width: '100%' }}>
      <div
        className="adaptive-sheet__inner"
        style={{
          maxWidth: `${maxInnerWidth}px`,
          width: '100%',
          marginInline: 'auto',
          ...(props.fillHeight === true ? { height: '100%' } : {}),
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

/** 全屏滚动页内容宿主：平板/横屏居中限宽 720dp，手机全宽。 */
export function AdaptivePageContent(props: {
  children: ReactNode;
  maxInnerWidth?: number;
  className?: string;
}) {
  const maxInnerWidth = props.maxInnerWidth ?? AdaptiveSpec.pageContentMaxWidth;
  return (
    <div
      className={`adaptive-page ${props.className ?? ''}`.trim()}
      style={{ width: '100%', minHeight: '100%' }}
    >
      <div
        className="adaptive-page__inner"
        style={{
          ...adaptivePageWidthStyle(),
          maxWidth: `${maxInnerWidth}px`,
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

/** DesignTokens.kt line 57 — `fun shape(radius: Dp) = RoundedCornerShape(radius)`. */
export function shapeRadius(dp: number): string {
  return `${dp}px`;
}