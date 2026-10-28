/**
 * Sequential download queue — semaphore(maxConcurrent) + HTTP GET with Range resume.
 * HttpClient is injected (platform) so unit tests stay deterministic with mocks.
 * Optional DownloadTaskStore persists task rows (port of Android DownloadTaskDao).
 */

import type { HttpClient, HttpRequest, HttpResponse, HttpHeader } from '../../platform/interfaces';
import type { DownloadTaskRecord, DownloadTaskState, DownloadTaskStore } from './downloadTaskRepository';

export type DownloadStatus =
  | 'PENDING'
  | 'DOWNLOADING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type DownloadEvent =
  | { type: 'progress'; taskId: string; downloadedBytes: number; totalBytes: number }
  | { type: 'completed'; taskId: string; filePath: string; format: string }
  | { type: 'failed'; taskId: string; error: string }
  | { type: 'status'; taskId: string; status: DownloadStatus; error?: string };

export interface DownloadQueueOptions {
  /** default 2 */
  maxConcurrent?: number;
  http: HttpClient;
  now?: () => number;
  repository?: DownloadTaskStore;
}

export interface EnqueueRequest {
  id: string;
  url: string;
  format: string;
  headers?: Record<string, string>;
  filePath: string;
  title?: string;
  author?: string;
  sourceId?: string;
  coverUrl?: string | null;
}

export interface DownloadSnapshotItem {
  id: string;
  status: DownloadStatus;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
  url?: string;
  format?: string;
  filePath?: string;
  title?: string;
  author?: string;
}

type TaskStatus = DownloadStatus;

interface TaskState {
  id: string;
  url: string;
  format: string;
  headers: Record<string, string>;
  filePath: string;
  status: TaskStatus;
  downloadedBytes: number;
  totalBytes: number;
  body: Uint8Array | null;
  error: string | null;
  pauseRequested: boolean;
  cancelRequested: boolean;
  updatedAt: number;
  sourceId: string;
  coverUrl: string | null;
  title?: string;
  author?: string;
}

function headerValue(headers: HttpHeader, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export class DownloadQueue {
  private readonly maxConcurrent: number;
  private readonly http: HttpClient;
  private readonly now: () => number;
  private repository: DownloadTaskStore | null;

  private readonly tasks = new Map<string, TaskState>();
  private readonly pendingIds: string[] = [];
  private readonly listeners = new Set<(e: DownloadEvent) => void>();
  private readonly inFlight = new Set<string>();
  private active = 0;
  private restored = false;

  constructor(opts: DownloadQueueOptions) {
    this.maxConcurrent = opts.maxConcurrent ?? 2;
    this.http = opts.http;
    this.now = opts.now ?? Date.now;
    this.repository = opts.repository ?? null;
  }

  attachRepository(repository: DownloadTaskStore): void {
    if (this.repository === null) {
      this.repository = repository;
    }
  }

  async restore(): Promise<void> {
    const repo = this.repository;
    if (repo === null || this.restored) {
      return;
    }
    const records = await repo.getAllTasks();
    this.restored = true;
    for (const record of records) {
      if (record.status === 'CANCELLED') {
        await repo.deleteTask(record.id);
        continue;
      }
      let status: TaskStatus = record.status;
      if (status === 'PENDING' || status === 'DOWNLOADING') {
        status = 'PAUSED';
        await repo.updateState(record.id, 'PAUSED', null, this.now());
      }
      const state: TaskState = {
        id: record.id,
        url: record.downloadUrl,
        format: record.format,
        headers: {},
        filePath: record.filePath,
        status,
        downloadedBytes: record.downloadedBytes,
        totalBytes: record.totalBytes,
        body: null,
        error: record.errorMessage,
        pauseRequested: false,
        cancelRequested: false,
        updatedAt: record.updatedAt,
        sourceId: record.sourceId,
        coverUrl: record.coverUrl,
        title: record.title,
        author: record.author,
      };
      this.tasks.set(record.id, state);
      this.emitStatus(state);
    }
  }

  enqueue(task: EnqueueRequest): void {
    const existing = this.tasks.get(task.id);
    if (existing && existing.status !== 'FAILED' && existing.status !== 'CANCELLED') {
      return;
    }
    const state: TaskState = {
      id: task.id,
      url: task.url,
      format: task.format,
      headers: { ...(task.headers ?? {}) },
      filePath: task.filePath,
      status: 'PENDING',
      downloadedBytes: existing?.downloadedBytes ?? 0,
      totalBytes: existing?.totalBytes ?? 0,
      body: existing?.body ?? null,
      error: null,
      pauseRequested: false,
      cancelRequested: false,
      updatedAt: this.now(),
      sourceId: task.sourceId ?? '',
      coverUrl: task.coverUrl ?? null,
    };
    if (task.title !== undefined) state.title = task.title;
    if (task.author !== undefined) state.author = task.author;
    this.tasks.set(task.id, state);
    this.pendingIds.push(task.id);
    this.persistInsert(state);
    this.emitStatus(state);
    this.pump();
  }

  pause(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.status === 'PENDING') {
      task.status = 'PAUSED';
      const idx = this.pendingIds.indexOf(taskId);
      if (idx >= 0) this.pendingIds.splice(idx, 1);
      task.updatedAt = this.now();
      this.persistTask(task);
      this.emitStatus(task);
      return;
    }
    if (task.status === 'DOWNLOADING') {
      task.pauseRequested = true;
      task.status = 'PAUSED';
      task.updatedAt = this.now();
      this.persistTask(task);
      this.emitStatus(task);
    }
  }

  resume(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.status !== 'PAUSED' && task.status !== 'FAILED' && task.status !== 'PENDING') return;
    if (this.inFlight.has(taskId) && task.pauseRequested) {
      task.status = 'DOWNLOADING';
      task.updatedAt = this.now();
      this.persistTask(task);
      this.emitStatus(task);
      return;
    }
    task.status = 'PENDING';
    task.pauseRequested = false;
    task.cancelRequested = false;
    task.error = null;
    task.updatedAt = this.now();
    if (!this.pendingIds.includes(taskId)) {
      this.pendingIds.push(taskId);
    }
    this.persistTask(task);
    this.emitStatus(task);
    this.pump();
  }

  cancel(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.cancelRequested = true;
    if (task.status === 'PENDING' || task.status === 'PAUSED' || task.status === 'FAILED') {
      const idx = this.pendingIds.indexOf(taskId);
      if (idx >= 0) this.pendingIds.splice(idx, 1);
      this.tasks.delete(taskId);
      this.persistDelete(taskId);
      this.emit({ type: 'status', taskId, status: 'CANCELLED' });
      return;
    }
    if (task.status === 'DOWNLOADING') {
      task.status = 'CANCELLED';
      task.updatedAt = this.now();
      this.persistDelete(taskId);
      this.emitStatus(task);
      return;
    }
    this.tasks.delete(taskId);
    this.persistDelete(taskId);
    this.emit({ type: 'status', taskId, status: 'CANCELLED' });
  }

  retry(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.status !== 'FAILED' && task.status !== 'CANCELLED') return;
    this.enqueue({
      id: task.id,
      url: task.url,
      format: task.format,
      headers: task.headers,
      filePath: task.filePath,
      sourceId: task.sourceId,
      coverUrl: task.coverUrl,
      ...(task.title !== undefined ? { title: task.title } : {}),
      ...(task.author !== undefined ? { author: task.author } : {}),
    });
  }

  pauseAll(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'PENDING' || task.status === 'DOWNLOADING') {
        this.pause(task.id);
      }
    }
  }

  resumeAll(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'PAUSED' || task.status === 'PENDING') {
        this.resume(task.id);
      }
    }
  }

  clearFinished(): void {
    for (const [id, task] of [...this.tasks.entries()]) {
      if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
        this.tasks.delete(id);
        this.persistDelete(id);
      }
    }
  }

  clearAll(): void {
    for (const id of [...this.tasks.keys()]) {
      this.cancel(id);
    }
    for (const id of [...this.tasks.keys()]) {
      const task = this.tasks.get(id);
      if (task && (task.status === 'COMPLETED' || task.status === 'CANCELLED' || task.status === 'FAILED')) {
        this.tasks.delete(id);
        this.persistDelete(id);
      }
    }
    this.pendingIds.length = 0;
  }

  on(cb: (e: DownloadEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  getSnapshot(): DownloadSnapshotItem[] {
    const out: DownloadSnapshotItem[] = [];
    for (const task of this.tasks.values()) {
      const item: DownloadSnapshotItem = {
        id: task.id,
        status: task.status,
        downloadedBytes: task.downloadedBytes,
        totalBytes: task.totalBytes,
      };
      if (task.error !== null) item.error = task.error;
      item.url = task.url;
      item.format = task.format;
      item.filePath = task.filePath;
      if (task.title !== undefined) item.title = task.title;
      if (task.author !== undefined) item.author = task.author;
      out.push(item);
    }
    return out;
  }

  private toRecord(task: TaskState): DownloadTaskRecord {
    return {
      id: task.id,
      sourceId: task.sourceId,
      title: task.title ?? '',
      author: task.author ?? '',
      coverUrl: task.coverUrl ?? null,
      downloadUrl: task.url,
      format: task.format,
      status: task.status as DownloadTaskState,
      downloadedBytes: task.downloadedBytes,
      totalBytes: task.totalBytes,
      filePath: task.filePath,
      errorMessage: task.error,
      updatedAt: task.updatedAt,
    };
  }

  private persistInsert(task: TaskState): void {
    const repo = this.repository;
    if (repo === null) return;
    void repo.insertTask(this.toRecord(task));
  }

  private persistTask(task: TaskState): void {
    const repo = this.repository;
    if (repo === null) return;
    void repo.updateTask(this.toRecord(task));
  }

  private persistDelete(id: string): void {
    const repo = this.repository;
    if (repo === null) return;
    void repo.deleteTask(id);
  }

  private persistProgress(task: TaskState): void {
    const repo = this.repository;
    if (repo === null) return;
    void repo.updateProgress(task.id, task.downloadedBytes, task.totalBytes, task.updatedAt);
  }

  private emitStatus(task: TaskState): void {
    const event: DownloadEvent = { type: 'status', taskId: task.id, status: task.status };
    if (task.error !== null) event.error = task.error;
    this.emit(event);
  }

  private emit(e: DownloadEvent): void {
    for (const cb of [...this.listeners]) cb(e);
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.pendingIds.length > 0) {
      const id = this.pendingIds.shift();
      if (id === undefined) break;
      const task = this.tasks.get(id);
      if (!task || task.status !== 'PENDING') continue;
      this.active += 1;
      task.status = 'DOWNLOADING';
      task.updatedAt = this.now();
      this.inFlight.add(id);
      this.persistTask(task);
      this.emitStatus(task);
      void this.runTask(task).finally(() => {
        this.inFlight.delete(task.id);
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async runTask(task: TaskState): Promise<void> {
    const resumeFrom = task.body !== null ? task.downloadedBytes : 0;
    const headers: Record<string, string> = { ...task.headers };
    const ranged = resumeFrom > 0 && !hasHeader(headers, 'Range');
    if (ranged) {
      headers['Range'] = `bytes=${resumeFrom}-`;
    }

    let res: HttpResponse;
    try {
      const req: HttpRequest = { url: task.url, method: 'GET', headers };
      res = await this.http.request(req);
    } catch (err) {
      this.failTask(task, err instanceof Error ? err.message : String(err));
      return;
    }

    const received = res.body;

    if (task.cancelRequested) {
      this.tasks.delete(task.id);
      this.persistDelete(task.id);
      this.emit({ type: 'status', taskId: task.id, status: 'CANCELLED' });
      return;
    }
    if (task.pauseRequested) {
      const merged = this.mergeBody(task, ranged, resumeFrom, received);
      task.body = merged;
      task.downloadedBytes = merged.length;
      if (task.totalBytes <= 0) {
        task.totalBytes = this.inferTotalBytes(resumeFrom, res, merged.length);
      }
      task.status = 'PAUSED';
      task.pauseRequested = false;
      task.updatedAt = this.now();
      this.persistTask(task);
      this.emitStatus(task);
      return;
    }
    if (res.status !== 200 && res.status !== 206) {
      this.failTask(task, `HTTP ${res.status}`);
      return;
    }
    if (ranged && res.status !== 206) {
      this.failTask(task, `expected 206 for ranged resume, got ${res.status}`);
      return;
    }

    const mergedBody = this.mergeBody(task, ranged, resumeFrom, received);
    task.body = mergedBody;
    task.downloadedBytes = mergedBody.length;
    task.totalBytes = this.inferTotalBytes(resumeFrom, res, mergedBody.length);

    this.emit({
      type: 'progress',
      taskId: task.id,
      downloadedBytes: task.downloadedBytes,
      totalBytes: task.totalBytes,
    });
    this.persistProgress(task);

    task.status = 'COMPLETED';
    task.updatedAt = this.now();
    this.persistTask(task);
    this.emitStatus(task);
    this.emit({
      type: 'completed',
      taskId: task.id,
      filePath: task.filePath,
      format: task.format,
    });
  }

  private mergeBody(task: TaskState, ranged: boolean, resumeFrom: number, received: Uint8Array): Uint8Array {
    if (ranged && resumeFrom > 0 && task.body !== null) {
      return concatBytes(task.body, received);
    }
    return received;
  }

  private inferTotalBytes(
    resumeFrom: number,
    res: HttpResponse,
    downloaded: number,
  ): number {
    const contentLength = headerValue(res.headers, 'content-length');
    if (res.status === 206) {
      const contentRange = headerValue(res.headers, 'content-range');
      const slash = contentRange !== undefined ? contentRange.lastIndexOf('/') : -1;
      const totalStr = contentRange !== undefined && slash >= 0 ? contentRange.slice(slash + 1).trim() : '';
      const parsed = Number.parseInt(totalStr, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
      if (contentLength !== undefined) {
        const n = Number.parseInt(contentLength, 10);
        return Number.isFinite(n) ? resumeFrom + n : downloaded;
      }
      return downloaded;
    }
    const n = contentLength !== undefined ? Number.parseInt(contentLength, 10) : Number.NaN;
    return Number.isFinite(n) ? n : downloaded;
  }

  private failTask(task: TaskState, error: string): void {
    task.status = 'FAILED';
    task.error = error;
    task.updatedAt = this.now();
    this.persistTask(task);
    this.emitStatus(task);
    this.emit({ type: 'failed', taskId: task.id, error });
  }
}

let sharedQueue: DownloadQueue | null = null;

export function getOrCreateDownloadQueue(options: DownloadQueueOptions): DownloadQueue {
  if (sharedQueue === null) {
    sharedQueue = new DownloadQueue(options);
    return sharedQueue;
  }
  if (options.repository !== undefined) {
    sharedQueue.attachRepository(options.repository);
  }
  return sharedQueue;
}

export function resetSharedDownloadQueue(): void {
  sharedQueue = null;
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const kb = bytes / 1024;
  if (kb < 1024) return `${String(Math.round(kb))} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function downloadProgressRatio(item: DownloadSnapshotItem): number {
  if (item.status === 'COMPLETED') return 1;
  if (item.totalBytes <= 0) return 0;
  return Math.min(1, Math.max(0, item.downloadedBytes / item.totalBytes));
}
