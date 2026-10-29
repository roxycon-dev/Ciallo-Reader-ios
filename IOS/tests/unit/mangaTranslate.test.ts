/**
 * Tests for `src/core/mangatranslate/*` — Module C.
 *
 * Manga translation is a deliberate scope exclusion (see `src/core/mangatranslate/index.ts`),
 * so these tests cover the parts that WERE ported because they are pure:
 * script detection, the model-URL allow-list, the LLM wire protocol, the page-memory guard,
 * the privacy gate, the tiling/geometry planners, the DB + CTC post-processors, the bubble
 * NMS, the region grouper and the cache (de)serialisers.
 *
 * Every expectation is derived from the Kotlin source, not from the TS implementation.
 */
import { describe, expect, it } from 'vitest';
import {
  MANGA_TRANSLATE_SCOPE_EXCLUSION,
  MangaTranslateUnsupportedError,
  copyRect,
  rectF,
  rectHeight,
  rectWidth,
} from '../../src/core/mangatranslate/index';
import {
  OnlineFallbackTranslator,
  ScriptDetector,
  TRANSMART_ENDPOINT,
  assertTransmartBatchLimits,
  buildTransmartBody,
  gtxSourceLang,
  parseGtx,
  parseTransmart,
  transmartSourceLang,
} from '../../src/core/mangatranslate/scriptDetector';
import {
  BUBBLE_MODEL,
  DET_MODEL,
  REC_MODEL,
  assertModelDownloadSizes,
  formatMegabytesOneDecimal,
  httpFailureMessage,
  incompleteDownloadMessage,
  isFileAndBig,
  modelFileSignature,
  progressCallbacks,
  totalMinBytes,
  validateModelDownloadUrl,
} from '../../src/core/mangatranslate/modelManager';
import {
  GLOSSARY_MAX_KEYS,
  LLM_MAX_ITEMS,
  LLM_MAX_TOTAL_CHARS,
  LLM_RETRY_COUNT,
  LlmGlossary,
  PROMPT_FALLBACK,
  buildGeminiRequest,
  buildLlmUserPayload,
  buildOpenAiCompatibleRequest,
  isValidLlmConfig,
  llmBatchGuard,
  llmCacheKeyPayload,
  llmTranslateBuckets,
  parseGeminiContent,
  parseOpenAiContent,
  parseStrictLlmResponse,
  sanitizeLlmEndpoint,
} from '../../src/core/mangatranslate/llmTranslator';
import { PageMemoryBudget } from '../../src/core/mangatranslate/pageMemoryBudget';
import { TranslationPrivacy } from '../../src/core/mangatranslate/translationPrivacy';
import {
  adaptiveNextTileTop,
  detectionTile,
  filterTinyTextRects,
  isTinyBubbleErrorRegion,
  isTinyTextErrorRegion,
  longImageBubbleDetectionInputHeight,
  longImageBubbleDetectionTileHeight,
  planPaddleTextDetectionTiles,
  rectContains,
  rectIou,
  remapTileMaskContourToPage,
  shouldFilterLongImageRegion,
  shouldUseLongImageTiling,
  tileBoundaryMargin,
} from '../../src/core/mangatranslate/pageRegionTiling';
import { TextBlockMerger, TextLineOrientation } from '../../src/core/mangatranslate/textBlockMerger';
import {
  DET_INPUT,
  buildRecognizerCharset,
  computePreResult,
  ctcDecode,
  extractLineRects,
  normalizeBgrPixel,
  sortBoxesReadingOrder,
} from '../../src/core/mangatranslate/mangaOcr';
import {
  BUBBLE_INPUT_SIZE,
  areDuplicate,
  computeLetterbox,
  deduplicateBubbleDetections,
  retainLargestConnectedComponent,
} from '../../src/core/mangatranslate/bubbleDetector';
import {
  BubblePipeline,
  contrastingTextColor,
  findLargestFilledRect,
  medianLineHeight,
  prefersVerticalText,
  sampleBackgroundColor,
} from '../../src/core/mangatranslate/bubblePipeline';
import {
  TranslationCoordinator,
  detectAndOcrFilter,
  hasUsableText,
  ocrRegionFilter,
  parsePageTranslationJson,
  serializePageTranslation,
  TextBlockGrouper,
} from '../../src/core/mangatranslate/translationCore';
import {
  needsTileCompression,
  planCropRegion,
  remapRectToPage,
} from '../../src/core/mangatranslate/pageRegionDetector';
import type { RectF } from '../../src/core/mangatranslate/index';

describe('module scope marker', () => {
  it('declares the exclusion and the typed stub error', () => {
    expect(MANGA_TRANSLATE_SCOPE_EXCLUSION).toBe(true);
    const e = new MangaTranslateUnsupportedError('X.y', 'onnx-inference', 'detail');
    expect(e).toBeInstanceOf(Error);
    expect(e.androidSymbol).toBe('X.y');
    expect(e.reason).toBe('onnx-inference');
    expect(e.message).toContain('X.y');
  });

  it('throws the typed error from an inference entry point', () => {
    expect(() => PageMemoryBudget.fingerprint({ width: 10, height: 10 }, 1 << 30)).toThrow(
      MangaTranslateUnsupportedError,
    );
    expect(() => BubblePipeline.bake(null, [], 1)).toThrow(MangaTranslateUnsupportedError);
  });

  it('RectF helpers match android.graphics.RectF', () => {
    const r = rectF(1, 2, 5, 8);
    expect(rectWidth(r)).toBe(4);
    expect(rectHeight(r)).toBe(6);
    expect(copyRect(r)).toEqual(r);
    expect(copyRect(r)).not.toBe(r);
  });
});

describe('ScriptDetector.detect (TextTranslator.kt 28..54)', () => {
  it('detects Japanese kana', () => {
    expect(ScriptDetector.detect('こんにちは')).toBe('ja');
    expect(ScriptDetector.detect('バーム')).toBe('ja');
  });

  it('detects Korean hangul', () => {
    expect(ScriptDetector.detect('안녕하세요')).toBe('ko');
  });

  it('detects English latin', () => {
    expect(ScriptDetector.detect('hello world')).toBe('en');
    expect(ScriptDetector.detect('ABC')).toBe('en');
  });

  it('treats pure kanji as Chinese (round-19 false-positive fix)', () => {
    expect(ScriptDetector.detect('这是一本中文书')).toBe('zh');
  });

  it('returns null when nothing is recognised', () => {
    expect(ScriptDetector.detect('')).toBeNull();
    expect(ScriptDetector.detect('！。、')).toBeNull();
  });

  it('kana beats latin for mixed text (when order matters)', () => {
    // kana*3 >= total/4 -> ja
    expect(ScriptDetector.detect('こんにちはabc')).toBe('ja');
  });
});

describe('OnlineFallbackTranslator wire format (TextTranslator.kt 56..163)', () => {
  it('keeps the Tencent endpoint and headers', () => {
    expect(TRANSMART_ENDPOINT).toBe('https://transmart.qq.com/api/imt');
  });

  it('maps source lang with the auto fallback', () => {
    expect(transmartSourceLang('ja')).toBe('ja');
    expect(transmartSourceLang('en')).toBe('en');
    expect(transmartSourceLang('zh')).toBe('zh');
    expect(transmartSourceLang('ko')).toBe('auto');
    expect(gtxSourceLang('zh')).toBe('auto');
    expect(gtxSourceLang('ja')).toBe('ja');
  });

  it('builds the request body with the Android key order and values', () => {
    const raw = buildTransmartBody(['a', 'b'], 'ja');
    expect(JSON.parse(raw)).toEqual({
      header: {
        fn: 'auto_translation',
        session: '',
        client_key: 'browser-chromium-131.0.0.0',
      },
      source: { text_list: ['a', 'b'], lang: 'ja' },
      target: { lang: 'zh' },
    });
  });

  it('enforces 500 texts / 128000 chars with the Android message', () => {
    expect(() => assertTransmartBatchLimits(new Array(500).fill('x'))).not.toThrow();
    expect(() => assertTransmartBatchLimits(new Array(501).fill('x'))).toThrow('翻译请求过大');
    const wide = new Array(400).fill('y'.repeat(400));
    expect(() => assertTransmartBatchLimits(wide)).toThrow('翻译请求过大');
  });

  it('parseTransmart requires header.ret_code === succ and an exact length', () => {
    expect(parseTransmart(JSON.stringify({ header: { ret_code: 'succ' }, auto_translation: ['译'] }), 1)).toEqual([
      '译',
    ]);
    expect(parseTransmart(JSON.stringify({ header: { ret_code: 'fail' }, auto_translation: ['译'] }), 1)).toBeNull();
    expect(parseTransmart(JSON.stringify({ header: { ret_code: 'succ' } }), 1)).toBeNull();
    expect(parseTransmart(JSON.stringify({ header: { ret_code: 'succ' }, auto_translation: ['a', 'b'] }), 1)).toBeNull();
    expect(parseTransmart('not json', 1)).toBeNull();
  });

  it('parseGtx concatenates the segments and rejects blank output', () => {
    expect(parseGtx(JSON.stringify([[['你好', 'hi'], ['世界', 'world']]]))).toBe('你好世界');
    expect(parseGtx(JSON.stringify([[['', '']]]))).toBeNull();
    expect(parseGtx('{}')).toBeNull();
  });

  it('exposes the Android gating order without performing IO', () => {
    const ok = new OnlineFallbackTranslator();
    const blocked = new OnlineFallbackTranslator(undefined, () => false);
    expect(ok.planBatch([])).toBe('empty');
    expect(blocked.planBatch(['a'])).toBe('privacy-blocked');
    expect(ok.planBatch(['a'])).toBe('sized');
    expect(() => ok.translate('x', 'ja')).toThrow(MangaTranslateUnsupportedError);
  });
});

describe('TranslateModelManager specs + validateUrl (TranslateModelManager.kt)', () => {
  it('keeps all three model specs byte-identical', () => {
    expect(DET_MODEL.fileName).toBe('ppocr_det.onnx');
    expect(DET_MODEL.minBytes).toBe(9_000_000);
    expect(DET_MODEL.label).toBe('文字检测模型');
    expect(DET_MODEL.sha256).toBe(
      'd73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e',
    );
    expect(DET_MODEL.urls).toHaveLength(2);
    expect(REC_MODEL.fileName).toBe('ppocr_rec.onnx');
    expect(REC_MODEL.minBytes).toBe(19_000_000);
    expect(REC_MODEL.label).toBe('文字识别模型');
    expect(BUBBLE_MODEL.fileName).toBe('mt_yolo_bubble.onnx');
    expect(BUBBLE_MODEL.minBytes).toBe(4_000_000);
    expect(BUBBLE_MODEL.label).toBe('气泡分割模型');
    expect(BUBBLE_MODEL.urls).toHaveLength(6);
    expect(totalMinBytes()).toBe(32_000_000);
  });

  it('accepts only https public CDNs', () => {
    expect(validateModelDownloadUrl(BUBBLE_MODEL.urls[0] as string)).toBe(BUBBLE_MODEL.urls[0]);
    expect(() => validateModelDownloadUrl('http://example.com/a.onnx')).toThrow('仅允许 https 下载源');
    expect(() => validateModelDownloadUrl('https://localhost/a.onnx')).toThrow('拒绝非公网下载源');
    expect(() => validateModelDownloadUrl('https://127.0.0.1/a.onnx')).toThrow('拒绝非公网下载源');
    expect(() => validateModelDownloadUrl('https://a.localhost/a.onnx')).toThrow('拒绝非公网下载源');
    expect(() => validateModelDownloadUrl('https://foo.internal/a.onnx')).toThrow('拒绝非公网下载源');
    expect(() => validateModelDownloadUrl('https://10.1.2.3/a.onnx')).toThrow('拒绝私网/保留地址下载源');
    expect(() => validateModelDownloadUrl('https://172.16.0.1/a.onnx')).toThrow('拒绝私网/保留地址下载源');
    expect(() => validateModelDownloadUrl('https://192.168.1.1/a.onnx')).toThrow('拒绝私网/保留地址下载源');
    expect(() => validateModelDownloadUrl('https://169.254.1.1/a.onnx')).toThrow('拒绝私网/保留地址下载源');
    expect(() => validateModelDownloadUrl('https://224.0.0.1/a.onnx')).toThrow('拒绝私网/保留地址下载源');
    // 172.32.x is public
    expect(validateModelDownloadUrl('https://172.32.0.1/a.onnx')).toBe('https://172.32.0.1/a.onnx');
  });

  it('keeps the file-signature template and the 32-entry cache bound', () => {
    expect(modelFileSignature('/f/a.onnx', 10, 20, DET_MODEL)).toBe(
      `/f/a.onnx:10:20:${DET_MODEL.sha256}`,
    );
    expect(modelFileSignature('/f/a.onnx', 1, 2, { ...DET_MODEL, sha256: null })).toBe('/f/a.onnx:1:2:null');
    expect(isFileAndBig(true, 100, 99)).toBe(true);
    expect(isFileAndBig(true, 98, 99)).toBe(false);
    expect(isFileAndBig(false, 100, 1)).toBe(false);
  });

  it('formats the incomplete-download message like String.format("%.1f")', () => {
    expect(formatMegabytesOneDecimal(9.04)).toBe('9.0');
    expect(formatMegabytesOneDecimal(9.05)).toBe('9.1');
    expect(formatMegabytesOneDecimal(12.34)).toBe('12.3');
    expect(incompleteDownloadMessage(DET_MODEL, 8_000_000)).toBe('文字检测模型下载不完整（8.0MB < 9MB）');
    expect(httpFailureMessage(404, 'https://hf-mirror.com/a/b/c.onnx')).toBe(
      'HTTP 404（hf-mirror.com/a/b/c.onnx…）',
    );
  });

  it('reports progress against the 3-model minimum total', () => {
    const cb = progressCallbacks(0, DET_MODEL);
    expect(cb.during(1)).toBeCloseTo(9 / 32, 6);
    expect(cb.after(9_000_000)).toBeCloseTo(9 / 32, 6);
    expect(progressCallbacks(31_000_000, REC_MODEL).during(1)).toBeCloseTo(1, 6);
  });

  it('enforces the 128 MiB download caps', () => {
    expect(() => assertModelDownloadSizes(0, 0)).not.toThrow();
    expect(() => assertModelDownloadSizes(129 * 1024 * 1024, 0)).toThrow('模型文件过大');
    expect(() => assertModelDownloadSizes(0, 129 * 1024 * 1024)).toThrow('模型文件过大');
    expect(() => assertModelDownloadSizes(1000, 999)).toThrow('模型下载不完整');
    expect(() => assertModelDownloadSizes(-1, 10)).not.toThrow();
  });
});

describe('LlmBubbleTranslator wire protocol (LlmBubbleTranslator.kt)', () => {
  const cfg = { apiUrl: 'https://api.x/v1', apiKey: 'k', modelName: 'gpt-x', geminiFormat: false };

  it('keeps RETRY_COUNT = 3 and the request caps', () => {
    expect(LLM_RETRY_COUNT).toBe(3);
    expect(LLM_MAX_ITEMS).toBe(500);
    expect(LLM_MAX_TOTAL_CHARS).toBe(128_000);
  });

  it('isValid requires apiUrl and modelName', () => {
    expect(isValidLlmConfig(cfg)).toBe(true);
    expect(isValidLlmConfig({ ...cfg, apiUrl: '  ' })).toBe(false);
    expect(isValidLlmConfig({ ...cfg, modelName: '' })).toBe(false);
  });

  it('cache key payload keeps the field order and lowercase boolean', () => {
    expect(llmCacheKeyPayload(cfg)).toBe('https://api.x/v1|gpt-x|false');
    expect(llmCacheKeyPayload({ ...cfg, geminiFormat: true })).toBe('https://api.x/v1|gpt-x|true');
  });

  it('builds the user payload as {items, glossary}', () => {
    const items = llmTranslateBuckets([{ rect: rectF(0, 0, 1, 1), original: 'あ' }]);
    expect(items).toEqual([{ id: 0, text: 'あ' }]);
    expect(JSON.parse(buildLlmUserPayload(items, { 人名: 'Roxy' }))).toEqual({
      items: [{ id: 0, text: 'あ' }],
      glossary: { 人名: 'Roxy' },
    });
  });

  it('builds the OpenAI-compatible body with temperature 0.2', () => {
    const { url, body } = buildOpenAiCompatibleRequest(cfg, 'P', 'U');
    expect(url).toBe('https://api.x/v1/chat/completions');
    expect(JSON.parse(body)).toEqual({
      model: 'gpt-x',
      messages: [
        { role: 'system', content: 'P' },
        { role: 'user', content: 'U' },
      ],
      temperature: 0.2,
    });
  });

  it('builds the Gemini body and the v1beta URL fallback', () => {
    const { url, body } = buildGeminiRequest({ ...cfg, geminiFormat: true }, 'P', 'U');
    expect(url).toBe('https://api.x/v1/models/gpt-x:generateContent?key=k');
    expect(JSON.parse(body)).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'P\n\nU' }] }],
      generationConfig: { temperature: 0.2 },
    });
    // no path segment -> "v1beta"
    const noPath = buildGeminiRequest({ ...cfg, apiUrl: 'https://generativelanguage.googleapis.com' }, 'P', 'U');
    expect(noPath.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gpt-x:generateContent?key=k',
    );
  });

  it('sanitizes endpoints: LAN allowed, loopback rejected', () => {
    expect(sanitizeLlmEndpoint('http://192.168.1.5:1234/v1', false)).toBe('http://192.168.1.5:1234/v1');
    expect(() => sanitizeLlmEndpoint('ftp://x/v1', false)).toThrow('API 地址须以 http(s):// 开头');
    expect(() => sanitizeLlmEndpoint('https://localhost:1234/v1', false)).toThrow(
      '请填局域网 IP 而非 localhost（如 http://192.168.x.x:1234）',
    );
    expect(() => sanitizeLlmEndpoint('https://127.0.0.1/v1', false)).toThrow('请填局域网 IP');
    expect(() => sanitizeLlmEndpoint('not a url', false)).toThrow('API 地址缺少主机名');
  });

  it('parses OpenAI / Gemini content envelopes', () => {
    expect(parseOpenAiContent(JSON.stringify({ choices: [{ message: { content: 'x' } }] }))).toBe('x');
    expect(parseOpenAiContent(JSON.stringify({}))).toBeNull();
    expect(parseGeminiContent(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'y' }] } }] }))).toBe('y');
    expect(parseGeminiContent(JSON.stringify({ candidates: [] }))).toBeNull();
  });

  it('parseStrict strips markdown fences and requires an exact id set', () => {
    const requested = [
      { id: 0, text: 'a' },
      { id: 1, text: 'b' },
    ];
    const ok = '```json\n{"items":[{"id":0,"translation":"甲"},{"id":1,"translation":"乙"}]}\n```';
    expect(parseStrictLlmResponse(ok, requested)?.get(0)).toBe('甲');

    // duplicate id -> reject
    expect(
      parseStrictLlmResponse(
        '{"items":[{"id":0,"translation":"a"},{"id":0,"translation":"b"}]}',
        requested,
      ),
    ).toBeNull();
    // missing id -> reject
    expect(parseStrictLlmResponse('{"items":[{"id":0,"translation":"a"}]}', requested)).toBeNull();
    // extra id -> reject
    expect(
      parseStrictLlmResponse(
        '{"items":[{"id":0,"translation":"a"},{"id":1,"translation":"b"},{"id":2,"translation":"c"}]}',
        requested,
      ),
    ).toBeNull();
    // missing field -> reject
    expect(parseStrictLlmResponse('{"items":[{"id":0}]}', requested)).toBeNull();
    // no items array -> reject
    expect(parseStrictLlmResponse('{}', requested)).toBeNull();
    expect(parseStrictLlmResponse('not json', requested)).toBeNull();
  });

  it('merges glossary_used with the 128-key / 80 / 120 bounds', () => {
    const glossary = new LlmGlossary();
    // the blank key and the blank value are skipped, but k->v is a valid merge
    expect(glossary.mergeUsed({ '': 'x', a: ' ' })).toBe(false);
    expect(glossary.mergeUsed({ k: 'v' })).toBe(true);
    expect(glossary.snapshot()).toEqual({ k: 'v' });

    const many: Record<string, string> = {};
    for (let i = 0; i < 200; i += 1) many[`k${i}`] = 'v';
    glossary.mergeUsed(many);
    expect(glossary.size()).toBe(GLOSSARY_MAX_KEYS);

    const g2 = new LlmGlossary();
    expect(g2.mergeUsed({ ['x'.repeat(81)]: 'v' })).toBe(false);
    expect(g2.mergeUsed({ k: 'y'.repeat(121) })).toBe(false);
  });

  it('round-trips the glossary through its JSON form', () => {
    const g = LlmGlossary.fromJson(JSON.stringify({ 人名: 'Roxy', blank: '' }));
    // Android's init only bounds key/value LENGTHS, so an empty value is kept too.
    expect(g.snapshot()).toEqual({ 人名: 'Roxy', blank: '' });
    expect(LlmGlossary.fromJson(null).size()).toBe(0);
    expect(LlmGlossary.fromJson('{')).toEqual(LlmGlossary.fromJson(null));
  });

  it('keeps the fallback prompt verbatim', () => {
    expect(PROMPT_FALLBACK).toContain('你是漫画翻译机');
    expect(PROMPT_FALLBACK).toContain('glossary_used');
    expect(PROMPT_FALLBACK).toContain('按每个气泡独立翻译');
    expect(PROMPT_FALLBACK.split('\n')).toHaveLength(4);
  });

  it('guards translateBubbles in the Android order', () => {
    expect(llmBatchGuard([], true, cfg)).toBe('empty');
    expect(llmBatchGuard(new Array(LLM_MAX_ITEMS + 1).fill({ id: 0, text: 'a' }), true, cfg)).toBe('oversized');
    expect(
      llmBatchGuard([{ id: 0, text: 'x'.repeat(LLM_MAX_TOTAL_CHARS + 1) }], true, cfg),
    ).toBe('oversized');
    expect(llmBatchGuard([{ id: 0, text: 'a' }], false, cfg)).toBe('privacy-blocked');
    expect(llmBatchGuard([{ id: 0, text: 'a' }], true, { ...cfg, apiUrl: '' })).toBe('config-invalid');
    expect(llmBatchGuard([{ id: 0, text: 'a' }], true, cfg)).toBe('proceed');
  });
});

describe('PageMemoryBudget.check + TranslationPrivacy.allowed', () => {
  it('allows pages under allowed/4 and rejects the rest with the Android message', () => {
    const heap = 512 * 1024 * 1024;
    expect(PageMemoryBudget.allowedPixelBudget(heap)).toBe(32 * 1024 * 1024);
    const allowed = Math.floor((32 * 1024 * 1024) / 4);
    expect(() => PageMemoryBudget.check({ width: 1000, height: allowed / 1000 }, heap)).not.toThrow();
    expect(() => PageMemoryBudget.check({ width: 4000, height: 4000 }, heap)).toThrow(
      '页面过大，请降低图片清晰度后翻译',
    );
  });

  it('clamps the heap-derived budget', () => {
    expect(PageMemoryBudget.allowedPixelBudget(8 * 1024 * 1024)).toBe(1024 * 1024);
  });

  it('samples rows with Kotlin Int division', () => {
    expect(PageMemoryBudget.sampleRows(1000)).toBe(16);
    expect(PageMemoryBudget.sampleRows(1)).toBe(32);
    expect(PageMemoryBudget.sampleRows(0)).toBe(32);
  });

  it('blocks translation under privacy mode or incognito', () => {
    expect(TranslationPrivacy.allowed(false, false)).toBe(true);
    expect(TranslationPrivacy.allowed(true, false)).toBe(false);
    expect(TranslationPrivacy.allowed(false, true)).toBe(false);
    expect(TranslationPrivacy.allowed(true, true)).toBe(false);
  });
});

describe('PageRegionTiling geometry (PageRegionTiling.kt)', () => {
  it('gates long-image tiling on height >= 2048 and aspect > 2.0', () => {
    expect(shouldUseLongImageTiling(800, 2000)).toBe(false);
    expect(shouldUseLongImageTiling(800, 2048)).toBe(true);
    expect(shouldUseLongImageTiling(800, 2047)).toBe(false);
    expect(shouldUseLongImageTiling(800, 2049)).toBe(true);
    expect(shouldUseLongImageTiling(1000, 3000)).toBe(true);
    expect(shouldUseLongImageTiling(0, 3000)).toBe(false);
  });

  it('treats a barely-taller page as one whole tile', () => {
    // base tile = 800 * 2.5 = 2000; remainder 100 <= 2000 * 0.2 = 400 -> whole page
    expect(longImageBubbleDetectionTileHeight(800, 2100)).toBe(2100);
    expect(longImageBubbleDetectionTileHeight(800, 3000)).toBe(2000);
    expect(longImageBubbleDetectionTileHeight(0, 3000)).toBe(0);
  });

  it('applies the 80% vertical compression scale', () => {
    expect(longImageBubbleDetectionInputHeight(1000)).toBe(800);
    expect(longImageBubbleDetectionInputHeight(1)).toBe(1);
    expect(longImageBubbleDetectionInputHeight(0)).toBe(0);
  });

  it('returns a single tile for a normal page', () => {
    const tiles = planPaddleTextDetectionTiles(800, 1200);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.left).toBe(0);
    expect(tiles[0]?.top).toBe(0);
    expect(tiles[0]?.height()).toBe(1200);
  });

  it('plans overlapping tiles for a long page with a pinned final tile', () => {
    // page 800x4000: tile = max(960, 800*1.5=1200) = 1200, stride = 1200*0.75 = 900
    const tiles = planPaddleTextDetectionTiles(800, 4000);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.every((t) => t.height() === 1200)).toBe(true);
    expect(tiles[tiles.length - 1]?.top).toBe(4000 - 1200);
  });

  it('clamps the tile boundary margin into 4..20 px', () => {
    expect(tileBoundaryMargin(100)).toBe(4);
    expect(tileBoundaryMargin(1000)).toBe(15);
    expect(tileBoundaryMargin(10000)).toBe(20);
  });

  it('filters tiny text / bubble error regions', () => {
    const tiny: RectF = rectF(0, 0, 4, 4);
    expect(isTinyTextErrorRegion(tiny, 1000, 1000)).toBe(true);
    expect(isTinyTextErrorRegion(rectF(0, 0, 400, 400), 1000, 1000)).toBe(false);
    expect(isTinyBubbleErrorRegion(tiny, 1000, 1000)).toBe(true);
    expect(isTinyBubbleErrorRegion(rectF(0, 0, 400, 400), 1000, 1000)).toBe(false);
    // degenerate rect is always "tiny"
    expect(isTinyTextErrorRegion(rectF(10, 10, 10, 10), 1000, 1000)).toBe(true);
  });

  it('filterTinyTextRects is a no-op on an empty list', () => {
    expect(filterTinyTextRects([], 100, 100)).toEqual([]);
  });

  it('filters a full-page-height stripe on long images', () => {
    // pageWidth * 1.8 == 1440 for an 800px page
    expect(shouldFilterLongImageRegion(rectF(0, 0, 800, 1439), 800, 4000)).toBe(false);
    expect(shouldFilterLongImageRegion(rectF(0, 0, 800, 1440), 800, 4000)).toBe(true);
    expect(shouldFilterLongImageRegion(rectF(0, 0, 800, 1440), 800, 1200)).toBe(false);
  });

  it('replays a truncated bottom bubble but never stalls', () => {
    const tile = detectionTile(0, 0, 800, 2000);
    const next = adaptiveNextTileTop(tile, 4000, 2000, [rectF(10, 1800, 300, 2000)]);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(2000);
    // no bottom-edge rects -> flush against the tile bottom
    expect(adaptiveNextTileTop(tile, 4000, 2000, [])).toBe(2000);
    // last tile -> page end
    expect(adaptiveNextTileTop(detectionTile(0, 2000, 800, 4000), 4000, 2000, [])).toBe(4000);
  });

  it('remaps a tile-normalised contour onto the page', () => {
    const out = remapTileMaskContourToPage([0, 0, 1, 1], 2000, 2000, 800, 4000);
    expect(out).toHaveLength(4);
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(out[3]).toBeCloseTo(1, 6);
    expect(remapTileMaskContourToPage([], 0, 0, 1, 1)).toEqual([]);
  });

  it('exposes the basic rect predicates', () => {
    expect(rectIou(rectF(0, 0, 10, 10), rectF(5, 0, 15, 10))).toBeCloseTo(50 / 150, 6);
    expect(rectIou(rectF(0, 0, 1, 1), rectF(9, 9, 10, 10))).toBe(0);
    expect(rectContains(rectF(0, 0, 10, 10), rectF(1, 1, 2, 2))).toBe(true);
    expect(rectContains(rectF(0, 0, 10, 10), rectF(1, 1, 20, 2))).toBe(false);
  });
});

describe('TextBlockMerger (TextBlockMerger.kt)', () => {
  it('returns nothing for a degenerate image size', () => {
    expect(TextBlockMerger.merge([], 0, 100)).toEqual([]);
    expect(TextBlockMerger.merge([rectF(0, 0, 100, 20)], 0, 100)).toEqual([]);
  });

  it('drops clamped lines smaller than MIN_LINE_SIZE (2px)', () => {
    expect(TextBlockMerger.merge([rectF(0, 0, 1, 50), rectF(0, 0, 1.5, 50)], 100, 100)).toEqual([]);
  });

  it('merges a vertically stacked run of horizontal lines into one block', () => {
    const lines = [
      rectF(10, 10, 90, 30),
      rectF(10, 34, 90, 54),
      rectF(10, 58, 90, 78),
    ];
    const blocks = TextBlockMerger.merge(lines, 100, 100);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.orientation).toBe(TextLineOrientation.HORIZONTAL);
    expect(blocks[0]?.lines).toHaveLength(3);
    // normalized mask contour, even length, within 0..1
    const contour = blocks[0]?.maskContour ?? [];
    expect(contour.length % 2).toBe(0);
    expect(contour.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('keeps far-apart lines in separate blocks', () => {
    const blocks = TextBlockMerger.merge([rectF(10, 10, 90, 30), rectF(10, 700, 90, 720)], 800, 800);
    expect(blocks).toHaveLength(2);
  });

  it('classifies orientation at the 1.35 aspect boundary', () => {
    expect(TextBlockMerger.orientationOf(rectF(0, 0, 135, 100))).toBe(TextLineOrientation.HORIZONTAL);
    expect(TextBlockMerger.orientationOf(rectF(0, 0, 100, 135))).toBe(TextLineOrientation.VERTICAL);
    expect(TextBlockMerger.orientationOf(rectF(0, 0, 110, 100))).toBe(TextLineOrientation.AMBIGUOUS);
  });

  it('deduplicates overlapping line boxes keeping the larger one', () => {
    const out = TextBlockMerger.deduplicateLines(
      [rectF(0, 0, 100, 20), rectF(0, 0, 90, 18), rectF(0, 0, 200, 20)],
      400,
      400,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.right).toBe(200);
  });

  it('computes the median the Kotlin way', () => {
    expect(TextBlockMerger.median([])).toBe(0);
    expect(TextBlockMerger.median([3, 1, 2])).toBe(2);
    expect(TextBlockMerger.median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('MangaOcr post-processing (MangaOcr.kt)', () => {
  it('computes the letterbox PreResult', () => {
    const pre = computePreResult(1920, 1080);
    expect(pre.ratioW).toBeCloseTo(0.5, 6);
    expect(pre.ratioH).toBeCloseTo(0.5, 6);
    expect(pre.padW).toBeCloseTo(0, 6);
    expect(pre.padH).toBeCloseTo(210, 6);
    expect(pre.originalWidth).toBe(1920);
    expect(DET_INPUT).toBe(960);
  });

  it('normalizes BGR (not RGB) with MEAN/STD', () => {
    // 0xFF0000 = B=255, G=0, R=0
    expect(normalizeBgrPixel(0xff0000, 0)).toBeCloseTo((255 / 255 - 0.485) / 0.229, 6);
    expect(normalizeBgrPixel(0xff0000, 1)).toBeCloseTo((0 - 0.456) / 0.224, 6);
    expect(normalizeBgrPixel(0xff0000, 2)).toBeCloseTo((0 - 0.406) / 0.225, 6);
  });

  it('extracts line rects above the DB thresholds', () => {
    const pre = { ratioW: 1, ratioH: 1, padW: 0, padH: 0, originalWidth: 960, originalHeight: 960 };
    const prob = new Array<number>(960 * 960).fill(0);
    // a 20x20 block of 1.0 well above PROB_THRESHOLD and BOX_THRESHOLD
    for (let y = 100; y < 120; y += 1) for (let x = 100; x < 120; x += 1) prob[y * 960 + x] = 1;
    const rects = extractLineRects(prob, pre);
    expect(rects.length).toBe(1);
    expect(rects[0]?.left).toBeLessThan(100);
    expect(rects[0]?.right).toBeGreaterThan(120);
  });

  it('returns nothing for a blank probability map', () => {
    const pre = { ratioW: 1, ratioH: 1, padW: 0, padH: 0, originalWidth: 960, originalHeight: 960 };
    expect(extractLineRects(new Array<number>(960 * 960).fill(0), pre)).toEqual([]);
    expect(extractLineRects([], pre)).toEqual([]);
  });

  it('sorts boxes into reading order bands', () => {
    const boxes = [
      rectF(60, 100, 90, 120),
      rectF(10, 102, 50, 122),
      rectF(10, 300, 90, 320),
    ];
    const sorted = sortBoxesReadingOrder(boxes);
    expect(sorted.map((r) => r.left)).toEqual([10, 60, 10]);
    expect(sortBoxesReadingOrder([])).toEqual([]);
  });

  it('builds the recognizer charset as blank + lines + space', () => {
    expect(buildRecognizerCharset(['a', '', 'b'])).toEqual(['blank', 'a', 'b', ' ']);
    // already ends with a space -> not doubled
    expect(buildRecognizerCharset(['a', ' '])).toEqual(['blank', 'a', ' ']);
    expect(buildRecognizerCharset([])).toEqual(['blank', ' ']);
  });

  it('CTC-decodes with blank + repeat suppression and averages the scores', () => {
    const charset = ['blank', 'a', 'b', ' '];
    // 3 time steps: a, a (repeat -> suppressed), blank, b
    const step = (idx: number): number[] => {
      const v = new Array<number>(4).fill(0);
      v[idx] = 1;
      return v;
    };
    const out = ctcDecode([step(1), step(1), step(0), step(2)], charset);
    expect(out.text).toBe('ab');
    expect(out.score).toBe(1);
  });

  it('CTC-decodes an empty batch to ("", 0)', () => {
    expect(ctcDecode([], ['blank', 'a'])).toEqual({ text: '', score: 0 });
  });

  it('keeps BUBBLE_INPUT_SIZE at the Android 1472 letterbox size', () => {
    expect(BUBBLE_INPUT_SIZE).toBe(1472);
  });
});

describe('BubbleDetector NMS + letterbox (BubbleDetector.kt)', () => {
  it('computes the letterbox gains and pads', () => {
    // 2000x1000 into 1472^2: fitY(1.472) > fitX(0.736) -> Android's 短图 vertical stretch
    const stretched = computeLetterbox(2000, 1000, 1472, 1472);
    expect(stretched.gainX).toBeCloseTo(0.736, 6);
    expect(stretched.gainY).toBeCloseTo(1.472, 6);
    expect(stretched.padX).toBe(0);
    expect(stretched.padY).toBe(0);

    // 500x2000: fitY(0.736) < fitX(2.944) -> scale to fit + centred grey pad
    const padded = computeLetterbox(500, 2000, 1472, 1472);
    expect(padded.gainX).toBeCloseTo(0.736, 6);
    expect(padded.gainY).toBeCloseTo(0.736, 6);
    expect(padded.padX).toBeCloseTo(552, 6);
    expect(padded.padY).toBe(0);
  });

  it('treats overlapping same-size boxes as duplicates (IoU >= 0.65)', () => {
    expect(areDuplicate(rectF(0, 0, 100, 100), rectF(5, 5, 105, 105))).toBe(true);
    expect(areDuplicate(rectF(0, 0, 100, 100), rectF(500, 500, 600, 600))).toBe(false);
    expect(areDuplicate(rectF(0, 0, 0, 0), rectF(0, 0, 10, 10))).toBe(false);
  });

  it('ranks by confidence then area and returns indices in input order', () => {
    const a = { rect: rectF(0, 0, 100, 100), confidence: 0.5, maskContour: null };
    const b = { rect: rectF(5, 5, 105, 105), confidence: 0.9, maskContour: null };
    const out = deduplicateBubbleDetections([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]?.confidence).toBe(0.9);
    expect(deduplicateBubbleDetections([a])).toEqual([a]);
    expect(deduplicateBubbleDetections([])).toEqual([]);
  });

  it('keeps only the largest 8-neighbour connected component', () => {
    const w = 5;
    const h = 3;
    const fg = new Array<boolean>(w * h).fill(false);
    fg[0] = true; // single pixel
    fg[7] = true; // 2 pixels: (1,1) and (2,1)
    fg[8] = true;
    const out = retainLargestConnectedComponent(fg, w, h);
    expect(out?.filter(Boolean)).toHaveLength(2);
    expect(out?.[7]).toBe(true);
    expect(out?.[8]).toBe(true);
    expect(out?.[0]).toBe(false);
  });

  it('returns null for an all-empty mask or a size mismatch', () => {
    expect(retainLargestConnectedComponent(new Array<boolean>(4).fill(false), 2, 2)).toBeNull();
    expect(retainLargestConnectedComponent([true], 2, 2)).toBeNull();
    expect(retainLargestConnectedComponent([true], 0, 1)).toBeNull();
  });
});

describe('BubblePipeline pure parts (BubblePipeline.kt)', () => {
  it('samples a light bubble background from a mostly-white crop', () => {
    const bg = sampleBackgroundColor(() => 0xffffffff, 100, 100, rectF(0, 0, 100, 100));
    expect(bg).not.toBeNull();
    // white-ish
    expect(((bg as number) >> 16) & 0xff).toBeGreaterThan(200);
  });

  it('rejects a degenerate sample window', () => {
    expect(sampleBackgroundColor(() => 0, 0, 0, rectF(0, 0, 1, 1))).toBeNull();
    // 1x1 bitmap: right/bottom both clamp to 1, so the probe is a single pixel.
    // Android's Color.rgb() result is a SIGNED int, hence the negative opaque-black value.
    const single = sampleBackgroundColor(() => 0x000000, 1, 1, rectF(0, 0, 1, 1));
    expect(single).not.toBeNull();
    expect(((single as number) >> 24) & 0xff).toBe(0xff);
  });

  it('picks the contrasting text colour by luminance', () => {
    expect(contrastingTextColor(0xffffff)).toBe(0xff1b1b1b);
    expect(contrastingTextColor(0x000000)).toBe(0xfff4f4f2);
  });

  it('computes the upper median line height (Kotlin, not an average)', () => {
    expect(medianLineHeight([])).toBe(0);
    expect(medianLineHeight([rectF(0, 0, 10, 10), rectF(0, 0, 10, 30)])).toBe(30);
  });

  it('dispatches to vertical layout for tall rects', () => {
    expect(prefersVerticalText(rectF(0, 0, 100, 200))).toBe(true);
    expect(prefersVerticalText(rectF(0, 0, 100, 100))).toBe(false);
  });

  it('picks the bubble-shape vs free-block bake branch', () => {
    expect(
      BubblePipeline.bakeDecision({ rect: rectF(0, 0, 1, 1), maskContour: [0, 0, 1, 0, 1, 1], lines: [], vertical: false }),
    ).toBe('bubble-shape');
    expect(
      BubblePipeline.bakeDecision({ rect: rectF(0, 0, 1, 1), maskContour: [0, 0], lines: [], vertical: false }),
    ).toBe('free-block');
    expect(
      BubblePipeline.bakeDecision({ rect: rectF(0, 0, 1, 1), maskContour: null, lines: [], vertical: false }),
    ).toBe('free-block');
  });

  it('finds the largest filled rectangle in a binary mask', () => {
    const w = 6;
    const h = 6;
    const filled = new Array<boolean>(w * h).fill(false);
    for (let y = 2; y < 5; y += 1) for (let x = 1; x < 4; x += 1) filled[y * w + x] = true;
    const best = findLargestFilledRect(filled, w, h);
    expect(best).not.toBeNull();
    expect(rectWidth(best as RectF)).toBe(3);
    expect(rectHeight(best as RectF)).toBe(3);
    expect(best?.top).toBe(2);
    expect(findLargestFilledRect(new Array<boolean>(4).fill(false), 2, 2)).toBeNull();
  });
});

describe('translationCore (MangaTranslationCore.kt)', () => {
  it('reports hasUsableText on any non-blank translation', () => {
    expect(hasUsableText({ pageWidth: 1, pageHeight: 1, regions: [] })).toBe(false);
    expect(
      hasUsableText({
        pageWidth: 1,
        pageHeight: 1,
        regions: [{ rect: rectF(0, 0, 1, 1), original: 'a', translated: '  ', lang: 'ja', vertical: false }],
      }),
    ).toBe(false);
    expect(
      hasUsableText({
        pageWidth: 1,
        pageHeight: 1,
        regions: [{ rect: rectF(0, 0, 1, 1), original: 'a', translated: '甲', lang: 'ja', vertical: false }],
      }),
    ).toBe(true);
  });

  it('round-trips the compact cache JSON with the Android keys', () => {
    const page = {
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
    };
    const raw = serializePageTranslation(page);
    expect(JSON.parse(raw).size).toEqual({ w: 800, h: 1200 });
    expect(Object.keys(JSON.parse(raw).r[0])).toEqual(['l', 't', 'r', 'b', 'o', 'c', 'lang', 'v', 'ct', 'lr']);
    expect(parsePageTranslationJson(raw, 800, 1200)).toEqual(page);
    // dimension mismatch -> null (Android re-translates on a resized page)
    expect(parsePageTranslationJson(raw, 801, 1200)).toBeNull();
    expect(parsePageTranslationJson('{', 800, 1200)).toBeNull();
  });

  it('drops a contour shorter than 6 or with an odd length', () => {
    const raw = JSON.stringify({
      size: { w: 1, h: 1 },
      r: [{ l: 0, t: 0, r: 1, b: 1, o: '', c: '', lang: '', v: false, ct: [0, 0, 1, 1, 0] }],
    });
    expect(parsePageTranslationJson(raw, 1, 1)?.regions[0]?.contour).toBeNull();
  });

  it('groups detected lines into blocks', () => {
    const lines = [rectF(10, 10, 90, 30), rectF(10, 34, 90, 54)];
    const blocks = TextBlockGrouper.group(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.vertical).toBe(false);
    expect(TextBlockGrouper.group([])).toEqual([]);
  });

  it('splits far-apart lines', () => {
    const blocks = TextBlockGrouper.group([rectF(10, 10, 90, 30), rectF(10, 800, 90, 820)]);
    expect(blocks).toHaveLength(2);
  });

  it('orders vertical blocks right-to-left', () => {
    const right = rectF(500, 10, 520, 60);
    const left = rectF(500, 64, 520, 114);
    const blocks = TextBlockGrouper.group([left, right]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.vertical).toBe(true);
    // 竖排阅读序：列按 x 降序（右起），列内 y 升序
    expect(blocks[0]?.lines.map((r) => r.top)).toEqual([10, 64]);
    // 两条相距 400px 的同尺寸竖条不并成一块（列距 400 > 1.5 * 列宽 30）
    expect(TextBlockGrouper.group([rectF(100, 10, 120, 120), rectF(500, 10, 520, 120)])).toHaveLength(2);
  });

  it('joins OCR pieces with the Android confidence floor and space rule', () => {
    const region = { rect: rectF(0, 0, 10, 10), maskContour: null, lines: [], vertical: false };
    const ok = ocrRegionFilter(region, [
      { text: 'あ', score: 0.9 },
      { text: 'い', score: 0.9 },
      { text: 'skip', score: 0.1 },
    ]);
    expect(ok?.original).toBe('あ い');
    expect(ok?.lang).toBe('ja');
    // below the 2-char minimum
    expect(ocrRegionFilter(region, [{ text: 'a', score: 1 }])).toBeNull();
    // vertical regions join without a space
    expect(ocrRegionFilter({ ...region, vertical: true }, [
      { text: 'あ', score: 1 },
      { text: 'い', score: 1 },
    ])?.original).toBe('あい');
  });

  it('drops Chinese and blank-language regions before translating', () => {
    const mk = (lang: string) => ({ rect: rectF(0, 0, 1, 1), original: 'x', translated: '', lang, vertical: false });
    expect(detectAndOcrFilter([mk('zh'), mk(''), mk('ja')]).map((r) => r.lang)).toEqual(['ja']);
  });

  it('keeps the coordinator cache key format', () => {
    const c = new TranslationCoordinator();
    expect(c.engineTag()).toBe('online');
    expect(c.planSchedule(false, 'k', 'tk', null, 'online-v1')).toBeNull();
    const key = c.planSchedule(true, 'k', 'tk', null, 'online-v1');
    expect(key).toBe('tk@online-auto-online-v1-v2');
    // second call is suppressed because the key is now busy? (Android checks jobs/bakedKeys)
    c.bakedKeys.add('k2');
    expect(c.planSchedule(true, 'k2', 'tk', 'ja', 'online-v1')).toBeNull();
    c.bumpEpoch();
    expect(c.epoch).toBe(1);
    c.resetMarks();
    expect(c.takeBakedKeys().size).toBe(0);
  });
});

describe('PageRegionDetector pure helpers (PageRegionDetector.kt)', () => {
  it('plans a crop with the shrink decision', () => {
    const tile = detectionTile(0, 100, 800, 500);
    const plan = planCropRegion(800, 2000, tile, 1920);
    expect(plan).not.toBeNull();
    expect(plan?.height).toBe(400);
    expect(plan?.shrink).toBe(1);
    const big = planCropRegion(4000, 4000, detectionTile(0, 0, 4000, 4000), 1920);
    expect(big?.shrink).toBeCloseTo(0.48, 6);
    expect(planCropRegion(800, 2000, detectionTile(0, 0, 0, 0), 1920)).toBeNull();
  });

  it('detects when a tile needs the 80% vertical compression', () => {
    expect(needsTileCompression(1000)).toBe(true);
    expect(needsTileCompression(0)).toBe(false);
  });

  it('remaps a tile-local rect onto page coordinates', () => {
    const tile = detectionTile(0, 1000, 800, 2000);
    const out = remapRectToPage(rectF(0, 0, 400, 500), tile, 800, 1000);
    expect(out.top).toBeCloseTo(1000, 6);
    expect(out.bottom).toBeCloseTo(1500, 6);
  });
});