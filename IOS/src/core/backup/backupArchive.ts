/**
 * Backup archive build + restore validation + platform file I/O.
 * Pure readers stay injectable; ZIP read/write goes through FileSystemApi.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { FileSystemApi } from '@platform/interfaces';
import { ArchiveBudget, zipSlipSafeDestination } from '@core/data/archiveBudget';
import { replaceFilesPath } from './backupArchiveFormat';
import {
  BACKUP_HEADER,
  BACKUP_TABLES_ORDER,
  MAX_CONTENT_LENGTH,
  encodeRowLine,
} from './backupArchiveFormat';
import { isSafeSettingKey } from './safeSetting';

/**
 * Kotlin `BackupArchive.kt` L22-24 — the directories under `context.filesDir` that belong
 * to the user's own library and must travel with a backup. Mirrored verbatim so an iOS
 * export is byte-compatible with an Android one (same `files/<relative>` entry names).
 */
const OWNED_NAMES = new Set([
  'imports',
  'epub_images',
  'docx_images',
  'fb2_images',
  'mobi_images',
  'epub_covers',
  'fb2_covers',
  'mobi_covers',
  'comic_covers',
  'god_covers',
  'sample_comic',
  'chapter_catalogs',
]);

/** Kotlin `BackupArchive.kt` L24 `owned(name)`. */
export function isOwnedFilesDir(name: string): boolean {
  return (
    OWNED_NAMES.has(name) ||
    name.startsWith('comics_') ||
    name.startsWith('restored_') ||
    name.startsWith('custom_poster_') ||
    name.startsWith('custom_background_') ||
    name.startsWith('custom_app_bg_') ||
    name.startsWith('custom_font_')
  );
}

/** Kotlin `BackupArchive.kt` L69 — per-entry 512 MB cap. */
export const BACKUP_ENTRY_MAX_BYTES = 512 * 1024 * 1024;
/** Kotlin `BackupArchive.kt` L69 — running 4 GB total. */
export const BACKUP_TOTAL_MAX_BYTES = 4 * 1024 * 1024 * 1024;
/** Kotlin `BackupArchive.kt` L103 — `seen.size < 50_000`. */
export const BACKUP_ENTRY_MAX_COUNT = 50_000;

function joinPath(base: string, name: string): string {
  return base === '' ? name : `${base.replace(/\/+$/, '')}/${name}`;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Kotlin `BackupArchive.kt` L67-70 — per-file 512 MB cap and a 4 GB running total.
 * The exact Chinese message is copied from the Kotlin `require` there.
 */
interface ExportBudget {
  expanded: number;
}

function assertWithinBackupBudget(budget: ExportBudget, size: number): void {
  if (size > BACKUP_ENTRY_MAX_BYTES || budget.expanded + size > BACKUP_TOTAL_MAX_BYTES) {
    throw new Error('备份内容超过容量限制');
  }
  budget.expanded += size;
}

export interface BackupTableReader {
  selectAll(table: string): Promise<Array<Record<string, unknown>>>;
}

export interface SettingsSnapshot {
  getKeys(): string[];
  get(key: string): unknown;
}

export interface EncodedSetting {
  key: string;
  type: string;
  value: unknown;
}

export const BACKUP_ZIP_ROWS_ENTRY = 'database.rows';
export const BACKUP_ZIP_SETTINGS_ENTRY = 'settings.json';

export async function buildDatabaseRowsNdjson(
  reader: BackupTableReader,
  filesRoot: string,
): Promise<string> {
  const lines: string[] = [JSON.stringify(BACKUP_HEADER)];
  for (const table of BACKUP_TABLES_ORDER) {
    const rows = await reader.selectAll(table);
    for (const row of rows) {
      const encoded: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === 'string') {
          encoded[key] = replaceFilesPath(value, filesRoot);
        } else {
          encoded[key] = value;
        }
      }
      lines.push(encodeRowLine(table, encoded));
    }
  }
  return `${lines.join('\n')}\n`;
}

export function encodeSettingsPayload(entries: ReadonlyArray<EncodedSetting>): string {
  const obj: Record<string, { type: string; value: unknown }> = {};
  for (const entry of entries) {
    if (!isSafeSettingKey(entry.key)) continue;
    obj[entry.key] = { type: entry.type, value: entry.value };
  }
  return JSON.stringify(obj);
}

export function parseSettingsPayload(text: string): EncodedSetting[] {
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('备份设置内容损坏');
  }
  const out: EncodedSetting[] = [];
  for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isSafeSettingKey(key)) continue;
    if (typeof item !== 'object' || item === null) {
      throw new Error(`备份设置项损坏: ${key}`);
    }
    const rec = item as { type?: unknown; value?: unknown };
    if (typeof rec.type !== 'string' || !('value' in rec)) {
      throw new Error(`备份设置项损坏: ${key}`);
    }
    out.push({ key, type: rec.type, value: rec.value });
  }
  return out;
}

/**
 * 2026-10-11（E79 接线）：`writeBackupArchive` / `readBackupArchive` 拆出**字节层**的
 * `buildBackupArchiveBytes` / `readBackupArchiveBytes`。Kotlin `BackupManager.exportBackupJson`
 * （BackupManager.kt L50-55）把 `exportBackupArchive` 产出的 ZIP 读成字节后 base64 进 JSON
 * 信封，全程在内存里，不经过第二次落盘；信封恢复（L87-88）也是先解 base64 得到 ZIP 字节再走
 * `restoreBackupArchive`。拆出字节层后 BackupService 可以在不落临时文件的情况下完成同样的流程。
 * 字节层与落盘层产出**同一个**归档（database.rows + settings.json + files/**，含 owned 资产）。
 */
export async function buildBackupArchiveBytes(
  fs: FileSystemApi,
  databaseRows: string,
  settingsJson: string,
  filesRoot = '',
): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {
    [BACKUP_ZIP_ROWS_ENTRY]: strToU8(databaseRows),
    [BACKUP_ZIP_SETTINGS_ENTRY]: strToU8(settingsJson),
  };
  // 缺口 A (E12): Android packs the user's own file assets under `files/` so that
  // "Android backup → iOS restore" does not silently drop imported books / covers / images.
  const ownedFiles = await collectOwnedFiles(fs, filesRoot);
  for (const [name, data] of ownedFiles) {
    entries[name] = data;
  }
  return zipSync(entries);
}

export async function writeBackupArchive(
  fs: FileSystemApi,
  path: string,
  databaseRows: string,
  settingsJson: string,
  filesRoot = '',
): Promise<void> {
  const bytes = await buildBackupArchiveBytes(fs, databaseRows, settingsJson, filesRoot);
  await fs.writeFile(path, bytes);
}

/**
 * Gap A (E12) — Kotlin `BackupArchive.export` L81-87. Walk the `owned()` directories under
 * `filesRoot` and pack every regular file into a `files/<relativePath>` ZIP entry:
 *   - the relative path matches the `filesDir` prefix that was substituted with `@FILES@`
 *     in the DB rows / settings (so a restore can re-localise them on the target device);
 *   - `.part` / `.tmp` temp files are skipped (L85);
 *   - every path is required to stay under `filesRoot` (L84 canonical-path safety);
 *   - per-file 512 MB and running 4 GB caps (L69).
 * Returns an empty map when no `filesRoot` is configured.
 */
async function collectOwnedFiles(
  fs: FileSystemApi,
  filesRoot: string,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  if (filesRoot === '') return out;
  const rootNorm = normalizePath(filesRoot);
  const budget: ExportBudget = { expanded: 0 };
  const top = await fs.list(filesRoot);
  for (const name of top) {
    if (!isOwnedFilesDir(name)) continue;
    await walkOwnedFile(fs, joinPath(filesRoot, name), rootNorm, budget, out);
  }
  return out;
}

async function walkOwnedFile(
  fs: FileSystemApi,
  path: string,
  rootNorm: string,
  budget: ExportBudget,
  out: Map<string, Uint8Array>,
): Promise<void> {
  const children = await fs.list(path);
  if (children.length === 0) {
    // Leaf: a regular file, or an empty directory. Probe with readFile to tell them apart.
    let data: Uint8Array;
    try {
      data = await fs.readFile(path);
    } catch {
      return; // empty directory / unreadable entry — nothing to archive
    }
    addOwnedFileEntry(path, data, rootNorm, budget, out);
    return;
  }
  for (const child of children) {
    await walkOwnedFile(fs, joinPath(path, child), rootNorm, budget, out);
  }
}

function addOwnedFileEntry(
  absPath: string,
  data: Uint8Array,
  rootNorm: string,
  budget: ExportBudget,
  out: Map<string, Uint8Array>,
): void {
  const base = absPath.split('/').pop() ?? absPath;
  // Kotlin L85: skip temp downloads.
  if (base.endsWith('.part') || base.endsWith('.tmp')) return;
  const norm = normalizePath(absPath);
  // Kotlin L84: require the file stays under filesDir.
  if (!norm.startsWith(`${rootNorm}/`)) {
    throw new Error('备份文件路径越界');
  }
  assertWithinBackupBudget(budget, data.length);
  const rel = norm.slice(rootNorm.length + 1);
  out.set(`files/${rel}`, data);
}

export async function readBackupArchive(
  fs: FileSystemApi,
  path: string,
): Promise<{ databaseRows: string; settingsJson: string; files: Map<string, Uint8Array> }> {
  // 2026-10-11（E79 接线）：落盘读取 → 字节解析。信封恢复路径拿到的是**解 base64 后的
  // ZIP 字节**（Kotlin L88 先 `archive.writeBytes(...)` 再走同一套 restore），所以解析
  // 逻辑必须能直接吃字节。
  return readBackupArchiveBytes(await fs.readFile(path));
}

export function readBackupArchiveBytes(
  bytes: Uint8Array,
): { databaseRows: string; settingsJson: string; files: Map<string, Uint8Array> } {
  // Kotlin `BackupArchive.restore` (BackupArchive.kt 99..113) reads the archive with a
  // `ZipInputStream`, i.e. **in central-directory order and one entry object at a
  // time**, so its duplicate guard sees every occurrence. fflate's returned object
  // collapses repeated names (last one wins), which would silently accept a
  // duplicate-entry archive Kotlin rejects with 「备份包含重复条目」. Collecting the
  // names through `unzipSync`'s `filter` — which the library invokes once per stored
  // entry, duplicates included — restores the ordered walk.
  const entryNames: string[] = [];
  const raw = unzipSync(bytes, {
    filter: (info) => {
      entryNames.push(info.name);
      // Always extract, so an entry whose compression method fflate cannot handle still
      // throws here instead of being silently treated as empty bytes.
      return true;
    },
  });
  // Kotlin L97: restore-side budget + entry bookkeeping.
  const budget = new ArchiveBudget(BACKUP_ENTRY_MAX_BYTES, BACKUP_TOTAL_MAX_BYTES, BACKUP_ENTRY_MAX_COUNT);
  const seen = new Set<string>();
  let rows: Uint8Array | undefined;
  let settings: Uint8Array | undefined;
  const files = new Map<string, Uint8Array>();
  for (const name of entryNames) {
    // Kotlin L103-104: entry name length cap, count cap, and duplicate rejection.
    if (name.length > 1024 || seen.size >= BACKUP_ENTRY_MAX_COUNT) {
      throw new Error('备份条目过多');
    }
    // NB: `Set.prototype.add` returns the *set* even when the value was already present
    // (that is the ECMAScript spec, not a quirk — `Map.prototype.set` behaves the same
    // way), so `if (!seen.add(name))` is always false. The presence has to be tested
    // explicitly; that bug made this guard dead code in every engine.
    if (seen.has(name)) {
      throw new Error('备份包含重复条目');
    }
    seen.add(name);
    // Kotlin L105: only the two metadata entries and `files/` assets are allowed.
    if (
      name !== BACKUP_ZIP_ROWS_ENTRY &&
      name !== BACKUP_ZIP_SETTINGS_ENTRY &&
      !name.startsWith('files/')
    ) {
      throw new Error('备份包含未知条目');
    }
    // Kotlin L106 + ArchiveBudget.destination: reject absolute paths and zip-slip escapes.
    // The archive root here is `files/` — an entry may only write *inside* the files
    // directory it came from. Passing `''` makes every relative path trivially "under"
    // the empty root, which silently disabled this check.
    zipSlipSafeDestination('files', name);
    // Kotlin L107 `if (!entry.isDirectory)`: a `files/` directory entry is allowed by the
    // whitelist but writes nothing.
    if (name.endsWith('/')) continue;
    const data = budget.copyEntry(raw[name] ?? new Uint8Array());
    if (name === BACKUP_ZIP_ROWS_ENTRY) rows = data;
    else if (name === BACKUP_ZIP_SETTINGS_ENTRY) settings = data;
    else files.set(name, data);
  }
  if (!rows || !settings) {
    throw new Error('备份包内容不完整');
  }
  // Kotlin L115: the settings blob is bounded on restore.
  if (settings.length > 1024 * 1024) {
    throw new Error('备份设置文件过大');
  }
  return {
    databaseRows: strFromU8(rows),
    settingsJson: strFromU8(settings),
    files,
  };
}

export function validateRestoreHeader(header: { version?: number; schema?: number }): void {
  if (header.version !== 1 || header.schema !== 12) {
    throw new Error('不支持的备份版本');
  }
}

export function validateRestoredRow(
  table: string,
  row: Record<string, unknown>,
  columns: Map<string, { type: string; notNull: boolean }>,
): void {
  if (table === 'chapters') {
    const content = row['content'];
    if (typeof content === 'string' && content.length > MAX_CONTENT_LENGTH) {
      throw new Error('备份章节超过存储安全限制');
    }
  }
  if (table === 'reading_records' || table === 'reading_sessions') {
    const duration = row['durationSeconds'];
    if (typeof duration === 'number' && duration < 0) {
      throw new Error('备份阅读时长为负');
    }
  }

  const names = Object.keys(row);
  const nameSet = new Set(names);
  if (nameSet.size !== columns.size) {
    throw new Error('备份列与数据库不一致');
  }
  for (const name of columns.keys()) {
    if (!nameSet.has(name)) {
      throw new Error('备份列与数据库不一致');
    }
  }

  for (const name of names) {
    const col = columns.get(name);
    if (!col) {
      throw new Error('备份列与数据库不一致');
    }
    const value = row[name];
    const isNull = value === null || value === undefined;
    if (isNull && col.notNull) {
      throw new Error('备份必填字段为空');
    }
    if (isNull) continue;
    if (col.type === 'TEXT') {
      if (typeof value !== 'string') {
        throw new Error('备份数据库字段类型错误');
      }
    } else if (col.type === 'INTEGER') {
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new Error('备份数据库字段类型错误');
      }
    } else if (col.type === 'REAL') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('备份数据库字段类型错误');
      }
    } else {
      throw new Error('备份数据库字段类型错误');
    }
  }
}
