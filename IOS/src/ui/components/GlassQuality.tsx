import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  RENDER_QUALITY_LIST,
  RenderQuality,
  realtimeGlass,
  renderQualityOf,
  type RenderQualityName,
} from '../../core/glass/renderQuality';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/GlassQuality.kt` (19 non-blank lines) — FULL PORT
 *   line 17-21 `enum class RenderQuality(val id: Int, val label: String)` → core/glass/renderQuality
 *   line 24    `val realtimeGlass: Boolean get() = id >= HIGH.id`        → core/glass/renderQuality
 *   line 27    `fun of(id: Int)`                                        → core/glass/renderQuality
 *   line 32    `val LocalRenderQuality = staticCompositionLocalOf { RenderQuality.HIGH }`
 *              → `RenderQualityProvider` + `useRenderQuality()` below.
 *
 * `staticCompositionLocalOf` maps onto React context; the default `{ HIGH }` is
 * preserved as `DEFAULT_RENDER_QUALITY`.
 */

export { RENDER_QUALITY_LIST, RenderQuality, renderQualityOf };
export type { RenderQualityName };

/** GlassQuality.kt line 32 — 未 provide 时回退 RenderQuality.HIGH。 */
export const DEFAULT_RENDER_QUALITY: RenderQualityName = 'HIGH';

const RenderQualityContext = createContext<RenderQualityName>(DEFAULT_RENDER_QUALITY);

/** `LocalRenderQuality provides …` — mount once near the app root. */
export function RenderQualityProvider(props: {
  quality: RenderQualityName;
  children: ReactNode;
}) {
  const value = useMemo(() => props.quality, [props.quality]);
  return (
    <RenderQualityContext.Provider value={value}>
      {props.children}
    </RenderQualityContext.Provider>
  );
}

/** `LocalRenderQuality.current` — reads the active quality tier. */
export function useRenderQuality(): RenderQualityName {
  return useContext(RenderQualityContext);
}

/** `LocalRenderQuality.current.realtimeGlass`. */
export function useRealtimeGlass(): boolean {
  return realtimeGlass(useRenderQuality());
}

/** Build the provider value straight from a persisted int (settings storage). */
export function renderQualityFromId(id: number): RenderQualityName {
  return renderQualityOf(id);
}

/** The four user-facing tier labels, verbatim: '流畅' / '均衡' / '高' / '极致'. */
export const RENDER_QUALITY_LABELS: readonly string[] = RENDER_QUALITY_LIST.map(
  (name) => RenderQuality[name].label,
);