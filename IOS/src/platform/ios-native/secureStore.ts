import { Preferences } from '@capacitor/preferences';
import { nonThenablePlugin } from './pluginProxy';
import type { SecureStore } from '@platform/interfaces';

interface KeychainPlugin {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

/** Keychain storage with a one-way migration from the previous UserDefaults store. */
export class KeychainSecureStore implements SecureStore {
  private plugin: Promise<KeychainPlugin> | null = null;
  private readonly pending = new Map<string, Promise<unknown>>();

  private getPlugin(): Promise<KeychainPlugin> {
    this.plugin ??= import('@capacitor/core').then(({ registerPlugin }) =>
      nonThenablePlugin(registerPlugin<KeychainPlugin>('ReaderKeychain')),
    );
    return this.plugin;
  }

  // Migration, writes and deletion for one key cannot overtake each other.
  private serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
    const next = (this.pending.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
    this.pending.set(key, next);
    void next
      .finally(() => {
        if (this.pending.get(key) === next) this.pending.delete(key);
      })
      .catch(() => {});
    return next;
  }

  get(key: string): Promise<string | null> {
    return this.serialize(key, async () => {
      const plugin = await this.getPlugin();
      const { value } = await plugin.get({ key });
      if (value !== null) {
        await Preferences.remove({ key });
        return value;
      }
      const legacy = await Preferences.get({ key });
      if (legacy.value === null) return null;
      // Never return a plaintext secret when Keychain rejected the migration.
      await plugin.set({ key, value: legacy.value });
      await Preferences.remove({ key });
      return legacy.value;
    });
  }

  set(key: string, value: string): Promise<void> {
    return this.serialize(key, async () => {
      await (await this.getPlugin()).set({ key, value });
      await Preferences.remove({ key });
    });
  }

  remove(key: string): Promise<void> {
    return this.serialize(key, async () => {
      // Remove the old copy first so a later read cannot resurrect a deleted key.
      await Preferences.remove({ key });
      await (await this.getPlugin()).remove({ key });
    });
  }
}
