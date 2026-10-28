import type { SourceManager } from '@core/source/sourceManager';
import { DiscoverController } from '@core/discover/controller';
import { DiscoverStore } from '@core/discover/store';
import type { DiscoverPartition } from '@core/discover/models';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { getPlatform } from '@platform/index';

const runtimes = new WeakMap<SourceManager, Map<DiscoverPartition, Promise<DiscoverController>>>();
export function getDiscoverRuntime(manager: SourceManager, partition: DiscoverPartition): Promise<DiscoverController> {
  let partitions = runtimes.get(manager);
  if (!partitions) { partitions = new Map(); runtimes.set(manager, partitions); }
  const existing = partitions.get(partition); if (existing) return existing;
  const creating = (async () => {
    await manager.initialize(); const platform = getPlatform(), settings = new SettingsRepository(platform.db);
    const store = new DiscoverStore(partition, {
      get: async (key) => (await settings.getString(key, '')) || null,
      set: (key, value) => settings.setString(key, value),
    }, platform.fs);
    await store.load(); return new DiscoverController(manager, store, partition);
  })().catch((error: unknown) => { partitions!.delete(partition); throw error; });
  partitions.set(partition, creating); return creating;
}
