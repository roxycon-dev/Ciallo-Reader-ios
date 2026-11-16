/**
 * Fails if the TS `CjkFoldMap` PAIRS table or the `TitleNormalizer` punctuation
 * class drifts from the Android original. Reads the two Kotlin files verbatim
 * and compares them to the ported tables pair-by-pair / char-by-char.
 *
 * Android originals (read-only):
 *   novel-reader/app/src/main/java/com/example/source/anilist/CjkFoldMap.kt
 *   novel-reader/app/src/main/java/com/example/source/anilist/TitleNormalizer.kt
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { androidReference } from '../helpers/androidReference';
import { describe, expect, it } from 'vitest';
import { CJK_FOLD_PAIR_COUNT, foldChar } from '../../src/core/data/cjkFoldMap';

const KOTLIN_DIR = 'app/src/main/java/com/example/source/anilist';

const kotlinPairs = ((): string => {
  const src = readFileSync(androidReference(`${KOTLIN_DIR}/CjkFoldMap.kt`), 'utf8');
  const m = /private const val PAIRS =\s*\n?\s*"([^"]*)"/.exec(src);
  if (m === null || m[1] === undefined) throw new Error('Kotlin PAIRS not found');
  return m[1];
})();

const kotlinPunctClass = ((): string => {
  const src = readFileSync(androidReference(`${KOTLIN_DIR}/TitleNormalizer.kt`), 'utf8');
  const m = /Regex\("(\[[^"]*)"\)/.exec(src);
  if (m === null || m[1] === undefined) throw new Error('Kotlin PUNCTUATION not found');
  return m[1];
})();

const tsPairsSource = readFileSync(
  path.resolve(import.meta.dirname, '../../src/core/data/cjkFoldMap.ts'),
  'utf8',
);
const tsPairs = ((): string => {
  const m = /const PAIRS =\s*\n?\s*'([^']*)';/m.exec(tsPairsSource);
  if (m === null || m[1] === undefined) throw new Error('TS PAIRS not found');
  return m[1];
})();

function cp(c: string): string {
  return (c.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0');
}

/** every entry of the ported table, as [traditional, simplified] tuples */
function tsPairList(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i + 1 < tsPairs.length; i += 2) {
    out.push([tsPairs[i] as string, tsPairs[i + 1] as string]);
  }
  return out;
}

describe('CjkFoldMap — parity with Android CjkFoldMap.kt', () => {
  it('the PAIRS table is byte-for-byte identical to the Kotlin constant', () => {
    expect(tsPairs).toBe(kotlinPairs);
  });

  it('has the same length and an even (pair-aligned) character count', () => {
    expect(tsPairs.length).toBe(kotlinPairs.length);
    expect(tsPairs.length % 2).toBe(0);
  });

  it('builds exactly one entry per pair (no duplicate-key collapse)', () => {
    expect(CJK_FOLD_PAIR_COUNT).toBe(tsPairs.length / 2);
  });

  it('every traditional character folds to its simplified counterpart', () => {
    const pairs = tsPairList();
    expect(pairs.length).toBeGreaterThan(500);
    const bad: string[] = [];
    for (const [trad, simp] of pairs) {
      if ([...trad].length !== 1) bad.push(`trad not 1 char: U+${cp(trad)}`);
      if ([...simp].length !== 1) bad.push(`simp not 1 char: U+${cp(simp)}`);
      if (foldChar(trad) !== simp) bad.push(`foldChar(U+${cp(trad)}) = U+${cp(foldChar(trad))} != U+${cp(simp)}`);
    }
    expect(bad).toEqual([]);
  });

  it('folds nothing that is not in the table', () => {
    for (const ch of ['无', '职', '转', '生', 'a', 'Z', '1', ' ', 'ー', 'の']) {
      if (tsPairs.includes(ch)) continue;
      expect(foldChar(ch)).toBe(ch);
    }
    expect(foldChar('')).toBe('');
  });

  it('duplicate traditional keys exist in Kotlin too (last-wins parity)', () => {
    // Kotlin buildMap{} also overwrites, so a duplicated key must resolve the
    // same way on both sides rather than silently differing.
    const kotlinMap = new Map<string, string>();
    for (let i = 0; i + 1 < kotlinPairs.length; i += 2) {
      kotlinMap.set(kotlinPairs[i] as string, kotlinPairs[i + 1] as string);
    }
    for (const [trad, simp] of kotlinMap) {
      expect(foldChar(trad)).toBe(simp);
    }
  });

  it('spot-checks the documented motivating example 無職転生 → 无职转生', () => {
    expect([...'無職転生'].map((c) => foldChar(c)).join('')).toBe('无职转生');
  });
});

describe('TitleNormalizer — punctuation class parity', () => {
  const tsPunctSource = readFileSync(
    path.resolve(import.meta.dirname, '../../src/core/data/titleNormalizer.ts'),
    'utf8',
  );
  // Compare the *effective* character class, not the raw source text: the Kotlin
  // source spells the class as `[!-/:-@\[-`{-~…]` (escaped `[`), the TS source as
  // `[!-/:-@[-`{-~…]` (leading `[`, literal). Both are the same class, and Java
  // and JS share this regex syntax, so the Kotlin class can be evaluated directly.
  const ktBody = kotlinPunctClass.slice(1, -1);
  const tsBody = ((): string => {
    const m = /const PUNCTUATION =\s*\n?\s*\/\[(.*)\]\/g;/m.exec(tsPunctSource);
    if (m === null || m[1] === undefined) throw new Error('TS PUNCTUATION not found');
    return m[1].replace('\\u3000', '\u3000');
  })();
  const ktClass = new RegExp(`[${ktBody}]`);
  const tsClass = new RegExp(`[${tsBody}]`);

  it('matches exactly the same punctuation characters as the Kotlin class', () => {
    const probes = [
      ...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
      ...'　。、・「」『』（）【】《》〈〉“”‘’…―ー･：；！？，．',
      ...'abcXYZ019あア한ก ',
    ];
    const mismatches = probes
      .filter((c) => ktClass.test(c) !== tsClass.test(c))
      .map((c) => `${c}[U+${cp(c)}] kt=${ktClass.test(c)} ts=${tsClass.test(c)}`);
    expect(mismatches).toEqual([]);
  });

  it('covers the full ASCII punctuation set (every ASCII punctuation code point)', () => {
    for (let code = 0; code < 0x7f; code += 1) {
      const c = String.fromCharCode(code);
      if (!/[!-/:-@[-`{-~]/.test(c)) continue;
      expect(`${c}[U+${cp(c)}]: ${tsClass.test(c)}`).toBe(`${c}[U+${cp(c)}]: true`);
    }
  });

  it('covers the CJK punctuation the port lists', () => {
    const listed = [...'　。、・「」『』（）【】《》〈〉“”‘’…―ー･：；！？，．'];
    const missing = listed.filter((c) => !tsClass.test(c)).map((c) => `U+${cp(c)}`);
    expect(missing).toEqual([]);
  });

  it('does not fold ASCII letters, digits or whitespace into spaces', () => {
    for (const c of [...'abcXYZ0189 \t\n']) {
      expect(`${c}: ${tsClass.test(c)}`).toBe(`${c}: false`);
    }
  });
});
