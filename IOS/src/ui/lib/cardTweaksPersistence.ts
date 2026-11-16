import type { CardTweaks } from '@core/glass/cardTweaks';
import type { SettingsRepository } from '@core/settings/settingsRepository';

/**
 * Android `PreferencesManager.writeCardTweaks` — all eight `card_*` keys.
 *
 * Shared by the Settings page (inline panel) and the standalone
 * `CardAppearancePage` route so both write the same persisted truth.
 */
export async function writeCardTweaks(
  settings: Pick<
    SettingsRepository,
    'setFloat'
  >,
  tweaks: CardTweaks,
): Promise<void> {
  await settings.setFloat('card_blur_dp', tweaks.blurRadiusDp);
  await settings.setFloat('card_corner_dp', tweaks.cornerRadiusDp);
  await settings.setFloat('card_tilt_deg', tweaks.tiltMaxDeg);
  await settings.setFloat('card_cam_mult', tweaks.cameraDistMult);
  await settings.setFloat('card_tint_mix', tweaks.tintMix);
  await settings.setFloat('card_press_s', tweaks.pressStrength);
  await settings.setFloat('card_press_r', tweaks.pressRadius);
  await settings.setFloat('card_alpha', tweaks.cardAlpha);
}
