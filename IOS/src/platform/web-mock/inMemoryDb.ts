import { createIndexSql, createTableSql, TABLES } from '@core/db/schemaV13';
import type { SQLiteDatabase, SqlValue } from '@platform/interfaces';

export interface ColumnMeta {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  autoGenerate: boolean;
}

export interface TableMeta {
  name: string;
  columns: ColumnMeta[];
  primaryKey: string[];
  autoGeneratePk: boolean;
}

export interface IndexMeta {
  name: string;
  table: string;
  unique: boolean;
  columns: string[];
}

type Row = Record<string, SqlValue>;

/** SQLite conflict resolution algorithms, as spelled by `INSERT OR <x> INTO`. */
type InsertStrategy = 'ABORT' | 'FAIL' | 'IGNORE' | 'REPLACE' | 'ROLLBACK';

export interface ExecuteResult {
  rowsAffected: number;
  lastInsertRowId?: number;
}

interface StateSnapshot {
  tables: Map<string, Row[]>;
  meta: Map<string, TableMeta>;
  indices: Map<string, IndexMeta>;
}

interface WhereCond {
  column: string;
  op: string;
  value: SqlValue | { param: true };
}

interface Cursor {
  i: number;
}

export class InMemorySqliteDatabase implements SQLiteDatabase {
  private dbName = '';
  private tables = new Map<string, Row[]>();
  private meta = new Map<string, TableMeta>();
  private indices = new Map<string, IndexMeta>();
  private txnSnapshot: StateSnapshot | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private ignoreCache = new Map<string, {
    rows: Row[]; length: number; nextId: number;
    unique: Array<{ columns: string[]; keys: Set<string> }>;
  }>();

  async open(options: { name: string }): Promise<void> {
    if (this.dbName === options.name) return;
    if (this.dbName) throw new Error('Close the current database before opening another database');
    this.dbName = options.name;
    this.tables = new Map();
    this.meta = new Map();
    this.indices = new Map();
    this.txnSnapshot = null;
  }

  async close(): Promise<void> {
    this.tables = new Map();
    this.meta = new Map();
    this.indices = new Map();
    this.txnSnapshot = null;
    this.dbName = '';
  }

  execute(sql: string, params?: SqlValue[]): Promise<{ rowsAffected: number; lastInsertRowId?: number }> {
    return this.enqueue(async () => {
      const result = await this.dispatch(sql, params, 'execute');
      if (Array.isArray(result)) {
        return { rowsAffected: 0 };
      }
      return result;
    });
  }

  query<T>(sql: string, params?: SqlValue[]): Promise<T[]> {
    return this.enqueue(() => this.dispatch(sql, params, 'query') as Promise<T[]>);
  }

  getDatabaseName(): string {
    return this.dbName;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async dispatch(
    sql: string,
    params: SqlValue[] | undefined,
    mode: 'execute' | 'query',
  ): Promise<{ rowsAffected: number; lastInsertRowId?: number } | unknown[]> {
    const statement = normalizeSql(sql);
    const upper = statement.toUpperCase();
    if (!/^INSERT\s+OR\s+IGNORE\s/i.test(statement) && !upper.startsWith('SELECT') && !upper.startsWith('PRAGMA')) {
      this.ignoreCache.clear();
    }

    if (upper.startsWith('BEGIN')) {
      if (this.txnSnapshot !== null) {
        throw new Error('cannot start a transaction within a transaction');
      }
      this.txnSnapshot = this.captureSnapshot();
      return { rowsAffected: 0 };
    }
    if (upper.startsWith('COMMIT')) {
      if (this.txnSnapshot === null) {
        throw new Error('cannot commit without a transaction');
      }
      this.txnSnapshot = null;
      return { rowsAffected: 0 };
    }
    if (upper.startsWith('ROLLBACK')) {
      if (this.txnSnapshot === null) {
        throw new Error('cannot rollback without a transaction');
      }
      const snap = this.txnSnapshot;
      this.tables = snap.tables;
      this.meta = snap.meta;
      this.indices = snap.indices;
      this.txnSnapshot = null;
      return { rowsAffected: 0 };
    }

    const createTable = /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([\s\S]+)$/i.exec(statement);
    if (createTable) {
      this.applyCreateTable(createTable[1] ?? '');
      return { rowsAffected: 0 };
    }

    const createIndex = /^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([\s\S]+)$/i.exec(statement);
    if (createIndex) {
      this.applyCreateIndex((createIndex[1] ?? '').toUpperCase().includes('UNIQUE'), createIndex[2] ?? '');
      return { rowsAffected: 0 };
    }

    // Room's conflict strategies are spelled `INSERT OR <strategy> INTO …`.
    // Capture the strategy here so `applyInsert` can honour it: a bare
    // `INSERT INTO` in SQLite is `OR ABORT`, which is why an unhandled strategy
    // used to surface as "unsupported SQL in memory db".
    const insert = /^INSERT\s+(?:OR\s+(ABORT|FAIL|IGNORE|REPLACE|ROLLBACK)\s+)?INTO\s+([\s\S]+)$/i.exec(
      statement,
    );
    if (insert) {
      const strategy = (insert[1] ?? 'ABORT').toUpperCase() as InsertStrategy;
      const lastInsertRowId = this.applyInsert(insert[2] ?? '', params, strategy);
      const result: { rowsAffected: number; lastInsertRowId?: number } = { rowsAffected: 1 };
      if (lastInsertRowId !== undefined) {
        result.lastInsertRowId = lastInsertRowId;
      }
      return result;
    }

    const selectCount = /^SELECT\s+COUNT\s*\(\s*\*\s*\)(?:\s+AS\s+(\w+))?\s+FROM\s+([\s\S]+)$/i.exec(statement);
    if (selectCount) {
      const n = this.countRows((selectCount[2] ?? '').trim(), params);
      return [{ [selectCount[1] ?? 'count']: n }];
    }

    const selectSum = /^SELECT\s+COALESCE\s*\(\s*SUM\s*\(\s*("[^"]+"|\w+)\s*\)\s*,\s*0\s*\)\s+AS\s+(\w+)\s+FROM\s+([\s\S]+)$/i.exec(statement);
    if (selectSum) {
      const column = unquoteIdent(selectSum[1]!);
      const total = this.applySelect(selectSum[3]!, params).reduce((sum, row) => sum + Number(row[column] ?? 0), 0);
      return [{ [selectSum[2]!]: total }];
    }

    const selectStar = /^SELECT\s+\*\s+FROM\s+([\s\S]+)$/i.exec(statement);
    if (selectStar) {
      const rows = this.applySelect((selectStar[1] ?? '').trim(), params);
      if (mode === 'execute') {
        return { rowsAffected: 0 };
      }
      return rows;
    }

    const selectColumns = /^SELECT\s+([\s\S]+?)\s+FROM\s+([\s\S]+)$/i.exec(statement);
    if (selectColumns) {
      const colsRaw = (selectColumns[1] ?? '').trim();
      if (colsRaw !== '*' && !/^COUNT\s*\(\s*\*\s*\)$/i.test(colsRaw)) {
        const rows = projectColumns(this.applySelect((selectColumns[2] ?? '').trim(), params), colsRaw);
        if (mode === 'execute') {
          return { rowsAffected: 0 };
        }
        return rows;
      }
    }

    const pragma = /^PRAGMA\s+table_info\s*\(\s*([\s\S]+?)\s*\)\s*$/i.exec(statement);
    if (pragma) {
      const rows = this.applyPragmaTableInfo(unquoteIdent((pragma[1] ?? '').trim()));
      if (mode === 'execute') {
        return { rowsAffected: 0 };
      }
      return rows;
    }

    const remove = /^DELETE\s+FROM\s+([\s\S]+)$/i.exec(statement);
    if (remove) {
      const affected = this.applyDelete((remove[1] ?? '').trim(), params);
      return { rowsAffected: affected };
    }

    const update = /^UPDATE\s+([\s\S]+)$/i.exec(statement);
    if (update) {
      const affected = this.applyUpdate(update[1] ?? '', params);
      return { rowsAffected: affected };
    }

    throw new Error(`unsupported SQL in memory db: ${statement}`);
  }

  private applyCreateTable(rest: string): void {
    const m = /^(.+?)\s*\(([\s\S]*)\)\s*$/.exec(rest.trim());
    if (!m) {
      throw new Error(`cannot parse CREATE TABLE: ${rest}`);
    }
    const name = unquoteIdent((m[1] ?? '').trim());
    if (this.meta.has(name)) {
      return;
    }
    const parts = splitTopLevel(m[2] ?? '', ',');
    // Room emits composite keys as a table-level `PRIMARY KEY ("a", "b")` constraint,
    // which is the only form real SQLite accepts (`createTableSql` in schemaV12).
    const tablePk = new Set<string>();
    const columnParts: string[] = [];
    for (const part of parts) {
      const pk = /^PRIMARY\s+KEY\s*\(([\s\S]*)\)$/i.exec(part.trim());
      if (pk) {
        for (const col of splitTopLevel(pk[1] ?? '', ',')) tablePk.add(unquoteIdent(col));
        continue;
      }
      columnParts.push(part);
    }
    const columns: ColumnMeta[] = columnParts.map(parseColumnDef);
    for (const c of columns) {
      if (tablePk.has(c.name)) c.primaryKey = true;
    }
    const primaryKey = columns.filter((c) => c.primaryKey).map((c) => c.name);
    const autoGeneratePk = columns.some((c) => c.autoGenerate);
    this.meta.set(name, { name, columns, primaryKey, autoGeneratePk });
    this.tables.set(name, []);
  }

  private applyCreateIndex(unique: boolean, rest: string): void {
    const m = /^(.+?)\s+ON\s+(.+?)\s*\(([\s\S]*)\)\s*$/.exec(rest.trim());
    if (!m) {
      throw new Error(`cannot parse CREATE INDEX: ${rest}`);
    }
    const name = unquoteIdent((m[1] ?? '').trim());
    const table = unquoteIdent((m[2] ?? '').trim());
    const columns = splitTopLevel(m[3] ?? '', ',').map((c) => unquoteIdent(c));
    if (this.indices.has(name)) {
      return;
    }
    if (!this.meta.has(table)) {
      throw new Error(`no such table: ${table}`);
    }
    this.indices.set(name, { name, table, unique, columns });
  }

  private applyInsert(
    rest: string,
    params: SqlValue[] | undefined,
    strategy: InsertStrategy = 'ABORT',
  ): number | undefined {
    const m = /^(.+?)\s*\(([\s\S]+?)\)\s*VALUES\s*\(([^)]*)\)([\s\S]*)$/i.exec(rest.trim());
    if (!m) {
      throw new Error(`cannot parse INSERT: ${rest}`);
    }
    const tableName = unquoteIdent((m[1] ?? '').trim());
    const meta = this.meta.get(tableName);
    const rows = this.tables.get(tableName);
    if (!meta || !rows) {
      throw new Error(`no such table: ${tableName}`);
    }
    const upsert = parseUpsertSuffix(m[4] ?? '');
    const colNames = splitTopLevel(m[2] ?? '', ',').map((c) => unquoteIdent(c));
    const valueTokens = splitTopLevel(m[3] ?? '', ',');
    if (colNames.length !== valueTokens.length) {
      throw new Error(`column/value count mismatch in INSERT into ${tableName}`);
    }
    const cursor: Cursor = { i: 0 };
    const row: Row = {};
    for (const col of meta.columns) {
      row[col.name] = null;
    }
    colNames.forEach((col, idx) => {
      row[col] = parseValueToken(valueTokens[idx] ?? '', params, cursor);
    });

    // Bundled title imports contain ~94k rows. Scanning every existing ID and
    // unique index on every INSERT made startup quadratic and froze WebKit.
    const autoPk = meta.autoGeneratePk && meta.primaryKey.length === 1 ? meta.primaryKey[0] : undefined;
    if (strategy === 'IGNORE' && upsert === null && autoPk !== undefined && row[autoPk] == null) {
      let cache = this.ignoreCache.get(tableName);
      if (cache === undefined || cache.rows !== rows || cache.length !== rows.length) {
        const unique = [...this.indices.values()].filter((index) => index.table === tableName && index.unique)
          .map((index) => ({ columns: index.columns, keys: new Set(rows.map((item) => JSON.stringify(index.columns.map((column) => item[column] ?? null)))) }));
        cache = { rows, length: rows.length, nextId: rows.reduce((max, item) => Math.max(max, Number(item[autoPk] ?? 0)), 0) + 1, unique };
        this.ignoreCache.set(tableName, cache);
      }
      const keys = cache.unique.map((index) => JSON.stringify(index.columns.map((column) => row[column] ?? null)));
      if (cache.unique.some((index, i) => index.keys.has(keys[i]!))) return undefined;
      const id = cache.nextId++;
      row[autoPk] = id;
      cache.unique.forEach((index, i) => index.keys.add(keys[i]!));
      rows.push(row);
      cache.length = rows.length;
      return id;
    }

    if (upsert !== null) {
      const conflictIdx = rows.findIndex((r) =>
        upsert.columns.every((c) => valueEquals(r[c] ?? null, row[c] ?? null)),
      );
      if (conflictIdx >= 0) {
        const existing = rows[conflictIdx];
        if (!existing) {
          throw new Error(`upsert conflict target missing in ${tableName}`);
        }
        for (const col of upsert.updates) {
          existing[col] = row[col] ?? null;
        }
        const pk = meta.primaryKey[0];
        if (pk !== undefined && typeof existing[pk] === 'number') {
          return existing[pk] as number;
        }
        return undefined;
      }
    }

    let lastInsertRowId: number | undefined;
    if (meta.autoGeneratePk && meta.primaryKey.length === 1) {
      const pk = meta.primaryKey[0] as string;
      const current = row[pk];
      if (current === null || current === undefined) {
        let max = 0;
        for (const existing of rows) {
          const v = existing[pk];
          if (typeof v === 'number' && v > max) {
            max = v;
          }
        }
        lastInsertRowId = max + 1;
        row[pk] = lastInsertRowId;
      } else if (typeof current === 'number') {
        lastInsertRowId = current;
      }
    }

    if (upsert === null && meta.primaryKey.length > 0) {
      const conflictIdx = rows.findIndex((r) =>
        meta.primaryKey.every((k) => valueEquals(r[k] ?? null, row[k] ?? null)),
      );
      if (conflictIdx >= 0) {
        if (strategy === 'IGNORE') return undefined;
        if (strategy === 'REPLACE') {
          rows.splice(conflictIdx, 1);
        } else {
          throw new Error(`UNIQUE constraint failed: ${meta.name}(${meta.primaryKey.join(',')})`);
        }
      }
    }
    for (const idx of this.indices.values()) {
      if (idx.table !== tableName || !idx.unique) {
        continue;
      }
      const conflictIdx = rows.findIndex((r) =>
        idx.columns.every((c) => valueEquals(r[c] ?? null, row[c] ?? null)),
      );
      if (conflictIdx < 0) {
        continue;
      }
      if (strategy === 'IGNORE') return undefined;
      if (strategy === 'REPLACE') {
        rows.splice(conflictIdx, 1);
        if (meta.autoGeneratePk && meta.primaryKey.length === 1) {
          const pk = meta.primaryKey[0] as string;
          row[pk] = lastInsertRowId ?? row[pk] ?? null;
        }
        break;
      }
      throw new Error(`UNIQUE constraint failed: ${idx.name}`);
    }

    rows.push(row);
    return lastInsertRowId;
  }

  private applySelect(fromSql: string, params: SqlValue[] | undefined): Row[] {
    const { table, whereSql, orderBySql, limit, offset } = parseFromClause(fromSql);
    const rows = this.tables.get(table);
    const meta = this.meta.get(table);
    if (!rows || !meta) {
      throw new Error(`no such table: ${table}`);
    }
    let out: Row[];
    if (!whereSql) {
      out = rows.map((r) => ({ ...r }));
    } else {
      const conds = parseWhere(whereSql);
      out = [];
      for (const row of rows) {
        if (matchesWhere(row, conds, params, { i: 0 })) {
          out.push({ ...row });
        }
      }
    }
    if (orderBySql) {
      out = orderByRows(out, orderBySql);
    }
    return limit === null ? out : out.slice(offset, offset + limit);
  }

  private countRows(fromSql: string, params: SqlValue[] | undefined): number {
    const { table, whereSql } = parseFromClause(fromSql);
    const rows = this.tables.get(table);
    const meta = this.meta.get(table);
    if (!rows || !meta) {
      throw new Error(`no such table: ${table}`);
    }
    if (!whereSql) {
      return rows.length;
    }
    const conds = parseWhere(whereSql);
    let n = 0;
    for (const row of rows) {
      if (matchesWhere(row, conds, params, { i: 0 })) {
        n += 1;
      }
    }
    return n;
  }

  private applyPragmaTableInfo(tableName: string): Row[] {
    const meta = this.meta.get(tableName);
    if (!meta) {
      return [];
    }
    return meta.columns.map((c, i) => ({
      cid: i,
      name: c.name,
      type: c.type,
      notnull: c.notNull ? 1 : 0,
      dflt_value: null,
      pk: c.primaryKey ? 1 : 0,
    }));
  }

  private applyDelete(fromSql: string, params: SqlValue[] | undefined): number {
    const { table, whereSql } = parseFromClause(fromSql);
    const rows = this.tables.get(table);
    if (!rows) {
      throw new Error(`no such table: ${table}`);
    }
    if (!whereSql) {
      const n = rows.length;
      rows.length = 0;
      return n;
    }
    const conds = parseWhere(whereSql);
    const kept: Row[] = [];
    let removed = 0;
    for (const row of rows) {
      if (matchesWhere(row, conds, params, { i: 0 })) {
        removed += 1;
      } else {
        kept.push(row);
      }
    }
    this.tables.set(table, kept);
    return removed;
  }

  private applyUpdate(rest: string, params: SqlValue[] | undefined): number {
    const m = /^([\s\S]+?)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i.exec(rest.trim());
    if (!m) {
      throw new Error(`cannot parse UPDATE: ${rest}`);
    }
    const table = unquoteIdent((m[1] ?? '').trim());
    const rows = this.tables.get(table);
    if (!rows) {
      throw new Error(`no such table: ${table}`);
    }
    const setTokens = splitTopLevel(m[2] ?? '', ',');
    const cursor: Cursor = { i: 0 };
    const assignments: Array<{ column: string; value: SqlValue }> = setTokens.map((token) => {
      const sm = /^("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(token.trim());
      if (!sm) {
        throw new Error(`cannot parse SET clause: ${token}`);
      }
      return {
        column: unquoteIdent((sm[1] ?? '').trim()),
        value: parseValueToken(sm[2] ?? '', params, cursor),
      };
    });
    const whereSql = m[3];
    const conds = whereSql ? parseWhere(whereSql) : null;
    const whereParameterStart = cursor.i;
    let affected = 0;
    for (const row of rows) {
      if (conds && !matchesWhere(row, conds, params, { i: whereParameterStart })) {
        continue;
      }
      for (const a of assignments) {
        row[a.column] = a.value;
      }
      affected += 1;
    }
    return affected;
  }

  private captureSnapshot(): StateSnapshot {
    const tables = new Map<string, Row[]>();
    for (const [name, rows] of this.tables) {
      tables.set(name, rows.map((r) => ({ ...r })));
    }
    return { tables, meta: new Map(this.meta), indices: new Map(this.indices) };
  }
}

export async function openSchemaV12(db: SQLiteDatabase): Promise<void> {
  for (const table of TABLES) {
    await db.execute(createTableSql(table));
    for (const index of table.indices) {
      await db.execute(createIndexSql(table, index));
    }
  }
}

function normalizeSql(sql: string): string {
  return sql.trim().replace(/;\s*$/, '').trim();
}

function unquoteIdent(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/""/g, '"');
  }
  if (t.length >= 2 && t.startsWith('`') && t.endsWith('`')) {
    return t.slice(1, -1);
  }
  if (t.length >= 2 && t.startsWith('[') && t.endsWith(']')) {
    return t.slice(1, -1);
  }
  return t;
}

function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (const ch of input) {
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '(') {
        depth += 1;
        current += ch;
        continue;
      }
      if (ch === ')') {
        depth -= 1;
        current += ch;
        continue;
      }
      if (ch === sep && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim() !== '') {
    parts.push(current);
  }
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

function splitOutsideQuotes(input: string, sep: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  const sepLen = sep.length;
  const lowerInput = input.toLowerCase();
  const sepLower = sep.toLowerCase();
  let i = 0;
  while (i < input.length) {
    const ch = input[i] as string;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      i += 1;
      continue;
    }
    if (!inSingle && !inDouble && lowerInput.startsWith(sepLower, i)) {
      parts.push(current);
      current = '';
      i += sepLen;
      continue;
    }
    current += ch;
    i += 1;
  }
  parts.push(current);
  return parts;
}

function parseColumnDef(raw: string): ColumnMeta {
  const m = /^("(?:[^"]|"")+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s+(\w+)([\s\S]*)$/.exec(raw.trim());
  if (!m) {
    throw new Error(`cannot parse column: ${raw}`);
  }
  const rest = (m[3] ?? '').toUpperCase();
  return {
    name: unquoteIdent(m[1] ?? ''),
    type: (m[2] ?? '').toUpperCase(),
    notNull: rest.includes('NOT NULL'),
    primaryKey: rest.includes('PRIMARY KEY'),
    autoGenerate: rest.includes('AUTOINCREMENT'),
  };
}

function parseSqlLiteral(raw: string): SqlValue {
  const t = raw.trim();
  const upper = t.toUpperCase();
  if (upper === 'NULL') {
    return null;
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    return Number(t);
  }
  throw new Error(`unsupported SQL literal: ${t}`);
}

function parseValueToken(raw: string, params: SqlValue[] | undefined, cursor: Cursor): SqlValue {
  const t = raw.trim();
  if (t === '?') {
    if (!params || cursor.i >= params.length) {
      throw new Error('missing bind parameter');
    }
    const v = params[cursor.i];
    cursor.i += 1;
    if (v === undefined) {
      throw new Error('missing bind parameter');
    }
    return v;
  }
  return parseSqlLiteral(t);
}

function parseFromClause(fromSql: string): {
  table: string;
  whereSql: string | null;
  orderBySql: string | null;
  limit: number | null;
  offset: number;
} {
  const limitMatch = /\s+LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?\s*$/i.exec(fromSql);
  const trimmed = (limitMatch ? fromSql.slice(0, limitMatch.index) : fromSql).trim();
  const orderMatch = /\s+ORDER\s+BY\s+([\s\S]+)$/i.exec(trimmed);
  const orderBySql = orderMatch ? (orderMatch[1] ?? '').trim() : null;
  const withoutOrder = orderMatch && orderMatch.index > 0 ? trimmed.slice(0, orderMatch.index) : trimmed;
  const m = /^([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i.exec(withoutOrder.trim());
  if (!m) {
    throw new Error(`cannot parse FROM clause: ${fromSql}`);
  }
  return {
    table: unquoteIdent((m[1] ?? '').trim()),
    whereSql: m[2] ? m[2].trim() : null,
    orderBySql,
    limit: limitMatch ? Number(limitMatch[1]) : null,
    offset: Number(limitMatch?.[2] ?? 0),
  };
}

function parseUpsertSuffix(suffix: string): { columns: string[]; updates: string[] } | null {
  const t = suffix.trim();
  if (t === '') return null;
  const m = /^ON\s+CONFLICT\s*\(([\s\S]+?)\)\s*DO\s+UPDATE\s+SET\s+([\s\S]+)$/i.exec(t);
  if (!m) {
    throw new Error(`unsupported upsert clause: ${t}`);
  }
  const columns = splitTopLevel(m[1] ?? '', ',').map((c) => unquoteIdent(c));
  const updates: string[] = [];
  for (const token of splitTopLevel(m[2] ?? '', ',')) {
    const sm = /^("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(token.trim());
    if (!sm) {
      throw new Error(`cannot parse upsert SET clause: ${token}`);
    }
    updates.push(unquoteIdent(sm[1] ?? ''));
  }
  return { columns, updates };
}

function projectColumns(rows: Row[], colsRaw: string): Row[] {
  const cols = splitTopLevel(colsRaw, ',').map((c) => {
    const parts = c.split(/\s+as\s+/i);
    return unquoteIdent((parts[0] ?? c).trim());
  });
  return rows.map((r) => {
    const o: Row = {};
    for (const col of cols) o[col] = r[col] ?? null;
    return o;
  });
}

function compareSqlValues(a: SqlValue, b: SqlValue): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return -1;
  if (bNull) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}

function orderByRows(rows: Row[], orderBySql: string): Row[] {
  const m = /^("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)(?:\s+(ASC|DESC))?$/i.exec(orderBySql.trim());
  if (!m) return rows;
  const col = unquoteIdent(m[1] ?? '');
  const desc = (m[2] ?? '').toUpperCase() === 'DESC';
  return [...rows].sort(
    (a, b) => compareSqlValues(a[col] ?? null, b[col] ?? null) * (desc ? -1 : 1),
  );
}

function parseWhere(whereSql: string): WhereCond[] {
  const parts = splitOutsideQuotes(whereSql, ' AND ');
  return parts.map((rawPart) => {
    const clause = rawPart.trim();
    if (clause === '') {
      throw new Error('empty WHERE clause');
    }
    const notNull = /^(.+?)\s+IS\s+NOT\s+NULL$/i.exec(clause);
    if (notNull) {
      return { column: unquoteIdent((notNull[1] ?? '').trim()), op: 'IS NOT NULL', value: null };
    }
    const isNull = /^(.+?)\s+IS\s+NULL$/i.exec(clause);
    if (isNull) {
      return { column: unquoteIdent((isNull[1] ?? '').trim()), op: 'IS NULL', value: null };
    }
    const cmp = /^(.+?)\s*(=|!=|<>|<=|>=|<|>)\s*([\s\S]+)$/s.exec(clause);
    if (!cmp) {
      throw new Error(`cannot parse WHERE clause: ${clause}`);
    }
    const column = unquoteIdent((cmp[1] ?? '').trim());
    const op = cmp[2] ?? '';
    const rhs = (cmp[3] ?? '').trim();
    if (rhs === '?') {
      return { column, op, value: { param: true } };
    }
    return { column, op, value: parseSqlLiteral(rhs) };
  });
}

function resolveCondValue(cond: WhereCond, params: SqlValue[] | undefined, cursor: Cursor): SqlValue {
  if (typeof cond.value === 'object' && cond.value !== null && 'param' in cond.value) {
    if (!params || cursor.i >= params.length) {
      throw new Error('missing bind parameter');
    }
    const v = params[cursor.i];
    cursor.i += 1;
    if (v === undefined) {
      throw new Error('missing bind parameter');
    }
    return v;
  }
  return cond.value as SqlValue;
}

function matchesWhere(row: Row, conds: WhereCond[], params: SqlValue[] | undefined, cursor: Cursor): boolean {
  for (const cond of conds) {
    const rowVal = row[cond.column];
    if (cond.op === 'IS NULL') {
      if (rowVal !== null && rowVal !== undefined) {
        return false;
      }
      continue;
    }
    if (cond.op === 'IS NOT NULL') {
      if (rowVal === null || rowVal === undefined) {
        return false;
      }
      continue;
    }
    const cmpVal = resolveCondValue(cond, params, cursor);
    if (rowVal === null || rowVal === undefined || cmpVal === null) {
      return false;
    }
    if (cond.op === '=') {
      if (!valueEquals(rowVal, cmpVal)) {
        return false;
      }
      continue;
    }
    if (cond.op === '!=' || cond.op === '<>') {
      if (valueEquals(rowVal, cmpVal)) {
        return false;
      }
      continue;
    }
    if (!compareOrdered(rowVal, cmpVal, cond.op)) {
      return false;
    }
  }
  return true;
}

function compareOrdered(a: SqlValue, b: SqlValue, op: string): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (op === '<') return a < b;
    if (op === '<=') return a <= b;
    if (op === '>') return a > b;
    return a >= b;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (op === '<') return a < b;
    if (op === '<=') return a <= b;
    if (op === '>') return a > b;
    return a >= b;
  }
  return false;
}

function valueEquals(a: SqlValue, b: SqlValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a === b;
  }
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((byte, i) => byte === b[i]);
  }
  return false;
}
