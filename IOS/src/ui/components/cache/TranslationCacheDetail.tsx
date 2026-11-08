/**
 * TranslationCacheDetail.tsx — line-by-line port of Android
 * `com/example/ui/TranslationCacheDetail.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/TranslationCacheDetail.kt`, 291 lines / 278 non-blank).
 *
 * Line map (Kotlin → this file):
 *   1-51    package + Compose imports      → React imports; Android/Compose imports SKIPPED
 *   53-57   KDoc                           → component KDoc
 *   58-63   TranslationCacheEntry          → TranslationCacheEntry (line 71)
 *   65-117  object TranslationCacheIndex   → module-level pure functions
 *                                              (describeTranslationCacheEntry /
 *                                               scanTranslationCacheEntries /
 *                                               deleteTranslationCacheEntries)
 *   119-121 KDoc + signature               → TranslationCacheDetailDialog props
 *   124-128 composable state              → useState
 *   130-137 fun refresh                   → refresh()
 *   138     LaunchedEffect(Unit)          → useEffect
 *   140-141 selectedFiles / totalSize     → useMemo
 *   143-284 Dialog tree                   → JSX below
 *   287-291 formatCacheSize               → `@core/cache/cacheManagement.formatCacheSize`
 *                                             (re-exported here for the shared API)
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1     `package com.example.ui` — TS module system.
 *  L3-45  Compose imports (`foundation.*`, `material3.*`, `ui.*`) → CSS classes
 *         (`cache-detail-*`, shared with `StorageDetailDialog.tsx`).
 *  L46    `com.example.mangatranslate.TranslationCache` → the cache dir constant
 *         `TRANSLATION_CACHE_DIR` from `@core/cache/cacheManagement` (same literal,
 *         `MangaTranslationCore.kt` L62) and an injected `cacheDir` root.
 *  L47-49 `kotlinx.coroutines` → async/await.
 *  L50    `org.json.JSONObject` → `JSON.parse` + the `optString` helper below
 *         (Android `optString` returns `""`, never `null` — preserved).
 *  L51    `java.io.File` → path strings + `CacheFileSystemApi`.
 *  L89    `dir.listFiles()?.filter { it.isFile && it.name.endsWith(".json") }` →
 *         `fs.listNodes(cacheDir)` filtered by `!isDirectory && name.endsWith('.json')`.
 *  L108   `label.replace('\n', ' ')` → `replace(/\n/g, ' ')` (Kotlin's Char-overload
 *         `replace` replaces **every** occurrence; the first version of this file used a
 *         "replace only the first" helper, which was a BUG — see `replaceNewlines`).
 *  L114   `files.forEach { f -> runCatching { freed += f.length(); f.delete() } }` →
 *         per-file try/catch, `freed` accumulated before delete (same order).
 *  L262   `TranslationCache.clear(context)` → `clearTranslationCache()` below (same body as
 *         Android `MangaTranslationCore.kt` L164-170: sum then delete each file).
 *  L270   `TextButton(onClick = onDismiss)` → the 关闭 button.
 *
 * NOTE: `TranslationCacheDetailDialog` itself is **not referenced anywhere in Kotlin**
 * (grep over `app/src/main/java` finds only its own definition) — `CacheManagementScreen`
 * opens 漫画译文缓存 through the generic `StorageDetailDialog`, which delegates the smart
 * label to `TranslationCacheIndex.describe`. The port keeps the dead component for parity.
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * `File.length()` / `isFile` / `name` / `readText(Charsets.UTF_8)` / `delete()` →
 *    `CacheFileSystemApi` (`stat` / `listNodes` / `readFile` / `delete`).
 *  * `withContext(Dispatchers.IO)` → the port's async methods.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TRANSLATION_CACHE_DIR,
  formatCacheSize,
  joinPath,
  type CacheFileSystemApi,
} from '@core/cache/cacheManagement';

export { formatCacheSize };

/** Android L58-63 `data class TranslationCacheEntry`. */
export interface TranslationCacheEntry {
  /** Android `file: File` — the absolute path string. */
  readonly file: string;
  readonly size: number;
  readonly label: string;
  readonly regionCount: number;
}

/** Android `JSONObject.optString(key)` — `""` when absent. */
function optString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function take18(value: string): string {
  return value.length <= 18 ? value : value.slice(0, 18);
}

/**
 * Android L108 `label.replace('\n', ' ')` / L80 `.replace("\n", " ")` —
 * **both overloads replace every occurrence**. Kotlin's
 * `CharSequence.replace(oldChar: Char, newChar: Char)` splits on the char and rejoins,
 * so there is no "replace first" variant to worry about. (The previous
 * `replaceFirstNewline` helper only swapped the first newline and was a BUG: a bubble
 * with two line breaks kept the second one and broke the single-line label.)
 */
function replaceNewlines(value: string): string {
  return value.replace(/\n/g, ' ');
}

/* ══════════════════════════════════════════════════════════════════════════════
   object TranslationCacheIndex — Kotlin lines 65-117
   ══════════════════════════════════════════════════════════════════════════════ */

/** 单个译文缓存文件的可读描述（通用明细对话框复用）。 — Kotlin L67-83 */
export async function describeTranslationCacheEntry(
  fs: CacheFileSystemApi,
  path: string,
): Promise<[string, string]> {
  try {
    const bytes = await fs.readFile(path);
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    if (typeof parsed !== 'object' || parsed === null) return ['未知页面', ''];
    const root = parsed as Record<string, unknown>;
    const arr = Array.isArray(root['r']) ? (root['r'] as unknown[]) : null;
    const regions = arr?.length ?? 0;
    const head =
      arr !== null && arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null
        ? (arr[0] as Record<string, unknown>)
        : null;
    const src = head === null ? '' : take18(optString(head, 'o'));
    const dst = head === null ? '' : take18(optString(head, 'c'));
    let label: string;
    if (src.trim() !== '' && dst.trim() !== '') label = `${src} → ${dst}`;
    else if (src.trim() !== '') label = src;
    else label = '空译文';
    return [replaceNewlines(label), `${String(regions)} 个气泡区域`];
  } catch {
    return ['未知页面', ''];
  }
}

/** 扫描缓存目录，解析每个 JSON 的首条原文/译文做可读标签。 — Kotlin L86-110 */
export async function scanTranslationCacheEntries(
  fs: CacheFileSystemApi,
  cacheDir: string,
): Promise<TranslationCacheEntry[]> {
  const dir = joinPath(cacheDir, TRANSLATION_CACHE_DIR);
  const nodes = await fs.listNodes(dir);
  const files = nodes.filter((f) => !f.isDirectory && f.name.endsWith('.json'));
  const out: TranslationCacheEntry[] = [];
  for (const f of files) {
    let label = '未知页面';
    let regions = 0;
    try {
      const bytes = await fs.readFile(f.path);
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      if (typeof parsed === 'object' && parsed !== null) {
        const root = parsed as Record<string, unknown>;
        const arr = Array.isArray(root['r']) ? (root['r'] as unknown[]) : null;
        regions = arr?.length ?? 0;
        const head =
          arr !== null && arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null
            ? (arr[0] as Record<string, unknown>)
            : null;
        if (head !== null) {
          const src = take18(optString(head, 'o'));
          const dst = take18(optString(head, 'c'));
          if (src.trim() !== '' && dst.trim() !== '') label = `${src} → ${dst}`;
          else if (src.trim() !== '') label = src;
          else label = '空译文';
        }
      }
    } catch {
      label = '未知页面';
      regions = 0;
    }
    out.push({ file: f.path, size: f.size, label: replaceNewlines(label), regionCount: regions });
  }
  // Kotlin L109 `.sortedByDescending { it.size }`
  return [...out].sort((a, b) => b.size - a.size);
}

/** Kotlin L112-116 `suspend fun delete(files: List<File>): Long`. */
export async function deleteTranslationCacheEntries(
  fs: CacheFileSystemApi,
  files: readonly string[],
): Promise<number> {
  let freed = 0;
  for (const f of files) {
    try {
      const node = await fs.stat(f);
      if (node === null) continue;
      freed += node.size;
      await fs.delete(f);
    } catch {
      // runCatching { freed += f.length(); f.delete() }
    }
  }
  return freed;
}

/**
 * Android `TranslationCache.clear(context)` — `MangaTranslationCore.kt` L164-170.
 * Sums every file's length, then deletes it.
 */
export async function clearTranslationCache(
  fs: CacheFileSystemApi,
  cacheDir: string,
): Promise<number> {
  const dir = joinPath(cacheDir, TRANSLATION_CACHE_DIR);
  const nodes = await fs.listNodes(dir);
  let freed = 0;
  for (const it of nodes) {
    if (it.isDirectory) continue;
    freed += it.size;
    try {
      await fs.delete(it.path);
    } catch {
      // runCatching { it.delete() }
    }
  }
  return freed;
}

/* ══════════════════════════════════════════════════════════════════════════════
   TranslationCacheDetailDialog — Kotlin lines 119-285
   ══════════════════════════════════════════════════════════════════════════════ */

export interface TranslationCacheDetailDialogProps {
  onDismiss: () => void;
  fs: CacheFileSystemApi;
  /** Android `LocalContext.current.cacheDir`. */
  cacheDir: string;
  /** Android `LocalContext.current` → toast sink; defaults to the global toast. */
  onError?: (message: string) => void;
}

export function TranslationCacheDetailDialog(props: TranslationCacheDetailDialogProps) {
  const { onDismiss, fs, cacheDir } = props;

  const [entries, setEntries] = useState<readonly TranslationCacheEntry[]>([]);
  const [scanning, setScanning] = useState(true);
  // Android L128 `mutableStateMapOf<File, Boolean>()` → immutable path set.
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set<string>());

  // Android L130-137 `suspend fun refresh()` 拆成两半：
  //  * `load`      —— 纯挂起扫描（不碰 React 状态），完成后 resolve 新列表；
  //  * `applyScanned` —— 落状态（entries / 勾选集合 / scanning=false）。
  // 两者用 `.then` 相连，等价 Kotlin 里「先 await 扫描、再写状态」，但状态写入因此发生
  // 在 promise 回调中（外部系统更新），Effect 体内不再有同步 setState。
  const load = useCallback(
    (): Promise<readonly TranslationCacheEntry[]> => scanTranslationCacheEntries(fs, cacheDir),
    [cacheDir, fs],
  );

  // Kotlin L132 `entries = …` / L134 `checked.keys.retainAll(entries.map { it.file }.toSet())` / L136 `scanning = false`
  const applyScanned = useCallback((scanned: readonly TranslationCacheEntry[]): void => {
    setEntries(scanned);
    setChecked((prev) => {
      const alive = new Set(scanned.map((e) => e.file));
      const next = new Set<string>();
      for (const path of prev) if (alive.has(path)) next.add(path);
      return next;
    });
    setScanning(false);
  }, []);

  const refresh = useCallback((): void => {
    setScanning(true);
    void load().then(applyScanned);
  }, [applyScanned, load]);

  // Android L138 `LaunchedEffect(Unit) { refresh() }` —— 只在首次组合（以及 fs/cacheDir
  // 变化 = refresh 换身份）时载入。初始 `scanning` 本就是 true，故与原实现逐帧一致。
  // 「开始扫描」那半边（scanning = true）用 React 官方的「渲染期派生 state」补齐：
  // fs/cacheDir 一变就在同一次渲染里置位，effect 体内只剩 promise 回调里的落状态。
  const [scannedFor, setScannedFor] = useState<readonly [CacheFileSystemApi, string]>([
    fs,
    cacheDir,
  ]);
  if (scannedFor[0] !== fs || scannedFor[1] !== cacheDir) {
    setScannedFor([fs, cacheDir]);
    setScanning(true);
  }

  useEffect(() => {
    void load().then(applyScanned);
  }, [applyScanned, load]);

  // Kotlin L140-141
  const selectedFiles = useMemo(
    () => entries.filter((e) => checked.has(e.file)).map((e) => e.file),
    [checked, entries],
  );
  const totalSize = useMemo(() => entries.reduce((sum, e) => sum + e.size, 0), [entries]);

  const allOn = entries.length > 0 && entries.every((e) => checked.has(e.file));

  return (
    <div className="cache-dialog-backdrop" role="presentation" onClick={onDismiss}>
      <div
        className="cache-detail"
        role="dialog"
        aria-modal="true"
        aria-label="译文缓存明细"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="cache-detail__head">
          <span className="cache-detail__icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
            </svg>
          </span>
          <h3 className="cache-detail__title">译文缓存明细</h3>
          <span className="cache-detail__head-meta">
            {scanning
              ? '扫描中…'
              : `${String(entries.length)} 页 · 共 ${formatCacheSize(totalSize)}`}
          </span>
        </div>
        <div className="cache-detail__rule" />

        {!scanning && entries.length === 0 ? (
          <div className="cache-detail__empty">
            <p>暂无已翻译页面</p>
          </div>
        ) : (
          <div className="cache-detail__list">
            <button
              type="button"
              className="cache-detail__row cache-detail__row--select-all"
              onClick={() => {
                const nextOn = !allOn;
                setChecked((prev) => {
                  const next = new Set(prev);
                  for (const entry of entries) {
                    if (nextOn) next.add(entry.file);
                    else next.delete(entry.file);
                  }
                  return next;
                });
              }}
            >
              <span className="cache-detail__select-label">
                {allOn ? '取消全选' : `全选（${String(entries.length)}）`}
              </span>
              <span className="cache-detail__select-meta">
                {selectedFiles.length === 0
                  ? ''
                  : `已选 ${String(selectedFiles.length)} 项 / ${formatCacheSize(
                      selectedFiles.reduce((sum, file) => {
                        const entry = entries.find((e) => e.file === file);
                        return sum + (entry?.size ?? 0);
                      }, 0),
                    )}`}
              </span>
            </button>
            {entries.map((entry) => {
              const isChecked = checked.has(entry.file);
              return (
                <div
                  key={entry.file}
                  className="cache-detail__row"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
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
                  <div className="cache-detail__text">
                    <p className="cache-detail__name">{entry.label}</p>
                    <p className="cache-detail__sub">
                      {String(entry.regionCount)} 个气泡区域
                    </p>
                  </div>
                  <span className="cache-detail__size">{formatCacheSize(entry.size)}</span>
                  <button
                    type="button"
                    className="cache-detail__del"
                    aria-label="删除"
                    onClick={() => {
                      void (async () => {
                        await deleteTranslationCacheEntries(fs, [entry.file]);
                        refresh();
                      })();
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="cache-detail__rule" />
        <div className="cache-detail__actions">
          <button
            type="button"
            className="cache-detail__action cache-detail__action--danger"
            disabled={entries.length === 0 || scanning}
            onClick={() => {
              void (async () => {
                await clearTranslationCache(fs, cacheDir);
                refresh();
              })();
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
              void (async () => {
                await deleteTranslationCacheEntries(fs, selectedFiles);
                refresh();
              })();
            }}
          >
            删除所选（{String(selectedFiles.length)}）
          </button>
        </div>
      </div>
    </div>
  );
}
