/**
 * E106 接线测试 — 同一部漫画在多个源时的「可能重复的作品」确认链。
 *
 * 权威链路：
 *   MainViewModel.kt L98-149   toggleFavorite（查重 → FavoriteAddRequest 挂起）
 *   MainViewModel.kt L164-209  dismissFavoriteAdd / confirmFavoriteAdd
 *   MainActivity.kt  L604-620  favoriteAddRequest / favoriteActionMessage → 弹窗 + Toast
 *
 * 覆盖：
 *   ① 无候选 → 直接写库、不弹窗
 *   ② 单候选 → 弹窗，且标题行 / 候选卡片都显示来源名（MainActivity L616）
 *   ③ 多候选 → 按 `ComicFavoriteMatching.candidates()` 的 score 倒序
 *   ④ confirm(replace) → 删旧行 + 进度迁移 + 详情补全 + 迁移文案
 *   ⑤ confirm(null) → 新增、两本并存
 *   ⑥ dismiss → 不写库
 *   ⑦ favoriteActionMessage 文案逐字（成功 / 迁移 / 超时 / 源不可用 / 异常）
 *   ⑧ 生产入口已改经控制器（三个页面不再直接 add）
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AppLanguage, setAppLanguage } from '@core/i18n';
import type { ComicSourcePort } from '@core/comic/comicChapters';
import type { BookSource } from '@core/source/bookSource';
import type { FavoriteRepository } from '@core/library/favoriteRepository';
import type { LibraryViewModel } from '@core/library/libraryViewModel';
import type { SourceManager } from '@core/source/sourceManager';
import { setLibraryRuntime, type LibraryRuntime } from '@core/library/libraryRuntime';
import {
  FAVORITE_SOURCE_UNAVAILABLE,
} from '@core/app/mainViewModel';
import {
  FavoriteAddController,
  FAVORITE_ADDED_MESSAGE,
  FAVORITE_CONFIRM_FAILED_MESSAGE,
  FAVORITE_TIMEOUT_MESSAGE,
  configureFavoriteAddController,
  getFavoriteAddSnapshot,
  requestFavoriteAdd,
  resetFavoriteAddController,
  type FavoriteAddRepository,
} from '@core/library/favoriteAddController';
import { createComicChapter } from '@core/library/comicSourceTypes';
import { FAV_DEFAULT_CATEGORY, favoriteKey, type FavoriteEntity } from '@core/library/favoriteTypes';
import { createSearchBook, type SearchBook as SourceSearchBook } from '@core/source/searchBook';
import { DuplicateFavoriteHost } from '@ui/components/favorite/DuplicateFavoriteHost';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ─────────────────────────── fixtures ─────────────────────────── */

function favorite(overrides: Partial<FavoriteEntity> = {}): FavoriteEntity {
  return {
    sourceId: 'src-a',
    comicId: 'c1',
    title: '葬送的芙莉莲',
    author: '阿部司',
    coverUrl: null,
    localThumbPath: null,
    serialStatus: 'ongoing',
    latestChapterId: null,
    latestChapterTitle: null,
    latestChapterUpdateAt: 0,
    lastCheckedAt: 0,
    sourceAlive: true,
    categoryName: FAV_DEFAULT_CATEGORY,
    favoritedAt: 0,
    sortOrder: 0,
    ...overrides,
  };
}

/** 新来源（src-b）的这一本。 */
function book(overrides: Partial<SourceSearchBook> = {}): SourceSearchBook {
  return createSearchBook({
    id: 'c9',
    sourceId: 'src-b',
    title: '葬送的芙莉莲',
    author: '阿部司',
    ...overrides,
  });
}

function comicPort(overrides: Partial<ComicSourcePort> = {}): ComicSourcePort {
  return {
    name: '拷贝漫画',
    supportOnlineText: false,
    getChapters: async () => [createComicChapter({ id: 'ch-9', title: '第 1 话' })],
    getChapterImages: async () => [],
    getChapterImageHeaders: async () => ({}),
    ...overrides,
  };
}

interface FakeStore {
  repository: FavoriteAddRepository;
  rows: FavoriteEntity[];
  progress: Map<string, { chapterId: string; chapterIndex: number }>;
  added: Array<{ sourceId: string; comicId: string; category: string; chapters: number }>;
  replaced: Array<{
    from: string;
    to: string;
    chapters: number;
    title: string;
    cover: string | null;
  }>;
}

/**
 * 仓库替身：行为对齐 `FavoriteRepository` / `FavoriteDao.replaceFavoriteMapped`
 * —— `replaceFavorite` 删旧行、把旧进度按章节映射搬到新主键（这里 1:1 映射）。
 */
function fakeRepository(seed: FavoriteEntity[] = []): FakeStore {
  const rows = [...seed];
  const progress = new Map<string, { chapterId: string; chapterIndex: number }>();
  const added: FakeStore['added'] = [];
  const replaced: FakeStore['replaced'] = [];
  const repository: FavoriteAddRepository = {
    favorites: async () => [...rows],
    isFavorite: async (sourceId, comicId) =>
      rows.some((row) => row.sourceId === sourceId && row.comicId === comicId),
    add: async (target, category, chapters) => {
      added.push({
        sourceId: target.sourceId,
        comicId: target.id,
        category,
        chapters: chapters.length,
      });
      if (!rows.some((row) => row.sourceId === target.sourceId && row.comicId === target.id)) {
        rows.push(
          favorite({
            sourceId: target.sourceId,
            comicId: target.id,
            title: target.title,
            author: target.author,
            coverUrl: target.cover,
          }),
        );
      }
    },
    replaceFavorite: async (from, target, chapters) => {
      replaced.push({
        from: favoriteKey(from.sourceId, from.comicId),
        to: favoriteKey(target.sourceId, target.id),
        chapters: chapters.length,
        title: target.title,
        cover: target.cover,
      });
      const index = rows.findIndex(
        (row) => row.sourceId === from.sourceId && row.comicId === from.comicId,
      );
      if (index >= 0) rows.splice(index, 1);
      rows.push(
        favorite({
          sourceId: target.sourceId,
          comicId: target.id,
          title: target.title,
          author: target.author,
          coverUrl: target.cover,
        }),
      );
      const moved = progress.get(favoriteKey(from.sourceId, from.comicId));
      if (moved === undefined) {
        return { migrated: 0, unmatched: 0, resumeMatched: false };
      }
      progress.delete(favoriteKey(from.sourceId, from.comicId));
      progress.set(favoriteKey(target.sourceId, target.id), moved);
      return { migrated: 1, unmatched: 0, resumeMatched: true };
    },
  };
  return { repository, rows, progress, added, replaced };
}

/** MainActivity L606/L616：`availableSources.firstOrNull { it.id == sourceId }?.name ?: sourceId`。 */
function installRuntime(repository: FavoriteAddRepository, names: Record<string, string>): void {
  const manager = {
    getSource: (id: string) =>
      names[id] === undefined ? null : ({ id, name: names[id] } as unknown as BookSource),
  } as unknown as SourceManager;
  const runtime: LibraryRuntime = {
    viewModel: null as unknown as LibraryViewModel,
    comicDownloads: null,
    shareHelper: null,
    sourceManager: manager,
    favorites: repository as unknown as FavoriteRepository,
  };
  setLibraryRuntime(runtime);
}

const mounted: Array<{ host: HTMLDivElement; root: Root }> = [];

function mount(node: ReactElement): HTMLDivElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ host, root });
  act(() => root.render(node));
  return host;
}

beforeEach(() => {
  setAppLanguage(AppLanguage.ZH);
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.host.remove();
  }
  resetFavoriteAddController();
  setLibraryRuntime(null);
});

/* ─────────────────────────── 用例 ─────────────────────────── */

describe('FavoriteAddController — MainViewModel.toggleFavorite（L98-149）', () => {
  it('① 无候选：直接写库，不弹窗', async () => {
    const store = fakeRepository([]);
    const controller = new FavoriteAddController({
      repository: store.repository,
      comicSource: async () => comicPort(),
    });

    await controller.requestFavoriteAdd({
      book: book(),
      chapters: [createComicChapter({ id: 'ch-9', title: '第 1 话' })],
    });

    expect(store.added).toEqual([
      { sourceId: 'src-b', comicId: 'c9', category: FAV_DEFAULT_CATEGORY, chapters: 1 },
    ]);
    expect(controller.getSnapshot().request).toBeNull();
    expect(controller.getSnapshot().message).toBe(FAVORITE_ADDED_MESSAGE);
  });

  it('② 单候选：弹窗显示来源名（请求来源 + 候选来源）', async () => {
    const store = fakeRepository([
      favorite({ sourceId: 'src-a', comicId: 'c1', title: '葬送的芙莉莲' }),
    ]);
    configureFavoriteAddController({
      repository: store.repository,
      comicSource: async () => comicPort(),
    });
    installRuntime(store.repository, { 'src-a': '漫画柜', 'src-b': '拷贝漫画' });

    await requestFavoriteAdd({ book: book() });

    const request = getFavoriteAddSnapshot().request;
    expect(request).not.toBeNull();
    expect(request?.candidates).toHaveLength(1);
    expect(request?.busy).toBe(false);
    expect(request?.error).toBeNull();

    const host = mount(<DuplicateFavoriteHost />);
    expect(host.textContent).toContain('可能重复的作品');
    expect(host.textContent).toContain('「葬送的芙莉莲」 · 拷贝漫画');
    expect(host.textContent).toContain('漫画柜');
    // 未点确认前没有写库（Kotlin L142 之后要等 onConfirm）。
    expect(store.added).toHaveLength(0);
    expect(store.replaced).toHaveLength(0);
  });

  it('③ 多候选：按 Kotlin candidates() 的 score 倒序，reason 逐字', async () => {
    const store = fakeRepository([
      favorite({ sourceId: 'src-a', comicId: 'c1', title: '葬送的芙莉莲', author: '阿部司' }),
      favorite({ sourceId: 'src-a', comicId: 'c2', title: '葬送的芙莉', author: '阿部司' }),
      favorite({ sourceId: 'src-a', comicId: 'c3', title: '葬送的芙莉', author: '别人' }),
    ]);
    const controller = new FavoriteAddController({
      repository: store.repository,
      comicSource: async () => comicPort(),
    });

    await controller.requestFavoriteAdd({ book: book() });

    const candidates = controller.getSnapshot().request?.candidates ?? [];
    expect(candidates).toHaveLength(3);
    expect(candidates.map((candidate) => candidate.favorite.comicId)).toEqual(['c1', 'c2', 'c3']);
    expect(candidates.map((candidate) => candidate.reason)).toEqual([
      '书名或已知别名相同',
      '书名相似，作者相同',
      '书名相似，请核对作品',
    ]);
    expect(candidates[0]?.score).toBe(1);
    expect(candidates[1]?.score).toBeGreaterThan(0.82);
    for (let i = 1; i < candidates.length; i += 1) {
      expect(candidates[i - 1]!.score).toBeGreaterThanOrEqual(candidates[i]!.score);
    }
  });
});

describe('FavoriteAddController — MainViewModel.confirmFavoriteAdd（L171-209）', () => {
  it('④ confirm(replace)：删旧行、迁移进度、补详情、写迁移文案', async () => {
    const store = fakeRepository([
      favorite({ sourceId: 'src-a', comicId: 'c1', title: '葬送的芙莉莲' }),
    ]);
    store.progress.set(favoriteKey('src-a', 'c1'), { chapterId: 'ch-1', chapterIndex: 0 });
    const controller = new FavoriteAddController({
      repository: store.repository,
      comicSource: async () => comicPort(),
      // Kotlin L189-190 `withTimeoutOrNull(15_000) { source?.getDetail(book.id) }`。
      comicDetail: async () =>
        createSearchBook({
          id: 'c9',
          sourceId: 'src-b',
          title: '葬送的芙莉莲',
          author: '阿部司',
          cover: 'https://cdn.example/new-cover.jpg',
        }),
    });

    await controller.requestFavoriteAdd({
      book: book({ cover: null }),
      chapters: [createComicChapter({ id: 'ch-9', title: '第 1 话' })],
    });
    const candidate = controller.getSnapshot().request?.candidates[0]?.favorite ?? null;
    expect(candidate).not.toBeNull();

    await controller.confirmFavoriteAdd(candidate);

    expect(store.replaced).toHaveLength(1);
    expect(store.replaced[0]?.from).toBe('src-a::c1');
    expect(store.replaced[0]?.to).toBe('src-b::c9');
    // 旧收藏被删除，只剩新来源的一本。
    expect(store.rows.map((row) => favoriteKey(row.sourceId, row.comicId))).toEqual(['src-b::c9']);
    // 已读进度按章节映射搬到新主键。
    expect(store.progress.get('src-b::c9')).toEqual({ chapterId: 'ch-1', chapterIndex: 0 });
    expect(store.progress.has('src-a::c1')).toBe(false);
    // 详情补全（withComicDetail）。
    expect(store.replaced[0]?.cover).toBe('https://cdn.example/new-cover.jpg');
    expect(controller.getSnapshot().request).toBeNull();
    expect(controller.getSnapshot().message).toBe(
      '已替换收藏，迁移 1 话阅读标记与书签。新版本从对应话的第一页续读',
    );
  });

  it('⑤ confirm(null)：新增收藏，两本并存', async () => {
    const store = fakeRepository([
      favorite({ sourceId: 'src-a', comicId: 'c1', title: '葬送的芙莉莲' }),
    ]);
    const controller = new FavoriteAddController({
      repository: store.repository,
      comicSource: async () => comicPort(),
    });

    await controller.requestFavoriteAdd({
      book: book(),
      chapters: [createComicChapter({ id: 'ch-9', title: '第 1 话' })],
    });
    await controller.confirmFavoriteAdd(null);

    expect(store.replaced).toHaveLength(0);
    expect(store.added).toEqual([
      { sourceId: 'src-b', comicId: 'c9', category: FAV_DEFAULT_CATEGORY, chapters: 1 },
    ]);
    expect(store.rows.map((row) => favoriteKey(row.sourceId, row.comicId)).sort()).toEqual([
      'src-a::c1',
      'src-b::c9',
    ]);
    expect(controller.getSnapshot().request).toBeNull();
    expect(controller.getSnapshot().message).toBe(FAVORITE_ADDED_MESSAGE);
  });

  it('⑥ dismiss：不写库，只清请求', async () => {
    const store = fakeRepository([
      favorite({ sourceId: 'src-a', comicId: 'c1', title: '葬送的芙莉莲' }),
    ]);
    const controller = new FavoriteAddController({
      repository: store.repository,
      comicSource: async () => comicPort(),
    });

    await controller.requestFavoriteAdd({ book: book() });
    expect(controller.getSnapshot().request).not.toBeNull();

    controller.dismissFavoriteAdd();

    expect(controller.getSnapshot().request).toBeNull();
    expect(controller.getSnapshot().message).toBeNull();
    expect(store.added).toHaveLength(0);
    expect(store.replaced).toHaveLength(0);
    expect(store.rows).toHaveLength(1);
  });
});

describe('favoriteActionMessage — MainViewModel.kt 文案逐字', () => {
  it('⑦a 未匹配记录：追加「；未匹配记录仍保留在旧来源」', async () => {
    const store = fakeRepository([
      favorite({ sourceId: 'src-a', comicId: 'c1', title: '葬送的芙莉莲' }),
    ]);
    store.repository.replaceFavorite = async () => ({
      migrated: 2,
      unmatched: 1,
      resumeMatched: true,
    });
    const controller = new FavoriteAddController({
      repository: store.repository,
      comicSource: async () => comicPort(),
    });

    await controller.requestFavoriteAdd({ book: book(), chapters: [createComicChapter({ id: 'ch-9', title: '第 1 话' })] });
    const candidate = controller.getSnapshot().request?.candidates[0]?.favorite ?? null;
    await controller.confirmFavoriteAdd(candidate);

    expect(controller.getSnapshot().message).toBe(
      '已替换收藏，迁移 2 话阅读标记与书签；未匹配记录仍保留在旧来源。新版本从对应话的第一页续读',
    );
  });

  it('⑦b 换源超时：L202 文案原样落到 request.error', async () => {
    const store = fakeRepository([
      favorite({ sourceId: 'src-a', comicId: 'c1', title: '葬送的芙莉莲' }),
    ]);
    const controller = new FavoriteAddController({
      repository: store.repository,
      // 章节为空时才会重取；这里让源抛超时文案（等价 TimeoutCancellationException）。
      comicSource: async () =>
        comicPort({
          getChapters: async () => {
            throw new Error(FAVORITE_TIMEOUT_MESSAGE);
          },
        }),
    });

    await controller.requestFavoriteAdd({ book: book(), chapters: [] });
    const candidate = controller.getSnapshot().request?.candidates[0]?.favorite ?? null;
    await controller.confirmFavoriteAdd(candidate);

    expect(controller.getSnapshot().request?.error).toBe(FAVORITE_TIMEOUT_MESSAGE);
    expect(controller.getSnapshot().request?.busy).toBe(false);
    expect(controller.getSnapshot().message).toBeNull();
    expect(store.replaced).toHaveLength(0);
  });

  it('⑦c 新来源不可用：L186「新来源暂不可用，请稍后重试」', async () => {
    const store = fakeRepository([
      favorite({ sourceId: 'src-a', comicId: 'c1', title: '葬送的芙莉莲' }),
    ]);
    // 查重时源还在（否则 L119 会直接 add），确认时已经掉线 → L186 的 else 分支。
    let sourceAvailable = true;
    const controller = new FavoriteAddController({
      repository: store.repository,
      comicSource: async () => (sourceAvailable ? comicPort() : null),
    });

    await controller.requestFavoriteAdd({ book: book(), chapters: [] });
    const candidate = controller.getSnapshot().request?.candidates[0]?.favorite ?? null;
    expect(candidate).not.toBeNull();
    sourceAvailable = false;
    await controller.confirmFavoriteAdd(candidate);

    expect(FAVORITE_SOURCE_UNAVAILABLE).toBe('新来源暂不可用，请稍后重试');
    expect(controller.getSnapshot().request?.error).toBe(FAVORITE_SOURCE_UNAVAILABLE);
  });

  it('⑦d 收藏异常：L146 用 e.message，非 Error 走「收藏失败，请重试」', async () => {
    const store = fakeRepository([]);
    store.repository.isFavorite = async () => {
      throw new Error('数据库忙');
    };
    const controller = new FavoriteAddController({
      repository: store.repository,
      comicSource: async () => comicPort(),
    });

    await controller.requestFavoriteAdd({ book: book() });
    expect(controller.getSnapshot().message).toBe('数据库忙');

    const throwing = fakeRepository([]);
    throwing.repository.isFavorite = async () => {
      throw 'not-an-error';
    };
    const controller2 = new FavoriteAddController({
      repository: throwing.repository,
      comicSource: async () => comicPort(),
    });
    await controller2.requestFavoriteAdd({ book: book() });
    expect(controller2.getSnapshot().message).toBe('收藏失败，请重试');
  });

  it('⑦e confirm 异常兜底：「操作失败，旧收藏已保留」（L206）', async () => {
    const store = fakeRepository([
      favorite({ sourceId: 'src-a', comicId: 'c1', title: '葬送的芙莉莲' }),
    ]);
    store.repository.replaceFavorite = async () => {
      throw 'boom';
    };
    const controller = new FavoriteAddController({
      repository: store.repository,
      comicSource: async () => comicPort(),
    });

    await controller.requestFavoriteAdd({ book: book(), chapters: [createComicChapter({ id: 'ch-9', title: '第 1 话' })] });
    const candidate = controller.getSnapshot().request?.candidates[0]?.favorite ?? null;
    await controller.confirmFavoriteAdd(candidate);

    expect(controller.getSnapshot().request?.error).toBe(FAVORITE_CONFIRM_FAILED_MESSAGE);
    expect(FAVORITE_CONFIRM_FAILED_MESSAGE).toBe('操作失败，旧收藏已保留');
  });
});

describe('生产入口接线', () => {
  it('⑧ 三个页面加入收藏都走 requestFavoriteAdd，取消仍直连 repository', () => {
    const pages = ['LibraryPage.tsx', 'ComicChaptersPage.tsx', 'DiscoverPage.tsx'];
    for (const page of pages) {
      const source = readFileSync(path.resolve(process.cwd(), 'src/ui/pages', page), 'utf8');
      expect(source).toContain("from '@core/library/favoriteAddController'");
      expect(source).toContain('requestFavoriteAdd');
      // 旧写法（直接 add）必须消失，否则查重被绕过。
      expect(source).not.toMatch(/favorites\.add\(/u);
      expect(source).not.toMatch(/repo\.add\(book/u);
      expect(source).not.toMatch(/repository\.add\(/u);
    }
    // 取消收藏仍然直连（MainViewModel L104-106）。
    const libraryPage = readFileSync(
      path.resolve(process.cwd(), 'src/ui/pages', 'LibraryPage.tsx'),
      'utf8',
    );
    expect(libraryPage).toContain('favorites.remove(book.sourceId, book.id)');
  });
});
