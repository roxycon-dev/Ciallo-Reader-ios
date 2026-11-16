import type { SQLiteDatabase } from '@platform/interfaces';
import { AsyncMutex, contentMutationGate } from '@core/library/contentMutationGate';
import { restoreImportUndo, validateImportUndo, type ImportJournalPreferences, type ImportJournalRecord } from './importJournal';
import { isTransferSessionId, requireTransfer } from './transferWire';

export interface PendingImportUndo { version: 1; operationId: string; snapshot: ImportJournalRecord; }
export interface ImportUndoFiles {
  available(): Promise<ImportJournalRecord | null>;
  pending(): Promise<PendingImportUndo | null>;
  begin(operationId: string, snapshotId: string): Promise<PendingImportUndo>;
  restore(record: PendingImportUndo): Promise<void>;
  finish(record: PendingImportUndo): Promise<void>;
}
const snapshotMarker = (id: string) => `undo-snapshot:${id}`, commitMarker = (id: string) => `undo:${id}`;
/** Undo is a durable user intent: once its pending marker exists, startup
 * finishes the requested restore. A committed marker only needs cleanup, so
 * later reader preference changes cannot be overwritten on the next launch. */
export class TransferUndoJournal {
  private readonly operations = new AsyncMutex();
  constructor(private readonly database: SQLiteDatabase, private readonly files: ImportUndoFiles, private readonly preferences: ImportJournalPreferences) {}
  private async hasMarker(marker: string): Promise<boolean> { return (await this.database.query('SELECT packageId FROM transfer_receipts WHERE packageId=?', [marker])).length > 0; }
  async available(): Promise<ImportJournalRecord | null> {
    const record = await this.files.available();
    if (!record || !isTransferSessionId(record.id) || !await this.hasMarker(snapshotMarker(record.id))) return null;
    await validateImportUndo(this.database); return record;
  }
  private validate(record: PendingImportUndo): void {
    requireTransfer(record.version === 1 && isTransferSessionId(record.operationId) && isTransferSessionId(record.snapshot.id) && isTransferSessionId(record.snapshot.stageId) && record.snapshot.keepUndo, '本机撤回记录无效');
  }
  private async apply(record: PendingImportUndo): Promise<void> {
    this.validate(record); requireTransfer(this.database.transaction, '撤回需要受管数据库事务');
    requireTransfer(await this.hasMarker(snapshotMarker(record.snapshot.id)), '撤回文件和数据库快照身份不一致');
    await this.database.transaction!(async (database) => {
      await restoreImportUndo(database);
      await this.files.restore(record); await this.preferences.restore(record.snapshot.settings);
      await database.execute('INSERT OR REPLACE INTO transfer_receipts (packageId,importedAt) VALUES (?,?)', [commitMarker(record.operationId), Date.now()]);
    });
  }
  private async finalize(record: PendingImportUndo): Promise<void> {
    await this.files.finish(record);
    await this.database.execute('DELETE FROM transfer_receipts WHERE packageId=?', [commitMarker(record.operationId)]).catch(() => {});
  }
  private async recoverLocked(): Promise<void> {
    const record = await this.files.pending(); if (!record) return;
    this.validate(record); contentMutationGate.invalidatePendingWrites();
    if (!await this.hasMarker(commitMarker(record.operationId))) await this.apply(record);
    await this.finalize(record);
  }
  async recover(): Promise<void> { await contentMutationGate.mutex.withLock(() => this.operations.withLock(() => this.recoverLocked())); }
  async run(operationId: string, expectedSnapshotId: string): Promise<{ finalizationPending: boolean }> {
    requireTransfer(isTransferSessionId(operationId) && isTransferSessionId(expectedSnapshotId), '本机撤回身份无效');
    return contentMutationGate.mutex.withLock(() => this.operations.withLock(async () => {
      await this.recoverLocked();
      const snapshot = await this.available(); requireTransfer(snapshot?.id === expectedSnapshotId, '恢复快照已改变，请重新查看后确认');
      const pending = await this.files.begin(operationId, expectedSnapshotId); this.validate(pending);
      requireTransfer(pending.operationId === operationId && pending.snapshot.id === expectedSnapshotId, '撤回身份未匹配');
      contentMutationGate.invalidatePendingWrites(); await this.apply(pending);
      try { await this.finalize(pending); return { finalizationPending: false }; }
      catch { return { finalizationPending: true }; }
    }));
  }
}
