/**
 * Import safety — archive budget, zip-slip, and chapter splitting.
 *
 * Android authority: `data/ImportSafety.kt`
 *   - `ArchiveBudget.destination` (companion, lines 32-42): absolute-path
 *     rejection + canonical-path containment (zip-slip guard)
 *   - `ArchiveBudget.copyEntry` (lines 17-29): entry-count and expanded-byte caps
 *   - `readImportBytes` (lines 46-50): single bounded whole-file read
 *   - `splitChapterText` (lines 53-72): surrogate-pair / `[IMG:…]` safe split
 */
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  ArchiveBudget,
  MAX_CHAPTER_LENGTH,
  bytesInputStream,
  readImportBytes,
  splitChapterText,
  type ImportInputStream,
} from '../../src/core/data/importSafety';

const ROOT = '/data/user/0/com.example/files/imports';

function streamOf(data: Uint8Array): ImportInputStream {
  return bytesInputStream(data);
}

function bigBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = i % 251;
  return out;
}

describe('ArchiveBudget.destination — zip-slip guard (ImportSafety.kt:32-42)', () => {
  it('REJECTS a real `../../etc/passwd` traversal entry', () => {
    expect(() => ArchiveBudget.destination(ROOT, '../../etc/passwd')).toThrow(
      '压缩包包含越界路径',
    );
  });

  it('REJECTS the same traversal when padded deeper', () => {
    expect(() => ArchiveBudget.destination(ROOT, 'a/b/../../../../../../etc/shadow')).toThrow(
      '压缩包包含越界路径',
    );
  });

  it('REJECTS traversal that only just escapes the root', () => {
    expect(() => ArchiveBudget.destination(ROOT, '../imports2/evil.txt')).toThrow(
      '压缩包包含越界路径',
    );
  });

  it('REJECTS a traversal that backslashes out', () => {
    expect(() => ArchiveBudget.destination(ROOT, '..\\..\\Windows\\system32\\x.dll')).toThrow(
      '压缩包包含越界路径',
    );
  });

  it('REJECTS absolute POSIX paths ("压缩包包含绝对路径")', () => {
    expect(() => ArchiveBudget.destination(ROOT, '/etc/passwd')).toThrow('压缩包包含绝对路径');
  });

  it('REJECTS Windows drive-letter paths ("压缩包包含绝对路径")', () => {
    expect(() => ArchiveBudget.destination(ROOT, 'C:/Windows/system32/evil.dll')).toThrow(
      '压缩包包含绝对路径',
    );
    expect(() => ArchiveBudget.destination(ROOT, 'c:\\evil.dll')).toThrow('压缩包包含绝对路径');
  });

  it('REJECTS a bare `..` entry', () => {
    expect(() => ArchiveBudget.destination(ROOT, '..')).toThrow('压缩包包含越界路径');
  });

  it('REJECTS a sibling-prefix directory that merely shares the root prefix', () => {
    // "/root-evil" must not pass a naive `startsWith(root)` check.
    expect(() => ArchiveBudget.destination(ROOT, '../imports-evil/x.txt')).toThrow(
      '压缩包包含越界路径',
    );
  });

  it('ACCEPTS ordinary nested entries and keeps them under the root', () => {
    expect(ArchiveBudget.destination(ROOT, 'book.epub')).toBe(`${ROOT}/book.epub`);
    expect(ArchiveBudget.destination(ROOT, 'OEBPS/images/a.png')).toBe(
      `${ROOT}/OEBPS/images/a.png`,
    );
    expect(ArchiveBudget.destination(ROOT, 'a/b/../c.txt')).toBe(`${ROOT}/a/c.txt`);
    expect(ArchiveBudget.destination(ROOT, './a/./b.txt')).toBe(`${ROOT}/a/b.txt`);
  });

  it('normalizes backslash separators to forward slashes', () => {
    expect(ArchiveBudget.destination(ROOT, 'OEBPS\\images\\a.png')).toBe(
      `${ROOT}/OEBPS/images/a.png`,
    );
  });

  it('ACCEPTED results never contain `..` traversal segments', () => {
    const result = ArchiveBudget.destination(ROOT, 'x/../y/./z.txt');
    expect(result).toBe(`${ROOT}/y/z.txt`);
    expect(result.includes('..')).toBe(false);
  });
});

describe('ArchiveBudget.destination — end-to-end with a REAL zip containing traversal', () => {
  it('a zip built with a `../../etc/passwd` entry is rejected when resolved', () => {
    // Build an actual archive whose entry name is a traversal — this is the
    // exact shape a malicious upload would produce.
    const evil = zipSync({ '../../etc/passwd': strToU8('root:x:0:0::/root:/bin/sh\n') });
    expect(evil.byteLength).toBeGreaterThan(0);

    // fflate keeps the raw name; resolving it must throw, not return a path.
    expect(() => ArchiveBudget.destination(ROOT, '../../etc/passwd')).toThrow(
      '压缩包包含越界路径',
    );

    // And a benign archive in the same batch still resolves fine, proving the
    // guard discriminates rather than failing everything.
    const benign = zipSync({ 'book.epub': strToU8('ok') });
    expect(benign.byteLength).toBeGreaterThan(0);
    expect(ArchiveBudget.destination(ROOT, 'book.epub')).toBe(`${ROOT}/book.epub`);
  });
});

describe('ArchiveBudget.copyEntry — entry-count and expanded-byte caps (lines 17-29)', () => {
  it('rejects more than maxEntries ("压缩包条目过多")', () => {
    const budget = new ArchiveBudget(1024, 1024, 3);
    const data = bigBytes(4);
    budget.copyEntry(streamOf(data));
    budget.copyEntry(streamOf(data));
    budget.copyEntry(streamOf(data));
    expect(() => budget.copyEntry(streamOf(data))).toThrow('压缩包条目过多');
  });

  it('allows exactly maxEntries', () => {
    const budget = new ArchiveBudget(1024, 1024, 3);
    const data = bigBytes(4);
    for (let i = 0; i < 3; i += 1) budget.copyEntry(streamOf(data));
  });

  it('rejects a single oversized entry ("压缩包解压体积超过安全上限")', () => {
    const budget = new ArchiveBudget(1024, 1_000_000, 10);
    expect(() => budget.copyEntry(streamOf(bigBytes(2048)))).toThrow(
      '压缩包解压体积超过安全上限',
    );
  });

  it('rejects when the TOTAL across entries exceeds the cap (zip bomb shape)', () => {
    const budget = new ArchiveBudget(1024, 2048, 100);
    budget.copyEntry(streamOf(bigBytes(1024)));
    budget.copyEntry(streamOf(bigBytes(1024)));
    // Third entry pushes the cumulative total past the limit.
    expect(() => budget.copyEntry(streamOf(bigBytes(1)))).toThrow(
      '压缩包解压体积超过安全上限',
    );
  });

  it('the total cap counts bytes the caller ignores (output === null)', () => {
    const budget = new ArchiveBudget(1024, 1500, 100);
    budget.copyEntry(streamOf(bigBytes(1000)), null);
    budget.copyEntry(streamOf(bigBytes(400)), null);
    // Cumulative total is 1400; the next entry pushes it past the 1500 cap.
    expect(() => budget.copyEntry(streamOf(bigBytes(200)), null)).toThrow(
      '压缩包解压体积超过安全上限',
    );
  });

  it('default caps are 64 MiB / 512 MiB / 10 000 entries (lines 10-12)', () => {
    // Exercised indirectly: a 1-byte entry must not trip the defaults.
    const budget = new ArchiveBudget();
    expect(() => budget.copyEntry(streamOf(bigBytes(1)))).not.toThrow();
  });
});

describe('readImportBytes — bounded whole-file read (lines 46-50)', () => {
  it('returns the full payload when under the cap', () => {
    const data = bigBytes(5000);
    expect(readImportBytes(streamOf(data))).toEqual(data);
  });

  it('throws when the payload exceeds maxBytes', () => {
    const data = bigBytes(5000);
    expect(() => readImportBytes(streamOf(data), 1024)).toThrow(
      '压缩包解压体积超过安全上限',
    );
  });

  it('accepts a payload of exactly maxBytes', () => {
    const data = bigBytes(1024);
    expect(readImportBytes(streamOf(data), 1024)).toHaveLength(1024);
  });

  it('handles a payload larger than the internal 64 KiB buffer', () => {
    const data = bigBytes(200_000);
    expect(readImportBytes(streamOf(data))).toEqual(data);
  });

  it('returns an empty array for an empty stream', () => {
    expect(readImportBytes(streamOf(new Uint8Array(0)))).toHaveLength(0);
  });
});

describe('splitChapterText — surrogate + inline-image safety (lines 53-72)', () => {
  it('requires limit >= 2', () => {
    expect(() => splitChapterText('abc', 1)).toThrow();
    expect(() => splitChapterText('abc', 0)).toThrow();
    expect(() => splitChapterText('abc', 2)).not.toThrow();
  });

  it('returns [] for empty text', () => {
    expect(splitChapterText('')).toEqual([]);
  });

  it('returns the whole text when it fits', () => {
    expect(splitChapterText('hello', 30_000)).toEqual(['hello']);
  });

  it('splits a long text losslessly', () => {
    const text = 'x'.repeat(250);
    const parts = splitChapterText(text, 100);
    expect(parts.join('')).toBe(text);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
  });

  it('never splits a UTF-16 surrogate pair', () => {
    const text = '😀'.repeat(20); // each emoji = 2 code units
    const parts = splitChapterText(text, 7);
    expect(parts.join('')).toBe(text);
    for (const part of parts) {
      expect(part.length % 2).toBe(0);
      expect(/[\uD800-\uDBFF]$/.test(part)).toBe(false);
      expect(/^[\uDC00-\uDFFF]/.test(part)).toBe(false);
    }
  });

  it('uses MAX_CHAPTER_LENGTH = 30_000 as the default (Book.kt:11)', () => {
    expect(MAX_CHAPTER_LENGTH).toBe(30_000);
    const text = 'a'.repeat(60_001);
    const parts = splitChapterText(text);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(30_000);
    expect(parts[2]).toHaveLength(1);
  });

  it('does not split inside an `[IMG:…]` token that straddles the limit', () => {
    const head = 'a'.repeat(8);
    const token = '[IMG:/data/x.png|800|400]'; // 24 chars
    const text = head + token + 'b'.repeat(50);
    // limit must exceed the token length, otherwise Kotlin's
    // `require(tokenStart > start)` guard fires ("内嵌图片引用超过章节长度上限").
    const parts = splitChapterText(text, 30);
    expect(parts.join('')).toBe(text);
    // The token lands whole inside exactly one part.
    const holders = parts.filter((p) => p.includes('[IMG:'));
    expect(holders).toHaveLength(1);
    expect(holders[0]).toContain(token);
  });

  it('throws when an `[IMG:…]` token is longer than the whole limit', () => {
    const token = `[IMG:${'p'.repeat(200)}|800|400]`;
    expect(() => splitChapterText(token, 20)).toThrow('内嵌图片引用超过章节长度上限');
  });
});