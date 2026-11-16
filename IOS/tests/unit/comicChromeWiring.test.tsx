/**
 * comicChromeWiring.test.tsx — 验证页面真的消费了 comic 组件族的移植版。
 *
 * 覆盖：
 *  1. ComicReaderChrome / PanelSlider（comicPanelDesign）真实进入 DOM；
 *  2. 底栏翻页后页码更新；
 *  3. PanelSlider 键盘 End 跳到最后一页（comicPanelDesign 的交互接线）；
 *  4. 双指缩放更新 ZoomableImageLayer（页面 zoom 状态）；
 *  5. 垂直模式的滚动指标来自 core 的 ComicScrollMetrics（滑条 fraction 随 scrollTop 变化）；
 *  6. 垂直模式章节边缘手势调用 onPrevChapter（core 的 comicChapterEdgeTarget 路径）；
 *  7. 设置面板仍由 ComicReaderChrome 的 sheets 端口挂载。
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function localPages(count: number): ComicPageRef[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: 'LOCAL' as const,
    id: `p${String(i + 1)}`,
    path: PIXEL,
  }));
}

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

function storeWithConfig(patch: Partial<ComicReaderConfig> = {}) {
  const config: ComicReaderConfig = {
    ...DEFAULT_COMIC_READER_CONFIG,
    bgType: 'BLACK',
    ...patch,
  };
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

function button(m: Mounted, label: string): HTMLButtonElement | null {
  return [...m.host.querySelectorAll('button')].find(
    (el) => el.textContent === label || el.getAttribute('aria-label') === label,
  ) ?? null;
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
  if (typeof Element.prototype.scrollTo !== 'function') {
    Element.prototype.scrollTo = function scrollTo(): void {};
  }
  // jsdom 没有 Pointer Capture；移植 hook 依赖它做手势会话隔离，这里补最小桩。
  HTMLElement.prototype.setPointerCapture = function setPointerCapture(): void {};
  HTMLElement.prototype.releasePointerCapture = function releasePointerCapture(): void {};
  HTMLElement.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false;
  };
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
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(): number {
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(): number {
      return 1000;
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

describe('ComicReaderPage — 移植组件接线', () => {
  it('ComicReaderChrome 与 comicPanelDesign 真实渲染', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(3)} title="接线测试" bookKey={null} store={storeWithConfig()} />,
    );
    expect(m.host.querySelector('.comic-chrome')).not.toBeNull();
    expect(m.host.querySelector('.comic-top-bar__title')?.textContent).toBe('接线测试');
    expect(m.host.querySelector('.comic-top-bar')).not.toBeNull();
    expect(m.host.querySelector('.comic-bottom-bar')).not.toBeNull();
    // PanelSlider（ComicPanelDesign.kt）不是页面内联的 <input type=range>。
    const slider = m.host.querySelector('.comic-panel-slider.comic-scrubber');
    expect(slider).not.toBeNull();
    expect(slider?.getAttribute('role')).toBe('slider');
    await unmount(m);
  });

  it('底栏下一页按钮推进页码（Chrome → page state）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(3)} bookKey={null} loader={fastLoader()} store={storeWithConfig()} />,
    );
    expect(m.host.querySelector('.comic-bottom-bar__page')?.textContent).toContain('1 / 3');
    const next = button(m, '下一页');
    expect(next).not.toBeNull();
    await act(async () => {
      next?.click();
    });
    expect(m.host.querySelector('.comic-bottom-bar__page')?.textContent).toContain('2 / 3');
    await unmount(m);
  });

  it('PanelSlider 键盘 End 跳到末页（comicPanelDesign 交互）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(3)} bookKey={null} loader={fastLoader()} store={storeWithConfig()} />,
    );
    const slider = m.host.querySelector('.comic-scrubber') as HTMLElement;
    await act(async () => {
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(m.host.querySelector('.comic-bottom-bar__page')?.textContent).toContain('3 / 3');
    await unmount(m);
  });

  it('双指缩放更新 ZoomableImageLayer 的 transform', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={storeWithConfig()} />,
    );
    const cell = m.host.querySelector('.comic-spread-cell-zoom') as HTMLElement;
    expect(cell).not.toBeNull();
    const down = (id: number, x: number): void => {
      cell.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: id,
          pointerType: 'touch',
          clientX: x,
          clientY: 100,
        }),
      );
    };
    await act(async () => {
      down(1, 100);
      down(2, 200);
      cell.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 2,
          pointerType: 'touch',
          clientX: 300,
          clientY: 100,
        }),
      );
    });
    const layer = m.host.querySelector('.comic-zoom-layer') as HTMLElement | null;
    expect(layer?.style.transform).toMatch(/scale\((1\.[0-9]+|2(\.0+)?)\)/);
    await act(async () => {
      cell.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      cell.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
    });
    await unmount(m);
  });

  it('滚动模式的 fraction 来自 ComicScrollMetrics', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(5)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({ mode: 'WEBTOON', direction: 'TTB' })}
      />,
    );
    const scroll = m.host.querySelector('.comic-vertical-scroll') as HTMLElement;
    expect(scroll).not.toBeNull();
    scroll.scrollTop = 100;
    await act(async () => {
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    const slider = m.host.querySelector('.comic-scrubber') as HTMLElement;
    const fraction = Number(slider.getAttribute('aria-valuenow'));
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(1);
    await unmount(m);
  });

  it('垂直模式章节边缘手势回调到 onPrevChapter', async () => {
    const onPrevChapter = vi.fn();
    const m = await mount(
      <ComicReaderPage
        pages={localPages(5)}
        bookKey={null}
        loader={fastLoader()}
        store={storeWithConfig({ mode: 'WEBTOON', direction: 'TTB' })}
        onPrevChapter={onPrevChapter}
      />,
    );
    const host = m.host.querySelector('.comic-vertical-host') as HTMLElement;
    expect(host).not.toBeNull();
    await act(async () => {
      host.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 7,
          pointerType: 'touch',
          isPrimary: true,
          clientX: 100,
          clientY: 100,
        }),
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 7,
          pointerType: 'touch',
          isPrimary: true,
          clientX: 100,
          clientY: 170,
        }),
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 7,
          pointerType: 'touch',
          isPrimary: true,
          clientX: 100,
          clientY: 170,
        }),
      );
    });
    expect(onPrevChapter).toHaveBeenCalledTimes(1);
    await unmount(m);
  });

  it('设置面板由 ComicReaderChrome 的 sheets 端口挂载', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(3)} bookKey={null} loader={fastLoader()} store={storeWithConfig()} />,
    );
    const settings = button(m, '阅读设置');
    expect(settings).not.toBeNull();
    await act(async () => {
      settings?.click();
    });
    expect(m.host.querySelector('.cmcs-sheet--settings')).not.toBeNull();
    expect(m.host.querySelectorAll('.cmcs-tabrow__item').length).toBeGreaterThanOrEqual(5);
    await unmount(m);
  });
});
