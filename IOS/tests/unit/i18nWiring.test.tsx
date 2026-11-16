/**
 * i18nWiring.test.tsx — 第一批量界面语言接线的回归测试。
 *
 * 权威源：`novel-reader/app/src/main/java/com/example/ui/SettingsTabScreen.kt` L1049–1090
 * （`item(key = "language_section")` + `item(key = "language_card")`）与
 * `com/example/i18n/Strings.kt`（`AppLocale.language` / `tr()`）。
 *
 * 覆盖任务书要求的四条：
 *   (a) 设置页出现「界面语言」区块与 `中文` / `English` 两个选项；
 *   (b) 点 English 后 `useAppStore.getState().appLanguage === 'en'`、`getAppLanguage() === 'en'`，
 *       界面出现词表里的英文（`Settings` / `Library` / `App language` …）；
 *   (c) 再点 `Chinese` 能切回中文；
 *   (d) `<html lang>` 跟着 `en` / `zh-CN` 变（`App.tsx` 的 lang effect）。
 *
 * 仓库没有 `@testing-library/react`，沿用 tests/unit 既有写法：`react-dom/client` + `act`。
 * 全程 jsdom + 内存 SQLite（`@platform/web-mock`），不联网。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AppLanguage, getAppLanguage, setAppLanguage, tr } from '@core/i18n';
import { bootstrapLibrary, useAppStore } from '@ui/state/appStore';
// `src/App.tsx` 在 `@ui/` 之外（alias 只覆盖 `src/ui`），与既有测试一样走相对路径。
import { App } from '../../src/App';

/**
 * `bootstrapLibrary()` 会从 `public/` 取 13 个只读书源资源（`/js_safety/acorn.js` 等）。
 * jsdom 的 `fetch` 不接受相对 URL，所以这里把全局 fetch 换成**只回 200 空脚本**的桩：
 * 资源内容只在真正调用 JS 书源时才会被解析，本测试只关心语言接线，不联网。
 */
const realFetch = globalThis.fetch;

beforeAll(async () => {
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
  // 生产入口是 `main.tsx` 的 `<StartupGate><App /></StartupGate>`：`bootstrapLibrary()`
  // 先把书架、书源运行时和设置水合完，`App` 才会挂载（`createSourceManagementIo()`
  // 依赖 `getLibraryRuntime().sourceManager`）。这里照同样的顺序先水合再挂载。
  await bootstrapLibrary();
});

afterAll(() => {
  vi.stubGlobal('fetch', realFetch);
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

interface Mounted {
  readonly host: HTMLDivElement;
  readonly root: Root;
}

const mounted: Mounted[] = [];

/**
 * 挂载并把挂载期 effect 里的异步 setState（设置项读取、版本号读取）一并冲干净，
 * 否则 jsdom 控制台会刷 `not wrapped in act(...)` 警告。
 */
async function mount(node: React.ReactNode): Promise<Mounted> {
  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  const entry: Mounted = { host, root };
  mounted.push(entry);
  await act(async () => {
    root.render(node);
  });
  return entry;
}

/**
 * 找到 label 恰好等于 `label` 的分段选项按钮。
 *
 * 2026-11 接线：设置页的分段选择器从页面内联副本（`.settings-segmented__option`）换成了
 * `@ui/components/SettingsControls` 的移植版（`.settings-pill__option`，Kotlin
 * `SettingsControls.kt:81 SegmentedPillSelector`）。两个类名都认，用例只关心「哪个 label 可点」。
 */
function segmentedOption(host: HTMLElement, label: string): HTMLButtonElement {
  const buttons = [
    ...host.querySelectorAll<HTMLButtonElement>(
      '.settings-pill__option, .settings-segmented__option',
    ),
  ];
  const hit = buttons.find((button) => (button.textContent ?? '').trim() === label);
  if (hit === undefined) {
    throw new Error(
      `segmented option "${label}" not found; got: ${buttons
        .map((button) => (button.textContent ?? '').trim())
        .join(' | ')}`,
    );
  }
  return hit;
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  setAppLanguage(AppLanguage.ZH);
  document.documentElement.lang = '';
  useAppStore.setState({
    route: 'main',
    activeTab: 'settings',
    appLanguage: AppLanguage.ZH,
  });
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.host.remove();
  }
  setAppLanguage(AppLanguage.ZH);
  document.documentElement.lang = '';
});

describe('界面语言接线 — SettingsPage / App / 底栏', () => {
  it('(a) 设置页有「界面语言」区块与 中文 / English 两个选项', async () => {
    const { host } = await mount(<App />);

    // 区块标题（SettingsSectionHeader + 卡片内标题各一次）
    expect(host.textContent).toContain('界面语言');
    // 说明文案
    expect(host.textContent).toContain('切换后立即生效，无需重启。');
    // 两个选项：0 → 中文，1 → English（与 Kotlin `listOf(0 to …, 1 to "English")` 一致）
    expect(segmentedOption(host, '中文').tagName).toBe('BUTTON');
    expect(segmentedOption(host, 'English').tagName).toBe('BUTTON');
    // 默认中文 → 选中项是 0（第一个）
    expect(segmentedOption(host, '中文').className).toMatch(
      /settings-(pill|segmented)__option--active/,
    );
    expect(useAppStore.getState().appLanguage).toBe('zh');
  });

  it('(b)(c)(d) 切 English 立即生效并改写 <html lang>，再切回中文', async () => {
    const { host } = await mount(<App />);

    // 中文态：底栏 / 页头是中文
    expect(host.textContent).toContain('书库');
    expect(host.textContent).toContain('设置');
    expect(document.documentElement.lang).toBe('zh-CN');

    click(segmentedOption(host, 'English'));

    // store + core 单例 + <html lang> 三者同步
    expect(useAppStore.getState().appLanguage).toBe('en');
    expect(getAppLanguage()).toBe(AppLanguage.EN);
    expect(document.documentElement.lang).toBe('en');

    // 界面真的换成英文：页头 `设置`→`Settings`、底栏 `书库`→`Library`、
    // 语言卡片 `界面语言`→`App language`
    expect(host.textContent).toContain('Settings');
    expect(host.textContent).toContain('Library');
    expect(host.textContent).toContain('App language');
    expect(host.textContent).toContain('Applies instantly. No restart needed.');
    expect(host.textContent).not.toContain('界面语言');
    // 中文项在英文界面下显示词表值 `Chinese`
    expect(segmentedOption(host, 'Chinese').tagName).toBe('BUTTON');

    // 切回中文
    click(segmentedOption(host, 'Chinese'));

    expect(useAppStore.getState().appLanguage).toBe('zh');
    expect(getAppLanguage()).toBe(AppLanguage.ZH);
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(host.textContent).toContain('界面语言');
    expect(host.textContent).toContain('书库');
    expect(host.textContent).not.toContain('App language');
  });

  it('底栏与 TabShell 的标签来自 TAB_ITEMS 的渲染期 tr()，core 常量本身不被改写', async () => {
    const { TAB_ITEMS } = await import('@core/app/navigation');
    expect(TAB_ITEMS.map((item) => item.label)).toEqual(['书库', '发现', '书架', '统计', '设置']);

    const { host } = await mount(<App />);
    click(segmentedOption(host, 'English'));

    const labels = [...host.querySelectorAll('.app-tabbar-label')].map((node) =>
      (node.textContent ?? '').trim(),
    );
    expect(labels).toEqual(['Library', 'Discover', 'Shelf', 'Stats', 'Settings']);
    // 词表回归：`tr` 在英文态确实命中
    expect(tr('书库')).toBe('Library');
  });
});
