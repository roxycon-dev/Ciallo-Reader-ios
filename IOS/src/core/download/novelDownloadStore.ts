/**
 * Whole-book novel download store — port of Android `NovelDownloadStore.kt`.
 *
 * Android SharedPreferences("whole_book_novel_downloads") → injected KeyValueStore.
 * Baselines advance only after import (pending:* → book:*).
 */

import {
  isWholeBookNovelSource,
  type NovelInfo,
  type SearchBook,
} from './downloadRequest';

/** Minimal async string-key store (SharedPreferences string ops subset). */
export interface NovelDownloadPrefs {
  getString(key: string): Promise<string | null>;
  /** commit() semantics — returns false when the write failed. */
  putString(key: string, value: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

export interface PendingNovel {
  book: SearchBook;
  replace: boolean;
}

function bookKey(source: string, id: string): string {
  return `book:${source}:${id}`;
}

function pendingKey(taskId: string): string {
  return `pending:${taskId}`;
}

function text(json: Record<string, unknown>, key: string): string | null {
  const v = json[key];
  return typeof v === 'string' ? v : null;
}

function optionalNumber(json: Record<string, unknown>, key: string): number | null {
  const v = json[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** encode(book) — Android JSONObject serialization of SearchBook + nested NovelInfo. */
function encode(book: SearchBook): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: book.id,
    sourceId: book.sourceId,
    title: book.title,
    author: book.author,
    cover: book.cover ?? null,
    format: book.format ?? 'epub',
    language: book.language ?? null,
    description: book.description ?? null,
    size: book.size ?? null,
  };
  const info = book.novelInfo;
  if (info != null) {
    out['info'] = {
      synopsis: info.synopsis ?? null,
      originalTitle: info.originalTitle ?? null,
      status: info.status ?? null,
      category: info.category ?? null,
      latestChapter: info.latestChapter ?? null,
      updatedAt: info.updatedAt ?? null,
      chapterCount: info.chapterCount ?? null,
      volumeCount: info.volumeCount ?? null,
      wordCount: info.wordCount ?? null,
      publisher: info.publisher ?? null,
      translation: info.translation ?? null,
      notice: info.notice ?? null,
      tags: info.tags ?? [],
    };
  }
  return out;
}

/** decode(json) — Android JSONObject → SearchBook. */
function decode(json: Record<string, unknown>): SearchBook {
  const infoRaw = json['info'];
  let info: NovelInfo | null = null;
  if (infoRaw != null && typeof infoRaw === 'object' && !Array.isArray(infoRaw)) {
    const data = infoRaw as Record<string, unknown>;
    const tagsRaw = data['tags'];
    const tags: string[] = Array.isArray(tagsRaw)
      ? tagsRaw.filter((t): t is string => typeof t === 'string')
      : [];
    info = {
      synopsis: text(data, 'synopsis'),
      originalTitle: text(data, 'originalTitle'),
      status: text(data, 'status'),
      category: text(data, 'category'),
      latestChapter: text(data, 'latestChapter'),
      updatedAt: text(data, 'updatedAt'),
      chapterCount: optionalNumber(data, 'chapterCount'),
      volumeCount: optionalNumber(data, 'volumeCount'),
      wordCount: text(data, 'wordCount'),
      publisher: text(data, 'publisher'),
      translation: text(data, 'translation'),
      notice: text(data, 'notice'),
      tags,
    };
  }
  const id = json['id'];
  const sourceId = json['sourceId'];
  const title = json['title'];
  if (typeof id !== 'string' || typeof sourceId !== 'string' || typeof title !== 'string') {
    throw new Error('novel snapshot JSON missing id/sourceId/title');
  }
  const author = json['author'];
  return {
    id,
    sourceId,
    title,
    author: typeof author === 'string' ? author : '',
    cover: text(json, 'cover'),
    description: text(json, 'description'),
    format: typeof json['format'] === 'string' ? (json['format'] as string) : 'epub',
    language: text(json, 'language'),
    size: optionalNumber(json, 'size'),
    novelInfo: info,
  };
}

export class NovelDownloadStore {
  constructor(private readonly prefs: NovelDownloadPrefs) {}

  async prepare(taskId: string, book: SearchBook, replace: boolean): Promise<void> {
    if (!isWholeBookNovelSource(book.sourceId)) {
      throw new Error('该书源不使用小说更新流程');
    }
    const payload = { ...encode(book), replace };
    const ok = await this.prefs.putString(pendingKey(taskId), JSON.stringify(payload));
    if (!ok) {
      throw new Error('novel download snapshot save failed');
    }
  }

  async pending(taskId: string): Promise<PendingNovel | null> {
    const raw = await this.prefs.getString(pendingKey(taskId));
    if (raw == null) return null;
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      return { book: decode(json), replace: json['replace'] === true };
    } catch {
      return null;
    }
  }

  async baseline(source: string, id: string): Promise<SearchBook | null> {
    const raw = await this.prefs.getString(bookKey(source, id));
    if (raw == null) return null;
    try {
      return decode(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  async imported(taskId: string): Promise<void> {
    const pending = await this.pending(taskId);
    if (pending == null) return;
    if (!isWholeBookNovelSource(pending.book.sourceId)) {
      throw new Error('该书源不使用小说更新流程');
    }
    const ok = await this.prefs.putString(
      bookKey(pending.book.sourceId, pending.book.id),
      JSON.stringify(encode(pending.book)),
    );
    if (!ok) {
      throw new Error('novel baseline save failed');
    }
    await this.prefs.remove(pendingKey(taskId));
  }
}
