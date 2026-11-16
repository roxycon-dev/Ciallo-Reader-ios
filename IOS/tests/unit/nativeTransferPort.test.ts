import { describe, expect, it, vi } from 'vitest';
import { NativeTransferPort, type ReaderTransferNative } from '@platform/ios-native/transferPort';
import { TransferWire } from '@core/transfer/transferWire';

const metadata = { connectionId: 'connection', localFingerprint: 'a'.repeat(64), peerFingerprint: 'b'.repeat(64) };
const id = '01234567-89ab-cdef-0123-456789abcdef';
function fixture() {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const native = {
    start: vi.fn(async () => ({ port: 38842, fingerprint: metadata.localFingerprint })), stop: vi.fn(async () => {}),
    connect: vi.fn(async () => metadata), read: vi.fn(async () => ({ data: 'AAH/', eof: false })), write: vi.fn(async () => {}), close: vi.fn(async () => {}),
    file: vi.fn(async () => ({ size: 3, exists: true, availableBytes: 1024, sha256: 'c'.repeat(64), data: 'AAH/' })),
    checkpoint: vi.fn<ReaderTransferNative['checkpoint']>(async () => ({ value: null })),
    addListener: vi.fn<ReaderTransferNative['addListener']>(async (event, handler) => {
      handlers.set(event, handler); return { remove: async () => { if (handlers.get(event) === handler) handlers.delete(event); } };
    }),
  } satisfies ReaderTransferNative;
  const events = { peers: vi.fn(), connection: vi.fn(), error: vi.fn() }, port = new NativeTransferPort(native);
  return { native, events, port, handlers };
}
describe('native device transfer assembly', () => {
  it('registers every listener before Bonjour advertising and removes them on stop', async () => {
    const { native, events, port, handlers } = fixture();
    native.start.mockImplementationOnce(async () => { expect(handlers.size).toBe(4); return { port: 1, fingerprint: metadata.localFingerprint }; });
    await port.start({ id: 'local', name: '本机' }, events);
    handlers.get('peers')!({ peers: [{ id: 'peer', name: '另一台设备' }, { name: 'invalid' }] }); expect(events.peers).toHaveBeenCalledWith([{ id: 'peer', name: '另一台设备' }]);
    await port.stop(); expect(handlers.size).toBe(0); expect(native.stop).toHaveBeenCalledOnce();
  });
  it('bridges actual binary bytes and gives native read a bounded pull request', async () => {
    const { port, native, events } = fixture(); await port.start({ id: 'local', name: '本机' }, events);
    const stream = await port.connect('peer'); expect([...await stream.read(3) ?? []]).toEqual([0, 1, 255]); expect(native.read).toHaveBeenCalledWith({ connectionId: 'connection', maxBytes: 3 });
    await stream.write(new Uint8Array([255, 0, 128])); expect(native.write).toHaveBeenCalledWith({ connectionId: 'connection', data: '/wCA' });
    await port.stop();
  });
  it('rejects an oversized native response and certificate metadata without exposing it as an authenticated stream', async () => {
    const { port, native, events } = fixture(); await port.start({ id: 'local', name: '本机' }, events);
    const stream = await port.connect('peer'); await expect(stream.read(1)).rejects.toThrow('长度无效');
    native.connect.mockResolvedValueOnce({ ...metadata, peerFingerprint: 'invalid' }); await expect(port.connect('other')).rejects.toThrow('TLS'); await port.stop();
  });
  it('closes a wire awaiting confirmation when the native socket disappears', async () => {
    const { port, events, handlers } = fixture(); await port.start({ id: 'local', name: '本机' }, events);
    const stream = await port.connect('peer'), wire = new TransferWire(stream);
    const waiting = wire.withDeadline(() => new Promise<void>(() => {})); handlers.get('closed')!({ connectionId: 'connection' });
    await expect(waiting).rejects.toThrow('取消'); expect(stream.closed?.aborted).toBe(true); await port.stop();
  });
  it('handles cancellation while addListener is still resolving without starting an orphan listener', async () => {
    const { port, native, events, handlers } = fixture();
    let finish: ((handle: { remove(): Promise<void> }) => void) | undefined;
    native.addListener.mockImplementationOnce(async () => new Promise((resolve) => { finish = resolve; }));
    const starting = port.start({ id: 'local', name: '本机' }, events); await port.stop();
    const remove = vi.fn(async () => {}); finish!({ remove }); await expect(starting).rejects.toThrow('关闭');
    expect(remove).toHaveBeenCalledOnce(); expect(handlers.size).toBe(0); expect(native.start).not.toHaveBeenCalled();
  });
  it('uses a receiver-owned path and bounded ranges for archive reads and fsynced append', async () => {
    const { port, native } = fixture(), file = port.file(id, true);
    expect(file.path).toBe(`transfer/${id}.incoming`); expect(await file.hash()).toBe('c'.repeat(64)); expect(await file.availableSpace()).toBe(1024);
    expect([...await file.readAt(1048576, 3)]).toEqual([0, 1, 255]); await file.appendDurable(new Uint8Array([0, 1, 255]));
    expect(native.file).toHaveBeenLastCalledWith({ action: 'append', path: file.path, data: 'AAH/' });
    expect(() => port.file('../../escape', true)).toThrow('身份'); await expect(file.readAt(0, 1048577)).rejects.toThrow('范围');
  });
  it('saves and restores the resume token only in the private checkpoint backend', async () => {
    const { port, native } = fixture(), checkpoint = { sessionId: id, token: 'c'.repeat(64), createdAt: 1 };
    await port.saveCheckpoint(checkpoint, true); expect(native.checkpoint).toHaveBeenCalledWith({ direction: 'incoming', value: JSON.stringify(checkpoint) });
    native.checkpoint.mockResolvedValueOnce({ value: JSON.stringify(checkpoint) }); expect(await port.loadCheckpoint(true)).toEqual(checkpoint);
    native.checkpoint.mockResolvedValueOnce({ value: '[]' }); await expect(port.loadCheckpoint(true)).rejects.toThrow('损坏');
  });
});
