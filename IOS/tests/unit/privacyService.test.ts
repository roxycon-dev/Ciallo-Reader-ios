import { describe, expect, it, vi } from 'vitest';
import { createHash, pbkdf2Sync } from 'node:crypto';
import { PrivacyService } from '@core/privacy/privacyService';
import { MemorySecureStore } from '@platform/web-mock/memorySecureStore';
import { derivePin, hashPinLegacy } from '@core/privacy/pinKdf';

describe('persisted privacy authorization', () => {
  it('derives the same PIN hash in iOS custom schemes without Web Crypto subtle', async () => {
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: original.getRandomValues.bind(original) });
    try {
      const salt = '00112233445566778899aabbccddeeff';
      expect(await derivePin('123456', salt)).toBe(pbkdf2Sync('123456', Buffer.from(salt, 'hex'), 120_000, 32, 'sha1').toString('hex'));
      expect(await hashPinLegacy('123456', salt)).toBe(createHash('sha256').update(Buffer.concat([Buffer.from(salt, 'hex'), Buffer.from('123456')])).digest('hex'));
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not unlock a scope if the app locks while verification is in flight', async () => {
    const service = new PrivacyService(new MemorySecureStore()); await service.enable('123456');
    const pending = service.unlockFavorites('123456'); service.lock();
    expect(await pending).toBe(false); expect(service.getSnapshot().favoritesUnlocked).toBe(false);
  });
  it('stores an Android-compatible derived hash and verifies the actual PIN after restarting', async () => {
    const secure = new MemorySecureStore(), service = new PrivacyService(secure);
    expect(await service.enable('123456')).toBe(true);
    const record = JSON.parse((await secure.get('privacy.pin.v1'))!) as { salt: string; hash: string; kdf: number };
    expect(record.hash).toBe(pbkdf2Sync('123456', Buffer.from(record.salt, 'hex'), 120_000, 32, 'sha1').toString('hex')); expect(record.kdf).toBe(1);
    const restored = new PrivacyService(secure); expect((await restored.ready()).enabled).toBe(true);
    expect(await restored.verify('654321')).toBe(false); expect(await restored.verify('123456')).toBe(true);
    expect(await restored.enable('654321')).toBe(false);
  });
  it('serializes concurrent failures and preserves a five-attempt cooldown across restart', async () => {
    const secure = new MemorySecureStore(); let now = Date.now(); const service = new PrivacyService(secure, () => now);
    await service.enable('123456'); expect(await Promise.all(Array.from({ length: 5 }, () => service.verify('654321')))).toEqual([false, false, false, false, false]);
    const restored = new PrivacyService(secure, () => now); expect((await restored.ready()).failures).toBe(5); expect(await restored.verify('123456')).toBe(false);
    now += 30_001; expect(await restored.verify('123456')).toBe(true); expect(restored.getSnapshot().failures).toBe(0);
  });
  it('changes and disables protection only after validating the old PIN', async () => {
    const service = new PrivacyService(new MemorySecureStore()); await service.enable('123456');
    expect(await service.change('000000', '654321')).toBe(false); expect(await service.change('123456', '654321')).toBe(true);
    expect(await service.verify('123456')).toBe(false); expect(await service.disable('123456')).toBe(false);
    expect(service.getSnapshot().enabled).toBe(true); expect(await service.disable('654321')).toBe(true); expect(service.getSnapshot().enabled).toBe(false);
  });
  it('authorizes only the selected scope and clears authorization on lock and restart', async () => {
    const secure = new MemorySecureStore(), service = new PrivacyService(secure); await service.enable('123456');
    expect(await service.unlockCategory(7, '123456')).toBe(true); expect(service.getSnapshot()).toMatchObject({ unlockedCategoryIds: [7], favoritesUnlocked: false });
    expect(await service.unlockFavorites('654321')).toBe(false); expect(await service.unlockFavorites('123456')).toBe(true);
    service.lock(); expect(service.getSnapshot()).toMatchObject({ unlockedCategoryIds: [], favoritesUnlocked: false });
    expect((await new PrivacyService(secure).ready()).favoritesUnlocked).toBe(false);
  });
  it('publishes no successful setup if secure persistence fails and permits a retry', async () => {
    const secure = new MemorySecureStore(); let fail = true;
    const service = new PrivacyService({ get: (key) => secure.get(key), set: async (key, value) => { if (fail) throw new Error('Keychain unavailable'); await secure.set(key, value); }, remove: (key) => secure.remove(key) });
    await expect(service.enable('123456')).rejects.toThrow('Keychain'); expect(service.getSnapshot().enabled).toBe(false);
    fail = false; expect(await service.enable('123456')).toBe(true);
  });
  it('upgrades a legacy SHA-256 PIN only after successful verification', async () => {
    const secure = new MemorySecureStore(), salt = '00112233445566778899aabbccddeeff';
    await secure.set('privacy.pin.v1', JSON.stringify({ salt, hash: await hashPinLegacy('123456', salt), kdf: 0, failures: 0, retryAfter: 0, enabled: true }));
    const service = new PrivacyService(secure); expect(await service.verify('123456')).toBe(true);
    expect(JSON.parse((await secure.get('privacy.pin.v1'))!).kdf).toBe(1);
  });
  it('refuses a damaged record instead of silently disabling existing protection', async () => {
    const secure = new MemorySecureStore(); await secure.set('privacy.pin.v1', '{damaged');
    await expect(new PrivacyService(secure).ready()).rejects.toThrow('未解除保护');
  });
});
