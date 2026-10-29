/**
 * comicReaderPage.test.tsx — ComicReaderPage.tsx 的挂载 / 交互冒烟测试。
 *
 * 目的：验证 ComicReaderCore.kt 的组合结构在 Web 上真的能渲染，并响应核心交互
 * （首末页外翻跨章、单飞门闩、点按区、最小可见面积上报、模式分支、
 *   目录/设置面板、自动阅读开关、翻译角标门控）。
 * 未覆盖：像素级图像管线、缩放手势的物理手感（其纯函数已在 comicReaderCore.test.ts 钉死）。
 *
 * 注意：jsdom 不实现 Element.scrollTo / scrollBy，这里补最小桩。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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

/** 带指定配置的设置仓库替身（避免 localStorage 副作用，且能注入配置） */
function storeWithConfig(patch: Partial<ComicReaderConfig>) {
  const config: ComicReaderConfig = { ...DEFAULT_COMIC_READER_CONFIG, ...patch };
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

async function mount(node: React.ReactNode): Promise<Mounted> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  return { root, host };
}

async function unmount(m: Mounted): Promise<void> {
  await act(async () => {
    m.root.unmount();
  });
  m.host.remove();
}

function chip(m: Mounted, label: string): HTMLButtonElement | undefined {
  return [...m.host.querySelectorAll('.comic-chip')].find(
    (el) => el.textContent === label,
  ) as HTMLButtonElement | undefined;
}

function barButton(m: Mounted, label: string): HTMLButtonElement | undefined {
  return [...m.host.querySelectorAll('.comic-chrome-bottom .comic-text-button')].find(
    (el) => el.textContent === label,
  ) as HTMLButtonElement | undefined;
}

/**
 * 触发受控 `<input type="range">` 的 onChange。
 * React 19 把 `value` 记在内部 value tracker 上，直接 `el.value = x` 不会让它
 * 察觉变化（事件被当作「值没变」吞掉），必须绕过 setter 写原生 value 再派发。
 */
function setRangeValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

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
  // jsdom 无排版：给固定容器尺寸，让点按区/滚动数学有确定输入
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
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(): number {
      return 200;
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
});

/** 两次点按之间需超过双击判定窗口（DOUBLE_TAP_TOLERANCE_MS = 300） */
async function waitPastDoubleTap(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 340));
  });
}

describe('ComicReaderPage — 组合结构', () => {
  it('单页模式渲染 root + pager 容器 + 控制层（Kotlin L563-748）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(4)} title="测试漫画" bookKey={null} />,
    );
    expect(m.host.querySelector('.comic-core')).not.toBeNull();
    expect(m.host.querySelector('.comic-pager-scroll')).not.toBeNull();
    expect(m.host.querySelectorAll('.comic-pager-slot')).toHaveLength(4);
    // Kotlin L383: controlsVisible 初始为 true
    expect(m.host.querySelector('.comic-chrome-top')).not.toBeNull();
    expect(m.host.querySelector('.comic-chrome-bottom')).not.toBeNull();
    expect(m.host.querySelector('.comic-scrubber')).not.toBeNull();
    expect(m.host.querySelector('.comic-chrome-title')?.textContent).toBe('测试漫画');
    await unmount(m);
  });

  it('内部保持暗色（bgType=BLACK → 纯黑，不改浅色主题）', async () => {
    // 显式注入 bgType=BLACK：Kotlin L203 的 `store.effectiveConfig(bookKey)` 在
    // 没有存过全局配置时返回**默认预设**（ComicSettingsStore.kt L75-79 +
    // PRESET_MANGA → bgType = PAPER），不再等于 ComicReaderConfig() 的默认值。
    // 断言本身一字未改，只是把标题已经声明的前提真正固定下来。
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} store={storeWithConfig({})} />,
    );
    const style = (m.host.querySelector('.comic-core') as HTMLElement).style;
    expect(style.background).toBe('rgb(0, 0, 0)');
    await unmount(m);
  });

  it('进度上报 rawPage / isFinished（Kotlin L367-375）', async () => {
    const onPageChanged = vi.fn();
    const m = await mount(
      <ComicReaderPage
        pages={localPages(3)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({})}
        onPageChanged={onPageChanged}
      />,
    );
    expect(onPageChanged).toHaveBeenCalledWith(0, false);
    await unmount(m);
  });

  it('末页上报 isFinished=true（Kotlin L371: raw >= totalPages - 1）', async () => {
    const onPageChanged = vi.fn();
    const m = await mount(
      <ComicReaderPage
        pages={localPages(1)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({})}
        onPageChanged={onPageChanged}
      />,
    );
    expect(onPageChanged).toHaveBeenCalledWith(0, true);
    await unmount(m);
  });

  it('双页模式两两配对（Kotlin L643-654 → buildComicLayout）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(6)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({ mode: 'DOUBLE' })}
      />,
    );
    expect(m.host.querySelectorAll('.comic-pager-slot')).toHaveLength(3);
    await unmount(m);
  });

  it('垂直模式（条漫）渲染滚动容器而非 pager（Kotlin L613-630）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(5)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({ mode: 'WEBTOON', direction: 'TTB' })}
      />,
    );
    expect(m.host.querySelector('.comic-vertical-scroll')).not.toBeNull();
    expect(m.host.querySelector('.comic-pager-scroll')).toBeNull();
    expect(m.host.querySelectorAll('.comic-vertical-slot')).toHaveLength(5);
    await unmount(m);
  });

  it('磁吸模式渲染三窗口宿主（Kotlin L1114-1283）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(5)}
        initialPage={2}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({ mode: 'MAGNETIC' })}
      />,
    );
    expect(m.host.querySelector('.comic-magnetic-host')).not.toBeNull();
    // ±1 窗口 = 3 个（Kotlin L1266）
    expect(m.host.querySelectorAll('.comic-magnetic-window')).toHaveLength(3);
    await unmount(m);
  });

  it('CURL + SINGLE 走 GL 引擎标记（Kotlin L943 curlEngineActive）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(3)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({ pageAnim: 'CURL', mode: 'SINGLE', direction: 'RTL' })}
      />,
    );
    expect(
      m.host.querySelector('.comic-engine-layer')?.getAttribute('data-engine-gl'),
    ).toBe('1');
    await unmount(m);
  });

  it('CURL + WEBTOON 不走 GL 引擎（Kotlin L129-134 的 mode 排除项）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(3)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({ pageAnim: 'CURL', mode: 'WEBTOON' })}
      />,
    );
    expect(
      m.host.querySelector('.comic-engine-layer')?.getAttribute('data-engine-gl'),
    ).toBe('0');
    await unmount(m);
  });
});

describe('ComicReaderPage — 翻页与章节导航', () => {
  it('末页 goNext 外翻到下一章（Kotlin L426-434）', async () => {
    const onNextChapter = vi.fn();
    const m = await mount(
      <ComicReaderPage
        pages={localPages(1)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({})}
        onNextChapter={onNextChapter}
      />,
    );
    const next = barButton(m, '下一页');
    expect(next).toBeDefined();
    await act(async () => {
      next?.click();
    });
    expect(onNextChapter).toHaveBeenCalledTimes(1);
    await unmount(m);
  });

  it('首页 goPrev 外翻到上一章（Kotlin L436-439）', async () => {
    const onPrevChapter = vi.fn();
    const m = await mount(
      <ComicReaderPage
        pages={localPages(2)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({})}
        onPrevChapter={onPrevChapter}
      />,
    );
    const prev = barButton(m, '上一页');
    await act(async () => {
      prev?.click();
    });
    expect(onPrevChapter).toHaveBeenCalledTimes(1);
    await unmount(m);
  });

  it('单飞门闩：同一时刻只允许一次跨章导航（Kotlin L391-398）', async () => {
    const onNextChapter = vi.fn();
    const onPrevChapter = vi.fn();
    const m = await mount(
      <ComicReaderPage
        pages={localPages(1)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({})}
        onNextChapter={onNextChapter}
        onPrevChapter={onPrevChapter}
      />,
    );
    await act(async () => {
      barButton(m, '下一页')?.click();
      barButton(m, '上一页')?.click();
    });
    expect(onNextChapter).toHaveBeenCalledTimes(1);
    expect(onPrevChapter).not.toHaveBeenCalled();
    await unmount(m);
  });

  it('未提供章节回调时外翻不炸且返回未消费（Kotlin L393 action == null → false）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(1)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({})}
      />,
    );
    await act(async () => {
      barButton(m, '下一页')?.click();
    });
    // autoRead 被关闭（Kotlin L432）
    expect(chip(m, '自动阅读')).toBeDefined();
    await unmount(m);
  });
});

describe('ComicReaderPage — 控制层与面板', () => {
  it('目录面板：点击「目录」chip 打开 ComicTocSheet 并渲染条目（Kotlin L282-290 → ComicReaderSheets L1280-1348）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(2)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({})}
        toc={[
          { id: 'c1', title: '第1话' },
          { id: 'c2', title: '第2话' },
        ]}
        currentChapterIndex={0}
        chapterNavLabel="话"
        onJumpToChapter={() => undefined}
      />,
    );
    await act(async () => {
      chip(m, '目录')?.click();
    });
    // 真移植版：`.cmcs-toc__row`（ComicTocSheet.tsx L62-91，Kotlin L1305-1332）
    const rows = m.host.querySelectorAll('.cmcs-toc__row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('第1话');
    expect(rows[0]?.className).toContain('cmcs-toc__row--active');
    // 面板标题「目录」（ComicTocSheet L169，Kotlin L1293）
    expect(m.host.querySelector('.cmcs-sheet--toc')?.getAttribute('aria-label')).toBe('目录');
    // 面板玻璃采样：非 CURL → data-glass="1"（Kotlin L142-147 → comicPanelGlass）
    expect(m.host.querySelector('.cmcs-sheet')?.getAttribute('data-glass')).toBe('1');
    await unmount(m);
  });

  it('CURL 引擎下面板回退纯半透明（Kotlin L136-141）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(2)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({ pageAnim: 'CURL', mode: 'SINGLE', direction: 'RTL' })}
        toc={[{ id: 'c1', title: '第1话' }]}
        onJumpToChapter={() => undefined}
      />,
    );
    await act(async () => {
      chip(m, '目录')?.click();
    });
    expect(m.host.querySelector('.cmcs-sheet')?.getAttribute('data-glass')).toBe('0');
    await unmount(m);
  });

  it('设置面板改阅读模式 → 布局重建（Kotlin L270-281 → ModeTab L509-511 / Kotlin L716 persistConfig）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(4)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({ mode: 'SINGLE' })}
      />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    // 真移植版：ModeTab 的阅读模式是 5 个格子按钮（ComicSettingsModeTab L58-67）
    const cells = [...m.host.querySelectorAll('.cmcs-grid__cell')];
    expect(cells.length).toBeGreaterThanOrEqual(5);
    const double = cells.find((el) => el.textContent === '双页');
    expect(double).toBeDefined();
    await act(async () => {
      (double as HTMLButtonElement).click();
    });
    expect(m.host.querySelectorAll('.comic-pager-slot')).toHaveLength(2);
    await unmount(m);
  });

  it('自动阅读开关切换按钮文案（Kotlin L728-729）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(3)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({ autoPageIntervalSec: 60 })}
      />,
    );
    expect(chip(m, '自动阅读')).toBeDefined();
    await act(async () => {
      chip(m, '自动阅读')?.click();
    });
    expect(chip(m, '停止自动阅读')).toBeDefined();
    await unmount(m);
  });

  it('隐藏控制栏后仅剩空 chrome 层（Kotlin L383/L694 visible=false）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(2)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({})}
      />,
    );
    const toggle = m.host.querySelector(
      '.comic-chrome-top .comic-chrome-btn:last-of-type',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    await act(async () => {
      toggle?.click();
    });
    expect(m.host.querySelector('.comic-chrome-top')).toBeNull();
    await unmount(m);
  });
});

describe('ComicReaderPage — 翻译角标与注入端口', () => {
  it('未启用翻译时不显示角标（Kotlin L664 门控）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(2)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({})}
        translatingKeys={['p1']}
      />,
    );
    expect(m.host.querySelector('.comic-translate-badge')).toBeNull();
    await unmount(m);
  });

  it('启用翻译且有在译页时显示「正在翻译…」（Kotlin L665-674）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(2)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({ translationEnabled: true })}
        translatingKeys={['p1']}
      />,
    );
    expect(m.host.querySelector('.comic-translate-badge')?.textContent).toContain('正在翻译');
    await unmount(m);
  });

  it('注入的 loader 收到预载窗口条目（Kotlin L548 preloadWindow）', async () => {
    const preloadWindow = vi.fn();
    const loader = fastLoader();
    const m = await mount(
      <ComicReaderPage
        pages={localPages(5)}
        bookKey={null}
        loader={{ ...loader, preloadWindow }}
        store={storeWithConfig({})}
      />,
    );
    expect(preloadWindow).toHaveBeenCalled();
    const entries = preloadWindow.mock.calls[0]?.[0] as { ref: ComicPageRef }[];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.ref.id).toBe('p1');
    await unmount(m);
  });

  it('翻译签名变化触发回调（Kotlin L286-303）', async () => {
    const onTranslationSignatureChange = vi.fn();
    const m = await mount(
      <ComicReaderPage
        pages={localPages(2)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({ translationEnabled: true })}
        onTranslationSignatureChange={onTranslationSignatureChange}
      />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    // E1：漫画翻译链路不可用 → 面板不给「能打开翻译」的入口
    // （TranslationTab 的引擎/功能/离线模型三张卡片整体不渲染）。
    expect([...m.host.querySelectorAll('.cmcs-switchrow__title')].map((e) => e.textContent))
      .not.toContain('整页自动翻译');
    // 「翻译」Tab 仍保留（Kotlin L141-149 的七 Tab 结构逐字不变），
    // 且「译文显示」分组仍在（惰性设置）：切到该 Tab 后拨动「译文字号」，
    // 同样改签名（L286-303 的签名 = translationEnabled|textScale|lang|engine）。
    await act(async () => {
      const tab = [...m.host.querySelectorAll('.cmcs-tabrow__item')].find(
        (el) => el.textContent === '翻译',
      ) as HTMLButtonElement | undefined;
      expect(tab).toBeDefined();
      (tab as HTMLButtonElement).click();
    });
    const scale = m.host.querySelector('.cmcs-slider[aria-label="译文字号"]') as HTMLInputElement | null;
    expect(scale).not.toBeNull();
    await act(async () => {
      setRangeValue(scale as HTMLInputElement, '120');
    });
    expect(onTranslationSignatureChange).toHaveBeenCalled();
    await unmount(m);
  });
});

describe('ComicReaderPage — 点按区与暗色交互', () => {
  it('栏可见时点击优先隐藏栏而非翻页（第 23 条 / Kotlin L466-473）', async () => {
    const onPrevChapter = vi.fn();
    const m = await mount(
      <ComicReaderPage
        pages={localPages(1)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({})}
        onPrevChapter={onPrevChapter}
      />,
    );
    const cell = m.host.querySelector('.comic-spread-cell-zoom') as HTMLElement;
    expect(cell).not.toBeNull();
    await act(async () => {
      cell.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 5, clientY: 100 }),
      );
      cell.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 5, clientY: 100 }),
      );
    });
    expect(onPrevChapter).not.toHaveBeenCalled();
    expect(m.host.querySelector('.comic-chrome-top')).toBeNull();
    await unmount(m);
  });

  it('栏隐藏后再次点击才翻页（第 23 条 / Kotlin L469）', async () => {
    const onPrevChapter = vi.fn();
    const m = await mount(
      <ComicReaderPage
        pages={localPages(1)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({})}
        onPrevChapter={onPrevChapter}
      />,
    );
    const tapZone = async (clientX: number): Promise<void> => {
      const cell = m.host.querySelector('.comic-spread-cell-zoom') as HTMLElement;
      await act(async () => {
        cell.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX, clientY: 400 }),
        );
        cell.dispatchEvent(
          new PointerEvent('pointerup', { bubbles: true, pointerId: 2, clientX, clientY: 400 }),
        );
      });
    };
    // 默认 direction = RTL：右侧三分之一 = 逻辑上一页侧（Kotlin L800-804）
    await tapZone(390); // 第一次：隐藏栏
    expect(m.host.querySelector('.comic-chrome-top')).toBeNull();
    await waitPastDoubleTap(); // 越过双击判定窗口，第二次才算独立单击
    await tapZone(390); // 第二次：翻页
    expect(onPrevChapter).toHaveBeenCalledTimes(1);
    await unmount(m);
  });

  it('RTL 下左侧点按区 = 下一页侧（Kotlin L800-804）', async () => {
    const onNextChapter = vi.fn();
    const m = await mount(
      <ComicReaderPage
        pages={localPages(1)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({ direction: 'RTL', gestureSwipe: true })}
        onNextChapter={onNextChapter}
      />,
    );
    // 先隐藏控制栏
    const toggle = m.host.querySelector(
      '.comic-chrome-top .comic-chrome-btn:last-of-type',
    ) as HTMLButtonElement | null;
    await act(async () => {
      toggle?.click();
    });
    const cell = m.host.querySelector('.comic-spread-cell-zoom') as HTMLElement;
    await act(async () => {
      cell.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerId: 3, clientX: 4, clientY: 200 }),
      );
      cell.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: 3, clientX: 4, clientY: 200 }),
      );
    });
    expect(onNextChapter).toHaveBeenCalledTimes(1);
    await unmount(m);
  });
});
