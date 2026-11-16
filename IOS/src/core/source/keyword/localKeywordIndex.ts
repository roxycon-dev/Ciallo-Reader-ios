/**
 * Android `com.example.source.keyword.LocalKeywordIndex.kt` (29 lines, 25 non-blank)
 * → `src/core/source/keyword/localKeywordIndex.ts`.
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-2     package/imports                            → header + imports
 *   5       class KDoc (Small curated seed, …)          → header comment (verbatim)
 *   6       class LocalKeywordIndex(reader: Reader)     → constructor taking a reader factory
 *   7       index map                                  → `index` Map
 *   9-26    init { reader.buffered().useLines { … } }    → static `create`/`parse` from a string
 *   28      find()                                     → find()
 *
 * Skipped lines / adaptations:
 *   - `java.io.Reader` → the caller supplies the raw UTF-8 text (`assets.open(…)
 *     .reader(UTF_8)` in Kotlin). Splitting happens in JS, so the `buffered()`
 *     and `useLines` plumbing disappears; the line filter, the 5-field check,
 *     the per-language `|` split and the index construction are unchanged.
 *   - `require(fields.size == 5) { "Invalid keyword seed row" }` → the same
 *     `throw new Error('Invalid keyword seed row')`, including on the
 *     un-`#`-prefixed, non-blank rows only (blank/`#` lines are still skipped
 *     first, exactly as in Kotlin).
 *   - `KeywordConcept("seed:${fields[0]}:${KeywordKeys.match(…)}")` string
 *     template is preserved verbatim.
 */

import type { KeywordConcept, KeywordName } from './keywordModels';
import { match } from './keywordModels';

/** Small curated seed, not a promise that every word or proper name exists locally. */
export class LocalKeywordIndex {
  private readonly index = new Map<string, KeywordConcept[]>();

  private constructor(concepts: KeywordConcept[]) {
    for (const concept of concepts) {
      const keys = concept.names
        .map((it) => match(it.text))
        .filter((key) => key.trim() !== '')
        .filter((key, i, all) => all.indexOf(key) === i);
      for (const key of keys) {
        const bucket = this.index.get(key);
        if (bucket === undefined) this.index.set(key, [concept]);
        else bucket.push(concept);
      }
    }
  }

  /** Kotlin `init { … }` — builds the index from the seed text. */
  static fromText(text: string): LocalKeywordIndex {
    const concepts: KeywordConcept[] = [];
    for (const rawLine of text.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line.trim() === '' || line.startsWith('#')) continue;
      const fields = line.split('\t');
      if (fields.length !== 5) {
        throw new Error('Invalid keyword seed row');
      }
      const names: KeywordName[] = [];
      for (const value of (fields[1] as string).split('|')) {
        if (value.trim() !== '') names.push({ text: value, language: 'zh' });
      }
      for (const value of (fields[2] as string).split('|')) {
        if (value.trim() !== '') names.push({ text: value, language: 'en' });
      }
      for (const value of (fields[3] as string).split('|')) {
        if (value.trim() !== '') names.push({ text: value, language: 'ja' });
      }
      for (const value of (fields[4] as string).split('|')) {
        if (value.trim() !== '') names.push({ text: value, language: 'romaji' });
      }
      const head = (fields[1] as string).split('|')[0] as string;
      concepts.push({
        id: `seed:${fields[0]}:${match(head)}`,
        names,
        source: 'curated-v1',
      });
    }
    return new LocalKeywordIndex(concepts);
  }

  /** Kotlin `fun find(input: String): List<KeywordConcept>`. */
  find(input: string): KeywordConcept[] {
    return this.index.get(match(input)) ?? [];
  }
}