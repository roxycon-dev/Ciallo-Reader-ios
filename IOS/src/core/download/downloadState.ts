/**
 * Download state machine — port of Android `DownloadState.kt`.
 *
 * Android sealed class → TS discriminated union on `kind`.
 */

export type DownloadState =
  | { kind: 'Idle' }
  | { kind: 'Pending' }
  | {
      kind: 'Downloading';
      downloadedBytes: number;
      totalBytes: number;
      progress: number;
    }
  | { kind: 'Paused'; downloadedBytes: number; totalBytes: number }
  | { kind: 'Success'; path: string }
  | { kind: 'Error'; message: string };

export const DownloadStateIdle: DownloadState = { kind: 'Idle' };
export const DownloadStatePending: DownloadState = { kind: 'Pending' };

export function downloadingState(
  downloadedBytes: number,
  totalBytes: number,
  progress: number,
): DownloadState {
  return { kind: 'Downloading', downloadedBytes, totalBytes, progress };
}

export function pausedState(downloadedBytes: number, totalBytes: number): DownloadState {
  return { kind: 'Paused', downloadedBytes, totalBytes };
}

export function successState(path: string): DownloadState {
  return { kind: 'Success', path };
}

export function errorState(message: string): DownloadState {
  return { kind: 'Error', message };
}

/** DownloadStatus.DOWNLOADING progress coercion: total>0 ? clamp(downloaded/total,0,1) : 0 */
export function progressRatio(downloadedBytes: number, totalBytes: number): number {
  if (totalBytes > 0) {
    return Math.min(1, Math.max(0, downloadedBytes / totalBytes));
  }
  return 0;
}
