/**
 * i18nMiscPages.test.tsx — 五个二级页面的界面语言接线回归测试。
 *
 * 权威源：`novel-reader/app/src/main/java/com/example/i18n/Strings.kt` 的 `private val EN`
 * 词表 —— 也就是 `IOS/src/core/i18n/strings.ts` 的 `EN_PAIRS`（2535 组 / 2307 个唯一 key），
 * 以及 `com/example/ui/StatisticsScreen.kt` / `DiscoverScreen.kt` / `SourceManagementScreen.kt` /
 * `CacheManagementScreen.kt` / `DeviceTransferScreen.kt` 里被 `t(...)` 包住的那些文案。
 *
 * 覆盖任务书要求的四条：
 *   (a) 中文态这五个页面显示原文（`阅读统计` / `发现` / `书源` / `缓存管理` / `设备互传`）；
 *   (b) 切 EN 后页面里出现词表值（`Reading stats` + `This week` / `Discover` / `Sources` /
 *       `Cache management` / `Device transfer`），中文原串消失；
 *   (c) 再切回中文，原文恢复、英文消失；
 *   (d) 数据键不被改写：Discover 的 `status` 仍是中文状态值（`全部`），只有显示层过 `tr()`。
 *
 * 语言切换照 `App.tsx` 的做法：先 `setAppLanguage()`（core 单例，`tr()` 读它），再改 store 的
 * `appLanguage`——订阅该字段的 `LanguageBoundary` 随之重渲染，`key` 变化把子树整体重挂载，
 * 与 `App.tsx` 订阅 `appLanguage` 让整棵树重渲染等价。
 *
 * 断言尽量落在**具体元素**上（`.tab-screen-header__title` / `.discover-header h1` /
 * `.stats-period-label` / `aria-label`）：页面里还有一批「复合文案」（`聚合发现`、
 * `并打开设备互传。`、`阅读时长 · 近14天`）不是整串 key，本来就不该整串替换，
 * 用 `textContent` 的全文包含/不包含会被它们误伤。
 *
 * 仓库没有 `@testing-library/react`，沿用 tests/unit 既有写法：`react-dom/client` + `act`。
 * 全程 jsdom + 内存 SQLite（`@platform/web-mock`）；fetch 一律回 200 空响应，不联网。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AppLanguage, getAppLanguage, setAppLanguage, tr } from '@core/i18n';
import { bootstrapLibrary, useAppStore } from '@ui/state/appStore';
import { StatisticsPage } from '@ui/pages/StatisticsPage';
import { DiscoverPage } from '@ui/pages/DiscoverPage';
import { NULL_SOURCE_IO, SourceManagementPage } from '@ui/pages/SourceManagementPage';
import { CacheManagementPage } from '@ui/pages/CacheManagementPage';
import { DeviceTransferPage } from '@ui/pages/DeviceTransferPage';

/**
 * `bootstrapLibrary()` 会从 `public/` 取只读书源资源，Discover 的刷新还会去访问各个书源站点。
 * jsdom 里没有 fetch，Node 的全局 fetch 会真的发网络请求，所以这里换成「永远 200 空响应」的桩：
 * 书源拿不到内容只会走各自的错误分支（被 controller 捕获），本测试不联网。
 */
const realFetch = globalThis.fetch;

/** jsdom 没有 `window.matchMedia`（StatisticsPage 的 `prefers-reduced-motion` 会读它）。 */
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

beforeAll(async () => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 200 }));
  vi.stubGlobal('matchMedia', mediaQueryStub);
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

/**
 * 等价于 `App.tsx` 的「订阅 `appLanguage` 让整树重渲染」：换成订阅该 store 字段的小壳，
 * `key` 变一次就把子树整体重挂载一次，页面里的 `tr()` 因此在每次切换后都会重新取值。
 */
function LanguageBoundary({ children }: { children: ReactNode }) {
  const appLanguage = useAppStore((state) => state.appLanguage);
  useEffect(() => {
    setAppLanguage(appLanguage);
  }, [appLanguage]);
  return <div key={appLanguage}>{children}</div>;
}

interface Mounted {
  readonly host: HTMLDivElement;
  readonly root: Root;
}

const mounted: Mounted[] = [];

async function mount(node: ReactNode): Promise<Mounted> {
  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  const entry: Mounted = { host, root };
  mounted.push(entry);
  await act(async () => {
    root.render(<LanguageBoundary>{node}</LanguageBoundary>);
  });
  return entry;
}

/** 让 effect 里的 await 链跑完（Discover 的 runtime 解析、Cache 的扫描都是异步的）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * 轮询一个 DOM 条件。Discover 切语言会把整页重挂载成「正在准备发现…」占位态，
 * 而占位文案里也有「发现」两个字，所以不能靠全文包含判断页头是否真的回来了。
 */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error(`等待 ${label} 超时`);
}

function switchLanguage(language: AppLanguage): void {
  act(() => {
    setAppLanguage(language);
    useAppStore.setState({ appLanguage: language });
  });
}

/** 页面标题（`TabScreenHeader`）的 `<h1>` 文本。 */
function headerTitle(host: HTMLElement): string | null | undefined {
  return host.querySelector('.tab-screen-header__title')?.textContent;
}

/** Discover 的页头标题（`<h1>发现</h1>`）。 */
function discoverHeading(host: HTMLElement): string | null | undefined {
  return host.querySelector('.discover-header h1')?.textContent;
}

beforeEach(() => {
  setAppLanguage(AppLanguage.ZH);
  useAppStore.setState({ route: 'main', activeTab: 'library', appLanguage: AppLanguage.ZH });
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.host.remove();
  }
  setAppLanguage(AppLanguage.ZH);
  useAppStore.setState({ appLanguage: AppLanguage.ZH });
});

describe('二级页面界面语言接线 — Statistics / Discover / Sources / Cache / Transfer', () => {
  it('StatisticsPage：中文原文 → EN 出现 Reading stats / This week → 切回恢复', async () => {
    const { host } = await mount(<StatisticsPage totalReadTimeSeconds={1800} />);

    // (a) 中文态：页头标题、周期名 + 图表标题、目标行都是原文
    expect(headerTitle(host)).toBe('阅读统计');
    expect(host.querySelector('.stats-period-label')?.textContent).toBe('本周阅读时长');
    expect(host.querySelector('.stats-goal-label')?.textContent).toBe('每日目标');

    switchLanguage(AppLanguage.EN);
    await flush();

    // (b) 词表命中：`阅读统计`→Reading stats、`本周`→This week、`阅读时长`→Time read …
    expect(getAppLanguage()).toBe(AppLanguage.EN);
    expect(headerTitle(host)).toBe('Reading stats');
    expect(host.querySelector('.stats-period-label')?.textContent).toBe('This weekTime read');
    expect(host.querySelector('.stats-goal-label')?.textContent).toBe('Daily goal');
    expect(host.textContent).toContain('Current streak');
    // 本周阅读明细区属于 `WeeklyReadingChart`（不在本次改动范围），只校验本页自己的标题/图表文案
    expect(host.textContent).not.toContain('每日目标');

    // (c) 切回中文恢复
    switchLanguage(AppLanguage.ZH);
    await flush();

    expect(getAppLanguage()).toBe(AppLanguage.ZH);
    expect(headerTitle(host)).toBe('阅读统计');
    expect(host.querySelector('.stats-period-label')?.textContent).toBe('本周阅读时长');
    expect(host.textContent).not.toContain('Reading stats');
    expect(host.textContent).not.toContain('This weekTime read');
  });

  it('DiscoverPage：中文原文 → EN 出现 Discover → 切回恢复，状态值仍是中文数据键', async () => {
    const { host } = await mount(<DiscoverPage />);
    await waitFor(() => discoverHeading(host) === '发现', 'Discover 页头（中文）');

    // (a) 中文态：页头、分区 Tab、筛选 chip
    expect(discoverHeading(host)).toBe('发现');
    expect(host.textContent).toContain('漫画');
    expect(host.textContent).toContain('小说');
    expect(host.textContent).toContain('原站推荐');

    switchLanguage(AppLanguage.EN);
    await waitFor(() => discoverHeading(host) === 'Discover', 'Discover 页头（英文）');

    // (b) `发现`→Discover、`漫画`→Comic、`小说`→Novel、`原站推荐`→Source picks、`更新`→Updated、`榜单`→Rankings
    expect(discoverHeading(host)).toBe('Discover');
    expect(host.textContent).toContain('Comic');
    expect(host.textContent).toContain('Novel');
    expect(host.textContent).toContain('Source picks');
    expect(host.textContent).toContain('Updated');
    expect(host.textContent).toContain('Rankings');
    expect(host.textContent).not.toContain('原站推荐');
    expect(tr('全部')).toBe('All');

    // (c) 切回中文恢复
    switchLanguage(AppLanguage.ZH);
    await waitFor(() => discoverHeading(host) === '发现', 'Discover 页头（切回中文）');

    expect(host.textContent).toContain('原站推荐');
    expect(host.textContent).not.toContain('Source picks');
  });

  it('SourceManagementPage：根区域名 书源 → EN 变 Sources，导入面板文案跟着变', async () => {
    const { host } = await mount(<SourceManagementPage io={NULL_SOURCE_IO} />);
    await flush();

    // (a) 中文态：页面根区域名 + 导入面板标题
    expect(host.querySelector('.source-mgmt')?.getAttribute('aria-label')).toBe('书源');
    act(() => host.querySelector<HTMLButtonElement>('.source-import-row')?.click());
    expect(host.querySelector('.source-mgmt-modal-title')?.textContent).toBe('导入书源');
    expect(host.textContent).toContain('网络导入书源');

    switchLanguage(AppLanguage.EN);
    await flush();

    // (b) `书源`→Sources（页面根区域名），导入面板标题 `导入书源`→Import source
    expect(host.querySelector('.source-mgmt')?.getAttribute('aria-label')).toBe('Sources');
    // 语言切换会把页面重挂载（与 App 的做法一致），导入面板要重新打开
    act(() => host.querySelector<HTMLButtonElement>('.source-import-row')?.click());
    expect(host.querySelector('.source-mgmt-modal-title')?.textContent).toBe('Import source');
    expect(host.textContent).toContain('Import source from a URL');
    expect(host.textContent).not.toContain('网络导入书源');

    // 第二个选项（粘贴 JSON 配置）打开粘贴面板：标题 `粘贴 JSON 书源配置`→Paste a JSON source config
    const options = host.querySelectorAll<HTMLButtonElement>('.source-mgmt-modal-option');
    act(() => options[1]?.click());
    expect(host.querySelector('.source-mgmt-modal-title')?.textContent).toBe(
      'Paste a JSON source config',
    );

    // (c) 切回中文恢复
    switchLanguage(AppLanguage.ZH);
    await flush();

    expect(host.querySelector('.source-mgmt')?.getAttribute('aria-label')).toBe('书源');
    act(() => host.querySelector<HTMLButtonElement>('.source-import-row')?.click());
    expect(host.querySelector('.source-mgmt-modal-title')?.textContent).toBe('导入书源');
    expect(host.textContent).not.toContain('Import source');
  });

  it('CacheManagementPage：缓存管理 → Cache management → 切回恢复', async () => {
    const { host } = await mount(<CacheManagementPage />);
    await flush();

    // (a) 中文态
    expect(host.querySelector('.cache-sheet__title')?.textContent).toBe('缓存管理');
    expect(host.querySelector('.cache-sheet__close')?.getAttribute('aria-label')).toBe('关闭');

    switchLanguage(AppLanguage.EN);
    await flush();

    // (b) `缓存管理`→Cache management、`关闭`→Close（页面根区域的 aria-label 同步）
    expect(host.querySelector('.cache-sheet__title')?.textContent).toBe('Cache management');
    expect(host.querySelector('.cache-sheet__close')?.getAttribute('aria-label')).toBe('Close');
    expect(host.querySelector('.cache-sheet')?.getAttribute('aria-label')).toBe('Cache management');

    // (c)
    switchLanguage(AppLanguage.ZH);
    await flush();

    expect(host.querySelector('.cache-sheet__title')?.textContent).toBe('缓存管理');
    expect(host.querySelector('.cache-sheet')?.getAttribute('aria-label')).toBe('缓存管理');
  });

  it('DeviceTransferPage：设备互传 → Device transfer → 切回恢复', async () => {
    const { host } = await mount(<DeviceTransferPage nativeAvailable={false} />);
    await flush();

    // (a) 中文态：页头标题 + 页面区域名
    expect(headerTitle(host)).toBe('设备互传');
    expect(host.querySelector('.device-transfer-page')?.getAttribute('aria-label')).toBe('设备互传');

    switchLanguage(AppLanguage.EN);
    await flush();

    // (b) `设备互传`→Device transfer（页头标题与区域名同一词表条目）
    expect(headerTitle(host)).toBe('Device transfer');
    expect(host.querySelector('.device-transfer-page')?.getAttribute('aria-label')).toBe(
      'Device transfer',
    );

    // (c) 切回中文恢复
    switchLanguage(AppLanguage.ZH);
    await flush();

    expect(headerTitle(host)).toBe('设备互传');
    expect(host.querySelector('.device-transfer-page')?.getAttribute('aria-label')).toBe('设备互传');
    expect(host.textContent).not.toContain('Device transfer');
  });
});
