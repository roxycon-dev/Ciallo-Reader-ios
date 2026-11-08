import type { SecureStore } from '@platform/interfaces';
import { changePin, disable, enableWithPin, PIN_MAX_FAILURES, PIN_RETRY_AFTER_MS, verifyPin, type PinStore } from './pinKdf';

const RECORD_KEY = 'privacy.pin.v1';
interface PinRecord { salt: string | null; hash: string | null; kdf: 0 | 1; failures: number; retryAfter: number; enabled: boolean }
export interface PrivacyState { loaded: boolean; enabled: boolean; hasPin: boolean; failures: number; retryAfter: number; favoritesUnlocked: boolean; unlockedCategoryIds: readonly number[] }
const empty = (): PinRecord => ({ salt: null, hash: null, kdf: 1, failures: 0, retryAfter: 0, enabled: false });

/** A synchronized PIN record; publish changes only after the secure store commits. */
export class PrivacyService {
  private record: PinRecord | null = null;
  private state: PrivacyState = { loaded: false, enabled: false, hasPin: false, failures: 0, retryAfter: 0, favoritesUnlocked: false, unlockedCategoryIds: [] };
  private favoritesUnlocked = false;
  private lockEpoch = 0;
  private readonly unlockedCategories = new Set<number>();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly secure: SecureStore, private readonly now: () => number = Date.now) {}
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = (): PrivacyState => this.state;
  canAccessCategory(category: { id: number; isProtected: boolean }): boolean { return this.state.loaded && (!this.state.enabled || !category.isProtected || this.state.unlockedCategoryIds.includes(category.id)); }
  private publish(record: PinRecord): void {
    this.record = record;
    if (!record.enabled) { this.favoritesUnlocked = false; this.unlockedCategories.clear(); }
    this.state = { loaded: true, enabled: record.enabled, hasPin: !!record.salt && !!record.hash, failures: record.failures, retryAfter: record.retryAfter, favoritesUnlocked: this.favoritesUnlocked, unlockedCategoryIds: [...this.unlockedCategories] };
    for (const listener of this.listeners) listener();
  }
  private async load(): Promise<PinRecord> {
    if (this.record) return this.record;
    const raw = await this.secure.get(RECORD_KEY); if (raw === null) { const record = empty(); this.publish(record); return record; }
    let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error('隐私密码记录损坏，未解除保护'); }
    if (!value || typeof value !== 'object') throw new Error('隐私密码记录损坏，未解除保护');
    const row = value as Partial<PinRecord>;
    if (typeof row.enabled !== 'boolean' || ![0, 1].includes(row.kdf ?? -1) || !Number.isSafeInteger(row.failures) || row.failures! < 0 || !Number.isSafeInteger(row.retryAfter) || row.retryAfter! < 0
      || (row.salt !== null && (typeof row.salt !== 'string' || !/^[a-f0-9]{32}$/i.test(row.salt))) || (row.hash !== null && (typeof row.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(row.hash))) || row.enabled && (!row.salt || !row.hash)) throw new Error('隐私密码记录损坏，未解除保护');
    const record = row as PinRecord; this.publish(record); return record;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.catch(() => {}).then(operation); this.tail = task.catch(() => {}); return task;
  }
  ready(): Promise<PrivacyState> { return this.serial(async () => { await this.load(); return this.state; }); }
  private run<T>(operation: (store: PinStore) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      const old = await this.load(), next = { ...old };
      const store: PinStore = {
        getSalt: () => next.salt, getHash: () => next.hash, getKdfVersion: () => next.kdf, getFailures: () => next.failures, getRetryAfterMs: () => next.retryAfter,
        setPin(salt, hash, kdf) { next.salt = salt; next.hash = hash; next.kdf = kdf; },
        recordFailure: () => { next.failures++; next.retryAfter = next.failures >= PIN_MAX_FAILURES ? this.now() + PIN_RETRY_AFTER_MS : 0; return next.failures; },
        clearFailures() { next.failures = 0; next.retryAfter = 0; },
        setEnabled(enabled) { next.enabled = enabled; }, isEnabled: () => next.enabled, hasPin: () => !!next.salt && !!next.hash,
      };
      const result = await operation(store);
      if (JSON.stringify(next) !== JSON.stringify(old)) { await this.secure.set(RECORD_KEY, JSON.stringify(next)); this.publish(next); }
      return result;
    });
  }
  async verify(pin: string): Promise<boolean> { const epoch = this.lockEpoch; const ok = await this.run((store) => verifyPin(pin, { store, now: this.now })); return ok && epoch === this.lockEpoch; }
  async unlockCategory(id: number, pin: string): Promise<boolean> { if (!Number.isSafeInteger(id)) return false; const epoch = this.lockEpoch; const ok = await this.verify(pin); if (ok && this.record && epoch === this.lockEpoch) { this.unlockedCategories.add(id); this.publish(this.record); return true; } return false; }
  async unlockFavorites(pin: string): Promise<boolean> { const epoch = this.lockEpoch; const ok = await this.verify(pin); if (ok && this.record && epoch === this.lockEpoch) { this.favoritesUnlocked = true; this.publish(this.record); return true; } return false; }
  lock(): void { this.lockEpoch++; this.favoritesUnlocked = false; this.unlockedCategories.clear(); if (this.record) this.publish(this.record); }
  enable(pin: string): Promise<boolean> { return this.run((store) => store.isEnabled() ? Promise.resolve(false) : enableWithPin(pin, store)); }
  async change(oldPin: string, pin: string): Promise<boolean> { const ok = await this.run((store) => changePin(oldPin, pin, store, this.now)); if (ok) this.lock(); return ok; }
  disable(pin: string): Promise<boolean> { return this.run((store) => disable(pin, store, this.now)); }
}
