import type { SecureStore } from '@platform/interfaces';
import type { ImportJournalPreferences } from '@core/transfer/importJournal';
import { portableObject } from '@core/transfer/portableFormat';
import { requireTransfer } from '@core/transfer/transferWire';

type StoragePort = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
const comicPrefix = 'comic_reader_store:', godKey = 'god_moment_prefs', idsKey = 'ss:custom_source_ids';
const sourceKey = (key: string) => key === idsKey || key === 'active_source_id' || key.startsWith('source_enabled_') || key.startsWith('custom_source_json_');
/** Only receiver-local reader preferences and source definition metadata enter
 * the private journal. Account keys, cookies, Worker data and PINs are excluded. */
export class NativeImportPreferences implements ImportJournalPreferences {
  constructor(private readonly secure: SecureStore, private readonly storage: StoragePort, private readonly sourceIds: readonly string[] = []) {}
  private comicKeys(): string[] {
    const keys: string[] = [];
    for (let index = 0; index < this.storage.length; index++) { const key = this.storage.key(index); if (key?.startsWith(comicPrefix)) keys.push(key); }
    requireTransfer(keys.length <= 9998, '本机漫画偏好过多，无法创建恢复快照'); return keys;
  }
  async snapshot(): Promise<Record<string, string | null>> {
    const snapshot: Record<string, string | null> = Object.create(null) as Record<string, string | null>;
    for (const key of this.comicKeys()) snapshot[key] = this.storage.getItem(key);
    snapshot[godKey] = this.storage.getItem(godKey);
    const rawIds = await this.secure.get(idsKey), ids = new Set(this.sourceIds);
    if (rawIds !== null) {
      const stored: unknown = JSON.parse(rawIds); requireTransfer(Array.isArray(stored) && stored.length <= 10000 && stored.every((id) => typeof id === 'string' && id.length <= 1000), '本机书源索引损坏');
      for (const id of stored) ids.add(id as string);
    }
    requireTransfer(ids.size <= 10000 && [...ids].every((id) => id.length <= 1000), '本机书源状态过多或标识过长');
    const metadata: Record<string, string | null> = Object.create(null) as Record<string, string | null>;
    metadata[idsKey] = rawIds; metadata.active_source_id = await this.secure.get('active_source_id');
    for (const id of ids) for (const prefix of ['source_enabled_', 'custom_source_json_']) { const key = prefix + id; metadata[key] = await this.secure.get(key); }
    snapshot.source_metadata = JSON.stringify(metadata);
    requireTransfer(new TextEncoder().encode(JSON.stringify(snapshot)).length <= 8 * 1024 * 1024 && Object.values(snapshot).every((value) => value === null || value.length <= 1024 * 1024), '本机设置快照过大');
    return snapshot;
  }
  async restore(snapshot: Record<string, string | null>): Promise<void> {
    const metadata = portableObject(JSON.parse(snapshot.source_metadata ?? '{}'), '本机源状态快照损坏');
    // Validate the entire record before touching either store.
    requireTransfer(Object.entries(snapshot).every(([key, value]) => (key.startsWith(comicPrefix) || key === godKey || key === 'source_metadata') && (value === null || typeof value === 'string')), '本机偏好快照包含未知存储');
    requireTransfer(Object.entries(metadata).every(([key, value]) => sourceKey(key) && key.length <= 1024 && (value === null || typeof value === 'string')), '本机源状态快照包含未知存储');
    for (const key of this.comicKeys()) if (!Object.hasOwn(snapshot, key)) this.storage.removeItem(key);
    for (const [key, value] of Object.entries(snapshot)) {
      if (key === 'source_metadata') continue;
      if (value === null) this.storage.removeItem(key); else this.storage.setItem(key, value);
    }
    for (const [key, value] of Object.entries(metadata)) { if (value === null) await this.secure.remove(key); else await this.secure.set(key, value as string); }
  }
}
