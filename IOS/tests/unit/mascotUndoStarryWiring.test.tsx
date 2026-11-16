/**
 * mascotUndoStarryWiring.test.tsx — E96 / E97 / E103 三处「已登记 GAP」的接线钉子。
 *
 * 权威源（Android，`novel-reader/app/src/main/java/com/example/`）：
 *   E96 删除的 8 秒撤销窗口
 *     MainViewModel.kt:881-905  `deletionScope` + `pendingDeleteTokens`
 *                               `scheduleBooksDeletion(books, token, onCommitted)`：
 *                               `delay(8_000)` 后**令牌还在**才 `repository.deleteBook(it)`
 *                               `cancelBooksDeletion(token)` = 从令牌表里摘掉
 *     MainActivity.kt:766-776   `pendingDeleteBooks`（软删除清单）+ `visibleBooks`
 *                               = `books.filter { it.id !in ids }`（卡片先消失）
 *     MainActivity.kt:777-790   `showUndo(message, undo)`：`SnackbarDuration.Long`
 *                               （= 10000ms）+ 动作「撤销」
 *     MainActivity.kt:1037-1057 `onDeleteDownloads`：`val token = UUID.randomUUID()`
 *                               → `scheduleBooksDeletion(list, token)`
 *                               → `showUndo("已删除 N 本，释放 X（阅读进度保留）") { cancelBooksDeletion(token) }`
 *   E97 吉祥物四事件
 *     MainActivity.kt:962       DeleteBook（删书回调内，紧跟 `viewModel.deleteBook`）
 *     MainActivity.kt:966       MoveBook
 *     MainActivity.kt:1453      AddBookmark（**加**书签，取消书签不播）
 *     ReaderScreen.kt:1642      BookComplete（翻到最后一章最后一页）
 *     MainActivity.kt:2086      `MascotOverlay()` —— 根部挂一次
 *   E103 星空 / 台灯底层
 *     HomeScreen.kt:666         `StarryNightBackground(showLamp = true) { … }`
 *
 * 覆盖：
 *   ① 删除后卡片立刻消失，但 8 秒窗口内 `books` 表一行未删（软删除）
 *   ② 8 秒到期 → 真正 `deleteBookDb`，并且播 DeleteSad（E97 的删书事件点）
 *   ③ 点「撤销」→ 卡片回来、DB 一行不动（窗口内 cancel 生效）
 *   ④ 两批删除各自一个 token：撤销最新一批只救回它，前一批照常落库
 *   ⑤ 四种吉祥物事件各触发一次 → 各自渲染对应动画（`playMascotEvent` 端口）
 *   ⑥ HomePage 渲染星空/台灯底层：`.home-page` 首子节点、`pointer-events:none`、
 *      CSS 里有绝对定位 + z-index: 0 的规则
 *
 * 仓库没有 `@testing-library/react`，沿用 `home3dShelfWiring.test.tsx` 的写法：
 * `react-dom/client` + `act` + 内存 SQLite（`@platform` 的 web-mock）。
 * 3D 书架默认开着会吃掉网格卡，所以每个用例先把 `shelf_uses_3d_view` 落成 false。
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { LONG_PRESS_MS } from '@core/home/homeViewModel';
import { DEFAULT_CATEGORY } from '@core/library/bookTypes';
import {
  MascotAnimationController,
  type MascotEvent,
} from '@core/mascot/mascotEvents';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { getPlatform } from '@platform/index';
import { bootstrapLibrary, getBookRepository } from '@ui/state/appStore';
import { HomePage } from '@ui/pages/HomePage';
import { MascotOverlay, playMascotEvent } from '@ui/components/mascot/MascotAnimationController';

/* ══════════════════════════════════════════════════════════════════════
 * 环境桩（与 home3dShelfWiring.test.tsx 同款）
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

/** 3D 书架按 `getBoundingClientRect().width` 算槽位；jsdom 恒为 0，这里钉成 411。 */
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

  const db = getPlatform().db;
  await db.execute('DELETE FROM books');
  await db.execute('DELETE FROM favorites');
  await db.execute('DELETE FROM favorite_categories');
  await db.execute('DELETE FROM chapters');

  const settings = new SettingsRepository(db);
  await settings.remove('shelf_uses_3d_view');
  await settings.remove('favorites_use_3d_view');
  // 网格卡才是删除 / 多选的入口（3D 书架没有 `.hp-book-card`）
  await settings.setBoolean('shelf_uses_3d_view', false);

  await seedShelfBooks();
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

const bookIds = new Map<string, number>();

function repoOrThrow(): NonNullable<ReturnType<typeof getBookRepository>> {
  const repo = getBookRepository();
  if (repo === null) throw new Error('BookRepository 未装配');
  return repo;
}

async function seedShelfBooks(): Promise<void> {
  bookIds.clear();
  const repo = repoOrThrow();
  for (const [index, title] of SHELF_TITLES.entries()) {
    const id = await repo.insertBook({
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
    bookIds.set(title, id);
  }
}

function idOf(title: string): number {
  const id = bookIds.get(title);
  if (id === undefined) throw new Error(`夹具缺书：${title}`);
  return id;
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
  await waitFor(host, '.hp-book-card');
  return host;
}

function mountOverlay(): HTMLDivElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => {
    root.render(<MascotOverlay />);
  });
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

/** 假时钟下的「把微任务 / 0ms 定时器跑完」。 */
async function flushFake(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/** 假时钟下推进 `ms`（先跑定时器，再跑它带出来的微任务链）。 */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flushFake();
}

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

function click(element: Element | null): void {
  if (element === null) throw new Error('点击目标不存在');
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function findCard(host: HTMLElement, title: string): HTMLElement | null {
  const cards = [...host.querySelectorAll<HTMLElement>('.hp-book-card')];
  return (
    cards.find(
      (card) => (card.querySelector('.hp-book-card__title')?.textContent ?? '').trim() === title,
    ) ?? null
  );
}

function buttonWithText(scope: Element | null, label: string): HTMLButtonElement {
  if (scope === null) throw new Error('容器不存在');
  const hit = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => (button.textContent ?? '').trim() === label,
  );
  if (hit === undefined) {
    throw new Error(
      `找不到「${label}」；实际有：${[...scope.querySelectorAll<HTMLButtonElement>('button')]
        .map((button) => (button.textContent ?? '').trim())
        .join(' | ')}`,
    );
  }
  return hit;
}

function firePointer(element: Element, x: number, y: number): void {
  const event = new MouseEvent('pointerdown', {
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

/** 浏览态长按 350ms → 进入多选（HomeScreen.kt L601–628 的第二步语义）。 */
async function enterSelection(host: HTMLElement, title: string): Promise<void> {
  const card = findCard(host, title);
  if (card === null) throw new Error(`找不到书卡：${title}`);
  firePointer(card, 30, 30);
  await advance(LONG_PRESS_MS + 60);
  if (host.querySelector('.hp-actionbar') === null) throw new Error('多选操作栏未出现');
}

/** 多选操作栏「删除下载」→ 一整批一个 token（MainActivity.kt:1037-1057）。 */
async function deleteSelected(host: HTMLElement): Promise<void> {
  click(buttonWithText(host.querySelector('.hp-actionbar'), '删除下载'));
  await flushFake();
}

function undoButton(host: HTMLElement): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('.hp-undo__action');
  if (button === null) throw new Error('撤销横幅没有「撤销」按钮');
  return button;
}

/** 收集吉祥物事件实例（`MascotAnimationController` 是进程级单例）。 */
function collectMascotEvents(): { readonly events: MascotEvent[]; stop(): void } {
  const events: MascotEvent[] = [];
  const stop = MascotAnimationController.subscribe((instance) => {
    events.push(instance.event);
  });
  return { events, stop };
}

const ROOT_DIR = process.cwd();

function readProjectFile(relative: string): string {
  return readFileSync(path.join(ROOT_DIR, relative), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════
 * E96 · 删除的 8 秒撤销窗口
 * ══════════════════════════════════════════════════════════════════════ */

describe('E96 · 书架删除的 8 秒撤销窗口', () => {
  it('① 删除后卡片立刻消失，但 8 秒窗口内一行 SQL 都没执行', async () => {
    const host = await mountHome();
    const id = idOf('雪国');

    vi.useFakeTimers();
    try {
      await enterSelection(host, '雪国');
      await deleteSelected(host);

      // MainActivity.kt:773-776 `visibleBooks = books - pendingDeleteBooks`
      expect(findCard(host, '雪国')).toBeNull();
      // 8 秒窗口内：DB 还在（软删除），并且横幅带「撤销」
      expect(await repoOrThrow().getBook(id)).not.toBeNull();
      const banner = host.querySelector('.hp-undo');
      expect(banner).not.toBeNull();
      expect(banner?.textContent ?? '').toContain('已删除 1 本');
      expect(banner?.textContent ?? '').toContain('阅读进度保留');
      expect(undoButton(host).textContent?.trim()).toBe('撤销');
    } finally {
      vi.useRealTimers();
    }
  });

  it('② 8 秒到期 → 真正落库，并在提交之后播 DeleteSad', async () => {
    const host = await mountHome();
    const id = idOf('雪国');
    const mascot = collectMascotEvents();

    vi.useFakeTimers();
    try {
      await enterSelection(host, '雪国');
      await deleteSelected(host);
      expect(await repoOrThrow().getBook(id)).not.toBeNull();
      expect(mascot.events).not.toContain('DeleteBook'); // 窗口没到，不许落库也不许播

      // MainViewModel.kt:893 `delay(8_000)` → 8 秒整
      await advance(7999);
      expect(await repoOrThrow().getBook(id)).not.toBeNull();

      await advance(1);
      expect(await repoOrThrow().getBook(id)).toBeNull();
      expect(mascot.events).toEqual(['DeleteBook']);
    } finally {
      mascot.stop();
      vi.useRealTimers();
    }
  });

  it('③ 点「撤销」→ 卡片回来，8 秒后依然不落库', async () => {
    const host = await mountHome();
    const id = idOf('雪国');

    vi.useFakeTimers();
    try {
      await enterSelection(host, '雪国');
      await deleteSelected(host);
      expect(findCard(host, '雪国')).toBeNull();

      click(undoButton(host));
      await flushFake();

      // 撤销 = cancelBooksDeletion(token) + 从软删除清单里摘掉 → 卡片回到网格
      expect(findCard(host, '雪国')).not.toBeNull();
      expect(await repoOrThrow().getBook(id)).not.toBeNull();

      await advance(8000);
      expect(await repoOrThrow().getBook(id)).not.toBeNull();
      expect(findCard(host, '雪国')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('④ 批量删除一批一个 token：撤销最新一批只救回它，前一批照常落库', async () => {
    const host = await mountHome();
    const snow = idOf('雪国');
    const gudu = idOf('古都');

    vi.useFakeTimers();
    try {
      // 批 1（token 1）
      await enterSelection(host, '雪国');
      await deleteSelected(host);
      // 批 2（token 2）—— 前一批仍在软删除清单里，所以网格只剩「古都」
      await enterSelection(host, '古都');
      await deleteSelected(host);

      expect(findCard(host, '雪国')).toBeNull();
      expect(findCard(host, '古都')).toBeNull();
      expect(host.querySelector('.hp-undo')?.textContent ?? '').toContain('已删除 1 本');

      // 横幅上的「撤销」只对最新一批的 token 生效（Kotlin 同样每批一个 token）
      click(undoButton(host));
      await flushFake();
      expect(findCard(host, '古都')).not.toBeNull();
      expect(findCard(host, '雪国')).toBeNull();

      await advance(8000);
      expect(await repoOrThrow().getBook(snow)).toBeNull(); // 批 1 已提交
      expect(await repoOrThrow().getBook(gudu)).not.toBeNull(); // 批 2 被撤销
      expect(findCard(host, '古都')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * E97 · 吉祥物四事件
 * ══════════════════════════════════════════════════════════════════════ */

describe('E97 · Mascot 四种事件动画', () => {
  it('⑤ 四种事件各触发一次，各自渲染对应动画；覆盖层由 App 根部挂一次', () => {
    const host = mountOverlay();
    const mascot = collectMascotEvents();
    try {
      expect(host.querySelector('.mascot-overlay')).toBeNull(); // 没事件就不占屏

      const cases: ReadonlyArray<readonly [MascotEvent, string]> = [
        ['DeleteBook', 'mascot-popup--delete'],
        ['MoveBook', 'mascot-popup--move'],
        ['AddBookmark', 'mascot-popup--bookmark'],
        ['BookComplete', 'mascot-popup--complete'],
      ];
      for (const [kind, className] of cases) {
        act(() => {
          playMascotEvent(kind);
        });
        expect(host.querySelector(`.mascot-popup.${className}`)).not.toBeNull();
      }

      // 每个事件恰好一次，顺序即调用顺序（方案 A：打断重播，不排队）
      expect(mascot.events).toEqual(['DeleteBook', 'MoveBook', 'AddBookmark', 'BookComplete']);
    } finally {
      mascot.stop();
    }

    // MainActivity.kt:2086 `MascotOverlay()` —— 根部挂一次（两次会把同一事件播两遍）
    const appSource = readProjectFile('src/App.tsx');
    expect(appSource.match(/<MascotOverlay\s*\/>/g) ?? []).toHaveLength(1);
  });

  it('⑤b 删书 / 移书两个真实事件点由 HomePage 触发（Kotlin 962 / 966）', async () => {
    const host = await mountHome();
    const mascot = collectMascotEvents();

    vi.useFakeTimers();
    try {
      // 删书：窗口到期提交后才播（E96 × E97 的接缝）
      await enterSelection(host, '雪国');
      await deleteSelected(host);
      await advance(8000);
      expect(mascot.events).toEqual(['DeleteBook']);

      // 移书：多选「移动」→ 选一个分类（HomeScreen.kt:473-475 onMoveBook）
      await enterSelection(host, '古都');
      click(buttonWithText(host.querySelector('.hp-actionbar'), '移动'));
      await flushFake();
      const sheet = host.querySelector('.hp-sheet[role="dialog"]');
      click(buttonWithText(sheet, DEFAULT_CATEGORY));
      await flushFake();

      expect(mascot.events).toEqual(['DeleteBook', 'MoveBook']);
    } finally {
      mascot.stop();
      vi.useRealTimers();
    }
  });

  it('⑤c ReaderPage 的两个事件点已接线（加书签 1453 / 读完 1642）', () => {
    const readerSource = readProjectFile('src/ui/pages/ReaderPage.tsx');
    expect(readerSource).toContain("playMascotEvent('AddBookmark')");
    expect(readerSource).toContain("playMascotEvent('BookComplete')");
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * E103 · 首页星空 + 台灯背景层
 * ══════════════════════════════════════════════════════════════════════ */

describe('E103 · 首页星空 + 台灯背景层', () => {
  it('⑥ 渲染星空层作为首子节点，台灯开着、不吃指针、CSS 定位为绝对底层', async () => {
    const host = await mountHome();

    const page = host.querySelector('.home-page');
    expect(page).not.toBeNull();
    const layer = host.querySelector<HTMLElement>('.home-page > .starry-night-background');
    expect(layer).not.toBeNull();
    if (layer === null) return;

    // 定位层：首子节点 → 后续内容按文档顺序叠在它上面，且它脱离文档流
    expect(page?.firstElementChild).toBe(layer);
    expect(layer.className).toContain('home-page__starfield');
    // `pointer-events: none` 走内联兜底（jsdom 不加载样式表，只有内联值可断言）
    expect(layer.style.pointerEvents).toBe('none');
    // HomeScreen.kt:666 `showLamp = true` → 台灯径向渐变子层必须存在
    expect(layer.querySelector('.starry-night-background__lamp')).not.toBeNull();

    // 定位规则写在 homePage.css（components.css 的既有样式不动）
    const css = readProjectFile('src/styles/homePage.css');
    const start = css.search(/\n\.home-page__starfield\s*\{/);
    expect(start).toBeGreaterThanOrEqual(0);
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('position: absolute');
    expect(block).toContain('inset: 0');
    expect(block).toContain('z-index: 0');
    expect(block).toContain('pointer-events: none');
  });
});
