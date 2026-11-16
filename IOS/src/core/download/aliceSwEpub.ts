/**
 * Android source: `com.example.download.AliceSwEpub.kt`（132 行）→ 本文件。
 *
 * 爱丽丝书屋整本下载：逐章抓正文并在本地生成 EPUB。
 * 该源没有可直接下载的文件，只能边抓边打包；任何一章失败，或目录在下载期间发生变化，
 * 都整体作废——绝不导入缺章的电子书（与书阁同一套约定）。
 *
 * 行号映射（Kotlin → TS）：
 *   L24-L27  value()                      → value()
 *   L29-L30  xml()                        → xml()
 *   L32-L33  hash()                       → digestHex()（复用 guestNovelCheckpoint）
 *   L35-L40  write() 签名                  → writeAliceSwEpub(source, downloadUrl, path, options)
 *   L41-L47  下载地址/作品 id 校验           → URL + pathSegments + `\d{1,9}` 校验
 *   L48-L49  getDetail / getChapters       → 同名调用（abortable 包裹）
 *   L51-L68  ZipOutputStream + entry/text  → fflate Zip / ZipDeflate / ZipPassThrough + appendFile
 *   L69-L72  mimetype（STORED）+ container → 同顺序，mimetype 用 ZipPassThrough（= STORED）
 *   L73-L96  逐章抓正文 → chapterN.xhtml    → 同顺序，空章即作废
 *   L97-L100 目录二次复核                   → 同比较（id + title 顺序）
 *   L101-L125 nav.xhtml / content.opf / ciallo-source.json → 同字符串
 *   L126-L130 complete 标记 + finally 删残片 → 同语义（失败/取消都删 target）
 *
 * 未移植项 / 有意替换：
 *  - Kotlin `File` + `ZipOutputStream(...buffered())` → `FileSystemApi` 端口 + fflate 流式
 *    ZIP：先 `writeFile(path, 空)`，再按 256 KiB 分片 `appendFile`（无 appendFile 的平台
 *    退化为 readFile + 拼接 + writeFile，与 `sourceNovelEpub.ts` 同一套写法）。
 *    条目仍按写入顺序落盘，`mimetype` 是第一条且不压缩（EPUB 规范要求）。
 *  - Kotlin 默认 DEFLATED；这里文本条目用 `ZipDeflate`，`mimetype` 用 `ZipPassThrough`
 *    （STORED），压缩算法不同不影响 EPUB 结构与解压结果。
 *  - `JSONObject` / `JSONArray` → `JSON.stringify`；键顺序、内容与 Kotlin 一致。
 *  - `currentCoroutineContext().ensureActive()` / `delay(180)` → `throwIfAborted(signal)` /
 *    `abortable(setTimeout)`；取消后同样走 finally 删除半成品。
 *  - Kotlin 未处理插图（纯文字源，`images: JSONArray()`），这里保持 `images: []`，不新增图片分支。
 *  - Kotlin `require(...)`（IllegalArgumentException）→ `Error`，消息逐字一致。
 */

import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { FileSystemApi } from '@platform/interfaces';
import {
  ALICE_SW_EPUB_MARKER,
  ALICE_SW_SOURCE_ID,
  type AliceSwSource,
} from '@core/source/impl/aliceSwSource';
import type { SourceResult } from '@core/source/sourceResult';
import { abortable, throwIfAborted } from './abortable';
import { digestHex } from './guestNovelCheckpoint';

const encoder = new TextEncoder();
const CHUNK_BYTES = 256 * 1024;
const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';

function value<T>(result: SourceResult<T>): T {
  if (result.kind === 'error') throw result.exception;
  return result.data;
}

function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface AliceSwEpubOptions {
  fs: FileSystemApi;
  signal?: AbortSignal;
  progress(done: number, total: number): Promise<void>;
  /** Kotlin `delay(180)`；单测传 0 跳过节流等待。 */
  delayMs?: number;
}

interface ChapterRecord {
  url: string;
  title: string;
  textSha256: string;
  characters: number;
  paragraphs: number;
}

/** 顺序抓取、流式打包；任何一章失败或目录变化都会删除半成品。 */
export async function writeAliceSwEpub(
  source: AliceSwSource,
  downloadUrl: string,
  path: string,
  options: AliceSwEpubOptions,
): Promise<void> {
  const { fs } = options;
  throwIfAborted(options.signal);

  const url = new URL(downloadUrl);
  if (url.hash !== `#${ALICE_SW_EPUB_MARKER}`) throw new Error('爱丽丝书屋下载标识无效');
  // Kotlin `url.pathSegments.getOrNull(1)?.substringBefore(".")`。
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const segment = segments[1];
  if (segment === undefined) throw new Error('爱丽丝书屋下载地址无效');
  const bookId = segment.split('.')[0] ?? segment;
  if (!/^\d{1,9}$/.test(bookId)) throw new Error('爱丽丝书屋作品标识无效');

  const book = value(await abortable(source.getDetail(bookId), options.signal));
  const toc = value(await abortable(source.getChapters(bookId), options.signal));
  if (toc.length === 0) throw new Error('爱丽丝书屋目录为空，未生成电子书');

  const records: ChapterRecord[] = [];
  const delayMs = options.delayMs ?? 180;
  let writes: Promise<void> = Promise.resolve();
  let failure: Error | null = null;
  let complete = false;

  await fs.writeFile(path, new Uint8Array());
  const append = async (bytes: Uint8Array): Promise<void> => {
    if (fs.appendFile) {
      await fs.appendFile(path, bytes);
      return;
    }
    const old = await fs.readFile(path);
    const joined = new Uint8Array(old.length + bytes.length);
    joined.set(old);
    joined.set(bytes, old.length);
    await fs.writeFile(path, joined);
  };
  const zip = new Zip((error, bytes) => {
    if (error) {
      failure = error;
      return;
    }
    if (bytes.length === 0) return;
    writes = writes.then(async () => {
      await append(bytes);
    });
    void writes.catch(() => undefined);
  });

  const entry = async (name: string, bytes: Uint8Array, stored = false): Promise<void> => {
    throwIfAborted(options.signal);
    if (failure) throw failure;
    const item = stored ? new ZipPassThrough(name) : new ZipDeflate(name);
    zip.add(item);
    if (bytes.length === 0) {
      item.push(bytes, true);
      return;
    }
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const end = Math.min(offset + CHUNK_BYTES, bytes.length);
      item.push(bytes.subarray(offset, end), end === bytes.length);
      await writes;
    }
  };
  const text = (name: string, contents: string, stored = false): Promise<void> =>
    entry(name, encoder.encode(contents), stored);

  try {
    // Kotlin `entry("mimetype", "application/epub+zip".toByteArray(), stored = true)`。
    await text('mimetype', 'application/epub+zip', true);
    await text(
      'META-INF/container.xml',
      `${XML_HEADER}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    );
    for (const [index, chapter] of toc.entries()) {
      throwIfAborted(options.signal);
      const body = value(await abortable(source.getChapterText(chapter.id), options.signal));
      const paragraphs = body
        .split('\n\n')
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph !== '');
      if (paragraphs.length === 0) throw new Error(`第 ${index + 1} 章正文为空，未生成缺章电子书`);
      const content = paragraphs.map((paragraph) => `<p>${xml(paragraph)}</p>`).join('');
      await text(
        `OEBPS/chapter${index}.xhtml`,
        `${XML_HEADER}<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xml(chapter.title)}</title></head><body><h1>${xml(chapter.title)}</h1>${content}</body></html>`,
      );
      const plain = paragraphs.join('\n\n');
      records.push({
        url: chapter.id,
        title: chapter.title,
        textSha256: await digestHex(encoder.encode(plain)),
        characters: plain.length,
        paragraphs: paragraphs.length,
      });
      await options.progress(index + 1, toc.length);
      // 顺序抓取，避免对源站形成并发压力。
      if (delayMs > 0) {
        await abortable(
          new Promise<void>((resolve) => {
            setTimeout(resolve, delayMs);
          }),
          options.signal,
        );
      }
    }
    const latest = value(await abortable(source.getChapters(bookId), options.signal));
    const expected = JSON.stringify(toc.map((chapter) => [chapter.id, chapter.title]));
    const actual = JSON.stringify(latest.map((chapter) => [chapter.id, chapter.title]));
    if (expected !== actual) throw new Error('下载期间源站目录变化，请重试；未导入旧目录的残缺书籍');

    const nav = toc
      .map((chapter, index) => `<li><a href="chapter${index}.xhtml">${xml(chapter.title)}</a></li>`)
      .join('');
    await text(
      'OEBPS/nav.xhtml',
      `${XML_HEADER}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>${nav}</ol></nav></body></html>`,
    );
    const manifest = toc
      .map(
        (_chapter, index) =>
          `<item id="c${index}" href="chapter${index}.xhtml" media-type="application/xhtml+xml"/>`,
      )
      .join('');
    const spine = toc.map((_chapter, index) => `<itemref idref="c${index}"/>`).join('');
    const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    await text(
      'OEBPS/content.opf',
      `${XML_HEADER}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${xml(`${ALICE_SW_SOURCE_ID}:${bookId}`)}</dc:identifier><dc:title>${xml(book.title)}</dc:title><dc:creator>${xml(book.author)}</dc:creator><dc:language>zh</dc:language><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest}</manifest><spine>${spine}</spine></package>`,
    );
    await text(
      'META-INF/ciallo-source.json',
      JSON.stringify({
        sourceId: ALICE_SW_SOURCE_ID,
        bookId,
        chapters: records,
        images: [],
        complete: true,
      }),
    );
    zip.end();
    await writes;
    if (failure) throw failure;
    throwIfAborted(options.signal);
    complete = true;
  } catch (error) {
    zip.terminate();
    await writes.catch(() => undefined);
    try {
      await fs.delete(path);
    } catch {
      // Kotlin `File.delete()` 返回值被忽略：文件不存在不算失败。
    }
    throw error;
  } finally {
    if (!complete) {
      try {
        await fs.delete(path);
      } catch {
        // 同上：残留清理尽力而为。
      }
    }
  }
}
