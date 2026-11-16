/**
 * Regression + coverage tests for the 2026-10-06 line-by-line audit of
 * `src/core/mangatranslate/**` against `com.example.mangatranslate/**` (12 Kotlin files).
 *
 * The sibling suite `mangaTranslate.test.ts` covers the ports that already existed. This
 * file covers, in order:
 *   1. the four BUGs the audit found (`packRgb` channel order, `insetFromLargestRect`
 *      scale factor, `org.json` `optString`/`optInt`/`getDouble` semantics);
 *   2. the eleven non-ONNX algorithms that had been mis-filed under E1 and are now ported
 *      (cache key/cap/trim, fingerprint sampling, OCR tensor packing, mask-contour
 *      reconstruction, safe-text-rect rasterisation, the two font-size searches, the two
 *      vertical glyph plans, and the whole long-image tiling orchestration).
 *
 * Every expectation below is derived from the Kotlin source, not from the previous TS.
 */
import { describe, expect, it } from 'vitest';

import {
  BUBBLE_INPUT_SIZE,
  computeMaskContour,
  packRgbChw,
  RawDet,
} from '../../src/core/mangatranslate/bubbleDetector';
import {
  appliedTextSize,
  binarySearchHorizontalFontSize,
  BubblePipeline,
  contrastingTextColor,
  freeBlockGeometry,
  horizontalTextSizeBounds,
  insetFallbackPad,
  insetFromLargestRect,
  insetMaskSize,
  insetTextBoundsFromContour,
  contourPageBounds,
  layoutVerticalColumns,
  MIN_ANCHORED_SIZE_PX,
  MIN_TEXT_SIZE_PX,
  packRgb,
  rasterizeContourMask,
  sampleBackgroundColor,
  TEXT_SIZE_PRECISION_PX,
  fitVerticalText,
} from '../../src/core/mangatranslate/bubblePipeline';
import {
  buildDetInputTensor,
  buildRecInputTensor,
  computePreResult,
  DET_INPUT,
  normalizeBgrPixel,
  REC_IMG_H,
  REC_IMG_W,
  recognizerTargetWidth,
} from '../../src/core/mangatranslate/mangaOcr';
import {
  compressedTileSize,
  PageRegionDetector,
  type PageRegionTileDetectors,
} from '../../src/core/mangatranslate/pageRegionDetector';
import {
  fingerprintBitmap,
  packFingerprintRows,
  PageMemoryBudget,
  planFingerprintRows,
} from '../../src/core/mangatranslate/pageMemoryBudget';
import {
  OverlayRenderer,
  parsePageTranslationJson,
  planTranslationCacheTrim,
  serializePageTranslation,
  shouldDiscardOversizedCacheFile,
  shrinkLoopHorizontalTextSize,
  layoutVerticalGlyphs,
  TRANSLATION_CACHE_DIR,
  TRANSLATION_CACHE_KEY_CHARS,
  TRANSLATION_CACHE_MAX_FILE_BYTES,
  TRANSLATION_CACHE_MAX_TOTAL_BYTES,
  translationCacheClearPlan,
  translationCacheFileName,
  translationCacheKey,
  translationCacheTotalBytes,
  type TranslationCacheFile,
} from '../../src/core/mangatranslate/translationCore';
import { parseTransmart, parseGtx } from '../../src/core/mangatranslate/scriptDetector';
import { parseStrictLlmResponse } from '../../src/core/mangatranslate/llmTranslator';
import { rectF, rectHeight, rectWidth, type RectF } from '../../src/core/mangatranslate/index';
import type { BubbleDetection } from '../../src/core/mangatranslate/bubbleDetector';

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. BUG: packRgb wrote ABGR, so contrastingTextColor weighted 0.299 against B.
 *    Kotlin `Color.rgb(r,g,b)` = 0xFF000000 | (r<<16) | (g<<8) | b  (L335).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('BUG packRgb / contrastingTextColor round trip (BubblePipeline.kt L335, L338..344)', () => {
  it('packs ARGB so (c shr 16) and 0xFF is R', () => {
    // Kotlin `Color.rgb` returns a **signed** `Int`, so `0xFFC8781E.toInt() == -3639266`。
    // `packRgb` 的 `| 0` 正是这个语义，因此这里必须与有符号值比较。
    expect(packRgb(200, 120, 30)).toBe(0xffc8781e | 0);
    expect((packRgb(200, 120, 30) >> 16) & 0xff).toBe(200);
    expect((packRgb(200, 120, 30) >> 8) & 0xff).toBe(120);
    expect(packRgb(200, 120, 30) & 0xff).toBe(30);
  });

  it('reproduces Kotlin luminance for a non-grey background (the case the ABGR bug flipped)', () => {
    // Kotlin: 0.299*200 + 0.587*120 + 0.114*30 = 133.66 > 127 -> dark text.
    // With the old ABGR packing the decoded value was (30,120,200) -> 102.21 -> light text.
    const packed = packRgb(200, 120, 30);
    expect(contrastingTextColor(packed)).toBe(0xff1b1b1b);
  });

  it('still reads the luminance of a sampled background through packRgb', () => {
    // sampleBackgroundColor returns packRgb((r/cnt), (g/cnt), (b/cnt)).
    const bg = sampleBackgroundColor(() => packRgb(200, 120, 30), 8, 8, rectF(0, 0, 8, 8));
    expect(bg).not.toBeNull();
    expect(contrastingTextColor(bg as number)).toBe(0xff1b1b1b);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. BUG: insetFromLargestRect divided by 1 instead of maskW / maskH (Kotlin L244..245).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('BUG insetFromLargestRect mask scaling (BubblePipeline.kt L241..255)', () => {
  const bounds = rectF(0, 0, 400, 200);

  it('scales the mask rect by pathBounds/maskSize', () => {
    // wScale = 400/100, hScale = 200/50 -> (10,20)-(90,80) inside a 400x200 bounds.
    const safe = insetFromLargestRect(bounds, rectF(10, 20, 90, 80), 6, 100, 50);
    expect(safe.left).toBeCloseTo(40 + 2.1, 6);
    expect(safe.right).toBeCloseTo(360 - 2.1, 6);
    expect(safe.top).toBeCloseTo(80 + 2.1, 6);
    expect(safe.bottom).toBeCloseTo(320 - 2.1, 6);
  });

  it('rejects a mask rect whose scaled result is under the 18% acceptance test', () => {
    // extraX = min(6, 400*0.12) = 6 -> 6*0.35 = 2.1 applied on each side.
    const safe = insetFromLargestRect(bounds, rectF(0, 0, 1, 1), 6, 400, 200);
    // -> the 18% rule fails, so Kotlin returns the fallbackPad inset of the bounds.
    expect(safe.left).toBeCloseTo(6, 6);
    expect(safe.top).toBeCloseTo(6, 6);
  });

  it('matches insetFallbackPad / insetMaskSize (Kotlin L219, L225..226)', () => {
    expect(insetFallbackPad(bounds)).toBeCloseTo(16, 6); // min(400,200)*0.08
    expect(insetFallbackPad(rectF(0, 0, 10, 10))).toBe(6); // coerceAtLeast(6f)
    expect(insetMaskSize(bounds)).toEqual({ maskW: 96, maskH: 96 }); // coerced up to 16..96
    expect(insetMaskSize(rectF(0, 0, 8, 4))).toEqual({ maskW: 16, maskH: 16 });
    expect(insetMaskSize(rectF(0, 0, 1472.9, 1472.9))).toEqual({ maskW: 96, maskH: 96 });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. org.json semantics (MangaTranslationCore.kt L80, L103..109;
 *    TextTranslator.kt L121, L153; LlmBubbleTranslator.kt L239).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('BUG org.json optString / optInt / getDouble semantics', () => {
  it('optString yields "" for a JSON null (not the text "null")', () => {
    const raw = JSON.stringify({
      size: { w: 10, h: 20 },
      r: [{ l: 0, t: 0, r: 4, b: 4, o: null, c: null, lang: null, v: false }],
    });
    const page = parsePageTranslationJson(raw, 10, 20);
    expect(page?.regions[0]?.original).toBe('');
    expect(page?.regions[0]?.translated).toBe('');
    expect(page?.regions[0]?.lang).toBe('');
  });

  it('optString yields "" for an absent key (Android default)', () => {
    const raw = JSON.stringify({ size: { w: 1, h: 1 }, r: [{ l: 0, t: 0, r: 2, b: 2 }] });
    const page = parsePageTranslationJson(raw, 1, 1);
    expect(page?.regions[0]?.original).toBe('');
    expect(page?.regions[0]?.translated).toBe('');
    expect(page?.regions[0]?.contour ?? null).toBeNull();
  });

  it('getDouble throwing on a missing l/t/r/b degrades the whole page to a cache miss', () => {
    // Kotlin runCatching{...}.getOrNull() on read() -> null (re-translate the page).
    const raw = JSON.stringify({ size: { w: 1, h: 1 }, r: [{ t: 0, r: 2, b: 2, o: 'x', c: 'y' }] });
    expect(parsePageTranslationJson(raw, 1, 1)).toBeNull();
  });

  it('getDouble throwing on a bad lr entry also degrades the whole page', () => {
    const raw = JSON.stringify({
      size: { w: 1, h: 1 },
      r: [{ l: 0, t: 0, r: 2, b: 2, o: '', c: '', lang: 'ja', v: false, lr: [{ t: 0, r: 1, b: 1 }] }],
    });
    expect(parsePageTranslationJson(raw, 1, 1)).toBeNull();
  });

  it('optInt returns 0 for a missing size field (Android default), so a 0x0 page matches', () => {
    const raw = JSON.stringify({ size: {}, r: [] });
    expect(parsePageTranslationJson(raw, 0, 0)).not.toBeNull();
  });

  it('parseTransmart maps a null entry to "" (optString) instead of the text "null"', () => {
    expect(parseTransmart(JSON.stringify({ header: { ret_code: 'succ' }, auto_translation: [null] }), 1)).toEqual([
      '',
    ]);
  });

  it('parseGtx maps a null segment to "" (optString)', () => {
    expect(parseGtx(JSON.stringify([[[null, 'x']]]))).toBeNull();
    expect(parseGtx(JSON.stringify([[['你', 'x']]]))).toBe('你');
  });

  it('parseStrictLlmResponse maps a null translation to "" (optString)', () => {
    const out = parseStrictLlmResponse(
      JSON.stringify({ items: [{ id: 0, translation: null }] }),
      [{ id: 0, text: 'a' }],
    );
    expect(out?.get(0)).toBe('');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. MISSING: 翻译缓存的键构造 / TTL / 容量上限 / 清理 (MangaTranslationCore.kt
 *    L61..181). Explicitly required by the audit checklist.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('TranslationCache key / cap / trim / clear (MangaTranslationCore.kt L61..181)', () => {
  it('keeps the dir name and both caps verbatim', () => {
    expect(TRANSLATION_CACHE_DIR).toBe('manga_translate_v1');
    expect(TRANSLATION_CACHE_MAX_TOTAL_BYTES).toBe(64 * 1024 * 1024);
    expect(TRANSLATION_CACHE_MAX_FILE_BYTES).toBe(4 * 1024 * 1024);
    expect(TRANSLATION_CACHE_KEY_CHARS).toBe(40);
  });

  it('takes the first 40 hex chars of the digest and appends .json (Kotlin L69..70)', () => {
    const hex = 'a'.repeat(64);
    expect(translationCacheFileName(hex)).toBe(`${'a'.repeat(40)}.json`);
  });

  it('derives a 40-hex-char lowercase key from the UTF-8 digest', async () => {
    const key = await translationCacheKey('page-1@ai-auto-v2');
    expect(key).toMatch(/^[0-9a-f]{40}\.json$/);
    // deterministic
    expect(await translationCacheKey('page-1@ai-auto-v2')).toBe(key);
    expect(await translationCacheKey('page-2@ai-auto-v2')).not.toBe(key);
  });

  it('applies the 4 MiB single-file cap on read (Kotlin L77)', () => {
    expect(shouldDiscardOversizedCacheFile(TRANSLATION_CACHE_MAX_FILE_BYTES)).toBe(false);
    expect(shouldDiscardOversizedCacheFile(TRANSLATION_CACHE_MAX_FILE_BYTES + 1)).toBe(true);
  });

  const file = (name: string, length: number, lastModified: number): TranslationCacheFile => ({
    name,
    length,
    lastModified,
  });

  it('sums totalBytes over every file (Kotlin L161..162)', () => {
    expect(translationCacheTotalBytes([file('a', 10, 1), file('b', 20, 2)])).toBe(30);
    expect(translationCacheTotalBytes([])).toBe(0);
  });

  it('clear frees the summed length of every file (Kotlin L164..170)', () => {
    expect(translationCacheClearPlan([file('a', 10, 1), file('b', 20, 2)])).toEqual({
      names: ['a', 'b'],
      freedBytes: 30,
    });
  });

  it('trimIfNeeded does nothing under the 64 MB cap (Kotlin L175)', () => {
    const plan = planTranslationCacheTrim([file('a', 1024, 1)]);
    expect(plan.deleteNames).toEqual([]);
    expect(plan.totalBytes).toBe(1024);
  });

  it('trimIfNeeded evicts oldest-first until the total fits (Kotlin L176..180)', () => {
    const half = TRANSLATION_CACHE_MAX_TOTAL_BYTES / 2 + 1024;
    const files = [
      file('newest', half, 300),
      file('oldest', half, 100),
      file('middle', half, 200),
    ];
    const plan = planTranslationCacheTrim(files);
    expect(plan.deleteNames).toEqual(['oldest', 'middle']);
    expect(plan.freedBytes).toBe(half * 2);
    expect(plan.totalBytes).toBeLessThanOrEqual(TRANSLATION_CACHE_MAX_TOTAL_BYTES);
  });

  it('keeps the eviction order stable for equal mtimes (Kotlin sortedBy is stable)', () => {
    const half = TRANSLATION_CACHE_MAX_TOTAL_BYTES / 2 + 1024;
    const plan = planTranslationCacheTrim([file('a', half, 5), file('b', half, 5)]);
    expect(plan.deleteNames).toEqual(['a']);
  });

  it('does not count a file whose delete failed (Kotlin L179 `if (f.delete())`)', () => {
    const over = TRANSLATION_CACHE_MAX_TOTAL_BYTES + 1;
    const plan = planTranslationCacheTrim([file('locked', over, 1)], () => false);
    expect(plan.deleteNames).toEqual([]);
    expect(plan.totalBytes).toBe(over);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. MISSING: PageMemoryBudget.fingerprint sampling walk (Kotlin L14..29).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('PageMemoryBudget fingerprint sampling (PageMemoryBudget.kt L14..29)', () => {
  it('derives the sample row count from the width (Kotlin L17)', () => {
    expect(PageMemoryBudget.sampleRows(512)).toBe(32);
    expect(PageMemoryBudget.sampleRows(1024)).toBe(16);
    expect(PageMemoryBudget.sampleRows(16384)).toBe(1);
    expect(PageMemoryBudget.sampleRows(100000)).toBe(1);
    // Kotlin L17 `16384/bitmap.width.coerceAtLeast(1)`：width=0 时分母被抬到 1，
    // 16384/1 = 16384，再被 `minOf(32, …)` 压到 32 —— 不是 1。
    expect(PageMemoryBudget.sampleRows(0)).toBe(32);
  });

  it('walks rows of at most `rows` px and advances by that height (Kotlin L20..27)', () => {
    const plan = planFingerprintRows(1024, 40); // rows = 16
    expect(plan.map((r) => r.height)).toEqual([16, 16, 8]);
    expect(plan.map((r) => r.y)).toEqual([0, 16, 32]);
    expect(plan.reduce((s, r) => s + r.count, 0)).toBe(1024 * 40);
  });

  it('packs 4 big-endian bytes per pixel: A, R, G, B (Kotlin L25..26 putInt)', () => {
    const bytes = packFingerprintRows(() => [0xffc8781e], 1, 1);
    expect(Array.from(bytes)).toEqual([0xff, 0xc8, 0x78, 0x1e]);
  });

  it('runs check() first and then the injected digest (Kotlin L15, L28)', () => {
    const hex = fingerprintBitmap(
      { width: 4, height: 4 },
      1 << 30,
      () => [0x00000000],
      (bytes) => `len${String(bytes.length)}`,
    );
    expect(hex).toBe('len64');
  });

  it('still rejects an over-budget page with the Kotlin message before hashing', () => {
    expect(() =>
      fingerprintBitmap({ width: 100000, height: 100000 }, 1 << 20, () => [0], () => ''),
    ).toThrow('页面过大，请降低图片清晰度后翻译');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. MISSING: OCR / detector pixel packing (MangaOcr.kt L204..217, L375..391).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('OCR tensor packing (MangaOcr.kt L204..217, L375..391)', () => {
  it('emits a [1,3,960,960] BGR-normalised CHW buffer', () => {
    const buf = buildDetInputTensor(() => 0xff000000);
    expect(buf.length).toBe(3 * DET_INPUT * DET_INPUT);
    // pure red 0xAARRGGBB -> b = 0, g = 0, r = 1
    const red = buildDetInputTensor(() => 0xffff0000);
    // Kotlin L209..211：平面 0 取 `(pixel shr 16)`、平面 1 取 `(pixel shr 8)`、
    // 平面 2 取 `(pixel and 0xFF)`。对 0xFFFF0000 来说这三个值分别是
    // 255（局部变量名叫 `b`，但读的是 R 字节）、0、0。
    expect(red[0]).toBeCloseTo((1 - 0.485) / 0.229, 9);
    expect(red[DET_INPUT * DET_INPUT]).toBeCloseTo((0 - 0.456) / 0.224, 9);
    expect(red[2 * DET_INPUT * DET_INPUT]).toBeCloseTo((0 - 0.406) / 0.225, 9);
  });

  it('normalizeBgrPixel keeps the BGR channel mapping', () => {
    expect(normalizeBgrPixel(0xff102030, 0)).toBeCloseTo((0x10 / 255 - 0.485) / 0.229, 9);
    expect(normalizeBgrPixel(0xff102030, 2)).toBeCloseTo((0x30 / 255 - 0.406) / 0.225, 9);
  });

  it('clamps targetW to 1..IMG_W with the (imgH * w/h) formula (Kotlin L375..376)', () => {
    expect(REC_IMG_H).toBe(48);
    expect(REC_IMG_W).toBe(320);
    expect(recognizerTargetWidth(640, 48)).toBe(320);
    // Kotlin L375..376：ratio = 24/48 = 0.5 → (48*0.5).toInt() = 24，
    // `coerceIn(1, 320)` 不改动它 —— 不是 1。
    expect(recognizerTargetWidth(24, 48)).toBe(24);
    expect(recognizerTargetWidth(48, 48)).toBe(48);
    expect(recognizerTargetWidth(0, 0)).toBe(1);
  });

  it('emits a [1,3,48,320] buffer with the (v - 0.5)/0.5 normalisation', () => {
    const buf = buildRecInputTensor(() => 0xff000000, 10);
    expect(buf.length).toBe(3 * REC_IMG_H * REC_IMG_W);
    expect(buf[0]).toBeCloseTo((0 - 0.5) / 0.5, 9);
    // Kotlin L381 `for (x in 0 until targetW)`：targetW=10，所以第 0 行的
    // 下标 10 起保持 FloatArray 的初值 0（下标 10 = 第 0 行第 10 列）。
    expect(buf[10]).toBe(0);
  });

  it('computePreResult keeps the 960 letterbox ratios (Kotlin L189..201)', () => {
    const pre = computePreResult(1200, 600);
    // Kotlin L192..194：scale = min(960/1200, 960/600) = 0.8 → newW=960、newH=480，
    // ratio = new/src，所以 ratioH 是 480/600 而不是 960/600。
    expect(pre.ratioW).toBeCloseTo(960 / 1200, 9);
    expect(pre.ratioH).toBeCloseTo(480 / 600, 9);
    expect(pre.padW).toBeCloseTo(0, 9);
    // Kotlin MangaOcr.kt L200 的局部量叫 `padY`，但 L224 存进 PreResult 时字段名是
    // `padH`（`padH = padY`）——所以这里断的是 `padH`，值仍然是 (960-480)/2。
    expect(pre.padH).toBeCloseTo((960 - 480) / 2, 9);
    expect(pre.originalWidth).toBe(1200);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. MISSING: BubbleDetector pixel packing + mask contour reconstruction
 *    (Kotlin L182..197, L216..278).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('BubbleDetector packRgbChw + computeMaskContour (Kotlin L182..197, L216..278)', () => {
  it('packs RGB (not BGR) CHW floats divided by 255 (Kotlin L190..192)', () => {
    const buf = packRgbChw(() => 0xff204060, 2, 2);
    const plane = 4;
    expect(buf.length).toBe(3 * plane);
    expect(buf[0]).toBeCloseTo(0x20 / 255, 9);
    expect(buf[plane]).toBeCloseTo(0x40 / 255, 9);
    expect(buf[2 * plane]).toBeCloseTo(0x60 / 255, 9);
  });

  it('reconstructs the contour of a single positive-lobe prototype (Kotlin L216..277)', () => {
    const w = 16;
    const h = 16;
    // 32 prototype planes, all zero except plane 0 which is +1 in a 4x8 block.
    const data = new Array<number>(32 * h * w).fill(0);
    for (let y = 4; y < 12; y += 1) for (let x = 4; x < 8; x += 1) data[y * w + x] = 1;
    // A detection row whose 32 mask coefficients all point at plane 0 with weight +1.
    const row = new Array<number>(38).fill(0);
    row[0] = 0; row[1] = 0; row[2] = BUBBLE_INPUT_SIZE; row[3] = BUBBLE_INPUT_SIZE;
    row[4] = 0.9; row[5] = 0;
    for (let c = 0; c < 32; c += 1) row[6 + c] = 1;
    const det = new RawDet(row);
    // A 1:1 letterbox, so no pad and gain 1.
    const pre = { gainX: 1, gainY: 1, padX: 0, padY: 0 };
    const contour = computeMaskContour(det, { data, height: h, width: w }, pre, BUBBLE_INPUT_SIZE, BUBBLE_INPUT_SIZE);
    expect(contour).not.toBeNull();
    // normalised page coords, monotone x inside the block and pairs throughout
    expect((contour as number[]).length % 2).toBe(0);
    expect((contour as number[]).length).toBeGreaterThanOrEqual(6);
    for (const v of contour as number[]) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('returns null when the prototype box degenerates (Kotlin L231)', () => {
    const det = new RawDet(new Array<number>(38).fill(0));
    const pre = { gainX: 1, gainY: 1, padX: 0, padY: 0 };
    expect(computeMaskContour(det, { data: [], height: 0, width: 0 }, pre, 10, 10)).toBeNull();
  });

  it('returns null when every mask score is negative (no largest component)', () => {
    const w = 4;
    const h = 4;
    const data = new Array<number>(32 * h * w).fill(-1);
    const row = new Array<number>(38).fill(0);
    row[2] = BUBBLE_INPUT_SIZE;
    row[3] = BUBBLE_INPUT_SIZE;
    for (let c = 0; c < 32; c += 1) row[6 + c] = 1;
    const pre = { gainX: 1, gainY: 1, padX: 0, padY: 0 };
    expect(computeMaskContour(new RawDet(row), { data, height: h, width: w }, pre, BUBBLE_INPUT_SIZE, BUBBLE_INPUT_SIZE)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. MISSING: 译文气泡的安全矩形（气泡形状随译文自适应）— BubblePipeline.kt L213..256.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('insetTextBounds rasterisation (BubblePipeline.kt L213..256)', () => {
  const square = [0.2, 0.2, 0.8, 0.2, 0.8, 0.8, 0.2, 0.8];

  it('computes the page bounds of a normalised contour', () => {
    expect(contourPageBounds(square, 1000, 1000)).toEqual(rectF(200, 200, 800, 800));
    expect(contourPageBounds([0.5], 1000, 1000)).toBeNull();
  });

  it('rasterises a convex polygon into the interior of the mask', () => {
    // 蒙版比 pathBounds 大一圈（bounds 收缩成 20%..80%，而 mask 覆盖整个 bounds），
// 所以四角都在多边形外。
    const bounds = rectF(0, 0, 1000, 1000);
    const filled = rasterizeContourMask(square, 1000, 1000, bounds, 40, 40);
    expect(filled.length).toBe(1600);
    expect(filled[20 * 40 + 20]).toBe(true); // 中心在内
    expect(filled[0]).toBe(false); // corner outside
    expect(filled[39 * 40 + 39]).toBe(false);
    // pathBounds 恰好等于多边形外接框时（insetTextBounds 真实走的路径），
    // Kotlin L232 的 `postScale((maskW-1)/width)` 把外框映射到 0..maskW-1，
    // 于是像素中心 0.5 在内、39.5 仍在外。
    const exact = rectF(200, 200, 800, 800);
    const filledExact = rasterizeContourMask(square, 1000, 1000, exact, 40, 40);
    expect(filledExact[0]).toBe(true);
    expect(filledExact[39 * 40 + 39]).toBe(false);
  });

  it('picks a safe rect inside the bubble for a full-page square bubble', () => {
    const safe = insetTextBoundsFromContour(square, 1000, 1000);
    const bounds = contourPageBounds(square, 1000, 1000) as RectF;
    expect(rectWidth(safe)).toBeGreaterThan(rectWidth(bounds) * 0.18);
    expect(rectHeight(safe)).toBeGreaterThan(rectHeight(bounds) * 0.18);
    expect(safe.left).toBeGreaterThan(bounds.left);
    expect(safe.right).toBeLessThan(bounds.right);
  });

  it('falls back to the pad inset when the largest filled rect fails the 18% test (L254)', () => {
    // 一条对角细带：外接框 980x1000，但最大内接矩形远小于 18% → Kotlin L254
    // `else inset`，返回 `fallbackPad` 内缩的 bounds。
    const thin = [0, 0, 0.02, 0, 0.98, 1, 0.96, 1];
    const safe = insetTextBoundsFromContour(thin, 1000, 1000);
    const pad = insetFallbackPad(contourPageBounds(thin, 1000, 1000) as RectF);
    expect(safe.left).toBeCloseTo(pad, 6);
    expect(safe.top).toBeCloseTo(pad, 6);
  });

  it('is reachable through the BubblePipeline facade', () => {
    expect(BubblePipeline.insetTextBounds(square, 1000, 1000)).toEqual(insetTextBoundsFromContour(square, 1000, 1000));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9. MISSING: 横排字号二分 + 锚定上限 (BubblePipeline.kt L356..390).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('horizontal font binary search (BubblePipeline.kt L356..390)', () => {
  it('brackets [low, high] with the round-19 anchored cap (L380..383)', () => {
    const rect = rectF(0, 0, 300, 80);
    expect(horizontalTextSizeBounds(rect, 1, 0)).toEqual({ low: MIN_TEXT_SIZE_PX, high: 300 });
    const anchored = horizontalTextSizeBounds(rect, 1, 40);
    expect(anchored.high).toBeCloseTo(40 * 1.15, 6);
    // Kotlin L381 `if (refLineHeight > 4f)`：refLineHeight <= 4 走未锚定分支，
    // 所以 MIN_ANCHORED_SIZE_PX 这个下限**只在锚定分支里**生效。
    expect(horizontalTextSizeBounds(rect, 1, 4).high).toBe(300);
    expect(horizontalTextSizeBounds(rect, 1, 1).high).toBe(300);
    // 锚定分支里 coerceIn 的下限是 MIN_ANCHORED_SIZE_PX：refLineHeight 刚好过门时
    // 1.15 * refLineHeight 远大于 10，锚定上限生效。
    expect(horizontalTextSizeBounds(rect, 1, 8).high).toBeCloseTo(Math.max(MIN_ANCHORED_SIZE_PX, 8 * 1.15), 6);
    // textScale multiplies
    expect(horizontalTextSizeBounds(rect, 2, 40).high).toBeCloseTo(40 * 1.15 * 2, 6);
  });

  it('binary searches to TEXT_SIZE_PRECISION_PX and reports the best fitting size', () => {
    const rect = rectF(0, 0, 300, 80);
    const { low } = horizontalTextSizeBounds(rect, 1, 40);
    const fits = (s: number): boolean => s <= 25;
    const seen: number[] = [];
    const size = binarySearchHorizontalFontSize(rect, 1, 40, (s) => {
      seen.push(s);
      return fits(s);
    });
    expect(size).not.toBeNull();
    expect(size as number).toBeLessThanOrEqual(25);
    expect(size as number).toBeGreaterThan(25 - TEXT_SIZE_PRECISION_PX);
    // Kotlin L386..389 的 `low` / `high` 是**循环内**的可变量，循环退出条件是
    // `high - low <= TEXT_SIZE_PRECISION_PX`；所以收敛要拿探测过的最小「放不下」
    // 值（= 循环结束时的 high）和返回值比，而不是跟初始 bracket 比。
    const finalHigh = Math.min(...seen.filter((s) => !fits(s)));
    expect(finalHigh - (size as number)).toBeLessThanOrEqual(TEXT_SIZE_PRECISION_PX);
    // bestSize 始终是**已探测且放得下**的最大字号。
    expect(size).toBe(Math.max(...seen.filter(fits)));
    expect(seen[0]).toBe(low);
  });

  it('returns null when even MIN_TEXT_SIZE_PX does not fit (Kotlin L384 bare return)', () => {
    expect(binarySearchHorizontalFontSize(rectF(0, 0, 300, 80), 1, 40, () => false)).toBeNull();
  });

  it('returns the low bound itself when only that fits', () => {
    expect(binarySearchHorizontalFontSize(rectF(0, 0, 300, 80), 1, 40, (s) => s <= MIN_TEXT_SIZE_PX)).toBe(
      MIN_TEXT_SIZE_PX,
    );
  });

  it('applies textScale to the queried size (Kotlin L364 paint.textSize = size * textScale)', () => {
    expect(appliedTextSize(20, 1.25)).toBe(25);
  });

  it('free block geometry keeps the 6% pad / min(10, 14%) corner (Kotlin L181..191)', () => {
    const g = freeBlockGeometry(rectF(0, 0, 100, 100));
    expect(g.ok).toBe(true);
    expect(g.pad).toBeCloseTo(6, 9);
    expect(g.corner).toBeCloseTo(10, 9);
    expect(g.inner).toEqual(rectF(6, 6, 94, 94));
    expect(freeBlockGeometry(rectF(0, 0, 5, 5)).ok).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10. MISSING: 竖排列排版 (BubblePipeline.kt L403..434; MangaTranslationCore.kt L351..392).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('vertical column layout (BubblePipeline.kt L403..434, MangaTranslationCore.kt L351..392)', () => {
  it('fits columns right-to-left with the 1.18 step and the 8% shrink walk', () => {
    const fit = fitVerticalText(10, 100, 100);
    expect(fit).not.toBeNull();
    const f = fit as { size: number; perCol: number; step: number };
    expect(f.step).toBeCloseTo(f.size * 1.18, 9);
    expect(f.perCol).toBeGreaterThanOrEqual(1);
    expect(fitVerticalText(500, 100, 100)).toBeNull(); // never fits
  });

  it('emits the Kotlin glyph plan: first column at rect.right - step/2, top + size', () => {
    const fit = fitVerticalText(6, 200, 200) as { size: number; perCol: number; step: number };
    const rect = rectF(0, 0, 200, 400);
    const glyphs = layoutVerticalColumns(['一', '二', '三', '四', '五', '六'], rect, fit) ?? [];
    expect(glyphs).toHaveLength(6);
    expect(glyphs[0]?.x).toBeCloseTo(200 - fit.step / 2, 9);
    expect(glyphs[0]?.y).toBeCloseTo(fit.size, 9);
    expect(glyphs[1]?.y).toBeCloseTo(fit.size + fit.step, 9);
    expect(glyphs[0]?.column).toBe(0);
    expect(glyphs.map((g) => g.charIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('wraps into a new column to the LEFT once perCol is exhausted', () => {
    const fit = { size: 20, perCol: 2, step: 24 };
    const glyphs = layoutVerticalColumns(['1', '2', '3', '4', '5'], rectF(0, 0, 100, 100), fit) ?? [];
    expect(glyphs.map((g) => g.column)).toEqual([0, 0, 1, 1, 2]);
    expect(glyphs[2]?.x).toBeCloseTo(100 - 24 / 2 - 24, 9);
  });

  it('returns null for a non-positive fit size (Kotlin L417 bare return)', () => {
    expect(layoutVerticalColumns(['a'], rectF(0, 0, 10, 10), { size: 0, perCol: 1, step: 1 })).toBeNull();
    expect(layoutVerticalColumns([], rectF(0, 0, 10, 10), { size: 10, perCol: 1, step: 12 })).toEqual([]);
  });

  it('OverlayRenderer lays out the same plan from a raw string', () => {
    const out = layoutVerticalGlyphs('一二三四五', rectF(0, 0, 200, 400), 1);
    expect(out).not.toBeNull();
    expect((out as { glyphs: unknown[] }).glyphs).toHaveLength(5);
    expect(layoutVerticalGlyphs('   ', rectF(0, 0, 200, 400), 1)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 11. MISSING: OverlayRenderer 横排收缩循环 (MangaTranslationCore.kt L313..341).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('OverlayRenderer horizontal shrink loop (MangaTranslationCore.kt L313..341)', () => {
  it('starts at (maxH * 0.98) capped at 64 and shrinks by 8% (Kotlin L317, L331)', () => {
    const asked: number[] = [];
    const size = shrinkLoopHorizontalTextSize(
      rectF(0, 0, 300, 40),
      1,
      (s, maxW) => {
        asked.push(s);
        expect(maxW).toBe(300); // Kotlin L314 coerceAtLeast(1)
        return { height: s * 1.05, lineFitsWidth: s <= 30 };
      },
    );
    expect(size).not.toBeNull();
    expect(size as number).toBeLessThanOrEqual(30);
    expect(asked[0]).toBeCloseTo(Math.min(40 * 0.98, 64), 9); // 39.2
  });

  it('rejects a layout whose height exceeds maxH even when the width fits', () => {
    expect(
      shrinkLoopHorizontalTextSize(rectF(0, 0, 300, 40), 1, () => ({ height: 999, lineFitsWidth: true })),
    ).toBeNull();
  });

  it('rejects a layout with an over-wide line (linesFitWidth, Kotlin L343..348)', () => {
    expect(
      shrinkLoopHorizontalTextSize(rectF(0, 0, 300, 40), 1, () => ({ height: 10, lineFitsWidth: false })),
    ).toBeNull();
  });

  it('applies textScale to the layout size (Kotlin L321)', () => {
    const asked: number[] = [];
    shrinkLoopHorizontalTextSize(rectF(0, 0, 300, 40), 2, (s) => {
      asked.push(s);
      return { height: 0, lineFitsWidth: true };
    });
    expect(asked[0]).toBeCloseTo(39.2 * 2, 6);
  });

  it('OverlayRenderer.fitFontSize keeps its vertical / horizontal split (Kotlin L395..413)', () => {
    expect(OverlayRenderer.fitFontSize('一二三', 200, 400, true)).toBeGreaterThan(0);
    expect(OverlayRenderer.fitFontSize('', 200, 400, true)).toBe(0);
    expect(OverlayRenderer.fitFontSize('甲', 4, 4, true)).toBe(0);
    // horizontal branch needs the injected Paint.measureText equivalent
    expect(OverlayRenderer.fitFontSize('甲', 200, 400, false, () => 10)).toBeGreaterThan(0);
    expect(OverlayRenderer.fitFontSize('甲', 5, 400, false, () => 10_000)).toBe(0);
    expect(() => OverlayRenderer.fitFontSize('甲', 200, 400, false)).toThrow(/measureText/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 12. MISSING: 长条漫页分片编排 (PageRegionDetector.kt L88..223).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('long-image tiling orchestration (PageRegionDetector.kt L88..223)', () => {
  const det = (rect: RectF, confidence: number, contour: number[] | null = null): BubbleDetection => ({
    rect,
    confidence,
    maskContour: contour,
  });

  /** 800 x 4000 page: height >= 2048 and ratio 5.0 > 2.0 -> long-image path. */
  const PAGE = { width: 800, height: 4000 };

  function recorder(): PageRegionTileDetectors & {
    bubbleCalls: { tileTop: number; tileH: number; detectH: number }[];
    textCalls: { tileTop: number; tileH: number }[];
  } {
    const bubbleCalls: { tileTop: number; tileH: number; detectH: number }[] = [];
    const textCalls: { tileTop: number; tileH: number }[] = [];
    return {
      bubbleCalls,
      textCalls,
      async detectBubblesInTile(input) {
        bubbleCalls.push({
          tileTop: input.tile.top,
          tileH: input.tile.height(),
          detectH: input.detectionSize.height,
        });
        return [det(rectF(100, 20, 400, 120), 0.9)];
      },
      async detectTextLinesInTile(input) {
        textCalls.push({ tileTop: input.tile.top, tileH: input.tile.height() });
        return [rectF(120, 30, 380, 60)];
      },
    };
  }

  it('compresses each bubble tile to 80% vertically, and leaves text tiles uncompressed', () => {
    // Kotlin L122..125: max(1, round(bitmapHeight * 0.8f))
    expect(compressedTileSize(2000)).toEqual({ width: 0, height: 1600 });
    expect(compressedTileSize(100)).toEqual({ width: 0, height: 80 });
    // Kotlin L267: targetHeight <= 0 means "no compression" -> the same bitmap
    expect(compressedTileSize(0)).toBeNull();
    expect(compressedTileSize(-10)).toBeNull();
  });

  it('runs the adaptive bubble tiling loop and the 25%-overlap text pass', async () => {
    const engines = recorder();
    const page = new PageRegionDetector(
      { detectBubbles: async () => [], detectTextLines: async () => [] },
      engines,
    );
    const result = await page.detect(PAGE);
    expect(result).not.toBeNull();
    // longImageBubbleDetectionTileHeight(800, 4000): base = 2000, remainder 2000 > 400
    expect(engines.bubbleCalls[0]?.tileTop).toBe(0);
    expect(engines.bubbleCalls[0]?.tileH).toBe(2000);
    // Kotlin L252-257 的顺序是「先 cropRegion 按 DETECTION_MAX_EDGE=1920 缩边长
    // （2000 → 1920），再 compressTile 压 80%（1920 → 1536）」，两步都算数。
    expect(engines.bubbleCalls[0]?.detectH).toBe(1536);
    // planPaddleTextDetectionTiles: tileHeight = max(960, 800*1.5) = 1200, stride 900
    expect(engines.textCalls.map((c) => c.tileTop)).toEqual([0, 900, 1800, 2700, 2800]);
    for (const call of engines.textCalls) expect(call.tileH).toBe(1200);
    expect(result?.complete).toBe(true);
  });

  it('remaps tile-local detections onto page coordinates', async () => {
    const engines = recorder();
    const page = new PageRegionDetector(
      { detectBubbles: async () => [], detectTextLines: async () => [] },
      engines,
    );
    const result = await page.detect(PAGE);
    // 第一片是 0..2000，cropRegion 缩到 1920 再压 80% → 1536，
    // Kotlin L233 的 `scaleY = tile.height / tileBitmap.height` = 2000/1536。
    const scaleY = 2000 / 1536;
    const first = result?.bubbles[0];
    expect(first?.rect.top).toBeCloseTo(20 * scaleY, 6);
    expect(first?.rect.bottom).toBeCloseTo(120 * scaleY, 6);
    expect(first?.confidence).toBeCloseTo(0.9, 6);
  });

  it('merges the text tiles into blocks with the correct orientation', async () => {
    const engines = recorder();
    const page = new PageRegionDetector(
      { detectBubbles: async () => [], detectTextLines: async () => [] },
      engines,
    );
    const result = await page.detect(PAGE);
    expect(result?.textBlocks.length).toBeGreaterThan(0);
    // the crop never shrinks (max edge 1920 > 800), so tile-local x maps 1:1
    for (const b of result?.textBlocks ?? []) expect(rectWidth(b.rect)).toBeCloseTo(260, 6);
  });

  it('drops a whole tile when the detector throws (Kotlin L166..169)', async () => {
    const failing: PageRegionTileDetectors = {
      detectBubblesInTile: async () => {
        throw new Error('onnx');
      },
      detectTextLinesInTile: async () => [],
    };
    const page = new PageRegionDetector(
      { detectBubbles: async () => [], detectTextLines: async () => [] },
      failing,
    );
    const result = await page.detect(PAGE);
    expect(result?.bubbles).toEqual([]);
    expect(result?.complete).toBe(true);
  });

  it('surfaces an explicit typed error when no tile detectors are wired', async () => {
    // Kotlin L38-45：`runCatching { detectLongImageTiledPage(bitmap) }.getOrElse { return null }`
    // —— 所以公开的 `detect()` 吞掉异常并返回 **null**（不是 reject）。
    // 未经 runCatching 的 `detectLongImageTiledPage` 才抛 MangaTranslateUnsupportedError。
    const page = new PageRegionDetector({
      detectBubbles: async () => [],
      detectTextLines: async () => [],
    });
    await expect(page.detect(PAGE)).resolves.toBeNull();
    await expect(page.detectLongImageTiledPage(PAGE)).rejects.toThrow(/长条漫页的分片检测/);
  });

  it('uses the whole-page path for a normal page (Kotlin L40..44)', async () => {
    const engines = recorder();
    const page = new PageRegionDetector(
      {
        detectBubbles: async () => [det(rectF(10, 10, 200, 100), 0.8)],
        detectTextLines: async () => [rectF(300, 600, 700, 660)],
      },
      engines,
    );
    const result = await page.detect({ width: 800, height: 1200 });
    expect(engines.bubbleCalls).toHaveLength(0);
    expect(engines.textCalls).toHaveLength(0);
    expect(result?.bubbles).toHaveLength(1);
    // Kotlin L71 `filterTinyTextRects`：20px 高的行在 800x1200 页上短边 20 > 6，
    // 长边 160 > 16，面积比 3200/960000 = 0.0033 > 0.0002 —— 三个门都不过滤。
    expect(result?.textBlocks.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13. The cache wire format still round-trips unchanged (regression guard for
 *     the parsePageTranslationJson rewrite).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('cache wire format regression (MangaTranslationCore.kt L120..158)', () => {
  it('emits exactly the Android key set and order', () => {
    const raw = serializePageTranslation({
      pageWidth: 800,
      pageHeight: 1200,
      regions: [
        {
          rect: rectF(1, 2, 3, 4),
          original: 'あ',
          translated: '啊',
          lang: 'ja',
          vertical: false,
          contour: [0, 0, 1, 0, 1, 1],
          lineRects: [rectF(1, 2, 3, 3)],
        },
      ],
    });
    const parsed = JSON.parse(raw) as { size: unknown; r: Record<string, unknown>[] };
    expect(parsed.size).toEqual({ w: 800, h: 1200 });
    expect(Object.keys(parsed.r[0] as object)).toEqual(['l', 't', 'r', 'b', 'o', 'c', 'lang', 'v', 'ct', 'lr']);
    expect(parsePageTranslationJson(raw, 800, 1200)?.regions[0]?.original).toBe('あ');
  });

  it('omits ct/lr exactly like Kotlin (L131..144 only writes them when present)', () => {
    const raw = serializePageTranslation({
      pageWidth: 1,
      pageHeight: 1,
      regions: [{ rect: rectF(0, 0, 1, 1), original: '', translated: '', lang: '', vertical: true }],
    });
    const parsed = JSON.parse(raw) as { r: Record<string, unknown>[] };
    expect(Object.keys(parsed.r[0] as object)).toEqual(['l', 't', 'r', 'b', 'o', 'c', 'lang', 'v']);
  });

  it('still rejects a contour with an odd length (L87)', () => {
    const raw = JSON.stringify({
      size: { w: 1, h: 1 },
      r: [{ l: 0, t: 0, r: 1, b: 1, o: '', c: '', lang: '', v: false, ct: [0, 0, 1, 1, 0] }],
    });
    expect(parsePageTranslationJson(raw, 1, 1)?.regions[0]?.contour ?? null).toBeNull();
  });
});
