import type { HttpClient } from '@platform/interfaces';
import { SourceManager } from '@core/source/sourceManager';
import type { SourceStorage } from '@core/source/sourceManager';
import { AutoNovelSource } from '@core/source/impl/autoNovelSource';
import { IxdzsSource } from '@core/source/impl/ixdzsSource';
import { Wenku8LibrarySource } from '@core/source/impl/wenku8LibrarySource';
import { MangaDexSource } from '@core/source/impl/mangaDexSource';
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
): Promise<void> {
  await manager.initialize();
  for (const source of [
    new AutoNovelSource({ client: http }),
    new Wenku8LibrarySource({ client: http }),
    new IxdzsSource({ client: http }),
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
