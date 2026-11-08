/**
 * Android source: `com.example.source.js.JsComicMetadata.kt` (66 lines, 63 non-blank)
 * Ported: 63 / 63 non-blank lines. Skipped: none.
 *
 * Platform adaptations:
 * - `org.json.JSONObject/JSONArray` → the local org.json port (`./json.ts`),
 *   which reproduces the lenient `opt*` semantics this file depends on.
 * - `org.jsoup.Jsoup.parse(raw).wholeText().trim()` → the injected
 *   `HtmlDomParser` from `./jsPlatform` (the pure-TS DOM in `@core/parser`).
 * - `SearchBook` / `ComicInfo` data classes → the existing TS interfaces
 *   (`@core/source/searchBook`, `@core/source/comicInfo`) via their factories.
 */

import { createComicInfo, type ComicInfo } from '../comicInfo';
import { createSearchBook, type SearchBook } from '../searchBook';
import { JSONObject, JSON_NULL } from './json';
import type { HtmlDomParser } from './jsPlatform';

/** Venera sources use strings, arrays, or category-keyed tag objects. Never treat a subtitle as an author. */
const JsComicMetadataObject = {
  /** Kotlin `private fun values(value: Any?): List<String>`. */
  values(value: unknown): string[] {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed !== '' && trimmed !== 'null' ? [trimmed] : [];
    }
    if (Array.isArray(value)) {
      // Kotlin `is JSONArray -> (0 until length()).flatMap { values(opt(it)) }`.
      // A JS array from the source script is the JSONArray analogue.
      return value.flatMap((item) => JsComicMetadataObject.values(item));
    }
    if (value instanceof JSONObject) {
      const list = [
        ...JsComicMetadataObject.values(value.opt('name')),
        ...JsComicMetadataObject.values(value.opt('nick')),
        ...JsComicMetadataObject.values(value.opt('username')),
        ...JsComicMetadataObject.values(value.opt('title')),
      ];
      return [...new Set(list)];
    }
    if (value === JSON_NULL) return [];
    if (value !== null && typeof value === 'object') {
      // A plain object (not wrapped in JSONObject) is the same shape.
      const plain = value as Record<string, unknown>;
      const list = [
        ...JsComicMetadataObject.values(plain['name']),
        ...JsComicMetadataObject.values(plain['nick']),
        ...JsComicMetadataObject.values(plain['username']),
        ...JsComicMetadataObject.values(plain['title']),
      ];
      return [...new Set(list)];
    }
    return [];
  },

  /** Kotlin `fun book(data: JSONObject, sourceId: String, bookId: String): SearchBook`. */
  book(data: JSONObject, sourceId: string, bookId: string, dom: HtmlDomParser): SearchBook {
    const categories = data.optJSONObject('tags');
    const category = (...names: string[]): string[] => {
      if (categories === null) return [];
      const out: string[] = [];
      for (const key of categories.keys()) {
        if (names.some((name) => name.toLowerCase() === key.toLowerCase())) {
          out.push(...JsComicMetadataObject.values(categories.opt(key)));
        }
      }
      return out;
    };
    const flatTags = JsComicMetadataObject.values(data.opt('tags'));
    const prefixed = (...names: string[]): string[] =>
      flatTags.flatMap((tag) => {
        // Kotlin `tag.substringBefore(':')` / `substringAfter(':', "")`.
        const colon = tag.indexOf(':');
        const prefix = colon >= 0 ? tag.slice(0, colon) : tag;
        const rest = colon >= 0 ? tag.slice(colon + 1) : '';
        const value = rest.trim();
        return value !== '' && names.some((name) => name.toLowerCase() === prefix.toLowerCase())
          ? [value]
          : [];
      });
    const authors = [
      ...new Set([
        ...JsComicMetadataObject.values(data.opt('author')),
        ...JsComicMetadataObject.values(data.opt('authors')),
        ...category('author', 'authors', '作者', '作家'),
        ...prefixed('author'),
      ]),
    ];
    const artists = [
      ...new Set([
        ...JsComicMetadataObject.values(data.opt('artist')),
        ...prefixed('artist'),
        ...category('artist', 'artists', '艺术家', '藝術家', '画师', '画家', '繪師', '绘师'),
      ]),
    ];
    let tags: string[];
    if (categories !== null) {
      tags = [];
      for (const key of categories.keys()) {
        for (const value of JsComicMetadataObject.values(categories.opt(key))) {
          tags.push(`${key}：${value}`);
        }
      }
    } else {
      tags = flatTags;
    }
    const aliases = [
      ...new Set([
        ...JsComicMetadataObject.values(data.opt('alternateTitles')),
        ...JsComicMetadataObject.values(data.opt('aliases')),
        ...JsComicMetadataObject.values(data.opt('otherNames')),
        ...category('别名', '別名', '其他名称', 'alternative', 'alternate titles'),
      ]),
    ];
    const status =
      JsComicMetadataObject.values(data.opt('status'))[0] ??
      category('状态', '狀態', 'status')[0] ??
      (data.opt('isCompleted') === true ? '已完结' : data.opt('isCompleted') === false ? '连载中' : null);
    return createSearchBook({
      id: bookId,
      sourceId,
      title: JsComicMetadataObject.values(data.opt('title'))[0] ?? '',
      author: authors.join('、'),
      cover: JsComicMetadataObject.values(data.opt('cover'))[0] ?? null,
      description: (() => {
        const raw = JsComicMetadataObject.values(data.opt('description'))[0];
        if (raw === undefined) return null;
        // Kotlin `Regex("(?i)<br\\s*/?>")` — JS has no inline `(?i)` flag.
        return dom.wholeText(raw.replace(/<br\s*\/?>/gi, '\n')).trim();
      })(),
      format: '漫画',
      language:
        JsComicMetadataObject.values(data.opt('language'))[0] ??
        category('language', '语言', '語言')[0] ??
        null,
      comicInfo: createComicInfo({
        alternateTitles: aliases,
        artists,
        tags: [...new Set(tags)],
        status: status ?? null,
        originalLanguage: JsComicMetadataObject.values(data.opt('originalLanguage'))[0] ?? null,
        updatedAt:
          JsComicMetadataObject.values(data.opt('updateTime'))[0] ??
          JsComicMetadataObject.values(data.opt('updatedAt'))[0] ??
          category('更新', '更新时间', '更新時間')[0] ??
          null,
      }),
    });
  },
};

/** The comic metadata a search/detail page contributed, without the SearchBook wrapper. */
export type JsComicMetadataResult = { readonly author: string; readonly comicInfo: ComicInfo };

/** Kotlin `object JsComicMetadata` call-site namespace. */
export const JsComicMetadata = JsComicMetadataObject;
