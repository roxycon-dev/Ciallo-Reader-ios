/**
 * Safe setting key filter — port of Android `BackupArchive.safeSetting`.
 * Excludes credentials and other sensitive preference keys from backup/restore.
 */

export const SAFE_SETTING_EXCLUSION = new RegExp(
  '(cookie|token|password|credential|secret|api.?key|pin_|salt|auth)',
  'i',
);

export function isSafeSettingKey(key: string): boolean {
  return !SAFE_SETTING_EXCLUSION.test(key);
}
