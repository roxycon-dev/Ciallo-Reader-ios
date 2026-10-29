import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createV12Database, type MemorySqlite } from '../port/data/support/androidSqlite';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { exportNativeArchiveSettings } from '@platform/ios-native/archiveExportSettings';
import { MemorySecureStore } from '@platform/web-mock/memorySecureStore';
import { MemoryFileSystem } from '@platform/web-mock/memoryFileSystem';
import { SecureStoreSourcePrefs, FileSystemSourceConfigFile } from '@platform/web/platformAdapters';
import { SharedPreferencesSourceStorage } from '@core/source/storage/sharedPreferencesSourceStorage';
const databases: MemorySqlite[] = [];
beforeEach(() => localStorage.clear()); afterEach(() => { for (const db of databases.splice(0)) db.close(); });
async function setup() {
  const db = createV12Database(); databases.push(db); const repo = new SettingsRepository(db); await repo.setFloat('font_size', 21); await repo.setString('custom_font_path', 'font.ttf'); await repo.setLong('total_read_time_seconds', 999); await repo.setBoolean('favorites_protected', true);
  const secure = new MemorySecureStore(), sources = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files: new FileSystemSourceConfigFile(new MemoryFileSystem()) });
  const context = { selectedBookKeys: new Set(['1', 'source::comic']), sources, scripts: { exportPortable: vi.fn(async () => []), importPortable: vi.fn(async () => {}) }, sourceIds: ['builtin', 'public'], storage: localStorage, resource: vi.fn(async (path: string) => `@FILES@/${path}`), warnings: [] as string[] };
  return { db, repo, secure, context };
}
describe('native portable settings export from actual stores', () => {
  it('selects resources independently of settings and excludes history counters and protection secrets', async () => {
    const { db, context } = await setup();
    const resources = await exportNativeArchiveSettings(db, { categories: ['RESOURCES'], protectedAuthorized: false }, context);
    expect(resources).toEqual({ novel_reader_prefs: { custom_font_path: { type: 'string', value: '@FILES@/font.ttf' } } });
    const settings = await exportNativeArchiveSettings(db, { categories: ['SETTINGS'], protectedAuthorized: false }, context);
    expect(settings.novel_reader_prefs).toEqual({ font_size: { type: 'float', value: 21 } }); expect(settings.god).toEqual({ ranking_style: 'podium', last_page_hint: true, gyro_parallax: true });
  });
  it('exports comic settings only for visible selected book keys and ignores unknown namespaces', async () => {
    const { db, context } = await setup();
    localStorage.setItem('comic_reader_store:book_cfg_1', '{}'); localStorage.setItem('comic_reader_store:resume_source::comic_chapter', '{}'); localStorage.setItem('comic_reader_store:book_cfg_2', '{"secret":"private book"}'); localStorage.setItem('comic_reader_store:device_secret', 'credential');
    const output = await exportNativeArchiveSettings(db, { categories: ['SETTINGS'], protectedAuthorized: false }, context);
    expect(output.comic_reader_store).toEqual({ book_cfg_1: { type: 'string', value: '{}' }, 'resume_source::comic_chapter': { type: 'string', value: '{}' } }); expect(JSON.stringify(output)).not.toMatch(/credential|private book/);
  });
  it('skips an entire source containing credentials without reading account or Worker stores', async () => {
    const { db, secure, context } = await setup();
    await context.sources.saveCustomSourceJson('public', '{"id":"public","name":"公开源"}'); await context.sources.saveCustomSourceJson('private', '{"id":"private","headers":{"Authorization":"secret"}}'); await context.sources.saveSourceState('builtin', false);
    await secure.set('privacy.pin.v1', 'pin-secret'); await secure.set('js_source_data.public', 'cookie-secret');
    const output = await exportNativeArchiveSettings(db, { categories: ['SOURCES'], protectedAuthorized: false }, context);
    expect(Object.keys(output.sources!)).toEqual(['public']); expect(output.source_states?.builtin).toBe(false); expect(context.warnings).toHaveLength(1); expect(context.scripts.exportPortable).toHaveBeenCalledOnce(); expect(JSON.stringify(output)).not.toMatch(/secret|cookie/);
  });
});
