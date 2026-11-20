/**
 * smallZlibAndFavoriteParity.test.ts —— 第九批（49–51 行档，3 个文件，合计 149 行）。
 *
 *   · `source/zlibrary/ZLibraryParser.kt`（49）—— 详情模型 + 格式推断 + 兼容门面
 *   · `source/js/JsImageProcessor.kt`（50）—— 图片后处理注册表（含「乱序页不得先显示」）
 *   · `data/favorite/ComicFavoriteMatching.kt`（51）—— 跨源重复漫画候选（Dice 相似度）
 *
 * 本轮修正（E174）：两条相似度理由漏了 `tr()` —— Kotlin 只给这两条包了本地化，
 * `书名或已知别名相同` 在原文里是裸字面量。
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ZLibraryParser,
  guessFileFormatFromUrl,
} from '@core/source/zlibrary/zLibraryParser';
import {
  JsImageProcessor,
  clear,
  hasTransform,
  register,
  transform,
  unregister,
} from '@core/source/js/jsImageProcessor';
import { candidates } from '@core/library/comicFavoriteMatching';
import type { FavoriteEntity } from '@core/library/favoriteTypes';
import { tr } from '@core/i18n';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

describe('ZLibraryParser.kt：格式推断与兼容门面', () => {
  const KT = kt('source/zlibrary/ZLibraryParser.kt');

  it('ParsedBookDetail 五个字段（title/author/cover/format/downloadUrl）', () => {
    expect(KT).toContain('data class ParsedBookDetail(');
    expect(KT).toContain('val title: String,');
    expect(KT).toContain('val author: String,');
    expect(KT).toContain('val cover: String?,');
    expect(KT).toContain('val format: String,');
    expect(KT).toContain('val downloadUrl: String');
  });

  it('14 个已知后缀；按路径后缀先判，再判 `?format=`', () => {
    expect(KT).toContain('"epub", "mobi", "azw3", "azw", "prc", "txt", "pdf", "fb2", "lit",');
    expect(KT).toContain('"doc", "docx", "rtf", "cbz", "cbr"');
    expect(KT).toContain('known.firstOrNull { path.endsWith(".$it") }?.let { return it }');
    expect(KT).toContain('Regex("(?:^|[?&])format=([a-z0-9]+)")');

    expect(guessFileFormatFromUrl('/dl/123/abc.mobi')).toBe('mobi');
    expect(guessFileFormatFromUrl('https://x/dl/1/a.EPUB')).toBe('epub');
    expect(guessFileFormatFromUrl('https://x/dl/1?a=2&format=azw3')).toBe('azw3');
    expect(guessFileFormatFromUrl('https://x/dl/1?format=cbz')).toBe('cbz');
    // 未知后缀 / 未知 format → null（调用方回落到页面解析出的格式）
    expect(guessFileFormatFromUrl('/dl/1/a.bin')).toBeNull();
    expect(guessFileFormatFromUrl('/dl/1?format=xyz')).toBeNull();
    expect(guessFileFormatFromUrl('')).toBeNull();
    expect(guessFileFormatFromUrl(null)).toBeNull();
    // 后缀必须在末尾（`.epubx` 不是 epub）
    expect(guessFileFormatFromUrl('/dl/1/a.epubx')).toBeNull();
  });

  it('路径先切 `?` 再切 `#`：带 fragment 的链接仍能认出后缀', () => {
    expect(KT).toContain("val path = lower.substringBefore('?').substringBefore('#')");
    expect(guessFileFormatFromUrl('/dl/1/a.epub#frag')).toBe('epub');
    expect(guessFileFormatFromUrl('/dl/1/a.mobi?x=1#frag')).toBe('mobi');
  });

  it('门面两个方法各一行转调 ZLibraryParserManager，sourceId 默认 "zlibrary"', () => {
    expect(KT).toContain('object ZLibraryParser {');
    expect(KT).toContain('fun parseSearchPage(html: String, baseUrl: String, sourceId: String = "zlibrary"): List<SearchBook> =');
    expect(KT).toContain('ZLibraryParserManager.parseSearchPage(html, baseUrl, sourceId)');
    expect(KT).toContain('ZLibraryParserManager.parseDetailPage(html, baseUrl)');
    expect(Object.keys(ZLibraryParser)).toEqual(['parseSearchPage', 'parseDetailPage']);
    // 空 HTML：管理器不会抛（走 fallback 解析器，0 条）
    expect(ZLibraryParser.parseSearchPage('<html></html>', 'https://z-lib.sk')).toEqual([]);
  });
});

describe('JsImageProcessor.kt：图片后处理注册表', () => {
  const KT = kt('source/js/JsImageProcessor.kt');

  beforeEach(() => {
    clear();
  });

  it('register：code 为空即撤销登记（而不是登记一个空变换）', () => {
    expect(KT).toContain('if (code.isNullOrBlank()) {');
    expect(KT).toContain('entries.remove(url)');
    const engine = { transformImageBlocking: async () => new Uint8Array([1]) };
    register('u1', engine, 'code');
    expect(hasTransform('u1')).toBe(true);
    register('u1', engine, '   ');
    expect(hasTransform('u1')).toBe(false);
    register('u1', engine, null);
    expect(hasTransform('u1')).toBe(false);
  });

  it('transform：未登记 → null（保持原图，不报错）', async () => {
    expect(KT).toContain('val entry = entries[url] ?: return null');
    await expect(transform('missing', new Uint8Array([1]))).resolves.toBeNull();
  });

  it('transform：已登记 → 交引擎处理；引擎抛错 → null 并记 warn', async () => {
    expect(KT).toContain('entry.engine.transformImageBlocking(entry.code, bytes)');
    expect(KT).toContain('Log.w("JsImageProcessor", "transform failed: $url", e)');
    const seen: string[] = [];
    register('u2', {
      transformImageBlocking: async (code, input) => {
        seen.push(`${code}:${String(input.length)}`);
        return new Uint8Array([9, 9]);
      },
    }, 'flip');
    const out = await transform('u2', new Uint8Array([1, 2, 3]));
    expect([...(out as Uint8Array)]).toEqual([9, 9]);
    expect(seen).toEqual(['flip:3']);

    register('u3', {
      transformImageBlocking: async () => {
        throw new Error('engine dead');
      },
    }, 'x');
    await expect(transform('u3', new Uint8Array([1]))).resolves.toBeNull();
  });

  it('hasTransform 的用途是「乱序页在变换前不得显示」', () => {
    expect(KT).toContain('Scrambled pages must never be displayed before their complete-image transform.');
    const engine = { transformImageBlocking: async () => null };
    register('u4', engine, 'c');
    expect(hasTransform('u4')).toBe(true);
    unregister('u4');
    expect(hasTransform('u4')).toBe(false);
  });

  it('clear 清空全部；命名空间五个成员', () => {
    expect(KT).toContain('fun clear() {');
    const engine = { transformImageBlocking: async () => null };
    register('a', engine, 'c');
    register('b', engine, 'c');
    clear();
    expect(hasTransform('a')).toBe(false);
    expect(hasTransform('b')).toBe(false);
    expect(Object.keys(JsImageProcessor)).toEqual([
      'register',
      'unregister',
      'hasTransform',
      'transform',
      'clear',
    ]);
  });
});

describe('ComicFavoriteMatching.kt：跨源重复漫画候选', () => {
  const KT = kt('data/favorite/ComicFavoriteMatching.kt');

  /**
   * `FavoriteEntity` 没有自增 id —— 主键是 (sourceId, comicId)。
   * 这里用 `comicId` 当标识，其余字段按类型补齐。
   */
  function favorite(overrides: Partial<FavoriteEntity>): FavoriteEntity {
    return {
      sourceId: 'mangadex',
      comicId: 'c1',
      title: '无职转生',
      author: '理不尽',
      coverUrl: null,
      localThumbPath: null,
      serialStatus: 'ongoing',
      latestChapterId: null,
      latestChapterTitle: null,
      latestChapterUpdateAt: 0,
      lastCheckedAt: 0,
      sourceAlive: true,
      categoryName: '默认',
      favoritedAt: 0,
      sortOrder: 0,
      ...overrides,
    };
  }

  it('数据形状：候选三元组 + 请求七个字段（busy 默认 false、error 默认 null）', () => {
    expect(KT).toContain('data class DuplicateComicCandidate(val favorite: FavoriteEntity, val reason: String, val score: Double)');
    expect(KT).toContain('val busy: Boolean = false,');
    expect(KT).toContain('val error: String? = null,');
  });

  it('同源直接跳过；书名/别名完全相同 → score 1.0，理由**不**本地化', () => {
    expect(KT).toContain('return favorites.filter { it.sourceId != book.sourceId }');
    expect(KT).toContain('title in titles -> DuplicateComicCandidate(favorite, "书名或已知别名相同", 1.0)');
    const book = { sourceId: 'copymanga', title: '无职转生', author: '理不尽' };
    const same = favorite({ comicId: 'c2', title: '無職転生' }); // 归一化后相同（繁简折叠）
    const sameSource = favorite({ comicId: 'c3', sourceId: 'copymanga', title: '无职转生' });
    const result = candidates(book, [same, sameSource], []);
    expect(result.map((it) => it.favorite.comicId)).toEqual(['c2']);
    expect(result[0]?.score).toBe(1.0);
    expect(result[0]?.reason).toBe('书名或已知别名相同');
  });

  it('相似度 ≥ 0.82 且标题 ≥ 4 字：作者相同与否分开提示（这两条**要**本地化）', () => {
    expect(KT).toContain('title.length >= 4 && similarity >= 0.82 -> DuplicateComicCandidate(favorite,');
    expect(KT).toContain('if (sameAuthor) tr("书名相似，作者相同") else tr("书名相似，请核对作品"), similarity)');
    const book = { sourceId: 'copymanga', title: '无职转生异世界冒险', author: '理不尽' };
    const withAuthor = favorite({ comicId: 'c4', title: '无职转生异世界冒险记', author: '理不尽' });
    const otherAuthor = favorite({ comicId: 'c5', title: '无职转生异世界冒险记', author: '别人' });
    const [first] = candidates(book, [withAuthor], []);
    expect(first?.reason).toBe(tr('书名相似，作者相同'));
    const [second] = candidates(book, [otherAuthor], []);
    expect(second?.reason).toBe(tr('书名相似，请核对作品'));
    expect(second?.score).toBeGreaterThanOrEqual(0.82);
  });

  it('不可用标题（未知书名/未知/unknown/untitled）双向过滤；短于 4 字不判相似', () => {
    expect(KT).toContain('title.isNotBlank() && title !in setOf("未知书名", "未知", "unknown", "untitled")');
    const book = { sourceId: 'copymanga', title: '无职转生', author: '理不尽' };
    expect(candidates(book, [favorite({ comicId: 'c6', title: '未知书名' })], [])).toEqual([]);
    expect(candidates(book, [favorite({ comicId: 'c7', title: 'untitled' })], [])).toEqual([]);
    // 短标题即使很像也不进候选
    const shortBook = { sourceId: 'copymanga', title: '书', author: '' };
    expect(candidates(shortBook, [favorite({ comicId: 'c8', title: '书' })], [])).toHaveLength(1); // 相同 → 1.0
    expect(candidates(shortBook, [favorite({ comicId: 'c9', title: '书吧' })], [])).toEqual([]);
  });

  it('Dice：完全相同 1.0；任一侧短于 4 字 0.0；结果按 score 降序', () => {
    expect(KT).toContain('if (a == b) return 1.0');
    expect(KT).toContain('if (a.length < 4 || b.length < 4) return 0.0');
    expect(KT).toContain('return 2.0 * common / (a.length + b.length - 2)');
    expect(KT).toContain('}.sortedByDescending { it.score }');

    const book = { sourceId: 'copymanga', title: '无职转生异世界冒险', author: '理不尽' };
    const exact = favorite({ comicId: 'c10', title: '无职转生异世界冒险' });
    const near = favorite({ comicId: 'c11', title: '无职转生异世界冒险记', author: '别人' });
    const result = candidates(book, [near, exact], []);
    expect(result.map((it) => it.favorite.comicId)).toEqual(['c10', 'c11']);
    expect(result[0]?.score).toBeGreaterThan(result[1]?.score as number);
  });

  it('别名参与匹配（comicInfo.alternateTitles + 外部 aliases）', () => {
    expect(KT).toContain('val titles = (listOf(book.title) + book.comicInfo?.alternateTitles.orEmpty() + aliases)');
    const book = {
      sourceId: 'copymanga',
      title: '无职转生',
      author: '理不尽',
      comicInfo: { alternateTitles: ['Mushoku Tensei'] },
    };
    expect(candidates(book, [favorite({ comicId: 'c12', title: 'Mushoku Tensei' })], [])).toHaveLength(1);
    expect(candidates(book, [favorite({ comicId: 'c13', title: '外部别名书' })], ['外部别名书'])).toHaveLength(1);
  });
});
