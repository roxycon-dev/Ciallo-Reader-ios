/**
 * Smoke test for the consolidated source-type surface:
 * - `sourceTypes.ts` (Android `com.example.source.*` → re-export barrel)
 * - `bookSourceTypes.ts` (extended with BookSource.kt + SourceConfig.kt types)
 * Importing the barrel also proves the re-export graph has no ESM cycle/TDZ breakage.
 */
import { describe, expect, it } from 'vitest';

import {
  AuthenticationState,
  ComicSource,
  SourceResult,
  SourceException,
  ParseError,
  createSearchBook,
  createNovelInfo,
  novelInfoRevision,
  novelInfoHasRevision,
  WholeBookNovelSources,
  mergedComicInfo,
  isKnownComicAuthor,
  withComicDetail,
  createSourceCapabilities,
  sourceRequiresLogin,
  isNovelSource,
  isComicSource,
  validRegistrationUrl,
} from '../../src/core/source/sourceTypes';
import {
  BookSource,
  createSourceConfig,
  createSearchRule,
  countEnabledSources,
} from '../../src/core/source/bookSourceTypes';

describe('sourceTypes (consolidated Android source types)', () => {
  it('creates SearchBook with Kotlin data-class defaults', () => {
    const book = createSearchBook({ id: 'b1', sourceId: 's1', title: 'T', author: 'A' });
    expect(book.format).toBe('epub');
    expect(book.cover).toBeNull();
    expect(book.novelInfo).toBeNull();
    expect(book.comicInfo).toBeNull();
  });

  it('mirrors AuthenticationState sealed-interface objects', () => {
    expect(AuthenticationState.NotRequired).toBe('NotRequired');
    expect(AuthenticationState.Required).toBe('Required');
    expect(AuthenticationState.Authenticated).toBe('Authenticated');
    expect(AuthenticationState.Expired).toBe('Expired');
  });

  it('maps SourceResult sealed-class helpers', () => {
    const ok = SourceResult.Success(7);
    const err = SourceResult.Error(new ParseError('bad'));
    expect(SourceResult.map(ok, (n) => n + 1)).toEqual(SourceResult.Success(8));
    expect(SourceResult.map(err, (n) => n)).toEqual(err);
    expect(SourceResult.getOrNull(ok)).toBe(7);
    expect(SourceResult.getOrNull(err)).toBeNull();
    expect(err.exception).toBeInstanceOf(SourceException);
  });

  it('exposes NovelInfo revision getters and whole-book source ids', () => {
    const info = createNovelInfo({ updatedAt: '2026-01-01', chapterCount: 10 });
    expect(novelInfoRevision(info)).toBe('2026-01-01||10|');
    expect(novelInfoHasRevision(info)).toBe(true);
    expect(novelInfoHasRevision(createNovelInfo())).toBe(false);
    expect(WholeBookNovelSources.contains('wenku8_library')).toBe(true);
    expect(WholeBookNovelSources.contains('nope')).toBe(false);
  });

  it('merges ComicInfo and filters unknown authors like Kotlin', () => {
    const merged = mergedComicInfo(
      { alternateTitles: ['a'], artists: ['x'], tags: ['t'], status: null, originalLanguage: null, updatedAt: null },
      { alternateTitles: ['a', 'b'], artists: [], tags: [], status: '完结', originalLanguage: null, updatedAt: null },
    );
    expect(merged.alternateTitles).toEqual(['a', 'b']);
    expect(merged.artists).toEqual(['x']);
    expect(merged.status).toBe('完结');
    expect(isKnownComicAuthor(' 未知 ')).toBe(false);
    expect(isKnownComicAuthor('墨香铜臭')).toBe(true);

    const detail = withComicDetail(
      createSearchBook({ id: '1', sourceId: 's', title: 'keep', author: 'keep' }),
      createSearchBook({ id: '1', sourceId: 's', title: '未知书名', author: 'unknown' }),
    );
    expect(detail.title).toBe('keep');
    expect(detail.author).toBe('keep');
  });

  it('classifies novel vs comic sources from capabilities', () => {
    // Kotlin extension props take the BookSource *interface*; the TS port types
    // them on the abstract class, so a structural stand-in is cast in.
    const novel = { id: 'zlibrary', name: 'z', capabilities: createSourceCapabilities() } as unknown as BookSource;
    const comic = { id: 'c', name: 'c', capabilities: createSourceCapabilities({ supportComic: true }) } as unknown as BookSource;
    expect(sourceRequiresLogin(novel.capabilities)).toBe(false);
    expect(isNovelSource(novel)).toBe(true);
    expect(isComicSource(comic)).toBe(true);
  });

  it('validates registration urls (OkHttp http/https only, no embedded credentials)', () => {
    expect(validRegistrationUrl(' https://example.com/register ')).toBe('https://example.com/register');
    expect(validRegistrationUrl('javascript:alert(1)')).toBeNull();
    expect(validRegistrationUrl('https://user:pass@example.com/')).toBeNull();
    expect(validRegistrationUrl(null)).toBeNull();
  });

  it('exports BookSource / ComicSource classes and SourceConfig factories', () => {
    expect(typeof BookSource).toBe('function');
    expect(typeof ComicSource).toBe('function');
    expect(ComicSource.prototype instanceof BookSource).toBe(true);

    const cfg = createSourceConfig({
      id: 'x',
      name: 'X',
      search: createSearchRule({ url: 'https://example.com/search?q={keyword}' }),
    });
    expect(cfg.search.method).toBe('GET');
    expect(cfg.download.defaultFormat).toBe('epub');
    expect(cfg.enabled).toBe(true);
    expect(cfg.type).toBeNull();
    expect(countEnabledSources([{ id: 'x', name: 'X', enabled: true }])).toBe(1);
  });
});
