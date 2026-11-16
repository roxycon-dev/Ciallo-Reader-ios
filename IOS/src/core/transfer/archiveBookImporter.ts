import { type ArchiveDatabaseRows, type ImportRowOutcome } from './archiveDatabaseRows';
import { type ArchiveResources } from './archiveResources';
import { BookContentFingerprint } from './bookFingerprint';
import { type TransferChapterIndex, localBookChapters, type IndexedBookBody } from './chapterIndex';
import { portableOnlineIdentity, type PortableChapterBody, type PortableEnvelope, type PortableRow, type TransferCategory } from './portableFormat';
import type { TransferImportMode } from './transferSession';
import type { TransferStagingRows } from './stagingRows';
import { requireTransfer } from './transferWire';

const online = (book: PortableRow): boolean => typeof book.sourceId === 'string' && typeof book.comicId === 'string';
interface LocalBook { row: PortableRow; identities: Set<string>; body?: IndexedBookBody; original?: string | null; incomingOrigin?: number; acceptedOrigins: number[]; }
export interface ArchiveBookImportOptions {
  mode: TransferImportMode;
  categories: readonly TransferCategory[];
  resources: ArchiveResources;
  index: TransferChapterIndex;
  staging: TransferStagingRows;
  localFingerprint: BookContentFingerprint;
  localOriginal(book: PortableRow): Promise<string | null>;
  localDirectoryIdentity?(book: PortableRow): Promise<string | null>;
  localFilesRoot?: string;
  normalizeLocalBody?(body: string, contentType: string): Promise<string>;
  signal?: AbortSignal;
}
/** Runs under the caller's managed import transaction. Matching never relies on
 * titles or device-local paths; dependent rows receive only mapped receiver ids. */
export class ArchiveBookImporter {
  readonly books = new Map<number, number>();
  readonly chapters = new Map<number, number>();
  readonly titles = new Map<number, string>();
  readonly warnings: string[] = [];
  private readonly locals = new Map<number, LocalBook>();
  private readonly incomingBodies = new Map<number, IndexedBookBody>();
  private readonly incomingFingerprint: BookContentFingerprint;
  private ready = false;
  constructor(private readonly rows: ArchiveDatabaseRows, private readonly options: ArchiveBookImportOptions) {
    this.incomingFingerprint = new BookContentFingerprint(async (path) => options.resources.hash(path));
  }
  async initialize(): Promise<void> {
    requireTransfer(!this.ready, '书籍导入器已初始化');
    let after: number | null = null;
    while (true) {
      const books: PortableRow[] = await this.rows.database.query('SELECT * FROM books WHERE (? IS NULL OR id>?) ORDER BY id LIMIT 128', [after, after]);
      if (!books.length) break;
      for (const row of books) { after = row.id as number; this.locals.set(after, { row, identities: new Set(), acceptedOrigins: [] }); this.titles.set(after, row.title as string); }
    }
    const identities = await this.rows.database.query<{ localKey: string; stableId: string }>("SELECT localKey,stableId FROM transfer_identities WHERE localKey LIKE 'books:%'");
    for (const identity of identities) if (/^books:-?\d+$/.test(identity.localKey)) this.locals.get(Number(identity.localKey.slice(6)))?.identities.add(identity.stableId);
    this.ready = true;
  }
  private async incoming(envelope: PortableEnvelope): Promise<IndexedBookBody> {
    const id = envelope.row.id as number; let result = this.incomingBodies.get(id);
    if (!result) {
      const staging = this.options.staging;
      async function* chapters(): AsyncGenerator<PortableChapterBody> {
        for await (const { row } of staging.chapters(id)) yield { chapterOrder: row.chapterOrder as number, title: row.title as string, content: row.content as string };
      }
      result = await this.options.index.addBook('incoming', envelope.row, chapters(), this.incomingFingerprint, '', this.options.signal); this.incomingBodies.set(id, result);
    }
    return result;
  }
  private async localBody(local: LocalBook): Promise<IndexedBookBody> {
    if (local.incomingOrigin !== undefined) return this.incomingBodies.get(local.incomingOrigin)!;
    local.body ??= await this.options.index.addBook('local', local.row, localBookChapters(this.rows.database, local.row.id as number), this.options.localFingerprint, this.options.localFilesRoot, this.options.signal, this.options.normalizeLocalBody);
    return local.body;
  }
  private async original(local: LocalBook): Promise<string | null> {
    if (local.original === undefined) local.original = online(local.row) ? null : await this.options.localOriginal(local.row);
    return local.original;
  }
  async book(envelope: PortableEnvelope): Promise<ImportRowOutcome> {
    requireTransfer(this.ready && envelope.table === 'books' && !this.books.has(envelope.row.id as number), '导入书籍未就绪或身份重复');
    const incoming = envelope.row, incomingId = incoming.id as number, body = await this.incoming(envelope), options = this.options;
    const original = online(incoming) ? null : options.resources.originalIdentity(incoming.filePath as string);
    const identity = envelope.identity ?? (online(incoming) ? portableOnlineIdentity(incoming.sourceId as string, incoming.comicId as string) : original ?? options.resources.directoryIdentity(incoming.filePath as string, incoming) ?? body.rawIdentity);
    const compatible = async (local: LocalBook): Promise<boolean> => {
      if (local.row.contentType !== incoming.contentType || online(local.row) !== online(incoming)) return false;
      if (online(incoming) && (local.row.sourceId !== incoming.sourceId || local.row.comicId !== incoming.comicId)) return false;
      const localOriginal = await this.original(local); if (original && localOriginal && original !== localOriginal) return false;
      if (envelope.parentOnly) return !envelope.bodyVersion || envelope.bodyVersion === (await this.localBody(local)).version;
      await this.localBody(local);
      if (!await options.index.compatible({ side: 'incoming', id: incomingId }, local.incomingOrigin === undefined ? { side: 'local', id: local.row.id as number } : { side: 'incoming', id: local.incomingOrigin })) return false;
      for (const previous of local.acceptedOrigins) if (!await options.index.compatible({ side: 'incoming', id: incomingId }, { side: 'incoming', id: previous })) return false;
      return true;
    };
    let matched: LocalBook | undefined;
    if (options.mode === 'MERGE' || this.locals.size > 0) {
      // Replacement starts with an empty receiver catalog. Books inserted from
      // this same archive are still candidates for deduplication.
      for (const local of this.locals.values()) {
        if (options.mode === 'REPLACE' && local.incomingOrigin === undefined) continue;
        let candidate = local.identities.has(identity) || online(incoming) && local.row.sourceId === incoming.sourceId && local.row.comicId === incoming.comicId;
        if (!candidate && !online(incoming) && local.row.contentType === incoming.contentType) {
          const localOriginal = await this.original(local);
          const primary = localOriginal ?? await options.localDirectoryIdentity?.(local.row) ?? (await this.localBody(local)).rawIdentity;
          candidate = primary === identity || original !== null && localOriginal === original;
        }
        if (candidate && await compatible(local)) { matched = local; break; }
      }
      if (!matched && !online(incoming) && !envelope.parentOnly && body.contentIdentity !== null) {
        for (const local of this.locals.values()) {
          if (online(local.row) || local.row.contentType !== incoming.contentType || options.mode === 'REPLACE' && local.incomingOrigin === undefined) continue;
          if (original !== null && await this.original(local) !== null) continue;
          if ((await this.localBody(local)).contentIdentity === body.contentIdentity && await compatible(local)) { matched = local; break; }
        }
      }
    }
    if (!matched && envelope.parentOnly) { this.warnings.push(`《${incoming.title}》未在本机找到对应版本，相关标注和记录已跳过；选择书籍类别可完整传送`); return 'skipped'; }
    let outcome: ImportRowOutcome;
    if (matched) {
      const protection = (await this.rows.database.query<{ isProtected: number }>('SELECT isProtected FROM categories WHERE name=? LIMIT 1', [incoming.category!]))[0]?.isProtected;
      if (protection && matched.row.category !== incoming.category) {
        await this.rows.database.execute('UPDATE books SET category=? WHERE id=?', [incoming.category!, matched.row.id!]); matched.row.category = incoming.category!;
      }
      if ((incoming.totalChapters as number) > (matched.row.totalChapters as number)) {
        await this.rows.database.execute('UPDATE books SET totalChapters=? WHERE id=?', [incoming.totalChapters!, matched.row.id!]); matched.row.totalChapters = incoming.totalChapters!;
      }
      if (options.categories.includes('HISTORY') && (incoming.lastReadTime as number) > (matched.row.lastReadTime as number)) {
        const progress = ['currentChapterIndex', 'scrollOffset', 'lastReadTime', 'isFinished'];
        await this.rows.database.execute(`UPDATE books SET ${progress.map((key) => `"${key}"=?`).join(',')} WHERE id=? AND lastReadTime<?`, [...progress.map((key) => incoming[key]!), matched.row.id!, incoming.lastReadTime!]);
        for (const key of progress) matched.row[key] = incoming[key]!;
      }
      outcome = 'merged';
    } else {
      const row = options.resources.row(incoming); delete row.id;
      if (!options.categories.includes('HISTORY')) { row.currentChapterIndex = 0; row.scrollOffset = 0; row.lastReadTime = 0; row.isFinished = 0; }
      const id = await this.rows.insert('books', row); row.id = id;
      matched = { row, identities: new Set(), original, incomingOrigin: incomingId, acceptedOrigins: [] }; this.locals.set(id, matched); this.titles.set(id, row.title as string); outcome = 'added';
    }
    matched.identities.add(identity); if (!envelope.parentOnly) matched.acceptedOrigins.push(incomingId);
    const mapped = matched.row.id as number; this.books.set(incomingId, mapped);
    await this.rows.database.execute('INSERT OR REPLACE INTO transfer_identities (localKey,stableId) VALUES (?,?)', [`books:${mapped}`, identity]);
    return outcome;
  }
  async chapter(envelope: PortableEnvelope, parentOnly = false): Promise<ImportRowOutcome> {
    requireTransfer(this.ready && envelope.table === 'chapters', '章节导入器未就绪');
    const incoming = envelope.row, bookId = this.books.get(incoming.bookId as number); if (bookId === undefined) return 'skipped';
    const local = this.locals.get(bookId)!, existing = await this.rows.find('chapters', ['bookId', 'chapterOrder'], [bookId, incoming.chapterOrder!]);
    const content = this.options.resources.body(incoming.content as string, local.row.contentType as string);
    if (existing) {
      this.chapters.set(incoming.id as number, existing.id as number);
      if (parentOnly) return 'skipped';
      if (!(existing.content as string).trim() && content.trim()) {
        await this.rows.database.execute('UPDATE chapters SET content=?,startCharIndex=?,endCharIndex=? WHERE id=?', [content, incoming.startCharIndex!, incoming.endCharIndex!, existing.id!]); return 'merged';
      }
      return 'skipped';
    }
    if (parentOnly) return 'skipped';
    const row: PortableRow = { ...incoming, bookId, content }; delete row.id;
    this.chapters.set(incoming.id as number, await this.rows.insert('chapters', row)); return 'added';
  }
}
