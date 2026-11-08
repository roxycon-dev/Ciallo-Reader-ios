import { DownloadManager, withControlLock } from '@core/download/downloadManager';
import { describe, expect, it, vi } from 'vitest';
import { performDownloadTask } from '@core/download/downloadWorker';
import { DownloadProgressBroadcaster } from '@core/download/downloadProgressBroadcaster';
import { NovelDownloadStore } from '@core/download/novelDownloadStore';
import type { DownloadTaskRecord, DownloadTaskStore } from '@core/download/downloadTaskRepository';
import type { FileSystemApi, HttpClient, HttpRequest, HttpStreamResponse } from '@platform/interfaces';
import { MemoryFileSystem } from '@platform/web-mock/memoryFileSystem';
import { MemorySecureStore } from '@platform/web-mock/memorySecureStore';

function fixture() {
  const memory = new MemoryFileSystem(), secure = new MemorySecureStore(), rows = new Map<string, DownloadTaskRecord>();
  const task: DownloadTaskRecord = { id: 'fixture', sourceId: 'fixture', title: '下载小说', author: '', coverUrl: null, downloadUrl: 'https://fixture.test/book.txt', format: 'txt', status: 'PENDING', downloadedBytes: 0, totalBytes: 0, filePath: 'downloads/book.txt', errorMessage: null, updatedAt: 1 }; rows.set(task.id, task);
  const save = async (row: DownloadTaskRecord) => { rows.set(row.id, { ...row }); };
  const dao: DownloadTaskStore = {
    insertTask: save, insertOrUpdate: save, updateTask: save, getTask: async (id) => rows.get(id) ?? null, deleteTask: async (id) => { rows.delete(id); },
    getActiveTasks: async () => [...rows.values()], getAllTasks: async () => [...rows.values()], getTasksByBook: async () => [],
    updateProgress: async (id, downloadedBytes, totalBytes) => { rows.set(id, { ...rows.get(id)!, downloadedBytes, totalBytes }); },
    updateState: async (id, status) => { rows.set(id, { ...rows.get(id)!, status }); },
    updateProgressAndStatus: async (id, status, downloadedBytes, totalBytes, errorMessage) => { rows.set(id, { ...rows.get(id)!, status, downloadedBytes, totalBytes, errorMessage: errorMessage ?? null }); },
  };
  const fs: FileSystemApi = { readFile: (path) => memory.readFile(path), writeFile: (path, data) => memory.writeFile(path, data), writeFileAtomic: (path, data) => memory.writeFile(path, data),
    exists: (path) => memory.exists(path), delete: (path) => memory.delete(path), list: (path) => memory.list(path), size: vi.fn((path) => memory.size(path)), move: vi.fn((from, to) => memory.move(from, to)),
    appendFile: vi.fn(async (path, bytes) => { const old = await memory.readFile(path), next = new Uint8Array(old.length + bytes.length); next.set(old); next.set(bytes, old.length); await memory.writeFile(path, next); }),
  };
  const novels = new NovelDownloadStore({ getString: async () => null, putString: async () => true, remove: async () => {} });
  return { fs, dao, rows, task, secure, novels, broadcaster: new DownloadProgressBroadcaster() };
}
describe('download worker durable partial files and cancellation', () => {
  it('keeps completed download history after restart and removes only the record on request', async () => {
    const scenario = fixture(), bytes = new TextEncoder().encode('已下载内容');
    await scenario.fs.writeFile(scenario.task.filePath, bytes);
    await scenario.dao.updateState(scenario.task.id, 'COMPLETED');
    const manager = new DownloadManager({ ...scenario, secrets: scenario.secure, downloadsDir: 'downloads',
      http: { request: async () => { throw new Error('history must not download anything'); } },
      books: { getAllBooksSync: async () => [], getBookBySourceResource: async () => null },
    });
    await manager.whenRestored();
    expect(await manager.getAllTasks()).toMatchObject([{ id: scenario.task.id, status: 'COMPLETED' }]);
    await manager.cancelDownload(scenario.task.id);
    expect(await scenario.dao.getTask(scenario.task.id)).toBeNull();
    expect(await scenario.fs.readFile(scenario.task.filePath)).toEqual(bytes);
  });

  it('keeps the paused prefix and resumes with Range/If-Range without duplicating or losing bytes', async () => {
    const scenario = fixture(), bytes = new Uint8Array(128 * 1024 + 17).fill(65), first = new AbortController(), append = scenario.fs.appendFile!;
    let interrupted = false; scenario.fs.appendFile = vi.fn(async (path, chunk) => { await append(path, chunk); if (!interrupted) { interrupted = true; first.abort(); } });
    const seen: HttpRequest[] = [];
    const consume = async <T,>(request: HttpRequest, consumer: (response: HttpStreamResponse) => Promise<T>): Promise<T> => {
      seen.push(request);
      const offset = request.headers?.Range ? 64 * 1024 : 0;
      if (offset) expect(request.headers?.['If-Range']).toBe('"edition-1"');
      async function* chunks() {
        for (let cursor = offset; cursor < bytes.length; cursor += 64 * 1024) yield bytes.subarray(cursor, cursor + 64 * 1024);
      }
      return consumer({ status: offset ? 206 : 200, headers: { etag: '"edition-1"', 'content-range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` },
        url: request.url, size: bytes.length - offset, chunks: chunks() });
    };
    const http: HttpClient = { consume, request: vi.fn(async () => { throw new Error('should not buffer response'); }) };
    const deps = { ...scenario, secrets: scenario.secure, http, downloadsDir: 'downloads' };
    await expect(performDownloadTask('fixture', { ...deps, signal: first.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(scenario.rows.get('fixture')).toMatchObject({ status: 'PAUSED', downloadedBytes: 64 * 1024 }); expect(await scenario.fs.size!('downloads/book.tmp')).toBe(64 * 1024);
    await scenario.dao.updateState('fixture', 'PENDING'); expect(await performDownloadTask('fixture', { ...deps, signal: new AbortController().signal })).toBe('success');
    expect(http.request).not.toHaveBeenCalled(); expect(seen[1]!.headers?.Range).toBe('bytes=65536-'); expect(await scenario.fs.readFile('downloads/book.txt')).toEqual(bytes); expect(scenario.rows.get('fixture')?.status).toBe('COMPLETED'); expect(scenario.fs.move).toHaveBeenCalledOnce(); expect(await scenario.fs.exists('downloads/book.tmp')).toBe(false);
  });
  it('replaces an expired Z-Library link once using the failed mirror and the new credentials', async () => {
    const scenario = fixture(), first = 'https://old.fixture.test/book.txt', second = 'https://new.fixture.test/book.txt';
    const text = new TextEncoder().encode('新链接取得的小说正文');
    scenario.rows.set('fixture', { ...scenario.task, sourceId: 'zlibrary', downloadUrl: first });
    await scenario.secure.set('download:fixture', JSON.stringify({ Referer: 'https://old.fixture.test/', Cookie: 'old=1' }));
    const http: HttpClient = { request: vi.fn(async (req) => {
      if (req.url === first) return { status: 403, headers: {}, url: req.url, body: new Uint8Array() };
      expect(req.url).toBe(second);
      expect(req.headers).toMatchObject({ Referer: 'https://new.fixture.test/', Cookie: 'new=1' });
      return { status: 200, headers: {}, url: req.url, body: text };
    }) };
    const recoverZLibraryDownload = vi.fn(async (_task: DownloadTaskRecord, excluded: ReadonlySet<string>) => {
      expect([...excluded]).toEqual(['old.fixture.test']);
      return { kind: 'success' as const, data: { url: second, headers: { Cookie: 'new=1' }, referer: 'https://new.fixture.test/',
        fileName: 'book.txt', format: 'txt', size: text.length } };
    });
    const result = await performDownloadTask('fixture', { ...scenario, secrets: scenario.secure, http, recoverZLibraryDownload, downloadsDir: 'downloads' });
    expect(result).toBe('success');
    expect(recoverZLibraryDownload).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(await scenario.fs.readFile(scenario.task.filePath))).toBe(new TextDecoder().decode(text));
    expect(scenario.rows.get('fixture')).toMatchObject({ status: 'COMPLETED', downloadUrl: second });
  });

  it('holds tasks offline, resumes on connection and keeps user-paused tasks paused', async () => {
    const scenario = fixture();
    let online = false, listener: (() => void) | undefined, started = 0;
    const manager = new DownloadManager({ ...scenario, secrets: scenario.secure, downloadsDir: 'downloads',
      http: { request: async () => { throw new Error('fixture worker owns the request'); } },
      books: { getAllBooksSync: async () => [], getBookBySourceResource: async () => null },
      connectivity: { connected: async () => online, async subscribe(callback) { listener = () => callback(online); return () => {}; } },
      runWorker: async (_id, deps) => {
        started++;
        await new Promise<void>((resolve) => { deps.signal!.addEventListener('abort', () => resolve(), { once: true }); });
        return 'skipped';
      },
    });
    const drain = () => withControlLock(async () => {});
    await manager.whenRestored(); await drain();
    expect(started).toBe(0);
    online = true; listener?.(); await drain();
    expect(started).toBe(1);
    online = false; listener?.(); await drain();
    expect(scenario.rows.get('fixture')?.status).toBe('PENDING');
    await manager.pauseDownload('fixture');
    online = true; listener?.(); await drain();
    expect(scenario.rows.get('fixture')?.status).toBe('PAUSED');
    expect(started).toBe(1);
    manager.dispose();
  });

  it('passes pause cancellation into a request that has not returned its body and records PAUSED', async () => {
    const scenario = fixture(), controller = new AbortController(); let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const http: HttpClient = { request: (request) => new Promise((_resolve, reject) => { expect(request.signal).toBe(controller.signal); request.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); started(); }) };
    const downloading = performDownloadTask('fixture', { ...scenario, secrets: scenario.secure, http, downloadsDir: 'downloads', signal: controller.signal }), rejected = expect(downloading).rejects.toMatchObject({ name: 'AbortError' });
    await ready; controller.abort(); await rejected; expect(scenario.rows.get('fixture')).toMatchObject({ status: 'PAUSED', downloadedBytes: 0 });
  });
});
