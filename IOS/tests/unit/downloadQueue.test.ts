import { describe, expect, it } from 'vitest';
import { openAppDatabase } from '../../src/core/db/openDatabase';
import {
  DownloadQueue,
  downloadProgressRatio,
  formatByteSize,
  getOrCreateDownloadQueue,
  resetSharedDownloadQueue,
  type DownloadEvent,
} from '../../src/core/download/downloadQueue';
import { DownloadTaskRepository } from '../../src/core/download/downloadTaskRepository';
import type { HttpClient, HttpRequest, HttpResponse } from '../../src/platform/interfaces';
import { InMemorySqliteDatabase } from '../../src/platform/web-mock/inMemoryDb';

function okResponse(url: string, body: Uint8Array, extraHeaders?: Record<string, string>): HttpResponse {
  return {
    status: 200,
    headers: { 'content-length': String(body.length), ...(extraHeaders ?? {}) },
    body,
    url,
  };
}

function deferredHttp(responses: HttpResponse[] | ((req: HttpRequest, index: number) => Promise<HttpResponse>)): {
  http: HttpClient;
  calls: HttpRequest[];
} {
  const calls: HttpRequest[] = [];
  const http: HttpClient = {
    request(req: HttpRequest): Promise<HttpResponse> {
      calls.push(req);
      if (typeof responses === 'function') {
        return responses(req, calls.length - 1);
      }
      const res = responses[calls.length - 1];
      if (!res) return Promise.reject(new Error(`unexpected request #${calls.length}`));
      return Promise.resolve({ ...res, url: req.url });
    },
  };
  return { http, calls };
}

async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

async function until(cond: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`condition not met: ${label}`);
}

describe('DownloadQueue', () => {
  it('enqueues one task → completed event with bytes', async () => {
    const body = new Uint8Array([10, 20, 30, 40]);
    const { http, calls } = deferredHttp([okResponse('https://x.test/a.epub', body)]);
    const q = new DownloadQueue({ http, maxConcurrent: 2 });

    const events: DownloadEvent[] = [];
    const unsub = q.on((e) => events.push(e));

    q.enqueue({
      id: 't1',
      url: 'https://x.test/a.epub',
      format: 'epub',
      filePath: '/books/a.epub',
      title: '样例书',
      author: '作者甲',
    });

    await until(() => events.some((e) => e.type === 'completed'), 'completed event');
    unsub();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://x.test/a.epub');
    expect(calls[0]?.method).toBe('GET');

    const progress = events.find((e) => e.type === 'progress');
    expect(progress).toEqual({
      type: 'progress',
      taskId: 't1',
      downloadedBytes: 4,
      totalBytes: 4,
    });

    const completed = events.find((e) => e.type === 'completed');
    expect(completed).toEqual({
      type: 'completed',
      taskId: 't1',
      filePath: '/books/a.epub',
      format: 'epub',
    });

    const snap = q.getSnapshot();
    expect(snap).toEqual([
      {
        id: 't1',
        status: 'COMPLETED',
        downloadedBytes: 4,
        totalBytes: 4,
        url: 'https://x.test/a.epub',
        format: 'epub',
        filePath: '/books/a.epub',
        title: '样例书',
        author: '作者甲',
      },
    ]);
  });

  it('maxConcurrent=2 runs at most 2 downloads; third waits', async () => {
    const resolvers: Array<(res: HttpResponse) => void> = [];
    const calls: HttpRequest[] = [];
    const http: HttpClient = {
      request(req: HttpRequest): Promise<HttpResponse> {
        calls.push(req);
        return new Promise((resolve) => {
          resolvers.push((res) => resolve({ ...res, url: req.url }));
        });
      },
    };
    const q = new DownloadQueue({ http, maxConcurrent: 2 });

    const events: DownloadEvent[] = [];
    q.on((e) => events.push(e));

    for (const id of ['t1', 't2', 't3']) {
      q.enqueue({
        id,
        url: `https://x.test/${id}.bin`,
        format: 'bin',
        filePath: `/books/${id}.bin`,
      });
    }

    await flush();
    expect(calls).toHaveLength(2);
    expect(q.getSnapshot().map((s) => s.status).sort()).toEqual([
      'DOWNLOADING',
      'DOWNLOADING',
      'PENDING',
    ]);

    const b1 = new Uint8Array([1]);
    const b2 = new Uint8Array([2, 2]);
    const b3 = new Uint8Array([3, 3, 3]);
    resolvers[0]?.(okResponse(calls[0]?.url ?? '', b1));
    await until(() => calls.length === 3, 'third request started');

    resolvers[1]?.(okResponse(calls[1]?.url ?? '', b2));
    resolvers[2]?.(okResponse(calls[2]?.url ?? '', b3));
    await until(
      () => q.getSnapshot().every((s) => s.status === 'COMPLETED'),
      'all completed',
    );

    const completedIds = events
      .filter((e): e is Extract<DownloadEvent, { type: 'completed' }> => e.type === 'completed')
      .map((e) => e.taskId)
      .sort();
    expect(completedIds).toEqual(['t1', 't2', 't3']);
  });

  it('checkpoints bytes on pause and resumes with Range header, validating 206', async () => {
    const part1 = new Uint8Array([1, 2, 3]);
    const part2 = new Uint8Array([4, 5]);
    const calls: HttpRequest[] = [];
    const pendings: Array<(res: HttpResponse) => void> = [];
    const http: HttpClient = {
      request(req: HttpRequest): Promise<HttpResponse> {
        calls.push(req);
        return new Promise((resolve) => {
          pendings.push((res) => resolve({ ...res, url: req.url }));
        });
      },
    };
    const q = new DownloadQueue({ http, maxConcurrent: 1 });

    const events: DownloadEvent[] = [];
    q.on((e) => events.push(e));

    q.enqueue({ id: 'r1', url: 'https://x.test/r.bin', format: 'bin', filePath: '/r.bin' });
    await until(() => calls.length === 1, 'first request started');
    expect(q.getSnapshot()[0]?.status).toBe('DOWNLOADING');

    q.pause('r1');
    pendings[0]?.(okResponse('https://x.test/r.bin', part1));
    await until(() => q.getSnapshot()[0]?.status === 'PAUSED', 'paused after checkpoint');

    const paused = q.getSnapshot()[0];
    expect(paused?.downloadedBytes).toBe(3);
    expect(events.some((e) => e.type === 'completed')).toBe(false);

    q.resume('r1');
    await until(() => calls.length === 2, 'resume request started');
    expect(calls[1]?.headers?.['Range']).toBe('bytes=3-');

    pendings[1]?.({
      status: 206,
      headers: { 'content-range': 'bytes 3-4/5', 'content-length': '2' },
      body: part2,
      url: 'https://x.test/r.bin',
    });
    await until(() => q.getSnapshot()[0]?.status === 'COMPLETED', 'resumed completed');

    const snap = q.getSnapshot()[0];
    expect(snap?.status).toBe('COMPLETED');
    expect(snap?.downloadedBytes).toBe(5);
    expect(snap?.totalBytes).toBe(5);

    const progress = events.find((e) => e.type === 'progress');
    expect(progress).toMatchObject({ taskId: 'r1', downloadedBytes: 5, totalBytes: 5 });
  });

  it('emits failed on non-OK status', async () => {
    const { http } = deferredHttp([
      {
        status: 404,
        headers: {},
        body: new Uint8Array(0),
        url: 'https://x.test/missing.bin',
      },
    ]);
    const q = new DownloadQueue({ http });
    const events: DownloadEvent[] = [];
    q.on((e) => events.push(e));
    q.enqueue({ id: 'f1', url: 'https://x.test/missing.bin', format: 'bin', filePath: '/f.bin' });
    await until(() => events.some((e) => e.type === 'failed'), 'failed event');
    expect(events.find((e) => e.type === 'failed')).toEqual({
      type: 'failed',
      taskId: 'f1',
      error: 'HTTP 404',
    });
  });

  it('emits status events for UI pause/resume/cancel transitions', async () => {
    const resolvers: Array<(res: HttpResponse) => void> = [];
    const http: HttpClient = {
      request(req: HttpRequest): Promise<HttpResponse> {
        return new Promise((resolve) => {
          resolvers.push((res) => resolve({ ...res, url: req.url }));
        });
      },
    };
    const q = new DownloadQueue({ http, maxConcurrent: 1 });
    const events: DownloadEvent[] = [];
    q.on((e) => events.push(e));

    q.enqueue({ id: 's1', url: 'https://x.test/s.bin', format: 'bin', filePath: '/s.bin' });
    await until(() => events.some((e) => e.type === 'status' && e.status === 'DOWNLOADING'), 'downloading status');

    q.pause('s1');
    resolvers[0]?.(okResponse('https://x.test/s.bin', new Uint8Array([1, 2])));
    await until(() => events.some((e) => e.type === 'status' && e.status === 'PAUSED'), 'paused status');

    q.resume('s1');
    await until(() => events.some((e) => e.type === 'status' && e.status === 'DOWNLOADING' && e.taskId === 's1' && events.indexOf(e) > 0), 'resumed downloading');

    q.cancel('s1');
    await until(() => events.some((e) => e.type === 'status' && e.status === 'CANCELLED'), 'cancelled status');
    expect(q.getSnapshot()[0]?.status).toBe('CANCELLED');
    q.clearFinished();
    expect(q.getSnapshot()).toEqual([]);
  });

  it('retry re-enqueues failed tasks; clearFinished removes completed/cancelled', async () => {
    const { http } = deferredHttp([
      {
        status: 500,
        headers: {},
        body: new Uint8Array(0),
        url: 'https://x.test/retry.bin',
      },
      okResponse('https://x.test/retry.bin', new Uint8Array([7, 7])),
    ]);
    const q = new DownloadQueue({ http });
    const events: DownloadEvent[] = [];
    q.on((e) => events.push(e));

    q.enqueue({ id: 'retry-1', url: 'https://x.test/retry.bin', format: 'bin', filePath: '/retry.bin', title: '重试样例' });
    await until(() => events.some((e) => e.type === 'failed'), 'failed first');
    expect(q.getSnapshot()[0]?.status).toBe('FAILED');

    q.retry('retry-1');
    await until(() => q.getSnapshot()[0]?.status === 'COMPLETED', 'retry completed');
    expect(q.getSnapshot()[0]?.title).toBe('重试样例');

    q.enqueue({ id: 'ok-1', url: 'https://x.test/ok.bin', format: 'bin', filePath: '/ok.bin' });
    // second enqueue needs another response — queue already used both deferred responses for retry path
    // clearFinished should still drop completed tasks
    q.clearFinished();
    expect(q.getSnapshot().some((s) => s.id === 'retry-1' && s.status === 'COMPLETED')).toBe(false);
  });

  it('pauseAll/resumeAll and format helpers', async () => {
    const resolvers: Array<(res: HttpResponse) => void> = [];
    const http: HttpClient = {
      request(req: HttpRequest): Promise<HttpResponse> {
        return new Promise((resolve) => {
          resolvers.push((res) => resolve({ ...res, url: req.url }));
        });
      },
    };
    const q = new DownloadQueue({ http, maxConcurrent: 1 });
    q.enqueue({ id: 'p1', url: 'https://x.test/p1.bin', format: 'bin', filePath: '/p1.bin' });
    q.enqueue({ id: 'p2', url: 'https://x.test/p2.bin', format: 'bin', filePath: '/p2.bin' });
    await flush();
    expect(q.getSnapshot().filter((s) => s.status === 'DOWNLOADING')).toHaveLength(1);
    expect(q.getSnapshot().filter((s) => s.status === 'PENDING')).toHaveLength(1);

    q.pauseAll();
    expect(q.getSnapshot().filter((s) => s.status === 'PAUSED' || s.status === 'PENDING')).toHaveLength(2);

    q.resumeAll();
    await flush();
    expect(q.getSnapshot().filter((s) => s.status === 'PENDING' || s.status === 'DOWNLOADING')).toHaveLength(2);

    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(2048)).toBe('2 KB');
    expect(formatByteSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(downloadProgressRatio({ id: 'x', status: 'COMPLETED', downloadedBytes: 0, totalBytes: 0 })).toBe(1);
    expect(
      downloadProgressRatio({ id: 'x', status: 'DOWNLOADING', downloadedBytes: 50, totalBytes: 200 }),
    ).toBe(0.25);
  });
});

async function openTaskRepo(): Promise<DownloadTaskRepository> {
  const db = new InMemorySqliteDatabase();
  await openAppDatabase({ db });
  return new DownloadTaskRepository(db);
}

async function untilDb(cond: () => Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`db condition not met: ${label}`);
}

describe('DownloadQueue persistence', () => {
  it('round-trips enqueue → complete through the repository', async () => {
    const repo = await openTaskRepo();
    const body = new Uint8Array([1, 2, 3]);
    const { http } = deferredHttp([okResponse('https://x.test/p.bin', body)]);
    const q = new DownloadQueue({ http, repository: repo });
    const events: DownloadEvent[] = [];
    q.on((e) => events.push(e));

    q.enqueue({
      id: 'p-1',
      url: 'https://x.test/p.bin',
      format: 'bin',
      filePath: '/p.bin',
      title: '持久化',
      author: '作者',
      sourceId: 'src-1',
    });

    await until(() => events.some((e) => e.type === 'completed'), 'completed event');
    await untilDb(
      async () => (await repo.getTask('p-1'))?.status === 'COMPLETED',
      'db row completed',
    );

    expect(await repo.getTask('p-1')).toMatchObject({
      id: 'p-1',
      sourceId: 'src-1',
      title: '持久化',
      author: '作者',
      format: 'bin',
      status: 'COMPLETED',
      downloadedBytes: 3,
      totalBytes: 3,
      filePath: '/p.bin',
      downloadUrl: 'https://x.test/p.bin',
      errorMessage: null,
    });
  });

  it('pause persists PAUSED with preserved progress; resume moves back to PENDING', async () => {
    const repo = await openTaskRepo();
    const calls: HttpRequest[] = [];
    const pendings: Array<(res: HttpResponse) => void> = [];
    const http: HttpClient = {
      request(req: HttpRequest): Promise<HttpResponse> {
        calls.push(req);
        return new Promise((resolve) => {
          pendings.push((res) => resolve({ ...res, url: req.url }));
        });
      },
    };
    const q = new DownloadQueue({ http, maxConcurrent: 1, repository: repo });
    q.enqueue({ id: 'pause-1', url: 'https://x.test/pz.bin', format: 'bin', filePath: '/pz.bin' });
    await until(() => calls.length === 1, 'first request started');

    q.pause('pause-1');
    pendings[0]?.(okResponse('https://x.test/pz.bin', new Uint8Array([9, 9, 9])));
    await until(() => q.getSnapshot()[0]?.status === 'PAUSED', 'paused in memory');
    await untilDb(async () => (await repo.getTask('pause-1'))?.status === 'PAUSED', 'paused in db');

    const paused = await repo.getTask('pause-1');
    expect(paused?.downloadedBytes).toBe(3);
    expect(paused?.totalBytes).toBe(3);

    q.resume('pause-1');
    await untilDb(async () => {
      const row = await repo.getTask('pause-1');
      return row?.status === 'PENDING' || row?.status === 'DOWNLOADING';
    }, 'resumed in db');
  });

  it('fail persists FAILED with error message; retry re-enqueues and completes', async () => {
    const repo = await openTaskRepo();
    const { http } = deferredHttp([
      {
        status: 500,
        headers: {},
        body: new Uint8Array(0),
        url: 'https://x.test/rt.bin',
      },
      okResponse('https://x.test/rt.bin', new Uint8Array([7])),
    ]);
    const q = new DownloadQueue({ http, repository: repo });
    const events: DownloadEvent[] = [];
    q.on((e) => events.push(e));

    q.enqueue({
      id: 'rt-1',
      url: 'https://x.test/rt.bin',
      format: 'bin',
      filePath: '/rt.bin',
      title: '重试样例',
    });
    await until(() => events.some((e) => e.type === 'failed'), 'failed event');
    await untilDb(async () => (await repo.getTask('rt-1'))?.status === 'FAILED', 'failed in db');
    expect((await repo.getTask('rt-1'))?.errorMessage).toBe('HTTP 500');

    q.retry('rt-1');
    await until(() => q.getSnapshot()[0]?.status === 'COMPLETED', 'retry completed');
    await untilDb(
      async () => (await repo.getTask('rt-1'))?.status === 'COMPLETED',
      'db completed after retry',
    );
  });

  it('cancel deletes the persisted row like Android cancelDownload', async () => {
    const repo = await openTaskRepo();
    const resolvers: Array<(res: HttpResponse) => void> = [];
    const http: HttpClient = {
      request(req: HttpRequest): Promise<HttpResponse> {
        return new Promise((resolve) => {
          resolvers.push((res) => resolve({ ...res, url: req.url }));
        });
      },
    };
    const q = new DownloadQueue({ http, maxConcurrent: 1, repository: repo });
    q.enqueue({ id: 'cancel-1', url: 'https://x.test/c.bin', format: 'bin', filePath: '/c.bin' });
    await until(() => resolvers.length === 1, 'request started');
    await untilDb(async () => (await repo.getTask('cancel-1')) !== null, 'row inserted');

    q.cancel('cancel-1');
    await untilDb(async () => (await repo.getTask('cancel-1')) === null, 'row deleted');
  });

  it('restore-from-empty leaves the queue empty', async () => {
    const repo = await openTaskRepo();
    const { http } = deferredHttp([]);
    const q = new DownloadQueue({ http, repository: repo });
    await q.restore();
    expect(q.getSnapshot()).toEqual([]);
  });

  it('restore-with-existing-tasks maps interrupted work to PAUSED and keeps history', async () => {
    const repo = await openTaskRepo();
    await repo.insertTask({
      id: 'r-pending',
      sourceId: 's',
      title: '待下载',
      author: '甲',
      coverUrl: null,
      downloadUrl: 'https://x.test/r1.bin',
      format: 'bin',
      status: 'PENDING',
      downloadedBytes: 0,
      totalBytes: 10,
      filePath: '/r1.bin',
      errorMessage: null,
      updatedAt: 1,
    });
    await repo.insertTask({
      id: 'r-downloading',
      sourceId: 's',
      title: '下载中',
      author: '乙',
      coverUrl: null,
      downloadUrl: 'https://x.test/r2.bin',
      format: 'bin',
      status: 'DOWNLOADING',
      downloadedBytes: 4,
      totalBytes: 10,
      filePath: '/r2.bin',
      errorMessage: null,
      updatedAt: 2,
    });
    await repo.insertTask({
      id: 'r-paused',
      sourceId: 's',
      title: '已暂停',
      author: '丙',
      coverUrl: null,
      downloadUrl: 'https://x.test/r3.bin',
      format: 'bin',
      status: 'PAUSED',
      downloadedBytes: 6,
      totalBytes: 10,
      filePath: '/r3.bin',
      errorMessage: null,
      updatedAt: 3,
    });
    await repo.insertTask({
      id: 'r-failed',
      sourceId: 's',
      title: '失败',
      author: '丁',
      coverUrl: null,
      downloadUrl: 'https://x.test/r4.bin',
      format: 'bin',
      status: 'FAILED',
      downloadedBytes: 0,
      totalBytes: 0,
      filePath: '/r4.bin',
      errorMessage: 'HTTP 500',
      updatedAt: 4,
    });
    await repo.insertTask({
      id: 'r-done',
      sourceId: 's',
      title: '已完成',
      author: '戊',
      coverUrl: null,
      downloadUrl: 'https://x.test/r5.bin',
      format: 'bin',
      status: 'COMPLETED',
      downloadedBytes: 10,
      totalBytes: 10,
      filePath: '/r5.bin',
      errorMessage: null,
      updatedAt: 5,
    });
    await repo.insertTask({
      id: 'r-cancelled',
      sourceId: 's',
      title: '已取消',
      author: '己',
      coverUrl: null,
      downloadUrl: 'https://x.test/r6.bin',
      format: 'bin',
      status: 'CANCELLED',
      downloadedBytes: 0,
      totalBytes: 0,
      filePath: '/r6.bin',
      errorMessage: null,
      updatedAt: 6,
    });

    const { http } = deferredHttp([]);
    const q = new DownloadQueue({ http, repository: repo });
    await q.restore();

    const byId = new Map(q.getSnapshot().map((s) => [s.id, s]));
    expect(byId.get('r-pending')?.status).toBe('PAUSED');
    expect(byId.get('r-downloading')?.status).toBe('PAUSED');
    expect(byId.get('r-downloading')?.downloadedBytes).toBe(4);
    expect(byId.get('r-paused')?.status).toBe('PAUSED');
    expect(byId.get('r-paused')?.downloadedBytes).toBe(6);
    expect(byId.get('r-failed')?.status).toBe('FAILED');
    expect(byId.get('r-failed')?.error).toBe('HTTP 500');
    expect(byId.get('r-done')?.status).toBe('COMPLETED');
    expect(byId.get('r-done')?.title).toBe('已完成');
    expect(byId.has('r-cancelled')).toBe(false);

    expect((await repo.getTask('r-cancelled'))).toBeNull();
    expect((await repo.getTask('r-downloading'))?.status).toBe('PAUSED');
    expect((await repo.getTask('r-paused'))?.downloadedBytes).toBe(6);
  });

  it('restored FAILED task can be retried against the repository', async () => {
    const repo = await openTaskRepo();
    await repo.insertTask({
      id: 'retry-persist',
      sourceId: 's',
      title: '重试',
      author: 'x',
      coverUrl: null,
      downloadUrl: 'https://x.test/rtp.bin',
      format: 'bin',
      status: 'FAILED',
      downloadedBytes: 0,
      totalBytes: 0,
      filePath: '/rtp.bin',
      errorMessage: 'boom',
      updatedAt: 1,
    });
    const { http, calls } = deferredHttp([
      okResponse('https://x.test/rtp.bin', new Uint8Array([1])),
    ]);
    const q = new DownloadQueue({ http, repository: repo });
    await q.restore();
    expect(q.getSnapshot()[0]?.status).toBe('FAILED');

    q.retry('retry-persist');
    await until(() => q.getSnapshot()[0]?.status === 'COMPLETED', 'retry completed');
    await untilDb(
      async () => (await repo.getTask('retry-persist'))?.status === 'COMPLETED',
      'db completed after retry',
    );
    expect(calls).toHaveLength(1);
  });

  it('getOrCreateDownloadQueue reuses one instance and attaches a late repository', async () => {
    resetSharedDownloadQueue();
    const repo = await openTaskRepo();
    const first = getOrCreateDownloadQueue({ http: { request: () => Promise.reject(new Error('no')) } });
    const second = getOrCreateDownloadQueue({
      http: { request: () => Promise.reject(new Error('no')) },
      repository: repo,
    });
    expect(second).toBe(first);
    await repo.insertTask({
      id: 'shared-1',
      sourceId: 's',
      title: '共享',
      author: 'a',
      coverUrl: null,
      downloadUrl: 'https://x.test/s.bin',
      format: 'bin',
      status: 'PAUSED',
      downloadedBytes: 2,
      totalBytes: 8,
      filePath: '/s.bin',
      errorMessage: null,
      updatedAt: 1,
    });
    await first.restore();
    expect(first.getSnapshot().map((s) => s.id)).toEqual(['shared-1']);
    expect(first.getSnapshot()[0]?.status).toBe('PAUSED');
    resetSharedDownloadQueue();
  });
});
