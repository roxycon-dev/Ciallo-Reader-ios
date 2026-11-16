import type { ComicBitmap, ComicReaderConfig } from '@core/comic/comicReaderCore';
import { formatCacheSize } from '@core/cache/cacheManagement';
import { AsyncMutex } from '@core/data/contentMutationGate';
import type { LlmConfig } from '@core/mangatranslate/llmTranslator';
import { PageMemoryBudget } from '@core/mangatranslate/pageMemoryBudget';
import {
  TRANSLATION_CONFIG,
  TRANSLATION_EMPTY,
  TRANSLATION_FORMAT,
  TRANSLATION_MEMORY,
  TRANSLATION_MODELS,
  TRANSLATION_OCR,
  TRANSLATION_PRIVACY,
  TRANSLATION_TIMEOUT,
  TranslationException,
  translationFailureException,
  translationFailureForHttpStatus,
  translationFailureFrom,
  type TranslationFailure,
} from '@core/mangatranslate/translationFailure';
import { MangaTranslationNetwork } from '@core/mangatranslate/translationNetwork';
import {
  TRANSLATION_CACHE_DIR,
  TRANSLATION_CACHE_MAX_FILE_BYTES,
  TRANSLATION_CACHE_MAX_TOTAL_BYTES,
  bytesToHex,
  translationCacheKey,
  type PageTranslation,
  type TranslatedRegion,
} from '@core/mangatranslate/translationCore';
import { TranslationPrivacy } from '@core/mangatranslate/translationPrivacy';
import { PreferencesManager, SettingsRepository } from '@core/settings/settingsRepository';
import { getPlatform, getPlatformKind, type PlatformBundle } from '@platform/index';
import type { HttpClient, HttpRequest } from '@platform/interfaces';
import { getPrivacyService } from '@platform/privacyRuntime';
import { bakeMangaTranslation } from '@platform/raster/mangaTranslationBake';
import { NativeMangaModels } from './nativeMangaModels';
import { NativeMangaOcr } from './nativeMangaOcr';

const CONFIG_KEY = 'mangaTranslate.llm.v1';
const defaultConfig: LlmConfig = { apiUrl: '', apiKey: '', modelName: '', geminiFormat: false };
const check = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('已取消漫画翻译', 'AbortError'); };

/**
 * Android `Runtime.getRuntime().maxMemory()` 的 iOS 替身（PageMemoryBudget.kt:13）。
 *
 * `PageMemoryBudget.allowedPixelBudget` = `minOf(32L*1024*1024, maxMemory/8)`，只要进程预算
 * ≥ 256MiB 就被那条 32MiB 硬顶钉住 —— 也就是说本常量的具体取值不影响闸门结论，不需要
 * 真的去探测 WebView 的内存上限。
 */
const DEFAULT_MAX_MEMORY_BYTES = 512 * 1024 * 1024;

/**
 * `translationNetwork.ts` 有四个失败只以消息文本表达（它没有 failure 端口）。
 * 每条对应 Kotlin `TranslationFailure` 的一个常量，顺序即判定优先级：
 *   `'隐私…'`            → `Privacy`（TranslationFailure.kt:21，translationNetwork.ts:28/96）
 *   `'请先配置…'`         → `Config`（TranslationFailure.kt:26，translationNetwork.ts:86/97）
 *   `'未获取到可用译文'`   → `Empty`（TranslationFailure.kt:25，MangaTranslationCore.kt:731）
 *   `'未获得有效译文…'`    → `Empty`（同上，translationNetwork.ts:89 的连接检查）
 *   `'大模型译文格式无效'` → `Format`（TranslationFailure.kt:27，translationNetwork.ts:75）
 */
const NETWORK_MESSAGE_FAILURES: readonly { readonly prefix: string; readonly failure: TranslationFailure }[] = [
  { prefix: '隐私', failure: TRANSLATION_PRIVACY },
  { prefix: '请先配置', failure: TRANSLATION_CONFIG },
  { prefix: '未获取到可用译文', failure: TRANSLATION_EMPTY },
  { prefix: '未获得有效译文', failure: TRANSLATION_EMPTY },
  { prefix: '大模型译文格式无效', failure: TRANSLATION_FORMAT },
];

/**
 * 按 `name` 判超时（Kotlin `SocketTimeoutException` / `TimeoutCancellationException`）。
 *
 * `translationFailure.ts` 的 `isTimeoutLike` 以 `instanceof Error` 起手：浏览器与 WebKit 的
 * `DOMException` 确实继承自 `Error`，但**跨 realm**（jsdom 测试环境、iframe、worker）时
 * `instanceof Error` 会失败 —— 超时就会被降级成 `internal`。这里补一道只看 `name` 的判定。
 */
const isTimeoutLikeError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'TimeoutError' || name === 'AbortError';
};

export type MangaTranslationStorageKey = 'manga_tr_cache' | 'manga_tr_models';

/** Safe, runtime-owned rows used by CacheManagementPage instead of raw path deletion. */
export interface MangaTranslationStorageEntry {
  readonly file: string;
  readonly size: number;
  readonly label: string;
  readonly sublabel: string;
}

/**
 * 解码后的页面图 —— Android `android.graphics.Bitmap` 的 iOS 替身。
 *
 * `width`/`height` 是 `PageMemoryBudget.check` 的唯一输入（PageMemoryBudget.kt:12），
 * `image` 交给 OCR / 烘焙（Android 的 `Bitmap` 同时承担这两件事）。
 */
export interface MangaTranslationPage {
  readonly image: HTMLImageElement;
  readonly width: number;
  readonly height: number;
}

/**
 * 运行时端口（全部可注入）。
 *
 * Android 侧这些都是持有 `Context` / ONNX 会话 / `Canvas` 的实例；iOS 侧除了真实实现，
 * 还需要能注入假实现，才能在不联网、不加载 ONNX 的前提下单测「页内存预算闸门」与
 * 「失败分类」两条链路。
 */
export interface MangaTranslationRuntimePorts {
  /** Android `Runtime.getRuntime().maxMemory()`（PageMemoryBudget.kt:13）。 */
  readonly maxMemoryBytes?: () => number;
  /** Android `TranslationPrivacy.allowed(context)`（MangaTranslationCore.kt:818）。 */
  readonly privacyAllowed?: () => Promise<boolean>;
  /** 已构造的模型仓库（Android `TranslateModelManager`）；省略时按平台端口新建。 */
  readonly models?: NativeMangaModels;
  /** Android 解码出页面 `Bitmap` 的那一步（iOS: `HTMLImageElement.decode()`）。 */
  readonly decodePage?: (src: string, signal: AbortSignal) => Promise<MangaTranslationPage>;
  /** Android `PageMemoryBudget.fingerprint(bitmap)`（MangaTranslationCore.kt:822 / :830）。 */
  readonly fingerprint?: (page: MangaTranslationPage, signal: AbortSignal) => Promise<string>;
  /** Android `MangaPageTranslator.recognizeForTranslation` 的 OCR 段（MangaTranslationCore.kt:591-641）。 */
  readonly ocr?: (page: MangaTranslationPage, forcedLang: string | null, signal: AbortSignal) => Promise<TranslatedRegion[]>;
  /** Android `BubblePipeline.bake`（MangaTranslationCore.kt:851）。 */
  readonly bake?: (page: MangaTranslationPage, translation: PageTranslation, textScale: number) => Promise<Blob>;
}

function firstRegionText(region: unknown, key: 'original' | 'translated' | 'o' | 'c'): string {
  if (typeof region !== 'object' || region === null) return '';
  const value = (region as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export class MangaTranslationRuntime {
  readonly models: NativeMangaModels;
  private readonly ocr: NativeMangaOcr;
  private readonly network: MangaTranslationNetwork;
  /** `platform.http` 的状态码探针包装（见 {@link probeHttpStatus}）。 */
  private readonly http: HttpClient;
  /**
   * Kotlin `MangaTranslationCore.kt:773 private val translateMutex = PageMemoryBudget.gate`
   * —— 整段识别/翻译/烘焙串行，与 `removeModels` 共用同一把闸门。
   */
  private readonly pageLock = PageMemoryBudget.gate;
  private readonly diskLock = new AsyncMutex();
  private readonly preferences: PreferencesManager;
  private llm = defaultConfig;
  private cacheBytes = 0;
  private configLoaded = false;
  private configVersion = 0;
  private configWrite = Promise.resolve();
  /** 最近一次非 2xx 的 HTTP 状态（Kotlin `TranslationFailure.http`，TextTranslator.kt:137）。 */
  private lastHttpStatus: number | undefined;
  /** 被批量兜底吞掉的最后一个请求错误（Kotlin `lastFailure`，TextTranslator.kt:116 / :145）。 */
  private lastRequestError: unknown;

  constructor(private readonly platform: PlatformBundle, private readonly ports: MangaTranslationRuntimePorts = {}) {
    this.http = this.probeHttpStatus(platform.http);
    this.models = ports.models ?? new NativeMangaModels(platform.fs, platform.http);
    this.ocr = new NativeMangaOcr(this.models);
    this.preferences = new PreferencesManager(new SettingsRepository(platform.db));
    this.network = new MangaTranslationNetwork(this.http, platform.keyValue, () => this.privacyAllowed());
  }

  /**
   * 状态码探针：`translationNetwork.ts` 对非 2xx 只抛一个 `TranslationRequestError`，而在线兜底
   * 会把它逐条吞掉（`onlineBatch` 的 catch），最终冒出来的是 `'未获取到可用译文'`。
   * 把状态码留在运行时里，失败分类才能走 Kotlin `TranslationFailure.http(status)`。
   *
   * 只包 `request`：`MangaTranslationNetwork` 只走这条路；模型下载仍拿原始 client（要用 `consume` 流）。
   */
  private probeHttpStatus(base: HttpClient): HttpClient {
    return {
      request: async (req: HttpRequest) => {
        try {
          const response = await base.request(req);
          if (response.status < 200 || response.status >= 300) this.lastHttpStatus = response.status;
          return response;
        } catch (error) {
          this.lastRequestError = error;
          throw error;
        }
      },
    };
  }

  async privacyAllowed(): Promise<boolean> {
    if (this.ports.privacyAllowed) return this.ports.privacyAllowed();
    const [privacy, incognito] = await Promise.all([getPrivacyService().ready(), this.preferences.incognitoBrowsingEnabled()]);
    return TranslationPrivacy.allowed(privacy.enabled, incognito);
  }

  async refreshStorage(): Promise<void> { await Promise.all([this.models.refresh(), this.refreshCache()]); }
  async refresh(): Promise<void> { await Promise.all([this.refreshStorage(), this.loadConfig()]); }
  get config(): LlmConfig { return { ...this.llm }; }
  get totalCacheBytes(): number { return this.cacheBytes; }

  private async loadConfig(): Promise<void> {
    if (this.configLoaded) return;
    const version = this.configVersion;
    const stored = await this.platform.secure.get(CONFIG_KEY);
    if (this.configVersion !== version || this.configLoaded) return;
    if (stored) {
      const raw = JSON.parse(stored) as Partial<LlmConfig>;
      if (typeof raw.apiUrl === 'string' && typeof raw.apiKey === 'string' && typeof raw.modelName === 'string' && typeof raw.geminiFormat === 'boolean') {
        this.llm = { apiUrl: raw.apiUrl, apiKey: raw.apiKey, modelName: raw.modelName, geminiFormat: raw.geminiFormat };
      }
    }
    this.configLoaded = true;
  }

  saveConfig(config: LlmConfig): Promise<void> {
    const version = ++this.configVersion;
    this.configLoaded = true;
    this.configWrite = this.configWrite.catch(() => {}).then(async () => {
      await this.platform.secure.set(CONFIG_KEY, JSON.stringify(config));
      if (version === this.configVersion) this.llm = { ...config };
    });
    return this.configWrite;
  }

  /**
   * Kotlin 侧没有同名入口，但设置面板的「测试连接」同样会撞上 401/429/超时；
   * 这里复用同一套分类，避免面板弹 `Error: 500`。
   */
  testConnection(engine: 'ai' | 'online', config: LlmConfig, signal?: AbortSignal): Promise<string> {
    this.lastHttpStatus = undefined;
    this.lastRequestError = undefined;
    return this.network.testConnection(engine, config, signal).catch((error: unknown) => {
      throw this.classifyFailure(error, signal);
    });
  }

  private async cacheFiles(): Promise<{ name: string; bytes: number; used: number }[]> {
    const fs = this.platform.fs;
    const files = (await fs.list(TRANSLATION_CACHE_DIR)).filter((name) => /^[a-f0-9]{40}\.json$/.test(name));
    return Promise.all(files.map(async (name) => ({
      name,
      bytes: await fs.size!(TRANSLATION_CACHE_DIR + '/' + name).catch(() => 0),
      used: Number(this.platform.keyValue.get('mangaTranslate.used.' + name) ?? 0),
    })));
  }

  private async refreshCache(): Promise<void> {
    await this.diskLock.withLock(async () => {
      this.cacheBytes = (await this.cacheFiles()).reduce((total, file) => total + file.bytes, 0);
    });
  }

  /** Read cache metadata through the same runtime that owns its usage timestamps and byte count. */
  async listCacheEntries(): Promise<MangaTranslationStorageEntry[]> {
    return this.diskLock.withLock(async () => {
      const files = await this.cacheFiles();
      const entries = await Promise.all(files.map(async ({ name, bytes }) => {
        let label = '未知页面';
        let regionCount = 0;
        try {
          const raw = JSON.parse(new TextDecoder().decode(await this.platform.fs.readFile(`${TRANSLATION_CACHE_DIR}/${name}`))) as unknown;
          if (typeof raw === 'object' && raw !== null) {
            const record = raw as Record<string, unknown>;
            const regions = Array.isArray(record.regions) ? record.regions : Array.isArray(record.r) ? record.r : [];
            regionCount = regions.length;
            const first = regions[0];
            const source = firstRegionText(first, 'original') || firstRegionText(first, 'o');
            const translated = firstRegionText(first, 'translated') || firstRegionText(first, 'c');
            if (source.trim() !== '' && translated.trim() !== '') label = `${source.slice(0, 18)} → ${translated.slice(0, 18)}`;
            else if (source.trim() !== '') label = source.slice(0, 18);
            else if (regionCount > 0) label = '空译文';
          }
        } catch {
          // Keep malformed rows visible so users can remove a broken cache entry.
        }
        return {
          file: name,
          size: bytes,
          label: label.replace(/\n/g, ' '),
          sublabel: `${String(regionCount)} 个气泡区域`,
        };
      }));
      return entries.sort((a, b) => b.size - a.size);
    });
  }

  /**
   * One model bundle row: the native plugin removes the bundle as a unit so inference
   * sessions and downloaded files stay in sync. The sublabel still reports each model.
   */
  listModelEntries(): MangaTranslationStorageEntry[] {
    const total = this.models.totalBytes;
    if (total <= 0) return [];
    return [{
      file: 'model-bundle',
      size: total,
      label: 'OCR 与气泡识别模型',
      sublabel: this.models.ready
        ? '文字检测、文字识别与气泡分割模型已下载'
        : `部分模型已下载（${formatCacheSize(total)}）`,
    }];
  }

  /** Delete cache files by validated names and update the LRU metadata/byte total atomically. */
  async deleteCacheEntries(names: readonly string[]): Promise<void> {
    await this.diskLock.withLock(() => this.deleteCacheEntriesLocked(names));
  }

  private async deleteCacheEntriesLocked(names: readonly string[]): Promise<void> {
    const fs = this.platform.fs;
    for (const name of new Set(names)) {
      if (!/^[a-f0-9]{40}\.json$/.test(name)) continue;
      const path = `${TRANSLATION_CACHE_DIR}/${name}`;
      if (await fs.exists(path)) await fs.delete(path);
      if (!await fs.exists(path)) this.platform.keyValue.remove(`mangaTranslate.used.${name}`);
    }
    this.cacheBytes = (await this.cacheFiles()).reduce((total, file) => total + file.bytes, 0);
  }

  /** Model deletion goes through NativeMangaModels, which waits on downloads and inference. */
  async removeModels(): Promise<void> {
    // Hold the page lock across the full OCR/translation sequence, not only one ONNX call.
    await this.pageLock.withLock(() => this.models.remove());
  }

  async clearCache(): Promise<void> {
    await this.diskLock.withLock(async () => {
      const files = await this.cacheFiles();
      await this.deleteCacheEntriesLocked(files.map((file) => file.name));
    });
  }

  private async readCache(name: string, width: number, height: number): Promise<PageTranslation | null> {
    const fs = this.platform.fs, path = TRANSLATION_CACHE_DIR + '/' + name;
    return this.diskLock.withLock(async () => {
      try {
        if (!await fs.exists(path) || await fs.size!(path) > TRANSLATION_CACHE_MAX_FILE_BYTES) return null;
        const stored = JSON.parse(new TextDecoder().decode(await fs.readFile(path))) as PageTranslation;
        if (stored.pageWidth !== width || stored.pageHeight !== height || !Array.isArray(stored.regions)) return null;
        this.platform.keyValue.set('mangaTranslate.used.' + name, String(Date.now()));
        return stored;
      } catch { return null; }
    });
  }

  private async writeCache(name: string, data: PageTranslation): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    if (bytes.length > TRANSLATION_CACHE_MAX_FILE_BYTES) return;
    await this.diskLock.withLock(async () => {
      const fs = this.platform.fs, path = TRANSLATION_CACHE_DIR + '/' + name;
      if (fs.writeFileAtomic) await fs.writeFileAtomic(path, bytes);
      else await fs.writeFile(path, bytes);
      this.platform.keyValue.set('mangaTranslate.used.' + name, String(Date.now()));
      const files = await this.cacheFiles();
      this.cacheBytes = files.reduce((total, file) => total + file.bytes, 0);
      if (this.cacheBytes > TRANSLATION_CACHE_MAX_TOTAL_BYTES) {
        for (const file of files.sort((a, b) => a.used - b.used)) {
          if (this.cacheBytes <= TRANSLATION_CACHE_MAX_TOTAL_BYTES) break;
          await fs.delete(TRANSLATION_CACHE_DIR + '/' + file.name);
          this.platform.keyValue.remove('mangaTranslate.used.' + file.name);
          this.cacheBytes -= file.bytes;
        }
      }
    });
  }

  translate(bitmap: ComicBitmap, config: ComicReaderConfig, signal: AbortSignal,
    stage: (text: string) => void): Promise<Blob | null> {
    return this.pageLock.withLock(async () => {
      this.lastHttpStatus = undefined;
      this.lastRequestError = undefined;
      try {
        return await this.translatePage(bitmap, config, signal, stage);
      } catch (error) {
        // Kotlin MangaTranslationCore.kt:879-884 —— 单页失败不打断阅读，抛给调用方一条分类文案。
        throw this.classifyFailure(error, signal);
      }
    });
  }

  /**
   * MangaTranslationCore.kt:813-868 —— 隐私 → 模型 → 解码 → 预算闸门 → 指纹 → 缓存 → 识别 →
   * 翻译 → 烘焙。闸门与指纹的先后严格照 Kotlin：`:821 check` 在 `:822 fingerprint` 之前，
   * 而两者都在任何 OCR（`:832`）之前。
   */
  private async translatePage(bitmap: ComicBitmap, config: ComicReaderConfig, signal: AbortSignal,
    stage: (text: string) => void): Promise<Blob | null> {
    check(signal);
    // Kotlin :818 `if (!TranslationPrivacy.allowed(appContext)) throw TranslationFailure.Privacy.exception()`
    if (!await this.privacyAllowed()) throw translationFailureException(TRANSLATION_PRIVACY);
    if (!this.models.ready) {
      stage('正在准备翻译模型…');
      const failure = await this.models.ensureDownloaded();
      check(signal);
      // Kotlin :547 / :603 `TranslationFailure.Models` —— 模型没就绪就没有 OCR。
      if (failure !== null || !this.models.ready) throw translationFailureException(TRANSLATION_MODELS);
    }
    await this.loadConfig();
    check(signal);
    const page = await this.decodePage(bitmap.src, signal);
    check(signal);
    // Kotlin :821 —— 解码后的整页先过预算闸门，超预算的页面连指纹都不算、更不会进 OCR。
    this.checkPageBudget(page);
    // Kotlin :822 / :830 —— 指纹进缓存键（同一张图 → 同一个键 → 复用译文）。
    const fingerprint = await this.fingerprintPage(page, signal);
    const cfg = this.config;
    const name = await translationCacheKey([fingerprint, config.translationLang, config.translationEngine,
      config.translationEngine === 'ai' ? [cfg.apiUrl, cfg.modelName, cfg.geminiFormat] : 'online-v1'].join('|') + '|v2');
    let result = await this.readCache(name, page.width, page.height);
    if (!result) {
      stage('正在识别漫画文字…');
      const lines = await this.recognizePage(page, config, signal);
      const regions = await this.network.translate(lines, config.translationEngine, cfg, signal, stage);
      result = { pageWidth: page.width, pageHeight: page.height, regions };
      check(signal);
      if (!await this.privacyAllowed()) return null;
      await this.writeCache(name, result).catch(() => {});
    }
    check(signal);
    if (!result.regions.some((region) => region.translated.trim()) || !await this.privacyAllowed()) return null;
    return this.bakePage(page, result, config.translationTextScale);
  }

  /**
   * Kotlin :821 `PageMemoryBudget.check(base)`（PageMemoryBudget.kt:11-15）。
   *
   * Kotlin 的 `require(...)` 抛 `IllegalArgumentException`，`TranslationFailure.from` 会把它归成
   * `input`（TranslationFailure.kt:43），`require` 的文案「页面过大，请降低图片清晰度后翻译」被丢掉。
   * 这里改归 Kotlin 的 `memory` 分支（TranslationFailure.kt:42，文案与 `require` 逐字相同），
   * 用户看到的正是那条可执行的提示。
   */
  private checkPageBudget(page: MangaTranslationPage): void {
    try {
      PageMemoryBudget.check(page, this.ports.maxMemoryBytes?.() ?? DEFAULT_MAX_MEMORY_BYTES);
    } catch {
      throw translationFailureException(TRANSLATION_MEMORY);
    }
  }

  /** Android `BitmapFactory.decode…` —— iOS 用 `HTMLImageElement.decode()` 拿真实像素尺寸。 */
  private async decodePage(src: string, signal: AbortSignal): Promise<MangaTranslationPage> {
    if (this.ports.decodePage) return this.ports.decodePage(src, signal);
    const image = new Image();
    image.src = src;
    await image.decode();
    check(signal);
    return { image, width: image.naturalWidth, height: image.naturalHeight };
  }

  /**
   * Kotlin :822 / :830 `PageMemoryBudget.fingerprint(base)`。
   *
   * Android 采样 ≤32 行 × 16384px 后做 SHA-256（PageMemoryBudget.kt:16-31，`fingerprintBitmap`
   * 是该段的逐行移植）；iOS 侧页面只以 Blob URL 存在，直接对同一页的字节取 SHA-256 ——
   * 同一张图得到同一个键，缓存复用语义与 Android 一致。
   */
  private async fingerprintPage(page: MangaTranslationPage, signal: AbortSignal): Promise<string> {
    if (this.ports.fingerprint) return this.ports.fingerprint(page, signal);
    const bytes = await (await fetch(page.image.src, { signal })).arrayBuffer();
    return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  }

  /**
   * Kotlin :591-641 `ocrRegions` / `recognizeForTranslation` —— OCR 段。
   * 引擎或识别失败按 `OcrEngine` / `Ocr` 分类（Kotlin :547-549 / :603 / :706）。
   */
  private async recognizePage(page: MangaTranslationPage, config: ComicReaderConfig,
    signal: AbortSignal): Promise<TranslatedRegion[]> {
    const forcedLang = config.translationLang === 'auto' ? null : config.translationLang;
    try {
      return this.ports.ocr ? await this.ports.ocr(page, forcedLang, signal) : await this.ocr.recognize(page, forcedLang, signal);
    } catch (error) {
      if (signal.aborted || error instanceof TranslationException) throw error;
      // Kotlin :547 / :603 —— 模型没就绪是 Models，否则是识别失败 Ocr。
      if (!this.models.ready) throw translationFailureException(TRANSLATION_MODELS);
      throw translationFailureException(TRANSLATION_OCR);
    }
  }

  /** Kotlin :851 `BubblePipeline.bake(base, regions, textScale)`。 */
  private bakePage(page: MangaTranslationPage, translation: PageTranslation, textScale: number): Promise<Blob> {
    return this.ports.bake
      ? this.ports.bake(page, translation, textScale)
      : bakeMangaTranslation(page.image, translation, textScale);
  }

  /**
   * Kotlin :876-884 + TranslationFailure.kt:25-32 —— 统一失败分类。
   *
   * 取消（翻页/关页）原样抛出，Kotlin 的 `catch (e: CancellationException) { throw e }` 同理；
   * 其余一律包成 `TranslationException`，让 UI 拿到分类后的中文文案而不是 `Error: 500`。
   */
  private classifyFailure(error: unknown, signal?: AbortSignal): Error {
    if (signal?.aborted === true) {
      return error instanceof Error ? error : new DOMException('已取消漫画翻译', 'AbortError');
    }
    if (error instanceof TranslationException) return error;
    // Kotlin `TranslationFailure.http(status)`（TranslationFailure.kt:30-37 / TextTranslator.kt:137）
    if (this.lastHttpStatus !== undefined) return translationFailureException(translationFailureForHttpStatus(this.lastHttpStatus));
    // Kotlin `TranslationFailure.Timeout`（TextTranslator.kt:116 的 `lastFailure = Timeout`）：
    // 请求层超时会被在线兜底吞成「未获取到可用译文」，这里把它抢回来。
    if (isTimeoutLikeError(error) || (this.lastRequestError !== undefined && isTimeoutLikeError(this.lastRequestError))) {
      return translationFailureException(TRANSLATION_TIMEOUT);
    }
    const swallowed = this.lastRequestError === undefined ? null : translationFailureFrom(this.lastRequestError);
    // `internal` 是 from() 的兜底（TranslationFailure.kt:44），没有信息量 —— 继续往下判。
    if (swallowed !== null && swallowed.code !== 'internal') return translationFailureException(swallowed);
    for (const rule of NETWORK_MESSAGE_FAILURES) {
      if (error instanceof Error && error.message.startsWith(rule.prefix)) return translationFailureException(rule.failure);
    }
    return translationFailureException(translationFailureFrom(error));
  }
}

let runtime: MangaTranslationRuntime | undefined;
let owner: PlatformBundle | undefined;
export function getMangaTranslationRuntime(): MangaTranslationRuntime | null {
  if (getPlatformKind() !== 'ios-native') return null;
  const platform = getPlatform();
  if (!runtime || platform !== owner) { owner = platform; runtime = new MangaTranslationRuntime(platform); }
  return runtime;
}
