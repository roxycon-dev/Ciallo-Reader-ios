/**
 * 逐行复核补测（god 模块）。
 *
 * 本文件只覆盖**本次复核实际改动过、且原有用例没钉住**的行为。
 * 每条断言都注明 Android 只读源的行号，方便回溯。
 *
 * Read-only Kotlin 源：`novel-reader/app/src/main/java/com/example/god/`
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseCoverSource, cropParamsToTag, DEFAULT_CROP_PARAMS, parseCropParams } from '@core/god/godTypes';
import {
  GOD_CORNER_RATIO,
  GOD_COVER_CACHE_DIR,
  GOD_COVER_HEIGHT,
  GOD_COVER_RATIO,
  GOD_COVER_WIDTH,
  GOD_JPEG_QUALITY,
  GOD_PREVIEW_HEIGHT,
  GOD_PREVIEW_WIDTH,
  GOD_SCRIM_ALPHA,
  GOD_SHADOW_ALPHA,
  GOD_SHADOW_BLUR,
  GOD_SHADOW_DY,
  GOD_THUMBNAIL_MAX_EDGE,
  GOD_BLUR_DOWNSCALE,
  GOD_BLUR_RADIUS_RATIO,
  GOD_FOREGROUND_MARGIN,
  resolveCoverSource,
} from '@core/god/godCoverEngine';
import { GOD_CROP_MIN } from '@ui/pages/GodCoverCropPage';
import {
  GOD_CHAPTER_BADGE_TEXT,
  GOD_CHAPTER_BADGE_GLYPH,
  GOD_CHAPTER_PULSE_IN_MS,
  GOD_CHAPTER_PULSE_MS,
  GOD_CHAPTER_PULSE_OUT_MS,
  GOD_CHAPTER_PULSE_TOTAL_MS,
  GOD_CHAPTER_SCRIM_CSS,
} from '@core/god/godChapterCard';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(path.join(here, '..', '..', 'src', rel), 'utf8');

/**
 * 去掉 JSX / JS 注释后的**实现代码**。
 *
 * 本文件下面那几条断言钉的是「实现里没有写死某个字面量 / 某个分支嵌套在另一个
 * 分支里面」。直接对整份源码 `toContain`/`toMatch` 会被注释里**引用**该字面量的
 * 说明文字命中（例如 GodPull.tsx 的注释写着「此前本文件把 `rgba(255, 226, 154, …)`
 * 写死」，GodMomentSheet.tsx 的注释写着「不再手写 `'1,0,0,0,0,0,1,1'`」），
 * 于是断言在实现已经正确时反而红。这不是放宽断言：去掉注释后仍然是「实现代码里
 * 不含该字面量」，而且多出来的 `codeOf` 剥离让这些断言对注释文案免疫。
 */
function codeOf(rel: string): string {
  return src(rel)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/* ══════════════ 1. coverSource 解析：Kotlin `toIntOrNull()` 语义 ══════════════ */

/**
 * Kotlin `parseCoverSource`（GodMomentModels.kt L86-104）用
 * `p.getOrNull(1)?.toIntOrNull() ?: 0`。`toIntOrNull()` 要求**整串**是合法十进制
 * Int：带空格 / 小数点 / 尾缀一律返回 null → 0。
 * 此前 TS 用 `Number.parseInt`，那三种都会被截断成数字。
 */
describe('parseCoverSource — Kotlin toIntOrNull parity (GodMomentModels.kt L91-100)', () => {
  it('reads well-formed integers', () => {
    expect(parseCoverSource('page|3|abc')).toEqual({ kind: 'comicPage', pageIndex: 3, pageId: 'abc' });
    expect(parseCoverSource('page|03|abc')).toEqual({ kind: 'comicPage', pageIndex: 3, pageId: 'abc' });
    expect(parseCoverSource('page|-5|')).toEqual({ kind: 'comicPage', pageIndex: -5, pageId: '' });
    expect(parseCoverSource('page|+5|')).toEqual({ kind: 'comicPage', pageIndex: 5, pageId: '' });
  });

  it('falls back to 0 for partially-numeric / spaced / fractional fields', () => {
    // Number.parseInt 会给 3 / 3 / 3；Kotlin 三种都是 null → 0
    expect(parseCoverSource('page|3abc|').kind === 'comicPage' && parseCoverSource('page|3abc|')).toMatchObject({ pageIndex: 0 });
    expect(parseCoverSource('page| 3|')).toMatchObject({ pageIndex: 0 });
    expect(parseCoverSource('page|3.7|')).toMatchObject({ pageIndex: 0 });
    expect(parseCoverSource('page||')).toMatchObject({ pageIndex: 0 });
    expect(parseCoverSource('page')).toMatchObject({ pageIndex: 0 });
  });

  it('applies the same rule to novelExcerpt start/end (L96-100)', () => {
    expect(parseCoverSource('novel|c1|7|9')).toEqual({
      kind: 'novelExcerpt',
      chapterId: 'c1',
      start: 7,
      end: 9,
    });
    expect(parseCoverSource('novel|c1|2x|y')).toMatchObject({ start: 0, end: 0 });
    expect(parseCoverSource('novel|c1')).toMatchObject({ start: 0, end: 0 });
  });

  it('falls back to ComicPage(0, "") for blank / unknown tags (L87, L101)', () => {
    const fallback = { kind: 'comicPage', pageIndex: 0, pageId: '' };
    expect(parseCoverSource(null)).toEqual(fallback);
    expect(parseCoverSource(undefined)).toEqual(fallback);
    expect(parseCoverSource('')).toEqual(fallback);
    expect(parseCoverSource('   ')).toEqual(fallback);
    expect(parseCoverSource('whatever|x|y')).toEqual(fallback);
  });

  it('parseCoverSource is the single implementation (resolveCoverSource delegates)', () => {
    expect(resolveCoverSource('page|3abc|')).toEqual(parseCoverSource('page|3abc|'));
    expect(resolveCoverSource('novel|c1|7|9')).toEqual(parseCoverSource('novel|c1|7|9'));
  });
});

/* ══════════════ 2. CropParams 序列化（GodMomentModels.kt L135-170） ══════════════ */

describe('cropParamsToTag / parseCropParams (GodMomentModels.kt L135-175)', () => {
  it('serializes scale, offsetX/Y, rotationDeg, cropL/T/R/B in that exact order', () => {
    expect(
      cropParamsToTag({
        scale: 2,
        offsetX: -0.25,
        offsetY: 0.5,
        rotationDeg: 90,
        cropL: 0.1,
        cropT: 0.2,
        cropR: 0.3,
        cropB: 0.4,
      }),
    // Kotlin L137 `joinToString(",") { round3(it) }`，而 `round3` (L174-175) 是
    // `((v*1000f).roundToInt()/1000f).toString()` —— Kotlin `Float.toString()` **永远**
    // 带小数点且至少一位小数，所以 2f 打成 "2.0"、90f 打成 "90.0"。
    ).toBe('2.0,-0.25,0.5,90.0,0.1,0.2,0.3,0.4');
  });

  it('rounds to 3 decimals like Kotlin round3 (L174-175)', () => {
    expect(
      cropParamsToTag({
        scale: 1.23456,
        offsetX: 0,
        offsetY: 0,
        rotationDeg: 0,
        cropL: 0,
        cropT: 0,
        cropR: 1,
        cropB: 1,
      }),
    ).toBe('1.235,0.0,0.0,0.0,0.0,0.0,1.0,1.0');
  });

  it('round-trips the default', () => {
    expect(cropParamsToTag(DEFAULT_CROP_PARAMS)).toBe('1.0,0.0,0.0,0.0,0.0,0.0,1.0,1.0');
    expect(parseCropParams(cropParamsToTag(DEFAULT_CROP_PARAMS))).toEqual(DEFAULT_CROP_PARAMS);
  });
});

/* ══════════════ 3. 封面引擎常量（GodCoverEngine.kt L51-79 / L74-76 / L466） ══════════════ */

describe('GodCoverEngine constants (GodCoverEngine.kt L51-79, L466)', () => {
  it('matches the Kotlin values verbatim', () => {
    expect(GOD_COVER_WIDTH).toBe(900);
    expect(GOD_COVER_HEIGHT).toBe(1200);
    expect(GOD_COVER_RATIO).toBe(3 / 4);
    expect(GOD_PREVIEW_WIDTH).toBe(450);
    expect(GOD_PREVIEW_HEIGHT).toBe(600);
    expect(GOD_FOREGROUND_MARGIN).toBe(0.08);
    expect(GOD_CORNER_RATIO).toBe(0.03);
    expect(GOD_BLUR_RADIUS_RATIO).toBe(0.07);
    expect(GOD_BLUR_DOWNSCALE).toBe(8);
    expect(GOD_SCRIM_ALPHA).toBe(0.15);
    expect(GOD_JPEG_QUALITY).toBe(90);
    expect(GOD_COVER_CACHE_DIR).toBe('god_covers');
    expect(GOD_SHADOW_BLUR).toBe(22);
    expect(GOD_SHADOW_DY).toBe(10);
    expect(GOD_SHADOW_ALPHA).toBe(0.34);
    expect(GOD_THUMBNAIL_MAX_EDGE).toBe(240);
  });
});

/* ══════════════ 4. 高亮脉冲时序（GodChapterCard.kt L79-90） ══════════════ */

/**
 * Kotlin：`pulse = true` → `tween(240)` 淡入；`delay(900)` 后 `pulse = false`
 * → `tween(520)` 淡出。所以一轮是 240 + (900 已含淡入) + 520 = **1420ms**。
 * 此前 CSS 把整轮压成 900ms（淡出只剩 660ms）。
 */
describe('GodChapterCard pulse timing (GodChapterCard.kt L79-90)', () => {
  it('total = PULSE_MS + PULSE_OUT_MS = 1420', () => {
    expect(GOD_CHAPTER_PULSE_MS).toBe(900);
    expect(GOD_CHAPTER_PULSE_IN_MS).toBe(240);
    expect(GOD_CHAPTER_PULSE_OUT_MS).toBe(520);
    expect(GOD_CHAPTER_PULSE_TOTAL_MS).toBe(1420);
  });

  it('the CSS keyframe stops sit at 240/1420 and 900/1420', () => {
    const css = src('styles/god.css');
    expect(css).toMatch(/16\.9%\s*\{/);
    expect(css).toMatch(/63\.38%\s*\{/);
  });

  it('the component drives animationDuration with the total, not the window', () => {
    const tsx = src('ui/components/god/GodChapterCard.tsx');
    expect(tsx).toContain('GOD_CHAPTER_PULSE_TOTAL_MS');
  });
});

/* ══════════════ 5. 裁剪几何（GodCoverCropScreen.kt L96-138 / L156-159 / L266-275） ══════════════ */

describe('crop-screen geometry (GodCoverCropScreen.kt)', () => {
  it('MIN_CROP = 0.1 (L57)', () => {
    expect(GOD_CROP_MIN).toBe(0.1);
  });

  it('the badge strings stay verbatim (GodChapterCard.kt L260-261)', () => {
    expect(GOD_CHAPTER_BADGE_TEXT).toBe('神回');
    expect(GOD_CHAPTER_BADGE_GLYPH).toBe('✦');
    // 0xCC / 0x66 / 0x22 over #0B0C0E
    expect(GOD_CHAPTER_SCRIM_CSS).toContain('rgba(11, 12, 14, 0.8)');
    expect(GOD_CHAPTER_SCRIM_CSS).toContain('rgba(11, 12, 14, 0.4)');
    expect(GOD_CHAPTER_SCRIM_CSS).toContain('rgba(11, 12, 14, 0.133)');
  });

  it('applies the transform in Compose order: translate → rotate → scale', () => {
    // Compose graphicsLayer 的矩阵里 translate(translationX, translationY) 是
    // **最后**一层（不被 scale 吃掉、不随 rotation 换轴）。CSS 右结合，
    // 所以必须写成 translate() rotate() scale()。
    const tsx = src('ui/pages/GodCoverCropPage.tsx');
    expect(tsx).toContain(
      'translate(${offX}px, ${offY}px) rotate(${rotation}deg) scale(${scale})',
    );
    expect(tsx).not.toContain('rotate(${rotation}deg) scale(${scale}) translate(');
  });

  it('reads the source size from the <img>, so the crop box is not degenerate', () => {
    // GodMomentSheet 传 sourceWidth/Height = 0；fitRect(0,0,…) 返回 null 会让
    // 裁剪框铺满舞台、确认恒回 crop 0,0,1,1。
    const tsx = src('ui/pages/GodCoverCropPage.tsx');
    expect(tsx).toContain('naturalWidth');
    expect(tsx).toContain('naturalHeight');
  });
});

/* ══════════════ 6. 拉拽浮层取色（GodPull.kt L177-178, L215, L239-262） ══════════════ */

describe('GodPullOverlay takes its gold from godGoldGradient (GodPull.kt L177-178)', () => {
  it('no hard-coded light-mode gold rgb triple is left in the overlay', () => {
    // Kotlin GodPull.kt:178 只有 `GodGold.goldGradient(dark)`，没有裸 rgb 三元组。
    expect(codeOf('ui/components/god/GodPull.tsx')).not.toContain('rgba(255, 226, 154');
  });

  it('the spine stroke width follows the Kotlin 2 + 5·p law (L215)', () => {
    const tsx = src('ui/components/god/GodPull.tsx');
    expect(tsx).toContain('const spineWidth = 2 + p * 5;');
  });
});

/* ══════════════ 7. Sheet 文案与门控（GodMomentSheet.kt） ══════════════ */

describe('GodMomentSheet verbatim details (GodMomentSheet.kt)', () => {
  it('the section number has no invented ✦ prefix (L1017-1023)', () => {
    const tsx = src('ui/components/god/GodMomentSheet.tsx');
    expect(tsx).not.toContain('god-sheet__section-number">✦');
    expect(tsx).toContain('god-sheet__section-number">{props.number}');
  });

  it('the action bar rating uses Float.toString semantics (L1153 → "5.0")', () => {
    const tsx = src('ui/components/god/GodMomentSheet.tsx');
    expect(tsx).toMatch(/god-sheet__actions-rating[\s\S]{0,200}godRatingText\(props\.rating\)/);
  });

  it('doSave keeps all three Kotlin guards (L350)', () => {
    const tsx = src('ui/components/god/GodMomentSheet.tsx');
    expect(tsx).toContain(
      'if (saving || props.loadingCover || props.previewUrl === null) return;',
    );
  });

  it('the crop tag always goes through cropParamsToTag (L261 / L486 / L594)', () => {
    // Kotlin L261 `var cropTag by rememberSaveable { … .toTag() }`、L486 `setCrop(CropParams.DEFAULT)`、
    // L594 `setCrop(newCrop)` —— 三处都走 `toTag()`，实现里不应出现裸 tag 字面量。
    const tsx = codeOf('ui/components/god/GodMomentSheet.tsx');
    // 安卓 `CropParams.DEFAULT.toTag()` 的字节是
    // `"1.0,0.0,0.0,0.0,0.0,0.0,1.0,1.0"`（Kotlin Float.toString 恒带小数点），
    // 两种写法都不许手写。
    expect(tsx).not.toContain("'1.0,0.0,0.0,0.0,0.0,0.0,1.0,1.0'");
    expect(tsx).not.toContain("'1,0,0,0,0,0,1,1'");
    expect(tsx).toContain('setCropTag(cropParamsToTag(DEFAULT_CROP_PARAMS));');
    expect(tsx).toContain('setCropTag(cropParamsToTag(next));');
  });

  it('the form-section border follows the dark/light branch (L1011)', () => {
    const tsx = src('ui/components/god/GodMomentSheet.tsx');
    expect(tsx).toContain(
      "borderColor: props.dark ? 'rgba(245, 185, 66, 0.25)' : 'rgba(245, 185, 66, 0.19)',",
    );
  });
});

/* ══════════════ 8. 星级弹性缩放（GodStarRating.kt L185-201） ══════════════ */

describe('GodStarRatingEditable star scale (GodStarRating.kt L185-201)', () => {
  it('applies target = filled > 0 ? 1 : 0.82 as a transform', () => {
    const tsx = src('ui/components/god/GodStarRatingEditable.tsx');
    expect(tsx).toContain('transform: `scale(${scaleTarget})`');
  });

  it('the gold fill is gated on filled > 0, not on the glow threshold', () => {
    // Kotlin GodStarRating.kt L207-229：`if (filled > 0f) { if (glow > 0.02f) 微光; clipRect 金色 }`
    // 两道门互相独立，所以 TS 里金色 clipPath 段必须与 showGlow 段**平级**。
    const tsx = codeOf('ui/components/god/GodStarRatingEditable.tsx');
    expect(tsx).toMatch(/showGlow \? \([\s\S]{0,400}?\) : null\}\s*\{filled > 0 \?/);
  });
});