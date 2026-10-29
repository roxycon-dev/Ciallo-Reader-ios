import { describe, expect, it, vi } from 'vitest';
import { NativeArchiveFilePort, parsePickedTransferArchive, type ArchiveFileNative } from '../../src/platform/ios-native/archiveFilePort';

const id = '12345678-1234-1234-1234-123456789abc';
const file = { sessionId: id, path: `transfer/${id}.incoming`, size: 1024, name: '迁移.ciallo', sha256: 'a'.repeat(64) };
describe('native migration file metadata boundary', () => {
  it('accepts managed immutable copies and preserves picker cancellation', async () => {
    const native: ArchiveFileNative = { pickTransfer: vi.fn(async () => ({ file })), shareTransfer: vi.fn(async () => ({ completed: true })), cancelTransfer: vi.fn(async () => {}) };
    const port = new NativeArchiveFilePort(native); expect(await port.pick()).toEqual(file);
    vi.mocked(native.pickTransfer).mockResolvedValueOnce({ file: null }); expect(await port.pick()).toBeNull();
    await port.share(`transfer/${id}.outgoing`, 'Ciallo.ciallo'); expect(native.shareTransfer).toHaveBeenCalledWith({ path: `transfer/${id}.outgoing`, name: 'Ciallo.ciallo' });
  });
  it.each([{ path: '../private/book.zip' }, { path: `transfer/${id}.outgoing` }, { sessionId: '../../private' }, { size: 0 }, { size: 4 * 1024 ** 3 + 1 }, { size: 1.5 }, { sha256: 'bad' }, { name: '../book.zip' }, { name: 'bad\0.zip' }])('rejects untrusted metadata %j', (change) => {
    expect(() => parsePickedTransferArchive({ ...file, ...change })).toThrow();
  });
  it('never sends arbitrary document paths or misleading names to the native share method', async () => {
    const native: ArchiveFileNative = { pickTransfer: vi.fn(async () => ({ file: null })), shareTransfer: vi.fn(async () => ({ completed: true })), cancelTransfer: vi.fn(async () => {}) }, port = new NativeArchiveFilePort(native);
    await expect(port.share('source_configs/private.json', 'Ciallo.ciallo')).rejects.toThrow(); await expect(port.share(`transfer/${id}.outgoing`, '../Ciallo.ciallo')).rejects.toThrow(); expect(native.shareTransfer).not.toHaveBeenCalled();
  });
});
