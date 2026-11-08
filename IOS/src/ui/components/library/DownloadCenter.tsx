import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { originalBookId, taskId } from '@core/download/downloadManager';
import { DownloadStatePending, downloadingState, errorState, pausedState, successState, type DownloadState } from '@core/download/downloadState';
import type { DownloadTaskRecord } from '@core/download/downloadTaskRepository';
import { comicDownloadTaskId, type ComicDownloadTask } from '@core/library/libraryComicDownload';
import { getLibraryRuntime, type LibraryRuntime } from '@core/library/libraryRuntime';
import { createSearchBook } from '@core/source/searchBook';
import { useAppStore } from '@ui/state/appStore';
import {
  createPaperPageTransitionController,
  type PaperOriginInput,
  type PaperPageTransitionController,
} from '@ui/shared/paperPageTransition';
import '../../../styles/library.css';

let opened = false;
let presenting = false;
let openingOrigin: PaperOriginInput = null;
let openingFocusTarget: HTMLElement | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const get = () => opened;
const getPresent = () => presenting;
const setOpen = (value: boolean) => { if (opened === value) return; opened = value; for (const fn of listeners) fn(); };
function currentTriggerOrigin(): PaperOriginInput {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  if (active === null || typeof (active as Element).getBoundingClientRect !== 'function') return null;
  return active;
}
function requestOpen(origin: PaperOriginInput): void {
  if (opened) return;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  openingFocusTarget = typeof HTMLElement !== 'undefined' && active instanceof HTMLElement
    ? active
    : null;
  openingOrigin = origin;
  presenting = true;
  setOpen(true);
}
/** Existing zero-argument click handler; it captures a focused trigger when available. */
export const openDownloadCenter = () => requestOpen(currentTriggerOrigin());
/** Optional adapter for click handlers that can pass the actual paper source element. */
export const openDownloadCenterFromTrigger = (origin: PaperOriginInput) => requestOpen(origin);
export const closeDownloadCenter = () => setOpen(false);

export function downloadStatusLabel(state: DownloadState): string {
  switch (state.kind) {
    case 'Pending': return '准备下载 · 获取文件与可用线路';
    case 'Downloading': return state.progress >= 1 ? '校验文件并存入书架…' :
      state.totalBytes > 0 || state.progress > 0 ? '下载中 · ' + Math.trunc(state.progress * 100) + '%' : '下载中 · 总大小未知';
    case 'Paused': return '已暂停';
    case 'Success': return '已完成 · 已存入书架';
    case 'Error': return '下载失败';
    case 'Idle': return '等待下载';
  }
}

const bytes = (n: number) => n < 0 ? '未知大小' : n < 1024 ? n + ' B' :
  n < 1024 ** 2 ? (n / 1024).toFixed(1) + ' KB' : (n / 1024 ** 2).toFixed(1) + ' MB';

function novelState(task: DownloadTaskRecord): DownloadState {
  switch (task.status) {
    case 'COMPLETED': return successState(task.filePath);
    case 'DOWNLOADING': return downloadingState(task.downloadedBytes, task.totalBytes, task.totalBytes > 0 ? Math.min(1, task.downloadedBytes / task.totalBytes) : 0);
    case 'PAUSED': return pausedState(task.downloadedBytes, task.totalBytes);
    case 'FAILED': return errorState(task.errorMessage || '下载失败');
    default: return DownloadStatePending;
  }
}

function comicState(task: ComicDownloadTask): DownloadState {
  switch (task.status) {
    case 'DOWNLOADING': return downloadingState(0, 0, task.progress);
    case 'PAUSED': return pausedState(0, 0);
    case 'FAILED': return errorState(task.error || '下载失败');
    case 'SUCCESS': return successState('');
  }
}

function DownloadRow({ title, subtitle, state, pause, resume, remove, retry }: {
  title: string; subtitle: string; state: DownloadState; pause(): void; resume(): void; remove(): void; retry(): void;
}) {
  return <li className="download-center__task">
    <div className="download-center__row">
      <div className="download-center__book"><strong>{title}</strong><small>{subtitle}</small></div>
      {state.kind === 'Downloading' && <button type="button" className="lib-icon-button" aria-label="暂停" onClick={pause}>Ⅱ</button>}
      {state.kind === 'Paused' && <button type="button" className="lib-icon-button" aria-label="继续" onClick={resume}>▶</button>}
      {state.kind === 'Error' && <button type="button" className="lib-icon-button" aria-label="重新获取并重试" onClick={retry}>↻</button>}
      <button type="button" className="lib-icon-button" aria-label="删除记录" onClick={remove}>×</button>
    </div>
    <p className={state.kind === 'Error' ? 'download-center__error' : 'download-center__status'}>{downloadStatusLabel(state)}</p>
    {state.kind === 'Pending' && <progress aria-label="准备下载" />}
    {state.kind === 'Downloading' && <>
      <progress aria-label="下载进度" max={1} value={state.totalBytes > 0 || state.progress > 0 ? Math.min(1, Math.max(0, state.progress)) : undefined} />
      {state.downloadedBytes > 0 && <small>{bytes(state.downloadedBytes)} / {bytes(state.totalBytes > 0 ? state.totalBytes : -1)}</small>}
    </>}
    {state.kind === 'Error' && <small className="download-center__error">{state.message}</small>}
  </li>;
}

function DownloadCenter({ runtime, visible, origin, onDismissComplete }: {
  runtime: LibraryRuntime;
  visible: boolean;
  origin: PaperOriginInput;
  onDismissComplete(): void;
}) {
  const vm = runtime.viewModel;
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const controllerRef = useRef<PaperPageTransitionController | null>(null);
  const visibleRef = useRef(visible);
  useLayoutEffect(() => { visibleRef.current = visible; }, [visible]);
  const [tasks, setTasks] = useState<DownloadTaskRecord[]>([]);
  const [states, setStates] = useState<Map<string, DownloadState>>(new Map());
  const [preps, setPreps] = useState(() => vm.preparingDownloadsState.value);
  const [comics, setComics] = useState(() => [...(runtime.comicDownloads?.tasks().values() ?? [])]);
  const [picking, setPicking] = useState(vm.formatPickerBookState.value !== null);
  const [deletion, setDeletion] = useState<{ title: string; run(): void } | null>(null);
  const updateBackdrop = useCallback((progress: number) => {
    const overlay = overlayRef.current;
    if (overlay === null) return;
    overlay.style.setProperty('--download-center-scrim-center', String(0.25 * progress));
    overlay.style.setProperty('--download-center-scrim-edge', String(0.35 * progress));
  }, []);
  useLayoutEffect(() => {
    if (picking) {
      controllerRef.current?.dispose();
      controllerRef.current = null;
      if (!visible) onDismissComplete();
      return;
    }
    const sheet = sheetRef.current;
    if (sheet === null) return;
    let controller = controllerRef.current;
    if (controller === null) {
      controller = createPaperPageTransitionController(sheet, {
        origin,
        mode: 'paper',
        initialProgress: visible ? 0 : 1,
        onProgress: updateBackdrop,
      });
      controllerRef.current = controller;
    } else controller.setOrigin(origin);

    let cancelled = false;
    void (visible ? controller.open() : controller.close()).then((result) => {
      if (!cancelled && result === 'finished' && !visibleRef.current) onDismissComplete();
    });
    return () => { cancelled = true; };
  }, [visible, origin, picking, onDismissComplete, updateBackdrop]);
  useLayoutEffect(() => () => {
    controllerRef.current?.dispose();
    controllerRef.current = null;
  }, []);
  const dismiss = useCallback(() => { setDeletion(null); closeDownloadCenter(); }, []);
  useEffect(() => {
    let disposed = false, signature: string | undefined, revision = 0;
    const update = (next: Map<string, DownloadState>) => {
      if (disposed) return;
      setStates(next);
      const fingerprint = [...next].map(([key, state]) => key + ':' + state.kind).join('|');
      if (fingerprint === signature) return;
      signature = fingerprint;
      const current = ++revision;
      void vm.allDownloadTasks().then((rows) => { if (!disposed && current === revision) setTasks(rows); }).catch(() => {});
    };
    void vm.downloadStates().then(update).catch(() => {});
    const offStates = vm.subscribeDownloadStates(update);
    const offPreps = vm.preparingDownloadsState.subscribe(setPreps);
    const offPicker = vm.formatPickerBookState.subscribe((book) => setPicking(book !== null));
    const offComics = runtime.comicDownloads?.subscribeTasks((items) => setComics([...items.values()]));
    return () => { disposed = true; offStates(); offPreps(); offPicker(); offComics?.(); };
  }, [runtime, vm]);
  useEffect(() => {
    const back = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || picking || !visible) return;
      event.stopPropagation(); event.preventDefault();
      if (deletion) setDeletion(null); else dismiss();
    };
    window.addEventListener('keydown', back, true);
    return () => window.removeEventListener('keydown', back, true);
  }, [deletion, dismiss, picking, visible]);
  const sorted = [...tasks].sort((a, b) => Number(a.status === 'COMPLETED') - Number(b.status === 'COMPLETED') || b.updatedAt - a.updatedAt);
  const persisted = new Set(tasks.map((task) => taskId(task.sourceId, originalBookId(task.id, task.sourceId))));
  const preparations = [...preps].filter(([key]) => !persisted.has(key));
  const actions = (key: string, title: string, retry: () => void) => ({
    pause: () => vm.pauseDownload(key), resume: () => vm.resumeDownload(key), retry,
    remove: () => setDeletion({ title, run: () => vm.cancelDownload(key) }),
  });
  if (picking) return null;
  return <div ref={overlayRef} className="download-center__overlay" aria-hidden={!visible} onClick={dismiss}>
    <section ref={sheetRef} className="download-center" role="dialog" aria-modal="true" aria-hidden={!visible} inert={!visible} aria-label="下载任务" data-testid="download_task_panel" onClick={(event) => event.stopPropagation()}>
      <header className="download-center__row"><h2>下载任务</h2><button type="button" className="lib-sheet__text-button" onClick={dismiss}>收起</button></header>
      <p className="download-center__hint">后台继续下载，完成记录保留。</p>
      <ul className="download-center__list">
        {preparations.map(([key, prep]) => <DownloadRow key={'prep:' + key} title={prep.book.title} subtitle={prep.book.sourceId} state={prep.state}
          {...actions(key, prep.book.title, () => vm.startDownloadWithFormat(prep.book, prep.book.format || null))} />)}
        {sorted.map((task) => {
          const id = originalBookId(task.id, task.sourceId), key = taskId(task.sourceId, id);
          const state = states.get(key) ?? novelState(task);
          const book = createSearchBook({ id, sourceId: task.sourceId, title: task.title, author: task.author, format: task.format, cover: task.coverUrl });
          return <DownloadRow key={task.id} title={task.title} subtitle={task.format.toUpperCase() + ' · ' + task.sourceId} state={state}
            {...actions(key, task.title, () => vm.startDownloadWithFormat(book, task.format || null))} />;
        })}
        {comics.map((task) => {
          const key = comicDownloadTaskId(task.book, task.chapterId), resume = () => vm.downloadComicChapter(task.book, task.chapter);
          return <DownloadRow key={'comic:' + key} title={task.book.title} subtitle={task.chapter.title + ' · ' + task.book.sourceId} state={comicState(task)}
            pause={() => vm.pauseComicChapter(key)} resume={resume} retry={resume}
            remove={() => setDeletion({ title: task.book.title, run: () => vm.cancelComicChapter(key) })} />;
        })}
        {!preparations.length && !sorted.length && !comics.length && <li className="download-center__empty">暂无下载任务</li>}
      </ul>
    </section>
    {deletion && visible && <div className="download-center__confirm-shade" onClick={(event) => { event.stopPropagation(); setDeletion(null); }}>
      <div className="lib-dialog" role="alertdialog" aria-modal="true" aria-label="删除下载记录？" onClick={(event) => event.stopPropagation()}>
        <h3 className="lib-dialog__title">删除下载记录？</h3>
        <p className="lib-dialog__subtitle">“{deletion.title}”的记录将被删除；未完成的下载会停止，已存入书架的书籍保留。</p>
        <div className="download-center__confirm-actions">
          <button type="button" className="lib-sheet__text-button" onClick={() => setDeletion(null)}>保留</button>
          <button type="button" className="lib-sheet__text-button" onClick={() => { setDeletion(null); deletion.run(); }}>删除</button>
        </div>
      </div>
    </div>}
  </div>;
}

export function GlobalDownloadCenter() {
  const visible = useSyncExternalStore(subscribe, get, get);
  const present = useSyncExternalStore(subscribe, getPresent, getPresent);
  const ready = useAppStore((state) => state.libraryReady);
  const runtime = ready ? getLibraryRuntime() : null;
  const onDismissComplete = useCallback(() => {
    if (get()) return;
    const focusTarget = openingFocusTarget;
    openingFocusTarget = null;
    openingOrigin = null;
    if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    presenting = false;
    for (const listener of listeners) listener();
  }, []);
  return (visible || present) && runtime
    ? createPortal(<DownloadCenter runtime={runtime} visible={visible} origin={openingOrigin} onDismissComplete={onDismissComplete} />, document.body)
    : null;
}
