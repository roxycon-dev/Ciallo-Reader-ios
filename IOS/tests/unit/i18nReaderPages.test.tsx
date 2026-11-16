/**
 * i18nReaderPages.test.tsx — 阅读器三页的界面语言接线回归。
 *
 * 覆盖面（任务书要求的最小集）：
 *   (a) 中文态渲染原文（控制栏 / 底栏 / 漫画 chrome）；
 *   (b) 切 EN 后 ReaderPage 控制栏与底栏出现词表英文（Contents / Bookmarks / Back …），
 *       ComicReaderPage 的 chrome 出现 Contents / Settings / Previous page；
 *   (c) 切回中文恢复原文；
 *   (d) 关键交互仍工作：打开目录（`.rd-sheet` + 章节项）、底栏「下一章」推进章节、
 *       漫画底栏「下一页」仍然外翻（回调被调用）。
 *   (e) ComicChaptersPage 走源码级断言：它要挂载需要完整 library 快照与书目仓储，
 *       本文件只钉「接线点」（`import { tr }` + 具体 key 被包裹），与
 *       `touchZonesWiring.test.tsx` 的 ReaderPage 段落同一手法。
 *
 * 语言切换的驱动方式与 `src/App.tsx` 一致：`App` 订阅 `useAppStore(s => s.appLanguage)`，
 * 语言一变整棵树重渲染（项目里没有任何 `React.memo` 边界），`tr()` 在渲染期重新求值。
 * 这里用同款订阅包一层 Harness，而不是 `key={language}` 强制重挂载 —— 重挂载会丢掉
 * 「控制栏已经打开」这类会话内状态，测出来的就不是产品行为了。
 *
 * 全程 jsdom + 内存平台（`@platform/web-mock`），不联网；db 不参与：
 * 挂载期 ReaderPage 会 `openBook(bookId)`，仓储为空会把正文清空，因此本文件把
 * `openBook` 钉成 no-op 并直接喂 store 的 `books` / `chapters`。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AppLanguage, getAppLanguage, setAppLanguage } from '@core/i18n';
import type { BookRow, ChapterRow } from '@core/library/bookTypes';
import type { Book } from '@ui/state/appStore';
import { useAppStore } from '@ui/state/appStore';
import { ReaderPage } from '@ui/pages/ReaderPage';
import { ComicReaderPage } from '@ui/pages/ComicReaderPage';
import {
  DEFAULT_COMIC_READER_CONFIG,
  type ComicBitmap,
  type ComicPageLoaderPort,
  type ComicPageRef,
  type ComicReaderConfig,
} from '@core/comic/comicReaderCore';

// React 19 要求显式声明 act 环境
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

/* ══════════════════════════════════════════════════════════════════════════════
   夹具
   ══════════════════════════════════════════════════════════════════════════════ */

const BOOK: BookRow = {
  id: 1,
  title: '测试书',
  author: '测试作者',
  filePath: null,
  coverUri: null,
  category: null,
  currentChapterIndex: 0,
  scrollOffset: 0,
  isFinished: 0,
  totalChapters: 2,
  contentType: 'NOVEL',
  addedTime: 0,
  lastReadTime: 0,
  sourceId: null,
  comicId: null,
};

const CHAPTERS: ChapterRow[] = [
  {
    id: 1,
    bookId: 1,
    chapterOrder: 0,
    title: '第一章',
    content: '第一章的正文内容，用来撑出一页以上的排版。',
    startCharIndex: 0,
    endCharIndex: 22,
  },
  {
    id: 2,
    bookId: 1,
    chapterOrder: 1,
    title: '第二章',
    content: '第二章的正文内容，用来验证翻章后标题跟着变。',
    startCharIndex: 23,
    endCharIndex: 45,
  },
];

/** 1×1 PNG，浏览器可解码 */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function localPages(count: number): ComicPageRef[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: 'LOCAL' as const,
    id: `p${String(i + 1)}`,
    path: PIXEL,
  }));
}

/** 立即返回 1×1 位图的解码器端口（跳过真实解码时序） */
function fastLoader(): ComicPageLoaderPort {
  const bitmap: ComicBitmap = { src: PIXEL, width: 1, height: 1 };
  return {
    peekProcessed: () => bitmap,
    peekReadingPreview: () => null,
    loadForDisplay: () => Promise.resolve(bitmap),
    decodeRegion: () => Promise.resolve(null),
    preloadWindow: () => undefined,
    replaceProcessed: () => undefined,
    evictProcessed: () => undefined,
    probeSizes: () => Promise.resolve(),
    clearProcessedCache: () => undefined,
    shutdown: () => undefined,
    sizes: () => ({}),
    subscribeSizes: () => () => undefined,
  };
}

/** 带默认值的设置仓库替身（避免 localStorage 副作用） */
function comicStore() {
  const config: ComicReaderConfig = { ...DEFAULT_COMIC_READER_CONFIG };
  return {
    loadGlobalConfig: () => config,
    saveGlobalConfig: () => undefined,
    loadBookConfig: () => null,
    saveBookConfig: () => undefined,
    clearBookConfig: () => undefined,
    loadBookState: () => ({
      lastPage: 0,
      lastChapterSig: null,
      pageRotations: {},
      mergeAnchors: new Set<number>(),
    }),
    saveBookState: () => undefined,
    effectiveConfig: () => ({ config, hasOverride: false }),
  };
}

interface Mounted {
  readonly root: Root;
  readonly host: HTMLDivElement;
}

const mounted: Mounted[] = [];

async function mount(node: ReactNode): Promise<Mounted> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const entry: Mounted = { root, host };
  mounted.push(entry);
  await act(async () => {
    root.render(node);
  });
  return entry;
}

/** 冲掉挂载期 effect 里的异步 setState（分页 0ms 定时器、prefs 读取）。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
  }
}

function click(el: Element | null): void {
  if (el === null) throw new Error('click target not found');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/**
 * 与 `App.tsx` 同款的语言订阅：store 的 `appLanguage` 一变，本组件重渲染并**重新创建**
 * 子元素，子树（无 memo 边界）跟着重渲染，`tr()` 在渲染期重新求值。
 *
 * 注意不能写成 `<Harness>{<ReaderPage />}</Harness>`：那样每次重渲染拿到的都是同一个
 * element 引用，React 会按 `pendingProps === memoizedProps` 直接跳过子树的渲染 ——
 * 测出来会像「切语言没生效」。
 */
function ReaderHarness(): ReactNode {
  useAppStore((s) => s.appLanguage);
  return <ReaderPage />;
}

const NOOP = (): void => undefined;

function ComicHarness(props: { onNextChapter: (() => void) | null; pageCount: number }): ReactNode {
  useAppStore((s) => s.appLanguage);
  const loader = useMemo(() => fastLoader(), []);
  const store = useMemo(() => comicStore(), []);
  const pages = useMemo(() => localPages(props.pageCount), [props.pageCount]);
  return (
    <ComicReaderPage
      pages={pages}
      title="测试漫画"
      bookKey={null}
      loader={loader}
      store={store}
      onGodMoment={NOOP}
      {...(props.onNextChapter === null ? {} : { onNextChapter: props.onNextChapter })}
    />
  );
}

/** 切语言：走产品路径（store + core 单例一起改）。 */
async function switchLanguage(language: AppLanguage): Promise<void> {
  await act(async () => {
    await useAppStore.getState().setAppLanguagePreference(language);
  });
  await settle();
}

function byLabel(host: HTMLElement, label: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

function buttonByText(host: HTMLElement, selector: string, text: string): HTMLButtonElement | null {
  const hit = [...host.querySelectorAll<HTMLButtonElement>(selector)].find(
    (el) => (el.textContent ?? '').trim() === text,
  );
  return hit ?? null;
}

/** 菜单项这类元素的 textContent 里带图标字符，用「包含」判定。 */
function buttonContaining(
  host: HTMLElement,
  selector: string,
  text: string,
): HTMLButtonElement | null {
  const hit = [...host.querySelectorAll<HTMLButtonElement>(selector)].find((el) =>
    (el.textContent ?? '').includes(text),
  );
  return hit ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════════
   环境
   ══════════════════════════════════════════════════════════════════════════════ */

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  // jsdom 不实现滚动 API
  if (typeof Element.prototype.scrollTo !== 'function') {
    Element.prototype.scrollTo = function scrollTo(): void {};
  }
  if (typeof Element.prototype.scrollBy !== 'function') {
    Element.prototype.scrollBy = function scrollBy(): void {};
  }
  // jsdom 无排版：给固定容器尺寸，让分页与点按区有确定输入（ReaderPage 的点击区是 35%/65%）
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(): number {
      return 400;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(): number {
      return 800;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 800,
      width: 400,
      height: 800,
      toJSON: () => ({}),
    } as DOMRect;
  };

  setAppLanguage(AppLanguage.ZH);
  useAppStore.setState({
    appLanguage: AppLanguage.ZH,
    route: 'reader',
    libraryReady: true,
    books: [{ ...BOOK } as unknown as Book],
    currentBookId: 1,
    chapters: CHAPTERS,
    bookmarks: [],
    // 挂载期 effect 会 `openBook(bookId)`；这里没有书目仓储，钉成 no-op 才能保住正文。
    openBook: async () => undefined,
  });
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.host.remove();
  }
  setAppLanguage(AppLanguage.ZH);
  useAppStore.setState({ appLanguage: AppLanguage.ZH });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ReaderPage
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * 唤出控制栏：`showBars` 初始为 false（Kotlin `var showBars by remember { false }`），
 * 点「中间 35%~65%」才展开。分派的是 pointerdown/pointerup —— 翻页容器按 Pointer Events
 * 判定点按（`PageTurnContainer.kt` / `PageCurlReaderContainer.tsx` 同一套状态机）。
 */
async function openReaderBars(host: HTMLElement): Promise<void> {
  const container =
    host.querySelector('.page-curl-container') ?? host.querySelector('.page-turn-container');
  if (container === null) throw new Error('翻页容器未渲染：正文可能还在分页');
  await act(async () => {
    container.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 400 }),
    );
  });
  await act(async () => {
    container.dispatchEvent(
      new MouseEvent('pointerup', { bubbles: true, clientX: 200, clientY: 400 }),
    );
  });
  await settle();
}

async function mountReader(): Promise<Mounted> {
  const m = await mount(<ReaderHarness />);
  await settle();
  return m;
}

describe('ReaderPage — 控制栏 / 底栏 / 目录面板的语言接线', () => {
  it('中文态渲染原文；切 EN 出现 Contents / Bookmarks / Next chapter；切回中文恢复', async () => {
    const { host } = await mountReader();
    await openReaderBars(host);

    // (a) 中文态：顶栏图标按钮的 aria-label + 底栏章节按钮都是原文
    expect(host.querySelector('.rd-top-bar')).not.toBeNull();
    expect(byLabel(host, '目录')).not.toBeNull();
    expect(byLabel(host, '书签')).not.toBeNull();
    expect(byLabel(host, '返回')).not.toBeNull();
    expect(byLabel(host, '听书')).not.toBeNull();
    expect(buttonByText(host, '.rd-chapter-nav .rd-text-btn', '下一章')).not.toBeNull();

    // (b) 切 EN：词表命中的 chrome 全部英文
    await switchLanguage(AppLanguage.EN);
    expect(getAppLanguage()).toBe(AppLanguage.EN);
    expect(byLabel(host, 'Contents')).not.toBeNull();
    expect(byLabel(host, 'Bookmarks')).not.toBeNull();
    expect(byLabel(host, 'Back')).not.toBeNull();
    expect(byLabel(host, 'Text-to-speech')).not.toBeNull();
    expect(byLabel(host, 'More')).not.toBeNull();
    expect(byLabel(host, 'Progress')).not.toBeNull();
    expect(buttonByText(host, '.rd-chapter-nav .rd-text-btn', 'Next chapter')).not.toBeNull();
    // 原文必须消失（词表命中即换，不是追加）
    expect(byLabel(host, '目录')).toBeNull();
    expect(byLabel(host, '书签')).toBeNull();

    // (c) 切回中文：原文回来，英文消失
    await switchLanguage(AppLanguage.ZH);
    expect(getAppLanguage()).toBe(AppLanguage.ZH);
    expect(byLabel(host, '目录')).not.toBeNull();
    expect(byLabel(host, '书签')).not.toBeNull();
    expect(buttonByText(host, '.rd-chapter-nav .rd-text-btn', '下一章')).not.toBeNull();
    expect(byLabel(host, 'Contents')).toBeNull();
    expect(byLabel(host, 'Bookmarks')).toBeNull();
  });

  it('英文态下打开目录、翻到下一章仍照常工作（交互不变）', async () => {
    const { host } = await mountReader();
    await openReaderBars(host);
    await switchLanguage(AppLanguage.EN);

    // 目录面板：点英文 aria-label 的按钮，面板照常出现，章节项是「数据」原文
    click(byLabel(host, 'Contents'));
    const sheet = host.querySelector('.rd-sheet');
    expect(sheet).not.toBeNull();
    const tocItems = [...host.querySelectorAll('.rd-toc-item')].map((el) =>
      (el.textContent ?? '').trim(),
    );
    expect(tocItems).toEqual(['第一章', '第二章']);

    // 关闭面板（点 backdrop 收敛），再验证章节推进
    click(host.querySelector('.rd-sheet-backdrop'));
    expect(host.querySelector('.rd-sheet')).toBeNull();

    click(buttonByText(host, '.rd-chapter-nav .rd-text-btn', 'Next chapter'));
    await settle();
    expect(host.querySelector('.rd-bar-title')?.textContent).toBe('第二章');
  });

  it('排版面板的可见文案（分组标题 / 滑杆 aria-label / 重置 / 触控分区入口）在英文态也走词表', async () => {
    const { host } = await mountReader();
    await openReaderBars(host);
    await switchLanguage(AppLanguage.EN);

    // 排版面板：菜单项「Typography」→ 面板标题（同一个 key）
    click(byLabel(host, 'More'));
    expect(buttonContaining(host, '.rd-menu-item', 'Typography')).not.toBeNull();
    click(buttonContaining(host, '.rd-menu-item', 'Typography'));
    await settle();
    expect(host.querySelector('.rd-sheet-title')?.textContent).toBe('Typography');
    expect(byLabel(host, 'Brightness')).not.toBeNull();
    expect(byLabel(host, 'First-line indent')).not.toBeNull();
    expect(byLabel(host, 'Line spacing')).not.toBeNull();
    expect(byLabel(host, 'Margins')).not.toBeNull();
    expect(buttonByText(host, '.rd-text-btn', 'Reset')).not.toBeNull();
    // 触控分区入口（词表里是 Custom touch zones）
    expect(host.textContent).toContain('Custom touch zones');
    // 「显 示 / 文 字 / 阅读主题 / 翻 页」四个分组标题
    expect(host.textContent).toContain('Display');
    expect(host.textContent).toContain('Reading theme');
    expect(host.textContent).toContain('Page turn');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ComicReaderPage
   ══════════════════════════════════════════════════════════════════════════════ */

async function mountComic(onNextChapter?: () => void, pageCount = 2): Promise<Mounted> {
  const m = await mount(
    <ComicHarness onNextChapter={onNextChapter ?? null} pageCount={pageCount} />,
  );
  await settle();
  return m;
}

describe('ComicReaderPage — chrome 的语言接线', () => {
  it('中文态原文 → 切 EN 出现 Contents / Settings / Previous page → 切回中文', async () => {
    const { host } = await mountComic();
    expect(host.querySelector('.comic-bottom-bar')).not.toBeNull();

    // (a) 中文态
    expect(buttonByText(host, '.comic-chip', '目录')).not.toBeNull();
    expect(buttonByText(host, '.comic-chip', '设置')).not.toBeNull();
    // Kotlin `ComicReaderChrome.kt:416` 只有图标按钮，contentDescription = 「标记神回」
    expect(byLabel(host, '标记神回')).not.toBeNull();
    expect(byLabel(host, '上一页')).not.toBeNull();
    expect(byLabel(host, '下一页')).not.toBeNull();
    // Kotlin `ComicReaderChrome.kt` 顶栏只有 arrow-back 图标，contentDescription = 「返回」
    expect(byLabel(host, '返回')).not.toBeNull();

    // (b) 英文态
    await switchLanguage(AppLanguage.EN);
    expect(buttonByText(host, '.comic-chip', 'Contents')).not.toBeNull();
    expect(buttonByText(host, '.comic-chip', 'Settings')).not.toBeNull();
    expect(byLabel(host, 'Mark highlight')).not.toBeNull(); // 标记神回
    expect(byLabel(host, 'Previous page')).not.toBeNull();
    expect(byLabel(host, 'Next page')).not.toBeNull();
    expect(byLabel(host, 'Back')).not.toBeNull();
    // 词表没收录的文案保持原文，不做半翻（Kotlin 侧同样只是查表）
    expect(byLabel(host, '隐藏控制栏')).not.toBeNull();
    expect(buttonByText(host, '.comic-chip', '目录')).toBeNull();

    // (c) 切回中文
    await switchLanguage(AppLanguage.ZH);
    expect(buttonByText(host, '.comic-chip', '目录')).not.toBeNull();
    expect(byLabel(host, '下一页')).not.toBeNull();
    expect(buttonByText(host, '.comic-chip', 'Contents')).toBeNull();
  });

  it('英文态下「Next page」仍然外翻到下一章（回调被调用一次）', async () => {
    const onNextChapter = vi.fn();
    // 单页章：末页点「Next page」才是外翻进入下一章（Kotlin L426-434）
    const { host } = await mountComic(onNextChapter, 1);
    await switchLanguage(AppLanguage.EN);

    const next = byLabel(host, 'Next page');
    expect(next).not.toBeNull();
    await act(async () => {
      next?.click();
    });
    expect(onNextChapter).toHaveBeenCalledTimes(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ComicChaptersPage（源码级接线点）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicChaptersPage — 接线点（源码级）', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/ui/pages/ComicChaptersPage.tsx'),
    'utf8',
  );

  it('复用 core i18n 的 tr，且只包裹词表里确实存在的可见文案', () => {
    expect(source).toContain("import { tr } from '@core/i18n';");
    // 顶栏 / 底栏
    expect(source).toContain("tr('退出多选')");
    expect(source).toContain("tr('返回')");
    expect(source).toContain("tr('取消下载')");
    // 章节卡片右侧
    expect(source).toContain("tr('下载')");
    expect(source).toContain("tr('已下载')");
    expect(source).toContain("tr('已选中')");
    // 排序 / 多选 / 资料
    expect(source).toContain("tr('倒序')");
    expect(source).toContain("tr('正序')");
    expect(source).toContain("tr('多选')");
    expect(source).toContain("tr('收起资料')");
    expect(source).toContain("tr('展开全部资料')");
    // 错误 / 空态 / toast
    expect(source).toContain("tr('站外链接章节暂不支持下载')");
    expect(source).toContain("tr('站外链接章节暂不支持在线阅读')");
    expect(source).toContain("tr('这本书没有来源信息，无法换源')");
    expect(source).toContain("tr('该话暂不可读')");
    expect(source).toContain('message={tr(\'来源暂不可用（已保留缓存信息与阅读进度）\')}');
  });

  it('数据键（书名 / 章节名 / 标签）不被包裹', () => {
    // 章节标题、tag 文本、别名行都是正文数据，直接渲染原值
    expect(source).toContain('{spec.title}');
    expect(source).toContain('{tag}');
    expect(source).toContain('别名：${aliases.join(');
  });
});
