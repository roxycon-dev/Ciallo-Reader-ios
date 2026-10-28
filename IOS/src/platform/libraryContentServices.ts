import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { BookRepository } from '@core/library/bookRepository';
import type { BookRow } from '@core/library/bookTypes';
import type { ComicImportedBook } from '@core/library/libraryComicLocalImporter';
import { BookShareHelper } from '@core/library/libraryBookShare';
import type { LibraryRuntime } from '@core/library/libraryRuntime';
import { createDownloadTaskRepository } from '@core/download/downloadTaskRepository';
import { originalBookId } from '@core/download/downloadManager';
import { JsImageProcessor } from '@core/source/js/jsImageProcessor';
import { ComicSource } from '@core/source/comicSource';
import { checkSourceUrl } from '@core/source/networkCalls';
import type { PlatformBundle } from '@platform/index';
import { createWebCrypto } from './web/webCrypto';
import { AppComicTaskRunner, ComicDownloadManager, comicTaskLocks, contentMutationGate } from './comicDownloads';
import { createBookSharePort, writeComicZip } from './bookSharing';

function imported(row: BookRow): ComicImportedBook {
  if (!row.filePath || !row.coverUri) throw new Error('漫画书架记录缺少页面路径');
  return { ...row, author: row.author ?? '漫画', filePath: row.filePath, coverUri: row.coverUri };
}

export async function installLibraryContentServices(platform: PlatformBundle, runtime: Pick<LibraryRuntime, 'sourceManager' | 'comicDownloads' | 'shareHelper'>,
  repository: BookRepository, reload: () => Promise<void>): Promise<void> {
  const fs = platform.fs;
  const deleteTree = async (path: string): Promise<void> => {
    if (!/^comics_[a-zA-Z0-9_-]+$/.test(path)) throw new Error('下载目录无效');
    if (Capacitor.isNativePlatform()) {
      if (await fs.exists(path)) await Filesystem.rmdir({ path, directory: Directory.Data, recursive: true });
    } else {
      const remove = async (directory: string): Promise<void> => {
        for (const name of await fs.list(directory)) {
          if (name.includes('/') || name.includes('\\') || name === '..') throw new Error('下载文件名无效');
          await remove(`${directory}/${name}`);
        }
        await fs.delete(directory);
      };
      await remove(path);
    }
  };
  const runner: AppComicTaskRunner = new AppComicTaskRunner((id, signal): Promise<unknown> => downloads.runWorkerForTask(id, signal),
    (error) => console.error('[comic-download]', error));
  const downloads: ComicDownloadManager = new ComicDownloadManager({
    fs, runner, withTaskLock: comicTaskLocks(), deleteTree,
    resolveSource: async (sourceId) => {
      const manager = runtime.sourceManager;
      if (!manager) return null;
      await manager.initialize(); const source = manager.getSource(sourceId);
      return source instanceof ComicSource ? source : null;
    },
    bookDao: {
      async getBookByFilePath(path) { const row = await repository.getBookByFilePath(path); return row ? imported(row) : null; },
      async insertBookWithChapters(book, chapters) {
        const row = await repository.insertBookWithChapters({ ...book, category: '默认', currentChapterIndex: 0,
          scrollOffset: 0, isFinished: 0, addedTime: Date.now(), lastReadTime: 0 },
        chapters.map((chapter) => ({ ...chapter, startCharIndex: 0, endCharIndex: 0 })));
        // Reload after the content lock is released; avoid waiting on UI database work inside the transaction.
        queueMicrotask(() => { void reload().catch((error: unknown) => console.error('[comic-download] 刷新书架失败', error)); });
        return imported(row);
      },
    },
    importer: {
      http: { request(request) { checkSourceUrl(request.url); return platform.http.request(request); } },
      cookieHeader: () => '', crypto: createWebCrypto(), contentGate: contentMutationGate.mutex,
      async transformImage(url, bytes) {
        if (!JsImageProcessor.hasTransform(url)) return null;
        const result = await JsImageProcessor.transform(url, bytes);
        if (!result) throw new Error('书源图片处理失败，请重试');
        return result;
      },
      async moveFile(from, to) { await fs.writeFile(to, await fs.readFile(from)); await fs.delete(from); },
      async copyLocalFile(url, to) {
        const path = decodeURIComponent(url.replace(/^file:\/\//, ''));
        if (Capacitor.isNativePlatform()) {
          const root = await Filesystem.getUri({ path: '', directory: Directory.Data });
          if (!url.startsWith(root.uri.replace(/\/$/, '') + '/')) throw new Error('缓存文件超出应用目录');
          await Filesystem.copy({ from: url, to, toDirectory: Directory.Data });
        } else await fs.writeFile(to, await fs.readFile(path));
      },
      ...(Capacitor.isNativePlatform() ? { freeSpaceBytes: async () => (await platform.storageStats.volumeStats()).freeBytes } : {}),
      deleteTree,
    },
    onFatalError: (message) => downloads.setMessage(message),
  });
  runtime.comicDownloads = downloads;
  const tasks = createDownloadTaskRepository(platform.db);
  runtime.shareHelper = new BookShareHelper({
    fs, share: createBookSharePort(fs), chaptersOfBook: (id) => repository.getChaptersListForBook(id),
    downloadTasks: () => tasks.getAllTasks(), originalBookId,
    async fileExists(path) {
      if (Capacitor.isNativePlatform()) {
        try { return (await Filesystem.stat({ path, directory: Directory.Data })).type === 'file'; } catch { return false; }
      }
      try { await fs.readFile(path); return true; } catch { return false; }
    },
    dirExists: async (path) => (await fs.list(path)).length > 0,
    writeZip: (entries, path) => writeComicZip(fs, entries, path),
    async listShareTemp() {
      const entries = await fs.list('share_temp');
      return Promise.all(entries.map(async (name) => {
        const path = `share_temp/${name}`;
        const modifiedAt = Capacitor.isNativePlatform() ? (await Filesystem.stat({ path, directory: Directory.Data })).mtime : Date.now();
        return { path, modifiedAt };
      }));
    },
  });
  await downloads.initialize();
  await runtime.shareHelper.cleanupTempShareDir();
}
