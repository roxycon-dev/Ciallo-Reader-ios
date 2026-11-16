/**
 * Android source: `com.example.source.SearchBook.kt`
 * `@Immutable` annotation dropped — Compose runtime concept, no TS equivalent.
 * Kotlin `Long?` → `number | null`.
 */

import type { ComicInfo } from './comicInfo';
import type { NovelInfo } from './novelInfo';

export interface SearchBook {
  readonly id: string;
  readonly sourceId: string;
  readonly title: string;
  readonly author: string;
  readonly cover: string | null;
  readonly description: string | null;
  readonly format: string;
  readonly language: string | null;
  readonly comicId: string | null;
  readonly size: number | null;
  readonly downloadUrl: string | null;
  /** eapi（bipinkrish 方案）书对象里的数字 id，用于多格式查询，仅 eapi 兜底搜索时填充。 */
  readonly eapiId: string | null;
  /** eapi 书对象里的短 hash，用于多格式查询，仅 eapi 兜底搜索时填充。 */
  readonly eapiHash: string | null;
  readonly novelInfo: NovelInfo | null;
  readonly comicInfo: ComicInfo | null;
}

export function createSearchBook(params: {
  id: string;
  sourceId: string;
  title: string;
  author: string;
  cover?: string | null;
  description?: string | null;
  format?: string;
  language?: string | null;
  comicId?: string | null;
  size?: number | null;
  downloadUrl?: string | null;
  eapiId?: string | null;
  eapiHash?: string | null;
  novelInfo?: NovelInfo | null;
  comicInfo?: ComicInfo | null;
}): SearchBook {
  return {
    id: params.id,
    sourceId: params.sourceId,
    title: params.title,
    author: params.author,
    cover: params.cover ?? null,
    description: params.description ?? null,
    format: params.format ?? 'epub',
    language: params.language ?? null,
    comicId: params.comicId ?? null,
    size: params.size ?? null,
    downloadUrl: params.downloadUrl ?? null,
    eapiId: params.eapiId ?? null,
    eapiHash: params.eapiHash ?? null,
    novelInfo: params.novelInfo ?? null,
    comicInfo: params.comicInfo ?? null,
  };
}
