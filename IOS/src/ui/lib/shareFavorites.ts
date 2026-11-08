import type { FavoriteEntity } from '@core/library/favoriteTypes';
import { favoriteShareText } from '@core/library/favoriteShare';
import { getLibraryRuntime } from '@core/library/libraryRuntime';
import { getPlatform } from '@platform/index';
import { SettingsRepository } from '@core/settings/settingsRepository';

export async function shareFavorites(works: readonly Pick<FavoriteEntity, 'sourceId' | 'comicId' | 'title'>[]): Promise<void> {
  const manager = getLibraryRuntime()?.sourceManager, platform = getPlatform();
  if (!manager) throw new Error('分享服务尚未准备好，请重试');
  const settings = new SettingsRepository(platform.db);
  const options = await favoriteShareText(works, (id) => manager.getSource(id), {
    get: async (key) => (await settings.getString(key, '')) || null, set: (key, value) => settings.setString(key, value),
  });
  await platform.shareText.shareText(options);
}
