import { describe, expect, it, vi } from 'vitest';
import { FanqieSource } from '@core/source/impl/fanqieSource';
import { AutoNovelSource } from '@core/source/impl/autoNovelSource';
import { Wenku8LibrarySource } from '@core/source/impl/wenku8LibrarySource';
import { wenkuHeatGrade } from '@core/source/impl/wenku8Discovery';
import { discoverQuery } from '@core/discover/models';
import type { HttpClient } from '@platform/interfaces';
import { createWebMockPlatform } from '@platform/web-mock';

const client = (response: (url: URL) => object | string): HttpClient => ({ request: vi.fn(async (request) => {
  expect(request.headers?.['Cookie']).toBeUndefined();
  const data = response(new URL(request.url)); return { status: 200, url: request.url, headers: {}, body: new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data)) };
}) });
const bookId = '7600000000000000001', chapterId = '7600000000000000002';
const directory = () => ({ allItemIds: [chapterId], chapterListWithVolume: [[{ itemId: chapterId, title: '第一章', volume_name: '正文', needPay: 0, isChapterLock: true, isPaidPublication: false, isPaidStory: false }]] });

describe('current native novel discovery APIs', () => {
  it('Fanqie keeps 19-digit identities, uses independent public indexes and reads complete Unicode', async () => {
    const http = client((url) => url.host === 'novel.snssdk.com' ? { code: 0, data: { ret_data: [{ book_id: bookId, genre: '0', title: '一本新书', author: '作者' }] } }
      : url.host === 'www.shuhuangdian.com' ? { code: 200, data: { books: [{ id: 'qd123', bookId: '123', site: '起点', bookTitle: '其他平台' }] } }
        : url.pathname.includes('directory') ? { data: directory() } : url.searchParams.get('action') === 'detail' ? { code: 0, data: { book_infos: [{ book_id: bookId, book_name: '一本新书', author: '作者' }] } }
          : { code: 0, content: '<p>中文<span>内联</span>正文。</p><p>第二段😀。</p>' });
    const source = new FanqieSource({ client: http }); const search = await source.search('一本新书'); expect(search.kind).toBe('success');
    if (search.kind === 'success') expect(search.data.map((book) => book.id)).toEqual([bookId]);
    const detail = await source.getDetail(bookId); expect(detail.kind).toBe('success'); if (detail.kind === 'success') expect(detail.data.novelInfo?.chapterCount).toBe(1);
    const text = await source.getChapterText(`https://fanqienovel.com/reader/${chapterId}`); expect(text).toMatchObject({ kind: 'success', data: '中文内联正文。\n\n第二段😀。' });
    expect(await source.getShareUrl(bookId)).toBe(`https://fanqienovel.com/page/${bookId}`);
  });
  it('Fanqie rejects paid, duplicate and incomplete directories and failure-message paragraphs', () => {
    const source = new FanqieSource({ client: client(() => ({})) });
    expect(source.parseChapters(directory())).toHaveLength(1);
    const paid = directory(); paid.chapterListWithVolume[0]![0]!.needPay = 1; expect(() => source.parseChapters(paid)).toThrow('付费');
    expect(() => source.parseChapters({ ...directory(), allItemIds: [chapterId, chapterId] })).toThrow('不完整');
    for (const content of ['', '<p>内容加载失败</p>', '<p>中文\uE012</p>', '<p>请登录后阅读</p>', '<p>中文\uFFFD</p>']) expect(() => source.parseParts({ code: 0, content })).toThrow();
  });
  it('Fanqie derives categories from data and paginates public Unicode top lists', async () => {
    const source = new FanqieSource({ client: client((url) => url.pathname === '/rank/1_1' ? '<script>window.__INITIAL_STATE__={"rank":{"rankCategoryTypeList":{"male":[{"id":"1","name":"玄幻"}],"female":[]}}};window.untrusted=1;</script>'
      : { book_list: [{ book_id: bookId, book_name: '榜单作品', author: '作者', category: '玄幻', rank_score: '原站分数' }] }) });
    const page = await source.discover(discoverQuery({ dimension: 'RANKING', range: '热门', categoryId: '1:1' })); expect(page.kind).toBe('success');
    if (page.kind === 'success') { expect(page.data.entries[0]?.book.id).toBe(bookId); expect(page.data.entries[0]?.rank).toBe(1); expect(page.data.catalog?.categories[0]?.label).toBe('玄幻'); }
    expect(Reflect.get(globalThis, 'untrusted')).toBeUndefined();
  });
  it('Novelia uses public daily ranks and never invents a guest update list', async () => {
    const http = client(() => ({ items: [{ providerId: 'syosetu', novelId: 'n123', titleZh: '日榜小说', authors: [{ name: '作者' }], updateAt: 1_700_000_000 }], pageNumber: 2 }));
    const source = new AutoNovelSource({ client: http });
    const unavailable = await source.discover(discoverQuery({ feedId: 'native' })); expect(unavailable).toMatchObject({ kind: 'success', data: { supported: false } }); expect(http.request).not.toHaveBeenCalled();
    const page = await source.discover(discoverQuery({ dimension: 'RANKING', range: '完结' })); expect(page.kind).toBe('success');
    if (page.kind === 'success') { expect(page.data.entries[0]?.book.novelInfo?.status).toBe('已完结'); expect(page.data.hasMore).toBe(true); }
    expect(vi.mocked(http.request).mock.calls[0]?.[0].url).toContain('/api/novel/rank/syosetu'); expect(await source.getShareUrl('syosetu/n123')).toContain('/novel/syosetu/n123');
  });
  it('Wenku sorts a complete metadata index locally and reuses the owned disk cache', async () => {
    const http = client((url) => url.pathname === '/api/categories' ? { tags: [{ name: '奇幻 校园' }] } : { pages: 1, total: 2, items: [
      { id: 1, title: '热度较高', author: '甲', heat: 'SSS级：E', updatedAt: '2026-01-01', tags: ['奇幻'], status: 'completed' },
      { id: 2, title: '近期更新', author: '乙', heat: 'A级：SS', updatedAt: '2026-10-28', tags: ['校园'], status: 'ongoing' },
    ] });
    const fs = createWebMockPlatform().fs, source = new Wenku8LibrarySource({ client: http, fs });
    const update = await source.discover(discoverQuery({ feedId: 'updates' })); expect(update.kind).toBe('success'); if (update.kind === 'success') expect(update.data.entries[0]?.book.id).toBe('2');
    const ranked = await source.discover(discoverQuery({ dimension: 'RANKING', range: '热门' })); if (ranked.kind === 'success') { expect(ranked.data.entries[0]?.book.id).toBe('1'); expect(ranked.data.entries[0]?.rank).toBeNull(); }
    const restored = new Wenku8LibrarySource({ client: http, fs }); await restored.discover(discoverQuery({ dimension: 'RANKING', range: '飙升' }));
    expect(vi.mocked(http.request).mock.calls.filter(([request]) => new URL(request.url).pathname === '/api/books')).toHaveLength(1);
    expect(wenkuHeatGrade('SSS级：SS', false)).toBe(7); expect(wenkuHeatGrade('SSS级：SS', true)).toBe(6);
  });
});
