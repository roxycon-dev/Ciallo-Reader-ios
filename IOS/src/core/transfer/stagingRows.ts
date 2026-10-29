import type { DatabaseLike } from '@core/library/bookRepository';
import { BACKUP_TABLES } from '@core/db/schemaV13';
import { PortableRowsInspector, parsePortableRow, type PortableEnvelope, type PortableManifest } from './portableFormat';
import { isTransferSessionId, requireTransfer } from './transferWire';
import { boundedTransferBatch } from './rowBatch';

/** Disk-backed row spool. Ordered, byte-bounded pagination lets the importer
 * visit tables in dependency order without rescanning or retaining book bodies.
 * The caller owns the connection/content gate and disposes this temporary table. */
export class TransferStagingRows {
  private readonly name: string;
  private ready = false;
  constructor(private readonly db: DatabaseLike, private readonly sessionId: string) {
    requireTransfer(isTransferSessionId(sessionId), '暂存数据库身份无效'); this.name = `_ciallo_transfer_${sessionId.replace(/-/g, '')}`;
  }
  async build(source: AsyncIterable<PortableEnvelope>, manifest?: PortableManifest, signal?: AbortSignal): Promise<void> {
    requireTransfer(!this.ready, '暂存数据已建立');
    await this.db.execute(`CREATE TEMP TABLE "${this.name}" (ordinal INTEGER PRIMARY KEY, tableName TEXT NOT NULL, bookId INTEGER, chapterOrder INTEGER, byteSize INTEGER NOT NULL, byteEnd INTEGER NOT NULL, envelope TEXT NOT NULL)`);
    try {
      await this.db.execute(`CREATE INDEX "${this.name}_table" ON "${this.name}" (tableName,ordinal)`);
      await this.db.execute(`CREATE INDEX "${this.name}_book" ON "${this.name}" (tableName,bookId,chapterOrder,ordinal,byteSize)`);
      const inspector = new PortableRowsInspector(), encoder = new TextEncoder();
      let ordinal = 0, byteEnd = 0, batchBytes = 0, batch: { ordinal: number; table: string; text: string; byteEnd: number; bytes: number; bookId: number | null; chapterOrder: number | null }[] = [];
      const flush = async () => {
        if (!batch.length) return;
        requireTransfer(!signal?.aborted, '导入暂存已取消');
        await this.db.execute(`INSERT INTO "${this.name}" (ordinal,tableName,envelope,byteEnd,bookId,chapterOrder,byteSize) VALUES ${batch.map(() => '(?,?,?,?,?,?,?)').join(',')}`, batch.flatMap((row) => [row.ordinal, row.table, row.text, row.byteEnd, row.bookId, row.chapterOrder, row.bytes]));
        batch = []; batchBytes = 0;
      };
      for await (const value of source) {
        requireTransfer(!signal?.aborted, '导入暂存已取消');
        const text = JSON.stringify(value), row = parsePortableRow(text), bytes = encoder.encode(text).length;
        inspector.add(row);
        if (batchBytes + bytes > 512 * 1024 || batch.length >= 128) await flush();
        byteEnd += bytes; requireTransfer(byteEnd <= 512 * 1024 * 1024, '数据库行文件超过 512MiB');
        batch.push({ ordinal: ++ordinal, table: row.table, text, byteEnd, bytes, bookId: row.table === 'chapters' ? row.row.bookId as number : null, chapterOrder: row.table === 'chapters' ? row.row.chapterOrder as number : null }); batchBytes += bytes;
      }
      await flush(); inspector.finish(manifest); this.ready = true;
    } catch (error) { await this.dispose(); throw error; }
  }
  async *table(table: string): AsyncGenerator<PortableEnvelope> {
    requireTransfer(this.ready && BACKUP_TABLES.includes(table), '暂存数据未就绪或数据表无效');
    let ordinal = 0;
    while (true) {
      const metadata = await this.db.query<{ ordinal: number; bytes: number }>(`SELECT ordinal,byteSize AS bytes FROM "${this.name}" WHERE tableName=? AND ordinal>? ORDER BY ordinal LIMIT 128`, [table, ordinal]);
      if (!metadata.length) return;
      const selected = boundedTransferBatch(metadata, 2);
      const rows = await this.db.query<{ ordinal: number; envelope: string }>(`SELECT ordinal,envelope FROM "${this.name}" WHERE ordinal IN (${selected.map(() => '?').join(',')}) ORDER BY ordinal`, selected.map((row) => row.ordinal));
      requireTransfer(rows.length === selected.length, '暂存数据在读取时发生变化');
      for (const row of rows) { requireTransfer(row.ordinal > ordinal, '暂存数据次序错误'); ordinal = row.ordinal; yield parsePortableRow(row.envelope); }
    }
  }
  async dispose(): Promise<void> { this.ready = false; await this.db.execute(`DROP TABLE IF EXISTS "${this.name}"`); }
  using(database: DatabaseLike): TransferStagingRows {
    requireTransfer(this.ready, '暂存数据未就绪');
    const view = new TransferStagingRows(database, this.sessionId); view.ready = true; return view;
  }
  async *chapters(bookId: number): AsyncGenerator<PortableEnvelope> {
    requireTransfer(this.ready && Number.isSafeInteger(bookId), '暂存数据未就绪或书籍身份无效');
    let order: number | null = null, ordinal = 0;
    while (true) {
      const metadata: { ordinal: number; bytes: number }[] = await this.db.query(`SELECT ordinal,byteSize AS bytes FROM "${this.name}" WHERE tableName='chapters' AND bookId=? AND (? IS NULL OR chapterOrder>? OR (chapterOrder=? AND ordinal>?)) ORDER BY chapterOrder,ordinal LIMIT 128`, [bookId, order, order, order, ordinal]);
      if (!metadata.length) return;
      const selected = boundedTransferBatch(metadata, 2);
      const rows: { chapterOrder: number; ordinal: number; envelope: string }[] = await this.db.query(`SELECT chapterOrder,ordinal,envelope FROM "${this.name}" WHERE ordinal IN (${selected.map(() => '?').join(',')}) ORDER BY chapterOrder,ordinal`, selected.map((row) => row.ordinal));
      requireTransfer(rows.length === selected.length, '暂存章节在读取时发生变化');
      for (const row of rows) { order = row.chapterOrder; ordinal = row.ordinal; yield parsePortableRow(row.envelope); }
    }
  }
}
