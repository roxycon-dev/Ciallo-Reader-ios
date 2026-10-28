import { isSafeSettingKey } from '@core/backup/safeSetting';
import { settingType, isAcceptableFloat, intRangeFor } from '@core/backup/settingTypes';
import { JsSourceRepo, type PortableJsSource } from '@core/source/js/jsSourceRepo';
import { portableObject, PORTABLE_METADATA_MAX_BYTES } from './portableFormat';
import { requireTransfer } from './transferWire';
import type { TransferImportMode } from './transferSession';

export interface PortableSetting { type: 'boolean' | 'int' | 'long' | 'float' | 'string'; value: boolean | number | string; }
export type PortableSettingEntries = Record<string, PortableSetting>;
export interface PortableSettings {
  novel_reader_prefs?: PortableSettingEntries;
  comic_reader_store?: PortableSettingEntries;
  god?: { ranking_style: string; last_page_hint: boolean; gyro_parallax: boolean };
  sources?: Record<string, Record<string, unknown>>;
  scripts?: PortableJsSource[];
  source_states?: Record<string, boolean>;
  active_source?: string;
}
const TOP_LEVEL = new Set(['novel_reader_prefs', 'comic_reader_store', 'god', 'sources', 'scripts', 'source_states', 'active_source']);
const COMIC_KEYS = new Set(['global_config', 'presets', 'default_preset', 'custom_fit_presets']);
const RESOURCE_KEYS = new Set(['custom_splash_poster_uri', 'custom_app_background_uri', 'custom_font_path']);
const TOTAL_KEYS = new Set(['total_read_time_seconds', 'legacy_unattributed_read_seconds', 'reading_totals_reconciled_v1']);
const SENSITIVE = /(cookie|authorization|credential|password|secret|api.?key|access.?token|refresh.?token)/i;
const URL_CREDENTIALS = /https?:\/\/[^/\s]+:[^/@\s]+@/i;
const stringBytes = (value: string): number => new TextEncoder().encode(value).length;
export function portableNovelKey(key: string): boolean { return isSafeSettingKey(key) && settingType(key) !== null && key !== 'favorites_protected'; }
export function portableCounterKey(key: string): boolean { return TOTAL_KEYS.has(key) || key.startsWith('daily_read_time_'); }
export function portableComicKey(key: string): boolean { return COMIC_KEYS.has(key) || /^(?:book_cfg_|book_state_|resume_).+/.test(key) && key.length <= 1024 && !key.includes('\0'); }
export function portableResourceKey(key: string): boolean { return RESOURCE_KEYS.has(key); }

function setting(value: unknown, expected: string): PortableSetting {
  const item = portableObject(value, '设置项格式错误');
  requireTransfer(item.type === expected, '设置类型不符');
  switch (expected) {
    case 'boolean': requireTransfer(typeof item.value === 'boolean', '布尔设置值无效'); break;
    case 'string': requireTransfer(typeof item.value === 'string', '字符串设置值无效'); break;
    case 'int': requireTransfer(typeof item.value === 'number' && Number.isInteger(item.value) && item.value >= -2147483648 && item.value <= 2147483647, '整数设置值无效'); break;
    case 'long': requireTransfer(typeof item.value === 'number' && Number.isSafeInteger(item.value), '长整数设置值无效'); break;
    case 'float': requireTransfer(typeof item.value === 'number' && Number.isFinite(item.value), '浮点设置值无效'); break;
    default: requireTransfer(false, '不支持的设置类型');
  }
  return { type: expected as PortableSetting['type'], value: item.value as PortableSetting['value'] };
}
/** Whole-package validation precedes every write. Account stores, cookies,
 * translation keys, private Worker storage and local PIN material have no
 * representation in this format. */
export function validatePortableSettings(input: unknown): PortableSettings {
  const value = portableObject(input), encoded = JSON.stringify(value);
  requireTransfer(stringBytes(encoded) <= PORTABLE_METADATA_MAX_BYTES && Object.keys(value).every((key) => TOP_LEVEL.has(key)), '设置过大或包含不可迁移存储');
  const output: PortableSettings = {};
  if (value.novel_reader_prefs !== undefined) {
    const entries = portableObject(value.novel_reader_prefs), settings: PortableSettingEntries = Object.create(null) as PortableSettingEntries;
    for (const [key, raw] of Object.entries(entries)) {
      requireTransfer(portableNovelKey(key), '包含不可迁移设置');
      const item = setting(raw, settingType(key)!);
      if (item.type === 'float') requireTransfer(isAcceptableFloat(key, item.value as number), '浮点设置超出范围');
      if (item.type === 'int') { const range = intRangeFor(key); requireTransfer((item.value as number) >= range.min && (item.value as number) <= range.max, '整数设置超出范围'); }
      settings[key] = item;
    }
    output.novel_reader_prefs = settings;
  }
  if (value.comic_reader_store !== undefined) {
    const entries = portableObject(value.comic_reader_store), settings: PortableSettingEntries = Object.create(null) as PortableSettingEntries;
    for (const [key, raw] of Object.entries(entries)) {
      requireTransfer(portableComicKey(key), '包含不可迁移漫画设置');
      const item = setting(raw, 'string'), text = item.value as string;
      requireTransfer(text.length <= 1024 * 1024, '漫画设置过大');
      if (key !== 'default_preset') {
        const parsed: unknown = JSON.parse(text);
        if (key === 'presets' || key === 'custom_fit_presets') requireTransfer(Array.isArray(parsed) && parsed.every((preset) => typeof portableObject(preset).id === 'string'), '预设列表无效');
        else portableObject(parsed, '漫画设置内容无效');
      }
      settings[key] = item;
    }
    output.comic_reader_store = settings;
  }
  if (value.sources !== undefined) {
    const sources = portableObject(value.sources), definitions: Record<string, Record<string, unknown>> = Object.create(null) as Record<string, Record<string, unknown>>;
    requireTransfer(Object.keys(sources).length <= 500, '书源过多');
    for (const [id, definition] of Object.entries(sources)) {
      const object = portableObject(definition), text = JSON.stringify(object);
      requireTransfer(id.length > 0 && id.length <= 512 && stringBytes(text) <= 2 * 1024 * 1024 && !SENSITIVE.test(text) && !URL_CREDENTIALS.test(text), '书源无效或含认证字段'); definitions[id] = object;
    }
    output.sources = definitions;
  }
  if (value.scripts !== undefined) output.scripts = JsSourceRepo.validatePortable(value.scripts);
  if (value.source_states !== undefined) {
    const states = portableObject(value.source_states), accepted: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    requireTransfer(Object.keys(states).length <= 2000, '书源状态过多');
    for (const [id, state] of Object.entries(states)) { requireTransfer(id.length > 0 && id.length <= 512 && typeof state === 'boolean', '书源状态无效'); accepted[id] = state; }
    output.source_states = accepted;
  }
  if (value.active_source !== undefined) { requireTransfer(typeof value.active_source === 'string' && value.active_source.length > 0 && value.active_source.length <= 512, '活动书源无效'); output.active_source = value.active_source; }
  if (value.god !== undefined) {
    const god = portableObject(value.god);
    requireTransfer(typeof god.ranking_style === 'string' && god.ranking_style.length <= 64 && typeof god.last_page_hint === 'boolean' && typeof god.gyro_parallax === 'boolean', '神回展示设置无效');
    output.god = { ranking_style: god.ranking_style, last_page_hint: god.last_page_hint, gyro_parallax: god.gyro_parallax };
  }
  return output;
}
export function relocateComicSettingKey(key: string, bookIds: ReadonlyMap<number, number>): string | null {
  const match = /^(book_cfg_|book_state_|resume_)(\d+)(_|$)/.exec(key);
  if (!match) return key;
  const id = bookIds.get(Number(match[2])); if (id === undefined) return null;
  return `${match[1]}${id}${key.slice(match[1]!.length + match[2]!.length)}`;
}
export function mergePortableSettings(existing: PortableSettingEntries, incoming: PortableSettingEntries, store: 'novel_reader_prefs' | 'comic_reader_store', mode: TransferImportMode, bookIds: ReadonlyMap<number, number>): PortableSettingEntries {
  const output: PortableSettingEntries = Object.fromEntries(Object.entries(existing).map(([key, item]) => [key, { ...item }]));
  const allowed = store === 'novel_reader_prefs' ? (key: string) => portableNovelKey(key) && !portableCounterKey(key) : portableComicKey;
  if (mode === 'REPLACE') for (const key of Object.keys(output)) if (allowed(key)) delete output[key];
  for (const [original, item] of Object.entries(incoming)) {
    if (!allowed(original)) continue;
    const key = store === 'comic_reader_store' ? relocateComicSettingKey(original, bookIds) : original; if (key === null) continue;
    if (mode === 'REPLACE' || !Object.hasOwn(output, key)) output[key] = { ...item };
    else if (key === 'presets' || key === 'custom_fit_presets') {
      const previous = JSON.parse(output[key]!.value as string) as Record<string, unknown>[], added = JSON.parse(item.value as string) as Record<string, unknown>[];
      const ids = new Set(previous.map((preset) => preset.id));
      output[key] = { type: 'string', value: JSON.stringify([...previous, ...added.filter((preset) => { if (ids.has(preset.id)) return false; ids.add(preset.id); return true; })]) };
    }
  }
  return output;
}
