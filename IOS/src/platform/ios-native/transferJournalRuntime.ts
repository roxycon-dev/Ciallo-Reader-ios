import type { PlatformBundle } from '@platform/index';
import { TransferImportJournal } from '@core/transfer/importJournal';
import { NativeImportJournalFiles } from './importJournalPort';
import { NativeImportPreferences } from './importPreferences';

export function createNativeTransferJournal(platform: PlatformBundle, sourceIds: readonly string[] = []): TransferImportJournal {
  return new TransferImportJournal(platform.db, new NativeImportJournalFiles(), new NativeImportPreferences(platform.secure, window.localStorage, sourceIds));
}
