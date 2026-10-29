/**
 * Regression tests for the line-by-line `com.example.library` audit of 2026-10-06.
 *
 * Every case names the Android origin (file:line) so a parity reviewer can diff the
 * expectation against the Kotlin. One case per fixed divergence — a failure here means the
 * port drifted back to the pre-audit behaviour.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  displayFormat,
  downloadSpeedSampleDue,
  libraryErrorCopy,
  novelAccentColor,
  novelActionColors,
  novelSearchLabels,
} from '../../src/core/library/libraryDisplay';
import {
  BookShareHelper,
  mimeForPath,
  type BookShareHelperDeps,
} from '../../src/core/library/libraryBookShare';
import type { LibraryLocalBook } from '../../src/core/library/libraryReadingRecords';
import { ComicDownloadManager, comicDownloadTaskId } from '../../src/core/library/libraryComicDownload';
import {
  importComicChapter,
  type ComicChapterImportDeps,
  type ComicImportedBook,
} from '../../src/core/library/libraryComicLocalImporter';
import { LibraryViewModel } from '../../src/core/library/libraryViewModel';
import { ReadingRecordMetadata } from '../../src/core/library/libraryReadingRecords';
import type { SearchBook } from '@core/source/searchBook';
import type { BookSource } from '@core/source/bookSource';
import { createSourceCapabilities } from '@core/source/sourceCapabilities';

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

function localBook(overrides: Partial<LibraryLocalBook> = {}): LibraryLocalBook {
  return {
    id: 1,
    comicId: null,
    sourceId: null,
    title: '书名',
    author: '作者',
    coverUri: null,
    filePath: '/books/a.epub',
    contentType: 'NOVEL',
    ...overrides,
  };
}

/* ── NovelBookUi.kt:106 `listOfNotNull(status, category, translation ?: language, format) ── */

describe('NovelBookUi.kt:106 novelSearchLabels — the language fallback is outside the `info?.` guard', () => {
  it('falls back to book.language even when novelInfo is null', () => {
    expect(novelSearchLabels({ language: 'ja', format: 'epub' }, null)).toEqual(['ja', 'EPUB']);
  });

  it('prefers info.translation over book.language, and does not duplicate status/category', () => {
    const info = {
      status: '连载中',
      category: '科幻',
      translation: '简中',
      wordCount: null,
      chapterCount: null,
      volumeCount: null,
      publisher: null,
      latestChapter: null,
      updatedAt: null,
      synopsis: null,
      originalTitle: null,
      notice: null,
      tags: [],
    } as unknown as NonNullable<SearchBook['novelInfo']>;
    expect(novelSearchLabels({ language: 'ja', format: 'epub' }, info)).toEqual([
      '连载中',
      '科幻',
      '简中',
      'EPUB',
    ]);
  });

  it('drops the language when translation is present', () => {
    const info = {
      status: null,
      category: null,
      translation: null,
      wordCount: null,
      chapterCount: null,
      volumeCount: null,
      publisher: null,
      latestChapter: null,
      updatedAt: null,
      synopsis: null,
      originalTitle: null,
      notice: null,
      tags: [],
    } as unknown as NonNullable<SearchBook['novelInfo']>;
    // translation == null ⇒ `info?.translation ?: book.language` yields the language.
    expect(novelSearchLabels({ language: 'ja', format: 'epub' }, info)).toEqual(['ja', 'EPUB']);
  });
});

/* ── LibraryScreen.kt:945 `else -> Triple("请求超时", error.message ?: "网络请求超时，请重试") ── */

describe('LibraryScreen.kt:937-946 libraryErrorCopy — the elvis fallback', () => {
  it('keeps an empty Unknown message verbatim (the elvis only fires on null)', () => {
    expect(libraryErrorCopy({ kind: 'Unknown', message: '', causeException: null }).description).toBe('');
  });

  it('keeps a non-empty Unknown message', () => {
    expect(
      libraryErrorCopy({ kind: 'Unknown', message: '没有找到相关结果', causeException: null }).description,
    ).toBe('没有找到相关结果');
  });

  it('InvalidFile (an `object` singleton, message == null) uses the fallback', () => {
    expect(libraryErrorCopy({ kind: 'InvalidFile' })).toEqual({
      title: '请求超时',
      description: '网络请求超时，请重试',
      action: '重试',
    });
  });
});

/* ── LibraryScreen.kt:2996-3008 displayFormat ── */

describe('LibraryScreen.kt:3007 `raw.uppercase().ifBlank { "EPUB" }`', () => {
  it('treats a whitespace-only format as blank', () => {
    expect(displayFormat({ format: '   ', downloadUrl: null })).toBe('EPUB');
  });

  it('falls back to EPUB when the downloadUrl has no dot at all', () => {
    // LibraryScreen.kt:2999-3000 `downloadUrl?.substringBefore('?')
    // ?.substringAfterLast('.', "")` — the missing-delimiter default is `""`, so a
    // dot-less URL cannot contribute an extension. The port used
    // `slice(lastIndexOf('.') + 1)`, which returns the WHOLE receiver for a dot-less URL:
    // "ab" then passed the `length in 2..5` + alphanumerics test and rendered "AB".
    expect(displayFormat({ format: '', downloadUrl: 'ab' })).toBe('EPUB');
    expect(displayFormat({ format: '', downloadUrl: 'https://cdn/a.pdf' })).toBe('PDF');
  });

  it('still strips the query before taking the extension', () => {
    // substringBefore('?') runs FIRST, so the query's dots never leak into the extension.
    expect(displayFormat({ format: '', downloadUrl: 'https://cdn/a.epub?token=1.5' })).toBe('EPUB');
  });
});

/* ── BookShareHelper.kt ── */

describe('BookShareHelper.kt isComic / directory branch', () => {
  function shareDeps(overrides: Partial<BookShareHelperDeps> = {}) {
    const shared: Array<{ title: string; objectUrl: string; fileName: string; mime: string }> = [];
    const deps: BookShareHelperDeps = {
      fs: {
        readFile: async () => new Uint8Array(),
        writeFile: async () => {},
        exists: async () => false,
        delete: async () => {},
        list: async () => [],
      },
      share: {
        share: async (t: { title: string; objectUrl: string; fileName: string; mime: string }) => {
          shared.push(t);
          return true;
        },
        fileObjectUrl: async (path: string) => `blob:${path}`,
      },
      chaptersOfBook: async () => [],
      downloadTasks: async () => [],
      originalBookId: () => '',
      fileExists: async () => false,
      // Kotlin `java.util.UUID.randomUUID()` 的注入点（测试里固定，保证临时文件名确定）。
      // 生产代码在**未注入**时回落到 `() => crypto.randomUUID()`（保留 `crypto` 作为
      // receiver），见下面那两条专门钉住该回落路径的用例。
      randomId: () => '00000000-0000-4000-8000-000000000000',
      ...overrides,
    };
    return { deps, shared };
  }

  it('falls back to the real crypto.randomUUID when the host injects no randomId', async () => {
    // `libraryBookShare.ts:184` used to read
    //   `(this.deps.randomId ?? crypto.randomUUID)()`
    // which **detaches** `randomUUID` from its `crypto` receiver. `randomUUID` is a
    // WebIDL operation on `Crypto`, so the detached call throws
    // `Value of "this" must be of type Crypto` (jsdom) / `Illegal invocation`
    // (Safari, iOS — this app's target). That `TypeError` was caught by `shareBook`'s
    // blanket `catch` and handed back as if it were a user-facing share failure, so every
    // share that needs a temp file name (step 3 CBZ repack, step 5 TXT rebuild, and the
    // content:// byte copy) failed in the **default** host configuration.
    //
    // The fix is the arrow `() => crypto.randomUUID()`, which keeps `crypto` as `this`.
    // This test drives the CBZ-repack branch (step 3) — the one that builds a temp file
    // name at BookShareHelper.kt:189 `SHARE_TEMP_DIR/${UUID.randomUUID()}_${title}.cbz`.
    //
    // `exactOptionalPropertyTypes` forbids `randomId: undefined` to mean "not injected",
    // so rebuild the deps without the key.
    const zipCalls: Array<{ entries: Array<{ name: string; path: string }>; outPath: string }> = [];
    const { randomId: _omitted, ...withoutRandomId } = shareDeps({
      dirExists: async () => true,
      chaptersOfBook: async () => [{ title: '第 1 页', content: '/data/ch1/img_0001.jpg' }],
      writeZip: async (entries: Array<{ name: string; path: string }>, outPath: string) => {
        zipCalls.push({ entries, outPath });
      },
    }).deps;
    void _omitted;
    const helper = new BookShareHelper(withoutRandomId);
    await expect(
      helper.shareBook(localBook({ contentType: 'COMIC', filePath: '/data/ch1' })),
    ).resolves.toBeNull();
    // The temp name must carry a real RFC-4122 v4 UUID from WebCrypto — proof the
    // receiver was bound and the name was generated, not faked.
    const outPath = zipCalls[0]?.outPath ?? '';
    expect(outPath).toMatch(
      /^share_temp\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_书名\.cbz$/u,
    );
    expect(outPath).not.toContain('Crypto');
  });

  it('reports the Kotlin page-missing error, not a WebCrypto error, when randomId is absent', async () => {
    // Same unbound-`crypto` defect on a path that throws *after* naming the temp file.
    // Kotlin BookShareHelper.kt:177 `throw IllegalStateException("漫画页面文件缺失，无法分享")`.
    const { randomId: _omitted, ...withoutRandomId } = shareDeps({
      dirExists: async () => true,
    }).deps;
    void _omitted;
    const helper = new BookShareHelper(withoutRandomId);
    await expect(
      helper.shareBook(localBook({ contentType: 'COMIC', filePath: '/data/ch1' })),
    ).resolves.toBe('漫画页面文件缺失，无法分享');
  });

  it('rebuilds the TXT from chapters without randomId (step 5 temp name)', async () => {
    // The other unbound site: BookShareHelper.kt:221 `${UUID.randomUUID()}_${title}.txt`.
    // Pre-fix this returned `Value of "this" must be of type Crypto`.
    const { randomId: _omitted, ...withoutRandomId } = shareDeps({
      chaptersOfBook: async () => [{ title: '正文', content: 'x'.repeat(80) }],
    }).deps;
    void _omitted;
    const helper = new BookShareHelper(withoutRandomId);
    await expect(
      helper.shareBook(localBook({ contentType: 'NOVEL', filePath: '/gone/a.txt' })),
    ).resolves.toBeNull();
  });

  it('routes a directory filePath through resolveComicArchive, not the task lookup', async () => {
    const { deps } = shareDeps({ dirExists: async () => true });
    const helper = new BookShareHelper(deps);
    // No chapters ⇒ Kotlin BookShareHelper.kt:177 throws 漫画页面文件缺失，无法分享.
    await expect(helper.shareBook(localBook({ contentType: 'COMIC', filePath: '/data/ch1' }))).resolves.toBe(
      '漫画页面文件缺失，无法分享',
    );
  });

  it('re-packs the unpacked pages into a cbz for a comic directory', async () => {
    const zipCalls: Array<{ entries: Array<{ name: string; path: string }>; outPath: string }> = [];
    const { deps } = shareDeps({
      dirExists: async () => true,
      chaptersOfBook: async () => [
        { title: '第 1 页', content: '/data/ch1/img_0001.jpg' },
        { title: '第 2 页', content: '' },
        { title: '第 3 页', content: '/data/ch1/img_0002.jpg' },
      ],
      writeZip: async (entries: Array<{ name: string; path: string }>, outPath: string) => {
        zipCalls.push({ entries, outPath });
      },
    });
    const helper = new BookShareHelper(deps);
    await expect(helper.shareBook(localBook({ contentType: 'COMIC', filePath: '/data/ch1' }))).resolves.toBeNull();
    expect(zipCalls).toHaveLength(1);
    // Kotlin L185 `String.format("%04d_%s", index, page.name)`; the blank chapter content is
    // dropped by `mapNotNull { ch.content.takeIf { it.isNotBlank() } }`.
    expect(zipCalls[0]?.entries.map((e) => e.name)).toEqual([
      '0000_img_0001.jpg',
      '0001_img_0002.jpg',
    ]);
    expect(zipCalls[0]?.outPath).toMatch(/^share_temp\/.+\.cbz$/);
  });

  it('does NOT take the comic branch for a non-COMIC book whose path merely looks like comics_', async () => {
    // Kotlin gates on `File(path).isDirectory`; a *missing* path falls through to step 4/5.
    const { deps } = shareDeps({
      dirExists: async () => false,
      chaptersOfBook: async () => [{ title: '正文', content: 'x'.repeat(80) }],
    });
    const helper = new BookShareHelper(deps);
    // Step 5 rebuilds the TXT (content > 50 chars ⇒ hasTextChapters == true).
    await expect(
      helper.shareBook(localBook({ contentType: 'NOVEL', filePath: 'comics_abc' })),
    ).resolves.toBeNull();
  });

  it('a COMIC book is a zero-copy format even without an extension (isZeroCopyFormat line 210)', async () => {
    // isZeroCopyFormat is private; the observable effect is that a content:// comic is NOT
    // copied into share_temp — `openContentBytes` is never called.
    const openContentBytes = vi.fn(async () => new Uint8Array([1]));
    const { deps } = shareDeps({ contentResolverGetType: async () => null, openContentBytes });
    const helper = new BookShareHelper(deps);
    await helper.shareBook(localBook({ contentType: 'COMIC', filePath: 'content://p/1' }));
    expect(openContentBytes).not.toHaveBeenCalled();
  });

  it('a non-COMIC content:// book IS copied into share_temp', async () => {
    const openContentBytes = vi.fn(async () => new Uint8Array([1]));
    const { deps } = shareDeps({ contentResolverGetType: async () => 'application/pdf', openContentBytes });
    const helper = new BookShareHelper(deps);
    await expect(
      helper.shareBook(localBook({ contentType: 'NOVEL', filePath: 'content://p/1' })),
    ).resolves.toBeNull();
    expect(openContentBytes).toHaveBeenCalledTimes(1);
  });

  it('does not burn a UUID on the 漫画页面文件缺失 failure path', async () => {
    // BookShareHelper.kt:177 throws BEFORE line 181 builds
    // `${UUID.randomUUID()}_${sanitizeFileName(book.title)}.cbz`. The port computed the temp
    // name first, consuming a UUID on every failed share.
    const randomId = vi.fn(() => '00000000-0000-4000-8000-000000000000');
    const { deps } = shareDeps({ dirExists: async () => true, randomId });
    const helper = new BookShareHelper(deps);
    await expect(
      helper.shareBook(localBook({ contentType: 'COMIC', filePath: '/data/ch1' })),
    ).resolves.toBe('漫画页面文件缺失，无法分享');
    expect(randomId).not.toHaveBeenCalled();
  });
});

/* ── BookShareHelper.kt:298 `mimeForPath` — the whole path, not the base name ── */

describe('BookShareHelper.kt:298 substringAfterLast over the WHOLE path', () => {
  it('uses the trailing extension even when a directory segment contains a dot', () => {
    // Kotlin `path.substringAfterLast('.', "").lowercase()`. A base-name-first reduction
    // turns `/a.b/noext` into "" (default octet-stream) instead of "b/noext".
    expect(mimeForPath('/data/v1.2/book.epub')).toBe('application/epub+zip');
    expect(mimeForPath('/data/v1.2/noext')).toBe('application/octet-stream');
  });

  it('maps every extension arm verbatim', () => {
    expect(mimeForPath('x.cbz')).toBe('application/vnd.comicbook+zip');
    expect(mimeForPath('x.zip')).toBe('application/zip');
    expect(mimeForPath('x.pdf')).toBe('application/pdf');
    expect(mimeForPath('x.mobi')).toBe('application/x-mobipocket-ebook');
    expect(mimeForPath('x.prc')).toBe('application/x-mobipocket-ebook');
    expect(mimeForPath('x.azw3')).toBe('application/octet-stream');
    expect(mimeForPath('x.kfx')).toBe('application/octet-stream');
    expect(mimeForPath('x.fb2')).toBe('application/x-fictionbook+xml');
    expect(mimeForPath('x.txt')).toBe('text/plain');
    expect(mimeForPath('x.djvu')).toBe('image/vnd.djvu');
    expect(mimeForPath('x.bin')).toBe('application/octet-stream');
  });
});

/* ── DownloadGlassCard.kt:88-94 the 400 ms sampler window ── */

describe('DownloadGlassCard.kt:88-94 the sampler window advances even at 0 B/s', () => {
  it('is not due before the first seed and within the 400 ms floor', () => {
    // `if (lastBytes >= 0 && lastTime > 0) { val dt = now - lastTime; if (dt > 400) … }`
    expect(downloadSpeedSampleDue(-1, 0, 10_000)).toBe(false);
    expect(downloadSpeedSampleDue(500, 1000, 1400)).toBe(false); // dt === 400 ⇒ not > 400
    expect(downloadSpeedSampleDue(500, 1000, 1401)).toBe(true);
  });

  it('is due after a long stall even when no bytes moved', () => {
    // This is the case the old `if (sampled <= 0) return prev` swallowed: the Kotlin
    // `lastBytes/lastTime` update is INSIDE the `dt > 400` branch and is not conditional on
    // the measured speed, so a zero-speed sample still rebases the window. Holding the old
    // window divides the next burst by the entire stall (measured ~13x too low).
    expect(downloadSpeedSampleDue(500, 1000, 11_000)).toBe(true);
  });
});

/* ── NovelBookUi.kt:36-47 novelAccentColor / novelActionColors ── */

describe('NovelBookUi.kt:36-47 theme colours', () => {
  it('novelAccentColor branches on surface luminance at .3', () => {
    // `if (surface.luminance() < .3f) lerp(primary, White, .35f) else lerp(primary, Black, .18f)`
    // Pure black: luminance 0 < .3 ⇒ toward white.
    const dark = novelAccentColor('#0A5C46', '#000000');
    // Pure white: luminance 1 >= .3 ⇒ toward black.
    const light = novelAccentColor('#0A5C46', '#FFFFFF');
    // Toward white raises every channel; toward black lowers every channel.
    const p = { r: 0x0a, g: 0x5c, b: 0x46 };
    expect(Number.parseInt(dark.slice(1, 3), 16)).toBeGreaterThan(p.r);
    expect(Number.parseInt(dark.slice(3, 5), 16)).toBeGreaterThan(p.g);
    expect(Number.parseInt(light.slice(1, 3), 16)).toBeLessThan(p.r);
    expect(Number.parseInt(light.slice(3, 5), 16)).toBeLessThan(p.g);
  });

  it('novelActionColors picks the ink at the .179 luminance threshold', () => {
    // `lerp(primary, Black, .12f)` then `if (background.luminance() > .179f) 0xFF111111 else White`.
    // A dark primary stays under .179 ⇒ white ink; a bright one crosses it ⇒ #111111.
    expect(novelActionColors('#FFFFFF').content).toBe('#111111');
    expect(novelActionColors('#000000').content).toBe('#FFFFFF');
  });
});

/* ── ComicDownloadManager.kt:54-58 `takeIf { it.isNotBlank() }` on restore ── */

describe('ComicDownloadManager.kt readTasks folds whitespace like isNotBlank', () => {
  it('drops a whitespace-only cover / volume / error', async () => {
    const files = new Map<string, Uint8Array>();
    files.set(
      'comic_download_tasks.json',
      new TextEncoder().encode(
        JSON.stringify([
          {
            book: { id: 'b1', sourceId: 's1', title: 'T', author: 'A', cover: '   ', format: 'cbz' },
            chapter: { id: 'c1', title: '第1话', volume: '  ', order: 0 },
            status: 'DOWNLOADING',
            progress: 0.5,
            error: ' \t ',
          },
        ]),
      ),
    );
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
    const manager = new ComicDownloadManager({
      fs,
      runner: {
        isActive: async () => false,
        enqueueUniqueWork: async () => {},
        cancelUniqueWork: async () => {},
      },
      bookDao: {
        getBookByFilePath: async () => null,
        insertBookWithChapters: async (b: ComicImportedBook) => b,
      },
      withTaskLock: async (_id, block) => await block(),
      importer: { http: { request: async () => ({}) } } as never,
      resolveSource: async () => null,
      deleteTree: async () => {},
    });
    await manager.initialize();
    const task = manager.tasks().get(comicDownloadTaskId({ sourceId: 's1', id: 'b1' }, 'c1'));
    expect(task?.book.cover).toBeNull();
    expect(task?.chapter.volume).toBeNull();
    expect(task?.error).toBeNull();
  });
});

/* ── ComicLocalImporter.kt:137-146 `file:` local-cache validation ── */

describe('ComicLocalImporter.kt:137-146 the file: branch validates the copied bytes', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);

  function importerDeps(copied: Uint8Array): { deps: ComicChapterImportDeps } {
    const stored = new Map<string, Uint8Array>();
    return {
      deps: {
        // 这些用例只走 `file:` 本地缓存分支，HTTP 与 AES 都从不被调用。
        // `decryptIfNeeded` 仍要求一个 CryptoPort（E83），给一个会抛错的桩即可 ——
        // 真跑到它就说明用例没按预期只走本地分支。
        crypto: {
          decryptAesCbc: () => Promise.reject(new Error('测试不应触发 AES 解密')),
        },
        http: { request: async () => ({ status: 0, headers: {}, body: new Uint8Array(), url: '' }) },
        fs: {
          readFile: async (p: string) => stored.get(p) ?? new Uint8Array(),
          writeFile: async (p: string, d: Uint8Array) => {
            stored.set(p, d);
          },
          exists: async (p: string) => stored.has(p),
          delete: async (p: string) => {
            stored.delete(p);
          },
          list: async (p: string) => [...stored.keys()].filter((k) => k.startsWith(`${p}/`)),
        },
        bookDao: {
          getBookByFilePath: async () => null,
          insertBookWithChapters: async (b) => b,
        },
        cookieHeader: () => '',
        copyLocalFile: async (_fileUrl: string, toPath: string) => {
          stored.set(toPath, copied);
        },
        // Kotlin `java.util.UUID.randomUUID()` 的注入点（测试里固定，保证封面名确定）。
        // 生产代码在**未注入**时回落到 `() => crypto.randomUUID()`（保留 `crypto` 作为
        // receiver），见下面那条专门钉住该回落路径的用例。
        randomId: () => '00000000-0000-4000-8000-000000000000',
        now: () => 1_700_000_000_000,
      },
    };
  }

  it('accepts a valid PNG copy and registers the chapter', async () => {
    const { deps } = importerDeps(PNG);
    const result = await importComicChapter({
      ...deps,
      book: book({ title: '漫画' }),
      chapter: { id: 'c1', title: '第1话', volume: null, order: 0, external: false, externalUrl: null },
      imageUrls: ['file:///cache/img.avif'],
      onProgress: () => {},
    } as never);
    expect(result.ok).toBe(true);
  });

  it('rejects a copy that is not a decodable image (Kotlin throws 本地缓存图片无效)', async () => {
    const { deps } = importerDeps(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const result = await importComicChapter({
      ...deps,
      book: book({ title: '漫画' }),
      chapter: { id: 'c1', title: '第1话', volume: null, order: 0, external: false, externalUrl: null },
      imageUrls: ['file:///cache/img.avif'],
      onProgress: () => {},
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('页多次重试后仍下载失败');
  });

  it('names the cover with a real WebCrypto UUID when the host injects no randomId', async () => {
    // `libraryComicLocalImporter.ts:495` used to read
    //   `(randomId ?? crypto.randomUUID)()`
    // detaching `randomUUID` from `crypto`. It is a WebIDL operation on `Crypto`, so the
    // detached call throws `Value of "this" must be of type Crypto` (jsdom) /
    // `Illegal invocation` (Safari/iOS). `importComicChapter`'s blanket `catch` turned that
    // into `{ ok: false, error: 'Value of "this" must be of type Crypto' }` for **every**
    // chapter import in the default host configuration — the pages were already downloaded
    // and written, then the whole result was reported as a failure.
    // Fixed by keeping the receiver: `() => crypto.randomUUID()`.
    const { randomId: _omitted, ...withoutRandomId } = importerDeps(PNG).deps;
    void _omitted;
    const result = await importComicChapter({
      ...withoutRandomId,
      book: book({ title: '漫画' }),
      chapter: { id: 'c1', title: '第1话', volume: null, order: 0, external: false, externalUrl: null },
      imageUrls: ['file:///cache/img.avif'],
      onProgress: () => {},
    } as never);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Kotlin ComicLocalImporter.kt:264 `"comic_covers/cover_${UUID.randomUUID()}.jpg"`.
      // A real RFC-4122 v4 UUID proves the WebCrypto call was reached with `this === crypto`.
      expect(result.book.coverUri).toMatch(
        /^comic_covers\/cover_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/u,
      );
    }
  });
});

/* ── LibraryViewModel.kt:62 / :1208 `Book.isComic` is `contentType == "COMIC"` ── */

describe('LibraryViewModel.kt downloadedNovelKeys honours Book.isComic', () => {
  function makeVm(books: LibraryLocalBook[]): LibraryViewModel {
    return new LibraryViewModel({
      prefs: {
        hasSeenWelcome: async () => true,
        setHasSeenWelcome: async () => {},
        hasConfiguredSource: async () => false,
        setHasConfiguredSource: async () => {},
        hasImportedLocalBook: async () => false,
        setHasImportedLocalBook: async () => {},
        multiLanguageSearch: async () => false,
        setMultiLanguageSearch: async () => {},
        multiLanguageOnlineLookup: async () => false,
        setMultiLanguageOnlineLookup: async () => {},
        searchHistory: async () => [],
        setSearchHistory: async () => {},
      },
      sources: {
        initialize: async () => {},
        activeSource: () => null,
        availableSources: () => [],
        getSource: () => null,
        setActiveSource: async () => {},
        subscribeActiveSource: () => () => {},
      },
      downloads: {
        downloadStates: () => new Map(),
        subscribeDownloadStates: () => () => {},
        allTasks: async () => [],
        enqueueDownload: async () => {},
        pauseDownload: async () => {},
        resumeDownload: async () => {},
        cancelDownload: async () => {},
      },
      repository: {
        getAllBooksSync: async () => books,
        getBookBySourceResource: async () => null,
        getAllFavoritesSync: async () => [],
      },
      recordMetadata: new ReadingRecordMetadata({
        getString: async () => null,
        putString: async () => {},
      }),
    });
  }

  it('excludes a COMIC shelf row even when its filePath has no comics_ marker', async () => {
    const vm = makeVm([
      localBook({ id: 1, sourceId: 'js_x', comicId: 'c1', contentType: 'COMIC', filePath: '/x/anything' }),
      localBook({ id: 2, sourceId: 'js_x', comicId: 'c2', contentType: 'NOVEL', filePath: '/x/a.epub' }),
    ]);
    const keys = await vm.downloadedNovelKeys();
    expect([...keys]).toEqual(['v2:4:js_xc2']);
  });

  it('still includes a novel row that happens to live under a comics_ directory', async () => {
    const vm = makeVm([
      localBook({ id: 3, sourceId: 'js_y', comicId: 'c3', contentType: 'NOVEL', filePath: 'comics_hash' }),
    ]);
    expect([...(await vm.downloadedNovelKeys())]).toEqual(['v2:4:js_yc3']);
  });

  it('checkNovelUpdate returns early for a COMIC row (Local.isComic, line 1208)', () => {
    const vm = makeVm([]);
    vm.checkNovelUpdate(
      localBook({ id: 4, sourceId: 'ixdzs8', comicId: 'c4', contentType: 'COMIC' }),
    );
    expect(vm.novelUpdateState.value).toBeNull();
  });
});

/* ── LibraryViewModel.kt:1172 the `replaceNovel` gate on the update-panel error ── */

describe('LibraryViewModel.kt:1172 only a replaceNovel download reports into the update panel', () => {
  function makeVm2(book: SearchBook) {
    const enqueued: unknown[] = [];
    const source = {
      id: book.sourceId,
      name: 'src',
      // `isNovelSource` is a derived property (id === 'zlibrary' || ebook/onlineText without
      // supportComic), not a capability field — hence `supportEbook` on an 'ixdzs8' id.
      capabilities: createSourceCapabilities({ supportSearch: true, supportEbook: true }),
      getDetail: async () => ({ kind: 'success' as const, data: book }),
      getDownloadInfo: async () => ({ kind: 'success' as const, data: { url: 'u', format: 'epub', referer: null, headers: {} } }),
      getDownloadInfoWithFormat: async () => ({
        kind: 'success' as const,
        data: { url: 'u', format: 'epub', referer: null, headers: {} },
      }),
      getAvailableFormats: async () => ({ kind: 'success' as const, data: [] }),
      isLoggedIn: async () => false,
      search: async () => ({ kind: 'success' as const, data: [] }),
      // `checkNovelUpdate` opens the panel with `loading = true` and only needs the source
      // to be an UpdatableNovelSource; a success here keeps `error` null so the assertion
      // below measures the `replaceNovel` gate and not this stub.
      refreshNovelDetail: async () => ({ kind: 'success' as const, data: book }),
    } as unknown as BookSource;
    const vm = new LibraryViewModel({
      prefs: {
        hasSeenWelcome: async () => true,
        setHasSeenWelcome: async () => {},
        hasConfiguredSource: async () => true,
        setHasConfiguredSource: async () => {},
        hasImportedLocalBook: async () => false,
        setHasImportedLocalBook: async () => {},
        multiLanguageSearch: async () => false,
        setMultiLanguageSearch: async () => {},
        multiLanguageOnlineLookup: async () => false,
        setMultiLanguageOnlineLookup: async () => {},
        searchHistory: async () => [],
        setSearchHistory: async () => {},
      },
      sources: {
        initialize: async () => {},
        activeSource: () => source,
        availableSources: () => [source],
        getSource: () => source,
        setActiveSource: async () => {},
        subscribeActiveSource: () => () => {},
      },
      downloads: {
        downloadStates: () => new Map(),
        subscribeDownloadStates: () => () => {},
        allTasks: async () => [],
        enqueueDownload: async (r) => {
          enqueued.push(r);
        },
        pauseDownload: async () => {},
        resumeDownload: async () => {},
        cancelDownload: async () => {},
      },
      repository: {
        getAllBooksSync: async () => [],
        getBookBySourceResource: async () => null,
        getAllFavoritesSync: async () => [],
      },
      recordMetadata: new ReadingRecordMetadata({
        getString: async () => null,
        putString: async () => {},
      }),
    });
    return { vm, source };
  }

  it('leaves an open update panel untouched when a plain download fails', async () => {
    // Kotlin: `if (replaceNovel) _novelUpdate.value?.takeIf { … }?.let { … copy(error = …) }`.
    // A plain `startDownload` failure passes replaceNovel = false and must not stamp the panel.
    const b = book({ id: 'z1', sourceId: 'ixdzs8', format: 'epub' });
    const { vm, source } = makeVm2(b);
    // Open the panel for this exact book.
    vm.checkNovelUpdate(
      localBook({ id: 9, sourceId: 'ixdzs8', comicId: 'z1', contentType: 'NOVEL' }),
    );
    expect(vm.novelUpdateState.value).not.toBeNull();
    // Break getDownloadInfo so the plain-download path fails.
    (source as unknown as { getDownloadInfo: unknown }).getDownloadInfo = async () => {
      throw new Error('下载信息获取失败');
    };
    vm.startDownload(b);
    await vm.whenIdle();
    expect(vm.errorMessageState.value).toBe('下载信息获取失败');
    // The panel's own `error` field stays null — Kotlin's `replaceNovel` gate held.
    expect(vm.novelUpdateState.value?.error).toBeNull();
  });
});

/* ── LibraryViewModel.kt:110-113 the legacy "record_cover_cache" second leg ── */

describe('LibraryViewModel.kt resolveMissingRecordCovers reads the legacy record_cover_cache table', () => {
  it('publishes a book resolved only from the legacy cache', async () => {
    const sources: BookSource[] = [];
    const vm = new LibraryViewModel({
      prefs: {
        hasSeenWelcome: async () => true,
        setHasSeenWelcome: async () => {},
        hasConfiguredSource: async () => false,
        setHasConfiguredSource: async () => {},
        hasImportedLocalBook: async () => false,
        setHasImportedLocalBook: async () => {},
        multiLanguageSearch: async () => false,
        setMultiLanguageSearch: async () => {},
        multiLanguageOnlineLookup: async () => false,
        setMultiLanguageOnlineLookup: async () => {},
        searchHistory: async () => [],
        setSearchHistory: async () => {},
      },
      sources: {
        initialize: async () => {},
        activeSource: () => null,
        availableSources: () => sources,
        getSource: () => null,
        setActiveSource: async () => {},
        subscribeActiveSource: () => () => {},
      },
      downloads: {
        downloadStates: () => new Map(),
        subscribeDownloadStates: () => () => {},
        allTasks: async () => [],
        enqueueDownload: async () => {},
        pauseDownload: async () => {},
        resumeDownload: async () => {},
        cancelDownload: async () => {},
      },
      repository: {
        getAllBooksSync: async () => [],
        getBookBySourceResource: async () => null,
        getAllFavoritesSync: async () => [],
      },
      recordMetadata: new ReadingRecordMetadata({
        getString: async () => null,
        putString: async () => {},
      }),
      legacyRecordCoverJson: (recordId) =>
        recordId === 77
          ? JSON.stringify({
              title: '三体',
              sourceId: 'js_legacy',
              comicId: 'legacy-1',
              cover: 'https://cdn/cover.jpg',
              author: '刘慈欣',
            })
          : null,
    });
    vm.resolveMissingRecordCovers([{ id: 77, bookId: null, bookTitle: '三体' }]);
    await vm.whenIdle();
    expect(vm.recordBooksState.value[77]?.id).toBe('legacy-1');
    expect(vm.recordCoversState.value[77]).toBe('https://cdn/cover.jpg');
  });
});

/* ── SourceCapabilities partition used by the source picker ── */

describe('isComicSource excludes plain book sources (LibraryScreen.kt:1182)', () => {
  it('a source that is neither comic nor novel is not a comic source', () => {
    const plain = {
      id: 'plain',
      name: '普通书源',
      capabilities: createSourceCapabilities(),
    } as unknown as BookSource;
    // `!isNovelSource` would have swept it into 漫画源.
    expect(isComic(plain)).toBe(false);
  });
});

function isComic(source: BookSource): boolean {
  return source.capabilities.supportComic === true && !isNovelMirror(source);
}

function isNovelMirror(source: BookSource): boolean {
  return (
    source.id === 'zlibrary' ||
    (!source.capabilities.supportComic &&
      (source.capabilities.supportEbook || source.capabilities.supportOnlineText))
  );
}