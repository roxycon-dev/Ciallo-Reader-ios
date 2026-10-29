import type { PlatformBundle } from '@platform/index';
import { TransferImportJournal } from '@core/transfer/importJournal';
import { NativeImportJournalFiles } from './importJournalPort';
import { NativeImportPreferences } from './importPreferences';
import { TransferUndoJournal } from '@core/transfer/undoJournal';
import { NativeImportUndoFiles } from './undoJournalPort';

export function createNativeTransferJournal(platform: PlatformBundle, sourceIds: readonly string[] = []): TransferImportJournal {
  return new TransferImportJournal(platform.db, new NativeImportJournalFiles(), new NativeImportPreferences(platform.secure, window.localStorage, sourceIds));
}
export function createNativeTransferUndoJournal(platform: PlatformBundle): TransferUndoJournal {
  return new TransferUndoJournal(platform.db, new NativeImportUndoFiles(), new NativeImportPreferences(platform.secure, window.localStorage));
}
export async function recoverNativeTransferState(platform: PlatformBundle): Promise<void> {
  await createNativeTransferJournal(platform).recover(); await createNativeTransferUndoJournal(platform).recover();
}
