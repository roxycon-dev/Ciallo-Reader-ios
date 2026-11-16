/**
 * autoBackupWiring.test.tsx — 自动备份「端到端接线」的回归用例。
 *
 * 覆盖（每条对应需求里的一个验收点）：
 *   ① 设置页开关写库 `auto_backup_enabled`，并自动挂上应用私有目录 `backups/auto`
 *   ② 「立即备份」真的调用归档适配器、产物落在 `backups/auto-tmp/`，卡片显示「已备份 N 本书」
 *   ③ `shouldOfferRestore()` 为真时出现「从自动备份恢复」，确认后走 `REPLACE` 导入
 *   ④ 启动入口 `runAutoBackupIfDue()` 调用 `runIfDue()`；异常被 Kotlin `runCatching` 语义吞掉
 *   ⑤ 距上次成功不足 12h 不重复备份
 *
 * 被测接线点：
 *   `@platform/autoBackupRuntime`（本文件注入内存 DB/FS + 假归档端口）
 *   `@ui/pages/SettingsPage`      （「数据备份」区块里的自动备份卡片）
 *   `src/App.tsx`                 （`runAutoBackupIfDue` / `offerAutoBackupRestore`）
 *
 * 仓库没有 `@testing-library/react`，沿用 tests/unit 既有写法：`react-dom/client` + `act`。
 * 全程不联网、不碰原生插件：归档端口是假的，DB / FS 都在内存里。
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { strToU8 } from 'fflate';
import { AppLanguage, setAppLanguage } from '@core/i18n';
import { TABLES, createTableSql } from '@core/db/schemaV14';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { AutoBackupStore } from '@core/backup/autoBackupStore';
import type { AutoBackupArchivePort } from '@core/backup/autoBackup';
import type { ArchiveImportResult } from '@core/transfer/archiveImporter';
import {
  AUTO_BACKUP_FOLDER,
  AUTO_BACKUP_TEMP_DIR,
  AutoBackupRuntime,
  createAutoBackupRuntime,
  resetAutoBackupRuntime,
  setAutoBackupRuntime,
} from '@platform/autoBackupRuntime';
import {
  SettingsPage,
  autoBackupResultText,
  autoBackupStatusText,
} from '@ui/pages/SettingsPage';
import { runAutoBackupIfDue } from '../../src/App';
import { InMemorySqliteDatabase } from '@platform/web-mock/inMemoryDb';
import { MemoryFileSystem } from '@platform/web-mock/memoryFileSystem';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

/** 固定时刻（本地时区构造，断言不依赖机器 TZ —— 与 `AutoBackupStore.fileName` 一致）。 */
const T0 = new Date(2026, 0, 15, 8, 30, 0).getTime();
const INTERVAL = AutoBackupStore.INTERVAL_MS;
const SNAPSHOT = 'ciallo-auto-20260115-083000.zip';

class FakeArchive implements AutoBackupArchivePort {
  readonly exports: string[] = [];
  readonly imports: Array<{ path: string; mode: 'REPLACE' }> = [];
  failWith: Error | null = null;

  constructor(private readonly fs: MemoryFileSystem) {}

  async exportArchive(target: string): Promise<void> {
    this.exports.push(target);
    if (this.failWith !== null) throw this.failWith;
    await this.fs.writeFile(target, strToU8('portable-archive'));
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
  archive: FakeArchive;
  clock: { value: number };
  runtime: AutoBackupRuntime;
}

async function openEnv(): Promise<Env> {
  const db = new InMemorySqliteDatabase();
  await db.open({ name: 'auto-backup-wiring.db' });
  for (const table of TABLES) await db.execute(createTableSql(table));
  const fs = new MemoryFileSystem();
  const settings = new SettingsRepository(db);
  const archive = new FakeArchive(fs);
  const clock = { value: T0 };
  let nano = 0;
  const runtime = createAutoBackupRuntime({
    db,
    fs,
    settings,
    archive,
    now: () => clock.value,
    nanoTime: () => {
      nano += 1;
      return nano;
    },
  });
  return { db, fs, settings, archive, clock, runtime };
}

async function addBook(db: InMemorySqliteDatabase, title = '诡秘之主'): Promise<void> {
  await db.execute(
    'INSERT INTO "books" ("title", "author", "filePath", "coverUri", "category", "currentChapterIndex", "scrollOffset", "isFinished", "totalChapters", "contentType", "addedTime", "lastReadTime", "sourceId", "comicId") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [title, '爱潜水的乌贼', '/books/mystery.txt', null, '玄幻', 0, 0, 0, 1400, 'novel', 1, 2, 'src-1', null],
  );
}

/* ── 渲染骨架（与 tests/unit 其它 .tsx 用例同一套：createRoot + act） ── */

interface Mounted {
  readonly root: Root;
  readonly host: HTMLDivElement;
}

const mounted: Mounted[] = [];

async function mountSettings(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<SettingsPage />);
  });
  mounted.push({ root, host });
  return host;
}

/** 让异步 handler（`void (async () => …)()`）跑完一轮。 */
async function settle(ms = 20): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
  const buttons = [...host.querySelectorAll('button')];
  return (buttons.find((button) => (button.textContent ?? '').trim() === text) ?? null) as HTMLButtonElement | null;
}

async function click(node: HTMLElement): Promise<void> {
  await act(async () => {
    node.click();
  });
  await settle();
}

function autoBackupSwitch(host: HTMLElement): HTMLButtonElement {
  const node = host.querySelector('[role="switch"][aria-label="自动备份"]');
  if (node === null) throw new Error('未找到自动备份开关');
  return node as HTMLButtonElement;
}

function text(host: HTMLElement, testId: string): string {
  return (host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '').trim();
}

beforeEach(() => {
  setAppLanguage(AppLanguage.ZH);
  resetAutoBackupRuntime();
});

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => {
      entry.root.unmount();
    });
    entry.host.remove();
  }
  resetAutoBackupRuntime();
});

describe('自动备份卡片 —— 状态文案（TransferScreen.kt L408-414 逐字）', () => {
  it('四条状态行与「最近一次结果」的优先级', () => {
    const base = { enabled: false, label: null, lastResult: null, lastSuccessAt: 0, latest: null, restorable: false };
    expect(autoBackupStatusText(base)).toBe('关闭后不会自动备份；卸载重装会丢掉书源和下载的书');
    expect(autoBackupStatusText({ ...base, enabled: true })).toBe('已开启，还需要选择一个备份目录');
    expect(autoBackupStatusText({ ...base, enabled: true, label: '应用备份目录' })).toBe(
      '已开启，尚未备份 · 应用备份目录',
    );
    expect(
      autoBackupStatusText({ ...base, enabled: true, label: '应用备份目录', lastSuccessAt: T0 }),
    ).toBe('已开启 · 01-15 08:30 · 应用备份目录');

    expect(autoBackupResultText(base, null)).toBe('尚未备份');
    expect(autoBackupResultText({ ...base, lastSuccessAt: T0 }, null)).toBe('上次备份 01-15 08:30');
    expect(autoBackupResultText({ ...base, lastResult: '写入备份目录失败' }, null)).toBe('写入备份目录失败');
    expect(autoBackupResultText(base, '已备份 3 本书')).toBe('已备份 3 本书');
  });
});

describe('设置页接线', () => {
  it('① 开关写 auto_backup_enabled，并自动挂上应用私有目录', async () => {
    const env = await openEnv();
    setAutoBackupRuntime(env.runtime);
    const host = await mountSettings();
    await settle();

    const toggle = autoBackupSwitch(host);
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await click(toggle);

    expect(await env.settings.getBoolean('auto_backup_enabled', false)).toBe(true);
    // Kotlin `pickAutoFolder` L192：挂上目录就等于开启 —— 这里反过来，开启时挂目录。
    expect(await env.runtime.folder()).toBe(AUTO_BACKUP_FOLDER);
    expect(text(host, 'auto_backup_status')).toBe('已开启，尚未备份 · 应用备份目录');
  });

  it('② 立即备份调用归档适配器、产物落 backups/auto-tmp，并显示「已备份 N 本书」', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await env.runtime.setEnabled(true);
    await env.runtime.attachDefaultFolder();
    setAutoBackupRuntime(env.runtime);
    const host = await mountSettings();
    await settle();

    const button = buttonByText(host, '立即备份');
    expect(button).not.toBeNull();
    await click(button!);

    expect(env.archive.exports).toHaveLength(1);
    expect(env.archive.exports[0]!.startsWith(`${AUTO_BACKUP_TEMP_DIR}/auto_backup_`)).toBe(true);
    expect(text(host, 'auto_backup_last_result')).toBe('已备份 1 本书');
    expect(await env.runtime.folder()).toBe(AUTO_BACKUP_FOLDER);
    expect((await env.fs.list(AUTO_BACKUP_FOLDER)).length).toBe(1);
    // 临时文件在 `AutoBackup` 的 finally 里删掉（Kotlin L74）。
    expect(await env.fs.list(AUTO_BACKUP_TEMP_DIR)).toEqual([]);
  });

  it('③ 空书架 + 目录里有备份 ⇒ 出现恢复按钮，确认后走 REPLACE 导入', async () => {
    const env = await openEnv();
    await env.runtime.attachDefaultFolder();
    await env.fs.writeFile(`${AUTO_BACKUP_FOLDER}/${SNAPSHOT}`, strToU8('portable-archive'));
    setAutoBackupRuntime(env.runtime);
    const host = await mountSettings();
    await settle();

    const restore = buttonByText(host, '从自动备份恢复');
    expect(restore).not.toBeNull();

    await click(restore!);
    // 确认框（不用原生 `confirm`）：标题 + 文件名都在弹层里。
    expect(host.textContent).toContain(`将用「${SNAPSHOT}」覆盖当前书架`);

    const confirm = buttonByText(host, '恢复');
    expect(confirm).not.toBeNull();
    await click(confirm!);
    await settle(30);

    expect(env.archive.imports).toHaveLength(1);
    expect(env.archive.imports[0]!.mode).toBe('REPLACE');
    expect(env.archive.imports[0]!.path.startsWith(`${AUTO_BACKUP_TEMP_DIR}/auto_restore_`)).toBe(true);
    // Kotlin L803 `markRestoreOffered()` —— 恢复后不再提示。
    expect(await env.settings.getBoolean('auto_backup_restore_offered', false)).toBe(true);
    expect(buttonByText(host, '从自动备份恢复')).toBeNull();
  });

  it('无原生归档端口时显式失败：卡片显示错误文案，不假装成功', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await env.runtime.setEnabled(true);
    await env.runtime.attachDefaultFolder();
    env.archive.failWith = new Error('当前平台没有原生归档端口，无法自动备份');
    setAutoBackupRuntime(env.runtime);
    const host = await mountSettings();
    await settle();

    await click(buttonByText(host, '立即备份')!);

    expect(text(host, 'auto_backup_last_result')).toBe('当前平台没有原生归档端口，无法自动备份');
    expect(await env.settings.getString('auto_backup_last_result', '')).toBe(
      '当前平台没有原生归档端口，无法自动备份',
    );
    expect(await env.settings.getLong('auto_backup_last_at', 0)).toBe(0);
    expect(await env.fs.list(AUTO_BACKUP_FOLDER)).toEqual([]);
  });
});

describe('启动 / 回前台接线（App.tsx）', () => {
  it('④ 启动调用 runIfDue：满足条件备份一次', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await env.runtime.setEnabled(true);
    await env.runtime.attachDefaultFolder();
    setAutoBackupRuntime(env.runtime);

    await runAutoBackupIfDue();
    await settle();

    expect(env.archive.exports).toHaveLength(1);
    expect(env.archive.exports[0]!.startsWith(AUTO_BACKUP_TEMP_DIR)).toBe(true);
    expect(await env.settings.getLong('auto_backup_last_at', 0)).toBe(T0);
  });

  it('④-b 备份失败（归档抛错）不崩：折成失败结果，lastSuccessAt 不动', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await env.runtime.setEnabled(true);
    await env.runtime.attachDefaultFolder();
    env.archive.failWith = new Error('原生归档不可用');
    setAutoBackupRuntime(env.runtime);

    await expect(runAutoBackupIfDue()).resolves.toEqual({ ok: false, message: '原生归档不可用' });
    expect(await env.settings.getLong('auto_backup_last_at', 0)).toBe(0);
  });

  it('④-c runIfDue 自身抛错时按 runCatching 吞掉并 console.warn', async () => {
    class ThrowingRuntime extends AutoBackupRuntime {
      override async runIfDue(): Promise<never> {
        throw new Error('本地存储不可用');
      }
    }
    const env = await openEnv();
    const throwing = new ThrowingRuntime({
      db: env.db,
      fs: env.fs,
      settings: env.settings,
      archive: env.archive,
    });
    setAutoBackupRuntime(throwing);

    const warn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      await expect(runAutoBackupIfDue()).resolves.toBeNull();
    } finally {
      console.warn = warn;
    }
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain('[auto-backup]');
  });

  it('⑤ 距上次成功不足 12h 不重复备份，满 12h 才再备一次', async () => {
    const env = await openEnv();
    await addBook(env.db);
    await env.runtime.setEnabled(true);
    await env.runtime.attachDefaultFolder();
    await env.settings.setLong('auto_backup_last_at', T0);
    setAutoBackupRuntime(env.runtime);

    env.clock.value = T0 + INTERVAL - 1;
    await runAutoBackupIfDue();
    expect(env.archive.exports).toHaveLength(0);

    env.clock.value = T0 + INTERVAL;
    await runAutoBackupIfDue();
    expect(env.archive.exports).toHaveLength(1);

    // 再回前台一次：仍在同一个 12h 窗口内，不重复备份。
    env.clock.value = T0 + INTERVAL + 60_000;
    await runAutoBackupIfDue();
    expect(env.archive.exports).toHaveLength(1);
  });
});
