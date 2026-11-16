import { describe, expect, it } from 'vitest';
import { SecureStoreSourcePrefs, FileSystemSourceConfigFile } from '@platform/web/platformAdapters';
import { MemorySecureStore } from '@platform/web-mock/memorySecureStore';
import { MemoryFileSystem } from '@platform/web-mock/memoryFileSystem';
import { SharedPreferencesSourceStorage } from '@core/source/storage/sharedPreferencesSourceStorage';
import { SourceManager } from '@core/source/sourceManager';
import { AutoNovelSource } from '@core/source/impl/autoNovelSource';
import type { FileSystemApi } from '@platform/interfaces';

describe('native source switches survive a new adapter instance', () => {
  it('queues source mutations behind a transfer lease and releases them after failure', async () => {
    const secure = new MemorySecureStore(), storage = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files: new FileSystemSourceConfigFile(new MemoryFileSystem()) });
    const source = new AutoNovelSource({ client: { request: async () => { throw new Error('Unexpected request'); } } }), manager = new SourceManager(storage); await manager.registerSource(source);
    let release!: () => void, entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; }); const hold = new Promise<void>((resolve) => { release = resolve; });
    const lease = manager.withMutationLease(async () => { entered(); await hold; throw new Error('intentional rollback'); }); await started;
    const update = manager.setSourceEnabled(source.id, false); await Promise.resolve(); expect(await secure.get(`source_enabled_${source.id}`)).toBeNull();
    release(); await expect(lease).rejects.toThrow('intentional rollback'); await update; expect(await secure.get(`source_enabled_${source.id}`)).toBe('false');
  });
  it('does not publish a disabled switch when the secure write fails', async () => {
    const secure = new MemorySecureStore(), storage = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files: new FileSystemSourceConfigFile(new MemoryFileSystem()) });
    const source = new AutoNovelSource({ client: { request: async () => { throw new Error('Unexpected network request'); } } }), manager = new SourceManager(storage);
    await manager.initialize(); await manager.registerSource(source); const set = secure.set.bind(secure);
    secure.set = async (key, value) => { if (key.startsWith('source_enabled_')) throw new Error('Secure write failed'); await set(key, value); };
    await expect(manager.setSourceEnabled(source.id, false)).rejects.toThrow('Secure write failed'); expect(manager.isSourceEnabled(source.id)).toBe(true); expect(manager.availableSources.value).toHaveLength(1);
  });
  it('persists custom definitions to the filesystem and reads them from a fresh adapter after restart', async () => {
    const secure = new MemorySecureStore(), fs = new MemoryFileSystem();
    const first = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files: new FileSystemSourceConfigFile(fs) });
    await first.saveCustomSourceJson('public', '{"name":"真实落盘的书源"}');
    expect(await fs.list('source_configs')).toHaveLength(1);
    const second = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files: new FileSystemSourceConfigFile(fs) });
    expect(await second.getCustomSourceJsons()).toEqual({ public: '{"name":"真实落盘的书源"}' });
    await second.removeCustomSourceJson('public');
    expect(await fs.list('source_configs')).toEqual([]);
  });
  it('keeps the old definition and source registry when an atomic replacement fails', async () => {
    const secure = new MemorySecureStore(), memory = new MemoryFileSystem(), fs: FileSystemApi = memory;
    const storage = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files: new FileSystemSourceConfigFile(fs) }), manager = new SourceManager(storage);
    const client = { request: async () => { throw new Error('Unexpected network request'); } }, old = new AutoNovelSource({ client });
    await manager.initialize(); await manager.registerCustomSource(old, '{"name":"原有定义"}');
    fs.writeFileAtomic = async () => { throw new Error('Disk full'); };
    await expect(manager.registerCustomSource(new AutoNovelSource({ client }), '{"name":"失败的新定义"}')).rejects.toThrow('Disk full');
    expect(manager.allSources.value[0]).toBe(old);
    const restarted = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files: new FileSystemSourceConfigFile(fs) });
    expect(await restarted.getCustomSourceJsons()).toEqual({ [old.id]: '{"name":"原有定义"}' });
  });
  it('keeps a built-in source disabled when it is registered after manager initialization', async () => {
    const secure = new MemorySecureStore(), files = new FileSystemSourceConfigFile(new MemoryFileSystem());
    const source = new AutoNovelSource({ client: { request: async () => { throw new Error('Registration must not perform network IO'); } } });
    await new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files }).saveSourceState(source.id, false);
    const manager = new SourceManager(new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files }));
    await manager.initialize(); await manager.registerSource(source);
    expect(manager.allSources.value).toHaveLength(1); expect(manager.availableSources.value).toEqual([]); expect(manager.enabledStates.value.get(source.id)).toBe(false);
  });
  it('reloads saved enabled/disabled flags for registered sources without relying on a warm mirror', async () => {
    const secure = new MemorySecureStore(), files = new FileSystemSourceConfigFile(new MemoryFileSystem());
    const first = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files }); await first.saveSourceState('disabled', false); await first.saveSourceState('enabled', true);
    const second = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files });
    expect(await second.getSourceStates(['disabled', 'enabled', 'unset'])).toEqual({ disabled: false, enabled: true });
    expect(await second.getSourceStates()).toEqual({ disabled: false, enabled: true });
  });
  it('loads custom-source flags from their persisted id set and preserves unusual ids safely', async () => {
    const secure = new MemorySecureStore(), files = new FileSystemSourceConfigFile(new MemoryFileSystem());
    const first = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files });
    await first.saveCustomSourceJson('__proto__', '{"id":"__proto__"}'); await first.saveSourceState('__proto__', false);
    const second = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(secure), files }), states = await second.getSourceStates();
    expect(Object.hasOwn(states, '__proto__')).toBe(true); expect(states['__proto__']).toBe(false); expect(Object.getPrototypeOf(states)).toBeNull();
    const definitions = await second.getCustomSourceJsons(); expect(Object.hasOwn(definitions, '__proto__')).toBe(true); expect(definitions['__proto__']).toBe('{"id":"__proto__"}');
  });
});
