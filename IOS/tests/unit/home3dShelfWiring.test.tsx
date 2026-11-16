/**
 * home3dShelfWiring.test.tsx — 3D 书架接进 `HomePage.tsx` 的接线钉子。
 *
 * 权威源：`novel-reader/app/src/main/java/com/example/ui/HomeScreen.kt`
 *   L237–238      `use3dShelf` / `use3dFavorites`（`remember(shelfPrefs) { mutableStateOf(...) }`）
 *   L1289–1299    书架 3D：`sortedBooks.isNotEmpty() && !selectedCategoryLocked && use3dShelf &&
 *                 phase == BROWSE` → `ArchiveShelf(scopeKey = "shelf:$selectedCategory")`
 *   L1876–1884    收藏 3D：`use3dFavorites && phase == BROWSE && favShelfBooks.isNotEmpty()` →
 *                 `ArchiveShelf(scopeKey = "favorites")`，`onBookClick = { favById[it.id]?.let(onOpenFavorite) }`
 *   L406–424      收藏 → 书架条目：`id = -(abs(item.key.hashCode()) + 1)`、`contentType = "COMIC"`、
 *                 `totalChapters = downloadedChapters`、`lastReadTime = progress?.lastReadAt ?: favoritedAt`
 *   L2348–2355    `ShelfViewControl`：`use3d ? "切换列表" : "切换 3D"`
 *
 * 覆盖：
 *   ① prefs 缺省（true）时书架渲染 `ArchiveShelf`（`data-wenku-favorites="false"`）而不是 `.hp-grid`
 *   ② 点「切换列表」→ 回到 `.hp-grid`，且 `shelf_uses_3d_view` 落库为 false
 *   ③ 收藏区 3D 的负 id 映射（唯一、与 `-(abs(javaHash) + 1)` 逐值一致）＋点击回调回查 `openFavorite`
 *   ④ `phase != BROWSE`（长按进入多选）时即使 `use3dShelf` 为 true 也强制留在网格
 *
 * 仓库没有 `@testing-library/react`，沿用 tests/unit 既有写法：`react-dom/client` + `act`。
 * jsdom 没有排版引擎，`getBoundingClientRect()` 恒为 0 —— 3D 书架按宽度算槽位，
 * 所以本文件把它的宽度钉成 411px（与 `wenkuShelfUi.test.tsx` 的几何基准同值），
 * 并把系统「减少动效」打开，跳过 520ms 入场时钟（槽位立即全部可见）。
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { javaStringHashCode } from '@core/download/downloadWorker';
import { DEFAULT_CATEGORY } from '@core/library/bookTypes';
import { FavoriteDao } from '@core/library/favoriteDao';
import { favoriteKey, type FavoriteEntity } from '@core/library/favoriteTypes';
import { LONG_PRESS_MS } from '@core/home/homeViewModel';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { ShelfMetrics, hitTestSlot } from '@core/wenku';
import { getPlatform } from '@platform/index';
import { bootstrapLibrary, getBookRepository } from '@ui/state/appStore';
import { HomePage } from '@ui/pages/HomePage';

/** `openFavorite` → `openOnlineBook`：唯一能观测「点收藏真的打开了哪一本」的出口。 */
vi.mock('@ui/lib/openOnlineBook', () => ({ openOnlineBook: vi.fn() }));

import { openOnlineBook } from '@ui/lib/openOnlineBook';

const openOnlineBookMock = vi.mocked(openOnlineBook);

/* ══════════════════════════════════════════════════════════════════════
 * 环境桩
 * ══════════════════════════════════════════════════════════════════════ */

interface MatchMediaLike {
  readonly matches: boolean;
  readonly media: string;
  addEventListener?: (type: string, listener: (event: { matches: boolean }) => void) => void;
  removeEventListener?: (type: string, listener: (event: { matches: boolean }) => void) => void;
  addListener?: (listener: (event: { matches: boolean }) => void) => void;
  removeListener?: (listener: (event: { matches: boolean }) => void) => void;
  onchange: null;
  dispatchEvent: (event: Event) => boolean;
}

/** 3D 书架的槽位依赖 `getBoundingClientRect().width`；jsdom 恒为 0，这里钉成 411。 */
const STAGE_RECT = {
  x: 0,
  y: 0,
  width: 411,
  height: 480,
  top: 0,
  left: 0,
  right: 411,
  bottom: 480,
  toJSON: () => ({}),
} as DOMRect;

/** 与组件同源的几何基准（`ShelfMetrics.of(411, 1)`，`wenkuShelfCore.test.ts` 的基准屏宽）。 */
const METRICS = ShelfMetrics.of(411, 1);

let rectSpy: ReturnType<typeof vi.spyOn> | null = null;
const realFetch = globalThis.fetch;

function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MatchMediaLike => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      dispatchEvent: () => false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  });
}

interface Mounted {
  readonly root: Root;
  readonly host: HTMLDivElement;
}

const mounted: Mounted[] = [];

beforeAll(async () => {
  // `bootstrapLibrary()` 会从 `public/` 取只读书源资源；jsdom 的 fetch 不接受相对
  // URL，这里换成只回 200 空脚本的桩（与 i18nWiring.test.tsx 同款）。
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('/')) throw new Error(`测试不联网：${url}`);
    return {
      status: 200,
      ok: true,
      url,
      headers: { forEach: () => undefined },
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;
  });
  installMatchMedia();
  await bootstrapLibrary();
});

afterAll(() => {
  vi.stubGlobal('fetch', realFetch);
});

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  installMatchMedia();
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(STAGE_RECT);
  openOnlineBookMock.mockClear();

  const db = getPlatform().db;
  await db.execute('DELETE FROM books');
  await db.execute('DELETE FROM favorites');
  await db.execute('DELETE FROM favorite_categories');

  const settings = new SettingsRepository(db);
  await settings.remove('shelf_uses_3d_view');
  await settings.remove('favorites_use_3d_view');

  await seedShelfBooks();
  await seedFavorites();
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.host.remove();
  }
  rectSpy?.mockRestore();
  rectSpy = null;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

/* ══════════════════════════════════════════════════════════════════════
 * 夹具
 * ══════════════════════════════════════════════════════════════════════ */

const SHELF_TITLES = ['雪国', '古都'] as const;

const FAVORITE_FIXTURES: readonly FavoriteEntity[] = [
  {
    sourceId: 'src-a',
    comicId: 'c1',
    title: '海贼王',
    author: '尾田荣一郎',
    coverUrl: null,
    localThumbPath: null,
    serialStatus: 'ongoing',
    latestChapterId: null,
    latestChapterTitle: null,
    latestChapterUpdateAt: 0,
    lastCheckedAt: 0,
    sourceAlive: true,
    categoryName: '默认',
    favoritedAt: 100,
    sortOrder: 0,
  },
  {
    sourceId: 'src-b',
    comicId: 'c2',
    title: '进击的巨人',
    author: '谏山创',
    coverUrl: null,
    localThumbPath: null,
    serialStatus: 'ongoing',
    latestChapterId: null,
    latestChapterTitle: null,
    latestChapterUpdateAt: 0,
    lastCheckedAt: 0,
    sourceAlive: true,
    categoryName: '默认',
    favoritedAt: 200,
    sortOrder: 0,
  },
];

async function seedShelfBooks(): Promise<void> {
  const repo = getBookRepository();
  if (repo === null) throw new Error('BookRepository 未装配');
  for (const [index, title] of SHELF_TITLES.entries()) {
    await repo.insertBook({
      title,
      author: '川端康成',
      filePath: null,
      coverUri: null,
      category: DEFAULT_CATEGORY,
      currentChapterIndex: index,
      scrollOffset: 0,
      isFinished: 0,
      totalChapters: 40 + index,
      contentType: 'novel',
      addedTime: 1000 + index,
      lastReadTime: 1000 + index,
      sourceId: null,
      comicId: null,
    });
  }
}

async function seedFavorites(): Promise<void> {
  const dao = new FavoriteDao(getPlatform().db);
  for (const favorite of FAVORITE_FIXTURES) await dao.insertFavorite(favorite);
}

/** HomeScreen.kt L413 —— `id = -(kotlin.math.abs(item.key.hashCode()) + 1)`。 */
function expectedFavoriteId(favorite: FavoriteEntity): number {
  return -(Math.abs(javaStringHashCode(favoriteKey(favorite.sourceId, favorite.comicId))) + 1);
}

/* ══════════════════════════════════════════════════════════════════════
 * 挂载 / 查询小工具
 * ══════════════════════════════════════════════════════════════════════ */

async function mountHome(): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => {
    root.render(<HomePage />);
  });
  await flush();
  return host;
}

/** 把 mount 期 effect 里的异步 setState（书架/收藏/偏好读取）冲干净。 */
async function flush(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

/** 轮询等待某个节点出现（异步读取落地后才有的内容）。 */
async function waitFor(host: HTMLElement, selector: string, timeoutMs = 4000): Promise<Element> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = host.querySelector(selector);
    if (found !== null) return found;
    if (Date.now() > deadline) throw new Error(`等待超时：${selector}`);
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
    });
  }
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** 头部 actions 里文案恰好等于 `label` 的胶囊（`ActionChip` 只有文本，无 testid）。 */
function findChip(host: Element | null, label: string): HTMLButtonElement {
  if (host === null) throw new Error('actions 容器不存在');
  const hit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => (button.textContent ?? '').trim() === label,
  );
  if (hit === undefined) {
    throw new Error(
      `找不到「${label}」；实际有：${[...host.querySelectorAll<HTMLButtonElement>('button')]
        .map((button) => (button.textContent ?? '').trim())
        .join(' | ')}`,
    );
  }
  return hit;
}

function firePointer(
  element: Element,
  type: 'pointerdown' | 'pointerup',
  x: number,
  y: number,
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: 1, configurable: true });
  Object.defineProperty(event, 'pointerType', { value: 'touch', configurable: true });
  act(() => {
    element.dispatchEvent(event);
  });
}

/* ══════════════════════════════════════════════════════════════════════
 * 断言
 * ══════════════════════════════════════════════════════════════════════ */

describe('HomePage × 3D 书架', () => {
  it('① prefs 缺省 true → 书架渲染 ArchiveShelf（books 映射），不是 .hp-grid', async () => {
    const host = await mountHome();

    const shelf = await waitFor(host, '[data-wenku-favorites="false"]');
    expect(shelf.getAttribute('data-wenku-count')).toBe(String(SHELF_TITLES.length));
    // 分类 scopeKey（Kotlin `scopeKey = "shelf:$selectedCategory"`）
    expect(host.querySelector('[data-testid="wenku-archive-shelf"]')).not.toBeNull();
    expect(host.querySelector('.hp-grid')).toBeNull();

    // 书架卡的字段映射：title 透传、id 正数、isComic=false
    const slotIds = [...shelf.querySelectorAll('[data-wenku-slot]')].map((node) =>
      Number(node.getAttribute('data-book-id')),
    );
    expect(slotIds.length).toBeGreaterThan(0);
    for (const id of slotIds) expect(id).toBeGreaterThan(0);

    // 头部 actions 里的切换胶囊文案（Kotlin `if (use3d) "切换列表" else "切换 3D"`）
    const shelfActions = host.querySelector('.home-shelf-header__actions');
    expect((findChip(shelfActions, '切换列表').textContent ?? '').trim()).toBe('切换列表');
  });

  it('② 点「切换列表」→ 回到 .hp-grid，并把 shelf_uses_3d_view 写成 false', async () => {
    const host = await mountHome();
    await waitFor(host, '[data-wenku-favorites="false"]');

    click(findChip(host.querySelector('.home-shelf-header__actions'), '切换列表'));
    await flush();

    expect(host.querySelector('[data-wenku-favorites="false"]')).toBeNull();
    expect(host.querySelector('.hp-grid')).not.toBeNull();
    // 收藏板块没被这条开关带上（两个 key 各自独立）
    expect(host.querySelector('[data-wenku-favorites="true"]')).not.toBeNull();

    const stored = await new SettingsRepository(getPlatform().db).getBoolean(
      'shelf_uses_3d_view',
      true,
    );
    expect(stored).toBe(false);

    // 文案换成另一档
    expect(
      (findChip(host.querySelector('.home-shelf-header__actions'), '切换 3D').textContent ?? '').trim(),
    ).toBe('切换 3D');
  });

  it('③ 收藏区 3D：负 id = -(abs(javaHash(key)) + 1) 唯一，点击回查 openFavorite', async () => {
    const host = await mountHome();

    const favShelf = await waitFor(host, '[data-wenku-favorites="true"]');
    expect(favShelf.getAttribute('data-wenku-count')).toBe(String(FAVORITE_FIXTURES.length));

    const expectedIds = FAVORITE_FIXTURES.map(expectedFavoriteId);
    for (const id of expectedIds) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeLessThan(0);
    }
    expect(new Set(expectedIds).size).toBe(expectedIds.length);

    const renderedIds = new Set(
      [...favShelf.querySelectorAll('[data-wenku-slot]')].map((node) =>
        Number(node.getAttribute('data-book-id')),
      ),
    );
    expect(renderedIds.size).toBeGreaterThan(0);
    for (const id of renderedIds) expect(expectedIds).toContain(id);

    // 点击当前居中的那本 → stage 的 resolveTap → onBookClick → favById 回查 → openFavorite
    const activeIndex = Number(favShelf.getAttribute('data-wenku-active-index'));
    const activeSlot = [...favShelf.querySelectorAll('[data-wenku-slot]')].find(
      (node) => Number(node.getAttribute('data-book-index')) === activeIndex,
    );
    expect(activeSlot).toBeDefined();
    const activeId = Number(activeSlot?.getAttribute('data-book-id'));
    const expected = FAVORITE_FIXTURES.find((item) => expectedFavoriteId(item) === activeId);
    expect(expected).toBeDefined();

    // ArchiveShelf 的「点击」只在 stage 的 pointerInput 里裁决（`.wenku-book` 只吞冒泡），
    // 所以按 core 的几何在**中心槽位**的封面中心按一下：该点必然命中当前居中的那本，
    // `resolveTap` 走 `open` 分支 → `openAt(activeIndex)` → `onBookClick`。
    const stage = favShelf.querySelector('[data-testid="wenku-archive-shelf-stage"]');
    expect(stage).not.toBeNull();
    if (stage === null || expected === undefined) return;
    const x = METRICS.startXPx + METRICS.originX(0) + METRICS.coverPx * 0.5;
    const y = METRICS.railY(0) + METRICS.originY(0) + METRICS.bodyPx * 0.5;
    expect(hitTestSlot(METRICS, { x, y }, activeIndex, FAVORITE_FIXTURES.length)).toBe(
      METRICS.focusOf(activeIndex, FAVORITE_FIXTURES.length),
    );
    firePointer(stage, 'pointerdown', x, y);
    firePointer(stage, 'pointerup', x, y);

    expect(openOnlineBookMock).toHaveBeenCalledTimes(1);
    expect(openOnlineBookMock.mock.calls[0]?.[0]).toMatchObject({
      id: expected.comicId,
      sourceId: expected.sourceId,
      title: expected.title,
    });
  });

  it('④ 多选（phase != BROWSE）时即使 use3dShelf = true 也强制留在网格', async () => {
    // 先落一个 false：首帧走列表，才能长按卡片进入多选（3D 书架没有网格卡）
    await new SettingsRepository(getPlatform().db).setBoolean('shelf_uses_3d_view', false);
    const host = await mountHome();

    const card = await waitFor(host, '.hp-book-card');
    expect(host.querySelector('[data-wenku-favorites="false"]')).toBeNull();

    firePointer(card, 'pointerdown', 40, 40);
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, LONG_PRESS_MS + 60);
      });
    });
    // 浏览态长按 350ms → 进入多选
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();

    click(findChip(host.querySelector('.home-shelf-header__actions'), '切换 3D'));
    await flush();

    // use3dShelf 已经是 true，但 phase 仍是 SELECTING → 3D 条件不成立，网格必须还在
    const stored = await new SettingsRepository(getPlatform().db).getBoolean(
      'shelf_uses_3d_view',
      true,
    );
    expect(stored).toBe(true);
    expect(host.querySelector('[data-wenku-favorites="false"]')).toBeNull();
    expect(host.querySelector('.hp-grid')).not.toBeNull();
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
  });
});
