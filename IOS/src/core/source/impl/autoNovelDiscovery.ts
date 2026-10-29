import { catalogRanges, discoverCatalog, discoverEntry, discoverPage, type DiscoverQuery } from '@core/discover/models';
import type { SearchBook } from '../searchBook';
import { createNovelInfo } from '../novelInfo';
import { ParseError } from '../sourceException';
import { isJsonObject, optInt, optJsonArray, optLong, optString, type JsonObject } from './jsonSupport';

const syosetu = ['恋爱：异世界', '恋爱：现实世界', '幻想：高幻想', '幻想：低幻想', '文学：纯文学', '文学：人性剧', '文学：历史', '文学：推理', '文学：恐怖', '文学：动作', '文学：喜剧', '科幻：VR游戏', '科幻：宇宙', '科幻：空想科学', '科幻：惊悚', '其他：童话', '其他：诗', '其他：散文', '其他：其他'];
const kakuyomu = ['异世界幻想', '现代幻想', '科幻', '恋爱', '浪漫喜剧', '现代戏剧', '恐怖', '推理', '散文·纪实', '历史·时代·传奇', '创作论·评论', '诗·童话·其他'];
/** The current guest API publishes daily ranks; recommendation/update lists require login. */
export class AutoNovelDiscovery {
  readonly catalog = discoverCatalog({ feeds: [{ id: 'syosetu', label: '成为小说家·综合日榜', kind: 'ranking' }, { id: 'kakuyomu', label: 'Kakuyomu·综合日榜', kind: 'ranking' }],
    categories: [...syosetu.map((label) => ({ id: `syosetu|${label}`, label, group: '成为小说家·流派' })), ...kakuyomu.map((label) => ({ id: `kakuyomu|${label}`, label, group: 'Kakuyomu·流派' }))], declared: true, explicit: true, dated: true, capabilities: { ranking: ['热门', '完结'] } });
  constructor(private readonly home: string, private readonly json: (url: string) => Promise<JsonObject>, private readonly book: (id: string, data: JsonObject) => SearchBook) {}
  async discover(q: DiscoverQuery) {
    const ranking = q.categoryId !== null || ['syosetu', 'kakuyomu'].includes(q.feedId ?? '') || q.feedId === null && q.dimension === 'RANKING';
    if (!ranking) return discoverPage({ supported: false, notice: 'Novelia 已关闭游客列表接口（HTTP 401），推荐与更新需登录；公开日榜仍可查看', catalog: this.catalog });
    if (q.feedId === null && !catalogRanges(this.catalog, q.dimension).includes(q.range)) return discoverPage({ supported: false, catalog: this.catalog });
    const selected = [...new Set([...(q.categoryId ? [q.categoryId] : []), ...q.categoryIds])];
    if (selected.some((id) => !this.catalog.categories.some((c) => c.id === id))) throw new ParseError('轻小说分类已变化，请重新选择');
    const routes = (selected.length ? selected : ['syosetu', 'kakuyomu'].includes(q.feedId ?? '') ? [q.feedId!] : ['syosetu', 'kakuyomu']).filter((route) => !((q.page > 1 || q.range === '完结' && q.feedId === null) && route.startsWith('kakuyomu')));
    const results: Array<{ entries: ReturnType<typeof discoverEntry>[]; more: boolean }> = new Array(routes.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, routes.length) }, async () => { while (next < routes.length) {
      const slot = next++, route = routes[slot]!, [provider, genre = ''] = route.split('|'), url = new URL(`/api/novel/rank/${provider}`, this.home);
      if (provider === 'syosetu') { url.searchParams.set('type', genre ? '流派' : '综合'); url.searchParams.set('page', String(q.page)); }
      if (genre) url.searchParams.set('genre', genre); else if (provider === 'kakuyomu') url.searchParams.set('genre', '综合');
      url.searchParams.set('range', '每日'); url.searchParams.set('status', q.range === '完结' && provider === 'syosetu' ? '完结' : '全部');
      const data = await this.json(url.toString()), items = optJsonArray(data, 'items'); if (!items) throw new ParseError('未返回轻小说日榜');
      const entries = items.filter(isJsonObject).flatMap((row) => {
        const provider = optString(row, 'providerId') ?? '', id = optString(row, 'novelId') ?? '';
        if (!['syosetu', 'kakuyomu', 'novelup', 'hameln', 'alphapolis'].includes(provider) || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) return [];
        const base = this.book(`${provider}/${id}`, row); if (!base.title.trim()) return [];
        const completed = q.range === '完结' && provider === 'syosetu';
        const book = { ...base, novelInfo: createNovelInfo({ ...base.novelInfo, tags: [...new Set([...(base.novelInfo?.tags ?? []), ...(genre ? [genre] : [])])], status: completed ? '已完结' : base.novelInfo?.status ?? null }) };
        const updated = optLong(row, 'updateAt');
        return [discoverEntry(book, { updatedAt: updated > 0 ? updated * 1000 : null, native: true, origin: `${provider === 'syosetu' ? '成为小说家' : 'Kakuyomu'}·${genre || '综合'}日榜`, statistic: optString(row, 'extra') || null })];
      });
      results[slot] = { entries, more: !route.startsWith('kakuyomu') && q.page < optInt(data, 'pageNumber', items.length === 24 ? q.page + 1 : q.page) };
    } }));
    const seen = new Set<string>(), entries = results.flatMap((r) => r.entries).filter((entry) => { if (seen.has(entry.book.id)) return false; seen.add(entry.book.id); return true; }).map((entry, i) => ({ ...entry, nativeOrder: q.offset + i, rank: q.offset + i + 1 }));
    return discoverPage({ entries, hasMore: results.some((r) => r.more), catalog: this.catalog, native: true });
  }
}
