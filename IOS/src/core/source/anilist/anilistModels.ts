/**
 * Android `com.example.source.anilist.AniListModels.kt` (100 lines, 93 non-blank)
 * → `src/core/source/anilist/anilistModels.ts`.
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-2     package/imports                        → header + imports
 *   3-12    KDoc (design notes)                    → header block, verbatim
 *   13-19   data class AniListTitleRow             → AniListTitleRow interface
 *   21-27   object AniListTitleType                → AniListTitleType const object
 *   29-33   data class AniListSyncPage             → AniListSyncPage interface
 *   35-65   data class AniListMediaTitles + toRows() → AniListMediaTitles + toRows()
 *   67-71   object SearchVariantBuilder KDoc       → header block, verbatim
 *   73-76   MAX_VARIANTS                           → MAX_VARIANTS
 *   78-99   build()                                → buildSearchVariants()
 *
 * Skipped lines / adaptations:
 *   - `TitleNormalizer.normalize / compact / usableVariant` are imported from the
 *     EXISTING `src/core/data/titleNormalizer.ts` (port of `TitleNormalizer.kt`),
 *     not re-created here. Same for `CjkFoldMap.fold` → `src/core/data/cjkFoldMap.ts`.
 *   - `com.example.source.keyword.KeywordKeys.query` is imported from
 *     `../keyword/keywordModels` (port of `KeywordModels.kt`) — the two Kotlin
 *     files already depend on each other that way.
 *   - `data class …(val …)` → readonly interfaces; `copy`/`componentN` have no
 *     callers in the ported layer.
 *   - `SearchVariantBuilder.build` → `buildSearchVariants` (module-level
 *     function; the Kotlin `object` has no state).
 */

import { compact, normalize, usableVariant } from '../../data/titleNormalizer';
import { query } from '../keyword/keywordModels';

/**
 * AniList 本地多语言标题数据库的实体与 DAO 约定（第七轮第 7 条）。
 *
 * 设计要点（对应规范第 2/3/13 点）：
 * - 只保存"用于标题匹配"的最小必要数据：Media ID + 标题类型 + 原文 + 两个归一化形态；
 *   不存封面、简介、角色、评分等无关数据；
 * - 每部作品的每个标题一行（romaji/english/native/synonyms 展开为多行），
 *   查询 = SQL + 索引命中，整个数据集从不整体加载进内存常驻；
 * - (mediaId, titleType, rawTitle) 唯一索引 + IGNORE 冲突策略：同步可安全重放。
 */
export interface AniListTitleRow {
  readonly mediaId: number;
  readonly titleType: string; // ROMAJI / ENGLISH / NATIVE / SYNONYM
  readonly rawTitle: string;
  readonly normalizedTitle: string;
  readonly compactTitle: string;
}

/** 标题类型常量 */
export const AniListTitleType = {
  ROMAJI: 'ROMAJI',
  ENGLISH: 'ENGLISH',
  NATIVE: 'NATIVE',
  SYNONYM: 'SYNONYM',
} as const;

export type AniListTitleTypeValue = (typeof AniListTitleType)[keyof typeof AniListTitleType];

/** 一页同步结果（GraphQL 响应的最小映射） */
export interface AniListSyncPage {
  readonly media: AniListMediaTitles[];
  readonly hasMore: boolean;
}

/** 单部作品的全部标题（缺失字段直接跳过——规范第 12 点） */
export interface AniListMediaTitles {
  readonly mediaId: number;
  readonly romaji: string | null;
  readonly english: string | null;
  readonly native: string | null;
  readonly synonyms: string[];
}

/** 展开为行（空值字段跳过；归一化在入库前完成） */
export function toTitleRows(media: AniListMediaTitles): AniListTitleRow[] {
  const rows: AniListTitleRow[] = [];
  const add = (titleType: string, raw: string | null): void => {
    if (raw == null || raw.trim() === '') return;
    rows.push({
      mediaId: media.mediaId,
      titleType,
      rawTitle: raw.trim(),
      normalizedTitle: normalize(raw),
      compactTitle: compact(raw),
    });
  };
  add(AniListTitleType.ROMAJI, media.romaji);
  add(AniListTitleType.ENGLISH, media.english);
  add(AniListTitleType.NATIVE, media.native);
  for (const synonym of media.synonyms) add(AniListTitleType.SYNONYM, synonym);
  // 归一化后为空的行没有匹配价值
  return rows.filter((it) => it.normalizedTitle !== '');
}

/** Kotlin `AniListMediaTitles.toRows()` bound as a method for call-site parity. */
export const AniListMediaTitlesKt = {
  toRows: toTitleRows,
};

/**
 * 搜索变体构建（纯函数，可单测——对应规范第 7 点的搜索流程）：
 * 原始关键词始终保留在首位；本地标题库命中的其它语言标题追加其后；
 * 去重（归一化级）+ 数量上限（防一次搜索扇出过大）。
 */
// 第十一轮第 6 条：5 → 6——原始词 + 原名/英文/罗马音 + 1 个同义标题，
// 保证主作品三种官方书写都发给各书源（原先 5 个在命中多部作品时会被衍生作挤占）
export const MAX_VARIANTS = 6;

/**
 * @param originalKeyword 用户原始输入
 * @param matchedRawTitles 本地库命中的作品原始标题（任意语言）
 * @return 去重后的搜索变体列表（首位 = 原始输入）
 */
export function buildSearchVariants(
  originalKeyword: string,
  matchedRawTitles: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const offer = (candidate: string, original = false): void => {
    if (out.length >= MAX_VARIANTS) return;
    const trimmed = candidate.trim();
    if (trimmed === '') return;
    if (!original && !usableVariant(trimmed)) return;
    const key = query(trimmed);
    if (key === '' || seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };
  offer(originalKeyword, true);
  // 原始关键词若自身过长截断保护（书源 URL 长度）
  for (const matched of matchedRawTitles) offer(matched);
  return out;
}

/** Kotlin `SearchVariantBuilder` object form, for call-site parity. */
export const SearchVariantBuilder = {
  MAX_VARIANTS,
  build: buildSearchVariants,
};