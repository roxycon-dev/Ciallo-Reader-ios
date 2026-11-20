/**
 * 下载指示器状态 —— `library/DownloadIndicatorState.kt` L5-82 的逐行移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L5  `enum class DownloadIndicatorStatus { Idle, Running, Paused, Failed }` → `DOWNLOAD_INDICATOR_STATUS`
 *   L8-28 `data class DownloadIndicatorState(activeIds, completedIds, pausedCount, failedCount, progress)`
 *          + `activeCount` / `status` / `description`
 *   L30-69 `downloadIndicatorState(novels, comics)`                          → `downloadIndicatorState`
 *   L74-82 `class DownloadCompletionTracker { previousActive; update(state) }` → `DownloadCompletionTracker`
 *
 * 关键语义（注释 L7 / L71-73）：
 *  · 「完成」不会改变静息图标（只由 `activeIds` 驱动）；
 *  · 只有被观察到 running 的任务才可能产生完成回执 —— 加载旧历史、取消任务、重开标签页
 *    都不能重放 success。这条由 `DownloadCompletionTracker` 的 `previousActive` 保证。
 */
import type { DownloadState } from '../download/downloadState';

/** L5 `enum class DownloadIndicatorStatus`。 */
export const DOWNLOAD_INDICATOR_STATUS = ['Idle', 'Running', 'Paused', 'Failed'] as const;
export type DownloadIndicatorStatus = (typeof DOWNLOAD_INDICATOR_STATUS)[number];

export interface DownloadIndicatorState {
  readonly activeIds: ReadonlySet<string>;
  readonly completedIds: ReadonlySet<string>;
  readonly pausedCount: number;
  readonly failedCount: number;
  /** L13 `progress: Float?` —— 全部 running 任务都有进度时才有值。 */
  readonly progress: number | null;
}

/** L15 `activeCount`。 */
export function downloadActiveCount(state: DownloadIndicatorState): number {
  return state.activeIds.size;
}

/** L16-21 `status`。 */
export function downloadStatus(state: DownloadIndicatorState): DownloadIndicatorStatus {
  if (downloadActiveCount(state) > 0) return 'Running';
  if (state.failedCount > 0) return 'Failed';
  if (state.pausedCount > 0) return 'Paused';
  return 'Idle';
}

/** L22-27 `description`。 */
export function downloadDescription(state: DownloadIndicatorState): string {
  const status = downloadStatus(state);
  if (status === 'Running') return `${String(downloadActiveCount(state))} 项下载中`;
  if (status === 'Failed') return `${String(state.failedCount)} 项失败`;
  if (status === 'Paused') return `${String(state.pausedCount)} 项暂停`;
  return '无进行中的下载';
}

/** 小说下载状态的最小输入（对应 Kotlin `DownloadState` 的封闭分支）。 */
export type NovelDownloadState =
  | { readonly kind: 'Pending' }
  | { readonly kind: 'Downloading'; readonly progress: number; readonly totalBytes: number }
  | { readonly kind: 'Success' }
  | { readonly kind: 'Paused' }
  | { readonly kind: 'Error' }
  | { readonly kind: 'Idle' };

/** 漫画下载任务的最小输入（对应 `ComicDownloadTask.status` / `progress`）。 */
export interface ComicDownloadTaskLike {
  readonly status: 'DOWNLOADING' | 'SUCCESS' | 'PAUSED' | 'FAILED';
  readonly progress: number;
}

/** L30-69 `downloadIndicatorState(novels, comics)`。 */
export function downloadIndicatorState(
  novels: ReadonlyMap<string, NovelDownloadState>,
  comics: ReadonlyMap<string, ComicDownloadTaskLike>,
): DownloadIndicatorState {
  const active = new Set<string>();
  const completed = new Set<string>();
  let paused = 0;
  let failed = 0;
  let known = 0;
  let totalProgress = 0;

  /** L40-46 `running(id, progress)`：只有有限进度才计入 `known`。 */
  const running = (id: string, progress: number | null): void => {
    active.add(id);
    if (progress !== null && Number.isFinite(progress)) {
      known += 1;
      totalProgress += Math.min(Math.max(progress, 0), 1);
    }
  };

  for (const [id, state] of novels) {
    switch (state.kind) {
      case 'Pending':
        running(id, null);
        break;
      case 'Downloading':
        // L51 `progress.takeIf { totalBytes > 0 || it > 0f }`。
        running(id, state.totalBytes > 0 || state.progress > 0 ? state.progress : null);
        break;
      case 'Success':
        completed.add(id);
        break;
      case 'Paused':
        paused += 1;
        break;
      case 'Error':
        failed += 1;
        break;
      case 'Idle':
        break;
    }
  }

  for (const [id, task] of comics) {
    switch (task.status) {
      case 'DOWNLOADING':
        // L61 `task.progress.takeIf { it > 0f }`。
        running(id, task.progress > 0 ? task.progress : null);
        break;
      case 'SUCCESS':
        completed.add(id);
        break;
      case 'PAUSED':
        paused += 1;
        break;
      case 'FAILED':
        failed += 1;
        break;
    }
  }

  // L67-68：只有「全部 running 任务都有进度」时才给总体进度。
  const progress =
    active.size > 0 && known === active.size ? totalProgress / active.size : null;
  return { activeIds: active, completedIds: completed, pausedCount: paused, failedCount: failed, progress };
}

/** L74-82 `class DownloadCompletionTracker`。 */
export class DownloadCompletionTracker {
  private previousActive: ReadonlySet<string> = new Set();

  /** L77-81 `update(state)`：只有「上一轮在跑、本轮出现在 completed 且已静息」才算完成。 */
  update(state: DownloadIndicatorState): boolean {
    let newlyCompleted = false;
    for (const id of this.previousActive) {
      if (state.completedIds.has(id)) {
        newlyCompleted = true;
        break;
      }
    }
    this.previousActive = state.activeIds;
    return newlyCompleted && downloadStatus(state) === 'Idle';
  }
}

/**
 * Kotlin `DownloadState` 的完整封闭集合（`download/DownloadState.kt`）。
 * 与 `src/core/download/downloadState.ts` 的 `DownloadState` 是同一枚举的两侧形态：
 * 本文件只需要 `kind` 判别，故单独声明最小投影，避免把 UI 字段拖进 core。
 */
export type NovelDownloadStateKind = DownloadState extends never ? never : 'Pending' | 'Downloading' | 'Success' | 'Paused' | 'Error' | 'Idle';
