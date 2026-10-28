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
  let writes = Promise.resolve();
  const paths = await fs.list('js_sources');
  await Promise.all(paths.map(async (name) => {
    const path = name.startsWith('js_sources/') ? name : `js_sources/${name}`;
    files.set(path, await fs.readFile(path));
  }));
  const write = (path: string, bytes: Uint8Array): void => {
    files.set(path, bytes);
    writes = writes.then(() => fs.writeFile(path, bytes));
  };
  return {
    filesDir: () => '', cacheDir: () => 'cache',
    exists: (path) => files.has(path.replace(/^\//, '')),
    readBytes: (path) => files.get(path.replace(/^\//, '')) ?? null,
    readText: (path) => { const bytes = files.get(path.replace(/^\//, '')); return bytes ? new TextDecoder().decode(bytes) : null; },
    writeBytes: (path, bytes) => write(path.replace(/^\//, ''), bytes),
    writeText: (path, text) => write(path.replace(/^\//, ''), new TextEncoder().encode(text)),
    delete(path) { const normalized = path.replace(/^\//, ''); files.delete(normalized); writes = writes.then(() => fs.delete(normalized)); },
    mkdirs() {}, length: (path) => files.get(path.replace(/^\//, ''))?.byteLength ?? 0,
    toFileUrl: (path) => `file://${path}`, readAsset: (path) => assets[path] ?? null,
    listFiles: (directory) => [...files.keys()].filter((path) => path.startsWith(`${directory.replace(/^\//, '')}/`)),
    flush: () => writes,
  };
}
