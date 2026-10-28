import { AsyncMutex } from '@core/library/contentMutationGate';
import type { SQLiteDatabase, SqliteExecutor, SqlValue } from './interfaces';

type ManagedDatabase<T extends SQLiteDatabase> = T & Required<Pick<SQLiteDatabase, 'transaction'>>;
const wrappers = new WeakMap<object, ManagedDatabase<SQLiteDatabase>>();
const begins = (sql: string) => /^\s*BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE))?(?:\s+TRANSACTION)?\s*;?\s*$/i.test(sql);
const finishes = (sql: string) => /^\s*(?:COMMIT|END|ROLLBACK)(?:\s+TRANSACTION)?\s*;?\s*$/i.test(sql);
function assertActive(active: boolean): void { if (!active) throw new Error('The SQLite transaction scope has ended'); }

/** A managed transaction owns the entire connection, not individual statements.
 * Its scoped executor bypasses the public queue; all other readers/writers wait
 * until commit/rollback. Existing explicit BEGIN callers are allowed to finish
 * before a managed transaction starts. The proxy preserves instanceof and the
 * database's diagnostics while exposing the same production API. */
export function withExclusiveDatabase<T extends SQLiteDatabase>(database: T): ManagedDatabase<T> {
  const existing = wrappers.get(database); if (existing) return existing as ManagedDatabase<T>;
  const connection = new AsyncMutex();
  let legacy: { finished: Promise<void>; release(): void } | undefined;
  const finishLegacy = () => { const previous = legacy; legacy = undefined; previous?.release(); };
  const execute = async (sql: string, params?: SqlValue[]) => connection.withLock(async () => {
    const result = await database.execute(sql, params);
    if (begins(sql)) {
      let release!: () => void; const finished = new Promise<void>((resolve) => { release = resolve; }); legacy = { finished, release };
    } else if (finishes(sql)) finishLegacy();
    return result;
  });
  const query = async <R>(sql: string, params?: SqlValue[]): Promise<R[]> => connection.withLock(() => database.query<R>(sql, params));
  const transaction = async <R>(operation: (executor: SqliteExecutor) => Promise<R>): Promise<R> => {
    while (true) {
      let wait: Promise<void> | undefined, result: { value: R } | undefined;
      await connection.withLock(async () => {
        if (legacy) { wait = legacy.finished; return; }
        await database.execute('BEGIN IMMEDIATE');
        let active = true;
        const statements = new AsyncMutex();
        const executor: SqliteExecutor = {
          execute: (sql, params) => statements.withLock(async () => {
            assertActive(active);
            if (begins(sql) || finishes(sql) || /^\s*(?:SAVEPOINT|RELEASE)\b/i.test(sql)) throw new Error('The managed SQLite transaction owns its commit boundary');
            return database.execute(sql, params);
          }),
          query: <V>(sql: string, params?: SqlValue[]) => statements.withLock(async () => {
            assertActive(active);
            if (begins(sql) || finishes(sql) || /^\s*(?:SAVEPOINT|RELEASE)\b/i.test(sql)) throw new Error('The managed SQLite transaction owns its commit boundary');
            return database.query<V>(sql, params);
          }),
        };
        try {
          const value = await operation(executor); active = false;
          await statements.withLock(async () => {});
          await database.execute('COMMIT'); result = { value };
        } catch (error) {
          active = false;
          await statements.withLock(async () => {});
          try { await database.execute('ROLLBACK'); }
          catch (rollback) { throw new AggregateError([error, rollback], 'SQLite transaction and rollback failed'); }
          throw error;
        }
      });
      if (wait) { await wait; continue; }
      if (!result) throw new Error('SQLite transaction did not produce a result');
      return result.value;
    }
  };
  const proxy = new Proxy(database, {
    get(target, property) {
      if (property === 'execute') return execute;
      if (property === 'query') return query;
      if (property === 'transaction') return transaction;
      if (property === 'open') return (options: { name: string }) => connection.withLock(() => database.open(options));
      if (property === 'close') return () => connection.withLock(async () => { try { await database.close(); } finally { finishLegacy(); } });
      const value: unknown = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as ManagedDatabase<T>;
  wrappers.set(database, proxy); wrappers.set(proxy, proxy); return proxy;
}
