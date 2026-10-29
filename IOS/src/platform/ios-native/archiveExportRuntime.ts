import type { PlatformBundle } from '@platform/index';
import { getLibraryRuntime } from '@core/library/libraryRuntime';
import { contentMutationGate } from '@core/library/contentMutationGate';
import { getOrCreateDownloadQueue } from '@core/download/downloadQueue';
import { exportPortableRows, type ArchiveExportSelection } from '@core/transfer/archiveExporter';
import { TRANSFER_CATEGORIES, type PortableManifest } from '@core/transfer/portableFormat';
import { requireTransfer } from '@core/transfer/transferWire';
import { getAppJsSources } from '@platform/jsSourceAssembly';
import { getPrivacyService } from '@platform/privacyRuntime';
import { SecureStoreSourcePrefs, FileSystemSourceConfigFile } from '@platform/web/platformAdapters';
import { SharedPreferencesSourceStorage } from '@core/source/storage/sharedPreferencesSourceStorage';
import { NativeLocalArchiveResources } from './localArchiveResources';
import { NativePortableArchivePort } from './portableArchivePort';
import { NativeTransferPort } from './transferPort';
import { exportNativeArchiveSettings } from './archiveExportSettings';

export interface PreparedNativeArchive { sessionId: string; path: string; size: number; sha256: string; manifest: PortableManifest; }
export async function exportNativeArchive(platform: PlatformBundle, selection: ArchiveExportSelection, options: { pin?: string; signal?: AbortSignal } = {}): Promise<PreparedNativeArchive> {
  requireTransfer(selection.categories.length > 0 && new Set(selection.categories).size === selection.categories.length && selection.categories.every((category) => (TRANSFER_CATEGORIES as readonly string[]).includes(category)), '请选择有效的数据类别');
  if (selection.protectedAuthorized) requireTransfer(options.pin && await getPrivacyService().verify(options.pin), '隐私 PIN 不正确，未导出受保护内容');
  const runtime = getLibraryRuntime(), manager = runtime?.sourceManager; requireTransfer(manager && platform.db.transaction, '书库服务尚未准备好');
  const scripts = getAppJsSources(manager); requireTransfer(scripts, '书源服务尚未准备好');
  const native = new NativePortableArchivePort(), stageId = await native.prepare(), local = new NativeLocalArchiveResources(native), file = new NativeTransferPort().file(stageId, false);
  try {
    const build = () => scripts.withDefinitionLease((definitions) => manager.withMutationLease(() => contentMutationGate.mutex.withLock(() => platform.db.transaction!(async (database) => {
      const exported = await exportPortableRows(database, stageId, selection, local, (text, reset) => native.write(stageId, 'database.rows', text, reset), options.signal);
      const warnings: string[] = [], sources = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(platform.secure), files: new FileSystemSourceConfigFile(platform.fs) });
      const settings = await exportNativeArchiveSettings(database, selection, { selectedBookKeys: exported.selectedBookKeys, sources, scripts: definitions, sourceIds: manager.allSources.value.map((source) => source.id), storage: window.localStorage, resource: (path) => local.exportPath(path), warnings });
      requireTransfer(!options.signal?.aborted, '导出已取消'); await native.write(stageId, 'settings.json', JSON.stringify(settings), true);
      const packed = await native.pack(stageId, stageId, local.resources(), { packageId: stageId, createdAt: Date.now(), categories: [...selection.categories], counts: exported.counts, warnings: [...new Set([...warnings, ...local.warnings])], containsProtected: exported.containsProtected, protectedFavorites: exported.protectedFavorites });
      requireTransfer(!options.signal?.aborted, '导出已取消'); return packed;
    }))));
    const packed = await getOrCreateDownloadQueue({ http: platform.http }).withPausedDownloads(async () => {
      if (!runtime?.comicDownloads) return build();
      return runtime.comicDownloads.withControlLock(async () => { await runtime.comicDownloads!.pauseAllLocked(); return build(); });
    });
    return { sessionId: stageId, path: packed.path, size: await file.size(), sha256: await file.hash(), manifest: packed.manifest };
  } catch (error) { await file.remove().catch(() => {}); throw error; }
  finally { await native.discard(stageId).catch(() => {}); }
}
