import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { DatabaseLike } from '@core/library/bookRepository';
import type { PortableChapterBody, PortableRow } from './portableFormat';
import { BookContentAccumulator, type BookContentFingerprint } from './bookFingerprint';
import { isTransferSessionId, requireTransfer, transferHash } from './transferWire';
import { boundedTransferBatch } from './rowBatch';

export interface IndexedBookBody { contentIdentity: string | null; rawIdentity: string; version: string; chapters: number; }
type Side = 'incoming' | 'local';
/** Keeps only chapter hashes on SQLite. Body text crosses the bridge in small
 * batches once; compatibility uses an indexed SQL join rather than JS maps. */
export class TransferChapterIndex {
  private readonly name: string;
  private ready = false;
  private readonly books = new Set<string>();
  constructor(private readonly db: DatabaseLike, sessionId: string) {
    requireTransfer(isTransferSessionId(sessionId), '章节索引身份无效'); this.name = `_ciallo_chapters_${sessionId.replace(/-/g, '')}`;
  }
  async initialize(): Promise<void> {
    requireTransfer(!this.ready, '章节索引已建立');
    await this.db.execute(`CREATE TEMP TABLE "${this.name}" (side TEXT NOT NULL, bookId INTEGER NOT NULL, chapterOrder INTEGER NOT NULL, bodyHash TEXT NOT NULL, hasContent INTEGER NOT NULL, PRIMARY KEY(side,bookId,chapterOrder))`); this.ready = true;
  }
  async addBook(side: Side, book: PortableRow, chapters: AsyncIterable<PortableChapterBody>, fingerprint: BookContentFingerprint, filesRoot = '', signal?: AbortSignal, normalizeBody?: (body: string, contentType: string) => Promise<string>): Promise<IndexedBookBody> {
    const key = `${side}:${book.id}`;
    requireTransfer(this.ready && !this.books.has(key) && Number.isSafeInteger(book.id), '章节索引未就绪或书籍重复');
    const content = new BookContentAccumulator(), raw = sha256.create(), version = sha256.create(), encoder = new TextEncoder();
    let count = 0, previous: number | null = null;
    let batch: (string | number | null)[][] = [];
    const flush = async () => {
      if (!batch.length) return;
      await this.db.execute(`INSERT INTO "${this.name}" VALUES ${batch.map(() => '(?,?,?,?,?)').join(',')}`, batch.flat()); batch = [];
    };
    try {
      for await (const chapter of chapters) {
        requireTransfer(!signal?.aborted, '章节校验已取消');
        requireTransfer(Number.isSafeInteger(chapter.chapterOrder) && (previous === null || chapter.chapterOrder > previous), '章节顺序重复或未排序'); previous = chapter.chapterOrder;
        const hash = await fingerprint.chapter(chapter.content, book.contentType as string), readable = chapter.content.trim().length > 0;
        content.add(chapter.chapterOrder, chapter.title, hash, readable);
        const rawBody = normalizeBody ? await normalizeBody(chapter.content, book.contentType as string) : chapter.content;
        for (const part of [String(chapter.chapterOrder), chapter.title, rawBody]) raw.update(encoder.encode(`${filesRoot ? part.split(filesRoot).join('@FILES@') : part}\0`));
        for (const part of [String(chapter.chapterOrder), chapter.title, chapter.content.replace(/\[IMG:[^\]]+]/g, '[IMG]')]) version.update(encoder.encode(`${part}\0`));
        batch.push([side, book.id!, chapter.chapterOrder, hash ?? `unresolved:${transferHash(encoder.encode(chapter.content))}`, readable ? 1 : 0]); count++;
        if (batch.length >= 64) await flush();
      }
      await flush();
      raw.update(encoder.encode(book.contentType as string));
      if (count === 0) raw.update(encoder.encode(`${book.title}\0${book.author}\0${String(book.filePath).replace(/^file:\/\//, '')}`));
      this.books.add(key);
      return { contentIdentity: content.finish(book.contentType as string), rawIdentity: `body:${bytesToHex(raw.digest())}`, version: bytesToHex(version.digest()), chapters: count };
    } catch (error) { await this.db.execute(`DELETE FROM "${this.name}" WHERE side=? AND bookId=?`, [side, book.id!]); throw error; }
  }
  async compatible(first: { side: Side; id: number }, second: { side: Side; id: number }): Promise<boolean> {
    requireTransfer(this.ready && this.books.has(`${first.side}:${first.id}`) && this.books.has(`${second.side}:${second.id}`), '待比较书籍尚未建立章节索引');
    const conflicts = await this.db.query(`SELECT 1 FROM "${this.name}" a JOIN "${this.name}" b ON a.chapterOrder=b.chapterOrder WHERE a.side=? AND a.bookId=? AND b.side=? AND b.bookId=? AND a.hasContent=1 AND b.hasContent=1 AND a.bodyHash!=b.bodyHash LIMIT 1`, [first.side, first.id, second.side, second.id]);
    return conflicts.length === 0;
  }
  async dispose(): Promise<void> { this.ready = false; this.books.clear(); await this.db.execute(`DROP TABLE IF EXISTS "${this.name}"`); }
}

export async function* localBookChapters(db: DatabaseLike, bookId: number): AsyncGenerator<PortableChapterBody> {
  requireTransfer(Number.isSafeInteger(bookId), '本机书籍身份无效');
  let order: number | null = null, id = 0;
  while (true) {
    const metadata: { id: number; bytes: number }[] = await db.query('SELECT id,length(CAST(title AS BLOB))+length(CAST(content AS BLOB)) AS bytes FROM chapters WHERE bookId=? AND (? IS NULL OR chapterOrder>? OR (chapterOrder=? AND id>?)) ORDER BY chapterOrder,id LIMIT 128', [bookId, order, order, order, id]);
    if (!metadata.length) return;
    const selected = boundedTransferBatch(metadata, 6);
    requireTransfer(selected.every((row) => Number.isSafeInteger(row.id)), '本机章节编号无效');
    const rows: (PortableChapterBody & { id: number })[] = await db.query(`SELECT id,chapterOrder,title,content FROM chapters WHERE id IN (${selected.map(() => '?').join(',')}) ORDER BY chapterOrder,id`, selected.map((row) => row.id));
    requireTransfer(rows.length === selected.length, '本机章节在读取时发生变化');
    for (const row of rows) { order = row.chapterOrder; id = row.id; yield row; }
  }
}
