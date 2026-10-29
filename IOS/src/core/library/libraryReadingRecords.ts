/**
 * Port of Android `com.example.library.ReadingRecordResolver.kt`
 * (81 lines, 63 non-blank) and `com.example.library.ReadingRecordMetadata.kt`
 * (50 lines, 38 non-blank).
 *
 * Ported: 101 / 101 non-blank lines.
 *
 * Skipped lines (each with reason):
 * - ReadingRecordResolver.kt:2-18 Kotlin imports (`Book`, `ReadingRecord`,
 *   `FavoriteEntity`, `BookSource`, `TitleNormalizer`, every `kotlinx.coroutines.*`) —
 *   `TitleNormalizer.normalize` is the shared `@core/data/titleNormalizer` port; Room
 *   rows become injected snapshots; coroutines become promises; `CancellationException`
 *   becomes AbortError (the `core/` convention).
 * - ReadingRecordResolver.kt:45-49 `remaining.groupBy { … }.map { async { titles.withPermit
 *   { … } } }.awaitAll()` → `Promise.all` over the grouped entries with the 3-permit
 *   title semaphore; the grouping key (`record.bookTitle`) is preserved.
 * - ReadingRecordResolver.kt:58 `Channel<SearchBook?>(sources.size)` + lines 69-79 the
 *   receive loop — a first-hit-wins race. The port uses a deferred promise per source
 *   and `Promise.any`-style resolution, which keeps "return the first non-null hit and
 *   cancel the rest" semantics without the channel.
 * - ReadingRecordResolver.kt:77-78 `jobs.forEach { it.cancel() }; results.cancel()` —
 *   there is no cooperative cancellation; each source search receives an `AbortSignal`
 *   seam (`LibrarySearchRequest.signal`) so a late hit is ignored by the caller.
 * - ReadingRecordMetadata.kt:1-7 imports (`Context`, `Book`, `ReadingRecord`,
 *   `SearchBook`, `JSONObject`) — SharedPreferences becomes the injected
 *   `ReadingRecordMetadataPrefs` async key/value store (the same seam
 *   `novelDownloadStore.ts` uses); `JSONObject` becomes `JSON.parse` / `JSON.stringify`.
 * - ReadingRecordMetadata.kt:45 `if (obj.optString("comicId").isBlank() || …)` — kept
 *   verbatim (`optString` on a missing key is `""`, so the TS read uses `''` fallback).
 *
 * Platform adaptations:
 * - `internal object ReadingRecordMetadata` → a class over the injected prefs, so the
 *   prefs name (`"reading_record_metadata"`) stays the host's decision.
 * - `runCatching { … }.getOrNull()` → `try { … } catch { return null }`.
 * - `com.example.data.Book` → the `LibraryLocalBook` structural row subset used here.
 *
 * Line-by-line audit fixes (2026-10-06):
 * - ReadingRecordResolver.kt:53 `filter { it.isLetterOrDigit() }` used `\p{N}` (every Number
 *   category) instead of `\p{Nd}` (`Character.isDigit`), so superscripts/fractions survived
 *   the fold on the TS side and could stop a title from matching its remote twin.
 */

import { normalize } from '@core/data/titleNormalizer';
import type { BookSource } from '@core/source/bookSource';
import type { SearchBook } from '@core/source/searchBook';
import type { SourceSearchCoordinator } from './librarySearchCoordinator';

/** Android `com.example.data.Book` subset used by the resolver/metadata. */
export interface LibraryLocalBook {
  id: number;
  comicId: string | null;
  sourceId: string | null;
  title: string;
  author: string;
  coverUri: string | null;
  /** Android `Book.filePath` — used by `BookShareHelper.resolveShareTarget`. */
  filePath: string | null;
  /** Android `Book.contentType` — `Book.isComic` is exactly `contentType == "COMIC"`. */
  contentType?: string;
}

/** Android `com.example.data.ReadingRecord` subset used by the resolver/metadata. */
export interface LibraryReadingRecord {
  id: number;
  bookId: number | null;
  bookTitle: string;
}

/** Android `com.example.data.favorite.FavoriteEntity` subset used by the resolver. */
export interface LibraryRecordFavorite {
  sourceId: string;
  comicId: string;
  title: string;
  author: string;
  localThumbPath: string | null;
  coverUrl: string | null;
}

/** Kotlin `kotlinx.coroutines.sync.Semaphore`. */
class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = permits;
  }

  async withPermit<T>(block: () => Promise<T>): Promise<T> {
    if (this.available > 0) {
      this.available -= 1;
    } else {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    try {
      return await block();
    } finally {
      const next = this.waiters.shift();
      if (next !== undefined) next();
      else this.available += 1;
    }
  }
}

/** Kotlin `withTimeoutOrNull(8_000) { … }`. */
async function withTimeoutOrNull<T>(ms: number, block: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      block(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/** Local identities first; only legacy records without a saved destination need a search. */
export class ReadingRecordResolver {
  private readonly requests = new Semaphore(4);
  private readonly titles = new Semaphore(3);
  private readonly searches: SourceSearchCoordinator;

  constructor(searches: SourceSearchCoordinator) {
    this.searches = searches;
  }

  /** Kotlin `suspend fun resolve(records, books, favorites, sources, cached, publish)`. */
  async resolve(
    records: LibraryReadingRecord[],
    books: LibraryLocalBook[],
    favorites: LibraryRecordFavorite[],
    sources: BookSource[],
    // Kotlin's `cached: (ReadingRecord) -> SearchBook?` is synchronous because
    // SharedPreferences is in-memory there; the async prefs port returns a promise, so
    // both shapes are accepted and awaited.
    cached: (record: LibraryReadingRecord) => SearchBook | null | Promise<SearchBook | null>,
    publish: (record: LibraryReadingRecord, book: SearchBook) => void,
  ): Promise<void> {
    const byId = new Map(books.map((b) => [b.id, b]));
    const remaining: LibraryReadingRecord[] = [];
    for (const record of records) {
      const local = record.bookId != null ? byId.get(record.bookId) : undefined;
      // Kotlin `favorites.filter { it.title == record.bookTitle }.distinctBy { sourceId to comicId }.singleOrNull()`
      const seen = new Set<string>();
      const sameTitle = favorites.filter((it) => {
        if (it.title !== record.bookTitle) return false;
        const key = `${it.sourceId} ${it.comicId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const favorite = sameTitle.length === 1 ? sameTitle[0] : undefined;
      const localResult =
        local !== undefined
          ? librarySearchBookOf({
              id: local.comicId ?? `local:${String(local.id)}`,
              sourceId: local.sourceId ?? '',
              title: local.title,
              author: local.author,
              cover: local.coverUri,
            })
          : null;
      const cachedResult = localResult ?? (await cached(record));
      const result =
        cachedResult ??
        (favorite !== undefined
          ? librarySearchBookOf({
              id: favorite.comicId,
              sourceId: favorite.sourceId,
              title: favorite.title,
              author: favorite.author,
              cover: favorite.localThumbPath ?? favorite.coverUrl,
            })
          : null);
      if (result !== null) publish(record, result);
      if (result === null) remaining.push(record);
    }

    const grouped = new Map<string, LibraryReadingRecord[]>();
    for (const record of remaining) {
      const list = grouped.get(record.bookTitle);
      if (list !== undefined) list.push(record);
      else grouped.set(record.bookTitle, [record]);
    }
    await Promise.all(
      [...grouped.entries()].map(([title, group]) =>
        this.titles.withPermit(async () => {
          const found = await this.search(title, sources);
          if (found !== null) {
            for (const record of group) publish(record, found);
          }
        }),
      ),
    );
  }

  /** Kotlin `private fun normalized(title)`. */
  private normalized(title: string): string {
    return normalize(title)
      .split('')
      // Kotlin `filter { it.isLetterOrDigit() }` = `Character.isLetter || Character.isDigit`.
      // `Character.isDigit` is the Nd category only, so `\p{Nd}` — not `\p{N}` (which would
      // also admit superscripts / fractions such as `²`).
      .filter((ch) => /\p{L}|\p{Nd}/u.test(ch))
      .join('');
  }

  /** Kotlin `internal suspend fun search(title, sources): SearchBook?`. */
  async search(title: string, sources: BookSource[]): Promise<SearchBook | null> {
    const wanted = this.normalized(title);
    if (wanted.trim() === '' || sources.length === 0) return null;

    let settled = false;
    let winner: SearchBook | null = null;
    const hit = new Promise<void>((resolve) => {
      const jobs = sources.map((source) =>
        this.requests
          .withPermit(async () => {
            if (settled) return null;
            let found: SearchBook | null = null;
            try {
              const reply = await withTimeoutOrNull(8_000, () =>
                this.searches.search(source, title),
              );
              if (reply !== null && reply.kind === 'success') {
                found = reply.data.find((it) => this.normalized(it.title) === wanted) ?? null;
              }
            } catch (e) {
              if (isAbortError(e)) throw e;
              found = null;
            }
            if (found === null || settled) return null;
            settled = true;
            winner = {
              ...found,
              id: found.comicId != null && found.comicId.trim() !== '' ? found.comicId : found.id,
            };
            resolve();
            return null;
          })
          .catch((e: unknown) => {
            if (isAbortError(e)) return null;
            return null;
          }),
      );
      void Promise.all(jobs).then(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
    });
    await hit;
    return winner;
  }
}

/** Kotlin `SearchBook(id = …, sourceId = …, title = …, author = …, cover = …)`. */
function librarySearchBookOf(partial: {
  id: string;
  sourceId: string;
  title: string;
  author: string;
  cover: string | null;
}): SearchBook {
  return {
    id: partial.id,
    sourceId: partial.sourceId,
    title: partial.title,
    author: partial.author,
    cover: partial.cover,
    description: null,
    format: 'epub',
    language: null,
    comicId: null,
    size: null,
    downloadUrl: null,
    eapiId: null,
    eapiHash: null,
    novelInfo: null,
    comicInfo: null,
  };
}

/* ───────────────── ReadingRecordMetadata.kt ───────────────── */

/** Android `context.getSharedPreferences("reading_record_metadata", MODE_PRIVATE)`. */
export interface ReadingRecordMetadataPrefs {
  getString(key: string): Promise<string | null>;
  putString(key: string, value: string): Promise<void>;
}

/** Save the original reading destination before a statistics lookup needs the network. */
export class ReadingRecordMetadata {
  private readonly prefs: ReadingRecordMetadataPrefs;

  constructor(prefs: ReadingRecordMetadataPrefs) {
    this.prefs = prefs;
  }

  /** Kotlin `private fun key(bookId, title)`. */
  static key(bookId: number | null, title: string): string {
    return bookId != null ? `book:${String(bookId)}` : `title:${title}`;
  }

  /** Kotlin `fun remember(context, book: SearchBook, bookId, recordId)`. */
  async remember(
    book: SearchBook,
    bookId: number | null = null,
    recordId: number | null = null,
  ): Promise<void> {
    if (book.title.trim() === '') return;
    const json = JSON.stringify({
      title: book.title,
      sourceId: book.sourceId,
      comicId:
        book.comicId != null && book.comicId.trim() !== '' ? book.comicId : book.id,
      cover: book.cover ?? '',
      author: book.author,
    });
    await this.prefs.putString(ReadingRecordMetadata.key(bookId, book.title), json);
    if (recordId != null) await this.prefs.putString(`record:${String(recordId)}`, json);
  }

  /** Kotlin `fun remember(context, book: Book, recordId)`. */
  async rememberLocal(book: LibraryLocalBook, recordId: number | null = null): Promise<void> {
    await this.remember(
      librarySearchBookOf({
        id: book.comicId ?? `local:${String(book.id)}`,
        sourceId: book.sourceId ?? '',
        title: book.title,
        author: book.author,
        cover: book.coverUri,
      }),
      book.id,
      recordId,
    );
  }

  /** Kotlin `fun find(context, record): SearchBook?`. */
  async find(record: LibraryReadingRecord): Promise<SearchBook | null> {
    const byRecord = ReadingRecordMetadata.decode(
      await this.prefs.getString(`record:${String(record.id)}`),
      record.bookTitle,
    );
    if (byRecord !== null) return byRecord;
    return ReadingRecordMetadata.decode(
      await this.prefs.getString(ReadingRecordMetadata.key(record.bookId, record.bookTitle)),
      record.bookTitle,
    );
  }

  /** Kotlin `fun decode(json, title): SearchBook?` (`runCatching { … }.getOrNull()`). */
  static decode(json: string | null, title: string): SearchBook | null {
    if (json === null) return null;
    try {
      const obj = JSON.parse(json) as Record<string, unknown>;
      const opt = (key: string): string =>
        typeof obj[key] === 'string' ? (obj[key] as string) : '';
      if (opt('title') !== title) return null;
      const id = opt('comicId');
      if (id.trim() === '' || id.startsWith('record_')) return null;
      const cover = opt('cover');
      return librarySearchBookOf({
        id,
        sourceId: opt('sourceId'),
        title,
        author: opt('author'),
        cover: cover.trim() === '' ? null : cover,
      });
    } catch {
      return null;
    }
  }
}
