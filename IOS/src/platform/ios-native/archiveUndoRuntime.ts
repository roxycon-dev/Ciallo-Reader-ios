import { getPlatform } from '@platform/index';
import { getLibraryRuntime } from '@core/library/libraryRuntime';
import { getOrCreateDownloadQueue } from '@core/download/downloadQueue';
import { getAppJsSources } from '@platform/jsSourceAssembly';
import { getPrivacyService } from '@platform/privacyRuntime';
import { requireTransfer } from '@core/transfer/transferWire';
import { createNativeTransferUndoJournal } from './transferJournalRuntime';
import { NativeImportUndoFiles } from './undoJournalPort';

export interface NativeUndoInfo { snapshotId: string; createdAt: number; needsPin: boolean; }
export class NativeUndoPendingError extends Error { readonly requiresReload = true; }
export async function getNativeUndoInfo(): Promise<NativeUndoInfo | null> {
  const record = await createNativeTransferUndoJournal(getPlatform()).available(); if (!record) return null;
  return { snapshotId: record.id, createdAt: record.createdAt, needsPin: (await getPrivacyService().ready()).enabled };
}
export async function undoNativeArchive(snapshotId: string, pin?: string): Promise<{ finalizationPending: boolean }> {
  const platform = getPlatform(), privacy = getPrivacyService(), enabled = (await privacy.ready()).enabled;
  requireTransfer(!enabled || pin && await privacy.verify(pin), '请先验证本机隐私 PIN');
  const runtime = getLibraryRuntime(), manager = runtime?.sourceManager; requireTransfer(manager, '书源服务尚未准备好');
  const scripts = getAppJsSources(manager); requireTransfer(scripts, '脚本源服务尚未准备好');
  const bytes = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const operationId = `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}-${bytes.slice(16, 20)}-${bytes.slice(20)}`;
  const run = () => scripts.withDefinitionLease(() => manager.withMutationLease(() => createNativeTransferUndoJournal(platform).run(operationId, snapshotId)));
  try {
    return await getOrCreateDownloadQueue({ http: platform.http }).withPausedDownloads(async () => {
      if (!runtime?.comicDownloads) return run();
      return runtime.comicDownloads.withControlLock(async () => { await runtime.comicDownloads!.pauseAllLocked(); return run(); });
    });
  } catch (error) {
    if (await new NativeImportUndoFiles().pending()) throw new NativeUndoPendingError('恢复尚未完成，重新载入后将继续处理');
    throw error;
  }
}
