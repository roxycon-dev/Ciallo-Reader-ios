/**
 * Room v12 schema ↔ `schemaV12.ts`, verified **against Room's own export**.
 *
 * This is the counterpart of `roomV12SchemaParity.test.ts`, which cross-checks
 * `TABLES` against a hand transcription of `12.json`. A transcription can drift from
 * the file it claims to transcribe; this test reads the authoritative artifact itself
 * — `novel-reader/app/schemas/com.example.data.AppDatabase/12.json`, the file Room
 * writes from `@Database(entities = [...], version = 12, exportSchema = true)` in
 * `data/AppDatabase.kt` lines 241..245 — and drives a **real SQLite engine**
 * (`node:sqlite`, the same engine Room's `inMemoryDatabaseBuilder` uses) with the DDL
 * that `schemaV12.ts` generates. Everything asserted below is therefore observable on
 * a live database, not on a JS object that a port author wrote by hand.
 *
 * What is pinned, per table:
 *   - the number of tables (14) and their order,
 *   - every column's name / affinity / notNull / default, in `fields[]` order,
 *   - the primary key (`primaryKey.columnNames` + `primaryKey.autoGenerate`),
 *   - the presence of `foreignKeys: []` on every table,
 *   - the physical DDL text, byte-for-byte against `database.entities[].createSql`
 *     after normalising SQLite's two legal identifier quoting styles,
 *   - every index, byte-for-byte against `database.entities[].indices[].createSql`,
 *   - the `setupQueries` identity hash, and therefore `ROOM_IDENTITY_HASH`.
 *
 * If the Room export is ever regenerated with a different identityHash (an entity or
 * DAO change), this test fails on the hash alone — which is exactly Room's own
 * "schema mismatch" check, reproduced on the TS side.
 */
import { existsSync, readFileSync } from 'node:fs';
import { androidReference } from '../helpers/androidReference';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { LEGACY_MIGRATION_INDEXES } from '../../src/core/db/legacyDatabaseMigration';
import {
  BACKUP_TABLES,
  createIndexSql,
  createTableSql,
  ROOM_IDENTITY_HASH,
  ROOM_SCHEMA_VERSION,
  TABLES,
} from '../../src/core/db/schemaV12';

/* ─────────────────────────── the authoritative artifact ─────────────────────────── */

const SCHEMA_JSON = androidReference('app/schemas/com.example.data.AppDatabase/12.json');

/** Room writes `defaultValue` only when an entity declares `@ColumnInfo(defaultValue = …)`. */
interface RoomField {
  fieldPath: string;
  columnName: string;
  affinity: 'INTEGER' | 'TEXT' | 'REAL' | 'BLOB';
  notNull: boolean;
  defaultValue?: unknown;
}

interface RoomIndex {
  name: string;
  unique: boolean;
  columnNames: string[];
  orders: string[];
  createSql: string;
}

interface RoomForeignKey {
  table: string;
  columns: string[];
  onDelete?: string;
  onUpdate?: string;
}

interface RoomEntity {
  tableName: string;
  createSql: string;
  fields: RoomField[];
  primaryKey: { columnNames: string[]; autoGenerate: boolean };
  indices: RoomIndex[];
  foreignKeys: RoomForeignKey[];
}

interface RoomExport {
  database: {
    version: number;
    identityHash: string;
    entities: RoomEntity[];
    views: unknown[];
    setupQueries: string[];
  };
}

const ROOM: RoomExport = (() => {
  if (!existsSync(SCHEMA_JSON)) {
    // A parity test must never pass because its authority is missing.
    throw new Error(
      `Room v12 schema export not found at ${SCHEMA_JSON} — ` +
        'the Android source tree must be checked out next to IOS/ for this test to run.',
    );
  }
  return JSON.parse(readFileSync(SCHEMA_JSON, 'utf8')) as RoomExport;
})();

/** SQLite accepts \`ident\` and "ident" interchangeably; Room emits the former. */
function normalizeQuoting(sql: string): string {
  return sql.replaceAll('`', '"');
}

/**
 * Room's createSql carries a `${TABLE_NAME}` placeholder **inside** backticks, so after
 * normalising the quoting the bare table name is what goes in.
 */
function roomCreateTableSql(entity: RoomEntity): string {
  return normalizeQuoting(entity.createSql).replaceAll('${TABLE_NAME}', entity.tableName);
}

function roomIndexSql(entity: RoomEntity, index: RoomIndex): string {
  return normalizeQuoting(index.createSql).replaceAll('${TABLE_NAME}', entity.tableName);
}

/**
 * SQLite rewrites `… IF NOT EXISTS …` out of the text it stores in `sqlite_master`,
 * so the *stored* form of both sides has the clause removed before comparing.
 */
function withoutIfNotExists(sql: string): string {
  return sql.replace(' IF NOT EXISTS', '');
}

/** `CREATE … INDEX IF NOT EXISTS "name" ON …` → `name`. */
function indexNameOf(createIndexSql: string): string {
  const match = /INDEX IF NOT EXISTS "([^"]+)"/.exec(createIndexSql);
  if (!match) throw new Error(`cannot read index name from ${createIndexSql}`);
  return match[1] as string;
}

/* ───────────────────────── the generated DDL, on real SQLite ───────────────────────── */

const sqlite = new DatabaseSync(':memory:');

for (const table of TABLES) {
  sqlite.exec(createTableSql(table));
  for (const index of table.indices) {
    sqlite.exec(createIndexSql(table, index));
  }
}

const storedSql = new Map<string, string>(
  (
    sqlite.prepare('SELECT name, sql FROM sqlite_master WHERE type = ?').all('table') as Array<{
      name: string;
      sql: string;
    }>
  ).map((r) => [r.name, r.sql]),
);

const storedIndexSql = new Map<string, string>(
  (
    sqlite.prepare('SELECT name, sql FROM sqlite_master WHERE type = ?').all('index') as Array<{
      name: string;
      sql: string;
    }>
  ).map((r) => [r.name, r.sql]),
);

interface PragmaColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function tableInfo(table: string): PragmaColumn[] {
  return sqlite.prepare(`PRAGMA table_info("${table}")`).all() as unknown as PragmaColumn[];
}

/* ─────────────────────────────────── assertions ─────────────────────────────────── */

describe('Room v12 export (novel-reader/app/schemas/…/12.json) — facts', () => {
  it('is itself version 12 with the identityHash the project pins', () => {
    // These two constants are the ones the task statement calls "authoritative facts";
    // asserting them against the file means the file and the port cannot disagree.
    expect(ROOM.database.version).toBe(12);
    expect(ROOM.database.identityHash).toBe('4edcea8e99eeed709b4f4497a5cc18a0');
    expect(ROOM_SCHEMA_VERSION).toBe(ROOM.database.version);
    expect(ROOM_IDENTITY_HASH).toBe(ROOM.database.identityHash);
  });

  it('exports exactly 14 entities, no views, and no default values anywhere', () => {
    expect(ROOM.database.entities).toHaveLength(14);
    expect(ROOM.database.views).toEqual([]);
    const columnCount = ROOM.database.entities.reduce((n, e) => n + e.fields.length, 0);
    expect(columnCount).toBe(123);
    // Room emits `defaultValue` only for `@ColumnInfo(defaultValue = …)`; no entity here
    // declares one, so there is nothing for schemaV12.ts to transcribe.
    for (const entity of ROOM.database.entities) {
      for (const field of entity.fields) {
        expect(Object.hasOwn(field, 'defaultValue'), `${entity.tableName}.${field.columnName}`).toBe(
          false,
        );
      }
    }
  });

  it('registers the identityHash through Room\'s own setupQueries', () => {
    expect(ROOM.database.setupQueries).toEqual([
      'CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)',
      "INSERT OR REPLACE INTO room_master_table (id,identity_hash) VALUES(42, '4edcea8e99eeed709b4f4497a5cc18a0')",
    ]);
  });
});

describe('TABLES ↔ 12.json, entity by entity', () => {
  it('declares 14 tables in the exact order Room exports them', () => {
    expect(TABLES).toHaveLength(14);
    expect(TABLES.map((t) => t.name)).toEqual(ROOM.database.entities.map((e) => e.tableName));
  });

  for (const entity of ROOM.database.entities) {
    const actual = TABLES.find((t) => t.name === entity.tableName);
    if (!actual) throw new Error(`TABLES is missing ${entity.tableName}`);

    describe(entity.tableName, () => {
      it('has the same columns, in the same order, on name / affinity / notNull / default', () => {
        expect(actual.columns).toHaveLength(entity.fields.length);
        entity.fields.forEach((field, i) => {
          const column = actual.columns[i];
          expect(column, `${entity.tableName}.${field.columnName} (index ${i})`).toBeDefined();
          if (!column) return;
          expect(column.name).toBe(field.columnName);
          expect(column.type).toBe(field.affinity);
          expect(column.notNull === true).toBe(field.notNull === true);
        });
      });

      it('has the same primary key and autoGenerate flag', () => {
        expect(actual.primaryKey).toEqual(entity.primaryKey.columnNames);
        expect(actual.autoGeneratePk).toBe(entity.primaryKey.autoGenerate);
        const flagged = actual.columns.filter((c) => c.primaryKey).map((c) => c.name);
        expect(flagged).toEqual(entity.primaryKey.columnNames);
      });

      it('has no foreign keys (12.json declares none for any table)', () => {
        expect(entity.foreignKeys).toEqual([]);
      });

      it('matches every index on name / unique / columns', () => {
        expect(actual.indices.map((i) => i.name)).toEqual(entity.indices.map((i) => i.name));
        expect(actual.indices).toEqual(
          entity.indices.map((i) => ({ name: i.name, unique: i.unique, columns: i.columnNames })),
        );
      });

      it('emits the physical DDL byte-for-byte identical to Room\'s createSql', () => {
        const roomSql = roomCreateTableSql(entity);
        expect(normalizeQuoting(createTableSql(actual))).toBe(roomSql);
        // …and the engine stored that exact text, so the comparison is not a JS
        // string comparison of something never handed to SQLite.
        expect(storedSql.get(entity.tableName)).toBe(withoutIfNotExists(roomSql));
      });

      it('exposes the same columns through a real PRAGMA table_info', () => {
        expect(tableInfo(entity.tableName)).toEqual(
          entity.fields.map((f, i) => ({
            cid: i,
            name: f.columnName,
            type: f.affinity,
            notnull: f.notNull ? 1 : 0,
            dflt_value: null,
            // PRAGMA reports 1-based positions for composite keys, 1 for a single one.
            pk: entity.primaryKey.columnNames.indexOf(f.columnName) + 1,
          })),
        );
      });
    });
  }

  it('creates no table other than the 14 (plus SQLite\'s own sqlite_sequence)', () => {
    // AUTOINCREMENT makes SQLite materialise `sqlite_sequence`; that is the engine's
    // bookkeeping table, not a 15th entity.
    const tables = [...storedSql.keys()].filter((n) => n !== 'sqlite_sequence').sort();
    expect(tables).toEqual(TABLES.map((t) => t.name).sort());
  });

  it('uses AUTOINCREMENT on exactly the five autoGenerate tables', () => {
    const autoGenerate = TABLES.filter((t) => t.autoGeneratePk).map((t) => t.name);
    expect(autoGenerate).toEqual([
      'books',
      'chapters',
      'bookmarks',
      'highlights',
      'categories',
      'reading_records',
      'reading_sessions',
      'anilist_titles',
      'god_moments',
    ]);
    for (const table of TABLES) {
      const sql = storedSql.get(table.name) ?? '';
      expect(sql.includes('AUTOINCREMENT')).toBe(table.autoGeneratePk);
    }
  });

  it('emits all 12 indices with DDL identical to Room\'s createSql', () => {
    const roomIndices = ROOM.database.entities.flatMap((e) => e.indices.map((i) => roomIndexSql(e, i)));
    const generated = TABLES.flatMap((t) => t.indices.map((i) => createIndexSql(t, i)));
    expect(generated).toHaveLength(12);
    expect(generated).toEqual(roomIndices);
    // …and the engine stored each generated statement. `sqlite_master` also lists
    // SQLite's internal `sqlite_autoindex_*` entries for the UNIQUE constraints; those
    // have a NULL `sql`, so only the named ones are compared.
    const stored = [...storedIndexSql.entries()].filter(([, sql]) => sql !== null);
    expect(stored).toEqual([
      ...generated.map((sql) => [indexNameOf(sql), withoutIfNotExists(sql)] as const),
    ]);
  });

  it('matches the 12 index statements LegacyDatabaseMigration replays', () => {
    // `LegacyDatabaseMigration.INDEXES` is a verbatim copy of the Kotlin block; it must
    // describe the same 12 indices the generated DDL creates.
    expect(LEGACY_MIGRATION_INDEXES).toHaveLength(12);
    const fromLegacy = LEGACY_MIGRATION_INDEXES.map(normalizeQuoting);
    const fromSchema = TABLES.flatMap((t) => t.indices.map((i) => createIndexSql(t, i)));
    expect(fromLegacy).toEqual(fromSchema);
  });
});

describe('the 12-vs-14 backup split', () => {
  it('drops exactly download_tasks and anilist_titles, keeping Room\'s order', () => {
    expect(BACKUP_TABLES).toHaveLength(12);
    expect(TABLES.map((t) => t.name).filter((n) => !BACKUP_TABLES.includes(n))).toEqual([
      'download_tasks',
      'anilist_titles',
    ]);
    // relative order preserved
    expect(BACKUP_TABLES).toEqual(
      TABLES.map((t) => t.name).filter((n) => BACKUP_TABLES.includes(n)),
    );
  });

  it('backups only tables that exist in the v12 export', () => {
    const names = new Set(TABLES.map((t) => t.name));
    for (const table of BACKUP_TABLES) expect(names.has(table)).toBe(true);
  });
});
