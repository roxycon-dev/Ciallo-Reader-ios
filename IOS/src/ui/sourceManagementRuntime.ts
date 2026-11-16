import { getLibraryRuntime } from '@core/library/libraryRuntime';
import {
  importBatchFromJsonString,
  importBatchFromUrl,
  buildImportStatusText,
} from '@core/source/importer/sourceImporter';
import { JsonBookSource } from '@core/source/impl/jsonBookSource';
import { SourceLog } from '@core/source/sourceLog';
import { getPlatform } from '@platform/index';
import { NULL_SOURCE_IO, type SourceManagementIo } from '@ui/pages/SourceManagementPage';
import type { SourceManager } from '@core/source/sourceManager';
import type { HttpClient } from '@platform/interfaces';
import { getAppJsSources } from '@platform/jsSourceAssembly';
import { JsComicSource } from '@core/source/js/jsComicSource';
import { SourceResult } from '@core/source/sourceResult';
import { getAppZLibrary } from '@platform/zLibraryAssembly';

/** Source-management mutations use the same manager observed by LibraryPage. */
export function createSourceManagementIo(
  manager: SourceManager | undefined = getLibraryRuntime()?.sourceManager,
  http: HttpClient = getPlatform().http,
): SourceManagementIo {
  if (manager === undefined) throw new Error('书源管理器尚未初始化');
  let status: string | null = null;
  const register = async (batch: ReturnType<typeof importBatchFromJsonString>): Promise<void> => {
    if (batch.imported.length === 0) {
      status = `导入失败：${batch.skipped[0]?.reason ?? '未找到可导入的书源'}`;
      return;
    }
    for (const entry of batch.imported) {
      await manager.registerCustomSource(
        new JsonBookSource(entry.source.config, http),
        entry.rawJson,
      );
    }
    status = buildImportStatusText(batch);
  };
  return {
    ...NULL_SOURCE_IO,
    allSources: async () => manager.allSources.value,
    activeSource: async () => manager.activeSource.value,
    enabledStates: async () => manager.enabledStates.value,
    isCustomSource: async (id) => manager.isCustomSource(id),
    enableSource: (id) => manager.setSourceEnabled(id, true),
    disableSource: (id) => manager.setSourceEnabled(id, false),
    removeSource: (id) => manager.unregisterSource(id),
    importSourceFromUri: async (text) => register(importBatchFromJsonString(text)),
    importSourceFromJsonString: async (text) => register(importBatchFromJsonString(text)),
    importSourceFromUrl: async (url) => register(await importBatchFromUrl(url, { client: http })),
    importStatus: async () => status,
    clearImportStatus: async () => {
      status = null;
    },
    sourceLog: () => SourceLog,
    zlibraryDomain: () => getAppZLibrary(manager)?.domain() ?? NULL_SOURCE_IO.zlibraryDomain(),
    isZLibraryLoggedIn: async () => getAppZLibrary(manager)?.source.isLoggedIn() ?? false,
    nodeStore: () => getAppZLibrary(manager)?.nodes ?? NULL_SOURCE_IO.nodeStore(),
    nodeProbe: () => getAppZLibrary(manager)?.probe ?? NULL_SOURCE_IO.nodeProbe(),
    zlibraryLoginSource: () => {
      const source = getAppZLibrary(manager)?.source;
      return source ? { id: source.id, name: source.name,
        login: async (credential) => SourceResult.map(await source.login(credential), () => null),
        getRegistrationUrl: () => source.getRegistrationUrl() } : null;
    },
    jsComicSource: (id) => {
      const source = manager.getSource(id);
      return source instanceof JsComicSource ? {
        id: source.id, name: source.name,
        login: async (credential) => SourceResult.map(await source.login(credential), () => null),
        getRegistrationUrl: () => source.getRegistrationUrl(),
      } : null;
    },
    registerJsComicSource: async (id) => {
      const source = manager.getSource(id);
      if (!(source instanceof JsComicSource)) throw new Error('书源不可用');
      const result = await source.register();
      if (result.kind === 'error') throw result.exception;
    },
    refreshJsSources: async () => {
      const sources = getAppJsSources(manager);
      if (!sources) throw new Error('JS 书源服务尚未初始化');
      await sources.refresh((message) => { status = message; });
    },
  };
}
