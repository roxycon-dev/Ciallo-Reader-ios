import { BACKUP_TABLES } from '@core/db/schemaV13';
import { AsyncMutex, contentMutationGate } from '@core/library/contentMutationGate';
import { isTransferSessionId, requireTransfer } from './transferWire';
import type { SQLiteDatabase, SqliteExecutor } from '@platform/interfaces';

export interface ImportJournalRecord {
  version: 1;
  id: string;
  stageId: string;
  keepUndo: boolean;
  createdAt: number;
  settings: Record<string, string | null>;
}
export interface ImportJournalFiles {
  pending(): Promise<ImportJournalRecord | null>;
  prepare(record: ImportJournalRecord): Promise<void>;
  restore(record: ImportJournalRecord): Promise<void>;
  finish(record: ImportJournalRecord): Promise<void>;
  discard(record: ImportJournalRecord): Promise<void>;
}
export interface ImportJournalPreferences {
  snapshot(): Record<string, string | null> | Promise<Record<string, string | null>>;
  restore(snapshot: Record<string, string | null>): void | Promise<void>;
}
export const IMPORT_SNAPSHOT_TABLES = [...BACKUP_TABLES, 'transfer_identities', 'transfer_receipts', 'app_settings'];
const undoName = (table: string): string => `_ciallo_undo_${table}`;
const affinity = (type: string): string => /INT/i.test(type) ? 'INTEGER' : /CHAR|CLOB|TEXT/i.test(type) ? 'TEXT' : /REAL|FLOA|DOUB/i.test(type) ? 'REAL' : /BLOB/i.test(type) || !type ? 'BLOB' : 'NUMERIC';
export async function snapshotImportUndo(database: SqliteExecutor): Promise<void> {
  for (const table of IMPORT_SNAPSHOT_TABLES) {
    await database.execute(`DROP TABLE IF EXISTS "${undoName(table)}"`);
    await database.execute(`CREATE TABLE "${undoName(table)}" AS SELECT * FROM "${table}"`);
  }
}
export async function restoreImportUndo(database: SqliteExecutor): Promise<void> {
  // Check all layouts before deleting anything; an undo from another schema
  // must fail without producing a partially restored library.
  for (const table of IMPORT_SNAPSHOT_TABLES) {
    const current = await database.query<{ name: string; type: string }>(`PRAGMA table_info("${table}")`);
    const backup = await database.query<{ name: string; type: string }>(`PRAGMA table_info("${undoName(table)}")`);
    requireTransfer(current.length > 0 && current.length === backup.length && current.every((column, index) => column.name === backup[index]?.name && affinity(column.type) === affinity(backup[index]!.type)), '回退快照缺失或版本不兼容');
  }
  for (const table of [...IMPORT_SNAPSHOT_TABLES].reverse()) await database.execute(`DELETE FROM "${table}"`);
  for (const table of IMPORT_SNAPSHOT_TABLES) await database.execute(`INSERT INTO "${table}" SELECT * FROM "${undoName(table)}"`);
}
const marker = (id: string): string => `journal:${id}`;

/** SQLite automatically rolls back an interrupted transaction. Its unique
 * receipt is committed with the library, letting startup distinguish a committed
 * import from a rollback even if file cleanup never ran. External definition/
 * preference snapshots stay private on this device. Caller pauses downloads and
 * holds the source-definition lock before entering this journal. */
export class TransferImportJournal {
  private readonly operations = new AsyncMutex();
  constructor(private readonly database: SQLiteDatabase, private readonly files: ImportJournalFiles, private readonly preferences: ImportJournalPreferences) {}

  async recover(): Promise<void> {
    await contentMutationGate.mutex.withLock(() => this.operations.withLock(() => this.recoverLocked()));
  }
  private async recoverLocked(): Promise<void> {
    const pending = await this.files.pending(); if (!pending) return;
    requireTransfer(isTransferSessionId(pending.id) && isTransferSessionId(pending.stageId) && pending.version === 1, '导入恢复记录无效');
    contentMutationGate.invalidatePendingWrites();
    const committed = (await this.database.query('SELECT packageId FROM transfer_receipts WHERE packageId=?', [marker(pending.id)])).length > 0;
    if (committed) await this.finalize(pending);
    else { await this.files.restore(pending); await this.preferences.restore(pending.settings); await this.files.discard(pending); }
  }
  private async finalize(record: ImportJournalRecord): Promise<void> {
    await this.files.finish(record);
    // A leftover housekeeping receipt is harmless; remove it only after file
    // finalization so a crash cannot mistake a completed import for a rollback.
    await this.database.execute('DELETE FROM transfer_receipts WHERE packageId=?', [marker(record.id)]).catch(() => {});
  }
  async run<T>(id: string, stageId: string, keepUndo: boolean, operation: (database: SqliteExecutor) => Promise<T>): Promise<{ value: T; finalizationPending: boolean }> {
    requireTransfer(isTransferSessionId(id) && isTransferSessionId(stageId) && this.database.transaction, '受管导入事务不可用');
    return contentMutationGate.mutex.withLock(() => this.operations.withLock(async () => {
      await this.recoverLocked(); contentMutationGate.invalidatePendingWrites();
      const record: ImportJournalRecord = { version: 1, id, stageId, keepUndo, createdAt: Date.now(), settings: await this.preferences.snapshot() };
      let value: T;
      try {
        value = await this.database.transaction!(async (tx) => {
          if (keepUndo) await snapshotImportUndo(tx);
          await this.files.prepare(record);
          try {
            const result = await operation(tx);
            await tx.execute('INSERT OR REPLACE INTO transfer_receipts (packageId,importedAt) VALUES (?,?)', [marker(id), Date.now()]);
            return result;
          } catch (error) {
            // Restore external state before the connection is released. If this
            // fails, leave the pending journal intact for startup recovery.
            await this.files.restore(record); await this.preferences.restore(record.settings); await this.files.discard(record); throw error;
          }
        });
      } catch (error) {
        try { await this.recoverLocked(); } catch (recovery) { throw new AggregateError([error, recovery], '导入失败且恢复待完成'); }
        throw error;
      }
      try { await this.finalize(record); return { value, finalizationPending: false }; }
      catch { return { value, finalizationPending: true }; }
    }));
  }
}
