import { afterEach, describe, expect, it } from 'vitest';
import { MemorySqlite } from '../port/data/support/androidSqlite';
import { withExclusiveDatabase } from '@platform/exclusiveDatabase';
import { InMemorySqliteDatabase } from '@platform/web-mock/inMemoryDb';
import type { SQLiteDatabase, SqliteExecutor } from '@platform/interfaces';

const databases: MemorySqlite[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
async function setup() {
  const memory = MemorySqlite.open(); databases.push(memory);
  const native: SQLiteDatabase = { open: async () => {}, close: async () => {}, execute: (sql, params) => memory.execute(sql, params as (string | number | null)[]), query: (sql, params) => memory.query(sql, params as (string | number | null)[]) };
  const db = withExclusiveDatabase(native); await db.execute('CREATE TABLE values_table (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
  await db.execute("INSERT INTO values_table VALUES (1,'原有书籍')"); return db;
}
describe('managed SQLite connection ownership', () => {
  it('queues outside reads/writes until a failed import rolls back, preserving the later UI write', async () => {
    const db = await setup(), entered = deferred(), release = deferred(); let outsideSettled = false;
    const transaction = db.transaction(async (tx) => { await tx.execute("INSERT INTO values_table VALUES (2,'未完成导入')"); entered.resolve(); await release.promise; throw new Error('Import failed'); });
    await entered.promise;
    const read = db.query<{ id: number }>('SELECT id FROM values_table ORDER BY id').then((rows) => { outsideSettled = true; return rows; });
    const uiWrite = db.execute("INSERT INTO values_table VALUES (3,'后来收藏')");
    await Promise.resolve(); expect(outsideSettled).toBe(false); release.resolve();
    await expect(transaction).rejects.toThrow('Import failed'); expect(await read).toEqual([{ id: 1 }]); await uiWrite;
    expect(await db.query('SELECT id FROM values_table ORDER BY id')).toEqual([{ id: 1 }, { id: 3 }]);
  });
  it('serializes two complete transactions and publishes only their committed state', async () => {
    const db = await setup(), entered = deferred(), release = deferred(), events: string[] = [];
    const first = db.transaction(async (tx) => { events.push('first'); await tx.execute("INSERT INTO values_table VALUES (2,'第一批')"); entered.resolve(); await release.promise; });
    await entered.promise;
    const second = db.transaction(async (tx) => { events.push('second'); expect(await tx.query('SELECT id FROM values_table ORDER BY id')).toEqual([{ id: 1 }, { id: 2 }]); await tx.execute("INSERT INTO values_table VALUES (3,'第二批')"); });
    await Promise.resolve(); expect(events).toEqual(['first']); release.resolve(); await Promise.all([first, second]);
    expect(events).toEqual(['first', 'second']); expect(await db.query('SELECT id FROM values_table ORDER BY id')).toHaveLength(3);
  });
  it('lets an existing explicit transaction finish before starting a managed import', async () => {
    const db = await setup(); await db.execute('BEGIN'); await db.execute("INSERT INTO values_table VALUES (2,'旧事务')"); let entered = false;
    const managed = db.transaction(async (tx) => { entered = true; return tx.query('SELECT id FROM values_table ORDER BY id'); });
    await Promise.resolve(); expect(entered).toBe(false); await db.execute('COMMIT'); expect(await managed).toEqual([{ id: 1 }, { id: 2 }]);
  });
  it('revokes escaped scoped executors and owns COMMIT/ROLLBACK through either API', async () => {
    const db = await setup(); let escaped: SqliteExecutor | undefined;
    await db.transaction(async (tx) => { escaped = tx; }); await expect(escaped!.execute("INSERT INTO values_table VALUES (4,'迟到写入')")).rejects.toThrow('scope has ended');
    for (const method of ['execute', 'query'] as const) {
      await expect(db.transaction(async (tx) => { await tx.execute("INSERT INTO values_table VALUES (5,'待回滚')"); await tx[method]('COMMIT'); })).rejects.toThrow('commit boundary');
    }
    expect(await db.query('SELECT id FROM values_table ORDER BY id')).toEqual([{ id: 1 }]);
  });
  it('preserves concrete platform identity and wraps a connection only once', () => {
    const raw = new InMemorySqliteDatabase(), wrapped = withExclusiveDatabase(raw);
    expect(wrapped).toBeInstanceOf(InMemorySqliteDatabase); expect(withExclusiveDatabase(raw)).toBe(wrapped); expect(withExclusiveDatabase(wrapped)).toBe(wrapped); expect(typeof wrapped.transaction).toBe('function');
  });
});
