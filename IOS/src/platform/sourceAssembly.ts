import type { FileSystemApi, HttpClient } from '@platform/interfaces';
import { SourceManager } from '@core/source/sourceManager';
import type { SourceStorage } from '@core/source/sourceManager';
import { AutoNovelSource } from '@core/source/impl/autoNovelSource';
import { IxdzsSource } from '@core/source/impl/ixdzsSource';
import { Wenku8LibrarySource } from '@core/source/impl/wenku8LibrarySource';
import { MangaDexSource } from '@core/source/impl/mangaDexSource';
import { XbookcnSource } from '@core/source/impl/xbookcnSource';
import { PublicNovelSource } from '@core/source/impl/publicNovelSource';
import { FanqieSource } from '@core/source/impl/fanqieSource';
import { verifySourceWebsite } from './ios-native/websiteVerification';
import { JsonBookSource } from '@core/source/impl/jsonBookSource';
import { importFromJsonString } from '@core/source/importer/sourceImporter';
import { SourceResult, type SourceResult as SourceResultType } from '@core/source/sourceResult';
import { ComicSource } from '@core/source/comicSource';
import { attachComicSourceResolver } from '@core/comic/comicChapters';

/** Every source, including restored custom sources, uses the platform HTTP client. */
export function createAppSourceManager(storage: SourceStorage, http: HttpClient): SourceManager {
  return new SourceManager(storage, {
    importFromJsonString(json) {
      const result = importFromJsonString(json);
      return result.kind === 'success'
        ? SourceResult.Success(new JsonBookSource(result.data.config, http))
        : result;
    },
  });
}

/** Registration itself does no network IO and preserves saved enable states. */
export async function registerAppBuiltinSources(
  manager: SourceManager,
  http: HttpClient,
  fs?: FileSystemApi,
): Promise<void> {
  await manager.initialize();
  for (const source of [
    new AutoNovelSource({ client: http }),
    new Wenku8LibrarySource({ client: http, ...(fs ? { fs } : {}) }),
    new IxdzsSource({ client: http }),
    new XbookcnSource({ client: http, verify: async (url, userAgent) => {
      const result = await verifySourceWebsite(url, userAgent);
      const target = new URL(url);
      return { cookie: result.cookies.filter((cookie) => {
        const domain = cookie.domain.replace(/^\./, '');
        return (target.hostname === domain || target.hostname.endsWith(`.${domain}`)) && target.pathname.startsWith(cookie.path || '/')
          && (!cookie.secure || target.protocol === 'https:') && (!cookie.expires || cookie.expires > Date.now())
          && !/[;\r\n]/.test(cookie.name + cookie.value);
      }).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') };
    } }),
    new PublicNovelSource('quanben', { client: http }),
    new PublicNovelSource('ihuaben', { client: http }),
    new PublicNovelSource('sfacg', { client: http }),
    new FanqieSource({ client: http }),
    new MangaDexSource({ client: http }),
  ]) {
    await manager.registerSource(source);
  }
  attachComicSourceResolver(async (id) => {
    const source = manager.getSource(id);
    if (!(source instanceof ComicSource)) return null;
    const unwrap = <T>(result: SourceResultType<T>): T => {
      if (result.kind === 'error') throw result.exception;
      return result.data;
    };
    return {
      name: source.name,
      supportOnlineText: source.capabilities.supportOnlineText,
      getChapters: async (bookId) => unwrap(await source.getChapters(bookId)),
      getChapterImages: async (chapterId) => unwrap(await source.getChapterImages(chapterId)),
      getChapterImageHeaders: (chapterId, urls) => source.getChapterImageHeaders(chapterId, urls),
    };
  });
}
