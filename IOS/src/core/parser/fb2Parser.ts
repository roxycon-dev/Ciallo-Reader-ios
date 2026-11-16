/**
 * FB2 (FictionBook) parser — port of Android `Fb2Parser.kt`.
 *
 * XML structure → title/author/chaptered body/embedded images/cover.
 * DB write shape matches EpubParser (Book + Chapter rows).
 *
 * Android deps replaced:
 *   Jsoup xmlParser      → DOMParser('application/xml') + document-order walks
 *   BitmapFactory bounds → probeImageSize (imageBytes.ts)
 *   android.util.Base64  → decodeBase64ToBytes (imageBytes.ts)
 *   ContentResolver read → caller supplies Uint8Array + FileSystemApi
 *   BookDao              → Fb2BookDao (narrow interface)
 *   Log.d/e              → omitted (core stays logging-free)
 *   CancellationException rethrow → errors propagate; no coroutine scope
 */

import { MAX_CHAPTER_LENGTH, splitChapterText } from '@core/data/splitChapterText';
import type { BookRow, ChapterRow } from '@core/library/bookTypes';
import type { FileSystemApi } from '@platform/interfaces';
import { decodeBase64ToBytes, detectImageExt, probeImageSize } from './imageBytes';

/**
 * Kotlin `Charset.forName(name)` → WHATWG `TextDecoder` label (Fb2Parser.kt L194).
 *
 * Java resolves the full IANA alias table, so `gb18030` must map to the WHATWG
 * `gb18030` decoder, **not** to `gbk`: the two differ on 4-byte sequences
 * (U+20000..U+2A6DF and friends) and on 0x8130..0xA2FF mappings, and folding GB18030
 * into GBK silently corrupts any FB2 declaring `encoding="gb18030"`.
 * `gb2312` is a strict subset of GBK, so the WHATWG `gb2312` label (which the spec
 * defines as a synonym of the gb18030 decoder) is used verbatim here.
 */
function normalizeCharsetLabel(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'utf-8' || lower === 'utf8') return 'utf-8';
  if (lower === 'gbk' || lower === 'cp936' || lower === 'windows-936') return 'gbk';
  if (lower === 'gb18030' || lower === 'gb18030-2000') return 'gb18030';
  if (lower === 'gb2312' || lower === 'chinese' || lower === 'csgb2312') return 'gb18030';
  return name;
}

export function isFb2File(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.fb2');
}

/** Narrow slice of Android BookDao used by FB2 import. */
export interface Fb2BookDao {
  insertBook(book: Omit<BookRow, 'id'>): Promise<number>;
  insertChapters(chapters: Array<Omit<ChapterRow, 'id'>>): Promise<void>;
  updateBook(book: BookRow): Promise<void>;
  deleteBook(book: BookRow): Promise<void>;
}

export interface Fb2ImportDeps {
  fs: FileSystemApi;
  /** App files root (Android `context.filesDir`). */
  filesDir: string;
  bookDao: Fb2BookDao;
}

export interface ParsedFb2Image {
  id: string;
  bytes: Uint8Array;
  ext: string;
  width: number;
  height: number;
}

export interface ParsedFb2 {
  title: string;
  author: string;
  chapters: Fb2ChapterDraft[];
  binaryImages: ParsedFb2Image[];
  cover: { bytes: Uint8Array; ext: string } | null;
}

const FALLBACK_SPLIT_LENGTH = 5_000;

// ---------------------------------------------------------------------------
// decodeFb2Text
// ---------------------------------------------------------------------------

export function decodeFb2Text(bytes: Uint8Array): string {
  const sample = bytes.subarray(0, Math.min(bytes.length, 2048));
  const header = new TextDecoder('iso-8859-1').decode(sample);
  const encMatch = /<\?xml[^>]*encoding=["']([a-zA-Z0-9_-]+)["']/i.exec(header);
  try {
    const named = encMatch?.[1];
    if (named) {
      const lower = named.toLowerCase();
      if (lower === 'utf-8' || lower === 'utf8') {
        return new TextDecoder('utf-8').decode(bytes);
      }
      return new TextDecoder(normalizeCharsetLabel(named)).decode(bytes);
    }
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    const utf8 = new TextDecoder('utf-8').decode(bytes);
    if (!utf8.includes('\uFFFD')) {
      return utf8;
    }
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch {
      return utf8;
    }
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// ---------------------------------------------------------------------------
// addChaptersWithSplit (Fb2Parser variant — newline-aware, image-token safe)
// ---------------------------------------------------------------------------

/** Android Chapter draft without Room id (bookId assigned at import time). */
export interface Fb2ChapterDraft {
  chapterOrder: number;
  title: string;
  content: string;
}

export function addChaptersWithSplit(
  chapters: Fb2ChapterDraft[],
  startOrder: number,
  title: string,
  content: string,
): void {
  if (content.length <= MAX_CHAPTER_LENGTH) {
    chapters.push({ chapterOrder: startOrder, title, content });
    return;
  }
  // 拆分点优先取换行，避免把 [IMG:...] 内嵌图片占位符从中间截断
  let start = 0;
  while (start < content.length) {
    const end = Math.min(content.length, start + MAX_CHAPTER_LENGTH);
    if (end >= content.length) {
      chapters.push({
        chapterOrder: startOrder + chapters.length,
        title,
        content: content.slice(start),
      });
      break;
    }
    const nl = content.lastIndexOf('\n', end);
    const cut = nl > start + MAX_CHAPTER_LENGTH / 2 ? nl + 1 : end;
    chapters.push({
      chapterOrder: startOrder + chapters.length,
      title: start === 0 ? title : `${title} (续${chapters.length - startOrder + 1})`,
      content: content.slice(start, cut),
    });
    start = cut;
  }
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function parseXmlDocument(text: string): Document | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) return null;
  return doc.documentElement ? doc : null;
}

function walkElements(root: Element | Document, out: Element[] = []): Element[] {
  const el = root instanceof Element ? root : root.documentElement;
  if (!el) return out;
  const visit = (node: Element): void => {
    out.push(node);
    const children = node.children;
    for (let i = 0; i < children.length; i += 1) {
      visit(children[i] as Element);
    }
  };
  visit(el);
  return out;
}

function firstByTag(root: Element | Document, tag: string): Element | null {
  const all = walkElements(root);
  for (const el of all) {
    if (el.tagName === tag) return el;
  }
  return null;
}

function allByTag(root: Element | Document, tag: string): Element[] {
  return walkElements(root).filter((el) => el.tagName === tag);
}

function elementText(el: Element | null): string {
  return (el?.textContent ?? '').trim();
}

// ---------------------------------------------------------------------------
// parseFb2
// ---------------------------------------------------------------------------

/**
 * Pure FB2 parse. Chapter image tokens use `[IMG:<binaryId>|<w>|<h>]`;
 * `importFb2` rewrites them to on-disk paths after images are written.
 */
export function parseFb2(bytes: Uint8Array, fileName: string): ParsedFb2 {
  const text = decodeFb2Text(bytes);
  if (!text.toLowerCase().includes('<fictionbook')) {
    throw new Error('不是有效的 FB2 文件');
  }
  const doc = parseXmlDocument(text);
  if (!doc) {
    throw new Error('不是有效的 FB2 文件');
  }

  const title =
    elementText(firstByTag(doc, 'book-title')) ||
    (() => {
      const idx = fileName.lastIndexOf('.');
      const stem = idx >= 0 ? fileName.slice(0, idx) : fileName;
      return stem.trim() !== '' ? stem : fileName;
    })();
  const author = elementText(firstByTag(doc, 'author')) || '未知作者';

  // 内嵌图片：<binary id> 全部提取；正文占位符按 id 引用
  const binaryImages: ParsedFb2Image[] = [];
  const binaryById = new Map<string, ParsedFb2Image>();
  for (const bin of allByTag(doc, 'binary')) {
    const binId = (bin.getAttribute('id') ?? '').trim();
    const base64 = (bin.textContent ?? '').replace(/\s/g, '');
    if (binId === '' || base64 === '') continue;
    const binBytes = decodeBase64ToBytes(base64);
    if (!binBytes) continue;
    const size = probeImageSize(binBytes);
    if (!size || size.width <= 0 || size.height <= 0) continue;
    const ext = detectImageExt(binBytes) ?? 'jpg';
    const img: ParsedFb2Image = {
      id: binId,
      bytes: binBytes,
      ext,
      width: size.width,
      height: size.height,
    };
    binaryImages.push(img);
    if (!binaryById.has(binId)) binaryById.set(binId, img);
  }

  // 只取第一个 <body>（正文），跳过 notes/comments 等附加 body
  const body = firstByTag(doc, 'body');
  const sections = body ? allByTag(body, 'section') : [];
  const chapters: Fb2ChapterDraft[] = [];
  let order = 0;

  if (sections.length > 0) {
    sections.forEach((section, index) => {
      const sectionTitle =
        elementText(firstByTag(section, 'title')) || `第 ${index + 1} 章`;
      // 按文档顺序遍历 p 与 image：文本与内嵌图片占位符交错排列
      const contentParts: string[] = [];
      const descendants = walkElements(section);
      for (const el of descendants) {
        const tag = el.tagName;
        if (tag === 'image') {
          const rawHref = el.getAttribute('l:href') ?? el.getAttribute('href') ?? '';
          const href = rawHref.replace(/^#/, '').trim();
          const img = binaryById.get(href);
          if (img) {
            contentParts.push(`[IMG:${img.id}|${img.width}|${img.height}]`);
          }
        } else if (tag === 'p') {
          if (el.parentElement?.tagName !== 'title') {
            const t = (el.textContent ?? '').trim();
            if (t.length > 0) contentParts.push(t);
          }
        }
      }
      const contentText = contentParts.join('\n\n').trim();
      if (contentText !== '') {
        addChaptersWithSplit(chapters, order, sectionTitle, contentText);
        order = chapters.length;
      }
    });
  } else {
    // 无 section 结构：整书文本按固定长度兜底分章
    const flatText = body
      ? walkElements(body)
          .filter((el) => el.tagName === 'p')
          .map((el) => (el.textContent ?? '').trim())
          .join('\n\n')
          .trim()
      : '';
    if (flatText !== '') {
      splitChapterText(flatText, FALLBACK_SPLIT_LENGTH).forEach((part, index) => {
        chapters.push({ chapterOrder: index, title: `第 ${index + 1} 部分`, content: part });
      });
    }
  }

  // coverpage → binary[id]
  let cover: { bytes: Uint8Array; ext: string } | null = null;
  try {
    const coverpage = firstByTag(doc, 'coverpage');
    const coverImage = coverpage ? firstByTag(coverpage, 'image') : null;
    const coverRef = (coverImage?.getAttribute('href') ?? '').replace(/^#/, '').trim();
    if (coverRef !== '') {
      const binaryEl = allByTag(doc, 'binary').find((b) => (b.getAttribute('id') ?? '') === coverRef);
      const base64 = (binaryEl?.textContent ?? '').replace(/\s/g, '');
      if (base64 !== '') {
        const coverBytes = decodeBase64ToBytes(base64);
        if (coverBytes && probeImageSize(coverBytes)) {
          cover = { bytes: coverBytes, ext: detectImageExt(coverBytes) ?? 'jpg' };
        }
      }
    }
  } catch {
    // Android runCatching around cover extraction
  }

  return { title, author, chapters, binaryImages, cover };
}

// ---------------------------------------------------------------------------
// importFb2
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
        // ignore individual failures
      }
    }
  } catch {
    // list may throw on missing dir
  }
}

/** Rewrite `[IMG:id|w|h]` tokens to on-disk paths (Android post-write content). */
function bindImagePaths(
  text: string,
  pathById: Map<string, string>,
): string {
  return text.replace(/\[IMG:([^|\]]+)\|(\d+)\|(\d+)]/g, (m: string, id: string, w: string, h: string) => {
    const p = pathById.get(id);
    return p ? `[IMG:${p}|${w}|${h}]` : m;
  });
}

/**
 * Android `Fb2Parser.importFb2` orchestration.
 * targetBookId 非空 = 老书补图片迁移：不新建书、失败不删书（调用方事务收尾）。
 */
export async function importFb2(
  bytes: Uint8Array,
  fileName: string,
  filePath: string,
  deps: Fb2ImportDeps,
  targetBookId: number | null = null,
): Promise<BookRow> {
  try {
    const parsed = parseFb2(bytes, fileName);

    const initialBook: BookRow = {
      title: parsed.title,
      author: parsed.author,
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

    // 内嵌图片落盘：fb2_images/<bookId>/<id>.<ext>
    const fb2ImageDir = joinPath(deps.filesDir, `fb2_images/${bookId}`);
    const pathById = new Map<string, string>();
    for (const img of parsed.binaryImages) {
      const path = joinPath(fb2ImageDir, `${img.id}.${img.ext}`);
      try {
        await deps.fs.writeFile(path, img.bytes);
        pathById.set(img.id, path);
      } catch {
        // runCatching around write — skip failed image
      }
    }

    const chapters: Array<Omit<ChapterRow, 'id'>> = parsed.chapters.map((ch) => ({
      bookId,
      chapterOrder: ch.chapterOrder,
      title: ch.title,
      content: bindImagePaths(ch.content, pathById),
      startCharIndex: 0,
      endCharIndex: 0,
    }));
    if (chapters.length === 0) {
      if (targetBookId === null) {
        await deps.bookDao.deleteBook({ ...initialBook, id: bookId });
      }
      await deleteDirFiles(deps.fs, fb2ImageDir);
      throw new Error('FB2 文件中未找到有效正文内容');
    }

    let coverUri: string | null = null;
    try {
      if (parsed.cover) {
        const coverDir = joinPath(deps.filesDir, 'fb2_covers');
        const destCover = joinPath(
          coverDir,
          `cover_${bookId}_${Date.now()}.${parsed.cover.ext}`,
        );
        await deps.fs.writeFile(destCover, parsed.cover.bytes);
        coverUri = destCover;
      }
    } catch {
      // Android runCatching around cover write
    }

    await deps.bookDao.insertChapters(chapters);
    const finalBook: BookRow = {
      ...initialBook,
      id: bookId,
      coverUri,
      totalChapters: chapters.length,
    };
    await deps.bookDao.updateBook(finalBook);
    return finalBook;
  } catch (t) {
    if (t instanceof Error && t.message === 'FB2 文件中未找到有效正文内容') {
      throw t;
    }
    throw new Error(t instanceof Error && t.message ? t.message : 'FB2 解析失败');
  }
}

export { MAX_CHAPTER_LENGTH };
