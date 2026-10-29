import type { PlatformBundle } from '@platform/index';
import { getLibraryRuntime } from '@core/library/libraryRuntime';
import { getOrCreateDownloadQueue } from '@core/download/downloadQueue';
import { SharedPreferencesSourceStorage } from '@core/source/storage/sharedPreferencesSourceStorage';
import { FileSystemSourceConfigFile, SecureStoreSourcePrefs } from '@platform/web/platformAdapters';
import { getAppJsSources } from '@platform/jsSourceAssembly';
import { getPrivacyService } from '@platform/privacyRuntime';
import { importPortableArchive, type ArchiveImportResult } from '@core/transfer/archiveImporter';
import { TransferStagingRows } from '@core/transfer/stagingRows';
import { ArchiveResources } from '@core/transfer/archiveResources';
import { BookContentFingerprint } from '@core/transfer/bookFingerprint';
import { requireTransfer } from '@core/transfer/transferWire';
import type { TransferImportMode } from '@core/transfer/transferSession';
import { NativePortableArchivePort, type InspectedPortableArchive } from './portableArchivePort';
import { NativeLocalArchiveResources } from './localArchiveResources';
import { createNativeTransferJournal } from './transferJournalRuntime';
import { applyNativeArchiveSettings } from './archiveSettings';

export interface NativeArchiveImportResult { result: ArchiveImportResult; finalizationPending: boolean; requiresReload: boolean; }
/** Invoked only after peer consent and archive inspection. The transport writes
 * its durable imported receipt before the UI performs requiresReload. */
export async function importNativeArchive(platform: PlatformBundle, archive: InspectedPortableArchive, mode: TransferImportMode, signal?: AbortSignal, progress?: (completed: number, total: number) => void): Promise<NativeArchiveImportResult> {
  const runtime = getLibraryRuntime(), manager = runtime?.sourceManager;
  requireTransfer(manager, '书源服务尚未准备好，请完成启动后重试');
  const scripts = getAppJsSources(manager); requireTransfer(scripts, '脚本源服务尚未准备好');
  const privacy = await getPrivacyService().ready();
  requireTransfer(!archive.preview.containsProtected || privacy.enabled, '请先在接收设备设置隐私 PIN，再导入受保护内容');
  const native = new NativePortableArchivePort(), staging = new TransferStagingRows(platform.db, archive.stageId);
  try {
    await staging.build(native.rows(archive.stageId), archive.manifest ?? undefined, signal);
    const ids = [...new Set([...manager.allSources.value.map((source) => source.id), ...Object.keys(archive.settings.sources ?? {}), ...Object.keys(archive.settings.source_states ?? {}), ...(archive.settings.scripts ?? []).map((source) => source.key), ...(archive.settings.active_source ? [archive.settings.active_source] : [])])];
    const journal = createNativeTransferJournal(platform, ids), local = new NativeLocalArchiveResources(native);
    const filesRoot = `restored_transfer_${archive.stageId}/files`, resources = new ArchiveResources(archive.entries, filesRoot);
    const queue = getOrCreateDownloadQueue({ http: platform.http });
    const run = () => scripts.withDefinitionLease((definitions) => manager.withMutationLease(async () => {
      const sourceStorage = new SharedPreferencesSourceStorage({ prefs: new SecureStoreSourcePrefs(platform.secure), files: new FileSystemSourceConfigFile(platform.fs) });
      return journal.run(archive.stageId, archive.stageId, mode === 'REPLACE', (tx) => importPortableArchive(tx, archive.preview, archive.settings, {
        stageId: archive.stageId, mode, privacyEnabled: privacy.enabled, resources, staging, ...(signal ? { signal } : {}), ...(progress ? { progress } : {}),
        localFingerprint: new BookContentFingerprint((path) => local.hash(path)), localOriginal: (book) => local.original(book), localDirectoryIdentity: (book) => local.directoryIdentity(book),
        normalizeLocalBody: (body, contentType) => local.normalizeBody(body, contentType),
        promoteResources: async () => { requireTransfer(await native.promote(archive.stageId) === filesRoot, '原生资源提升路径错误'); },
        applySettings: (database, settings, bookIds, recordedSeconds) => applyNativeArchiveSettings(database, settings, { mode, preview: archive.preview, resources, bookIds, recordedSeconds, storage: window.localStorage, sources: sourceStorage, scripts: definitions, sourceIds: ids }),
      }));
    }));
    const imported = await queue.withPausedDownloads(async () => {
      if (!runtime?.comicDownloads) return run();
      return runtime.comicDownloads.withControlLock(async () => { await runtime.comicDownloads!.pauseAllLocked(); return run(); });
    });
    return { result: imported.value, finalizationPending: imported.finalizationPending, requiresReload: !imported.value.duplicate };
  } finally { await staging.dispose().catch(() => {}); }
}
