import { ComicDownloadManager, type ComicDownloadTaskRunner } from '@core/library/libraryComicDownload';
import { AsyncMutex, contentMutationGate } from '@core/library/contentMutationGate';
import { abortable, throwIfAborted } from '@core/download/abortable';

/** Unique jobs retain their lock until every page writer has drained. */
export class AppComicTaskRunner implements ComicDownloadTaskRunner {
  private readonly jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  constructor(private readonly run: (id: string, signal: AbortSignal) => Promise<unknown>,
    private readonly onError: (error: unknown) => void) {}
  async isActive(name: string): Promise<boolean> { return this.jobs.has(name); }
  async enqueueUniqueWork(name: string, _policy: 'KEEP', taskId: string): Promise<void> {
    if (this.jobs.has(name)) return;
    const controller = new AbortController();
    const done = Promise.resolve().then(async () => {
      throwIfAborted(controller.signal);
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        let connected: () => void = () => {};
        try { await abortable(new Promise<void>((resolve) => {
          connected = resolve; window.addEventListener('online', connected, { once: true });
        }), controller.signal); }
        finally { window.removeEventListener('online', connected); }
      }
      await this.run(taskId, controller.signal);
    }).catch((error: unknown) => {
      if (!(error instanceof Error && error.name === 'AbortError')) this.onError(error);
    }).finally(() => { if (this.jobs.get(name)?.controller === controller) this.jobs.delete(name); });
    this.jobs.set(name, { controller, done });
  }
  async cancelUniqueWork(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) return;
    job.controller.abort();
    await job.done;
  }
}

export function comicTaskLocks(): <T>(key: string, block: () => Promise<T>) => Promise<T> {
  const locks = new Map<string, { mutex: AsyncMutex; users: number }>();
  return async (key, block) => {
    let entry = locks.get(key);
    if (!entry) { entry = { mutex: new AsyncMutex(), users: 0 }; locks.set(key, entry); }
    entry.users++;
    try { return await entry.mutex.withLock(block); }
    finally { if (--entry.users === 0) locks.delete(key); }
  };
}

export { ComicDownloadManager, contentMutationGate };
