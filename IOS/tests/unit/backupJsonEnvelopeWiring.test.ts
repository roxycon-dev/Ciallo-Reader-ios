/**
 * E79 接线 —— `BackupService` 导出/恢复编排 × `BackupManager` JSON 兼容信封。
 *
 * Kotlin 权威：`com.example.data.BackupManager.kt` L50-108（exportBackupJson /
 * restoreBackupJson）+ `com.example.god.GodMomentRepository.kt` L103-158（exportJson /
 * importJson）。此前 `backupManagerJson.ts` 只有单测、没有任何生产调用方；本套件钉住
 * BackupService 编排层的行为：
 *  - 导出产物 = Kotlin JSON 信封（archive / exportTime / booksCount / preferences /
 *    godMoments），键名与键序逐字对齐 Kotlin L69-74；
 *  - 信封外层神回 14 字段、不含 coverPath（GodMomentRepository.kt L103-127「封面是本地
 *    缓存可重建」），内层 ZIP 的 god_moments 行照旧走通用 rows 通道（Kotlin 内层同样如此）；
 *  - 恢复：archive 优先并立即返回（L85-90）；轻量路径 7 项 preferences 钳制应用 +
 *    神回 upsert（coverPath 恒 null、rating coerceIn(0.5,5)、空 bookId/chapterId 跳过）；
 *  - 互通：Android 设置页 UI 导出的 ZIP 照旧可导入；按 Kotlin 序列化逻辑构造的
 *    Android 轻量信封样本可恢复 god_moments；iOS 导出信封的键序/键集与 Kotlin 一致
 *    （结构级对拍，parity/ 下没有现成 Android 备份样本）。
 */
import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { BackupService } from '../../src/core/backup/backupService';
import {
  BACKUP_ZIP_ROWS_ENTRY,
  BACKUP_ZIP_SETTINGS_ENTRY,
} from '../../src/core/backup/backupArchive';
import {
  decodeBase64Default,
  JSON_PREFERENCE_KEYS,
} from '../../src/core/backup/backupManagerJson';
import { GodMomentRepository } from '../../src/core/god/godMomentRepository';
import { SettingsRepository } from '../../src/core/settings/settingsRepository';
import { openAppDatabase } from '../../src/core/db/openDatabase';
import { InMemorySqliteDatabase } from '../../src/platform/web-mock/inMemoryDb';
import { MemoryFileSystem } from '../../src/platform/web-mock/memoryFileSystem';

async function env(opts?: { godRepo?: boolean; fs?: MemoryFileSystem }): Promise<{
  db: InMemorySqliteDatabase;
  fs: MemoryFileSystem;
  settings: SettingsRepository;
  backup: BackupService;
}> {
  const db = new InMemorySqliteDatabase();
  await openAppDatabase({ db });
  const fs = opts?.fs ?? new MemoryFileSystem();
  const settings = new SettingsRepository(db);
  const godRepo = opts?.godRepo === false ? null : new GodMomentRepository(db);
  const backup = new BackupService(db, fs, settings, '', godRepo);
  return { db, fs, settings, backup };
}

async function insertBook(db: InMemorySqliteDatabase, title = '诡秘之主'): Promise<void> {
  await db.execute(
    'INSERT INTO "books" ("title", "author", "filePath", "coverUri", "category", "currentChapterIndex", "scrollOffset", "isFinished", "totalChapters", "contentType", "addedTime", "lastReadTime", "sourceId", "comicId") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    // `filePath` is NOT NULL in the Room v12 schema（见 backupService.test.ts 同款注释）。
    [title, '爱潜水的乌贼', '/books/lord.txt', null, '玄幻', 3, 128, 0, 1400, 'novel', 1, 2, 'src-1', null],
  );
}

async function insertGodMoment(db: InMemorySqliteDatabase): Promise<void> {
  await db.execute(
    'INSERT INTO "god_moments" ("id","contentType","bookId","chapterId","bookTitle","chapterTitle","chapterNumber","title","titleIsCustom","rating","note","coverPath","coverSource","cropParams","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [1, 'NOVEL', 'src-1::b1', 'ch-1', '三体', '第一章', 1, '古筝行动', 1, 4.5, '好', '/data/user/0/x/files/god_covers/1.jpg', 'BOOK', '{}', 111, 222],
  );
}

async function readEnvelope(fs: MemoryFileSystem, path: string): Promise<Record<string, unknown>> {
  const text = new TextDecoder().decode(await fs.readFile(path));
  return JSON.parse(text) as Record<string, unknown>;
}

describe('导出产物结构（Kotlin BackupManager.exportBackupJson L50-80）', () => {
  it('信封含 archive/exportTime/booksCount/preferences/godMoments，键序逐字对齐 Kotlin L69-74', async () => {
    const { db, fs, settings, backup } = await env();
    await insertBook(db);
    await insertGodMoment(db);
    await settings.setFloat('font_size', 16.5);
    await settings.setInt('reader_theme', 2);
    await settings.setBoolean('splash_pure_mode', true);

    await backup.exportBackup('backups/novel_reader_backup.json');

    const text = new TextDecoder().decode(await fs.readFile('backups/novel_reader_backup.json'));
    const o = JSON.parse(text) as Record<string, unknown>;
    expect(o['booksCount']).toBe(1);
    expect(typeof o['exportTime']).toBe('number');
    // Kotlin L69-74 的 JSONObject().put 顺序：archive → exportTime → booksCount →
    // preferences →（若有）godMoments。JSON.stringify 保持插入序，逐键比对位置。
    const order = ['"archive"', '"exportTime"', '"booksCount"', '"preferences"', '"godMoments"'].map(
      (key) => text.indexOf(key),
    );
    expect(order.every((pos) => pos >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // NO_WRAP：archive 字段不含换行（Kotlin L54）。
    expect((o['archive'] as string).includes('\n')).toBe(false);

    // 内层 ZIP 与 Android `BackupArchive.export` 同构：12 张表的 rows + settings.json；
    // god_moments 行照旧在 rows 里（含 coverPath）—— Kotlin 的内层 ZIP 同样如此，照抄。
    const zip = unzipSync(decodeBase64Default(o['archive'] as string));
    const rowsText = new TextDecoder().decode(zip[BACKUP_ZIP_ROWS_ENTRY] as Uint8Array);
    expect(rowsText).toContain('god_moments');
    expect(rowsText).toContain('"coverPath":"/data/user/0/x/files/god_covers/1.jpg"');
    expect(zip[BACKUP_ZIP_SETTINGS_ENTRY]).toBeInstanceOf(Uint8Array);

    // 信封 preferences：7 个 camelCase 键（与 ZIP 通道的 snake_case 不同，Kotlin 原样）；
    // Float 走 Kotlin Float.toString()（恒带小数点）。
    const prefs = o['preferences'] as Record<string, string>;
    expect(Object.keys(prefs).sort()).toEqual([...JSON_PREFERENCE_KEYS].sort());
    expect(prefs['fontSize']).toBe('16.5');
    expect(prefs['lineHeight']).toBe('28.0'); // 默认 28f → "28.0"
    expect(prefs['readerTheme']).toBe('2');
    expect(prefs['pageTurnMode']).toBe('0');
    expect(prefs['splashPureMode']).toBe('true');
    expect(prefs['screenOrientationLock']).toBe('0');
    expect(prefs['restReminderMinutes']).toBe('30');

    // 信封外层神回：恰好 14 字段、不含 coverPath（GodMomentRepository.kt L104-127）。
    const god = (o['godMoments'] as Array<Record<string, unknown>>)[0] as Record<string, unknown>;    expect(Object.keys(god).sort()).toEqual(
      [
        'bookId',
        'bookTitle',
        'chapterId',
        'chapterTitle',
        'chapterNumber',
        'contentType',
        'coverSource',
        'createdAt',
        'cropParams',
        'id',
        'note',
        'rating',
        'title',
        'titleIsCustom',
        'updatedAt',
      ].sort(),
    );
    expect('coverPath' in god).toBe(false);
    expect(god['bookId']).toBe('src-1::b1');
    expect(god['chapterId']).toBe('ch-1');
    expect(god['rating']).toBe(4.5);
    expect(god['title']).toBe('古筝行动');
  });

  it('未注入神回仓库时信封不带 godMoments 键（Kotlin L19/L56 可空仓库）', async () => {
    const { db, fs, backup } = await env({ godRepo: false });
    await insertBook(db);
    await backup.exportBackup('b.json');
    const o = await readEnvelope(fs, 'b.json');
    expect('godMoments' in o).toBe(false);
  });
});

describe('信封恢复（Kotlin BackupManager.restoreBackupJson L82-108）', () => {
  it('archive 存在 ⇒ 走 ZIP 通道并立即返回：信封 preferences/godMoments 不参与（L85-90）', async () => {
    const source = await env();
    await insertBook(source.db);
    await source.backup.exportBackup('src.json');
    const inner = ((await readEnvelope(source.fs, 'src.json'))['archive'] as string);

    const target = await env({ fs: source.fs });
    await target.settings.setFloat('font_size', 20);
    // 手工拼一个「archive + 误导性 preferences/godMoments」的信封。
    await target.fs.writeFile(
      'trap.json',
      strToU8(
        JSON.stringify({
          archive: inner,
          exportTime: 1,
          booksCount: 0,
          preferences: { fontSize: '77' },
          godMoments: [{ bookId: 'ghost', chapterId: 'ghost#1', title: '垃圾行' }],
        }),
      ),
    );
    await target.backup.importBackup('trap.json');

    // 书从内层 ZIP 恢复了。
    const books = await target.db.query<{ title: string }>('SELECT "title" FROM "books"');
    expect(books.map((b) => b.title)).toEqual(['诡秘之主']);
    // 信封 preferences 没有被应用（archive 路径立即返回）：font_size 也没被 77 覆盖。
    expect(await target.settings.getFloat('font_size', 999)).toBe(999);
    // 信封 godMoments 没有被导入。
    const god = await target.db.query<{ bookId: string }>('SELECT "bookId" FROM "god_moments"');
    expect(god).toEqual([]);
  });

  it('导出 → 恢复：内层 ZIP 的 god_moments 行原样回来（archive 优先路径，Kotlin L85-90）', async () => {
    const source = await env();
    await insertBook(source.db);
    await insertGodMoment(source.db);
    await source.settings.setInt('reader_theme', 4);
    await source.backup.exportBackup('rt.json');

    const target = await env({ fs: source.fs });
    await target.backup.importBackup('rt.json');

    const god = await targetGodRows(target.db);
    expect(god).toHaveLength(1);
    expect(god[0]?.bookId).toBe('src-1::b1');
    expect(god[0]?.chapterId).toBe('ch-1');
    expect(god[0]?.title).toBe('古筝行动');
    expect(god[0]?.rating).toBe(4.5);
    // Kotlin L85-90：archive 非空 ⇒ 走 ZIP 通道并立即返回，god_moments 由内层 ZIP 的
    // rows 恢复 —— coverPath 随行回来（Kotlin 的内层 ZIP 同样带这一列，照抄）。
    expect(god[0]?.coverPath).toBe('/data/user/0/x/files/god_covers/1.jpg');
    // 内层 ZIP 的书与设置也一并恢复。
    const books = await target.db.query<{ title: string }>('SELECT "title" FROM "books"');
    expect(books).toHaveLength(1);
    expect(await target.settings.getInt('reader_theme', 0)).toBe(4);
  });

  it('导出 → 剥掉 archive → 恢复（轻量路径）：god_moments 经信封 14 字段通道回来，coverPath 恒 null', async () => {
    const source = await env();
    await insertBook(source.db);
    await insertGodMoment(source.db);
    await source.settings.setFloat('font_size', 22);
    await source.backup.exportBackup('rt.json');

    // 轻量样本 = Kotlin 信封去掉 archive（旧备份文件/手编文件的形状，L91-103）。
    const envelope = JSON.parse(new TextDecoder().decode(await source.fs.readFile('rt.json'))) as Record<string, unknown>;
    delete envelope['archive'];
    const target = await env({ fs: source.fs });
    await target.fs.writeFile('rt-light.json', strToU8(JSON.stringify(envelope)));
    await target.backup.importBackup('rt-light.json');

    const god = await targetGodRows(target.db);
    expect(god).toHaveLength(1);
    expect(god[0]?.bookId).toBe('src-1::b1');
    expect(god[0]?.chapterId).toBe('ch-1');
    expect(god[0]?.title).toBe('古筝行动');
    expect(god[0]?.rating).toBe(4.5);
    // 信封通道不含 coverPath，恢复侧硬编码 null（Kotlin L147）—— 跨端封面失效问题就此关闭。
    expect(god[0]?.coverPath).toBeNull();
    // 书**不**恢复（轻量路径只有 preferences + godMoments，Kotlin L91-103）。
    const books = await target.db.query<{ title: string }>('SELECT "title" FROM "books"');
    expect(books).toHaveLength(0);
    // preferences 走信封通道（fontSize 由 Float.toString 序列化，恢复时 8..80 内应用）。
    expect(await target.settings.getFloat('font_size', 0)).toBe(22);
  });

  it('轻量路径（无 archive）：7 项 preferences 区间外跳过 + 神回同键覆盖/越界钳制/空键跳过', async () => {
    const { db, fs, settings, backup } = await env();
    await insertGodMoment(db); // id=1, (src-1::b1, ch-1), rating 4.5, createdAt 111, updatedAt 222
    await settings.setFloat('font_size', 20); // 信封 999 越界 ⇒ 保持 20
    await settings.setInt('reader_theme', 1); // 信封 7 越界 ⇒ 保持 1
    await settings.setInt('screen_orientation_lock', 0); // 信封 9 越界 ⇒ 保持 0

    await fs.writeFile(
      'light.json',
      strToU8(
        JSON.stringify({
          exportTime: 1,
          booksCount: 0,
          preferences: {
            fontSize: '999', // 8..80 之外 → 跳过
            lineHeight: '30', // 8..120 内 → 应用
            readerTheme: '7', // 0..5 之外 → 跳过
            pageTurnMode: '3', // 0..4 内 → 应用
            splashPureMode: 'true',
            screenOrientationLock: '9', // 0..2 之外 → 跳过
            restReminderMinutes: '15', // 0..1440 内 → 应用
          },
          godMoments: [
            // 同 (bookId, chapterId) 覆盖（Kotlin save L66-77），rating coerceIn(0.5, 5)。
            { bookId: 'src-1::b1', chapterId: 'ch-1', title: '古筝行动（修订）', rating: 99 },
            // 空 bookId → 跳过（Kotlin L153）。
            { bookId: '  ', chapterId: 'ch-9', title: '空键', rating: 3 },
            // 新增行；coverPath 即使混进来也必须被丢弃（14 字段通道 + L147）。
            { bookId: 'src-1::b2', chapterId: 'ch-2', title: '新场面', rating: 2.5, coverPath: '/evil/x' },
          ],
        }),
      ),
    );
    await backup.importBackup('light.json');

    expect(await settings.getFloat('font_size', 0)).toBe(20);
    expect(await settings.getFloat('line_height', 0)).toBe(30);
    expect(await settings.getInt('reader_theme', 0)).toBe(1);
    expect(await settings.getInt('page_turn_mode', 0)).toBe(3);
    expect(await settings.getBoolean('splash_pure_mode', false)).toBe(true);
    expect(await settings.getInt('screen_orientation_lock', 0)).toBe(0);
    expect(await settings.getInt('rest_reminder_minutes', 0)).toBe(15);

    const god = await targetGodRows(db);
    expect(god).toHaveLength(2);
    const updated = god.find((row) => row.bookId === 'src-1::b1');
    expect(updated?.title).toBe('古筝行动（修订）');
    expect(updated?.rating).toBe(5); // 99 → coerceIn(0.5, 5)
    expect(updated?.id).toBe(1); // 覆盖语义复用旧 id（Kotlin save）
    expect(updated?.createdAt).toBe(111);
    expect((updated?.updatedAt ?? 0)).toBeGreaterThan(222);
    const added = god.find((row) => row.bookId === 'src-1::b2');
    expect(added?.title).toBe('新场面');
    expect(added?.rating).toBe(2.5);
    expect(added?.coverPath).toBeNull();
  });

  it('无 archive 且无 preferences 对象的信封被拒绝（Kotlin L91 `?: return false`）', async () => {
    const { fs, backup } = await env();
    await fs.writeFile('nolight.json', strToU8(JSON.stringify({ exportTime: 1, booksCount: 0 })));
    await expect(backup.importBackup('nolight.json')).rejects.toThrow('备份缺少 preferences 字段');
  });
});

describe('跨端互通', () => {
  it('Android 设置页 UI 导出的 ZIP（restoreBackupArchive 通道）照旧可导入', async () => {
    const { fs, settings, backup } = await env();
    // Android UI 产物形状：database.rows + settings.json 的 ZIP（PK 魔数开头）。
    await fs.writeFile(
      'android-ui.zip',
      zipSync({
        'database.rows': strToU8('{"version":1,"schema":12}\n'),
        'settings.json': strToU8(JSON.stringify({ reader_theme: { type: 'int', value: 3 } })),
      }),
    );
    await backup.importBackup('android-ui.zip');
    expect(await settings.getInt('reader_theme', 0)).toBe(3);
  });

  it('按 Kotlin 序列化逻辑构造的 Android 轻量信封样本可恢复 god_moments', async () => {
    const { db, fs, settings, backup } = await env();
    // Kotlin JSONObject 键名 / 值形状：Float.toString 恒带小数点、rating 是 double、
    // 神回条目恰好 14 字段（无 coverPath）；轻量样本没有 archive 键。
    const envelope = JSON.stringify({
      exportTime: 1760000000000,
      booksCount: 3,
      preferences: {
        fontSize: '18.0',
        lineHeight: '28.0',
        readerTheme: '1',
        pageTurnMode: '0',
        splashPureMode: 'false',
        screenOrientationLock: '0',
        restReminderMinutes: '30',
      },
      godMoments: [
        {
          id: 12,
          contentType: 'comic',
          bookId: 'src::c',
          chapterId: 'src::c#7',
          bookTitle: '葬送的芙莉莲',
          chapterTitle: '第7话',
          chapterNumber: 7,
          title: '一级魔法使试验',
          titleIsCustom: false,
          rating: 4.5,
          note: '',
          coverSource: 'page|2|',
          cropParams: 'l0.06,t0.06,r0.94,b0.94',
          createdAt: 1760000000000,
          updatedAt: 1760000000000,
        },
        // Kotlin isBlank → 跳过。
        { bookId: '', chapterId: 'x', title: 'blank' },
      ],
    });
    await fs.writeFile('android-light.json', strToU8(envelope));
    await backup.importBackup('android-light.json');

    expect(await settings.getFloat('font_size', 0)).toBe(18);
    expect(await settings.getFloat('line_height', 0)).toBe(28);
    expect(await settings.getInt('reader_theme', 0)).toBe(1);
    expect(await settings.getInt('rest_reminder_minutes', 0)).toBe(30);

    const god = await targetGodRows(db);
    expect(god).toHaveLength(1);
    expect(god[0]).toMatchObject({
      bookId: 'src::c',
      chapterId: 'src::c#7',
      bookTitle: '葬送的芙莉莲',
      chapterTitle: '第7话',
      chapterNumber: 7,
      title: '一级魔法使试验',
      titleIsCustom: 0,
      rating: 4.5,
      coverSource: 'page|2|',
      cropParams: 'l0.06,t0.06,r0.94,b0.94',
    });
    // Android 备份从不携带 coverPath，iOS 恢复后必须是 null（Kotlin L147），而不是指向
    // 本机不存在文件的路径。
    expect(god[0]?.coverPath).toBeNull();
  });
});

interface GodRow {
  id: number;
  contentType: string;
  bookId: string;
  chapterId: string;
  bookTitle: string;
  chapterTitle: string;
  chapterNumber: number;
  title: string;
  titleIsCustom: number;
  rating: number;
  note: string;
  coverPath: string | null;
  coverSource: string;
  cropParams: string;
  createdAt: number;
  updatedAt: number;
}

async function targetGodRows(db: InMemorySqliteDatabase): Promise<GodRow[]> {
  return db.query<GodRow>('SELECT * FROM "god_moments"');
}
