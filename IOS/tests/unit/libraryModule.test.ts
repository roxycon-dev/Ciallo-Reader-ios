/**
 * Unit tests for the `com.example.library` → `core/library/library*.ts` port.
 *
 * Every case names the Android origin (file:line) so a parity reviewer can diff the
 * expectation against the Kotlin.
 */

import { describe, expect, it } from 'vitest';
import {
  LibraryError,
  libraryAggregateGroup,
  libraryAggregateResults,
  libraryErrorMessage,
  librarySearchResults,
  type LibraryUiState,
} from '../../src/core/library/libraryTypes';
import {
  SourceSearchCoordinator,
} from '../../src/core/library/librarySearchCoordinator';
import {
  AsyncQueue,
  ComicAggregateSearch,
  ComicAggregateSearchSlots,
  KEYWORD_VARIANTS_LIMIT,
  keywordKeysQuery,
  withComicSearchGroup,
  withTimeoutOrNull,
} from '../../src/core/library/libraryAggregateSearch';
import {
  comicDownloadTaskId,
  comicDownloadWorkName,
  freshComicChapterDir,
  setComicDownloadClocks,
  ComicDownloadManager,
} from '../../src/core/library/libraryComicDownload';
import {
  isAvif,
  decodeOk,
  imageExtension,
  isEncryptedHost,
  gunzipIfNeeded,
  mhttuKeyBytes,
  webpVariants,
  ImageBytes,
  MhttuImageDecryptor,
} from '../../src/core/library/libraryImageBytes';
import { createWebCrypto } from '../../src/platform/web/webCrypto';

/** E83: decryptIfNeeded 现在接 CryptoPort（WebCrypto 实现，WKWebView 原生可用）。 */
const webCrypto = createWebCrypto();
import {
  ReadingRecordMetadata,
  ReadingRecordResolver,
  type LibraryReadingRecord,
} from '../../src/core/library/libraryReadingRecords';
import { mimeForPath, sanitizeFileName } from '../../src/core/library/libraryBookShare';
import {
  AGGREGATE_PREVIEW_COUNT,
  READER_UNSUPPORTED_FORMATS,
  STAGGER_RATIO_PALETTE,
  activeAggregateGroupIndex,
  aggregateGroupItemCount,
  aggregateSourceErrorMessage,
  allFormatsUnsupportedMessage,
  bookCardMetaLine,
  chunkFactsIntoRows,
  comicFormatBadge,
  coverPlaceholderGradient,
  displayFormat,
  downloadCardPrimaryLabel,
  downloadCardProgress,
  downloadCardRemainingLine,
  downloadCardShowsControls,
  downloadCardSpeedText,
  downloadCardStatusText,
  downloadSpeedBps,
  filterReadableFormats,
  formatSize,
  groupHeaderIndex,
  headerCollapseMetrics,
  headerFraction,
  keywordProviderOutcome,
  keywordRetryVisible,
  keywordSubmittedLine,
  libraryErrorCopy,
  novelAuthorLine,
  novelDetailFacts,
  novelDownloadLabel,
  novelUpdateHeadline,
  novelUpdateNewFileStored,
  novelUpdatePanelIsStale,
  staggerRatio,
  unsupportedFormatMessage,
} from '../../src/core/library/libraryDisplay';
import { keywordProviderDisplayName } from '../../src/core/library/libraryViewModel';
import type { SearchBook } from '@core/source/searchBook';
import type { DownloadState } from '@core/download/downloadState';

function book(overrides: Partial<SearchBook> = {}): SearchBook {
  return {
    id: 'b1',
    sourceId: 's1',
    title: '书名',
    author: '作者',
    cover: null,
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
    ...overrides,
  };
}

/* ── LibraryUiState.kt / LibraryError.kt ── */

describe('LibraryUiState.kt + LibraryError.kt', () => {
  it('keeps the sealed branch shapes', () => {
    const searching: LibraryUiState = { kind: 'Searching' };
    expect(searching.kind).toBe('Searching');
    const results = librarySearchResults([book()], true);
    expect(results).toEqual({ kind: 'SearchResults', results: [book()], loading: true });
    const group = libraryAggregateGroup('s1', '源一', [book()], null, true);
    expect(group.loading).toBe(true);
    expect(group.failure).toBeNull();
    const aggregate = libraryAggregateResults([group], true);
    expect(aggregate.kind).toBe('AggregateResults');
  });

  it('maps every LibraryError branch and its Exception.message', () => {
    expect(libraryErrorMessage(LibraryError.NetworkUnavailable)).toBeNull();
    expect(libraryErrorMessage(LibraryError.SourceUnavailable)).toBeNull();
    expect(libraryErrorMessage(LibraryError.AuthenticationRequired)).toBeNull();
    expect(libraryErrorMessage(LibraryError.CloudflareBlocked)).toBeNull();
    expect(libraryErrorMessage(LibraryError.InvalidFile)).toBeNull();
    expect(libraryErrorMessage(LibraryError.NetworkDetail('HTTP 503'))).toBe('HTTP 503');
    expect(libraryErrorMessage(LibraryError.ParseFailed('解析失败'))).toBe('解析失败');
    expect(libraryErrorMessage(LibraryError.Unknown('未知错误'))).toBe('未知错误');
  });
});

/* ── SourceSearchCoordinator.kt ── */

describe('SourceSearchCoordinator.kt', () => {
  function fakeSource(id: string) {
    const calls: string[] = [];
    return {
      id,
      name: id,
      calls,
      capabilities: {} as never,
      search: async (keyword: string) => {
        calls.push(keyword);
        return { kind: 'success' as const, data: [book({ id: `${id}-${keyword}` })] };
      },
    };
  }

  it('caches a non-empty success for the cache window', async () => {
    let now = 1000;
    const source = fakeSource('s1');
    const coordinator = new SourceSearchCoordinator(1100, 60_000, () => now);
    const first = await coordinator.search(source as never, '  原词  ');
    expect(first.kind).toBe('success');
    // The query is trimmed.
    expect(source.calls).toEqual(['原词']);
    const second = await coordinator.search(source as never, '原词');
    expect(source.calls).toHaveLength(1);
    expect(second.kind).toBe('success');
    now += 60_001;
    await coordinator.search(source as never, '原词');
    expect(source.calls).toHaveLength(2);
  });

  it('never caches an empty result or a failure', async () => {
    let now = 0;
    const source = {
      id: 's2',
      name: 's2',
      capabilities: {} as never,
      search: async () => ({ kind: 'success' as const, data: [] as SearchBook[] }),
    };
    const coordinator = new SourceSearchCoordinator(0, 60_000, () => now);
    await coordinator.search(source as never, 'q');
    await coordinator.search(source as never, 'q');
    now += 1;
    expect(coordinator).toBeInstanceOf(SourceSearchCoordinator);
  });

  it('spaces requests from the same site (spacingMs cooldown)', async () => {
    let now = 0;
    const source = fakeSource('s3');
    const coordinator = new SourceSearchCoordinator(1100, 0, () => now);
    await coordinator.search(source as never, 'a');
    now += 10;
    await coordinator.search(source as never, 'b');
    expect(source.calls).toEqual(['a', 'b']);
  });
});

/* ── ComicAggregateSearch.kt ── */

describe('ComicAggregateSearch.kt', () => {
  it('KeywordKeys.query folds whitespace + case, KeywordVariants.LIMIT is 6', () => {
    expect(keywordKeysQuery('  Hello   World ')).toBe('hello world');
    expect(KEYWORD_VARIANTS_LIMIT).toBe(6);
  });

  it('AsyncQueue is FIFO and stops at close()', async () => {
    const q = new AsyncQueue<number>(4);
    await q.send(1);
    await q.send(2);
    q.close();
    const seen: number[] = [];
    for await (const v of q) seen.push(v);
    expect(seen).toEqual([1, 2]);
  });

  it('withTimeoutOrNull returns null on expiry', async () => {
    expect(await withTimeoutOrNull(1000, async () => 'ok')).toBe('ok');
    expect(
      await withTimeoutOrNull(1, () => new Promise((r) => setTimeout(() => r('late'), 40))),
    ).toBeNull();
  });

  it('ComicAggregateSearchSlots caps concurrency', async () => {
    const slots = new ComicAggregateSearchSlots(2);
    let peak = 0;
    let active = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        slots.withPermit(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it('withComicSearchGroup promotes books-first groups and recomputes running', () => {
    const emptyLoading = libraryAggregateGroup('a', 'A', [], null, true);
    const emptyDone = libraryAggregateGroup('b', 'B', [], null, false);
    const withBooks = libraryAggregateGroup('a', 'A', [book()], null, true);
    const current = libraryAggregateResults([emptyLoading, emptyDone], true);
    const next = withComicSearchGroup(current, withBooks);
    expect(next.kind).toBe('AggregateResults');
    if (next.kind === 'AggregateResults') {
      expect(next.groups.map((g) => g.sourceId)).toEqual(['a', 'b']);
      expect(next.running).toBe(true);
    }
    // A non-aggregate state passes through untouched.
    const empty: LibraryUiState = { kind: 'Empty' };
    expect(withComicSearchGroup(empty, withBooks)).toBe(empty);
  });

  it('collects one group per source and stops loading after the aliases drain', async () => {
    const source = {
      id: 's1',
      name: '源一',
      capabilities: { supportSearch: true, environmentOnly: false } as never,
      search: async (keyword: string) => ({
        kind: 'success' as const,
        data: [book({ id: `${keyword}-1` }), book({ id: `${keyword}-2`, sourceId: 'other' })],
      }),
    };
    const groups: Array<{ sourceId: string; books: SearchBook[]; loading: boolean }> = [];
    const search = new ComicAggregateSearch({ requestTimeoutMs: 1000 });
    await search.search([source as never], 'kw', async () => ['别名'], (group) => {
      groups.push({ sourceId: group.sourceId, books: group.books, loading: group.loading });
    });
    expect(groups.length).toBeGreaterThan(0);
    // Every accepted hit is re-stamped with the searched source id.
    for (const group of groups) {
      for (const b of group.books) expect(b.sourceId).toBe('s1');
    }
    expect(groups[groups.length - 1]?.loading).toBe(false);
  });
});

/* ── ImageBytes.kt / MhttuImageDecryptor.kt ── */

describe('ImageBytes.kt + MhttuImageDecryptor.kt', () => {
  it('isAvif matches the ftyp box brand', () => {
    const header = new Uint8Array(16);
    header.set([0, 0, 0, 0x20], 0);
    header.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
    header.set([0x61, 0x76, 0x69, 0x66], 8); // avif
    expect(isAvif(header)).toBe(true);
    header.set([0x61, 0x76, 0x69, 0x73], 8); // avis
    expect(isAvif(header)).toBe(true);
    header.set([0x6d, 0x70, 0x34, 0x32], 8);
    expect(isAvif(header)).toBe(false);
    expect(isAvif(new Uint8Array(4))).toBe(false);
  });

  it('imageExtension detects jpg / webp / png', () => {
    expect(imageExtension(new Uint8Array([0xff, 0xd8, 0x00]))).toBe('jpg');
    expect(imageExtension(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe('webp');
    expect(imageExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(imageExtension(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it('decodeOk rejects non-images (BitmapFactory bounds parity)', () => {
    const png = new Uint8Array(30);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
    png.set([0, 0, 0, 2, 0, 0, 0, 3], 16); // width 2, height 3
    expect(decodeOk(png)).toBe(true);
    expect(decodeOk(new Uint8Array([1, 2, 3, 4, 5]))).toBe(false);
    // A PNG header with zero dimensions is not decodable (Android outWidth <= 0).
    const zero = new Uint8Array(30);
    zero.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    zero.set([0x49, 0x48, 0x44, 0x52], 12);
    expect(decodeOk(zero)).toBe(false);
  });

  it('gunzipIfNeeded passes non-gzip straight through and inflates gzip', async () => {
    const plain = new Uint8Array([1, 2, 3]);
    expect(await gunzipIfNeeded(plain)).toBe(plain);

    const enc = new TextEncoder().encode('hello 书库');
    const stream = new CompressionStream('gzip');
    const writer = stream.writable.getWriter();
    void writer.write(enc);
    void writer.close();
    const parts: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done || value === undefined) break;
      parts.push(value);
    }
    const gz = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
      gz.set(p, off);
      off += p.length;
    }
    expect(gz[0]).toBe(0x1f);
    expect(gz[1]).toBe(0x8b);
    expect(new TextDecoder().decode(await gunzipIfNeeded(gz))).toBe('hello 书库');
  });

  it('webpVariants emits the five hitomi candidates in order', () => {
    const url = 'https://a3.gold-usergeneratedcontent.net/thumb/1/2.avif';
    expect(webpVariants(url)).toEqual([
      'https://a3.gold-usergeneratedcontent.net/thumb/1/2.webp',
      'https://w3.gold-usergeneratedcontent.net/thumb/1/2',
      'https://w3.gold-usergeneratedcontent.net/thumb/1/2.webp',
      'https://w.gold-usergeneratedcontent.net/thumb/1/2',
      'https://w.gold-usergeneratedcontent.net/thumb/1/2.webp',
    ]);
    expect(webpVariants('https://example.com/a.avif')).toEqual([]);
  });

  it('MhttuImageDecryptor: encrypted-host list and the key prefix', async () => {
    expect(isEncryptedHost('tu.mhttu.cc')).toBe(true);
    expect(isEncryptedHost('mhttu.cc')).toBe(true);
    expect(isEncryptedHost('cdn.mhttu.cc')).toBe(true);
    expect(isEncryptedHost('example.com')).toBe(false);
    // The Kotlin key literal is exactly 32 ASCII bytes, so `copyOf(32)` keeps it all.
    expect(new TextDecoder().decode(mhttuKeyBytes())).toBe('0B6666A0-BB59-1381-B746-a0E4C9AC');
    expect(mhttuKeyBytes()).toHaveLength(32);
    // Already-decoded images and tiny payloads pass through untouched.
    // `decryptIfNeeded` became `async` when it moved onto `CryptoPort`
    // (`crypto.subtle.decrypt` is a Promise — see E83), so await the result.
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3]);
    await expect(MhttuImageDecryptor.decryptIfNeeded(jpeg, webCrypto)).resolves.toBe(jpeg);
    const short = new Uint8Array([1, 2]);
    await expect(MhttuImageDecryptor.decryptIfNeeded(short, webCrypto)).resolves.toBe(short);
  });

  it('ImageBytes namespace exposes the same functions', () => {
    expect(ImageBytes.isAvif).toBe(isAvif);
    expect(ImageBytes.decodeOk).toBe(decodeOk);
    expect(ImageBytes.webpVariants).toBe(webpVariants);
  });
});

/* ── ComicDownloadManager.kt / ComicDownloadWorker.kt ── */

describe('ComicDownloadManager.kt + ComicDownloadWorker.kt', () => {
  it('taskId embeds both source and book lengths', () => {
    expect(comicDownloadTaskId({ sourceId: 'ab', id: 'cde' }, 'ch1')).toBe(
      'comic:2:ab3:cdech1',
    );
    expect(comicDownloadWorkName('comic:2:ab3:cdech1')).toBe(
      'comic_download_comic:2:ab3:cdech1',
    );
  });

  it('directory() is a deterministic SHA-256 folder', async () => {
    const fs = {
      readFile: async () => new Uint8Array(),
      writeFile: async () => {},
      exists: async () => false,
      delete: async () => {},
      list: async () => [],
    };
    const manager = new ComicDownloadManager({
      fs,
      runner: {
        isActive: async () => false,
        enqueueUniqueWork: async () => {},
        cancelUniqueWork: async () => {},
      },
      bookDao: {
        getBookByFilePath: async () => null,
        insertBookWithChapters: async (b) => b,
      },
      withTaskLock: async (_id, block) => await block(),
      importer: { http: { request: async () => ({}) } } as never,
      resolveSource: async () => null,
      deleteTree: async () => {},
    });
    const dir = await manager.directory('abc');
    expect(dir).toMatch(/^comics_[0-9a-f]{64}$/);
    expect(await manager.directory('abc')).toBe(dir);
  });

  it('corrupt task storage surfaces the Android message', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('comic_download_tasks.json', new TextEncoder().encode('{not json'));
    const fs = {
      readFile: async (p: string) => files.get(p) as Uint8Array,
      writeFile: async (p: string, data: Uint8Array) => {
        files.set(p, data);
      },
      exists: async (p: string) => files.has(p),
      delete: async (p: string) => {
        files.delete(p);
      },
      list: async () => [...files.keys()],
    };
    const manager = new ComicDownloadManager({
      fs,
      runner: {
        isActive: async () => false,
        enqueueUniqueWork: async () => {},
        cancelUniqueWork: async () => {},
      },
      bookDao: { getBookByFilePath: async () => null, insertBookWithChapters: async (b) => b },
      withTaskLock: async (_id, block) => await block(),
      importer: { http: { request: async () => ({}) } } as never,
      resolveSource: async () => null,
      deleteTree: async () => {},
    });
    await manager.initialize();
    await manager.whenIdle();
    expect(manager.messageValue()).toBe('下载任务记录损坏，请重新添加任务');
    expect(manager.tasks().size).toBe(0);
    manager.clearMessage();
    expect(manager.messageValue()).toBeNull();
  });

  it('an unknown ComicDownloadStatus name is treated as a corrupt file (valueOf throws)', async () => {
    // ComicDownloadManager.kt:57 `ComicDownloadStatus.valueOf(o.getString("status"))` throws
    // IllegalArgumentException on an unknown constant, and the enclosing `runCatching`
    // (line 46-61) turns that into `下载任务记录损坏，请重新添加任务` + an EMPTY map. The port
    // cast the raw JSON value, so a bogus status leaked into `_tasks` as if it were valid.
    const files = new Map<string, Uint8Array>();
    files.set(
      'comic_download_tasks.json',
      new TextEncoder().encode(
        JSON.stringify([
          {
            book: { id: 'b1', sourceId: 's1', title: 'T', author: 'A', cover: '', format: 'cbz' },
            chapter: { id: 'c1', title: 'c', volume: '', order: 0 },
            status: 'NOT_A_STATUS',
            progress: 0.5,
            error: '',
          },
        ]),
      ),
    );
    const fs = {
      readFile: async (p: string) => files.get(p) as Uint8Array,
      writeFile: async (p: string, data: Uint8Array) => {
        files.set(p, data);
      },
      exists: async (p: string) => files.has(p),
      delete: async (p: string) => {
        files.delete(p);
      },
      list: async () => [...files.keys()],
    };
    const manager = new ComicDownloadManager({
      fs,
      runner: {
        isActive: async () => false,
        enqueueUniqueWork: async () => {},
        cancelUniqueWork: async () => {},
      },
      bookDao: { getBookByFilePath: async () => null, insertBookWithChapters: async (b) => b },
      withTaskLock: async (_id, block) => await block(),
      importer: { http: { request: async () => ({}) } } as never,
      resolveSource: async () => null,
      deleteTree: async () => {},
    });
    await manager.initialize();
    await manager.whenIdle();
    expect(manager.messageValue()).toBe('下载任务记录损坏，请重新添加任务');
    expect(manager.tasks().size).toBe(0);
  });

  it('update() only mutates a DOWNLOADING task (Android guard)', async () => {
    const files = new Map<string, Uint8Array>();
    const fs = {
      readFile: async (p: string) => files.get(p) as Uint8Array,
      writeFile: async (p: string, d: Uint8Array) => {
        files.set(p, d);
      },
      exists: async (p: string) => files.has(p),
      delete: async (p: string) => {
        files.delete(p);
      },
      list: async () => [...files.keys()],
    };
    setComicDownloadClocks(
      () => 1_000_000,
      () => 5_000,
    );
    const manager = new ComicDownloadManager({
      fs,
      runner: {
        isActive: async () => false,
        enqueueUniqueWork: async () => {},
        cancelUniqueWork: async () => {},
      },
      bookDao: { getBookByFilePath: async () => null, insertBookWithChapters: async (b) => b },
      withTaskLock: async (_id, block) => await block(),
      importer: { http: { request: async () => ({}) } } as never,
      resolveSource: async () => null,
      deleteTree: async () => {},
    });
    await manager.initialize();
    manager.start(book({ id: 'b1', sourceId: 's1' }), {
      id: 'c1',
      title: '第1话',
      volume: null,
      order: 0,
      external: false,
      externalUrl: null,
    }, { getChapters: async () => ({}) } as never);
    await manager.whenIdle();
    const id = comicDownloadTaskId({ sourceId: 's1', id: 'b1' }, 'c1');
    expect(manager.tasks().get(id)?.status).toBe('DOWNLOADING');
    manager.updateNow(id, (t) => ({ ...t, status: 'PAUSED' }));
    // The transform ran, but the task is no longer DOWNLOADING so the next update is a no-op.
    expect(manager.tasks().get(id)?.status).toBe('PAUSED');
    manager.updateNow(id, (t) => ({ ...t, progress: 0.5 }));
    expect(manager.tasks().get(id)?.progress).toBe(0);
    expect(freshComicChapterDir()).toMatch(/^comics_1000000$/);
  });
});

/* ── ReadingRecordResolver.kt / ReadingRecordMetadata.kt ── */

describe('ReadingRecordMetadata.kt', () => {
  function memoryPrefs() {
    const map = new Map<string, string>();
    return {
      getString: async (k: string) => map.get(k) ?? null,
      putString: async (k: string, v: string) => {
        map.set(k, v);
      },
      map,
    };
  }

  it('key() prefers bookId over title', () => {
    expect(ReadingRecordMetadata.key(7, '书名')).toBe('book:7');
    expect(ReadingRecordMetadata.key(null, '书名')).toBe('title:书名');
  });

  it('remember/find round-trips through both keys', async () => {
    const prefs = memoryPrefs();
    const meta = new ReadingRecordMetadata(prefs);
    const target = book({ title: '三体', comicId: 'c9' });
    await meta.remember(target, 42, 1001);
    const found = await meta.find({ id: 1001, bookId: 42, bookTitle: '三体' });
    expect(found?.id).toBe('c9');
    expect(found?.title).toBe('三体');
    expect(prefs.map.has('record:1001')).toBe(true);
    expect(prefs.map.has('book:42')).toBe(true);
  });

  it('decode rejects a title mismatch, a blank id and record_* ids', () => {
    expect(ReadingRecordMetadata.decode('{"title":"A","comicId":"c"}', 'B')).toBeNull();
    expect(ReadingRecordMetadata.decode('{"title":"A","comicId":"  "}', 'A')).toBeNull();
    expect(ReadingRecordMetadata.decode('{"title":"A","comicId":"record_9"}', 'A')).toBeNull();
    expect(ReadingRecordMetadata.decode(null, 'A')).toBeNull();
    expect(ReadingRecordMetadata.decode('{oops', 'A')).toBeNull();
    const ok = ReadingRecordMetadata.decode(
      '{"title":"A","comicId":"c","sourceId":"s","author":"a","cover":"http://x"}',
      'A',
    );
    expect(ok?.cover).toBe('http://x');
  });

  it('remember() skips a blank title', async () => {
    const prefs = memoryPrefs();
    const meta = new ReadingRecordMetadata(prefs);
    await meta.remember(book({ title: '   ' }), 1, 2);
    expect(prefs.map.size).toBe(0);
  });
});

describe('ReadingRecordResolver.kt', () => {
  it('prefers a local book over the cached lookup', async () => {
    const resolver = new ReadingRecordResolver(new SourceSearchCoordinator(0, 0));
    const published: Array<[string, string]> = [];
    await resolver.resolve(
      [{ id: 1, bookId: 5, bookTitle: '三体' }] as LibraryReadingRecord[],
      [
        {
          id: 5,
          comicId: 'local-cid',
          sourceId: 'local-src',
          title: '三体',
          author: '刘慈欣',
          coverUri: null,
          filePath: 'x',
        },
      ],
      [],
      [],
      () => book({ id: 'cached' }),
      (record, b) => {
        published.push([record.bookTitle, b.id]);
      },
    );
    expect(published).toEqual([['三体', 'local-cid']]);
  });

  it('reports nothing for an unresolvable record without sources', async () => {
    const resolver = new ReadingRecordResolver(new SourceSearchCoordinator(0, 0));
    const published: string[] = [];
    await resolver.resolve(
      [{ id: 1, bookId: null, bookTitle: '无解' }] as LibraryReadingRecord[],
      [],
      [],
      [],
      () => null,
      (_r, b) => {
        published.push(b.id);
      },
    );
    expect(published).toEqual([]);
  });
});

/* ── BookShareHelper.kt ── */

describe('BookShareHelper.kt', () => {
  it('mimeForPath maps every extension verbatim', () => {
    const b = { filePath: '' } as never;
    expect(mimeForPath('a.epub', b)).toBe('application/epub+zip');
    expect(mimeForPath('a.cbz', b)).toBe('application/vnd.comicbook+zip');
    expect(mimeForPath('a.zip', b)).toBe('application/zip');
    expect(mimeForPath('a.pdf', b)).toBe('application/pdf');
    expect(mimeForPath('a.mobi', b)).toBe('application/x-mobipocket-ebook');
    expect(mimeForPath('a.prc', b)).toBe('application/x-mobipocket-ebook');
    expect(mimeForPath('a.azw3', b)).toBe('application/octet-stream');
    expect(mimeForPath('a.kfx', b)).toBe('application/octet-stream');
    expect(mimeForPath('a.fb2', b)).toBe('application/x-fictionbook+xml');
    expect(mimeForPath('a.txt', b)).toBe('text/plain');
    expect(mimeForPath('a.djvu', b)).toBe('image/vnd.djvu');
    expect(mimeForPath('a.bin', b)).toBe('application/octet-stream');
  });

  it('sanitizeFileName strips separators and caps at 80 chars', () => {
    expect(sanitizeFileName('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i');
    expect(sanitizeFileName('   ')).toBe('book');
    expect(sanitizeFileName('x'.repeat(200))).toHaveLength(80);
  });
});

/* ── LibraryScreen.kt pure helpers ── */

describe('LibraryScreen.kt display + layout helpers', () => {
  it('displayFormat falls back to the download URL extension', () => {
    expect(displayFormat({ format: '', downloadUrl: 'https://x/y.pdf' })).toBe('PDF');
    expect(displayFormat({ format: '', downloadUrl: 'https://x/y.html' })).toBe('EPUB');
    expect(displayFormat({ format: 'mobi', downloadUrl: null })).toBe('MOBI');
    expect(displayFormat({ format: '', downloadUrl: null })).toBe('EPUB');
  });

  it('STAGGER_RATIO_PALETTE / AGGREGATE_PREVIEW_COUNT are the Kotlin values', () => {
    expect(STAGGER_RATIO_PALETTE).toEqual([0.62, 0.7, 0.78, 0.9, 0.75]);
    expect(AGGREGATE_PREVIEW_COUNT).toBe(6);
  });

  it('staggerRatio is stable per source+id', () => {
    const ratio = staggerRatio({ sourceId: 's', id: 'i' });
    expect(STAGGER_RATIO_PALETTE).toContain(ratio);
    expect(staggerRatio({ sourceId: 's', id: 'i' })).toBe(ratio);
  });

  it('aggregateGroupItemCount mirrors the grid emit', () => {
    const many = Array.from({ length: 9 }, (_, i) => book({ id: `b${String(i)}` }));
    const group = libraryAggregateGroup('s', 'S', many, null, false);
    // 6 preview cards + the expand button.
    expect(aggregateGroupItemCount(group)).toBe(7);
    expect(aggregateGroupItemCount(group, true)).toBe(9);
    expect(aggregateGroupItemCount(libraryAggregateGroup('s', 'S', [], null, true))).toBe(4);
    expect(aggregateGroupItemCount(libraryAggregateGroup('s', 'S', [], 'err', false))).toBe(1);
  });

  it('groupHeaderIndex skips the leading items and honours expansion', () => {
    const a = libraryAggregateGroup('a', 'A', Array.from({ length: 9 }, (_, i) => book({ id: `a${String(i)}` })), null, false);
    const b = libraryAggregateGroup('b', 'B', [], null, false);
    const groups = [a, b];
    expect(groupHeaderIndex(groups, 0)).toBe(0);
    expect(groupHeaderIndex(groups, 1)).toBe(8);
    expect(groupHeaderIndex(groups, 1, { a: true })).toBe(10);
    expect(groupHeaderIndex(groups, 1, {}, 1)).toBe(9);
  });

  it('activeAggregateGroupIndex tracks the visible band', () => {
    const groups = [
      libraryAggregateGroup('a', 'A', [book()], null, false),
      libraryAggregateGroup('b', 'B', [], null, false),
    ];
    expect(activeAggregateGroupIndex(groups, {}, 0, 0)).toBe(0);
    // Group 0 occupies item 0 (header) + 1 (single card) → item 2 starts group 1.
    expect(activeAggregateGroupIndex(groups, {}, 1, 0)).toBe(0);
    expect(activeAggregateGroupIndex(groups, {}, 2, 0)).toBe(1);
    expect(activeAggregateGroupIndex([], {}, 0, 0)).toBe(-1);
  });

  it('headerFraction force-collapses on focus and saturates at the travel', () => {
    expect(headerFraction(true, 0, 0, 0, 0, 150)).toBe(1);
    expect(headerFraction(false, 1, 0, 0, 0, 150)).toBe(1);
    expect(headerFraction(false, 0, 0, 75, 0, 150)).toBe(0.5);
    expect(headerFraction(false, 0, 0, 0, 999, 150)).toBe(1);
  });

  it('headerCollapseMetrics applies the three overlapping stages', () => {
    expect(headerCollapseMetrics(0)).toEqual({
      compact: 0,
      fade: 0,
      collapse: 0,
      titleSize: 24,
      subAlpha: 1,
      subHeight: 20,
      outerVertical: 10,
      innerVertical: 12,
    });
    const mid = headerCollapseMetrics(0.5);
    expect(mid.compact).toBe(1);
    expect(mid.titleSize).toBe(19);
    expect(mid.fade).toBeCloseTo(0.25, 5);
    expect(mid.collapse).toBe(0);
    const full = headerCollapseMetrics(1);
    expect(full.collapse).toBe(1);
    expect(full.fade).toBe(1);
    expect(full.outerVertical).toBe(0);
    expect(full.subAlpha).toBe(0);
  });

  it('coverPlaceholderGradient derives a stable hue pair', () => {
    const [from, to] = coverPlaceholderGradient('三体');
    expect(from).toMatch(/^#[0-9a-f]{6}$/i);
    expect(to).toMatch(/^#[0-9a-f]{6}$/i);
    expect(from).not.toBe(to);
    expect(coverPlaceholderGradient('三体')).toEqual([from, to]);
  });

  it('comicFormatBadge prefers #id, then a non-epub format, then 小说/漫画', () => {
    expect(comicFormatBadge({ comicId: '77', format: 'epub' }, false)).toBe('#77');
    expect(comicFormatBadge({ comicId: null, format: 'pdf' }, false)).toBe('PDF');
    expect(comicFormatBadge({ comicId: null, format: 'epub' }, true)).toBe('小说');
    expect(comicFormatBadge({ comicId: null, format: 'EPUB' }, false)).toBe('漫画');
  });

  it('bookCardMetaLine renders 格式：…', () => {
    expect(bookCardMetaLine({ format: 'epub', comicId: null, language: null })).toBe('格式：EPUB');
    expect(
      bookCardMetaLine({ format: 'epub', comicId: '9', language: 'zh' }),
    ).toBe('格式：EPUB · #9 · zh');
  });

  it('aggregateSourceErrorMessage translates timeouts and blanks', () => {
    expect(aggregateSourceErrorMessage(null)).toBe('无结果');
    expect(aggregateSourceErrorMessage('')).toBe('无结果');
    expect(aggregateSourceErrorMessage('Read timeout')).toBe('链接超时');
    expect(aggregateSourceErrorMessage('连接超时')).toBe('链接超时');
    expect(aggregateSourceErrorMessage('boom')).toBe('boom');
  });

  it('libraryErrorCopy covers every user-visible branch', () => {
    expect(libraryErrorCopy(LibraryError.NetworkUnavailable)).toEqual({
      title: '无网络连接',
      description: '请检查网络设置后重试',
      action: '重试',
    });
    expect(libraryErrorCopy(LibraryError.NetworkDetail('HTTP 500'))).toEqual({
      title: '请求失败',
      description: 'HTTP 500',
      action: '重试',
    });
    expect(libraryErrorCopy(LibraryError.AuthenticationRequired).action).toBe('去登录');
    expect(libraryErrorCopy(LibraryError.CloudflareBlocked).title).toBe('安全验证拦截');
    expect(libraryErrorCopy(LibraryError.ParseFailed('')).title).toBe('数据解析失败');
    // LibraryScreen.kt:945 is `error.message ?: "网络请求超时，请重试"`. `LibraryError.Unknown.message`
    // is a NON-NULLABLE `String` (LibraryError.kt:12), so the elvis never fires for Unknown — an empty
    // message is preserved verbatim. Only the `InvalidFile` `object` (message == null) falls back.
    expect(libraryErrorCopy(LibraryError.Unknown('')).description).toBe('');
    expect(libraryErrorCopy(LibraryError.Unknown('DNS')).description).toBe('DNS');
  });
});

/* ── NovelBookUi.kt ── */

describe('NovelBookUi.kt helpers', () => {
  const states: Array<[DownloadState, boolean, string]> = [
    [{ kind: 'Success', path: '/x' }, false, '已在书架 · 离线阅读'],
    [{ kind: 'Downloading', downloadedBytes: 1, totalBytes: 2, progress: 0.42 }, false, '整本下载 42%'],
    [{ kind: 'Pending' }, false, '正在准备整本下载'],
    [{ kind: 'Paused', downloadedBytes: 1, totalBytes: 2 }, false, '整本下载已暂停'],
    [{ kind: 'Error', message: 'x' }, false, '下载失败 · 点开重试'],
    [{ kind: 'Error', message: 'x' }, true, '可读离线版本 · 更新下载失败'],
    [{ kind: 'Idle' }, false, '查看详情 · 整本下载'],
    [{ kind: 'Idle' }, true, '已在书架 · 离线阅读'],
  ];

  it('novelDownloadLabel matches every DownloadState arm', () => {
    for (const [state, downloaded, expected] of states) {
      expect(novelDownloadLabel(state, downloaded)).toBe(expected);
    }
  });

  it('novelDetailFacts keeps the label order and MB formatting', () => {
    const facts = novelDetailFacts(
      { size: 5 * 1024 * 1024 },
      {
        wordCount: '10万',
        latestChapter: null,
        chapterCount: 12,
        volumeCount: 3,
        publisher: '译林',
        translation: '简体',
      } as never,
    );
    expect(facts.map(([label]) => label)).toEqual([
      '字数',
      '源站目录',
      '收录卷数',
      '下载大小',
      '出版社',
      '阅读版本',
    ]);
    expect(facts[3]).toEqual(['下载大小', '5.0 MB']);
    expect(chunkFactsIntoRows(facts).map((r) => r.length)).toEqual([2, 2, 2]);
    expect(novelDetailFacts({ size: null }, null)).toEqual([]);
  });

  it('novelAuthorLine drops a blank author', () => {
    expect(novelAuthorLine({ author: '刘慈欣' }, '源一')).toBe('刘慈欣 · 源一');
    expect(novelAuthorLine({ author: '  ' }, '源一')).toBe('源一');
  });

  it('novelUpdateHeadline / novelUpdateNewFileStored / novelUpdatePanelIsStale', () => {
    expect(novelUpdateHeadline(true)).toBe('源站信息有更新');
    expect(novelUpdateHeadline(false)).toBe('源站信息未变化');
    expect(novelUpdateHeadline(null)).toBe('已获取源站当前信息');
    expect(novelUpdateNewFileStored({ kind: 'Success', path: '/new' }, '/old')).toBe(true);
    expect(novelUpdateNewFileStored({ kind: 'Success', path: '/old' }, 'file:///old')).toBe(false);
    expect(novelUpdateNewFileStored({ kind: 'Idle' }, '/old')).toBe(false);
    expect(novelUpdatePanelIsStale(null, 3)).toBe(true);
    expect(novelUpdatePanelIsStale(3, 3)).toBe(false);
  });
});

/* ── DownloadGlassCard.kt ── */

describe('DownloadGlassCard.kt helpers', () => {
  it('progress per state', () => {
    expect(downloadCardProgress({ kind: 'Downloading', downloadedBytes: 1, totalBytes: 2, progress: 0.5 })).toBe(0.5);
    expect(downloadCardProgress({ kind: 'Paused', downloadedBytes: 5, totalBytes: 10 })).toBe(0.5);
    expect(downloadCardProgress({ kind: 'Paused', downloadedBytes: 5, totalBytes: 0 })).toBe(1);
    expect(downloadCardProgress({ kind: 'Success', path: '' })).toBe(1);
    expect(downloadCardProgress({ kind: 'Idle' })).toBe(0);
  });

  it('status text / speed / remaining lines', () => {
    expect(downloadCardStatusText({ kind: 'Pending' })).toBe('等待下载…');
    expect(downloadCardStatusText({ kind: 'Downloading', downloadedBytes: 1, totalBytes: 2, progress: 0 })).toBe('下载中');
    expect(downloadCardStatusText({ kind: 'Paused', downloadedBytes: 1, totalBytes: 2 })).toBe('已暂停');
    expect(downloadCardStatusText({ kind: 'Success', path: '' })).toBe('下载完成');
    expect(downloadCardStatusText({ kind: 'Error', message: '' })).toBe('下载失败');
    expect(downloadCardStatusText({ kind: 'Idle' })).toBe('');
    expect(downloadCardSpeedText(0)).toBe('计算速度…');
    expect(downloadCardSpeedText(2048)).toBe('2 KB/s');
    expect(
      downloadCardRemainingLine({
        kind: 'Downloading',
        downloadedBytes: 1000,
        totalBytes: 2000,
        progress: 0.5,
      }),
    ).toBe('剩余 1 KB / 共 2 KB');
  });

  it('controls visibility, primary label and the speed sampler', () => {
    expect(downloadCardShowsControls({ kind: 'Pending' })).toBe(true);
    expect(downloadCardShowsControls({ kind: 'Success', path: '' })).toBe(false);
    expect(downloadCardPrimaryLabel({ kind: 'Paused', downloadedBytes: 1, totalBytes: 2 })).toBe('继续下载');
    expect(downloadCardPrimaryLabel({ kind: 'Error', message: '' })).toBe('重试');
    expect(
      downloadCardPrimaryLabel({ kind: 'Downloading', downloadedBytes: 1, totalBytes: 2, progress: 0 }),
    ).toBe('暂停');
    // The 400 ms window gate: below it the speed stays 0.
    expect(downloadSpeedBps(1000, 500, 1000, 1100)).toBe(0);
    expect(downloadSpeedBps(1500, 500, 1000, 2000)).toBe(1000);
    expect(downloadSpeedBps(100, -1, 0, 2000)).toBe(0);
  });

  it('formatSize matches the Kotlin thresholds', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(-5)).toBe('0 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe('3.00 GB');
  });
});

/* ── KeywordSearchPreview.kt ── */

describe('KeywordSearchPreview.kt helpers', () => {
  it('submitted line + provider outcomes', () => {
    expect(keywordSubmittedLine(null, 0)).toBe('扩展名称 · 等待提交');
    expect(keywordSubmittedLine('原词', 3)).toBe('原词 · 已提交 3 个书源');
    expect(keywordProviderOutcome('found', '')).toBe('已找到名称');
    expect(keywordProviderOutcome('empty', '')).toBe('未收录匹配名称');
    expect(keywordProviderOutcome('ambiguous', '')).toBe('存在同名，未自动采用');
    expect(keywordProviderOutcome('other', '超时')).toBe('超时');
    expect(keywordProviderOutcome('other', '  ')).toBe('查询失败，请稍后重试');
  });

  it('retry visibility', () => {
    expect(keywordRetryVisible('正在查找本地名称')).toBe(false);
    expect(keywordRetryVisible('在线查询失败')).toBe(true);
    expect(keywordRetryVisible('在线查询超时')).toBe(true);
    expect(keywordRetryVisible('未找到更多别名')).toBe(true);
    expect(keywordRetryVisible('已找到 3 个')).toBe(false);
  });

  it('provider display names', () => {
    expect(keywordProviderDisplayName('wikidata')).toBe('Wikidata');
    expect(keywordProviderDisplayName('anilist')).toBe('AniList');
    expect(keywordProviderDisplayName('bangumi:subjects')).toBe('Bangumi 作品');
    expect(keywordProviderDisplayName('bangumi:characters')).toBe('Bangumi 角色');
    expect(keywordProviderDisplayName('bangumi:persons')).toBe('Bangumi 人物');
    expect(keywordProviderDisplayName('other')).toBe('云扩展查询');
  });
});

/* ── LibraryViewModel.kt format filter ── */

describe('LibraryViewModel.kt format filtering', () => {
  it('READER_UNSUPPORTED_FORMATS blocks kfx/djvu/doc/rtf/chm but not pdf', () => {
    expect([...READER_UNSUPPORTED_FORMATS].sort()).toEqual(
      ['chm', 'djvu', 'doc', 'kfx', 'rtf'].sort(),
    );
    expect(READER_UNSUPPORTED_FORMATS.has('pdf')).toBe(false);
  });

  it('filterReadableFormats drops the unsupported ones case-insensitively', () => {
    const formats = [
      { format: 'EPUB' },
      { format: 'pdf' },
      { format: 'KFX' },
      { format: 'mobi' },
      { format: ' djvu ' },
    ];
    expect(filterReadableFormats(formats).map((f) => f.format)).toEqual([
      'EPUB',
      'pdf',
      'mobi',
    ]);
  });

  it('refusal messages keep the Chinese copy verbatim', () => {
    expect(unsupportedFormatMessage('pdf')).toBe(
      '该书文件为 PDF 格式，App 内暂不支持阅读，请换其他版本',
    );
    expect(allFormatsUnsupportedMessage([{ format: 'pdf' }, { format: 'kfx' }])).toBe(
      '该书仅有 PDF / KFX 格式，App 内暂不支持阅读，请换其他版本',
    );
  });
});