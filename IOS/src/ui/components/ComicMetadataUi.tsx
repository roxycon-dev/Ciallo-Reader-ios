/**
 * ComicMetadataUi.tsx — line-by-line port of Android `com/example/ui/ComicMetadataUi.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/ComicMetadataUi.kt`, 86 lines / 82 non-blank).
 *
 * Line map (Kotlin → this file):
 *   1-15    package + Compose imports → React imports; Compose imports SKIPPED
 *   16-22   fun Modifier.comicSearchActions → comicSearchActions() (button props factory)
 *   24-83   fun ComicMetadataBlock     → ComicMetadataBlock
 *   85-86   private fun languageName   → languageName()
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1      `package com.example.ui` — TS module system.
 *  L3      `ExperimentalFoundationApi` — Compose opt-in, no TS equivalent.
 *  L4      `SelectionContainer` — Android's native long-press copy container. On the web
 *          the browser already owns text selection, so the wrapper is dropped; the
 *          selectable text remains selectable (see the component KDoc).
 *  L5      `clickable` Modifier → `<button>` / `onClick`.
 *  L6      `foundation.layout.*` (Row/Column/FlowRow/Spacer/PaddingValues) → CSS flex
 *          (`comic-meta__tags` uses `flex-wrap` for FlowRow, gap 6.dp = 6px).
 *  L7      `RoundedCornerShape` → CSS `border-radius` (14.dp / 8.dp preserved).
 *  L8      `material3.*` (Surface/Text/TextButton) → plain elements + `comic-meta-*` CSS
 *          (this surface is LIGHT: `surfaceContainerHigh`, `onSurfaceVariant` #61666D).
 *  L9-13   `runtime.*` / `ui.Modifier` / `draw.clip` / `unit.dp` / `ui.semantics.Role` →
 *          `useState` / CSS / `type="button"`.
 *  L44     `if (rows.isEmpty() && aliases.isEmpty() && tags.isEmpty()) return` → the
 *          component returns `null` (no wrapper element, same as Compose).
 *  L45     `Spacer(Modifier.height(12.dp))` → CSS `margin-top: 12px` on the block.
 *  L57-76  `FlowRow` → `.comic-meta__tags { display: flex; flex-wrap: wrap; gap: 6px }`.
 *  L63     `tag.substringAfter('：', tag).trim().ifBlank { tag }` → the same
 *          substring-after logic (a full-width colon `：`; default when absent; trimmed;
 *          fall back to the whole tag when blank).
 *  L77-79  `TextButton(onClick = { expanded = !expanded }, contentPadding = 0.dp)` →
 *          `<button className="comic-meta__toggle">` with `padding: 0`.
 *  L85-86  `java.util.Locale.forLanguageTag(code).getDisplayLanguage(Locale.SIMPLIFIED_CHINESE)`
 *          → `Intl.DisplayNames(['zh-Hans'], { type: 'language' })` (the same BCP-47
 *          language display name), with the same `takeIf { it.isNotBlank() } ?: code`
 *          fallback. `Intl.DisplayNames` can return the input code unchanged for an
 *          unknown tag, which matches `getDisplayLanguage` returning the tag.
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * `remember(book.sourceId, book.id) { mutableStateOf(false) }` → React `useState`
 *    plus a `key` prop. Compose resets `expanded` whenever the book identity changes, so
 *    callers MUST render `<ComicMetadataBlock key={`${book.sourceId}::${book.id}`} … />`;
 *    `key` is the exact React equivalent of a Compose `remember` key.
 *  * `Modifier.clip(...).comicSearchActions(...)` → a `<button>` whose accessible name is
 *    `搜索标签` (Android `onClickLabel = "搜索$label"`, `$label` = `标签`).
 */

import { useState } from 'react';
import type { SearchBook } from '@core/source/searchBook';
// `statistics.css` is the only stylesheet this module may extend (see the write-target
// list); the `.comic-meta-*` block lives in its "Comic metadata block" section.
import '../../styles/statistics.css';

/**
 * Plain taps search; SelectionContainer owns long press and native copying.
 *
 * Android: `Modifier.clickable(role = Role.Button, onClickLabel = "搜索$label")`.
 * Web: text selection is native, so long-press copy keeps working on the tag text.
 */
export interface ComicSearchActions {
  readonly type: 'button';
  readonly role: 'button';
  readonly 'aria-label': string;
  readonly onClick: () => void;
}

/** `fun Modifier.comicSearchActions(label, text, onSearch): Modifier` */
export function comicSearchActions(
  label: string,
  text: string,
  onSearch: (value: string) => void,
): ComicSearchActions {
  return {
    type: 'button',
    role: 'button',
    'aria-label': `搜索${label}`,
    onClick: () => {
      if (text.trim() !== '') onSearch(text);
    },
  };
}

export interface ComicMetadataBlockProps {
  book: SearchBook;
  onSearch?: (value: string) => void;
}

/**
 * `internal fun ComicMetadataBlock(book: SearchBook, onSearch: (String) -> Unit = {})`
 *
 * Android remembers `expanded` per `(book.sourceId, book.id)`; pass the same pair as
 * `resetKey` from the caller so switching books collapses the block again.
 */
export function ComicMetadataBlock(props: ComicMetadataBlockProps) {
  const { book } = props;
  const onSearch = props.onSearch ?? (() => {});
  const [expanded, setExpanded] = useState(false);

  const info = book.comicInfo;
  // Kotlin L29 `.filter { it != book.title }.distinct()`
  const aliases = (info?.alternateTitles ?? []).filter((title) => title !== book.title);
  const distinctAliases: string[] = [];
  for (const alias of aliases) if (!distinctAliases.includes(alias)) distinctAliases.push(alias);
  const tags = info?.tags ?? [];

  // Kotlin L31-43 `buildList { … }`
  const rows: Array<[string, string]> = [];
  const status = info?.status;
  if (status !== null && status !== undefined) {
    // Kotlin L32-38 `when (raw.lowercase())`
    const lower = status.toLowerCase();
    let mapped: string;
    if (lower === 'ongoing') mapped = '连载中';
    else if (lower === 'completed' || lower === 'finished') mapped = '已完结';
    else if (lower === 'hiatus') mapped = '休刊中';
    else if (lower === 'cancelled' || lower === 'canceled') mapped = '已中止';
    else mapped = status;
    rows.push(['状态', mapped]);
  }
  const language = book.language;
  if (language !== null && language !== undefined) rows.push(['源站标注语言', language]);
  const originalLanguage = info?.originalLanguage;
  if (originalLanguage !== null && originalLanguage !== undefined) {
    rows.push(['原作语言', languageName(originalLanguage)]);
  }
  const artists = info?.artists ?? [];
  if (artists.length > 0) rows.push(['画师', artists.join('、')]);
  const updatedAt = info?.updatedAt;
  if (updatedAt !== null && updatedAt !== undefined) rows.push(['源站更新信息', updatedAt]);

  // Kotlin L44 — nothing to show → render nothing.
  if (rows.length === 0 && distinctAliases.length === 0 && tags.length === 0) return null;

  const shownAliases = expanded ? distinctAliases : distinctAliases.slice(0, 3);
  const shownTags = expanded ? tags : tags.slice(0, 6);

  return (
    <div className="comic-meta">
      <div className="comic-meta__surface">
        {rows.map(([label, value]) => (
          <p className="comic-meta__row" key={label}>
            {`${label}：${value}`}
          </p>
        ))}
        {distinctAliases.length > 0 ? (
          <p className="comic-meta__aliases">
            {`别名：${shownAliases.join(' / ')}`}
          </p>
        ) : null}
        {tags.length > 0 ? (
          <>
            <p className="comic-meta__row">标签</p>
            <div className="comic-meta__tags">
              {shownTags.map((tag) => {
                const tagName = tagSubstringAfter(tag).trim() || tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    className="comic-meta__tag"
                    aria-label={`搜索标签`}
                    onClick={() => {
                      if (tagName.trim() !== '') onSearch(tagName);
                    }}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
        {distinctAliases.length > 3 || tags.length > 6 ? (
          <button
            type="button"
            className="comic-meta__toggle"
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? '收起资料' : '展开全部资料'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** `tag.substringAfter('：', tag).trim().ifBlank { tag }` (Kotlin L63). */
function tagSubstringAfter(tag: string): string {
  const at = tag.indexOf('：');
  if (at < 0) return tag;
  return tag.slice(at + 1);
}

/**
 * `private fun languageName(code: String): String`
 * — `Locale.forLanguageTag(code).getDisplayLanguage(Locale.SIMPLIFIED_CHINESE)`
 *   `.takeIf { it.isNotBlank() } ?: code`
 */
const displayNames = new Intl.DisplayNames(['zh-Hans'], { type: 'language' });

export function languageName(code: string): string {
  let shown: string;
  try {
    shown = displayNames.of(code) ?? '';
  } catch {
    shown = '';
  }
  return shown.trim() !== '' ? shown : code;
}
