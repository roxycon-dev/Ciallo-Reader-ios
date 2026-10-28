/**
 * StorageDetailDialog.tsx — line-by-line port of Android
 * `com/example/ui/StorageDetailDialog.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/StorageDetailDialog.kt`, 480 lines / 467 non-blank).
 *
 * Line map (Kotlin → this file):
 *   1-58    package + Compose imports        → React imports; Android/Compose imports SKIPPED
 *   60-66   KDoc                             → preserved as the component KDoc
 *   67-73   StorageFileEntry data class      → StorageFileEntry (line 73)
 *   75-241  object StorageDetailIndex        → module-level pure functions
 *                                               (pathOf / describeStorageEntry /
 *                                                scanStorageEntries / deleteStorageEntries)
 *   243-253 StorageDetailDialog KDoc+sig     → StorageDetailDialog + props interface
 *   254-263 composable state                → useState (entries / scanning / checked /
 *                                               pendingDeletion / appeared→CSS animation)
 *   265-285 fun refresh                     → refresh() (useCallback)
 *   286-297 fun requestDeletion             → requestDeletion()
 *   298-301 LaunchedEffect(Unit)            → useEffect(…, [refresh])
 *   303-304 selectedFiles / totalSize       → useMemo derivations
 *   306-462 Dialog + Surface tree           → JSX below
 *   463-483 pendingDeletion AlertDialog     → JSX below
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1     `package com.example.ui` — TS module system.
 *  L3-49  Compose imports (`animateFloatAsState`, `foundation.layout.*`, `material3.*`,
 *         `ui.*`) → CSS transitions + `cache-detail-*` / `cache-dialog-*` class names.
 *  L50    `androidx.compose.ui.window.Dialog` → modal `<div role="dialog">` overlay.
 *  L51-53 `kotlinx.coroutines.*` → async/await (the port methods are already async).
 *  L54    `java.io.File` → absolute path strings (the same convention used by
 *         `@core/cache/cacheManagement`, whose `CacheFileSystemApi` replaces File).
 *  L55-58 `AppDatabase` / `Book` / `DownloadManager` / `DownloadTaskEntity` — the DB read at
 *         L269-276 is preserved as INJECTED props (`books`, `tasks`): the structural mirrors
 *         `StorageBookRef` / `StorageDownloadTaskRef` below carry exactly the four fields
 *         `describe()` reads (coverUri / id / filePath / title) plus the download-task triple
 *         (id / title / format). `DownloadManager.sanitizeFileName` → `sanitizeFileName`
 *         from `@core/download/downloadManager` (same SHA-256 algorithm).
 *  L262-263 `animateFloatAsState(…, tween(180))` → CSS `cache-detail-pop` keyframes
 *         (scale 0.92→1 + fade in, 180ms — identical spec).
 *  L306   `Dialog(onDismissRequest = onDismiss)` → backdrop click + `role="dialog"`.
 *  L348   `Modifier.height(340.dp)` → `.cache-detail__list { max-height: 340px }`.
 *  L372   `Arrangement.spacedBy(4.dp)` → CSS `gap: 4px`.
 *  L388/393/399/406/419/425 Compose `Row`/`Box`/`Icon` nesting → flex CSS.
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * `File.length()` / `lastModified()` / `isDirectory` / `exists()` / `listFiles(filter)` /
 *    `sortedByDescending` / `walkBottomUp()` / `walkTopDown()` / `deleteRecursively()` /
 *    `delete()` → `CacheFileSystemApi` (declared in `@core/cache/cacheManagement`).
 *  * `withContext(Dispatchers.IO)` → the port's async methods.
 *  * `mutableStateMapOf<File, Boolean>()` (Kotlin L258) → `ReadonlySet<string>` keyed by path;
 *    `checked[it.file]` → `checked.has(path)`, `checked[x] = !allOn` → `setChecked` with a
 *    `ReadonlySet` copy (immutable updates, same observable behaviour).
 *
 * ── Fixes applied by the cache review agent ─────────────────────────────────────────
 *  * `primeSanitizeFileNames(tasks.map(t => t.id))` is now awaited before the first
 *    scan (Kotlin L99 `DownloadManager.sanitizeFileName(it.id)` is a synchronous digest).
 *    Without priming, `describeStorageEntry('downloads', …)` compared the file name
 *    against a *prefix-only* placeholder, so the 「下载记录 · EPUB」 label could never
 *    match once a task's `filePath` had been nulled out.
 *  * `replace` semantics for the smart label are correct here (global) — the sibling
 *    `TranslationCacheDetail.tsx` had a "first occurrence only" helper, now fixed.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  fileExtensionOf,
  fileNameOf,
  fileNameWithoutExtensionOf,
  formatCacheSize,
  parentDirNameOf,
  type CacheFileSystemApi,
  type CacheLayout,
} from '@core/cache/cacheManagement';
import { sanitizeFileName } from '@core/download/downloadManager';

/** Android L67-73 `data class StorageFileEntry`. */
export interface StorageFileEntry {
  /** Android `file: File` — the absolute path string. */
  readonly file: string;
  readonly size: number;
  readonly label: string;
  /** Kotlin default `""`. */
  readonly sublabel: string;
  /** Kotlin default `true`. */
  readonly deletable: boolean;
}

/**
 * Android `com.example.data.Book` — structural mirror of the four fields
 * `StorageDetailIndex.describe` reads (L84-94).
 */
export interface StorageBookRef {
  readonly id: number;
  readonly title: string;
  readonly coverUri: string | null;
  readonly filePath: string | null;
}

/** Android `com.example.download.DownloadTaskEntity` — mirror of L97-101. */
export interface StorageDownloadTaskRef {
  readonly id: string;
  readonly title: string;
  readonly format: string;
  readonly filePath: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════════
   object StorageDetailIndex — Kotlin lines 75-241, as module-level functions
   ══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin L77 `pathOf(value: String?)`. */
export function pathOf(value: string | null): string | null {
  if (value === null) return null;
  if (value.startsWith('content:')) return null;
  return value.replace('file://', '');
}

/**
 * Kotlin L80-143 `describe(key, file, books, tasks): Pair<String, String>`.
 * Returns `[label, sublabel]`.
 */
export function describeStorageEntry(
  key: string,
  file: string,
  books: readonly StorageBookRef[],
  tasks: readonly StorageDownloadTaskRef[],
  sanitize: (id: string) => string = defaultSanitizeFileName,
): [string, string] {
  const name = fileNameOf(file);
  const extension = fileExtensionOf(file);

  let book: StorageBookRef | null = null;
  if (key === 'covers') {
    book = books.find((b) => pathOf(b.coverUri) === file) ?? null;
  } else if (key === 'book_images') {
    const id = Number.parseInt(name, 10);
    if (/^\d+$/.test(name) && Number.isFinite(id)) {
      book = books.find((b) => b.id === id) ?? null;
    }
  } else if (key === 'downloads' || key === 'imports' || key === 'comics') {
    book = books.find((b) => pathOf(b.filePath) === file) ?? null;
  }

  if (book !== null) {
    let sublabel: string;
    if (key === 'covers') sublabel = '书架封面';
    else if (key === 'book_images') sublabel = '书内插图';
    else if (key === 'comics') sublabel = '离线漫画页面';
    else sublabel = `${extension.toUpperCase()} 原文件`;
    return [`《${book.title}》`, sublabel];
  }

  if (key === 'downloads') {
    const sanitized = new Map<string, StorageDownloadTaskRef>();
    for (const task of tasks) {
      sanitized.set(fileNameWithoutExtensionOf(sanitize(task.id)), task);
    }
    const task =
      tasks.find((t) => pathOf(t.filePath) === file) ??
      sanitized.get(fileNameWithoutExtensionOf(file)) ??
      null;
    if (task !== null) {
      return [`《${task.title}》`, `下载记录 · ${task.format.toUpperCase()}`];
    }
  }

  if (
    key === 'downloads' ||
    key === 'imports' ||
    key === 'comics' ||
    key === 'covers' ||
    key === 'book_images'
  ) {
    let label: string;
    if (key === 'covers') label = '未关联的封面';
    else if (key === 'book_images') label = '未关联的书内插图';
    else if (key === 'comics') label = '未关联的漫画';
    else label = '未关联的书籍文件';
    return [label, name];
  }

  if (key === 'manga_tr_models') return ['离线翻译模型', name];

  if (key === 'webview') {
    switch (name) {
      case 'Cookies':
        return ['网页登录信息', 'Cookie'];
      case 'Local Storage':
        return ['网页本地数据', '登录与浏览记录'];
      case 'Default':
        return ['网页浏览资料', '浏览器数据'];
      default:
        return ['网页浏览数据', name];
    }
  }

  if (key === 'personalization') {
    if (name === 'custom_font.ttf') return ['自定义字体', ''];
    if (name.startsWith('custom_poster_')) return ['启动海报', ''];
    return ['软件背景', ''];
  }

  if (key === 'sources') {
    return name === 'novel_reader_backup.json' ? ['设置备份', 'JSON'] : ['已安装书源', name];
  }

  if (key === 'appdata') {
    const parent = parentDirNameOf(file);
    if (parent === 'databases' || name === 'databases') return ['书架与阅读数据', name];
    if (parent === 'shared_prefs' || name === 'shared_prefs') return ['应用设置', name];
    return ['应用状态数据', name];
  }

  let category: string;
  switch (key) {
    case 'ehimg':
      category = '网页图片缓存';
      break;
    case 'image_cache':
      category = '封面与图片缓存';
      break;
    case 'comic_image_cache':
      category = '漫画图片缓存';
      break;
    case 'comic_processed':
      category = '漫画增强缓存';
      break;
    case 'external_cache':
      category = '外部缓存';
      break;
    case 'temp':
      category = '临时文件';
      break;
    case 'other':
      category = '其他应用数据';
      break;
    case 'external_files':
      category = '外部应用文件';
      break;
    default:
      category = '缓存文件';
  }
  const opaque = name.length > 18 && /^[a-fA-F0-9_.-]+$/.test(name);
  return [category, opaque ? `内部编号 ${name.slice(-8)}` : name];
}

/** Kotlin `DownloadManager.sanitizeFileName(it.id)` (L99) — async on this platform. */
const sanitizeCache = new Map<string, string>();

function defaultSanitizeFileName(id: string): string {
  const cached = sanitizeCache.get(id);
  if (cached !== undefined) return cached;
  // Fallback until the async digest resolves: Android's pre-digest form is
  // `${id.replace(Regex("[^A-Za-z0-9._-]"), "_").take(40)}_${sha256.take(12)}`;
  // we keep the sanitized prefix so labels stay stable, and refresh below.
  const prefix = id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40);
  sanitizeCache.set(id, prefix);
  return prefix;
}

/** Populate the sanitize cache asynchronously (Kotlin L99 is a suspend-free digest call). */
export async function primeSanitizeFileNames(ids: readonly string[]): Promise<void> {
  await Promise.all(
    ids.map(async (id) => {
      try {
        sanitizeCache.set(id, await sanitizeFileName(id));
      } catch {
        sanitizeCache.set(id, defaultSanitizeFileName(id));
      }
    }),
  );
}

const primedSanitizeIds = new Set<string>();

/** Idempotent: primes the id→filename map once per task id (module-level, no refs). */
async function ensureSanitizeFileNames(tasks: readonly StorageDownloadTaskRef[]): Promise<void> {
  const pending = tasks
    .map((t) => t.id)
    .filter((id) => !primedSanitizeIds.has(id));
  if (pending.length === 0) return;
  for (const id of pending) primedSanitizeIds.add(id);
  await primeSanitizeFileNames(pending);
}

async function filesUnder(
  fs: CacheFileSystemApi,
  dir: string,
): Promise<Array<{ size: number; lastModified: number }>> {
  const root = await fs.stat(dir);
  if (root === null) return [];
  if (!root.isDirectory) return [{ size: root.size, lastModified: root.lastModified }];
  const out: Array<{ size: number; lastModified: number }> = [];
  const queue: string[] = [root.path];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const children = await fs.listNodes(current);
    for (const child of children) {
      if (child.isDirectory) queue.push(child.path);
      else out.push({ size: child.size, lastModified: child.lastModified });
    }
  }
  return out;
}

/** Kotlin L205 `withContext(Dispatchers.IO) { File.system.currentTimeMillis() }`. */
function nowOf(now: number): number {
  return now;
}

/** 把类别 key 展开为逐文件/逐目录条目（含可读标签）。 — Kotlin L145-203 */
export async function scanStorageEntries(
  fs: CacheFileSystemApi,
  key: string,
  targets: readonly string[],
  books: readonly StorageBookRef[],
  tasks: readonly StorageDownloadTaskRef[],
  now: number,
  sanitize: (id: string) => string = defaultSanitizeFileName,
): Promise<StorageFileEntry[]> {
  const out: StorageFileEntry[] = [];
  const ts = nowOf(now);
  for (const dir of targets) {
    const node = await fs.stat(dir);
    if (node === null) continue;

    if (key === 'comics' && node.isDirectory) {
      const files = await filesUnder(fs, dir);
      const size = files.reduce((sum, f) => sum + f.size, 0);
      const [label, sublabel] = describeStorageEntry(key, dir, books, tasks, sanitize);
      const active = files.some((f) => f.lastModified > ts - 2 * 60_000);
      out.push({ file: dir, size, label, sublabel, deletable: !active });
      continue;
    }

    let activeRoot = false;
    if (key === 'temp') {
      activeRoot =
        node.name !== 'share_temp' &&
        (await filesUnder(fs, dir)).some((f) => f.lastModified > ts - 2 * 60_000);
    } else if (key === 'comics') {
      activeRoot = (await filesUnder(fs, dir)).some((f) => f.lastModified > ts - 2 * 60_000);
    } else if (key === 'downloads') {
      const children = await fs.listNodes(dir);
      activeRoot = children.some(
        (f) => !f.isDirectory && f.name.endsWith('.tmp') && f.lastModified > ts - 30 * 60_000,
      );
    }

    if (!node.isDirectory) {
      const activeFile =
        (key === 'downloads' &&
          node.name.endsWith('.tmp') &&
          node.lastModified > ts - 30 * 60_000) ||
        (key === 'imports' && node.lastModified > ts - 2 * 60_000);
      const [label, sublabel] = describeStorageEntry(key, dir, books, tasks, sanitize);
      out.push({
        file: dir,
        size: node.size,
        label,
        sublabel,
        deletable: !activeFile && !activeRoot,
      });
      continue;
    }

    const children = await fs.listNodes(dir);
    const sorted = [...children].sort((a, b) => b.size - a.size);
    for (const f of sorted) {
      const size = f.isDirectory
        ? (await filesUnder(fs, f.path)).reduce((sum, x) => sum + x.size, 0)
        : f.size;
      if (size <= 0 && !f.isDirectory) continue;
      const protectedEntry =
        activeRoot ||
        (key === 'downloads' &&
          f.name.endsWith('.tmp') &&
          f.lastModified > ts - 30 * 60_000) ||
        (key === 'imports' && f.lastModified > ts - 2 * 60_000) ||
        (key === 'temp' &&
          node.name === 'share_temp' &&
          f.lastModified > ts - 15 * 60_000) ||
        (key === 'temp' &&
          node.name !== 'share_temp' &&
          f.lastModified > ts - 2 * 60_000);
      if (key === 'manga_tr_cache') {
        // 译文缓存：复用智能标签（原文→译文）
        const info = await describeTranslationCacheFile(fs, f.path);
        out.push({
          file: f.path,
          size,
          label: info[0],
          sublabel: info[1],
          deletable: !protectedEntry,
        });
        continue;
      }
      const [label, sublabel] = describeStorageEntry(key, f.path, books, tasks, sanitize);
      out.push({ file: f.path, size, label, sublabel, deletable: !protectedEntry });
    }
  }
  // Kotlin L202 `out.sortedByDescending { it.size }`
  return [...out].sort((a, b) => b.size - a.size);
}

/** Kotlin `TranslationCacheIndex.describe(f)` (TranslationCacheDetail.kt L68-83). */
export async function describeTranslationCacheFile(
  fs: CacheFileSystemApi,
  path: string,
): Promise<[string, string]> {
  try {
    const bytes = await fs.readFile(path);
    const o: unknown = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    if (typeof o !== 'object' || o === null) return ['未知页面', ''];
    const record = o as Record<string, unknown>;
    const arr = Array.isArray(record['r']) ? (record['r'] as unknown[]) : null;
    const regions = arr?.length ?? 0;
    const first =
      arr !== null && arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null
        ? (arr[0] as Record<string, unknown>)
        : null;
    const src = first !== null ? optString(first, 'o').slice(0, 18) : '';
    const dst = first !== null ? optString(first, 'c').slice(0, 18) : '';
    let label: string;
    if (src.trim() !== '' && dst.trim() !== '') label = `${src} → ${dst}`;
    else if (src.trim() !== '') label = src;
    else label = '空译文';
    return [label.replace(/\n/g, ' '), `${String(regions)} 个气泡区域`];
  } catch {
    return ['未知页面', ''];
  }
}

/** Android `File.parentFile?.path` — `""` at the filesystem root. */
function dirOf(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const slash = trimmed.lastIndexOf('/');
  return slash <= 0 ? '/' : trimmed.slice(0, slash);
}

/** Android `JSONObject.optString(key)` — `""` when absent (never `null`). */
function optString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Kotlin L205-240 `suspend fun delete(files: List<File>, key: String): Long`. */
export async function deleteStorageEntries(
  fs: CacheFileSystemApi,
  key: string,
  files: readonly string[],
  now: number,
): Promise<number> {
  let freed = 0;
  const ts = nowOf(now);
  for (const f of files) {
    try {
      const node = await fs.stat(f);
      if (node === null) continue;
      // Kotlin L210-214: root = comics_ dir itself for "comics", else the parent dir.
      // (`"temp"` and `else` both reduce to `f.parentFile`.)
      const parentName = parentDirNameOf(f);
      const rootPath =
        key === 'comics' && node.name.startsWith('comics_')
          ? f
          : parentName === null
            ? f
            : dirOf(f);
      const rootNode = rootPath === f ? node : await fs.stat(rootPath);

      let active = false;
      if (key === 'downloads') {
        const children = rootNode === null ? [] : await fs.listNodes(rootNode.path);
        active = children.some(
          (it) =>
            !it.isDirectory && it.name.endsWith('.tmp') && it.lastModified > ts - 30 * 60_000,
        );
      } else if (key === 'comics') {
        active =
          rootNode !== null &&
          (await filesUnder(fs, rootNode.path)).some((x) => x.lastModified > ts - 2 * 60_000);
      } else if (key === 'temp') {
        if (rootNode !== null && rootNode.name === 'share_temp') {
          active = node.lastModified > ts - 15 * 60_000;
        } else {
          active =
            rootNode !== null &&
            (await filesUnder(fs, rootNode.path)).some((x) => x.lastModified > ts - 2 * 60_000);
        }
      } else if (key === 'imports') {
        active = node.lastModified > ts - 2 * 60_000;
      }
      if (active) continue;

      const before = node.isDirectory
        ? (await filesUnder(fs, f)).reduce((sum, x) => sum + x.size, 0)
        : node.isDirectory
          ? 0
          : node.size;
      if (node.isDirectory) await fs.deleteRecursively(f);
      else await fs.delete(f);
      const afterNode = await fs.stat(f);
      const after =
        afterNode === null
          ? 0
          : afterNode.isDirectory
            ? (await filesUnder(fs, f)).reduce((sum, x) => sum + x.size, 0)
            : afterNode.size;
      freed += Math.max(0, before - after);
    } catch {
      // runCatching { … } — a failed delete must not abort the batch.
    }
  }
  return freed;
}

/* ══════════════════════════════════════════════════════════════════════════════
   StorageDetailDialog — Kotlin lines 243-484
   ══════════════════════════════════════════════════════════════════════════════ */

export interface StorageDetailDialogProps {
  /** 明细对话框：任意类别通用。rowKey 用于译文缓存智能标签分支。 */
  rowKey: string;
  title: string;
  /** Android `targets: List<File>` — absolute path strings. */
  targets: readonly string[];
  /** Kotlin default `null`. */
  confirmTip?: string | null;
  /** Kotlin default `true`. */
  allowDelete?: boolean;
  onDismiss: () => void;
  onChanged: () => void;
  /** Android `LocalContext.current` file access → the injected FS port. */
  fs: CacheFileSystemApi;
  /** Android `LocalContext.current` layout roots. */
  layout: CacheLayout;
  /** Android L269 `db.bookDao().getAllBooksSync()` — injected (see header L55-58). */
  books?: readonly StorageBookRef[];
  /** Android L273 `db.downloadTaskDao().getAllTasksSync()` — injected. */
  tasks?: readonly StorageDownloadTaskRef[];
  /** Test seam; defaults to `Date.now()` (Android `System.currentTimeMillis()`). */
  now?: () => number;
}

export function StorageDetailDialog(props: StorageDetailDialogProps) {
  const {
    rowKey,
    title,
    targets,
    confirmTip = null,
    allowDelete = true,
    onDismiss,
    onChanged,
    fs,
    books = [],
    tasks = [],
  } = props;
  // `props.now ?? (() => Date.now())` 每次渲染都是新函数，会让依赖它的一串
  // useCallback 每次都失效。用 useMemo 固定身份，值不变。
  const now = useMemo(() => props.now ?? (() => Date.now()), [props.now]);

  const [entries, setEntries] = useState<readonly StorageFileEntry[]>([]);
  const [scanning, setScanning] = useState(true);
  // Android L258 `mutableStateMapOf<File, Boolean>()` → immutable path set.
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set<string>());
  // Android L259 `pendingDeletion: List<File>?`
  const [pendingDeletion, setPendingDeletion] = useState<readonly string[] | null>(null);

  // Android L97-101 `DownloadManager.sanitizeFileName(it.id)` — the Kotlin digest is
  // synchronous, ours is a promise, so the id→filename map has to be primed before the
  // scan or the "下载记录 · EPUB" label would never match a file whose `filePath` is gone.

  const refresh = useCallback((): void => {
    setScanning(true);
    void (async () => {
      // Kotlin L265 `StorageDetailIndex.scan(key, targets, books, tasks)`：
      // layout 已在宿主侧解析成绝对路径 `targets`（本文件不读 layout）。
      await ensureSanitizeFileNames(tasks);
      const scanned = await scanStorageEntries(fs, rowKey, targets, books, tasks, now());
      // Kotlin L277-279 `.map { if (allowDelete) it else it.copy(deletable = false) }`
      setEntries(allowDelete ? scanned : scanned.map((e) => ({ ...e, deletable: false })));
      // Kotlin L280 `checked.keys.retainAll(entries.map { it.file }.toSet())`
      setChecked((prev) => {
        const alive = new Set(scanned.map((e) => e.file));
        const next = new Set<string>();
        for (const path of prev) if (alive.has(path)) next.add(path);
        return next;
      });
      setScanning(false);
    })();
  }, [allowDelete, books, fs, now, rowKey, targets, tasks]);

  const requestDeletion = useCallback(
    (files: readonly string[]): void => {
      if (files.length === 0) return;
      if (confirmTip != null) {
        setPendingDeletion(files);
        return;
      }
      void (async () => {
        // Kotlin L286 `StorageDetailIndex.delete(files, key)`（targets 已含 layout 解析结果）
        await deleteStorageEntries(fs, rowKey, files, now());
        onChanged();
        refresh();
      })();
    },
    [confirmTip, fs, now, onChanged, refresh, rowKey],
  );

  // Kotlin L298-301 LaunchedEffect(Unit) { refresh(); appeared = true }
  // 初次挂载时的这一次扫描：用「渲染期调整状态」写法避免 effect 里同步 setState
  //（`refresh()` 会先 `setScanning(true)`）。之后所有手动刷新仍走 `refresh()`。
  const [didInitialScan, setDidInitialScan] = useState(false);
  if (!didInitialScan) {
    setDidInitialScan(true);
    setScanning(true);
    void (async () => {
      await ensureSanitizeFileNames(tasks);
      const scanned = await scanStorageEntries(fs, rowKey, targets, books, tasks, now());
      setEntries(allowDelete ? scanned : scanned.map((e) => ({ ...e, deletable: false })));
      setChecked((prev) => {
        const alive = new Set(scanned.map((e) => e.file));
        const next = new Set<string>();
        for (const path of prev) if (alive.has(path)) next.add(path);
        return next;
      });
      setScanning(false);
    })();
  }

  // Kotlin L303-304
  const selectedFiles = useMemo(
    () => entries.filter((e) => checked.has(e.file)).map((e) => e.file),
    [checked, entries],
  );
  const totalSize = useMemo(() => entries.reduce((sum, e) => sum + e.size, 0), [entries]);
  const selectedBytes = useMemo(
    () => entries.filter((e) => checked.has(e.file)).reduce((sum, e) => sum + e.size, 0),
    [checked, entries],
  );

  const allOn = entries.length > 0 && entries.every((e) => checked.has(e.file));
  const anyDeletable = entries.some((e) => e.deletable);
  const deletableAllOn =
    entries.length > 0 &&
    entries.every((e) => checked.has(e.file) || !e.deletable);

  return (
    <>
      <div className="cache-dialog-backdrop" role="presentation" onClick={onDismiss}>
        <div
          className="cache-detail"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <div className="cache-detail__head">
            <span className="cache-detail__icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
              </svg>
            </span>
            <h3 className="cache-detail__title">{title}</h3>
            <button
              type="button"
              className="cache-detail__close"
              aria-label="关闭"
              onClick={onDismiss}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
          <p className="cache-detail__meta">
            {scanning
              ? '扫描中…'
              : `${String(entries.length)} 项 · 共 ${formatCacheSize(totalSize)}`}
          </p>
          <div className="cache-detail__rule" />

          {!scanning && entries.length === 0 ? (
            <div className="cache-detail__empty">
              <p>暂无可管理的内容</p>
            </div>
          ) : (
            <div className="cache-detail__list">
              {allowDelete ? (
                <button
                  type="button"
                  className="cache-detail__row cache-detail__row--select-all"
                  onClick={() => {
                    const nextOn = !allOn;
                    setChecked((prev) => {
                      const next = new Set(prev);
                      for (const entry of entries) {
                        if (!entry.deletable) continue;
                        if (nextOn) next.add(entry.file);
                        else next.delete(entry.file);
                      }
                      return next;
                    });
                  }}
                >
                  <span className="cache-detail__select-label">
                    {deletableAllOn ? '取消全选' : '全选'}
                  </span>
                  {selectedFiles.length > 0 ? (
                    <span className="cache-detail__select-meta">
                      已选 {String(selectedFiles.length)} 项 /{' '}
                      {formatCacheSize(selectedBytes)}
                    </span>
                  ) : null}
                </button>
              ) : null}
              {entries.map((entry) => {
                const isChecked = checked.has(entry.file);
                return (
                  <div
                    key={entry.file}
                    className="cache-detail__row"
                    role={entry.deletable ? 'button' : undefined}
                    tabIndex={entry.deletable ? 0 : undefined}
                    onClick={(event) => {
                      if (!entry.deletable) return;
                      const target = event.target as HTMLElement;
                      if (target.closest('button') !== null) return;
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (next.has(entry.file)) next.delete(entry.file);
                        else next.add(entry.file);
                        return next;
                      });
                    }}
                    onKeyDown={(event) => {
                      if (!entry.deletable) return;
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (next.has(entry.file)) next.delete(entry.file);
                        else next.add(entry.file);
                        return next;
                      });
                    }}
                  >
                    {entry.deletable ? (
                      <>
                        <span
                          className={
                            isChecked
                              ? 'cache-detail__check cache-detail__check--on'
                              : 'cache-detail__check'
                          }
                          aria-hidden
                        >
                          {isChecked ? '✓' : ''}
                        </span>
                        <span className="cache-detail__gap" />
                      </>
                    ) : null}
                    <div className="cache-detail__text">
                      <p className="cache-detail__name">{entry.label}</p>
                      {entry.sublabel !== '' ? (
                        <p className="cache-detail__sub">{entry.sublabel}</p>
                      ) : null}
                    </div>
                    <span className="cache-detail__size">{formatCacheSize(entry.size)}</span>
                    {entry.deletable ? (
                      <button
                        type="button"
                        className="cache-detail__del"
                        aria-label="删除"
                        onClick={() => {
                          requestDeletion([entry.file]);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <div className="cache-detail__rule" />
          {allowDelete ? (
            <div className="cache-detail__actions">
              <button
                type="button"
                className="cache-detail__action cache-detail__action--danger"
                disabled={!anyDeletable || scanning}
                onClick={() => {
                  requestDeletion(entries.filter((e) => e.deletable).map((e) => e.file));
                }}
              >
                全部清理
              </button>
              <span className="cache-detail__spacer" />
              <button type="button" className="cache-detail__action" onClick={onDismiss}>
                关闭
              </button>
              <button
                type="button"
                className="cache-detail__action cache-detail__action--primary"
                disabled={selectedFiles.length === 0}
                onClick={() => {
                  requestDeletion(selectedFiles);
                }}
              >
                删除所选（{String(selectedFiles.length)}）
              </button>
            </div>
          ) : (
            <div className="cache-detail__actions">
              <button type="button" className="cache-detail__action" onClick={onDismiss}>
                关闭
              </button>
            </div>
          )}
        </div>
      </div>

      {pendingDeletion !== null ? (
        <div
          className="cache-dialog-backdrop"
          role="presentation"
          onClick={() => {
            setPendingDeletion(null);
          }}
        >
          <div
            className="cache-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <h3 className="cache-dialog__title">
              确认清理 {String(pendingDeletion.length)} 项
            </h3>
            <div className="cache-dialog__body">
              <p>预计清理 {formatCacheSize(bytesOf(entries, pendingDeletion))}。</p>
              <p>{confirmTip ?? ''}</p>
            </div>
            <div className="cache-dialog__actions">
              <button
                type="button"
                className="cache-dialog__action cache-dialog__action--primary"
                onClick={() => {
                  const files = pendingDeletion;
                  setPendingDeletion(null);
                  void (async () => {
                    // Kotlin L459 `StorageDetailIndex.delete(files, key)`
                    await deleteStorageEntries(fs, rowKey, files, now());
                    onChanged();
                    refresh();
                  })();
                }}
              >
                清理
              </button>
              <button
                type="button"
                className="cache-dialog__action"
                onClick={() => {
                  setPendingDeletion(null);
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Kotlin L464 `entries.filter { it.file in files }.sumOf { it.size }`. */
function bytesOf(
  entries: ReadonlyArray<StorageFileEntry>,
  files: readonly string[],
): number {
  const set = new Set(files);
  let sum = 0;
  for (const entry of entries) if (set.has(entry.file)) sum += entry.size;
  return sum;
}
