/**
 * Library runtime registry — the host-side wiring seam for the ported
 * `LibraryViewModel.kt` / `ComicDownloadManager.kt` / `BookShareHelper.kt`.
 *
 * No Android counterpart: this file exists because `App.tsx` / `appStore.ts` are owned
 * by another agent, so the library page must be able to obtain (and a host must be able
 * to install) a fully wired ViewModel without this module reaching into the app shell.
 *
 * Usage:
 *   // host (App bootstrap / settings page):
 *   setLibraryRuntime({ viewModel, comicDownloads, shareHelper });
 *   // LibraryPage.tsx: getLibraryRuntime()
 *
 * Pure TypeScript — no React/DOM/Capacitor imports, so `src/core` stays platform-free
 * (see `eslint.config.js` `no-restricted-imports` for `src/core/**`).
 */

import type { BookShareHelper } from './libraryBookShare';
import type { ComicDownloadManager } from './libraryComicDownload';
import { LibraryViewModel, type LibraryViewModelDeps } from './libraryViewModel';
import type { SearchBook } from '@core/source/searchBook';
import type { BookSource } from '@core/source/bookSource';
import type { SourceManager } from '@core/source/sourceManager';
import type { FavoriteRepository } from './favoriteRepository';

export interface LibraryRuntime {
  sourceManager?: SourceManager;
  favorites?: FavoriteRepository;
  viewModel: LibraryViewModel;
  comicDownloads: ComicDownloadManager | null;
  shareHelper: BookShareHelper | null;
  /**
   * LibraryScreen.kt:188 `favoriteKeys: Set<String>` —
   * `"sourceId::comicId"` keys of the shelf cards whose ♡ is already filled.
   * Sourced from `FavoriteRepository.favoriteKeys()` (see `favoriteRepository.ts`).
   */
  favoriteKeys?: string[];
  /** LibraryScreen.kt:190 `onToggleFavorite: (SearchBook, Boolean) -> Unit`. */
  onToggleFavorite?: (book: SearchBook, favorite: boolean) => void;
  /**
   * LibraryScreen.kt:1029-1031 (result card "下载") and :1092-1093 (novel detail sheet
   * "下载") — when the source declares `capabilities.downloadRequiresLogin` and is not
   * logged in, Android opens `ZLibraryLoginDialog` instead of enqueuing the download.
   * `ZLibraryLoginDialog` belongs to the Z-Library module (another agent), so the page
   * calls this seam. Absent ⇒ the download is skipped (never silently queued while the
   * session is unauthenticated, which is what Android prevents).
   */
  openZLibraryLoginDialog?: (source: BookSource) => void;
  /** Android `com.example.source.anilist.TitleNormalizer` hook (owned elsewhere). */
  dispose?: () => void;
}

let runtime: LibraryRuntime | null = null;

/** Install the wired runtime (idempotent). */
export function setLibraryRuntime(next: LibraryRuntime | null): void {
  runtime = next;
}

export function getLibraryRuntime(): LibraryRuntime | null {
  return runtime;
}

/** Android `class LibraryViewModel(application)` → `new LibraryViewModel(deps)`. */
export function createLibraryViewModel(deps: LibraryViewModelDeps): LibraryViewModel {
  return new LibraryViewModel(deps);
}
