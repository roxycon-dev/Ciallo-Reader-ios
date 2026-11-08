import type { FileStoragePort, KeyValueStorage } from '@core/source/js/jsPlatform';
import type { FileSystemApi } from '@platform/interfaces';
import type { EnginePreferences } from './engine';

export function preferencePort(store: EnginePreferences): KeyValueStorage {
  const put = (key: string, value: string): void => store.update({ ...store.values, [key]: value });
  return {
    getString: (key) => store.values[key] ?? null,
    getBoolean: (key, fallback) => key in store.values ? store.values[key] === 'true' : fallback,
    getInt: (key, fallback) => key in store.values ? Number(store.values[key]) : fallback,
    putString: put, putBoolean: (key, value) => put(key, String(value)), putInt: (key, value) => put(key, String(value)),
    remove: (key) => { const values = { ...store.values }; delete values[key]; store.update(values); },
    clear: () => store.update({}),
  };
}

/** Synchronous script-cache view with awaited writes to the app-private filesystem. */
export async function sourceFileStorage(fs: FileSystemApi, assets: Record<string, string>): Promise<FileStoragePort & { flush(): Promise<void> }> {
  const files = new Map<string, Uint8Array>();
  const failures = new Map<string, unknown>();
  let writes = Promise.resolve();
  const paths = await fs.list('js_sources');
  let cacheBytes = 0;
  const ordered = paths.slice().sort((a, b) => Number(b.endsWith('index.json')) - Number(a.endsWith('index.json')));
  for (const name of ordered.slice(0, 501)) {
    const base = name.replace(/^js_sources\//, '');
    if (base !== 'index.json' && !/^[\w.-]+\.js$/.test(base)) continue;
    const path = name.startsWith('js_sources/') ? name : `js_sources/${name}`;
    try {
      const bytes = await fs.readFile(path);
      if (bytes.length > (base === 'index.json' ? 1024 * 1024 : 512 * 1024) || cacheBytes + bytes.length > 32 * 1024 * 1024) continue;
      cacheBytes += bytes.length; files.set(path, bytes);
    } catch { /* A missing/corrupt cache file must not hide the other installed sources. */ }
  }
  const persist = (path: string, action: () => Promise<void>): void => {
    writes = writes.then(async () => {
      try {
        if (path === 'js_sources/index.json' && [...failures.keys()].some((key) => key !== path)) throw new Error('书源脚本未完整保存，未提交新索引');
        await action(); failures.delete(path);
      } catch (error) { failures.set(path, error); }
    });
  };
  const write = (path: string, bytes: Uint8Array): void => {
    const index = path === 'js_sources/index.json';
    const nextBytes = cacheBytes - (files.get(path)?.length ?? 0) + bytes.length;
    if (bytes.length > (index ? 1024 * 1024 : 512 * 1024) || nextBytes > (index ? 32 : 31) * 1024 * 1024) throw new Error('书源缓存超过内存容量上限');
    const snapshot = bytes.slice();
    cacheBytes = nextBytes;
    files.set(path, snapshot);
    persist(path, () => fs.writeFile(path, snapshot));
  };
  return {
    filesDir: () => '', cacheDir: () => 'cache',
    exists: (path) => files.has(path.replace(/^\//, '')),
    readBytes: (path) => files.get(path.replace(/^\//, ''))?.slice() ?? null,
    readText: (path) => { const bytes = files.get(path.replace(/^\//, '')); return bytes ? new TextDecoder().decode(bytes) : null; },
    writeBytes: (path, bytes) => write(path.replace(/^\//, ''), bytes),
    writeText: (path, text) => write(path.replace(/^\//, ''), new TextEncoder().encode(text)),
    delete(path) { const normalized = path.replace(/^\//, ''); cacheBytes -= files.get(normalized)?.length ?? 0; files.delete(normalized); persist(normalized, () => fs.delete(normalized)); },
    mkdirs() {}, length: (path) => files.get(path.replace(/^\//, ''))?.byteLength ?? 0,
    toFileUrl: (path) => `file://${path}`, readAsset: (path) => assets[path] ?? null,
    listFiles: (directory) => [...files.keys()].filter((path) => path.startsWith(`${directory.replace(/^\//, '')}/`)),
    flush: async () => { await writes; if (failures.size) throw [...failures.values()][0]; },
  };
}
