import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  DEFAULT_CARD_TWEAKS,
  cardCameraDistance,
  glassThicknessGains,
  rescaleCornerRadius,
  type CardTweaks,
} from '../../core/glass/cardTweaks';
import {
  getGlassCardTweaksSnapshot,
  subscribeGlassAppearance,
} from './glassAppearanceRuntime';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/CardTweaks.kt` (42 non-blank lines)
 *   lines 13-28 `data class CardTweaks(...)` → core/glass/cardTweaks#CardTweaks
 *   line 31     `val LocalCardTweaks = staticCompositionLocalOf { CardTweaks() }`
 *               → `CardTweaksProvider` + `useCardTweaks()` below; its unprovided
 *               value is hydrated from the shared appearance runtime.
 *
 * The preferences accessors are read by `glassAppearanceRuntime`; SettingsPage
 * writes the same persisted keys and publishes optimistic values to that store.
 *
 * The pure derivations from the Kotlin comments are ported too:
 * - `rescaleCorners` (GlassCard.kt 202-214) → `rescaleCornerRadius`
 * - 毛玻璃厚度感知补偿 (GlassCard.kt 816-818) → `glassThicknessGains`
 * - 相机距离 (GlassCard.kt 436-437) → `cardCameraDistance`
 */

export type { CardTweaks };
export {
  DEFAULT_CARD_TWEAKS,
  cardCameraDistance,
  glassThicknessGains,
  rescaleCornerRadius,
};

const CardTweaksContext = createContext<CardTweaks | null>(null);

/** Optional scoped override for previews and isolated surfaces. */
export function CardTweaksProvider(props: {
  tweaks?: Partial<CardTweaks>;
  children: ReactNode;
}) {
  const value = useMemo<CardTweaks>(
    () => ({ ...DEFAULT_CARD_TWEAKS, ...(props.tweaks ?? {}) }),
    [props.tweaks],
  );
  return (
    <CardTweaksContext.Provider value={value}>{props.children}</CardTweaksContext.Provider>
  );
}

/** `LocalCardTweaks.current` — reads an override or the persisted shared tweaks. */
export function useCardTweaks(): CardTweaks {
  const providedTweaks = useContext(CardTweaksContext);
  const runtimeTweaks = useSyncExternalStore(
    subscribeGlassAppearance,
    getGlassCardTweaksSnapshot,
    getGlassCardTweaksSnapshot,
  );
  return providedTweaks ?? runtimeTweaks;
}
