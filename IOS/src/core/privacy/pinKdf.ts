/**
 * PIN KDF — authoritative port of Android `PrivacyManager` (Phase 0 audit).
 *
 * Android source:
 *   PrivacyManager.hashPin: SHA-256(saltBytes || pinBytes) hex
 *   PrivacyManager.derivePin: PBKDF2WithHmacSHA1(pin, saltBytes, 120_000, 256) hex
 *   verify: constant-time compare; >=5 failures → 30_000ms cooldown
 *
 * This module is pure TS (no DOM/Capacitor). Storage side-effects live in platform/.
 */

export const PIN_LENGTH = 6;
export const PIN_KDF_ITERATIONS = 120_000;
export const PIN_KDF_BITS = 256;
export const PIN_SALT_BYTES = 16;
export const PIN_RETRY_AFTER_MS = 30_000;
export const PIN_MAX_FAILURES = 5;

export function isValidPin(pin: string): boolean {
  return pin.length === PIN_LENGTH && /^[0-9]+$/.test(pin);
}

export function newSaltHex(random: () => Uint8Array = defaultRandom): string {
  const bytes = random();
  if (bytes.length !== PIN_SALT_BYTES) {
    throw new Error(`salt must be ${PIN_SALT_BYTES} bytes, got ${bytes.length}`);
  }
  return bytesToHex(bytes);
}

function defaultRandom(): Uint8Array {
  const bytes = new Uint8Array(PIN_SALT_BYTES);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('hex string must have even length');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const pair = hex.slice(i * 2, i * 2 + 2);
    const value = Number.parseInt(pair, 16);
    if (Number.isNaN(value)) {
      throw new Error(`invalid hex pair: ${pair}`);
    }
    out[i] = value;
  }
  return out;
}

/** SHA-256(salt || pin) hex — legacy Android path (`hashPin`). */
export async function hashPinLegacy(pin: string, saltHex: string): Promise<string> {
  const salt = hexToBytes(saltHex);
  const pinBytes = new TextEncoder().encode(pin);
  const data = new Uint8Array(salt.length + pinBytes.length);
  data.set(salt, 0);
  data.set(pinBytes, salt.length);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * PBKDF2-HMAC-SHA1, 120_000 iterations, 256-bit key — modern Android path.
 * Web Crypto requires extractable=false; we export raw key bytes as hex.
 */
export async function derivePin(pin: string, saltHex: string): Promise<string> {
  const salt = hexToBytes(saltHex);
  const pinBytes = new TextEncoder().encode(pin);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    pinBytes as unknown as BufferSource,
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PIN_KDF_ITERATIONS,
      hash: 'SHA-1',
    },
    baseKey,
    PIN_KDF_BITS,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** Constant-time string compare (Android `verifyPin` OR-diff shape). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface PinStore {
  getSalt(): string | null;
  getHash(): string | null;
  getKdfVersion(): 0 | 1;
  getFailures(): number;
  getRetryAfterMs(): number;
  setPin(salt: string, hash: string, kdfVersion: 0 | 1): void;
  recordFailure(): number;
  clearFailures(): void;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  hasPin(): boolean;
}

export interface PinVerifierDeps {
  store: PinStore;
  now?: () => number;
}

export async function verifyPin(pin: string, deps: PinVerifierDeps): Promise<boolean> {
  const { store } = deps;
  const now = deps.now ?? (() => Date.now());
  const salt = store.getSalt();
  const stored = store.getHash();
  if (!salt || !stored) {
    return false;
  }
  if (!isValidPin(pin) || salt.length !== 32 || !/^[0-9a-fA-F]+$/.test(salt)) {
    return false;
  }
  if (now() < store.getRetryAfterMs()) {
    return false;
  }
  const modern = store.getKdfVersion() === 1;
  const candidate = modern ? await derivePin(pin, salt) : await hashPinLegacy(pin, salt);
  // AUDIT FIX: Android `verifyPin` returns early on a length mismatch **before** the
  // XOR diff loop, so it does NOT increment `pin_failures` for that case. The first TS
  // pass relied on `constantTimeEqual` alone and therefore counted a length mismatch as
  // a failed attempt (5 mismatches would lock the user out for 30 s). Both candidates are
  // 64 hex chars in practice, but the guard is what Android does.
  if (candidate.length !== (stored?.length ?? 0)) {
    return false;
  }
  if (!constantTimeEqual(candidate, stored)) {
    store.recordFailure();
    return false;
  }
  if (!modern) {
    const upgraded = await derivePin(pin, salt);
    store.setPin(salt, upgraded, 1);
  }
  store.clearFailures();
  return true;
}

export async function enableWithPin(pin: string, store: PinStore): Promise<boolean> {
  if (!isValidPin(pin)) {
    return false;
  }
  const salt = newSaltHex();
  const hash = await derivePin(pin, salt);
  store.setPin(salt, hash, 1);
  store.setEnabled(true);
  return true;
}

/** Android `PrivacyManager.pinLength()`. */
export function pinLength(): number {
  return PIN_LENGTH;
}

/** Android `PrivacyManager.isEnabled()`. */
export function isEnabled(store: PinStore): boolean {
  return store.isEnabled();
}

/** Android `PrivacyManager.hasPin()`. */
export function hasPin(store: PinStore): boolean {
  return store.hasPin();
}

/** Android `PrivacyManager.changePin(oldPin, newPin)` — verify old, then rotate salt + hash. */
export async function changePin(
  oldPin: string,
  newPin: string,
  store: PinStore,
): Promise<boolean> {
  if (!(await verifyPin(oldPin, { store })) || !isValidPin(newPin)) {
    return false;
  }
  const salt = newSaltHex();
  const hash = await derivePin(newPin, salt);
  store.setPin(salt, hash, 1);
  return true;
}

/**
 * Android `PrivacyManager.disable(pin)` — 关闭隐私模式（需先验证 PIN；
 * 分类保护标记保留在 DB，开关关闭期间不生效）。
 */
export async function disable(pin: string, store: PinStore): Promise<boolean> {
  if (!(await verifyPin(pin, { store }))) {
    return false;
  }
  store.setEnabled(false);
  return true;
}

/* ---------------------------------------------------------------------------
 * PrivacyManager façade — audit addendum.
 *
 * Android `PrivacyManager.kt` (122 lines total, 112 non-blank) has TWO layers: the
 * SharedPreferences-backed class (`isEnabled`, `hasPin`, `enableWithPin`, `verifyPin`,
 * `changePin`, `disable`, `isValidPin`) and the pure `companion object` maths
 * (`hashPin`, `newSaltHex`, `pinLength`). The maths + every function body was already
 * ported above as free functions, but the CLASS itself was missing, so callers had no
 * single object to hold. This adds it as a thin façade over a {@link PinStore} — no
 * behaviour is new.
 *
 * Storage key parity (Android lines 18..24, 61..62, 73..74, 86, 134, 137):
 *   prefs file          "privacy_prefs"
 *   KEY_ENABLED         "privacy_mode_enabled"        (default false)
 *   KEY_PIN_HASH        "privacy_pin_hash"
 *   KEY_PIN_SALT        "privacy_pin_salt"
 *   "pin_kdf_version"   1
 *   "pin_failures"      (default 0)
 *   "pin_retry_after"   (default 0, ms epoch)
 *   PIN_LENGTH          6
 * --------------------------------------------------------------------------- */

/** Android `PrivacyManager` SharedPreferences keys (lines 21..24 plus the inline ones). */
export const PRIVACY_PREFS_NAME = 'privacy_prefs';
export const KEY_ENABLED = 'privacy_mode_enabled';
export const KEY_PIN_HASH = 'privacy_pin_hash';
export const KEY_PIN_SALT = 'privacy_pin_salt';
export const KEY_PIN_KDF_VERSION = 'pin_kdf_version';
export const KEY_PIN_FAILURES = 'pin_failures';
export const KEY_PIN_RETRY_AFTER = 'pin_retry_after';

/** Android's chained `prefs.edit().putX(...).putY(...)` builder. */
export interface PrivacyEditor {
  putBoolean(key: string, value: boolean): PrivacyEditor;
  putInt(key: string, value: number): PrivacyEditor;
  putLong(key: string, value: number): PrivacyEditor;
  putString(key: string, value: string): PrivacyEditor;
  /** `apply()` / `commit()` — both are fire-and-forget here (single-threaded JS). */
  apply(): void;
  commit(): boolean;
}

/** Minimal synchronous string/number store (`SharedPreferences` shape). */
export interface PrivacyPrefs {
  getBoolean(key: string, fallback: boolean): boolean;
  getInt(key: string, fallback: number): number;
  getLong(key: string, fallback: number): number;
  getString(key: string): string | null;
  edit(): PrivacyEditor;
}

/**
 * 隐私模式管理器（第七轮第 6.4 条）。
 *
 * - 全局 6 位数字 PIN：首次开启隐私模式时设置（输入 + 二次确认）；
 * - 存储做基本安全处理：随机盐 + PBKDF2（兼容旧 SHA-256 并在验证后升级），不落明文（补充说明第 3 条）；
 * - 开关状态持久化——重启 App 后受保护分类仍需 PIN 验证；
 * - 无痕浏览（6.5）语义由 MainViewModel 按"隐私模式开启 且 书籍所在分类受保护"
 *   判定，本类只提供开关与校验。
 *
 * Port of Android `PrivacyManager` (lines 16..122) onto the pure helpers above.
 */
export class PrivacyManager {
  constructor(private readonly prefs: PrivacyPrefs) {}

  /** Android `PinStore` view of the same SharedPreferences. */
  private readonly store: PinStore = {
    getSalt: () => this.prefs.getString(KEY_PIN_SALT),
    getHash: () => this.prefs.getString(KEY_PIN_HASH),
    getKdfVersion: () =>
      this.prefs.getInt(KEY_PIN_KDF_VERSION, 0) === 1 ? 1 : 0,
    getFailures: () => this.prefs.getInt(KEY_PIN_FAILURES, 0),
    getRetryAfterMs: () => this.prefs.getLong(KEY_PIN_RETRY_AFTER, 0),
    setPin: (salt, hash, kdfVersion) => {
      this.prefs.edit().putString(KEY_PIN_SALT, salt).putString(KEY_PIN_HASH, hash)
        .putInt(KEY_PIN_KDF_VERSION, kdfVersion);
    },
    recordFailure: () => {
      // Android lines 79..83: failures++ and, at >= 5, a 30_000ms cooldown.
      const failures = this.prefs.getInt(KEY_PIN_FAILURES, 0) + 1;
      this.prefs.edit()
        .putInt(KEY_PIN_FAILURES, failures)
        .putLong(
          KEY_PIN_RETRY_AFTER,
          failures >= PIN_MAX_FAILURES ? Date.now() + PIN_RETRY_AFTER_MS : 0,
        );
      return failures;
    },
    clearFailures: () => {
      // Android lines 85..87: reset counters and, for a legacy hash, upgrade in place.
      this.prefs.edit().putInt(KEY_PIN_FAILURES, 0).putLong(KEY_PIN_RETRY_AFTER, 0);
    },
    setEnabled: (enabled) => {
      this.prefs.edit().putBoolean(KEY_ENABLED, enabled);
    },
    isEnabled: () => this.prefs.getBoolean(KEY_ENABLED, false),
    hasPin: () => this.prefs.getString(KEY_PIN_HASH) !== null,
  };

  /** Android line 38: `companion object { fun pinLength() }`. */
  pinLength(): number {
    return PIN_LENGTH;
  }

  /** Android line 45: `fun isEnabled(): Boolean`. */
  isEnabled(): boolean {
    return this.store.isEnabled();
  }

  /** Android line 48: `fun hasPin(): Boolean = prefs.contains(KEY_PIN_HASH)`. */
  hasPin(): boolean {
    return this.store.hasPin();
  }

  /** Android line 121: `fun isValidPin(pin): Boolean`. */
  isValidPin(pin: string): boolean {
    return isValidPin(pin);
  }

  /** Android lines 54..65: `@Synchronized fun enableWithPin(pin): Boolean`. */
  enableWithPin(pin: string): Promise<boolean> {
    return enableWithPin(pin, this.store);
  }

  /** Android lines 68..89: `@Synchronized fun verifyPin(pin): Boolean`. */
  verifyPin(pin: string): Promise<boolean> {
    return verifyPin(pin, { store: this.store });
  }

  /** Android lines 92..102: `@Synchronized fun changePin(oldPin, newPin): Boolean`. */
  changePin(oldPin: string, newPin: string): Promise<boolean> {
    return changePin(oldPin, newPin, this.store);
  }

  /** Android lines 105..110: `@Synchronized fun disable(pin): Boolean`. */
  disable(pin: string): Promise<boolean> {
    return disable(pin, this.store);
  }

  /** Android line 37: `internal fun hashPin(pin, saltHex): String`. */
  hashPin(pin: string, saltHex: string): Promise<string> {
    return hashPinLegacy(pin, saltHex);
  }

  /** Android line 37: `internal fun newSaltHex(): String`. */
  newSaltHex(): string {
    return newSaltHex();
  }
}
