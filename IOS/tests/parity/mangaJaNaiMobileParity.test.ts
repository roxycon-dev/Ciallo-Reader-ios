/**
 * mangaJaNaiMobileParity.test.ts —— `ui/comic/MangaJaNaiMobile.kt`（75 行 / 57 非空）。
 *
 * 上一轮把 `mangaJaNaiMobile.ts`（246 行）读完，确认是「早就实现了、但没有一条读
 * Kotlin 原文的测试」的那一类。本轮补上：每条断言都先锚在 Kotlin 原文的某一行上，
 * 再验证端口的行为。
 *
 * 两条容易写错的语义：
 *   · `(x).roundToInt()` 是「四舍五入到最近整数」（正数等价 `Math.round`），
 *     而 `(w * 0.93).toInt()` 是**截断**（等价 `Math.trunc`）—— 收缩循环用的是后者。
 *   · `detail[i] and -0x1000000` 保留 alpha 通道，端口必须 `& -0x1000000`
 *     而不是 `& 0xFFFFFF`。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { combineMangaJaNaiDetail, mangaMobileInputSize } from '@core/comic/mangaJaNaiMobile';
import type { PixImage } from '@core/comic/comicPixOps';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

const TILE = 128;

function pix(width: number, height: number, fill: (x: number, y: number) => number): PixImage {
  const data = new Uint32Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data[y * width + x] = fill(x, y);
  return { width, height, data };
}

describe('MangaJaNaiMobile.kt L12-23 mangaMobileInputSize', () => {
  const KT = kt('ui/comic/MangaJaNaiMobile.kt');

  it('两个上限逐字一致：1400 绝对边 + 900_000 面积开方', () => {
    expect(KT).toContain('val scale = minOf(1.0, 1400.0 / maxOf(width, height), sqrt(900_000.0 / (width.toDouble() * height)))');
    expect(KT).toContain('var w = (width * scale).roundToInt().coerceAtLeast(1)');
    expect(KT).toContain('var h = (height * scale).roundToInt().coerceAtLeast(1)');
  });

  it('缩放系数 ≤ 1 时尺寸原样返回（不放大）', () => {
    // max(1000,800)=1000 → 1400/1000=1.4；sqrt(900000/800000)=1.06 → scale = 1
    expect(mangaMobileInputSize(1000, 800, 128)).toEqual([1000, 800]);
  });

  it('roundToInt 而不是 trunc：1400×1400 先按 0.6776 缩放，两条边都四舍五入', () => {
    const scale = Math.sqrt(900_000 / (1400 * 1400));
    expect(mangaMobileInputSize(1400, 1400, 512)).toEqual([
      Math.round(1400 * scale),
      Math.round(1400 * scale),
    ]);
    // 949 而非 948 —— trunc 会少一个像素
    expect(mangaMobileInputSize(1400, 1400, 512)[0]).toBe(949);
  });

  it('收缩循环用 toInt()（截断）而非 round，且每步都 coerceAtLeast(1)', () => {
    expect(KT).toContain('w = (w * 0.93).toInt().coerceAtLeast(1)');
    expect(KT).toContain('h = (h * 0.93).toInt().coerceAtLeast(1)');
    expect(KT).toContain('while (((w + MangaJaNai.TILE - 1) / MangaJaNai.TILE).toLong() *');
    const [w, h] = mangaMobileInputSize(1400, 1400, 1);
    expect(Math.ceil(w / TILE) * Math.ceil(h / TILE)).toBeLessThanOrEqual(1);
    expect(w).toBeGreaterThanOrEqual(1);
    expect(h).toBeGreaterThanOrEqual(1);
  });

  it('tileBudget 传 0 时按 1 算（coerceAtLeast(1)）', () => {
    expect(KT).toContain('val tiles = tileBudget.coerceAtLeast(1)');
    const zero = mangaMobileInputSize(1400, 1400, 0);
    const one = mangaMobileInputSize(1400, 1400, 1);
    expect(zero).toEqual(one);
  });
});

describe('MangaJaNaiMobile.kt L28-74 combineMangaJaNaiDetail', () => {
  const KT = kt('ui/comic/MangaJaNaiMobile.kt');

  it('strength <= 0 时只画原图就返回（band 完全不分配）', () => {
    expect(KT).toContain('val paint = Paint(Paint.FILTER_BITMAP_FLAG)');
    expect(KT).toContain('Canvas(output).drawBitmap(original, null, RectF(0f, 0f, width.toFloat(), height.toFloat()), paint)');
    expect(KT).toContain('if (strength <= 0f) return output');
    const original = pix(2, 2, () => 0xff112233);
    const out = combineMangaJaNaiDetail(original, original, original, 2, 2, 0);
    expect([...out.data]).toEqual([...original.data]);
  });

  it('band 高度 min(48, height)，blend = strength.coerceIn(0, 1)', () => {
    expect(KT).toContain('val bandHeight = minOf(48, height)');
    expect(KT).toContain('val blend = strength.coerceIn(0f, 1f)');
    expect(KT).toContain('for (y in 0 until height step bandHeight)');
  });

  it('逐通道 (from + delta * blend) 再 roundToInt + coerceIn(0,255)', () => {
    expect(KT).toContain('val delta = ((ai[i] shr shift) and 255) - ((low[i] shr shift) and 255)');
    expect(KT).toContain('pixel = pixel or ((from + delta * blend).roundToInt().coerceIn(0, 255) shl shift)');
    // 1×1：原图 0xFF000000，低清 0xFF101010，AI 0xFF202020，strength=1 → 每通道 +0x10
    const original = pix(1, 1, () => 0xff000000);
    const low = pix(1, 1, () => 0xff101010);
    const ai = pix(1, 1, () => 0xff202020);
    const out = combineMangaJaNaiDetail(original, low, ai, 1, 1, 1);
    expect(out.data[0]).toBe(0xff101010);
    // strength = 0.5 → +0x08（roundToInt(8) = 8）
    expect(combineMangaJaNaiDetail(original, low, ai, 1, 1, 0.5).data[0]).toBe(0xff080808);
    // strength > 1 被 coerceIn 到 1
    expect(combineMangaJaNaiDetail(original, low, ai, 1, 1, 3).data[0]).toBe(0xff101010);
  });

  it('alpha 保留原图（and -0x1000000），不是取 AI 的 alpha', () => {
    expect(KT).toContain('var pixel = detail[i] and -0x1000000');
    const original = pix(1, 1, () => 0x80000000);
    const low = pix(1, 1, () => 0x00101010);
    const ai = pix(1, 1, () => 0xff202020);
    expect(combineMangaJaNaiDetail(original, low, ai, 1, 1, 1).data[0]).toBe(0x80101010);
  });

  it('越界被 coerceIn(0,255) 夹住（深色像素 + 负 delta）', () => {
    const original = pix(1, 1, () => 0xff050505);
    const low = pix(1, 1, () => 0xff202020);
    const ai = pix(1, 1, () => 0xff000000);
    expect(combineMangaJaNaiDetail(original, low, ai, 1, 1, 1).data[0]).toBe(0xff000000);
  });

  it('每条 band 都重查一次取消（isInterrupted → InterruptedException）', () => {
    expect(KT).toContain('if (Thread.currentThread().isInterrupted) throw InterruptedException("MangaJaNai cancelled")');
    const original = pix(1, 20, () => 0xff000000);
    const out = (): unknown => combineMangaJaNaiDetail(original, original, original, 1, 20, 1,
      () => true, () => new Error('MangaJaNai cancelled'));
    expect(out).toThrow('MangaJaNai cancelled');
  });

  it('height 不是 48 的整数倍时最后一段只处理剩余行', () => {
    const original = pix(1, 100, () => 0xff000000);
    const low = pix(1, 100, () => 0xff000000);
    const ai = pix(1, 100, () => 0xff0f0f0f);
    const out = combineMangaJaNaiDetail(original, low, ai, 1, 100, 1);
    // 3 段（48 + 48 + 4），最后一行同样被叠加
    expect(out.data[99]).toBe(0xff0f0f0f);
    expect(out.data[48]).toBe(0xff0f0f0f);
    expect(out.data.length).toBe(100);
  });
});