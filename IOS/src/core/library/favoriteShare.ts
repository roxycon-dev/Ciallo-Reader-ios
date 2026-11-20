import type { BookSource } from '@core/source/bookSource';
import { validDetailLink } from '@core/source/detailLink';
import type { FavoriteEntity } from './favoriteTypes';
import { sharedWorkLinkCreate } from './sharedWorkLink';

/**
 * `library/FavoriteShareHelper.kt`（80 行 / 71 非空）—— 收藏夹分享的正文拼装。
 *
 * 只移植 `prepareShareIntent`（L42-79）里与平台无关的部分；`shareFavorites`（L26-40）
 * 与 `Intent.createChooser` 属平台层（Web 走 `navigator.share` / 剪贴板）。
 *
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `require(favorites.isNotEmpty())` | L44 | `FAVORITE_SHARE_EMPTY_MESSAGE` |
 * | prefs 名 `work_detail_share_links` | L45 | `FAVORITE_SHARE_PREFS_NAME` |
 * | `Semaphore(3)` | L46 | `FAVORITE_SHARE_CONCURRENCY` |
 * | `withTimeout(25_000)` | L47 | `FAVORITE_SHARE_TOTAL_TIMEOUT_MS` |
 * | `favorites.distinctBy { it.sourceId to it.comicId }` | L49 | `favoriteShareDistinct()` |
 * | `JSONArray(listOf(sourceId, comicId)).toString()` | L51 | `favoriteShareLinkKey()` |
 * | `DetailLink.valid(...)` 三级回退 | L52-53 | 同名逻辑 |
 * | `withTimeout(4_000)` + `require(...)` | L54-56 | `FAVORITE_SHARE_SOURCE_TIMEOUT_MS` |
 * | `IllegalStateException("《title》：书源详情链接无效")` | L61 | 同文案 |
 * | `"《title》\n$url"` / 三段兜底 | L65-68 | 同文案 |
 * | 主题行 `favorites.joinToString("、")` | L77 | 用**原始列表** |
 */

/** Kotlin L47 `withTimeout(25_000)` —— 整批最多 25 秒。 */
export const FAVORITE_SHARE_TOTAL_TIMEOUT_MS = 25_000;
/** Kotlin L54 `withTimeout(4_000)` —— 单个书源取详情链接。 */
export const FAVORITE_SHARE_SOURCE_TIMEOUT_MS = 4_000;
/** Kotlin L46 `Semaphore(3)`。 */
export const FAVORITE_SHARE_CONCURRENCY = 3;
/** Kotlin L45 `getSharedPreferences("work_detail_share_links", MODE_PRIVATE)`。 */
export const FAVORITE_SHARE_PREFS_NAME = 'work_detail_share_links';
/** Kotlin L36 `"获取详情链接超时，请检查网络后重试"`。 */
export const FAVORITE_SHARE_TIMEOUT_MESSAGE = '获取详情链接超时，请检查网络后重试';
/** Kotlin L44 `tr("请先选择要分享的作品")`。 */
export const FAVORITE_SHARE_EMPTY_MESSAGE = '请先选择要分享的作品';
/** Kotlin L56 `tr("书源详情链接无效")`。 */
export const FAVORITE_SHARE_INVALID_LINK_MESSAGE = '书源详情链接无效';
/** Kotlin L68 的兜底尾巴（含全角括号）。 */
export const FAVORITE_SHARE_APP_LINK_SUFFIX = '（用 Ciallo Reader 打开，需启用相同书源）';

interface SharePreferences { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> }
type ShareWork = Pick<FavoriteEntity, 'sourceId' | 'comicId' | 'title'>;

async function within<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(FAVORITE_SHARE_TIMEOUT_MESSAGE)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kotlin L49 `favorites.distinctBy { it.sourceId to it.comicId }` —— 保留**第一次**出现的那条。
 *
 * ⚠️ 旧端口是把 key→work 塞进一个 `Map` 再取值：`Map` 的语义是「后写覆盖、位置留首个」，
 * 于是同 key 的两条记录会保留**最后一条**。`distinctBy` 保留的是**第一条**。
 * 同一作品的两个书名（「三体」与「三体（全集）」）会让分享正文里的书名换人。
 */
export function favoriteShareDistinct(works: readonly ShareWork[]): ShareWork[] {
  const seen = new Set<string>();
  const out: ShareWork[] = [];
  for (const work of works) {
    const key = favoriteShareLinkKey(work);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(work);
  }
  return out;
}

/** Kotlin L51 `JSONArray(listOf(favorite.sourceId, favorite.comicId)).toString()` + L45 prefs 名。 */
export function favoriteShareLinkKey(work: ShareWork): string {
  return `${FAVORITE_SHARE_PREFS_NAME}:${JSON.stringify([work.sourceId, work.comicId])}`;
}

/** Android FavoriteShareHelper: public detail URLs, then a credential-free app link. */
export async function favoriteShareText(works: readonly ShareWork[], source: (id: string) => BookSource | null,
  preferences: SharePreferences): Promise<{ title: string; text: string }> {
  // Kotlin L44 `require(favorites.isNotEmpty()) { tr("请先选择要分享的作品") }`
  if (!works.length) throw new Error(FAVORITE_SHARE_EMPTY_MESSAGE);
  const unique = favoriteShareDistinct(works);
  const rows = new Array<string>(unique.length);
  let next = 0;
  await within(Promise.all(Array.from({ length: Math.min(FAVORITE_SHARE_CONCURRENCY, unique.length) }, async () => {
    while (next < unique.length) {
      const index = next++, work = unique[index]!;
      const key = favoriteShareLinkKey(work);
      // L52-53 `DetailLink.valid(comicId) ?: DetailLink.valid(prefs.getString(key, null))`
      let url = validDetailLink(work.comicId) ?? validDetailLink(await preferences.get(key));
      if (!url) {
        try {
          const raw = await within(source(work.sourceId)?.getShareUrl(work.comicId) ?? Promise.resolve(null), FAVORITE_SHARE_SOURCE_TIMEOUT_MS);
          /*
           * L56 `require(raw == null || DetailLink.valid(raw) != null) { tr("书源详情链接无效") }`
           * 然后 L61 捕获 `IllegalArgumentException` 并**带着书名**重抛 —— 链接无效不是
           * 可忽略的失败，它要让整次分享报错。所以这条检查在 `try` **里面**。
           */
          if (raw !== null && !validDetailLink(raw)) throw new InvalidSourceLinkError(work.title);
          url = validDetailLink(raw);
        } catch (error) {
          if (error instanceof InvalidSourceLinkError) throw new Error(error.message);
          /* L59 / L62 只吞掉「超时」与「其它异常」：没有可用公益站点的源仍有离线 App 链接。 */
        }
      }
      if (url) {
        // L64 `prefs.edit().putString(key, url).apply()`
        await preferences.set(key, url);
        rows[index] = `《${work.title}》\n${url}`;
      } else {
        // L67-68 兜底：`SharedWorkLink.create(...)` + 固定尾巴
        rows[index] = `《${work.title}》\n${sharedWorkLinkCreate(work.sourceId, work.comicId, work.title)}\n${FAVORITE_SHARE_APP_LINK_SUFFIX}`;
      }
    }
  })), FAVORITE_SHARE_TOTAL_TIMEOUT_MS);
  /*
   * L77 `putExtra(Intent.EXTRA_SUBJECT, favorites.joinToString("、") { it.title })`
   * —— 主题行用的是**原始列表**（含重复），不是去重后的那份；去重只影响正文。
   */
  return { title: works.map((work) => work.title).join('、'), text: rows.join('\n\n') };
}

/** L61 `IllegalStateException("《${favorite.title}》：书源详情链接无效", e)` 的内部载体。 */
class InvalidSourceLinkError extends Error {
  constructor(title: string) {
    super(`《${title}》：${FAVORITE_SHARE_INVALID_LINK_MESSAGE}`);
    this.name = 'InvalidSourceLinkError';
  }
}
