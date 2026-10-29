import type { SecureStore } from '@platform/interfaces';

export class MemorySecureStore implements SecureStore {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

export function createMemorySecureStore(): MemorySecureStore {
  return new MemorySecureStore();
}
