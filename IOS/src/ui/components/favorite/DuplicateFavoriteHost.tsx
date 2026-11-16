/**
 * 收藏查重宿主（E106）— 逐行对接 Android `MainActivity.kt` L604-620。
 *
 * ```kotlin
 * val favoriteAddRequest by viewModel.favoriteAddRequest.collectAsStateWithLifecycle()   // L604
 * val favoriteActionMessage by viewModel.favoriteActionMessage.collectAsStateWithLifecycle() // L605
 * val favoriteSourceNames by libraryViewModel.availableSources.collectAsStateWithLifecycle() // L606
 * LaunchedEffect(favoriteActionMessage) {                                               // L607-612
 *     favoriteActionMessage?.let { message ->
 *         AppToast.makeText(this@MainActivity, message, Toast.LENGTH_LONG).show()
 *         viewModel.clearFavoriteActionMessage()
 *     }
 * }
 * favoriteAddRequest?.let { request ->                                                  // L613-620
 *     com.example.ui.favorite.DuplicateComicSheet(
 *         request = request,
 *         sourceName = { sourceId -> favoriteSourceNames.firstOrNull { it.id == sourceId }?.name ?: sourceId },
 *         onDismiss = viewModel::dismissFavoriteAdd,
 *         onConfirm = viewModel::confirmFavoriteAdd,
 *     )
 * }
 * ```
 *
 * 映射：
 *   - 两个 `StateFlow` → `favoriteAddController.getSnapshot()` 的 `request` / `message`，
 *     走 `useSyncExternalStore`（身份稳定、无 tear）。
 *   - `favoriteSourceNames` → `getLibraryRuntime().sourceManager.getSource(id)?.name`，
 *     查不到时回落 `sourceId`（与 Kotlin 的 `?: sourceId` 一致）。
 *   - `LaunchedEffect(message)` → `useEffect([message])`：先 `showToast(…, LENGTH_LONG)`
 *     再 `clearFavoriteActionMessage()`（顺序与 Kotlin 相同，保证同一文案第二次也能弹）。
 *   - `onConfirm` 是挂起函数 → `void confirmFavoriteAdd(...)`；`busy` 态由 request 自己带。
 *
 * 挂载点：`src/App.tsx` 根层（与 `<Toast />` 同级），由主代理统一加：
 *     <DuplicateFavoriteHost />
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  clearFavoriteActionMessage,
  confirmFavoriteAdd,
  dismissFavoriteAdd,
  getFavoriteAddSnapshot,
  subscribeFavoriteAdd,
} from '@core/library/favoriteAddController';
import type { FavoriteEntity } from '@core/library/favoriteTypes';
import { getLibraryRuntime } from '@core/library/libraryRuntime';
import { TOAST_DURATION_LONG, showToast } from '@ui/toast';
import { DuplicateComicSheet } from './DuplicateComicSheet';

/** L616 `favoriteSourceNames.firstOrNull { it.id == sourceId }?.name ?: sourceId`。 */
function sourceNameOf(sourceId: string): string {
  return getLibraryRuntime()?.sourceManager?.getSource(sourceId)?.name ?? sourceId;
}

export function DuplicateFavoriteHost() {
  const snapshot = useSyncExternalStore(subscribeFavoriteAdd, getFavoriteAddSnapshot, getFavoriteAddSnapshot);

  const sourceName = useCallback((sourceId: string): string => sourceNameOf(sourceId), []);

  // L607-612：Toast.LENGTH_LONG → TOAST_DURATION_LONG，弹完立刻清消息。
  useEffect(() => {
    if (snapshot.message === null) return;
    showToast(snapshot.message, { durationMs: TOAST_DURATION_LONG });
    clearFavoriteActionMessage();
  }, [snapshot.message]);

  const request = snapshot.request;
  if (request === null) return null;

  return (
    <DuplicateComicSheet
      request={request}
      sourceName={sourceName}
      onDismiss={dismissFavoriteAdd}
      onConfirm={(favorite: FavoriteEntity | null) => {
        void confirmFavoriteAdd(favorite);
      }}
    />
  );
}
