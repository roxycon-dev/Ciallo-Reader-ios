/**
 * Filesystem seam for the `BookRepository` disk-accounting / orphan-cleanup methods.
 *
 * Kotlin source: `novel-reader/app/src/main/java/com/example/data/BookRepository.kt`
 *   lines 659..691  `suspend fun booksDiskBytes(books: List<Book>): Long`
 *   lines 726..751  `suspend fun cleanupOrphanFiles()`
 *
 * Both Android methods read `context.filesDir` and the download-task table directly.
 * `src/core` must not import Capacitor (enforced by ESLint), so the filesystem is injected
 * here and the *accounting rules* stay in `bookRepository.ts` where the Android line map
 * lives. Everything in this file is a thin, side-effect-free string/path helper.
 *
 * Kotlin API → TS:
 *   `File.removePrefix("file://")`            → {@link stripFileScheme}
 *   `File(nameWithoutExtension)`               → {@link baseNameWithoutExtension}
 *   `File.extension`                           → {@link extensionOf}
 *   `File.canonicalPath ?: File.absolutePath`  → `fs.canonicalPath(path) ?? path`
 *   `File.name`                                → {@link fileNameOf}
 *   `File.walkBottomUp().filter { it.isFile }.sumOf { it.length() }` → `fs.walkFileBytes`
 *   `File.parentFile` (canonical)              → `fs.parent`
 *   `File.deleteRecursively()`                 → `fs.deleteRecursively`
 *
 * The async half of this file (below) is the port used by `deleteBook` /
 * `booksDiskBytes`: Kotlin runs both on `Dispatchers.IO`, and the native bridge only
 * exposes Promise-based `Filesystem.*` calls, so a second, Promise-returning surface
 * mirrors the same `File` semantics instead of blocking the JS thread.
 */

import type { FileSystemApi } from '@platform/interfaces';

/** `java.io.File` surface required by the two BookRepository methods. */
export interface BookRepositoryFileSystem {
  /** `context.filesDir`. */
  filesDir(): string;
  /** `File.isFile`. */
  isFile(path: string): boolean;
  /** `File.isDirectory`. */
  isDirectory(path: string): boolean;
  /** `File.length()`. */
  length(path: string): number;
  /** `File.lastModified()`. */
  lastModified(path: string): number;
  /** `File.listFiles()` — direct children; empty when absent (Kotlin `.orEmpty()`). */
  listFiles(dir: string): string[];
  /** `File.canonicalPath`. */
  canonicalPath(path: string): string | null;
  /** `File.name`. */
  name(path: string): string;
  /** Canonical parent directory, i.e. `File.canonicalFile.parentFile`. */
  parent(path: string): string | null;
  /** `File.delete()`. */
  delete(path: string): void;
  /** `File.deleteRecursively()`. */
  deleteRecursively(path: string): void;
  /** Recursive byte total of a directory tree (`walkBottomUp().filter { isFile }`). */
  walkFileBytes(path: string): number;
}

/** `File.taskFilePath.removePrefix("file://")`. */
export function stripFileScheme(path: string): string {
  return path.startsWith('file://') ? path.slice('file://'.length) : path;
}

/** `File.name`. */
export function fileNameOf(path: string): string {
  const normalized = stripFileScheme(path);
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

/** `File.nameWithoutExtension`. */
export function baseNameWithoutExtension(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** `File.extension` (no leading dot; empty when there is none). */
export function extensionOf(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

/**
 * `File(parent, child).path` / `new File(dir, name)` — join without letting a
 * leading slash on `name` escape the parent. `dir === ''` keeps `name` relative
 * (the host FS root is addressed by the empty string, see
 * {@link AsyncBookRepositoryFileSystem.filesDir}).
 */
export function joinFsPath(dir: string, name: string): string {
  const base = stripFileScheme(dir).replace(/\/+$/, '');
  const child = name.replace(/^\/+/, '');
  if (base === '') return child;
  if (child === '') return base;
  return `${base}/${child}`;
}

/**
 * Asynchronous `java.io.File` surface for the two BookRepository methods that
 * Android runs on `Dispatchers.IO` (`deleteBookFiles`, `booksDiskBytes`).
 *
 * The synchronous {@link BookRepositoryFileSystem} above is what Capacitor cannot
 * provide (every `Filesystem.*` call is a Promise), so the port is duplicated with
 * `Promise` return types instead of pretending the native FS is synchronous.
 * Implementations must confine every path to the app data directory — on iOS the
 * Capacitor bridge already does (`normalizeFsPath` + `Directory.Data`), so
 * {@link AsyncBookRepositoryFileSystem.filesDir} returns `''` for it.
 */
export interface AsyncBookRepositoryFileSystem {
  /**
   * `context.filesDir` canonical path. `''` means "the host FS is already rooted at
   * the app data directory", which is what the Capacitor adapter reports.
   */
  filesDir(): Promise<string>;
  /** `File.exists()`. */
  exists(path: string): Promise<boolean>;
  /** `File.isDirectory`. */
  isDirectory(path: string): Promise<boolean>;
  /** `File.length()`. */
  size(path: string): Promise<number>;
  /** `File.listFiles()` — direct children as full paths; empty when absent. */
  list(dir: string): Promise<string[]>;
  /** `File.canonicalPath`; `null` when the string is not a local path. */
  canonicalPath(path: string): Promise<string | null>;
  /** `File.delete()` — must not throw for a missing target. */
  delete(path: string): Promise<void>;
  /** `File.deleteRecursively()`. */
  deleteRecursively(path: string): Promise<void>;
  /** `File.walkBottomUp().filter { it.isFile }.sumOf { it.length() }`. */
  walkFileBytes(path: string): Promise<number>;
}

/**
 * Platform FS capabilities the generic adapter uses when the host exposes them.
 * `platform/ios-native/index.ts` adds both (`Filesystem.stat` / `Filesystem.rmdir`);
 * the web mock has neither and falls back to probing with `size`/`readFile`/`list`.
 */
export interface BookFileSystemApi extends FileSystemApi {
  /** `File.isFile` / `File.isDirectory` / missing, in one `stat` round-trip. */
  kind?(path: string): Promise<'file' | 'directory' | 'none'>;
  /** `File.deleteRecursively()` on a directory (`Filesystem.rmdir`). */
  removeDirectory?(path: string): Promise<void>;
}

/** `File(path)` canonicalisation: strip `file://`, collapse `.`/`..`, reject URIs. */
function normalizeVirtualPath(path: string): string | null {
  const raw = stripFileScheme(path).replace(/\\/g, '/');
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  const parts: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join('/');
}

/**
 * Adapt a host {@link FileSystemApi} (Capacitor `Filesystem`, `MemoryFileSystem`)
 * to {@link AsyncBookRepositoryFileSystem}.
 *
 * `src/core` cannot import the platform object graph, so `libraryAssembly` passes
 * `ports.fs` through this factory — no Capacitor import leaks into core.
 */
export function createAsyncBookRepositoryFileSystem(
  api: BookFileSystemApi,
): AsyncBookRepositoryFileSystem {
  const fileSize = async (path: string): Promise<number> => {
    if (api.size !== undefined) return api.size(path);
    return (await api.readFile(path)).byteLength;
  };

  const kindOf = async (path: string): Promise<'file' | 'directory' | 'none'> => {
    if (api.kind !== undefined) return api.kind(path);
    try {
      await fileSize(path);
      return 'file';
    } catch {
      const children = await api.list(path).catch(() => []);
      return children.length > 0 ? 'directory' : 'none';
    }
  };

  const children = async (dir: string): Promise<string[]> => {
    const names = await api.list(dir).catch(() => []);
    return names.map((name) => joinFsPath(dir, name));
  };

  const adapter: AsyncBookRepositoryFileSystem = {
    filesDir: () => Promise.resolve(''),
    exists: (path) => api.exists(path),
    isDirectory: async (path) => (await kindOf(path)) === 'directory',
    size: fileSize,
    list: children,
    canonicalPath: (path) => Promise.resolve(normalizeVirtualPath(path)),
    delete: async (path) => {
      await api.delete(path);
    },
    deleteRecursively: async (path) => {
      const kind = await kindOf(path);
      if (kind === 'none') return;
      if (kind === 'file') {
        await api.delete(path);
        return;
      }
      for (const child of await children(path)) {
        await adapter.deleteRecursively(child);
      }
      if (api.removeDirectory !== undefined) {
        await api.removeDirectory(path);
      } else {
        await api.delete(path);
      }
    },
    walkFileBytes: async (path) => {
      const kind = await kindOf(path);
      if (kind === 'none') return 0;
      if (kind === 'file') {
        try {
          return await fileSize(path);
        } catch {
          return 0;
        }
      }
      let total = 0;
      for (const child of await children(path)) {
        total += await adapter.walkFileBytes(child);
      }
      return total;
    },
  };
  return adapter;
}
