import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  RENDER_QUALITY_LIST,
  RenderQuality,
  realtimeGlass,
  renderQualityOf,
  type RenderQualityName,
} from '../../core/glass/renderQuality';
import {
  getGlassQualitySnapshot,
  subscribeGlassAppearance,
} from './glassAppearanceRuntime';

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
 * `staticCompositionLocalOf` maps onto React context; when no explicit provider
 * exists the hook reads the live persisted quality from `glassAppearanceRuntime`.
 */

export { RENDER_QUALITY_LIST, RenderQuality, renderQualityOf };
export type { RenderQualityName };

/** GlassQuality.kt default — also used before the preference runtime hydrates. */
export const DEFAULT_RENDER_QUALITY: RenderQualityName = 'HIGH';

const RenderQualityContext = createContext<RenderQualityName | null>(null);

/** Optional scoped override for previews and isolated surfaces. */
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

/** `LocalRenderQuality.current` — reads an override or the persisted live tier. */
export function useRenderQuality(): RenderQualityName {
  const providedQuality = useContext(RenderQualityContext);
  const runtimeQuality = useSyncExternalStore(
    subscribeGlassAppearance,
    getGlassQualitySnapshot,
    getGlassQualitySnapshot,
  );
  return providedQuality ?? runtimeQuality;
}

/** `LocalRenderQuality.current.realtimeGlass`. */
export function useRealtimeGlass(): boolean {
  return realtimeGlass(useRenderQuality());
}

/** Build the provider value straight from a persisted int (settings storage). */
export function renderQualityFromId(id: number): RenderQualityName {
  return renderQualityOf(id);
}

/** The five user-facing tier labels, including Android's minimal fallback. */
export const RENDER_QUALITY_LABELS: readonly string[] = RENDER_QUALITY_LIST.map(
  (name) => RenderQuality[name].label,
);
