/**
 * diagnosticsGlassWindowWiring.test.tsx — 三项「只差接线」缺口的接线门禁。
 *
 * ① 设置页挂上 `StartupDiagnosticsExportButton`（Kotlin `SettingsTabScreen.kt` L1038）
 * ② 点按钮 → 走导出端口：文件名 L46 模板 + 报告写进目标
 * ③ 写盘失败 → Kotlin L38「无法保存诊断日志，请重新选择保存位置」+ `record("diagnostic-export")`
 * ④ `reader.css` 的 `.rd-sheet--settings` 接的是 **`ReadingSettingsPanel.kt` L72-80** 的
 *    容器参数（数值源：`src/core/reader/readingSettingsPanel.ts`）—— 不是 `ReadingGlass`
 * ⑤ 这个面板在 Kotlin 里**没有**画质档分支，端口不得自造 `[data-render-quality]` 规则
 * ⑥ `ReaderChapterWindow` 只装当前章 ±1（`ReaderChapterWindow.kt` L21-25）
 * ⑦ 越过窗口边界只拉新分片，合并章按物理顺序拼接（L26-38）
 *
 * 渲染骨架沿用 tests/unit 既有写法（`react-dom/client` + `act`，仓库没有
 * `@testing-library/react`）；设置页的 jsdom 缺件与 `orphanComponentWiring.test.tsx` 一致。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@ui/toast', () => ({ showToast: vi.fn(), hideToast: vi.fn(), Toast: () => null }));

import {
  READING_SETTINGS_BLUR_PX,
  READING_SETTINGS_BORDER_ALPHA,
  READING_SETTINGS_BORDER_WIDTH_PX,
  READING_SETTINGS_RADIUS_PX,
  READING_SETTINGS_SCRIM_ALPHA,
  READING_SETTINGS_SHEEN_ALPHA,
  READING_SETTINGS_SHADOW,
  READING_SETTINGS_TINT_ALPHA,
} from '@core/reader/readingSettingsPanel';
import type { ChapterRow } from '@core/library/bookTypes';
import {
  loadChapterWindowAround,
  loadedChapterIndices,
} from '@ui/pages/ReaderPage';
import {
  SettingsPage,
  type SettingsDiagnosticsExportIo,
} from '@ui/pages/SettingsPage';
import { showToast } from '@ui/toast';

// React 19 要求显式声明 act 环境
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

/* ══════════════════════════════════════════════════════════════════════════════
   jsdom 缺件（设置页会读 matchMedia / rAF，bootstrap 会走 fetch）
   ══════════════════════════════════════════════════════════════════════════════ */

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
  await Promise.resolve();
});

afterAll(() => {
  vi.stubGlobal('fetch', realFetch);
  vi.unstubAllGlobals();
});

/* ══════════════════════════════════════════════════════════════════════════════
   渲染骨架
   ══════════════════════════════════════════════════════════════════════════════ */

interface Mounted {
  readonly root: Root;
  readonly host: HTMLDivElement;
}

const mounted: Mounted[] = [];

async function mount(node: ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  mounted.push({ root, host });
  return host;
}

/** 冲掉挂载期 effect 里的异步 setState（版本号读取 / 隐私服务 ready）。 */
async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  });
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => {
      entry.root.unmount();
    });
    entry.host.remove();
  }
  vi.mocked(showToast).mockClear();
});

beforeEach(() => {
  vi.mocked(showToast).mockClear();
});

/* ══════════════════════════════════════════════════════════════════════════════
   ① ② ③ 设置页 → StartupDiagnosticsExportButton（Kotlin L1038 / L24-57）
   ══════════════════════════════════════════════════════════════════════════════ */

const EXPORT_STAMP = 1_700_000_000_000;

function exportPorts(overrides: Partial<SettingsDiagnosticsExportIo> = {}): SettingsDiagnosticsExportIo {
  return {
    now: () => EXPORT_STAMP,
    readReport: vi.fn(async () => 'Ciallo Reader 启动诊断报告\n'),
    recordFailure: vi.fn(async () => undefined),
    openPicker: vi.fn(async (fileName: string) => `target:${fileName}`),
    writeTarget: vi.fn(async () => undefined),
    ...overrides,
  };
}

function exportButton(host: HTMLElement): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>('[data-testid="export_startup_diagnostics_button"]');
  if (found === null) throw new Error('export_startup_diagnostics_button 未渲染');
  return found;
}

describe('StartupDiagnosticsExportButton 接线（SettingsTabScreen.kt L1038）', () => {
  it('① 设置页渲染出 export_startup_diagnostics_button，文案逐字 "导出启动诊断"', async () => {
    const host = await mount(<SettingsPage diagnosticsExportIo={exportPorts()} />);
    await settle();

    const button = exportButton(host);
    expect(button.tagName).toBe('BUTTON');
    expect((button.textContent ?? '').trim()).toBe('导出启动诊断');
    expect(button.querySelector('.app-button__icon')).not.toBeNull();
  });

  it('② 点击 → 保存面板拿到 L46 文件名，报告写进该目标', async () => {
    const ports = exportPorts();
    const host = await mount(<SettingsPage diagnosticsExportIo={ports} />);
    await settle();

    await act(async () => {
      exportButton(host).click();
    });
    await settle();

    expect(ports.openPicker).toHaveBeenCalledTimes(1);
    const fileName = vi.mocked(ports.openPicker).mock.calls[0]?.[0] ?? '';
    expect(fileName).toMatch(/^Ciallo-Reader-diagnostic-.+-1700000000000\.txt$/);
    expect(ports.readReport).toHaveBeenCalledTimes(1);
    expect(ports.writeTarget).toHaveBeenCalledWith(`target:${fileName}`, 'Ciallo Reader 启动诊断报告\n');
    expect(ports.recordFailure).not.toHaveBeenCalled();
    expect(vi.mocked(showToast)).toHaveBeenCalledWith('诊断日志已保存');
  });

  it('③ 写盘失败 → 弹 L38 错误文案，并把 diagnostic-export 记进面包屑', async () => {
    const ports = exportPorts({
      readReport: vi.fn(async () => {
        throw new Error('No output stream');
      }),
    });
    const host = await mount(<SettingsPage diagnosticsExportIo={ports} />);
    await settle();

    await act(async () => {
      exportButton(host).click();
    });
    await settle();

    expect(vi.mocked(showToast)).toHaveBeenCalledWith('无法保存诊断日志，请重新选择保存位置');
    expect(ports.recordFailure).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ports.recordFailure).mock.calls[0]?.[0]).toBe('diagnostic-export');
    // Kotlin L39 `finally { exporting = false }` —— 失败后按钮必须重新可点。
    expect(exportButton(host).disabled).toBe(false);
  });

  it('③b 保存面板打不开 → 「无法打开文件保存窗口」+ diagnostic-picker', async () => {
    const ports = exportPorts({
      openPicker: vi.fn(async () => {
        throw new Error('SHARE_UNAVAILABLE');
      }),
    });
    const host = await mount(<SettingsPage diagnosticsExportIo={ports} />);
    await settle();

    await act(async () => {
      exportButton(host).click();
    });
    await settle();

    expect(vi.mocked(showToast)).toHaveBeenCalledWith('无法打开文件保存窗口');
    expect(vi.mocked(ports.recordFailure).mock.calls[0]?.[0]).toBe('diagnostic-picker');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ ⑤ 阅读排版面板容器（ReadingSettingsPanel.kt L72-80 → reader.css）
   ══════════════════════════════════════════════════════════════════════════════ */

const repoRoot = process.cwd();

function sourceText(relative: string): string {
  return readFileSync(path.resolve(repoRoot, relative), 'utf8');
}

/** `.rd-sheet--settings { … }` 的声明块正文（到行首 `}` 为止；注释里的 `}` 不参与）。 */
function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`找不到选择器 ${selector}`);
  const end = css.indexOf('\n}', start);
  if (end < 0) throw new Error(`选择器 ${selector} 没有闭合`);
  return css.slice(start, end);
}

describe('.rd-sheet--settings 的容器参数（ReadingSettingsPanel.kt L72-80）', () => {
  const css = sourceText('src/styles/reader.css');

  it('④ blur / tint / 双段高光 / 1px 描边 / 两层阴影全部来自 READING_SETTINGS_*', () => {
    const block = cssBlock(css, '.rd-sheet--settings');

    // L76 `effects = { blur(DesignTokens.SpaceSm.toPx()) }` —— 只有模糊
    expect(block).toContain(`blur(${String(READING_SETTINGS_BLUR_PX)}px)`);
    expect(block).toContain('-webkit-backdrop-filter:');
    // L78 `themeColor.copy(alpha = 0.56f)`
    expect(block).toContain(`--rd-settings-tint-alpha: ${String(READING_SETTINGS_TINT_ALPHA)};`);
    // L79 `verticalGradient(white@.10f, Transparent)` —— 单段高光
    expect(block).toContain(`--rd-settings-sheen: ${String(READING_SETTINGS_SHEEN_ALPHA)};`);
    // L80 `border(1.dp, contentColor.copy(alpha = 0.12f), shape)`
    expect(block).toContain(
      `--rd-settings-border-width: ${String(READING_SETTINGS_BORDER_WIDTH_PX)}px;`,
    );
    expect(block).toContain(`--rd-settings-border-alpha: ${String(READING_SETTINGS_BORDER_ALPHA)};`);
    // L72 双层阴影的两个 alpha（elevation 见 `READING_SETTINGS_SHADOW.elevationPx`）
    expect(block).toContain(`rgb(0 0 0 / ${String(READING_SETTINGS_SHADOW.ambientAlpha)})`);
    expect(block).toContain(`rgb(0 0 0 / ${String(READING_SETTINGS_SHADOW.spotAlpha)})`);
    // L79 只有一层渐变：白 → 透明（ReadingGlass 的三段高光在这里没有对应物）
    expect(block.match(/linear-gradient\(/g)?.length ?? 0).toBe(1);
    // L86 仍要向面板**内部**提供 ReadingGlassStyle 的 tint / ink
    expect(block).toContain('--rd-reading-glass-tint:');
    expect(block).toContain('--rd-reading-glass-ink:');
  });

  it('④b 这个面板不是 ReadingGlass：不得出现 saturation 与三段高光/0.7px 描边', () => {
    const block = cssBlock(css, '.rd-sheet--settings');
    expect(block).not.toContain('saturate(');
    expect(block).not.toContain('--rd-reading-glass-sheen');
    expect(block).not.toContain('--rd-reading-glass-border');
  });

  it('④c 几何块（560/80dvh、宽屏 440/94dvh、圆角 28、遮罩 .35）保持不动', () => {
    expect(css).toContain('.rd-sheet-backdrop:has(.rd-sheet--settings) {');
    expect(css).toContain(`background: rgba(0, 0, 0, ${String(READING_SETTINGS_SCRIM_ALPHA)});`);
    expect(css).toContain('max-height: 80dvh;');
    expect(css).toContain('max-width: 440px;');
    expect(css).toContain(`border-radius: ${String(READING_SETTINGS_RADIUS_PX)}px;`);
  });

  it('⑤ Kotlin 没有画质档分支 —— 端口不得自造 [data-render-quality] 规则', () => {
    // `ReadingSettingsPanel.kt` 全文没有 `LocalRenderQuality`：它无条件
    // `drawPlainBackdrop { blur(8.dp) }`。`[data-render-quality='LOW'|'MINIMAL']`
    // 是照搬 `ReadingGlass.kt` L35/L37 的产物 —— 把另一个组件的降级规则套到这个面板上。
    expect(css).not.toContain('.rd-sheet--settings[data-render-quality=');
    const page = sourceText('src/ui/pages/ReaderPage.tsx');
    expect(page).not.toContain('data-render-quality={renderQuality}');
    expect(page).not.toContain('const renderQuality = useRenderQuality();');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ ⑦ ReaderChapterWindow（ReaderChapterWindow.kt L12-41）
   ══════════════════════════════════════════════════════════════════════════════ */

function row(order: number, title: string, content: string): ChapterRow {
  return {
    id: order + 1,
    bookId: 1,
    chapterOrder: order,
    title,
    content,
    startCharIndex: 0,
    endCharIndex: content.length,
  };
}

/** 9 章、正文全为空（= 刚入库、store 里只有元数据）。 */
const EMPTY_ROWS: ChapterRow[] = Array.from({ length: 9 }, (_, index) =>
  row(index, `第${String(index + 1)}章`, ''),
);

describe('ReaderChapterWindow 接线（ReaderChapterWindow.kt）', () => {
  it('⑥ 打开书籍只装当前章 ±1，其余章节保持空正文', async () => {
    const readParts = vi.fn(async (orders: number[]) =>
      orders.map((order) => row(order, `第${String(order + 1)}章`, `正文${String(order)}`)),
    );

    const result = await loadChapterWindowAround({
      rows: EMPTY_ROWS,
      currentIndex: 4,
      previous: null,
      loaded: loadedChapterIndices(EMPTY_ROWS),
      readParts,
    });

    // L21 `targets = (currentIndex-1)..(currentIndex+1)` —— 只请求 3 个物理分片
    expect(readParts).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readParts).mock.calls[0]?.[0]).toEqual([3, 4, 5]);
    expect([...result.loaded]).toEqual([3, 4, 5]);
    expect(result.chapters[4]?.content).toBe('正文4');
    expect(result.chapters[0]?.content).toBe('');
    expect(result.chapters[8]?.content).toBe('');
    expect(result.aligned).toBe(true);
  });

  it('⑥b 正文已在内存的章不重复拉取（`loaded` 复用）', async () => {
    const loadedRows = EMPTY_ROWS.map((item, index) =>
      index === 4 ? { ...item, content: '已有正文' } : item,
    );
    const readParts = vi.fn(async (orders: number[]) =>
      orders.map((order) => row(order, `第${String(order + 1)}章`, `正文${String(order)}`)),
    );

    const result = await loadChapterWindowAround({
      rows: loadedRows,
      currentIndex: 4,
      previous: null,
      loaded: loadedChapterIndices(loadedRows),
      readParts,
    });

    expect(vi.mocked(readParts).mock.calls[0]?.[0]).toEqual([3, 5]);
    expect(result.chapters[4]?.content).toBe('已有正文');
  });

  it('⑦ 越过窗口边界只拉新进入的分片（复用集不再请求）', async () => {
    const readParts = vi.fn(async (orders: number[]) =>
      orders.map((order) => row(order, `第${String(order + 1)}章`, `正文${String(order)}`)),
    );

    const first = await loadChapterWindowAround({
      rows: EMPTY_ROWS,
      currentIndex: 4,
      previous: null,
      loaded: loadedChapterIndices(EMPTY_ROWS),
      readParts,
    });
    expect(vi.mocked(readParts).mock.calls[0]?.[0]).toEqual([3, 4, 5]);

    // 翻到 6：窗口 5..7，5 复用 → 只拉 6、7（L22-24）
    const second = await loadChapterWindowAround({
      rows: EMPTY_ROWS,
      currentIndex: 6,
      previous: first.chapters,
      loaded: first.loaded,
      readParts,
    });
    expect(readParts).toHaveBeenCalledTimes(2);
    expect(vi.mocked(readParts).mock.calls[1]?.[0]).toEqual([6, 7]);
    expect([...second.loaded]).toEqual([5, 6, 7]);
    expect(second.chapters[5]?.content).toBe('正文5');
    expect(second.chapters[6]?.content).toBe('正文6');
  });

  it('⑦b 合并章（"(续)" 分片）按物理 chapterOrder 顺序拼接', async () => {
    const rows: ChapterRow[] = [
      row(0, '第一章', ''),
      row(1, '第二章', ''),
      row(2, '第三章', ''),
      row(3, '第三章 (续)', ''),
      row(4, '第四章', ''),
    ];
    const readParts = vi.fn(async (orders: number[]) =>
      orders.map((order) => {
        if (order === 2) return row(2, '第三章', '前半段');
        if (order === 3) return row(3, '第三章 (续)', '后半段');
        return row(order, rows[order]?.title ?? `第${String(order + 1)}章`, `正文${String(order)}`);
      }),
    );

    const result = await loadChapterWindowAround({
      rows,
      currentIndex: 2,
      previous: null,
      loaded: loadedChapterIndices(rows),
      readParts,
    });

    // 物理下标 2 → 逻辑下标 2（0/1 各自成章），窗口 1..3 → 物理分片 1,2,3,4
    expect(vi.mocked(readParts).mock.calls[0]?.[0]).toEqual([1, 2, 3, 4]);
    // L34-37 `logicalToPhysicalOrders[index].mapNotNull { parts[it] }.joinToString("")`
    expect(result.chapters[2]?.content).toBe('前半段后半段');
    expect(result.chapters[2]?.title).toBe('第三章');
    // 合并让「逻辑下标 ≠ store 行下标」，接线层据此跳过写回（避免把合并正文
    // 同时塞进两个物理行）。
    expect(result.aligned).toBe(false);
  });
});
