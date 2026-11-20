/**
 * shelfSelectAndTranslationParity.test.ts —— 书架多选门槛 + 漫译 overlay 常量对拍。
 *
 * 两个模块的共同点：数值错一点，表现都是「手感不对」——
 * 书架多选的 `HYSTERESIS`（12dp 迟滞）决定拖选会不会抖，
 * 漫译的 `PADDING_FRACTION` / 三种颜色决定译文块贴不贴边、字压不压图。
 *
 * 覆盖：
 *   `ui/shelf/ShelfMultiSelect.kt`   HYSTERESIS / EDGE_BAND_DP
 *   `mangatranslate/MangaTranslationCore.kt`
 *       DIR_NAME / MAX_TOTAL_BYTES / PADDING_FRACTION / BG_COLOR / TEXT_COLOR / OUTLINE_COLOR
 *
 * 本轮补的缺口：`MangaTranslationCore.kt:286` 的 `TEXT_COLOR = 0xFF1A1A18`
 * 在 iOS 侧**没有对应值**（已有的是 `DEFAULT_TEXT_COLOR = 0xFF1B1B1B`，深 3 个灰阶的差别），
 * 已补成 `TRANSLATION_OVERLAY_TEXT_COLOR`。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { EDGE_BAND_DP, HYSTERESIS } from '@core/home/homeViewModel';
import {
  FREE_BLOCK_BG_COLOR,
  FREE_BLOCK_PADDING_FRACTION,
  OUTLINE_COLOR,
  TRANSLATION_OVERLAY_TEXT_COLOR,
} from '@core/mangatranslate/bubblePipeline';
import { TRANSLATION_CACHE_DIR, TRANSLATION_CACHE_MAX_TOTAL_BYTES } from '@core/mangatranslate/translationCore';

import { androidReference } from '../helpers/androidReference';

const KT = 'app/src/main/java/com/example';

function src(rel: string): string {
  return readFileSync(androidReference(`${KT}/${rel}`), 'utf8');
}

describe('ShelfMultiSelect.kt 的拖选门槛', () => {
  const source = src('ui/shelf/ShelfMultiSelect.kt');

  it('HYSTERESIS = 12dp、EDGE_BAND_DP = 96dp', () => {
    const hyst = /const\s+val\s+HYSTERESIS\s*(?::\s*Float)?\s*=\s*([\d.]+)f/.exec(source);
    const band = /const\s+val\s+EDGE_BAND_DP\s*(?::\s*Float)?\s*=\s*([\d.]+)f/.exec(source);
    expect(hyst, 'HYSTERESIS 没匹配到').not.toBeNull();
    expect(band, 'EDGE_BAND_DP 没匹配到').not.toBeNull();
    expect(HYSTERESIS).toBe(Number(hyst?.[1]));
    expect(HYSTERESIS).toBe(12);
    expect(EDGE_BAND_DP).toBe(Number(band?.[1]));
    expect(EDGE_BAND_DP).toBe(96);
    // 迟滞必须远小于感应带宽，否则「进入边缘」后立刻被迟滞弹回
    expect(HYSTERESIS).toBeLessThan(EDGE_BAND_DP / 4);
  });
});

describe('MangaTranslationCore.kt 的缓存与 overlay 常量', () => {
  const source = src('mangatranslate/MangaTranslationCore.kt');

  it('缓存目录名与 64 MiB 总量上限', () => {
    expect(source).toContain('private const val DIR_NAME = "manga_translate_v1"');
    expect(source).toContain('private const val MAX_TOTAL_BYTES = 64L * 1024 * 1024');
    expect(TRANSLATION_CACHE_DIR).toBe('manga_translate_v1');
    expect(TRANSLATION_CACHE_MAX_TOTAL_BYTES).toBe(64 * 1024 * 1024);
    expect(TRANSLATION_CACHE_MAX_TOTAL_BYTES).toBe(67_108_864);
  });

  it('PADDING_FRACTION = 0.06、三个颜色逐值一致', () => {
    const grab = (name: string): number | null => {
      const m = new RegExp(`${name}\\s*=\\s*(0[xX][0-9a-fA-F]+|[\\d.]+)f?`).exec(source);
      if (m === null) return null;
      const raw = m[1] ?? '';
      return /^0[xX]/.test(raw) ? Number.parseInt(raw, 16) : Number(raw);
    };

    expect(source).toContain('private const val PADDING_FRACTION = 0.06f');
    expect(FREE_BLOCK_PADDING_FRACTION).toBe(0.06);
    expect(FREE_BLOCK_PADDING_FRACTION).toBe(grab('PADDING_FRACTION'));

    expect(FREE_BLOCK_BG_COLOR).toBe(grab('BG_COLOR'));
    expect(FREE_BLOCK_BG_COLOR).toBe(0xfffdfbf7);

    expect(TRANSLATION_OVERLAY_TEXT_COLOR).toBe(grab('TEXT_COLOR'));
    expect(TRANSLATION_OVERLAY_TEXT_COLOR).toBe(0xff1a1a18);

    expect(OUTLINE_COLOR).toBe(grab('OUTLINE_COLOR'));
    expect(OUTLINE_COLOR).toBe(0x14262626);

    // 三者语义：纸色（浅）> 墨色（深）> 描边（极淡）
    const luminance = (argb: number): number => {
      const r = (argb >>> 16) & 0xff;
      const g = (argb >>> 8) & 0xff;
      const b = argb & 0xff;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    expect(luminance(FREE_BLOCK_BG_COLOR)).toBeGreaterThan(luminance(TRANSLATION_OVERLAY_TEXT_COLOR));
    // 描边是 0x14 alpha（20/255）的黑，几乎透明
    expect((OUTLINE_COLOR >>> 24) & 0xff).toBe(0x14);
  });
});
