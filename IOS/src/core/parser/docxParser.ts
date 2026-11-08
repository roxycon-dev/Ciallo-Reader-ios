/**
 * DOCX parser — port of Android `DocxParser.kt`.
 *
 * From the zip: word/document.xml, split chapters on Heading1/Heading2,
 * extract <w:t> text (DB shape matches EpubParser). Inline images become
 * `[IMG:path|w|h]` placeholders.
 *
 * Android deps replaced:
 *   ZipInputStream + FileOutputStream → fflate unzipSync + FileSystemApi
 *   BitmapFactory.decodeFile bounds  → probeImageSize (imageBytes.ts)
 *   ArchiveBudget streaming copy     → per-entry budget.copyEntry after unzip
 *   Log / CancellationException      → omitted / errors propagate
 */

import { ArchiveBudget, zipSlipSafeDestination } from '@core/data/archiveBudget';
import { MAX_CHAPTER_LENGTH, splitChapterText } from '@core/data/splitChapterText';
import type { BookRow, ChapterRow } from '@core/library/bookTypes';
import type { FileSystemApi } from '@platform/interfaces';
import { unzipSync } from 'fflate';
import { probeImageSize } from './imageBytes';
import { collapseAsciiWhitespace, kotlinTrim } from './kotlinText';

export function isDocxFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.docx');
}

/** Narrow slice of Android BookDao used by DOCX import. */
export interface DocxBookDao {
  insertBook(book: Omit<BookRow, 'id'>): Promise<number>;
  insertChapters(chapters: Array<Omit<ChapterRow, 'id'>>): Promise<void>;
  updateBook(book: BookRow): Promise<void>;
  deleteBook(book: BookRow): Promise<void>;
}

export interface DocxImportDeps {
  fs: FileSystemApi;
  /** App files root (Android `context.filesDir`). */
  filesDir: string;
  bookDao: DocxBookDao;
}

interface DocxParagraph {
  text: string;
  isHeading: boolean;
}

interface DocxContent {
  documentXml: string;
  /** rId -> 已落盘的媒体文件路径（正文插图的引用来源） */
  relTargets: Map<string, string>;
  /** rId -> 媒体字节（尺寸探测用，对应 Android 读盘前的 BitmapFactory.decodeFile） */
  relMediaBytes: Map<string, Uint8Array>;
}

const DOCX_ENTRY_BUDGET_BYTES = 16 * 1024 * 1024;
const FALLBACK_SPLIT_LENGTH = 5_000;

// ---------------------------------------------------------------------------
// readDocxContent
// ---------------------------------------------------------------------------

async function readDocxContent(
  zipBytes: Uint8Array,
  imageDir: string,
  fs: FileSystemApi,
): Promise<DocxContent | null> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    throw new Error('无法解压 DOCX 文件');
  }

  let documentXml: string | null = null;
  const rels = new Map<string, string>();
  const mediaByName = new Map<string, Uint8Array>();
  const budget = new ArchiveBudget(DOCX_ENTRY_BUDGET_BYTES);

  for (const [name, data] of Object.entries(entries)) {
    // Android: ArchiveBudget.destination(imageDir, entry.name) for every entry
    zipSlipSafeDestination(imageDir, name);
    const counted = budget.copyEntry(data);

    if (name === 'word/document.xml') {
      documentXml = new TextDecoder('utf-8').decode(counted);
    } else if (name === 'word/_rels/document.xml.rels') {
      const relXml = new TextDecoder('utf-8').decode(counted);
      // 关系映射：<Relationship Id="rIdX" Target="media/image1.png"/>
      const relRe = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g;
      let rm: RegExpExecArray | null;
      while ((rm = relRe.exec(relXml)) !== null) {
        const target = rm[2] as string;
        if (target.includes('media/')) {
          rels.set(rm[1] as string, target);
        }
      }
    } else if (!name.endsWith('/') && name.startsWith('word/media/')) {
      const base = name.slice(name.lastIndexOf('/') + 1);
      const path = `${imageDir.replace(/\/+$/, '')}/${base}`;
      await fs.writeFile(path, counted);
      mediaByName.set(base, counted);
      rels.set(`__file__${name}`, path);
    }
  }

  if (documentXml === null) return null;

  // rId -> 落盘图片路径 + bytes
  const resolved = new Map<string, string>();
  const relMediaBytes = new Map<string, Uint8Array>();
  for (const [rid, target] of rels) {
    if (rid.startsWith('__file__')) continue;
    const name = target.slice(target.lastIndexOf('/') + 1);
    if (mediaByName.has(name)) {
      resolved.set(rid, `${imageDir.replace(/\/+$/, '')}/${name}`);
      relMediaBytes.set(rid, mediaByName.get(name) as Uint8Array);
    }
  }
  return { documentXml, relTargets: resolved, relMediaBytes };
}

// ---------------------------------------------------------------------------
// parseParagraphsWithImages / parseParagraphs / extractText
// ---------------------------------------------------------------------------

/** 段落文本 + 内嵌插图（r:embed → 已落盘媒体）→ 文本与 [IMG:...] 占位符交错 */
function parseParagraphsWithImages(
  xml: string,
  relTargets: Map<string, string>,
  relMediaBytes: Map<string, Uint8Array>,
): DocxParagraph[] {
  const result: DocxParagraph[] = [];
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/gi;
  const headingRegex = /<w:pStyle w:val="(Heading[1-6][^"]*)"\//i;
  const blipRegex = /r:embed="(rId\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = paraRegex.exec(xml)) !== null) {
    const raw = m[0];
    const isHeading = headingRegex.test(raw);
    const text = extractText(raw);
    const tokens: string[] = [];
    let bm: RegExpExecArray | null;
    blipRegex.lastIndex = 0;
    while ((bm = blipRegex.exec(raw)) !== null) {
      const rid = bm[1] as string;
      const path = relTargets.get(rid);
      if (path === undefined) continue;
      const bytes = relMediaBytes.get(rid);
      const size = bytes ? probeImageSize(bytes) : null;
      const w = size && size.width > 0 ? size.width : 800;
      const h = size && size.height > 0 ? size.height : 600;
      tokens.push(`[IMG:${path}|${w}|${h}]`);
    }
    const combined = (
      text.trim() + (tokens.length > 0 ? `\n${tokens.join('\n')}` : '')
    ).trim();
    if (combined.trim() !== '' || isHeading) {
      result.push({ text: combined, isHeading });
    }
  }
  return result;
}

/** Android private parseParagraphs (no images) — kept for parity. */
export function parseParagraphs(xml: string): DocxParagraph[] {
  const result: DocxParagraph[] = [];
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/gi;
  const headingRegex = /<w:pStyle w:val="(Heading[1-6][^"]*)"\//i;
  let m: RegExpExecArray | null;
  while ((m = paraRegex.exec(xml)) !== null) {
    const raw = m[0];
    const isHeading = headingRegex.test(raw);
    const text = extractText(raw);
    if (text.trim() !== '' || isHeading) {
      result.push({ text, isHeading });
    }
  }
  return result;
}

export function extractText(raw: string): string {
  let sb = '';
  const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/gi;
  let m: RegExpExecArray | null;
  while ((m = tRegex.exec(raw)) !== null) {
    sb += m[1] as string;
  }
  let text = sb;
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (match: string, code: string) => {
      const n = Number.parseInt(code, 10);
      // Kotlin `toIntOrNull()` yields null above Int.MAX_VALUE, keeping the source text.
      if (!Number.isFinite(n) || n > 0x7fffffff) return match;
      // Kotlin toChar(): UTF-16 code unit
      return String.fromCharCode(n);
    });
  // Kotlin L245 `text.replace(Regex("""\s+"""), " ").trim()` — Java `\s` is ASCII-only,
  // so a decoded `&nbsp;` (U+00A0) survives as NBSP here just as it does on Android.
  return kotlinTrim(collapseAsciiWhitespace(text));
}

// ---------------------------------------------------------------------------
// addChaptersWithSplit (DocxParser variant — uses splitChapterText)
// ---------------------------------------------------------------------------

function addChaptersWithSplit(
  chapters: Array<{ chapterOrder: number; title: string; content: string }>,
  startOrder: number,
  title: string,
  content: string,
): void {
  if (content.length <= MAX_CHAPTER_LENGTH) {
    chapters.push({ chapterOrder: startOrder, title, content });
    return;
  }
  splitChapterText(content).forEach((part, index) => {
    chapters.push({
      chapterOrder: startOrder + index,
      title: index === 0 ? title : `${title} (续${index + 1})`,
      content: part,
    });
  });
}

// ---------------------------------------------------------------------------
// importDocx
// ---------------------------------------------------------------------------

function joinPath(dir: string, name: string): string {
  return dir.replace(/\/+$/, '') + '/' + name;
}

async function deleteDirFiles(fs: FileSystemApi, dir: string): Promise<void> {
  try {
    const names = await fs.list(dir);
    for (const name of names) {
      try {
        await fs.delete(joinPath(dir, name));
      } catch {
        // ignore
      }
    }
  } catch {
    // missing dir
  }
}

function fileNameStem(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(0, idx) : fileName;
}

/**
 * Android `DocxParser.importDocx` orchestration.
 * targetBookId 非空 = 老书补图片迁移：不新建书、失败不删书。
 */
export async function importDocx(
  zipBytes: Uint8Array,
  fileName: string,
  filePath: string,
  deps: DocxImportDeps,
  targetBookId: number | null = null,
): Promise<BookRow> {
  try {
    // Android readDocxContent(context, uri, bookId=0) — image dir uses 0 until book insert
    const imageDir = joinPath(deps.filesDir, 'docx_images/0');
    const docx = await readDocxContent(zipBytes, imageDir, deps.fs);
    if (!docx) {
      throw new Error('无法读取 DOCX 文件（缺少 word/document.xml）');
    }
    const xml = docx.documentXml;

    const paragraphs = parseParagraphsWithImages(xml, docx.relTargets, docx.relMediaBytes);
    if (paragraphs.length === 0) {
      throw new Error('DOCX 文件中未找到有效正文内容');
    }

    const heading = paragraphs.find((p) => p.isHeading);
    const title = (heading?.text ?? '').trim() || fileNameStem(fileName).trim() || fileName;

    const initialBook: BookRow = {
      title,
      author: '未知作者',
      filePath,
      coverUri: null,
      category: '默认',
      currentChapterIndex: 0,
      scrollOffset: 0,
      isFinished: 0,
      totalChapters: 0,
      contentType: 'NOVEL',
      addedTime: Date.now(),
      lastReadTime: Date.now(),
      sourceId: null,
      comicId: null,
    };
    const bookId = targetBookId ?? (await deps.bookDao.insertBook(initialBook));

    const draft: Array<{ chapterOrder: number; title: string; content: string }> = [];
    let order = 0;
    let currentTitle = '第 1 章';
    let currentContent = '';

    const flushChapter = (): void => {
      const content = currentContent.trim();
      if (content !== '') {
        addChaptersWithSplit(draft, order, currentTitle, content);
        order = draft.length;
      }
      currentContent = '';
    };

    const hasHeadings = paragraphs.some((p) => p.isHeading);
    for (const para of paragraphs) {
      if (para.isHeading && hasHeadings) {
        flushChapter();
        currentTitle = para.text.trim() || `第 ${draft.length + 1} 章`;
      } else if (para.text.trim() !== '') {
        if (currentContent !== '') currentContent += '\n\n';
        currentContent += para.text.trim();
      }
    }
    flushChapter();

    const chapters: Array<Omit<ChapterRow, 'id'>> = draft.map((ch) => ({
      bookId,
      chapterOrder: ch.chapterOrder,
      title: ch.title,
      content: ch.content,
      startCharIndex: 0,
      endCharIndex: 0,
    }));

    if (chapters.length === 0) {
      // 无标题结构：按固定长度兜底
      const flatText = paragraphs.map((p) => p.text.trim()).join('\n\n');
      splitChapterText(flatText, FALLBACK_SPLIT_LENGTH).forEach((part, index) => {
        chapters.push({
          bookId,
          chapterOrder: index,
          title: `第 ${index + 1} 部分`,
          content: part,
          startCharIndex: 0,
          endCharIndex: 0,
        });
      });
    }

    if (chapters.length === 0) {
      if (targetBookId === null) {
        await deps.bookDao.deleteBook({ ...initialBook, id: bookId });
      }
      throw new Error('DOCX 文件中未找到有效正文内容');
    }

    await deps.bookDao.insertChapters(chapters);
    const finalBook: BookRow = {
      ...initialBook,
      id: bookId,
      totalChapters: chapters.length,
    };
    await deps.bookDao.updateBook(finalBook);
    return finalBook;
  } catch (t) {
    const msg = t instanceof Error ? t.message : '';
    if (
      msg === 'DOCX 文件中未找到有效正文内容' ||
      msg === '无法读取 DOCX 文件（缺少 word/document.xml）' ||
      msg === '无法解压 DOCX 文件'
    ) {
      throw t instanceof Error ? t : new Error(msg || 'DOCX 解析失败');
    }
    throw new Error(msg || 'DOCX 解析失败');
  }
}

export { deleteDirFiles as deleteDocxImageDirFiles };
