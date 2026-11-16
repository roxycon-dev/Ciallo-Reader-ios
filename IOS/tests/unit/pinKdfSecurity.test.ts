/**
 * SECURITY-CRITICAL PIN KDF pin-down.
 *
 * Android authority: `novel-reader/app/src/main/java/com/example/data/PrivacyManager.kt`
 *   - line 112..119 `derivePin`:
 *       PBEKeySpec(pin.toCharArray(), saltBytes, 120_000, 256)
 *       SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1")
 *   - line 29..35  `hashPin` (legacy): SHA-256(saltBytes || pinUtf8)
 *   - line 37..41  `newSaltHex`: SecureRandom 16 bytes -> 32 hex chars
 *   - line 72      `verifyPin` requires `salt.length == 32`
 *
 * The iteration count, PRF, derived-key length and salt width are the security
 * contract with the Android install. If any of these drift, a PIN set on one
 * platform stops verifying on the other. These tests pin every one of them with
 * *independently computed* expected values (Node `crypto.pbkdf2Sync` is the
 * oracle; it is a different code path from `crypto.subtle` used by the impl).
 */
import { createHash, pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PIN_KDF_BITS,
  PIN_KDF_ITERATIONS,
  PIN_LENGTH,
  PIN_MAX_FAILURES,
  PIN_RETRY_AFTER_MS,
  PIN_SALT_BYTES,
  bytesToHex,
  derivePin,
  hashPinLegacy,
  hexToBytes,
  isValidPin,
  newSaltHex,
} from '../../src/core/privacy/pinKdf';

// ── Oracle helpers (deliberately NOT the implementation under test) ──────────

const SALT_HEX = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';

function oraclePbkdf2(pin: string, saltHex: string, iterations: number, bits: number): string {
  return pbkdf2Sync(
    Buffer.from(pin, 'utf8'),
    Buffer.from(saltHex, 'hex'),
    iterations,
    bits / 8,
    'sha1',
  ).toString('hex');
}

function oracleLegacySha256(pin: string, saltHex: string): string {
  return createHash('sha256')
    .update(Buffer.from(saltHex, 'hex'))
    .update(Buffer.from(pin, 'utf8'))
    .digest('hex');
}

describe('pinKdf — constants match Android PrivacyManager', () => {
  it('iterates exactly 120,000 times (PBEKeySpec, line 114)', () => {
    expect(PIN_KDF_ITERATIONS).toBe(120_000);
  });

  it('derives 256-bit keys (PBEKeySpec keyLength, line 114)', () => {
    expect(PIN_KDF_BITS).toBe(256);
  });

  it('uses a 16-byte salt (ByteArray(16), line 38) => 32 hex chars (line 72 check)', () => {
    expect(PIN_SALT_BYTES).toBe(16);
    expect(newSaltHex()).toHaveLength(PIN_SALT_BYTES * 2);
  });

  it('keeps the 6-digit PIN length and 5-strike / 30s cooldown (lines 24, 82)', () => {
    expect(PIN_LENGTH).toBe(6);
    expect(PIN_MAX_FAILURES).toBe(5);
    expect(PIN_RETRY_AFTER_MS).toBe(30_000);
  });
});

describe('pinKdf — PBKDF2-HMAC-SHA1 output equals the independent oracle', () => {
  // Guards the PRF: HMAC-SHA1, not SHA-256. A silently swapped hash would still
  // produce "a" 64-char hex string and pass a naive shape assertion.
  const cases: Array<[string, string]> = [
    ['123456', '11111111111111111111111111111111'],
    ['000000', '22222222222222222222222222222222'],
    ['999999', '00112233445566778899aabbccddeeff'],
    ['654321', 'abababababababababababababababab'],
    ['123456', SALT_HEX],
    ['000001', SALT_HEX],
  ];

  for (const [pin, saltHex] of cases) {
    it(`derivePin(${pin}, ${saltHex})`, async () => {
      const expected = oraclePbkdf2(pin, saltHex, 120_000, 256);
      expect(await derivePin(pin, saltHex)).toBe(expected);
    });
  }

  it('is SHA-1 based, not SHA-256', async () => {
    const got = await derivePin('123456', SALT_HEX);
    // A SHA-256-PBKDF2 run over the same inputs must not coincide.
    expect(got).not.toBe(
      pbkdf2Sync(
        Buffer.from('123456', 'utf8'),
        Buffer.from(SALT_HEX, 'hex'),
        120_000,
        32,
        'sha256',
      ).toString('hex'),
    );
  });

  it('is sensitive to the iteration count (a 1-iteration run differs)', async () => {
    const got = await derivePin('123456', SALT_HEX);
    expect(got).not.toBe(oraclePbkdf2('123456', SALT_HEX, 1, 256));
  });

  it('is sensitive to the salt', async () => {
    const a = await derivePin('123456', SALT_HEX);
    const b = await derivePin('123456', '00'.repeat(16));
    expect(a).not.toBe(b);
  });

  it('produces 32 bytes rendered as 64 lowercase hex chars', async () => {
    const hex = await derivePin('123456', SALT_HEX);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(hexToBytes(hex)).toHaveLength(32);
  });

  it('treats the PIN as UTF-8 bytes (all-digits PIN is ASCII, so byte-identical)', async () => {
    // PBEKeySpec takes char[]; SunJCE encodes it as UTF-8 before HMAC.
    expect(await derivePin('123456', SALT_HEX)).toBe(oraclePbkdf2('123456', SALT_HEX, 120_000, 256));
  });
});

describe('pinKdf — legacy SHA-256(salt || pin) path', () => {
  it('matches the oracle for every fixture salt', async () => {
    const salts = [
      '11111111111111111111111111111111',
      '22222222222222222222222222222222',
      '00112233445566778899aabbccddeeff',
      'abababababababababababababababab',
      SALT_HEX,
    ];
    for (const salt of salts) {
      expect(await hashPinLegacy('123456', salt)).toBe(oracleLegacySha256('123456', salt));
    }
  });

  it('differs from the PBKDF2 output (legacy is NOT upgraded transparently)', async () => {
    expect(await hashPinLegacy('123456', SALT_HEX)).not.toBe(await derivePin('123456', SALT_HEX));
  });
});

describe('pinKdf — hex helpers round-trip', () => {
  it('bytesToHex / hexToBytes round-trip 16 bytes', () => {
    const bytes = hexToBytes(SALT_HEX);
    expect(bytes).toHaveLength(16);
    expect(bytesToHex(bytes)).toBe(SALT_HEX);
  });

  it('rejects odd-length hex (Android chunked(2) would silently drop it)', () => {
    expect(() => hexToBytes('abc')).toThrow(/even length/);
  });
});

describe('pinKdf — isValidPin matches pin.length == 6 && all digits', () => {
  it('accepts exactly 6 ASCII digits', () => {
    for (const pin of ['000000', '123456', '999999']) {
      expect(isValidPin(pin)).toBe(true);
    }
  });

  it('rejects wrong length, non-digits, and full-width digits', () => {
    // Kotlin: `pin.all { it in '0'..'9' }` — full-width '１' is NOT in that range.
    for (const pin of ['12345', '1234567', '', '12345a', 'abcdef', '１２３４５６', '123 456']) {
      expect(isValidPin(pin)).toBe(false);
    }
  });
});