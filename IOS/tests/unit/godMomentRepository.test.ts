import { beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '@core/db/openDatabase';
import { GodMomentRepository } from '@core/god/godMomentRepository';
import type { GodMoment } from '@core/god/godTypes';
import { DEFAULT_CROP_PARAMS, cropParamsToTag, parseCropParams } from '@core/god/godTypes';
import { InMemorySqliteDatabase } from '@platform/web-mock/inMemoryDb';

function makeMoment(overrides: Partial<GodMoment> = {}): GodMoment {
  return {
    id: 0,
    contentType: 'comic',
    bookId: 'local_1',
    chapterId: 'c1',
    bookTitle: '书名',
    chapterTitle: '',
    chapterNumber: 1,
    title: '',
    titleIsCustom: false,
    rating: 5,
    note: '',
    coverPath: null,
    coverSource: 'page|0|',
    cropParams: '1,0,0,0,0,0,1,1',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

async function openRepo(): Promise<GodMomentRepository> {
  const db = new InMemorySqliteDatabase();
  await openAppDatabase({ db });
  return new GodMomentRepository(db);
}

describe('guarded() 降级（GodMomentRepository.kt L33-37）', () => {
  function brokenRepo(): GodMomentRepository {
    const boom = (): Promise<never> => Promise.reject(new Error('database not ready'));
    return new GodMomentRepository({ query: boom, execute: boom });
  }

  it('读方法在 DB 失败时返回默认值，不把异常抛给调用方', async () => {
    // 「神回是附加功能，任何一步出问题都只允许它自己不可用，绝不能把整个 App 带崩」
    const repo = brokenRepo();
    await expect(repo.all()).resolves.toEqual([]);
    await expect(repo.listRanked('recent')).resolves.toEqual([]);
    await expect(repo.listForBook('b1')).resolves.toEqual([]);
    await expect(repo.find('b1', 'c1')).resolves.toBeNull();
  });

  it('count 不在 guarded 范围内（Kotlin 的 dao.count 同样没有 guard）', async () => {
    const repo = brokenRepo();
    await expect(repo.count()).rejects.toThrow('database not ready');
  });

  it('byId 走的是 guarded 的 all()（Kotlin 的 dao.byId 是另一条 SQL，无 guard）', async () => {
    // TS 侧 `byId` 是 `all()` 之上的筛选而不是独立 SQL，因此顺带被 guard 住 ——
    // 比 Kotlin 更保守（不会因为一次查询失败把异常抛给调用方），方向是安全的。
    const repo = brokenRepo();
    await expect(repo.byId(1)).resolves.toBeNull();
  });

  it('cropParams 原样回写：默认串的字节由 @core/god/godTypes.cropParamsToTag 决定', async () => {
    const inserted: Array<Array<string | number | null>> = [];
    const repo = new GodMomentRepository({
      query: () => Promise.resolve([]),
      execute: (sql: string, params?: Array<string | number | null>) => {
        if (sql.includes('INSERT')) inserted.push(params ?? []);
        return Promise.resolve({ rowsAffected: 1, lastInsertRowId: 7 });
      },
    });
    const kotlinTag = cropParamsToTag(DEFAULT_CROP_PARAMS);
    expect(kotlinTag).toBe('1.0,0.0,0.0,0.0,0.0,0.0,1.0,1.0'); // Kotlin L219 + L174-175
    const saved = await repo.upsert(
      makeMoment({ bookId: 'b1', chapterId: 'c1', cropParams: kotlinTag }),
    );
    expect(saved.cropParams).toBe(kotlinTag);
    expect(inserted).toHaveLength(1);
    // cropParams 是第 14 个绑定参数（0 起下标 13）
    expect(inserted[0]?.[13]).toBe(kotlinTag);
  });

  it('Kotlin 的旧格式 cropParams 也能原样回写（解析 / 比对走同一路径）', async () => {
    const repo = await openRepo();
    const saved = await repo.upsert(
      makeMoment({ bookId: 'b9', chapterId: 'c9', cropParams: '1,0,0,0,0,0,1,1' }),
    );
    expect(saved.cropParams).toBe('1,0,0,0,0,0,1,1');
    const found = await repo.find('b9', 'c9');
    expect(parseCropParams(found?.cropParams ?? '')).toEqual(DEFAULT_CROP_PARAMS);
  });
});

describe('GodMomentRepository', () => {
  let repo: GodMomentRepository;

  beforeEach(async () => {
    repo = await openRepo();
  });

  it('upsert creates a new row and auto-assigns id', async () => {
    const saved = await repo.upsert(makeMoment({ bookId: 'b1', chapterId: 'c1' }));
    expect(saved.id).toBe(1);
    expect(await repo.count()).toBe(1);

    const found = await repo.find('b1', 'c1');
    expect(found).not.toBeNull();
    expect(found?.id).toBe(1);
    expect(found?.bookTitle).toBe('书名');
  });

  it('upsert reuses id, preserves createdAt, and bumps updatedAt on the same key', async () => {
    const first = await repo.upsert(
      makeMoment({ bookId: 'b1', chapterId: 'c1', rating: 4, createdAt: 5000, updatedAt: 5000 }),
    );
    const second = await repo.upsert(
      makeMoment({
        bookId: 'b1',
        chapterId: 'c1',
        rating: 5,
        note: '更新',
        createdAt: 9999,
        updatedAt: 9999,
      }),
    );

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(5000);
    expect(second.updatedAt).toBeGreaterThanOrEqual(5000);
    expect(await repo.count()).toBe(1);

    const found = await repo.find('b1', 'c1');
    expect(found?.rating).toBe(5);
    expect(found?.note).toBe('更新');
  });

  it('enforces unique (bookId, chapterId) at the schema level', async () => {
    const db = new InMemorySqliteDatabase();
    await openAppDatabase({ db });
    const localRepo = new GodMomentRepository(db);
    await localRepo.upsert(makeMoment({ bookId: 'b1', chapterId: 'c1' }));
    await expect(
      db.execute(
        'INSERT INTO god_moments ("bookId", "chapterId", "bookTitle", "titleIsCustom", "rating", "title", "chapterTitle", "chapterNumber", "note", "coverSource", "cropParams", "createdAt", "updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ['b1', 'c1', 'x', 0, 5, '', '', 0, '', 'page|0|', '1,0,0,0,0,0,1,1', 1, 1],
      ),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('deletes by id, book, and chapter', async () => {
    await repo.upsert(makeMoment({ bookId: 'b1', chapterId: 'c1' }));
    await repo.upsert(makeMoment({ bookId: 'b1', chapterId: 'c2', chapterNumber: 2 }));
    await repo.upsert(makeMoment({ bookId: 'b2', chapterId: 'c1', bookTitle: '别集' }));
    expect(await repo.count()).toBe(3);

    await repo.deleteForChapter('b1', 'c1');
    expect(await repo.count()).toBe(2);
    expect(await repo.find('b1', 'c1')).toBeNull();

    const remaining = await repo.find('b1', 'c2');
    expect(remaining).not.toBeNull();
    await repo.delete(remaining?.id ?? -1);
    expect(await repo.count()).toBe(1);

    await repo.deleteForBook('b2');
    expect(await repo.count()).toBe(0);
  });

  it('clear empties the table', async () => {
    await repo.upsert(makeMoment({ bookId: 'b1', chapterId: 'c1' }));
    await repo.upsert(makeMoment({ bookId: 'b2', chapterId: 'c2' }));
    await repo.clear();
    expect(await repo.count()).toBe(0);
  });

  it('listRanked sorts rating desc then createdAt desc for ranking', async () => {
    await repo.upsert(
      makeMoment({ id: 0, bookId: 'b', chapterId: 'c1', rating: 4, createdAt: 2000, chapterNumber: 10 }),
    );
    await repo.upsert(
      makeMoment({ id: 0, bookId: 'b', chapterId: 'c2', rating: 5, createdAt: 1000, chapterNumber: 2 }),
    );
    await repo.upsert(
      makeMoment({ id: 0, bookId: 'b', chapterId: 'c3', rating: 5, createdAt: 3000, chapterNumber: 1 }),
    );

    const ranked = await repo.listRanked('rating');
    expect(ranked.map((item) => item.chapterId)).toEqual(['c3', 'c2', 'c1']);

    const recent = await repo.listRanked('recent');
    expect(recent.map((item) => item.chapterId)).toEqual(['c3', 'c1', 'c2']);

    const byBook = await repo.listRanked('book');
    expect(byBook.map((item) => item.chapterId)).toEqual(['c3', 'c2', 'c1']);
  });

  it('listForBook orders by chapterNumber ascending', async () => {
    await repo.upsert(makeMoment({ bookId: 'b1', chapterId: 'c3', chapterNumber: 30 }));
    await repo.upsert(makeMoment({ bookId: 'b1', chapterId: 'c1', chapterNumber: 10 }));
    await repo.upsert(makeMoment({ bookId: 'b2', chapterId: 'c9', chapterNumber: 99 }));

    const list = await repo.listForBook('b1');
    expect(list.map((item) => item.chapterId)).toEqual(['c1', 'c3']);
  });

  it('find and byId return null for missing rows', async () => {
    expect(await repo.find('nope', 'nope')).toBeNull();
    expect(await repo.byId(999)).toBeNull();
  });

  it('round-trips boolean titleIsCustom and nullable coverPath', async () => {
    await repo.upsert(
      makeMoment({
        bookId: 'b1',
        chapterId: 'c1',
        titleIsCustom: true,
        title: '自定义',
        coverPath: '/covers/gm.jpg',
      }),
    );
    const found = await repo.find('b1', 'c1');
    expect(found?.titleIsCustom).toBe(true);
    expect(found?.title).toBe('自定义');
    expect(found?.coverPath).toBe('/covers/gm.jpg');

    await repo.upsert(
      makeMoment({
        bookId: 'b1',
        chapterId: 'c1',
        titleIsCustom: false,
        title: '',
        coverPath: null,
      }),
    );
    const updated = await repo.find('b1', 'c1');
    expect(updated?.titleIsCustom).toBe(false);
    expect(updated?.coverPath).toBeNull();
  });
});
