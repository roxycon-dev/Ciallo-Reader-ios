/**
 * Android `com.example.source.impl.MockBookSource.kt` (93 lines, 83 non-blank)
 * → `src/core/source/impl/mockBookSource.ts`.
 *
 * Kotlin → TS mapping (line ranges refer to the Kotlin file):
 *   1        package                       → header comment
 *   3-10     imports                       → imports
 *   12-15    class KDoc                    → KDoc block (verbatim)
 *   16-24    class + id/name/capabilities  → MockBookSource ctor + fields
 *   26-45    sampleBooks listOf(SearchBook)→ SAMPLE_BOOKS (createSearchBook)
 *   47-57    search()                      → search()
 *   59-66    getDetail()                   → getDetail()
 *   68-80    getDownloadInfo()             → getDownloadInfo()
 *   82-83    login()                       → login()
 *   85-87    logout()                      → logout()
 *   89       isLoggedIn()                  → isLoggedIn()
 *   91-92    getAuthenticationState()      → getAuthenticationState()
 *
 * Skipped lines / adaptations:
 *   - `class MockBookSource(context: Context)` — the Android `Context` parameter
 *     is never read in the Kotlin body (2 of 93 lines: the ctor signature and
 *     the unused import). TS drops it entirely; the class takes no constructor.
 *   - `suspend` / `override` → `async` / `override`.
 *   - `SourceResult.Success/Error` object constructors → the `SourceResult`
 *     const namespace already exported by `../sourceResult`.
 *   - `com.example.source.SourceException.BookNotFound` → `new BookNotFound()`
 *     from `../sourceException`.
 */

import { AuthenticationState } from '../authenticationState';
import { BookSource } from '../bookSource';
import { createDownloadInfo } from '../downloadInfo';
import type { DownloadInfo } from '../downloadInfo';
import { BookNotFound } from '../sourceException';
import { createSearchBook } from '../searchBook';
import type { SearchBook } from '../searchBook';
import { createSourceCapabilities } from '../sourceCapabilities';
import type { SourceCapabilities } from '../sourceCapabilities';
import { SourceResult } from '../sourceResult';
import type { SourceResult as SourceResultType } from '../sourceResult';
import type { LoginCredential } from '../loginCredential';

/**
 * Environment-only mock source used by integration tests and local demos.
 * Never shown in the production UI because [SourceCapabilities.environmentOnly] is true.
 */
export class MockBookSource extends BookSource {
  readonly id: string = 'mock';
  readonly name: string = 'Mock 测试书源';
  readonly capabilities: SourceCapabilities = createSourceCapabilities({
    supportSearch: true,
    supportDownload: true,
    supportDebug: true,
    environmentOnly: true,
  });

  /** Kotlin `private val sampleBooks = listOf(...)` — hoisted so both filters share it. */
  private readonly sampleBooks: SearchBook[] = [
    createSearchBook({
      id: 'mock/pride-and-prejudice',
      sourceId: this.id,
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      cover: null,
      format: 'epub',
      downloadUrl: 'https://example.com/mock/pride-and-prejudice.epub',
    }),
    createSearchBook({
      id: 'mock/three-body',
      sourceId: this.id,
      title: '三体 (The Three-Body Problem)',
      author: '刘慈欣',
      cover: null,
      format: 'epub',
      downloadUrl: 'https://example.com/mock/three-body.epub',
    }),
  ];

  async search(keyword: string): Promise<SourceResultType<SearchBook[]>> {
    const filtered =
      keyword.trim() === ''
        ? this.sampleBooks
        : this.sampleBooks.filter(
            (it) =>
              it.title.toLowerCase().includes(keyword.toLowerCase()) ||
              it.author.toLowerCase().includes(keyword.toLowerCase()),
          );
    return SourceResult.Success(filtered);
  }

  async getDetail(bookId: string): Promise<SourceResultType<SearchBook>> {
    const book = this.sampleBooks.find((it) => it.id === bookId);
    return book != null ? SourceResult.Success(book) : SourceResult.Error(new BookNotFound());
  }

  async getDownloadInfo(bookId: string): Promise<SourceResultType<DownloadInfo>> {
    const detail = SourceResult.getOrNull(await this.getDetail(bookId));
    if (detail == null) {
      return SourceResult.Error(new BookNotFound());
    }
    return SourceResult.Success(
      createDownloadInfo({
        url: detail.downloadUrl ?? `https://example.com/mock/${detail.id}.epub`,
        fileName: detail.title,
        format: detail.format,
        referer: 'https://example.com/',
      }),
    );
  }

  async login(_credential: LoginCredential): Promise<SourceResultType<boolean>> {
    return SourceResult.Success(true);
  }

  async logout(): Promise<void> {
    // No-op for mock source
  }

  async isLoggedIn(): Promise<boolean> {
    return true;
  }

  override async getAuthenticationState(): Promise<AuthenticationState> {
    return AuthenticationState.NotRequired;
  }
}