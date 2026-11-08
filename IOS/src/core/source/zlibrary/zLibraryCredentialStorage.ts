/**
 * Kotlin → TS: `source/zlibrary/ZLibraryCredentialStorage.kt` (64 lines, 56 non-blank)
 *             → `src/core/source/zlibrary/zLibraryCredentialStorage.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary  → SKIPPED (TS has no packages)
 *   L3        import android.content.Context       → REPLACED by the injected `ZLibraryCredentialStore`
 *   L4        import android.content.SharedPreferences → same
 *   L5        import androidx.security.crypto.EncryptedSharedPreferences → same
 *   L6        import androidx.security.crypto.MasterKey → same
 *   L8        class ZLibraryCredentialStorage private constructor(preferencesFactory) → `class` taking a store
 *   L9-21     `constructor(context: Context)` — wipes the plaintext fallback prefs, builds an
 *             AES256_GCM MasterKey and an EncryptedSharedPreferences file with
 *             AES256_SIV keys / AES256_GCM values, `catch (_) { null }` on failure
 *                                                        → MOVED to the platform layer: the
 *                                                          `createEncryptedSecretStoreAdapter()` factory
 *                                                          below wires `EncryptedSecretStore`
 *                                                          (`src/core/data/encryptedSecretStore.ts`,
 *                                                          the existing port of
 *                                                          `EncryptedSecretStore.kt`) to this interface
 *   L23-24     `internal constructor(preferences)` test injection → the store parameter IS the injection point
 *   L25        `private val prefs by lazy(preferencesFactory)` → `readonly store` field (no lazy needed in TS)
 *   L27-40     fun saveCredentials(...)            → `saveCredentials(...)`, same 4 keys + same defaults
 *   L42-45     getUserId / getUserKey / getDomain / getCookies → verbatim
 *   L47-49     fun clear()                         → verbatim
 *   L51-55     fun isLoggedIn()                    → verbatim
 *   L57-63     companion object: DEFAULT_DOMAIN + the 4 KEY_ constants → module-level consts
 *   L64        closing brace                       → n/a
 *
 * Adaptations:
 *   - `SharedPreferences` / `EncryptedSharedPreferences` → the injected
 *     `ZLibraryCredentialStore` interface (`available` mirrors the Kotlin `prefs: SharedPreferences?`
 *     nullability, which is what drives the `error(…)` at L33). The keystore/algorithm
 *     construction (L9-21) is platform work and is provided by
 *     `createEncryptedSecretStoreAdapter`, which delegates every read/write to the existing
 *     `EncryptedSecretStore` port. `MasterKey`/`EncryptedSharedPreferences` have no TS API and
 *     are therefore NOT re-implemented here.
 *   - `SharedPreferences` is synchronous, `EncryptedSecretStore` is async → every method below
 *     returns a `Promise`. All call sites in this module are already async.
 *   - `edit().putString(key, null)` REMOVES the key in Android; the adapter maps a null value
 *     to `SecureStore.remove`, and `available === false` reproduces the `?: null` reads.
 *   - `runCatching { … }.getOrNull()` → try/catch returning null.
 *   - `error("系统安全存储不可用，无法保存登录凭据，请修复系统密钥后重试")` → `throw new Error(<same text>)`.
 *     NOTE this is intentionally NOT `EncryptedSecretStore.write`'s own message
 *     ("系统安全存储不可用，无法保存 API 密钥") — the Android wording is preserved verbatim and the
 *     availability check is done here so the two never blur.
 */

import {
  EncryptedSecretStore,
  type LegacySharedPreferences,
} from '../../data/encryptedSecretStore';
import type { SecureStore } from '@platform/interfaces';

/**
 * Injected replacement for `SharedPreferences` / `EncryptedSharedPreferences`.
 * `available === false` mirrors the Kotlin `prefs: SharedPreferences?` being null.
 */
export interface ZLibraryCredentialStore {
  readonly available: boolean;
  getString(key: string): Promise<string | null>;
  /** Kotlin `edit().putString(key, value ?: null)` — a null value removes the key. */
  putString(key: string, value: string | null): Promise<void>;
  /** Kotlin `edit().clear()`. */
  clear(): Promise<void>;
}

/**
 * Wires the existing `EncryptedSecretStore` port (AES256_SIV keys / AES256_GCM values on
 * Android, `SecureStore` on iOS/web) to the `SharedPreferences` shape the Kotlin class uses.
 * This is the port of the `constructor(context)` block at Kotlin L9-21 minus the
 * AndroidKeyStore bootstrap, which the platform layer owns.
 */
export function createEncryptedSecretStoreAdapter(
  secure: SecureStore | null,
  legacy: LegacySharedPreferences | null = null,
): ZLibraryCredentialStore {
  const store = new EncryptedSecretStore(secure, legacy);
  return {
    available: secure !== null,
    async getString(key: string): Promise<string | null> {
      return store.read(key);
    },
    async putString(key: string, value: string | null): Promise<void> {
      if (value === null) {
        // Android: `edit().putString(key, null)` deletes the key.
        await store.remove(key);
        return;
      }
      await store.write(key, value);
    },
    async clear(): Promise<void> {
      for (const key of [KEY_USER_ID, KEY_USER_KEY, KEY_DOMAIN, KEY_COOKIES]) {
        await store.remove(key);
      }
    },
  };
}

export class ZLibraryCredentialStorage {
  constructor(
    // Test injection exercises cookie semantics independently of secure-store support.
    private readonly store: ZLibraryCredentialStore,
  ) {}

  async saveCredentials(params: {
    userId?: string | null;
    userKey?: string | null;
    domain?: string;
    cookies?: string | null;
  } = {}): Promise<void> {
    const userId = params.userId ?? null;
    const userKey = params.userKey ?? null;
    const domain = params.domain ?? DEFAULT_DOMAIN;
    const cookies = params.cookies ?? null;
    if (!this.store.available) {
      throw new Error('系统安全存储不可用，无法保存登录凭据，请修复系统密钥后重试');
    }
    await this.store.putString(KEY_USER_ID, userId);
    await this.store.putString(KEY_USER_KEY, userKey);
    await this.store.putString(KEY_DOMAIN, domain.trim() === '' ? DEFAULT_DOMAIN : domain);
    await this.store.putString(KEY_COOKIES, cookies);
  }

  async getUserId(): Promise<string | null> {
    return this.safeRead(KEY_USER_ID);
  }

  async getUserKey(): Promise<string | null> {
    return this.safeRead(KEY_USER_KEY);
  }

  async getDomain(): Promise<string> {
    const stored = await this.safeRead(KEY_DOMAIN);
    return stored === null ? DEFAULT_DOMAIN : stored;
  }

  async getCookies(): Promise<string | null> {
    return this.safeRead(KEY_COOKIES);
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }

  async isLoggedIn(): Promise<boolean> {
    const cookies = await this.getCookies();
    const userKey = await this.getUserKey();
    return (
      (cookies !== null && cookies.trim() !== '' &&
        (cookies.includes('remix_userkey') || cookies.includes('remix_userid'))) ||
      (userKey !== null && userKey.trim() !== '')
    );
  }

  /** Kotlin `runCatching { prefs?.getString(key, null) }.getOrNull()`. */
  private async safeRead(key: string): Promise<string | null> {
    try {
      return await this.store.getString(key);
    } catch {
      return null;
    }
  }
}

/** Kotlin `const val DEFAULT_DOMAIN = "1lib.sk"` (L58, comment preserved). */
export const DEFAULT_DOMAIN =
  '1lib.sk'; // 2026-09-04 实测：唯一正确官网（rpc.php/eapi/搜索/下载全链路已验证）；z-lib.li 等为仿冒站

/** Kotlin `private const val KEY_USER_ID = "userId"`. */
const KEY_USER_ID = 'userId';
/** Kotlin `private const val KEY_USER_KEY = "userKey"`. */
const KEY_USER_KEY = 'userKey';
/** Kotlin `private const val KEY_DOMAIN = "domain"`. */
const KEY_DOMAIN = 'domain';
/** Kotlin `private const val KEY_COOKIES = "cookies"`. */
const KEY_COOKIES = 'cookies';
