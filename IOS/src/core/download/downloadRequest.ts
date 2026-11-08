/**
 * Download request + novel snapshot types — port of Android `DownloadRequest.kt`
 * and the `SearchBook` / `NovelInfo` / `WholeBookNovelSources` types it depends on.
 *
 * Android sources:
 *   download/DownloadRequest.kt
 *   source/SearchBook.kt
 *   source/NovelInfo.kt
 */

/** Port of Android `source/NovelInfo.kt`. */
export interface NovelInfo {
  synopsis?: string | null;
  originalTitle?: string | null;
  status?: string | null;
  category?: string | null;
  latestChapter?: string | null;
  updatedAt?: string | null;
  chapterCount?: number | null;
  volumeCount?: number | null;
  wordCount?: string | null;
  publisher?: string | null;
  tags?: string[];
  translation?: string | null;
  notice?: string | null;
}

/** NovelInfo.revision — joined revision key for update comparison. */
export function novelInfoRevision(info: NovelInfo): string {
  return [
    info.updatedAt ?? '',
    info.latestChapter ?? '',
    info.chapterCount != null ? String(info.chapterCount) : '',
    info.volumeCount != null ? String(info.volumeCount) : '',
  ].join('|');
}

/** NovelInfo.hasRevision */
export function novelInfoHasRevision(info: NovelInfo): boolean {
  return (
    (info.updatedAt != null && info.updatedAt.trim() !== '') ||
    (info.latestChapter != null && info.latestChapter.trim() !== '') ||
    info.chapterCount != null ||
    info.volumeCount != null
  );
}

/** Port of Android `source/WholeBookNovelSources`. */
export const WHOLE_BOOK_NOVEL_SOURCE_IDS: ReadonlySet<string> = new Set([
  'auto_novel',
  'wenku8_library',
  'ixdzs8',
  'xbookcn',
  'quanben',
  'ihuaben',
  'sfacg',
  'fanqie',
]);

export function isWholeBookNovelSource(id: string | null | undefined): boolean {
  return id != null && WHOLE_BOOK_NOVEL_SOURCE_IDS.has(id);
}

/** Port of Android `source/SearchBook.kt` (fields used by the download layer). */
export interface SearchBook {
  id: string;
  sourceId: string;
  title: string;
  author: string;
  cover?: string | null;
  description?: string | null;
  format?: string;
  language?: string | null;
  comicId?: string | null;
  size?: number | null;
  downloadUrl?: string | null;
  eapiId?: string | null;
  eapiHash?: string | null;
  novelInfo?: NovelInfo | null;
}

/** Port of Android `download/DownloadRequest.kt`. */
export interface DownloadRequest {
  bookId: string;
  title: string;
  author: string;
  sourceId: string;
  downloadUrl: string;
  format: string;
  coverUrl?: string | null;
  novelSnapshot?: SearchBook | null;
  replaceExistingNovel?: boolean;
}
