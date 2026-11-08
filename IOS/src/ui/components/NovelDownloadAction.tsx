import { useEffect, useState } from 'react';
import type { SearchBook } from '@core/source/searchBook';
import { getLibraryRuntime } from '@core/library/libraryRuntime';
import { DownloadStateIdle, type DownloadState } from '@core/download/downloadState';
import { taskId } from '@core/download/downloadManager';
import { useAppStore } from '@ui/state/appStore';
import { showToast } from '@ui/toast';

/** Directory download uses the novel queue/importer, rather than the image-chapter downloader. */
export function NovelDownloadAction({ book }: { book: SearchBook }) {
  const [state, setState] = useState<DownloadState>(DownloadStateIdle), runtime = getLibraryRuntime(), vm = runtime?.viewModel;
  const key = taskId(book.sourceId, book.id);
  useEffect(() => {
    if (!vm) return;
    let cancelled = false;
    const update = (states: Map<string, DownloadState>): void => { if (!cancelled) setState(states.get(key) ?? DownloadStateIdle); };
    void vm.downloadStates().then(update); const unsubscribe = vm.subscribeDownloadStates(update);
    const unsubscribeError = vm.errorMessageState.subscribe((error) => { if (error) showToast(error); });
    return () => { cancelled = true; unsubscribe(); unsubscribeError(); };
  }, [vm, key]);
  const start = (): void => {
    if (!vm || !runtime) { showToast('下载服务尚未准备好，请重试'); return; }
    void (async () => {
      const source = runtime.sourceManager?.getSource(book.sourceId);
      if (!source) throw new Error('此作品的书源不可用');
      if (source.capabilities.downloadRequiresLogin && !(await source.isLoggedIn())) { runtime.openZLibraryLoginDialog?.(source); return; }
      vm.startDownloadWithFormat(book, 'epub');
    })().catch((error: unknown) => showToast(error instanceof Error ? error.message : '无法开始下载'));
  };
  const read = (): void => { if (!vm) return; void vm.localNovel(book).then(async (local) => { if (!local) throw new Error('本地小说暂不可用，请重新下载'); await useAppStore.getState().openBook(local.id); useAppStore.getState().setRoute('reader'); }).catch((error: unknown) => showToast(error instanceof Error ? error.message : '打开失败')); };
  const busy = state.kind === 'Downloading' || state.kind === 'Pending';
  return <div className="cc-novel-download" aria-label="整本小说下载"><button type="button" className="cc-toolbar__chip" disabled={busy}
    onClick={state.kind === 'Success' ? read : state.kind === 'Paused' ? () => vm?.resumeDownload(key) : start}>
    {state.kind === 'Success' ? '已下载 · 阅读' : state.kind === 'Paused' ? '继续整本下载' : state.kind === 'Downloading' ? `整本下载 ${Math.round(state.progress * 100)}%` : state.kind === 'Pending' ? '等待下载…' : state.kind === 'Error' ? '重试整本下载' : '整本下载'}
  </button>{state.kind === 'Downloading' && <button onClick={() => vm?.pauseDownload(key)}>暂停</button>}{(busy || state.kind === 'Paused') && <button onClick={() => vm?.cancelDownload(key)}>取消</button>}{state.kind === 'Error' && <span role="alert">{state.message}</span>}</div>;
}
