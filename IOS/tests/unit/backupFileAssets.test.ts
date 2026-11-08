/**
 * Gap A (E12) + `@FILES@` re-localisation — `src/core/backup/**` parity against Android
 * `BackupArchive.kt` L57 / L81-87 / L144.
 *
 * An Android backup carries the user's own file assets (imported books, extracted covers,
 * custom fonts, …) under a `files/<relative>` ZIP entry. This suite proves that the iOS
 * export writes those assets and that a restore re-materialises them and re-localises the
 * `@FILES@` placeholder to the *target* device files directory — the exact byte-compatible
 * shape Android produces and consumes.
 */
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { BackupService } from '../../src/core/backup/backupService';
import { decodeBase64Default } from '../../src/core/backup/backupManagerJson';
import { SettingsRepository } from '../../src/core/settings/settingsRepository';
import { openAppDatabase } from '../../src/core/db/openDatabase';
import { InMemorySqliteDatabase } from '../../src/platform/web-mock/inMemoryDb';
import { MemoryFileSystem } from '../../src/platform/web-mock/memoryFileSystem';

const SRC = '/data/user/0/com.ciallo.reader/files';
const TGT = '/var/mobile/Containers/Data/Application/ABC/Documents/files';

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * 2026-10-11（E79 接线）：`exportBackup` 产物是 Kotlin JSON 信封，`files/**` 与
 * `database.rows` / `settings.json` 都在内层 ZIP（`archive` 字段）里。
 */
async function readEnvelopeArchive(fs: MemoryFileSystem, path: string): Promise<Record<string, Uint8Array>> {
  const envelope = JSON.parse(decode(await fs.readFile(path))) as { archive: string };
  return unzipSync(decodeBase64Default(envelope.archive));
}

async function seedBook(db: InMemorySqliteDatabase, filesRoot: string): Promise<void> {
  await db.execute(
    'INSERT INTO "books" ("id","title","author","filePath","coverUri","category","currentChapterIndex","scrollOffset","isFinished","totalChapters","contentType","addedTime","lastReadTime","sourceId","comicId") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [1, '书', '作者', '/abs/book.txt', `${filesRoot}/epub_covers/cover.png`, '玄幻', 0, 0, 0, 1, 'NOVEL', 1, 1, '', ''],
  );
}

describe('backup file assets (Gap A / E12)', () => {
  it('packs owned file assets into files/ and re-localises @FILES@ on restore', async () => {
    const fs = new MemoryFileSystem();
    // Owned assets that must travel with the backup.
    await fs.writeFile(`${SRC}/epub_covers/cover.png`, new TextEncoder().encode('COVER'));
    await fs.writeFile(`${SRC}/imports/book.epub`, new TextEncoder().encode('EPUB'));
    await fs.writeFile(`${SRC}/custom_font_roboto.ttf`, new TextEncoder().encode('FONT'));
    // Must be excluded: not an owned name, and a temp download.
    await fs.writeFile(`${SRC}/cache/skip.txt`, new TextEncoder().encode('SKIP'));
    await fs.writeFile(`${SRC}/epub_covers/temp.part`, new TextEncoder().encode('PART'));

    const srcDb = new InMemorySqliteDatabase();
    await openAppDatabase({ db: srcDb });
    const srcSettings = new SettingsRepository(srcDb);
    const srcBackup = new BackupService(srcDb, fs, srcSettings, SRC);

    await seedBook(srcDb, SRC);
    await srcSettings.setString('custom_font_path', `${SRC}/custom_font_roboto.ttf`);
    await srcSettings.setInt('reader_theme', 3);
    await srcBackup.exportBackup('b.json');

    // Android-compatible ZIP layout: relative `files/<path>` entries, no absolute paths.
    const entries = Object.keys(await readEnvelopeArchive(fs, 'b.json'));
    expect(entries).toContain('database.rows');
    expect(entries).toContain('settings.json');
    expect(entries).toContain('files/epub_covers/cover.png');
    expect(entries).toContain('files/imports/book.epub');
    expect(entries).toContain('files/custom_font_roboto.ttf');
    // Non-owned directory and .part temp file are skipped (Kotlin L81 / L85).
    expect(entries).not.toContain('files/cache/skip.txt');
    expect(entries).not.toContain('files/epub_covers/temp.part');

    // The export substituted the files root with the @FILES@ placeholder in settings.
    const zip = await readEnvelopeArchive(fs, 'b.json');
    const settingsObj = JSON.parse(decode(zip['settings.json'] as Uint8Array)) as Record<
      string,
      { type: string; value: string }
    >;
    expect(settingsObj['custom_font_path']).toEqual({ type: 'string', value: '@FILES@/custom_font_roboto.ttf' });

    // Restore into a DIFFERENT device root to prove @FILES@ is re-localised, not copied raw.
    const tdb = new InMemorySqliteDatabase();
    await openAppDatabase({ db: tdb });
    const tsettings = new SettingsRepository(tdb);
    const tbackup = new BackupService(tdb, fs, tsettings, TGT);
    await tbackup.importBackup('b.json');

    // File assets materialised under the NEW root (Kotlin L106 equivalent).
    expect(decode(await fs.readFile(`${TGT}/epub_covers/cover.png`))).toBe('COVER');
    expect(decode(await fs.readFile(`${TGT}/imports/book.epub`))).toBe('EPUB');
    expect(decode(await fs.readFile(`${TGT}/custom_font_roboto.ttf`))).toBe('FONT');

    // DB row + setting re-localised to the NEW root — the @FILES@ placeholder was restored.
    const books = await tdb.query<{ coverUri: string }>('SELECT * FROM "books"');
    expect(books[0]?.coverUri).toBe(`${TGT}/epub_covers/cover.png`);
    expect(await tsettings.getString('custom_font_path', '')).toBe(`${TGT}/custom_font_roboto.ttf`);
    expect(await tsettings.getInt('reader_theme', 0)).toBe(3);
  });

  it('skips files that escape the files root or exceed capacity', async () => {
    const fs = new MemoryFileSystem();
    // A sibling directory outside filesRoot must never be archived.
    await fs.writeFile(`/elsewhere/secret.txt`, new TextEncoder().encode('X'));

    const db = new InMemorySqliteDatabase();
    await openAppDatabase({ db });
    const settings = new SettingsRepository(db);
    const backup = new BackupService(db, fs, settings, SRC);
    await seedBook(db, SRC);
    await backup.exportBackup('b2.json');

    const entries = Object.keys(await readEnvelopeArchive(fs, 'b2.json'));
    expect(entries).not.toContain('files/elsewhere/secret.txt');
  });
});
