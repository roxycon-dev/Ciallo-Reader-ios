/**
 * Android source: `com.example.source.ComicSource.kt`
 * Kotlin `interface ComicSource : BookSource` with default methods →
 * abstract class extending BookSource.
 */

import { BookSource } from './bookSource';
import type { ComicChapter } from './comicChapter';
import { ParseError } from './sourceException';
import { SourceResult } from './sourceResult';
import type { SourceResult as SourceResultType } from './sourceResult';

/** A book source that can browse online comics chapter by chapter. */
export abstract class ComicSource extends BookSource {
  abstract getChapters(bookId: string): Promise<SourceResultType<ComicChapter[]>>;
  abstract getChapterImages(chapterId: string): Promise<SourceResultType<string[]>>;

  /** 章节式文字源：返回章节正文纯文本（段落以 \n\n 分隔）。图片源默认不支持。 */
  async getChapterText(_chapterId: string): Promise<SourceResultType<string>> {
    return SourceResult.Error(new ParseError('该书源不支持文字章节'));
  }

  /**
   * 每个图片 URL 对应的额外请求头（Referer/Cookie/签名等）。
   * 默认无；JS 源通过 onImageLoad 提供。
   * Kotlin returns `Map<String, Map<String, String>>`.
   */
  async getChapterImageHeaders(
    _chapterId: string,
    _urls: string[],
  ): Promise<Record<string, Record<string, string>>> {
    return {};
  }

  /**
   * 懒加载解析：把源返回的“图片页 URL”解析成真实图片 URL（e-hentai 等），
   * 阅读器/下载器在真正加载某一页时按需调用并缓存。默认不支持。
   */
  async resolveChapterImage(_url: string): Promise<string | null> {
    return null;
  }

  /** 懒加载解析后，真实图片 URL 需要的请求头。 */
  async getResolvedHeaders(_url: string): Promise<Record<string, string>> {
    return {};
  }

  /**
   * 封面图请求头（Referer/Cookie 等）。JS 源通过 onThumbnailLoad 提供。
   */
  async getCoverHeaders(_url: string): Promise<Record<string, string>> {
    return {};
  }
}
