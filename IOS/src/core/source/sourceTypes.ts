/**
 * Consolidated source-layer types — Android `com.example.source.*` → TypeScript.
 *
 * Every Kotlin file below was ported line-by-line into its own module (one
 * Android file → one TS file, declaration order preserved). This module is the
 * consolidated entry point: it re-exports the "remaining" source types so
 * consumers have a single import surface without duplicating any declaration.
 *
 * Android file → TS module:
 *   AuthenticationState.kt → ./authenticationState   (definition)
 *   BookFormat.kt          → ./bookFormat            (definition)
 *   ComicChapter.kt        → ./comicChapter          (definition)
 *   ComicInfo.kt           → ./comicInfo             (definition)
 *   ComicSource.kt         → ./comicSource           (definition)
 *   DownloadInfo.kt        → ./downloadInfo          (definition)
 *   LoginCredential.kt     → ./loginCredential       (definition)
 *   NovelInfo.kt           → ./novelInfo             (definition)
 *   SearchBook.kt          → ./searchBook            (definition)
 *   SourceCapabilities.kt  → ./sourceCapabilities    (definition)
 *   SourceException.kt     → ./sourceException       (definition)
 *   SourceResult.kt        → ./sourceResult          (definition)
 *   SourceRegistration.kt  → ./sourceRegistration    (definition)
 *
 * Not re-exported here (they have their own consolidated homes):
 *   BookSource.kt         → ./bookSource (also surfaced via ./bookSourceTypes)
 *   SourceConfig.kt       → ./sourceConfig (also surfaced via ./bookSourceTypes)
 *   SourceLog.kt          → ./sourceLog
 *   NetworkCalls.kt       → ./networkCalls
 */

/** Android `AuthenticationState.kt` — sealed interface + 4 objects. */
export { AuthenticationState } from './authenticationState';

/** Android `BookFormat.kt` — data class BookFormat (Kotlin `Long?` → `number | null`). */
export type { BookFormat } from './bookFormat';
export { createBookFormat } from './bookFormat';

/** Android `ComicChapter.kt` — data class ComicChapter (Kotlin `Float order` → `number`). */
export type { ComicChapter } from './comicChapter';
export { createComicChapter } from './comicChapter';

/** Android `ComicInfo.kt` — data class + mergedWith / isKnownComicAuthor / withComicDetail. */
export type { ComicInfo } from './comicInfo';
export {
  createComicInfo,
  mergedComicInfo,
  isKnownComicAuthor,
  withComicDetail,
} from './comicInfo';

/** Android `ComicSource.kt` — `interface ComicSource : BookSource` → abstract class. */
export { ComicSource } from './comicSource';

/** Android `DownloadInfo.kt` — data class DownloadInfo. */
export type { DownloadInfo } from './downloadInfo';
export { createDownloadInfo } from './downloadInfo';

/** Android `LoginCredential.kt` — data class LoginCredential. */
export type { LoginCredential } from './loginCredential';
export { createLoginCredential } from './loginCredential';

/** Android `NovelInfo.kt` — data class + WholeBookNovelSources + UpdatableNovelSource. */
export type { NovelInfo, UpdatableNovelSource } from './novelInfo';
export {
  createNovelInfo,
  novelInfoRevision,
  novelInfoHasRevision,
  WholeBookNovelSources,
} from './novelInfo';

/** Android `SearchBook.kt` — data class SearchBook. */
export type { SearchBook } from './searchBook';
export { createSearchBook } from './searchBook';

/** Android `SourceCapabilities.kt` — data class + isNovelSource / isComicSource extensions. */
export type { SourceCapabilities } from './sourceCapabilities';
export {
  createSourceCapabilities,
  sourceRequiresLogin,
  isNovelSource,
  isComicSource,
} from './sourceCapabilities';

/** Android `SourceException.kt` — sealed class → class hierarchy. */
export {
  SourceException,
  LoginRequired,
  NetworkError,
  ParseError,
  BookNotFound,
  Unknown,
} from './sourceException';

/**
 * Android `SourceResult.kt` — sealed class → discriminated union + factories/methods.
 * The plain re-export carries both meanings of `SourceResult` (type + const namespace).
 */
export type { SourceResultSuccess, SourceResultError } from './sourceResult';
export {
  SourceResult,
  sourceSuccess,
  sourceError,
  isSuccessSourceResult,
  isErrorSourceResult,
} from './sourceResult';

/** Android `SourceRegistration.kt` — `validRegistrationUrl` (OkHttp HttpUrl → WHATWG URL). */
export { validRegistrationUrl } from './sourceRegistration';
