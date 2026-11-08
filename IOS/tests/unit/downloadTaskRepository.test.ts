import { describe, expect, it } from 'vitest';
import { openAppDatabase } from '../../src/core/db/openDatabase';
import {
  DownloadTaskRepository,
  type DownloadTaskRecord,
} from '../../src/core/download/downloadTaskRepository';
import { InMemorySqliteDatabase } from '../../src/platform/web-mock/inMemoryDb';

async function openRepo(): Promise<DownloadTaskRepository> {
  const db = new InMemorySqliteDatabase();
  await openAppDatabase({ db });
  return new DownloadTaskRepository(db);
}

function sampleTask(overrides?: Partial<DownloadTaskRecord>): DownloadTaskRecord {
  return {
    id: 'src-1:book-9',
    sourceId: 'src-1',
    title: '诡秘之主',
    author: '爱潜水的乌贼',
    coverUrl: 'https://img.test/c.jpg',
    downloadUrl: 'https://dl.test/book.epub',
    format: 'epub',
    status: 'PENDING',
    downloadedBytes: 0,
    totalBytes: 0,
    filePath: '/downloads/book.epub',
    errorMessage: null,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

describe('DownloadTaskRepository', () => {
  it('insertTask then getTask round-trips all columns', async () => {
    const repo = await openRepo();
    const task = sampleTask();
    await repo.insertTask(task);
    expect(await repo.getTask(task.id)).toEqual(task);
  });

  it('insertTask upserts on conflict like Android OnConflictStrategy.REPLACE', async () => {
    const repo = await openRepo();
    await repo.insertTask(
      sampleTask({ status: 'FAILED', errorMessage: 'HTTP 404', downloadedBytes: 10 }),
    );
    await repo.insertTask(sampleTask({ status: 'PENDING', errorMessage: null, downloadedBytes: 0 }));
    const row = await repo.getTask('src-1:book-9');
    expect(row?.status).toBe('PENDING');
    expect(row?.errorMessage).toBeNull();
    expect(row?.downloadedBytes).toBe(0);
  });

  it('updateTask rewrites the row and deleteTask removes it', async () => {
    const repo = await openRepo();
    await repo.insertTask(sampleTask());
    await repo.updateTask(sampleTask({ status: 'PAUSED', downloadedBytes: 50, totalBytes: 100 }));
    expect(await repo.getTask('src-1:book-9')).toMatchObject({
      status: 'PAUSED',
      downloadedBytes: 50,
      totalBytes: 100,
    });
    await repo.deleteTask('src-1:book-9');
    expect(await repo.getTask('src-1:book-9')).toBeNull();
  });

  it('getTask returns null for unknown id', async () => {
    const repo = await openRepo();
    expect(await repo.getTask('missing')).toBeNull();
  });

  it('getActiveTasks returns only PENDING/DOWNLOADING rows', async () => {
    const repo = await openRepo();
    await repo.insertTask(sampleTask({ id: 'a', status: 'PENDING' }));
    await repo.insertTask(sampleTask({ id: 'b', status: 'DOWNLOADING', downloadedBytes: 1 }));
    await repo.insertTask(sampleTask({ id: 'c', status: 'PAUSED' }));
    await repo.insertTask(sampleTask({ id: 'd', status: 'FAILED' }));
    await repo.insertTask(sampleTask({ id: 'e', status: 'COMPLETED' }));
    await repo.insertTask(sampleTask({ id: 'f', status: 'CANCELLED' }));
    const active = await repo.getActiveTasks();
    expect(active.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('getAllTasks orders by updatedAt DESC', async () => {
    const repo = await openRepo();
    await repo.insertTask(sampleTask({ id: 'old', updatedAt: 100 }));
    await repo.insertTask(sampleTask({ id: 'new', updatedAt: 900 }));
    expect((await repo.getAllTasks()).map((t) => t.id)).toEqual(['new', 'old']);
  });

  it('getTasksByBook matches exact id and composite Android task ids', async () => {
    const repo = await openRepo();
    await repo.insertTask(sampleTask({ id: 'book-1' }));
    await repo.insertTask(sampleTask({ id: 'v2:5:src-1book-1' }));
    await repo.insertTask(sampleTask({ id: 'v2:5:src-2other' }));
    const tasks = await repo.getTasksByBook('book-1');
    expect(tasks.map((t) => t.id).sort()).toEqual(['book-1', 'v2:5:src-1book-1']);
  });

  it('updateProgress updates byte counters and updatedAt', async () => {
    const repo = await openRepo();
    await repo.insertTask(sampleTask());
    await repo.updateProgress('src-1:book-9', 120, 480, 1700000000999);
    const row = await repo.getTask('src-1:book-9');
    expect(row?.downloadedBytes).toBe(120);
    expect(row?.totalBytes).toBe(480);
    expect(row?.updatedAt).toBe(1700000000999);
  });

  it('updateState writes status/error/updatedAt like Android updateProgressAndStatus', async () => {
    const repo = await openRepo();
    await repo.insertTask(sampleTask());
    await repo.updateState('src-1:book-9', 'FAILED', 'HTTP 500', 42);
    const failed = await repo.getTask('src-1:book-9');
    expect(failed?.status).toBe('FAILED');
    expect(failed?.errorMessage).toBe('HTTP 500');
    expect(failed?.updatedAt).toBe(42);
    await repo.updateState('src-1:book-9', 'PAUSED', null, 43);
    const paused = await repo.getTask('src-1:book-9');
    expect(paused?.status).toBe('PAUSED');
    expect(paused?.errorMessage).toBeNull();
    expect(paused?.updatedAt).toBe(43);
  });

  it('coerces unknown persisted status to FAILED like Android TypeConverter', async () => {
    const db = new InMemorySqliteDatabase();
    await openAppDatabase({ db });
    const repo = new DownloadTaskRepository(db);
    await repo.insertTask(sampleTask({ id: 'weird' }));
    await db.execute('UPDATE download_tasks SET "status" = ? WHERE "id" = ?', ['NOPE', 'weird']);
    const row = await repo.getTask('weird');
    expect(row?.status).toBe('FAILED');
  });
});
