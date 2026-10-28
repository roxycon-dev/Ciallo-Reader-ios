import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  DEFAULT_CARD_TWEAKS,
  cardCameraDistance,
  glassThicknessGains,
  rescaleCornerRadius,
  type CardTweaks,
} from '../../core/glass/cardTweaks';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/CardTweaks.kt` (42 non-blank lines)
 *   lines 13-28 `data class CardTweaks(...)` → core/glass/cardTweaks#CardTweaks
 *   line 31     `val LocalCardTweaks = staticCompositionLocalOf { CardTweaks() }`
 *               → `CardTweaksProvider` + `useCardTweaks()` below
 *
 * SKIPPED (data layer, owned by the settings agent):
 * - lines 34-44 `PreferencesManager.readCardTweaks()`
 * - lines 47-57 `PreferencesManager.writeCardTweaks(t)`
 * Both are 9-field copies onto `PreferencesManager`; the settings store reads and
 * writes the same keys, so no logic is lost. See report.
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

const CardTweaksContext = createContext<CardTweaks>(DEFAULT_CARD_TWEAKS);

/** `LocalCardTweaks provides …` — mount once near the app root. */
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

/** `LocalCardTweaks.current` — 未 provide 时回退历史视觉（CardTweaks.kt line 31）。 */
export function useCardTweaks(): CardTweaks {
  return useContext(CardTweaksContext);
}