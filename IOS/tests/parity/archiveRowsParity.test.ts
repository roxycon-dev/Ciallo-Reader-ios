/**
 * archiveRowsParity.test.ts —— `transfer/ArchiveRows.kt`（73 行）+ `transfer/BookBodyFingerprint.kt`（72 行）。
 *
 * `ArchiveRows.kt` 此前**没有对应物**：端口里的 `archiveDatabaseRows.ts` 是 portable 归档的行合并
 * （`ArchiveDatabaseRows` / `RelatedArchiveRows`），而 Kotlin 这个是**设备互传日志**的快照格式
 * —— `boundedLine` 的 512 KiB 上限、header `version in 1..2 && schema in 12..13`、100 万行上限、
 * `journalTables = tables + ["transfer_identities","transfer_receipts"]`、`forEach`/`snapshot`/
 * `restoreSnapshot`。本轮补齐（E186）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  ARCHIVE_COLUMN_PATTERN,
  ArchiveRows,
  BACKUP_ARCHIVE_TABLES,
  JOURNAL_MAX_LINE_CHARS,
  JOURNAL_MAX_ROWS,
  JOURNAL_SCHEMA_MAX,
  JOURNAL_SCHEMA_MIN,
  JOURNAL_TABLES,
  JOURNAL_VERSION_MAX,
  JOURNAL_VERSION_MIN,
  allRows,
  archiveRow,
  boundedLineAt,
  boundedLinesOf,
  forEachRow,
  insertRow,
  parseJournalHeader,
  requireJournalTable,
  restoreSnapshotRows,
  snapshotRows,
} from '@core/transfer/archiveJournalRows';
import { BookContentAccumulator, BookContentFingerprint } from '@core/transfer/bookFingerprint';
import type { SqlValue, SqliteExecutor } from '@platform/interfaces';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① transfer/ArchiveRows.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ArchiveRows.kt：日志快照格式（E186）', () => {
  const KT = kt('transfer/ArchiveRows.kt');

  function fakeDb(seed: Record<string, Record<string, SqlValue>[]> = {}): SqliteExecutor & {
    executed: string[];
    tables: Map<string, Record<string, SqlValue>[]>;
  } {
    const tables = new Map<string, Record<string, SqlValue>[]>();
    for (const [name, rows] of Object.entries(seed)) tables.set(name, [...rows]);
    const executed: string[] = [];
    return {
      executed,
      tables,
      async execute(sql: string): Promise<{ rowsAffected: number; lastInsertRowId?: number }> {
        executed.push(sql);
        const del = /^DELETE FROM `(.+)`$/.exec(sql);
        if (del !== null) {
          const rows = tables.get(del[1] as string) ?? [];
          tables.set(del[1] as string, []);
          return { rowsAffected: rows.length };
        }
        const ins = /^INSERT (?:OR REPLACE )?INTO `(.+?)`/.exec(sql);
        if (ins !== null) {
          const rows = tables.get(ins[1] as string) ?? [];
          tables.set(ins[1] as string, rows);
          return { rowsAffected: 1, lastInsertRowId: rows.length + 1 };
        }
        return { rowsAffected: 0 };
      },
      async query<T>(sql: string): Promise<T[]> {
        const sel = /FROM `(.+?)`/.exec(sql);
        if (sel !== null) return ((tables.get(sel[1] as string) ?? []) as unknown as T[]).slice();
        return [] as T[];
      },
    };
  }

  it('journalTables = 备份表 + transfer_identities + transfer_receipts', () => {
    expect(KT).toContain('val tables = BackupArchive.tables');
    expect(KT).toContain('val journalTables = tables + listOf("transfer_identities", "transfer_receipts")');
    expect(JOURNAL_TABLES.slice(-2)).toEqual(['transfer_identities', 'transfer_receipts']);
    expect(JOURNAL_TABLES.length).toBe(BACKUP_ARCHIVE_TABLES.length + 2);
    expect(ArchiveRows.journalTables).toBe(JOURNAL_TABLES);
  });

  it('row()：NULL / 整数 / 浮点 / 字符串；BLOB 抛「不支持的数据库类型」', () => {
    expect(KT).toContain('Cursor.FIELD_TYPE_NULL -> JSONObject.NULL');
    expect(KT).toContain('else -> error(com.example.i18n.tr("不支持的数据库类型"))');
    expect(archiveRow({ a: null, b: 3, c: 1.5, d: 'x' })).toEqual({ a: null, b: 3, c: 1.5, d: 'x' });
    expect(() => archiveRow({ blob: new Uint8Array([1, 2]) })).toThrow('不支持的数据库类型');
  });

  it('all()：白名单外的表直接抛；带 WHERE 与参数透传', async () => {
    expect(KT).toContain('require(table in journalTables)');
    expect(() => requireJournalTable('not_a_table')).toThrow();
    const db = fakeDb({ books: [{ id: 1, title: 'a' }] });
    const rows = await allRows(db, 'books', 'id = ?', [1]);
    expect(rows).toEqual([{ id: 1, title: 'a' }]);
    await expect(allRows(db, 'nope')).rejects.toThrow();
  });

  it('insert()：列名校验 + 参数绑定；`lastInsertRowId` 缺失时回落 `last_insert_rowid()`', async () => {
    expect(KT).toContain('require(keys.all { it.matches(Regex("[a-zA-Z][a-zA-Z0-9_]*")) })');
    expect(ARCHIVE_COLUMN_PATTERN.test('userId')).toBe(true);
    expect(ARCHIVE_COLUMN_PATTERN.test('1bad')).toBe(false);
    expect(ARCHIVE_COLUMN_PATTERN.test('a-b')).toBe(false);

    const db = fakeDb();
    await expect(
      insertRow(db, 'books', { '1bad': 1 }),
    ).rejects.toThrow('无效数据库字段');
    await expect(
      insertRow(db, 'books', { ok: { nested: true } as unknown }),
    ).rejects.toThrow('无效数据库字段');

    const id = await insertRow(db, 'books', { id: 7, title: 'x', size: null });
    expect(id).toBe(1);
    expect(db.executed.at(-1)).toBe('INSERT INTO `books` (`id`, `title`, `size`) VALUES (?, ?, ?)');
    // replace 只在需要时加 OR REPLACE
    await insertRow(db, 'books', { id: 8 }, true);
    expect(db.executed.at(-1)).toBe('INSERT OR REPLACE INTO `books` (`id`) VALUES (?)');
  });

  it('boundedLine：LF 终止、EOF 空串 → null、512 KiB 上限', () => {
    expect(KT).toContain('if(ch == 10) return text.toString()');
    expect(KT).toContain('require(text.length < 512 * 1024) { tr("数据行过大") }');
    expect(JOURNAL_MAX_LINE_CHARS).toBe(512 * 1024);
    expect(boundedLineAt('ab\ncd', 0)).toEqual({ line: 'ab', next: 3 });
    expect(boundedLineAt('ab\ncd', 3)).toEqual({ line: 'cd', next: 5 });
    expect(boundedLineAt('ab\ncd', 5)).toBeNull();
    // 空行是合法的「空串行」，不是 EOF
    expect(boundedLineAt('\n', 0)).toEqual({ line: '', next: 1 });
    // `\r` 属于行内容（Kotlin 只认 ch == 10）
    expect(boundedLinesOf('a\r\nb\r\n')).toEqual(['a\r', 'b\r']);
    expect(() => boundedLinesOf('x'.repeat(JOURNAL_MAX_LINE_CHARS + 1))).toThrow('数据行过大');
  });

  it('forEach：header 版本范围、未知表、100 万行上限、按表过滤', () => {
    expect(KT).toContain('require(header.getInt("version") in 1..2 && header.getInt("schema") in 12..13) { tr("不支持的数据版本，请升级应用") }');
    expect(KT).toContain('require(++count <= 1_000_000) { tr("数据条目过多") }');
    expect(KT).toContain('require(name in tables) { tr("包含未知数据表") }');
    expect([JOURNAL_VERSION_MIN, JOURNAL_VERSION_MAX]).toEqual([1, 2]);
    expect([JOURNAL_SCHEMA_MIN, JOURNAL_SCHEMA_MAX]).toEqual([12, 13]);
    expect(JOURNAL_MAX_ROWS).toBe(1_000_000);

    expect(() => parseJournalHeader('')).toThrow('缺少数据头');
    expect(() => parseJournalHeader('{"version":3,"schema":13}')).toThrow('不支持的数据版本，请升级应用');
    expect(() => parseJournalHeader('{"version":1,"schema":11}')).toThrow('不支持的数据版本，请升级应用');
    expect(parseJournalHeader('{"version":2,"schema":13}')).toEqual({ version: 2, schema: 13 });

    const table = BACKUP_ARCHIVE_TABLES[0] as string;
    const text = [
      '{"version":1,"schema":12}',
      JSON.stringify({ table, row: { a: 1 } }),
      JSON.stringify({ table, row: { a: 2 } }),
    ].join('\n');
    const seen: number[] = [];
    forEachRow(text, null, (name, row) => {
      expect(name).toBe(table);
      seen.push(row['a'] as number);
    });
    expect(seen).toEqual([1, 2]);
    // 按表过滤：不匹配的行被跳过
    expect(() => forEachRow(text, 'not_this_table', () => undefined)).not.toThrow();
    // 未知表（含 transfer_* —— 它们不在 `tables` 里）
    expect(() =>
      forEachRow(`${'{"version":1,"schema":12}'}\n${JSON.stringify({ table: 'transfer_receipts', row: {} })}`, null, () => undefined),
    ).toThrow('包含未知数据表');
  });

  it('snapshot / restoreSnapshot：NDJSON 往返 + 先反序 DELETE', async () => {
    expect(KT).toContain('out.appendLine(JSONObject().put("table", table).put("row", row(c)).toString())');
    expect(KT).toContain('journalTables.asReversed().forEach { db.execSQL("DELETE FROM `$it`") }');
    const table = BACKUP_ARCHIVE_TABLES[0] as string;
    const db = fakeDb({ [table]: [{ id: 1, title: 'a' }, { id: 2, title: null }] });
    const snapshot = await snapshotRows(db);
    expect(snapshot.trim().split('\n')).toEqual([
      JSON.stringify({ table, row: { id: 1, title: 'a' } }),
      JSON.stringify({ table, row: { id: 2, title: null } }),
    ]);

    const target = fakeDb({ [table]: [{ id: 9, title: 'old' }] });
    await restoreSnapshotRows(target, snapshot);
    // 先清空（每张 journal 表一条 DELETE，且顺序是反序）
    const deletes = target.executed.filter((sql) => sql.startsWith('DELETE FROM'));
    expect(deletes).toHaveLength(JOURNAL_TABLES.length);
    expect(deletes[0]).toBe(`DELETE FROM \`${JOURNAL_TABLES[JOURNAL_TABLES.length - 1] as string}\``);
    expect(deletes.at(-1)).toBe(`DELETE FROM \`${JOURNAL_TABLES[0] as string}\``);
    // 再插回去
    expect(target.executed.filter((sql) => sql.startsWith('INSERT'))).toHaveLength(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② transfer/BookBodyFingerprint.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('BookBodyFingerprint.kt：资源感知的书籍指纹', () => {
  const KT = kt('transfer/BookBodyFingerprint.kt');

  it('KDoc：缺少图片时身份「未解析」，不能按路径合并不同版本', () => {
    // Kotlin L9 的类 KDoc 原文
    expect(KT).toContain('A second identity when either device has lost its original file. Paths are never identities.');
    const ts = readFileSync('src/core/transfer/bookFingerprint.ts', 'utf8');
    expect(ts).toContain('makes identity unresolved');
    expect(BACKUP_ARCHIVE_TABLES).toHaveLength(12);
  });

  it('Accumulator：任一章节摘要缺失 → complete=false → finish 返回 null', () => {
    expect(KT).toContain('if (hash == null) complete = false');
    expect(KT).toContain('if (!complete || !readable) return null');
    const missing = new BookContentAccumulator();
    missing.add(0, 'a', 'h', true);
    missing.add(1, 'b', null, true);
    expect(missing.finish('NOVEL')).toBeNull();

    const ok = new BookContentAccumulator();
    ok.add(0, 'a', 'h1', true);
    ok.add(1, 'b', 'h2', true);
    expect(ok.finish('NOVEL')).toMatch(/^body-content:[a-f0-9]{64}$/);
    // 换 contentType 结果不同
    expect(ok.finish('COMIC')).not.toBe(ok.finish('NOVEL'));
  });

  it('Accumulator：全书都没有可读内容 → readable=false → null', () => {
    expect(KT).toContain('readable = readable || hasContent');
    const empty = new BookContentAccumulator();
    empty.add(0, 'a', 'h1', false);
    expect(empty.finish('NOVEL')).toBeNull();
  });

  it('chapter()：漫画章节的 `[IMG:path]` 换成 `[IMG:sha256:…]`；资源缺失 → null', async () => {
    expect(KT).toContain('[IMG:');
    const hashes = new Map([['/files/a.jpg', 'f'.repeat(64)]]);
    const fingerprint = new BookContentFingerprint(async (path) => hashes.get(path) ?? null);
    const comic = await fingerprint.chapter('[IMG:/files/a.jpg]', 'COMIC');
    expect(comic).toMatch(/^[a-f0-9]{64}$/);

    // 资源不存在 → null（身份未解析）
    await expect(fingerprint.chapter('[IMG:/files/missing.jpg]', 'COMIC')).resolves.toBeNull();
    // 纯文本章节（NOVEL）不需要资源
    await expect(fingerprint.chapter('正文', 'NOVEL')).resolves.toMatch(/^[a-f0-9]{64}$/);
  });
});
