/**
 * Android source: `com.example.source.ComicInfo.kt`
 * Data class + `mergedWith`, `String.isKnownComicAuthor`, `SearchBook.withComicDetail`.
 */

import type { SearchBook } from './searchBook';

export interface ComicInfo {
  readonly alternateTitles: string[];
  readonly artists: string[];
  readonly tags: string[];
  readonly status: string | null;
  readonly originalLanguage: string | null;
  readonly updatedAt: string | null;
}

export function createComicInfo(overrides: Partial<ComicInfo> = {}): ComicInfo {
  return {
    alternateTitles: [],
    artists: [],
    tags: [],
    status: null,
    originalLanguage: null,
    updatedAt: null,
    ...overrides,
  };
}

/** Kotlin `fun ComicInfo.mergedWith(fresh: ComicInfo)`. */
export function mergedComicInfo(info: ComicInfo, fresh: ComicInfo): ComicInfo {
  return {
    alternateTitles: [...new Set([...info.alternateTitles, ...fresh.alternateTitles])],
    artists: fresh.artists.length > 0 ? fresh.artists : info.artists,
    tags: fresh.tags.length > 0 ? fresh.tags : info.tags,
    status: fresh.status ?? info.status,
    originalLanguage: fresh.originalLanguage ?? info.originalLanguage,
    updatedAt: fresh.updatedAt ?? info.updatedAt,
  };
}

/** Kotlin `fun String.isKnownComicAuthor(): Boolean`. */
const UNKNOWN_COMIC_AUTHORS = new Set([
  '',
  'null',
  '未知',
  '未知作者',
  '佚名',
  'unknown',
  'unknown author',
  'mangadex',
]);

export function isKnownComicAuthor(raw: string): boolean {
  return !UNKNOWN_COMIC_AUTHORS.has(raw.trim().toLowerCase());
}

/**
 * Kotlin `fun SearchBook.withComicDetail(detail: SearchBook): SearchBook`:
 * keep the selected source/id and useful search metadata when a source only
 * returns a partial detail.
 */
export function withComicDetail(book: SearchBook, detail: SearchBook): SearchBook {
  const alternateTitles = detail.comicInfo?.alternateTitles ?? [];
  return {
    ...book,
    title: alternateTitles.includes(book.title)
      ? book.title
      : detail.title.trim() !== '' && detail.title !== detail.id && detail.title !== '未知书名'
        ? detail.title
        : book.title,
    author: isKnownComicAuthor(detail.author) ? detail.author : book.author,
    cover: detail.cover != null && detail.cover.trim() !== '' ? detail.cover : book.cover,
    description:
      detail.description != null && detail.description.trim() !== ''
        ? detail.description
        : book.description,
    language: detail.language != null && detail.language.trim() !== '' ? detail.language : book.language,
    comicId: detail.comicId ?? book.comicId,
    comicInfo:
      detail.comicInfo == null
        ? book.comicInfo
        : book.comicInfo == null
          ? detail.comicInfo
          : mergedComicInfo(book.comicInfo, detail.comicInfo),
  };
}
