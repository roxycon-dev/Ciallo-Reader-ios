import { registerPlugin } from '@capacitor/core';
import { nonThenablePlugin } from './pluginProxy';
import type { ImportJournalFiles, ImportJournalRecord } from '@core/transfer/importJournal';
import { isTransferSessionId, requireTransfer } from '@core/transfer/transferWire';
import { portableObject } from '@core/transfer/portableFormat';

interface JournalNative {
  journal(options: { action: 'pending' | 'prepare' | 'restore' | 'finish' | 'discard'; record?: ImportJournalRecord; id?: string }): Promise<{ record?: unknown }>;
}
export function parseImportJournalRecord(input: unknown): ImportJournalRecord {
  const value = portableObject(input, '本机导入恢复记录损坏'), settings = portableObject(value.settings, '本机设置快照损坏');
  requireTransfer(value.version === 1 && isTransferSessionId(value.id) && isTransferSessionId(value.stageId) && typeof value.keepUndo === 'boolean' && typeof value.createdAt === 'number' && Number.isSafeInteger(value.createdAt) && value.createdAt >= 0, '本机导入恢复记录无效');
  requireTransfer(Object.keys(settings).length <= 10000 && new TextEncoder().encode(JSON.stringify(value)).length <= 8 * 1024 * 1024, '本机导入恢复记录过大');
  const snapshot: Record<string, string | null> = Object.create(null) as Record<string, string | null>;
  for (const [key, setting] of Object.entries(settings)) {
    requireTransfer((key.startsWith('comic_reader_store:') || key === 'god_moment_prefs' || key === 'source_metadata') && key.length <= 1024 && (setting === null || typeof setting === 'string' && setting.length <= 1024 * 1024), '本机快照包含未知存储或无效值');
    snapshot[key] = setting;
  }
  return { version: 1, id: value.id, stageId: value.stageId, keepUndo: value.keepUndo, createdAt: value.createdAt, settings: snapshot };
}
export class NativeImportJournalFiles implements ImportJournalFiles {
  constructor(private readonly native: JournalNative = nonThenablePlugin(registerPlugin<JournalNative>('ReaderTransferArchive'))) {}
  async pending(): Promise<ImportJournalRecord | null> {
    const result = await this.native.journal({ action: 'pending' }); requireTransfer(Object.hasOwn(result, 'record'), '本机导入日志响应不完整'); return result.record === null ? null : parseImportJournalRecord(result.record);
  }
  async prepare(record: ImportJournalRecord): Promise<void> { await this.native.journal({ action: 'prepare', record: parseImportJournalRecord(record) }); }
  async restore(record: ImportJournalRecord): Promise<void> { await this.native.journal({ action: 'restore', id: record.id }); }
  async finish(record: ImportJournalRecord): Promise<void> { await this.native.journal({ action: 'finish', id: record.id }); }
  async discard(record: ImportJournalRecord): Promise<void> { await this.native.journal({ action: 'discard', id: record.id }); }
}
