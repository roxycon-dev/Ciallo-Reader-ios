/**
 * Android `com.example.source.keyword.KeywordModels.kt` (156 lines, 142 non-blank)
 * → `src/core/source/keyword/keywordModels.ts`.
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-4     package/imports                       → header + imports
 *   6       KeywordName KDoc                      → header comment (verbatim)
 *   7       data class KeywordName               → KeywordName interface
 *   8-21    data class KeywordConcept + kind      → KeywordConcept interface + kindOf()
 *   23-33   data class KeywordProviderState + displayName → interface + providerDisplayName()
 *   34-39   data class OnlineKeywordResult       → interface
 *   40-45   data class KeywordUpdate              → interface
 *   47      KeywordConcepts KDoc                  → header comment (verbatim)
 *   48-55   KeywordConcepts.complete()            → complete()
 *   56-77   KeywordConcepts.merge()               → merge()
 *   79      KeywordKeys KDoc                      → header comment (verbatim)
 *   80      KeywordKeys.match()                   → match()
 *   82-83   KeywordKeys.query()                   → query()
 *   85-90   KeywordKeys.language()                → language()
 *   92-94   KeywordKeys.isPlain()                 → isPlain()
 *   97-98   KeywordPersonNames KDoc               → header comment (verbatim)
 *   99-105  KeywordPersonNames.shortForms()       → shortForms()
 *   107-113 KeywordPersonNames.rank()             → rank()
 *   116-117 KeywordVariants.LIMIT                 → VARIANT_LIMIT
 *   119-134 KeywordVariants.compose()             → compose()
 *   136-155 KeywordVariants.prioritized()         → prioritized()
 *
 * Skipped lines / adaptations:
 *   - `TitleNormalizer.compact` → the EXISTING `src/core/data/titleNormalizer.ts`
 *     (port of `TitleNormalizer.kt`); not re-created here.
 *   - `internal object KeywordKeys` etc. → exported module functions. The Kotlin
 *     `objects` hold no state, so a module namespace is equivalent; the const
 *     namespaces (`KeywordKeys`, `KeywordConcepts`, `KeywordPersonNames`,
 *     `KeywordVariants`) are also exported for call-site parity.
 *   - `data class` → readonly interfaces + `readonly` props; `copy` has no caller
 *     outside this module (merge() constructs fresh objects).
 *   - `Locale.ROOT` lowercase → `toLowerCase()` (the Kotlin call is locale-fixed
 *     on purpose; JS `toLowerCase` is also locale-independent for the ROOT
 *     equivalent, unlike `toLocaleLowerCase`).
 *   - `it.isLetter()` → `/\p{L}/u` (Unicode property escapes; identical to
 *     `Character.isLetter` for every code point Kotlin accepts).
 *   - `buildList { … }` → array literals / loops with the same emission order.
 *
 * 2026-10-06 review fix: KeywordKeys.language() ran a single scan returning
 * the first ja-or-zh char; Kotlin evaluates three independent `any` scans,
 * so any Japanese char anywhere in the string wins. The TS version now does
 * the same two-pass count (`hasJa` → `hasZh` → letter test).
 */

import { compact } from '../../data/titleNormalizer';

/** Metadata changes requests only. It never filters a source's returned books. */
export interface KeywordName {
  readonly text: string;
  readonly language: string;
}

export interface KeywordConcept {
  readonly id: string;
  readonly names: KeywordName[];
  readonly source: string;
}

/** Kotlin `val KeywordConcept.kind: String get() = …` (lines 13-20). */
export function kindOf(concept: KeywordConcept): string {
  const id = concept.id;
  if (
    id.startsWith('seed:common:') ||
    id.startsWith('ehtag:female:') ||
    id.startsWith('ehtag:male:') ||
    id.startsWith('ehtag:mixed:') ||
    id.startsWith('ehtag:other:')
  ) {
    return 'common';
  }
  if (id.includes(':character:')) return 'character';
  if (
    id.includes(':artist:') ||
    id.includes(':person:') ||
    id.includes(':author:') ||
    id.includes(':staff:') ||
    id.includes(':creator:')
  ) {
    return 'person';
  }
  if (
    id.includes(':parody:') ||
    id.includes(':work:') ||
    id.includes(':media:') ||
    id.includes(':subject:')
  ) {
    return 'work';
  }
  return 'unknown';
}

export interface KeywordProviderState {
  readonly provider: string;
  readonly outcome: string;
  readonly retryAt: number;
  readonly detail: string;
}

/** Kotlin `val KeywordProviderState.displayName` (lines 25-32). */
export function providerDisplayName(provider: string): string {
  switch (provider) {
    case 'wikidata':
      return 'Wikidata';
    case 'bangumi:subjects':
      return 'Bangumi 作品';
    case 'bangumi:characters':
      return 'Bangumi 角色';
    case 'bangumi:persons':
      return 'Bangumi 人物';
    case 'anilist':
      return 'AniList';
    default:
      return '名称查询';
  }
}

export interface OnlineKeywordResult {
  readonly concepts: KeywordConcept[];
  readonly states: KeywordProviderState[];
  readonly cached: boolean;
  readonly persisted: boolean;
}

export interface KeywordUpdate {
  readonly added: string[];
  readonly status: string;
  readonly origins: Record<string, string>;
  readonly providers: KeywordProviderState[];
}

/** Completeness belongs to one entity, never the union of unrelated search candidates. */

/** Kotlin `KeywordConcepts.complete(concepts)` (lines 49-54). */
export function complete(concepts: KeywordConcept[]): boolean {
  if (concepts.length === 0) return false;
  return concepts.every((c) => {
    const languages = new Set(c.names.map((it) => it.language));
    const native = languages.has('ja') || languages.has('native');
    if (!native) return false;
    return kindOf(c) === 'work' || kindOf(c) === 'common'
      ? languages.has('en')
      : [...languages].some((it) => it === 'en' || it === 'romaji' || it === 'latin');
  });
}

/** Kotlin `KeywordConcepts.merge(concepts)` (lines 56-76). */
export function merge(concepts: KeywordConcept[]): KeywordConcept[] {
  const merged: KeywordConcept[] = [];
  for (const concept of concepts) {
    const index = merged.findIndex((old) => {
      const oldKeys = new Set(old.names.map((it) => match(it.text)));
      const conceptKeys = new Set(concept.names.map((it) => match(it.text)));
      const shared = [...oldKeys].filter((key) => conceptKeys.has(key) && key.trim() !== '');
      const unknownBridge = (kindOf(old) === 'unknown') !== (kindOf(concept) === 'unknown') && shared.length >= 2;
      const sameKindBridge =
        kindOf(old) === kindOf(concept) &&
        kindOf(old) !== 'unknown' &&
        old.names.some((a) => {
          if (a.language === 'zh' || a.language === 'alias') return false;
          return concept.names.some(
            (b) =>
              b.language !== 'zh' &&
              b.language !== 'alias' &&
              match(a.text) === match(b.text),
          );
        });
      return old.id === concept.id || unknownBridge || sameKindBridge;
    });
    if (index < 0) {
      merged.push(concept);
      continue;
    }
    const slot = index;
    const old = merged[slot] as KeywordConcept;
    const primary = kindOf(old) === 'unknown' && kindOf(concept) !== 'unknown' ? concept : old;
    merged[slot] = {
      ...primary,
      names: dedupeNames([...old.names, ...concept.names]),
      source: [...new Set([...splitSources(old.source), ...splitSources(concept.source)])].join(' + '),
    };
  }
  return merged;
}

/** Kotlin `old.names + concept.names).distinct()` — data-class equality on both fields. */
function dedupeNames(names: KeywordName[]): KeywordName[] {
  const seen = new Set<string>();
  const out: KeywordName[] = [];
  for (const name of names) {
    const key = `${name.text}${name.language}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Kotlin `old.source.split(" + ")`. */
function splitSources(source: string): string[] {
  return source.split(' + ');
}

export const KeywordKeys = {
  match,
  query,
  language,
  isPlain,
};

/** Kotlin `KeywordKeys.match(text)` = `TitleNormalizer.compact(text)`. */
export function match(text: string): string {
  return compact(text);
}

// Never fold CJK, remove punctuation or remove Japanese vowel marks here.
/** Kotlin `KeywordKeys.query(text)`. */
export function query(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Kotlin `KeywordKeys.language(text)`. */
export function language(text: string): string {
  // Kotlin evaluates three independent `any` scans — a Japanese char ANYWHERE
  // wins over a Chinese char that appears earlier in the string.
  let hasJa = false;
  let hasZh = false;
  let hasLetter = false;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code == null) continue;
    if (code >= 0x3040 && code <= 0x30ff) hasJa = true;
    else if (code >= 0x4e00 && code <= 0x9fff) hasZh = true;
    if (/\p{L}/u.test(ch)) hasLetter = true;
  }
  if (hasJa) return 'ja';
  if (hasZh) return 'zh';
  if (hasLetter) return 'en';
  return 'und';
}

// Preserve an explicitly written search expression instead of silently rewriting it.
/** Kotlin `KeywordKeys.isPlain(text)`. */
export function isPlain(text: string): boolean {
  const lengthOk = text.length >= 1 && text.length <= 160;
  if (!lengthOk) return false;
  return !/["$\\]|(?:^|\s)[-~]|[a-zA-Z]+:/.test(text);
}

/** A Chinese given name separated from a surname is a reliable short form.
 * Do not turn arbitrary prefixes, surnames or substrings into aliases. */
export const KeywordPersonNames = {
  shortForms,
  rank,
};

/** Kotlin `KeywordPersonNames.shortForms(text)` (lines 100-105). */
export function shortForms(text: string): string[] {
  const parts = text.split(/[·・•‧･]/).map((part) => part.trim());
  if (parts.length < 2) return [];
  // Only the first name, never the family name after the separator.
  const first = parts[0] as string;
  const allCjk = [...first].every((ch) => {
    const code = ch.codePointAt(0);
    return code != null && code >= 0x4e00 && code <= 0x9fff;
  });
  return first.length >= 2 && first.length <= 6 && allCjk ? [first] : [];
}

/** Kotlin `KeywordPersonNames.rank(names, keys, allowShortName)` (lines 107-113). */
export function rank(
  names: KeywordName[],
  keys: Set<string>,
  allowShortName: boolean,
): number | null {
  if (names.some((it) => keys.has(match(it.text)))) return 0;
  if (allowShortName) {
    const zhNames = names.filter((it) => it.language === 'zh');
    const anyShort = zhNames.some((name) =>
      shortForms(name.text).some((form) => keys.has(match(form))),
    );
    if (anyShort) return 1;
  }
  return null;
}

/** Kotlin `KeywordVariants.LIMIT`. */
export const VARIANT_LIMIT = 6;

export const KeywordVariants = {
  LIMIT: VARIANT_LIMIT,
  compose,
  prioritized,
};

/** Whole names win over splitting (e.g. a title containing spaces). */
/** Kotlin `KeywordVariants.compose(input, parts, concepts)` (lines 120-134). */
export function compose(
  _input: string,
  parts: string[],
  concepts: KeywordConcept[][],
): KeywordName[] {
  if (parts.length === 1) {
    return (concepts[0] as KeywordConcept[]).flatMap((it) => it.names);
  }
  const out: KeywordName[] = [];
  for (const lang of ['en', 'ja', 'romaji', 'zh']) {
    let mapped = false;
    const words = parts.map((original, i) => {
      const group = concepts[i] as KeywordConcept[];
      const names = group
        .flatMap((it) => it.names)
        .filter((it) => query(it.text) !== query(original));
      const picked =
        names.find((it) => it.language === lang) ??
        names.find((it) => (lang === 'ja' && it.language === 'native') || (lang === 'en' && it.language === 'latin'));
      if (picked === undefined) return original;
      mapped = true;
      return picked.text;
    });
    if (mapped) out.push({ text: words.join(' '), language: lang });
  }
  return out;
}

/** Kotlin `KeywordVariants.prioritized(names)` (lines 136-155). */
export function prioritized(names: KeywordName[]): KeywordName[] {
  // Resolve labels before textual deduplication, so a Chinese alias cannot hide
  // an explicitly identified Japanese/native spelling with the same text.
  const order = ['en', 'ja', 'native', 'romaji', 'latin', 'alias', 'zh', 'und'];
  const usable = names.filter((it) => it.text.trim() !== '' && it.text.length <= 160);
  const byText = new Map<string, KeywordName[]>();
  for (const name of usable) {
    const key = query(name.text);
    const bucket = byText.get(key);
    if (bucket === undefined) byText.set(key, [name]);
    else bucket.push(name);
  }
  const distinct = [...byText.values()].map((same) => {
    let best = same[0] as KeywordName;
    let bestRank = rankOf(best.language);
    for (const candidate of same) {
      const candidateRank = rankOf(candidate.language);
      if (candidateRank < bestRank) {
        best = candidate;
        bestRank = candidateRank;
      }
    }
    return best;
  });

  const groupKeys = new Set<string>();
  const grouped = new Map<string, KeywordName[]>();
  for (const name of distinct) {
    const key = name.language === 'native' ? 'ja' : name.language;
    groupKeys.add(key);
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [name]);
    else bucket.push(name);
  }
  // Kotlin `mapValues { … }` for the alias group.
  const aliasGroup = grouped.get('alias');
  if (aliasGroup !== undefined) {
    grouped.set(
      'alias',
      aliasGroup
        .slice()
        .sort((a, b) => aliasSortKey(a) - aliasSortKey(b)),
    );
  }

  const priorities = [...new Set([...order, ...groupKeys])];
  const maxSize = Math.max(0, ...[...grouped.values()].map((rows) => rows.length));
  const out: KeywordName[] = [];
  for (let i = 0; i < maxSize; i += 1) {
    for (const lang of priorities) {
      const name = grouped.get(lang)?.[i];
      if (name !== undefined) out.push(name);
    }
  }
  return out;
}

/** Kotlin `order.indexOf(it.language).takeIf { rank >= 0 } ?: 99`. */
function rankOf(language: string): number {
  const idx = ['en', 'ja', 'native', 'romaji', 'latin', 'alias', 'zh', 'und'].indexOf(language);
  return idx >= 0 ? idx : 99;
}

/** Kotlin `(if (all ascii && length <= 40) 0 else 1000) + text.length`. */
function aliasSortKey(name: KeywordName): number {
  const allAscii = [...name.text].every((ch) => (ch.codePointAt(0) ?? 0) < 128);
  return (allAscii && name.text.length <= 40 ? 0 : 1000) + name.text.length;
}

export const KeywordConcepts = { complete, merge };