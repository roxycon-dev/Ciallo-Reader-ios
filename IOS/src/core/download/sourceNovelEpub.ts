import { Zip, ZipPassThrough } from 'fflate';
import type { FileSystemApi, HttpClient } from '@platform/interfaces';
import type { BookSource } from '@core/source/bookSource';
import type { ComicChapter } from '@core/source/comicChapter';
import type { SourceResult } from '@core/source/sourceResult';
import { checkSourceUrl } from '@core/source/networkCalls';
import { probeImageMime, probeImageSize } from '@core/parser/imageBytes';
import { hasMissingNovelContent, validateNovelParts, type NovelPart } from '@core/source/impl/novelParts';
import { abortable, throwIfAborted } from './abortable';

export interface GeneratedNovelSource extends BookSource {
  getChapters(id: string): Promise<SourceResult<ComicChapter[]>>;
  getEpubBookId(url: string): string;
  getNovelParts(chapterId: string): Promise<NovelPart[]>;
  invalidateBook?(id: string): void;
}
export function generatedNovelSource(source: BookSource | null): source is GeneratedNovelSource {
  return !!source && 'getEpubBookId' in source && typeof source.getEpubBookId === 'function' && 'getNovelParts' in source && typeof source.getNovelParts === 'function';
}
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const xml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
function value<T>(result: SourceResult<T>): T { if (result.kind === 'error') throw result.exception; return result.data; }
async function hash(bytes: Uint8Array): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }

/** Sequential, streamed EPUB assembly. A failed chapter, image or changed TOC deletes the partial file. */
export async function writeSourceNovelEpub(source: GeneratedNovelSource, downloadUrl: string, path: string,
  options: { fs: FileSystemApi; http: HttpClient; signal?: AbortSignal; progress(done: number, total: number): Promise<void>; delayMs?: number }): Promise<void> {
  const { fs, signal } = options; throwIfAborted(signal);
  const id = source.getEpubBookId(downloadUrl), book = value(await abortable(source.getDetail(id), signal));
  const toc = value(await abortable(source.getChapters(id), signal));
  if (!toc.length || toc.length > 30_000 || new Set(toc.map((c) => c.id)).size !== toc.length) throw new Error('源站目录为空、重复或过大');
  await fs.writeFile(path, new Uint8Array());
  let writes = Promise.resolve(), failure: Error | null = null, size = 0;
  const zip = new Zip((error, bytes) => {
    if (error) { failure = error; return; }
    if (!bytes.length) return;
    writes = writes.then(async () => {
      throwIfAborted(signal); size += bytes.length; if (size > 512 * 1024 * 1024) throw new Error('小说文件超过 512 MiB，未生成超大下载');
      if (fs.appendFile) await fs.appendFile(path, bytes);
      else { const old = await fs.readFile(path), joined = new Uint8Array(old.length + bytes.length); joined.set(old); joined.set(bytes, old.length); await fs.writeFile(path, joined); }
    });
    void writes.catch(() => {});
  });
  const entry = async (name: string, bytes: Uint8Array): Promise<void> => {
    throwIfAborted(signal); if (failure) throw failure;
    const item = new ZipPassThrough(name); zip.add(item);
    if (!bytes.length) item.push(bytes, true);
    for (let offset = 0; offset < bytes.length; offset += 256 * 1024) { const end = Math.min(offset + 256 * 1024, bytes.length); item.push(bytes.subarray(offset, end), end === bytes.length); await writes; }
  };
  const text = (name: string, text: string): Promise<void> => entry(name, encode(text));
  const records: Array<Record<string, unknown>> = [], images: Array<Record<string, unknown>> = [], assets = new Map<string, { path: string; mime: string }>();
  try {
    await text('mimetype', 'application/epub+zip');
    await text('META-INF/container.xml', '<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    for (const [index, chapter] of toc.entries()) {
      const parts = await abortable(source.getNovelParts(chapter.id), signal); validateNovelParts(parts);
      const plain = parts.filter((part) => part.kind === 'text').map((part) => part.value).join('\n\n');
      if (hasMissingNovelContent(plain)) throw new Error('章节内容缺失，未生成残缺电子书');
      let body = '';
      for (const part of parts) {
        throwIfAborted(signal);
        if (part.kind === 'text') { body += `<p>${xml(part.value)}</p>`; continue; }
        let asset = assets.get(part.url);
        if (!asset) {
          checkSourceUrl(part.url);
          const response = await abortable(options.http.request({ url: part.url, headers: { Referer: chapter.id, 'User-Agent': 'Mozilla/5.0' } }), signal);
          if (response.status < 200 || response.status >= 300 || response.body.length > 16 * 1024 * 1024) throw new Error('插图下载失败，未生成缺图电子书');
          const probe = probeImageSize(response.body); const mime = probeImageMime(response.body);
          const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[mime ?? ''];
          if (!probe || probe.width <= 0 || probe.height <= 0 || !extension || !mime) throw new Error('插图损坏，未生成缺图电子书');
          asset = { path: `Images/${assets.size}.${extension}`, mime }; await entry(`OEBPS/${asset.path}`, response.body); assets.set(part.url, asset);
          images.push({ url: part.url, path: asset.path, sha256: await hash(response.body) });
        }
        body += `<p><img src="${xml(asset.path)}" alt="插图"/></p>`;
      }
      await text(`OEBPS/chapter${index}.xhtml`, `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xml(chapter.title)}</title></head><body><h1>${xml(chapter.title)}</h1>${body}</body></html>`);
      records.push({ url: chapter.id, title: chapter.title, textSha256: await hash(encode(plain)), characters: plain.length, paragraphs: parts.filter((part) => part.kind === 'text').length, images: parts.filter((part) => part.kind === 'image').length });
      await options.progress(index + 1, toc.length);
      if ((options.delayMs ?? 200) > 0) await abortable(new Promise<void>((resolve) => setTimeout(resolve, options.delayMs ?? 200)), signal);
    }
    source.invalidateBook?.(id);
    const latest = value(await abortable(source.getChapters(id), signal));
    if (JSON.stringify(toc.map((c) => [c.id, c.title])) !== JSON.stringify(latest.map((c) => [c.id, c.title]))) throw new Error('下载期间源站目录变化，请重试；未导入旧目录的残缺书籍');
    const nav = toc.map((chapter, i) => `<li><a href="chapter${i}.xhtml">${xml(chapter.title)}</a></li>`).join('');
    await text('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>${nav}</ol></nav></body></html>`);
    const manifest = toc.map((_, i) => `<item id="c${i}" href="chapter${i}.xhtml" media-type="application/xhtml+xml"/>`).join('') + [...assets.values()].map((asset, i) => `<item id="img${i}" href="${xml(asset.path)}" media-type="${asset.mime}"/>`).join('');
    await text('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${xml(source.id + ':' + id)}</dc:identifier><dc:title>${xml(book.title)}</dc:title><dc:creator>${xml(book.author)}</dc:creator><dc:language>zh</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest}</manifest><spine>${toc.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`);
    await text('META-INF/ciallo-source.json', JSON.stringify({ sourceId: source.id, bookId: id, chapters: records, images, complete: true }));
    zip.end(); await writes; if (failure) throw failure; throwIfAborted(signal);
  } catch (error) { zip.terminate(); await writes.catch(() => {}); await fs.delete(path); throw error; }
}
