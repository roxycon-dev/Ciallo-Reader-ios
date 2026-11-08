/**
 * EncryptedSecretStore — the "never silently degrade" contract.
 *
 * Android authority: `data/EncryptedSecretStore.kt`
 *   - line 8 KDoc: "A failed keystore never permits a plaintext read or write."
 *   - line 21-30 `read`: falls back to a legacy plain prefs value exactly ONCE,
 *     migrating it into the secure store and then REMOVING it from legacy.
 *     Every failure path is swallowed by `runCatching { }.getOrNull()` -> null.
 *   - line 31-34 `write`: `error("系统安全存储不可用，无法保存 API 密钥")` when the
 *     keystore is unavailable; `check(...) { "API 密钥保存失败" }` on commit failure.
 *     **Never** falls back to plain storage.
 *   - line 35 `remove`: `runCatching { ... }` — best effort, failures swallowed.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  EncryptedSecretStore,
  type LegacySharedPreferences,
} from '../../src/core/data/encryptedSecretStore';
import type { SecureStore } from '@platform/interfaces';

function memorySecure(): SecureStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async get(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
  };
}

function memoryLegacy(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  const legacy: LegacySharedPreferences = {
    getString: (key) => (map.has(key) ? (map.get(key) as string) : null),
    edit: () => ({
      putString: (key, value) => {
        map.set(key, value);
        return true;
      },
      remove: (key) => {
        map.delete(key);
        return true;
      },
    }),
  };
  return { legacy, map };
}

describe('EncryptedSecretStore.write — never degrades to plaintext', () => {
  it('stores a new value in the secure store', async () => {
    const secure = memorySecure();
    await new EncryptedSecretStore(secure).write('api_key', 'SECRET');
    expect(secure.map.get('api_key')).toBe('SECRET');
  });

  it('THROWS when the keystore is unavailable (Android line 32)', async () => {
    const store = new EncryptedSecretStore(null);
    await expect(store.write('api_key', 'SECRET')).rejects.toThrow(
      '系统安全存储不可用，无法保存 API 密钥',
    );
  });

  it('THROWS (does not swallow) when the secure set fails', async () => {
    const secure: SecureStore = {
      async get() {
        return null;
      },
      async set() {
        throw new Error('keystore exploded');
      },
      async remove() {},
    };
    await expect(new EncryptedSecretStore(secure).write('api_key', 'S')).rejects.toThrow(
      'API 密钥保存失败',
    );
  });

  it('skips the write when the value is unchanged (Android line 33 guard)', async () => {
    const secure = memorySecure();
    secure.map.set('api_key', 'SAME');
    const setSpy = vi.spyOn(secure, 'set');
    await new EncryptedSecretStore(secure).write('api_key', 'SAME');
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('overwrites when the value differs', async () => {
    const secure = memorySecure();
    secure.map.set('api_key', 'OLD');
    await new EncryptedSecretStore(secure).write('api_key', 'NEW');
    expect(secure.map.get('api_key')).toBe('NEW');
  });
});

describe('EncryptedSecretStore.read — secure value wins, legacy migrates once', () => {
  it('returns the secure value', async () => {
    const secure = memorySecure();
    secure.map.set('api_key', 'FROM_SECURE');
    const { legacy } = memoryLegacy({ api_key: 'FROM_LEGACY' });
    const store = new EncryptedSecretStore(secure, legacy);
    expect(await store.read('api_key')).toBe('FROM_SECURE');
    // Legacy copy must be left untouched when the secure value already exists.
    expect(legacy.getString('api_key')).toBe('FROM_LEGACY');
  });

  it('migrates a legacy plaintext value and REMOVES it from legacy', async () => {
    const secure = memorySecure();
    const { legacy } = memoryLegacy({ api_key: 'LEGACY_ONLY' });
    const store = new EncryptedSecretStore(secure, legacy);

    expect(await store.read('api_key')).toBe('LEGACY_ONLY');
    expect(secure.map.get('api_key')).toBe('LEGACY_ONLY');
    expect(legacy.getString('api_key')).toBeNull();
  });

  it('returns null when the key is absent everywhere', async () => {
    const secure = memorySecure();
    expect(await new EncryptedSecretStore(secure).read('missing')).toBeNull();
  });

  it('returns null (never plaintext) when the keystore is unavailable', async () => {
    const { legacy } = memoryLegacy({ api_key: 'LEGACY_ONLY' });
    // Android: `val secure = prefs ?: return@synchronized null` — the legacy
    // value must NOT be returned, because that would leak a secret in clear.
    expect(await new EncryptedSecretStore(null, legacy).read('api_key')).toBeNull();
  });

  it('returns null when migration into the secure store fails', async () => {
    const secure: SecureStore = {
      async get() {
        return null;
      },
      async set() {
        throw new Error('nope');
      },
      async remove() {},
    };
    const { legacy } = memoryLegacy({ api_key: 'LEGACY' });
    // Kotlin: `check(commit()) { "密钥迁移失败" }` throws inside runCatching -> null.
    expect(await new EncryptedSecretStore(secure, legacy).read('api_key')).toBeNull();
  });

  it('returns null when removing from legacy fails', async () => {
    const secure = memorySecure();
    const legacy: LegacySharedPreferences = {
      getString: () => 'LEGACY',
      edit: () => ({
        putString: () => true,
        remove: () => false, // commit() == false -> "旧密钥清理失败"
      }),
    };
    expect(await new EncryptedSecretStore(secure, legacy).read('api_key')).toBeNull();
  });

  it('a per-call legacy override is honoured', async () => {
    const secure = memorySecure();
    const { legacy } = memoryLegacy({ k: 'OVERRIDE' });
    const store = new EncryptedSecretStore(secure, null);
    expect(await store.read('k', legacy)).toBe('OVERRIDE');
  });
});

describe('EncryptedSecretStore.remove — best effort', () => {
  it('removes the key', async () => {
    const secure = memorySecure();
    secure.map.set('k', 'v');
    await new EncryptedSecretStore(secure).remove('k');
    expect(secure.map.has('k')).toBe(false);
  });

  it('swallows backend failures (Android runCatching)', async () => {
    const secure: SecureStore = {
      async get() {
        return null;
      },
      async set() {},
      async remove() {
        throw new Error('boom');
      },
    };
    await expect(new EncryptedSecretStore(secure).remove('k')).resolves.toBeUndefined();
  });

  it('is a no-op when the keystore is unavailable (null-safe chain)', async () => {
    await expect(new EncryptedSecretStore(null).remove('k')).resolves.toBeUndefined();
  });
});

describe('EncryptedSecretStore — no secret is ever written to legacy', () => {
  it('write() never touches the legacy prefs', async () => {
    const secure = memorySecure();
    const { legacy, map } = memoryLegacy();
    await new EncryptedSecretStore(secure, legacy).write('api_key', 'SECRET');
    expect(map.size).toBe(0);
    expect(secure.map.get('api_key')).toBe('SECRET');
  });
});