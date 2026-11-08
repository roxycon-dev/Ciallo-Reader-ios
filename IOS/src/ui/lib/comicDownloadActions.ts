import { getLibraryRuntime } from '@core/library/libraryRuntime';
import { ComicSource } from '@core/source/comicSource';
import { createSearchBook } from '@core/source/searchBook';
import { comicChaptersStore, EMPTY_COMIC_DOWNLOAD_SNAPSHOT, type ComicDetailTarget, type ComicDownloadSnapshot } from '@core/comic/comicChapters';
import type { ComicChapter } from '@core/source/comicChapter';
import type { ComicDownloadTask } from '@core/library/libraryComicDownload';
import { showToast } from '@ui/toast';

let previousTasks: Map<string, ComicDownloadTask> | null = null;
let previousTarget = '';
let snapshot: ComicDownloadSnapshot = EMPTY_COMIC_DOWNLOAD_SNAPSHOT;
export function subscribeComicDownloads(listener: () => void): () => void {
  const stop = getLibraryRuntime()?.comicDownloads?.subscribeTasks(listener);
  const stopTarget = comicChaptersStore.subscribe(listener);
  return () => { stop?.(); stopTarget(); };
}
export function currentComicDownloads(): ComicDownloadSnapshot {
  const tasks = getLibraryRuntime()?.comicDownloads?.tasks();
  const target = comicChaptersStore.getSnapshot().target;
  if (!tasks || !target) return EMPTY_COMIC_DOWNLOAD_SNAPSHOT;
  const key = JSON.stringify([target.sourceId, target.comicId]);
  if (tasks === previousTasks && key === previousTarget) return snapshot;
  previousTasks = tasks; previousTarget = key;
  snapshot = { downloading: new Set(), downloaded: new Set(), progress: new Map(), paused: new Set() };
  for (const task of tasks.values()) {
    if (task.book.sourceId !== target.sourceId || task.book.id !== target.comicId) continue;
    snapshot.progress.set(task.chapterId, task.progress);
    if (task.status === 'SUCCESS') snapshot.downloaded.add(task.chapterId);
    if (task.status === 'DOWNLOADING') snapshot.downloading.add(task.chapterId);
    if (task.status === 'PAUSED' || task.status === 'FAILED') snapshot.paused.add(task.chapterId);
  }
  return snapshot;
}
export function startComicDownload(target: ComicDetailTarget, chapter: ComicChapter): void {
  const runtime = getLibraryRuntime();
  const source = runtime?.sourceManager?.getSource(target.sourceId);
  const metadata = target.book ?? comicChaptersStore.getSnapshot().book;
  if (!runtime?.comicDownloads || !(source instanceof ComicSource) || !metadata) { showToast('下载服务或书源尚未准备好，请重试'); return; }
  runtime.comicDownloads.start(createSearchBook({ ...metadata, id: target.comicId, sourceId: target.sourceId, novelInfo: null }), chapter, source);
}
export function controlComicDownload(action: 'pause' | 'resume' | 'cancel', chapter: ComicChapter): void {
  const runtime = getLibraryRuntime(), current = comicChaptersStore.getSnapshot();
  if (!runtime?.comicDownloads || !current.target || !current.book) return;
  const book = createSearchBook({ ...current.book, id: current.target.comicId, sourceId: current.target.sourceId, novelInfo: null });
  if (action === 'resume') {
    const source = runtime.sourceManager?.getSource(current.target.sourceId);
    if (source instanceof ComicSource) runtime.comicDownloads.start(book, chapter, source);
  } else if (action === 'pause') runtime.comicDownloads.pause(chapter.id, book);
  else runtime.comicDownloads.cancel(chapter.id, book);
}
