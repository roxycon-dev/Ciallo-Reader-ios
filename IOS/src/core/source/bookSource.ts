/**
 * Android source: `com.example.source.BookSource.kt`
 * Kotlin interface with default methods → abstract class with default bodies.
 *
 * `getDownloadInfo(bookId, preferredFormat = null)` overload maps to
 * `getDownloadInfoWithFormat` — TS cannot overload an abstract method with a
 * default-arg sibling of the same name.
 */

import { AuthenticationState } from './authenticationState';
import type { BookFormat } from './bookFormat';
import type { DownloadInfo } from './downloadInfo';
import type { LoginCredential } from './loginCredential';
import type { SearchBook } from './searchBook';
import { sourceRequiresLogin } from './sourceCapabilities';
import type { SourceCapabilities } from './sourceCapabilities';
import { SourceResult } from './sourceResult';
import type { SourceResult as SourceResultType } from './sourceResult';
import { ParseError } from './sourceException';
import { validDetailLink } from './detailLink';
import { discoverCatalog as emptyCatalog, discoverPage as emptyPage, type DiscoverCatalog, type DiscoverPage, type DiscoverQuery } from '@core/discover/models';

export abstract class BookSource {
  async getShareUrl(bookId: string): Promise<string | null> { return validDetailLink(bookId); }
  get supportsDiscoverMetadata(): boolean { return false; }
  async getDiscoverMetadata(_bookId: string, _signal?: AbortSignal): Promise<SourceResultType<SearchBook>> { return SourceResult.Error(new ParseError('书源没有轻量元数据接口')); }
  async discoverCatalog(_resolveDynamic = false, _signal?: AbortSignal): Promise<SourceResultType<DiscoverCatalog>> { return SourceResult.Success(emptyCatalog()); }
  async discover(_query: DiscoverQuery, _signal?: AbortSignal): Promise<SourceResultType<DiscoverPage>> { return SourceResult.Success(emptyPage({ supported: false, notice: '该书源未提供此维度数据' })); }
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly capabilities: SourceCapabilities;

  /** Kotlin `val requiresLogin: Boolean get() = capabilities.requiresLogin`. */
  get requiresLogin(): boolean {
    return sourceRequiresLogin(this.capabilities);
  }

  abstract search(keyword: string): Promise<SourceResultType<SearchBook[]>>;
  abstract getDetail(bookId: string): Promise<SourceResultType<SearchBook>>;
  abstract getDownloadInfo(bookId: string): Promise<SourceResultType<DownloadInfo>>;
  abstract login(credential: LoginCredential): Promise<SourceResultType<boolean>>;
  abstract logout(): Promise<void>;
  abstract isLoggedIn(): Promise<boolean>;

  /** Kotlin default: `suspend fun getRegistrationUrl(): String? = null`. */
  async getRegistrationUrl(): Promise<string | null> {
    return null;
  }

  /**
   * 返回书籍可用的下载格式列表。默认实现返回空列表（不支持多格式选择）。
   * 调用方可凭此展示"选择格式"弹窗；空列表表示直接走 getDownloadInfo 默认格式。
   * Kotlin default: `SourceResult.Success(emptyList())`.
   */
  async getAvailableFormats(_book: SearchBook): Promise<SourceResultType<BookFormat[]>> {
    return SourceResult.Success([]);
  }

  /**
   * 按指定格式获取下载信息。默认实现忽略 preferredFormat，与单参数版本一致。
   * Kotlin: `getDownloadInfo(bookId, preferredFormat = null)`.
   */
  async getDownloadInfoWithFormat(
    bookId: string,
    _preferredFormat?: string | null,
  ): Promise<SourceResultType<DownloadInfo>> {
    return this.getDownloadInfo(bookId);
  }

  /** Kotlin default `getAuthenticationState()`. */
  async getAuthenticationState(): Promise<AuthenticationState> {
    if (this.capabilities.downloadRequiresLogin) {
      return (await this.isLoggedIn())
        ? AuthenticationState.Authenticated
        : AuthenticationState.Required;
    }
    return AuthenticationState.NotRequired;
  }
}
