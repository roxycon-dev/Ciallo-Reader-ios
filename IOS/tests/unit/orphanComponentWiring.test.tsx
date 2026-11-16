/**
 * orphanComponentWiring.test.tsx — 「孤儿组件接线」回归钉子。
 *
 * 背景：可达性审计发现 `src/ui/components/` 里有一批**逐行移植但生产不可达**的组件，
 * 页面上跑的是页面内联的手写副本。本文件把「页面真的用上移植版」这件事钉死在 DOM 上：
 * 每条用例都做**页面级挂载**，断言移植版的类名上屏、内联副本的类名消失。
 *
 * 本轮接线（与 Kotlin 调用点一一对应）：
 *   | 页面            | 移植版组件                              | Kotlin 生产调用点                    |
 *   |-----------------|-----------------------------------------|--------------------------------------|
 *   | StatisticsPage  | `ReadingCalendarCard`                   | StatisticsScreen.kt:210              |
 *   | StatisticsPage  | `ReadingTrendCard`                      | StatisticsScreen.kt:220              |
 *   | StatisticsPage  | `ReadingRecordCover`                    | StatisticsScreen.kt:725              |
 *   | StatisticsPage  | `ReadingStats`（纯函数/hook 模块）      | StatisticsScreen.kt L118-120/231     |
 *   | SettingsPage    | `SettingsPageTurnSelectorRow`           | SettingsTabScreen.kt:674             |
 *   | SettingsPage    | `SettingsSegmentedPillSelector`         | SettingsTabScreen.kt:432/583/613/…   |
 *   | SettingsPage    | `CustomMinutesDialog`                   | SettingsTabScreen.kt:1112            |
 *
 * 反向断言（「页面不再出现内联副本特征」）分两层：
 *   ① DOM 层：内联副本独有的类名（`.stats-cal-*` / `.stats-trend-*` /
 *      `.page-turn-android-row` / `.settings-segmented`）在挂载结果里查不到；
 *   ② 源码层：页面文件里不再有同名 `function` 定义，而是 import 移植版。
 *
 * 仓库没有 `@testing-library/react`，沿用 tests/unit 既有写法：`react-dom/client` + `act`。
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { AppLanguage, setAppLanguage } from '@core/i18n';
import { bootstrapLibrary, useAppStore } from '@ui/state/appStore';
import { StatisticsPage } from '@ui/pages/StatisticsPage';
import { SettingsPage } from '@ui/pages/SettingsPage';

/* ── jsdom 缺件（页面会读 matchMedia / rAF） ── */

const mediaQueryStub = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

const realFetch = globalThis.fetch;

beforeAll(async () => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 200 }));
  vi.stubGlobal('matchMedia', mediaQueryStub);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number =>
    window.setTimeout(() => {
      callback(performance.now());
    }, 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
    window.clearTimeout(handle);
  });
  await bootstrapLibrary();
});

afterAll(() => {
  vi.stubGlobal('fetch', realFetch);
  vi.unstubAllGlobals();
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

/* ── 渲染骨架 ── */

interface Mounted {
  readonly host: HTMLDivElement;
  readonly root: Root;
}

const mounted: Mounted[] = [];

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  mounted.push({ host, root });
  return host;
}

/** 让 effect 里的 await 链跑完（统计页会 `bootstrapLibrary()` + 读库）。 */
async function settle(ms = 20): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  });
}

beforeEach(() => {
  setAppLanguage(AppLanguage.ZH);
  useAppStore.setState({ route: 'main', activeTab: 'library', appLanguage: AppLanguage.ZH });
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => {
      entry.root.unmount();
    });
    entry.host.remove();
  }
  setAppLanguage(AppLanguage.ZH);
  useAppStore.setState({ appLanguage: AppLanguage.ZH });
});

/* ── 夹具 ── */

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function todayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

const RECORD_ID = 4242;
const COVER_URL = 'https://example.test/cover-4242.jpg';

/** 今天读 600 秒的一条记录 + 封面补抓结果 + 在线书 sourceId。 */
const RECORDS = [
  {
    id: RECORD_ID,
    bookId: null,
    bookTitle: '接线验证之书',
    dateStr: todayStr(),
    durationSeconds: 600,
  },
];

async function mountStatistics(): Promise<HTMLElement> {
  const host = await mount(
    <StatisticsPage
      totalReadTimeSeconds={1800}
      readingRecords={RECORDS}
      readingSessions={[
        { id: 1, dateStr: todayStr(), startTimeMs: Date.now(), startHour: 9, durationSeconds: 600 },
      ]}
      recordCovers={new Map([[RECORD_ID, COVER_URL]])}
      recordBooks={new Map([[RECORD_ID, { sourceId: 'alice' }]])}
    />,
  );
  await settle();
  return host;
}

/** 打开「今日」那一格的当日明细。 */
async function openTodaySheet(host: HTMLElement): Promise<HTMLElement> {
  const day = todayStr().slice(8);
  const cells = Array.from(host.querySelectorAll<HTMLButtonElement>('.cal-day'));
  const target = cells.find((cell) => cell.querySelector('.cal-day__num')?.textContent === day);
  expect(target, '日历里应能找到今天那一格').toBeTruthy();
  await act(async () => {
    target?.click();
  });
  const sheet = host.querySelector<HTMLElement>('.stats-sheet');
  expect(sheet, '点击日格应打开当日明细').toBeTruthy();
  return sheet as HTMLElement;
}

function buttonByText(host: ParentNode, text: string): HTMLButtonElement | null {
  const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('button'));
  return buttons.find((button) => (button.textContent ?? '').trim() === text) ?? null;
}

function pageSource(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

/* ══════════════════════ StatisticsPage ══════════════════════ */

describe('StatisticsPage — 统计卡改用移植版组件', () => {
  it('ReadingCalendarCard：`.cal-card` 上屏，内联副本的 `.stats-cal-*` 不再出现', async () => {
    const host = await mountStatistics();

    // 移植版结构（ReadingCalendarCard.kt L57-160 → `.cal-card__head` / 月年 pill / 步进器）
    expect(host.querySelector('.cal-card')).toBeTruthy();
    expect(host.querySelectorAll('.cal-month__weekday')).toHaveLength(7);
    expect(host.querySelectorAll('.cal-day').length).toBeGreaterThanOrEqual(28);
    expect(host.querySelector('.cal-card__period')?.textContent).toBe(
      `${new Date().getFullYear()}年${new Date().getMonth() + 1}月`,
    );

    // 内联副本特征全部消失
    expect(host.querySelector('.stats-cal-weekdays')).toBeNull();
    expect(host.querySelector('.stats-cal-grid')).toBeNull();
    expect(host.querySelector('.stats-cal-cell')).toBeNull();
  });

  it('ReadingCalendarCard 交互：点日格 → onDayClick 打开当日明细（`.stats-sheet`）', async () => {
    const host = await mountStatistics();
    const sheet = await openTodaySheet(host);
    expect(sheet.querySelector('.stats-sheet-title')?.textContent).toContain(todayStr());
    expect(sheet.querySelector('.stats-sheet-total')?.textContent).toContain('10分钟');
  });

  it('ReadingRecordCover：当日明细的封面由移植版渲染（`.reading-record-cover` + src）', async () => {
    const host = await mountStatistics();
    const sheet = await openTodaySheet(host);

    const cover = sheet.querySelector<HTMLImageElement>('img.reading-record-cover');
    expect(cover, '有 recordCovers 时应渲染移植版封面').toBeTruthy();
    expect(cover?.getAttribute('src')).toBe(COVER_URL);
    expect(cover?.getAttribute('alt')).toBe('接线验证之书');
    // Kotlin `contentScale = ContentScale.Crop` → CSS object-fit: cover
    expect(cover?.style.objectFit).toBe('cover');
    // 移植版把 headers 暴露成 data-cover-headers（无 header 时不带该属性）
    expect(cover?.hasAttribute('data-cover-headers')).toBe(false);
  });

  it('ReadingTrendCard：`.trend-card` 上屏，内联副本的 `.stats-trend-*` 不再出现', async () => {
    const host = await mountStatistics();

    expect(host.querySelector('.trend-card')).toBeTruthy();
    expect(host.querySelector('.trend-card__legend-label')?.textContent).toBe('阅读时长 · 近14天');
    // 24 根高峰柱（Kotlin PeakHoursBars L347-401）
    expect(host.querySelectorAll('.peak-bars__col')).toHaveLength(24);

    expect(host.querySelector('.stats-trend-chart-wrap')).toBeNull();
    expect(host.querySelector('.stats-trend-meta')).toBeNull();
    expect(host.querySelector('.stats-peak-bar-col')).toBeNull();
  });

  it('ReadingTrendCard 交互：周/月 pill 切换由移植版内部状态驱动（近14天 → 近30天）', async () => {
    const host = await mountStatistics();
    const tabs = host.querySelector('.trend-card__tabs');
    expect(tabs).toBeTruthy();
    const month = buttonByText(tabs as HTMLElement, '月');
    expect(month).toBeTruthy();

    await act(async () => {
      month?.click();
    });

    expect(host.querySelector('.trend-card__legend-label')?.textContent).toBe('阅读时长 · 近30天');
  });

  it('页面源码：三处内联副本已删除，改为 import 移植版 + 复用 ReadingStats 模块', () => {
    const source = pageSource('src/ui/pages/StatisticsPage.tsx');

    expect(source).toContain("from '@ui/components/ReadingCalendarCard'");
    expect(source).toContain("from '@ui/components/ReadingTrendCard'");
    expect(source).toContain("from '@ui/components/ReadingRecordCover'");
    expect(source).toContain("from '@ui/components/ReadingStats'");

    expect(source).not.toContain('function ReadingCalendarCard(');
    expect(source).not.toContain('function ReadingTrendCard(');
    expect(source).not.toContain('function ReadingRecordCover(');
    expect(source).not.toContain('function YearHeatmap(');
    // 页面自己的 `useTodayCalendar` 副本也删了（改用移植版导出的那个）
    expect(source).not.toContain('function useTodayCalendar(');
  });
});

/* ══════════════════════ SettingsPage ══════════════════════ */

describe('SettingsPage — 设置控件改用移植版组件', () => {
  it('SettingsPageTurnSelectorRow：5 行翻页效果全部由移植版渲染', async () => {
    const host = await mount(<SettingsPage />);
    await settle();

    const rows = host.querySelectorAll('.settings-pt-row');
    expect(rows).toHaveLength(5);
    expect(host.querySelectorAll('.settings-pt-row__title')).toHaveLength(5);
    // Kotlin SettingsControls.kt L94 `PageTurnSelectorRow(title, description, type, selected, onClick)`
    expect(host.querySelector('.settings-pt-row__title')?.textContent).toBe('仿真3D卷页');

    // 内联副本特征消失
    expect(host.querySelector('.page-turn-android-row')).toBeNull();
    expect(host.querySelector('.page-turn-android-row__preview')).toBeNull();
  });

  it('SettingsPageTurnSelectorRow 交互：点第 5 行 → 只有它 aria-pressed="true"', async () => {
    const host = await mount(<SettingsPage />);
    await settle();

    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>('.settings-pt-row'));
    const target = rows[rows.length - 1];
    expect(target).toBeTruthy();
    expect(target?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      target?.click();
    });
    await settle();

    const after = Array.from(host.querySelectorAll<HTMLButtonElement>('.settings-pt-row'));
    expect(after.filter((row) => row.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    expect(after[after.length - 1]?.getAttribute('aria-pressed')).toBe('true');
    expect(after[after.length - 1]?.querySelector('.settings-pt-row__title')?.textContent).toBe(
      '上下滚动',
    );
  });

  it('SettingsSegmentedPillSelector：分段选择器由移植版渲染（`.settings-pill__row`）', async () => {
    const host = await mount(<SettingsPage />);
    await settle();

    const pills = host.querySelectorAll('.settings-pill');
    expect(pills.length).toBeGreaterThanOrEqual(5);
    expect(host.querySelectorAll('.settings-pill__row').length).toBe(pills.length);
    // 5 个 Kotlin 调用点：开屏海报 / 屏幕方向 / 渲染画质 / 定时休息 / 界面语言
    const labels = Array.from(host.querySelectorAll('.settings-pill__option')).map(
      (option) => option.textContent,
    );
    expect(labels).toEqual(
      expect.arrayContaining(['默认', '自定义', '跟随系统', '锁定竖屏', '极简', '均衡', '关', '60分', '中文']),
    );

    // 内联副本特征消失
    expect(host.querySelector('.settings-segmented')).toBeNull();
    expect(host.querySelector('.settings-segmented__option')).toBeNull();
  });

  it('SettingsSegmentedPillSelector 交互：点「高」→ 该 pill 内只有它变 active', async () => {
    const host = await mount(<SettingsPage />);
    await settle();

    const high = buttonByText(host, '高');
    expect(high, '渲染画质分段里应有「高」这一项').toBeTruthy();
    const pill = high?.closest('.settings-pill');
    expect(pill).toBeTruthy();

    await act(async () => {
      high?.click();
    });
    await settle();

    const active = Array.from(pill?.querySelectorAll('.settings-pill__option') ?? []).filter(
      (option) => option.className.includes('settings-pill__option--active'),
    );
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toBe('高');
    // 同页其它 pill（开屏海报 / 屏幕方向 / 定时休息 / 界面语言）不受影响
    expect(host.querySelectorAll('.settings-pill__option--active').length).toBeGreaterThanOrEqual(5);
  });

  it('CustomMinutesDialog：点「自定义」→ 移植版弹窗（`custom_minutes_dialog` + `.settings-dialog__title`）', async () => {
    const host = await mount(<SettingsPage />);
    await settle();

    const triggers = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
      (button) => (button.textContent ?? '').trim() === '自定义',
    );
    // 最后一个「自定义」是定时休息旁的 AppButton（前面那个是壁纸分段的选项）
    const trigger = triggers[triggers.length - 1];
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.click();
    });
    await settle();

    const dialog = document.querySelector('[data-testid="custom_minutes_dialog"]');
    expect(dialog, '移植版 CustomMinutesDialog 应挂载').toBeTruthy();
    expect(dialog?.querySelector('.settings-dialog__title')?.textContent).toBe('自定义休息时间');
    expect(dialog?.querySelector('.settings-textfield')).toBeTruthy();
    expect(dialog?.querySelector('.settings-dialog__minutes')?.textContent).toContain('分钟');
  });

  it('页面源码：内联副本已删除，改为 import SettingsControls 的移植版', () => {
    const source = pageSource('src/ui/pages/SettingsPage.tsx');

    expect(source).toContain("from '@ui/components/SettingsControls'");
    expect(source).toContain('SettingsPageTurnSelectorRow');
    expect(source).toContain('SettingsSegmentedPillSelector');
    expect(source).toContain('CustomMinutesDialog');

    expect(source).not.toContain('function AndroidPageTurnRow(');
    expect(source).not.toContain('function SettingsSegmented(');
    expect(source).not.toContain('function CustomMinutesDialog(');
    expect(source).not.toContain('function PageTurnPreview(');
    // Kotlin L980-991 的 `PageTurnType.entries` 循环仍在页面上（只是换成移植版行）
    expect(source).not.toContain('<AndroidPageTurnRow');
  });
});
