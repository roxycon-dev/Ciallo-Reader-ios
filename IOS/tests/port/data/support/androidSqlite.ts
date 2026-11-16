/**
 * Shared helpers for `tests/port/data/**` — the Android→TS test ports of
 * `novel-reader/app/src/test/java/com/example/{data,data/favorite,network,integration}`.
 *
 * `node:sqlite` (Node ≥ 22.5, stable from 23.4) provides a REAL SQLite engine, which
 * is what the Android side gets from Room's `inMemoryDatabaseBuilder`. That lets the
 * Room-backed Android tests below be ported as real schema → real statement → real
 * rows, instead of the statement-recorder stubs `tests/unit/roomMigrations.test.ts`
 * uses (those deliberately assert the SQL *text*, which is a different question).
 *
 * ⚠️ EQUIVALENCE DEPENDENCY (Room 迁移测试): Android runs `MIGRATION_*` through Room's
 * `Migration.migrate(SupportSQLiteDatabase)` and then lets Room re-validate the whole
 * v12 schema (`identityHash`, every column, every index). Here the migration SQL runs
 * on real SQLite, but there is no Room schema validator afterwards, so a ported test
 * asserts the *migration's own* observable effects (rows preserved, columns added,
 * tables/indices created) and not Room's identityHash check. `Room 迁移测试的等价性依赖持久化实现`
 * — see the report.
 */

import { DatabaseSync } from 'node:sqlite';
import type { DatabaseLike } from '../../../../src/core/library/bookRepository';
import { createIndexSql, createTableSql, TABLES } from '../../../../src/core/db/schemaV12';

/**
 * `DatabaseLike` over a real in-memory SQLite, i.e. what Capacitor's SQLite plugin
 * gives the app at runtime (so the DAO/Repository SQL is exercised for real).
 */
export class MemorySqlite implements DatabaseLike {
  private readonly handle: DatabaseSync;

  constructor(handle: DatabaseSync) {
    this.handle = handle;
  }

  static open(): MemorySqlite {
    return new MemorySqlite(new DatabaseSync(':memory:'));
  }

  /** Kotlin `database.close()` in the Kotlin `@After` blocks. */
  close(): void {
    this.handle.close();
  }

  /** Room `openHelper.writableDatabase.execSQL(...)` used by the migration fixtures. */
  exec(sql: string): void {
    this.handle.exec(sql);
  }

  /** Kotlin `SupportSQLiteDatabase.query(sql).use { cursor -> … }`. */
  select<T>(sql: string, params: Array<string | number | null> = []): T[] {
    return this.handle.prepare(sql).all(...params) as T[];
  }

  /** Kotlin `cursor.getInt(0)` on a `SELECT COUNT(*)`-shaped row. */
  async count(sql: string, params: Array<string | number | null> = []): Promise<number> {
    const rows = this.select<{ c: number }>(sql, params);
    return rows[0]?.c ?? 0;
  }

  async execute(
    sql: string,
    params: Array<string | number | null> = [],
  ): Promise<{ rowsAffected: number; lastInsertRowId?: number }> {
    const statement = this.handle.prepare(sql);
    const info = statement.run(...params);
    const lastInsertRowId = Number(info.lastInsertRowid);
    return {
      rowsAffected: Number(info.changes),
      ...(Number.isFinite(lastInsertRowId) ? { lastInsertRowId } : {}),
    };
  }

  async query<T>(sql: string, params: Array<string | number | null> = []): Promise<T[]> {
    return this.select<T>(sql, params);
  }
}

/** Kotlin `Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).build()` — the v12 schema. */
export function createV12Database(): MemorySqlite {
  const db = MemorySqlite.open();
  for (const table of TABLES) {
    db.exec(createTableSql(table));
    for (const index of table.indices) {
      db.exec(createIndexSql(table, index));
    }
  }
  return db;
}

/** Kotlin `assertEquals(expected, actual)` order, spelled out for the integer/boolean cases. */
export const UTF8 = new TextEncoder();
export const UTF8_DECODER = new TextDecoder('utf-8');

export function utf8(text: string): Uint8Array {
  return UTF8.encode(text);
}

export function fromUtf8(bytes: Uint8Array): string {
  return UTF8_DECODER.decode(bytes);
}
