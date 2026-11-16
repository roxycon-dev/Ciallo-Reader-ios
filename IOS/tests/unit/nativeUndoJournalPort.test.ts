import { describe, expect, it, vi } from 'vitest';
import { NativeImportUndoFiles, parsePendingImportUndo } from '@platform/ios-native/undoJournalPort';
const id = '01234567-89ab-cdef-0123-456789abcdef', operationId = '11234567-89ab-cdef-0123-456789abcdef';
const snapshot = { version: 1 as const, id, stageId: id, keepUndo: true, createdAt: 1, settings: { source_metadata: '{}' } };
describe('native replacement undo record bridge', () => {
  it('accepts a complete private snapshot and requires matching operation ids before native restoration', async () => {
    const undo = vi.fn(async () => ({ record: { version: 1, operationId, snapshot } })), files = new NativeImportUndoFiles({ undo });
    const pending = await files.begin(operationId, id); expect(pending.snapshot.id).toBe(id); await files.restore(pending); expect(undo).toHaveBeenLastCalledWith({ action: 'restore', operationId });
    await expect(files.begin('../bad', id)).rejects.toThrow('身份无效');
  });
  it('rejects unknown/private account fields and incomplete native responses', async () => {
    const files = new NativeImportUndoFiles({ undo: async () => ({}) }); await expect(files.pending()).rejects.toThrow('响应不完整');
    expect(() => parsePendingImportUndo({ version: 1, operationId, snapshot: { ...snapshot, settings: { 'privacy.pin.v1': 'private' } } })).toThrow('未知存储');
    expect(() => parsePendingImportUndo({ version: 1, operationId, snapshot: { ...snapshot, keepUndo: false } })).toThrow('替换恢复快照');
  });
});
