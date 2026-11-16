import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { AutoBackup } from '../../src/core/backup/autoBackup';
import type { AutoBackupArchivePort } from '../../src/core/backup/autoBackup';
import { AutoBackupStore } from '../../src/core/backup/autoBackupStore';
import { SettingsRepository } from '../../src/core/settings/settingsRepository';
import { createTableSql, TABLES } from '../../src/core/db/schemaV12';
import type { ArchiveImportResult } from '../../src/core/transfer/archiveImporter';
import { InMemorySqliteDatabase } from '../../src/platform/web-mock/inMemoryDb';
import { MemoryFileSystem } from '../../src/platform/web-mock/memoryFileSystem';

/**
 * `autoBackup.ts` / `autoBackupStore.ts` 的门禁用例 —— 每条对应 `AutoBackup.kt` /
 * `AutoBackupStore.kt` 的一个分支，时钟、文件系统、归档端口全部注入，不外接真实定时器。
 */

/** 用户选的备份目录（Kotlin 是 SAF 树 URI，iOS 是目录路径）。 */
const FOLDER = 'BackupDir';
/** 临时目录（Kotlin `context.filesDir`）。 */
const TEMP = 'tmp';

/** 用**本地时区**构造的固定时刻，避免断言依赖机器 TZ（`SimpleDateFormat` 用的是本地时区）。 */
const T0 = new Date(2026, 0, 15, 8, 30, 0).getTime();
const INTERVAL = AutoBackupStore.INTERVAL_MS;

class FakeArchive implements AutoBackupArchivePort {
  exports = 0;
  imports: Array<{ path: string; mode: 'REPLACE' }> = [];
  peakConcurrency = 0;
  failWith: Error | null = null;
  emptyExport = false;
  onExport: (() => void) | null = null;
  private active = 0;

  constructor(private readonly fs: MemoryFileSystem) {}

  async exportArchive(target: string): Promise<void> {
    this.exports += 1;
    this.active += 1;
    this.peakConcurrency = Math.max(this.peakConcurrency, this.active);
    try {
      // 让出一次事件循环：没有串行锁时这里会观测到并发。
      await Promise.resolve();
      this.onExport?.();
      if (this.failWith !== null) throw this.failWith;
      await this.fs.writeFile(target, this.emptyExport ? new Uint8Array() : strToU8('portable-archive'));
    } finally {
      this.active -= 1;
    }
  }

  async importArchive(target: string, mode: 'REPLACE'): Promise<ArchiveImportResult> {
    this.imports.push({ path: target, mode });
    const bytes = await this.fs.readFile(target);
    return {
      added: bytes.length,
      merged: 0,
      skipped: 0,
      warnings: [],
      duplicate: false,
      recordedSeconds: null,
    };
  }
}

interface Env {
  db: InMemorySqliteDatabase;
  fs: MemoryFileSystem;
  settings: SettingsRepository;
  store: AutoBackupStore;
  archive: FakeArchive;
  clock: { value: number };
  auto: AutoBackup;
}

async function openEnv(): Promise<Env> {
  const db = new InMemorySqliteDatabase();
  await db.open({ name: 'auto-backup.db' });
  for (const table of TABLES) {
    await db.execute(createTableSql(table));
  }
  const fs = new MemoryFileSystem();
  const settings = new SettingsRepository(db);
  const store = new AutoBackupStore(fs, settings);
  const archive = new FakeArchive(fs);
  const clock = { value: T0 };
  let nano = 0;
  const auto = new AutoBackup(db, fs, archive, store, {
    now: () => clock.value,
    nanoTime: () => {
      nano += 1;
      return nano;
    },
    tempDir: TEMP,
  });
  return { db, fs, settings, store, archive, clock, auto };
}

async function addBook(db: InMemorySqliteDatabase, title = '诡秘之主'): Promise<void> {
  await db.execute(
    'INSERT INTO "books" ("title", "author", "filePath", "coverUri", "category", "currentChapterIndex", "scrollOffset", "isFinished", "totalChapters", "contentType", "addedTime", "lastReadTime", "sourceId", "comicId") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [title, '爱潜水的乌贼', '/books/mystery.txt', null, '玄幻', 0, 0, 0, 1400, 'novel', 1, 2, 'src-1', null],
  );
}

/** 打开自动备份 + 选好目录（`enable` + `attachTree`）。 */
async function enableAuto(env: Env): Promise<void> {
  await env.store.setEnabled(true);
  expect(await env.store.attachTree(FOLDER)).toBe(true);
}

describe('AutoBackupStore 常量与纯函数（Kotlin companion object L150-175）', () => {
  it('照抄 FILE_PREFIX / FILE_SUFFIX / MAX_KEPT / INTERVAL_MS', () => {
    expect(AutoBackupStore.FILE_PREFIX).toBe('ciallo-auto-');
    expect(AutoBackupStore.FILE_SUFFIX).toBe('.zip');
    expect(AutoBackupStore.MAX_KEPT).toBe(3);
    expect(AutoBackupStore.INTERVAL_MS).toBe(12 * 60 * 60 * 1000);
    expect(AutoBackupStore.MIME).toBe('application/zip');
    expect(AutoBackupStore.PREFS_NAME).toBe('auto_backup');
  });

  it('fileName 生成 ciallo-auto-yyyyMMdd-HHmmss.zip，并能反解时间', () => {
    const name = AutoBackupStore.fileName(T0);
    expect(name).toBe('ciallo-auto-20260115-083000.zip');
    expect(AutoBackupStore.isSnapshotName(name)).toBe(true);
    expect(AutoBackupStore.isSnapshotName('manual-backup.zip')).toBe(false);
    expect(AutoBackupStore.snapshotTime(name)).toBe(Date.UTC(2026, 0, 15, 8, 30, 0));
    expect(AutoBackupStore.snapshotTime('ciallo-auto-broken.zip')).toBe(0);
  });

  it('isDue 只在「启用 + 有目录 + 满 12h」时成立', () => {
    const base = { enabled: true, hasTree: true, lastSuccessAt: T0 };
    expect(AutoBackupStore.isDue({ ...base, now: T0 + INTERVAL })).toBe(true);
    expect(AutoBackupStore.isDue({ ...base, now: T0 + INTERVAL - 1 })).toBe(false);
    expect(AutoBackupStore.isDue({ ...base, enabled: false, now: T0 + INTERVAL })).toBe(false);
    expect(AutoBackupStore.isDue({ ...base, hasTree: false, now: T0 + INTERVAL })).toBe(false);
  });
});

describe('AutoBackup.runIfDue（AutoBackup.kt L42-50）', () => {
  it('未启用或有目录缺失时返回 null 且不写盘', async () => {
    const env = await openEnv();
    await addBook(env.db);
    expect(await env.auto.runIfDue()).toBeNull();

    // 只开开关、不选目录 ⇒ 仍然不备份（Kotlin hasTree 合取项）。
    await env.store.setEnabled(true);
    expect(await env.auto.runIfDue()).toBeNull();
    expect(await env.fs.list(FOLDER)).toEqual([]);
    expect(env.archive.exports).toBe(0);
  });

  it('首次满足条件时备份一次并刷新 lastSuccessAt', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await enableAuto(env);

    const outcome = await env.auto.runIfDue();
    expect(outcome).toEqual({ ok: true, message: '已备份 1 本书' });
    expect(env.archive.exports).toBe(1);
    expect(await env.store.lastSuccessAt()).toBe(T0);
    expect(await env.store.lastResult()).toBeNull();

    const files = await env.fs.list(FOLDER);
    expect(files).toEqual(['ciallo-auto-20260115-083000.zip']);
    // 临时文件在 finally 里删掉了（Kotlin L74）。
    expect(await env.fs.list(TEMP)).toEqual([]);
    expect(await env.auto.latest()).toEqual({
      name: 'ciallo-auto-20260115-083000.zip',
      modifiedAt: Date.UTC(2026, 0, 15, 8, 30, 0),
    });
  });

  it('距上次成功不足 12h 不触发，正好 12h 触发', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await enableAuto(env);
    await env.store.setLastSuccessAt(T0);

    env.clock.value = T0 + INTERVAL - 1;
    expect(await env.auto.runIfDue()).toBeNull();
    expect(env.archive.exports).toBe(0);

    env.clock.value = T0 + INTERVAL;
    expect(await env.auto.runIfDue()).toEqual({ ok: true, message: '已备份 1 本书' });
    expect(env.archive.exports).toBe(1);
    expect(await env.store.lastSuccessAt()).toBe(T0 + INTERVAL);
  });

  it('打开「仅 Wi-Fi 预加载」也不影响触发（Kotlin 没有网络/电量门禁）', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await enableAuto(env);
    await env.settings.setBoolean('preload_wifi_only', true);

    const outcome = await env.auto.runIfDue();
    expect(outcome?.ok).toBe(true);
    expect(env.archive.exports).toBe(1);
  });
});

describe('AutoBackup.backupNow 失败与空内容分支（AutoBackup.kt L59-75）', () => {
  it('导出抛错时返回失败文案、写入 lastResult、不更新 lastSuccessAt', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await enableAuto(env);
    env.archive.failWith = new Error('导出中断');

    const outcome = await env.auto.backupNow();
    expect(outcome).toEqual({ ok: false, message: '导出中断' });
    expect(await env.store.lastResult()).toBe('导出中断');
    expect(await env.store.lastSuccessAt()).toBe(0);
    expect(await env.fs.list(FOLDER)).toEqual([]);
    expect(await env.fs.list(TEMP)).toEqual([]);
  });

  it('没有目录 / 空书库分别给出 Kotlin 原文文案', async () => {
    const env = await openEnv();
    expect(await env.auto.backupNow()).toEqual({ ok: false, message: '还没有选择备份目录' });

    await enableAuto(env);
    expect(await env.auto.backupNow()).toEqual({ ok: false, message: '书库是空的，暂不备份' });
    expect(env.archive.exports).toBe(0);
  });

  it('导出成空文件时保留上一份，且不清空上一轮的 lastResult', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await enableAuto(env);

    expect((await env.auto.runIfDue())?.ok).toBe(true);
    const kept = await env.fs.list(FOLDER);
    expect(kept).toHaveLength(1);

    await env.store.setLastResult('上一轮失败');
    env.clock.value = T0 + INTERVAL;
    env.archive.emptyExport = true;

    expect(await env.auto.runIfDue()).toEqual({ ok: false, message: '备份内容为空，已保留上一份' });
    expect(await env.store.lastSuccessAt()).toBe(T0);
    expect(await env.store.lastResult()).toBe('上一轮失败');
    expect(await env.fs.list(FOLDER)).toEqual(kept);
    expect(await env.fs.list(TEMP)).toEqual([]);
  });
});

describe('AutoBackup 取消（Kotlin CancellationException 重抛，L70/L82）', () => {
  it('开始时已取消 ⇒ 抛错、不写 lastSuccessAt、不留临时文件', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await enableAuto(env);
    const controller = new AbortController();
    controller.abort();

    await expect(env.auto.backupNow(controller.signal)).rejects.toThrow(/自动备份已取消/);
    expect(await env.store.lastSuccessAt()).toBe(0);
    expect(await env.store.lastResult()).toBeNull();
    expect(await env.fs.list(FOLDER)).toEqual([]);
    expect(await env.fs.list(TEMP)).toEqual([]);
  });

  it('导出过程中被取消 ⇒ 抛错而不是折成 Outcome(false, …)', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await enableAuto(env);
    const controller = new AbortController();
    env.archive.onExport = () => controller.abort();

    await expect(env.auto.backupNow(controller.signal)).rejects.toThrow();
    expect(await env.store.lastSuccessAt()).toBe(0);
    expect(await env.store.lastResult()).toBeNull();
    expect(await env.fs.list(FOLDER)).toEqual([]);
    expect(await env.fs.list(TEMP)).toEqual([]);
  });
});

describe('AutoBackup 旧包清理（AutoBackupStore.prune，Kotlin L103-106 + L162）', () => {
  it('连续备份 5 次只保留最近 3 份，且不动非本应用文件', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await enableAuto(env);
    await env.fs.writeFile(`${FOLDER}/manual-backup.zip`, strToU8('manual'));
    await env.fs.writeFile(`${FOLDER}/notes.txt`, strToU8('notes'));

    for (let round = 0; round < 5; round += 1) {
      if (round > 0) env.clock.value = T0 + round * (INTERVAL + 1000);
      const outcome = await env.auto.runIfDue();
      expect(outcome?.ok).toBe(true);
    }

    const files = (await env.fs.list(FOLDER)).sort();
    expect(files).toEqual([
      'ciallo-auto-20260116-083002.zip',
      'ciallo-auto-20260116-203003.zip',
      'ciallo-auto-20260117-083004.zip',
      'manual-backup.zip',
      'notes.txt',
    ]);
    const snapshots = await env.store.snapshots();
    expect(snapshots.map((snapshot) => snapshot.name)).toEqual([
      'ciallo-auto-20260117-083004.zip',
      'ciallo-auto-20260116-203003.zip',
      'ciallo-auto-20260116-083002.zip',
    ]);
  });
});

describe('AutoBackup 恢复与恢复提示（AutoBackup.kt L79-100）', () => {
  it('restore 读出目录里的备份后用 REPLACE 导入，并删掉临时文件', async () => {
    const env = await openEnv();
    const name = AutoBackupStore.fileName(T0);
    await env.fs.writeFile(`${FOLDER}/${name}`, strToU8('portable-archive'));
    await env.store.attachTree(FOLDER);

    const result = await env.auto.restore(name);
    expect(result.added).toBe('portable-archive'.length);
    expect(env.archive.imports).toHaveLength(1);
    expect(env.archive.imports[0]?.mode).toBe('REPLACE');
    expect(env.archive.imports[0]?.path.startsWith(`${TEMP}/auto_restore_`)).toBe(true);
    expect(await env.fs.list(TEMP)).toEqual([]);
  });

  it('名字不存在时抛 Kotlin 原文的「无法读取备份文件」', async () => {
    const env = await openEnv();
    await env.store.attachTree(FOLDER);
    await expect(env.auto.restore('ciallo-auto-20260115-083000.zip')).rejects.toThrow(
      '无法读取备份文件：ciallo-auto-20260115-083000.zip',
    );
    expect(env.archive.imports).toHaveLength(0);
  });

  it('空书架 + 目录有备份才提示恢复，提示一次后不再提示', async () => {
    const env = await openEnv();
    await env.store.attachTree(FOLDER);
    expect(await env.auto.shouldOfferRestore()).toBe(false);

    await env.fs.writeFile(`${FOLDER}/${AutoBackupStore.fileName(T0)}`, strToU8('portable-archive'));
    expect(await env.auto.shouldOfferRestore()).toBe(true);
    expect(await env.auto.treeLabel()).toBe(FOLDER);

    await env.auto.markRestoreOffered();
    expect(await env.auto.shouldOfferRestore()).toBe(false);

    // 书架非空同样不提示（新建环境避免 restore_offered 干扰）。
    const withBook = await openEnv();
    await addBook(withBook.db);
    await withBook.store.attachTree(FOLDER);
    await withBook.fs.writeFile(`${FOLDER}/${AutoBackupStore.fileName(T0)}`, strToU8('x'));
    expect(await withBook.auto.shouldOfferRestore()).toBe(false);
  });
});

describe('AutoBackup 并发锁', () => {
  it('两个 backupNow 并发时归档调用不重叠', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await enableAuto(env);

    const results = await Promise.all([env.auto.backupNow(), env.auto.backupNow()]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(env.archive.exports).toBe(2);
    expect(env.archive.peakConcurrency).toBe(1);
  });
});
