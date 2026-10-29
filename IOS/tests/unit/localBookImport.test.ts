import { gzipSync, strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importLocalBook, createNovelBookImporter } from '@platform/localBookImport';
import { InMemorySqliteDatabase, MemoryFileSystem } from '@platform/web-mock';
import { openAppDatabase } from '@core/db/openDatabase';
import { BookRepository } from '@core/library/bookRepository';
import { seedAniListTitles } from '@core/data/anilistSeeding';
import { createSearchBook } from '@core/source/searchBook';
import { encode } from 'fast-png';

async function fixture() {
  const db = new InMemorySqliteDatabase();
  await openAppDatabase({ db });
  return { db, repo: new BookRepository(db), fs: new MemoryFileSystem() };
}

describe('actual local book import', () => {
  it('keeps distinct EPUB illustrations across chapters and persists the declared cover', async () => {
    const { repo, fs } = await fixture();
    const first = encode({ width: 2, height: 2, data: new Uint8Array(16).fill(120), channels: 4, depth: 8 });
    const second = encode({ width: 2, height: 2, data: new Uint8Array(16).fill(230), channels: 4, depth: 8 });
    const bytes = zipSync({
      'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'),
      'OPS/book.opf': strToU8('<package><metadata><dc:title>插图验收</dc:title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="a.png" media-type="image/png" properties="cover-image"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'),
      'OPS/one.xhtml': strToU8('<html><body><h1>第一章</h1><p>图片一</p><img src="a.png"/></body></html>'),
      'OPS/two.xhtml': strToU8('<html><body><h1>第二章</h1><p>图片二</p><img src="b.png"/></body></html>'),
      'OPS/a.png': first, 'OPS/b.png': second,
    });
    const book = await importLocalBook({ name: 'illustrated.epub', mime: '', bytes }, repo, fs);
    const chapters = await repo.listChapters(book.id!);
    const paths = chapters.map((chapter) => /\[IMG:([^|]+)\|/.exec(chapter.content)?.[1]);
    expect(paths[0]).toBeTruthy(); expect(paths[0]).not.toBe(paths[1]);
    expect(await fs.readFile(paths[0]!)).toEqual(first); expect(await fs.readFile(paths[1]!)).toEqual(second);
    expect(await fs.readFile(book.coverUri!)).toEqual(first);
  });
  it('imports TXT chapters and original content rather than a placeholder book', async () => {
    const { repo, fs } = await fixture();
    const book = await importLocalBook(
      {
        name: '接力验收.txt',
        mime: 'text/plain',
        bytes: strToU8('第一章 相遇\n真正的第一章正文。\n第二章 出发\n真正的第二章正文。'),
      },
      repo,
      fs,
    );
    expect(book.title).toBe('接力验收');
    const chapters = await repo.listChapters(book.id!);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.content).toContain('真正的第一章正文');
    expect(chapters[1]?.content).toContain('真正的第二章正文');
    expect(await fs.exists(book.filePath!)).toBe(true);
  });

  it('imports a real EPUB spine with its title and text', async () => {
    const { repo, fs } = await fixture();
    const bytes = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
      ),
      'OEBPS/book.opf': strToU8(
        '<package><metadata><dc:title>EPUB 验收</dc:title><dc:creator>样例作者</dc:creator></metadata><manifest><item id="ch1" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>',
      ),
      'OEBPS/one.xhtml': strToU8(
        '<html><body><h1>开始</h1><p>这是 EPUB 文件内的真实正文。</p></body></html>',
      ),
    });
    const book = await importLocalBook(
      { name: 'sample.epub', mime: 'application/epub+zip', bytes },
      repo,
      fs,
    );
    expect(book.title).toBe('EPUB 验收');
    expect((await repo.listChapters(book.id!))[0]?.content).toContain('真实正文');
  });

  it('does not add empty or corrupt files to the shelf', async () => {
    const { repo, fs } = await fixture();
    await expect(
      importLocalBook({ name: 'empty.txt', mime: 'text/plain', bytes: strToU8('  ') }, repo, fs),
    ).rejects.toThrow('正文');
    await expect(
      importLocalBook({ name: 'bad.epub', mime: '', bytes: strToU8('broken zip') }, repo, fs),
    ).rejects.toThrow();
    expect(await repo.getAllBooks()).toEqual([]);
  });

  it('a completed download actually creates a readable shelf entry linked to its source', async () => {
    const { repo, fs } = await fixture();
    await fs.writeFile('downloads/book.txt', strToU8('第一章\n下载后的正文'));
    const importer = createNovelBookImporter(repo, fs, async () => {});
    await importer.importBookFromUri('downloads/book.txt', '下载样书.txt', 'source', 'remote-id');
    const book = await repo.getBookBySourceResource('source', 'remote-id');
    expect(book?.title).toBe('下载样书');
    expect((await repo.listChapters(book!.id!))[0]?.content).toContain('下载后的正文');
  });

  it('allows import while background title seeding is running without nested transactions', async () => {
    const { repo, fs, db } = await fixture();
    await Promise.all([
      seedAniListTitles(db, gzipSync(strToU8('1\tROMAJI\tTest Title\n'))),
      importLocalBook(
        { name: '并发导入.txt', mime: 'text/plain', bytes: strToU8('正文仍然完整。') },
        repo,
        fs,
      ),
    ]);
    expect(await repo.getBooksCount()).toBe(1);
    expect(
      (await db.query<{ count: number }>('SELECT COUNT(*) FROM anilist_titles'))[0]?.count,
    ).toBe(1);
  });

  it('merges an updated download into the same book while remapping progress and annotations', async () => {
    const { repo, fs } = await fixture();
    const importer = createNovelBookImporter(repo, fs, async () => {});
    const snapshot = createSearchBook({ id: 'remote', sourceId: 'novelia', title: '更新验收', author: '作者', format: 'txt' });
    await fs.writeFile('downloads/old.txt', strToU8('第一章 开始\n原有正文\n第二章 途中\n途中原有正文'));
    await importer.importDownloadedNovel('downloads/old.txt', snapshot, false);
    const old = (await repo.getBookBySourceResource('novelia', 'remote'))!;
    await repo.updateBook({ ...old, currentChapterIndex: 1, scrollOffset: 4, isFinished: 1 });
    await repo.insertBookmark({ bookId: old.id!, chapterIndex: 1, scrollOffset: 4, title: '途中', snippet: '原有正文', createdTime: 1 });
    await repo.insertHighlight({ bookId: old.id!, chapterIndex: 1, selectedText: '原有正文', note: '我的批注', colorHex: '#ff0', createdTime: 1 });
    await fs.writeFile('downloads/new.txt', strToU8('序言\n新前言\n第一章 开始\n原有正文\n第二章 途中\n途中原有正文\n第三章 后续\n新增正文'));
    await importer.importDownloadedNovel('downloads/new.txt', snapshot, true);
    const updated = (await repo.getBookBySourceResource('novelia', 'remote'))!;
    expect(updated.id).toBe(old.id);
    expect((await repo.listChapters(updated.id!)).map((chapter) => chapter.title)).toEqual(['前言', '第一章 开始', '第二章 途中', '第三章 后续']);
    expect(updated.currentChapterIndex).toBe(2);
    expect(updated.scrollOffset).toBe(4);
    expect(updated.isFinished).toBe(0);
    expect((await repo.getBookmarksForBook(old.id!))[0]?.chapterIndex).toBe(2);
    const highlights = await repo.getHighlightsForBook(old.id!);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toMatchObject({ chapterIndex: 2, note: '我的批注' });
    expect(await repo.getBooksCount()).toBe(1);
  });

  it('preserves the original book and annotations when a replacement omits an old chapter', async () => {
    const { repo, fs } = await fixture();
    const importer = createNovelBookImporter(repo, fs, async () => {});
    const snapshot = createSearchBook({ id: 'remote', sourceId: 'novelia', title: '更新验收', author: '作者', format: 'txt' });
    await fs.writeFile('old.txt', strToU8('第一章 开始\n正文\n第二章 后续\n原文'));
    await importer.importDownloadedNovel('old.txt', snapshot, false);
    const before = await repo.getBookBySourceResource('novelia', 'remote');
    await fs.writeFile('bad.txt', strToU8('第一章 开始\n不完整更新包'));
    await expect(importer.importDownloadedNovel('bad.txt', snapshot, true)).rejects.toThrow('缺少原有章节');
    expect(await repo.getBookBySourceResource('novelia', 'remote')).toEqual(before);
    expect(await repo.getBooksCount()).toBe(1);
    expect((await repo.listChapters(before!.id!))[1]?.content).toContain('原文');
  });
});
