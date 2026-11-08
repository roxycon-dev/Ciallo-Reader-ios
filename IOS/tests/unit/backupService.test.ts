import { describe, expect, it } from 'vitest';
import { BackupService } from '../../src/core/backup/backupService';
import { BACKUP_ZIP_ROWS_ENTRY, BACKUP_ZIP_SETTINGS_ENTRY } from '../../src/core/backup/backupArchive';
import { decodeBase64Default } from '../../src/core/backup/backupManagerJson';
import { SettingsRepository } from '../../src/core/settings/settingsRepository';
import { createTableSql, TABLES } from '../../src/core/db/schemaV12';
import { InMemorySqliteDatabase } from '../../src/platform/web-mock/inMemoryDb';
import { MemoryFileSystem } from '../../src/platform/web-mock/memoryFileSystem';
import { unzipSync } from 'fflate';

async function openEnv(opts?: { fs?: MemoryFileSystem }): Promise<{
  db: InMemorySqliteDatabase;
  fs: MemoryFileSystem;
  settings: SettingsRepository;
  backup: BackupService;
}> {
  const db = new InMemorySqliteDatabase();
  await db.open({ name: 'backup-test.db' });
  for (const table of TABLES) {
    await db.execute(createTableSql(table));
  }
  const fs = opts?.fs ?? new MemoryFileSystem();
  const settings = new SettingsRepository(db);
  const backup = new BackupService(db, fs, settings);
  return { db, fs, settings, backup };
}

describe('BackupService', () => {
  it('exports NDJSON database rows plus safe settings inside the Kotlin JSON envelope archive', async () => {
    const { db, fs, settings, backup } = await openEnv();
    await db.execute(
      'INSERT INTO "books" ("title", "author", "filePath", "coverUri", "category", "currentChapterIndex", "scrollOffset", "isFinished", "totalChapters", "contentType", "addedTime", "lastReadTime", "sourceId", "comicId") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['诡秘之主', '爱潜水的乌贼', null, 'https://img.test/c.jpg', '玄幻', 3, 128, 0, 1400, 'novel', 1, 2, 'src-1', null],
    );
    await settings.setInt('reader_theme', 4);
    await settings.setFloat('font_size', 20);
    await settings.setString('cookie_token', 'secret');

    // 2026-10-11（E79 接线）：导出产物是 Kotlin `BackupManager.exportBackupJson` 的 JSON
    // 信封，内层 ZIP（archive 字段）才是 `BackupArchive.export` 的原样产物。
    await backup.exportBackup('backups/novel_reader_backup.json');

    const bytes = await fs.readFile('backups/novel_reader_backup.json');
    const envelope = JSON.parse(new TextDecoder().decode(bytes)) as { archive: string };
    expect(envelope.archive.includes('\n')).toBe(false); // Base64.NO_WRAP
    const entries = unzipSync(decodeBase64Default(envelope.archive));
    const rowsText = new TextDecoder().decode(entries[BACKUP_ZIP_ROWS_ENTRY] as Uint8Array);
    const settingsText = new TextDecoder().decode(entries[BACKUP_ZIP_SETTINGS_ENTRY] as Uint8Array);

    const lines = rowsText.trim().split('\n');
    expect(JSON.parse(lines[0] ?? '')).toEqual({ version: 1, schema: 12 });
    const firstRow = JSON.parse(lines[1] ?? '') as { table: string; row: { title: string } };
    expect(firstRow.table).toBe('books');
    expect(firstRow.row.title).toBe('诡秘之主');

    const settingsObj = JSON.parse(settingsText) as Record<string, { type: string; value: unknown }>;
    expect(settingsObj['reader_theme']).toEqual({ type: 'int', value: 4 });
    expect(settingsObj['font_size']?.type).toBe('float');
    expect(settingsObj['cookie_token']).toBeUndefined();
  });

  it('importBackup restores table rows and settings', async () => {
    const source = await openEnv();
    await source.db.execute(
      'INSERT INTO "books" ("title", "author", "filePath", "coverUri", "category", "currentChapterIndex", "scrollOffset", "isFinished", "totalChapters", "contentType", "addedTime", "lastReadTime", "sourceId", "comicId") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      // `filePath` is NOT NULL in the Room v12 schema (12.json `books.filePath.notNull: true`),
    // so a real round-trip cannot carry null there. `coverUri` / `comicId` are nullable.
    ['凡人修仙传', '忘语', '/books/fanren.txt', null, '仙侠', 10, 0, 0, 2446, 'novel', 5, 6, 'src-2', null],
    );
    await source.db.execute(
      'INSERT INTO "chapters" ("bookId", "chapterOrder", "title", "content", "startCharIndex", "endCharIndex") VALUES (?, ?, ?, ?, ?, ?)',
      [1, 0, '第一章', '少年离乡。', 0, 5],
    );
    await source.settings.setInt('page_turn_mode', 2);
    await source.settings.setBoolean('incognito_browsing_enabled', true);
    await source.backup.exportBackup('backups/roundtrip.zip');

    const target = await openEnv({ fs: source.fs });
    await target.backup.importBackup('backups/roundtrip.zip');

    const books = await target.db.query<{ title: string; author: string }>('SELECT "title", "author" FROM "books"');
    expect(books).toHaveLength(1);
    expect(books[0]?.title).toBe('凡人修仙传');
    expect(books[0]?.author).toBe('忘语');

    const chapters = await target.db.query<{ title: string; content: string }>(
      'SELECT "title", "content" FROM "chapters"',
    );
    expect(chapters[0]?.content).toBe('少年离乡。');

    expect(await target.settings.getInt('page_turn_mode', 0)).toBe(2);
    expect(await target.settings.getBoolean('incognito_browsing_enabled', false)).toBe(true);
  });

  it('importBackup rejects unsupported headers', async () => {
    const { fs, backup } = await openEnv();
    const { zipSync, strToU8 } = await import('fflate');
    const bad = zipSync({
      [BACKUP_ZIP_ROWS_ENTRY]: strToU8('{"version":1,"schema":11}\n'),
      [BACKUP_ZIP_SETTINGS_ENTRY]: strToU8('{}'),
    });
    await fs.writeFile('backups/bad.zip', bad);
    await expect(backup.importBackup('backups/bad.zip')).rejects.toThrow(/不支持的备份版本/);
  });

  it('importBackup rejects unsafe setting type mismatches', async () => {
    const { fs, backup } = await openEnv();
    const { zipSync, strToU8 } = await import('fflate');
    const bad = zipSync({
      [BACKUP_ZIP_ROWS_ENTRY]: strToU8('{"version":1,"schema":12}\n'),
      [BACKUP_ZIP_SETTINGS_ENTRY]: strToU8(JSON.stringify({
        reader_theme: { type: 'float', value: 1 },
      })),
    });
    await fs.writeFile('backups/bad-type.zip', bad);
    await expect(backup.importBackup('backups/bad-type.zip')).rejects.toThrow(/类型不符/);
  });

  it('importBackup preserves credential keys on restore (E13)', async () => {
    const { db, fs, settings, backup } = await openEnv();
    await settings.setString('cookie_token', 'keep-me-local');
    await settings.setInt('reader_theme', 0);

    const { zipSync, strToU8 } = await import('fflate');
    const payload = zipSync({
      [BACKUP_ZIP_ROWS_ENTRY]: strToU8('{"version":1,"schema":12}\n'),
      [BACKUP_ZIP_SETTINGS_ENTRY]: strToU8(
        JSON.stringify({
          reader_theme: { type: 'int', value: 5 },
          auth_header: { type: 'string', value: 'Bearer x' },
        }),
      ),
    });
    await fs.writeFile('backups/safe.zip', payload);

    await backup.importBackup('backups/safe.zip');

    expect(await settings.getInt('reader_theme', 0)).toBe(5);
    // E13: `cookie_token` is not a safe key, so Android only removes safe+known-type keys and
    // leaves credentials untouched — a restore must not log the user out.
    expect(await settings.getString('cookie_token', '')).toBe('keep-me-local');
    const all = await db.query<{ key: string }>('SELECT "key" FROM "app_settings"');
    expect(all.map((row) => row.key).sort()).toEqual(['cookie_token', 'reader_theme']);
  });
});
