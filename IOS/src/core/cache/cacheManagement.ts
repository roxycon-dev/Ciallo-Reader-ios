/**
 * cacheManagement.ts — line-by-line port of the pure logic inside Android
 * `com/example/ui/CacheManagementScreen.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/CacheManagementScreen.kt`, 903 lines / 865 non-blank).
 *
 * Line map (Kotlin → this file):
 *   1-71     imports / file annotations        → SKIPPED (Compose + Android framework imports; see list below)
 *   72-73    COVER_DIRS                        → COVER_DIRS
 *   75-88    StorageRow data class + zone doc  → StorageRow (+ zone documentation preserved verbatim)
 *   90-101   CacheManagementScreen KDoc        → CacheManagementScreenDoc (kept as comment on the file)
 *   102-120  composable state declarations     → ScanState shape (returned by scanStorage)
 *   121-140  B1 clear animation + totalAnim   → SKIPPED in core (Compose Animatable); the
 *                                               AnimatedValue/total-size roll lives in
 *                                               `CacheManagementPage.tsx` (CSS keyframes)
 *   142-147  fun formatSize                    → formatSize
 *   149-155  fun dirSize                       → dirSize(fs, target)
 *   157-160  fun newestFileTime                → newestFileTime(fs, target)
 *   162-175  fun hasActiveWrite                → hasActiveWrite(fs, layout, key, now)
 *   177-214  fun targetsFor                    → targetsFor(fs, layout, key)
 *   216-235  fun clearTargets                  → clearTargets(fs, layout, key, now)
 *   237-263  fun clearRow                      → clearRow(fs, layout, key)
 *   265-290  fun clearAllCache                 → clearAllCache(fs, layout)
 *   292-439  LaunchedEffect(scanTrigger) scan  → scanStorage(fs, layout)
 *   441      cacheTotal                        → zoneTotal(rows, 0) helper + returned row array
 *   443-454  detailRow + StorageDetailDialog   → SKIPPED in core (UI); dialog lives in
 *                                               `ui/components/cache/StorageDetailDialog.tsx`
 *   456-700  ModalBottomSheet UI               → SKIPPED in core (Compose tree);
 *                                               `ui/pages/CacheManagementPage.tsx`
 *   702-726  AlertDialog confirm               → SKIPPED in core (Compose dialog);
 *                                               `ui/pages/CacheManagementPage.tsx`
 *   729-766  segmentedBar                      → segmentedSegments() (pure widths/colors)
 *   768-787  ScanningSkeleton                  → SKIPPED in core (Compose Canvas/ShimmerBox);
 *                                               CSS in `styles/statistics.css`
 *   789-832  FileSweepIndicator                → SKIPPED in core (Compose Canvas);
 *                                               SVG in `ui/pages/CacheManagementPage.tsx`
 *   834-870  CleanSuccessBadge                 → SKIPPED in core (Compose Surface);
 *                                               `ui/pages/CacheManagementPage.tsx`
 *   872-905  AnimatedCheckMark                 → SKIPPED in core (Compose Canvas);
 *                                               SVG in `ui/pages/CacheManagementPage.tsx`
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1-4    `@file:OptIn(ExperimentalMaterial3Api, ExperimentalFoundationApi)` — Compose opt-in, no TS equivalent.
 *  L8-11   `android.os.StatFs/Build/Process/StorageManager` + `android.app.usage.StorageStatsManager`
 *          → replaced by the injected `CacheFileSystemApi.volumeStats()` /
 *            `packageStats()` port members (declared below).
 *  L13-28  Compose animation imports (`AnimatedVisibility`, `animateFloatAsState`, `Animatable`,
 *          `rememberInfiniteTransition`, `Canvas`, …) → CSS transitions / SVG in the page component.
 *  L29     `android.widget.Toast` → `showToast()` from `@ui/components/Toast`.
 *  L31-55  `androidx.compose.foundation.layout.*`, `material3.*`, `ui.*` → React + CSS.
 *  L46     `me.trishiraj.shadowglow.consistentShadow` → CSS `box-shadow` in the page component.
 *  L56-58  `AppIconButton` / `ShimmerBox` / `MintPrimary` → local SVG button + CSS shimmer.
 *  L59-66  `kotlinx.coroutines.*` + `java.io.File` + `java.util.Locale` → async/await + injected FS port.
 *  L67-68  `widthIn` / `AdaptiveSpec` → CSS `max-width` (values preserved below).
 *  L69-70  `DesignTokens` / `AppToast` → `DESIGN_TOKENS` / `showToast`.
 *  L107    `rememberCoroutineScope` → `useRef`-free async handlers in the page component.
 *  L110-119 Compose `remember { mutableStateOf(...) }` → React `useState`.
 *  L165    `System.currentTimeMillis()` → injected `now` argument (pure-function shape).
 *  L254/281 `MascotAnimationController.play(MascotEvent.CleanComplete)` → SKIPPED: the mascot
 *          animation subsystem (`ui/mascot/**`) is owned by another agent and has no TS port yet;
 *          the success badge itself is ported.
 *  L347/377/411/347 StatFs / StorageStatsManager / PackageManager introspection → port members.
 *  L363    `StorageStatsManager.queryStatsForPackage` → `packageStats()`.
 *  L472-424 (L422-424) `catch (e: CancellationException) throw e` → AbortError re-throw inside
 *          `scanStorage` (the `if (isActive)` guard becomes a `signal.aborted` check in the page).
 *  L545-560 `legend.forEach { ... }` → `.map()` over `legendSegments()` in the page component.
 *
 * ── Platform adaptations (documented inline at each site) ─────────────────────────
 *  * `java.io.File.length()` / `lastModified()` / `isDirectory` / `walkBottomUp()` /
 *    `walkTopDown()` / `deleteRecursively()` / `listFiles(filter)` → members of the injected
 *    `CacheFileSystemApi` (extends the existing `FileSystemApi` from `@platform/interfaces`).
 *  * `StatFs(filesDir.path).availableBytes/totalBytes` → `CacheFileSystemApi.volumeStats(path)`.
 *  * `StorageStatsManager.queryStatsForPackage(...)` → `CacheFileSystemApi.packageStats()`.
 *  * `context.applicationInfo.sourceDir` + `splitSourceDirs` →
 *    `CacheFileSystemApi.packageInstallPaths()`.
 *  * `withContext(Dispatchers.IO)` → plain `await` (the web/iOS platform ports are already async).
 *  * `scope.launch { … }` → the page component's async handlers.
 *
 * Android `File.length()` returns `Long`; `number` is used throughout (see
 * `src/core/data/importSafety.ts` for the same convention).
 */

/* ══════════════════════════════════════════════════════════════════════════════
   1. Injected ports — Android `java.io.File` + `StatFs` + `StorageStatsManager`
   ══════════════════════════════════════════════════════════════════════════════ */

import type { FileSystemApi } from '@platform/interfaces';

/** Android `java.io.File` facts the cache screen needs (stat snapshot). */
export interface CacheFsNode {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
  /** Android `File.length()` — bytes. 0 for directories. */
  readonly size: number;
  /** Android `File.lastModified()` — epoch ms. */
  readonly lastModified: number;
}

/** Android `StatFs` facts. */
export interface CacheVolumeStats {
  /** Android `StatFs.availableBytes`. */
  readonly freeBytes: number;
  /** Android `StatFs.totalBytes`. */
  readonly totalBytes: number;
}

/** Android `StorageStatsManager.queryStatsForPackage(...)` → `appBytes + dataBytes`. */
export interface CachePackageStats {
  readonly appBytes: number;
  readonly dataBytes: number;
}

/**
 * Android `Context.filesDir / cacheDir / dataDir` + the external dir families.
 * Mirrors the `Context` members CacheManagementScreen reads; `null` entries of
 * `getExternalFilesDirs(null)` / `externalCacheDirs` / `externalMediaDirs` are
 * already filtered out here (Android: `filterNotNull()`).
 */
export interface CacheLayout {
  readonly filesDir: string;
  readonly cacheDir: string;
  readonly dataDir: string;
  readonly externalCacheDirs: readonly string[];
  readonly externalFilesDirs: readonly string[];
  readonly externalMediaDirs: readonly string[];
}

/**
 * The `File.length()` / `StatFs` / `StorageStatsManager` port.
 *
 * Extends the shared `FileSystemApi` (read/write/exists/delete/list) with the
 * stat-shaped members the Android screen used directly. Implementations live in
 * `src/platform/web-mock` and `src/platform/ios-native`; core stays pure TS.
 */
export interface CacheFileSystemApi extends FileSystemApi {
  /** Android `File(path)` + `isDirectory`. `null` when the path does not exist. */
  stat(path: string): Promise<CacheFsNode | null>;
  /** Android `File(dir).listFiles()` — `[]` when the dir is missing (Android `?.listFiles() ?: …`). */
  listNodes(dir: string): Promise<CacheFsNode[]>;
  /** Android `File.deleteRecursively()`. */
  deleteRecursively(path: string): Promise<void>;
  /** Android `StatFs(path)` → availableBytes / totalBytes; `null` when unsupported. */
  volumeStats(path: string): Promise<CacheVolumeStats | null>;
  /** Android `StorageStatsManager.queryStatsForPackage(...)`; `null` when unsupported. */
  packageStats(): Promise<CachePackageStats | null>;
  /** Android `applicationInfo.sourceDir` + `splitSourceDirs` (distinct). */
  packageInstallPaths(): readonly string[];
}

/* ══════════════════════════════════════════════════════════════════════════════
   2. Constants — Kotlin lines 72-73 and the inline literals they gate
   ══════════════════════════════════════════════════════════════════════════════ */

/** 四类书籍封面目录（漫画/EPUB/FB2/MOBI 解析产物）。 */
export const COVER_DIRS: readonly string[] = [
  'comic_covers',
  'epub_covers',
  'fb2_covers',
  'mobi_covers',
];

/** Android `com.example.mangatranslate.TranslationCache.DIR_NAME`. */
export const TRANSLATION_CACHE_DIR = 'manga_translate_v1';
/** Android `com.example.mangatranslate.TranslateModelManager.modelDir()` subdir. */
export const TRANSLATION_MODEL_DIR = 'manga_translate_models';
/** Android `com.example.ui.comic.ComicPageLoader` processed-page cache dir. */
export const COMIC_PROCESSED_DIR = 'comic_processed_v1';
/** Android `com.example.source.js.JsSourceRepo.LOCAL_EXTRA_SOURCES` / index dir name. */
export const JS_SOURCES_DIR = 'js_sources';
/** Android `BackupManager` local backup file name. */
export const BACKUP_FILE = 'novel_reader_backup.json';
/** Android `PreferencesManager` custom font file name. */
export const CUSTOM_FONT_FILE = 'custom_font.ttf';
/** Android `custom_poster_*` prefix (startup poster). */
export const CUSTOM_POSTER_PREFIX = 'custom_poster_';
/** Android `custom_app_bg_*` prefix (app background image). */
export const CUSTOM_APP_BG_PREFIX = 'custom_app_bg_';

/**
 * Kotlin L185/L224: cache subdirectories that own their own entry point and must
 * never be swept by the "temp" bucket.
 */
export const CACHE_MANAGED_SUBDIRS: ReadonlySet<string> = new Set([
  'ehimg',
  'image_cache',
  'comic_image_cache',
  COMIC_PROCESSED_DIR,
  TRANSLATION_CACHE_DIR,
]);

/** Kotlin L197-198 `knownDirs` for the "other" bucket. */
const KNOWN_FILES_DIRS: ReadonlySet<string> = new Set([
  'downloads',
  'imports',
  'epub_images',
  'mobi_images',
  'fb2_images',
  'docx_images',
  JS_SOURCES_DIR,
  TRANSLATION_MODEL_DIR,
  ...COVER_DIRS,
]);

/** Kotlin L205 `dataDir.listFiles()` exclusion set for the "other" bucket. */
const KNOWN_DATA_DIRS: ReadonlySet<string> = new Set([
  'files',
  'cache',
  'databases',
  'shared_prefs',
  'no_backup',
  'app_webview',
  'lib',
]);

/** Kotlin L272 — keys touched by 一键清理 (one-tap clean). */
export const ONE_TAP_CACHE_KEYS: readonly string[] = [
  'ehimg',
  'image_cache',
  'comic_image_cache',
  'comic_processed',
  'external_cache',
  'temp',
];

/** Kotlin L656 `row.key in setOf("downloads", "imports", "comics", "covers")` (detail dialog first). */
export const DETAIL_FIRST_KEYS: ReadonlySet<string> = new Set([
  'downloads',
  'imports',
  'comics',
  'covers',
]);

/** Kotlin L609 `zoneMeta` — zone number → section title. */
export const ZONE_META: ReadonlyArray<readonly [number, string]> = [
  [0, '可清理缓存'],
  [1, '离线内容与个人文件'],
  [2, '应用与设置'],
];

/* ══════════════════════════════════════════════════════════════════════════════
   3. StorageRow — Kotlin lines 75-88
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * 存储行数据。zone 划分即安全模型：
 * 0=缓存（删除后自动重建，即时清理） 1=用户数据（不可再生或含状态，删除需确认） 2=应用核心数据（只读统计）
 */
export interface StorageRow {
  readonly key: string;
  readonly name: string;
  readonly desc: string;
  readonly size: number;
  readonly zone: number;
  readonly deletable: boolean;
  /** Kotlin default `null`. */
  readonly confirmTip?: string | null;
  /** Kotlin default `null`. */
  readonly countLabel?: string | null;
}

/** Result of one scan pass — the Compose `remember` state of Kotlin L108-119. */
export interface StorageScanResult {
  readonly rows: readonly StorageRow[];
  /** Kotlin `appTotalSize` (L111). */
  readonly appTotalSize: number;
  /** Kotlin `systemMeasured` (L112) — true when `StorageStatsManager` covered the scan. */
  readonly systemMeasured: boolean;
  /** Kotlin `otherSize` (L113). */
  readonly otherSize: number;
  /** Kotlin `freeBytes` (L114) — `StatFs.availableBytes`. */
  readonly freeBytes: number;
  /** Kotlin `deviceTotalBytes` (L115) — `StatFs.totalBytes`. */
  readonly deviceTotalBytes: number;
  /** Kotlin `hasActiveDownload` (L116). */
  readonly hasActiveDownload: boolean;
  /** Kotlin `hasActiveComicDownload` (L117). */
  readonly hasActiveComicDownload: boolean;
  /** `true` while the caller should still be scanning (the page owns this flag). */
  readonly scanning: boolean;
}

/** Result of a clear operation — Kotlin L245-256 / L272-284. */
export type ClearResult =
  /** `freed < 0` → `检测到下载正在进行，已取消删除` (Kotlin L253). */
  | { readonly kind: 'skipped-active-download'; readonly message: string }
  /** `freed > 0` → success badge animation (Kotlin L254). */
  | { readonly kind: 'freed'; readonly freed: number }
  /** `freed == 0` → `没有可释放的内容` (Kotlin L255). */
  | { readonly kind: 'nothing-to-free'; readonly message: string };

/* ══════════════════════════════════════════════════════════════════════════════
   4. Path helpers
   ══════════════════════════════════════════════════════════════════════════════ */

function trimTrailingSlash(dir: string): string {
  return dir.endsWith('/') ? dir.slice(0, -1) : dir;
}

/** Android `File(parent, child)` → `<parent>/<child>` (parent without trailing slash). */
export function joinPath(parent: string, child: string): string {
  return `${trimTrailingSlash(parent)}/${child}`;
}

/** Android `File.name`. */
export function fileNameOf(path: string): string {
  const trimmed = trimTrailingSlash(path);
  const slash = trimmed.lastIndexOf('/');
  return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}

/** Android `File.extension` (no leading dot; `""` when there is none). */
export function fileExtensionOf(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1);
}

/** Android `File.nameWithoutExtension`. */
export function fileNameWithoutExtensionOf(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

/** Android `File.parentFile?.name` — `null` at the filesystem root. */
export function parentDirNameOf(path: string): string | null {
  const trimmed = trimTrailingSlash(path);
  const slash = trimmed.lastIndexOf('/');
  if (slash <= 0) return null;
  return trimmed.slice(slash + 1);
}

/** Android `distinctBy { it.absolutePath }` over dir lists. */
function distinctPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════
   5. formatSize — Kotlin lines 142-147
   ══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin `String.format(Locale.getDefault(), "%.1f GB", …)` → `.toFixed(1)`. */
export function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${String(bytes)} B`;
}

/**
 * Kotlin `internal fun formatCacheSize(bytes: Long)` from `TranslationCacheDetail.kt`
 * lines 287-291 — the detail-dialog variant of `formatSize` (different units/literals).
 */
export function formatCacheSize(bytes: number): string {
  if (bytes >= 1 << 20) return `${(bytes / 1048576).toFixed(1)}MB`;
  if (bytes >= 1 << 10) return `${Math.floor(bytes / 1024)}KB`;
  return `${String(bytes)}B`;
}

/* ══════════════════════════════════════════════════════════════════════════════
   6. dirSize / newestFileTime — Kotlin lines 149-160
   ══════════════════════════════════════════════════════════════════════════════ */

async function walkFiles(
  fs: CacheFileSystemApi,
  target: string,
  bottomUp: boolean,
): Promise<CacheFsNode[]> {
  const root = await fs.stat(target);
  if (root === null) return [];
  if (!root.isDirectory) return [root];
  const out: CacheFsNode[] = [];
  const queue: string[] = [root.path];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (dir === undefined) break;
    const children = await fs.listNodes(dir);
    for (const child of children) {
      if (child.isDirectory) queue.push(child.path);
      else out.push(child);
    }
  }
  // Kotlin `walkBottomUp()` vs `walkTopDown()` differ only in emission order, and
  // both consumers below are order-independent (sum / maxOfOrNull).
  void bottomUp;
  return out;
}

/** 带异常保护的目录大小统计：任何权限/IO 异常都按 0 处理，绝不让扫描协程崩溃卡住 */
export async function dirSize(fs: CacheFileSystemApi, target: string): Promise<number> {
  const node = await fs.stat(target);
  if (node === null) return 0;
  try {
    if (!node.isDirectory) return Math.max(0, node.size);
    const files = await walkFiles(fs, target, true);
    let sum = 0;
    for (const file of files) {
      try {
        sum += Math.max(0, file.size);
      } catch {
        sum += 0;
      }
    }
    return sum;
  } catch {
    return 0;
  }
}

/** 目录内最新文件的修改时间：目录 mtime 只在直接子项增删时更新，解析中的 epub_* 目录需要递归判断 */
export async function newestFileTime(fs: CacheFileSystemApi, target: string): Promise<number> {
  const node = await fs.stat(target);
  if (node === null) return 0;
  try {
    const files = await walkFiles(fs, target, false);
    let max = 0;
    let found = false;
    for (const file of files) {
      if (!found || file.lastModified > max) {
        max = file.lastModified;
        found = true;
      }
    }
    return found ? max : node.lastModified;
  } catch {
    return node.lastModified;
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   7. hasActiveWrite — Kotlin lines 162-175
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * 删除执行前的现场复核（扫描快照会过期）：书籍下载以 30 分钟内的 .tmp 为准，
 * 漫画页图片写入后不再修改，2 分钟内有新文件即认为下载仍在进行
 */
export async function hasActiveWrite(
  fs: CacheFileSystemApi,
  layout: CacheLayout,
  key: string,
  now: number,
): Promise<boolean> {
  if (key === 'downloads') {
    const nodes = await fs.listNodes(joinPath(layout.filesDir, 'downloads'));
    return nodes.some(
      (f) => !f.isDirectory && f.name.endsWith('.tmp') && f.lastModified > now - 30 * 60_000,
    );
  }
  if (key === 'comics') {
    const dirs = await fs.listNodes(layout.filesDir);
    for (const dir of dirs) {
      if (!dir.isDirectory || !dir.name.startsWith('comics_')) continue;
      const files = await walkFiles(fs, dir.path, false);
      if (files.some((f) => f.lastModified > now - 2 * 60_000)) return true;
    }
    return false;
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════════
   8. targetsFor — Kotlin lines 177-214
   ══════════════════════════════════════════════════════════════════════════════ */

/** ── 各清理项对应的磁盘目标 ── */
export async function targetsFor(
  fs: CacheFileSystemApi,
  layout: CacheLayout,
  key: string,
): Promise<string[]> {
  switch (key) {
    case 'ehimg':
      return [joinPath(layout.cacheDir, 'ehimg')];
    case 'image_cache':
      return [joinPath(layout.cacheDir, 'image_cache')];
    case 'comic_image_cache':
      return [joinPath(layout.cacheDir, 'comic_image_cache')];
    case 'comic_processed':
      return [joinPath(layout.cacheDir, COMIC_PROCESSED_DIR)];
    case 'external_cache':
      return distinctPaths(layout.externalCacheDirs);
    case 'temp': {
      const nodes = await fs.listNodes(layout.cacheDir);
      return nodes.filter((f) => !CACHE_MANAGED_SUBDIRS.has(f.name)).map((f) => f.path);
    }
    case 'downloads':
      return [joinPath(layout.filesDir, 'downloads')];
    case 'imports':
      return [joinPath(layout.filesDir, 'imports')];
    case 'comics': {
      const nodes = await fs.listNodes(layout.filesDir);
      return nodes
        .filter((f) => f.isDirectory && f.name.startsWith('comics_'))
        .map((f) => f.path);
    }
    case 'book_images':
      return ['epub_images', 'mobi_images', 'fb2_images', 'docx_images'].map((name) =>
        joinPath(layout.filesDir, name),
      );
    case 'external_files':
      return distinctPaths([...layout.externalFilesDirs, ...layout.externalMediaDirs]);
    case 'personalization': {
      const nodes = await fs.listNodes(layout.filesDir);
      return nodes
        .filter(
          (f) =>
            !f.isDirectory &&
            (f.name === CUSTOM_FONT_FILE ||
              f.name.startsWith(CUSTOM_POSTER_PREFIX) ||
              f.name.startsWith(CUSTOM_APP_BG_PREFIX)),
        )
        .map((f) => f.path);
    }
    case 'sources':
      return [
        joinPath(layout.filesDir, JS_SOURCES_DIR),
        joinPath(layout.filesDir, BACKUP_FILE),
      ];
    case 'appdata':
      return ['databases', 'shared_prefs', 'no_backup'].map((name) =>
        joinPath(layout.dataDir, name),
      );
    case 'other': {
      const fileNodes = await fs.listNodes(layout.filesDir);
      const fileRemainder = fileNodes.filter(
        (f) =>
          !KNOWN_FILES_DIRS.has(f.name) &&
          !f.name.startsWith('comics_') &&
          f.name !== CUSTOM_FONT_FILE &&
          f.name !== BACKUP_FILE &&
          !f.name.startsWith(CUSTOM_POSTER_PREFIX) &&
          !f.name.startsWith(CUSTOM_APP_BG_PREFIX),
      );
      const dataNodes = await fs.listNodes(layout.dataDir);
      const dataRemainder = dataNodes.filter((f) => !KNOWN_DATA_DIRS.has(f.name));
      return [...fileRemainder, ...dataRemainder].map((f) => f.path);
    }
    case 'covers':
      return COVER_DIRS.map((name) => joinPath(layout.filesDir, name));
    case 'webview':
      return [joinPath(layout.dataDir, 'app_webview')];
    case 'manga_tr_cache':
      return [joinPath(layout.cacheDir, TRANSLATION_CACHE_DIR)];
    case 'manga_tr_models':
      return [joinPath(layout.filesDir, TRANSLATION_MODEL_DIR)];
    default:
      return [];
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   9. clearTargets — Kotlin lines 216-235
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * 临时文件清理的保守策略：Coil 缓存目录有自己的入口不重复动；
 * share_temp 保留 15 分钟内的文件（分享面板里停留或目标应用冷启动都可能超过几分钟）；
 * epub_* 解压目录内最近 2 分钟仍有文件更新的说明可能正在导入
 */
export async function clearTargets(
  fs: CacheFileSystemApi,
  layout: CacheLayout,
  key: string,
  now: number,
): Promise<void> {
  if (key !== 'temp') {
    for (const target of await targetsFor(fs, layout, key)) {
      try {
        await fs.deleteRecursively(target);
      } catch {
        // runCatching { it.deleteRecursively() }
      }
    }
    return;
  }

  const nodes = await fs.listNodes(layout.cacheDir);
  for (const f of nodes) {
    if (CACHE_MANAGED_SUBDIRS.has(f.name)) {
      // `-> Unit`
      continue;
    }
    if (f.name === 'share_temp' && f.isDirectory) {
      const children = await fs.listNodes(f.path);
      for (const c of children) {
        if (c.lastModified < now - 15 * 60_000) {
          try {
            await fs.deleteRecursively(c.path);
          } catch {
            // runCatching { c.deleteRecursively() }
          }
        }
      }
      continue;
    }
    if (f.name.startsWith('epub_') && f.isDirectory) {
      const newest = await newestFileTime(fs, f.path);
      if (newest > now - 2 * 60_000) continue;
    }
    const newest = await newestFileTime(fs, f.path);
    if (newest < now - 2 * 60_000) {
      try {
        await fs.deleteRecursively(f.path);
      } catch {
        // runCatching { f.deleteRecursively() }
      }
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   10. clearRow / clearAllCache — Kotlin lines 237-290
   ══════════════════════════════════════════════════════════════════════════════ */

/** 删除并统计实际释放量（删除前后实测差），完成后重扫刷新全部数字 */
export async function clearRow(
  fs: CacheFileSystemApi,
  layout: CacheLayout,
  key: string,
  now: number,
): Promise<ClearResult> {
  // 快照可能过期，删除前现场复核；-1 表示因下载进行中放弃本次删除
  if (await hasActiveWrite(fs, layout, key, now)) {
    return { kind: 'skipped-active-download', message: '检测到下载正在进行，已取消删除' };
  }
  const targets = await targetsFor(fs, layout, key);
  let before = 0;
  for (const target of targets) before += await dirSize(fs, target);
  await clearTargets(fs, layout, key, now);
  let after = 0;
  for (const target of await targetsFor(fs, layout, key)) after += await dirSize(fs, target);
  const freed = Math.max(0, before - after);
  // B1：清理成功不再只弹 Toast，改为播放「打勾 + 释放量」动画
  if (freed > 0) return { kind: 'freed', freed };
  return { kind: 'nothing-to-free', message: '没有可释放的内容' };
}

/** 一键清理只作用于可再生缓存，译文、模型和离线内容走独立入口 */
export async function clearAllCache(
  fs: CacheFileSystemApi,
  layout: CacheLayout,
  now: number,
): Promise<ClearResult> {
  const keys = ONE_TAP_CACHE_KEYS;
  let before = 0;
  for (const key of keys) {
    for (const target of await targetsFor(fs, layout, key)) before += await dirSize(fs, target);
  }
  for (const key of keys) {
    await clearTargets(fs, layout, key, now);
  }
  let after = 0;
  for (const key of keys) {
    for (const target of await targetsFor(fs, layout, key)) after += await dirSize(fs, target);
  }
  const freed = Math.max(0, before - after);
  // B1：同上，成功走动画
  if (freed > 0) return { kind: 'freed', freed };
  return { kind: 'nothing-to-free', message: '没有可释放的内容' };
}

/* ══════════════════════════════════════════════════════════════════════════════
   11. scanStorage — Kotlin lines 292-439
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * 扫描：内部数据 + 外部缓存；安装包和系统组件不在此口径内
 *
 * `signal` mirrors Kotlin's `if (isActive)` guard in the `finally` block (L426-437):
 * a cancelled scan must not write its rows over a newer scan.
 */
export async function scanStorage(
  fs: CacheFileSystemApi,
  layout: CacheLayout,
  now: number,
  signal?: { readonly aborted: boolean },
): Promise<StorageScanResult> {
  const rows: StorageRow[] = [];
  let appTotal = 0;
  let other = 0;
  let free = 0;
  let deviceTotal = 0;
  let activeDownload = false;
  let activeComic = false;
  let measuredBySystem = false;

  try {
    const filesDir = layout.filesDir;
    const cacheDir = layout.cacheDir;
    const dataDir = layout.dataDir;

    const ehimgSize = await dirSize(fs, joinPath(cacheDir, 'ehimg'));
    const imageCacheSize = await dirSize(fs, joinPath(cacheDir, 'image_cache'));
    const comicImageSize = await dirSize(fs, joinPath(cacheDir, 'comic_image_cache'));
    const comicProcessedSize = await dirSize(fs, joinPath(cacheDir, COMIC_PROCESSED_DIR));
    const cacheAll = await dirSize(fs, cacheDir);

    // 逐目标测量一次并复用（Kotlin 为每个 key 重复调用 dirSize；数值相同）。
    const sizeCache = new Map<string, number>();
    const measure = async (target: string): Promise<number> => {
      const cached = sizeCache.get(target);
      if (cached !== undefined) return cached;
      const value = await dirSize(fs, target);
      sizeCache.set(target, value);
      return value;
    };

    const externalCacheTargets = await targetsFor(fs, layout, 'external_cache');
    const externalCacheSize = await sumAll(measure, externalCacheTargets);
    const externalFileTargets = await targetsFor(fs, layout, 'external_files');
    const externalFilesSize = await sumAll(measure, externalFileTargets);
    const tempTargets = await targetsFor(fs, layout, 'temp');
    const tempSize = await sumAll(measure, tempTargets);

    const downloadsDir = joinPath(filesDir, 'downloads');
    const downloadsSize = await measure(downloadsDir);
    const importsSize = await measure(joinPath(filesDir, 'imports'));
    const bookImageTargets = await targetsFor(fs, layout, 'book_images');
    const bookImagesSize = await sumAll(measure, bookImageTargets);
    const comicDirs = await targetsFor(fs, layout, 'comics');
    const comicsSize = await sumAll(measure, comicDirs);
    const coversSize = await sumAll(
      measure,
      COVER_DIRS.map((name) => joinPath(filesDir, name)),
    );
    const personalFiles = await targetsFor(fs, layout, 'personalization');
    let personalSize = 0;
    for (const path of personalFiles) {
      const node = await fs.stat(path);
      if (node === null) continue;
      try {
        personalSize += Math.max(0, node.size);
      } catch {
        personalSize += 0;
      }
    }
    const jsSourcesSize = await measure(joinPath(filesDir, JS_SOURCES_DIR));
    const backupNode = await fs.stat(joinPath(filesDir, BACKUP_FILE));
    const backupSize = backupNode === null ? 0 : Math.max(0, backupNode.size);
    const sourcesSize = jsSourcesSize + backupSize;
    const trModelsSize = await measure(joinPath(filesDir, TRANSLATION_MODEL_DIR));
    const webviewSize = await measure(joinPath(dataDir, 'app_webview'));
    const appDataSize = await sumAll(
      measure,
      ['databases', 'shared_prefs', 'no_backup'].map((name) => joinPath(dataDir, name)),
    );

    // filesDir 中未归类的杂项（历史遗留示例数据等），归入「其他」让总数自洽
    for (const f of await fs.listNodes(filesDir)) {
      const known =
        (f.isDirectory &&
          (f.name === 'downloads' ||
            f.name === 'imports' ||
            f.name === 'epub_images' ||
            f.name === 'mobi_images' ||
            f.name === 'fb2_images' ||
            f.name === 'docx_images' ||
            f.name.startsWith('comics_') ||
            COVER_DIRS.includes(f.name) ||
            f.name === JS_SOURCES_DIR ||
            f.name === TRANSLATION_MODEL_DIR)) ||
        (!f.isDirectory &&
          (f.name === CUSTOM_FONT_FILE ||
            f.name === BACKUP_FILE ||
            f.name.startsWith(CUSTOM_POSTER_PREFIX) ||
            f.name.startsWith(CUSTOM_APP_BG_PREFIX)));
      if (!known) other += await measure(f.path);
    }
    for (const f of await fs.listNodes(dataDir)) {
      if (!KNOWN_DATA_DIRS.has(f.name)) other += await measure(f.path);
    }

    appTotal =
      cacheAll +
      externalCacheSize +
      externalFilesSize +
      downloadsSize +
      importsSize +
      bookImagesSize +
      comicsSize +
      coversSize +
      personalSize +
      sourcesSize +
      trModelsSize +
      other +
      webviewSize +
      appDataSize;

    const scannedData = appTotal;
    let systemTotal: number | null = null;
    const stats = await fs.packageStats();
    if (stats !== null) systemTotal = stats.appBytes + stats.dataBytes;
    measuredBySystem = systemTotal !== null && systemTotal >= scannedData;
    let installAndSystemSize: number;
    if (measuredBySystem && systemTotal !== null) {
      installAndSystemSize = systemTotal - scannedData;
    } else {
      installAndSystemSize = 0;
      for (const path of fs.packageInstallPaths()) installAndSystemSize += await measure(path);
    }
    appTotal += installAndSystemSize;

    const volume = await fs.volumeStats(filesDir);
    if (volume !== null) {
      free = volume.freeBytes;
      deviceTotal = volume.totalBytes;
    }

    const downloadNodes = await fs.listNodes(downloadsDir);
    activeDownload = downloadNodes.some(
      (f) => !f.isDirectory && f.name.endsWith('.tmp') && f.lastModified > now - 30 * 60_000,
    );
    for (const dir of comicDirs) {
      const files = await walkFiles(fs, dir, false);
      if (files.some((f) => f.lastModified > now - 2 * 60_000)) {
        activeComic = true;
        break;
      }
    }
    const bookCount = downloadNodes.filter((f) => !f.isDirectory && !f.name.endsWith('.tmp'))
      .length;
    const activeDownloadTip = activeDownload
      ? '\n\n注意：检测到有下载正在进行，暂不能删除；请完成或取消下载后再试。'
      : '';
    const activeComicTip = activeComic
      ? '\n\n注意：检测到有漫画下载正在进行，暂不能删除；请完成或取消下载后再试。'
      : '';

    rows.push({
      key: 'ehimg',
      name: '网页图片缓存',
      desc: '在线书源图片，删除后浏览时自动重新加载',
      size: ehimgSize,
      zone: 0,
      deletable: true,
    });
    rows.push({
      key: 'image_cache',
      name: '图片加载缓存',
      desc: '封面与在线图片的通用缓存，自动重建',
      size: imageCacheSize,
      zone: 0,
      deletable: true,
    });
    rows.push({
      key: 'comic_image_cache',
      name: '漫画原图缓存',
      desc: '在线漫画图片，删除后阅读时重新下载',
      size: comicImageSize,
      zone: 0,
      deletable: true,
    });
    rows.push({
      key: 'comic_processed',
      name: '漫画增强缓存',
      desc: '画质增强后的页面，删除后重新处理',
      size: comicProcessedSize,
      zone: 0,
      deletable: true,
    });
    if (externalCacheSize > 0) {
      rows.push({
        key: 'external_cache',
        name: '外部缓存',
        desc: '应用专用外部缓存，删除后按需重建',
        size: externalCacheSize,
        zone: 0,
        deletable: true,
      });
    }
    rows.push({
      key: 'temp',
      name: '其他临时文件',
      desc: '导入、分享和模型副本；正在使用的文件会保留',
      size: tempSize,
      zone: 0,
      deletable: true,
    });

    // 译文需要重新翻译、模型需要重新下载，因此归入按需管理
    const trCacheTargets = await targetsFor(fs, layout, 'manga_tr_cache');
    let trCacheSize = 0;
    let trCacheCount = 0;
    try {
      const dir = trCacheTargets[0];
      if (dir !== undefined) {
        const children = await fs.listNodes(dir);
        for (const child of children) {
          if (child.isDirectory) continue;
          trCacheSize += Math.max(0, child.size);
          trCacheCount += 1;
        }
      }
    } catch {
      trCacheSize = 0;
      trCacheCount = 0;
    }
    if (trCacheSize > 0) {
      rows.push({
        key: 'manga_tr_cache',
        name: '漫画译文缓存',
        desc: '已翻译页面；清理后需要重新翻译',
        size: trCacheSize,
        zone: 1,
        deletable: true,
        confirmTip: '清理后再次阅读这些页面需要重新翻译。',
        countLabel: trCacheCount > 0 ? `共 ${String(trCacheCount)} 页` : null,
      });
    }
    if (trModelsSize > 0) {
      rows.push({
        key: 'manga_tr_models',
        name: '漫画翻译模型',
        desc: '离线模型；清理后需要重新下载',
        size: trModelsSize,
        zone: 1,
        deletable: true,
        confirmTip: '清理后漫画翻译将不可用，直到重新下载模型。',
      });
    }

    rows.push({
      key: 'downloads',
      name: '离线书籍',
      desc: '下载的书籍原文件，属于你的离线内容',
      size: downloadsSize,
      zone: 1,
      deletable: true,
      confirmTip: `书架记录仍保留，但删除原文件后无法重新解析；若书源失效，也无法重新下载。${activeDownloadTip}`,
      countLabel: bookCount > 0 ? `共 ${String(bookCount)} 个文件` : null,
    });
    rows.push({
      key: 'imports',
      name: '导入的原文件',
      desc: '本地书籍源文件',
      size: importsSize,
      zone: 1,
      deletable: true,
      confirmTip: '删除后可能无法重新解析或恢复书内图片；书架记录仍会保留。',
    });
    rows.push({
      key: 'comics',
      name: '离线漫画',
      desc: '已下载的漫画页面与封面，属于你的离线内容',
      size: comicsSize,
      zone: 1,
      deletable: true,
      confirmTip: `已下载的漫画页会被删除，之后无法离线阅读。${activeComicTip}`,
      countLabel: comicDirs.length > 0 ? `共 ${String(comicDirs.length)} 个目录` : null,
    });
    rows.push({
      key: 'covers',
      name: '封面图片',
      desc: '书籍与漫画的封面图，删除后无法自动恢复',
      size: coversSize,
      zone: 1,
      deletable: true,
      confirmTip: '书架封面将显示为空白，重新导入对应书籍后才能恢复。',
    });
    rows.push({
      key: 'webview',
      name: '网页浏览数据',
      desc: '网页书源的浏览器数据，删除后需重新登录书源网站',
      size: webviewSize,
      zone: 1,
      deletable: true,
      confirmTip: '网页书源的登录状态与浏览数据将被清除，之后需要重新登录。',
    });
    rows.push({
      key: 'personalization',
      name: '个性化文件',
      desc: '导入的字体、启动海报与软件背景，可在设置中更换',
      size: personalSize,
      zone: 1,
      deletable: false,
    });
    rows.push({
      key: 'book_images',
      name: '书内插图',
      desc: '本地书籍解析出的图片',
      size: bookImagesSize,
      zone: 1,
      deletable: false,
    });
    if (externalFilesSize > 0) {
      rows.push({
        key: 'external_files',
        name: '外部应用文件',
        desc: '应用专用外部文件',
        size: externalFilesSize,
        zone: 1,
        deletable: false,
      });
    }
    rows.push({
      key: 'sources',
      name: '书源与备份',
      desc: '已安装的书源脚本与设置备份',
      size: sourcesSize,
      zone: 1,
      deletable: false,
    });
    rows.push({
      key: 'appdata',
      name: '书籍数据与设置',
      desc: '书架、阅读进度与全部设置，不可在此清理',
      size: appDataSize,
      zone: 2,
      deletable: false,
    });
    if (installAndSystemSize > 0) {
      rows.push({
        key: 'install',
        name: '安装包与系统文件',
        desc: '应用安装及系统编译文件',
        size: installAndSystemSize,
        zone: 2,
        deletable: false,
      });
    }
    if (other > 0) {
      rows.push({
        key: 'other',
        name: '其他应用数据',
        desc: '运行代码缓存等内部文件，应用运行时不提供清理',
        size: other,
        zone: 2,
        deletable: false,
      });
    }
  } catch (error) {
    // Kotlin L424 `catch (_: Exception) {}` — a scan must never crash the page.
    // `isActive`-style cancellation is re-thrown by the page before applying.
    if (error instanceof Error && error.name === 'AbortError') throw error;
  }

  // 协程被取消（快速重扫/离开页面）时不落状态，避免旧扫描覆盖新扫描或闪空数据
  if (signal?.aborted === true) {
    return {
      rows: [],
      appTotalSize: 0,
      systemMeasured: false,
      otherSize: 0,
      freeBytes: 0,
      deviceTotalBytes: 0,
      hasActiveDownload: false,
      hasActiveComicDownload: false,
      scanning: true,
    };
  }

  return {
    rows,
    appTotalSize: appTotal,
    systemMeasured: measuredBySystem,
    otherSize: other,
    freeBytes: free,
    deviceTotalBytes: deviceTotal,
    hasActiveDownload: activeDownload,
    hasActiveComicDownload: activeComic,
    scanning: false,
  };
}

async function sumAll(
  measure: (target: string) => Promise<number>,
  targets: readonly string[],
): Promise<number> {
  let sum = 0;
  for (const target of targets) sum += await measure(target);
  return sum;
}

/* ══════════════════════════════════════════════════════════════════════════════
   12. Overview aggregations — Kotlin lines 441 and 530-560
   ══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin L441 `storageRows.filter { it.zone == 0 }.sumOf { it.size }`. */
export function zoneTotal(rows: readonly StorageRow[], zone: number): number {
  let sum = 0;
  for (const row of rows) if (row.zone === zone) sum += row.size;
  return sum;
}

/** Kotlin L532 `storageRows.filter { it.zone == 2 && it.key != "other" }.sumOf { it.size }`. */
export function appDataTotalExcludingOther(rows: readonly StorageRow[]): number {
  let sum = 0;
  for (const row of rows) if (row.zone === 2 && row.key !== 'other') sum += row.size;
  return sum;
}

/** Kotlin L546-551 `legend` — `可直接清理` / `按需管理与离线内容` / `应用数据与设置` / `其他`. */
export interface LegendSegment {
  readonly label: string;
  readonly size: number;
  readonly color: string;
}

export function legendSegments(
  rows: readonly StorageRow[],
  otherSize: number,
): LegendSegment[] {
  const out: LegendSegment[] = [
    { label: '可直接清理', size: zoneTotal(rows, 0), color: '#00B894' },
    { label: '按需管理与离线内容', size: zoneTotal(rows, 1), color: '#E17055' },
    { label: '应用数据与设置', size: appDataTotalExcludingOther(rows), color: '#74B9FF' },
  ];
  if (otherSize > 0) out.push({ label: '其他', size: otherSize, color: '#90A4AE' });
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════
   13. segmentedBar — Kotlin lines 729-766
   ══════════════════════════════════════════════════════════════════════════════ */

export interface BarSegment {
  readonly size: number;
  readonly color: string;
  /** Kotlin `Triple(_, _, "cache" | "user" | "appdata" | "other")`. */
  readonly id: string;
  /** Kotlin `target = (size / grandTotal).coerceAtLeast(0.005f)`. */
  readonly weight: number;
  /** Kotlin `tween(durationMillis = 520, delayMillis = index * 90)`. */
  readonly growDelayMs: number;
}

/** 总览占比条：缓存/用户数据/书籍数据与设置，可选「其他」段。 */
export function segmentedSegments(
  cacheTotal: number,
  userTotal: number,
  appDataTotal: number,
  otherTotal: number,
  grandTotal: number,
): BarSegment[] {
  const raw: Array<[number, string, string]> = [
    [cacheTotal, '#00B894', 'cache'],
    [userTotal, '#E17055', 'user'],
    [appDataTotal, '#74B9FF', 'appdata'],
  ];
  if (otherTotal > 0) raw.push([otherTotal, '#90A4AE', 'other']);
  return raw.map(([size, color, id], index) => ({
    size,
    color,
    id,
    weight: grandTotal > 0 ? Math.max(size / grandTotal, 0.005) : 0,
    growDelayMs: index * 90,
  }));
}

/* ══════════════════════════════════════════════════════════════════════════════
   14. Confirm-dialog text — Kotlin lines 702-726
   ══════════════════════════════════════════════════════════════════════════════ */

/** 用户数据删除确认：一句话说清删什么、多少、多大、后果 */
export function confirmRowText(row: StorageRow): string {
  const countPart = row.countLabel != null && row.countLabel !== '' ? `${row.countLabel}，` : '';
  return `将删除「${row.name}」${countPart}约 ${formatSize(row.size)}。\n\n${row.confirmTip ?? ''}`;
}

/** Kotlin L713-714 — the delete button is disabled while a matching download runs. */
export function confirmDeleteEnabled(
  row: StorageRow,
  hasActiveDownload: boolean,
  hasActiveComicDownload: boolean,
): boolean {
  if (row.key === 'downloads' && hasActiveDownload) return false;
  if (row.key === 'comics' && hasActiveComicDownload) return false;
  return true;
}

/** Kotlin L601 — one-tap button label. */
export function clearAllLabel(cacheTotal: number): string {
  return cacheTotal > 0
    ? `清理可再生缓存 · 约 ${formatSize(cacheTotal)}`
    : '清理可再生缓存';
}

/** Kotlin L527 — overview sub-caption. */
export function overviewCaption(systemMeasured: boolean): string {
  return systemMeasured ? '应用总占用 · 系统统计' : '已扫描占用 · 含安装包';
}

/** Kotlin L575 — device free/total line. */
export function deviceFreeText(freeBytes: number, deviceTotalBytes: number): string {
  return `设备剩余 ${formatSize(freeBytes)} / 共 ${formatSize(deviceTotalBytes)}`;
}

/* ══════════════════════════════════════════════════════════════════════════════
   15. End of CacheManagementScreen.kt port
   ══════════════════════════════════════════════════════════════════════════════ */
