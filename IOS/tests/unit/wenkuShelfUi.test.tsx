/**
 * `src/ui/components/wenku/**` 的 jsdom 验收。
 *
 * 断言纪律：
 *   - **几何不在 UI 里重算**：槽位/书号/位置一律拿 `src/core/wenku/**` 的固定向量对拍
 *     （`ShelfMetrics.of(411, 1)`、`layoutVisibleSlots`、`hitTestSlot`、`startingIndex`），
 *     UI 只负责把 core 的输出写进 CSS 变量。
 *   - 交互（点击、长按、键盘、按钮）走真实 DOM 事件；动画时钟用 `vi.useFakeTimers`
 *     （rAF / setTimeout 都由 fake clock 驱动，组件内部用 rAF 的时间戳算进度）。
 */

import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ShelfMetrics,
  hitTestSlot,
  layoutVisibleSlots,
  semanticBoxRect,
  shelfVolumeOf,
} from '@core/wenku';
import {
  ArchiveShelf,
  ArchiveShelfMemory,
  MAX_SHELF_BOOKS,
  SHELF_LONG_PRESS_MS,
  SHELF_REVEAL_MS,
  defaultShelfMenuEntries,
  shelfMoreRows,
} from '@ui/components/wenku/ArchiveShelf';
import type { ArchiveShelfBook } from '@ui/components/wenku/ArchiveShelf';
import {
  WENKU_ICON_ART,
  WenkuIcon,
  wenkuIconHasArt,
  wenkuSymbolForIconName,
} from '@ui/components/wenku/WenkuIcon';
import type { WenkuSymbol } from '@ui/components/wenku/WenkuIcon';
import { WenkuActionSheet } from '@ui/components/wenku/WenkuActionSheet';
import { WenkuActionBar, WenkuMenuHost } from '@ui/components/wenku/WenkuMenuHost';
import { WenkuGlass } from '@ui/components/wenku/WenkuGlass';

/* ───────────────────────────── jsdom 环境 ───────────────────────────── */

interface MediaQueryListLike {
  readonly matches: boolean;
  readonly media: string;
  onchange: null;
  addEventListener: (type: string, listener: (event: { matches: boolean }) => void) => void;
  removeEventListener: (type: string, listener: (event: { matches: boolean }) => void) => void;
  addListener: (listener: (event: { matches: boolean }) => void) => void;
  removeListener: (listener: (event: { matches: boolean }) => void) => void;
  dispatchEvent: (event: Event) => boolean;
}

let reduceMotionPreference = false;

function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryListLike => ({
      matches: query.includes('prefers-reduced-motion') ? reduceMotionPreference : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

/** jsdom 30 没有 `PointerEvent`：用 `MouseEvent` 补指针字段，语义与浏览器一致。 */
type PointerInit = {
  readonly pointerId?: number;
  readonly pointerType?: string;
  readonly button?: number;
  readonly clientX?: number;
  readonly clientY?: number;
  readonly cancelable?: boolean;
};

function firePointer(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: PointerInit,
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: init.cancelable === true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
  });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1, configurable: true });
  Object.defineProperty(event, 'pointerType', {
    value: init.pointerType ?? 'touch',
    configurable: true,
  });
  element.dispatchEvent(event);
}

function fireClick(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

const mounted: { root: Root; host: HTMLDivElement }[] = [];

function mount(node: ReactNode): HTMLDivElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => {
    root.render(node);
  });
  return host;
}

function q<T extends Element>(host: HTMLElement, selector: string): T | null {
  return host.querySelector<T>(selector);
}

function need<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`missing: ${label}`);
  return value;
}

/** 走完 520ms 入场（reveal → 1）。 */
function settleEntry(): void {
  act(() => {
    vi.advanceTimersByTime(SHELF_REVEAL_MS + 80);
  });
}

/* ───────────────────────────── 固定向量 ───────────────────────────── */

/** 与组件同源的几何基准：411px 视口（`ShelfMetrics.of(411, 1)`）。 */
const METRICS = ShelfMetrics.of(411, 1);
const VIEWPORT = 411;

function booksFixture(count: number): ArchiveShelfBook[] {
  const titles = ['雪国', 'Alpha Beta', '海边的卡夫卡', '夜航西飞', '人间失格', '古都'];
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    title: titles[index % titles.length] ?? `书 ${String(index + 1)}`,
    author: index % 2 === 0 ? '川端康成' : 'YG',
    totalChapters: 12 + index,
    currentChapterIndex: 0,
    lastReadTime: 0,
  }));
}

function slotsFor(books: readonly ArchiveShelfBook[], logicalFocus = 0) {
  return layoutVisibleSlots(
    METRICS,
    {
      logicalFocus,
      entrance: 1,
      frameNanos: 0,
      reduceMotion: false,
      flyingBookId: null,
      flyingProgress: 0,
    },
    books.map((book) => ({ id: book.id })),
    METRICS.viewportPx,
  );
}

/** 中心槽位里那本书的封面面中心（用于点按命中）。 */
function centrePoint(): { x: number; y: number } {
  return {
    x: METRICS.startXPx + METRICS.originX(0) + METRICS.coverPx * 0.5,
    y: METRICS.railY(0) + METRICS.originY(0) + METRICS.bodyPx * 0.5,
  };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  reduceMotionPreference = false;
  installMatchMedia();
  vi.useFakeTimers();
  ArchiveShelfMemory.forget('shelf');
  ArchiveShelfMemory.forget('favorites');
  ArchiveShelfMemory.forget('scope-a');
  ArchiveShelfMemory.forget('scope-b');
});

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-theme');
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

/* ───────────────────────────── 书架：槽位与选中项 ───────────────────────────── */

describe('3D 书架：槽位与选中项', () => {
  it('渲染 core 算出的全部可见槽位，书号对 count 取模', () => {
    const books = booksFixture(5);
    const host = mount(
      <ArchiveShelf books={books} reduceMotion initialIndex={0} stageWidthVar={VIEWPORT} onOpen={() => {}} />,
    );
    const shelf = need(q(host, '[data-testid="wenku-archive-shelf"]'), 'shelf');
    expect(shelf.getAttribute('data-wenku-count')).toBe('5');
    expect(shelf.getAttribute('data-wenku-active-index')).toBe('0');

    const rendered = [...host.querySelectorAll<HTMLElement>('[data-testid="wenku-shelf-slot"]')];
    const expected = slotsFor(books);
    expect(expected.length).toBe(33); // core 固定向量：槽位 [-18, 14] → 33 本
    expect(rendered.map((node) => Number(node.dataset.wenkuSlot))).toEqual(
      expected.map((slot) => slot.slot),
    );
    expect(rendered.map((node) => Number(node.dataset.bookIndex))).toEqual(
      expected.map((slot) => slot.bookIndex),
    );
    const focused = rendered.find(
      (node) => Number(node.dataset.wenkuSlot) === METRICS.focusOf(0, 5),
    );
    expect(focused?.dataset.bookIndex).toBe('0');
  });

  it('槽位 CSS 变量与 core 的 VisibleSlot 逐值一致（UI 不重算几何）', () => {
    const books = booksFixture(5);
    const host = mount(
      <ArchiveShelf books={books} reduceMotion initialIndex={0} stageWidthVar={VIEWPORT} onOpen={() => {}} />,
    );
    const expected = slotsFor(books);
    const focused = need(
      expected.find((slot) => slot.slot === METRICS.focusOf(0, 5)),
      'focused slot',
    );
    const node = need(
      q<HTMLElement>(host, `[data-wenku-slot="${String(focused.slot)}"]`),
      'focused node',
    );
    expect(node.style.getPropertyValue('--wenku-slot-x')).toBe(`${focused.x.toFixed(2)}px`);
    expect(node.style.getPropertyValue('--wenku-slot-y')).toBe(`${focused.y.toFixed(2)}px`);
    expect(node.style.getPropertyValue('--wenku-slot-floor-y')).toBe(
      `${focused.floorY.toFixed(2)}px`,
    );
    expect(node.style.getPropertyValue('--wenku-book-w')).toBe(`${METRICS.coverPx.toFixed(2)}px`);
    // 中心槽位的 x 就是 core 的 `startX + originX(0)` = 154.4235
    expect(node.style.getPropertyValue('--wenku-slot-x')).toBe('154.42px');
  });

  it('焦点两侧槽位 x 与 core 的 slotOriginX 逐值一致（含 originX 的 pull）', () => {
    const books = booksFixture(5);
    const host = mount(
      <ArchiveShelf books={books} reduceMotion initialIndex={0} stageWidthVar={VIEWPORT} onOpen={() => {}} />,
    );
    const centreSlot = METRICS.focusOf(0, 5);
    const readX = (slot: number): number =>
      Number.parseFloat(
        need(q<HTMLElement>(host, `[data-wenku-slot="${String(slot)}"]`), `slot ${String(slot)}`).style.getPropertyValue(
          '--wenku-slot-x',
        ),
      );
    // 固定向量：起点 centre 154.42（= pull*depthX 拉出）、左邻 176.75、右邻 234.10
    expect(readX(centreSlot)).toBeCloseTo(
      METRICS.startXPx + METRICS.originX(0),
      1,
    );
    expect(readX(centreSlot - 1)).toBeCloseTo(
      METRICS.startXPx - METRICS.pitchPx + METRICS.originX(-1),
      1,
    );
    expect(readX(centreSlot + 1)).toBeCloseTo(
      METRICS.startXPx + METRICS.pitchPx + METRICS.originX(1),
      1,
    );
    // 焦点书被拉出（originX(0) 最负），所以它比左邻更靠左 —— 两侧对称性看 originX(±1)
    expect(METRICS.originX(-1)).toBeCloseTo(METRICS.originX(1), 9);
    expect(readX(centreSlot)).toBeLessThan(readX(centreSlot + 1));
  });

  it('没有 coverUrl 用 generatedCoverPlan 的渐变封面 + 书名；有封面用 <img>', () => {
    const books: ArchiveShelfBook[] = [
      { id: 11, title: '雪国', author: '川端康成' },
      { id: 12, title: 'Alpha', author: 'YG', coverUrl: 'https://example.test/cover.jpg' },
      { id: 13, title: '古都', author: '川端康成' },
    ];
    const host = mount(
      <ArchiveShelf books={books} reduceMotion initialIndex={0} stageWidthVar={VIEWPORT} onOpen={() => {}} />,
    );
    const withCover = need(
      q<HTMLElement>(host, '[data-testid="wenku-book"][data-book-index="1"]'),
      'book 1',
    );
    expect(withCover.querySelector('img')?.getAttribute('src')).toBe('https://example.test/cover.jpg');
    expect(withCover.querySelector('[data-testid="wenku-cover-art"]')).toBeNull();

    const generated = need(
      q<HTMLElement>(host, '[data-testid="wenku-book"][data-book-index="0"]'),
      'book 0',
    );
    expect(generated.querySelector('img')).toBeNull();
    expect(generated.querySelector('[data-testid="wenku-cover-art"]')).not.toBeNull();
    const titles = [...host.querySelectorAll('[data-testid="wenku-cover-art-title"]')].map(
      (node) => node.textContent,
    );
    expect(titles).toContain('雪国');
  });

  it('最多渲染 60 本（ArchiveShelf.kt L185 books.take(60)）', () => {
    const books = booksFixture(MAX_SHELF_BOOKS + 12);
    const host = mount(
      <ArchiveShelf books={books} reduceMotion initialIndex={0} stageWidthVar={VIEWPORT} onOpen={() => {}} />,
    );
    expect(
      need(q(host, '[data-testid="wenku-archive-shelf"]'), 'shelf').getAttribute('data-wenku-count'),
    ).toBe(String(MAX_SHELF_BOOKS));
  });

  it('书脊编号 / 文件码 / 章节数来自 core 的 ShelfVolume.of', () => {
    const books = booksFixture(1);
    const host = mount(
      <ArchiveShelf books={books} reduceMotion initialIndex={0} stageWidthVar={VIEWPORT} onOpen={() => {}} />,
    );
    const volume = shelfVolumeOf(0, {
      id: 1,
      title: '雪国',
      author: '川端康成',
      isComic: false,
      totalChapters: 12,
      lastReadTime: 0,
    });
    expect(volume.number).toBe('01');
    expect(volume.fileCode).toBe('WK-00001');
    expect(need(q(host, '[data-testid="wenku-book-number"]'), 'number').textContent).toBe('01');
    expect(need(q(host, '[data-testid="wenku-book-code"]'), 'code').textContent).toBe('WK-00001');
    expect(need(q(host, '[data-testid="wenku-caption-meta"]'), 'meta').textContent).toContain('12');
  });
});

/* ───────────────────────────── 书架：点击 / 长按 / 键盘 ───────────────────────────── */

describe('3D 书架：点击 / 长按 / 键盘', () => {
  it('点中心的书 → onOpen(book, index) 且只触发一次', () => {
    const books = booksFixture(5);
    const onOpen = vi.fn();
    const host = mount(
      <ArchiveShelf books={books} reduceMotion initialIndex={0} stageWidthVar={VIEWPORT} onOpen={onOpen} />,
    );
    const stage = need(q<HTMLElement>(host, '[data-testid="wenku-archive-shelf-stage"]'), 'stage');
    const point = centrePoint();
    expect(hitTestSlot(METRICS, point, 0, 5)).toBe(METRICS.focusOf(0, 5));
    act(() => {
      firePointer(stage, 'pointerdown', { clientX: point.x, clientY: point.y });
      firePointer(stage, 'pointerup', { clientX: point.x, clientY: point.y });
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject({ id: 1, title: '雪国' });
    expect(onOpen.mock.calls[0]?.[1]).toBe(0);
  });

  it('点非中心的书 → 先居中（core resolveTap 的 centre 分支），不打开', () => {
    const books = booksFixture(5);
    const onOpen = vi.fn();
    const onIndexChange = vi.fn();
    const host = mount(
      <ArchiveShelf
        books={books}
        reduceMotion
        initialIndex={0}
        stageWidthVar={VIEWPORT}
        onOpen={onOpen}
        onIndexChange={onIndexChange}
      />,
    );
    const stage = need(q<HTMLElement>(host, '[data-testid="wenku-archive-shelf-stage"]'), 'stage');
    const distance = 1;
    const x = METRICS.startXPx + distance * METRICS.pitchPx + METRICS.originX(distance) + 4;
    const y = METRICS.railY(distance) + METRICS.originY(distance) + METRICS.bodyPx * 0.5;
    expect(hitTestSlot(METRICS, { x, y }, 0, 5)).toBe(METRICS.focusOf(0, 5) + 1);
    act(() => {
      firePointer(stage, 'pointerdown', { clientX: x, clientY: y });
      firePointer(stage, 'pointerup', { clientX: x, clientY: y });
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    expect(
      need(q(host, '[data-testid="wenku-archive-shelf"]'), 'shelf').getAttribute(
        'data-wenku-active-index',
      ),
    ).toBe('1');
  });

  it('长按 ≥ 500ms → onLongPress(book, index) 并打开玻璃菜单（Android 动作表）', () => {
    const books = booksFixture(5);
    const onLongPress = vi.fn();
    const host = mount(
      <ArchiveShelf
        books={books}
        reduceMotion
        initialIndex={0}
        stageWidthVar={VIEWPORT}
        onOpen={() => {}}
        onLongPress={onLongPress}
      />,
    );
    const stage = need(q<HTMLElement>(host, '[data-testid="wenku-archive-shelf-stage"]'), 'stage');
    const point = centrePoint();
    act(() => {
      firePointer(stage, 'pointerdown', { clientX: point.x, clientY: point.y });
      vi.advanceTimersByTime(SHELF_LONG_PRESS_MS + 10);
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onLongPress.mock.calls[0]?.[0]).toMatchObject({ id: 1 });
    expect(onLongPress.mock.calls[0]?.[1]).toBe(0);
    expect(q(host, '[data-testid="wenku-shelf-menu"]')).not.toBeNull();
    const labels = [...host.querySelectorAll('[data-testid="wenku-menu-item"]')].map(
      (node) => node.textContent ?? '',
    );
    for (const entry of defaultShelfMenuEntries(false)) {
      expect(labels.some((label) => label.includes(entry.label))).toBe(true);
    }
    expect(host.querySelectorAll('[data-testid="wenku-action-bar-item"]').length).toBe(
      defaultShelfMenuEntries(false).filter((entry) => entry.key !== 'more').length,
    );
  });

  it('收藏板块的动作表换成「打开 / 移动 / 分享 / 取消喜欢 / 更多」', () => {
    const books = booksFixture(3);
    const host = mount(
      <ArchiveShelf
        books={books}
        reduceMotion
        favorites
        initialIndex={0}
        stageWidthVar={VIEWPORT}
        onOpen={() => {}}
        onLongPress={() => {}}
      />,
    );
    const stage = need(q<HTMLElement>(host, '[data-testid="wenku-archive-shelf-stage"]'), 'stage');
    const point = centrePoint();
    act(() => {
      firePointer(stage, 'pointerdown', { clientX: point.x, clientY: point.y });
      vi.advanceTimersByTime(SHELF_LONG_PRESS_MS + 10);
    });
    const keys = [...host.querySelectorAll<HTMLElement>('[data-testid="wenku-menu-item"]')].map(
      (node) => node.dataset.wenkuEntry,
    );
    expect(keys).toEqual(['open', 'move', 'share', 'unfavorite', 'more']);
    expect(
      need(q(host, '[data-wenku-entry="unfavorite"]'), 'unfavorite').className,
    ).toContain('wenku-menu__item--destructive');
    expect(shelfMoreRows(true).map((row) => row.key)).toEqual(['check-update', 'clear-selection']);
    expect(shelfMoreRows(false).map((row) => row.key)).toEqual(['mark-finished', 'clear-selection']);
  });

  it('点菜单项 → onMenuAction(key, book, index)，并收起菜单', () => {
    const books = booksFixture(3);
    const onMenuAction = vi.fn();
    const host = mount(
      <ArchiveShelf
        books={books}
        reduceMotion
        initialIndex={0}
        stageWidthVar={VIEWPORT}
        onOpen={() => {}}
        onLongPress={() => {}}
        onMenuAction={onMenuAction}
      />,
    );
    const stage = need(q<HTMLElement>(host, '[data-testid="wenku-archive-shelf-stage"]'), 'stage');
    const point = centrePoint();
    act(() => {
      firePointer(stage, 'pointerdown', { clientX: point.x, clientY: point.y });
      vi.advanceTimersByTime(SHELF_LONG_PRESS_MS + 10);
    });
    const share = need(q<HTMLButtonElement>(host, '[data-wenku-entry="share"]'), 'share item');
    act(() => {
      fireClick(share);
    });
    expect(onMenuAction).toHaveBeenCalledWith('share', expect.objectContaining({ id: 1 }), 0);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(q(host, '[data-testid="wenku-shelf-menu"]')).toBeNull();
  });

  it('键盘 ← → 切槽位、Enter 打开当前书', () => {
    const books = booksFixture(5);
    const onOpen = vi.fn();
    const onIndexChange = vi.fn();
    const host = mount(
      <ArchiveShelf
        books={books}
        reduceMotion
        initialIndex={0}
        stageWidthVar={VIEWPORT}
        onOpen={onOpen}
        onIndexChange={onIndexChange}
      />,
    );
    const stage = need(q<HTMLElement>(host, '[data-testid="wenku-archive-shelf-stage"]'), 'stage');
    const activeIndex = (): string | null =>
      need(q(host, '[data-testid="wenku-archive-shelf"]'), 'shelf').getAttribute(
        'data-wenku-active-index',
      );
    act(() => {
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(activeIndex()).toBe('1');
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    act(() => {
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(activeIndex()).toBe('0');
    act(() => {
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[1]).toBe(0);
  });

  it('书讯的上一本/下一本走 core 的 centreStep（末本 +1 = 第 1 本）', () => {
    const books = booksFixture(3);
    const host = mount(
      <ArchiveShelf books={books} reduceMotion initialIndex={2} stageWidthVar={VIEWPORT} onOpen={() => {}} />,
    );
    expect(
      need(q(host, '[data-testid="wenku-archive-shelf"]'), 'shelf').getAttribute(
        'data-wenku-active-index',
      ),
    ).toBe('2');
    expect(need(q(host, '[data-testid="wenku-caption-counter"]'), 'counter').textContent).toBe(
      '03 / 03',
    );
    const next = need(q<HTMLButtonElement>(host, '[data-testid="wenku-caption-next"]'), 'next');
    act(() => {
      fireClick(next);
    });
    expect(
      need(q(host, '[data-testid="wenku-archive-shelf"]'), 'shelf').getAttribute(
        'data-wenku-active-index',
      ),
    ).toBe('0');
    expect(need(q(host, '[data-testid="wenku-caption-counter"]'), 'counter').textContent).toBe(
      '01 / 03',
    );
  });

  it('书讯的打开按钮回调 onOpen（ArchiveShelfCaption 的可点行）', () => {
    const books = booksFixture(4);
    const onOpen = vi.fn();
    const host = mount(
      <ArchiveShelf books={books} reduceMotion initialIndex={1} stageWidthVar={VIEWPORT} onOpen={onOpen} />,
    );
    act(() => {
      fireClick(need(q(host, '[data-testid="wenku-caption-open"]'), 'caption open'));
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[1]).toBe(1);
    expect(need(q(host, '[data-testid="wenku-caption-title"]'), 'title').textContent).toBe(
      'Alpha Beta',
    );
  });
});

/* ───────────────────────────── 书架：空态 / 减少动效 / 记忆 ───────────────────────────── */

describe('3D 书架：空态 / 减少动效 / 记忆', () => {
  it('空书架渲染空态（Kotlin L184 直接 return）', () => {
    const host = mount(<ArchiveShelf books={[]} onOpen={() => {}} />);
    expect(
      need(q(host, '[data-testid="wenku-archive-shelf"]'), 'shelf').getAttribute('data-wenku-empty'),
    ).toBe('true');
    expect(need(q(host, '[data-testid="wenku-archive-shelf-empty"]'), 'empty').textContent).toContain(
      '书架还是空的',
    );
    expect(q(host, '[data-testid="wenku-shelf-slot"]')).toBeNull();
    expect(q(host, '[data-testid="wenku-shelf-caption"]')).toBeNull();
  });

  it('prefers-reduced-motion → data-reduce-motion=true，槽位立即全可见', () => {
    reduceMotionPreference = true;
    installMatchMedia();
    const books = booksFixture(5);
    const host = mount(
      <ArchiveShelf books={books} initialIndex={0} stageWidthVar={VIEWPORT} onOpen={() => {}} />,
    );
    expect(
      need(q(host, '[data-testid="wenku-archive-shelf"]'), 'shelf').getAttribute(
        'data-reduce-motion',
      ),
    ).toBe('true');
    expect(host.querySelectorAll('[data-testid="wenku-shelf-slot"]').length).toBe(
      slotsFor(books).length,
    );
  });

  it('入场未完成时按 ink 过滤槽位（layoutVisibleSlots 的 entrance 参数）', () => {
    const books = booksFixture(5);
    const host = mount(
      <ArchiveShelf books={books} initialIndex={0} stageWidthVar={VIEWPORT} onOpen={() => {}} />,
    );
    const before = host.querySelectorAll('[data-testid="wenku-shelf-slot"]').length;
    settleEntry();
    const after = host.querySelectorAll('[data-testid="wenku-shelf-slot"]').length;
    expect(before).toBe(0);
    expect(after).toBe(slotsFor(books).length);
  });

  it('initialIndex 优先于记忆；记忆优先于最近阅读（startingIndex 的优先级）', () => {
    const books = booksFixture(5);
    // 记忆里是 bookId 3 → 下标 2；没有 initialIndex 时用它
    ArchiveShelfMemory.remember('scope-a', 3);
    const withMemory = mount(
      <ArchiveShelf books={books} reduceMotion scopeKey="scope-a" stageWidthVar={VIEWPORT} onOpen={() => {}} />,
    );
    expect(
      need(q(withMemory, '[data-testid="wenku-archive-shelf"]'), 'shelf').getAttribute(
        'data-wenku-active-index',
      ),
    ).toBe('2');

    // initialIndex 压过记忆（Kotlin L202-209 的第一个分支）
    ArchiveShelfMemory.remember('scope-b', 3);
    const withInitial = mount(
      <ArchiveShelf
        books={books}
        reduceMotion
        scopeKey="scope-b"
        initialIndex={4}
        stageWidthVar={VIEWPORT}
        onOpen={() => {}}
      />,
    );
    expect(
      need(q(withInitial, '[data-testid="wenku-archive-shelf"]'), 'shelf').getAttribute(
        'data-wenku-active-index',
      ),
    ).toBe('4');
  });

  it('最近阅读时间兜底（没有 initialIndex、没有记忆）', () => {
    const books = booksFixture(4).map((book, index) => ({
      ...book,
      lastReadTime: index === 2 ? 9000 : index,
    }));
    const host = mount(
      <ArchiveShelf books={books} reduceMotion scopeKey="scope-b" stageWidthVar={VIEWPORT} onOpen={() => {}} />,
    );
    expect(
      need(q(host, '[data-testid="wenku-archive-shelf"]'), 'shelf').getAttribute(
        'data-wenku-active-index',
      ),
    ).toBe('2');
  });

  it('停位按 scopeKey 分开记（ArchiveShelfMemory）', () => {
    const books = booksFixture(5);
    const host = mount(
      <ArchiveShelf
        books={books}
        reduceMotion
        scopeKey="favorites"
        initialIndex={3}
        stageWidthVar={VIEWPORT}
        onOpen={() => {}}
      />,
    );
    expect(
      need(q(host, '[data-testid="wenku-archive-shelf"]'), 'shelf').getAttribute(
        'data-wenku-active-index',
      ),
    ).toBe('3');
    expect(ArchiveShelfMemory.indexFor('favorites', books)).toBe(3);
    expect(ArchiveShelfMemory.indexFor('shelf', books)).toBeNull();
  });

  it('菜单锚点用 core 的 semanticBoxRect（书架的语义盒）', () => {
    const box = semanticBoxRect(METRICS, 0, 5, 0);
    expect(box).toEqual({ left: 154, top: 29, width: 102, height: 226 });
    const books = booksFixture(5);
    const host = mount(
      <ArchiveShelf
        books={books}
        reduceMotion
        initialIndex={0}
        stageWidthVar={VIEWPORT}
        onOpen={() => {}}
        onLongPress={() => {}}
      />,
    );
    const stage = need(q<HTMLElement>(host, '[data-testid="wenku-archive-shelf-stage"]'), 'stage');
    const point = centrePoint();
    act(() => {
      firePointer(stage, 'pointerdown', { clientX: point.x, clientY: point.y });
      vi.advanceTimersByTime(SHELF_LONG_PRESS_MS + 10);
    });
    const layer = need(q<HTMLElement>(host, '[data-testid="wenku-shelf-menu"]'), 'menu');
    expect(layer.style.getPropertyValue('--wenku-anchor-x')).toBe(`${String(box.left)}px`);
    expect(layer.style.getPropertyValue('--wenku-anchor-y')).toBe(`${String(box.top)}px`);
  });
});

/* ───────────────────────────── 图标 ───────────────────────────── */

describe('WenkuIcon：Kotlin 符号表与手绘几何', () => {
  const SHELF_SYMBOLS: WenkuSymbol[] = [
    'Shelf',
    'Book',
    'Folder',
    'More',
    'Close',
    'Back',
    'Forward',
    'ArrowLeft',
    'ArrowRight',
    'External',
    'Contents',
    'Bookmark',
    'Share',
    'Delete',
    'Download',
    'Check',
    'CheckCircle',
    'Search',
    'Filter',
    'Grid',
    'Settings',
    'Info',
    'Warning',
    'Refresh',
    'Edit',
  ];

  it('书架/菜单实际用到的 25 个符号都有烘焙几何（无空 d、无 NaN）', () => {
    expect(SHELF_SYMBOLS.length).toBeGreaterThanOrEqual(20);
    for (const symbol of SHELF_SYMBOLS) {
      expect(wenkuIconHasArt(symbol)).toBe(true);
    }
    const host = mount(
      <div>
        {SHELF_SYMBOLS.map((symbol) => (
          <WenkuIcon key={symbol} symbol={symbol} testId={`icon-${symbol}`} />
        ))}
      </div>,
    );
    for (const symbol of SHELF_SYMBOLS) {
      const svg = need(q(host, `[data-testid="icon-${symbol}"]`), symbol);
      const paths = [...svg.querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '');
      expect(paths.length).toBeGreaterThan(0);
      for (const d of paths) {
        expect(d.startsWith('M')).toBe(true);
        expect(d.includes('NaN')).toBe(false);
        expect(d.includes('Infinity')).toBe(false);
      }
    }
  });

  it('13 个变体符号折叠成族符号后再出图（WenkuIconPoses.of）', () => {
    expect(WENKU_ICON_ART['Pause']?.length).toBeGreaterThan(0);
    const host = mount(
      <div>
        <WenkuIcon symbol="Back" testId="back" />
        <WenkuIcon symbol="Pause" testId="pause" />
        <WenkuIcon symbol="Selected" testId="selected" />
        <WenkuIcon symbol="EyeOff" testId="eyeoff" />
      </div>,
    );
    expect(need(q(host, '[data-testid="back"]'), 'back').getAttribute('data-wenku-family')).toBe(
      'Forward',
    );
    expect(need(q(host, '[data-testid="pause"]'), 'pause').getAttribute('data-wenku-family')).toBe(
      'Play',
    );
    expect(
      need(q(host, '[data-testid="selected"]'), 'selected').getAttribute('data-wenku-family'),
    ).toBe('Circle');
    expect(need(q(host, '[data-testid="eyeoff"]'), 'eyeoff').getAttribute('data-wenku-family')).toBe(
      'Eye',
    );
  });

  it('Material 图标名 → WenkuSymbol（WenkuIconMapping.kt 的叶子名匹配）', () => {
    expect(wenkuSymbolForIconName('Filled.MenuBook')).toBe('Book');
    expect(wenkuSymbolForIconName('AutoMirrored.Filled.KeyboardArrowLeft')).toBe('Back');
    expect(wenkuSymbolForIconName('Outlined.Share')).toBe('Share');
    expect(wenkuSymbolForIconName('Filled.MoreVert')).toBe('More');
    expect(wenkuSymbolForIconName('Filled.Delete')).toBe('Delete');
    expect(wenkuSymbolForIconName('Filled.NotARealIcon')).toBeNull();
  });

  it('装饰图标 aria-hidden；给了 title 就是有名字的图形', () => {
    const host = mount(
      <div>
        <WenkuIcon symbol="Shelf" testId="decorative" />
        <WenkuIcon symbol="Shelf" testId="named" title="书架" />
      </div>,
    );
    expect(
      need(q(host, '[data-testid="decorative"]'), 'decorative').getAttribute('aria-hidden'),
    ).toBe('true');
    expect(need(q(host, '[data-testid="named"]'), 'named').getAttribute('aria-label')).toBe('书架');
    expect(need(q(host, '[data-testid="named"]'), 'named').getAttribute('role')).toBe('img');
  });
});

/* ───────────────────────────── 玻璃 / 面板 / 菜单宿主 ───────────────────────────── */

describe('WenkuGlass / WenkuActionSheet / WenkuMenuHost', () => {
  it('玻璃面：28dp 圆角 + wenku-glass 类 + 内容槽', () => {
    const host = mount(<WenkuGlass testId="glass">内容</WenkuGlass>);
    const node = need(q<HTMLElement>(host, '[data-testid="glass"]'), 'glass');
    expect(node.className).toContain('wenku-glass');
    expect(node.textContent).toBe('内容');
    expect(node.style.borderRadius).toBe('28px');
  });

  it('玻璃面板：标题 / 关闭 / 抓取条 / 内容，挂载后 data-wenku-open=true', () => {
    const onDismiss = vi.fn();
    const host = mount(
      <WenkuActionSheet title="更多操作" onDismiss={onDismiss} testId="sheet">
        <button type="button">标记为已读完</button>
      </WenkuActionSheet>,
    );
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(need(q(host, '[data-testid="sheet"]'), 'sheet').getAttribute('data-wenku-open')).toBe(
      'true',
    );
    expect(need(q(host, '.wenku-sheet__title'), 'title').textContent).toBe('更多操作');
    expect(need(q(host, '[role="dialog"]'), 'dialog').getAttribute('aria-label')).toBe('更多操作');
    expect(q(host, '[data-testid="wenku-action-sheet-grabber"]')).not.toBeNull();
    act(() => {
      fireClick(need(q(host, '[data-testid="wenku-action-sheet-close"]'), 'close'));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('遮罩点击与 Esc 都能关；dismissEnabled=false 时都不关（WenkuActionSheet.kt L26）', () => {
    const onDismiss = vi.fn();
    const host = mount(<WenkuActionSheet title="面板" onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    act(() => {
      fireClick(need(q(host, '[data-testid="wenku-action-sheet-scrim"]'), 'scrim'));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    const locked = vi.fn();
    const lockedHost = mount(
      <WenkuActionSheet title="锁定" onDismiss={locked} dismissEnabled={false} />,
    );
    act(() => {
      vi.advanceTimersByTime(50);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(locked).not.toHaveBeenCalled();
    expect(
      need(
        q(lockedHost, '[data-testid="wenku-action-sheet-close"]'),
        'locked close',
      ).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('菜单宿主：visible 挂载、项回调、Esc 触发 onDismiss', () => {
    const onDismiss = vi.fn();
    const onSelect = vi.fn();
    const host = mount(
      <WenkuMenuHost
        visible
        anchor={{ left: 40, top: 60, width: 80, height: 120 }}
        title="雪国"
        entries={[
          { key: 'open', label: '打开', icon: 'Book', onSelect },
          { key: 'delete', label: '删除下载', icon: 'Delete', destructive: true },
        ]}
        onDismiss={onDismiss}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(
      need(q(host, '[data-testid="wenku-menu-host"]'), 'menu host').getAttribute('data-wenku-open'),
    ).toBe('true');
    expect(need(q(host, '[data-testid="wenku-menu-title"]'), 'title').textContent).toBe('雪国');
    const items = host.querySelectorAll<HTMLButtonElement>('[data-testid="wenku-menu-item"]');
    expect(items.length).toBe(2);
    act(() => {
      fireClick(need(items[0], 'first item'));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('操作栏：收起时不可点，展开后每项回调（ShelfSelectionHost.kt L451-545）', () => {
    const onSelect = vi.fn();
    const closed = mount(
      <WenkuActionBar
        visible={false}
        actions={[{ key: 'move', label: '移动', icon: 'Folder', onSelect }]}
      />,
    );
    expect(
      need(q<HTMLButtonElement>(closed, '[data-testid="wenku-action-bar-item"]'), 'closed item')
        .disabled,
    ).toBe(true);

    const open = mount(
      <WenkuActionBar
        visible
        actions={[
          { key: 'move', label: '移动', icon: 'Folder', onSelect },
          { key: 'delete', label: '删除下载', icon: 'Delete', destructive: true },
        ]}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(
      need(q(open, '[data-testid="wenku-action-bar"]'), 'bar').getAttribute('data-wenku-open'),
    ).toBe('true');
    const buttons = open.querySelectorAll<HTMLButtonElement>('[data-testid="wenku-action-bar-item"]');
    expect(buttons.length).toBe(2);
    act(() => {
      fireClick(need(buttons[0], 'first action'));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(need(buttons[1], 'second action').className).toContain(
      'wenku-actionbar__item--destructive',
    );
  });
});
