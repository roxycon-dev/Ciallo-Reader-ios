import { describe, expect, it, vi } from 'vitest';
import { NativeByteHttpTransport, type ByteHttpNative } from '@platform/ios-native/nativeByteHttpTransport';
import { bytesToBase64, base64ToBytes, CapacitorHttpClient } from '@platform/ios-native/capacitorHttpClient';

function fixture(bytes = new Uint8Array([0, 255, 128, 0xd6, 0xd0, 0xce, 0xc4])) {
  const native: ByteHttpNative = {
    begin: vi.fn(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, url: 'https://source.test/result', size: bytes.length })),
    read: vi.fn(async ({ offset, length }) => ({ data: bytesToBase64(bytes.slice(offset, offset + length)) })), cancel: vi.fn(async () => {}), release: vi.fn(async () => {}),
  };
  return { native, transport: new NativeByteHttpTransport(native) };
}
describe('byte-preserving native HTTP adapter', () => {
  it('preserves JSON whitespace, repeated keys and non-UTF8 bytes instead of interpreting content types', async () => {
    const json = new TextEncoder().encode(' { "a":1, "a":2 }\r\n'), first = fixture(json);
    expect(Array.from((await new CapacitorHttpClient({ transport: first.transport }).request({ url: 'https://source.test/a' })).body)).toEqual(Array.from(json));
    const binary = fixture(); expect((await binary.transport.request({ url: 'https://source.test/b', method: 'GET' })).body).toEqual(new Uint8Array([0, 255, 128, 0xd6, 0xd0, 0xce, 0xc4]));
    expect(first.native.release).toHaveBeenCalledOnce(); expect(binary.native.release).toHaveBeenCalledOnce();
  });
  it('crosses the bridge in bounded chunks while preserving byte order and exact request body', async () => {
    const bytes = Uint8Array.from({ length: 1024 * 1024 + 7 }, (_, index) => index % 251), { native, transport } = fixture(bytes), body = new Uint8Array([255, 0, 128]);
    const response = await new CapacitorHttpClient({ transport }).request({ url: 'https://source.test/a', method: 'POST', body, redirect: 'error' });
    expect(response.body).toEqual(bytes); expect(native.read).toHaveBeenCalledTimes(3);
    for (const [{ length }] of vi.mocked(native.read).mock.calls) expect(length).toBeLessThanOrEqual(512 * 1024);
    expect(base64ToBytes(vi.mocked(native.begin).mock.calls[0]![0].body!)).toEqual(body); expect(vi.mocked(native.begin).mock.calls[0]![0].redirect).toBe('error');
  });
  it('cancels native work at the actual call deadline and releases its spool', async () => {
    const { native, transport } = fixture(); vi.mocked(native.begin).mockImplementationOnce(() => new Promise(() => {}));
    await expect(transport.request({ url: 'https://source.test/a', method: 'GET', readTimeout: 10 })).rejects.toThrow('HTTP 请求超时（10ms）'); expect(native.cancel).toHaveBeenCalledOnce(); expect(native.release).toHaveBeenCalledOnce();
  });
  it('honors caller cancellation during bridge reads and does not issue more reads', async () => {
    const { native, transport } = fixture(new Uint8Array(1024 * 1024)), controller = new AbortController();
    vi.mocked(native.read).mockImplementationOnce(async () => { controller.abort(); return { data: bytesToBase64(new Uint8Array(512 * 1024)) }; });
    await expect(transport.request({ url: 'https://source.test/a', method: 'GET', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.read).toHaveBeenCalledOnce(); expect(native.cancel).toHaveBeenCalledOnce(); expect(native.release).toHaveBeenCalledOnce();
  });
  it('does not start an already cancelled request', async () => {
    const { native, transport } = fixture(), controller = new AbortController(); controller.abort();
    await expect(transport.request({ url: 'https://source.test/a', method: 'GET', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(native.begin).not.toHaveBeenCalled();
  });
  it('still delivers its deadline when a broken native cleanup promise does not settle', async () => {
    const { native, transport } = fixture(); vi.mocked(native.begin).mockImplementationOnce(() => new Promise(() => {})); vi.mocked(native.release).mockImplementationOnce(() => new Promise(() => {}));
    await expect(transport.request({ url: 'https://source.test/a', method: 'GET', readTimeout: 10 })).rejects.toThrow('HTTP 请求超时（10ms）'); expect(native.cancel).toHaveBeenCalledOnce(); expect(native.release).toHaveBeenCalledOnce();
  });
  it('rejects invalid native lengths and incomplete chunks, releasing each response', async () => {
    const { native, transport } = fixture(); vi.mocked(native.begin).mockResolvedValueOnce({ status: 200, headers: {}, url: 'https://source.test', size: 512 * 1024 * 1024 + 1 });
    await expect(transport.request({ url: 'https://source.test', method: 'GET' })).rejects.toThrow('信息无效');
    vi.mocked(native.read).mockResolvedValueOnce({ data: '' }); await expect(transport.request({ url: 'https://source.test', method: 'GET' })).rejects.toThrow('分块不完整'); expect(native.release).toHaveBeenCalledTimes(2);
  });
});
