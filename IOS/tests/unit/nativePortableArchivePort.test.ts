import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { NativePortableArchivePort, type PortableArchiveNative } from '@platform/ios-native/portableArchivePort';

const stageId = '01234567-89ab-cdef-0123-456789abcdef';
const archive = new Uint8Array(readFileSync(resolve('public/native-fixtures/transfer-deflated.zip')));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const files = unzipSync(archive), text = (name: string) => new TextDecoder().decode(files[name]!);
  const extracted = { stageId, settings: text('settings.json'), manifest: text('manifest.json') as string | null,
    entries: Object.entries(files).map(([path, bytes]) => ({ path, size: bytes.length, sha256: digest(bytes) })) };
  const native = {
    prepare: vi.fn(async () => ({ stageId })), write: vi.fn<PortableArchiveNative['write']>(async () => {}),
    pack: vi.fn<PortableArchiveNative['pack']>(async () => ({ path: `transfer/${stageId}.outgoing`, manifest: text('manifest.json') })),
    extract: vi.fn(async () => extracted),
    rows: vi.fn<PortableArchiveNative['rows']>(async () => ({ lines: [text('database.rows').trimEnd()], cursor: files['database.rows']!.length, done: true })),
    discard: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
  } satisfies PortableArchiveNative;
  return { port: new NativePortableArchivePort(native), native, extracted, files };
}
describe('native portable archive receive pipeline', () => {
  it('accepts the actual JDK-generated Android v2 fixture and exposes a checked preview', async () => {
    const { port, native } = fixture(), inspected = await port.inspect('transfer/input.incoming', digest(archive));
    expect(inspected.preview).toMatchObject({ packageId: stageId, version: 2, counts: {}, containsProtected: false, categories: ['BOOKS'] });
    expect(inspected.manifest?.entries.find((entry) => entry.path === 'files/插图.bin')?.size).toBe(1048613);
    expect(inspected.settings).toEqual({}); expect(native.discard).not.toHaveBeenCalled();
  });
  it('discards the private extraction stage if any hash or unlisted entry differs', async () => {
    for (const unknownFile of [false, true]) {
      const { port, native, extracted } = fixture();
      if (unknownFile) extracted.entries.push({ path: 'files/unlisted', size: 0, sha256: digest(new Uint8Array(0)) });
      else extracted.entries.find((entry) => entry.path === 'files/插图.bin')!.sha256 = 'f'.repeat(64);
      await expect(port.inspect('transfer/input.incoming', digest(archive))).rejects.toThrow(); expect(native.discard).toHaveBeenCalledWith({ stageId });
    }
  });
  it('detects settings changed between native hashing and metadata read', async () => {
    const { port, native, extracted } = fixture(); extracted.settings = '{"novel_reader_prefs":{}}';
    await expect(port.inspect('transfer/input.incoming', digest(archive))).rejects.toThrow('发生变化'); expect(native.discard).toHaveBeenCalledOnce();
  });
  it('uses a verified archive hash as legacy receipt identity and never imports the sender PIN or private keys', async () => {
    const { port, extracted } = fixture(); extracted.manifest = null; extracted.entries = extracted.entries.filter((entry) => entry.path !== 'manifest.json');
    extracted.settings = JSON.stringify({ font_size: { type: 'float', value: 20 }, favorites_protected: { type: 'boolean', value: true }, privacy_pin: { type: 'string', value: '123456' } });
    const bytes = new TextEncoder().encode(extracted.settings), settings = extracted.entries.find((entry) => entry.path === 'settings.json')!; settings.sha256 = digest(bytes); settings.size = bytes.length;
    const inspected = await port.inspect('transfer/legacy.incoming', digest(archive));
    expect(inspected.preview.packageId).toBe(digest(archive)); expect(inspected.preview.containsProtected).toBe(true); expect(inspected.preview.protectedFavorites).toBe(true);
    expect(inspected.settings).toEqual({ novel_reader_prefs: { font_size: { type: 'float', value: 20 } } });
  });
  it('rejects missing parent books before returning a preview or allowing any import write', async () => {
    const { port, native } = fixture();
    native.rows.mockResolvedValueOnce({ lines: ['{"version":2,"schema":13}', JSON.stringify({ table: 'chapters', row: { id: 1, bookId: 99, chapterOrder: 0, title: '缺少书籍', content: '正文', startCharIndex: 0, endCharIndex: 2 } })], cursor: 100, done: true });
    await expect(port.inspect('transfer/input.incoming', digest(archive))).rejects.toThrow('缺失'); expect(native.discard).toHaveBeenCalledOnce(); expect(native.write).not.toHaveBeenCalled();
  });
  it('rejects a stalled row cursor instead of looping indefinitely', async () => {
    const { port, native } = fixture(); native.rows.mockResolvedValueOnce({ lines: [], cursor: 0, done: false });
    await expect(port.inspect('transfer/input.incoming', digest(archive))).rejects.toThrow('没有前进'); expect(native.rows).toHaveBeenCalledOnce();
  });
  it('splits large row writes without dividing UTF-16 surrogate pairs or corrupting UTF-8', async () => {
    const { port, native } = fixture(), text = 'x'.repeat(256 * 1024 - 1) + '📚' + '结尾';
    await port.write(stageId, 'database.rows', text, true);
    expect(native.write).toHaveBeenCalledTimes(2);
    const calls = native.write.mock.calls.map(([call]) => call); expect(calls.map((call) => call.reset)).toEqual([true, false]);
    expect(calls.map((call) => new TextDecoder().decode(new TextEncoder().encode(call.text))).join('')).toBe(text);
  });
});
