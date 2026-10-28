/**
 * Encrypted secret store — port of Android `EncryptedSecretStore.kt`.
 *
 * Android: EncryptedSharedPreferences (MasterKey AES256_GCM + AES256_SIV/GCM prefs).
 * iOS/web: platform `SecureStore` (iOS Keychain / MemorySecureStore).
 * A failed keystore never permits a plaintext read or write:
 *   - secure === null  → read returns null; write throws.
 * synchronized(lock) is implicit (JS single-threaded).
 */

import type { SecureStore } from '@platform/interfaces';

/** Legacy plain SharedPreferences used only for one-shot key migration. */
export interface LegacySharedPreferences {
  getString(key: string): string | null;
  edit(): {
    putString(key: string, value: string): boolean;
    remove(key: string): boolean;
  };
}

export class EncryptedSecretStore {
  constructor(
    /** null = keystore unavailable (EncryptedSharedPreferences.create failed). */
    private readonly secure: SecureStore | null,
    private readonly legacy: LegacySharedPreferences | null = null,
  ) {}

  async read(key: string, legacy: LegacySharedPreferences | null = this.legacy): Promise<string | null> {
    const secure = this.secure;
    if (!secure) return null;
    try {
      const current = await secure.get(key);
      if (current !== null && current !== undefined) {
        return current;
      }
      // Android: val old = legacy?.getString(key, null) ?: return@runCatching null
      if (legacy === null) return null;
      const old = legacy.getString(key);
      if (old === null) return null;
      try {
        await secure.set(key, old);
      } catch {
        // Android: check(secure.edit().putString(key, old).commit()) { "密钥迁移失败" }
        throw new Error('密钥迁移失败');
      }
      const removed = legacy.edit().remove(key);
      if (!removed) {
        throw new Error('旧密钥清理失败');
      }
      return old;
    } catch {
      // runCatching { ... }.getOrNull()
      return null;
    }
  }

  async write(key: string, value: string): Promise<void> {
    const secure = this.secure;
    if (!secure) {
      throw new Error('系统安全存储不可用，无法保存 API 密钥');
    }
    const current = await secure.get(key);
    if (current !== value) {
      // Android: check(secure.edit().putString(key, value).commit()) { "API 密钥保存失败" }
      try {
        await secure.set(key, value);
      } catch {
        throw new Error('API 密钥保存失败');
      }
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.secure?.remove(key);
    } catch {
      // runCatching swallow
    }
  }
}
