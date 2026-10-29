import type { SqliteExecutor } from '@platform/interfaces';
import type { SourceStorage } from '@core/source/sourceManager';
import type { JsDefinitionLease } from '@platform/jsSourceAssembly';
import type { ArchiveExportSelection } from '@core/transfer/archiveExporter';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { portableComicKey, portableCounterKey, portableNovelKey, portableResourceKey, validatePortableSettings, type PortableSettingEntries, type PortableSettings } from '@core/transfer/portableSettings';
import { godRankingStyleOf } from '@core/god/godRankingSettings';

interface ExportSettingsContext {
  selectedBookKeys: ReadonlySet<string>;
  sources: SourceStorage;
  scripts: JsDefinitionLease;
  sourceIds: readonly string[];
  storage: Pick<Storage, 'length' | 'key' | 'getItem'>;
  resource(path: string): Promise<string>;
  warnings: string[];
}
export async function exportNativeArchiveSettings(database: SqliteExecutor, selection: ArchiveExportSelection, context: ExportSettingsContext): Promise<PortableSettings> {
  const output: PortableSettings = {}, categories = new Set(selection.categories);
  if (categories.has('SETTINGS') || categories.has('RESOURCES')) {
    const novel: PortableSettingEntries = Object.create(null) as PortableSettingEntries;
    for (const item of await new SettingsRepository(database).getAll()) {
      if (!portableNovelKey(item.key) || portableCounterKey(item.key) || !categories.has(portableResourceKey(item.key) ? 'RESOURCES' : 'SETTINGS')) continue;
      try {
        const setting = { type: item.type, value: portableResourceKey(item.key) ? await context.resource(item.value as string) : item.value };
        novel[item.key] = validatePortableSettings({ novel_reader_prefs: { [item.key]: setting } }).novel_reader_prefs![item.key]!;
      } catch { context.warnings.push(`设置 ${item.key} 无法迁移，已跳过`); }
    }
    output.novel_reader_prefs = novel;
  }
  if (categories.has('SETTINGS')) {
    const comic: PortableSettingEntries = Object.create(null) as PortableSettingEntries;
    for (let index = 0; index < context.storage.length; index++) {
      const fullKey = context.storage.key(index); if (!fullKey?.startsWith('comic_reader_store:')) continue;
      const key = fullKey.slice(19); if (!portableComicKey(key)) continue;
      const allowed = ['global_config', 'presets', 'default_preset', 'custom_fit_presets'].includes(key) || [...context.selectedBookKeys].some((id) => key === `book_cfg_${id}` || key === `book_state_${id}` || key === `resume_${id}` || key.startsWith(`resume_${id}_`));
      if (!allowed) continue;
      const value = context.storage.getItem(fullKey); if (value === null) continue;
      try { comic[key] = validatePortableSettings({ comic_reader_store: { [key]: { type: 'string', value } } }).comic_reader_store![key]!; }
      catch { context.warnings.push(`漫画设置 ${key} 无法迁移，已跳过`); }
    }
    output.comic_reader_store = comic;
    let god: Record<string, unknown> = {};
    try { const value: unknown = JSON.parse(context.storage.getItem('god_moment_prefs') ?? '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) god = value as Record<string, unknown>; } catch { /* Use the same defaults as the reader. */ }
    output.god = { ranking_style: godRankingStyleOf(typeof god.ranking_style === 'string' ? god.ranking_style : null), last_page_hint: typeof god.last_page_hint === 'boolean' ? god.last_page_hint : true, gyro_parallax: typeof god.gyro_parallax === 'boolean' ? god.gyro_parallax : true };
  }
  if (categories.has('SOURCES')) {
    const definitions: Record<string, Record<string, unknown>> = Object.create(null) as Record<string, Record<string, unknown>>;
    for (const [id, raw] of Object.entries(await context.sources.getCustomSourceJsons())) {
      try { definitions[id] = validatePortableSettings({ sources: { [id]: JSON.parse(raw) } }).sources![id]!; }
      catch { context.warnings.push(`书源 ${id} 含认证字段或定义无效，未发送`); }
    }
    output.sources = definitions; output.scripts = await context.scripts.exportPortable(context.warnings);
    output.source_states = await context.sources.getSourceStates(context.sourceIds);
    const active = await context.sources.getActiveSourceId(); if (active) output.active_source = active;
  }
  return validatePortableSettings(output);
}
