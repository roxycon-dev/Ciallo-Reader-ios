/**
 * comicSheetsEnumOrdinals.test.ts — 十个枚举的 `toJson` / `fromJson` 逐条钉死。
 *
 * 目的：`ComicReaderConfig.kt` L106-239 的序列化契约是**跨版本持久化**的
 * ——`toJson` 按 `枚举.name`（字符串）写入，`fromJson` 按名字查表、查不到回落
 * fallback。本文件把「name ↔ ordinal ↔ 声明顺序」三者锁死，任何一次重排或改名
 * 都会在这里炸掉，而不是等到旧存档静默降级。
 *
 * 覆盖的十个枚举（Kotlin 声明行号）：
 *   ComicMode        L243-245
 *   ComicDirection   L248-250
 *   ComicFit         L262-265
 *   ComicDoubleAlign L268-270
 *   ComicCropMode    L273-275
 *   ComicEnhanceMode L281-287
 *   ComicBgType      L290-292
 *   ComicScene       L295-299
 *   ComicPageAnim    L302-304
 *   ComicGestureAction L307-311
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
  comicReaderConfigFromJson,
  comicReaderConfigToJson,
  createComicReaderConfig,
  type ComicReaderConfig,
} from '../../src/core/comic/comicReaderConfig';

/**
 * 每个枚举的三张表 + 承载它的 config 字段 + fromJson 的 fallback 值。
 * `jsonKey` = Kotlin `toJson` 里 `put("<key>", <enum>.name)` 的键名。
 */
interface EnumSpec {
  readonly type: string;
  readonly kotlin: string;
  readonly jsonKey: string;
  readonly values: readonly string[];
  readonly ordinals: Readonly<Record<string, number>>;
  readonly labels: Readonly<Record<string, string>>;
  /** Kotlin `safe(name, fallback, entries)` 里的 fallback */
  readonly fallback: string;
}

const ENUM_SPECS: readonly EnumSpec[] = [
  {
    type: 'ComicMode',
    kotlin: 'L243-245',
    jsonKey: 'mode',
    values: COMIC_MODE_VALUES,
    ordinals: COMIC_MODE_ORDINAL,
    labels: COMIC_MODE_LABEL,
    fallback: 'SINGLE',
  },
  {
    type: 'ComicDirection',
    kotlin: 'L248-250',
    jsonKey: 'direction',
    values: COMIC_DIRECTION_VALUES,
    ordinals: COMIC_DIRECTION_ORDINAL,
    labels: COMIC_DIRECTION_LABEL,
    fallback: 'RTL',
  },
  {
    type: 'ComicFit',
    kotlin: 'L262-265',
    jsonKey: 'fit',
    values: COMIC_FIT_VALUES,
    ordinals: COMIC_FIT_ORDINAL,
    labels: COMIC_FIT_LABEL,
    fallback: 'FIT_WIDTH',
  },
  {
    type: 'ComicFit(customFitBase)',
    kotlin: 'L182 safe("customFitBase", ComicFit.FIT_PAGE, entries)',
    jsonKey: 'customFitBase',
    values: COMIC_FIT_VALUES,
    ordinals: COMIC_FIT_ORDINAL,
    labels: COMIC_FIT_LABEL,
    fallback: 'FIT_PAGE',
  },
  {
    type: 'ComicDoubleAlign',
    kotlin: 'L268-270',
    jsonKey: 'doubleAlign',
    values: COMIC_DOUBLE_ALIGN_VALUES,
    ordinals: COMIC_DOUBLE_ALIGN_ORDINAL,
    labels: COMIC_DOUBLE_ALIGN_LABEL,
    fallback: 'CENTER',
  },
  {
    type: 'ComicCropMode',
    kotlin: 'L273-275',
    jsonKey: 'cropMode',
    values: COMIC_CROP_MODE_VALUES,
    ordinals: COMIC_CROP_MODE_ORDINAL,
    labels: COMIC_CROP_MODE_LABEL,
    fallback: 'OFF',
  },
  {
    type: 'ComicEnhanceMode',
    kotlin: 'L281-287',
    jsonKey: 'enhanceMode',
    values: COMIC_ENHANCE_MODE_VALUES,
    ordinals: COMIC_ENHANCE_MODE_ORDINAL,
    labels: COMIC_ENHANCE_MODE_LABEL,
    fallback: 'OFF',
  },
  {
    type: 'ComicBgType',
    kotlin: 'L290-292',
    jsonKey: 'bgType',
    values: COMIC_BG_TYPE_VALUES,
    ordinals: COMIC_BG_TYPE_ORDINAL,
    labels: COMIC_BG_TYPE_LABEL,
    fallback: 'BLACK',
  },
  {
    type: 'ComicScene',
    kotlin: 'L295-299',
    jsonKey: 'scene',
    values: COMIC_SCENE_VALUES,
    ordinals: COMIC_SCENE_ORDINAL,
    labels: COMIC_SCENE_LABEL,
    fallback: 'NONE',
  },
  {
    type: 'ComicPageAnim',
    kotlin: 'L302-304',
    jsonKey: 'pageAnim',
    values: COMIC_PAGE_ANIM_VALUES,
    ordinals: COMIC_PAGE_ANIM_ORDINAL,
    labels: COMIC_PAGE_ANIM_LABEL,
    fallback: 'SLIDE',
  },
  {
    type: 'ComicGestureAction(gestureTapLeft)',
    kotlin: 'L221 safe("gestureTapLeft", ComicGestureAction.PREV, entries)',
    jsonKey: 'gestureTapLeft',
    values: COMIC_GESTURE_ACTION_VALUES,
    ordinals: COMIC_GESTURE_ACTION_ORDINAL,
    labels: COMIC_GESTURE_ACTION_LABEL,
    fallback: 'PREV',
  },
  {
    type: 'ComicGestureAction(gestureTapRight)',
    kotlin: 'L222 safe("gestureTapRight", ComicGestureAction.NEXT, entries)',
    jsonKey: 'gestureTapRight',
    values: COMIC_GESTURE_ACTION_VALUES,
    ordinals: COMIC_GESTURE_ACTION_ORDINAL,
    labels: COMIC_GESTURE_ACTION_LABEL,
    fallback: 'NEXT',
  },
  {
    type: 'ComicGestureAction(gestureTapCenter)',
    kotlin: 'L223 safe("gestureTapCenter", …TOGGLE_CONTROLS, entries)',
    jsonKey: 'gestureTapCenter',
    values: COMIC_GESTURE_ACTION_VALUES,
    ordinals: COMIC_GESTURE_ACTION_ORDINAL,
    labels: COMIC_GESTURE_ACTION_LABEL,
    fallback: 'TOGGLE_CONTROLS',
  },
];

describe('枚举序列化契约 · toJson 写入 name（Kotlin `put(key, enum.name)`）', () => {
  it.each(ENUM_SPECS)('$type：toJson 写出的是枚举名，不是 ordinal（$kotlin）', (spec) => {
    // 逐个枚举值写进 config，断言 toJson 里落的就是那个字符串。
    for (const value of spec.values) {
      const config = createComicReaderConfig({ [spec.jsonKey]: value } as Partial<ComicReaderConfig>);
      const json = comicReaderConfigToJson(config);
      expect(json[spec.jsonKey]).toBe(value);
      // ordinal 是数字，绝不能被写成 JSON 值
      expect(typeof json[spec.jsonKey]).toBe('string');
    }
  });

  it.each(ENUM_SPECS)('$type：名字 → ordinal 的映射是 1:1 且连续（$kotlin）', (spec) => {
    expect(Object.keys(spec.ordinals).sort()).toEqual([...spec.values].sort());
    // Kotlin `entries[i].ordinal === i`：声明顺序即 ordinal，从 0 连续递增。
    spec.values.forEach((value, index) => {
      expect(spec.ordinals[value]).toBe(index);
    });
  });

  it.each(ENUM_SPECS)('$type：ordinal → values 反查严格双向（$kotlin）', (spec) => {
    for (const value of spec.values) {
      const index = spec.ordinals[value];
      expect(index).toBeDefined();
      expect(spec.values[index ?? -1]).toBe(value);
    }
  });

  it.each(ENUM_SPECS)('$type：每个枚举值都有 label（$kotlin）', (spec) => {
    for (const value of spec.values) {
      expect(typeof spec.labels[value]).toBe('string');
      expect(spec.labels[value]?.length).toBeGreaterThan(0);
    }
  });
});

describe('枚举序列化契约 · fromJson 按名字查表、未知回落 fallback', () => {
  it.each(ENUM_SPECS)('$type：合法名字原样解出（$kotlin）', (spec) => {
    for (const value of spec.values) {
      const decoded = comicReaderConfigFromJson({ [spec.jsonKey]: value });
      expect(decoded[spec.jsonKey as keyof ComicReaderConfig]).toBe(value);
    }
  });

  it.each(ENUM_SPECS)('$type：未知名字回落 fallback（Kotlin `?: fallback`）（$kotlin）', (spec) => {
    const decoded = comicReaderConfigFromJson({ [spec.jsonKey]: '__NOT_A_REAL_ENUM_NAME__' });
    expect(decoded[spec.jsonKey as keyof ComicReaderConfig]).toBe(spec.fallback);
  });

  it.each(ENUM_SPECS)('$type：键缺失同样回落 fallback（$kotlin）', (spec) => {
    const decoded = comicReaderConfigFromJson({});
    expect(decoded[spec.jsonKey as keyof ComicReaderConfig]).toBe(spec.fallback);
  });

  it.each(ENUM_SPECS)('$type：JSON null 视为缺失 → fallback（Android optString(null)=default）（$kotlin）', (spec) => {
    const decoded = comicReaderConfigFromJson({ [spec.jsonKey]: null });
    expect(decoded[spec.jsonKey as keyof ComicReaderConfig]).toBe(spec.fallback);
  });

  it.each(ENUM_SPECS)('$type：round-trip 每个枚举值（toJson → fromJson）（$kotlin）', (spec) => {
    for (const value of spec.values) {
      const config = createComicReaderConfig({ [spec.jsonKey]: value } as Partial<ComicReaderConfig>);
      const round = comicReaderConfigFromJson(comicReaderConfigToJson(config));
      expect(round[spec.jsonKey as keyof ComicReaderConfig]).toBe(value);
    }
  });
});

describe('枚举默认值 · DEFAULT_COMIC_READER_CONFIG 每个枚举字段 = Kotlin 构造默认', () => {
  it('mode = ComicMode.SINGLE（Kotlin L16）', () => {
    expect(DEFAULT_COMIC_READER_CONFIG.mode).toBe('SINGLE');
  });
  it('direction = ComicDirection.RTL（Kotlin L17）', () => {
    expect(DEFAULT_COMIC_READER_CONFIG.direction).toBe('RTL');
  });
  it('fit = ComicFit.FIT_WIDTH（Kotlin L22）', () => {
    expect(DEFAULT_COMIC_READER_CONFIG.fit).toBe('FIT_WIDTH');
  });
  it('customFitBase = ComicFit.FIT_PAGE（Kotlin L24）', () => {
    expect(DEFAULT_COMIC_READER_CONFIG.customFitBase).toBe('FIT_PAGE');
  });
  it('doubleAlign = ComicDoubleAlign.CENTER（Kotlin L30）', () => {
    expect(DEFAULT_COMIC_READER_CONFIG.doubleAlign).toBe('CENTER');
  });
  it('cropMode = ComicCropMode.OFF（Kotlin L43）', () => {
    expect(DEFAULT_COMIC_READER_CONFIG.cropMode).toBe('OFF');
  });
  it('enhanceMode = ComicEnhanceMode.OFF（Kotlin L52）', () => {
    expect(DEFAULT_COMIC_READER_CONFIG.enhanceMode).toBe('OFF');
  });
  it('bgType = ComicBgType.BLACK（Kotlin L66）', () => {
    expect(DEFAULT_COMIC_READER_CONFIG.bgType).toBe('BLACK');
  });
  it('scene = ComicScene.NONE（Kotlin L70）', () => {
    expect(DEFAULT_COMIC_READER_CONFIG.scene).toBe('NONE');
  });
  it('pageAnim = ComicPageAnim.SLIDE（Kotlin L76）', () => {
    expect(DEFAULT_COMIC_READER_CONFIG.pageAnim).toBe('SLIDE');
  });
  it('gestureTapLeft/Right/Center = PREV/NEXT/TOGGLE_CONTROLS（Kotlin L83-85）', () => {
    expect(DEFAULT_COMIC_READER_CONFIG.gestureTapLeft).toBe('PREV');
    expect(DEFAULT_COMIC_READER_CONFIG.gestureTapRight).toBe('NEXT');
    expect(DEFAULT_COMIC_READER_CONFIG.gestureTapCenter).toBe('TOGGLE_CONTROLS');
  });
});

describe('ComicEnhanceMode.desc（Kotlin L282-286 的 val desc，逐字）', () => {
  it('OFF 的 desc 是空串（L282）', () => {
    expect(COMIC_ENHANCE_MODE_DESC.OFF).toBe('');
  });
  it('四档 desc 逐字一致，且都以自己的 label 语义开头', () => {
    expect(COMIC_ENHANCE_MODE_DESC.CAS).toBe('对比度自适应锐化，强化线条与小字（最快，约 0.5 秒/页）');
    expect(COMIC_ENHANCE_MODE_DESC.ANIME4K).toBe(
      'Anime4K Restore CNN 线条重建降噪，不放大（约 2-4 秒/页）',
    );
    expect(COMIC_ENHANCE_MODE_DESC.WAIFU2X).toBe(
      'Anime4K Upscale CNN ×2 神经网络超分（低分辨率页收益最大；约 2-6 秒/页，处理时有预计耗时提示）',
    );
    expect(COMIC_ENHANCE_MODE_DESC.SUPER_RES).toBe(
      'Lanczos 2× 重建 + 自适应锐化（低分辨率页翻倍清晰度）',
    );
  });
  it('WAIFU2X 的 desc 用 U+00D7（×）而不是字母 x（L285）', () => {
    expect(COMIC_ENHANCE_MODE_DESC.WAIFU2X).toContain('×');
    expect(COMIC_ENHANCE_MODE_DESC.WAIFU2X).not.toMatch(/[a-zA-Z]×/);
  });
});

describe('fromJson 的数字枚举兼容（Android optString 会把数字转成串）', () => {
  it('mode = 0 解析为 ordinal 0 的枚举名 SINGLE', () => {
    expect(comicReaderConfigFromJson({ mode: 0 }).mode).toBe('SINGLE');
  });
  it('direction = 1 解析为 RTL', () => {
    expect(comicReaderConfigFromJson({ direction: 1 }).direction).toBe('RTL');
  });
  it('超出范围的数字（如 mode = 99）仍回落 fallback，不抛错', () => {
    expect(comicReaderConfigFromJson({ mode: 99 }).mode).toBe('SINGLE');
  });
});