/**
 * bookDeleteFileCleanup.test.ts — 删除书籍的**文件清理**与**真实磁盘统计**回归。
 *
 * 权威源（Android，`novel-reader/app/src/main/java/com/example/data/BookRepository.kt`）：
 *   - L618-656 `deleteBook(book)`：事务内删神回（`god_moments`，`local_{book.id}`）+
 *     5 段 DB 清理 + `bookDao.deleteBook(book)`；事务后 `GodCoverEngine.deleteQuietly`
 *     删神回封面、`EncryptedSecretStore.remove("download:${task.id}")`、`deleteBookFiles`。
 *   - L662-693 `booksDiskBytes(books)`：书体 + 封面 + 匹配任务文件 +
 *     `downloads/{basename}.tmp|.resume`，同一 canonical path 只计一次。
 *   - L769-811 `deleteBookFiles(book, tasks)`：`epub_images/{id}`、书本体（文件或漫画
 *     目录）、封面、任务文件与 `.tmp`/`.resume`，并 `DownloadProgressBroadcaster.removeState`。
 *
 * iOS 端把 `File` 换成异步端口 `AsyncBookRepositoryFileSystem`
 * （`src/core/library/bookRepositoryDisk.ts`），本文件用一棵内存目录树作为宿主实现，
 * 因此每个用例都能直接断言「文件真的没了 / 真的还在」。
 */

import { describe, expect, it } from 'vitest';

import { openAppDatabase } from '@core/db/openDatabase';
import {
  BookRepository,
  type BookDeletionBroadcaster,
  type BookDeletionDeps,
  type BookDeletionSecretStore,
  type DatabaseLike,
} from '@core/library/bookRepository';
import type { AsyncBookRepositoryFileSystem } from '@core/library/bookRepositoryDisk';
import type { BookRow, DownloadTaskRow } from '@core/library/bookTypes';
import { InMemorySqliteDatabase } from '@platform/web-mock/inMemoryDb';

/* ═══════════════════════════════════════════════════════════════════
   宿主 FS：一棵内存目录树（绝对路径，`filesDir` = `/data/app`）
   ═══════════════════════════════════════════════════════════════════ */

class FakeDiskFs implements AsyncBookRepositoryFileSystem {
  readonly files = new Map<string, number>();
  readonly dirs = new Set<string>();
  readonly deleted: string[] = [];

  constructor(private readonly root: string) {}

  private static norm(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '');
  }

  private ensureParents(path: string): void {
    const parts = FakeDiskFs.norm(path).split('/');
    for (let i = 1; i < parts.length; i += 1) {
      const dir = parts.slice(0, i).join('/');
      if (dir !== '') this.dirs.add(dir);
    }
  }

  /** 建文件（父目录一并登记）。 */
  mkfile(path: string, bytes: number): this {
    const key = FakeDiskFs.norm(path);
    this.ensureParents(key);
    this.files.set(key, bytes);
    return this;
  }

  /** 建目录（父目录一并登记）。 */
  mkdir(path: string): this {
    const key = FakeDiskFs.norm(path);
    this.ensureParents(`${key}/_`);
    this.dirs.add(key);
    return this;
  }

  async filesDir(): Promise<string> {
    return this.root;
  }

  async exists(path: string): Promise<boolean> {
    const key = FakeDiskFs.norm(path);
    return this.files.has(key) || this.dirs.has(key);
  }

  async isDirectory(path: string): Promise<boolean> {
    return this.dirs.has(FakeDiskFs.norm(path));
  }

  async size(path: string): Promise<number> {
    const bytes = this.files.get(FakeDiskFs.norm(path));
    if (bytes === undefined) throw new Error(`not a file: ${path}`);
    return bytes;
  }

  async list(dir: string): Promise<string[]> {
    const base = FakeDiskFs.norm(dir);
    const children = new Set<string>();
    const collect = (path: string): void => {
      if (!path.startsWith(`${base}/`)) return;
      const rest = path.slice(base.length + 1);
      const first = rest.split('/')[0];
      if (first !== undefined && first !== '') children.add(`${base}/${first}`);
    };
    for (const path of this.files.keys()) collect(path);
    for (const path of this.dirs) {
      if (path !== base) collect(path);
    }
    return [...children].sort();
  }

  async canonicalPath(path: string): Promise<string | null> {
    return FakeDiskFs.norm(path);
  }

  async delete(path: string): Promise<void> {
    const key = FakeDiskFs.norm(path);
    this.deleted.push(key);
    this.files.delete(key);
    this.dirs.delete(key);
  }

  /** `File.deleteRecursively()`。 */
  async deleteRecursively(path: string): Promise<void> {
    const key = FakeDiskFs.norm(path);
    if (this.files.has(key)) {
      await this.delete(key);
      return;
    }
    for (const child of await this.list(key)) {
      await this.deleteRecursively(child);
    }
    if (this.dirs.has(key)) {
      this.dirs.delete(key);
      this.deleted.push(key);
    }
  }

  /** `walkBottomUp().filter { it.isFile }.sumOf { it.length() }`。 */
  async walkFileBytes(path: string): Promise<number> {
    const key = FakeDiskFs.norm(path);
    const direct = this.files.get(key);
    if (direct !== undefined) return direct;
    let total = 0;
    for (const [file, bytes] of this.files) {
      if (file.startsWith(`${key}/`)) total += bytes;
    }
    return total;
  }
}

class RecordingBroadcaster implements BookDeletionBroadcaster {
  readonly removed: string[] = [];
  removeState(taskId: string): void {
    this.removed.push(taskId);
  }
}

class RecordingSecrets implements BookDeletionSecretStore {
  readonly removed: string[] = [];
  async remove(key: string): Promise<void> {
    this.removed.push(key);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   夹具
   ═══════════════════════════════════════════════════════════════════ */

const ROOT = '/data/app';

const DEFAULT_BOOK = {
  author: '测试作者',
  filePath: null as string | null,
  coverUri: null as string | null,
  category: '默认',
  currentChapterIndex: 0,
  scrollOffset: 0,
  isFinished: 0,
  totalChapters: 1,
  contentType: 'NOVEL',
  addedTime: 1,
  lastReadTime: 1,
  sourceId: null as string | null,
  comicId: null as string | null,
};

interface Fixture {
  readonly repo: BookRepository;
  readonly db: DatabaseLike;
}

async function openFixture(): Promise<Fixture> {
  const db = new InMemorySqliteDatabase();
  await openAppDatabase({ db });
  return { repo: new BookRepository(db), db };
}

async function seedBook(
  repo: BookRepository,
  title: string,
  patch: Omit<Partial<BookRow>, 'id'> = {},
): Promise<BookRow> {
  const draft: Omit<BookRow, 'id'> = { ...DEFAULT_BOOK, title, ...patch };
  const id = await repo.insertBook(draft);
  return { ...draft, id };
}

function taskRow(id: string, filePath: string | null): DownloadTaskRow {
  return {
    id,
    sourceId: 'src-1',
    title: '下载任务',
    author: null,
    coverUrl: null,
    downloadUrl: null,
    format: 'epub',
    status: 'COMPLETED',
    downloadedBytes: 0,
    totalBytes: 0,
    filePath,
    errorMessage: null,
    updatedAt: 1,
  };
}

async function seedGodMoment(
  db: DatabaseLike,
  godBookId: string,
  coverPath: string | null,
): Promise<void> {
  // Room v12 `god_moments`（`src/core/db/schemaV12.ts:284-311`）逐列对齐。
  await db.execute(
    'INSERT INTO god_moments ("contentType", "bookId", "chapterId", "bookTitle", "chapterTitle", ' +
      '"chapterNumber", "title", "titleIsCustom", "rating", "note", "coverPath", "coverSource", ' +
      '"cropParams", "createdAt", "updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ['comic', godBookId, 'ch-1', '书名', '章节', 1, '标题', 0, 5, '', coverPath, 'page|0|', '1,0,0,0,0,0,1,1', 1, 1],
  );
}

async function godMomentCount(db: DatabaseLike, godBookId: string): Promise<number> {
  const rows = await db.query<{ c: number }>(
    'SELECT COUNT(*) AS c FROM god_moments WHERE "bookId" = ?',
    [godBookId],
  );
  return rows[0]?.c ?? 0;
}

/* ═══════════════════════════════════════════════════════════════════
   用例
   ═══════════════════════════════════════════════════════════════════ */

describe('deleteBook 文件清理（BookRepository.kt:618-656 / 769-811）', () => {
  it('① 删书后书本体文件消失，books 行同时删除', async () => {
    const { repo } = await openFixture();
    const fs = new FakeDiskFs(ROOT);
    fs.mkfile(`${ROOT}/imports/novel-a.txt`, 120);
    const book = await seedBook(repo, '甲书', { filePath: `${ROOT}/imports/novel-a.txt` });

    await repo.deleteBook(book, { fs });

    expect(fs.files.has(`${ROOT}/imports/novel-a.txt`)).toBe(false);
    expect(await repo.getBook(book.id ?? 0)).toBeNull();
  });

  it('② 删书后封面文件消失（Kotlin L786-791）', async () => {
    const { repo } = await openFixture();
    const fs = new FakeDiskFs(ROOT);
    fs.mkfile(`${ROOT}/covers/novel-a.jpg`, 40);
    const book = await seedBook(repo, '乙书', { coverUri: `${ROOT}/covers/novel-a.jpg` });

    await repo.deleteBook(book, { fs });

    expect(fs.files.has(`${ROOT}/covers/novel-a.jpg`)).toBe(false);
  });

  it('③ 漫画目录递归删除（Kotlin L779-784 的 isDirectory 分支）', async () => {
    const { repo } = await openFixture();
    const fs = new FakeDiskFs(ROOT);
    fs.mkfile(`${ROOT}/comics_20/chapters/1.jpg`, 10);
    fs.mkfile(`${ROOT}/comics_20/chapters/2.jpg`, 20);
    fs.mkfile(`${ROOT}/comics_20/pages/1.jpg`, 30);
    const book = await seedBook(repo, '丙漫画', {
      filePath: `${ROOT}/comics_20`,
      contentType: 'COMIC',
    });

    await repo.deleteBook(book, { fs });

    expect(await fs.isDirectory(`${ROOT}/comics_20`)).toBe(false);
    expect([...fs.files.keys()].filter((path) => path.startsWith(`${ROOT}/comics_20/`))).toEqual([]);
  });

  it('④ epub_images/{id} 目录删除（Kotlin L775-777）', async () => {
    const { repo } = await openFixture();
    const fs = new FakeDiskFs(ROOT);
    const book = await seedBook(repo, '丁书', { filePath: null });
    const imageDir = `${ROOT}/epub_images/${String(book.id ?? 0)}`;
    fs.mkfile(`${imageDir}/img-1.png`, 64);

    await repo.deleteBook(book, { fs });

    expect(await fs.isDirectory(imageDir)).toBe(false);
    expect(fs.files.has(`${imageDir}/img-1.png`)).toBe(false);
  });

  it('⑤ 应用目录之外的路径不删（Kotlin L770-773 ownedFile 前缀守卫）', async () => {
    const { repo } = await openFixture();
    const fs = new FakeDiskFs(ROOT);
    fs.mkfile('/etc/passwd', 10);
    const book = await seedBook(repo, '戊书', { filePath: '/etc/passwd' });

    await repo.deleteBook(book, { fs });

    expect(fs.files.has('/etc/passwd')).toBe(true);
    expect(fs.deleted).not.toContain('/etc/passwd');
  });

  it('⑥ 任务文件 + downloads/{base}.tmp + .resume 都删（Kotlin L793-810）', async () => {
    const { repo } = await openFixture();
    const fs = new FakeDiskFs(ROOT);
    fs.mkfile(`${ROOT}/imports/novel-6.txt`, 5);
    fs.mkfile(`${ROOT}/downloads/novel-6.epub`, 200);
    fs.mkfile(`${ROOT}/downloads/novel-6.tmp`, 30);
    fs.mkfile(`${ROOT}/downloads/novel-6.resume`, 10);
    const book = await seedBook(repo, '己书', { filePath: `${ROOT}/imports/novel-6.txt` });
    await repo.upsertDownloadTask(taskRow('task-6', `${ROOT}/downloads/novel-6.epub`));

    const deps: BookDeletionDeps = { fs, matchTasks: (_book, tasks) => tasks };
    await repo.deleteBook(book, deps);

    expect(fs.files.has(`${ROOT}/downloads/novel-6.epub`)).toBe(false);
    expect(fs.files.has(`${ROOT}/downloads/novel-6.tmp`)).toBe(false);
    expect(fs.files.has(`${ROOT}/downloads/novel-6.resume`)).toBe(false);
    expect(fs.files.has(`${ROOT}/imports/novel-6.txt`)).toBe(false);
  });

  it('⑦ 进度广播状态被移除（Kotlin L799 DownloadProgressBroadcaster.removeState）', async () => {
    const { repo } = await openFixture();
    const fs = new FakeDiskFs(ROOT);
    const broadcaster = new RecordingBroadcaster();
    const secrets = new RecordingSecrets();
    fs.mkfile(`${ROOT}/downloads/novel-7.epub`, 12);
    const book = await seedBook(repo, '庚书', { filePath: `${ROOT}/downloads/novel-7.epub` });
    await repo.upsertDownloadTask(taskRow('task-7', `${ROOT}/downloads/novel-7.epub`));

    await repo.deleteBook(book, { fs, broadcaster, secrets });

    expect(broadcaster.removed).toEqual(['task-7']);
    // Kotlin L649-650：`EncryptedSecretStore.remove("download:${it.id}")`。
    expect(secrets.removed).toEqual(['download:task-7']);
  });

  it('⑧ 神回封面被删、god_moments 行清空（Kotlin L636-638 + L648）', async () => {
    const { repo, db } = await openFixture();
    const fs = new FakeDiskFs(ROOT);
    const book = await seedBook(repo, '辛书', { filePath: null });
    const godBookId = `local_${String(book.id ?? 0)}`;
    fs.mkfile(`${ROOT}/god_covers/gm_1.jpg`, 80);
    await seedGodMoment(db, godBookId, `${ROOT}/god_covers/gm_1.jpg`);

    await repo.deleteBook(book, { fs });

    expect(fs.files.has(`${ROOT}/god_covers/gm_1.jpg`)).toBe(false);
    expect(await godMomentCount(db, godBookId)).toBe(0);
  });

  it('⑨ booksDiskBytes 逐项累加且同一路径不重复计（Kotlin L662-693）', async () => {
    const { repo } = await openFixture();
    const fs = new FakeDiskFs(ROOT);
    fs.mkfile(`${ROOT}/imports/book-9.txt`, 100);
    fs.mkfile(`${ROOT}/covers/book-9.jpg`, 40);
    fs.mkfile(`${ROOT}/downloads/task-9.epub`, 200);
    fs.mkfile(`${ROOT}/downloads/task-9.tmp`, 30);
    fs.mkfile(`${ROOT}/downloads/task-9.resume`, 10);
    const book = await seedBook(repo, '壬书', {
      filePath: `${ROOT}/imports/book-9.txt`,
      coverUri: `${ROOT}/covers/book-9.jpg`,
    });
    await repo.upsertDownloadTask(taskRow('task-9', `${ROOT}/downloads/task-9.epub`));

    const matchAll = (): readonly DownloadTaskRow[] => [
      taskRow('task-9', `${ROOT}/downloads/task-9.epub`),
    ];
    const bytes = await repo.booksDiskBytesAsync([book], fs, matchAll);
    expect(bytes).toBe(380);

    // 同一本书记两遍：canonical path 去重，总量不变。
    const deduped = await repo.booksDiskBytesAsync([book, book], fs, matchAll);
    expect(deduped).toBe(380);
  });

  it('⑩ deleteBookDb 只清 DB，磁盘文件保留（对照：单参 deleteBook 即 bookDao.deleteBook）', async () => {
    const { repo } = await openFixture();
    const fs = new FakeDiskFs(ROOT);
    fs.mkfile(`${ROOT}/imports/keep-me.txt`, 50);
    const book = await seedBook(repo, '癸书', { filePath: `${ROOT}/imports/keep-me.txt` });

    await repo.deleteBookDb(book);

    expect(await repo.getBook(book.id ?? 0)).toBeNull();
    expect(fs.files.has(`${ROOT}/imports/keep-me.txt`)).toBe(true);
    // 单参 deleteBook 是 `bookDao.deleteBook(book)`，同样不动文件。
    const other = await seedBook(repo, '子书', { filePath: `${ROOT}/imports/keep-me.txt` });
    await repo.deleteBook(other);
    expect(fs.files.has(`${ROOT}/imports/keep-me.txt`)).toBe(true);
  });
});
