import { describe, expect, it } from 'vitest';
import { DEFAULT_COMIC_READER_CONFIG, type ComicBitmap, type ComicReaderConfig } from '@core/comic/comicReaderCore';
import { rectF } from '@core/mangatranslate/index';
import { PageMemoryBudget } from '@core/mangatranslate/pageMemoryBudget';
import { TRANSMART_ENDPOINT } from '@core/mangatranslate/scriptDetector';
import {
  TRANSLATION_CONFIG,
  TRANSLATION_EMPTY,
  TRANSLATION_MEMORY,
  TRANSLATION_MODELS,
  TRANSLATION_OCR,
  TRANSLATION_PRIVACY,
  TRANSLATION_TIMEOUT,
  TranslationException,
  translationFailureForHttpStatus,
} from '@core/mangatranslate/translationFailure';
import type { PageTranslation, TranslatedRegion } from '@core/mangatranslate/translationCore';
import type { PlatformBundle } from '@platform/index';
import type { HttpClient, HttpRequest, HttpResponse, KeyValueStore } from '@platform/interfaces';
import { MangaTranslationRuntime, type MangaTranslationPage } from '@platform/ios-native/mangaTranslationRuntime';
import { NativeMangaModels } from '@platform/ios-native/nativeMangaModels';
import { InMemorySqliteDatabase, MemoryFileSystem, MemorySecureStore, createWebMockPlatform } from '@platform/web-mock';

/**
 * E101 —— 漫画翻译的页内存预算闸门与失败分类。
 *
 * 权威：Android `MangaTranslationCore.kt` :773（`translateMutex = PageMemoryBudget.gate`）、
 * :818（隐私）、:821（`PageMemoryBudget.check`）、:822/:830（`fingerprint` 进缓存键）、
 * :851（烘焙）、:876-884（`TranslationFailure.from`）；`PageMemoryBudget.kt`:11-31；
 * `TranslationFailure.kt`:20-45；`TextTranslator.kt`:116/137/145（lastFailure / http）。
 *
 * 全部端口都是假的：内存 FS、假 OCR、假烘焙、假 HTTP。不联网、不加载 ONNX、不碰 DOM 画布。
 */

const CONFIG: ComicReaderConfig = {
  ...DEFAULT_COMIC_READER_CONFIG,
  translationEnabled: true,
  translationEngine: 'online',
  translationLang: 'auto',
};

const BITMAP: ComicBitmap = { src: 'blob:manga-page-1', width: 1000, height: 1000 };

/** 一页一个气泡（`lang: 'ja'` 才能进在线翻译：Kotlin :710 滤掉 zh）。 */
const REGION: TranslatedRegion = {
  rect: rectF(10, 10, 990, 990),
  original: 'こんにちは',
  translated: '',
  lang: 'ja',
  vertical: false,
};

class RecordingHttp implements HttpClient {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly reply: (request: HttpRequest) => HttpResponse) {}

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    return this.reply(req);
  }
}

function jsonResponse(body: unknown, status = 200): HttpResponse {
  return { status, headers: {}, url: TRANSMART_ENDPOINT, body: new TextEncoder().encode(JSON.stringify(body)) };
}

/** 腾讯 `parseTransmart` 只认 `header.ret_code === 'succ'` + 等长数组。 */
const transmartSuccess = () => jsonResponse({ header: { ret_code: 'succ' }, auto_translation: ['译文'] });

function memoryKeyValue(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => { map.set(key, value); },
    remove: (key) => { map.delete(key); },
  };
}

/** `ReaderMangaModels` 插件的假实现（`NativeMangaModels` 的 native 端口）。 */
const modelsNative = (files: Record<'det' | 'rec' | 'bubble', number>) => ({
  status: async () => ({ files: { ...files } }),
  commit: async () => ({ size: 1 }),
  remove: async () => { /* nothing to remove */ },
  infer: async () => ({ tokens: [] as number[], confidence: [] as number[] }),
  read: async () => ({ data: '' }),
  release: async () => { /* no sessions */ },
});

interface HarnessOptions {
  readonly width?: number;
  readonly height?: number;
  readonly privacyAllowed?: boolean;
  readonly modelsReady?: boolean;
  readonly fingerprint?: string;
  readonly reply?: (request: HttpRequest) => HttpResponse;
  readonly ocr?: () => Promise<TranslatedRegion[]>;
  readonly bake?: (translation: PageTranslation) => Promise<Blob>;
}

interface Harness {
  readonly runtime: MangaTranslationRuntime;
  readonly http: RecordingHttp;
  readonly ocrCalls: MangaTranslationPage[];
  readonly baked: PageTranslation[];
  readonly counters: { fingerprints: number };
}

function harness(options: HarnessOptions = {}): Harness {
  const fs = new MemoryFileSystem();
  const http = new RecordingHttp(options.reply ?? transmartSuccess);
  const ready = options.modelsReady !== false;
  const models = new NativeMangaModels(fs, http, modelsNative(ready
    ? { det: 1, rec: 1, bubble: 1 }
    : { det: 0, rec: 0, bubble: 0 }));
  const base = createWebMockPlatform();
  const platform: PlatformBundle = {
    ...base,
    fs,
    http,
    db: new InMemorySqliteDatabase(),
    secure: new MemorySecureStore(),
    keyValue: memoryKeyValue(),
  };

  const ocrCalls: MangaTranslationPage[] = [];
  const baked: PageTranslation[] = [];
  const counters = { fingerprints: 0 };
  const page = (): MangaTranslationPage => ({
    image: new Image(),
    width: options.width ?? 1000,
    height: options.height ?? 1000,
  });

  const runtime = new MangaTranslationRuntime(platform, {
    // Android `Runtime.getRuntime().maxMemory()` 的替身：512MiB → 32MiB 硬顶 → 8_388_608 px。
    maxMemoryBytes: () => 512 * 1024 * 1024,
    privacyAllowed: async () => options.privacyAllowed !== false,
    models,
    decodePage: async (_src, signal) => {
      if (signal.aborted) throw new DOMException('已取消漫画翻译', 'AbortError');
      return page();
    },
    fingerprint: async () => {
      counters.fingerprints += 1;
      return options.fingerprint ?? 'page-fingerprint';
    },
    ocr: async (target) => {
      ocrCalls.push(target);
      if (options.ocr) return options.ocr();
      return [{ ...REGION }];
    },
    bake: async (_target, translation) => {
      baked.push(translation);
      if (options.bake) return options.bake(translation);
      return new Blob(['baked'], { type: 'image/png' });
    },
  });

  return { runtime, http, ocrCalls, baked, counters };
}

function translate(runtime: MangaTranslationRuntime): Promise<Blob | null> {
  return runtime.translate(BITMAP, CONFIG, new AbortController().signal, () => {});
}

async function failureOf(run: Promise<unknown>): Promise<TranslationException> {
  try {
    await run;
  } catch (error) {
    if (!(error instanceof TranslationException)) throw error;
    return error;
  }
  throw new Error('expected the page translation to reject');
}

describe('页内存预算闸门（MangaTranslationCore.kt:773 / :821-830，PageMemoryBudget.kt:11-15）', () => {
  it('闸门阈值与 Kotlin 的 min(32MiB, heap/8)/4 逐位一致', () => {
    const heap = 512 * 1024 * 1024;
    expect(PageMemoryBudget.allowedPixelBudget(heap)).toBe(32 * 1024 * 1024);
    expect(Math.floor(PageMemoryBudget.allowedPixelBudget(heap) / 4)).toBe(8_388_608);
    // 2048×4096 = 8_388_608 px 正好在预算上，2049×4096 越界。
    expect(2048 * 4096).toBe(8_388_608);
    expect(() => PageMemoryBudget.check({ width: 2048, height: 4096 }, heap)).not.toThrow();
    expect(() => PageMemoryBudget.check({ width: 2049, height: 4096 }, heap)).toThrow('页面过大，请降低图片清晰度后翻译');
  });

  it('超预算页面被 PageMemoryBudget.check 拒绝，且不算指纹、不进 OCR、不发请求', async () => {
    const h = harness({ width: 4000, height: 4000 });
    const failure = await failureOf(translate(h.runtime));
    expect(failure.failure).toEqual(TRANSLATION_MEMORY);
    expect(failure.message).toBe('页面过大，请降低图片清晰度后翻译');
    expect(h.counters.fingerprints).toBe(0);
    expect(h.ocrCalls).toHaveLength(0);
    expect(h.http.requests).toHaveLength(0);
    expect(h.baked).toHaveLength(0);
  });

  it('预算内的页面照常进入 OCR → 翻译 → 烘焙', async () => {
    const h = harness();
    const blob = await translate(h.runtime);
    expect(blob).toBeInstanceOf(Blob);
    expect(h.counters.fingerprints).toBe(1);
    expect(h.ocrCalls).toHaveLength(1);
    expect(h.ocrCalls[0]?.width).toBe(1000);
    expect(h.baked).toHaveLength(1);
    expect(h.baked[0]?.pageWidth).toBe(1000);
    expect(h.baked[0]?.regions[0]?.translated).toBe('译文');
  });

  it('恰好卡在预算边界（2048×4096）的页面放行', async () => {
    const h = harness({ width: 2048, height: 4096 });
    await expect(translate(h.runtime)).resolves.toBeInstanceOf(Blob);
    expect(h.ocrCalls).toHaveLength(1);
  });

  it('指纹一致时复用缓存：第二次不再 OCR、不再发请求', async () => {
    const h = harness();
    await translate(h.runtime);
    const requestsAfterFirst = h.http.requests.length;
    expect(requestsAfterFirst).toBe(1);
    await translate(h.runtime);
    expect(h.counters.fingerprints).toBe(2);
    expect(h.ocrCalls).toHaveLength(1);
    expect(h.http.requests).toHaveLength(requestsAfterFirst);
    // 缓存命中仍要逐页烘焙（Kotlin :851 在缓存分支之后）。
    expect(h.baked).toHaveLength(2);
    expect(h.baked[1]?.regions[0]?.translated).toBe('译文');
  });

  it('指纹不同（换图）时不复用缓存', async () => {
    const first = harness({ fingerprint: 'page-A' });
    await translate(first.runtime);
    const second = harness({ fingerprint: 'page-B' });
    await translate(second.runtime);
    expect(first.ocrCalls).toHaveLength(1);
    expect(second.ocrCalls).toHaveLength(1);
    expect(second.http.requests).toHaveLength(1);
  });
});

describe('失败分类（MangaTranslationCore.kt:876-884，TranslationFailure.kt:20-45）', () => {
  it('隐私未开启 → TRANSLATION_PRIVACY，不碰模型/OCR', async () => {
    const h = harness({ privacyAllowed: false });
    const failure = await failureOf(translate(h.runtime));
    expect(failure.failure).toEqual(TRANSLATION_PRIVACY);
    expect(failure.message).toBe('隐私模式禁止在线翻译，请关闭隐私模式后再试');
    expect(h.ocrCalls).toHaveLength(0);
    expect(h.http.requests).toHaveLength(0);
  });

  it('模型缺失 → TRANSLATION_MODELS', async () => {
    const h = harness({ modelsReady: false });
    const failure = await failureOf(translate(h.runtime));
    expect(failure.failure).toEqual(TRANSLATION_MODELS);
    expect(failure.message).toBe('OCR 模型未就绪，请到翻译设置检查下载');
    expect(h.ocrCalls).toHaveLength(0);
    expect(h.http.requests).toHaveLength(0);
  });

  const httpCases = [
    { status: 401, code: 'auth', message: '服务拒绝访问（401），请检查 API Key 或切换引擎' },
    { status: 429, code: 'limited', message: '翻译服务繁忙或限流，请稍后重试' },
    { status: 500, code: 'service', message: '翻译服务暂时不可用（500），请稍后重试' },
  ] as const;

  for (const item of httpCases) {
    it(`HTTP ${item.status} → ${item.code}（不是 internal）`, async () => {
      const h = harness({ reply: () => jsonResponse({}, item.status) });
      const failure = await failureOf(translate(h.runtime));
      expect(failure.failure).toEqual(translationFailureForHttpStatus(item.status));
      expect(failure.failure.code).toBe(item.code);
      expect(failure.message).toBe(item.message);
      // OCR 在翻译之前跑完：状态码分类不能把识别阶段一起吞掉。
      expect(h.ocrCalls).toHaveLength(1);
    });
  }

  it('请求超时 → TRANSLATION_TIMEOUT（即使在线兜底把错误吞成了「未获取到可用译文」）', async () => {
    const h = harness({ reply: () => { throw new DOMException('The operation timed out.', 'TimeoutError'); } });
    const failure = await failureOf(translate(h.runtime));
    expect(failure.failure).toEqual(TRANSLATION_TIMEOUT);
    expect(failure.message).toBe('翻译请求超时，请检查网络或换用更快的模型');
  });

  it('OCR 引擎失败 → TRANSLATION_OCR（Kotlin :548-549）', async () => {
    const h = harness({ ocr: async () => { throw new Error('文字检测模型输出无效'); } });
    const failure = await failureOf(translate(h.runtime));
    expect(failure.failure).toEqual(TRANSLATION_OCR);
    expect(failure.failure.retryable).toBe(true);
  });

  it('服务返回空译文 → TRANSLATION_EMPTY（Kotlin :731）', async () => {
    const h = harness({ reply: () => jsonResponse({ header: { ret_code: 'fail' } }) });
    const failure = await failureOf(translate(h.runtime));
    expect(failure.failure).toEqual(TRANSLATION_EMPTY);
    expect(failure.message).toBe('未获得有效译文，请检查原文语言或切换翻译引擎');
  });

  it('测试连接缺配置 → TRANSLATION_CONFIG（不是 internal，也不发请求）', async () => {
    const h = harness();
    const failure = await failureOf(h.runtime.testConnection('ai', { apiUrl: ' ', apiKey: '', modelName: '', geminiFormat: false }));
    expect(failure.failure).toEqual(TRANSLATION_CONFIG);
    expect(h.http.requests).toHaveLength(0);
  });

  it('未知错误 → internal 可重试，页面保持原文（不返回烘焙结果）', async () => {
    const h = harness({ bake: async () => { throw new Error('boom'); } });
    const failure = await failureOf(translate(h.runtime));
    expect(failure.failure.code).toBe('internal');
    expect(failure.failure.retryable).toBe(true);
    expect(failure.message).toBe('翻译处理失败，请切换引擎或重新进入阅读器');
    // 烘焙抛错 = 没有新位图可发布，调用方（useReaderTranslation）保留原图。
    expect(h.baked).toHaveLength(1);
  });

  it('取消（signal 已 abort）原样抛出，不包装成分类失败', async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();
    await expect(h.runtime.translate(BITMAP, CONFIG, controller.signal, () => {})).rejects.toBeInstanceOf(DOMException);
    expect(h.ocrCalls).toHaveLength(0);
  });
});
