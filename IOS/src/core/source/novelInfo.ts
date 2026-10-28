/**
 * Android source: `com.example.source.NovelInfo.kt`
 * `@Immutable` annotation dropped — Compose runtime concept, no TS equivalent.
 * Kotlin `Int?` → `number | null`.
 */

import type { BookSource } from './bookSource';
import type { SearchBook } from './searchBook';
import type { SourceResult } from './sourceResult';

export interface NovelInfo {
  readonly synopsis: string | null;
  readonly originalTitle: string | null;
  readonly status: string | null;
  readonly category: string | null;
  readonly latestChapter: string | null;
  readonly updatedAt: string | null;
  readonly chapterCount: number | null;
  readonly volumeCount: number | null;
  readonly wordCount: string | null;
  readonly publisher: string | null;
  readonly tags: string[];
  readonly translation: string | null;
  readonly notice: string | null;
}

export function createNovelInfo(overrides: Partial<NovelInfo> = {}): NovelInfo {
  return {
    synopsis: null,
    originalTitle: null,
    status: null,
    category: null,
    latestChapter: null,
    updatedAt: null,
    chapterCount: null,
    volumeCount: null,
    wordCount: null,
    publisher: null,
    tags: [],
    translation: null,
    notice: null,
    ...overrides,
  };
}

/** Kotlin `val NovelInfo.revision: String get() = ...`. */
export function novelInfoRevision(info: NovelInfo): string {
  return [
    info.updatedAt ?? '',
    info.latestChapter ?? '',
    info.chapterCount != null ? String(info.chapterCount) : '',
    info.volumeCount != null ? String(info.volumeCount) : '',
  ].join('|');
}

/** Kotlin `val NovelInfo.hasRevision: Boolean get() = ...`. */
export function novelInfoHasRevision(info: NovelInfo): boolean {
  return (
    (info.updatedAt != null && info.updatedAt.trim() !== '') ||
    (info.latestChapter != null && info.latestChapter.trim() !== '') ||
    info.chapterCount != null ||
    info.volumeCount != null
  );
}

/** Kotlin `object WholeBookNovelSources` — only these public whole-book sources opt into novel UI. */
export const WholeBookNovelSources = {
  ids: new Set(['auto_novel', 'wenku8_library', 'ixdzs8']),
  contains(id: string | null | undefined): boolean {
    return id != null && WholeBookNovelSources.ids.has(id);
  },
};

/** Kotlin `interface UpdatableNovelSource : BookSource`. */
export interface UpdatableNovelSource extends BookSource {
  refreshNovelDetail(bookId: string): Promise<SourceResult<SearchBook>>;
}
