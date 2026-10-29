import { describe, expect, it } from 'vitest';
import {
  ArchiveBudget,
  bytesInputStream,
  readImportBytes,
  splitChapterText,
} from '../../src/core/data/importSafety';

describe('importSafety / ArchiveBudget', () => {
  it('accepts nested relative paths under root', () => {
    expect(ArchiveBudget.destination('/data/files', 'images/page.jpg')).toBe('/data/files/images/page.jpg');
  });

  it('rejects absolute paths (posix and drive letters)', () => {
    expect(() => ArchiveBudget.destination('/data/files', '/outside.jpg')).toThrow(/绝对路径/);
    expect(() => ArchiveBudget.destination('/data/files', 'C:\\outside.jpg')).toThrow(/绝对路径/);
  });

  it('rejects zip-slip escapes with both separators', () => {
    for (const name of ['../outside.jpg', '..\\outside.jpg', 'images/../../outside.jpg']) {
      expect(() => ArchiveBudget.destination('/data/files', name)).toThrow(/越界路径/);
    }
  });

  it('enforces per-entry, total, and entry-count limits', () => {
    const budget = new ArchiveBudget(10, 15, 2);
    budget.copyEntry(bytesInputStream(new Uint8Array(10)));
    expect(() => budget.copyEntry(bytesInputStream(new Uint8Array(6)))).toThrow(/体积/);
    const entries = new ArchiveBudget(64 * 1024 * 1024, 512 * 1024 * 1024, 1);
    entries.copyEntry(bytesInputStream(new Uint8Array(0)));
    expect(() => entries.copyEntry(bytesInputStream(new Uint8Array(0)))).toThrow(/条目过多/);
  });

  it('streams bytes into an optional output sink', () => {
    const budget = new ArchiveBudget();
    const chunks: number[] = [];
    budget.copyEntry(bytesInputStream(new Uint8Array([1, 2, 3])), {
      write(buffer, offset, length) {
        for (let i = 0; i < length; i += 1) chunks.push(buffer[offset + i] as number);
      },
    });
    expect(chunks).toEqual([1, 2, 3]);
  });
});

describe('importSafety / readImportBytes', () => {
  it('reads a whole byte source', () => {
    const data = new Uint8Array(5).fill(7);
    expect(Array.from(readImportBytes(bytesInputStream(data)))).toEqual([7, 7, 7, 7, 7]);
  });

  it('caps the read at maxBytes', () => {
    const data = new Uint8Array(10);
    expect(() => readImportBytes(bytesInputStream(data), 5)).toThrow(/体积/);
  });

  it('reads in bounded chunks', () => {
    const data = new Uint8Array(200_000).fill(1);
    const out = readImportBytes(bytesInputStream(data));
    expect(out.length).toBe(200_000);
  });
});

describe('importSafety / splitChapterText', () => {
  it('returns the whole text when it fits', () => {
    expect(splitChapterText('short', 10)).toEqual(['short']);
  });

  it('returns no parts for empty input', () => {
    expect(splitChapterText('', 10)).toEqual([]);
  });

  it('rejects limits below 2', () => {
    expect(() => splitChapterText('abc', 1)).toThrow();
  });

  it('splits at the limit', () => {
    expect(splitChapterText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh']);
  });

  it('never splits a UTF-16 surrogate pair', () => {
    const text = `ab${'😀'}c`; // a b <high> <low> c
    expect(splitChapterText(text, 3)).toEqual(['ab', '😀c']);
  });

  it('never cuts an [IMG:...] token in half', () => {
    const text = `${'a'.repeat(9)}[IMG:p|1|1]bbbb`; // token is 11 chars
    const parts = splitChapterText(text, 11);
    expect(parts.join('')).toBe(text);
    expect(parts[0]).toBe('a'.repeat(9));
    expect(parts[1]).toBe('[IMG:p|1|1]');
    expect(parts[2]).toBe('bbbb');
  });

  it('throws when an image token exceeds the whole chapter limit', () => {
    expect(() => splitChapterText('[IMG:p|1|1]', 5)).toThrow(/内嵌图片引用/);
  });
});
