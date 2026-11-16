import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ArchiveResources } from '@core/transfer/archiveResources';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function resources(root = 'restored_transfer_test/files') {
  const entries = ['imports/book/封面.png', 'imports/book/page.jpg', 'fonts/中文.ttf'].map((path) => ({ path: `files/${path}`, size: 1, sha256: hash(path) }));
  return new ArchiveResources(new Map(entries.map((entry) => [entry.path, entry])), root);
}
describe('archive resource relocation and original file identity', () => {
  it('resolves verified file/dir placeholders and iOS relative files into the promoted root', () => {
    const files = resources();
    expect(files.relocate('file://@FILES@/imports/book/封面.png')).toBe('restored_transfer_test/files/imports/book/封面.png');
    expect(files.relocate('@FILES@/imports/book')).toBe('restored_transfer_test/files/imports/book');
    expect(files.relocate('fonts/中文.ttf')).toBe('restored_transfer_test/files/fonts/中文.ttf');
    expect(files.hash('@FILES@/imports/book/page.jpg')).toBe(hash('imports/book/page.jpg'));
    expect(files.originalIdentity('@FILES@/fonts/中文.ttf')).toBe(`file:${hash('fonts/中文.ttf')}`);
  });
  it('rejects paths to preexisting receiver secrets, traversal, nonexistent resources and absolute sender files', () => {
    for (const path of ['source_configs/private.json', '/sender/book.epub', 'file:///sender/book.epub', '@FILES@/../private.json', '@FILES@/imports/book/../../private', 'imports/book/gone.png', 'files/imports/book/page.jpg', 'content://credentials', '@FILES@\\imports\\book']) expect(resources().relocate(path)).toBe('');
    expect(resources().relocate('https://example.org/cover.png')).toBe('https://example.org/cover.png');
    expect(resources().relocate('https://example.org/private.epub', false)).toBe('');
  });
  it('relocates chapter images and comic paths while removing missing local images', () => {
    const files = resources();
    expect(files.body('文[IMG:@FILES@/imports/book/page.jpg]后[IMG:source_configs/private.json]', 'NOVEL')).toBe('文[IMG:restored_transfer_test/files/imports/book/page.jpg]后');
    expect(files.body(' @FILES@/imports/book/page.jpg ', 'COMIC')).toBe('restored_transfer_test/files/imports/book/page.jpg');
    expect(files.body('https://example.org/page.jpg', 'COMIC')).toBe('https://example.org/page.jpg');
    expect(files.row({ filePath: 'source_configs/private.json', coverUri: '@FILES@/imports/book/封面.png', title: '标题' })).toEqual({ filePath: '', coverUri: 'restored_transfer_test/files/imports/book/封面.png', title: '标题' });
  });
  it('keeps directory identities independent of relocation and excludes sibling files', () => {
    const a = resources(), b = resources('another/root');
    const book = { contentType: 'COMIC', totalChapters: 2 };
    const expected = `body:${hash(`page.jpg${hash('imports/book/page.jpg')}封面.png${hash('imports/book/封面.png')}COMIC`)}`;
    expect(a.originalIdentity('@FILES@/imports/book')).toBeNull();
    expect(a.directoryIdentity('@FILES@/imports/book', book)).toBe(expected); expect(b.directoryIdentity('imports/book', book)).toBe(expected);
    expect(a.originalIdentity('@FILES@/imports/missing')).toBeNull();
  });
});
