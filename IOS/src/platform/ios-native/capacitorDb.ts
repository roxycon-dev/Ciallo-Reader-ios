import type { SQLiteDatabase, SqlValue } from '@platform/interfaces';
import { reportStartup } from './startupDiagnostics';

interface SqlitePluginLike {
  createConnection(options: { database: string; version?: number; readonly?: boolean }): Promise<void>;
  open(options: { database: string }): Promise<void>;
  run(options: {
    database: string;
    statement: string;
    values?: SqlValue[];
    transaction?: boolean;
  }): Promise<{ changes?: { changes?: number; lastId?: number } }>;
  query(options: { database: string; statement: string; values?: SqlValue[] }): Promise<{ values?: unknown[] }>;
  close(options: { database: string }): Promise<void>;
  closeConnection(options: { database: string; readonly: boolean }): Promise<void>;
}

const SQLITE_PLUGIN_ERROR = 'sqlite plugin not bound';

async function loadSqlitePlugin(): Promise<SqlitePluginLike> {
  try {
    const mod = (await import('@capacitor-community/sqlite')) as unknown as {
      CapacitorSQLite?: SqlitePluginLike;
    };
    const plugin = mod?.CapacitorSQLite;
    if (!plugin) {
      throw new Error('missing CapacitorSQLite export');
    }
    return plugin;
  } catch {
    throw new Error(SQLITE_PLUGIN_ERROR);
  }
}

function normalizeQueryValues<T>(values: unknown[] | undefined): T[] {
  if (!values || values.length === 0) {
    return [];
  }
  const first = values[0];
  // The iOS plugin prepends column metadata. It is not a database row.
  if (first !== null && typeof first === 'object' && 'ios_columns' in first) {
    return values.slice(1) as T[];
  }
  if (Array.isArray(first)) {
    const cols = first.map((c) => String(c));
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 1; i < values.length; i += 1) {
      const row = values[i];
      if (!Array.isArray(row)) {
        continue;
      }
      const obj: Record<string, unknown> = {};
      cols.forEach((c, idx) => {
        obj[c] = row[idx];
      });
      rows.push(obj);
    }
    return rows as T[];
  }
  return values as T[];
}

export class CapacitorSqliteDatabase implements SQLiteDatabase {
  private plugin: SqlitePluginLike | null = null;
  private databaseName = '';
  private opening: Promise<void> | null = null;

  async open(options: { name: string }): Promise<void> {
    if (this.opening) await this.opening;
    if (this.plugin !== null) {
      if (this.databaseName === options.name) return;
      throw new Error('Close the current database before opening another database');
    }
    const opening = (async () => {
      await reportStartup('starting', new Error('database: loading plugin'));
      const plugin = await loadSqlitePlugin();
      await reportStartup('starting', new Error('database: creating connection'));
      await plugin.createConnection({ database: options.name, version: 1, readonly: false });
      await reportStartup('starting', new Error('database: opening connection'));
      try {
        await plugin.open({ database: options.name });
      } catch (error) {
        await plugin.closeConnection({ database: options.name, readonly: false }).catch(() => {});
        throw error;
      }
      this.databaseName = options.name;
      this.plugin = plugin;
      await reportStartup('starting', new Error('database: connection ready'));
    })();
    this.opening = opening;
    try { await opening; }
    finally { if (this.opening === opening) this.opening = null; }
  }

  async execute(sql: string, params?: SqlValue[]): Promise<{ rowsAffected: number; lastInsertRowId?: number }> {
    const plugin = this.requirePlugin();
    const base = { database: this.databaseName, statement: sql };
    // The native bridge requires values even for DDL. Core owns BEGIN/COMMIT/
    // ROLLBACK, so the plugin must not wrap each statement in another transaction.
    const res = await plugin.run({ ...base, values: params ?? [], transaction: false });
    const changes = res.changes;
    const rowsAffected = changes?.changes ?? 0;
    if (changes?.lastId !== undefined) {
      return { rowsAffected, lastInsertRowId: changes.lastId };
    }
    return { rowsAffected };
  }

  async query<T>(sql: string, params?: SqlValue[]): Promise<T[]> {
    const plugin = this.requirePlugin();
    const base = { database: this.databaseName, statement: sql };
    const res = await plugin.query({ ...base, values: params ?? [] });
    return normalizeQueryValues<T>(res.values);
  }

  async close(): Promise<void> {
    if (this.opening) await this.opening;
    if (!this.plugin) {
      return;
    }
    // closeConnection also releases the plugin's connection registry entry.
    await this.plugin.closeConnection({ database: this.databaseName, readonly: false });
    this.plugin = null;
    this.databaseName = '';
  }

  private requirePlugin(): SqlitePluginLike {
    if (!this.plugin) {
      throw new Error(SQLITE_PLUGIN_ERROR);
    }
    return this.plugin;
  }
}

export function createCapacitorSqliteDatabase(): CapacitorSqliteDatabase {
  return new CapacitorSqliteDatabase();
}
