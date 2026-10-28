// Exercise the production native adapter against real SQLite, including the
// bridge's required options and iOS metadata row. The old web mock hid these bugs.
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlValue } from '@platform/interfaces';
import { CapacitorSqliteDatabase } from '@platform/ios-native/capacitorDb';
import { openAppDatabase } from '@core/db/openDatabase';
import { SettingsRepository } from '@core/settings/settingsRepository';

const state = vi.hoisted(() => ({
  sqlite: null as DatabaseSync | null,
  failOpen: false,
  creates: 0,
  releases: 0,
}));
vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: new Proxy({
    createConnection: async () => {
      state.creates += 1;
    },
    open: async () => {
      if (state.failOpen) throw new Error('device database unavailable');
      state.sqlite = new DatabaseSync(':memory:');
    },
    closeConnection: async () => {
      state.releases += 1;
      state.sqlite?.close();
      state.sqlite = null;
    },
    run: async ({
      statement,
      values,
      transaction,
    }: {
      statement: string;
      values: SqlValue[];
      transaction: boolean;
    }) => {
      if (!Array.isArray(values)) throw new Error('Must provide an Array of values');
      if (transaction !== false) throw new Error('adapter must preserve explicit transactions');
      const result = state.sqlite!.prepare(statement).run(...values);
      return {
        changes: { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) },
      };
    },
    query: async ({ statement, values }: { statement: string; values: SqlValue[] }) => {
      if (!Array.isArray(values)) throw new Error('Must provide an Array of values');
      const rows = state.sqlite!.prepare(statement).all(...values);
      return { values: rows.length ? [{ ios_columns: Object.keys(rows[0]!) }, ...rows] : [] };
    },
  }, { get: (target, property) => property in target ? Reflect.get(target, property) : () => new Promise(() => {}) }),
}));

describe('iOS database bridge', () => {
  let db: CapacitorSqliteDatabase;
  beforeEach(() => {
    db = new CapacitorSqliteDatabase();
    state.creates = 0;
    state.releases = 0;
    state.failOpen = false;
  });
  afterEach(async () => {
    await db.close();
  });

  it('creates the full application schema and reads settings without phantom metadata rows', async () => {
    await openAppDatabase({ db });
    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    expect(tables.map((row) => row.name)).toContain('books');
    expect(tables.map((row) => row.name)).toContain('comic_progress');
    expect(tables.every((row) => typeof row.name === 'string')).toBe(true);
    const settings = new SettingsRepository(db);
    await settings.setBoolean('has_seen_onboarding', true);
    expect(await settings.getBoolean('has_seen_onboarding', false)).toBe(true);
  });

  it('commits and rolls back chapter writes using the core transaction contract', async () => {
    await openAppDatabase({ db });
    await db.execute('BEGIN');
    await db.execute('INSERT INTO categories (name, isProtected) VALUES (?, ?)', ['小说', 0]);
    await db.execute('COMMIT');
    await db.execute('BEGIN');
    await db.execute('INSERT INTO categories (name, isProtected) VALUES (?, ?)', ['取消导入', 0]);
    await db.execute('ROLLBACK');
    expect(await db.query('SELECT name FROM categories ORDER BY id')).toEqual([{ name: '小说' }]);
  });

  it('coalesces concurrent opens and keeps the existing schema and rows', async () => {
    await Promise.all([db.open({ name: 'reader' }), db.open({ name: 'reader' })]);
    await db.execute('CREATE TABLE probe (name TEXT)');
    await db.execute('INSERT INTO probe VALUES (?)', ['保留']);
    await db.open({ name: 'reader' });
    expect(state.creates).toBe(1);
    expect(await db.query('SELECT * FROM probe')).toEqual([{ name: '保留' }]);
  });

  it('releases the registry connection on close so it can be opened again', async () => {
    await db.open({ name: 'reader' });
    await db.close();
    await db.open({ name: 'reader' });
    expect(state.releases).toBe(1);
    expect(state.creates).toBe(2);
  });

  it('cleans up a failed open and permits a retry', async () => {
    state.failOpen = true;
    await expect(db.open({ name: 'reader' })).rejects.toThrow('device database unavailable');
    expect(state.releases).toBe(1);
    state.failOpen = false;
    await db.open({ name: 'reader' });
    await expect(db.query('SELECT 1 AS ready')).resolves.toEqual([{ ready: 1 }]);
  });
});
