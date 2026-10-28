import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { encode } from 'fast-png';
import { XbookcnParser, XbookcnSource, parseXbookChapter, requireXbookId } from '@core/source/impl/xbookcnSource';
import { PublicNovelSource } from '@core/source/impl/publicNovelSource';
import { extractNovelParts } from '@core/source/impl/novelParts';
import { parseHtmlDocument } from '@core/source/impl/jsoup';
import { writeSourceNovelEpub, type GeneratedNovelSource } from '@core/download/sourceNovelEpub';
import { discoverQuery } from '@core/discover/models';
import { createSearchBook } from '@core/source/searchBook';
import { createComicChapter } from '@core/source/comicChapter';
import { SourceResult } from '@core/source/sourceResult';
import { createWebMockPlatform } from '@platform/web-mock';
import type { HttpClient } from '@platform/interfaces';

const snapshot = (name: string): string => readFileSync(resolve('tests/fixtures/xbookcn', `${name}.html`), 'utf8');
const id = 'b3068315c735';
const http = (body: (url: string) => string | object): HttpClient => ({ request: vi.fn(async (request) => { const data = body(request.url); return { status: 200, url: request.url, headers: {}, body: new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data)) }; }) });

describe('current Android public novel ports', () => {
  it('matches the real Android Xbook search, detail and chapter snapshots', () => {
    const books = XbookcnParser.books(snapshot('search'));
    expect(books).toHaveLength(20); expect(books[0]).toMatchObject({ id, title: '总裁X总裁', author: '顾盼若浅', description: '她，顾倾，霸道总裁。' });
    const detail = XbookcnParser.detail(snapshot('detail'), id);
    expect(detail.novelInfo).toMatchObject({ chapterCount: 4, wordCount: '23.2 万字', updatedAt: '2019-06-29', category: '都市生活', tags: expect.arrayContaining(['经商']) });
    expect(XbookcnParser.chapters(snapshot('detail'), id).map((chapter) => chapter.title)).toEqual(['001', '010', '029', '048']);
    const body = XbookcnParser.chapterText(snapshot('chapter'));
    expect(body.split('\n\n')).toHaveLength(81); expect(body.length).toBeGreaterThan(3000); expect(body.startsWith('陆思羡')).toBe(true);
  });
  it('rejects injected identifiers and incomplete, empty or paid chapters', () => {
    expect(() => requireXbookId('../etc/passwd')).toThrow();
    expect(parseXbookChapter(`${id}/12`)).toEqual({ bookId: id, number: 12 });
    expect(() => parseXbookChapter(`${id}/0`)).toThrow();
    expect(() => XbookcnParser.chapterText('<article></article>')).toThrow();
    expect(() => XbookcnParser.chapterText('<article><p>购买本章后可阅读</p></article>')).toThrow();
  });
  it('keeps inline Unicode, paragraphs and illustrations in their source order', () => {
    const root = parseHtmlDocument('<article><p>中文<span>内联𠮷</span><br>下一行</p><script>广告</script><img data-src="/p.png"><p>后文</p></article>').selectFirst('article')!;
    expect(extractNovelParts(root, 'https://example.org/book/1')).toEqual([{ kind: 'text', value: '中文内联𠮷' }, { kind: 'text', value: '下一行' }, { kind: 'image', url: 'https://example.org/p.png' }, { kind: 'text', value: '后文' }]);
    expect(() => extractNovelParts(parseHtmlDocument('<div><p>乱码\uE001</p></div>').selectFirst('div')!, 'https://example.org')).toThrow('乱码');
  });
  it('discovers real Xbook cards and follows only its own catalogue pages', async () => {
    const client = http((url) => url.includes('/novels') ? '<nav><a href="/novels?cat=都市">都市分类</a><a href="https://evil.test/novels?tag=evil">坏分类</a></nav>' + snapshot('search') : snapshot('search'));
    const source = new XbookcnSource({ client });
    const catalog = await source.discoverCatalog(); expect(catalog.kind).toBe('success');
    if (catalog.kind === 'success') { expect(catalog.data.categories).toEqual([{ id: 'https://xbookcn.app/novels?cat=%E9%83%BD%E5%B8%82', label: '都市', group: '题材' }]); }
    const page = await source.discover(discoverQuery({ feedId: 'native' }));
    expect(page.kind).toBe('success'); if (page.kind === 'success') { expect(page.data.entries.length).toBeGreaterThan(0); expect(page.data.entries[0]?.book.id).toBe(id); }
    const invalid = await source.discover(discoverQuery({ cursor: 'https://evil.test/next', page: 2 }));
    expect(client.request).not.toHaveBeenCalledWith(expect.objectContaining({ url: 'https://evil.test/next' }));
    expect(invalid.kind).toBe('success');
  });
  it('rejects locked SF and non-free or misattributed Huaben chapters', async () => {
    const sf = new PublicNovelSource('sfacg', { client: http(() => '<div class="mulu_list"><a href="/c/12/"><i class="icon-lock2"></i>锁定</a></div>') });
    const locked = await sf.getChapters('1'); expect(locked.kind).toBe('error'); if (locked.kind === 'error') expect(locked.exception.message).toContain('VIP');
    const huaben = new PublicNovelSource('ihuaben', { client: http(() => ({ code: 0, chapters: [{ bookId: '1', chapterId: 12, title: '章节', chapterType: 'VIP', status: 'PUBLISHED' }] })) });
    const paid = await huaben.getChapters('1'); expect(paid.kind).toBe('error');
  });
});

describe('complete streamed source EPUB', () => {
  const chapter = createComicChapter({ id: 'chapter', title: '第一章 & 试读' });
  function fixture() {
    const fs = createWebMockPlatform().fs, image = encode({ width: 2, height: 2, channels: 4, depth: 8, data: new Uint8Array(16).fill(255) });
    const client: HttpClient = { request: vi.fn(async (request) => ({ status: 200, url: request.url, headers: {}, body: image })) };
    const source = { id: 'generated', getEpubBookId: () => 'work', getDetail: async () => SourceResult.Success(createSearchBook({ id: 'work', sourceId: 'generated', title: '完整作品', author: '作者' })), getChapters: vi.fn(async () => SourceResult.Success([chapter])), getNovelParts: vi.fn(async () => [{ kind: 'text' as const, value: '完整正文𠮷 & 保留' }, { kind: 'image' as const, url: 'https://images.example/page.png' }]) } as unknown as GeneratedNovelSource;
    return { fs, client, source };
  }
  it('writes a readable EPUB with exact images and source hashes after rechecking the TOC', async () => {
    const { fs, client, source } = fixture(), progress = vi.fn(async () => {});
    await writeSourceNovelEpub(source, 'https://example.org/work#marker', 'test.epub', { fs, http: client, progress, delayMs: 0 });
    const zip = unzipSync(await fs.readFile('test.epub')), text = (name: string) => new TextDecoder().decode(zip[name]);
    expect(text('mimetype')).toBe('application/epub+zip'); expect(text('OEBPS/chapter0.xhtml')).toContain('完整正文𠮷 &amp; 保留');
    expect(text('OEBPS/chapter0.xhtml')).toContain('Images/0.png');
    expect(JSON.parse(text('META-INF/ciallo-source.json'))).toMatchObject({ complete: true, chapters: [{ paragraphs: 1, images: 1, textSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
    expect(source.getChapters).toHaveBeenCalledTimes(2); expect(progress).toHaveBeenCalledWith(1, 1);
  });
  it('deletes partial output when a chapter, illustration or final TOC fails', async () => {
    const { fs, client, source } = fixture();
    vi.mocked(source.getChapters).mockResolvedValueOnce(SourceResult.Success([chapter])).mockResolvedValueOnce(SourceResult.Success([{ ...chapter, title: '目录已经变化' }]));
    await expect(writeSourceNovelEpub(source, 'https://example.org', 'bad.epub', { fs, http: client, progress: async () => {}, delayMs: 0 })).rejects.toThrow('目录变化');
    expect(await fs.exists('bad.epub')).toBe(false);
    vi.mocked(source.getNovelParts).mockRejectedValueOnce(new Error('缺章'));
    await expect(writeSourceNovelEpub(source, 'https://example.org', 'missing.epub', { fs, http: client, progress: async () => {}, delayMs: 0 })).rejects.toThrow('缺章');
    expect(await fs.exists('missing.epub')).toBe(false);
  });
  it('stops a pending response on pause without later recreating the EPUB', async () => {
    const { fs, client, source } = fixture(), controller = new AbortController(); let finish!: (parts: []) => void;
    vi.mocked(source.getNovelParts).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = writeSourceNovelEpub(source, 'https://example.org', 'paused.epub', { fs, http: client, progress: async () => {}, signal: controller.signal, delayMs: 0 });
    await vi.waitFor(() => expect(finish).toBeDefined()); controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); finish([]); await Promise.resolve();
    expect(await fs.exists('paused.epub')).toBe(false);
  });
});
