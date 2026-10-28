import type { DatabaseLike } from '@core/library/bookRepository';
import { BACKUP_TABLES } from '@core/db/schemaV13';
import { PortableRowsInspector, parsePortableRow, type PortableEnvelope, type PortableManifest } from './portableFormat';
import { isTransferSessionId, requireTransfer } from './transferWire';

/** Disk-backed row spool. Ordered, byte-bounded pagination lets the importer
 * visit tables in dependency order without rescanning or retaining book bodies.
 * The caller owns the connection/content gate and disposes this temporary table. */
export class TransferStagingRows {
  private readonly name: string;
  private ready = false;
  constructor(private readonly db: DatabaseLike, sessionId: string) {
    requireTransfer(isTransferSessionId(sessionId), '暂存数据库身份无效'); this.name = `_ciallo_transfer_${sessionId.replace(/-/g, '')}`;
  }
  async build(source: AsyncIterable<PortableEnvelope>, manifest?: PortableManifest, signal?: AbortSignal): Promise<void> {
    requireTransfer(!this.ready, '暂存数据已建立');
    await this.db.execute(`CREATE TEMP TABLE "${this.name}" (ordinal INTEGER PRIMARY KEY, tableName TEXT NOT NULL, envelope TEXT NOT NULL, byteEnd INTEGER NOT NULL)`);
    try {
      await this.db.execute(`CREATE INDEX "${this.name}_table" ON "${this.name}" (tableName,ordinal)`);
      const inspector = new PortableRowsInspector(), encoder = new TextEncoder();
      let ordinal = 0, byteEnd = 0, batchBytes = 0, batch: { ordinal: number; table: string; text: string; byteEnd: number }[] = [];
      const flush = async () => {
        if (!batch.length) return;
        requireTransfer(!signal?.aborted, '导入暂存已取消');
        await this.db.execute(`INSERT INTO "${this.name}" (ordinal,tableName,envelope,byteEnd) VALUES ${batch.map(() => '(?,?,?,?)').join(',')}`, batch.flatMap((row) => [row.ordinal, row.table, row.text, row.byteEnd]));
        batch = []; batchBytes = 0;
      };
      for await (const value of source) {
        requireTransfer(!signal?.aborted, '导入暂存已取消');
        const text = JSON.stringify(value), row = parsePortableRow(text), bytes = encoder.encode(text).length;
        inspector.add(row);
        if (batchBytes + bytes > 512 * 1024 || batch.length >= 128) await flush();
        byteEnd += bytes; requireTransfer(byteEnd <= 512 * 1024 * 1024, '数据库行文件超过 512MiB');
        batch.push({ ordinal: ++ordinal, table: row.table, text, byteEnd }); batchBytes += bytes;
      }
      await flush(); inspector.finish(manifest); this.ready = true;
    } catch (error) { await this.dispose(); throw error; }
  }
  async *table(table: string): AsyncGenerator<PortableEnvelope> {
    requireTransfer(this.ready && BACKUP_TABLES.includes(table), '暂存数据未就绪或数据表无效');
    let ordinal = 0;
    while (true) {
      const first = (await this.db.query<{ ordinal: number; byteEnd: number }>(`SELECT ordinal,byteEnd FROM "${this.name}" WHERE tableName=? AND ordinal>? ORDER BY ordinal LIMIT 1`, [table, ordinal]))[0];
      if (!first) return;
      const rows = await this.db.query<{ ordinal: number; envelope: string }>(`SELECT ordinal,envelope FROM "${this.name}" WHERE tableName=? AND ordinal>=? AND byteEnd<=? ORDER BY ordinal LIMIT 128`, [table, first.ordinal, first.byteEnd + 1024 * 1024]);
      requireTransfer(rows.length > 0, '暂存数据游标没有前进');
      for (const row of rows) { requireTransfer(row.ordinal > ordinal, '暂存数据次序错误'); ordinal = row.ordinal; yield parsePortableRow(row.envelope); }
    }
  }
  async dispose(): Promise<void> { this.ready = false; await this.db.execute(`DROP TABLE IF EXISTS "${this.name}"`); }
}
