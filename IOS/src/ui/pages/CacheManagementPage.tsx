/**
 * CacheManagementPage.tsx — the Compose tree of Android `CacheManagementScreen.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/CacheManagementScreen.kt`, 903 lines / 865 non-blank).
 * All pure scan/clear logic lives in `@core/cache/cacheManagement` (ported line by line there).
 *
 * Line map (Kotlin → this file):
 *   1-71    imports / file annotations  → React imports (Compose/Android imports skipped)
 *   72-73   COVER_DIRS                  → `@core/cache/cacheManagement.COVER_DIRS`
 *   75-88   StorageRow + zone doc       → core `StorageRow`
 *   90-101  KDoc                        → props KDoc below
 *   102-120 composable + state          → `useState` (storageRows/isScanning/isClearing/
 *                                          appTotalSize/systemMeasured/otherSize/freeBytes/
 *                                          deviceTotalBytes/hasActiveDownload/
 *                                          hasActiveComicDownload/scanTrigger/confirmRow)
 *   121-129 B1 successFreed + LaunchedEffect(successFreed) delay(2400) →
 *                                          `successFreed` state + `useEffect` timer
 *   130-140 totalAnim (0 → appTotalSize, tween 650 FastOutSlowInInEasing) →
 *                                          `useRollingNumber` hook (rAF, same easing curve)
 *   142-235 formatSize/dirSize/newestFileTime/hasActiveWrite/targetsFor/clearTargets →
 *                                          core (`formatSize`, `targetsFor`, `clearTargets`, …)
 *   237-263 clearRow + AppToast + MascotAnimationController → `handleClearRow`
 *                                          (mascot animation skipped — see core header L254)
 *   265-290 clearAllCache               → `handleClearAll`
 *   292-439 LaunchedEffect(scanTrigger) → `useEffect` on `scanTrigger`
 *   441     cacheTotal                   → `zoneTotal(rows, 0)`
 *   443-454 detailRow + StorageDetailDialog → `detailRow` state + `<StorageDetailDialog/>`
 *   456-497 ModalBottomSheet + 64dp title bar → `<div className="cache-sheet">` + header
 *   499     HorizontalDivider            → `.cache-divider`
 *   501-584 overview Surface + ScanningSkeleton + total number + segmentedBar +
 *           legend + device free line → overview card / `ScanningSkeleton` / `SegmentedBar`
 *   586-606 clear_all Button (+ FileSweepIndicator while clearing) → clear button + `FileSweepIndicator`
 *   608-677 zone sections + rows + per-row delete → zone sections + `StorageRowItem`
 *   679-696 clean-success AnimatedVisibility overlay → `<CleanSuccessBadge/>` overlay
 *   702-726 AlertDialog confirm         → `.cache-dialog`
 *   729-766 segmentedBar                → `SegmentedBar` (CSS flex-grow)
 *   768-787 ScanningSkeleton             → `ScanningSkeleton` (CSS shimmer)
 *   789-832 FileSweepIndicator           → `FileSweepIndicator` (SVG)
 *   834-870 CleanSuccessBadge            → `CleanSuccessBadge`
 *   872-905 AnimatedCheckMark            → `AnimatedCheckMark` (SVG stroke-dashoffset)
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1-4    `@file:OptIn(...)` — Compose opt-in, no TS equivalent.
 *  L8-11   `StatFs` / `Build` / `Process` / `StorageManager` / `StorageStatsManager` →
 *          `CacheFileSystemApi.volumeStats()` / `packageStats()` / `packageInstallPaths()`
 *          (declared in `@core/cache/cacheManagement`).
 *  L13-28  Compose animation imports → CSS transitions / `useRollingNumber` / SVG.
 *  L29     `android.widget.Toast` → `showToast()` (`@ui/components/Toast`).
 *  L31-55  Compose layout/material/ui imports → CSS classes `cache-*`.
 *  L46     `me.trishiraj.shadowglow.consistentShadow` → CSS `box-shadow`
 *          (same elevation 12dp, ambient rgba(0,0,0,0.12), spot rgba(0,0,0,0.16)).
 *  L56-57  `AppIconButton` / `ShimmerBox` → local `IconButton` / CSS `.cache-shimmer`.
 *  L58     `MintPrimary` → `#00B894`-family accent; `MintPrimary` value in this project is
 *          `var(--color-primary, #059669)` (see `src/ui/theme/tokens.ts`).
 *  L59-66  `kotlinx.coroutines.*` / `java.io.File` / `java.util.Locale` → async/await + port.
 *  L67-68  `widthIn` / `AdaptiveSpec.sheetMaxWidth` (560.dp) → CSS `max-width: 560px`;
 *          `pageContentMaxWidth` (720.dp) → `max-width: 720px`.
 *  L69     `DesignTokens.SpacePage` (16.dp) → CSS `padding-inline: 16px`.
 *  L70     `AppToast.makeText(context, msg, Toast.LENGTH_SHORT)` → `showToast(msg)`.
 *  L107    `rememberCoroutineScope()` → async event handlers.
 *  L269/281 `MascotAnimationController.play(MascotEvent.CleanComplete)` → SKIPPED: the
 *          `ui/mascot/**` animation subsystem has no TS port and is owned elsewhere.
 *          `CleanSuccessBadge` itself is ported.
 *  FIXES applied by the cache review agent:
 *  * `requestRowDeletion` was missing the middle branch of Kotlin L656-658
 *    (`else if (row.confirmTip != null) confirmRow = row`). Without it the 漫画译文缓存 /
 *    漫画翻译模型 rows (zone 1 user data, both carry a `confirmTip`) were deleted straight
 *    through with no confirmation — `confirmRow` was never set, so the whole confirm
 *    dialog was dead code. Restored.
 *  * `hasTargets` was hard-coded `true`; Kotlin L631 only makes a row clickable when
 *    `targetsFor(row.key).isNotEmpty()`. Now resolved per row after each scan.
 *  L457    `rememberModalBottomSheetState(skipPartiallyExpanded = true)` → fixed-position sheet.
 *  L462-466 `ModalBottomSheet` (surface color, fillMaxHeight(0.9f), padding 12/8,
 *          RoundedCornerShape 24.dp) → `.cache-sheet` CSS (same values).
 *  L517-518 `ScanningSkeleton()` — ported.
 *  L626-628 `animateContentSize(spring(StiffnessMediumLow))` on each row → CSS
 *          `transition: height 250ms` + `layout` class.
 *  L630-633 `Modifier.clickable { detailRow = row }` when `targetsFor(row.key).isNotEmpty()` →
 *          row is clickable only when its targets resolve non-empty (targets are provided by
 *          the caller through the `resolveTargets` port).
 *  L683-695 `AnimatedVisibility(fadeIn(tween 180) + scaleIn(spring MediumBouncy, 0.6f),
 *          exit = fadeOut(tween 260))` → CSS `cache-badge-pop` (180ms scale 0.6→1) and
 *          `cache-badge-fade` (260ms).
 *  L776    `ShimmerBox` (infinite 1100ms linear-gradient sweep) → `.cache-shimmer` CSS.
 *  L807-831 Compose `Canvas` particle loop → SVG `<rect>`s with a CSS `offset-path`-free
 *          parabola computed per animation frame via `requestAnimationFrame`.
 *  L875-881 `LaunchedEffect(Unit) { started = true }` + `animateFloatAsState(tween 420)` →
 *          CSS `stroke-dashoffset` transition on the check mark.
 *  L886-887 `p1 = (progress / 0.45f)`, `p2 = ((progress - 0.45f) / 0.55f)` → SVG path
 *          segment lengths derived from the same 0.45/0.55 split.
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * `withContext(Dispatchers.IO)` → the port's async methods (already off the render path).
 *  * `scope.launch { … }` → `void (async () => { … })()`.
 *  * `if (isActive)` guard in the scan `finally` → `AbortController` (`signal.aborted`).
 *  * `LaunchedEffect(key)` → `useEffect(…, [key])`.
 *  * `ModalBottomSheet` / `AlertDialog` → CSS overlays.
 *  * Light theme: this surface is LIGHT in Android (`MaterialTheme.colorScheme.surface`,
 *    `onSurface` #18191C, `onSurfaceVariant` #61666D) — CSS uses the project's
 *    `--color-on-light` / `--color-medium-gray` tokens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPlatform } from '@platform/index';
import { useAppStore } from '@ui/state/appStore';
import {
  DETAIL_FIRST_KEYS,
  ZONE_META,
  clearAllCache,
  clearAllLabel,
  clearRow,
  confirmDeleteEnabled,
  confirmRowText,
  deviceFreeText,
  formatSize,
  legendSegments,
  overviewCaption,
  scanStorage,
  segmentedSegments,
  targetsFor,
  zoneTotal,
  type CacheFileSystemApi,
  type CacheLayout,
  type ClearResult,
  type StorageRow,
} from '@core/cache/cacheManagement';
import { StorageDetailDialog } from '@ui/components/cache/StorageDetailDialog';
import { showToast } from '@ui/components/Toast';
import { AppButton } from '@ui/components/AppButton';
import '../../styles/statistics.css';

/* ── Icons (Material icons paths, same shapes as the Kotlin icons) ── */

function CleaningServicesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16 11h-1V3c0-1.1-.9-2-2-2h-2C9.9 1 9 1.9 9 3v8H8c-2.76 0-5 2.24-5 5v7h18v-7c0-2.76-2.24-5-5-5zm-6-8h4v8h-4V3zm10 15H4v-2c0-1.66 1.34-3 3-3h10c1.66 0 3 1.34 3 3v2zm-3-9h-2v2h2v-2zm0 4h-2v2h2v-2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

function StorageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zM2 14h20v-4H2v4zm2-3h2v2H4v-2z" />
    </svg>
  );
}

/* ── Android `Context.filesDir / cacheDir / dataDir` defaults (web/iOS) ── */

/**
 * Android has no "external cache/files/media dir" on the web, so those families are
 * empty here (`getExternalFilesDirs(null)` returns only null entries on iOS).
 */
export const DEFAULT_CACHE_LAYOUT: CacheLayout = {
  filesDir: 'files',
  cacheDir: 'cache',
  dataDir: 'data',
  externalCacheDirs: [],
  externalFilesDirs: [],
  externalMediaDirs: [],
};

/**
 * The web/iOS `CacheFileSystemApi` built on the platform `FileSystemApi`
 * (`@platform/index`).
 *
 * Documented degradations vs. Android:
 *  * `lastModified` is always 0 — the platform port exposes no mtime. Every "still being
 *    written" gate therefore reports "not active", which only makes deletion slightly more
 *    eager than Android, never less.
 *  * `isDirectory` is inferred: a path whose children can be listed AND whose bytes
 *    cannot be read is a directory (true for both the in-memory mock and Capacitor FS).
 *  * `volumeStats` maps to `navigator.storage.estimate()` (quota/usage) instead of `StatFs`.
 *  * `packageStats` returns `null` — `StorageStatsManager` is Android-only, so
 *    `systemMeasured` stays false and the overview falls back to 已扫描占用 · 含安装包.
 *  * `packageInstallPaths` is empty — there is no split APK on the web.
 */
export function createPlatformCacheFileSystem(): CacheFileSystemApi {
  const base = getPlatform().fs;
  const join = (dir: string, name: string): string =>
    dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;

  const isDirectory = async (path: string): Promise<boolean> => {
    try {
      await base.readFile(path);
      return false;
    } catch {
      // unreadable → could be a directory or a missing path; probe the children.
      try {
        const children = await base.list(path);
        if (children.length > 0) return true;
        return !(await base.exists(path));
      } catch {
        return false;
      }
    }
  };

  const sizeOf = async (path: string, directory: boolean): Promise<number> => {
    if (!directory) {
      try {
        return (await base.readFile(path)).length;
      } catch {
        return 0;
      }
    }
    let sum = 0;
    for (const name of await base.list(path)) {
      const child = join(path, name);
      sum += await sizeOf(child, await isDirectory(child));
    }
    return sum;
  };

  const stat = async (path: string) => {
    if (!(await base.exists(path))) return null;
    const directory = await isDirectory(path);
    return {
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      isDirectory: directory,
      size: await sizeOf(path, directory),
      lastModified: 0,
    };
  };

  // `File.deleteRecursively()`：用具名 const 自引用。原先写在返回的对象字面量里，
  // 递归调用用的是箭头函数里的 `this`（ESM 顶层 `this` 为 undefined，`noImplicitThis`
  // 直接报错 TS2683）。逻辑逐行照抄，只是把递归入口换成这个具名函数。
  const deleteRecursively = async (path: string): Promise<void> => {
    const node = await stat(path);
    if (node === null) return;
    if (!node.isDirectory) {
      await base.delete(path);
      return;
    }
    for (const name of await base.list(path)) {
      await deleteRecursively(join(path, name));
    }
    await base.delete(path);
  };

  return {
    readFile: (path) => base.readFile(path),
    writeFile: (path, data) => base.writeFile(path, data),
    exists: (path) => base.exists(path),
    delete: (path) => base.delete(path),
    list: (dir) => base.list(dir),
    stat,
    listNodes: async (dir) => {
      const names = await base.list(dir);
      const nodes = await Promise.all(names.map((name) => stat(join(dir, name))));
      return nodes.filter((node) => node !== null);
    },
    deleteRecursively,
    volumeStats: async () => {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate === undefined || estimate.quota === undefined) return null;
      return {
        freeBytes: estimate.quota - (estimate.usage ?? 0),
        totalBytes: estimate.quota,
      };
    },
    packageStats: async () => null,
    packageInstallPaths: () => [],
  };
}

/* ── Rolling number: Kotlin L130-140 `Animatable` 0 → appTotalSize ── */

/** `tween(650, easing = FastOutSlowInEasing)` — same cubic curve, driven by rAF. */
function easeFastOutSlowIn(t: number): number {
  // Compose FastOutSlowInEasing = CubicBezierEasing(0.4f, 0.0f, 0.2f, 1.0f)
  const x = Math.min(1, Math.max(0, t));
  // Newton solve for the bezier x, then evaluate y.
  let u = x;
  for (let i = 0; i < 6; i += 1) {
    const bx = 3 * u * (1 - u) * (1 - u) * 0.4 + 3 * u * u * (1 - u) * 0 + u * u * u;
    const dx =
      3 * (1 - u) * (1 - u) * 0.4 + 6 * u * (1 - u) * (0 - 0.4) + 3 * u * u * (1 - 1);
    if (Math.abs(bx - x) < 1e-4) break;
    u = Math.min(1, Math.max(0, u - (bx - x) / (dx === 0 ? 1e-6 : dx)));
  }
  return 3 * u * (1 - u) * (1 - u) * 0 + 3 * u * u * (1 - u) * 0 + u * u * u;
}

function useRollingNumber(target: number, durationMs: number): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);
  // Kotlin L134 `totalAnim.snapTo(0f)`：目标（或时长）一变，先把显示值归零。
  // 用 React 官方的「渲染期派生 state」代替 effect 里的同步 setValue —— 归零与新目标在
  // 同一次渲染里生效（少一次级联渲染），effect 只剩 rAF 驱动，行为逐帧一致。
  const [rollingFor, setRollingFor] = useState<readonly [number, number]>([target, durationMs]);
  if (rollingFor[0] !== target || rollingFor[1] !== durationMs) {
    setRollingFor([target, durationMs]);
    setValue(0);
  }

  useEffect(() => {
    // `target <= 0` 时上面的渲染期派生已把显示值归零，这里只需停掉上一段动画。
    if (target <= 0) return undefined;
    // Kotlin L134-135 `totalAnim.snapTo(0f)` then `animateTo(appTotalSize, tween(650))`
    const start = performance.now();
    const tick = (): void => {
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / durationMs);
      setValue(target * easeFastOutSlowIn(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [durationMs, target]);

  return value;
}

/* ── Kotlin L768-787 ScanningSkeleton ── */

function ScanningSkeleton() {
  return (
    <div className="cache-skeleton">
      <div className="cache-shimmer" style={{ width: 128, height: 38, borderRadius: 10 }} />
      <div style={{ height: 8 }} />
      <div className="cache-shimmer" style={{ width: 76, height: 16, borderRadius: 8 }} />
      <div style={{ height: 18 }} />
      <div className="cache-shimmer" style={{ width: '100%', height: 8, borderRadius: 4 }} />
      <div style={{ height: 14 }} />
      {[0, 1, 2].map((i) => (
        <div key={i}>
          <div className="cache-shimmer" style={{ width: '100%', height: 14, borderRadius: 7 }} />
          <div style={{ height: 8 }} />
        </div>
      ))}
    </div>
  );
}

/* ── Kotlin L729-766 segmentedBar ── */

function SegmentedBar(props: {
  cacheTotal: number;
  userTotal: number;
  appDataTotal: number;
  otherTotal: number;
  grandTotal: number;
}) {
  const { cacheTotal, userTotal, appDataTotal, otherTotal, grandTotal } = props;
  // B1：原先 weight 直接赋值 → 占比条瞬间成形。改为逐段错峰生长（每段延迟 90ms）
  // 生长必须「先提交一帧 flexGrow≈0，再翻到目标值」，CSS 过渡才会跑 —— 所以这里的状态
  // 不能简单地在渲染期派生（那样第一帧就是终值，元素插入即终态，动画会消失）。
  // 改为由 effect 排一个 rAF 回调在下一帧翻（规则允许「回调里的 setState」）：落点仍是
  // 「首帧 0.0001 → 次帧权重」，与原来 effect 里同步 setGrown(true) 的时序一致。
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGrown(grandTotal > 0));
    return () => cancelAnimationFrame(raf);
  }, [grandTotal]);
  const segments = segmentedSegments(cacheTotal, userTotal, appDataTotal, otherTotal, grandTotal);

  return (
    <div className="cache-segmented">
      {segments.map((segment) => (
        <span
          key={segment.id}
          className="cache-segmented__seg"
          style={{
            background: segment.color,
            // Kotlin L749 `target = (size / grandTotal).coerceAtLeast(0.005f)`
            flexGrow: grown ? Math.max(segment.weight, 0.0001) : 0.0001,
            transitionDelay: `${String(segment.growDelayMs)}ms`,
          }}
        />
      ))}
    </div>
  );
}

/* ── Kotlin L872-905 AnimatedCheckMark (Compose Canvas → SVG) ── */

function AnimatedCheckMark() {
  // p1 = (progress / 0.45f), p2 = ((progress - 0.45f) / 0.55f) — the two strokes are
  // split at 45% of the 420ms animation, short stroke first.
  const size = 28;
  const w = size;
  const h = size;
  const shortLen = w * 0.24 * Math.SQRT2;
  const longLen = Math.hypot(w * 0.42, h * 0.48);
  return (
    <svg viewBox={`0 0 ${String(size)} ${String(size)}`} width={size} height={size} aria-hidden>
      <line
        x1={w * 0.18}
        y1={h * 0.52}
        x2={w * 0.18}
        y2={h * 0.52}
        stroke="#FFFFFF"
        strokeWidth={3.5}
        strokeLinecap="round"
        style={{
          strokeDasharray: `${String(shortLen)} ${String(shortLen)}`,
          strokeDashoffset: 0,
          animation: 'cache-check 420ms cubic-bezier(0.4,0,0.2,1) 0ms forwards',
        }}
      />
      <line
        x1={w * 0.42}
        y1={h * 0.76}
        x2={w * 0.42}
        y2={h * 0.76}
        stroke="#FFFFFF"
        strokeWidth={3.5}
        strokeLinecap="round"
        style={{
          strokeDasharray: `${String(longLen)} ${String(longLen)}`,
          animation: 'cache-check 420ms cubic-bezier(0.4,0,0.2,1) 189ms forwards',
        }}
      />
    </svg>
  );
}

/* ── Kotlin L834-870 CleanSuccessBadge ── */

function CleanSuccessBadge(props: { freedText: string }) {
  return (
    <div className="cache-badge">
      <div className="cache-badge__circle">
        <AnimatedCheckMark />
      </div>
      <div style={{ height: 12 }} />
      <p className="cache-badge__title">清理完成</p>
      <div style={{ height: 4 }} />
      <p className="cache-badge__sub">已释放 {props.freedText}</p>
    </div>
  );
}

/* ── Kotlin L608-677 zone row ── */

function StorageRowItem(props: {
  row: StorageRow;
  disabled: boolean;
  hasTargets: boolean;
  onOpenDetail: (row: StorageRow) => void;
  onDelete: (row: StorageRow) => void;
}) {
  const { row, disabled, hasTargets, onOpenDetail, onDelete } = props;
  const open = (): void => {
    if (!hasTargets) return;
    onOpenDetail(row);
  };
  const remove = (event: React.MouseEvent): void => {
    event.stopPropagation();
    if (disabled) return;
    onDelete(row);
  };
  return (
    <div
      className="cache-row"
      role={hasTargets ? 'button' : undefined}
      tabIndex={hasTargets ? 0 : undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (!hasTargets) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      }}
    >
      <div className="cache-row__text">
        <p className="cache-row__name">{row.name}</p>
        <p className="cache-row__desc">{row.desc}</p>
      </div>
      <span className="cache-row__size">{formatSize(row.size)}</span>
      {row.deletable ? (
        <button
          type="button"
          className="cache-row__del"
          aria-label={`清理${row.name}`}
          disabled={disabled}
          onClick={remove}
        >
          {/* 颜色语言：缓存=中性灰（随便删），用户数据=警示红（需确认） */}
          <DeleteIcon />
        </button>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   CacheManagementScreen — Kotlin lines 102-727
   ══════════════════════════════════════════════════════════════════════════════ */

export interface CacheManagementPageProps {
  /** Android `onBack: () -> Unit` — defaults to the app store's `main` route. */
  onBack?: () => void;
  /** Android `LocalContext.current` file access; defaults to the web/iOS platform FS. */
  fs?: CacheFileSystemApi;
  /** Android `Context.filesDir / cacheDir / dataDir` + external dir families. */
  layout?: CacheLayout;
  /** Books/tasks for the detail dialog labels (Android L269-276 DB read). */
  books?: Parameters<typeof StorageDetailDialog>[0]['books'];
  tasks?: Parameters<typeof StorageDetailDialog>[0]['tasks'];
  /** Test seam; defaults to `Date.now()`. */
  now?: () => number;
}

export function CacheManagementPage(props: CacheManagementPageProps) {
  const setRoute = useAppStore((s) => s.setRoute);
  // Android `onBack` / `LocalContext.current` — defaulted so the routed page can render
  // with no props (see `createDefaultCacheLayout` / `createPlatformCacheFileSystem`).
  const onBack = props.onBack ?? (() => setRoute('main'));
  const fs = useMemo(() => props.fs ?? createPlatformCacheFileSystem(), [props.fs]);
  const layout = props.layout ?? DEFAULT_CACHE_LAYOUT;
  // `System.currentTimeMillis()` 的测试注入口。默认值放进 useMemo 只是为了让引用稳定：
  // 否则 `now` 每次渲染都是新函数，会击穿下面 handleClearRow / handleClearAll 的 useCallback。
  // 取值逻辑（`props.now ?? Date.now()`）与原来逐字一致。
  const now = useMemo(() => props.now ?? (() => Date.now()), [props.now]);

  const [rows, setRows] = useState<readonly StorageRow[]>([]);
  const [isScanning, setIsScanning] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [appTotalSize, setAppTotalSize] = useState(0);
  const [systemMeasured, setSystemMeasured] = useState(false);
  const [otherSize, setOtherSize] = useState(0);
  const [freeBytes, setFreeBytes] = useState(0);
  const [deviceTotalBytes, setDeviceTotalBytes] = useState(0);
  const [hasActiveDownload, setHasActiveDownload] = useState(false);
  const [hasActiveComicDownload, setHasActiveComicDownload] = useState(false);
  const [scanTrigger, setScanTrigger] = useState(0);
  const [confirmRow, setConfirmRow] = useState<StorageRow | null>(null);
  // ── B1 清理动画状态 ── 清理完成后弹出「打勾 + 释放量」，替代原来只有一个 Toast
  const [successFreed, setSuccessFreed] = useState<number | null>(null);

  const [detailRow, setDetailRow] = useState<StorageRow | null>(null);
  const [detailTargets, setDetailTargets] = useState<readonly string[]>([]);

  const scanAbortRef = useRef<AbortController | null>(null);

  // Kotlin L124-129 LaunchedEffect(successFreed) { delay(2400); successFreed = null }
  useEffect(() => {
    if (successFreed === null) return undefined;
    const id = window.setTimeout(() => {
      setSuccessFreed(null);
    }, 2400);
    return () => {
      window.clearTimeout(id);
    };
  }, [successFreed]);

  // 总占用数字：从 0 滚动到实测值，而不是直接蹦出来
  const animatedTotal = useRollingNumber(appTotalSize, 650);

  // Kotlin L293 LaunchedEffect(scanTrigger)
  // 「开始一次扫描」（isScanning = true）改用 React 官方的「渲染期派生 state」：
  // scanTrigger 一变就在同一次渲染里置位，effect 体内只剩异步扫描本身
  // （await 之后的写状态属于外部系统更新），行为与原来一致。
  const [scannedTrigger, setScannedTrigger] = useState(scanTrigger);
  if (scannedTrigger !== scanTrigger) {
    setScannedTrigger(scanTrigger);
    setIsScanning(true);
  }

  useEffect(() => {
    scanAbortRef.current?.abort();
    const controller = new AbortController();
    scanAbortRef.current = controller;
    void (async () => {
      const {
        appTotalSize: total,
        rows: scanned,
        systemMeasured: measured,
        otherSize: other,
        freeBytes: free,
        deviceTotalBytes: deviceTotal,
        hasActiveDownload: activeDownload,
        hasActiveComicDownload: activeComic,
      } = await scanStorage(fs, layout, now(), controller.signal);
      // 协程被取消（快速重扫/离开页面）时不落状态，避免旧扫描覆盖新扫描或闪空数据
      if (controller.signal.aborted) return;
      setRows(scanned);
      setAppTotalSize(total);
      setSystemMeasured(measured);
      setOtherSize(other);
      setFreeBytes(free);
      setDeviceTotalBytes(deviceTotal);
      setHasActiveDownload(activeDownload);
      setHasActiveComicDownload(activeComic);
      setIsScanning(false);
    })();
    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanTrigger]);

  const cacheTotal = useMemo(() => zoneTotal(rows, 0), [rows]);
  const userTotal = useMemo(() => zoneTotal(rows, 1), [rows]);
  const appDataTotal = useMemo(
    () =>
      rows
        .filter((row) => row.zone === 2 && row.key !== 'other')
        .reduce((sum, row) => sum + row.size, 0),
    [rows],
  );
  const legend = useMemo(() => legendSegments(rows, otherSize), [otherSize, rows]);

  const applyClearResult = useCallback((result: ClearResult): void => {
    // B1：清理成功不再只弹 Toast，改为播放「打勾 + 释放量」动画
    if (result.kind === 'freed') setSuccessFreed(result.freed);
    else if (result.message !== '') showToast(result.message);
  }, []);

  // Kotlin L238-263 fun clearRow
  const handleClearRow = useCallback(
    (key: string): void => {
      if (isClearing) return;
      setIsClearing(true);
      void (async () => {
        try {
          const result = await clearRow(fs, layout, key, now());
          applyClearResult(result);
          setScanTrigger((n) => n + 1);
        } finally {
          setIsClearing(false);
        }
      })();
    },
    [applyClearResult, fs, isClearing, layout, now],
  );

  // Kotlin L266-290 fun clearAllCache
  const handleClearAll = useCallback((): void => {
    if (isClearing) return;
    setIsClearing(true);
    void (async () => {
      try {
        const result = await clearAllCache(fs, layout, now());
        applyClearResult(result);
        setScanTrigger((n) => n + 1);
      } finally {
        setIsClearing(false);
      }
    })();
  }, [applyClearResult, fs, isClearing, layout, now]);

  const openDetail = useCallback(
    (row: StorageRow): void => {
      void (async () => {
        const list = await targetsFor(fs, layout, row.key);
        setDetailTargets(list);
        setDetailRow(row);
      })();
    },
    [fs, layout],
  );

  // Kotlin L631 `if (targetsFor(row.key).isNotEmpty()) Modifier.clickable { detailRow = row }
  //   else Modifier` —— 只有真的能解析出磁盘目标的行才可点开明细。
  const [targetKeys, setTargetKeys] = useState<ReadonlySet<string>>(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const resolved = new Set<string>();
      for (const row of rows) {
        if (cancelled) return;
        const list = await targetsFor(fs, layout, row.key);
        if (list.length > 0) resolved.add(row.key);
      }
      if (!cancelled) setTargetKeys(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [fs, layout, rows]);

  const requestRowDeletion = useCallback(
    (row: StorageRow): void => {
      // Kotlin L656-658 — 三个分支逐字照抄：
      //   if (row.key in setOf("downloads","imports","comics","covers")) detailRow = row
      //   else if (row.confirmTip != null) confirmRow = row
      //   else clearRow(row.key)
      // 少了中间那个分支，漫画译文缓存 / 漫画翻译模型（zone 1 用户数据，都带
      // confirmTip）就会被静默删除 —— Kotlin 要求先弹确认框。
      if (DETAIL_FIRST_KEYS.has(row.key)) openDetail(row);
      else if (row.confirmTip != null && row.confirmTip !== '') setConfirmRow(row);
      else handleClearRow(row.key);
    },
    [handleClearRow, openDetail],
  );

  return (
    <div className="page cache-page">
      <div className="cache-sheet" role="dialog" aria-modal="true" aria-label="缓存管理">
        <div className="cache-sheet__inner">
          {/* 顶部标题栏（同手册页：64dp + 图标 + 标题 + 关闭） */}
          <div className="cache-sheet__bar">
            <div className="cache-sheet__bar-row">
              <div className="cache-sheet__title-group">
                <span className="cache-sheet__title-icon" aria-hidden>
                  <CleaningServicesIcon />
                </span>
                <span className="cache-sheet__spacer-8" />
                <h1 className="cache-sheet__title">缓存管理</h1>
              </div>
              <button
                type="button"
                className="cache-sheet__close"
                aria-label="关闭"
                onClick={onBack}
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className="cache-divider" />

          <div className="cache-sheet__body">
            <div className="cache-sheet__content">
              {/* overview */}
              <section className="cache-overview">
                {isScanning ? (
                  /* B1：扫描期间整块空白 → 骨架屏，形状与目标内容一一对应 */
                  <ScanningSkeleton />
                ) : (
                  <>
                    {/* B1：数字从 0 滚动到实测值 */}
                    <p className="cache-overview__total">
                      {formatSize(Math.max(0, Math.trunc(animatedTotal)))}
                    </p>
                    <p className="cache-overview__caption">
                      {overviewCaption(systemMeasured)}
                    </p>
                    {appTotalSize > 0 ? (
                      <>
                        <div style={{ height: 16 }} />
                        <SegmentedBar
                          cacheTotal={cacheTotal}
                          userTotal={userTotal}
                          appDataTotal={appDataTotal}
                          otherTotal={otherSize}
                          grandTotal={appTotalSize}
                        />
                      </>
                    ) : null}
                    <div style={{ height: 12 }} />
                    <div className="cache-legend">
                      {legend.map((item) => (
                        <div className="cache-legend__row" key={item.label}>
                          <span
                            className="cache-legend__dot"
                            style={{ background: item.color }}
                          />
                          <span className="cache-legend__spacer" />
                          <span className="cache-legend__label">{item.label}</span>
                          <span className="cache-legend__spacer" />
                          <span className="cache-legend__size">
                            {formatSize(item.size)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {freeBytes > 0 ? (
                      <>
                        <div style={{ height: 12 }} />
                        <div className="cache-divider cache-divider--soft" />
                        <div style={{ height: 10 }} />
                        <div className="cache-device">
                          <span className="cache-device__icon" aria-hidden>
                            <StorageIcon />
                          </span>
                          <span className="cache-sheet__spacer-8" />
                          <span className="cache-device__text">
                            {deviceFreeText(freeBytes, deviceTotalBytes)}
                          </span>
                        </div>
                      </>
                    ) : null}
                  </>
                )}
              </section>

              {/* 一键清理 */}
              <AppButton
                fullWidth
                disabled={isScanning || isClearing || cacheTotal <= 0}
                onClick={handleClearAll}
              >
                {isClearing ? (
                  <span className="cache-clear-busy">
                    {/* B1：正在清理 → 文件飞进垃圾桶的粒子动画 */}
                    <FileSweepIcon />
                    <span>正在清理…</span>
                  </span>
                ) : (
                  clearAllLabel(cacheTotal)
                )}
              </AppButton>

              {/* 三个分区：可再生缓存 → 按需管理与离线内容 → 核心数据；空区整段隐藏 */}
              {ZONE_META.map(([zone, title]) => {
                const zoneRows = rows.filter((row) => row.zone === zone && row.size > 0);
                if (zoneRows.length === 0) return null;
                return (
                  <div className="cache-zone" key={zone}>
                    <h2 className="cache-zone__title">{title}</h2>
                    {zoneRows.map((row) => (
                      <StorageRowItem
                        key={row.key}
                        row={row}
                        disabled={isScanning || isClearing}
                        hasTargets={targetKeys.has(row.key)}
                        onOpenDetail={openDetail}
                        onDelete={requestRowDeletion}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── B1 清理成功动画：打勾 + 释放量，弹簧弹出后自动消失 ── */}
        {successFreed !== null ? (
          <div className="cache-badge-overlay">
            <div className="cache-badge-pop">
              <CleanSuccessBadge freedText={formatSize(successFreed)} />
            </div>
          </div>
        ) : null}
      </div>

      {/* 第十八轮：全部类别明细（手机内存管理式：单删/批删/全选/全清 + 弹出动画） */}
      {detailRow !== null ? (
        <StorageDetailDialog
          rowKey={detailRow.key}
          title={detailRow.name}
          targets={detailTargets}
          confirmTip={detailRow.confirmTip ?? null}
          allowDelete={detailRow.deletable}
          onDismiss={() => {
            setDetailRow(null);
          }}
          onChanged={() => {
            setScanTrigger((n) => n + 1);
          }}
          fs={fs}
          layout={layout}
          books={props.books ?? []}
          tasks={props.tasks ?? []}
          now={now}
        />
      ) : null}

      {/* 用户数据删除确认：一句话说清删什么、多少、多大、后果 */}
      {confirmRow !== null ? (
        <div
          className="cache-dialog-backdrop"
          role="presentation"
          onClick={() => {
            setConfirmRow(null);
          }}
        >
          <div
            className="cache-dialog"
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <h3 className="cache-dialog__title">删除「{confirmRow.name}」</h3>
            <div className="cache-dialog__body">
              <p>{confirmRowText(confirmRow)}</p>
            </div>
            <div className="cache-dialog__actions">
              <button
                type="button"
                className="cache-dialog__action cache-dialog__action--danger"
                disabled={
                  !confirmDeleteEnabled(
                    confirmRow,
                    hasActiveDownload,
                    hasActiveComicDownload,
                  )
                }
                onClick={() => {
                  const key = confirmRow.key;
                  setConfirmRow(null);
                  handleClearRow(key);
                }}
              >
                删除
              </button>
              <button
                type="button"
                className="cache-dialog__action"
                onClick={() => {
                  setConfirmRow(null);
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The particle "fly into the bin" indicator needs per-frame geometry, so the
 * parabola is driven by rAF instead of a static SVG transform.
 */
function FileSweepIcon(): React.ReactElement {
  const ref = useRef<SVGGElement | null>(null);
  const box = 22;
  const cx = box * 0.5;
  const cy = box * 0.7;

  useEffect(() => {
    const g = ref.current;
    if (g === null) return undefined;
    let raf = 0;
    const start = performance.now();
    const duration = 1250; // Kotlin L803 tween(1250, easing = LinearEasing)
    const rects = Array.from(g.querySelectorAll('rect'));
    const tick = (now: number): void => {
      const t = ((now - start) % duration) / duration;
      rects.forEach((el, i) => {
        const phase = (t + i / 3) % 1;
        // 水平匀速、垂直加速（抛物线感）
        const px = box * 0.04 + (cx - box * 0.04) * phase;
        const py = box * 0.02 + (cy - box * 0.02) * (phase * phase);
        const side = box * 0.26 * (1 - phase * 0.55);
        el.setAttribute('x', String(px - side / 2));
        el.setAttribute('y', String(py - side / 2));
        el.setAttribute('width', String(side));
        el.setAttribute('height', String(side));
        el.setAttribute('opacity', String(Math.max(0, Math.min(1, 1 - phase))));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
    // `box` / `cx` / `cy` 都由字面量 22 推出（编译期常量，永不变），列进依赖只是为了让
    // exhaustive-deps 看见它们 —— 不会引入任何额外的重订阅。
  }, [box, cx, cy]);

  return (
    <svg viewBox={`0 0 ${String(box)} ${String(box)}`} width={box} height={box} aria-hidden>
      <g ref={ref}>
        {[0, 1, 2].map((i) => (
          <rect key={i} x={0} y={0} width={0} height={0} rx={1} fill="#FFFFFF" />
        ))}
      </g>
      <line
        x1={box * 0.22}
        y1={box * 0.88}
        x2={box * 0.78}
        y2={box * 0.88}
        stroke="#FFFFFF"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}
