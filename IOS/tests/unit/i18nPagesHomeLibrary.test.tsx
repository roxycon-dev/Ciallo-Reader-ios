/**
 * i18nPagesHomeLibrary.test.tsx — 「词表接入 HomePage / LibraryPage」的回归钉子。
 *
 * 覆盖：
 *   ① 中文态：两页渲染中文原文（`tr()` 在 ZH 下恒等），`getAppLanguage()` 为 ZH；
 *   ② 切 English：HomePage 的主路径文案变成词表里的英文（`My Shelf` / `Favorites` /
 *      `Import` / `New category` / `List`、搜索按钮 `aria-label="Search"`、搜索框
 *      `placeholder="Title or author"`），底栏同时给出 `Library` / `Discover` / `Shelf` …
 *   ③ 切 English：LibraryPage 的主路径同样变英文（页头 `Library`、欢迎门
 *      `Welcome to the library` / `Read locally` / `Online search` / `Advanced`）；
 *   ④ 切回中文：两页恢复原文，英文消失；
 *   ⑤ 切 EN 之后关键交互仍工作：书架 3D ↔ 列表切换（`List` ↔ `3D`，`.hp-grid` 出现/消失）、
 *      搜索展开与清空（`.hp-search__input` + `placeholder` + `Clear`）。
 *
 * 语言切换必须走 `useAppStore.getState().setAppLanguagePreference()`：`App.tsx` 订阅
 * `appLanguage` 才会整树重渲染（`tr()` 在渲染期重新求值），单改 core 的模块级语言
 * 不会触发 React 重渲染 —— 那就是这条接线最容易漏掉的一环。
 *
 * 仓库没有 `@testing-library/react`，沿用 tests/unit 既有写法：`react-dom/client` + `act`。
 * 全程 jsdom + 内存 SQLite（`@platform/web-mock`），不联网。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AppLanguage, getAppLanguage, setAppLanguage, tr } from '@core/i18n';
import { DEFAULT_CATEGORY } from '@core/library/bookTypes';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { getPlatform } from '@platform/index';
import { bootstrapLibrary, getBookRepository, useAppStore } from '@ui/state/appStore';
// `src/App.tsx` 在 `@ui/` 之外（alias 只覆盖 `src/ui`），与既有测试一样走相对路径。
import { App } from '../../src/App';

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

function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MatchMediaLike => ({
      // 打开「减少动效」：跳过 3D 书架 520ms 的入场时钟，槽位立即全部可见。
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

const realFetch = globalThis.fetch;
let rectSpy: ReturnType<typeof vi.spyOn> | null = null;

interface Mounted {
  readonly root: Root;
  readonly host: HTMLDivElement;
}

const mounted: Mounted[] = [];

const SHELF_TITLES = ['雪国', '古都'] as const;

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

beforeAll(async () => {
  // `bootstrapLibrary()` 会从 `public/` 取只读书源资源；jsdom 的 fetch 不接受相对
  // URL，这里换成只回 200 空脚本的桩（与 i18nWiring.test.tsx 同款），不联网。
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

  setAppLanguage(AppLanguage.ZH);
  document.documentElement.lang = '';
  useAppStore.setState({
    route: 'main',
    activeTab: 'bookshelf',
    appLanguage: AppLanguage.ZH,
  });

  const db = getPlatform().db;
  await db.execute('DELETE FROM books');
  await db.execute('DELETE FROM favorites');
  await db.execute('DELETE FROM favorite_categories');
  const settings = new SettingsRepository(db);
  // 3D 书架的首读缺省是 true（`getBoolean(key, true)`），显式清掉让每条用例同起点。
  await settings.remove('shelf_uses_3d_view');
  await settings.remove('favorites_use_3d_view');
  await settings.remove('app_language');

  await seedShelfBooks();
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.host.remove();
  }
  rectSpy?.mockRestore();
  rectSpy = null;
  setAppLanguage(AppLanguage.ZH);
  document.documentElement.lang = '';
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

/* ══════════════════════════════════════════════════════════════════════
 * 挂载 / 查询小工具
 * ══════════════════════════════════════════════════════════════════════ */

async function mountApp(): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => {
    root.render(<App />);
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
function findChip(scope: Element | null, label: string): HTMLButtonElement {
  if (scope === null) throw new Error('actions 容器不存在');
  const buttons = [...scope.querySelectorAll<HTMLButtonElement>('button')];
  const hit = buttons.find((button) => (button.textContent ?? '').trim() === label);
  if (hit === undefined) {
    throw new Error(
      `找不到「${label}」；实际有：${buttons.map((button) => (button.textContent ?? '').trim()).join(' | ')}`,
    );
  }
  return hit;
}

/** 语言切换的唯一入口：store + core 单例 + 落库，缺一不可。 */
async function switchLanguage(language: AppLanguage): Promise<void> {
  await act(async () => {
    await useAppStore.getState().setAppLanguagePreference(language);
  });
  await flush(2);
}

/** 底栏标签（TabShell 渲染期 `tr(TAB_ITEMS[].label)`）。 */
function tabLabels(host: HTMLElement): string[] {
  return [...host.querySelectorAll('.app-tabbar-label')].map((node) => (node.textContent ?? '').trim());
}

/* ══════════════════════════════════════════════════════════════════════
 * 用例
 * ══════════════════════════════════════════════════════════════════════ */

describe('i18n 接线 × HomePage / LibraryPage', () => {
  it('① 中文态：HomePage 渲染中文原文', async () => {
    const host = await mountApp();
    await waitFor(host, '[data-wenku-favorites="false"]');

    const text = host.textContent ?? '';
    expect(getAppLanguage()).toBe(AppLanguage.ZH);
    expect(tr('我的书架')).toBe('我的书架');

    // 页头 + 书架分区标题（两处都走 `tr('我的书架')`）
    expect(text).toContain('我的书架');
    expect(text).toContain('我喜欢的');
    expect(text).toContain('阅读统计');
    // 头部胶囊：排序 / 导入 / 新建分类 / 3D 切换（Kotlin `if (use3d) "切换列表"`）
    const actions = host.querySelector('.home-shelf-header__actions');
    expect((findChip(actions, '导入新书').textContent ?? '').trim()).toBe('导入新书');
    expect((findChip(actions, '新建分类').textContent ?? '').trim()).toBe('新建分类');
    expect((findChip(actions, '切换列表').textContent ?? '').trim()).toBe('切换列表');
    // 搜索展开按钮的 aria-label
    expect(host.querySelector('button[aria-label="搜索"]')).not.toBeNull();
    expect(tabLabels(host)).toEqual(['书库', '发现', '书架', '统计', '设置']);
  });

  it('② 切 English：HomePage 主路径出现词表英文', async () => {
    const host = await mountApp();
    await waitFor(host, '[data-wenku-favorites="false"]');

    await switchLanguage(AppLanguage.EN);

    expect(useAppStore.getState().appLanguage).toBe('en');
    expect(getAppLanguage()).toBe(AppLanguage.EN);
    expect(document.documentElement.lang).toBe('en');

    const text = host.textContent ?? '';
    // 页头 / 分区标题 / 收藏标题 / 统计卡
    expect(text).toContain('My Shelf');
    expect(text).toContain('Favorites');
    expect(text).toContain('Continue Reading');
    expect(text).toContain('Stats');
    expect(text).not.toContain('我的书架');
    // 头部胶囊（`导入新书` / `新建分类` / `切换列表`）
    const actions = host.querySelector('.home-shelf-header__actions');
    expect((findChip(actions, 'Import').textContent ?? '').trim()).toBe('Import');
    expect((findChip(actions, 'New category').textContent ?? '').trim()).toBe('New category');
    expect((findChip(actions, 'List').textContent ?? '').trim()).toBe('List');
    // 搜索按钮 aria-label 与后续搜索框 placeholder
    const searchButton = host.querySelector('button[aria-label="Search"]');
    expect(searchButton).not.toBeNull();
    click(searchButton as Element);
    await flush(1);
    const input = host.querySelector<HTMLInputElement>('.hp-search__input');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('placeholder')).toBe('Title or author');
    // 底栏（`书库`/`书架` 的渲染期 tr）
    expect(tabLabels(host)).toEqual(['Library', 'Discover', 'Shelf', 'Stats', 'Settings']);
  });

  it('③ 切 English：LibraryPage 主路径出现词表英文', async () => {
    const host = await mountApp();

    act(() => {
      useAppStore.getState().setTab('library');
    });
    await flush(2);

    // 中文态：欢迎门（首启默认）
    expect(host.textContent ?? '').toContain('欢迎使用书库');

    await switchLanguage(AppLanguage.EN);

    const text = host.textContent ?? '';
    // 页头 `书库` → `Library`（同名的底栏标签另算，下方单独断言）
    expect(host.querySelector('.lib-welcome__title')?.textContent?.trim()).toBe(
      'Welcome to the library',
    );
    expect(text).toContain('Read locally');
    expect(text).toContain('Online search');
    expect(text).toContain('Advanced');
    expect(text).not.toContain('欢迎使用书库');
    expect(text).not.toContain('本地阅读');
    // 底栏与页头同时是英文
    expect(text).toContain('Library');
    expect(tabLabels(host)).toEqual(['Library', 'Discover', 'Shelf', 'Stats', 'Settings']);
  });

  it('④ 切回中文：HomePage / LibraryPage 都恢复原文', async () => {
    const host = await mountApp();
    await waitFor(host, '[data-wenku-favorites="false"]');

    await switchLanguage(AppLanguage.EN);
    expect(host.textContent ?? '').toContain('My Shelf');

    await switchLanguage(AppLanguage.ZH);

    expect(useAppStore.getState().appLanguage).toBe('zh');
    expect(getAppLanguage()).toBe(AppLanguage.ZH);
    expect(document.documentElement.lang).toBe('zh-CN');

    const text = host.textContent ?? '';
    expect(text).toContain('我的书架');
    expect(text).not.toContain('My Shelf');
    expect((findChip(host.querySelector('.home-shelf-header__actions'), '切换列表').textContent ?? '').trim()).toBe(
      '切换列表',
    );

    // 书库页同样回中文
    act(() => {
      useAppStore.getState().setTab('library');
    });
    await flush(2);
    expect(host.textContent ?? '').toContain('欢迎使用书库');
    expect(host.textContent ?? '').not.toContain('Welcome to the library');
  });

  it('⑤ 切 EN 后关键交互仍工作：书架 3D ↔ 列表、搜索展开 / 清空', async () => {
    const host = await mountApp();
    await waitFor(host, '[data-wenku-favorites="false"]');

    await switchLanguage(AppLanguage.EN);

    // 3D 缺省开启：胶囊是 `List`，书架是 ArchiveShelf 而不是网格
    const actions = host.querySelector('.home-shelf-header__actions');
    expect((findChip(actions, 'List').textContent ?? '').trim()).toBe('List');
    expect(host.querySelector('[data-wenku-favorites="false"]')).not.toBeNull();
    expect(host.querySelector('.hp-grid')).toBeNull();

    // 切到列表：网格出现，胶囊换成 `3D`
    click(findChip(actions, 'List'));
    await flush(2);
    expect(host.querySelector('.hp-grid')).not.toBeNull();
    expect(host.querySelector('[data-wenku-favorites="false"]')).toBeNull();
    expect((findChip(actions, '3D').textContent ?? '').trim()).toBe('3D');

    // 再切回 3D：ArchiveShelf 回来（交互闭环，不只是单向开关）
    click(findChip(actions, '3D'));
    await flush(2);
    expect(host.querySelector('[data-wenku-favorites="false"]')).not.toBeNull();
    expect((findChip(actions, 'List').textContent ?? '').trim()).toBe('List');

    // 搜索：展开 → 输入框出现（placeholder 走词表）→ Clear 收起
    const expand = host.querySelector('button[aria-label="Search"]');
    expect(expand).not.toBeNull();
    click(expand as Element);
    await flush(1);
    const input = host.querySelector<HTMLInputElement>('.hp-search__input');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('placeholder')).toBe('Title or author');
    expect(document.activeElement).toBe(input);

    const clear = host.querySelector('.hp-search__close');
    expect(clear?.getAttribute('aria-label')).toBe('Clear');
    click(clear as Element);
    await flush(1);
    expect(host.querySelector('.hp-search__input')).toBeNull();
  });

  it('⑥ 词表口径：被包裹的 key 在 EN 下确实有英文，ZH 下恒等回原文', () => {
    // 抽几条本文件断言过的 key，钉住「只包裹 EN_PAIRS 里确实存在的 key」这条约束。
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['我的书架', 'My Shelf'],
      ['我喜欢的', 'Favorites'],
      ['导入新书', 'Import'],
      ['新建分类', 'New category'],
      ['切换列表', 'List'],
      ['切换 3D', '3D'],
      ['搜索', 'Search'],
      ['输入书名或作者', 'Title or author'],
      ['书库', 'Library'],
      ['欢迎使用书库', 'Welcome to the library'],
    ];
    setAppLanguage(AppLanguage.ZH);
    for (const [zh] of pairs) expect(tr(zh)).toBe(zh);
    setAppLanguage(AppLanguage.EN);
    for (const [zh, en] of pairs) expect(tr(zh)).toBe(en);
  });
});
