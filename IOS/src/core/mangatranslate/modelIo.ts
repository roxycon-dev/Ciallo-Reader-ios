/**
 * Minimal filesystem surface used by the manga-translation **stubs**.
 *
 * Kotlin's manga-translation code reaches into `context.filesDir` / `context.cacheDir`
 * directly (`TranslateModelManager`, `TranslationCache`, `ChapterCatalog` is separate and
 * already ported). `src/core` must not import Capacitor, so this interface is the seam.
 *
 * Port map: Android `java.io.File` / `android.content.Context.cacheDir` →
 * {@link ModelFsEntry}. No behaviour is implemented here; the callers that need real IO
 * throw {@link MangaTranslateUnsupportedError} before touching it.
 */

/** `android.content.Context.filesDir` / `cacheDir` + a `File` stat. */
export interface ModelFsEntry {
  filesDir: string;
  cacheDir: string;
  /** `File.isFile`. */
  isFile(path: string): boolean;
  /** `File.length()`. */
  length(path: string): number;
  /** `File.lastModified()`. */
  lastModified(path: string): number;
}