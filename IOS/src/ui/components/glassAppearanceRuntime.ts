import {
  DEFAULT_CARD_TWEAKS,
  type CardTweaks,
} from '../../core/glass/cardTweaks';
import {
  renderQualityOf,
  type RenderQualityName,
} from '../../core/glass/renderQuality';
import { PreferencesManager, SettingsRepository } from '../../core/settings/settingsRepository';
import { getPlatform } from '../../platform';

/**
 * MainActivity.kt applies RenderQuality and CardTweaks for the whole UI tree.
 * This small external store gives the web port that same app-wide state without
 * requiring SettingsPage to own screens that are outside its route.
 */
export interface GlassAppearanceSnapshot {
  quality: RenderQualityName;
  tweaks: CardTweaks;
}

let snapshot: GlassAppearanceSnapshot = {
  quality: 'HIGH',
  tweaks: DEFAULT_CARD_TWEAKS,
};
const listeners = new Set<() => void>();
let loadStarted = false;
let qualityRevision = 0;
let tweaksRevision = 0;

export function subscribeGlassAppearance(listener: () => void): () => void {
  listeners.add(listener);
  void loadStoredGlassAppearance();
  return () => listeners.delete(listener);
}

export function getGlassAppearanceSnapshot(): GlassAppearanceSnapshot {
  return snapshot;
}

export function getGlassQualitySnapshot(): RenderQualityName {
  return snapshot.quality;
}

export function getGlassCardTweaksSnapshot(): CardTweaks {
  return snapshot.tweaks;
}

export function setRuntimeRenderQuality(id: number): void {
  qualityRevision += 1;
  snapshot = { ...snapshot, quality: renderQualityOf(id) };
  notify();
}

export function setRuntimeCardTweaks(tweaks: Partial<CardTweaks>): void {
  tweaksRevision += 1;
  snapshot = { ...snapshot, tweaks: { ...snapshot.tweaks, ...tweaks } };
  notify();
}

function notify(): void {
  for (const listener of listeners) listener();
}

async function loadStoredGlassAppearance(): Promise<void> {
  if (loadStarted) return;
  loadStarted = true;
  const qualityAtStart = qualityRevision;
  const tweaksAtStart = tweaksRevision;

  try {
    const prefs = new PreferencesManager(new SettingsRepository(getPlatform().db));
    const [
      quality,
      blurRadiusDp,
      cornerRadiusDp,
      tiltMaxDeg,
      cameraDistMult,
      rippleAlpha,
      tintMix,
      pressStrength,
      pressRadius,
      cardAlpha,
    ] = await Promise.all([
      prefs.renderQuality(),
      prefs.cardBlurRadiusDp(),
      prefs.cardCornerRadiusDp(),
      prefs.cardTiltMaxDeg(),
      prefs.cardCameraDistMult(),
      prefs.cardRippleAlpha(),
      prefs.cardTintMix(),
      prefs.cardPressStrength(),
      prefs.cardPressRadius(),
      prefs.cardAlpha(),
    ]);

    snapshot = {
      quality:
        qualityRevision === qualityAtStart ? renderQualityOf(quality) : snapshot.quality,
      tweaks:
        tweaksRevision === tweaksAtStart
          ? {
              blurRadiusDp,
              cornerRadiusDp,
              tiltMaxDeg,
              cameraDistMult,
              rippleAlpha,
              tintMix,
              pressStrength,
              pressRadius,
              cardAlpha,
            }
          : snapshot.tweaks,
    };
  } catch {
    // Keep Kotlin-equivalent defaults when the host preference store is not ready.
  }
  notify();
}
