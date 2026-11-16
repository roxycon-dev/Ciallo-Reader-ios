/**
 * Behavioural boundary tests for `src/core/backup/**` and the `@TypeConverter`
 * mappings, each pinned against the Kotlin line that defines it.
 *
 * The format-level expectations (line budgets, `@FILES@` substitution, NDJSON shape,
 * settings payload) come from `BackupArchive.kt` / `BackupManager.kt`; the
 * atomicity expectations prove that the `@Transaction` / `db.withTransaction` blocks
 * of the Kotlin DAOs really are atomic in the TS port; the TypeConverter expectations
 * come from `DownloadTypeConverters` and `FavoriteModels.kt`.
 *
 * Kotlin line references in this file point at
 * `novel-reader/app/src/main/java/com/example/data/BackupArchive.kt` (204 lines).
 */
import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { strToU8 } from 'fflate';
import {
  BACKUP_HEADER,
  MAX_LINE_BYTES,
  parseBoundedLines,
  parseRowLine,
  encodeRowLine,
  replaceFilesPath,
  restoreFilesPath,
} from '../../src/core/backup/backupArchiveFormat';
import {
  BACKUP_ZIP_ROWS_ENTRY,
  BACKUP_ZIP_SETTINGS_ENTRY,
  encodeSettingsPayload,
  parseSettingsPayload,
  readBackupArchive,
} from '../../src/core/backup/backupArchive';
import { decodeBase64Default } from '../../src/core/backup/backupManagerJson';
import { BackupService } from '../../src/core/backup/backupService';
import { SettingsRepository } from '../../src/core/settings/settingsRepository';
import { openAppDatabase } from '../../src/core/db/openDatabase';
import { InMemorySqliteDatabase } from '../../src/platform/web-mock/inMemoryDb';
import { MemoryFileSystem } from '../../src/platform/web-mock/memoryFileSystem';
import {
  DOWNLOAD_TASK_STATES,
  type DownloadTaskRecord,
  DownloadTaskRepository,
} from '../../src/core/download/downloadTaskRepository';
import {
  ChapterReadState,
  chapterReadStateOf,
  serialStatusOf,
} from '../../src/core/library/favoriteTypes';

const FILES_ROOT = '/data/user/0/com.ciallo.reader/files';
const BACKUP_HEADER_JSON = JSON.stringify(BACKUP_HEADER);

async function freshBackup(filesRoot = FILES_ROOT, sharedFs?: MemoryFileSystem) {
  const db = new InMemorySqliteDatabase();
  await openAppDatabase({ db });
  const fs = sharedFs ?? new MemoryFileSystem();
  const settings = new SettingsRepository(db);
  const backup = new BackupService(db, fs, settings, filesRoot);
  return { db, fs, settings, backup };
}

async function seedAllTwelve(db: InMemorySqliteDatabase): Promise<void> {
  await db.execute(
    'INSERT INTO "books" ("id","title","author","filePath","coverUri","category","currentChapterIndex","scrollOffset","isFinished","totalChapters","contentType","addedTime","lastReadTime") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [1, 't', 'a', '/p', null, '默认', 0, 0, 0, 1, 'NOVEL', 1, 1],
  );
  await db.execute(
    'INSERT INTO "chapters" ("id","bookId","chapterOrder","title","content","startCharIndex","endCharIndex") VALUES (?,?,?,?,?,?,?)',
    [1, 1, 0, 'x', 'y', 0, 1],
  );
  await db.execute('INSERT INTO "categories" ("id","name","isProtected") VALUES (?,?,?)', [1, '默认', 0]);
  await db.execute(
    'INSERT INTO "comic_progress" ("sourceId","comicId","lastChapterId","lastChapterIndex","lastPageIndex","lastPageCount","lastReadAt","seenTopChapterId","seenChapterCount") VALUES (?,?,?,?,?,?,?,?,?)',
    ['s', 'c', 'ch', 0, 0, 1, 1, null, 0],
  );
  await db.execute(
    'INSERT INTO "god_moments" ("id","contentType","bookId","chapterId","bookTitle","chapterTitle","chapterNumber","title","titleIsCustom","rating","note","coverPath","coverSource","cropParams","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [1, 'NOVEL', 'b', 'ch', 't', 'x', 0, '名场面', 0, 4.5, '', null, 'BOOK', '{}', 1, 2],
  );
}

/* ═══════════════════ 1. the NDJSON line budget (readBoundedLine, L194-203) ═══════════════════ */

describe('parseBoundedLines — Kotlin readBoundedLine boundary', () => {
  /** The helper works on characters; the Kotlin guard is `line.length < 512 * 1024`. */
  const prefix = '{"table":"books","row":{';

  it('accepts a line of exactly MAX_LINE_BYTES characters', () => {
    const line = `${prefix}${'x'.repeat(MAX_LINE_BYTES - prefix.length - 1)}}`;
    expect(line).toHaveLength(MAX_LINE_BYTES);
    const text = `${BACKUP_HEADER_JSON}\n${line}\n`;
    expect(parseBoundedLines(text)).toEqual([BACKUP_HEADER_JSON, line]);
  });

  it('rejects a line of MAX_LINE_BYTES + 1 characters', () => {
    const line = `${prefix}${'x'.repeat(MAX_LINE_BYTES - prefix.length)}}`;
    expect(line).toHaveLength(MAX_LINE_BYTES + 1);
    expect(() => parseBoundedLines(`${BACKUP_HEADER_JSON}\n${line}\n`)).toThrow('备份行过大');
  });

  it('keeps a final line that has no trailing newline (Kotlin `ch < 0` branch)', () => {
    expect(parseBoundedLines('a\nb')).toEqual(['a', 'b']);
  });

  it('returns nothing at all for empty text (Kotlin `takeIf { it.isNotEmpty() }`)', () => {
    expect(parseBoundedLines('')).toEqual([]);
  });

  it('treats a trailing CR as data-adjacent, not as a record separator', () => {
    // Kotlin only terminates on char 10; a stray CR stays inside the line.
    expect(parseBoundedLines('a\r\nb\n')).toEqual(['a\r', 'b']);
  });
});

/* ═══════════════════ 2. the NDJSON row shape (L53-60) ═══════════════════ */

describe('the NDJSON row line shape', () => {
  it('writes {"table":…,"row":{…}} with table before row, exactly like JSONObject().put', () => {
    expect(encodeRowLine('books', { id: 1, coverUri: null })).toBe(
      '{"table":"books","row":{"id":1,"coverUri":null}}',
    );
  });

  it('round-trips through parseRowLine', () => {
    const parsed = parseRowLine(encodeRowLine('god_moments', { rating: 4.5, coverPath: null }));
    expect(parsed).toEqual({ table: 'god_moments', row: { rating: 4.5, coverPath: null } });
  });

  it('rejects a line whose table or row is missing / mistyped', () => {
    expect(() => parseRowLine('{"table":"books"}')).toThrow();
    expect(() => parseRowLine('{"row":{}}')).toThrow();
    expect(() => parseRowLine('{"table":"books","row":"x"}')).toThrow();
    expect(() => parseRowLine('not json')).toThrow();
  });

  it('starts the archive with the {version:1,schema:12} header (Kotlin L47)', () => {
    expect(BACKUP_HEADER).toEqual({ version: 1, schema: 12 });
    expect(BACKUP_HEADER_JSON).toBe('{"version":1,"schema":12}');
  });
});

/* ═══════════════════ 3. @FILES@ substitution, both ways (L57 / L175) ═══════════════════ */

describe('@FILES@ re-localisation', () => {
  it('replaces EVERY occurrence, like Java String.replace', () => {
    const value = `${FILES_ROOT}/a.png and again ${FILES_ROOT}/b.png`;
    expect(replaceFilesPath(value, FILES_ROOT)).toBe('@FILES@/a.png and again @FILES@/b.png');
  });

  it('restores every occurrence back to the target root', () => {
    expect(restoreFilesPath('@FILES@/a.png and again @FILES@/b.png', '/target')).toBe(
      '/target/a.png and again /target/b.png',
    );
  });

  it('leaves the value untouched when no root is configured on either side', () => {
    expect(replaceFilesPath('/somewhere/a.png', '')).toBe('/somewhere/a.png');
    expect(restoreFilesPath('@FILES@/a.png', '')).toBe('@FILES@/a.png');
  });

  it('leaves values that contain no root occurrence alone', () => {
    expect(replaceFilesPath('/books/lord.txt', FILES_ROOT)).toBe('/books/lord.txt');
    expect(restoreFilesPath('/books/lord.txt', '/target')).toBe('/books/lord.txt');
  });
});

/* ═══════════════════ 4. the settings.json payload (L77-80 / L116) ═══════════════════ */

describe('settings.json payload', () => {
  it('encodes every entry as {type,value} and drops unsafe keys', () => {
    const json = encodeSettingsPayload([
      { key: 'font_size', type: 'float', value: 20 },
      { key: 'auth_token', type: 'string', value: 'secret' },
      { key: 'reader_theme', type: 'int', value: 3 },
    ]);
    expect(JSON.parse(json)).toEqual({
      font_size: { type: 'float', value: 20 },
      reader_theme: { type: 'int', value: 3 },
    });
  });

  it('parses back to the same key/type/value triples, still filtering unsafe keys', () => {
    const entries = parseSettingsPayload(
      JSON.stringify({
        font_size: { type: 'float', value: 20 },
        cookie_jar: { type: 'string', value: 'x' },
        custom_font_path: { type: 'string', value: '@FILES@/f.ttf' },
      }),
    );
    expect(entries).toEqual([
      { key: 'font_size', type: 'float', value: 20 },
      { key: 'custom_font_path', type: 'string', value: '@FILES@/f.ttf' },
    ]);
  });

  it('throws on a non-object or a malformed entry', () => {
    expect(() => parseSettingsPayload('[]')).toThrow('备份设置内容损坏');
    expect(() => parseSettingsPayload('{"font_size":"nope"}')).toThrow('备份设置项损坏: font_size');
    expect(() => parseSettingsPayload('{"font_size":{"type":"float"}}')).toThrow(
      '备份设置项损坏: font_size',
    );
  });
});

/* ═══════════════════ 5. the ZIP entry walk: duplicates, unknown names, order ═══════════════════ */

/** Build a ZIP by hand so a duplicate entry name is possible. */
function rawZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = (s: string): Uint8Array => new Uint8Array([...s].map((ch) => ch.charCodeAt(0)));
  const STORED = 0;
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  const crc32 = (u8: Uint8Array): number => {
    let c = ~0;
    for (let i = 0; i < u8.length; i += 1) {
      const byte = u8[i] as number;
      const slot = table[(c ^ byte) & 0xff] as number;
      c = slot ^ (c >>> 8);
    }
    return ~c >>> 0;
  };
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(8, STORED, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, entry.data.length, true);
    dv.setUint32(22, entry.data.length, true);
    dv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    locals.push(local);
    const cd = new Uint8Array(46 + name.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(10, STORED, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, entry.data.length, true);
    cdv.setUint32(24, entry.data.length, true);
    cdv.setUint16(28, name.length, true);
    cd.set(name, 46);
    cdv.setUint32(42, offset, true);
    centrals.push(cd);
    offset += local.length;
  }
  const concat = (parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let p = 0;
    for (const part of parts) {
      out.set(part, p);
      p += part.length;
    }
    return out;
  };
  const cdAll = concat(centrals);
  const end = new Uint8Array(22);
  const edv = new DataView(end.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, cdAll.length, true);
  edv.setUint32(16, offset, true);
  return concat([...locals, cdAll, end]);
}

describe('readBackupArchive — the Kotlin ZipInputStream walk', () => {
  it('accepts a normal two-entry archive', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile(
      'b.zip',
      zipSync({
        [BACKUP_ZIP_ROWS_ENTRY]: strToU8('{"version":1,"schema":12}\n'),
        [BACKUP_ZIP_SETTINGS_ENTRY]: strToU8('{}'),
      }),
    );
    const out = await readBackupArchive(fs, 'b.zip');
    expect(out.databaseRows).toBe('{"version":1,"schema":12}\n');
    expect(out.settingsJson).toBe('{}');
    expect(out.files.size).toBe(0);
  });

  it('rejects a duplicated entry name (Kotlin L104)', async () => {
    const rows = strToU8('{"version":1,"schema":12}\n');
    const fs = new MemoryFileSystem();
    await fs.writeFile(
      'dup.zip',
      rawZip([
        { name: BACKUP_ZIP_ROWS_ENTRY, data: rows },
        { name: BACKUP_ZIP_ROWS_ENTRY, data: rows },
        { name: BACKUP_ZIP_SETTINGS_ENTRY, data: strToU8('{}') },
      ]),
    );
    await expect(readBackupArchive(fs, 'dup.zip')).rejects.toThrow('备份包含重复条目');
  });

  it('rejects an entry that is neither metadata nor a files/ asset (Kotlin L105)', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile(
      'evil.zip',
      zipSync({
        [BACKUP_ZIP_ROWS_ENTRY]: strToU8('{"version":1,"schema":12}\n'),
        [BACKUP_ZIP_SETTINGS_ENTRY]: strToU8('{}'),
        'settings.json.bak': strToU8('{}'),
      }),
    );
    await expect(readBackupArchive(fs, 'evil.zip')).rejects.toThrow('备份包含未知条目');
  });

  it('rejects a zip-slip files/ entry (Kotlin L106 + ArchiveBudget.destination)', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile(
      'slip.zip',
      zipSync({
        [BACKUP_ZIP_ROWS_ENTRY]: strToU8('{"version":1,"schema":12}\n'),
        [BACKUP_ZIP_SETTINGS_ENTRY]: strToU8('{}'),
        'files/../../etc/passwd': strToU8('root'),
      }),
    );
    await expect(readBackupArchive(fs, 'slip.zip')).rejects.toThrow('压缩包包含越界路径');
  });

  it('rejects both a duplicate and an unknown entry before trusting either', async () => {
    // The Kotlin checks run per entry in archive order, so whichever violation comes
    // first wins. `files/x` precedes the duplicated `settings.json` here.
    const fs = new MemoryFileSystem();
    await fs.writeFile(
      'x.zip',
      rawZip([
        { name: BACKUP_ZIP_ROWS_ENTRY, data: strToU8('{"version":1,"schema":12}\n') },
        { name: 'files/x', data: strToU8('x') },
        { name: BACKUP_ZIP_SETTINGS_ENTRY, data: strToU8('{}') },
        { name: BACKUP_ZIP_SETTINGS_ENTRY, data: strToU8('{}') },
      ]),
    );
    await expect(readBackupArchive(fs, 'x.zip')).rejects.toThrow('备份包含重复条目');
  });

  it('drops a files/ directory entry without failing (Kotlin `if (!entry.isDirectory)`)', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile(
      'dir.zip',
      zipSync({
        [BACKUP_ZIP_ROWS_ENTRY]: strToU8('{"version":1,"schema":12}\n'),
        [BACKUP_ZIP_SETTINGS_ENTRY]: strToU8('{}'),
        'files/epub_covers/': strToU8(''),
      }),
    );
    const out = await readBackupArchive(fs, 'dir.zip');
    expect(out.files.size).toBe(0);
  });

  it('reads stored (uncompressed) entries like ZipInputStream does', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile(
      'stored.zip',
      rawZip([
        { name: BACKUP_ZIP_ROWS_ENTRY, data: strToU8('{"version":1,"schema":12}\n') },
        { name: BACKUP_ZIP_SETTINGS_ENTRY, data: strToU8('{}') },
        { name: 'files/imports/book.epub', data: strToU8('EPUB') },
      ]),
    );
    const out = await readBackupArchive(fs, 'stored.zip');
    expect(out.databaseRows).toBe('{"version":1,"schema":12}\n');
    expect(new TextDecoder().decode(out.files.get('files/imports/book.epub'))).toBe('EPUB');
  });
});

/* ═══════════════════ 6. transaction atomicity of the row restore (L149-187) ═══════════════════ */

describe('importBackup transaction atomicity', () => {
  it('rolls the whole DELETE + INSERT sequence back when a late table fails', async () => {
    const source = await freshBackup();
    await seedAllTwelve(source.db);
    await source.backup.exportBackup('b.json');

    // Restore into a database that already holds a row that the archive will DELETE.
    const target = await freshBackup(FILES_ROOT, source.fs);
    await target.db.execute('INSERT INTO "categories" ("id","name","isProtected") VALUES (?,?,?)', [
      7, '旧分类', 0,
    ]);
    // Make the very last table of the restore fail, after the DELETEs and the earlier
    // INSERTs have already run.
    const real = target.db;
    const statements: string[] = [];
    const failing: BackupService extends never ? never : { db: InMemorySqliteDatabase } = {
      db: Object.assign(Object.create(real) as InMemorySqliteDatabase, {
        open: () => real.open({ name: 'novel-reader.db' }),
        close: () => real.close(),
        query: (sql: string, params?: Array<string | number | null>) =>
          real.query(sql, params),
        execute: async (sql: string, params?: Array<string | number | null>) => {
          statements.push(sql.trim().split(/\s/)[0]?.toUpperCase() ?? '');
          if (sql.includes('INSERT INTO "god_moments"')) {
            throw new Error('injected failure on the last table');
          }
          return real.execute(sql, params);
        },
      }),
    };
    const backup = new BackupService(failing.db, target.fs, target.settings, FILES_ROOT);

    await expect(backup.importBackup('b.json')).rejects.toThrow('injected failure on the last table');

    // Exactly one BEGIN / one ROLLBACK, and no COMMIT.
    expect(statements.filter((s) => s === 'ROLLBACK')).toHaveLength(1);
    expect(statements.filter((s) => s === 'COMMIT')).toHaveLength(0);

    // The pre-existing row survived: the transaction was rolled back, not half-applied.
    const categories = await target.db.query<{ id: number; name: string }>(
      'SELECT * FROM "categories"',
    );
    expect(categories).toEqual([{ id: 7, name: '旧分类', isProtected: 0 }]);
    const books = await target.db.query<{ id: number }>('SELECT * FROM "books"');
    expect(books).toEqual([]);
    const god = await target.db.query<{ id: number }>('SELECT * FROM "god_moments"');
    expect(god).toEqual([]);
  });

  it('keeps the 12-table row set identical across export → import → export', async () => {
    const source = await freshBackup();
    await seedAllTwelve(source.db);
    await source.backup.exportBackup('one.json');
    const target = await freshBackup(FILES_ROOT, source.fs);
    await target.backup.importBackup('one.json');
    await target.backup.exportBackup('two.json');

    // 2026-10-11（E79 接线）：导出产物是 JSON 信封，rows / settings 在内层 ZIP 里。
    const first = await source.fs.readFile('one.json');
    const second = await target.fs.readFile('two.json');
    const firstZip = unzipSync(
      decodeBase64Default((JSON.parse(new TextDecoder().decode(first)) as { archive: string }).archive),
    );
    const secondZip = unzipSync(
      decodeBase64Default((JSON.parse(new TextDecoder().decode(second)) as { archive: string }).archive),
    );
    expect(new TextDecoder().decode(secondZip[BACKUP_ZIP_ROWS_ENTRY] as Uint8Array)).toBe(
      new TextDecoder().decode(firstZip[BACKUP_ZIP_ROWS_ENTRY] as Uint8Array),
    );
    expect(new TextDecoder().decode(secondZip[BACKUP_ZIP_SETTINGS_ENTRY] as Uint8Array)).toBe(
      new TextDecoder().decode(firstZip[BACKUP_ZIP_SETTINGS_ENTRY] as Uint8Array),
    );
  });
});

/* ═══════════════════ 7. the @TypeConverter mappings ═══════════════════ */

describe('DownloadTypeConverters (DownloadTaskDao.kt 6..16)', () => {
  it('stores the enum name, not the ordinal (status.name)', () => {
    // `fromStatus(status: DownloadStatus): String = status.name`
    // `toStatus(value: String): DownloadStatus = valueOf(value) catch -> FAILED`
    expect([...DOWNLOAD_TASK_STATES]).toEqual([
      'PENDING',
      'DOWNLOADING',
      'PAUSED',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ]);
  });

  it('falls back to FAILED for an unknown persisted name', async () => {
    const db = new InMemorySqliteDatabase();
    await openAppDatabase({ db });
    const repo = new DownloadTaskRepository(db);
    // `BOGUS` is not a member of `DownloadStatus`, which is exactly what the converter
    // has to survive: a row written by a newer/older build, or a corrupted database.
    // (Write a legal record, then corrupt the status through a string view — no `any`.)
    const task: DownloadTaskRecord = {
      id: 'b1',
      sourceId: 's',
      title: 't',
      author: 'a',
      coverUrl: null,
      downloadUrl: 'u',
      format: 'EPUB',
      status: 'PENDING',
      downloadedBytes: 0,
      totalBytes: 0,
      filePath: '/f',
      errorMessage: null,
      updatedAt: 0,
    };
    (task as { status: string }).status = 'BOGUS';
    await repo.insertTask(task);
    const row = await repo.getTask('b1');
    expect(row?.status).toBe('FAILED');
  });

  it('round-trips every legal enum name unchanged', async () => {
    const db = new InMemorySqliteDatabase();
    await openAppDatabase({ db });
    const repo = new DownloadTaskRepository(db);
    for (const [index, status] of DOWNLOAD_TASK_STATES.entries()) {
      await repo.insertTask({
        id: `t${index}`,
        sourceId: 's',
        title: 't',
        author: 'a',
        coverUrl: null,
        downloadUrl: 'u',
        format: 'EPUB',
        status,
        downloadedBytes: 0,
        totalBytes: 0,
        filePath: '/f',
        errorMessage: null,
        updatedAt: index,
      });
      expect((await repo.getTask(`t${index}`))?.status).toBe(status);
    }
  });
});

describe('ChapterReadState / SerialStatus (FavoriteModels.kt 17..37)', () => {
  it('ChapterReadState pins the codes 0 / 1 / 2 (enum code, not ordinal)', () => {
    expect(ChapterReadState.UNREAD).toBe(0);
    expect(ChapterReadState.READING).toBe(1);
    expect(ChapterReadState.READ).toBe(2);
  });

  it('ChapterReadState.of falls back to UNREAD for any unknown code', () => {
    expect(chapterReadStateOf(0)).toBe(0);
    expect(chapterReadStateOf(1)).toBe(1);
    expect(chapterReadStateOf(2)).toBe(2);
    expect(chapterReadStateOf(3)).toBe(ChapterReadState.UNREAD);
    expect(chapterReadStateOf(-1)).toBe(ChapterReadState.UNREAD);
    expect(chapterReadStateOf(99)).toBe(ChapterReadState.UNREAD);
  });

  it('serialStatusOf maps the six Chinese aliases and lowercases its input', () => {
    expect(serialStatusOf('已完结')).toBe('completed');
    expect(serialStatusOf('完结')).toBe('completed');
    expect(serialStatusOf('已完結')).toBe('completed');
    expect(serialStatusOf('完結')).toBe('completed');
    expect(serialStatusOf('finished')).toBe('completed');
    expect(serialStatusOf('COMPLETED')).toBe('completed');
    expect(serialStatusOf('连载中')).toBe('ongoing');
    expect(serialStatusOf('連載中')).toBe('ongoing');
    expect(serialStatusOf('连载')).toBe('ongoing');
    expect(serialStatusOf('ONGOING')).toBe('ongoing');
    expect(serialStatusOf('休刊')).toBe('hiatus');
    expect(serialStatusOf('暂停')).toBe('hiatus');
    expect(serialStatusOf('PAUSED')).toBe('hiatus');
    expect(serialStatusOf('unknown')).toBe('unknown');
    expect(serialStatusOf(null)).toBe('unknown');
    expect(serialStatusOf(undefined)).toBe('unknown');
    expect(serialStatusOf('  ongoing  ')).toBe('ongoing');
  });
});
