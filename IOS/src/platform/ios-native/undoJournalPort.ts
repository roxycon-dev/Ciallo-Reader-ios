import { registerPlugin } from '@capacitor/core';
import { nonThenablePlugin } from './pluginProxy';
import { parseImportJournalRecord } from './importJournalPort';
import type { ImportJournalRecord } from '@core/transfer/importJournal';
import type { ImportUndoFiles, PendingImportUndo } from '@core/transfer/undoJournal';
import { portableObject } from '@core/transfer/portableFormat';
import { isTransferSessionId, requireTransfer } from '@core/transfer/transferWire';

interface UndoNative { undo(options: { action: 'available' | 'pending' | 'begin' | 'restore' | 'finish'; operationId?: string; snapshotId?: string }): Promise<{ record?: unknown }>; }
export function parsePendingImportUndo(input: unknown): PendingImportUndo {
  const value = portableObject(input, '本机撤回记录损坏');
  requireTransfer(value.version === 1 && isTransferSessionId(value.operationId), '本机撤回身份无效');
  const snapshot = parseImportJournalRecord(value.snapshot); requireTransfer(snapshot.keepUndo, '不是替换恢复快照');
  return { version: 1, operationId: value.operationId, snapshot };
}
export class NativeImportUndoFiles implements ImportUndoFiles {
  constructor(private readonly native: UndoNative = nonThenablePlugin(registerPlugin<UndoNative>('ReaderTransferArchive'))) {}
  async available(): Promise<ImportJournalRecord | null> {
    const result = await this.native.undo({ action: 'available' }); requireTransfer(Object.hasOwn(result, 'record'), '恢复快照响应不完整'); return result.record === null ? null : parseImportJournalRecord(result.record);
  }
  async pending(): Promise<PendingImportUndo | null> {
    const result = await this.native.undo({ action: 'pending' }); requireTransfer(Object.hasOwn(result, 'record'), '撤回记录响应不完整'); return result.record === null ? null : parsePendingImportUndo(result.record);
  }
  async begin(operationId: string, snapshotId: string): Promise<PendingImportUndo> {
    requireTransfer(isTransferSessionId(operationId) && isTransferSessionId(snapshotId), '本机撤回身份无效');
    return parsePendingImportUndo((await this.native.undo({ action: 'begin', operationId, snapshotId })).record);
  }
  async restore(record: PendingImportUndo): Promise<void> { await this.native.undo({ action: 'restore', operationId: parsePendingImportUndo(record).operationId }); }
  async finish(record: PendingImportUndo): Promise<void> { await this.native.undo({ action: 'finish', operationId: parsePendingImportUndo(record).operationId }); }
}
