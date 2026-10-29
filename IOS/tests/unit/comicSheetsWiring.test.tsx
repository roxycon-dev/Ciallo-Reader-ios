/**
 * comicSheetsWiring.test.tsx — 面板族接线的回归测试（P0 修复的钉子）。
 *
 * 背景：`ComicReaderPage.tsx` 此前把 `ComicReaderSheets.kt` 的四个面板替换成了
 * 一份 5 select + 3 slider + 4 checkbox 的内联精简面板，并在 PRESET / CROP
 * 两个分支渲染占位文案「该面板由 ComicReaderSheets.kt 提供，本次未移植。」——
 * **用户点得到但没实现**。现改为直接渲染 `../components/comic/sheets` 的
 * 真移植版（Kotlin `ComicReaderChrome.kt` L269-307 的 `when (panel)` 四分支）。
 *
 * 本文件锁住：① 占位文案彻底消失 ② 四个面板都能打开并渲染出 Kotlin 里的
 * 真实标题/选项中文 ③ 每个面板的关键交互真的写回 config。
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/comic/ComicReaderSheets.kt
 *           + ComicReaderChrome.kt L262-309
 * TS 源:    IOS/src/ui/pages/ComicReaderPage.tsx
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
import { ComicSettingsStore, createMemoryComicStore } from '@core/comic/comicSettingsStore';
import { createComicReaderConfig, type ComicScene } from '@core/comic/comicReaderConfig';
import { SCENE_OPTIONS } from '@core/comic/comicReaderSheets';

// React 19 要求显式声明 act 环境
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function localPages(count: number): ComicPageRef[] {
  return Array.from({ length: count }, (_unused, i) => ({
    kind: 'LOCAL' as const,
    id: `p${String(i + 1)}`,
    path: PIXEL,
  }));
}

/** 立即返回 1×1 位图的解码器端口（跳过真实解码时序）。 */
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

/**
 * 真实的 `ComicSettingsStore`（内存 KV）——这样面板的预设系统是**真的**接上了，
 * 而不是拿一个只实现了 7 个方法的替身把预设区降级隐藏掉。
 */
function realStore(patch: Partial<ComicReaderConfig> = {}) {
  const settings = new ComicSettingsStore(createMemoryComicStore());
  // `ComicReaderConfig.scene` 是字面量联合 `ComicScene`。对象字面量展开
  // `{ scene: 'NONE', ...patch }` 会把 `scene` 推成 `string`，所以先展开再赋字面量。
  // 之后保证 scene 落在合法场景表里。
  const base = createComicReaderConfig({
    ...patch,
    scene: (patch.scene ?? 'NONE') as ComicScene,
  });
  const scene: ComicScene = SCENE_OPTIONS.find((o) => o.scene === base.scene)?.scene ?? 'NONE';
  settings.saveGlobalConfig({ ...base, scene });
  return settings;
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

function texts(m: Mounted, selector: string): string[] {
  return [...m.host.querySelectorAll(selector)].map((el) => el.textContent ?? '');
}

/** 找到文本等于 label 的按钮并点击（React 19 需要 act 包裹）。 */
async function clickByText(m: Mounted, selector: string, label: string): Promise<HTMLButtonElement> {
  const target = [...m.host.querySelectorAll(selector)].find(
    (el) => (el.textContent ?? '').includes(label),
  ) as HTMLButtonElement | undefined;
  if (target === undefined) {
    throw new Error(`no ${selector} whose text includes ${JSON.stringify(label)}`);
  }
  await act(async () => {
    target.click();
  });
  return target;
}

function cardTitles(m: Mounted): string[] {
  return texts(m, '.cmcs-card__title');
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
});

describe('P0 · 占位文案已彻底删除', () => {
  it('任意面板打开后，页面里不再出现「本次未移植」', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(3)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    for (const label of ['设置', '目录']) {
      await act(async () => {
        chip(m, label)?.click();
      });
      expect(m.host.textContent).not.toContain('本次未移植');
      await act(async () => {
        chip(m, label)?.click();
      });
    }
    expect(m.host.textContent).not.toContain('该面板由');
    await unmount(m);
  });
});

describe('P0 · ComicSettingsSheet（Kotlin L151-278，七个 Tab）', () => {
  it('打开后是「阅读设置」面板，且七个 Tab 逐字一致（Kotlin L141-149）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    expect(m.host.querySelector('.cmcs-sheet--settings')).not.toBeNull();
    expect(texts(m, '.cmcs-sheet__title')).toContain('阅读设置');
    // 七个 Tab：翻页 / 显示 / 图像 / 翻译 / 主题 / 自动 / 手势
    expect(texts(m, '.cmcs-tabrow__label')).toEqual([
      '翻页',
      '显示',
      '图像',
      '翻译',
      '主题',
      '自动',
      '手势',
    ]);
    await unmount(m);
  });

  it('默认 Tab「翻页」：阅读模式五档 / 方向三档 / 翻页动画四档（Kotlin L509-526）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    const labels = texts(m, '.cmcs-grid__label');
    expect(labels).toEqual(['单页', '双页', '条漫', '无缝滚动', '磁吸', '左 → 右', '右 → 左', '上 → 下']);
    // 翻页动画是分段控件：短标签「无 / 平移 / 渐变 / 仿真」（Kotlin L518-523）
    const segmentLabels = texts(m, '.cmcs-segment__item');
    expect(segmentLabels).toEqual(['无', '平移', '渐变', '仿真']);
    await unmount(m);
  });

  it('切到「显示」Tab：缩放方式六档 + 间距 + 双页排列（Kotlin L615-622 / L718-754）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await act(async () => {
      (m.host.querySelectorAll('.cmcs-tabrow__item')[1] as HTMLButtonElement).click();
    });
    expect(cardTitles(m)).toEqual(['缩放方式', '间距', '双页排列', '缩放']);
    // 缩放方式六档的**短**标签（Kotlin FitOptions：整页/高度/原始/铺满/拉伸/自定义）
    const fitLabels = texts(m, '.cmcs-segment__item').slice(0, 6);
    expect(fitLabels).toEqual(['整页', '高度', '原始', '铺满', '拉伸', '自定义']);
    // 双页对齐三档：顶部 / 居中 / 底部
    expect(texts(m, '.cmcs-segment__item')).toContain('顶部');
    expect(texts(m, '.cmcs-segment__item')).toContain('底部');
    await unmount(m);
  });

  it('切到「图像」Tab：裁边 / 大图拆分 / 旋转 / 画质增强 / 滤镜（Kotlin L783-915）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await act(async () => {
      (m.host.querySelectorAll('.cmcs-tabrow__item')[2] as HTMLButtonElement).click();
    });
    expect(cardTitles(m)).toEqual(['裁边', '大图拆分', '旋转', '画质增强', '滤镜']);
    // 自动裁边四档（Kotlin L786-791）：关闭 / 白边 / 黑边 / 自动
    const cropLabels = texts(m, '.cmcs-segment__item').slice(0, 4);
    expect(cropLabels).toEqual(['关闭', '白边', '黑边', '自动']);
    // 手动裁边入口（Kotlin L805）
    expect(texts(m, '.cmcs-navrow__label')).toEqual(['手动裁边']);
    // 整本旋转四档（Kotlin L840）
    expect(texts(m, '.cmcs-segment__item')).toContain('90°');
    expect(texts(m, '.cmcs-segment__item')).toContain('270°');
    // 旋转本页 / 临时合页两个 ActionChip（Kotlin L845 / L854）
    expect(texts(m, '.cmcs-actionchip')).toEqual([
      '旋转本页 +90°',
      '与下一页临时合页',
    ]);
    // 画质增强五档（Kotlin L869）
    expect(texts(m, '.cmcs-segment__item')).toContain('锐化增强');
    expect(texts(m, '.cmcs-segment__item')).toContain('超分 完整');
    await unmount(m);
  });

  it('切到「主题」Tab：阅读背景五色卡 + 场景八档 + 显示（Kotlin L986-991 / L1043-1052）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await act(async () => {
      (m.host.querySelectorAll('.cmcs-tabrow__item')[4] as HTMLButtonElement).click();
    });
    expect(cardTitles(m)).toEqual(['阅读背景', '场景', '显示']);
    // 背景色卡的**短**标签（Kotlin L986-990：纯黑/纯白/深灰/纸张/沉浸）
    expect(texts(m, '.cmcs-bgswatch__label')).toEqual(['纯黑', '纯白', '深灰', '纸张', '沉浸']);
    // 场景八档（Kotlin L1044-1051）
    expect(texts(m, '.cmcs-scene__label')).toEqual([
      '关闭',
      '雨夜',
      '落雪',
      '樱花',
      '萤火',
      '海边',
      '篝火',
      '夏夜',
    ]);
    await unmount(m);
  });

  it('切到「自动」Tab：自动翻页 + 自动滚动（Kotlin L1228-1240）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await act(async () => {
      (m.host.querySelectorAll('.cmcs-tabrow__item')[5] as HTMLButtonElement).click();
    });
    expect(cardTitles(m)).toEqual(['自动翻页', '自动滚动']);
    expect(texts(m, '.cmcs-sliderrow__title')).toEqual(['翻页间隔', '滚动速度']);
    await unmount(m);
  });

  it('切到「手势」Tab：点按区域三行 + 手势开关五行（Kotlin L1247-1275）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await act(async () => {
      (m.host.querySelectorAll('.cmcs-tabrow__item')[6] as HTMLButtonElement).click();
    });
    expect(cardTitles(m)).toEqual(['点按区域动作', '手势开关']);
    // Kotlin L1412-1423: the three region labels are direction/mode dependent.
    // Defaults are `direction = RTL` + `mode = SINGLE` (ComicReaderConfig.kt:17 and
    // the `fromJson` fallback at :215), so `vertical === false` and `reverse === true`
    // → 右侧区域 / 中间区域 / 左侧区域.
    expect(texts(m, '.cmcs-segment__title')).toEqual(['右侧区域', '中间区域', '左侧区域']);
    // Kotlin L1408-1410 PanelHint — the RTL horizontal branch text.
    expect(texts(m, '.cmcs-hint')).toEqual([
      '右至左阅读：左侧对应下一页区域，右侧对应上一页区域。',
    ]);
    // Kotlin L1424-1427「恢复默认点按动作」
    expect(texts(m, '.cmcs-textbtn')).toContain('恢复默认点按动作');
    // 手势动作七档的 label（Kotlin L308-310）
    const actionLabels = texts(m, '.cmcs-segment__item');
    expect(actionLabels).toContain('呼出/隐藏控制');
    expect(actionLabels).toContain('退出');
    // 手势开关五行（Kotlin L1431/1432/1435/1438/1442）。面板底部还有一行固定的
    // 「本漫画独立设置」（Kotlin L243-273），同样用 `.cmcs-switchrow__title`，
    // 所以这里逐项包含，而不是全等。
    expect(texts(m, '.cmcs-switchrow__title')).toEqual(
      expect.arrayContaining([
        '单指滑动翻页',
        '双指合拢退出',
        '侧边滑动关闭',
        '长按呼出控制层',
        '音量键翻页',
      ]),
    );
    // Kotlin L1435 的副标题此前在 TS 侧丢失，本轮补回
    expect(texts(m, '.cmcs-switchrow__subtitle')).toContain(
      '从两侧边缘向内滑动；放大查看时不触发',
    );
    await unmount(m);
  });

  it('区域标题随 mode/direction 三分支变化（Kotlin L1412-1423 vertical/reverse）', async () => {
    const cases: Array<[{ mode: string; direction: string }, string[]]> = [
      // WEBTOON / CONTINUOUS → vertical === true → 顶部 / 中间 / 底部
      [{ mode: 'WEBTOON', direction: 'RTL' }, ['顶部区域', '中间区域', '底部区域']],
      [{ mode: 'CONTINUOUS', direction: 'LTR' }, ['顶部区域', '中间区域', '底部区域']],
      // TTB + 非 DOUBLE → vertical === true
      [{ mode: 'SINGLE', direction: 'TTB' }, ['顶部区域', '中间区域', '底部区域']],
      // LTR 横向 → vertical false, reverse false → 左 / 中 / 右
      [{ mode: 'SINGLE', direction: 'LTR' }, ['左侧区域', '中间区域', '右侧区域']],
      // DOUBLE + TTB → vertical false（mode !== DOUBLE 的守卫），reverse false → 左 / 中 / 右
      [{ mode: 'DOUBLE', direction: 'TTB' }, ['左侧区域', '中间区域', '右侧区域']],
      // RTL 横向（默认）→ reverse true → 右 / 中 / 左
      [{ mode: 'SINGLE', direction: 'RTL' }, ['右侧区域', '中间区域', '左侧区域']],
    ];
    for (const [patch, expected] of cases) {
      const m = await mount(
        <ComicReaderPage
          pages={localPages(2)}
          bookKey={null}
          loader={fastLoader()}
          store={realStore(patch as never)}
        />,
      );
      await act(async () => {
        chip(m, '设置')?.click();
      });
      await act(async () => {
        (m.host.querySelectorAll('.cmcs-tabrow__item')[6] as HTMLButtonElement).click();
      });
      expect(
        texts(m, '.cmcs-segment__title'),
        `mode=${patch.mode} direction=${patch.direction}`,
      ).toEqual(expected);
      await unmount(m);
    }
  });

  it('面板底部固定区：预设管理入口 + 本漫画独立设置（Kotlin L243-273）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    expect(texts(m, '.cmcs-chiprow__label')).toContain('预设管理');
    expect(texts(m, '.cmcs-switchrow__title')).toContain('本漫画独立设置');
    // 未开启时副标题是「跟随全局设置」（Kotlin L270）
    expect(texts(m, '.cmcs-switchrow__subtitle')).toContain('跟随全局设置');
    await unmount(m);
  });

  it('点「预设管理」→ 切到 ComicPresetSheet（Kotlin L274 onOpenPreset）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await clickByText(m, '.cmcs-chiprow', '预设管理');
    expect(m.host.querySelector('.cmcs-sheet--preset')).not.toBeNull();
    expect(texts(m, '.cmcs-sheet__title')).toContain('阅读预设');
    await unmount(m);
  });

  it('图像 Tab 的「手动裁边」→ 切到 ComicCropSheet（Kotlin L275 onOpenCrop）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await act(async () => {
      (m.host.querySelectorAll('.cmcs-tabrow__item')[2] as HTMLButtonElement).click();
    });
    await act(async () => {
      (m.host.querySelector('.cmcs-navrow') as HTMLButtonElement).click();
    });
    expect(m.host.querySelector('.cmcs-cropsheet')).not.toBeNull();
    expect(texts(m, '.cmcs-cropsheet__title')).toEqual(['手动裁边']);
    expect(texts(m, '.cmcs-cropsheet__btn')).toEqual(['重置', '取消', '保存']);
    expect(texts(m, '.cmcs-cropsheet__hint')).toEqual(['拖动四角调整裁剪区域（不修改原文件）']);
    await unmount(m);
  });

  it('交互写回 config：改「适配」为「拉伸铺满」后立即反映到渲染层', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await act(async () => {
      (m.host.querySelectorAll('.cmcs-tabrow__item')[1] as HTMLButtonElement).click();
    });
    await act(async () => {
      const stretch = [...m.host.querySelectorAll('.cmcs-segment__item')].find(
        (el) => el.textContent === '拉伸',
      ) as HTMLButtonElement | undefined;
      expect(stretch).toBeDefined();
      stretch?.click();
    });
    // 选中态回到该分段项
    const active = [...m.host.querySelectorAll('.cmcs-segment__item--active')].map(
      (el) => el.textContent,
    );
    expect(active).toContain('拉伸');
    await unmount(m);
  });
});

describe('P0 · ComicTocSheet（Kotlin L1280-1348）', () => {
  it('有目录时渲染章节行（标题 + 选中打勾）', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(2)}
        bookKey={null}
        loader={fastLoader()}
        store={realStore()}
        toc={[
          { id: 'c1', title: '第1话' },
          { id: 'c2', title: '第2话' },
        ]}
        currentChapterIndex={1}
        onJumpToChapter={() => undefined}
      />,
    );
    await act(async () => {
      chip(m, '目录')?.click();
    });
    expect(texts(m, '.cmcs-toc__title')).toEqual(['第1话', '第2话']);
    // 当前章高亮（Kotlin L1304 `i == currentChapterIndex`）
    expect(texts(m, '.cmcs-toc__row--active').length).toBe(1);
    await unmount(m);
  });

  it('无目录时回落到页缩略图网格（Kotlin L1335-1346 本地漫画分支）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(4)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '目录')?.click();
    });
    expect(m.host.querySelector('.cmcs-thumbgrid')).not.toBeNull();
    expect(m.host.querySelectorAll('.cmcs-thumb')).toHaveLength(4);
    // 页码从 1 开始（Kotlin L1388 `${index + 1}`）
    expect(texts(m, '.cmcs-thumb__no')).toEqual(['1', '2', '3', '4']);
    await unmount(m);
  });
});

describe('P0 · ComicPresetSheet（Kotlin L1395-1608）', () => {
  it('列出三个内置预设并带「内置」徽标 + 「应用」按钮（Kotlin L1461-1484）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await clickByText(m, '.cmcs-chiprow', '预设管理');
    expect(texts(m, '.cmcs-preset__name')).toEqual(['日漫', '条漫', '老漫画']);
    expect(texts(m, '.cmcs-preset__badge--muted')).toEqual(['内置', '内置', '内置']);
    expect(texts(m, '.cmcs-preset__apply')).toEqual(['应用', '应用', '应用']);
    // 副标题 = 模式 · 方向 · 动画（Kotlin L1471-1474）
    expect(texts(m, '.cmcs-preset__subtitle')[0]).toBe('单页 · 右 → 左 · 仿真翻页');
    // 尾部「从当前设置新建预设」（Kotlin L1577）
    expect(texts(m, '.cmcs-preset-create__label')).toEqual(['从当前设置新建预设']);
    await unmount(m);
  });

  it('「新建预设」对话框：标题 + 预设名称占位 + 确定/取消（Kotlin L1584-1595 / L1619-1638）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await clickByText(m, '.cmcs-chiprow', '预设管理');
    const create = m.host.querySelector('.cmcs-preset-create');
    expect(create).not.toBeNull();
    await act(async () => {
      (create as HTMLButtonElement).click();
    });
    expect(texts(m, '.cmcs-dialog__title')).toEqual(['新建预设']);
    expect(m.host.querySelector('.cmcs-dialog__field')?.getAttribute('placeholder')).toBe('预设名称');
    expect(texts(m, '.cmcs-dialog__btn')).toEqual(['取消', '确定']);
    await unmount(m);
  });

  it('内置预设只有 收藏 / 设为默认 / 复制 三个动作，无重命名/删除（Kotlin L1537）', async () => {
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await clickByText(m, '.cmcs-chiprow', '预设管理');
    const labels = [...m.host.querySelectorAll('.cmcs-preset__act')].map(
      (el) => el.getAttribute('aria-label'),
    );
    // 3 个内置 × 3 个动作 = 9；没有「重命名」「删除」
    expect(labels.filter((l) => l === '重命名' || l === '删除')).toHaveLength(0);
    expect(labels.filter((l) => l === '收藏' || l === '取消收藏')).toHaveLength(3);
    expect(labels.filter((l) => l === '设为默认')).toHaveLength(3);
    expect(labels.filter((l) => l === '复制')).toHaveLength(3);
    await unmount(m);
  });
});

describe('P0 · ComicCropSheet（Kotlin L1645-1728）', () => {
  it('顶部「手动裁边」+ 读数 + 裁剪画布，保存写回 manualCrop（Kotlin L1836-1930 / Chrome L324-327）', async () => {
    const store = realStore();
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={store} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await act(async () => {
      (m.host.querySelectorAll('.cmcs-tabrow__item')[2] as HTMLButtonElement).click();
    });
    await act(async () => {
      (m.host.querySelector('.cmcs-navrow') as HTMLButtonElement).click();
    });
    // 读数默认 L6% · T6% · R6% · B6%（Kotlin L1913-1917 `L %.0f%% · T %.0f%% …`）
    expect(texts(m, '.cmcs-cropsheet__readout')).toEqual(['L 6% · T 6% · R 6% · B 6%']);
    await act(async () => {
      const save = [...m.host.querySelectorAll('.cmcs-cropsheet__btn')].find(
        (el) => el.textContent === '保存',
      ) as HTMLButtonElement | undefined;
      save?.click();
    });
    // Kotlin ComicReaderChrome.kt:324-327
    // `onApply = { l, t, r, b -> onConfigChange(config.copy(manualCrop = listOf(l, t, r, b))); onDismissPanel() }`
    // — 保存把裁边写进全局配置并关闭面板（panel → NONE，控制栏随之隐藏）。
    // 持久化走 250 ms 防抖（Kotlin ComicReaderCore.kt:244-251 `delay(250)`；
    // TS `ComicReaderPage.tsx:2917` 的 `setTimeout(…, 250)`），所以这里要等它落库。
    expect(m.host.querySelector('.cmcs-cropsheet')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(store.loadGlobalConfig().manualCrop).toEqual([0.06, 0.06, 0.94, 0.94]);
    await unmount(m);
  });
});

describe('E1 · 漫画翻译入口隐藏', () => {
  it('设置面板里不出现「整页自动翻译」开关，也没有引擎选择卡 / 离线模型下载', async () => {
    const m = await mount(
      <ComicReaderPage
        pages={localPages(2)}
        bookKey={null}
        loader={fastLoader()}
        store={realStore({ translationEnabled: false })}
      />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    // 「翻译」Tab 本身保留（Kotlin L141-149 的七 Tab 结构不变）
    expect(texts(m, '.cmcs-tabrow__label')).toContain('翻译');
    await act(async () => {
      (m.host.querySelectorAll('.cmcs-tabrow__item')[3] as HTMLButtonElement).click();
    });
    // 明示不可用
    expect(texts(m, '.cmcs-card__title')).toContain('漫画翻译');
    expect(m.host.textContent).toContain('漫画翻译在 iOS 上不可用');
    // 三张「能开启翻译」的卡片整体不渲染
    expect(cardTitles(m)).not.toContain('翻译引擎（点击选择）');
    expect(cardTitles(m)).not.toContain('功能');
    expect(cardTitles(m)).not.toContain('离线模型');
    expect(texts(m, '.cmcs-switchrow__title')).not.toContain('整页自动翻译');
    expect(texts(m, '.cmcs-enginecard__title')).toHaveLength(0);
    // 惰性设置仍在（译文显示 / 译文缓存）
    expect(cardTitles(m)).toEqual(['漫画翻译', '译文显示', '译文缓存']);
    await unmount(m);
  });
});

describe('面板接线 · loader 退化路径（Kotlin loadPreview / loadThumb）', () => {
  it('宿主 loader 若原生提供 loadPreview / loadThumb 则优先用宿主实现', async () => {
    const loadPreview = vi.fn(() => Promise.resolve('blob:preview'));
    const loadThumb = vi.fn(() => Promise.resolve('blob:thumb'));
    const base = fastLoader();
    const loader = Object.assign(base, { loadPreview, loadThumb });

    const m = await mount(
      <ComicReaderPage pages={localPages(3)} bookKey={null} loader={loader} store={realStore()} />,
    );
    // 无目录 → 目录面板走页缩略图网格 → 每格调 loadThumb（Kotlin L1359）
    await act(async () => {
      chip(m, '目录')?.click();
    });
    expect(loadThumb).toHaveBeenCalled();
    await unmount(m);
  });

  it('宿主没有同名方法时退化为 loadForDisplay，不抛错', async () => {
    const loadForDisplay = vi.fn(() => Promise.resolve({ src: PIXEL, width: 1, height: 1 }));
    const loader = { ...fastLoader(), loadForDisplay } as ComicPageLoaderPort;
    const m = await mount(
      <ComicReaderPage pages={localPages(3)} bookKey={null} loader={loader} store={realStore()} />,
    );
    await act(async () => {
      chip(m, '目录')?.click();
    });
    // 退化路径仍能用 loadForDisplay 拿到缩略图，不炸
    expect(loadForDisplay).toHaveBeenCalled();
    await unmount(m);
  });
});

describe('面板接线 · 预设系统退化（Kotlin PageTab L631 `store: ComicSettingsStore? = null`）', () => {
  it('宿主仓库缺少预设方法时，预设面板入口存在但面板不渲染（不崩）', async () => {
    // 只实现本页读配置用的 7 个方法（等价于测试替身）
    const partial = {
      loadGlobalConfig: () => DEFAULT_COMIC_READER_CONFIG,
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
      effectiveConfig: () => ({ config: DEFAULT_COMIC_READER_CONFIG, hasOverride: false }),
    };
    const m = await mount(
      <ComicReaderPage pages={localPages(2)} bookKey={null} loader={fastLoader()} store={partial} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    // 设置面板正常（store=null 只是隐藏自定义缩放预设区，Kotlin L661）
    expect(m.host.querySelector('.cmcs-sheet--settings')).not.toBeNull();
    await clickByText(m, '.cmcs-chiprow', '预设管理');
    // 预设面板返回 null（无仓库），页面不崩
    expect(m.host.querySelector('.cmcs-sheet--preset')).toBeNull();
    await unmount(m);
  });
});

describe('面板接线 · bookState 回写（Kotlin L745 onBookStateChange → saveBookState）', () => {
  it('图像 Tab 的「旋转本页 +90°」写进 bookKey 对应的阅读状态', async () => {
    const backing = createMemoryComicStore();
    const settings = new ComicSettingsStore(backing);
    const m = await mount(
      <ComicReaderPage
        pages={localPages(2)}
        bookKey="bk-rot"
        loader={fastLoader()}
        store={settings}
      />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await act(async () => {
      (m.host.querySelectorAll('.cmcs-tabrow__item')[2] as HTMLButtonElement).click();
    });
    await act(async () => {
      const rotate = [...m.host.querySelectorAll('.cmcs-actionchip')].find(
        (el) => el.textContent === '旋转本页 +90°',
      ) as HTMLButtonElement | undefined;
      rotate?.click();
    });
    const state = settings.loadBookState('bk-rot');
    // 当前页 p1 被转了 90°
    expect(state.pageRotations.p1).toBe(90);
    await unmount(m);
  });

  it('「与下一页临时合页」按钮文案随锚点状态翻转（Kotlin L854）', async () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    const m = await mount(
      <ComicReaderPage pages={localPages(3)} bookKey={null} loader={fastLoader()} store={settings} />,
    );
    await act(async () => {
      chip(m, '设置')?.click();
    });
    await act(async () => {
      (m.host.querySelectorAll('.cmcs-tabrow__item')[2] as HTMLButtonElement).click();
    });
    const merge = () =>
      [...m.host.querySelectorAll('.cmcs-actionchip')].find((el) =>
        (el.textContent ?? '').includes('临时合页'),
      ) as HTMLButtonElement;
    expect(merge().textContent).toBe('与下一页临时合页');
    await act(async () => {
      merge().click();
    });
    expect(merge().textContent).toBe('取消临时合页');
    await unmount(m);
  });
});