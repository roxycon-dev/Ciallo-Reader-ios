import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  derivePin,
  enableWithPin,
  hashPinLegacy,
  isValidPin,
  newSaltHex,
  verifyPin,
  type PinStore,
} from '../../src/core/privacy/pinKdf';

function memoryStore(initial?: { salt?: string | null; hash?: string | null }): PinStore {
  let salt: string | null = initial?.salt ?? null;
  let hash: string | null = initial?.hash ?? null;
  let kdfVersion: 0 | 1 = 1;
  let failures = 0;
  let retryAfter = 0;
  let enabled = false;
  return {
    getSalt: () => salt,
    getHash: () => hash,
    getKdfVersion: () => kdfVersion,
    getFailures: () => failures,
    getRetryAfterMs: () => retryAfter,
    setPin(s, h, v) {
      salt = s;
      hash = h;
      kdfVersion = v;
    },
    recordFailure() {
      failures += 1;
      if (failures >= 5) {
        retryAfter = Date.now() + 30_000;
      }
      return failures;
    },
    clearFailures() {
      failures = 0;
      retryAfter = 0;
    },
    setEnabled(v) {
      enabled = v;
    },
    isEnabled: () => enabled,
    hasPin: () => salt !== null && hash !== null,
  };
}

describe('pinKdf — pure logic (no fixtures yet)', () => {
  it('validates 6-digit PINs', () => {
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('abcdef')).toBe(false);
  });

  it('generates 32-char hex salt', () => {
    const salt = newSaltHex();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it('hashPinLegacy is stable SHA-256(salt||pin)', async () => {
    // salt 16 bytes of 0x11, pin "123456"
    const salt = '11'.repeat(16);
    const a = await hashPinLegacy('123456', salt);
    const b = await hashPinLegacy('123456', salt);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derivePin is stable PBKDF2-HMAC-SHA1 @ 120k', async () => {
    const salt = '22'.repeat(16);
    const a = await derivePin('654321', salt);
    const b = await derivePin('654321', salt);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('legacy verify upgrades to modern KDF', async () => {
    const store = memoryStore();
    const salt = 'ab'.repeat(16);
    const legacyHash = await hashPinLegacy('123456', salt);
    store.setPin(salt, legacyHash, 0);
    const ok = await verifyPin('123456', { store });
    expect(ok).toBe(true);
    expect(store.getKdfVersion()).toBe(1);
    expect(store.getHash()).not.toBe(legacyHash);
  });

  it('enableWithPin + verifyPin roundtrip', async () => {
    const store = memoryStore();
    expect(await enableWithPin('123456', store)).toBe(true);
    expect(store.isEnabled()).toBe(true);
    expect(await verifyPin('123456', { store })).toBe(true);
    expect(await verifyPin('000000', { store })).toBe(false);
  });

  it('constantTimeEqual rejects different lengths', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('abcd', 'abcd')).toBe(true);
  });
});
