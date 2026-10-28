/**
 * Comic/source types required by favorite modules — port of Android
 * `com.example.source.SearchBook.kt`, `ComicChapter.kt`, `ComicInfo.kt`.
 * Defined under library/ because core/source/ is outside the allowed edit set.
 */

/** Android SearchBook.kt */
export interface SearchBook {
  id: string
  sourceId: string
  title: string
  author: string
  cover: string | null
  description: string | null
  format: string
  language: string | null
  comicId: string | null
  size: number | null
  downloadUrl: string | null
  eapiId: string | null
  eapiHash: string | null
  comicInfo: ComicInfo | null
}

export function createSearchBook(overrides: Partial<SearchBook> & Pick<SearchBook, 'id' | 'sourceId' | 'title' | 'author'>): SearchBook {
  return {
    cover: null,
    description: null,
    format: 'epub',
    language: null,
    comicId: null,
    size: null,
    downloadUrl: null,
    eapiId: null,
    eapiHash: null,
    comicInfo: null,
    ...overrides,
  }
}

/** Android ComicChapter.kt */
export interface ComicChapter {
  id: string
  title: string
  volume: string | null
  order: number
  external: boolean
  externalUrl: string | null
}

export function createComicChapter(
  overrides: Partial<ComicChapter> & Pick<ComicChapter, 'id' | 'title'>,
): ComicChapter {
  return {
    volume: null,
    order: 0,
    external: false,
    externalUrl: null,
    ...overrides,
  }
}

/** Android ComicInfo.kt */
export interface ComicInfo {
  alternateTitles: string[]
  artists: string[]
  tags: string[]
  status: string | null
  originalLanguage: string | null
  updatedAt: string | null
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
  }
}

/** Android ComicInfo.kt — isKnownComicAuthor. */
const UNKNOWN_AUTHORS = new Set([
  '',
  'null',
  '未知',
  '未知作者',
  '佚名',
  'unknown',
  'unknown author',
  'mangadex',
])

export function isKnownComicAuthor(raw: string): boolean {
  return !UNKNOWN_AUTHORS.has(raw.trim().toLowerCase())
}

/** Android SourceResult — sealed result of source network calls. */
export type SourceResult<T> =
  | { kind: 'success'; data: T }
  | { kind: 'error'; exception: Error }

export function sourceSuccess<T>(data: T): SourceResult<T> {
  return { kind: 'success', data }
}

export function sourceError(exception: Error): SourceResult<never> {
  return { kind: 'error', exception }
}

/** Android ComicSource — subset used by FavoriteRepository. */
export interface ComicSource {
  getChapters(comicId: string): Promise<SourceResult<ComicChapter[]>>
}

export type ComicSourceResolver = (sourceId: string) => Promise<ComicSource | null>
