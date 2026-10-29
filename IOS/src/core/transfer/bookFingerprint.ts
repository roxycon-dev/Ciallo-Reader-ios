import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { isTransferHash, requireTransfer, transferHash } from './transferWire';
import type { PortableChapterBody, PortableRow } from './portableFormat';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
/** Same resource-aware identity as Android BookBodyFingerprint. A missing image
 * makes identity unresolved, so unrelated editions cannot be merged by path. */
export class BookContentFingerprint {
  private readonly resources = new Map<string, Promise<string | null>>();
  constructor(private readonly localResourceHash: (path: string) => Promise<string | null>) {}
  private resource(path: string): Promise<string | null> {
    if (path.startsWith('http://') || path.startsWith('https://')) return Promise.resolve(`url:${transferHash(encode(path))}`);
    let pending = this.resources.get(path);
    if (!pending) {
      pending = this.localResourceHash(path).catch((error: unknown) => { if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') throw error; return null; })
        .then((hash) => { requireTransfer(hash === null || isTransferHash(hash), '资源摘要无效'); return hash; });
      this.resources.set(path, pending);
    }
    return pending;
  }
  async chapter(body: string, contentType: string): Promise<string | null> {
    if (contentType === 'COMIC' && body.trim() && !body.includes('[IMG:')) {
      const hash = await this.resource(body.trim()); return hash === null ? null : transferHash(encode(`[IMG:sha256:${hash}]`));
    }
    const parts: string[] = []; let end = 0;
    for (const match of body.matchAll(/\[IMG:([^\]]+)]/g)) {
      const hash = await this.resource(match[1]!); if (hash === null) return null;
      parts.push(body.slice(end, match.index), `[IMG:sha256:${hash}]`); end = match.index + match[0].length;
    }
    parts.push(body.slice(end)); return transferHash(encode(parts.join('')));
  }
  async book(chapters: AsyncIterable<PortableChapterBody> | Iterable<PortableChapterBody>, contentType: string): Promise<string | null> {
    const accumulator = new BookContentAccumulator();
    for await (const chapter of chapters) accumulator.add(chapter.chapterOrder, chapter.title, await this.chapter(chapter.content, contentType), chapter.content.trim().length > 0);
    return accumulator.finish(contentType);
  }
}
export class BookContentAccumulator {
  private readonly digest = sha256.create();
  private complete = true;
  private readable = false;
  add(order: number, title: string, hash: string | null, hasContent: boolean): void {
    this.complete &&= hash !== null; this.readable ||= hasContent;
    for (const part of [String(order), title, hash ?? '']) { this.digest.update(encode(part)); this.digest.update(new Uint8Array([0])); }
  }
  finish(contentType: string): string | null {
    if (!this.complete || !this.readable) return null;
    return `body-content:${bytesToHex(this.digest.clone().update(encode(contentType)).digest())}`;
  }
}
export function portableRawBodyIdentity(book: PortableRow, chapters: Iterable<PortableChapterBody>, filesRoot: string): string {
  const digest = sha256.create();
  for (const chapter of chapters) {
    for (const part of [String(chapter.chapterOrder), chapter.title, chapter.content]) {
      digest.update(encode(filesRoot ? part.split(filesRoot).join('@FILES@') : part)); digest.update(new Uint8Array([0]));
    }
  }
  digest.update(encode(book.contentType as string));
  if (book.totalChapters === 0) digest.update(encode(`${book.title}\0${book.author}\0${String(book.filePath).replace(/^file:\/\//, '')}`));
  return `body:${bytesToHex(digest.digest())}`;
}
