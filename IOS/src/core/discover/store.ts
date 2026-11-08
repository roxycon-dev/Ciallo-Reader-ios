import type { FileSystemApi, SecureStore } from '@platform/interfaces';
import { discoverIdentity, type DiscoverCatalog, type DiscoverEntry, type DiscoverPartition, type DiscoverWork } from './models';

type Preference = string | boolean | string[] | Record<string, string | string[]>;
export interface DiscoverNavigation {
  entryCount: number; pages: Record<string, number>; cursors: Record<string, string | null>;
  more: string[]; history: Record<string, string[]>; progress: Record<string, number>; catalogs: Record<string, DiscoverCatalog>;
}
export interface DiscoverCache { savedAt: number; entries: DiscoverEntry[]; navigation: DiscoverNavigation | null }

/** Separate comic/novel preferences and 24 bounded, expiring offline snapshots. */
export class DiscoverStore {
  private values: Record<string, Preference> = {};
  private writes: Promise<void> = Promise.resolve();
  private cacheWrites: Promise<void> = Promise.resolve();
  private revision = 0;
  private listeners = new Set<() => void>();
  private readonly key: string;
  private readonly directory: string;
  constructor(readonly partition: DiscoverPartition, private readonly preferences: Pick<SecureStore, 'get' | 'set'>,
    private readonly fs: FileSystemApi, private readonly now: () => number = Date.now) {
    this.key = `discover_preferences${partition === 'NOVEL' ? '_novel' : ''}`;
    this.directory = `cache/discover/${partition.toLowerCase()}`;
  }
  async load(): Promise<void> {
    const saved = await this.preferences.get(this.key);
    if (!saved) return;
    try {
      const parsed: unknown = JSON.parse(saved);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.values = parsed as Record<string, Preference>;
    } catch { /* A damaged preference snapshot starts with default choices. */ }
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getRevision = (): number => this.revision;
  string(key: string, fallback: string): string { const value = this.values[key]; return typeof value === 'string' ? value : fallback; }
  flag(key: string, fallback = true): boolean { const value = this.values[key]; return typeof value === 'boolean' ? value : fallback; }
  selection(key: string): Set<string> { const value = this.values[key]; return new Set(Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []); }
  put(key: string, value: Preference | Set<string>): void {
    this.values = { ...this.values, [key]: value instanceof Set ? [...value] : value };
    const json = JSON.stringify(this.values);
    this.writes = this.writes.catch(() => {}).then(() => this.preferences.set(this.key, json));
    void this.writes.catch(() => {});
    this.revision++; for (const listener of this.listeners) listener();
  }
  private groups(): Record<string, string[]> {
    const value = this.values['blocked_groups'];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])));
  }
  blockedWorks(): Array<{ key: string; title: string }> {
    const labels = this.values['blocked_labels'];
    if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return [];
    return Object.entries(labels).filter((entry): entry is [string, string] => typeof entry[1] === 'string').map(([key, title]) => ({ key, title }));
  }
  block(work: DiscoverWork): void {
    const groups = this.groups(); groups[work.key] = [...new Set([work.key, ...work.variants.map(discoverIdentity)])];
    const labels = Object.fromEntries(this.blockedWorks().map((row) => [row.key, row.title]));
    labels[work.key] = work.variants[0]!.book.title;
    this.put('blocked_groups', groups); this.put('blocked_labels', labels);
    this.put('blocked', new Set([...this.selection('blocked'), ...groups[work.key]!]));
  }
  unblock(key: string): void {
    const groups = this.groups(); const removed = groups[key] ?? [key]; delete groups[key];
    const other = new Set(Object.values(groups).flat());
    this.put('blocked', new Set([...this.selection('blocked')].filter((id) => !removed.includes(id) || other.has(id))));
    this.put('blocked_groups', groups);
    this.put('blocked_labels', Object.fromEntries(this.blockedWorks().filter((row) => row.key !== key).map((row) => [row.key, row.title])));
  }
  private async cachePath(key: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
    return `${this.directory}/${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}.json`;
  }
  async readCache(key: string): Promise<DiscoverCache | null> {
    if (!this.flag('cache')) return null;
    try {
      const bytes = await this.fs.readFile(await this.cachePath(key));
      if (bytes.length > 8 * 1024 * 1024) return null;
      const saved = JSON.parse(new TextDecoder().decode(bytes)) as Partial<DiscoverCache>;
      const hours = Number(this.string('cache_hours', '24'));
      if (!Number.isFinite(saved.savedAt) || this.now() - saved.savedAt! > (Number.isFinite(hours) && hours > 0 ? hours : 24) * 3_600_000) return null;
      if (!Array.isArray(saved.entries) || saved.entries.length > 300 || saved.entries.some((entry) => !entry?.book || typeof entry.book.id !== 'string' || typeof entry.book.sourceId !== 'string' || typeof entry.book.title !== 'string')) return null;
      return { savedAt: saved.savedAt!, entries: saved.entries, navigation: saved.navigation ?? null };
    } catch { return null; }
  }
  async writeCache(key: string, entries: DiscoverEntry[], navigation: DiscoverNavigation | null): Promise<void> {
    if (!this.flag('cache')) return;
    const path = await this.cachePath(key);
    const subset = entries.slice(0, 300);
    const bytes = new TextEncoder().encode(JSON.stringify({ savedAt: this.now(), entries: subset,
      navigation: entries.length <= 300 ? navigation : null } satisfies DiscoverCache));
    if (bytes.length > 8 * 1024 * 1024) return;
    this.cacheWrites = this.cacheWrites.catch(() => {}).then(async () => {
      if (!this.flag('cache')) return;
      await this.fs.writeFile(path, bytes);
      const indexPath = `${this.directory}/index.json`;
      let keys: string[] = [];
      try { const raw: unknown = JSON.parse(new TextDecoder().decode(await this.fs.readFile(indexPath))); if (Array.isArray(raw)) keys = raw.filter((key): key is string => typeof key === 'string' && /^[a-f0-9]{64}\.json$/.test(key)); } catch { /* New cache directory. */ }
      const name = path.slice(path.lastIndexOf('/') + 1); keys = [...keys.filter((key) => key !== name), name];
      for (const expired of keys.slice(0, -24)) await this.fs.delete(`${this.directory}/${expired}`);
      await this.fs.writeFile(indexPath, new TextEncoder().encode(JSON.stringify(keys.slice(-24))));
    });
    await this.cacheWrites;
  }
  async clearCache(): Promise<void> {
    await this.cacheWrites.catch(() => {});
    for (const name of await this.fs.list(this.directory)) if (/^(?:[a-f0-9]{64}|index)\.json$/.test(name)) await this.fs.delete(`${this.directory}/${name}`);
  }
  async flush(): Promise<void> { await this.writes; await this.cacheWrites; }
}
