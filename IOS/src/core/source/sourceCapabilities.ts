/**
 * Android source: `com.example.source.SourceCapabilities.kt`
 * Data class + `BookSource` extension properties `isNovelSource` / `isComicSource`.
 */

import type { BookSource } from './bookSource';

export interface SourceCapabilities {
  readonly supportSearch: boolean;
  readonly supportDownload: boolean;
  readonly searchRequiresLogin: boolean;
  readonly downloadRequiresLogin: boolean;
  readonly supportDebug: boolean;
  readonly supportImport: boolean;
  readonly supportComic: boolean;
  /** 支持章节式在线文字阅读（Legado 网文源：htmlChapters + 文本正文规则） */
  readonly supportOnlineText: boolean;
  readonly environmentOnly: boolean;
  /** 提供小说电子书文件，可整本下载后进入本地文字阅读器。 */
  readonly supportEbook: boolean;
}

/** Kotlin data-class defaults: search/download true, everything else false. */
export function createSourceCapabilities(partial: Partial<SourceCapabilities> = {}): SourceCapabilities {
  return {
    supportSearch: partial.supportSearch ?? true,
    supportDownload: partial.supportDownload ?? true,
    searchRequiresLogin: partial.searchRequiresLogin ?? false,
    downloadRequiresLogin: partial.downloadRequiresLogin ?? false,
    supportDebug: partial.supportDebug ?? false,
    supportImport: partial.supportImport ?? false,
    supportComic: partial.supportComic ?? false,
    supportOnlineText: partial.supportOnlineText ?? false,
    environmentOnly: partial.environmentOnly ?? false,
    supportEbook: partial.supportEbook ?? false,
  };
}

/** Kotlin `SourceCapabilities.requiresLogin` getter = downloadRequiresLogin. */
export function sourceRequiresLogin(capabilities: SourceCapabilities): boolean {
  return capabilities.downloadRequiresLogin;
}

/**
 * Kotlin `val BookSource.isNovelSource`:
 * 小说源（电子书/网文）：电子书下载源，或支持章节文字阅读的源。
 * 与漫画源（capabilities.supportComic）互斥，用于书源分类展示与聚合搜索分组。
 */
export function isNovelSource(source: BookSource): boolean {
  return (
    source.id === 'zlibrary' ||
    (!source.capabilities.supportComic &&
      (source.capabilities.supportEbook || source.capabilities.supportOnlineText))
  );
}

/** Kotlin `val BookSource.isComicSource`. */
export function isComicSource(source: BookSource): boolean {
  return source.capabilities.supportComic && !isNovelSource(source);
}
