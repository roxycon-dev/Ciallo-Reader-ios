/**
 * loadingHandoffSkeletons.test.tsx — `WenkuLoadingHandoff`（两个版本）/ `WenkuLoadedContentSequence` /
 * `WenkuSkeletonBlock` / `WenkuContentPanel` / 三个骨架屏的门禁。
 *
 * 权威源
 * ─────
 *   `novel-reader/app/src/main/java/com/example/ui/wenku/WenkuLoadingHandoff.kt` L28-77（擦除交接）
 *   `novel-reader/app/src/main/java/com/example/ui/wenku/WenkuMotion.kt` L88-114（内容时钟）
 *   `novel-reader/app/src/main/java/com/example/ui/wenku/WenkuMotion.kt` L567-577（骨架块）
 *   `novel-reader/app/src/main/java/com/example/ui/wenku/WenkuMotion.kt` L581-601（alpha 交接）
 *   `novel-reader/app/src/main/java/com/example/ui/wenku/WenkuGlass.kt` L679-712（内容面板）
 *   `novel-reader/app/src/main/java/com/example/ui/ComicChaptersScreen.kt` L681-697（两个目录骨架）
 *   `novel-reader/app/src/main/java/com/example/library/LibraryScreen.kt` L1169-1186（搜索骨架）
 *
 * 覆盖清单
 * ───────
 *   ① `loaded=false` 时渲染骨架且 `--handoff-p` 为 0
 *   ② `loaded=true` 时 rAF 把 `--handoff-p` 推到 1
 *   ③ reduce-motion 下直接落 1，且不起 rAF
 *   ④ `RenderQuality.MINIMAL` 下直接落 1
 *   ⑤ true→false 立即回骨架
 *   ⑥ 内容层与骨架层的 clip-path 在同一 p 下**上下互补**（百分比之和 = 100）
 *   ⑦ 320 ms 擦除 / 120 ms alpha 时长常量逐值
 *   ⑧ 三个骨架屏的元素个数（1 / 5 / 16）与逐项尺寸
 *   ⑨ `WenkuContentPanel` 渲染 props 对应结构（4px 圆角 / panel@.82 / 0.7px outline@.42 / 16px / role）
 *   ⑩ alpha 版：`contentKey` 变化时内容序列重播（重置）
 *   ⑪ alpha 版：`!loading` 时 `skeletonAlpha` 收敛到 0 并卸载骨架
 *   ⑫ `WenkuSkeletonBlock` 亮/暗两档 alpha（0.0625 / 0.0825）与 4px 圆角
 *
 * 仓库没有 `@testing-library/react`，沿用 tests/unit 既有写法：`react-dom/client` + `act`。
 * rAF 用可手动步进的假时钟，避免真的等 320/420 ms。
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { RenderQualityProvider } from '@ui/components/GlassQuality';
import {
  WENKU_HANDOFF_ERASE_MS,
  WENKU_HANDOFF_FADE_MS,
  WENKU_SKELETON_ALPHA_DARK,
  WENKU_SKELETON_ALPHA_LIGHT,
  WENKU_SKELETON_RADIUS_PX,
  WenkuLoadingHandoff,
  WenkuLoadingHandoffFade,
  WenkuSkeletonBlock,
} from '@ui/components/wenku/WenkuLoadingHandoff';
import { WenkuContentPanel } from '@ui/components/wenku/WenkuContentPanel';
import {
  ComicDirectorySkeleton,
  DirectoryHeadingSkeleton,
} from '@ui/components/comic/ComicChaptersSkeletons';
import { LibrarySearchSkeleton } from '@ui/components/library/LibrarySearchSkeleton';

/* ════════════════════════════════════════════════════════════════════════════
 * jsdom 缺件：matchMedia 与可控 rAF
 * ════════════════════════════════════════════════════════════════════════════ */

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

interface PendingFrame {
  readonly id: number;
  readonly callback: FrameRequestCallback;
}

let pendingFrames: PendingFrame[] = [];
let nextFrameId = 1;
let frameClock = 0;

const rafStub = (callback: FrameRequestCallback): number => {
  const id = nextFrameId;
  nextFrameId += 1;
  pendingFrames.push({ id, callback });
  return id;
};

const cancelRafStub = (id: number): void => {
  pendingFrames = pendingFrames.filter((frame) => frame.id !== id);
};

/**
 * 步进假时钟：每个 delta 对应"合并一次 rAF 批次"。
 * 第一次给 0 时只记录起始时间（`startedAt`），后续 delta 累加。
 */
function runFrames(deltas: readonly number[]): void {
  for (const delta of deltas) {
    const batch = pendingFrames;
    pendingFrames = [];
    frameClock += delta;
    const now = frameClock;
    act(() => {
      for (const frame of batch) frame.callback(now);
    });
  }
}

beforeAll(() => {
  vi.stubGlobal('matchMedia', mediaQueryStub);
  vi.stubGlobal('requestAnimationFrame', rafStub);
  vi.stubGlobal('cancelAnimationFrame', cancelRafStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

/* ════════════════════════════════════════════════════════════════════════════
 * 渲染骨架
 * ════════════════════════════════════════════════════════════════════════════ */

interface Mounted {
  readonly host: HTMLDivElement;
  readonly root: Root;
}

const mounted: Mounted[] = [];

function mount(element: ReactElement, quality: 'HIGH' | 'MINIMAL' = 'HIGH'): Mounted {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<RenderQualityProvider quality={quality}>{element}</RenderQualityProvider>);
  });
  const entry: Mounted = { host, root };
  mounted.push(entry);
  return entry;
}

function rerender(entry: Mounted, element: ReactElement, quality: 'HIGH' | 'MINIMAL' = 'HIGH'): void {
  act(() => {
    entry.root.render(<RenderQualityProvider quality={quality}>{element}</RenderQualityProvider>);
  });
}

function progressOf(host: HTMLElement): number {
  const root = host.querySelector('[data-wenku-handoff="erase"]');
  if (!(root instanceof HTMLElement)) throw new Error('handoff root missing');
  return Number(root.style.getPropertyValue('--handoff-p'));
}

function handoffRoot(host: HTMLElement): HTMLElement {
  const root = host.querySelector('[data-wenku-handoff="erase"]');
  if (!(root instanceof HTMLElement)) throw new Error('handoff root missing');
  return root;
}

function layer(host: HTMLElement, name: 'content' | 'skeleton'): HTMLElement | null {
  const node = host.querySelector(`[data-handoff-layer="${name}"]`);
  return node instanceof HTMLElement ? node : null;
}

const REPO_ROOT = process.cwd();
function sourceText(relative: string): string {
  return readFileSync(path.resolve(REPO_ROOT, relative), 'utf8');
}

beforeEach(() => {
  reduceMotionMatches = false;
  pendingFrames = [];
  nextFrameId = 1;
  frameClock = 0;
  document.documentElement.removeAttribute('data-theme');
});

afterEach(async () => {
  while (mounted.length > 0) {
    const entry = mounted.pop();
    if (entry === undefined) break;
    await act(async () => {
      entry.root.unmount();
    });
    entry.host.remove();
  }
  pendingFrames = [];
  document.documentElement.removeAttribute('data-theme');
});

/* ════════════════════════════════════════════════════════════════════════════
 * ① - ⑤ 擦除交接
 * ════════════════════════════════════════════════════════════════════════════ */

describe('WenkuLoadingHandoff（擦除交接，WenkuLoadingHandoff.kt L28-77）', () => {
  it('① loaded=false 时渲染骨架，且 --handoff-p 停在 0', () => {
    const entry = mount(
      <WenkuLoadingHandoff loaded={false} skeleton={<div data-testid="sk" />}>
        <div data-testid="ct" />
      </WenkuLoadingHandoff>,
    );

    expect(progressOf(entry.host)).toBe(0);
    expect(layer(entry.host, 'skeleton')).not.toBeNull();
    expect(entry.host.querySelector('[data-testid="sk"]')).not.toBeNull();
    // 内容层始终在（高度由它决定），只是被裁到 0 高。
    expect(layer(entry.host, 'content')).not.toBeNull();
    expect(entry.host.querySelector('[data-testid="ct"]')).not.toBeNull();
    // Kotlin `!loaded → snapTo(0)`：没有时钟要跑。
    expect(pendingFrames).toHaveLength(0);
  });

  it('② loaded=true 时 rAF 逐帧推进 --handoff-p，直到 1', () => {
    const entry = mount(
      <WenkuLoadingHandoff loaded skeleton={<div />}>
        <div />
      </WenkuLoadingHandoff>,
    );

    expect(progressOf(entry.host)).toBe(0);
    expect(pendingFrames).toHaveLength(1);

    runFrames([0]);
    expect(progressOf(entry.host)).toBe(0);

    runFrames([WENKU_HANDOFF_ERASE_MS / 2]);
    const mid = progressOf(entry.host);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // 骨架还在：`showSkeleton = progress.value < 1f`（Kotlin L37）
    expect(layer(entry.host, 'skeleton')).not.toBeNull();

    runFrames([WENKU_HANDOFF_ERASE_MS]);
    expect(progressOf(entry.host)).toBe(1);
    expect(layer(entry.host, 'skeleton')).toBeNull();
    expect(pendingFrames).toHaveLength(0);
  });

  it('③ reduce-motion 下直接落终点 1，且不起 rAF', () => {
    reduceMotionMatches = true;
    const entry = mount(
      <WenkuLoadingHandoff loaded skeleton={<div data-testid="sk" />}>
        <div />
      </WenkuLoadingHandoff>,
    );

    expect(progressOf(entry.host)).toBe(1);
    expect(layer(entry.host, 'skeleton')).toBeNull();
    expect(pendingFrames).toHaveLength(0);
  });

  it('④ RenderQuality.MINIMAL 下直接落终点 1', () => {
    const entry = mount(
      <WenkuLoadingHandoff loaded skeleton={<div data-testid="sk" />}>
        <div />
      </WenkuLoadingHandoff>,
      'MINIMAL',
    );

    expect(progressOf(entry.host)).toBe(1);
    expect(layer(entry.host, 'skeleton')).toBeNull();
    expect(pendingFrames).toHaveLength(0);
    expect(handoffRoot(entry.host).getAttribute('data-handoff-loaded')).toBe('true');
  });

  it('⑤ loaded 由 true 变 false 时立即回到骨架', () => {
    const entry = mount(
      <WenkuLoadingHandoff loaded skeleton={<div />}>
        <div />
      </WenkuLoadingHandoff>,
    );
    runFrames([0, WENKU_HANDOFF_ERASE_MS * 2]);
    expect(progressOf(entry.host)).toBe(1);
    expect(layer(entry.host, 'skeleton')).toBeNull();

    rerender(
      entry,
      <WenkuLoadingHandoff loaded={false} skeleton={<div data-testid="sk" />}>
        <div />
      </WenkuLoadingHandoff>,
    );

    expect(progressOf(entry.host)).toBe(0);
    expect(layer(entry.host, 'skeleton')).not.toBeNull();
    expect(entry.host.querySelector('[data-testid="sk"]')).not.toBeNull();
    expect(handoffRoot(entry.host).getAttribute('data-handoff-loaded')).toBe('false');
  });

  it('⑥ 内容层与骨架层的 clip-path 在同一 p 下互补，且与 wenku.css 声明一致', () => {
    const entry = mount(
      <WenkuLoadingHandoff loaded skeleton={<div />}>
        <div />
      </WenkuLoadingHandoff>,
    );
    runFrames([0, WENKU_HANDOFF_ERASE_MS / 2]);

    const p = progressOf(entry.host);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);

    const content = layer(entry.host, 'content');
    const skeleton = layer(entry.host, 'skeleton');
    expect(content).not.toBeNull();
    expect(skeleton).not.toBeNull();
    if (content === null || skeleton === null) return;

    const contentClip = content.style.clipPath;
    const skeletonClip = skeleton.style.clipPath;
    // 两层都只吃同一个 CSS 变量（`--handoff-p` 由容器继承下来）。
    expect(contentClip).toContain('var(--handoff-p)');
    expect(skeletonClip).toContain('var(--handoff-p)');

    // `inset(0 0 calc(100% - p*100%) 0)`：底部裁掉 (1-p)，即内容只画 [0, p]
    const contentBottom = 100 - p * 100;
    // `inset(calc(p*100%) 0 0 0)`：顶部裁掉 p，即骨架只画 [p, 1]
    const skeletonTop = p * 100;
    expect(Number((contentBottom + skeletonTop).toFixed(6))).toBe(100);

    // 源码级交叉校验：wenku.css 里必须同时有这两条互补规则
    const css = sourceText('src/styles/wenku.css');
    expect(css).toContain(
      'clip-path: inset(0 0 calc(100% - var(--handoff-p, 0) * 100%) 0);',
    );
    expect(css).toContain('clip-path: inset(calc(var(--handoff-p, 0) * 100%) 0 0 0);');
  });

  it('⑦ 时长常量逐值对齐（擦除 320ms / alpha 120ms）', () => {
    expect(WENKU_HANDOFF_ERASE_MS).toBe(320);
    expect(WENKU_HANDOFF_FADE_MS).toBe(120);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * ⑩ ⑪ alpha 交接
 * ════════════════════════════════════════════════════════════════════════════ */

describe('WenkuLoadingHandoffFade（alpha 交接，WenkuMotion.kt L581-601）', () => {
  it('⑪ !loading 时 skeletonAlpha 收敛到 0，骨架随之卸载', () => {
    const entry = mount(
      <WenkuLoadingHandoffFade loading contentKey="a" skeleton={<div data-testid="sk" />}>
        <div data-testid="ct" />
      </WenkuLoadingHandoffFade>,
    );

    let skeleton = entry.host.querySelector('[data-handoff-layer="skeleton"]');
    expect(skeleton).not.toBeNull();
    expect((skeleton as HTMLElement).style.opacity).toBe('1');

    rerender(
      entry,
      <WenkuLoadingHandoffFade loading={false} contentKey="a" skeleton={<div data-testid="sk" />}>
        <div data-testid="ct" />
      </WenkuLoadingHandoffFade>,
    );

    // 第一帧 t=0：alpha 仍是 1（`animateFloatAsState` 从当前值起跑）
    runFrames([0]);
    skeleton = entry.host.querySelector('[data-handoff-layer="skeleton"]');
    expect((skeleton as HTMLElement).style.opacity).toBe('1');

    // 半程：0 < alpha < 1
    runFrames([WENKU_HANDOFF_FADE_MS / 2]);
    skeleton = entry.host.querySelector('[data-handoff-layer="skeleton"]');
    const mid = Number((skeleton as HTMLElement).style.opacity);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);

    // 收尾：alpha → 0，`skeletonVisible = alpha > 0.01f` 为假，整层卸载
    runFrames([WENKU_HANDOFF_FADE_MS]);
    expect(entry.host.querySelector('[data-handoff-layer="skeleton"]')).toBeNull();
    expect(entry.host.querySelector('[data-testid="ct"]')).not.toBeNull();
  });

  it('⑩ contentKey 变化时内容入场序列重播（reset → 再次推进到 1）', () => {
    const entry = mount(
      <WenkuLoadingHandoffFade loading={false} contentKey="a" skeleton={<div />}>
        <div />
      </WenkuLoadingHandoffFade>,
    );

    runFrames([0, 420]);
    const seq = (): number => {
      const node = entry.host.querySelector('[data-wenku-seq]');
      if (!(node instanceof HTMLElement)) throw new Error('sequence host missing');
      return Number(node.getAttribute('data-wenku-seq'));
    };
    expect(seq()).toBe(1);

    rerender(
      entry,
      <WenkuLoadingHandoffFade loading={false} contentKey="b" skeleton={<div />}>
        <div />
      </WenkuLoadingHandoffFade>,
    );
    // Kotlin `LaunchedEffect(contentKey, …)` → `snapTo(0f)`：首帧就归零
    runFrames([0]);
    expect(seq()).toBe(0);
    expect(pendingFrames.length).toBeGreaterThan(0);

    runFrames([420]);
    expect(seq()).toBe(1);
  });

  it('⑩b 相同内容（值相等）的 contentKey 不重播 —— 对齐 Compose `equals` 语义', () => {
    const entry = mount(
      <WenkuLoadingHandoffFade loading={false} contentKey={['src', 'kw', true]} skeleton={<div />}>
        <div />
      </WenkuLoadingHandoffFade>,
    );
    runFrames([0, 420]);

    rerender(
      entry,
      <WenkuLoadingHandoffFade loading={false} contentKey={['src', 'kw', true]} skeleton={<div />}>
        <div />
      </WenkuLoadingHandoffFade>,
    );
    const node = entry.host.querySelector('[data-wenku-seq]');
    expect(Number((node as HTMLElement).getAttribute('data-wenku-seq'))).toBe(1);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * ⑧ 三个骨架屏
 * ════════════════════════════════════════════════════════════════════════════ */

describe('三个骨架屏（Kotlin L681-697 / L1169-1186）', () => {
  it('⑧a DirectoryHeadingSkeleton：32px 高容器里 1 个 36% × 14px 的块', () => {
    const entry = mount(<DirectoryHeadingSkeleton />);
    const wrapper = entry.host.querySelector('[data-cc-skeleton="heading"]');
    expect(wrapper).not.toBeNull();
    expect(entry.host.querySelectorAll('[data-wenku-skeleton]')).toHaveLength(1);
    const bar = entry.host.querySelector('[data-wenku-skeleton]');
    expect((bar as HTMLElement).className).toContain('cc-skel-heading__bar');
  });

  it('⑧b ComicDirectorySkeleton：标题骨架 + 4 条 56px 块 = 5 个骨架块', () => {
    const entry = mount(<ComicDirectorySkeleton />);
    const blocks = entry.host.querySelectorAll('[data-wenku-skeleton]');
    expect(blocks).toHaveLength(5);
    const rows = entry.host.querySelectorAll('.cc-skel-directory__row');
    expect(rows).toHaveLength(4);
    expect(entry.host.querySelector('[data-cc-skeleton="heading"]')).not.toBeNull();
    // 16 + 32 + 4×56 + 5×8 的间距由 CSS 给；这里断言 CSS 真的声明了这些数值
    const css = sourceText('src/styles/comicChrome.css');
    expect(css).toContain('.cc-skel-directory {');
    expect(css).toContain('gap: 8px; /* L692 `spacedBy(8.dp)` */');
    expect(css).toContain('padding-top: 16px; /* L691 `padding(top = 16.dp)` */');
    expect(css).toContain('height: 56px; /* L695 `height(56.dp)` */');
    expect(css).toContain('height: 32px; /* L683 `height(32.dp)` */');
    expect(css).toContain('width: 36%; /* L684 `fillMaxWidth(.36f)` */');
    expect(css).toContain('height: 14px; /* L684 `height(14.dp)` */');
  });

  it('⑧c LibrarySearchSkeleton：4 组 × (封面 + 3 行文本) = 16 个骨架块', () => {
    const entry = mount(<LibrarySearchSkeleton />);
    expect(entry.host.querySelectorAll('[data-wenku-skeleton]')).toHaveLength(16);
    expect(entry.host.querySelectorAll('.lib-search-skel__row')).toHaveLength(4);
    expect(entry.host.querySelectorAll('.lib-search-skel__cover')).toHaveLength(4);
    expect(entry.host.querySelectorAll('.lib-search-skel__title')).toHaveLength(4);
    expect(entry.host.querySelectorAll('.lib-search-skel__source')).toHaveLength(4);
    expect(entry.host.querySelectorAll('.lib-search-skel__meta')).toHaveLength(4);

    const css = sourceText('src/styles/library.css');
    expect(css).toContain('gap: 16px; /* L1173 `spacedBy(16.dp)` */');
    expect(css).toContain('padding: 8px 20px; /* L1172 `padding(horizontal = 20.dp, vertical = 8.dp)` */');
    expect(css).toContain('width: 66px; /* L1177 `size(66.dp, 96.dp)` */');
    expect(css).toContain('height: 96px;');
    expect(css).toContain('width: 72%; /* L1179 `fillMaxWidth(.72f)` */');
    expect(css).toContain('width: 43%; /* L1180 `fillMaxWidth(.43f)` */');
    expect(css).toContain('width: 85%; /* L1181 `fillMaxWidth(.85f)` */');
    expect(css).toContain('gap: 10px; /* L1178 `spacedBy(10.dp)` */');
    expect(css).toContain('padding-top: 10px; /* L1178 `padding(top = 10.dp)` */');
  });

  it('⑫ WenkuSkeletonBlock：亮 .0625 / 暗 .0825 两档 alpha，圆角 4px，且纯静态', async () => {
    expect(WENKU_SKELETON_ALPHA_LIGHT).toBe(0.0625);
    expect(WENKU_SKELETON_ALPHA_DARK).toBe(0.0825);
    expect(WENKU_SKELETON_RADIUS_PX).toBe(4);

    const entry = mount(<WenkuSkeletonBlock />);
    const block = entry.host.querySelector('[data-wenku-skeleton]');
    if (!(block instanceof HTMLElement)) throw new Error('skeleton block missing');
    expect(block.getAttribute('data-wenku-skeleton-alpha')).toBe('0.0625');
    expect(block.style.borderRadius).toBe('4px');
    // jsdom 的 cssstyle 会把 alpha 归一到 3 位小数（0.0625 → 0.063），通道值不变
    expect(block.style.background).toContain('22, 22, 19');

    // `useDocumentDark` 订阅 `<html data-theme>`（`App.tsx` 写的同一个属性）
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    expect(block.getAttribute('data-wenku-skeleton-alpha')).toBe('0.0825');
    expect(block.style.background).toContain('242, 242, 242');
    await act(async () => {
      document.documentElement.removeAttribute('data-theme');
    });

    // Kotlin L567-568「纯静态占位（无 shimmer / 无重复 ticker / 无滤镜）」
    const wenkuCss = sourceText('src/styles/wenku.css');
    const skeletonSection = wenkuCss.slice(wenkuCss.indexOf('.wenku-skeleton-block {'));
    expect(skeletonSection.slice(0, 120)).not.toContain('animation');
    const comicCss = sourceText('src/styles/comicChrome.css');
    expect(comicCss).not.toContain('@keyframes cc-skel');
    const libraryCss = sourceText('src/styles/library.css');
    expect(libraryCss).not.toContain('@keyframes lib-search-skel');
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * ⑨ 内容面板
 * ════════════════════════════════════════════════════════════════════════════ */

describe('WenkuContentPanel（WenkuGlass.kt L679-712）', () => {
  it('⑨ 默认分支：4px 圆角 / panel@.82 底 / 0.7px outline@.42 / 16px 内边距 / 无交互', () => {
    const entry = mount(
      <WenkuContentPanel>
        <span data-testid="body">body</span>
      </WenkuContentPanel>,
    );
    const panel = entry.host.querySelector('[data-wenku-content-panel]');
    expect(panel).not.toBeNull();
    if (!(panel instanceof HTMLElement)) return;

    expect(panel.style.padding).toBe('16px');
    expect(panel.style.background).toContain('0.82');
    expect(panel.style.border).toContain('0.7px');
    expect(panel.style.border).toContain('0.42');
    expect(panel.getAttribute('role')).toBeNull();
    expect(panel.className).not.toContain('wenku-content-panel--interactive');
    expect(entry.host.querySelector('[data-testid="body"]')).not.toBeNull();

    const css = sourceText('src/styles/wenku.css');
    expect(css).toContain('.wenku-content-panel {');
    expect(css).toContain('border-radius: 4px; /* WenkuTokens.PanelRadius */');
    expect(css).toContain('transform: scale(var(--wenku-panel-press, 0.975));');
  });

  it('⑨b onClick 分支：role=button / tabIndex=0 / 可交互类，点击回调生效', () => {
    const clicks: number[] = [];
    const entry = mount(
      <WenkuContentPanel
        contentPadding={12}
        onClick={() => {
          clicks.push(1);
        }}
      >
        <span>body</span>
      </WenkuContentPanel>,
    );
    const panel = entry.host.querySelector('[data-wenku-content-panel]');
    if (!(panel instanceof HTMLElement)) throw new Error('panel missing');

    expect(panel.getAttribute('role')).toBe('button');
    expect(panel.tabIndex).toBe(0);
    expect(panel.className).toContain('wenku-content-panel--interactive');
    expect(panel.style.padding).toBe('12px');

    act(() => {
      panel.click();
    });
    expect(clicks).toHaveLength(1);
  });

  it('⑨c highContrast 走不透明 panel（Kotlin L700 的另一支）', () => {
    const entry = mount(
      <WenkuContentPanel highContrast>
        <span>body</span>
      </WenkuContentPanel>,
    );
    const panel = entry.host.querySelector('[data-wenku-content-panel]');
    if (!(panel instanceof HTMLElement)) throw new Error('panel missing');
    expect(panel.style.background).not.toContain('0.82');
    expect(panel.style.background).toContain('253');
  });
});
