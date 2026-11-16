import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { writeSourceNovelEpub, type GeneratedNovelSource } from '@core/download/sourceNovelEpub';
import { createComicChapter } from '@core/source/comicChapter';
import { createSearchBook } from '@core/source/searchBook';
import { MemoryFileSystem } from '@platform/web-mock/memoryFileSystem';

describe('guest novel chapter checkpoints', () => {
  it('resumes a cancelled EPUB from the verified chapter and illustration on disk', async () => {
    const fs = new MemoryFileSystem(), signal = new AbortController(), calls: string[] = [], imageCalls: string[] = [];
    const imageUrl = 'https://fixture.test/chapter-image.png', downloadUrl = 'https://fixture.test/novel#ciallo-public-epub-v1';
    const target = 'downloads/fixture.tmp', progress: number[] = [];
    const toc = [createComicChapter({ id: 'https://fixture.test/1', title: '第一章' }), createComicChapter({ id: 'https://fixture.test/2', title: '第二章' })];
    const book = createSearchBook({ id: 'novel', sourceId: 'fixture', title: '断点验收', author: '作者' });
    const source = {
      id: 'fixture', getEpubBookId: () => book.id,
      getDetail: async () => ({ kind: 'success', data: book }),
      getChapters: async () => ({ kind: 'success', data: toc }),
      getNovelParts: async (id: string) => {
        calls.push(id);
        return id === toc[0]!.id ? [{ kind: 'text', value: '正文第一章' }, { kind: 'image', url: imageUrl }]
          : [{ kind: 'text', value: '正文第二章' }];
      },
    } as unknown as GeneratedNovelSource;
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nm8QAAAAASUVORK5CYII=', 'base64'));
    const http = { request: async ({ url }: { url: string }) => {
      imageCalls.push(url); return { status: 200, headers: {}, body: png, url };
    } };
    await expect(writeSourceNovelEpub(source, downloadUrl, target, { fs, http, signal: signal.signal, delayMs: 0,
      async progress(done) { if (done === 1) signal.abort(); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await fs.exists(target)).toBe(false);
    await writeSourceNovelEpub(source, downloadUrl, target, { fs, http, delayMs: 0, async progress(done) { progress.push(done); } });
    expect(calls).toEqual(toc.map((chapter) => chapter.id));
    expect(imageCalls).toEqual([imageUrl]);
    expect(progress).toEqual([1, 1, 2]);
    const files = unzipSync(await fs.readFile(target)), utf8 = new TextDecoder();
    expect(utf8.decode(files['OEBPS/chapter0.xhtml'])).toContain('正文第一章');
    expect(utf8.decode(files['OEBPS/chapter1.xhtml'])).toContain('正文第二章');
    expect(files['OEBPS/Images/0.png']).toEqual(png);
  });
});
