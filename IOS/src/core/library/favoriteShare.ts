import type { BookSource } from '@core/source/bookSource';
import { validDetailLink } from '@core/source/detailLink';
import type { FavoriteEntity } from './favoriteTypes';
import { sharedWorkLinkCreate } from './sharedWorkLink';

interface SharePreferences { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> }
type ShareWork = Pick<FavoriteEntity, 'sourceId' | 'comicId' | 'title'>;

async function within<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('获取详情链接超时，请检查网络后重试')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

/** Android FavoriteShareHelper: public detail URLs, then a credential-free app link. */
export async function favoriteShareText(works: readonly ShareWork[], source: (id: string) => BookSource | null,
  preferences: SharePreferences): Promise<{ title: string; text: string }> {
  if (!works.length) throw new Error('请先选择要分享的作品');
  const unique = [...new Map(works.map((work) => [JSON.stringify([work.sourceId, work.comicId]), work])).values()];
  const rows = new Array<string>(unique.length);
  let next = 0;
  await within(Promise.all(Array.from({ length: Math.min(3, unique.length) }, async () => {
    while (next < unique.length) {
      const index = next++, work = unique[index]!;
      const key = `work_detail_share_links:${JSON.stringify([work.sourceId, work.comicId])}`;
      let url = validDetailLink(work.comicId) ?? validDetailLink(await preferences.get(key));
      if (!url) {
        let raw: string | null = null;
        try { raw = await within(source(work.sourceId)?.getShareUrl(work.comicId) ?? Promise.resolve(null), 4000); }
        catch { /* Sources without a working public site still have an offline app link. */ }
        if (raw !== null && !validDetailLink(raw)) throw new Error(`《${work.title}》：书源详情链接无效`);
        url = validDetailLink(raw);
      }
      if (url) {
        await preferences.set(key, url);
        rows[index] = `《${work.title}》\n${url}`;
      } else rows[index] = `《${work.title}》\n${sharedWorkLinkCreate(work.sourceId, work.comicId, work.title)}\n（用 Ciallo Reader 打开，需启用相同书源）`;
    }
  })), 25_000);
  return { title: unique.map((work) => work.title).join('、'), text: rows.join('\n\n') };
}
