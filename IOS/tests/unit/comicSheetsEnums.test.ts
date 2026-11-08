/**
 * comicSheetsEnums.test.ts — 枚举 ↔ ordinal ↔ 中文 label 的**持久化契约**单测。
 *
 * 背景（REVIEW_PROTOCOL 第 2 条重点审查项）：
 * Kotlin `Enum.ordinal` 就是声明顺序下标，而 `toJson()` 写的是 `mode.name`（字符串），
 * `SegmentRow` 的选中态用的却是 `config.pageAnim.ordinal`。所以一旦某份 TS 镜像
 * 少一个成员 / 顺序变了 / 中文标签差一个字：
 *   - 分段控件会高亮到错误的选项；
 *   - 旧存档（写的是 name）会回落到错误的 fallback；
 *   - preset 副标题（`${mode.label} · ${direction.label} · ${pageAnim.label}`）会显示错字。
 *
 * Kotlin 源：`com/example/ui/comic/ComicReaderConfig.kt` L242–311（枚举本体）。
 * TS 源：  `src/core/comic/comicReaderConfig.ts`（权威表）
 *          + `comicPortTypes.ts` / `comicReaderCore.ts` / `comicReaderSheets.ts`（镜像）
 *
 * 本文件把每一条映射都钉死；改动任一表都会在这里失败。
 */
import { describe, expect, it } from 'vitest';

import {
  COMIC_BG_TYPE_LABEL,
  COMIC_BG_TYPE_ORDINAL,
  COMIC_BG_TYPE_VALUES,
  COMIC_CROP_MODE_LABEL,
  COMIC_CROP_MODE_ORDINAL,
  COMIC_CROP_MODE_VALUES,
  COMIC_DIRECTION_LABEL,
  COMIC_DIRECTION_ORDINAL,
  COMIC_DIRECTION_VALUES,
  COMIC_DOUBLE_ALIGN_LABEL,
  COMIC_DOUBLE_ALIGN_ORDINAL,
  COMIC_DOUBLE_ALIGN_VALUES,
  COMIC_ENHANCE_MODE_DESC,
  COMIC_ENHANCE_MODE_LABEL,
  COMIC_ENHANCE_MODE_ORDINAL,
  COMIC_ENHANCE_MODE_VALUES,
  COMIC_FIT_LABEL,
  COMIC_FIT_ORDINAL,
  COMIC_FIT_VALUES,
  COMIC_GESTURE_ACTION_LABEL,
  COMIC_GESTURE_ACTION_ORDINAL,
  COMIC_GESTURE_ACTION_VALUES,
  COMIC_MODE_LABEL,
  COMIC_MODE_ORDINAL,
  COMIC_MODE_VALUES,
  COMIC_PAGE_ANIM_LABEL,
  COMIC_PAGE_ANIM_ORDINAL,
  COMIC_PAGE_ANIM_VALUES,
  COMIC_SCENE_LABEL,
  COMIC_SCENE_ORDINAL,
  COMIC_SCENE_VALUES,
} from '../../src/core/comic/comicReaderConfig';

import type {
  ComicCropMode,
  ComicDirection,
  ComicDoubleAlign,
  ComicEnhanceMode,
  ComicFit,
  ComicGestureAction,
  ComicMode,
  ComicPageAnim,
  ComicScene,
} from '../../src/core/comic/comicReaderConfig';

import {
  DIRECTION_OPTIONS,
  GESTURE_ACTIONS,
  MODE_OPTIONS,
  SCENE_OPTIONS,
} from '../../src/core/comic/comicReaderSheets';
import type {
  ComicMode as SheetsMode,
  ComicDirection as SheetsDirection,
  ComicScene as SheetsScene,
  ComicGestureAction as SheetsGestureAction,
} from '../../src/core/comic/comicReaderSheets';
// 两处镜像现在只在类型层面比对（见下面 `Equals` 的说明），所以是 type-only import。
import type * as PortTypes from '../../src/core/comic/comicPortTypes';
import type * as ReaderCore from '../../src/core/comic/comicReaderCore';

/**
 * Kotlin 枚举原文（顺序 = ordinal）。这个数组是**人肉从 Kotlin 抄的**，
 * 与 TS 表一一对照，任一侧改动都会让下面的 it() 失败。
 */
const KOTLIN_ENUMS: ReadonlyArray<{
  readonly kotlin: string
  readonly type: string
  readonly values: readonly string[]
  readonly ordinals: Readonly<Record<string, number>>
  readonly labels: Readonly<Record<string, string>>
  readonly descs?: Readonly<Record<string, string>>
}> = [
  {
    kotlin: 'ComicReaderConfig.kt L243-245',
    type: 'ComicMode',
    // enum class ComicMode(val label: String) { SINGLE("单页"), DOUBLE("双页"),
    //   WEBTOON("条漫"), CONTINUOUS("无缝滚动"), MAGNETIC("磁吸") }
    values: ['SINGLE', 'DOUBLE', 'WEBTOON', 'CONTINUOUS', 'MAGNETIC'],
    ordinals: { SINGLE: 0, DOUBLE: 1, WEBTOON: 2, CONTINUOUS: 3, MAGNETIC: 4 },
    labels: {
      SINGLE: '单页',
      DOUBLE: '双页',
      WEBTOON: '条漫',
      CONTINUOUS: '无缝滚动',
      MAGNETIC: '磁吸',
    },
  },
  {
    kotlin: 'ComicReaderConfig.kt L248-250',
    type: 'ComicDirection',
    // enum class ComicDirection(val label: String) {
    //   LTR("左 → 右"), RTL("右 → 左"), TTB("上 → 下") }
    values: ['LTR', 'RTL', 'TTB'],
    ordinals: { LTR: 0, RTL: 1, TTB: 2 },
    // U+2192 RIGHTWARDS ARROW，逐字保留（协议要求核对字节）
    labels: { LTR: '左 → 右', RTL: '右 → 左', TTB: '上 → 下' },
  },
  {
    kotlin: 'ComicReaderConfig.kt L262-265',
    type: 'ComicFit',
    // enum class ComicFit(val label: String) {
    //   FIT_WIDTH("适应宽度"), FIT_HEIGHT("适应高度"), ORIGINAL("原始大小"),
    //   FILL("铺满裁切"), STRETCH("拉伸铺满"), FIT_PAGE("整页"), CUSTOM("自定义") }
    values: ['FIT_WIDTH', 'FIT_HEIGHT', 'ORIGINAL', 'FILL', 'STRETCH', 'FIT_PAGE', 'CUSTOM'],
    ordinals: {
      FIT_WIDTH: 0,
      FIT_HEIGHT: 1,
      ORIGINAL: 2,
      FILL: 3,
      STRETCH: 4,
      FIT_PAGE: 5,
      CUSTOM: 6,
    },
    labels: {
      FIT_WIDTH: '适应宽度',
      FIT_HEIGHT: '适应高度',
      ORIGINAL: '原始大小',
      FILL: '铺满裁切',
      STRETCH: '拉伸铺满',
      FIT_PAGE: '整页',
      CUSTOM: '自定义',
    },
  },
  {
    kotlin: 'ComicReaderConfig.kt L268-270',
    type: 'ComicDoubleAlign',
    // enum class ComicDoubleAlign(val label: String) {
    //   TOP("顶部对齐"), CENTER("居中对齐"), BOTTOM("底部对齐") }
    values: ['TOP', 'CENTER', 'BOTTOM'],
    ordinals: { TOP: 0, CENTER: 1, BOTTOM: 2 },
    labels: { TOP: '顶部对齐', CENTER: '居中对齐', BOTTOM: '底部对齐' },
  },
  {
    kotlin: 'ComicReaderConfig.kt L273-275',
    type: 'ComicCropMode',
    // enum class ComicCropMode(val label: String) {
    //   OFF("关闭"), WHITE("裁白边"), BLACK("裁黑边"), AUTO("自动识别") }
    values: ['OFF', 'WHITE', 'BLACK', 'AUTO'],
    ordinals: { OFF: 0, WHITE: 1, BLACK: 2, AUTO: 3 },
    labels: { OFF: '关闭', WHITE: '裁白边', BLACK: '裁黑边', AUTO: '自动识别' },
  },
  {
    kotlin: 'ComicReaderConfig.kt L281-287',
    type: 'ComicEnhanceMode',
    // enum class ComicEnhanceMode(val label: String, val desc: String) {
    //   OFF("关闭", ""),
    //   CAS("锐化增强", "对比度自适应锐化，强化线条与小字（最快，约 0.5 秒/页）"),
    //   ANIME4K("Anime4K 轻量", "Anime4K Restore CNN 线条重建降噪，不放大（约 2-4 秒/页）"),
    //   WAIFU2X("超分 完整", "Anime4K Upscale CNN ×2 神经网络超分（低分辨率页收益最大；约 2-6 秒/页，处理时有预计耗时提示）"),
    //   SUPER_RES("超分辨率", "Lanczos 2× 重建 + 自适应锐化（低分辨率页翻倍清晰度）") }
    values: ['OFF', 'CAS', 'ANIME4K', 'WAIFU2X', 'SUPER_RES'],
    ordinals: { OFF: 0, CAS: 1, ANIME4K: 2, WAIFU2X: 3, SUPER_RES: 4 },
    labels: {
      OFF: '关闭',
      CAS: '锐化增强',
      ANIME4K: 'Anime4K 轻量',
      WAIFU2X: '超分 完整',
      SUPER_RES: '超分辨率',
    },
    descs: {
      OFF: '',
      CAS: '对比度自适应锐化，强化线条与小字（最快，约 0.5 秒/页）',
      ANIME4K: 'Anime4K Restore CNN 线条重建降噪，不放大（约 2-4 秒/页）',
      WAIFU2X: 'Anime4K Upscale CNN ×2 神经网络超分（低分辨率页收益最大；约 2-6 秒/页，处理时有预计耗时提示）',
      SUPER_RES: 'Lanczos 2× 重建 + 自适应锐化（低分辨率页翻倍清晰度）',
    },
  },
  {
    kotlin: 'ComicReaderConfig.kt L290-292',
    type: 'ComicBgType',
    // enum class ComicBgType(val label: String) {
    //   BLACK("纯黑"), WHITE("纯白"), GRAY("深灰"), PAPER("纸张纹理"), DYNAMIC("沉浸动态") }
    values: ['BLACK', 'WHITE', 'GRAY', 'PAPER', 'DYNAMIC'],
    ordinals: { BLACK: 0, WHITE: 1, GRAY: 2, PAPER: 3, DYNAMIC: 4 },
    labels: {
      BLACK: '纯黑',
      WHITE: '纯白',
      GRAY: '深灰',
      PAPER: '纸张纹理',
      DYNAMIC: '沉浸动态',
    },
  },
  {
    kotlin: 'ComicReaderConfig.kt L295-299',
    type: 'ComicScene',
    // enum class ComicScene(val label: String) {
    //   NONE("关闭"), RAIN("雨夜"), SNOW("落雪"), SAKURA("樱花"), FIREFLY("萤火"),
    //   OCEAN("海边"), CAMPFIRE("篝火"), NIGHT("夏夜") }
    values: ['NONE', 'RAIN', 'SNOW', 'SAKURA', 'FIREFLY', 'OCEAN', 'CAMPFIRE', 'NIGHT'],
    ordinals: { NONE: 0, RAIN: 1, SNOW: 2, SAKURA: 3, FIREFLY: 4, OCEAN: 5, CAMPFIRE: 6, NIGHT: 7 },
    labels: {
      NONE: '关闭',
      RAIN: '雨夜',
      SNOW: '落雪',
      SAKURA: '樱花',
      FIREFLY: '萤火',
      OCEAN: '海边',
      CAMPFIRE: '篝火',
      NIGHT: '夏夜',
    },
  },
  {
    kotlin: 'ComicReaderConfig.kt L302-304',
    type: 'ComicPageAnim',
    // enum class ComicPageAnim(val label: String) {
    //   NONE("无动画"), SLIDE("平移"), FADE("渐变"), CURL("仿真翻页") }
    values: ['NONE', 'SLIDE', 'FADE', 'CURL'],
    ordinals: { NONE: 0, SLIDE: 1, FADE: 2, CURL: 3 },
    labels: { NONE: '无动画', SLIDE: '平移', FADE: '渐变', CURL: '仿真翻页' },
  },
  {
    kotlin: 'ComicReaderConfig.kt L307-311',
    type: 'ComicGestureAction',
    // enum class ComicGestureAction(val label: String) {
    //   NONE("无操作"), PREV("上一页"), NEXT("下一页"),
    //   TOGGLE_CONTROLS("呼出/隐藏控制"), TOC("目录"), SETTINGS("设置"), EXIT("退出") }
    values: ['NONE', 'PREV', 'NEXT', 'TOGGLE_CONTROLS', 'TOC', 'SETTINGS', 'EXIT'],
    ordinals: { NONE: 0, PREV: 1, NEXT: 2, TOGGLE_CONTROLS: 3, TOC: 4, SETTINGS: 5, EXIT: 6 },
    labels: {
      NONE: '无操作',
      PREV: '上一页',
      NEXT: '下一页',
      TOGGLE_CONTROLS: '呼出/隐藏控制',
      TOC: '目录',
      SETTINGS: '设置',
      EXIT: '退出',
    },
  },
];

interface TSEnumTable {
  values: readonly string[]
  ordinals: Readonly<Record<string, number>>
  labels: Readonly<Record<string, string>>
  descs?: Readonly<Record<string, string>>
}

const TS_TABLES: Readonly<Record<string, TSEnumTable>> = {
  ComicMode: {
    values: COMIC_MODE_VALUES,
    ordinals: COMIC_MODE_ORDINAL,
    labels: COMIC_MODE_LABEL,
  },
  ComicDirection: {
    values: COMIC_DIRECTION_VALUES,
    ordinals: COMIC_DIRECTION_ORDINAL,
    labels: COMIC_DIRECTION_LABEL,
  },
  ComicFit: {
    values: COMIC_FIT_VALUES,
    ordinals: COMIC_FIT_ORDINAL,
    labels: COMIC_FIT_LABEL,
  },
  ComicDoubleAlign: {
    values: COMIC_DOUBLE_ALIGN_VALUES,
    ordinals: COMIC_DOUBLE_ALIGN_ORDINAL,
    labels: COMIC_DOUBLE_ALIGN_LABEL,
  },
  ComicCropMode: {
    values: COMIC_CROP_MODE_VALUES,
    ordinals: COMIC_CROP_MODE_ORDINAL,
    labels: COMIC_CROP_MODE_LABEL,
  },
  ComicEnhanceMode: {
    values: COMIC_ENHANCE_MODE_VALUES,
    ordinals: COMIC_ENHANCE_MODE_ORDINAL,
    labels: COMIC_ENHANCE_MODE_LABEL,
    descs: COMIC_ENHANCE_MODE_DESC,
  },
  ComicBgType: {
    values: COMIC_BG_TYPE_VALUES,
    ordinals: COMIC_BG_TYPE_ORDINAL,
    labels: COMIC_BG_TYPE_LABEL,
  },
  ComicScene: {
    values: COMIC_SCENE_VALUES,
    ordinals: COMIC_SCENE_ORDINAL,
    labels: COMIC_SCENE_LABEL,
  },
  ComicPageAnim: {
    values: COMIC_PAGE_ANIM_VALUES,
    ordinals: COMIC_PAGE_ANIM_ORDINAL,
    labels: COMIC_PAGE_ANIM_LABEL,
  },
  ComicGestureAction: {
    values: COMIC_GESTURE_ACTION_VALUES,
    ordinals: COMIC_GESTURE_ACTION_ORDINAL,
    labels: COMIC_GESTURE_ACTION_LABEL,
  },
};

/** `TS_TABLES` 的键集合由下方「十个枚举一个都不少」钉死；这里只把
 *  `noUncheckedIndexedAccess` 产生的 `| undefined` 收敛掉，缺键立刻抛错（即失败）。 */
function tableOf(type: string): TSEnumTable {
  const table = TS_TABLES[type];
  if (table === undefined) throw new Error(`TS_TABLES 缺少枚举 ${type}`);
  return table;
}

describe('枚举契约 · ComicReaderConfig.kt L242-311 ↔ comicReaderConfig.ts', () => {
  it('十个枚举一个都不少', () => {
    expect(KOTLIN_ENUMS.map((e) => e.type)).toEqual(Object.keys(TS_TABLES));
  });

  for (const spec of KOTLIN_ENUMS) {
    const table = tableOf(spec.type);

    it(`${spec.type}（${spec.kotlin}）：声明顺序 === VALUES === ordinal 下标`, () => {
      // Kotlin `Enum.ordinal` = 声明顺序下标；VALUES 数组必须逐项同序
      expect([...table.values]).toEqual([...spec.values]);
      for (const [index, name] of spec.values.entries()) {
        expect(table.ordinals[name as keyof typeof table.ordinals]).toBe(index);
      }
    });

    it(`${spec.type}：label 逐字一致（含 U+2192 / 全角标点 / × 乘号）`, () => {
      for (const name of spec.values) {
        expect(table.labels[name as keyof typeof table.labels]).toBe(
          spec.labels[name as string],
        );
      }
      // 标签表不得有多余成员
      expect(Object.keys(table.labels).sort()).toEqual([...spec.values].sort());
    });
  }

  it('ComicEnhanceMode 的 desc 逐字一致（Kotlin L282-287 的 val desc）', () => {
    const descs = tableOf('ComicEnhanceMode').descs;
    expect(descs).toBeDefined();
    const expected = KOTLIN_ENUMS.find((e) => e.type === 'ComicEnhanceMode')?.descs;
    expect(descs).toEqual(expected);
  });

  it('ComicDirection 的三个标签保留 U+2192（RIGHTWARDS ARROW）', () => {
    for (const value of COMIC_DIRECTION_VALUES) {
      expect(COMIC_DIRECTION_LABEL[value]).toContain('\u2192');
    }
    // 逐字核对：空格 + 箭头 + 空格
    expect(COMIC_DIRECTION_LABEL.LTR).toBe('左 \u2192 右');
    expect(COMIC_DIRECTION_LABEL.RTL).toBe('右 \u2192 左');
    expect(COMIC_DIRECTION_LABEL.TTB).toBe('上 \u2192 下');
  });

  it('ComicEnhanceMode 的 desc 里保留 U+00D7（×）而不是字母 x', () => {
    // Kotlin 原文用的是 × (U+00D7)
    expect(COMIC_ENHANCE_MODE_DESC.WAIFU2X).toContain('\u00d7');
    expect(COMIC_ENHANCE_MODE_DESC.SUPER_RES).toContain('\u00d7');
    // × 只出现在 `val desc`（Kotlin L285-286）；L285 的 `val label` 是「超分 完整」，
    // 不含 × —— 所以这里断的是 desc，不是 label。
    expect(COMIC_ENHANCE_MODE_LABEL.WAIFU2X).toBe('超分 完整');
  });
});

describe('枚举契约 · 面板渲染顺序（comicReaderSheets.ts 的四个 options 表）', () => {
  // Kotlin ModeGrid / DirectionGrid / SceneOptionFlow / GestureTab 都是
  // `Xxx.entries.forEach { … }` 或 `Xxx.entries.map { ordinal to label }`，
  // 所以**渲染顺序 === 声明顺序**（grid 的视觉排列直接由它决定）。
  it('MODE_OPTIONS 顺序与 label === ComicMode 枚举（Kotlin L551 ModeGrid）', () => {
    expect(MODE_OPTIONS.map((o) => o.mode)).toEqual([...COMIC_MODE_VALUES]);
    for (const o of MODE_OPTIONS) {
      expect(o.label).toBe(COMIC_MODE_LABEL[o.mode as ComicMode]);
    }
  });

  it('DIRECTION_OPTIONS 顺序与 label === ComicDirection（Kotlin L589 DirectionGrid）', () => {
    expect(DIRECTION_OPTIONS.map((o) => o.direction)).toEqual([...COMIC_DIRECTION_VALUES]);
    for (const o of DIRECTION_OPTIONS) {
      expect(o.label).toBe(COMIC_DIRECTION_LABEL[o.direction as ComicDirection]);
    }
  });

  it('SCENE_OPTIONS 顺序与 label === ComicScene（Kotlin L1043-1052）', () => {
    expect(SCENE_OPTIONS.map((o) => o.scene)).toEqual([...COMIC_SCENE_VALUES]);
    for (const o of SCENE_OPTIONS) {
      expect(o.label).toBe(COMIC_SCENE_LABEL[o.scene as ComicScene]);
    }
  });

  it('GESTURE_ACTIONS 顺序与 label === ComicGestureAction（Kotlin L1248）', () => {
    expect(GESTURE_ACTIONS.map((o) => o.action)).toEqual([...COMIC_GESTURE_ACTION_VALUES]);
    for (const o of GESTURE_ACTIONS) {
      expect(o.label).toBe(COMIC_GESTURE_ACTION_LABEL[o.action as ComicGestureAction]);
    }
  });
});

/**
 * 镜像若少一个成员，面板把 config 传给镜像类型时会编译失败（这是好事）；
 * 这里再钉一层，防止将来有人在镜像里加成员而忘了加权威表。
 *
 * `comicPortTypes.ts` L24-35 已把八个枚举镜像**删除**，改为
 * `export type { … } from './comicReaderConfig'`（单一数据源），所以镜像侧
 * 只有类型、没有运行时 `_VALUES`；等价性只能在**类型层面**钉，用双向
 * `extends` 的恒等判定（成员少一个或多一个都会让 `Equals` 变成 `false`）。
 */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** 编译期断言：`T` 必须是 `true`，否则 tsc 报错（`ok` 本身在运行时不参与判断）。 */
function assertType<T extends true>(ok: T): void {
  expect(ok).toBe(true);
}

describe('枚举契约 · 三处镜像类型与权威表逐成员一致', () => {
  it('comicPortTypes.ts 的九个枚举联合 === comicReaderConfig.ts 的枚举', () => {
    assertType<Equals<PortTypes.ComicMode, ComicMode>>(true);
    assertType<Equals<PortTypes.ComicDirection, ComicDirection>>(true);
    assertType<Equals<PortTypes.ComicFit, ComicFit>>(true);
    assertType<Equals<PortTypes.ComicPageAnim, ComicPageAnim>>(true);
    assertType<Equals<PortTypes.ComicDoubleAlign, ComicDoubleAlign>>(true);
    assertType<Equals<PortTypes.ComicCropMode, ComicCropMode>>(true);
    assertType<Equals<PortTypes.ComicEnhanceMode, ComicEnhanceMode>>(true);
    assertType<Equals<PortTypes.ComicScene, ComicScene>>(true);
    assertType<Equals<PortTypes.ComicGestureAction, ComicGestureAction>>(true);
    // 运行时侧仍钉住权威表的成员数（镜像侧无运行时成员，见上面的注释）。
    expect(COMIC_MODE_VALUES).toHaveLength(5);
    expect(COMIC_DIRECTION_VALUES).toHaveLength(3);
    expect(COMIC_FIT_VALUES).toHaveLength(7);
    expect(COMIC_PAGE_ANIM_VALUES).toHaveLength(4);
  });

  it('comicReaderSheets.ts 的 ComicMode/ComicDirection/ComicScene/ComicGestureAction 与权威表同宽', () => {
    // 类型层面由 TS 保证；这里断言面板表本身没有多余成员
    const sheetsModes: readonly SheetsMode[] = MODE_OPTIONS.map((o) => o.mode);
    expect(sheetsModes).toEqual([...COMIC_MODE_VALUES]);
    const sheetsDirections: readonly SheetsDirection[] = DIRECTION_OPTIONS.map((o) => o.direction);
    expect(sheetsDirections).toEqual([...COMIC_DIRECTION_VALUES]);
    const sheetsScenes: readonly SheetsScene[] = SCENE_OPTIONS.map((o) => o.scene);
    expect(sheetsScenes).toEqual([...COMIC_SCENE_VALUES]);
    const sheetsActions: readonly SheetsGestureAction[] = GESTURE_ACTIONS.map((o) => o.action);
    expect(sheetsActions).toEqual([...COMIC_GESTURE_ACTION_VALUES]);
  });

  it('comicReaderCore.ts 的 ComicMode/ComicDirection 镜像同宽', () => {
    // `comicReaderCore.ts` 只声明类型（无运行时 `_VALUES` 表），所以这里同样
    // 用编译期的双向 `extends` 恒等判定；成员顺序则由上面的 VALUES 断言负责。
    assertType<Equals<ReaderCore.ComicMode, ComicMode>>(true);
    assertType<Equals<ReaderCore.ComicDirection, ComicDirection>>(true);
    expect([...COMIC_MODE_VALUES]).toEqual(['SINGLE', 'DOUBLE', 'WEBTOON', 'CONTINUOUS', 'MAGNETIC']);
    expect([...COMIC_DIRECTION_VALUES]).toEqual(['LTR', 'RTL', 'TTB']);
  });
});

describe('枚举契约 · segment 辅助函数的 index 往返', () => {
  // ComicSettingsModeTab / PageTab / ImageTab / GestureTab 都用
  // 「index → 枚举」与「枚举 → index」两个函数驱动 SegmentRow；
  // 二者必须互逆，否则点一下就跳到别的档。
  it('pageAnimIndex ∘ pageAnimByIndex === id', async () => {
    const m = await import('../../src/core/comic/comicReaderSheets');
    for (const value of COMIC_PAGE_ANIM_VALUES) {
      expect(m.pageAnimByIndex(m.pageAnimIndex(value as ComicPageAnim))).toBe(value);
    }
  });

  it('doubleAlignIndex ∘ doubleAlignByIndex === id', async () => {
    const m = await import('../../src/core/comic/comicReaderSheets');
    for (const value of COMIC_DOUBLE_ALIGN_VALUES) {
      expect(m.doubleAlignByIndex(m.doubleAlignIndex(value as ComicDoubleAlign))).toBe(value);
    }
  });

  it('cropModeIndex ∘ cropModeByIndex === id', async () => {
    const m = await import('../../src/core/comic/comicReaderSheets');
    for (const value of COMIC_CROP_MODE_VALUES) {
      expect(m.cropModeByIndex(m.cropModeIndex(value as ComicCropMode))).toBe(value);
    }
  });

  it('gestureIndexOf ∘ gestureActionByIndex === id', async () => {
    const m = await import('../../src/core/comic/comicReaderSheets');
    for (const value of COMIC_GESTURE_ACTION_VALUES) {
      expect(m.gestureActionByIndex(m.gestureIndexOf(value as ComicGestureAction))).toBe(value);
    }
  });

  it('enhanceSegmentIndexOf ∘ enhanceModeByIndex === id', async () => {
    const m = await import('../../src/core/comic/comicReaderSheets');
    for (const value of COMIC_ENHANCE_MODE_VALUES) {
      expect(m.enhanceModeByIndex(m.enhanceSegmentIndexOf(value as ComicEnhanceMode))).toBe(value);
    }
  });

  it('fitSegmentIndex ∘ fitBySegmentIndex 只在 FIT_OPTIONS 覆盖的 6 档上往返', async () => {
    const m = await import('../../src/core/comic/comicReaderSheets');
    // Kotlin L615-622：FIT_OPTIONS = FIT_PAGE, FIT_HEIGHT, ORIGINAL, FILL, STRETCH, CUSTOM
    const inOptions: readonly ComicFit[] = ['FIT_PAGE', 'FIT_HEIGHT', 'ORIGINAL', 'FILL', 'STRETCH', 'CUSTOM'];
    for (const value of inOptions) {
      expect(m.fitBySegmentIndex(m.fitSegmentIndex(value))).toBe(value);
    }
    // FIT_WIDTH 不在 FitOptions 里 → indexOfFirst 返回 -1 → coerceAtLeast(0) → 0
    expect(m.fitSegmentIndex('FIT_WIDTH')).toBe(0);
    expect(m.fitBySegmentIndex(0)).toBe('FIT_PAGE');
  });

  it('customFitBaseSegmentIndex ∘ customFitBaseBySegmentIndex === id（四档全覆盖）', async () => {
    const m = await import('../../src/core/comic/comicReaderSheets');
    const bases: readonly ComicFit[] = ['FIT_PAGE', 'FIT_WIDTH', 'FIT_HEIGHT', 'ORIGINAL'];
    for (const value of bases) {
      expect(m.customFitBaseBySegmentIndex(m.customFitBaseSegmentIndex(value))).toBe(value);
    }
  });
});
