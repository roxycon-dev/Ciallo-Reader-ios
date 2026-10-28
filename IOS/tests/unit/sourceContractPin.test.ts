/**
 * Contract-layer pins for the `com.example.source.*` root files + `source/storage/`.
 *
 * These are the files whose field names and default values ARE the on-disk data format
 * (book-source JSON, persisted caches, backups), so every literal below is copied from
 * the Kotlin source rather than from the TS port:
 *   BookFormat.kt · BookSource.kt · ComicChapter.kt · ComicInfo.kt · ComicSource.kt
 *   DownloadInfo.kt · LoginCredential.kt · NetworkCalls.kt · NovelInfo.kt · SearchBook.kt
 *   SourceCapabilities.kt · SourceConfig.kt · SourceException.kt · SourceLog.kt
 *   SourceManager.kt · SourceRegistration.kt · SourceResult.kt · AuthenticationState.kt
 *   PufeiImageCacheRetry.kt · storage/SourceStorage.kt · storage/SharedPreferencesSourceStorage.kt
 *
 * `sourceModulesPort.test.ts` covers PufeiImageCacheRetry's happy path and
 * `sourceStorageSharedPreferences.test.ts` covers the storage impl exhaustively (SHA-256
 * against node:crypto, AtomicFile staging, the 2 MiB guard, check(commit())). This file
 * covers what neither does: the default-value tables, SourceManager's ordering and
 * activation rules, the SourceLog redaction text, and the SSRF guard.
 */
import { describe, expect, it } from 'vitest';

import { createBookFormat } from '../../src/core/source/bookFormat';
import { BookSource } from '../../src/core/source/bookSource';
import { createComicChapter } from '../../src/core/source/comicChapter';
import {
  createComicInfo,
  isKnownComicAuthor,
  mergedComicInfo,
  withComicDetail,
} from '../../src/core/source/comicInfo';
import { ComicSource } from '../../src/core/source/comicSource';
import { createDownloadInfo } from '../../src/core/source/downloadInfo';
import type { DownloadInfo } from '../../src/core/source/downloadInfo';
import { createLoginCredential } from '../../src/core/source/loginCredential';
import {
  SharedHttpTransport,
  checkAddress,
  checkSourceUrl,
  isPrivateAddress,
} from '../../src/core/source/networkCalls';
import {
  WholeBookNovelSources,
  createNovelInfo,
  novelInfoHasRevision,
  novelInfoRevision,
} from '../../src/core/source/novelInfo';
import { createSearchBook } from '../../src/core/source/searchBook';
import {
  createSourceCapabilities,
  isComicSource,
  isNovelSource,
  sourceRequiresLogin,
} from '../../src/core/source/sourceCapabilities';
import {
  createBookFieldRule,
  createDetailRule,
  createDownloadRule,
  createHtmlChapterRule,
  createHtmlContentRule,
  createHtmlSearchRule,
  createSearchRule,
  createSourceConfig,
} from '../../src/core/source/sourceConfig';
import {
  BookNotFound,
  LoginRequired,
  NetworkError,
  ParseError,
  SourceException,
  Unknown,
} from '../../src/core/source/sourceException';
import { SOURCE_LOG_TAG, SourceLog, setLogSink } from '../../src/core/source/sourceLog';
import { SourceManager } from '../../src/core/source/sourceManager';
import { validRegistrationUrl } from '../../src/core/source/sourceRegistration';
import { SourceResult } from '../../src/core/source/sourceResult';
import { AuthenticationState } from '../../src/core/source/authenticationState';

// ── minimal BookSource / ComicSource stand-ins ────────────────────────────────────

class StubSource extends BookSource {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ReturnType<typeof createSourceCapabilities>;
  loggedIn: boolean;

  constructor(
    id: string,
    overrides: Partial<ReturnType<typeof createSourceCapabilities>> = {},
    loggedIn = false,
  ) {
    super();
    this.id = id;
    this.name = `源-${id}`;
    this.capabilities = createSourceCapabilities(overrides);
    this.loggedIn = loggedIn;
  }

  async search(): Promise<SourceResult<never[]>> {
    return SourceResult.Success([]);
  }

  async getDetail(): Promise<SourceResult<never>> {
    throw new Error('unused');
  }

  // Declared with the base-class signature (not a narrowed `Promise<never>`) so
  // the test below can override the method with a real implementation.
  async getDownloadInfo(_bookId: string): Promise<SourceResult<DownloadInfo>> {
    throw new Error('unused');
  }

  async login(): Promise<SourceResult<boolean>> {
    return SourceResult.Success(true);
  }

  async logout(): Promise<void> {
    this.loggedIn = false;
  }

  async isLoggedIn(): Promise<boolean> {
    return this.loggedIn;
  }
}

class StubComicSource extends ComicSource {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ReturnType<typeof createSourceCapabilities>;

  constructor(
    id = 'comic',
    overrides: Partial<ReturnType<typeof createSourceCapabilities>> = {},
  ) {
    super();
    this.id = id;
    this.name = `漫画源-${id}`;
    this.capabilities = createSourceCapabilities({ supportComic: true, ...overrides });
  }

  async search(): Promise<SourceResult<never[]>> {
    return SourceResult.Success([]);
  }

  async getDetail(): Promise<SourceResult<never>> {
    throw new Error('unused');
  }

  async getDownloadInfo(_bookId: string): Promise<SourceResult<DownloadInfo>> {
    throw new Error('unused');
  }

  async login(): Promise<SourceResult<boolean>> {
    return SourceResult.Success(true);
  }

  async logout(): Promise<void> {}

  async isLoggedIn(): Promise<boolean> {
    return true;
  }

  async getChapters(): Promise<SourceResult<never[]>> {
    return SourceResult.Success([]);
  }

  async getChapterImages(): Promise<SourceResult<string[]>> {
    return SourceResult.Success([]);
  }
}

/** In-memory `storage/SourceStorage.kt`. */
class MemoryStorage {
  states: Record<string, boolean> = {};
  jsons: Record<string, string> = {};
  activeId: string | null = null;
  savedStates: Array<[string, boolean]> = [];
  removed: string[] = [];

  async saveSourceState(id: string, enabled: boolean): Promise<void> {
    this.states[id] = enabled;
    this.savedStates.push([id, enabled]);
  }

  async getSourceStates(): Promise<Record<string, boolean>> {
    return { ...this.states };
  }

  async saveActiveSourceId(id: string): Promise<void> {
    this.activeId = id;
  }

  async getActiveSourceId(): Promise<string | null> {
    return this.activeId;
  }

  async saveCustomSourceJson(id: string, json: string): Promise<void> {
    this.jsons[id] = json;
  }

  async getCustomSourceJsons(): Promise<Record<string, string>> {
    return { ...this.jsons };
  }

  async removeCustomSourceJson(id: string): Promise<void> {
    delete this.jsons[id];
    this.removed.push(id);
  }
}

// ── BookFormat.kt ─────────────────────────────────────────────────────────────────

describe('BookFormat.kt — data class, not an enum', () => {
  it('has exactly the six Kotlin fields', () => {
    expect(Object.keys(createBookFormat({ format: 'epub' })).sort()).toEqual([
      'downloadUrl',
      'eapiHash',
      'eapiId',
      'format',
      'size',
      'sizeText',
    ]);
  });

  it('defaults every optional field to null (Kotlin `= null`)', () => {
    const f = createBookFormat({ format: 'mobi' });
    expect(f.format).toBe('mobi');
    expect(f.downloadUrl).toBeNull();
    expect(f.size).toBeNull();
    expect(f.sizeText).toBeNull();
    expect(f.eapiId).toBeNull();
    expect(f.eapiHash).toBeNull();
  });

  it('keeps size as a raw number and the eapi pair as strings', () => {
    const f = createBookFormat({
      format: 'azw3',
      downloadUrl: 'https://e.com/d',
      size: 12_582_912,
      sizeText: '12 MB',
      eapiId: '77',
      eapiHash: 'ab12',
    });
    expect(f.size).toBe(12_582_912);
    expect(f.eapiId).toBe('77');
    expect(f.eapiHash).toBe('ab12');
  });
});

// ── DownloadInfo.kt / LoginCredential.kt / ComicChapter.kt ───────────────────────

describe('DownloadInfo.kt', () => {
  it('defaults format to "epub", size/referer to null and headers to {}', () => {
    const d = createDownloadInfo({ url: 'https://e.com/a.epub', fileName: 'a.epub' });
    expect(d.format).toBe('epub');
    expect(d.size).toBeNull();
    expect(d.referer).toBeNull();
    expect(d.headers).toEqual({});
  });
});

describe('LoginCredential.kt', () => {
  it('defaults username/password to "" and cookie to null', () => {
    const c = createLoginCredential();
    expect(c.username).toBe('');
    expect(c.password).toBe('');
    expect(c.cookie).toBeNull();
    expect(c.extraData).toEqual({});
  });
});

describe('ComicChapter.kt', () => {
  it('defaults order to 0 (Kotlin `Float = 0f`), external false, others null', () => {
    const c = createComicChapter({ id: 'c1', title: '第一话' });
    expect(c.order).toBe(0);
    expect(c.external).toBe(false);
    expect(c.volume).toBeNull();
    expect(c.externalUrl).toBeNull();
  });
});

// ── SearchBook.kt / NovelInfo.kt ─────────────────────────────────────────────────

describe('SearchBook.kt', () => {
  it('defaults format to "epub" and every other optional to null', () => {
    const b = createSearchBook({ id: '1', sourceId: 's', title: 'T', author: 'A' });
    expect(b.format).toBe('epub');
    expect(b.cover).toBeNull();
    expect(b.description).toBeNull();
    expect(b.language).toBeNull();
    expect(b.comicId).toBeNull();
    expect(b.size).toBeNull();
    expect(b.downloadUrl).toBeNull();
    expect(b.eapiId).toBeNull();
    expect(b.eapiHash).toBeNull();
    expect(b.novelInfo).toBeNull();
    expect(b.comicInfo).toBeNull();
  });
});

describe('NovelInfo.kt', () => {
  it('revision joins updatedAt|latestChapter|chapterCount|volumeCount', () => {
    // Kotlin L21 `listOf(...).joinToString("|")`.
    expect(novelInfoRevision(createNovelInfo({ updatedAt: '2026-01-01', chapterCount: 10 }))).toBe(
      '2026-01-01||10|',
    );
    expect(novelInfoRevision(createNovelInfo())).toBe('|||');
    expect(
      novelInfoRevision(createNovelInfo({ latestChapter: '第9话', volumeCount: 2 })),
    ).toBe('|第9话||2');
  });

  it('hasRevision is true when any of the four counters moved', () => {
    expect(novelInfoHasRevision(createNovelInfo())).toBe(false);
    expect(novelInfoHasRevision(createNovelInfo({ updatedAt: '2026-01-01' }))).toBe(true);
    expect(novelInfoHasRevision(createNovelInfo({ latestChapter: 'x' }))).toBe(true);
    expect(novelInfoHasRevision(createNovelInfo({ chapterCount: 0 }))).toBe(true);
    expect(novelInfoHasRevision(createNovelInfo({ volumeCount: 0 }))).toBe(true);
    // Blank strings do NOT count (`isNotBlank()`), and chapterCount: 0 does.
    expect(novelInfoHasRevision(createNovelInfo({ updatedAt: '   ' }))).toBe(false);
    expect(novelInfoHasRevision(createNovelInfo({ latestChapter: '' }))).toBe(false);
  });

  it('WholeBookNovelSources lists exactly the three Kotlin ids', () => {
    expect([...WholeBookNovelSources.ids].sort()).toEqual([
      'auto_novel',
      'ixdzs8',
      'wenku8_library',
    ]);
    expect(WholeBookNovelSources.contains('auto_novel')).toBe(true);
    expect(WholeBookNovelSources.contains('zlibrary')).toBe(false);
    expect(WholeBookNovelSources.contains(null)).toBe(false);
  });
});

// ── ComicInfo.kt ─────────────────────────────────────────────────────────────────

describe('ComicInfo.kt', () => {
  it('mergedWith unions titles, keeps the old list for empty fresh ones', () => {
    const merged = mergedComicInfo(
      createComicInfo({ alternateTitles: ['a'], artists: ['x'], tags: ['t'] }),
      createComicInfo({ alternateTitles: ['a', 'b'], status: '连载中' }),
    );
    expect(merged.alternateTitles).toEqual(['a', 'b']);
    expect(merged.artists).toEqual(['x']);
    expect(merged.tags).toEqual(['t']);
    expect(merged.status).toBe('连载中');
  });

  it('isKnownComicAuthor rejects the eight Kotlin placeholders, case-insensitively', () => {
    for (const bad of [
      '',
      '   ',
      'null',
      'NULL',
      '未知',
      '未知作者',
      '佚名',
      'unknown',
      'UNKNOWN AUTHOR',
      'MangaDex',
    ]) {
      expect(isKnownComicAuthor(bad)).toBe(false);
    }
    expect(isKnownComicAuthor('墨香铜臭')).toBe(true);
  });

  it('withComicDetail keeps the search title when the detail title is useless', () => {
    const base = createSearchBook({ id: '1', sourceId: 's', title: 'keep', author: 'keep' });
    for (const detailTitle of ['未知书名', '', '   ', '1']) {
      const out = withComicDetail(
        base,
        createSearchBook({ id: '1', sourceId: 's', title: detailTitle, author: 'unknown' }),
      );
      expect(out.title).toBe('keep');
    }
  });

  it('withComicDetail keeps the base title when it is one of the fresh alternate titles', () => {
    const base = createSearchBook({
      id: '1',
      sourceId: 's',
      title: '别名',
      author: 'A',
      comicInfo: createComicInfo(),
    });
    const out = withComicDetail(
      base,
      createSearchBook({
        id: '1',
        sourceId: 's',
        title: '正名',
        author: 'B',
        comicInfo: createComicInfo({ alternateTitles: ['别名'] }),
      }),
    );
    expect(out.title).toBe('别名');
  });
});

// ── SourceCapabilities.kt ────────────────────────────────────────────────────────

describe('SourceCapabilities.kt', () => {
  it('defaults exactly as the Kotlin data class', () => {
    expect(createSourceCapabilities()).toEqual({
      supportSearch: true,
      supportDownload: true,
      searchRequiresLogin: false,
      downloadRequiresLogin: false,
      supportDebug: false,
      supportImport: false,
      supportComic: false,
      supportOnlineText: false,
      environmentOnly: false,
      supportEbook: false,
    });
  });

  it('requiresLogin mirrors downloadRequiresLogin only (not searchRequiresLogin)', () => {
    expect(sourceRequiresLogin(createSourceCapabilities())).toBe(false);
    expect(sourceRequiresLogin(createSourceCapabilities({ searchRequiresLogin: true }))).toBe(
      false,
    );
    expect(sourceRequiresLogin(createSourceCapabilities({ downloadRequiresLogin: true }))).toBe(
      true,
    );
  });

  it('a source exposes requiresLogin through its own getter', () => {
    expect(new StubSource('a').requiresLogin).toBe(false);
    expect(new StubSource('b', { downloadRequiresLogin: true }).requiresLogin).toBe(true);
  });

  it('novel and comic classification is mutually exclusive and zlibrary is always novel', () => {
    const zlib = new StubSource('zlibrary', { supportComic: true });
    expect(isNovelSource(zlib)).toBe(true);
    expect(isComicSource(zlib)).toBe(false);

    const ebook = new StubSource('e', { supportEbook: true });
    expect(isNovelSource(ebook)).toBe(true);
    expect(isComicSource(ebook)).toBe(false);

    const online = new StubSource('o', { supportOnlineText: true });
    expect(isNovelSource(online)).toBe(true);
    expect(isComicSource(online)).toBe(false);

    const comic = new StubSource('c', { supportComic: true });
    expect(isNovelSource(comic)).toBe(false);
    expect(isComicSource(comic)).toBe(true);

    // supportComic short-circuits the novel test entirely (Kotlin L25-26), so a source that
    // declares BOTH supportEbook and supportComic is classified as a comic source. Only the
    // `id == "zlibrary"` override can force a comic source to be a novel source.
    const both = new StubSource('b', { supportComic: true, supportEbook: true });
    expect(isNovelSource(both)).toBe(false);
    expect(isComicSource(both)).toBe(true);

    // A plain ebook-less, text-less source is neither.
    const plain = new StubSource('p');
    expect(isNovelSource(plain)).toBe(false);
    expect(isComicSource(plain)).toBe(false);
  });
});

// ── SourceConfig.kt ──────────────────────────────────────────────────────────────

describe('SourceConfig.kt — every default is part of the persisted book-source JSON', () => {
  it('BookFieldRule defaults', () => {
    expect(createBookFieldRule()).toEqual({
      id: 'id',
      title: 'title',
      author: 'author',
      cover: 'cover',
      description: 'description',
      format: 'format',
      downloadUrl: 'downloadUrl',
    });
  });

  it('SearchRule / DetailRule default method GET, listPath books, empty headers, null body', () => {
    const search = createSearchRule({ url: 'https://e.com/s?k={keyword}' });
    expect(search).toEqual({
      url: 'https://e.com/s?k={keyword}',
      method: 'GET',
      listPath: 'books',
      fields: createBookFieldRule(),
      headers: {},
      body: null,
    });
    const detail = createDetailRule({ url: 'https://e.com/b/{id}' });
    expect(detail).toEqual({
      url: 'https://e.com/b/{id}',
      method: 'GET',
      fields: createBookFieldRule(),
      headers: {},
      body: null,
    });
  });

  it('DownloadRule defaults urlField to "downloadUrl" and defaultFormat to "epub"', () => {
    expect(createDownloadRule()).toEqual({
      url: null,
      urlField: 'downloadUrl',
      defaultFormat: 'epub',
      headers: {},
    });
  });

  it('HtmlSearchRule defaults every selector to the empty string, charset null, method GET', () => {
    expect(createHtmlSearchRule({ url: 'https://e.com/s', listSelector: '.item' })).toEqual({
      url: 'https://e.com/s',
      listSelector: '.item',
      titleSelector: '',
      authorSelector: '',
      coverSelector: '',
      detailUrlSelector: '',
      introSelector: '',
      charset: null,
      method: 'GET',
      body: null,
    });
  });

  it('HtmlChapterRule defaults nameSelector "text", hrefSelector "href", toc null', () => {
    expect(createHtmlChapterRule({ url: 'https://e.com/toc/{id}', listSelector: '.ch' })).toEqual({
      url: 'https://e.com/toc/{id}',
      listSelector: '.ch',
      nameSelector: 'text',
      hrefSelector: 'href',
      tocUrlSelector: null,
    });
  });

  it('HtmlContentRule has only url + imageSelector', () => {
    expect(createHtmlContentRule({ url: 'https://e.com/c', imageSelector: 'img@src' })).toEqual({
      url: 'https://e.com/c',
      imageSelector: 'img@src',
    });
  });

  it('SourceConfig defaults', () => {
    const cfg = createSourceConfig({
      id: 'x',
      name: 'X',
      search: createSearchRule({ url: 'https://e.com/s' }),
    });
    expect(cfg.baseUrl).toBe('');
    expect(cfg.detail).toBeNull();
    expect(cfg.download).toEqual(createDownloadRule());
    expect(cfg.htmlSearch).toBeNull();
    expect(cfg.htmlChapters).toBeNull();
    expect(cfg.htmlContent).toBeNull();
    expect(cfg.enabled).toBe(true);
    expect(cfg.priority).toBe(0);
    expect(cfg.isCustom).toBe(true);
    expect(cfg.insecureTls).toBe(false);
    expect(cfg.type).toBeNull();
  });

  it('SourceConfig field names are exactly the Kotlin ones (JSON round-trip)', () => {
    const cfg = createSourceConfig({
      id: 'x',
      name: 'X',
      search: createSearchRule({ url: 'https://e.com/s' }),
      priority: 7,
      type: 'comic',
      insecureTls: true,
    });
    expect(Object.keys(JSON.parse(JSON.stringify(cfg))).sort()).toEqual([
      'baseUrl',
      'detail',
      'download',
      'enabled',
      'htmlChapters',
      'htmlContent',
      'htmlSearch',
      'id',
      'insecureTls',
      'isCustom',
      'name',
      'priority',
      'search',
      'type',
    ]);
    expect(cfg.priority).toBe(7);
    expect(cfg.type).toBe('comic');
  });
});

// ── SourceException.kt / SourceResult.kt / AuthenticationState.kt ────────────────

describe('SourceException.kt — the user-visible Chinese messages are verbatim', () => {
  it('LoginRequired and BookNotFound carry the exact Kotlin literals', () => {
    expect(new LoginRequired().message).toBe('需要登录后继续操作');
    expect(new BookNotFound().message).toBe('未能找到对应图书');
  });

  it('the three data classes keep errorMsg; only two of them carry a throwable', () => {
    const cause = new Error('root');
    const net = new NetworkError('网络炸了', cause);
    expect(net.errorMsg).toBe('网络炸了');
    expect(net.message).toBe('网络炸了');
    expect(net.throwable).toBe(cause);

    const parse = new ParseError('解析失败');
    expect(parse.errorMsg).toBe('解析失败');
    // Kotlin `data class ParseError(val errorMsg: String)` — the parameter has no
    // `throwable` companion, unlike NetworkError/Unknown. Assert the property is
    // absent rather than merely undefined, so a future `throwable?: Throwable`
    // with a default would fail here too.
    expect('throwable' in parse).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parse, 'throwable')).toBe(false);

    const unknown = new Unknown('未知错误');
    expect(unknown.errorMsg).toBe('未知错误');
    expect(unknown.throwable).toBeUndefined();
  });

  it('every subclass is a SourceException and names itself', () => {
    for (const e of [new LoginRequired(), new BookNotFound(), new ParseError('x')]) {
      expect(e).toBeInstanceOf(SourceException);
      expect(e).toBeInstanceOf(Error);
    }
    expect(new ParseError('x').name).toBe('ParseError');
    expect(new NetworkError('x').name).toBe('NetworkError');
    expect(new Unknown('x').name).toBe('Unknown');
    expect(new LoginRequired().name).toBe('LoginRequired');
    expect(new BookNotFound().name).toBe('BookNotFound');
  });
});

describe('SourceResult.kt', () => {
  it('Success carries the data, Error carries the exception', () => {
    const ok = SourceResult.Success([1, 2]);
    const err = SourceResult.Error(new ParseError('bad'));
    expect(ok.kind).toBe('success');
    expect(err.kind).toBe('error');
    expect(err.kind === 'error' ? err.exception.message : '').toBe('bad');
  });

  it('map transforms only a success and passes the error through', () => {
    const err = SourceResult.Error(new BookNotFound());
    expect(SourceResult.map(SourceResult.Success(2), (n) => n * 3)).toEqual(
      SourceResult.Success(6),
    );
    expect(SourceResult.map(err, (n: number) => n)).toEqual(err);
  });

  it('getOrNull returns null for an error', () => {
    expect(SourceResult.getOrNull(SourceResult.Success('v'))).toBe('v');
    expect(SourceResult.getOrNull(SourceResult.Error(new Unknown('e')))).toBeNull();
  });
});

describe('AuthenticationState.kt', () => {
  it('the four sealed-interface objects', () => {
    expect(AuthenticationState.NotRequired).toBe('NotRequired');
    expect(AuthenticationState.Required).toBe('Required');
    expect(AuthenticationState.Authenticated).toBe('Authenticated');
    expect(AuthenticationState.Expired).toBe('Expired');
  });

  it('BookSource.getAuthenticationState follows the Kotlin default', async () => {
    // downloadRequiresLogin false → NotRequired, regardless of isLoggedIn().
    expect(await new StubSource('a', {}, true).getAuthenticationState()).toBe(
      AuthenticationState.NotRequired,
    );
    expect(await new StubSource('b', { downloadRequiresLogin: true }).getAuthenticationState()).toBe(
      AuthenticationState.Required,
    );
    expect(
      await new StubSource('c', { downloadRequiresLogin: true }, true).getAuthenticationState(),
    ).toBe(AuthenticationState.Authenticated);
  });
});

// ── BookSource.kt / ComicSource.kt default methods ───────────────────────────────

describe('BookSource.kt / ComicSource.kt default methods', () => {
  it('getRegistrationUrl defaults to null', async () => {
    expect(await new StubSource('a').getRegistrationUrl()).toBeNull();
  });

  it('getAvailableFormats defaults to a successful empty list', async () => {
    const r = await new StubSource('a').getAvailableFormats(
      createSearchBook({ id: '1', sourceId: 's', title: 'T', author: 'A' }),
    );
    expect(r.kind).toBe('success');
    expect(r.kind === 'success' ? r.data : null).toEqual([]);
  });

  it('getDownloadInfoWithFormat falls back to getDownloadInfo and ignores the format', async () => {
    const src = new StubSource('a');
    let seen: string | null = null;
    src.getDownloadInfo = async (id: string): Promise<SourceResult<DownloadInfo>> => {
      seen = id;
      return SourceResult.Success(createDownloadInfo({ url: 'https://e.com/a', fileName: 'a' }));
    };
    const r = await src.getDownloadInfoWithFormat('42', 'mobi');
    expect(seen).toBe('42');
    expect(r.kind === 'success' ? r.data.format : '').toBe('epub');
  });

  it('ComicSource.getChapterText defaults to the Chinese ParseError', async () => {
    const r = await new StubComicSource().getChapterText('c1');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.exception).toBeInstanceOf(ParseError);
      expect(r.exception.message).toBe('该书源不支持文字章节');
    }
  });

  it('the remaining ComicSource defaults are empty/null', async () => {
    const comic = new StubComicSource();
    expect(await comic.getChapterImageHeaders('c1', ['u'])).toEqual({});
    expect(await comic.resolveChapterImage('u')).toBeNull();
    expect(await comic.getResolvedHeaders('u')).toEqual({});
    expect(await comic.getCoverHeaders('u')).toEqual({});
  });
});

// ── SourceRegistration.kt ────────────────────────────────────────────────────────

describe('SourceRegistration.kt', () => {
  it('accepts http(s) only and rejects embedded credentials', () => {
    expect(validRegistrationUrl('  https://e.com/reg  ')).toBe('https://e.com/reg');
    expect(validRegistrationUrl('http://e.com/reg')).toBe('http://e.com/reg');
    expect(validRegistrationUrl('ftp://e.com/reg')).toBeNull();
    expect(validRegistrationUrl('javascript:alert(1)')).toBeNull();
    expect(validRegistrationUrl('https://u:p@e.com/')).toBeNull();
    expect(validRegistrationUrl('   ')).toBeNull();
    expect(validRegistrationUrl(null)).toBeNull();
  });
});

// ── NetworkCalls.kt ──────────────────────────────────────────────────────────────

describe('NetworkCalls.kt — SharedHttpTransport limits', () => {
  it('matches ConnectionPool(8, 5, MINUTES) and Dispatcher(32, 4)', () => {
    expect(SharedHttpTransport.limits).toEqual({
      maxRequests: 32,
      maxRequestsPerHost: 4,
      connectionPoolSize: 8,
      keepAliveMinutes: 5,
    });
    expect(SharedHttpTransport.builder()).toEqual(SharedHttpTransport.limits);
  });
});

describe('NetworkCalls.kt — SourceNetworkPolicy', () => {
  it('classifies the IPv4 special ranges exactly like InetAddress', () => {
    for (const ip of [
      '0.0.0.0',
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.1.1',
      '224.0.0.1',
      '239.1.1.1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '11.0.0.1', 'example.com']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('classifies the IPv6 special ranges', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'ff02::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['2001:4860:4860::8888', '2606:4700::1111', 'example.com']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('treats an IPv4-mapped literal as its IPv4 address (Inet4Address folding)', () => {
    // Kotlin InetAddress.getByName("::ffff:127.0.0.1") is an Inet4Address, so the
    // loopback/site-local verdicts apply. Without this the SSRF guard is bypassable.
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateAddress('0:0:0:0:0:ffff:192.168.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
    // ::ffff:0:a.b.c.d is NOT IPv4-mapped in Java, so it is not folded.
    expect(isPrivateAddress('::ffff:0:127.0.0.1')).toBe(false);
  });

  it('checkAddress throws the verbatim Kotlin message for a private address', () => {
    expect(() => checkAddress('evil.test', '10.0.0.1', null)).toThrow(
      '书源跳转或 DNS 指向未配置的内网地址',
    );
    expect(() => checkAddress('evil.test', '8.8.8.8', null)).not.toThrow();
  });

  it('checkAddress honours the allow-list case-insensitively (host.lowercase())', () => {
    expect(() => checkAddress('NAS.Local', '192.168.1.9', 'nas.local')).not.toThrow();
    expect(() => checkAddress('nas.local', '192.168.1.9', 'nas.example')).toThrow(
      '书源跳转或 DNS 指向未配置的内网地址',
    );
  });

  it('checkSourceUrl rejects a non-HTTP(S) scheme with the Kotlin message', () => {
    expect(() => checkSourceUrl('ftp://e.com/a', null)).toThrow('仅支持 HTTP/HTTPS 书源');
    expect(() => checkSourceUrl('file:///etc/passwd', null)).toThrow('仅支持 HTTP/HTTPS 书源');
    expect(() => checkSourceUrl('not a url', null)).toThrow('仅支持 HTTP/HTTPS 书源');
  });

  it('checkSourceUrl rejects every local-host spelling Kotlin lists', () => {
    for (const url of [
      'http://localhost/a',
      'http://foo.localhost/a',
      'http://printer.local/a',
      'http://0.0.0.0/a',
      'http://127.0.0.1/a',
      'http://10.0.0.1/a',
      'http://192.168.0.1/a',
      'http://169.254.1.1/a',
      'http://172.16.0.1/a',
      'http://172.31.0.1/a',
      'http://[::1]/a',
      'http://[::ffff:127.0.0.1]/a',
    ]) {
      expect(() => checkSourceUrl(url, null), url).toThrow('书源规则尝试访问未配置的内网地址');
    }
  });

  it('checkSourceUrl allows public hosts, 172.15/172.32 and public IPv6', () => {
    for (const url of [
      'https://example.com/a',
      'http://172.15.0.1/a',
      'http://172.32.0.1/a',
      'http://11.0.0.1/a',
      'http://[2001:4860:4860::8888]/a',
    ]) {
      expect(() => checkSourceUrl(url, null), url).not.toThrow();
    }
  });

  it('checkSourceUrl lets the allow-listed host through', () => {
    expect(() => checkSourceUrl('http://nas.local/a', 'nas.local')).not.toThrow();
    expect(() => checkSourceUrl('http://nas.local/a', 'other.local')).toThrow(
      '书源规则尝试访问未配置的内网地址',
    );
  });
});

// ── SourceLog.kt ─────────────────────────────────────────────────────────────────

describe('SourceLog.kt', () => {
  it('formats as "MM-dd HH:mm:ss.SSS [source] message"', () => {
    SourceLog.clear();
    SourceLog.log('ZLib', '搜索 三体');
    // Zero-padded MM/dd, 24-hour HH, and three-digit millis (Kotlin L18 pattern).
    expect(SourceLog.dump()).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \[ZLib\] 搜索 三体$/);
    // The month is 01-12 and the hour 00-23 — never a 12-hour or unpadded value.
    const [, mm, dd, hh] = /^(\d{2})-(\d{2}) (\d{2}):/.exec(SourceLog.dump()) ?? [];
    expect(Number(mm)).toBeGreaterThanOrEqual(1);
    expect(Number(mm)).toBeLessThanOrEqual(12);
    expect(Number(dd)).toBeGreaterThanOrEqual(1);
    expect(Number(dd)).toBeLessThanOrEqual(31);
    expect(Number(hh)).toBeLessThanOrEqual(23);
  });

  it('masks a URL down to scheme://host/…', () => {
    SourceLog.clear();
    SourceLog.log('S', 'GET https://e.com/search?q=1&p=2 done');
    expect(SourceLog.dump()).toContain('[S] GET https://e.com/… done');
    // The query string is gone.
    expect(SourceLog.dump()).not.toContain('q=1');
  });

  it('blanks the whole line when a secret key is present (Kotlin tests the raw message)', () => {
    SourceLog.clear();
    SourceLog.log('S', 'Cookie: remix_userkey=SECRETVALUE; other=1');
    const line = SourceLog.dump();
    expect(line).toContain('[敏感信息已隐藏]');
    expect(line).not.toContain('SECRETVALUE');
    // The inline `cookie=[redacted]` form produced by the first replace is unreachable,
    // because Kotlin L24 always overrides `safe` when the key regex matched `message`.
    expect(line).not.toContain('[redacted]');
  });

  it('blanks for every secret key Kotlin lists, case-insensitively', () => {
    for (const key of [
      'cookie',
      'Cookie',
      'authorization',
      'password',
      'userkey',
      'api_key',
      'api-key',
      'apikey',
      'token',
    ]) {
      SourceLog.clear();
      SourceLog.log('S', `${key}=abc123`);
      expect(SourceLog.dump(), key).toContain('[敏感信息已隐藏]');
      expect(SourceLog.dump(), key).not.toContain('abc123');
    }
  });

  it('leaves a plain message alone', () => {
    SourceLog.clear();
    SourceLog.log('Plain', 'nothing secret here');
    expect(SourceLog.dump()).toContain('[Plain] nothing secret here');
  });

  it('keeps at most MAX (300) entries, dropping the oldest first', () => {
    SourceLog.clear();
    for (let i = 0; i < 305; i += 1) SourceLog.log('S', `line-${i}`);
    const lines = SourceLog.dump().split('\n');
    expect(lines).toHaveLength(300);
    expect(lines[0]).toContain('line-5');
    expect(lines[299]).toContain('line-304');
  });

  it('dump() on an empty buffer returns the verbatim Kotlin hint', () => {
    SourceLog.clear();
    expect(SourceLog.dump()).toBe('（暂无书源请求日志，请先执行一次搜索）');
  });

  it('clear() empties the ring buffer', () => {
    SourceLog.log('S', 'x');
    SourceLog.clear();
    expect(SourceLog.dump()).toBe('（暂无书源请求日志，请先执行一次搜索）');
  });

  it('stays silent until a sink is installed (Kotlin BuildConfig.DEBUG)', () => {
    const seen: Array<[string, string]> = [];
    SourceLog.clear();
    setLogSink((tag, line) => seen.push([tag, line]));
    SourceLog.log('Tag1', 'hello');
    setLogSink(null);
    SourceLog.log('Tag2', 'quiet');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe(SOURCE_LOG_TAG);
    expect(seen[0]?.[0]).toBe('SourceLog');
    expect(seen[0]?.[1]).toContain('[Tag1] hello');
    // The second line is still buffered even though nothing consumed it.
    expect(SourceLog.dump()).toContain('[Tag2] quiet');
    setLogSink(null);
  });
});

// ── SourceManager.kt ─────────────────────────────────────────────────────────────

describe('SourceManager.kt — ordering is insertion order, not priority', () => {
  it('allSources / availableSources keep registration order and never sort by priority', async () => {
    const manager = new SourceManager();
    await manager.registerSource(new StubSource('c', {}, true));
    await manager.registerSource(new StubSource('a', {}, true));
    await manager.registerSource(new StubSource('b', {}, true));
    expect(manager.allSources.value.map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(manager.availableSources.value.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('availableSources is allSources filtered by the enabled state', async () => {
    const manager = new SourceManager();
    await manager.registerSource(new StubSource('a'));
    await manager.registerSource(new StubSource('b'));
    await manager.registerSource(new StubSource('c'));
    await manager.setSourceEnabled('b', false);
    expect(manager.allSources.value.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(manager.availableSources.value.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('re-registering an existing id keeps its original slot and its enabled flag', async () => {
    const manager = new SourceManager();
    await manager.registerSource(new StubSource('a'));
    await manager.registerSource(new StubSource('b'));
    await manager.setSourceEnabled('a', false);
    await manager.registerSource(new StubSource('a'));
    expect(manager.allSources.value.map((s) => s.id)).toEqual(['a', 'b']);
    expect(manager.isSourceEnabled('a')).toBe(false);
  });

  it('registerSource honours defaultEnabled = false', async () => {
    const manager = new SourceManager();
    await manager.registerSource(new StubSource('hidden'), false);
    expect(manager.isSourceEnabled('hidden')).toBe(false);
    expect(manager.availableSources.value).toEqual([]);
    expect(manager.activeSource.value).toBeNull();
  });

  it('defaultEnabled = true for registerCustomSource / addSource / registerCustomSource', async () => {
    const manager = new SourceManager();
    await manager.addSource(new StubSource('a'));
    await manager.registerCustomSource(new StubSource('b'));
    expect(manager.availableSources.value.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('an unknown id defaults to enabled, matching `enabledStatesMap[id] ?: true`', () => {
    const manager = new SourceManager();
    expect(manager.isSourceEnabled('never-registered')).toBe(true);
    expect(manager.getSource('never-registered')).toBeNull();
  });

  it('the first enabled registration becomes the active source', async () => {
    const manager = new SourceManager();
    await manager.registerSource(new StubSource('a'));
    expect(manager.activeSource.value?.id).toBe('a');
  });

  it('registration does NOT persist the active id — Kotlin L85 runs updateFlowsInternal first', async () => {
    // Kotlin registerSource calls `updateFlowsInternal()` (L85) BEFORE the
    // `if (_activeSource.value == null …)` guard at L86. updateFlowsInternal has already
    // assigned `availableList.first()`, so the guard is always false and
    // `setActiveSourceInternal` → `storage.saveActiveSourceId` never runs on this path.
    // The TS port reproduces that ordering exactly; the id is persisted on the next
    // `setActiveSource` / `setSourceEnabled` call instead.
    const storage = new MemoryStorage();
    const manager = new SourceManager(storage);
    await manager.registerSource(new StubSource('a'));
    expect(manager.activeSource.value?.id).toBe('a');
    expect(storage.activeId).toBeNull();
    // …and it is persisted as soon as anything else calls setActiveSourceInternal.
    await manager.setActiveSource('a');
    expect(storage.activeId).toBe('a');
  });

  it('a disabled registration does not become active, but the next enabled one does', async () => {
    const manager = new SourceManager();
    await manager.registerSource(new StubSource('off'), false);
    expect(manager.activeSource.value).toBeNull();
    await manager.registerSource(new StubSource('on'));
    expect(manager.activeSource.value?.id).toBe('on');
  });

  it('disabling the active source moves active to the first available', async () => {
    const storage = new MemoryStorage();
    const manager = new SourceManager(storage);
    await manager.registerSource(new StubSource('a'));
    await manager.registerSource(new StubSource('b'));
    await manager.setSourceEnabled('a', false);
    expect(manager.activeSource.value?.id).toBe('b');
  });

  it('disabling a non-active source leaves active untouched and saves the flag', async () => {
    const storage = new MemoryStorage();
    const manager = new SourceManager(storage);
    await manager.registerSource(new StubSource('a'));
    await manager.registerSource(new StubSource('b'));
    await manager.setActiveSource('b');
    await manager.setSourceEnabled('a', false);
    expect(manager.activeSource.value?.id).toBe('b');
    expect(storage.activeId).toBe('b');
    expect(storage.savedStates).toContainEqual(['a', false]);
  });

  it('disabling the active source when nothing else is enabled clears it', async () => {
    const manager = new SourceManager();
    await manager.registerSource(new StubSource('only'));
    await manager.setSourceEnabled('only', false);
    expect(manager.activeSource.value).toBeNull();
  });

  it('unregisterSource drops state, json and the file, then re-picks the active source', async () => {
    const storage = new MemoryStorage();
    const manager = new SourceManager(storage);
    await manager.registerSource(new StubSource('a'), true, '{"a":1}');
    await manager.registerSource(new StubSource('b'));
    await manager.unregisterSource('a');
    expect(manager.allSources.value.map((s) => s.id)).toEqual(['b']);
    expect(manager.isSourceEnabled('a')).toBe(true); // back to the `?: true` default
    expect(manager.enabledStates.value.has('a')).toBe(false);
    expect(storage.removed).toEqual(['a']);
    expect(manager.activeSource.value?.id).toBe('b');
  });

  it('unregisterCustomSource / removeSource are the same call', async () => {
    const manager = new SourceManager();
    await manager.registerSource(new StubSource('a'));
    await manager.removeSource('a');
    expect(manager.allSources.value).toEqual([]);
    await manager.registerSource(new StubSource('b'));
    await manager.unregisterCustomSource('b');
    expect(manager.allSources.value).toEqual([]);
  });

  it('setActiveSource ignores an unknown or disabled id', async () => {
    const storage = new MemoryStorage();
    const manager = new SourceManager(storage);
    await manager.registerSource(new StubSource('a'));
    await manager.setActiveSource('nope');
    expect(manager.activeSource.value?.id).toBe('a');
    // An unknown id must not clear or overwrite the persisted id.
    expect(storage.activeId).toBeNull();
    await manager.registerSource(new StubSource('b'));
    await manager.setSourceEnabled('b', false);
    await manager.setActiveSource('b');
    expect(manager.activeSource.value?.id).toBe('a');
  });

  it('enabledStates carries every toggle and is snapshotted per change', async () => {
    const manager = new SourceManager();
    await manager.registerSource(new StubSource('a'), false);
    expect([...manager.enabledStates.value]).toEqual([['a', false]]);
    await manager.setSourceEnabled('a', true);
    expect([...manager.enabledStates.value]).toEqual([['a', true]]);
  });

  it('isCustomSource is true for a raw-json registration and for config.isCustom', async () => {
    const manager = new SourceManager();
    await manager.registerSource(new StubSource('plain'));
    expect(manager.isCustomSource('plain')).toBe(false);
    await manager.registerSource(new StubSource('json'), true, '{}');
    expect(manager.isCustomSource('json')).toBe(true);
  });

  it('StateFlow notifies subscribers and hands out an unsubscribe handle', async () => {
    const manager = new SourceManager();
    const seen: number[] = [];
    const stop = manager.allSources.subscribe((list) => seen.push(list.length));
    await manager.registerSource(new StubSource('a'));
    await manager.registerSource(new StubSource('b'));
    stop();
    await manager.registerSource(new StubSource('c'));
    expect(seen).toEqual([1, 2]);
  });

  it('initialize is idempotent and loadPersistedData just calls it', async () => {
    const storage = new MemoryStorage();
    storage.states = { saved: false };
    const manager = new SourceManager(storage);
    await manager.initialize();
    await manager.initialize();
    await manager.loadPersistedData();
    expect(manager.isSourceEnabled('saved')).toBe(false);
  });
});

describe('SourceManager.kt — loadPersistedDataInternal', () => {
  const importer = (ids: string[]) => ({
    importFromJsonString(json: string) {
      const id = ids.find((candidate) => json.includes(candidate));
      if (id === undefined) return SourceResult.Error(new ParseError('bad'));
      return SourceResult.Success(new StubSource(id));
    },
  });

  it('restores saved states, imports custom sources and honours savedActiveId', async () => {
    const storage = new MemoryStorage();
    storage.states = { a: false, b: true };
    storage.jsons = { a: '{"id":"a"}', b: '{"id":"b"}', bad: '{"id":"zzz"}' };
    storage.activeId = 'b';
    const manager = new SourceManager(storage, importer(['a', 'b']));
    await manager.initialize();
    expect(manager.allSources.value.map((s) => s.id)).toEqual(['a', 'b']);
    expect(manager.availableSources.value.map((s) => s.id)).toEqual(['b']);
    expect(manager.activeSource.value?.id).toBe('b');
    // The failed import left nothing behind.
    expect(manager.getSource('bad')).toBeNull();
    // isCustomSource now knows about the imported raw json.
    expect(manager.isCustomSource('a')).toBe(true);
  });

  it('falls back to the first available source when savedActiveId is stale', async () => {
    const storage = new MemoryStorage();
    storage.states = { a: true, b: true };
    storage.jsons = { a: '{"id":"a"}', b: '{"id":"b"}' };
    storage.activeId = 'removed-somewhere-else';
    const manager = new SourceManager(storage, importer(['a', 'b']));
    await manager.initialize();
    expect(manager.activeSource.value?.id).toBe('a');
  });

  it('does not honour a savedActiveId that is disabled', async () => {
    const storage = new MemoryStorage();
    storage.states = { a: false, b: true };
    storage.jsons = { a: '{"id":"a"}', b: '{"id":"b"}' };
    storage.activeId = 'a';
    const manager = new SourceManager(storage, importer(['a', 'b']));
    await manager.initialize();
    expect(manager.activeSource.value?.id).toBe('b');
  });

  it('skips persisted sources entirely without storage', async () => {
    const manager = new SourceManager(null, importer(['a']));
    await manager.initialize();
    expect(manager.allSources.value).toEqual([]);
  });
});

