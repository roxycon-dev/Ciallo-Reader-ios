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
 */

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
