import { describe, expect, it, vi } from 'vitest';
import { NativeImportJournalFiles, parseImportJournalRecord } from '@platform/ios-native/importJournalPort';

const id = '01234567-89ab-cdef-0123-456789abcdef';
const record = { version: 1, id, stageId: id, keepUndo: true, createdAt: 1, settings: { 'comic_reader_store:global_config': '{"zoom":1}', 'comic_reader_store:book_state_1': null } };
describe('private native import journal boundary', () => {
  it('preserves nullable reader values and rejects foreign stores or broken identities', () => {
    expect(parseImportJournalRecord(record)).toEqual(record);
    for (const changed of [{ ...record, id: '../escape' }, { ...record, keepUndo: 'true' }, { ...record, settings: { privacy_pin: '123456' } }, { ...record, settings: { 'comic_reader_store:global_config': {} } }]) expect(() => parseImportJournalRecord(changed)).toThrow();
  });
  it('sends only an operation and identity when restoring/finalizing a native snapshot', async () => {
    const journal = vi.fn(async (): Promise<{ record?: unknown }> => ({ record })), files = new NativeImportJournalFiles({ journal });
    expect(await files.pending()).toEqual(record); await files.prepare(parseImportJournalRecord(record)); await files.restore(parseImportJournalRecord(record)); await files.finish(parseImportJournalRecord(record));
    expect(journal).toHaveBeenLastCalledWith({ action: 'finish', id }); expect(journal.mock.calls).toHaveLength(4);
    journal.mockResolvedValueOnce({}); await expect(files.pending()).rejects.toThrow('不完整');
  });
});
