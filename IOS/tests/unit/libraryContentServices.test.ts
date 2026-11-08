import { describe, expect, it, vi } from 'vitest';
import { encode } from 'fast-png';
import { unzipSync } from 'fflate';
import { createWebMockPlatform } from '@platform/web-mock';
import { installLibraryContentServices } from '@platform/libraryContentServices';
import { writeComicZip } from '@platform/bookSharing';
import { BookRepository } from '@core/library/bookRepository';
import { openAppDatabase } from '@core/db/openDatabase';
import { ComicSource } from '@core/source/comicSource';
import { SourceManager } from '@core/source/sourceManager';
import { SourceResult } from '@core/source/sourceResult';
import { ParseError } from '@core/source/sourceException';
import { createSourceCapabilities } from '@core/source/sourceCapabilities';
import { createSearchBook } from '@core/source/searchBook';
import { createComicChapter } from '@core/source/comicChapter';
import type { LibraryRuntime } from '@core/library/libraryRuntime';
import type { HttpResponse } from '@platform/interfaces';

const image = encode({ width: 2, height: 2, channels: 4, depth: 8, data: new Uint8Array(16).fill(255) });
const book = createSearchBook({ id: 'work', sourceId: 'real-download', title: '离线验收', author: '作者', format: 'comic' });
const chapter = createComicChapter({ id: 'chapter', title: '第一话' });
class Source extends ComicSource {
  id = book.sourceId; name = '下载验收源';
  capabilities = createSourceCapabilities({ supportComic: true, supportDownload: true });
  async search() { return SourceResult.Success([book]); }
  async getDetail() { return SourceResult.Success(book); }
  async getDownloadInfo() { return SourceResult.Error(new ParseError('使用章节下载')); }
  async login() { return SourceResult.Success(true); }
  async logout() {}
  async isLoggedIn() { return true; }
  async getChapters() { return SourceResult.Success([chapter]); }
  async getChapterImages() { return SourceResult.Success(['https://images.example/1.png', 'https://images.example/2.png']); }
  override async getChapterImageHeaders() { return { 'https://images.example/1.png': { Referer: 'https://source.example/' } }; }
}
async function fixture() {
  const platform = createWebMockPlatform(); await openAppDatabase({ db: platform.db });
  const repository = new BookRepository(platform.db); const source = new Source();
  const sourceManager = new SourceManager(); await sourceManager.registerSource(source);
  const runtime: Pick<LibraryRuntime, 'sourceManager' | 'comicDownloads' | 'shareHelper'> = { sourceManager, comicDownloads: null, shareHelper: null };
  const reload = vi.fn(async () => {});
  await installLibraryContentServices(platform, runtime, repository, reload);
  return { platform, repository, runtime, source, reload };
}
function response(url: string): HttpResponse { return { status: 200, url, headers: {}, body: image }; }

describe('production comic downloads and file sharing', () => {
  it('downloads real page bytes, commits a readable shelf book, and preserves source headers', async () => {
    const { platform, runtime, repository, source, reload } = await fixture();
    const network = vi.fn(async (request) => response(request.url)); platform.http.request = network;
    const downloads = runtime.comicDownloads!; downloads.start(book, chapter, source);
    await downloads.whenIdle();
    await vi.waitFor(() => expect([...downloads.tasks().values()][0]?.status).toBe('SUCCESS'));
    await downloads.flush();
    const stored = (await repository.getAllBooks())[0]!;
    expect(stored.contentType).toBe('COMIC'); expect(stored.sourceId).toBe(source.id);
    const pages = await repository.listChapters(stored.id!); expect(pages).toHaveLength(2);
    expect(await platform.fs.readFile(pages[0]!.content)).toEqual(image);
    expect(network.mock.calls.find(([request]) => request.url.endsWith('/1.png'))?.[0].headers?.['Referer']).toBe('https://source.example/');
    expect(reload).toHaveBeenCalled();
    expect(JSON.parse(new TextDecoder().decode(await platform.fs.readFile('comic_download_tasks.json')))[0].status).toBe('SUCCESS');
  });

  it('pauses outstanding requests without a late book commit and resumes the same task once', async () => {
    const { platform, runtime, repository, source } = await fixture();
    const pending: Array<() => void> = [];
    platform.http.request = (request) => new Promise((resolve) => pending.push(() => resolve(response(request.url))));
    const downloads = runtime.comicDownloads!; downloads.start(book, chapter, source); await downloads.whenIdle();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    downloads.pause(chapter.id, book); await downloads.whenIdle();
    expect([...downloads.tasks().values()][0]?.status).toBe('PAUSED');
    for (const resolve of pending) resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await repository.getAllBooks()).toEqual([]);
    platform.http.request = async (request) => response(request.url);
    downloads.start(book, chapter, source); await downloads.whenIdle();
    await vi.waitFor(() => expect([...downloads.tasks().values()][0]?.status).toBe('SUCCESS'));
    expect(await repository.getAllBooks()).toHaveLength(1);
  });

  it('streams a valid CBZ with exact page contents instead of sharing only titles', async () => {
    const { platform } = await fixture();
    await platform.fs.writeFile('pages/1.png', image); await platform.fs.writeFile('pages/2.png', image);
    await writeComicZip(platform.fs, [{ name: '001.png', path: 'pages/1.png' }, { name: '002.png', path: 'pages/2.png' }], 'share_temp/chapter.cbz');
    const contents = unzipSync(await platform.fs.readFile('share_temp/chapter.cbz'));
    expect(Object.keys(contents)).toEqual(['001.png', '002.png']); expect(contents['002.png']).toEqual(image);
  });
});
