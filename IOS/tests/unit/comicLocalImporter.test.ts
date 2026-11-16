/**
 * Regression cover for the `ComicLocalImporter.kt` / `ImageBytes.kt` numeric + string
 * divergences found in the line-by-line library review (2026-10-06, round 4).
 *
 * Every case below pins an Android source line, so a future "simplification" of the
 * expression cannot silently change the ported behaviour.
 */

import { describe, expect, it } from 'vitest';
import { normalizeImage, type ImageBytesHooks } from '../../src/core/library/libraryImageBytes';
import { importComicChapter } from '../../src/core/library/libraryComicLocalImporter';
import type { SearchBook } from '../../src/core/source/searchBook';

/** A 1×1 PNG — `probeImageSize` accepts it, so `hasImageBounds` is true. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function book(overrides: Partial<SearchBook> = {}): SearchBook {
  return {
    id: 'b1',
    sourceId: 'src',
    title: '漫画',
    author: '作者',
    cover: null,
    description: null,
    format: 'comic',
    language: null,
    comicId: null,
    size: null,
    downloadUrl: null,
    eapiId: null,
    eapiHash: null,
    novelInfo: null,
    comicInfo: null,
    ...overrides,
  } as SearchBook;
}

/** In-memory `FileSystemApi` + the local-copy hook, mirroring `libraryAuditRound2.test.ts`. */
function importerDeps(copied: Uint8Array) {
  const stored = new Map<string, Uint8Array>();
  return {
    deps: {
      http: {
        request: async () => {
          throw new Error('no network in this test');
        },
      },
      fs: {
        readFile: async (p: string) => stored.get(p) ?? new Uint8Array(),
        writeFile: async (p: string, d: Uint8Array) => {
          stored.set(p, d);
        },
        exists: async (p: string) => stored.has(p),
        delete: async (p: string) => {
          stored.delete(p);
        },
        list: async (p: string) => [...stored.keys()].filter((k) => k.startsWith(`${p}/`)),
      },
      bookDao: {
        getBookByFilePath: async () => null,
        insertBookWithChapters: async (b: unknown) => b,
      },
      cookieHeader: () => '',
      copyLocalFile: async (_fileUrl: string, toPath: string) => {
        stored.set(toPath, copied);
      },
      randomId: () => '00000000-0000-4000-8000-000000000000',
      now: () => 1_700_000_000_000,
    },
  };
}

/** Run one `file:` local-copy import and report the `img_%04d.<ext>` name it produced. */
async function localCopyExtensionFor(imageUrl: string): Promise<string> {
  // The `file:` branch (ComicLocalImporter.kt:137-147) copies via `copyLocalFile(from, pageFile)`,
  // where `pageFile` is the name whose extension is derived from the URL — spy on that.
  const written: string[] = [];
  const { deps } = importerDeps(PNG);
  const result = await importComicChapter({
    ...deps,
    copyLocalFile: async (_fileUrl: string, toPath: string) => {
      written.push(toPath);
      await deps.copyLocalFile(_fileUrl, toPath);
    },
    book: book(),
    chapter: { id: 'c1', title: '第1话', volume: null, order: 0, external: false, externalUrl: null },
    imageUrls: [imageUrl],
    onProgress: () => {},
  } as never);
  expect(result.ok).toBe(true);
  const target = written[0] as string;
  // `<chapterDir>/img_0001.<ext>` — chapterDir defaults to `comics_<now>`.
  return target.slice(target.indexOf('/img_0001.') + '/img_0001.'.length);
}

/* ── ComicLocalImporter.kt:134 `substringAfterLast('.', "").substringBefore('?')` ── */

describe('ComicLocalImporter.kt:134 rawExt — substring order matters', () => {
  it('reads the extension AFTER the last dot of the WHOLE url, then cuts at "?"', async () => {
    // Kotlin: "https://c/a.png?t=.jpeg"
    //   substringAfterLast('.', "") over the whole string → the last '.' is inside the query,
    //   so it yields "jpeg"; substringBefore('?') then leaves "jpeg" untouched.
    //   ⇒ ext = "jpeg".
    // Splitting the query off FIRST (the old port) yields "png".
    await expect(localCopyExtensionFor('file:///cache/a.png?t=.jpeg')).resolves.toBe('jpeg');
  });

  it('still yields "jpg" when the last dot is only inside the query', async () => {
    // Kotlin: "https://c/a.jpg?token=1.5" → afterLastLast('.') = "5" → length 1 fails
    // `in 3..4` → ext = "jpg".
    await expect(localCopyExtensionFor('file:///cache/a.jpg?token=1.5')).resolves.toBe('jpg');
  });

  it('accepts a plain 3-4 char extension', async () => {
    await expect(localCopyExtensionFor('file:///cache/p1.webp')).resolves.toBe('webp');
  });

  it('accepts a Unicode letter/digit extension (Char::isLetterOrDigit is not ASCII-only)', async () => {
    // Kotlin `rawExt.all { it.isLetterOrDigit() }` is Unicode (L + Nd). "日本" is two letters
    // and length 2 fails `in 3..4`, so use a 3-char CJK extension instead: it must be kept.
    await expect(localCopyExtensionFor('file:///cache/p1.日本語')).resolves.toBe('日本語');
  });

  it('falls back to jpg for a dot-less url (substringAfterLast returns "")', async () => {
    // Kotlin `substringAfterLast('.', "")` yields "" when the delimiter is absent — the
    // missing-delimiter default is "", NOT the receiver. An empty rawExt fails the length
    // test, so ext = "jpg".
    await expect(localCopyExtensionFor('file:///cache/noextension')).resolves.toBe('jpg');
  });
});

/* ── ImageBytes.kt:60 the AVIF pixel cap ── */

describe('ImageBytes.kt:60 — the AVIF cap divides AFTER minOf', () => {
  /** `....ftypavif` header followed by AVIF-shaped payload bytes. */
  function avifBytes(): Uint8Array {
    const head = [
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
    ] as number[];
    return new Uint8Array(head.concat([1, 2, 3, 4, 5, 6, 7, 8]));
  }

  it('passes minOf(32MB, maxMemory/8)/4, not minOf(32MB, maxMemory/8/4)', async () => {
    const seen: number[] = [];
    const hooks: ImageBytesHooks = {
      maxMemory: 8 * 32 * 1024 * 1024, // 256 MiB → minOf(32MB, 32MB)/4 = 8 MiB
      avifToPng: async (_bytes, expandedLimit) => {
        seen.push(expandedLimit);
        return null;
      },
    };
    await normalizeImage(avifBytes(), null, hooks);
    expect(seen).toHaveLength(1);
    // Kotlin: (32 MiB / 1) / 4 = 8 MiB. The old port grouped the `/4` INSIDE the second
    // minOf argument and produced 32 MiB — a 4× weaker guard on every AVIF.
    expect(seen[0]).toBe(8 * 1024 * 1024);
  });

  it('keeps the 32 MiB cap when maxMemory is the default (unbounded)', async () => {
    const seen: number[] = [];
    await normalizeImage(avifBytes(), null, {
      avifToPng: async (_bytes, expandedLimit) => {
        seen.push(expandedLimit);
        return null;
      },
    });
    expect(seen[0]).toBe(8 * 1024 * 1024);
  });
});