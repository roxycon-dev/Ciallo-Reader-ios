import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeychainSecureStore } from '@platform/ios-native/secureStore';

const state = vi.hoisted(() => ({
  native: new Map<string, string>(),
  legacy: new Map<string, string>(),
  fail: false,
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: state.legacy.get(key) ?? null }),
    remove: async ({ key }: { key: string }) => {
      state.legacy.delete(key);
    },
  },
}));
vi.mock('@capacitor/core', () => ({
  registerPlugin: (name: string) => {
    if (name !== 'ReaderKeychain') throw new Error('wrong plugin registration');
    return {
      get: async ({ key }: { key: string }) => {
        if (state.fail) throw new Error('keychain locked');
        return { value: state.native.get(key) ?? null };
      },
      set: async ({ key, value }: { key: string; value: string }) => {
        if (state.fail) throw new Error('keychain locked');
        state.native.set(key, value);
      },
      remove: async ({ key }: { key: string }) => {
        if (state.fail) throw new Error('keychain locked');
        state.native.delete(key);
      },
    };
  },
}));

describe('native Keychain migration', () => {
  beforeEach(() => {
    state.native.clear();
    state.legacy.clear();
    state.fail = false;
  });

  it('moves a legacy secret to Keychain before deleting the plaintext copy', async () => {
    state.legacy.set('token', '旧凭据');
    expect(await new KeychainSecureStore().get('token')).toBe('旧凭据');
    expect(state.native.get('token')).toBe('旧凭据');
    expect(state.legacy.has('token')).toBe(false);
  });

  it('never falls back to plaintext if the Keychain is unavailable', async () => {
    state.legacy.set('token', '旧凭据');
    state.fail = true;
    await expect(new KeychainSecureStore().get('token')).rejects.toThrow('keychain locked');
    expect(state.legacy.get('token')).toBe('旧凭据');
  });

  it('keeps an authoritative Keychain value and cleans up a stale legacy value', async () => {
    state.native.set('token', '新凭据');
    state.legacy.set('token', '旧凭据');
    expect(await new KeychainSecureStore().get('token')).toBe('新凭据');
    expect(state.legacy.has('token')).toBe(false);
  });

  it('serializes migration, replacement and deletion without resurrecting old credentials', async () => {
    state.legacy.set('token', 'old');
    const store = new KeychainSecureStore();
    const read = store.get('token');
    const write = store.set('token', 'new');
    const remove = store.remove('token');
    await Promise.all([read, write, remove]);
    expect(await store.get('token')).toBeNull();
    expect(state.native.has('token')).toBe(false);
    expect(state.legacy.has('token')).toBe(false);
  });

  it('retries a failed operation rather than poisoning the per-key queue', async () => {
    const store = new KeychainSecureStore();
    state.fail = true;
    await expect(store.set('token', 'value')).rejects.toThrow();
    state.fail = false;
    await store.set('token', 'value');
    expect(await store.get('token')).toBe('value');
  });
});
