/**
 * 神回模块「数据格式 / 单位 / 文案」逐行对拍的回归测试。
 *
 * Kotlin 行号映射（`novel-reader/app/src/main/java/com/example/god/`）：
 *   - `GodMomentModels.kt` L135-137 `CropParams.toTag()` / L174-175 `round3()`
 *     / L142-156 `parse` / L86-104 `parseCoverSource` / L231-233 `defaultTitle()`
 *   - `GodMotion.kt` L76 `PULL_THRESHOLD_DP` / L78 `PULL_DAMPING` / L89-94 `damp`
 *   - `GodPull.kt` L151-158（spanPx / thresholdPx 的换算）
 *   - `GodMomentSheet.kt` L262/L344（crop 的 parse→toTag 再比较）
 *
 * 这些断言锁的是**跨端字节与手感**：改了任何一处，两端读同一份备份 / 同一份手势就会分叉。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CROP_PARAMS,
  cropParamsToTag,
  defaultGodTitle,
  parseCropParams,
  parseCoverSource,
  coverSourceToTag,
} from '@core/god/godTypes';
import {
  GOD_PULL_DAMPING,
  GOD_PULL_THRESHOLD_DP,
  godPullDamp,
  godPullDampedToRaw,
  godPullProgress,
} from '@core/god/godPull';
import { godSheetNormalizedCropTag } from '@core/god/godReaderBinding';

describe('CropParams.toTag 的字节必须与 Kotlin Float.toString() 一致', () => {
  // Kotlin: `round3(v) = ((v*1000f).roundToInt() / 1000f).toString()`
  // Kotlin `Float.toString()` 永远带一位小数 ⇒ 默认值是 "1.0,0.0,…,1.0,1.0"
  it('默认值是 "1.0,0.0,0.0,0.0,0.0,0.0,1.0,1.0"，不是 "1,0,0,0,0,0,1,1"', () => {
    expect(cropParamsToTag(DEFAULT_CROP_PARAMS)).toBe('1.0,0.0,0.0,0.0,0.0,0.0,1.0,1.0');
  });

  it('0.5 步长 / 负偏移 / 四位小数一律走 round3 + Float.toString', () => {
    expect(
      cropParamsToTag({
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        rotationDeg: 0,
        cropL: 0.5,
        cropT: 0.25,
        cropR: 0.5,
        cropB: 0.25,
      }),
    ).toBe('1.0,0.0,0.0,0.0,0.5,0.25,0.5,0.25');
    expect(
      cropParamsToTag({
        scale: 1.2345,
        offsetX: -12.5,
        offsetY: 90,
        rotationDeg: 90,
        cropL: 0,
        cropT: 0,
        cropR: 1,
        cropB: 1,
      }),
    ).toBe('1.235,-12.5,90.0,90.0,0.0,0.0,1.0,1.0'); // 1.2345 → round3 → 1.235
  });

  it('round3 是 Kotlin 的 roundToInt（半数向上），0.0005 进位到 0.001', () => {
    expect(
      cropParamsToTag({
        scale: 1,
        offsetX: 0.0005,
        offsetY: 0,
        rotationDeg: 0,
        cropL: 0,
        cropT: 0,
        cropR: 1,
        cropB: 1,
      }),
    ).toBe('1.0,0.001,0.0,0.0,0.0,0.0,1.0,1.0');
  });

  it('往返：parse(toTag(x)) == x（归一化后）', () => {
    const custom = {
      scale: 2.5,
      offsetX: -4,
      offsetY: 7.125,
      rotationDeg: 180,
      cropL: 0.1,
      cropT: 0.2,
      cropR: 0.9,
      cropB: 0.8,
    };
    expect(parseCropParams(cropParamsToTag(custom))).toEqual(custom);
  });
});

describe('CropParams.parse 的字符串判定与 Kotlin toFloatOrNull() 一致', () => {
  // Number.parseFloat 是前缀解析，Kotlin toFloatOrNull() 要求整串匹配
  it('脏 tag 的字段回落默认值，而不是「解析一半」', () => {
    // "1,5" 在 JS 里 parseFloat 得 1，Kotlin toFloatOrNull() 返回 null → 1f（scale 默认值）
    expect(parseCropParams('1,0,0,0,0,0,1,1')).toEqual(DEFAULT_CROP_PARAMS);
    // " 1.5"：Kotlin null → 默认 1；JS parseFloat 会得到 1.5
    expect(parseCropParams(' 1.5,0,0,0,0,0,1,1').scale).toBe(1);
    // "1.5abc"：Kotlin null → 默认 0
    expect(parseCropParams('1,1.5abc,0,0,0,0,1,1').offsetX).toBe(0);
    // 空串 / null → DEFAULT
    expect(parseCropParams('')).toEqual(DEFAULT_CROP_PARAMS);
    expect(parseCropParams(null)).toEqual(DEFAULT_CROP_PARAMS);
    expect(parseCropParams(undefined)).toEqual(DEFAULT_CROP_PARAMS);
  });

  it('合法写法照常解析（含 Kotlin 允许的 f 后缀 / 指数 / 前导正号）', () => {
    expect(parseCropParams('2f,0,0,0,0,0,1,1').scale).toBe(2);
    expect(parseCropParams('1e0,0,0,0,0,0,1,1').scale).toBe(1);
    expect(parseCropParams('+1.0,0,0,0,0,0,1,1').scale).toBe(1);
    expect(parseCropParams('1.0,0,0,0,0,0,1,1').scale).toBe(1);
  });
});

describe('CoverSource.toTag / parseCoverSource（GodMomentModels.kt L80-104）', () => {
  it('三类来源的 tag 逐字一致', () => {
    expect(coverSourceToTag({ kind: 'comicPage', pageIndex: 0, pageId: '' })).toBe('page|0|');
    expect(coverSourceToTag({ kind: 'comicPage', pageIndex: 12, pageId: 'ab' })).toBe('page|12|ab');
    expect(coverSourceToTag({ kind: 'album', uri: 'content://media/1' })).toBe(
      'album|content://media/1',
    );
    expect(coverSourceToTag({ kind: 'novelExcerpt', chapterId: 'c', start: 1, end: 9 })).toBe(
      'novel|c|1|9',
    );
  });

  it('脏 pageIndex 走 Kotlin toIntOrNull() 语义（整串必须是合法 Int）', () => {
    expect(parseCoverSource('page|3abc|')).toEqual({
      kind: 'comicPage',
      pageIndex: 0,
      pageId: '',
    });
    expect(parseCoverSource('page| 4|')).toEqual({ kind: 'comicPage', pageIndex: 0, pageId: '' });
    expect(parseCoverSource('page|+7|')).toEqual({ kind: 'comicPage', pageIndex: 7, pageId: '' });
    expect(parseCoverSource('page|12|')).toEqual({ kind: 'comicPage', pageIndex: 12, pageId: '' });
    // 未知头 / 空 tag → ComicPage()
    expect(parseCoverSource('what|1')).toEqual({ kind: 'comicPage', pageIndex: 0, pageId: '' });
    expect(parseCoverSource('')).toEqual({ kind: 'comicPage', pageIndex: 0, pageId: '' });
  });

  it('album / novel 分支的空缺字段按 Kotlin ?: 默认值兜底', () => {
    expect(parseCoverSource('album|')).toEqual({ kind: 'album', uri: '' });
    expect(parseCoverSource('novel|c|x|y')).toEqual({
      kind: 'novelExcerpt',
      chapterId: 'c',
      start: 0,
      end: 0,
    });
    expect(parseCoverSource('novel|c|1|9')).toEqual({
      kind: 'novelExcerpt',
      chapterId: 'c',
      start: 1,
      end: 9,
    });
  });
});

describe('defaultTitle 的 ifBlank 语义（GodMomentModels.kt L231-233）', () => {
  it('bookTitle 空 → 回退 chapterTitle 的**原串**（不裁空白）', () => {
    // Kotlin `chapterTitle.ifBlank { … }` 在非 blank 时返回 receiver 本身
    expect(defaultGodTitle('', '灯塔', 56)).toBe('灯塔');
    expect(defaultGodTitle('   ', '  灯塔  ', 56)).toBe('  灯塔  ');
  });

  it('bookTitle 与 chapterTitle 都空 → 第N话', () => {
    expect(defaultGodTitle('', '', 56)).toBe('第56话');
    expect(defaultGodTitle('   ', '  ', 0)).toBe('第0话');
  });

  it('bookTitle 非空 → "书名 第N话"', () => {
    expect(defaultGodTitle('诡秘之主', '', 120)).toBe('诡秘之主 第120话');
  });
});

describe('dirty 判定用的 crop 序列化（GodMomentSheet.kt L262 / L344）', () => {
  it('parse→toTag 之后再与实体里的原始字符串比（安卓就是这么比的）', () => {
    // 安卓写出的默认值
    const androidTag = cropParamsToTag(DEFAULT_CROP_PARAMS);
    // 早期 iOS 写出的旧格式（语义相同、字节不同）
    const legacyTag = '1,0,0,0,0,0,1,1';
    const norm = (tag: string): string =>
      godSheetNormalizedCropTag(tag, parseCropParams, cropParamsToTag);
    // 归一化后两者同值 → 与任一侧的实体比较都判「未改动」
    expect(norm(legacyTag)).toBe(androidTag);
    expect(norm(androidTag)).toBe(androidTag);
  });

  it('用户真的裁过 → 归一化后仍与默认值不同', () => {
    const cropped = cropParamsToTag({ ...DEFAULT_CROP_PARAMS, cropL: 0.2, cropR: 0.8 });
    expect(godSheetNormalizedCropTag(cropped, parseCropParams, cropParamsToTag)).not.toBe(
      cropParamsToTag(DEFAULT_CROP_PARAMS),
    );
  });
});

describe('GodPull 的 spanPx / thresholdPx 必须同单位（GodPull.kt L151-158）', () => {
  it('阈值常量逐字一致', () => {
    expect(GOD_PULL_THRESHOLD_DP).toBe(96);
    expect(GOD_PULL_DAMPING).toBe(0.55);
  });

  it('damp 的形状只取决于 raw/span 比值 ⇒ 换算到物理像素后结果同乘 dpr', () => {
    // Kotlin 侧 span / raw / offset 全是物理像素（`dp.toPx()`），TS 侧统一用 CSS px。
    // `damp` 的输入只看 raw/span 的**比值**，输出按 span 线性缩放 ——
    // 所以两套口径相差一个常数因子 dpr，形状（曲线形状 / armed 点）逐点等价。
    const dpr = 3;
    const spanCss = 390;
    const spanPx = spanCss * dpr;
    for (const rawCss of [0, 30, 120, 400, 900]) {
      const fromPx = godPullDamp(rawCss * dpr, spanPx);
      const fromCss = godPullDamp(rawCss, spanCss);
      expect(fromPx / dpr).toBeCloseTo(fromCss, 10);
    }
  });

  it('阈值与 span 同单位时，armed 的原始拉距只随单位换算线性缩放', () => {
    const spanPx = 390 * 3; // Kotlin 物理像素口径
    const thresholdPx = GOD_PULL_THRESHOLD_DP * 3;
    let crossingCss = 0;
    let crossingPx = 0;
    for (let raw = 1; raw < 4000; raw += 1) {
      if (crossingCss === 0 && godPullDamp(raw, 390) >= GOD_PULL_THRESHOLD_DP) {
        crossingCss = raw;
      }
      if (crossingPx === 0 && godPullDamp(raw, spanPx) >= thresholdPx) crossingPx = raw;
    }
    expect(crossingCss).toBeGreaterThan(0);
    // 整数扫描下取整误差 ≤ 1 个 css 单位（= 3 个物理像素）
    expect(Math.abs(crossingPx - crossingCss * 3)).toBeLessThanOrEqual(3);
  });

  it('若 span 乘了 dpr 而阈值没乘（本次修掉的 BUG），armed 会提前 3 倍', () => {
    const span = 390 * 3;
    let wrong = 0;
    for (let raw = 1; raw < 4000; raw += 1) {
      if (godPullDamp(raw, span) >= GOD_PULL_THRESHOLD_DP) {
        wrong = raw;
        break;
      }
    }
    let right = 0;
    for (let raw = 1; raw < 4000; raw += 1) {
      if (godPullDamp(raw, 390) >= GOD_PULL_THRESHOLD_DP) {
        right = raw;
        break;
      }
    }
    expect(wrong).toBeLessThan(right); // 旧口径确实更早 armed
    expect(godPullProgress(GOD_PULL_THRESHOLD_DP, GOD_PULL_THRESHOLD_DP)).toBe(1);
  });

  it('dampedToRaw 与 damp 在比值 < 0.999 时互为逆运算', () => {
    const span = 390;
    for (const raw of [1, 30, 120, 400]) {
      const back = godPullDampedToRaw(godPullDamp(raw, span), span);
      expect(Math.abs(back - raw) / raw).toBeLessThan(0.05);
    }
  });
});