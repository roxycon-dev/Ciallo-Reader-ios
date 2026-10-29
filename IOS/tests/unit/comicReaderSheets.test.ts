/**
 * comicReaderSheets.test.ts — `src/core/comic/comicReaderSheets.ts` 纯逻辑单测。
 *
 * 覆盖 Android `ComicReaderSheets.kt`（1872 行）中可脱离 Compose 的部分：
 *   - 132–149   设置分组 Tab 文案与顺序
 *   - 357/401  页面文字语言下标 ↔ 代码
 *   - 370–388  翻译引擎状态文案
 *   - 416–502  OCR 模型 / 缓存文案（31MB、64MB、进度百分比、错误文案）
 *   - 505–610  阅读模式 / 阅读方向选项（标签逐字比对）
 *   - 614–625  缩放档位与 fitLabel
 *   - 837–861  旋转归一化 / 单页旋转 +90 / 临时合页
 *   - 866–915  画质增强（label + desc）与滤镜重置补丁
 *   - 978–1092 背景色卡（含 0x 值）与场景选项
 *   - 1243–1276 手势动作（7 项顺序与标签）
 *   - 1393–1608 收藏置顶稳定排序 / 新建预设默认名与 emoji
 *   - 1645–1872 裁边钳制（最小 5%）/ 贴边判定 / 命中判定 / 拖动派生 / 百分比读数
 */
import { describe, expect, it } from 'vitest';
import {
  ACCENT_COLOR,
  BG_SWATCHES,
  CUSTOM_FIT_BASES,
  DEFAULT_CROP,
  DIRECTION_OPTIONS,
  ENHANCE_OPTIONS,
  FIT_OPTIONS,
  GESTURE_ACTIONS,
  LLM_SAVE_ERROR,
  MIN_CROP_SIZE,
  MODE_OPTIONS,
  OCR_MODEL_MB,
  OCR_MODEL_READY_LABEL,
  OCR_MODEL_SIZE_HINT,
  PRESET_DEFAULT_NAME,
  PRESET_NAME_MAX_LEN,
  SCENE_OPTIONS,
  SETTINGS_TABS,
  TRANSLATION_CACHE_LIMIT_MB,
  aiEngineState,
  applyCropHandleDrag,
  clampCrop,
  clampPresetName,
  cropHandleFromPoint,
  cropInsetsLabel,
  cropModeByIndex,
  cropModeIndex,
  cropTouchesEdge,
  customFitBaseBySegmentIndex,
  customFitBaseSegmentIndex,
  downloadErrorLabel,
  downloadProgressLabel,
  doubleAlignByIndex,
  doubleAlignIndex,
  enhanceModeByIndex,
  enhanceOption,
  enhanceSegmentIndexOf,
  fitBySegmentIndex,
  fitLabel,
  fitSegmentIndex,
  formatDegrees,
  formatDp,
  formatDpPerSec,
  formatGamma,
  formatInt,
  formatPercent,
  formatScalePercent,
  formatSeconds,
  formatSplitPosition,
  gestureActionByIndex,
  gestureIndexOf,
  imagePipelineFingerprint,
  isAiConfigured,
  mergeAnchorLabel,
  nextPageRotation,
  normalizeBookRotation,
  onlineEngineState,
  pageAnimByIndex,
  pageAnimIndex,
  pageRotationFor,
  presetEmojiFromName,
  presetNameOrFallback,
  presetSubtitle,
  scaleToTranslationTextScale,
  sortPresetsFavoritesFirst,
  toggleMergeAnchor,
  translationCacheLabel,
  translationLangByIndex,
  translationLangIndex,
  TRANSLATION_LANG_SEGMENT,
  type ComicSheetsConfig,
} from '../../src/core/comic/comicReaderSheets';

const CONFIG: ComicSheetsConfig = {
  mode: 'SINGLE',
  direction: 'RTL',
  webtoonSnap: true,
  fit: 'FIT_WIDTH',
  customFitBase: 'FIT_PAGE',
  customFitScale: 1,
  pageSpacingDp: 8,
  doubleGapDp: 8,
  doubleFirstAlone: false,
  doubleAlign: 'CENTER',
  doubleShiftXDp: 0,
  doubleShiftYDp: 0,
  doubleTapZoom: true,
  longPressZoom: true,
  zoomWhileTurn: false,
  bookRotation: 0,
  cropMode: 'OFF',
  manualCrop: null,
  splitWide: false,
  splitReverse: false,
  splitPosition: 0.5,
  enhanceMode: 'OFF',
  enhanceStrength: 60,
  filterBrightness: 0,
  filterContrast: 0,
  filterSaturation: 0,
  filterHue: 0,
  filterGamma: 1,
  filterSharpen: 0,
  filterShadow: 0,
  filterBW: false,
  bgType: 'BLACK',
  paperIntensity: 35,
  scene: 'NONE',
  sceneSound: true,
  sceneEffect: true,
  sceneVolume: 40,
  pageAnim: 'SLIDE',
  autoPageIntervalSec: 6,
  autoScrollSpeedDp: 40,
  gestureTapLeft: 'PREV',
  gestureTapRight: 'NEXT',
  gestureTapCenter: 'TOGGLE_CONTROLS',
  gestureSwipe: true,
  gesturePinchClose: true,
  gestureEdgeSwipe: true,
  gestureLongPressPanel: false,
  volumeKeyTurn: true,
  showThumbPreview: true,
  hideSystemBars: true,
  translationEnabled: false,
  translationLang: 'auto',
  translationTextScale: 1,
  translationEngine: 'online',
};

describe('comicReaderSheets — 设置分组 Tab（Kotlin 141–149）', () => {
  it('七个 Tab 的顺序与文案逐字一致', () => {
    expect(SETTINGS_TABS.map((t) => t.label)).toEqual([
      '翻页',
      '显示',
      '图像',
      '翻译',
      '主题',
      '自动',
      '手势',
    ]);
  });

  it('Tab 图标名保留 Material 命名', () => {
    expect(SETTINGS_TABS.map((t) => t.icon)).toEqual([
      'MenuBook',
      'Visibility',
      'Image',
      'Translate',
      'Palette',
      'Schedule',
      'PanTool',
    ]);
  });

  it('AccentColor = 0xFFF0D9C0（Kotlin 134）', () => {
    expect(ACCENT_COLOR.toUpperCase()).toBe('#F0D9C0');
  });
});

describe('comicReaderSheets — 阅读模式 / 方向（Kotlin 505–610）', () => {
  it('五种模式标签逐字一致', () => {
    expect(MODE_OPTIONS.map((m) => m.label)).toEqual([
      '单页',
      '双页',
      '条漫',
      '无缝滚动',
      '磁吸',
    ]);
    expect(MODE_OPTIONS.map((m) => m.mode)).toEqual([
      'SINGLE',
      'DOUBLE',
      'WEBTOON',
      'CONTINUOUS',
      'MAGNETIC',
    ]);
  });

  it('三种方向标签带箭头（左右箭头为 U+2192）', () => {
    expect(DIRECTION_OPTIONS.map((d) => d.label)).toEqual(['左 → 右', '右 → 左', '上 → 下']);
  });

  it('翻页动画分段与下标互换', () => {
    expect(pageAnimByIndex(0)).toBe('NONE');
    expect(pageAnimByIndex(1)).toBe('SLIDE');
    expect(pageAnimByIndex(2)).toBe('FADE');
    expect(pageAnimByIndex(3)).toBe('CURL');
    expect(pageAnimIndex('CURL')).toBe(3);
    expect(pageAnimIndex('NONE')).toBe(0);
  });
});

describe('comicReaderSheets — 缩放档（Kotlin 614–655）', () => {
  it('FitOptions 序列与 Kotlin 615–622 一致', () => {
    expect(FIT_OPTIONS.map((f) => f[0])).toEqual([
      'FIT_PAGE',
      'FIT_HEIGHT',
      'ORIGINAL',
      'FILL',
      'STRETCH',
      'CUSTOM',
    ]);
    expect(FIT_OPTIONS.map((f) => f[1])).toEqual(['整页', '高度', '原始', '铺满', '拉伸', '自定义']);
  });

  it('fitLabel 对未列入的 FIT_WIDTH 返回「适应宽度」', () => {
    expect(fitLabel('FIT_WIDTH')).toBe('适应宽度');
    expect(fitLabel('FIT_PAGE')).toBe('整页');
    expect(fitLabel('CUSTOM')).toBe('自定义');
  });

  it('FIT_WIDTH 不在序列中 → index 钳到 0', () => {
    expect(fitSegmentIndex('FIT_WIDTH')).toBe(0);
    expect(fitSegmentIndex('CUSTOM')).toBe(5);
    expect(fitBySegmentIndex(5)).toBe('CUSTOM');
  });

  it('自定义基础适配四档顺序为 FIT_PAGE/FIT_WIDTH/FIT_HEIGHT/ORIGINAL', () => {
    expect(CUSTOM_FIT_BASES.map((f) => f[0])).toEqual([
      'FIT_PAGE',
      'FIT_WIDTH',
      'FIT_HEIGHT',
      'ORIGINAL',
    ]);
    expect(customFitBaseSegmentIndex('FIT_HEIGHT')).toBe(2);
    expect(customFitBaseBySegmentIndex(2)).toBe('FIT_HEIGHT');
  });
});

describe('comicReaderSheets — 裁边模式 / 双页对齐（Kotlin 735–793）', () => {
  it('双页对齐下标互换', () => {
    expect(doubleAlignIndex('TOP')).toBe(0);
    expect(doubleAlignIndex('CENTER')).toBe(1);
    expect(doubleAlignIndex('BOTTOM')).toBe(2);
    expect(doubleAlignByIndex(2)).toBe('BOTTOM');
  });

  it('自动裁边四档下标互换', () => {
    expect(cropModeIndex('OFF')).toBe(0);
    expect(cropModeIndex('AUTO')).toBe(3);
    expect(cropModeByIndex(1)).toBe('WHITE');
  });
});

describe('comicReaderSheets — 旋转与临时合页（Kotlin 837–861）', () => {
  it('bookRotation 归一化到 0..359', () => {
    expect(normalizeBookRotation(0)).toBe(0);
    expect(normalizeBookRotation(360)).toBe(0);
    expect(normalizeBookRotation(-90)).toBe(270);
    expect(normalizeBookRotation(450)).toBe(90);
  });

  it('单页旋转 +90° 循环', () => {
    expect(nextPageRotation(0)).toBe(90);
    expect(nextPageRotation(270)).toBe(0);
  });

  it('pageRotationFor 缺省为 0，pageId 为 null 时无副作用', () => {
    expect(pageRotationFor({}, 'p1')).toBe(0);
    expect(pageRotationFor({ p1: 180 }, 'p1')).toBe(180);
    expect(pageRotationFor({ p1: 180 }, null)).toBeNull();
  });

  it('临时合页锚点可加可删且不改动原集合', () => {
    const base = new Set<number>([1, 5]);
    expect([...toggleMergeAnchor(base, 3)].sort((a, b) => a - b)).toEqual([1, 3, 5]);
    expect([...toggleMergeAnchor(base, 5)].sort((a, b) => a - b)).toEqual([1]);
    expect([...base].sort((a, b) => a - b)).toEqual([1, 5]);
  });

  it('合页按钮文案随锚点状态切换', () => {
    expect(mergeAnchorLabel(new Set<number>(), 4)).toBe('与下一页临时合页');
    expect(mergeAnchorLabel(new Set<number>([4]), 4)).toBe('取消临时合页');
  });
});

describe('comicReaderSheets — 画质增强（Kotlin 866–881）', () => {
  it('五档 label/desc 与 Kotlin 282–286 逐字一致', () => {
    expect(ENHANCE_OPTIONS.map((e) => e.label)).toEqual([
      '关闭',
      '锐化增强',
      'Anime4K 轻量',
      '超分 完整',
      '超分辨率',
    ]);
    expect(ENHANCE_OPTIONS[0]!.desc).toBe('');
    expect(ENHANCE_OPTIONS[1]!.desc).toBe(
      '对比度自适应锐化，强化线条与小字（最快，约 0.5 秒/页）',
    );
    expect(enhanceOption('WAIFU2X').desc).toBe(
      'Anime4K Upscale CNN ×2 神经网络超分（低分辨率页收益最大；约 2-6 秒/页，处理时有预计耗时提示）',
    );
  });

  it('增强引擎下标互换', () => {
    expect(enhanceSegmentIndexOf('ANIME4K')).toBe(2);
    expect(enhanceModeByIndex(4)).toBe('SUPER_RES');
    expect(enhanceModeByIndex(99)).toBe('OFF');
  });
});

describe('comicReaderSheets — 背景色卡（Kotlin 979–1037）', () => {
  it('五个色卡的标签与 Compose Color 字面量原样', () => {
    expect(BG_SWATCHES.map((s) => s.label)).toEqual(['纯黑', '纯白', '深灰', '纸张', '沉浸']);
    expect(BG_SWATCHES.map((s) => s.fill.toUpperCase())).toEqual([
      '#0A0A0C',
      '#FAFAF7',
      '#2A2A2E',
      '#E9E2D0',
      '#35323A',
    ]);
  });
});

describe('comicReaderSheets — 场景（Kotlin 1043–1052）', () => {
  it('八个场景的标签与图标名', () => {
    expect(SCENE_OPTIONS.map((s) => s.scene)).toEqual([
      'NONE',
      'RAIN',
      'SNOW',
      'SAKURA',
      'FIREFLY',
      'OCEAN',
      'CAMPFIRE',
      'NIGHT',
    ]);
    expect(SCENE_OPTIONS.map((s) => s.label)).toEqual([
      '关闭',
      '雨夜',
      '落雪',
      '樱花',
      '萤火',
      '海边',
      '篝火',
      '夏夜',
    ]);
    expect(SCENE_OPTIONS[4]!.icon).toBe('AutoAwesome');
  });
});

describe('comicReaderSheets — 手势动作（Kotlin 1248）', () => {
  it('七项动作顺序与中文标签逐字一致', () => {
    expect(GESTURE_ACTIONS.map((g) => g.action)).toEqual([
      'NONE',
      'PREV',
      'NEXT',
      'TOGGLE_CONTROLS',
      'TOC',
      'SETTINGS',
      'EXIT',
    ]);
    expect(GESTURE_ACTIONS.map((g) => g.label)).toEqual([
      '无操作',
      '上一页',
      '下一页',
      '呼出/隐藏控制',
      '目录',
      '设置',
      '退出',
    ]);
  });

  it('动作下标互换', () => {
    expect(gestureIndexOf('TOC')).toBe(4);
    expect(gestureActionByIndex(6)).toBe('EXIT');
    expect(gestureActionByIndex(-1)).toBe('NONE');
  });
});

describe('comicReaderSheets — 翻译 Tab 文案（Kotlin 357–502）', () => {
  it('页面文字三档', () => {
    expect(TRANSLATION_LANG_SEGMENT.map((o) => o.label)).toEqual(['自动识别', '日文', '英文']);
    expect(translationLangIndex('ja')).toBe(1);
    expect(translationLangIndex('en')).toBe(2);
    expect(translationLangIndex('ko')).toBe(0);
    expect(translationLangIndex('auto')).toBe(0);
    expect(translationLangByIndex(1)).toBe('ja');
    expect(translationLangByIndex(2)).toBe('en');
    expect(translationLangByIndex(0)).toBe('auto');
  });

  it('AI 引擎卡片三态文案', () => {
    expect(isAiConfigured('https://x', 'deepseek-chat')).toBe(true);
    expect(isAiConfigured('  ', 'deepseek-chat')).toBe(false);
    expect(isAiConfigured('https://x', ' ')).toBe(false);
    expect(aiEngineState('ai', true)).toBe('当前使用 · 已配置');
    expect(aiEngineState('online', true)).toBe('已配置 · 点击选用并配置');
    expect(aiEngineState('online', false)).toBe('未配置 · 点击选用并配置');
  });

  it('在线引擎卡片两态文案', () => {
    expect(onlineEngineState('online')).toBe('当前使用');
    expect(onlineEngineState('ai')).toBe('点击选用');
  });

  it('离线模型文案固定 31MB', () => {
    expect(OCR_MODEL_MB).toBe(31);
    expect(OCR_MODEL_READY_LABEL).toBe('OCR 模型（约 31MB，已下载）');
    expect(OCR_MODEL_SIZE_HINT).toBe('需要下载离线 OCR 模型（约 31MB，仅一次）');
  });

  it('缓存标签使用 Long 整除（截断而非四舍五入）', () => {
    expect(TRANSLATION_CACHE_LIMIT_MB).toBe(64);
    expect(translationCacheLabel(0)).toBe('已缓存译文（0MB / 64MB）');
    expect(translationCacheLabel(1024 * 1024)).toBe('已缓存译文（1MB / 64MB）');
    expect(translationCacheLabel(1024 * 1024 * 3.9)).toBe('已缓存译文（3MB / 64MB）');
    expect(translationCacheLabel(1024 * 1024 * 64)).toBe('已缓存译文（64MB / 64MB）');
  });

  it('下载进度按 Float.toInt 截断', () => {
    expect(downloadProgressLabel(0)).toBe('正在下载模型 0%');
    expect(downloadProgressLabel(0.567)).toBe('正在下载模型 56%');
    expect(downloadProgressLabel(1)).toBe('正在下载模型 100%');
  });

  it('下载失败与 LLM 保存失败文案', () => {
    expect(downloadErrorLabel('网络异常')).toBe('下载失败：网络异常（可切换网络后重试）');
    expect(LLM_SAVE_ERROR).toBe('配置保存失败');
  });
});

describe('comicReaderSheets — 预设（Kotlin 1589–1625, 1420, 1472）', () => {
  it('收藏置顶为稳定排序，组内保持原相对顺序', () => {
    const list = [
      { id: 'a', favorite: false },
      { id: 'b', favorite: true },
      { id: 'c', favorite: false },
      { id: 'd', favorite: true },
    ];
    expect(sortPresetsFavoritesFirst(list).map((p) => p.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(list.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('新建预设的默认名与 emoji', () => {
    expect(PRESET_DEFAULT_NAME).toBe('我的预设');
    expect(presetNameOrFallback('', PRESET_DEFAULT_NAME)).toBe('我的预设');
    expect(presetNameOrFallback('  ', PRESET_DEFAULT_NAME)).toBe('我的预设');
    expect(presetNameOrFallback('夜间', PRESET_DEFAULT_NAME)).toBe('夜间');
    expect(presetEmojiFromName('')).toBe('SC');
    expect(presetEmojiFromName('   ')).toBe('SC');
    expect(presetEmojiFromName('日漫')).toBe('日漫');
    expect(presetEmojiFromName('夜')).toBe('夜');
    expect(presetEmojiFromName('夜读模式')).toBe('夜读');
  });

  it('预设名上限 12 字符（Kotlin 1625 take(12)）', () => {
    expect(PRESET_NAME_MAX_LEN).toBe(12);
    expect(clampPresetName('一二三四五六七八九十十一十二十三')).toBe('一二三四五六七八九十十一');
  });

  it('副标题为 模式 · 方向 · 动画', () => {
    expect(presetSubtitle(CONFIG)).toBe('单页 · 右 → 左 · 平移');
    expect(presetSubtitle({ ...CONFIG, mode: 'WEBTOON', direction: 'TTB', pageAnim: 'CURL' })).toBe(
      '条漫 · 上 → 下 · 仿真翻页',
    );
  });
});

describe('comicReaderSheets — 格式化（Kotlin 475–1238）', () => {
  it('各类 format 与 Kotlin 字符串模板一致', () => {
    expect(formatPercent(80)).toBe('80%');
    expect(formatPercent(133.9)).toBe('133%');
    expect(formatScalePercent(1.5)).toBe('150%');
    expect(formatScalePercent(0.5)).toBe('50%');
    expect(formatDp(8)).toBe('8 dp');
    expect(formatDp(-12.7)).toBe('-12 dp');
    expect(formatSplitPosition(0.5)).toBe('50%');
    expect(formatSplitPosition(0.333)).toBe('33%');
    expect(formatDegrees(-180)).toBe('-180°');
    expect(formatGamma(1)).toBe('1.00');
    expect(formatGamma(2.2)).toBe('2.20');
    expect(formatInt(60)).toBe('60');
    expect(formatSeconds(6)).toBe('6 秒');
    expect(formatDpPerSec(40)).toBe('40 dp/s');
  });

  it('译文字号换算钳制在 0.8..1.4', () => {
    expect(scaleToTranslationTextScale(100)).toBe(1);
    expect(scaleToTranslationTextScale(80)).toBe(0.8);
    expect(scaleToTranslationTextScale(140)).toBe(1.4);
    expect(scaleToTranslationTextScale(0)).toBe(0.8);
    expect(scaleToTranslationTextScale(999)).toBe(1.4);
  });
});

describe('comicReaderSheets — 手动裁边（Kotlin 1661–1872）', () => {
  it('默认裁剪框 0.06/0.06/0.94/0.94', () => {
    expect(DEFAULT_CROP).toEqual([0.06, 0.06, 0.94, 0.94]);
    expect(MIN_CROP_SIZE).toBe(0.05);
  });

  it('最小裁剪区 5% 双向钳制', () => {
    // 左边界不得越过 right - 5%
    expect(clampCrop([0.99, 0.06, 0.94, 0.94])[0]).toBeCloseTo(0.89, 10);
    // 右边界不得越过 left + 5%
    expect(clampCrop([0.06, 0.06, 0.11, 0.94])[2]).toBeCloseTo(0.11, 10);
    // 上下同规则
    expect(clampCrop([0.06, 0.99, 0.94, 0.94])[1]).toBeCloseTo(0.89, 10);
    expect(clampCrop([0.06, 0.06, 0.94, 0.11])[3]).toBeCloseTo(0.11, 10);
  });

  it('交叉矩形（右/下越到左/上外侧）退化为最小 5% 而不抛错', () => {
    // Kotlin 的 Float.coerceIn(min, max) 在 min > max 时抛 IllegalArgumentException，
    // 这里改为返回 lo（见 comicReaderSheets.ts clampCrop 注释）
    expect(clampCrop([0.06, 0.06, 0.0, 0.94])).toEqual([0, 0.06, 0.05, 0.94]);
    expect(clampCrop([0.06, 0.06, 0.94, 0.0])).toEqual([0.06, 0, 0.94, 0.05]);
  });

  it('clampCrop 不修改入参', () => {
    const input = [0.5, 0.5, 0.5, 0.5];
    clampCrop(input);
    expect(input).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('贴边判定：任一边贴 0 或 1 即触发', () => {
    expect(cropTouchesEdge([0, 0.3, 0.9, 0.9])).toBe(true);
    expect(cropTouchesEdge([0.3, 0, 0.9, 0.9])).toBe(true);
    expect(cropTouchesEdge([0.3, 0.3, 1, 0.9])).toBe(true);
    expect(cropTouchesEdge([0.3, 0.3, 0.9, 1])).toBe(true);
    expect(cropTouchesEdge([0.3, 0.3, 0.9, 0.9])).toBe(false);
  });

  it('百分比读数格式 L/T/R/B（右边距用 1-right）', () => {
    expect(cropInsetsLabel([0.06, 0.06, 0.94, 0.94])).toBe('L 6% · T 6% · R 6% · B 6%');
    expect(cropInsetsLabel([0, 0, 1, 1])).toBe('L 0% · T 0% · R 0% · B 0%');
    expect(cropInsetsLabel([0.1, 0.2, 0.8, 0.9])).toBe('L 10% · T 20% · R 20% · B 10%');
  });

  it('命中判定：角优先于边，半径 14*1.6=22.4px', () => {
    const crop = [0.1, 0.1, 0.9, 0.9];
    const w = 1000;
    const h = 1000;
    // 0 号角（左上）
    expect(cropHandleFromPoint(crop, w, h, 100, 100)).toBe(0);
    // 1 号角（右上）
    expect(cropHandleFromPoint(crop, w, h, 900, 100)).toBe(1);
    // 2 号角（左下）
    expect(cropHandleFromPoint(crop, w, h, 100, 900)).toBe(2);
    // 3 号角（右下）
    expect(cropHandleFromPoint(crop, w, h, 900, 900)).toBe(3);
    // 4 号边（上中）
    expect(cropHandleFromPoint(crop, w, h, 500, 100)).toBe(4);
    // 5 号边（下中）
    expect(cropHandleFromPoint(crop, w, h, 500, 900)).toBe(5);
    // 6 号边（左中）
    expect(cropHandleFromPoint(crop, w, h, 100, 500)).toBe(6);
    // 7 号边（右中）
    expect(cropHandleFromPoint(crop, w, h, 900, 500)).toBe(7);
    // 远离所有手柄
    expect(cropHandleFromPoint(crop, w, h, 500, 500)).toBe(-1);
  });

  it('拖动派生：四角同时改两值，边只改一值', () => {
    const crop = [0.2, 0.2, 0.8, 0.8];
    expect(applyCropHandleDrag(crop, 0, 0.1, 0.15)).toEqual([0.1, 0.15, 0.8, 0.8]);
    expect(applyCropHandleDrag(crop, 1, 0.9, 0.15)).toEqual([0.2, 0.15, 0.9, 0.8]);
    expect(applyCropHandleDrag(crop, 2, 0.1, 0.9)).toEqual([0.1, 0.2, 0.8, 0.9]);
    expect(applyCropHandleDrag(crop, 3, 0.9, 0.9)).toEqual([0.2, 0.2, 0.9, 0.9]);
    expect(applyCropHandleDrag(crop, 4, 0.5, 0.1)).toEqual([0.2, 0.1, 0.8, 0.8]);
    expect(applyCropHandleDrag(crop, 5, 0.5, 0.95)).toEqual([0.2, 0.2, 0.8, 0.95]);
    expect(applyCropHandleDrag(crop, 6, 0.05, 0.5)).toEqual([0.05, 0.2, 0.8, 0.8]);
    expect(applyCropHandleDrag(crop, 7, 0.95, 0.5)).toEqual([0.2, 0.2, 0.95, 0.8]);
  });

  it('拖动坐标超出范围时钳到 0..1', () => {
    const crop = [0.2, 0.2, 0.8, 0.8];
    expect(applyCropHandleDrag(crop, 0, -0.4, 1.6)).toEqual([0, 1, 0.8, 0.8]);
  });

  it('拖动派生不修改入参（保证「派生基准 = 最新 crop」不被就地改写）', () => {
    const crop = [0.2, 0.2, 0.8, 0.8];
    applyCropHandleDrag(crop, 0, 0.05, 0.05);
    expect(crop).toEqual([0.2, 0.2, 0.8, 0.8]);
  });
});

describe('comicReaderSheets — 预览指纹（Kotlin ComicReaderConfig 163–170）', () => {
  it('任一滤镜字段变化都会改变指纹', () => {
    const base = imagePipelineFingerprint(CONFIG);
    expect(base).toBe(
      imagePipelineFingerprint({ ...CONFIG, filterBrightness: 0, filterGamma: 1 }),
    );
    expect(imagePipelineFingerprint({ ...CONFIG, filterBrightness: 10 })).not.toBe(base);
    expect(imagePipelineFingerprint({ ...CONFIG, manualCrop: [0.1, 0.1, 0.9, 0.9] })).not.toBe(base);
    // null manualCrop → 空槽（Kotlin `manualCrop?.joinToString(",")` = "null"）
    expect(base.split('|')[1]).toBe('null');
  });

  it('gamma 用 3 位小数（Kotlin "%.3f"）', () => {
    expect(imagePipelineFingerprint({ ...CONFIG, filterGamma: 0.9 }).split('|')[11]).toBe('0.900');
  });
});
