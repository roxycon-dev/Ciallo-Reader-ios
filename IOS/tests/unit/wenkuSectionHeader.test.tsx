/**
 * wenkuSectionHeader.test.tsx — `WenkuSectionHeader` / `WenkuHairline` 的门禁。
 *
 * 权威源：`novel-reader/app/src/main/java/com/example/ui/wenku/WenkuGlass.kt` L733-794
 * （`WenkuSectionHeader`）与 L789-794（`WenkuHairline`）。
 *
 * 覆盖任务书要求的 8 条：
 *   ① `index / latin` 与 `title` 逐字（含 `" / "` 分隔符）
 *   ② 0.5px 细线与 3px 点存在，且 Kotlin 的 10/17px、1.1px 字距、6/8/5px 间距落在 CSS 上
 *   ③ `trailing` 为 null 时无容器、有内容时逐字渲染
 *   ④ 亮/暗两套 `inkSecondary` / `hairline` 取值（`wenkuColors(isDark)` + `WenkuTokens.kt` L235）
 *   ⑤ `prefers-reduced-motion` 下没有揭示动画类
 *   ⑥ `RenderQuality.MINIMAL` 下没有揭示动画类
 *   ⑦ DiscoverPage 两个区块头参数逐字（`01 / DISCOVER / FILTERS`、`01 / BROWSE / CATALOGUE`）
 *   ⑧ 版本记录弹窗 `01 / RELEASE NOTES` 逐字
 *
 * ⑦ 的说明：`BROWSE / CATALOGUE` 在 Kotlin（DiscoverScreen.kt L336-340）里是
 * `if (rows.isEmpty()) sourceProgress() else WenkuSectionHeader(...)`——**有结果才出头**，
 * 而 jsdom 里没有真实书源（fetch 桩返回空），DOM 上拿不到它。因此这一条拆两步：
 * DOM 断言筛选头真的挂上了页面，`BROWSE / CATALOGUE` 用源码字面量断言（同一份 JSX）。
 *
 * 仓库没有 `@testing-library/react`，沿用 tests/unit 既有写法：`react-dom/client` + `act`。
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { bootstrapLibrary } from '@ui/state/appStore';
import { RenderQualityProvider } from '@ui/components/GlassQuality';
import {
  WenkuHairline,
  WenkuSectionHeader,
} from '@ui/components/wenku/WenkuSectionHeader';
import ReleaseHistoryDialog from '@ui/components/ReleaseHistoryDialog';
import { DiscoverPage } from '@ui/pages/DiscoverPage';

/**
 * 本文件要跑 `bootstrapLibrary()`（DiscoverPage 的宿主运行时）。与 `vitest.config.ts` L28-39
 * 记录的同一现象：门禁里 5 个 jsdom 文件并发时，装配 + 首屏 transform 会把 20s 预算吃满，
 * 于是 beforeAll 被判超时、整个 suite 变成「全 skipped」。这里给本文件单独放宽，
 * 与配置里的 `testTimeout/hookTimeout` 语义一致（超时预算，不是逻辑豁免）。
 */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/* ── jsdom 缺件 ── */

/** ⑤ 用：`prefers-reduced-motion` 的匹配值可翻转（`useWenkuReducedMotion` 每次渲染重读）。 */
let reduceMotionMatches = false;

const mediaQueryStub = (query: string): MediaQueryList =>
  ({
    matches: query.includes('prefers-reduced-motion') ? reduceMotionMatches : false,
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

beforeEach(() => {
  reduceMotionMatches = false;
  document.documentElement.removeAttribute('data-theme');
});

afterEach(async () => {
  // 每条用例结束就卸载：`data-theme` 的 MutationObserver 不会把上一条的树重渲染到 act 外。
  while (mounted.length > 0) {
    const entry = mounted.pop();
    if (entry === undefined) break;
    await act(async () => {
      entry.root.unmount();
    });
    entry.host.remove();
  }
  reduceMotionMatches = false;
  document.documentElement.removeAttribute('data-theme');
});

/* ── 渲染骨架 ── */

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
    root.render(node);
  });
  return entry;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error(`等待 ${label} 超时`);
}

afterAll(async () => {
  for (const entry of mounted) {
    await act(async () => {
      entry.root.unmount();
    });
    entry.host.remove();
  }
  mounted.length = 0;
});

const REPO_ROOT = process.cwd();

function sourceText(relative: string): string {
  return readFileSync(path.resolve(REPO_ROOT, relative), 'utf8');
}

function part(host: HTMLElement, selector: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(selector);
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① index / latin / title 逐字
   ══════════════════════════════════════════════════════════════════════════════ */

describe('WenkuSectionHeader（WenkuGlass.kt L733-787）', () => {
  it('① 渲染 "index / latin" 与 title 逐字，title 不再二次 tr()', async () => {
    const { host } = await mount(
      <WenkuSectionHeader index="01" latin="TONAL PALETTE" title="实时预览" />,
    );
    // Kotlin L749 `"$index / $latin"`
    expect(part(host, '.wenku-section-header__meta')?.textContent).toBe('01 / TONAL PALETTE');
    expect(part(host, '.wenku-section-header__title')?.textContent).toBe('实时预览');
    // 组件只渲染传进来的字符串：英文词表值原样上屏（不会被打回中文）
    expect(part(host, '.wenku-section-header__title')?.textContent).not.toBe('Live preview');
    expect(host.textContent).toBe('01 / TONAL PALETTE实时预览');

    const english = await mount(
      <WenkuSectionHeader index="02" latin="CONTENTS" title="Contents" />,
    );
    expect(part(english.host, '.wenku-section-header__title')?.textContent).toBe('Contents');
    expect(part(english.host, '.wenku-section-header__meta')?.textContent).toBe('02 / CONTENTS');
  });

  /* ══════════════════════════════════════════════════════════════════════════
     ② 0.5px 细线 + 3px 点 + Kotlin 的排版数值
     ══════════════════════════════════════════════════════════════════════════ */

  it('② 细线与 3px 点存在，Kotlin 的字号/字距/间距落在 wenku.css 上', async () => {
    const { host } = await mount(
      <WenkuSectionHeader index="01" latin="DISCOVER / FILTERS" title="浏览筛选" />,
    );
    const rule = part(host, '.wenku-section-header__rule');
    const dot = part(host, '.wenku-section-header__dot');
    expect(rule).not.toBeNull();
    expect(dot).not.toBeNull();
    // L758-763：两根 Box 都是纯装饰
    expect(rule?.getAttribute('aria-hidden')).toBe('true');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');

    // 结构：两行（meta 行 + 标题行），顺序与 Kotlin 的两次 Row 一致
    const rows = [...host.querySelectorAll<HTMLElement>('.wenku-section-header > .wenku-section-header__row')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.wenku-section-header__meta')).not.toBeNull();
    expect(rows[0]?.querySelector('.wenku-section-header__rule')).not.toBeNull();
    expect(rows[0]?.querySelector('.wenku-section-header__dot')).not.toBeNull();
    expect(rows[1]?.querySelector('.wenku-section-header__title')).not.toBeNull();

    const css = sourceText('src/styles/wenku.css');
    // L744 `padding(top = 8.dp, bottom = 5.dp)`
    expect(css).toMatch(/\.wenku-section-header \{[^}]*padding: 8px 0 5px;/);
    // L745 `spacedBy(6.dp)`
    expect(css).toMatch(/\.wenku-section-header \{[^}]*gap: 6px;/);
    // L747 / L768 `spacedBy(8.dp)`
    expect(css).toMatch(/\.wenku-section-header__row \{[^}]*gap: 8px;/);
    // L752-755 meta 10.sp / 1.1.sp / Medium
    expect(css).toMatch(/\.wenku-section-header__meta \{[^}]*font-size: 10px;/);
    expect(css).toMatch(/\.wenku-section-header__meta \{[^}]*letter-spacing: 1.1px;/);
    expect(css).toMatch(/\.wenku-section-header__meta \{[^}]*font-weight: 500;/);
    // L759 rule height 0.5.dp
    expect(css).toMatch(/\.wenku-section-header__rule \{[^}]*height: 0.5px;/);
    // L763 dot size 3.dp
    expect(css).toMatch(/\.wenku-section-header__dot \{[^}]*width: 3px;/);
    expect(css).toMatch(/\.wenku-section-header__dot \{[^}]*height: 3px;/);
    // L774-776 title 17.sp / SemiBold
    expect(css).toMatch(/\.wenku-section-header__title \{[^}]*font-size: 17px;/);
    expect(css).toMatch(/\.wenku-section-header__title \{[^}]*font-weight: 600;/);
    // L782 trailing `spacedBy(8.dp)`
    expect(css).toMatch(/\.wenku-section-header__trailing \{[^}]*gap: 8px;/);
  });

  it('②b WenkuHairline（L789-794）整宽 0.5px，颜色随主题', async () => {
    const { host } = await mount(<WenkuHairline />);
    const hairline = part(host, '.wenku-hairline');
    expect(hairline).not.toBeNull();
    expect(hairline?.hasAttribute('data-wenku-hairline')).toBe(true);
    // 亮色：`ink(#161613).copy(alpha = .10f)`；ARGB 里 alpha 量化成 round(.10 * 255) = 25 →
    // 25 / 255 = 0.098（Compose 的 `Color.copy(alpha)` 同样落在 8 位通道上）
    expect(hairline?.style.background).toBe('rgba(22, 22, 19, 0.098)');
    expect(sourceText('src/styles/wenku.css')).toMatch(/\.wenku-hairline \{[^}]*height: 0.5px;/);
  });

  /* ══════════════════════════════════════════════════════════════════════════
     ③ trailing
     ══════════════════════════════════════════════════════════════════════════ */

  it('③ trailing 为 null 时不渲染容器，有内容时逐字渲染', async () => {
    const empty = await mount(<WenkuSectionHeader index="01" latin="SYNOPSIS" title="简介" />);
    expect(part(empty.host, '.wenku-section-header__trailing')).toBeNull();

    const filled = await mount(
      <WenkuSectionHeader
        index="01"
        latin="BROWSE / CATALOGUE"
        title="浏览结果"
        trailing={<button type="button">来源 3 / 5</button>}
      />,
    );
    const trailing = part(filled.host, '.wenku-section-header__trailing');
    expect(trailing).not.toBeNull();
    expect(trailing?.querySelector('button')?.textContent).toBe('来源 3 / 5');
    // L778-784：trailing 与 title 同一行
    expect(trailing?.parentElement?.querySelector('.wenku-section-header__title')?.textContent).toBe(
      '浏览结果',
    );
  });

  /* ══════════════════════════════════════════════════════════════════════════
     ④ 亮 / 暗两套颜色
     ══════════════════════════════════════════════════════════════════════════ */

  it('④ 亮色：inkSecondary / ink / hairline 取 WenkuTokens 亮色分支', async () => {
    const { host } = await mount(<WenkuSectionHeader index="01" latin="LIGHT" title="亮色" />);
    // WenkuTokens.kt L45-47 `InkSecondaryLight #646B62` / `InkLight #161613`
    // （jsdom 把 alpha = 1 的 rgba 归一成 rgb，故不透明的三个断言写 rgb）
    expect(part(host, '.wenku-section-header__meta')?.style.color).toBe('rgb(100, 107, 98)');
    expect(part(host, '.wenku-section-header__dot')?.style.background).toBe('rgb(22, 22, 19)');
    expect(part(host, '.wenku-section-header__title')?.style.color).toBe('rgb(22, 22, 19)');
    // `hairline = ink.copy(alpha = .10f)`（WenkuTokens.kt L235）→ ARGB alpha 25/255
    expect(part(host, '.wenku-section-header__rule')?.style.background).toBe('rgba(22, 22, 19, 0.098)');
    // 字体变量（AppFonts.Default / AppFonts.Serif）
    expect(part(host, '.wenku-section-header__meta')?.style.fontFamily).toBe('var(--font-sans)');
    expect(part(host, '.wenku-section-header__title')?.style.fontFamily).toBe('var(--font-serif)');
  });

  it('④b 暗色：<html data-theme="dark"> 切到 InkSecondaryDark / InkDark / hairline@.14', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { host } = await mount(<WenkuSectionHeader index="01" latin="DARK" title="暗色" />);
    // WenkuTokens.kt L55-56 `InkSecondaryDark #B7B7B7` / `InkDark #F2F2F2`
    expect(part(host, '.wenku-section-header__meta')?.style.color).toBe('rgb(183, 183, 183)');
    expect(part(host, '.wenku-section-header__dot')?.style.background).toBe('rgb(242, 242, 242)');
    // `hairline = ink.copy(alpha = .14f)` → ARGB alpha `(.14 * 255).toInt()` = 35 → 35 / 255 = 0.137…
    expect(part(host, '.wenku-section-header__rule')?.style.background).toBe(
      'rgba(242, 242, 242, 0.137)',
    );
  });

  /* ══════════════════════════════════════════════════════════════════════════
     ⑤ / ⑥ 动画降级
     ══════════════════════════════════════════════════════════════════════════ */

  it('⑤ 默认不播揭示动画（`reveal` 显式开启）；reduced-motion 下即使开启也不播', async () => {
    // 默认关：CSS `animation` 会随页面重渲染重播，元素在动画期间成为合成层，
    // WKWebView renderer 会被反复创建/销毁拖崩（见组件里 `reveal` 的注释）。
    const plain = await mount(<WenkuSectionHeader index="01" latin="MOTION" title="动效" />);
    expect(part(plain.host, '.wenku-section-header')?.className).not.toContain('wenku-section-header--reveal');

    const normal = await mount(<WenkuSectionHeader index="01" latin="MOTION" title="动效" reveal />);
    const normalRoot = part(normal.host, '.wenku-section-header');
    expect(normalRoot?.className).toContain('wenku-section-header--reveal');
    // 揭示窗口由 ENTER_MS = 420 推出来：meta [.08,.68] → 34ms / 252ms
    expect(normalRoot?.style.getPropertyValue('--wenku-sh-meta-delay')).toBe('34ms');
    expect(normalRoot?.style.getPropertyValue('--wenku-sh-meta-duration')).toBe('252ms');
    expect(normalRoot?.style.getPropertyValue('--wenku-sh-title-delay')).toBe('67ms');

    reduceMotionMatches = true;
    const reduced = await mount(<WenkuSectionHeader index="01" latin="MOTION" title="动效" reveal />);
    const reducedRoot = part(reduced.host, '.wenku-section-header');
    expect(reducedRoot?.className).not.toContain('wenku-section-header--reveal');
    // 没有动画类时不注入任何时间轴变量
    expect(reducedRoot?.style.getPropertyValue('--wenku-sh-meta-delay')).toBe('');

    // CSS 侧也必须有 `prefers-reduced-motion` 兜底（类名被别的路径带上时同样退化）
    const css = sourceText('src/styles/wenku.css');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .wenku-section-header--reveal'));
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain('animation: none;');
  });

  it('⑥ 开启 reveal 时：MINIMAL 下没有揭示动画类，HIGH 下有', async () => {
    const minimal = await mount(
      <RenderQualityProvider quality="MINIMAL">
        <WenkuSectionHeader index="01" latin="MINIMAL" title="极简" reveal />
      </RenderQualityProvider>,
    );
    const minimalRoot = part(minimal.host, '.wenku-section-header');
    expect(minimalRoot?.className).not.toContain('wenku-section-header--reveal');
    expect(minimalRoot?.getAttribute('data-render-quality')).toBe('MINIMAL');

    const high = await mount(
      <RenderQualityProvider quality="HIGH">
        <WenkuSectionHeader index="01" latin="HIGH" title="高" reveal />
      </RenderQualityProvider>,
    );
    const highRoot = part(high.host, '.wenku-section-header');
    expect(highRoot?.className).toContain('wenku-section-header--reveal');
    expect(highRoot?.getAttribute('data-render-quality')).toBe('HIGH');

    // 样式表里同样有 `[data-render-quality='MINIMAL']` 的兜底
    expect(sourceText('src/styles/wenku.css')).toContain(
      "[data-render-quality='MINIMAL'] .wenku-section-header--reveal",
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑦ DiscoverPage — DiscoverScreen.kt L296 / L339
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DiscoverPage 接线（DiscoverScreen.kt L296 / L339）', () => {
  it('⑦ 筛选区块头逐字上屏：01 / DISCOVER / FILTERS + 浏览筛选', async () => {
    const { host } = await mount(<DiscoverPage />);
    // Discover 先渲染「正在准备发现…」，runtime 解析完才有筛选卡与区块头。
    await waitFor(() => host.querySelector('.discover-filters') !== null, 'Discover 筛选卡');

    const metas = [...host.querySelectorAll<HTMLElement>('.wenku-section-header__meta')].map(
      (node) => node.textContent,
    );
    expect(metas).toContain('01 / DISCOVER / FILTERS');
    const titles = [...host.querySelectorAll<HTMLElement>('.wenku-section-header__title')].map(
      (node) => node.textContent,
    );
    expect(titles).toContain('浏览筛选');
    // 筛选头紧贴在筛选卡上方（Kotlin L296 的顺序：header 然后 browseControls()）
    const filters = part(host, '.discover-filters');
    expect(filters?.previousElementSibling?.classList.contains('wenku-section-header')).toBe(true);
  });

  it('⑦b 结果区块头：01 / BROWSE / CATALOGUE + 浏览结果 + sourceProgress（源码字面量）', () => {
    // 有结果才渲染（DiscoverScreen.kt L336-340），jsdom 无书源 → 断言 JSX 字面量。
    // 目标文件是 CRLF，先归一化再按行断言。
    const source = sourceText('src/ui/pages/DiscoverPage.tsx').replace(/\r\n/g, '\n');
    expect(source).toContain('latin="BROWSE / CATALOGUE"');
    expect(source).toContain("title={tr('浏览结果')}");
    expect(source).toContain('<WenkuSectionHeader\n        index="01"\n        latin="BROWSE / CATALOGUE"');
    expect(source).toContain('{sourcesOfLabel(participantCount, sources.length)}');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑧ ReleaseHistoryDialog — ReleaseHistoryDialog.kt L114
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ReleaseHistoryDialog 接线（ReleaseHistoryDialog.kt L114）', () => {
  it('⑧ 版本记录区块头逐字：01 / RELEASE NOTES + 版本记录', async () => {
    const { host } = await mount(<ReleaseHistoryDialog onDismiss={() => undefined} />);
    expect(part(host, '.wenku-section-header__meta')?.textContent).toBe('01 / RELEASE NOTES');
    expect(part(host, '.wenku-section-header__title')?.textContent).toBe('版本记录');
    // 旧的三段内联头已经换成共享组件
    expect(part(host, '.release-history__section-header')).toBeNull();
  });
});
