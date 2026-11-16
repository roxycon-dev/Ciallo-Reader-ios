/**
 * Comic parser — port of Android `ComicParser.kt`.
 *
 * CBZ/ZIP: fflate unzip + ArchiveBudget + zipSlip + natural-order page sort.
 * PDF: Android `PdfRenderer` has no pure-TS equivalent in this repo (no pdf.js
 * dependency) — importComic throws a conversion hint for .pdf (see skipped).
 *
 * naturalOrderCompare is reused from `@core/data/naturalOrderCompare` (already
 * ported from this same Android file).
 *
 * Android deps replaced:
 *   ZipInputStream(UTF-8/GBK)  → unzipSync + central-directory GBK name remap
 *   PdfRenderer               → skipped (throws)
 *   BitmapFactory / JPEG out  → bytes passed through; cover is page[0]
 *   UUID.randomUUID           → crypto.randomUUID
 *   Log                       → omitted
 */

import { ArchiveBudget, zipSlipSafeDestination } from '@core/data/archiveBudget';
import { naturalOrderCompare } from '@core/data/naturalOrderCompare';
import type { BookRow, ChapterRow } from '@core/library/bookTypes';
import type { FileSystemApi } from '@platform/interfaces';
import { unzipSync } from 'fflate';

export function isComicFile(fileName: string): boolean {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  return ['cbz', 'zip', 'pdf', 'cbr', 'cb7', 'rar', '7z'].includes(ext);
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif']);
const SUPPORTED_IMPORT_EXTENSIONS = new Set(['pdf', 'cbz', 'zip']);

/** Narrow slice of Android BookDao.insertBookWithChapters. */
export interface ComicBookDao {
  insertBookWithChapters(
    book: Omit<BookRow, 'id'>,
    chapters: Array<Omit<ChapterRow, 'id'>>,
  ): Promise<BookRow>;
}

export interface ComicImportDeps {
  fs: FileSystemApi;
  /** App files root (Android `context.filesDir`). */
  filesDir: string;
  bookDao: ComicBookDao;
}

export interface ComicPage {
  /** Original archive entry path (sort key, Android `name`). */
  entryName: string;
  /** Generated on-disk name after extraction (Android `img_N.ext`). */
  fileName: string;
  bytes: Uint8Array;
}

// ---------------------------------------------------------------------------
// Zip helpers
// ---------------------------------------------------------------------------

function u16(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) return 0;
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

/**
 * Re-decode zip entry names from the central directory when the UTF-8 flag is
 * not set (GBK comic archives). Port of epubParser.remapEntryNames pattern.
 */
function remapEntryNames(
  zipBytes: Uint8Array,
  entries: Record<string, Uint8Array>,
  label: string,
): Record<string, Uint8Array> {
  const maxScan = Math.min(zipBytes.length, 66_000);
  let eocd = -1;
  for (let i = zipBytes.length - 22; i >= Math.max(0, zipBytes.length - maxScan); i -= 1) {
    if (u32(zipBytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return entries;
  const totalEntries = u16(zipBytes, eocd + 10);
  const cdOffset = u32(zipBytes, eocd + 16);
  if (totalEntries <= 0 || totalEntries > 100_000) return entries;

  const remapped: Record<string, Uint8Array> = { ...entries };
  let pos = cdOffset;
  for (let e = 0; e < totalEntries; e += 1) {
    if (u32(zipBytes, pos) !== 0x02014b50) break;
    const flags = u16(zipBytes, pos + 8);
    const nameLen = u16(zipBytes, pos + 28);
    const nameStart = pos + 46;
    if (nameStart + nameLen > zipBytes.length) break;
    const rawName = zipBytes.subarray(nameStart, nameStart + nameLen);
    const utf8Flag = (flags & 0x800) !== 0;
    if (!utf8Flag && rawName.length > 0) {
      const utf8Name = new TextDecoder('utf-8').decode(rawName);
      const altName = new TextDecoder(label).decode(rawName);
      if (altName !== utf8Name) {
        const payload = entries[utf8Name];
        if (payload) remapped[altName] = payload;
      }
    }
    pos = nameStart + nameLen + u16(zipBytes, pos + 30) + u16(zipBytes, pos + 32);
  }
  return remapped;
}

function isVisibleEntryPath(name: string): boolean {
  return !name.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX');
}

function extOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// parseComicArchive
// ---------------------------------------------------------------------------

/**
 * Pure zip/CBZ page extraction. Pages keep original entry names for natural
 * sort; `fileName` is the generated `img_<extractIndex>.<ext>` (Android naming
 * uses pre-sort extraction order).
 */
export function parseComicArchive(zipBytes: Uint8Array, extension: string): ComicPage[] {
  if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
    throw new Error('请转换为CBZ、ZIP或PDF格式后导入。');
  }
  if (extension === 'pdf') {
    // Android PdfRenderer path — not portable without pdf.js
    throw new Error('PDF 导入依赖 Android PdfRenderer，当前移植版暂不支持；请转换为 CBZ/ZIP');
  }

  let entries: Record<string, Uint8Array> | null = null;
  let lastFailure: Error | null = null;
  for (const charsetLabel of ['utf-8', 'gbk'] as const) {
    try {
      const raw = unzipSync(zipBytes);
      entries = charsetLabel === 'utf-8' ? raw : remapEntryNames(zipBytes, raw, charsetLabel);
      break;
    } catch (e) {
      lastFailure = e instanceof Error ? e : new Error(String(e));
    }
  }
  if (!entries) {
    throw lastFailure ?? new Error('无法解压漫画文件');
  }

  const budget = new ArchiveBudget();
  const pages: ComicPage[] = [];
  for (const [rawName, data] of Object.entries(entries)) {
    const name = rawName.replace(/\\/g, '/');
    // Android: ArchiveBudget.destination(comicDir, name) for every entry.
    // Pure parse has no disk root yet — validate under a stable virtual root.
    zipSlipSafeDestination('comic', name);
    const counted = budget.copyEntry(data);
    const visible = isVisibleEntryPath(name);
    const ext = extOf(name);
    const isDir = rawName.endsWith('/') || rawName.endsWith('\\');
    if (!isDir && visible && IMAGE_EXTENSIONS.has(ext)) {
      pages.push({
        entryName: name,
        fileName: `img_${pages.length}.${ext}`,
        bytes: counted,
      });
    }
  }

  if (pages.length === 0) {
    throw new Error('未在文件中找到有效漫画页面');
  }
  pages.sort((a, b) => naturalOrderCompare(a.entryName, b.entryName));
  return pages;
}

// ---------------------------------------------------------------------------
// importComic
// ---------------------------------------------------------------------------

function joinPath(dir: string, name: string): string {
  return dir.replace(/\/+$/, '') + '/' + name;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fileNameStem(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(0, idx) : fileName;
}

/**
 * Android `ComicParser.importComic` for CBZ/ZIP.
 * PDF throws (see parseComicArchive). Cleanup on failure removes comicDir + cover.
 */
export async function importComic(
  zipBytes: Uint8Array,
  fileName: string,
  deps: ComicImportDeps,
): Promise<BookRow> {
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  const comicDir = joinPath(deps.filesDir, `comics_${randomId()}`);
  let coverPath: string | null = null;
  try {
    if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
      throw new Error('请转换为CBZ、ZIP或PDF格式后导入。');
    }

    // Pages are written under comicDir with generated names (Android img_N.ext)
    const parsed = parseComicArchive(zipBytes, extension);
    for (const page of parsed) {
      await deps.fs.writeFile(joinPath(comicDir, page.fileName), page.bytes);
    }

    const coverDir = joinPath(deps.filesDir, 'comic_covers');
    const cover = joinPath(coverDir, `cover_${randomId()}.jpg`);
    coverPath = cover;
    const first = parsed[0] as ComicPage;
    await deps.fs.writeFile(cover, first.bytes);

    const now = Date.now();
    const book: BookRow = {
      title: fileNameStem(fileName),
      author: '漫画',
      filePath: comicDir,
      coverUri: cover,
      category: '默认',
      currentChapterIndex: 0,
      scrollOffset: 0,
      isFinished: 0,
      totalChapters: parsed.length,
      contentType: 'COMIC',
      addedTime: now,
      lastReadTime: now,
      sourceId: null,
      comicId: null,
    };
    const chapters: Array<Omit<ChapterRow, 'id'>> = parsed.map((page, i) => ({
      bookId: 0,
      chapterOrder: i,
      title: `第 ${i + 1} 页`,
      content: joinPath(comicDir, page.fileName),
      startCharIndex: 0,
      endCharIndex: 0,
    }));
    return await deps.bookDao.insertBookWithChapters(book, chapters);
  } catch (e) {
    try {
      const names = await deps.fs.list(comicDir);
      for (const name of names) {
        try {
          await deps.fs.delete(joinPath(comicDir, name));
        } catch {
          // ignore
        }
      }
    } catch {
      // dir may not exist
    }
    if (coverPath) {
      try {
        await deps.fs.delete(coverPath);
      } catch {
        // ignore
      }
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export { naturalOrderCompare };
