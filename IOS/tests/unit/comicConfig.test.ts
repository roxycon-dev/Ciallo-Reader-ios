/**
 * comicConfig.test.ts — `ComicReaderConfig.kt` 端口的单元测试。
 *
 * 重点：**枚举 ↔ int（ordinal）全表**、默认值、toJson/fromJson 往返、全部
 *      `coerceIn` 钳位、`safe()` 的非法值回退、`optXxx` 的 Android JSONObject
 *      语义、`imagePipelineFingerprint`、`ComicBookState` 的两处 runCatching 兜底。
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/comic/ComicReaderConfig.kt
 * TS 源:    IOS/src/core/comic/comicReaderConfig.ts
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
  DEFAULT_COMIC_READER_CONFIG,
  EMPTY_COMIC_BOOK_STATE,
  TRANSLATION_ENGINES,
  TRANSLATION_LANGS,
  coerceIn,
  comicBookStateFromJson,
  comicBookStateToJson,
  comicReaderConfigFromJson,
  comicReaderConfigToJson,
  createComicReaderConfig,
  imagePipelineFingerprint,
  jsonArrayGetDouble,
  jsonArrayGetInt,
  optBoolean,
  optDouble,
  optInt,
  optJSONArray,
  optJSONObject,
  optString,
  optStringOrEmpty,
  takeIfIn,
  type ComicReaderConfig,
} from '../../src/core/comic/comicReaderConfig';
import {
  SPLIT_HALF_ORDINAL,
  type ComicBgType as PortBgType,
  type ComicCropMode as PortCropMode,
  type ComicDirection as PortDirection,
  type ComicDoubleAlign as PortDoubleAlign,
  type ComicEnhanceMode as PortEnhanceMode,
  type ComicFit as PortFit,
  type ComicGestureAction as PortGestureAction,
  type ComicMode as PortMode,
  type ComicPageAnim as PortPageAnim,
  type ComicScene as PortScene,
} from '../../src/core/comic/comicPortTypes';

describe('comicConfig — enum ↔ int (ordinal) full table', () => {
  // 这张表是 load-bearing：ordinal 是持久化的 int，声明顺序一旦改动，
  // 所有既有存档与缓存键都会静默损坏。
  const table: ReadonlyArray<{
    name: string;
    values: readonly string[];
    ordinals: Readonly<Record<string, number>>;
  }> = [
    {
      name: 'ComicMode (L243-245)',
      values: COMIC_MODE_VALUES,
      ordinals: COMIC_MODE_ORDINAL,
    },
    {
      name: 'ComicDirection (L248-250)',
      values: COMIC_DIRECTION_VALUES,
      ordinals: COMIC_DIRECTION_ORDINAL,
    },
    {
      name: 'ComicFit (L262-265)',
      values: COMIC_FIT_VALUES,
      ordinals: COMIC_FIT_ORDINAL,
    },
    {
      name: 'ComicDoubleAlign (L268-270)',
      values: COMIC_DOUBLE_ALIGN_VALUES,
      ordinals: COMIC_DOUBLE_ALIGN_ORDINAL,
    },
    {
      name: 'ComicCropMode (L273-275)',
      values: COMIC_CROP_MODE_VALUES,
      ordinals: COMIC_CROP_MODE_ORDINAL,
    },
    {
      name: 'ComicEnhanceMode (L281-287)',
      values: COMIC_ENHANCE_MODE_VALUES,
      ordinals: COMIC_ENHANCE_MODE_ORDINAL,
    },
    {
      name: 'ComicBgType (L290-292)',
      values: COMIC_BG_TYPE_VALUES,
      ordinals: COMIC_BG_TYPE_ORDINAL,
    },
    {
      name: 'ComicScene (L295-299)',
      values: COMIC_SCENE_VALUES,
      ordinals: COMIC_SCENE_ORDINAL,
    },
    {
      name: 'ComicPageAnim (L302-304)',
      values: COMIC_PAGE_ANIM_VALUES,
      ordinals: COMIC_PAGE_ANIM_ORDINAL,
    },
    {
      name: 'ComicGestureAction (L307-311)',
      values: COMIC_GESTURE_ACTION_VALUES,
      ordinals: COMIC_GESTURE_ACTION_ORDINAL,
    },
  ];

  table.forEach(({ name, values, ordinals }) => {
    it(`${name} maps declaration order 1:1 onto ordinal`, () => {
      values.forEach((value, index) => {
        expect(ordinals[value]).toBe(index);
      });
      // ordinal 是稠密的 0..n-1（Kotlin Enum.ordinal 的定义）
      expect(Object.keys(ordinals).sort()).toEqual([...values].sort());
    });
  });

  it('ComicMode ordinals are SINGLE=0 … MAGNETIC=4', () => {
    expect(COMIC_MODE_ORDINAL.SINGLE).toBe(0);
    expect(COMIC_MODE_ORDINAL.DOUBLE).toBe(1);
    expect(COMIC_MODE_ORDINAL.WEBTOON).toBe(2);
    expect(COMIC_MODE_ORDINAL.CONTINUOUS).toBe(3);
    expect(COMIC_MODE_ORDINAL.MAGNETIC).toBe(4);
  });

  it('ComicDirection ordinals are LTR=0, RTL=1, TTB=2', () => {
    expect(COMIC_DIRECTION_ORDINAL.LTR).toBe(0);
    expect(COMIC_DIRECTION_ORDINAL.RTL).toBe(1);
    expect(COMIC_DIRECTION_ORDINAL.TTB).toBe(2);
  });

  it('ComicBgType ordinals are BLACK=0 … DYNAMIC=4', () => {
    expect(COMIC_BG_TYPE_ORDINAL.BLACK).toBe(0);
    expect(COMIC_BG_TYPE_ORDINAL.WHITE).toBe(1);
    expect(COMIC_BG_TYPE_ORDINAL.GRAY).toBe(2);
    expect(COMIC_BG_TYPE_ORDINAL.PAPER).toBe(3);
    expect(COMIC_BG_TYPE_ORDINAL.DYNAMIC).toBe(4);
  });

  it('ComicPageAnim ordinals are NONE=0 … CURL=3', () => {
    expect(COMIC_PAGE_ANIM_ORDINAL.NONE).toBe(0);
    expect(COMIC_PAGE_ANIM_ORDINAL.SLIDE).toBe(1);
    expect(COMIC_PAGE_ANIM_ORDINAL.FADE).toBe(2);
    expect(COMIC_PAGE_ANIM_ORDINAL.CURL).toBe(3);
  });

  it('ComicFit ordinals are FIT_WIDTH=0 … CUSTOM=6', () => {
    expect(COMIC_FIT_ORDINAL.FIT_WIDTH).toBe(0);
    expect(COMIC_FIT_ORDINAL.FIT_HEIGHT).toBe(1);
    expect(COMIC_FIT_ORDINAL.ORIGINAL).toBe(2);
    expect(COMIC_FIT_ORDINAL.FILL).toBe(3);
    expect(COMIC_FIT_ORDINAL.STRETCH).toBe(4);
    expect(COMIC_FIT_ORDINAL.FIT_PAGE).toBe(5);
    expect(COMIC_FIT_ORDINAL.CUSTOM).toBe(6);
  });

  it('ComicScene ordinals are NONE=0 … NIGHT=7', () => {
    expect(COMIC_SCENE_ORDINAL.NONE).toBe(0);
    expect(COMIC_SCENE_ORDINAL.RAIN).toBe(1);
    expect(COMIC_SCENE_ORDINAL.SNOW).toBe(2);
    expect(COMIC_SCENE_ORDINAL.SAKURA).toBe(3);
    expect(COMIC_SCENE_ORDINAL.FIREFLY).toBe(4);
    expect(COMIC_SCENE_ORDINAL.OCEAN).toBe(5);
    expect(COMIC_SCENE_ORDINAL.CAMPFIRE).toBe(6);
    expect(COMIC_SCENE_ORDINAL.NIGHT).toBe(7);
  });

  it('ComicGestureAction ordinals are NONE=0 … EXIT=6', () => {
    expect(COMIC_GESTURE_ACTION_ORDINAL.NONE).toBe(0);
    expect(COMIC_GESTURE_ACTION_ORDINAL.PREV).toBe(1);
    expect(COMIC_GESTURE_ACTION_ORDINAL.NEXT).toBe(2);
    expect(COMIC_GESTURE_ACTION_ORDINAL.TOGGLE_CONTROLS).toBe(3);
    expect(COMIC_GESTURE_ACTION_ORDINAL.TOC).toBe(4);
    expect(COMIC_GESTURE_ACTION_ORDINAL.SETTINGS).toBe(5);
    expect(COMIC_GESTURE_ACTION_ORDINAL.EXIT).toBe(6);
  });

  it('ComicEnhanceMode / ComicCropMode / ComicDoubleAlign ordinals', () => {
    expect(COMIC_ENHANCE_MODE_ORDINAL).toEqual({
      OFF: 0,
      CAS: 1,
      ANIME4K: 2,
      WAIFU2X: 3,
      SUPER_RES: 4,
    });
    expect(COMIC_CROP_MODE_ORDINAL).toEqual({ OFF: 0, WHITE: 1, BLACK: 2, AUTO: 3 });
    expect(COMIC_DOUBLE_ALIGN_ORDINAL).toEqual({ TOP: 0, CENTER: 1, BOTTOM: 2 });
  });
});

describe('comicConfig — enum labels (verbatim Chinese)', () => {
  it('ComicMode labels', () => {
    expect(COMIC_MODE_LABEL).toEqual({
      SINGLE: '单页',
      DOUBLE: '双页',
      WEBTOON: '条漫',
      CONTINUOUS: '无缝滚动',
      MAGNETIC: '磁吸',
    });
  });

  it('ComicDirection labels keep the U+2192 arrows', () => {
    expect(COMIC_DIRECTION_LABEL).toEqual({ LTR: '左 → 右', RTL: '右 → 左', TTB: '上 → 下' });
  });

  it('ComicFit labels', () => {
    expect(COMIC_FIT_LABEL).toEqual({
      FIT_WIDTH: '适应宽度',
      FIT_HEIGHT: '适应高度',
      ORIGINAL: '原始大小',
      FILL: '铺满裁切',
      STRETCH: '拉伸铺满',
      FIT_PAGE: '整页',
      CUSTOM: '自定义',
    });
  });

  it('ComicEnhanceMode labels + descriptions', () => {
    expect(COMIC_ENHANCE_MODE_LABEL.OFF).toBe('关闭');
    expect(COMIC_ENHANCE_MODE_LABEL.CAS).toBe('锐化增强');
    expect(COMIC_ENHANCE_MODE_LABEL.ANIME4K).toBe('Anime4K 轻量');
    expect(COMIC_ENHANCE_MODE_LABEL.WAIFU2X).toBe('超分 完整');
    expect(COMIC_ENHANCE_MODE_LABEL.SUPER_RES).toBe('超分辨率');
    expect(COMIC_ENHANCE_MODE_DESC.OFF).toBe('');
    expect(COMIC_ENHANCE_MODE_DESC.CAS).toBe(
      '对比度自适应锐化，强化线条与小字（最快，约 0.5 秒/页）',
    );
    expect(COMIC_ENHANCE_MODE_DESC.ANIME4K).toBe(
      'Anime4K Restore CNN 线条重建降噪，不放大（约 2-4 秒/页）',
    );
    expect(COMIC_ENHANCE_MODE_DESC.WAIFU2X).toBe(
      'Anime4K Upscale CNN ×2 神经网络超分（低分辨率页收益最大；约 2-6 秒/页，处理时有预计耗时提示）',
    );
    expect(COMIC_ENHANCE_MODE_DESC.SUPER_RES).toBe('Lanczos 2× 重建 + 自适应锐化（低分辨率页翻倍清晰度）');
  });

  it('remaining labels', () => {
    expect(COMIC_DOUBLE_ALIGN_LABEL).toEqual({
      TOP: '顶部对齐',
      CENTER: '居中对齐',
      BOTTOM: '底部对齐',
    });
    expect(COMIC_CROP_MODE_LABEL).toEqual({
      OFF: '关闭',
      WHITE: '裁白边',
      BLACK: '裁黑边',
      AUTO: '自动识别',
    });
    expect(COMIC_BG_TYPE_LABEL).toEqual({
      BLACK: '纯黑',
      WHITE: '纯白',
      GRAY: '深灰',
      PAPER: '纸张纹理',
      DYNAMIC: '沉浸动态',
    });
    expect(COMIC_SCENE_LABEL).toEqual({
      NONE: '关闭',
      RAIN: '雨夜',
      SNOW: '落雪',
      SAKURA: '樱花',
      FIREFLY: '萤火',
      OCEAN: '海边',
      CAMPFIRE: '篝火',
      NIGHT: '夏夜',
    });
    expect(COMIC_PAGE_ANIM_LABEL).toEqual({
      NONE: '无动画',
      SLIDE: '平移',
      FADE: '渐变',
      CURL: '仿真翻页',
    });
    expect(COMIC_GESTURE_ACTION_LABEL).toEqual({
      NONE: '无操作',
      PREV: '上一页',
      NEXT: '下一页',
      TOGGLE_CONTROLS: '呼出/隐藏控制',
      TOC: '目录',
      SETTINGS: '设置',
      EXIT: '退出',
    });
  });
});

describe('comicConfig — DEFAULT_COMIC_READER_CONFIG (Kotlin L16-104)', () => {
  it('reproduces every constructor default', () => {
    expect(DEFAULT_COMIC_READER_CONFIG).toEqual({
      mode: 'SINGLE',
      direction: 'RTL',
      webtoonSnap: true,
      fit: 'FIT_WIDTH',
      customFitBase: 'FIT_PAGE',
      customFitScale: 1.0,
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
      filterGamma: 1.0,
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
      translationTextScale: 1.0,
      translationEngine: 'online',
    });
  });

  it('createComicReaderConfig patches over the defaults', () => {
    const patched = createComicReaderConfig({ mode: 'WEBTOON', pageAnim: 'NONE' });
    expect(patched.mode).toBe('WEBTOON');
    expect(patched.pageAnim).toBe('NONE');
    expect(patched.direction).toBe('RTL');
    expect(createComicReaderConfig()).toEqual(DEFAULT_COMIC_READER_CONFIG);
  });
});

describe('comicConfig — toJson (Kotlin L106-161)', () => {
  it('omits manualCrop when it is null (Kotlin `manualCrop?.let { … }`)', () => {
    const json = comicReaderConfigToJson(DEFAULT_COMIC_READER_CONFIG);
    expect(Object.keys(json)).not.toContain('manualCrop');
    // 54 个字段，manualCrop 缺席 → 53 个键
    expect(Object.keys(json).length).toBe(53);
  });

  it('includes manualCrop as an array when set', () => {
    const json = comicReaderConfigToJson(
      createComicReaderConfig({ manualCrop: [0.1, 0.2, 0.3, 0.4] }),
    );
    expect(json['manualCrop']).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('uses the Kotlin key names verbatim, in the Kotlin order', () => {
    const keys = Object.keys(comicReaderConfigToJson(createComicReaderConfig({ manualCrop: [0, 0, 0, 0] })));
    expect(keys).toEqual([
      'mode',
      'direction',
      'webtoonSnap',
      'fit',
      'customFitBase',
      'customFitScale',
      'pageSpacingDp',
      'doubleGapDp',
      'doubleFirstAlone',
      'doubleAlign',
      'doubleShiftXDp',
      'doubleShiftYDp',
      'doubleTapZoom',
      'longPressZoom',
      'zoomWhileTurn',
      'bookRotation',
      'cropMode',
      'manualCrop',
      'splitWide',
      'splitReverse',
      'splitPosition',
      'enhanceMode',
      'enhanceStrength',
      'filterBrightness',
      'filterContrast',
      'filterSaturation',
      'filterHue',
      'filterGamma',
      'filterSharpen',
      'filterShadow',
      'filterBW',
      'bgType',
      'paperIntensity',
      'scene',
      'sceneSound',
      'sceneEffect',
      'sceneVolume',
      'pageAnim',
      'autoPageIntervalSec',
      'autoScrollSpeedDp',
      'gestureTapLeft',
      'gestureTapRight',
      'gestureTapCenter',
      'gestureSwipe',
      'gesturePinchClose',
      'gestureEdgeSwipe',
      'gestureLongPressPanel',
      'volumeKeyTurn',
      'showThumbPreview',
      'hideSystemBars',
      'translationEnabled',
      'translationLang',
      'translationTextScale',
      'translationEngine',
    ]);
  });

  it('stores enums by NAME (Kotlin `mode.name`), not by ordinal', () => {
    const json = comicReaderConfigToJson(createComicReaderConfig({ mode: 'MAGNETIC', pageAnim: 'CURL' }));
    expect(json['mode']).toBe('MAGNETIC');
    expect(json['pageAnim']).toBe('CURL');
    expect(json['mode']).not.toBe(COMIC_MODE_ORDINAL.MAGNETIC);
  });
});

describe('comicConfig — fromJson defaults & safe() fallback (Kotlin L178-237)', () => {
  it('returns the full default set for an empty object', () => {
    expect(comicReaderConfigFromJson({})).toEqual(DEFAULT_COMIC_READER_CONFIG);
  });

  it('falls back on an unknown enum name (Kotlin `?: fallback`)', () => {
    const cfg = comicReaderConfigFromJson({
      mode: 'NOT_A_MODE',
      direction: 'BTB',
      fit: 'HUGE',
      customFitBase: 'NOPE',
      doubleAlign: 'MIDDLE',
      cropMode: 'MAGIC',
      enhanceMode: 'ULTRA',
      bgType: 'SEPIA',
      scene: 'THUNDER',
      pageAnim: 'EXPLODE',
      gestureTapLeft: 'DANCE',
    });
    expect(cfg.mode).toBe('SINGLE');
    expect(cfg.direction).toBe('RTL');
    expect(cfg.fit).toBe('FIT_WIDTH');
    expect(cfg.customFitBase).toBe('FIT_PAGE');
    expect(cfg.doubleAlign).toBe('CENTER');
    expect(cfg.cropMode).toBe('OFF');
    expect(cfg.enhanceMode).toBe('OFF');
    expect(cfg.bgType).toBe('BLACK');
    expect(cfg.scene).toBe('NONE');
    expect(cfg.pageAnim).toBe('SLIDE');
    expect(cfg.gestureTapLeft).toBe('PREV');
  });

  it('accepts valid enum names', () => {
    const cfg = comicReaderConfigFromJson({
      mode: 'DOUBLE',
      direction: 'LTR',
      fit: 'STRETCH',
      customFitBase: 'CUSTOM',
      doubleAlign: 'BOTTOM',
      cropMode: 'AUTO',
      enhanceMode: 'SUPER_RES',
      bgType: 'PAPER',
      scene: 'CAMPFIRE',
      pageAnim: 'FADE',
      gestureTapLeft: 'TOC',
      gestureTapRight: 'EXIT',
      gestureTapCenter: 'NONE',
    });
    expect(cfg.mode).toBe('DOUBLE');
    expect(cfg.direction).toBe('LTR');
    expect(cfg.fit).toBe('STRETCH');
    expect(cfg.customFitBase).toBe('CUSTOM');
    expect(cfg.doubleAlign).toBe('BOTTOM');
    expect(cfg.cropMode).toBe('AUTO');
    expect(cfg.enhanceMode).toBe('SUPER_RES');
    expect(cfg.bgType).toBe('PAPER');
    expect(cfg.scene).toBe('CAMPFIRE');
    expect(cfg.pageAnim).toBe('FADE');
    expect(cfg.gestureTapLeft).toBe('TOC');
    expect(cfg.gestureTapRight).toBe('EXIT');
    expect(cfg.gestureTapCenter).toBe('NONE');
  });

  it('falls back on a numeric enum value (Android optString stringifies numbers)', () => {
    // optString(5) → "5" → safe() 找不到 → fallback
    expect(comicReaderConfigFromJson({ mode: 5 }).mode).toBe('SINGLE');
    // optString(true) → "true" → 找不到 → fallback
    expect(comicReaderConfigFromJson({ mode: true }).mode).toBe('SINGLE');
  });

  it('only accepts real booleans (Android optBoolean rejects "true")', () => {
    // webtoonSnap 的 Kotlin fallback 是 true，所以用 fallback 为 false 的字段才能区分
    expect(comicReaderConfigFromJson({ doubleFirstAlone: 'true' }).doubleFirstAlone).toBe(false);
    expect(comicReaderConfigFromJson({ doubleFirstAlone: 1 }).doubleFirstAlone).toBe(false);
    expect(comicReaderConfigFromJson({ webtoonSnap: false }).webtoonSnap).toBe(false);
    expect(comicReaderConfigFromJson({ filterBW: true }).filterBW).toBe(true);
    expect(comicReaderConfigFromJson({ filterBW: 1 }).filterBW).toBe(false);
  });

  it('treats JSON null as absent', () => {
    const cfg = comicReaderConfigFromJson({
      mode: null,
      webtoonSnap: null,
      enhanceStrength: null,
      filterGamma: null,
    });
    expect(cfg.mode).toBe('SINGLE');
    expect(cfg.webtoonSnap).toBe(true);
    expect(cfg.enhanceStrength).toBe(60);
    expect(cfg.filterGamma).toBe(1);
  });
});

describe('comicConfig — coerceIn clamping (every Kotlin clamp site)', () => {
  it('coerceIn matches the Kotlin definition (NaN passes through)', () => {
    expect(coerceIn(5, 0, 10)).toBe(5);
    expect(coerceIn(-1, 0, 10)).toBe(0);
    expect(coerceIn(11, 0, 10)).toBe(10);
    expect(coerceIn(Number.NaN, 0, 10)).toBeNaN();
  });

  const clamped: ReadonlyArray<{
    field: keyof ComicReaderConfig;
    low: number;
    high: number;
    min: number;
    max: number;
  }> = [
    { field: 'customFitScale', low: 0.1, high: 9.9, min: 0.5, max: 2.5 },
    { field: 'splitPosition', low: 0.1, high: 0.9, min: 0.3, max: 0.7 },
    { field: 'enhanceStrength', low: -5, high: 250, min: 0, max: 100 },
    { field: 'filterBrightness', low: -500, high: 500, min: -100, max: 100 },
    { field: 'filterContrast', low: -500, high: 500, min: -100, max: 100 },
    { field: 'filterSaturation', low: -500, high: 500, min: -100, max: 100 },
    { field: 'filterHue', low: -400, high: 400, min: -180, max: 180 },
    { field: 'filterGamma', low: 0.1, high: 9, min: 0.5, max: 2.2 },
    { field: 'filterSharpen', low: -1, high: 900, min: 0, max: 100 },
    { field: 'filterShadow', low: -900, high: 900, min: -100, max: 100 },
    { field: 'paperIntensity', low: -1, high: 900, min: 0, max: 100 },
    { field: 'sceneVolume', low: -1, high: 900, min: 0, max: 100 },
    { field: 'autoPageIntervalSec', low: 0.1, high: 900, min: 1, max: 120 },
    { field: 'autoScrollSpeedDp', low: 1, high: 900, min: 5, max: 400 },
    { field: 'translationTextScale', low: 0.1, high: 9, min: 0.8, max: 1.4 },
  ];

  clamped.forEach(({ field, low, high, min, max }) => {
    it(`clamps ${field} into [${min}, ${max}]`, () => {
      expect(comicReaderConfigFromJson({ [field]: low })[field]).toBe(min);
      expect(comicReaderConfigFromJson({ [field]: high })[field]).toBe(max);
      // 恰好落在边界上不动
      expect(comicReaderConfigFromJson({ [field]: min })[field]).toBe(min);
      expect(comicReaderConfigFromJson({ [field]: max })[field]).toBe(max);
    });
  });

  it('does NOT clamp the fields Kotlin leaves unclamped', () => {
    const cfg = comicReaderConfigFromJson({
      pageSpacingDp: 9999,
      doubleGapDp: -5,
      doubleShiftXDp: 999,
      doubleShiftYDp: -999,
      bookRotation: 12345,
    });
    expect(cfg.pageSpacingDp).toBe(9999);
    expect(cfg.doubleGapDp).toBe(-5);
    expect(cfg.doubleShiftXDp).toBe(999);
    expect(cfg.doubleShiftYDp).toBe(-999);
    expect(cfg.bookRotation).toBe(12345);
  });

  it('keeps in-range values untouched', () => {
    const cfg = comicReaderConfigFromJson({
      customFitScale: 1.75,
      splitPosition: 0.42,
      enhanceStrength: 33,
      filterHue: -90,
      filterGamma: 0.9,
      autoPageIntervalSec: 12,
      autoScrollSpeedDp: 100,
      translationTextScale: 1.25,
    });
    expect(cfg.customFitScale).toBe(1.75);
    expect(cfg.splitPosition).toBe(0.42);
    expect(cfg.enhanceStrength).toBe(33);
    expect(cfg.filterHue).toBe(-90);
    expect(cfg.filterGamma).toBe(0.9);
    expect(cfg.autoPageIntervalSec).toBe(12);
    expect(cfg.autoScrollSpeedDp).toBe(100);
    expect(cfg.translationTextScale).toBe(1.25);
  });
});

describe('comicConfig — manualCrop decode (Kotlin L195-198)', () => {
  it('accepts a 4-element numeric array', () => {
    expect(comicReaderConfigFromJson({ manualCrop: [0.1, 0.2, 0.3, 0.4] }).manualCrop).toEqual([
      0.1, 0.2, 0.3, 0.4,
    ]);
  });

  it('is null when absent, not an array, or the wrong length', () => {
    expect(comicReaderConfigFromJson({}).manualCrop).toBeNull();
    expect(comicReaderConfigFromJson({ manualCrop: null }).manualCrop).toBeNull();
    expect(comicReaderConfigFromJson({ manualCrop: 'x' }).manualCrop).toBeNull();
    expect(comicReaderConfigFromJson({ manualCrop: [0, 1] }).manualCrop).toBeNull();
    expect(comicReaderConfigFromJson({ manualCrop: [0, 1, 2, 3, 4] }).manualCrop).toBeNull();
    expect(comicReaderConfigFromJson({ manualCrop: [] }).manualCrop).toBeNull();
  });

  it('is null (not partially decoded) when any element is not a number', () => {
    // Kotlin: arr.getDouble() throws → runCatching → 整个 manualCrop 为 null
    expect(comicReaderConfigFromJson({ manualCrop: [0, 1, 2, 'x'] }).manualCrop).toBeNull();
    expect(comicReaderConfigFromJson({ manualCrop: [0, 1, 2, null] }).manualCrop).toBeNull();
  });

  it('coerces numeric strings (Android JSONArray.getDouble parses them)', () => {
    expect(comicReaderConfigFromJson({ manualCrop: ['0.1', '0.2', '0.3', '0.4'] }).manualCrop).toEqual([
      0.1, 0.2, 0.3, 0.4,
    ]);
  });
});

describe('comicConfig — takeIf sets (Kotlin L233 / L236)', () => {
  it('translationLang accepts only auto/ja/en/ko', () => {
    expect(TRANSLATION_LANGS).toEqual(['auto', 'ja', 'en', 'ko']);
    for (const lang of TRANSLATION_LANGS) {
      expect(comicReaderConfigFromJson({ translationLang: lang }).translationLang).toBe(lang);
    }
    expect(comicReaderConfigFromJson({ translationLang: 'de' }).translationLang).toBe('auto');
    expect(comicReaderConfigFromJson({ translationLang: '' }).translationLang).toBe('auto');
    expect(comicReaderConfigFromJson({ translationLang: null }).translationLang).toBe('auto');
  });

  it('translationEngine accepts only ai/online', () => {
    expect(TRANSLATION_ENGINES).toEqual(['ai', 'online']);
    expect(comicReaderConfigFromJson({ translationEngine: 'ai' }).translationEngine).toBe('ai');
    expect(comicReaderConfigFromJson({ translationEngine: 'online' }).translationEngine).toBe('online');
    expect(comicReaderConfigFromJson({ translationEngine: 'deepl' }).translationEngine).toBe('online');
  });

  it('takeIfIn implements `takeIf { it in allowed } ?: fallback`', () => {
    expect(takeIfIn('a', ['a', 'b'] as const, 'b')).toBe('a');
    expect(takeIfIn('z', ['a', 'b'] as const, 'b')).toBe('b');
  });
});

describe('comicConfig — toJson/fromJson round-trip', () => {
  it('survives every field', () => {
    const original: ComicReaderConfig = createComicReaderConfig({
      mode: 'MAGNETIC',
      direction: 'TTB',
      webtoonSnap: false,
      fit: 'CUSTOM',
      customFitBase: 'FILL',
      customFitScale: 2.25,
      pageSpacingDp: 17.5,
      doubleGapDp: 22,
      doubleFirstAlone: true,
      doubleAlign: 'TOP',
      doubleShiftXDp: -12,
      doubleShiftYDp: 34,
      doubleTapZoom: false,
      longPressZoom: false,
      zoomWhileTurn: true,
      bookRotation: 270,
      cropMode: 'WHITE',
      manualCrop: [0.05, 0.1, 0.95, 0.9],
      splitWide: true,
      splitReverse: true,
      splitPosition: 0.65,
      enhanceMode: 'ANIME4K',
      enhanceStrength: 45,
      filterBrightness: -30,
      filterContrast: 30,
      filterSaturation: -45,
      filterHue: 120,
      filterGamma: 1.4,
      filterSharpen: 80,
      filterShadow: -60,
      filterBW: true,
      bgType: 'DYNAMIC',
      paperIntensity: 12,
      scene: 'SNOW',
      sceneSound: false,
      sceneEffect: false,
      sceneVolume: 7,
      pageAnim: 'NONE',
      autoPageIntervalSec: 90,
      autoScrollSpeedDp: 350,
      gestureTapLeft: 'SETTINGS',
      gestureTapRight: 'TOC',
      gestureTapCenter: 'EXIT',
      gestureSwipe: false,
      gesturePinchClose: false,
      gestureEdgeSwipe: false,
      gestureLongPressPanel: true,
      volumeKeyTurn: false,
      showThumbPreview: false,
      hideSystemBars: false,
      translationEnabled: true,
      translationLang: 'ja',
      translationTextScale: 1.4,
      translationEngine: 'ai',
    });
    const round = comicReaderConfigFromJson(comicReaderConfigToJson(original));
    expect(round).toEqual(original);
  });

  it('survives the built-in preset shapes used by ComicSettingsStore', () => {
    // 条漫内置预设：mode=WEBTOON / direction=TTB / pageAnim=NONE / pageSpacingDp=0
    const webtoon: ComicReaderConfig = createComicReaderConfig({
      mode: 'WEBTOON',
      direction: 'TTB',
      pageAnim: 'NONE',
      pageSpacingDp: 0,
      bgType: 'BLACK',
    });
    expect(comicReaderConfigFromJson(comicReaderConfigToJson(webtoon))).toEqual(webtoon);
  });
});

describe('comicConfig — imagePipelineFingerprint (Kotlin L164-170)', () => {
  it('emits 15 pipe-joined segments in the Kotlin order', () => {
    const fp = imagePipelineFingerprint(DEFAULT_COMIC_READER_CONFIG);
    const parts = fp.split('|');
    expect(parts).toHaveLength(15);
    expect(parts[0]).toBe('OFF'); // cropMode.name
    expect(parts[1]).toBe('null'); // manualCrop?.joinToString(",") == null → Kotlin 渲染成 "null"
    expect(parts[2]).toBe('0'); // bookRotation
    expect(parts[3]).toBe('false'); // splitWide
    expect(parts[4]).toBe('0.5'); // splitPosition
    expect(parts[5]).toBe('OFF'); // enhanceMode.name
    expect(parts[6]).toBe('60'); // enhanceStrength
    expect(parts[7]).toBe('0'); // filterBrightness
    expect(parts[8]).toBe('0'); // filterContrast
    expect(parts[9]).toBe('0'); // filterSaturation
    expect(parts[10]).toBe('0'); // filterHue
    expect(parts[11]).toBe('1.000'); // String.format("%.3f", filterGamma)
    expect(parts[12]).toBe('0'); // filterSharpen
    expect(parts[13]).toBe('0'); // filterShadow
    expect(parts[14]).toBe('false'); // filterBW
  });

  it('renders manualCrop as a comma list when present', () => {
    const fp = imagePipelineFingerprint(createComicReaderConfig({ manualCrop: [0.1, 0.2, 0.3, 0.4] }));
    expect(fp.split('|')[1]).toBe('0.1,0.2,0.3,0.4');
  });

  it('formats filterGamma with exactly 3 decimals', () => {
    expect(imagePipelineFingerprint(createComicReaderConfig({ filterGamma: 0.9 })).split('|')[11]).toBe(
      '0.900',
    );
    expect(imagePipelineFingerprint(createComicReaderConfig({ filterGamma: 2 })).split('|')[11]).toBe(
      '2.000',
    );
  });

  it('changes when any fingerprinted field changes', () => {
    const base = imagePipelineFingerprint(DEFAULT_COMIC_READER_CONFIG);
    // 每个字段都给一个与默认值**不同且类型合法**的覆写
    const variants: ReadonlyArray<Partial<ComicReaderConfig>> = [
      { cropMode: 'AUTO' },
      { manualCrop: [0, 0, 0, 0] },
      { bookRotation: 90 },
      { splitWide: true },
      { splitPosition: 0.7 },
      { enhanceMode: 'CAS' },
      { enhanceStrength: 1 },
      { filterBrightness: 1 },
      { filterContrast: 1 },
      { filterSaturation: 1 },
      { filterHue: 1 },
      { filterGamma: 1.5 },
      { filterSharpen: 1 },
      { filterShadow: 1 },
      { filterBW: true },
    ];
    expect(variants).toHaveLength(15);
    variants.forEach((patch) => {
      expect(imagePipelineFingerprint(createComicReaderConfig(patch))).not.toBe(base);
    });
  });

  it('ignores fields that are NOT in the fingerprint', () => {
    const base = imagePipelineFingerprint(DEFAULT_COMIC_READER_CONFIG);
    expect(imagePipelineFingerprint(createComicReaderConfig({ mode: 'DOUBLE' }))).toBe(base);
    expect(imagePipelineFingerprint(createComicReaderConfig({ scene: 'RAIN' }))).toBe(base);
    expect(imagePipelineFingerprint(createComicReaderConfig({ hideSystemBars: false }))).toBe(base);
  });
});

describe('comicConfig — ComicBookState (Kotlin L316-352)', () => {
  it('EMPTY_COMIC_BOOK_STATE matches the Kotlin default constructor', () => {
    expect(EMPTY_COMIC_BOOK_STATE.lastPage).toBe(0);
    expect(EMPTY_COMIC_BOOK_STATE.lastChapterSig).toBeNull();
    expect(EMPTY_COMIC_BOOK_STATE.pageRotations).toEqual({});
    expect(EMPTY_COMIC_BOOK_STATE.mergeAnchors.size).toBe(0);
  });

  it('round-trips', () => {
    const state = {
      lastPage: 42,
      lastChapterSig: 'sig-abc',
      pageRotations: { p1: 90, p2: 180 },
      mergeAnchors: new Set([1, 3, 5]),
    };
    expect(comicBookStateFromJson(comicBookStateToJson(state))).toEqual(state);
  });

  it('omits lastChapterSig when null (Kotlin `lastChapterSig?.let { put(…) }`)', () => {
    const json = comicBookStateToJson({ ...EMPTY_COMIC_BOOK_STATE });
    expect(Object.keys(json)).toEqual(['lastPage', 'pageRotations', 'mergeAnchors']);
  });

  it('defaults everything for an empty object', () => {
    expect(comicBookStateFromJson({})).toEqual({
      lastPage: 0,
      lastChapterSig: null,
      pageRotations: {},
      mergeAnchors: new Set<number>(),
    });
  });

  it('nulls a blank lastChapterSig (Kotlin `ifBlank { null }`)', () => {
    expect(comicBookStateFromJson({ lastChapterSig: '' }).lastChapterSig).toBeNull();
    expect(comicBookStateFromJson({ lastChapterSig: '   ' }).lastChapterSig).toBeNull();
    expect(comicBookStateFromJson({ lastChapterSig: null }).lastChapterSig).toBeNull();
    expect(comicBookStateFromJson({ lastChapterSig: 'x' }).lastChapterSig).toBe('x');
  });

  it('defaults non-numeric pageRotations values to 0 (Android optInt has no fallback arg)', () => {
    const state = comicBookStateFromJson({ pageRotations: { a: 90, b: 'x', c: null, d: 1.9 } });
    expect(state.pageRotations).toEqual({ a: 90, b: 0, c: 0, d: 1 });
  });

  it('falls back to an EMPTY set when any mergeAnchor is not an int', () => {
    // Kotlin runCatching 吞掉 getInt 抛出的 JSONException → 整个集合退化
    expect(comicBookStateFromJson({ mergeAnchors: [1, 2] }).mergeAnchors).toEqual(new Set([1, 2]));
    expect(comicBookStateFromJson({ mergeAnchors: ['1', '2'] }).mergeAnchors).toEqual(new Set([1, 2]));
    expect(comicBookStateFromJson({ mergeAnchors: [1, 'x'] }).mergeAnchors).toEqual(new Set());
    expect(comicBookStateFromJson({ mergeAnchors: [1, null] }).mergeAnchors).toEqual(new Set());
  });

  it('de-duplicates mergeAnchors (Kotlin `.toSet()`)', () => {
    expect(comicBookStateFromJson({ mergeAnchors: [1, 1, 2, 2] }).mergeAnchors).toEqual(new Set([1, 2]));
  });

  it('ignores a non-array mergeAnchors / non-object pageRotations', () => {
    expect(comicBookStateFromJson({ mergeAnchors: 'nope' }).mergeAnchors).toEqual(new Set());
    expect(comicBookStateFromJson({ pageRotations: [1, 2] }).pageRotations).toEqual({});
  });
});

describe('comicConfig — Android JSONObject.optXxx semantics', () => {
  it('optString stringifies non-strings and falls back for absent/null', () => {
    expect(optString({ a: 'x' }, 'a', 'd')).toBe('x');
    expect(optString({ a: 5 }, 'a', 'd')).toBe('5');
    expect(optString({ a: true }, 'a', 'd')).toBe('true');
    expect(optString({ a: false }, 'a', 'd')).toBe('false');
    expect(optString({ a: null }, 'a', 'd')).toBe('d');
    expect(optString({}, 'a', 'd')).toBe('d');
    expect(optStringOrEmpty({}, 'a')).toBe('');
  });

  it('optBoolean accepts only real booleans', () => {
    expect(optBoolean({ a: true }, 'a', false)).toBe(true);
    expect(optBoolean({ a: false }, 'a', true)).toBe(false);
    expect(optBoolean({ a: 'true' }, 'a', false)).toBe(false);
    expect(optBoolean({ a: 1 }, 'a', false)).toBe(false);
    expect(optBoolean({ a: null }, 'a', true)).toBe(true);
  });

  it('optInt truncates toward zero, parses numeric strings, saturates int32', () => {
    expect(optInt({ a: 42 }, 'a', 0)).toBe(42);
    expect(optInt({ a: 1.9 }, 'a', 0)).toBe(1);
    expect(optInt({ a: -1.9 }, 'a', 0)).toBe(-1);
    expect(optInt({ a: '42' }, 'a', 0)).toBe(42);
    expect(optInt({ a: '4.9' }, 'a', 0)).toBe(4);
    expect(optInt({ a: 'abc' }, 'a', 7)).toBe(7);
    expect(optInt({ a: null }, 'a', 7)).toBe(7);
    expect(optInt({ a: 1e12 }, 'a', 0)).toBe(2147483647);
    expect(optInt({ a: -1e12 }, 'a', 0)).toBe(-2147483648);
  });

  it('optDouble accepts numbers and numeric strings', () => {
    expect(optDouble({ a: 1.5 }, 'a', 0)).toBe(1.5);
    expect(optDouble({ a: '1.5' }, 'a', 0)).toBe(1.5);
    expect(optDouble({ a: 2 }, 'a', 0)).toBe(2);
    expect(optDouble({ a: 'abc' }, 'a', 9)).toBe(9);
    expect(optDouble({}, 'a', 9)).toBe(9);
  });

  it('optJSONArray / optJSONObject return null on type mismatch', () => {
    expect(optJSONArray({ a: [1, 2] }, 'a')).toEqual([1, 2]);
    expect(optJSONArray({ a: { x: 1 } }, 'a')).toBeNull();
    expect(optJSONObject({ a: { x: 1 } }, 'a')).toEqual({ x: 1 });
    expect(optJSONObject({ a: [1] }, 'a')).toBeNull();
    expect(optJSONObject({}, 'a')).toBeNull();
  });

  it('jsonArrayGet* return null where Android would throw', () => {
    expect(jsonArrayGetInt([1, '2'], 1)).toBe(2);
    expect(jsonArrayGetInt([1, 'x'], 1)).toBeNull();
    expect(jsonArrayGetInt([1], 5)).toBeNull();
    expect(jsonArrayGetDouble([1.5, '2.5'], 1)).toBe(2.5);
    expect(jsonArrayGetDouble([1], 0)).toBe(1);
    expect(jsonArrayGetDouble([null], 0)).toBeNull();
  });
});

describe('comicConfig — structural compatibility with comicPortTypes.ts', () => {
  // 我的枚举必须与既有镜像逐字相同（否则 comicPageLoader / comicHarismCurl /
  // comicZoomGesture / comicImagePipeline 会在换 import 时编译失败）。
  it('ComicMode matches the mirror member-for-member', () => {
    const mine: readonly PortMode[] = COMIC_MODE_VALUES;
    const theirs: readonly PortMode[] = ['SINGLE', 'DOUBLE', 'WEBTOON', 'CONTINUOUS', 'MAGNETIC'];
    expect(mine).toEqual(theirs);
  });

  it('ComicDirection / ComicBgType / ComicPageAnim match their mirrors', () => {
    const dir: readonly PortDirection[] = COMIC_DIRECTION_VALUES;
    const bg: readonly PortBgType[] = COMIC_BG_TYPE_VALUES;
    const anim: readonly PortPageAnim[] = COMIC_PAGE_ANIM_VALUES;
    expect(dir).toEqual(['LTR', 'RTL', 'TTB']);
    expect(bg).toEqual(['BLACK', 'WHITE', 'GRAY', 'PAPER', 'DYNAMIC']);
    expect(anim).toEqual(['NONE', 'SLIDE', 'FADE', 'CURL']);
  });

  it('ComicFit matches the mirror (7 members, FIT_PAGE = 5)', () => {
    const fit: readonly PortFit[] = COMIC_FIT_VALUES;
    expect(fit).toEqual([
      'FIT_WIDTH',
      'FIT_HEIGHT',
      'ORIGINAL',
      'FILL',
      'STRETCH',
      'FIT_PAGE',
      'CUSTOM',
    ]);
    // `comicPortTypes.ts` 过去手写八个枚举的镜像，现已改为
    // `export type { … } from './comicReaderConfig'`（单一数据源）。
    // 下面按 `comicPortTypes` 的导入口径把其余五个也钉住：名字集合 + 声明顺序
    // 与 Kotlin `ComicReaderConfig.kt` L242-311 一致。ComicScene /
    // ComicGestureAction 此前从未被镜像过，这次一并转正，成员集在此锁定。
    const align: readonly PortDoubleAlign[] = COMIC_DOUBLE_ALIGN_VALUES;
    expect(align).toEqual(['TOP', 'CENTER', 'BOTTOM']);
    const crop: readonly PortCropMode[] = COMIC_CROP_MODE_VALUES;
    expect(crop).toEqual(['OFF', 'WHITE', 'BLACK', 'AUTO']);
    const enhance: readonly PortEnhanceMode[] = COMIC_ENHANCE_MODE_VALUES;
    expect(enhance).toEqual(['OFF', 'CAS', 'ANIME4K', 'WAIFU2X', 'SUPER_RES']);
    const scene: readonly PortScene[] = COMIC_SCENE_VALUES;
    expect(scene).toEqual(['NONE', 'RAIN', 'SNOW', 'SAKURA', 'FIREFLY', 'OCEAN', 'CAMPFIRE', 'NIGHT']);
    const action: readonly PortGestureAction[] = COMIC_GESTURE_ACTION_VALUES;
    expect(action).toEqual(['NONE', 'PREV', 'NEXT', 'TOGGLE_CONTROLS', 'TOC', 'SETTINGS', 'EXIT']);
  });

  it('DEFAULT_COMIC_READER_CONFIG satisfies ComicConfigSubset structurally', () => {
    // ComicConfigSubset 的每个字段都必须在本配置里存在且类型兼容。
    const cfg = DEFAULT_COMIC_READER_CONFIG;
    const subset = {
      mode: cfg.mode,
      direction: cfg.direction,
      fit: cfg.fit,
      customFitBase: cfg.customFitBase,
      customFitScale: cfg.customFitScale,
      doubleGapDp: cfg.doubleGapDp,
      doubleAlign: cfg.doubleAlign,
      doubleShiftXDp: cfg.doubleShiftXDp,
      doubleShiftYDp: cfg.doubleShiftYDp,
      bookRotation: cfg.bookRotation,
      cropMode: cfg.cropMode,
      manualCrop: cfg.manualCrop,
      splitWide: cfg.splitWide,
      splitPosition: cfg.splitPosition,
      enhanceMode: cfg.enhanceMode,
      enhanceStrength: cfg.enhanceStrength,
      filterBrightness: cfg.filterBrightness,
      filterContrast: cfg.filterContrast,
      filterSaturation: cfg.filterSaturation,
      filterHue: cfg.filterHue,
      filterGamma: cfg.filterGamma,
      filterSharpen: cfg.filterSharpen,
      filterShadow: cfg.filterShadow,
      filterBW: cfg.filterBW,
      bgType: cfg.bgType,
      paperIntensity: cfg.paperIntensity,
      pageAnim: cfg.pageAnim,
    };
    expect(Object.keys(subset)).toHaveLength(27);
    // mirror 的手工分半表（本文件不负责，作为存在性断言）
    expect(SPLIT_HALF_ORDINAL).toEqual({ FULL: 0, LEFT: 1, RIGHT: 2 });
  });
});
