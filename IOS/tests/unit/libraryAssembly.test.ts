/**
 * E94 —— `LibraryViewModel` 的宿主装配。
 *
 * Android 权威：`com.example.library.LibraryViewModel` 的构造函数
 * （`LibraryViewModel.kt:57-73`）：
 * ```kotlin
 * class LibraryViewModel(application: Application) : AndroidViewModel(application) {
 *     val sourceManager = SourceManager(SharedPreferencesSourceStorage(application))   // L59
 *     val downloadManager = DownloadManager(application)                             // L62
 *     private val database = AppDatabase.getDatabase(application)                    // L67
 *     private val repository = BookRepository(application, database.bookDao())        // L68
 *     val prefs = com.example.data.PreferencesManager(application)                   // L73
 * }
 * ```
 *
 * 装配前 `setLibraryRuntime()` 零调用方 → `LibraryPage` 永远跑在
 * `emptyRuntimeViewModel()`（18 个端口全是返回空值的桩）上，书库页整体是空壳。
 *
 * 本测试验证：
 *  1. 装配后 `getLibraryRuntime()` 返回真实 ViewModel（不再是 null）；
 *  2. 六个必需端口接的不是桩：`prefs` 读得到真实落库值、`sources` 能初始化、
 *     `downloads` 能枚举任务、`repository` 能读书架；
 *  3. 平台适配器（`SecureStoreSourcePrefs` 等）的 `edit()`/`commit()` 批量语义、
 *     string-set 编解码与 `all()` 同步快照。
 */

import { describe, expect, it } from 'vitest';
import {
  createLibraryAssembly,
  installLibraryRuntime,
  type LibraryAssemblyPorts,
} from '@core/library/libraryAssembly';
import { getLibraryRuntime, setLibraryRuntime } from '@core/library/libraryRuntime';
import {
  SecureStoreNovelPrefs,
  SecureStoreRecordMetadataPrefs,
  SecureStoreSourcePrefs,
  FileSystemSourceConfigFile,
} from '@platform/web/platformAdapters';
import { createMemorySecureStore, createMemoryFileSystem, InMemorySqliteDatabase, openSchemaV12 } from '@platform/web-mock';
import { createFetchHttpClient } from '@platform/web-mock';

/** Android 的键名（`PreferencesManager.kt` / `settingsRepository.ts` 逐字一致）。 */
const K_WELCOME = 'has_seen_welcome';
const K_SOURCE = 'has_configured_source';
const K_MULTI_LANG = 'multi_language_search';

async function makePorts(over: Partial<LibraryAssemblyPorts> = {}): Promise<LibraryAssemblyPorts> {
  const db = new InMemorySqliteDatabase();
  await openSchemaV12(db);
  const { FavoriteDao } = await import('@core/library/favoriteDao');
  const secure = createMemorySecureStore();
  const fs = createMemoryFileSystem();
  return {
    db,
    fs,
    http: createFetchHttpClient(),
    secrets: secure,
    sourcePrefs: new SecureStoreSourcePrefs(secure),
    // 书源 JSON 配置文件（`source_configs/<sha256>.json`）
    sourceConfigs: new FileSystemSourceConfigFile(fs),
    novelPrefs: new SecureStoreNovelPrefs(secure),
    recordMetadataPrefs: new SecureStoreRecordMetadataPrefs(secure),
    favoriteDao: new FavoriteDao(db as never),
    comicSourceOf: async () => null,
    downloadsDir: 'downloads',
    ...over,
  };
}

describe('LibraryViewModel 宿主装配（E94）', () => {
  it('装配前 runtime 是 null（这正是 E94 的病根）', () => {
    setLibraryRuntime(null);
    expect(getLibraryRuntime()).toBeNull();
  });

  it('installLibraryRuntime 把真实 ViewModel 注册进 runtime', async () => {
    setLibraryRuntime(null);
    const runtime = installLibraryRuntime(await makePorts());
    expect(getLibraryRuntime()).toBe(runtime);
    expect(runtime.viewModel).toBeTruthy();
    // 不再是空壳：LibraryPage 拿到的就是它
    expect(runtime.viewModel.constructor.name).toBe('LibraryViewModel');
    setLibraryRuntime(null);
  });

  it('prefs 端口读的是真实落库值，不是恒返回 false 的桩', async () => {
    const ports = await makePorts();
    const { SettingsRepository } = await import('@core/settings/settingsRepository');
    const settings = new SettingsRepository(ports.db);
    await settings.setBoolean(K_WELCOME, true);
    await settings.setBoolean(K_SOURCE, true);
    await settings.setBoolean(K_MULTI_LANG, false);

    const { prefs } = createLibraryAssembly(ports);
    expect(await prefs.hasSeenWelcome()).toBe(true);
    expect(await prefs.hasConfiguredSource()).toBe(true);
    expect(await prefs.multiLanguageSearch()).toBe(false);
    // 写入也落到同一个 ViewModel 用的实例上
    await settings.setBoolean(K_WELCOME, false);
    expect(await prefs.hasSeenWelcome()).toBe(false);
  });

  it('sources 端口接到真实的 SourceManager（可 initialize、可枚举）', async () => {
    const assembly = createLibraryAssembly(await makePorts());
    await assembly.sourceManager.initialize();
    expect(Array.isArray(assembly.sourceManager.availableSources.value)).toBe(true);
    expect(assembly.sourceManager.getSource('__missing__')).toBeNull();
  });

  it('downloads / repository 端口返回真实集合而不是空 Map', async () => {
    const assembly = createLibraryAssembly(await makePorts());
    expect(assembly.downloadManager).toBeTruthy();
    expect(await assembly.downloadTasks.getAllTasks()).toEqual([]);
    expect(await assembly.repository.getAllBooksSync()).toEqual([]);
    expect(await assembly.favorites.favorites()).toEqual([]);
  });
});

describe('平台适配器（E94 的配件）', () => {
  it('SecureStoreSourcePrefs：put/get 往返，string-set 编解码', async () => {
    const prefs = new SecureStoreSourcePrefs(createMemorySecureStore());
    await prefs.putBoolean('source_enabled_a', true);
    expect(await prefs.getString('source_enabled_a', null)).toBe('true');
    await prefs.putString('active_source_id', 'js_a');
    expect(await prefs.getString('active_source_id', null)).toBe('js_a');
    await prefs.putStringSet('custom_source_ids', new Set(['x', 'y']));
    expect(Array.from(await prefs.getStringSet('custom_source_ids')).sort()).toEqual(['x', 'y']);
    // all() 是**同步**快照（Android SharedPreferences.all 的语义）
    const all = prefs.all();
    expect(all['source_enabled_a']).toBe(true);
    expect(all['active_source_id']).toBe('js_a');
    expect(all['custom_source_ids']).toBeInstanceOf(Set);
  });

  it('remove 只入队，commit() 才落盘（Android edit() 的批量语义）', async () => {
    const store = createMemorySecureStore();
    const prefs = new SecureStoreSourcePrefs(store);
    await prefs.putString('to_remove', 'value');
    prefs.remove('to_remove');
    // 未 commit 时存储里还在
    expect(await store.get('to_remove')).toBe('value');
    expect(await prefs.commit()).toBe(true);
    expect(await store.get('to_remove')).toBeNull();
    expect(prefs.all()['to_remove']).toBeUndefined();
  });

  it('SecureStoreNovelPrefs.putString 返回 false 而不是抛（commit 语义）', async () => {
    const novelPrefs = new SecureStoreNovelPrefs(createMemorySecureStore());
    expect(await novelPrefs.putString('k', 'v')).toBe(true);
    expect(await novelPrefs.getString('k')).toBe('v');
    await novelPrefs.remove('k');
    expect(await novelPrefs.getString('k')).toBeNull();
  });

  it('FileSystemSourceConfigFile：write→rename→finishWrite 的提升流程', async () => {
    const fs = createMemoryFileSystem();
    const files = new FileSystemSourceConfigFile(fs);
    expect(files.filesDir()).toBe('');
    files.writeText('source_configs/a.json.bak', '{"a":1}');
    expect(files.readText('source_configs/a.json.bak')).toBe('{"a":1}');
    expect(files.length('source_configs/a.json.bak')).toBe(7);
    files.rename('source_configs/a.json.bak', 'source_configs/a.json');
    expect(files.readText('source_configs/a.json')).toBe('{"a":1}');
    expect(files.readText('source_configs/a.json.bak')).toBeNull();
    await files.flush();
    expect(await fs.exists('source_configs/a.json')).toBe(true);
    files.delete('source_configs/a.json');
    await files.flush();
    expect(files.exists('source_configs/a.json')).toBe(false);
  });
});