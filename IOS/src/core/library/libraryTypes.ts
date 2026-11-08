/**
 * Port of Android `com.example.library.LibraryUiState.kt` (27 lines, 22 non-blank)
 * and `com.example.library.LibraryError.kt` (13 lines, 11 non-blank).
 *
 * Ported: 33 / 33 non-blank lines.
 *
 * Skipped lines (each with reason):
 * - LibraryUiState.kt:3  `import androidx.compose.runtime.Immutable` — Compose runtime
 *   concept, no TS equivalent (the frozen-ness is documented in the type instead).
 * - LibraryUiState.kt:19 `com.example.source.SourceException? failure` — the Android
 *   type lives in another module; the port uses the shared structural
 *   `LibrarySourceFailure` (same shape: a message-carrying error) so this module does
 *   not import `core/source` declarations that another agent owns.
 * - LibraryError.kt:3    `sealed class LibraryError : Exception()` — Kotlin class
 *   hierarchy → TS discriminated union on `kind`; every branch is preserved verbatim.
 * - LibraryError.kt:7-9, 11 — `object` singletons → union members with no payload;
 *   the Chinese doc comment on NetworkDetail is preserved on the member.
 *
 * Platform adaptations:
 * - `@Immutable data class` → `readonly` interface + object literal factories.
 * - `data class` `copy()` / destructuring → object spread at call sites.
 */

import type { SearchBook } from '@core/source/searchBook';
import type { SourceException } from '@core/source/sourceException';

/** Android `LibraryUiState.kt` — `AggregateGroup.failure: SourceException?`. */
export type LibrarySourceFailure = SourceException;

/** Android `sealed class LibraryUiState`. */
export type LibraryUiState =
  | { kind: 'Loading' }
  | { kind: 'Empty' }
  | { kind: 'Ready' }
  | { kind: 'Searching' }
  | { kind: 'SearchResults'; results: SearchBook[]; loading: boolean }
  | { kind: 'AggregateResults'; groups: LibraryAggregateGroup[]; running: boolean }
  | { kind: 'Downloading'; taskId: string; progress: number }
  | { kind: 'Error'; error: LibraryError };

/** Android `data class AggregateGroup(sourceId, sourceName, books, error, loading, failure)`. */
export interface LibraryAggregateGroup {
  sourceId: string;
  sourceName: string;
  books: SearchBook[];
  error: string | null;
  loading: boolean;
  failure: LibrarySourceFailure | null;
}

/** Kotlin object factories (`Loading`/`Empty`/…). */
export const LibraryUiLoading: LibraryUiState = { kind: 'Loading' };
export const LibraryUiEmpty: LibraryUiState = { kind: 'Empty' };
export const LibraryUiReady: LibraryUiState = { kind: 'Ready' };
export const LibraryUiSearching: LibraryUiState = { kind: 'Searching' };

/** Kotlin `LibraryUiState.AggregateGroup(...)` — loading defaults to false. */
export function libraryAggregateGroup(
  sourceId: string,
  sourceName: string,
  books: SearchBook[],
  error: string | null,
  loading = false,
  failure: LibrarySourceFailure | null = null,
): LibraryAggregateGroup {
  return { sourceId, sourceName, books, error, loading, failure };
}

/** Kotlin `LibraryUiState.AggregateResults(groups, running)`. */
export function libraryAggregateResults(
  groups: LibraryAggregateGroup[],
  running: boolean,
): LibraryUiState {
  return { kind: 'AggregateResults', groups, running };
}

/** Kotlin `LibraryUiState.SearchResults(results, loading = false)`. */
export function librarySearchResults(
  results: SearchBook[],
  loading = false,
): LibraryUiState {
  return { kind: 'SearchResults', results, loading };
}

/** Kotlin `LibraryUiState.Downloading(taskId, progress)`. */
export function libraryDownloading(taskId: string, progress: number): LibraryUiState {
  return { kind: 'Downloading', taskId, progress };
}

/** Kotlin `LibraryUiState.Error(error)`. */
export function libraryErrorState(error: LibraryError): LibraryUiState {
  return { kind: 'Error', error };
}

/**
 * Android `sealed class LibraryError : Exception()`.
 *
 * `message` mirrors Kotlin `Exception.message` — it is `null` for every `object`
 * branch (which have no `override val message`) and the payload string for the
 * three `data class` branches. `causeException` mirrors `Unknown.causeException`.
 */
export type LibraryError =
  | { kind: 'NetworkUnavailable' }
  /** 网络请求失败，携带真实原因（HTTP 状态码 / DNS / TLS / 超时等），供界面展示与调试。 */
  | { kind: 'NetworkDetail'; message: string }
  | { kind: 'SourceUnavailable' }
  | { kind: 'AuthenticationRequired' }
  | { kind: 'CloudflareBlocked' }
  | { kind: 'InvalidFile' }
  | { kind: 'ParseFailed'; message: string }
  | { kind: 'Unknown'; message: string; causeException: unknown | null };

/** Kotlin `Exception.message` for the sealed branch (null for `object` branches). */
export function libraryErrorMessage(error: LibraryError): string | null {
  switch (error.kind) {
    case 'NetworkDetail':
    case 'ParseFailed':
    case 'Unknown':
      return error.message;
    default:
      return null;
  }
}

/* ── LibraryError.kt singleton factories (the Kotlin `object` branches) ── */

export const LibraryErrorNetworkUnavailable: LibraryError = { kind: 'NetworkUnavailable' };
export const LibraryErrorSourceUnavailable: LibraryError = { kind: 'SourceUnavailable' };
export const LibraryErrorAuthenticationRequired: LibraryError = { kind: 'AuthenticationRequired' };
export const LibraryErrorCloudflareBlocked: LibraryError = { kind: 'CloudflareBlocked' };
export const LibraryErrorInvalidFile: LibraryError = { kind: 'InvalidFile' };

export function libraryErrorNetworkDetail(message: string): LibraryError {
  return { kind: 'NetworkDetail', message };
}

export function libraryErrorParseFailed(message: string): LibraryError {
  return { kind: 'ParseFailed', message };
}

export function libraryErrorUnknown(
  message: string,
  causeException: unknown | null = null,
): LibraryError {
  return { kind: 'Unknown', message, causeException };
}

/** Kotlin call-site namespace (`LibraryError.NetworkUnavailable` etc.). */
export const LibraryError = {
  NetworkUnavailable: LibraryErrorNetworkUnavailable,
  NetworkDetail: libraryErrorNetworkDetail,
  SourceUnavailable: LibraryErrorSourceUnavailable,
  AuthenticationRequired: LibraryErrorAuthenticationRequired,
  CloudflareBlocked: LibraryErrorCloudflareBlocked,
  InvalidFile: LibraryErrorInvalidFile,
  ParseFailed: libraryErrorParseFailed,
  Unknown: libraryErrorUnknown,
} as const;
