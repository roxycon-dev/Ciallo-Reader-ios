import { useEffect, useState } from 'react';
import type { SearchBook } from '@core/source/searchBook';
import type { LibraryRuntime } from '@core/library/libraryRuntime';
import type { LibraryLocalBook } from '@core/library/libraryReadingRecords';
import { taskId } from '@core/download/downloadManager';
import { DownloadStateIdle, type DownloadState } from '@core/download/downloadState';
import { NovelDetailSheet } from '@ui/pages/LibraryPage';
import { useAppStore } from '@ui/state/appStore';
import { showToast } from '@ui/toast';

export function DiscoverNovelDetails({ book, runtime, onDismiss }: { book: SearchBook; runtime: LibraryRuntime; onDismiss(): void }) {
  const [detail, setDetail] = useState(book), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<DownloadState>(DownloadStateIdle), [local, setLocal] = useState<LibraryLocalBook | null>(null);
  const vm = runtime.viewModel, key = taskId(book.sourceId, book.id);
  useEffect(() => {
    let cancelled = false;
    void vm.novelDetail(book).then((result) => {
      if (cancelled) return;
      if (result.kind === 'success') setDetail(result.data); else setError(result.exception.message);
    }).catch((error: unknown) => { if (!cancelled) setError(error instanceof Error ? error.message : '详情暂时无法加载'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vm, book]);
  useEffect(() => {
    let cancelled = false;
    const update = (states: Map<string, DownloadState>): void => { if (!cancelled) setState(states.get(key) ?? DownloadStateIdle); };
    void vm.downloadStates().then(update);
    const unsubscribe = vm.subscribeDownloadStates(update);
    return () => { cancelled = true; unsubscribe(); };
  }, [vm, key]);
  useEffect(() => {
    let cancelled = false;
    void vm.localNovel(book).then((local) => { if (!cancelled) setLocal(local); });
    return () => { cancelled = true; };
  }, [vm, book, state.kind]);
  return <NovelDetailSheet book={detail} sourceName={runtime.sourceManager?.getSource(book.sourceId)?.name ?? ''} loading={loading} error={error}
    state={state} hasLocal={local !== null} onDismiss={onDismiss} onDownload={() => {
      const source = runtime.sourceManager?.getSource(book.sourceId);
      void (async () => {
        if (source?.capabilities.downloadRequiresLogin && !(await source.isLoggedIn())) { runtime.openZLibraryLoginDialog?.(source); return; }
        vm.startDownloadWithFormat(detail, detail.format);
      })().catch((error: unknown) => showToast(error instanceof Error ? error.message : '下载失败'));
    }} onRead={() => {
      if (!local) return;
      void useAppStore.getState().openBook(local.id).then(() => { onDismiss(); useAppStore.getState().setRoute('reader'); });
    }} onPause={() => vm.pauseDownload(key)} onResume={() => vm.resumeDownload(key)} onCancel={() => vm.cancelDownload(key)} />;
}
