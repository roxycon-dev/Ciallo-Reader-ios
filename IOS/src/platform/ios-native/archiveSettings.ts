import { SettingsRepository } from '@core/settings/settingsRepository';
import type { SourceStorage } from '@core/source/sourceManager';
import type { SqliteExecutor } from '@platform/interfaces';
import type { JsDefinitionLease } from '@platform/jsSourceAssembly';
import type { ArchiveResources } from '@core/transfer/archiveResources';
import type { PortableArchivePreview } from '@core/transfer/portableFormat';
import { mergePortableSettings, portableComicKey, portableCounterKey, portableNovelKey, portableResourceKey, validatePortableSettings, type PortableSetting, type PortableSettingEntries, type PortableSettings } from '@core/transfer/portableSettings';
import type { TransferImportMode } from '@core/transfer/transferSession';
import { requireTransfer } from '@core/transfer/transferWire';

interface SettingsContext {
  mode: TransferImportMode;
  preview: PortableArchivePreview;
  resources: ArchiveResources;
  bookIds: ReadonlyMap<number, number>;
  recordedSeconds: number | null;
  storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
  sources: SourceStorage;
  scripts: JsDefinitionLease;
  sourceIds: readonly string[];
}
const comicPrefix = 'comic_reader_store:';
/** Invoked inside the journal and both source leases. SQLite preferences use
 * the scoped executor; browser/definition state is covered by private snapshots. */
export async function applyNativeArchiveSettings(database: SqliteExecutor, input: PortableSettings, context: SettingsContext): Promise<void> {
  const settings = validatePortableSettings(input), { preview, mode, storage, sources, scripts } = context;
  const selected = new Set(preview.categories), repository = new SettingsRepository(database), all = await repository.getAll();
  const chosenNovel = (key: string) => portableNovelKey(key) && !portableCounterKey(key) && selected.has(portableResourceKey(key) ? 'RESOURCES' : 'SETTINGS');
  const existing = Object.fromEntries(all.filter((item) => chosenNovel(item.key)).map(({ key, type, value }) => [key, { type, value }]));
  const incoming: PortableSettingEntries = Object.create(null) as PortableSettingEntries;
  for (const [key, setting] of Object.entries(settings.novel_reader_prefs ?? {})) if (chosenNovel(key)) incoming[key] = portableResourceKey(key) ? { ...setting, value: context.resources.relocate(setting.value as string) } : setting;
  const merged = mergePortableSettings(existing, incoming, 'novel_reader_prefs', mode, context.bookIds);
  const put = async (key: string, setting: PortableSetting) => { await database.execute('INSERT OR REPLACE INTO app_settings (key,type,value) VALUES (?,?,?)', [key, setting.type, JSON.stringify(setting.value)]); };
  for (const key of Object.keys(existing)) if (!Object.hasOwn(merged, key)) await database.execute('DELETE FROM app_settings WHERE key=?', [key]);
  for (const [key, setting] of Object.entries(merged)) await put(key, setting);
  if (selected.has('SETTINGS')) {
    const current: PortableSettingEntries = Object.create(null) as PortableSettingEntries;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(comicPrefix) && portableComicKey(key.slice(comicPrefix.length))) { const value = storage.getItem(key); if (value !== null) current[key.slice(comicPrefix.length)] = { type: 'string', value }; }
    }
    const comic = mergePortableSettings(current, settings.comic_reader_store ?? {}, 'comic_reader_store', mode, context.bookIds);
    for (const key of Object.keys(current)) if (!Object.hasOwn(comic, key)) storage.removeItem(comicPrefix + key);
    for (const [key, item] of Object.entries(comic)) storage.setItem(comicPrefix + key, item.value as string);
    if (settings.god && (mode === 'REPLACE' || storage.getItem('god_moment_prefs') === null)) storage.setItem('god_moment_prefs', JSON.stringify(settings.god));
  }
  if (selected.has('SOURCES')) {
    const definitions = await sources.getCustomSourceJsons();
    if (settings.scripts) await scripts.importPortable(settings.scripts, mode === 'REPLACE');
    for (const [id, definition] of Object.entries(settings.sources ?? {})) if (mode === 'REPLACE' || !Object.hasOwn(definitions, id)) await sources.saveCustomSourceJson(id, JSON.stringify(definition));
    const states = await sources.getSourceStates([...new Set([...context.sourceIds, ...Object.keys(settings.source_states ?? {})])]);
    for (const [id, enabled] of Object.entries(settings.source_states ?? {})) if (mode === 'REPLACE' || !Object.hasOwn(states, id)) await sources.saveSourceState(id, enabled);
    if (settings.active_source !== undefined && (mode === 'REPLACE' || await sources.getActiveSourceId() === null)) await sources.saveActiveSourceId(settings.active_source);
  }
  if (selected.has('FAVORITES') && preview.protectedFavorites) await put('favorites_protected', { type: 'boolean', value: true });
  if (context.recordedSeconds !== null) {
    const replaceHistory = mode === 'REPLACE' && (selected.has('HISTORY') || selected.has('BOOKS'));
    const legacy = replaceHistory ? 0 : await repository.getLong('legacy_unattributed_read_seconds', 0);
    const total = context.recordedSeconds + Math.max(0, legacy);
    requireTransfer(Number.isSafeInteger(total) && total >= 0, '导入后阅读总时长无效');
    await put('total_read_time_seconds', { type: 'long', value: total });
    await put('legacy_unattributed_read_seconds', { type: 'long', value: Math.max(0, legacy) });
    await put('reading_totals_reconciled_v1', { type: 'boolean', value: true });
    for (const item of all) if (item.key.startsWith('daily_read_time_')) await database.execute('DELETE FROM app_settings WHERE key=?', [item.key]);
    const days = await database.query<{ dateStr: string; seconds: number }>('SELECT dateStr,SUM(durationSeconds) AS seconds FROM reading_records GROUP BY dateStr');
    for (const day of days) { requireTransfer(/^\d{4}-\d{2}-\d{2}$/.test(day.dateStr) && Number.isSafeInteger(day.seconds) && day.seconds >= 0, '阅读日统计无效'); await put(`daily_read_time_${day.dateStr}`, { type: 'long', value: day.seconds }); }
  }
}
