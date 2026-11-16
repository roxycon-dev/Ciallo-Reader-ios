import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { encode } from 'fast-png';
import { MemoryFileSystem } from '@platform/web-mock';
import { createFileInlineImageDecoder } from '@platform/readerImageResolver';

afterEach(() => vi.unstubAllGlobals());
describe('private illustration URLs', () => {
  it('opens legacy zero-copy EPUB image tokens and revokes their object URLs', async () => {
    const create = vi.fn((_blob: Blob) => 'blob:epub-illustration'); const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const fs = new MemoryFileSystem();
    const png = encode({ width: 2, height: 2, channels: 4, depth: 8, data: new Uint8Array(16).fill(255) });
    await fs.writeFile('imports/book.epub', zipSync({ 'OPS/Art.png': png }));
    const decoder = createFileInlineImageDecoder(fs);
    expect(await decoder.resolve('epzip:file://imports/book.epub!OPS/Art.png')).toBe('blob:epub-illustration');
    expect(create.mock.calls[0]?.[0]).toMatchObject({ type: 'image/png', size: png.length });
    decoder.dispose(); expect(revoke).toHaveBeenCalledWith('blob:epub-illustration');
  });
  it('rejects traversal and missing entries instead of issuing a broken relative URL', async () => {
    const decoder = createFileInlineImageDecoder(new MemoryFileSystem());
    expect(await decoder.resolve('epzip:file://book.epub!../outside.png')).toBeNull();
    expect(await decoder.resolve('epzip:file://missing.epub!OPS/art.png')).toBeNull();
    decoder.dispose();
  });
});
