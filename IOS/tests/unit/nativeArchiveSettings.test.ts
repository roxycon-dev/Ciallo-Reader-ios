import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createV12Database, type MemorySqlite } from '../port/data/support/androidSqlite';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { applyNativeArchiveSettings } from '@platform/ios-native/archiveSettings';
import { ArchiveResources } from '@core/transfer/archiveResources';
import { MemorySecureStore } from '@platform/web-mock/memorySecureStore';
import { MemoryFileSystem } from '@platform/web-mock/memoryFileSystem';
import { SecureStoreSourcePrefs, FileSystemSourceConfigFile } from '@platform/web/platformAdapters';
import { SharedPreferencesSourceStorage } from '@core/source/storage/sharedPreferencesSourceStorage';
import type { PortableArchivePreview, TransferCategory } from '@core/transfer/portableFormat';
const databases: MemorySqlite[] = [];
beforeEach(() => localStorage.clear()); afterEach(() => { for (const db of databases.splice(0)) db.close(); });
async function setup(categories: TransferCategory[], mode: 'MERGE' | 'REPLACE' = 'MERGE') {
  const db = createV12Database(); databases.push(db); const repo = new SettingsRepository(db); await repo.setFloat('font_size', 20);
  const secure = new MemorySecureStore(), fs = new MemoryFileSystem(), sources = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files: new FileSystemSourceConfigFile(fs) });
  const preview: PortableArchivePreview = { packageId: '01234567-89ab-cdef-0123-456789abcdef', version: 2, categories, counts: {}, expandedBytes: 0, warnings: [], containsProtected: false, protectedFavorites: false };
  const file = { path: 'files/font.ttf', size: 1, sha256: 'a'.repeat(64) };
  const context = { mode, preview, resources: new ArchiveResources(new Map([[file.path, file]]), 'restored/files'), bookIds: new Map([[9, 88]]), recordedSeconds: null as number | null, storage: localStorage, sources, scripts: { exportPortable: vi.fn(async () => []), importPortable: vi.fn(async () => {}) }, sourceIds: ['builtin', 'custom'] };
  return { db, repo, secure, fs, context };
}
describe('native portable settings applied to actual stores', () => {
  it('replaces only selected resource settings and preserves ordinary reader settings', async () => {
    const { db, repo, context } = await setup(['RESOURCES'], 'REPLACE');
    await repo.setString('custom_font_path', 'old.ttf');
    await applyNativeArchiveSettings(db, { novel_reader_prefs: { font_size: { type: 'float', value: 30 }, custom_font_path: { type: 'string', value: '@FILES@/font.ttf' }, custom_app_background_uri: { type: 'string', value: 'source_configs/private.json' } } }, context);
    expect(await repo.getFloat('font_size')).toBe(20); expect(await repo.getString('custom_font_path')).toBe('restored/files/font.ttf'); expect(await repo.getString('custom_app_background_uri')).toBe('');
  });
  it('replaces reader/comic preferences with remapped ids while retaining privacy, resources and counters', async () => {
    const { db, repo, context } = await setup(['SETTINGS'], 'REPLACE'); await repo.setBoolean('favorites_protected', true); await repo.setLong('total_read_time_seconds', 100); await repo.setString('custom_font_path', 'receiver.ttf');
    localStorage.setItem('comic_reader_store:book_cfg_55', '{}'); localStorage.setItem('comic_reader_store:device_secret', 'keep');
    await applyNativeArchiveSettings(db, { novel_reader_prefs: { line_height: { type: 'float', value: 35 }, total_read_time_seconds: { type: 'long', value: 9999 } }, comic_reader_store: { book_cfg_9: { type: 'string', value: '{"fit":2}' }, book_cfg_999: { type: 'string', value: '{}' } } }, context);
    expect((await repo.getAll()).some((item) => item.key === 'font_size')).toBe(false); expect(await repo.getFloat('line_height')).toBe(35); expect(await repo.getBoolean('favorites_protected')).toBe(true); expect(await repo.getLong('total_read_time_seconds')).toBe(100); expect(await repo.getString('custom_font_path')).toBe('receiver.ttf');
    expect(localStorage.getItem('comic_reader_store:book_cfg_88')).toBe('{"fit":2}'); expect(localStorage.getItem('comic_reader_store:book_cfg_55')).toBeNull(); expect(localStorage.getItem('comic_reader_store:book_cfg_999')).toBeNull(); expect(localStorage.getItem('comic_reader_store:device_secret')).toBe('keep');
  });
  it('merges preset ids without overwriting existing settings and recomputes historical totals once', async () => {
    const { db, repo, context } = await setup(['SETTINGS', 'HISTORY']); context.recordedSeconds = 30;
    await repo.setLong('legacy_unattributed_read_seconds', 7); await repo.setLong('daily_read_time_2020-01-01', 999);
    await db.execute("INSERT INTO reading_records VALUES (1,NULL,'在线','2026-10-28',30)");
    localStorage.setItem('comic_reader_store:presets', '[{"id":"same","name":"receiver"}]');
    await applyNativeArchiveSettings(db, { novel_reader_prefs: { font_size: { type: 'float', value: 30 } }, comic_reader_store: { presets: { type: 'string', value: '[{"id":"same","name":"sender"},{"id":"new"}]' } } }, context);
    expect(await repo.getFloat('font_size')).toBe(20); expect(await repo.getLong('total_read_time_seconds')).toBe(37); expect(await repo.getLong('daily_read_time_2026-10-28', 0)).toBe(30); expect(await repo.getLong('daily_read_time_2020-01-01', 0)).toBe(0); expect(JSON.parse(localStorage.getItem('comic_reader_store:presets')!)).toEqual([{ id: 'same', name: 'receiver' }, { id: 'new' }]);
    context.mode = 'REPLACE'; await applyNativeArchiveSettings(db, {}, context); expect(await repo.getLong('legacy_unattributed_read_seconds')).toBe(0); expect(await repo.getLong('total_read_time_seconds')).toBe(30);
  });
  it('applies definitions and explicit source states using awaited persistence while leaving credentials intact', async () => {
    const { db, secure, context } = await setup(['SOURCES'], 'REPLACE'); await secure.set('privacy.pin.v1', 'private'); await secure.set('js_source_data.custom', 'private-session');
    await applyNativeArchiveSettings(db, { sources: { custom: { id: 'custom', name: '移植源' } }, source_states: { builtin: false, custom: true }, active_source: 'custom', scripts: [] }, context);
    expect(await context.sources.getCustomSourceJsons()).toEqual({ custom: '{"id":"custom","name":"移植源"}' }); expect(await secure.get('source_enabled_builtin')).toBe('false'); expect(await secure.get('active_source_id')).toBe('custom');
    expect(context.scripts.importPortable).toHaveBeenCalledWith([], true); expect(await secure.get('privacy.pin.v1')).toBe('private'); expect(await secure.get('js_source_data.custom')).toBe('private-session');
  });
  it('ignores source definitions when their category is absent and keeps protected favorites protected', async () => {
    const { db, repo, context } = await setup(['FAVORITES']); context.preview.protectedFavorites = true;
    await applyNativeArchiveSettings(db, { sources: { ignored: { name: '忽略' } }, scripts: [] }, context);
    expect(context.scripts.importPortable).not.toHaveBeenCalled(); expect(await context.sources.getCustomSourceJsons()).toEqual({}); expect(await repo.getBoolean('favorites_protected')).toBe(true);
  });
});
