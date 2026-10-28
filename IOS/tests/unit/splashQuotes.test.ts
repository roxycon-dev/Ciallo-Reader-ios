/**
 * Kotlin → TS map
 * ──────────────
 * Tests for `src/core/mascot/splashQuotes.ts` — the port of
 * `novel-reader/app/src/main/res/values/splash_quotes.xml`
 * (`<string-array name="splash_quotes">`), consumed by `ui/SplashScreen.kt` L52-56.
 *
 * Nothing skipped. Every assertion targets either an Android source fact or a
 * `SplashScreen.kt` expression.
 *
 * ⚠️ COUNT: the resource holds **100** `<item>` entries, not 110. Verified by counting
 * `<item>` occurrences in the XML (see `countAssertion` below). The port asserts 100.
 *
 * The three layers of pinning, cheapest first:
 *   1. length            — catches a dropped/duplicated tail
 *   2. per-entry shape   — catches a truncated or reformatted entry
 *   3. SHA-256 checksum  — catches ANY single-character drift anywhere, including a
 *                         homoglyph swap that still satisfies (1) and (2)
 * Layer 3 is the load-bearing one.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { androidReference } from '../helpers/androidReference';
import { describe, expect, it } from 'vitest';

import {
  SPLASH_QUOTES,
  SPLASH_QUOTES_FALLBACK,
  randomPosterStyle,
  randomSplashQuote,
} from '../../src/core/mascot/splashQuotes';

/**
 * `<string-array name="splash_quotes">` in `res/values/splash_quotes.xml`.
 * Counted from the XML, not assumed.
 */
const XML_ITEM_COUNT = 100;

/**
 * SHA-256 over the 100 entries joined with "\n", computed from the Android XML with
 * `node -e` reading it as UTF-8 (never via a PowerShell pipe — the console codepage
 * would corrupt the CJK text). Any edit to a single character in `SPLASH_QUOTES`
 * changes this digest and fails the test below.
 */
const XML_SHA256 = '3752d351a76df63d1cf6e84b127178102f397f4dbacd8a66aa82463fbece0b4b';

/** ` ——《` — U+0020, U+2014, U+2014, U+300A. Written as escapes so the expectation
 *  cannot itself be corrupted by an editor. `。 ——《` style spacing is verified below. */
const SEPARATOR = ' \u2014\u2014\u300A';
const CLOSE_BRACKET = '\u300b';

/** Path to the Android source, resolved relative to this test file. */
const ANDROID_XML = androidReference('app/src/main/res/values/splash_quotes.xml');

function readAndroidItems(): string[] {
  const xml = readFileSync(ANDROID_XML, 'utf8');
  const items: string[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let match = re.exec(xml);
  while (match !== null) {
    items.push(match[1] as string);
    match = re.exec(xml);
  }
  return items;
}

describe('R.array.splash_quotes — res/values/splash_quotes.xml', () => {
  it(`carries exactly ${XML_ITEM_COUNT} entries`, () => {
    expect(SPLASH_QUOTES).toHaveLength(XML_ITEM_COUNT);
  });

  it('is frozen so no caller can mutate the shared resource array', () => {
    expect(Object.isFrozen(SPLASH_QUOTES)).toBe(true);
  });

  it('has no duplicate entries (verified against the XML, which has none)', () => {
    expect(new Set(SPLASH_QUOTES).size).toBe(SPLASH_QUOTES.length);
  });

  it('every entry is `quote + " ——《source》"` with exactly one ASCII space separator', () => {
    for (const [i, quote] of SPLASH_QUOTES.entries()) {
      expect(quote, `entry ${i} must start with a non-empty quote body`).not.toBe('');
      expect(quote.endsWith(CLOSE_BRACKET), `entry ${i} must end with ${CLOSE_BRACKET}`).toBe(
        true,
      );
      const at = quote.indexOf(SEPARATOR);
      expect(at, `entry ${i} is missing the " ——《" separator`).toBeGreaterThan(0);
      // Exactly one separator => the attribution is unambiguous.
      expect(quote.indexOf(SEPARATOR, at + 1), `entry ${i} has a second separator`).toBe(-1);
      // One ASCII space, not U+3000 and not a newline: the Android Text node renders
      // the whole entry as a single wrapping paragraph (SplashScreen.kt L192-197).
      expect(quote, `entry ${i} must not contain a newline`).not.toMatch(/[\n\r]/);
      expect(quote, `entry ${i} must not contain an ideographic space`).not.toContain('\u3000');
      // Separator spacing: the character before "——" is U+0020.
      expect(quote.codePointAt(at), `entry ${i} separator must start with U+0020`).toBe(0x20);
      // Non-empty source attribution between 《 and 》, and nothing after 》.
      const source = quote.slice(at + SEPARATOR.length, quote.length - 1);
      expect(source.length, `entry ${i} must name a source`).toBeGreaterThan(0);
      expect(quote.slice(-1), `entry ${i} must end the string at 》`).toBe(CLOSE_BRACKET);
    }
  });

  it('SHA-256 of the entries joined with \\n matches the Android XML', () => {
    const joined = SPLASH_QUOTES.join('\n');
    expect(createHash('sha256').update(joined, 'utf8').digest('hex')).toBe(XML_SHA256);
  });

  it('first and last entries are byte-identical to the XML', () => {
    // Guards the checksum test with readable literals so a failure points at the culprit.
    expect(SPLASH_QUOTES[0]).toBe('如果不战斗，就无法获胜！ ——《进击的巨人》');
    expect(SPLASH_QUOTES[99]).toBe('如果这份感情能被称为爱，那这一定是世界上最悲伤的爱。 ——《紫罗兰永恒花园》');
  });

  // The strongest check: re-read the Android resource at test time and diff every
  // character. Skipped (not silently passed) when the read-only Android tree is absent,
  // e.g. a standalone checkout of the iOS port.
  const androidTreeAvailable = existsSync(ANDROID_XML);
  it.skipIf(!androidTreeAvailable)(
    'is character-for-character identical to the Android XML, in source order',
    () => {
      const items = readAndroidItems();
      expect(items).toHaveLength(XML_ITEM_COUNT);
      expect(SPLASH_QUOTES).toEqual(items);
      // Explicit code-point walk (not just ===, which compares UTF-16 units).
      items.forEach((item, i) => {
        const mine = [...(SPLASH_QUOTES[i] as string)];
        const theirs = [...item];
        expect(mine.length, `entry ${i} code-point count`).toBe(theirs.length);
        mine.forEach((c, k) => {
          expect(c.codePointAt(0), `entry ${i} code point ${k}`).toBe(theirs[k]?.codePointAt(0));
        });
      });
    },
  );
});

describe('SplashScreen.kt L54 — empty-array fallback', () => {
  it('equals the shipped resource’s first entry, as the Kotlin literal spells out', () => {
    expect(SPLASH_QUOTES_FALLBACK).toBe(SPLASH_QUOTES[0]);
    expect(SPLASH_QUOTES_FALLBACK).toBe('如果不战斗，就无法获胜！ ——《进击的巨人》');
  });
});

describe('SplashScreen.kt L56 — remember(splashQuotes) { splashQuotes.random() }', () => {
  it('picks index floor(r * size) for the injected RNG', () => {
    const size = SPLASH_QUOTES.length;
    // Midpoints: (i + 0.5) / size always lands in bucket i for every i, with no
    // float-boundary ambiguity (exact i / size is not safe — e.g. 29 / 100 * 100
    // evaluates to 28.999999999999996 in f64).
    for (let i = 0; i < size; i++) {
      expect(randomSplashQuote(() => (i + 0.5) / size)).toBe(SPLASH_QUOTES[i]);
    }
    // Bucket edges, checked on the exact powers of two that are representable.
    expect(randomSplashQuote(() => 0)).toBe(SPLASH_QUOTES[0]);
    expect(randomSplashQuote(() => 0.5)).toBe(SPLASH_QUOTES[size / 2]);
    expect(randomSplashQuote(() => 0.75)).toBe(SPLASH_QUOTES[(size * 3) / 4]);
  });

  it('reaches the last entry and clamps an RNG that returns exactly 1.0', () => {
    expect(randomSplashQuote(() => 0.999999999)).toBe(SPLASH_QUOTES[SPLASH_QUOTES.length - 1]);
    expect(randomSplashQuote(() => 1)).toBe(SPLASH_QUOTES[SPLASH_QUOTES.length - 1]);
  });

  it('always returns one of the resource entries', () => {
    let seed = 0;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 500; i++) {
      expect(SPLASH_QUOTES).toContain(randomSplashQuote(rng));
    }
  });
});

describe('SplashScreen.kt L62 — remember { (0..2).random() }', () => {
  it('maps (0..2) onto the ProceduralArtisticPoster styleIndex range', () => {
    expect(randomPosterStyle(() => 0)).toBe(0);
    expect(randomPosterStyle(() => 0.33)).toBe(0);
    expect(randomPosterStyle(() => 0.34)).toBe(1);
    expect(randomPosterStyle(() => 0.67)).toBe(2);
    expect(randomPosterStyle(() => 0.9)).toBe(2);
  });

  it('never leaves 0..2 even when the RNG returns 1.0', () => {
    expect(randomPosterStyle(() => 1)).toBe(2);
    for (const r of [0, 0.25, 0.5, 0.75, 0.999999, 1]) {
      const v = randomPosterStyle(() => r);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(2);
    }
  });
});
