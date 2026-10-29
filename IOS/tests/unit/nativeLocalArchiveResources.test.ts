import { describe, expect, it, vi } from 'vitest';
import { NativeLocalArchiveResources } from '@platform/ios-native/localArchiveResources';
import type { PortableResourceDescriptor } from '@platform/ios-native/portableArchivePort';
function setup() {
  const resource = vi.fn(async (path: string): Promise<PortableResourceDescriptor> => path === 'missing' ? { kind: 'missing', files: [] } : path === 'book' ? { kind: 'directory', path: 'book', files: [{ path: 'book/page.jpg', size: 2, sha256: 'a'.repeat(64) }] } : { kind: 'file', path: 'book/page.jpg', files: [{ path: 'book/page.jpg', size: 2, sha256: 'a'.repeat(64) }] });
  return { resource, catalog: new NativeLocalArchiveResources({ resource }) };
}
describe('native archive resource hash/export catalog', () => {
  it('deduplicates an original directory and inline copies while preserving only native-relative source paths', async () => {
    const { catalog, resource } = setup();
    expect(await catalog.exportPath('book')).toBe('@FILES@/book');
    expect(await catalog.exportBody('文[IMG:file:///device/book/page.jpg]后', 'NOVEL')).toBe('文[IMG:@FILES@/book/page.jpg]后');
    expect(await catalog.exportBody('file:///device/book/page.jpg', 'COMIC')).toBe('@FILES@/book/page.jpg');
    expect(catalog.resources()).toEqual([{ path: 'files/book/page.jpg', sourcePath: 'book/page.jpg' }]); expect(resource).toHaveBeenCalledTimes(2);
  });
  it('does not fetch public URLs or include unavailable local files', async () => {
    const { catalog, resource } = setup();
    expect(await catalog.exportBody('[IMG:https://example.org/p.png][IMG:missing]', 'NOVEL')).toBe('[IMG:https://example.org/p.png]');
    expect(resource).toHaveBeenCalledWith('missing'); expect(resource).toHaveBeenCalledOnce(); expect(catalog.resources()).toEqual([]); expect(catalog.warnings).toHaveLength(1);
  });
  it('uses native streamed hashes for original files and excludes directories from original-file matching', async () => {
    const { catalog } = setup();
    expect(await catalog.original({ filePath: 'page.jpg' })).toBe(`file:${'a'.repeat(64)}`);
    expect(await catalog.original({ filePath: 'book' })).toBeNull();
    expect(await catalog.directoryIdentity({ filePath: 'book', contentType: 'COMIC', totalChapters: 1 })).toMatch(/^body:[a-f0-9]{64}$/);
  });
  it('rejects a resource changed between overlapping native descriptor reads', async () => {
    const { catalog, resource } = setup(); await catalog.exportPath('book');
    resource.mockResolvedValueOnce({ kind: 'file', path: 'book/page.jpg', files: [{ path: 'book/page.jpg', size: 2, sha256: 'b'.repeat(64) }] });
    await expect(catalog.exportPath('page.jpg')).rejects.toThrow('发生变化');
  });
});
