import type { ComicBitmap, ComicReaderConfig } from '@core/comic/comicReaderCore';
import { AsyncMutex } from '@core/data/contentMutationGate';
import type { LlmConfig } from '@core/mangatranslate/llmTranslator';
import { MangaTranslationNetwork } from '@core/mangatranslate/translationNetwork';
import { TRANSLATION_CACHE_DIR, TRANSLATION_CACHE_MAX_FILE_BYTES, TRANSLATION_CACHE_MAX_TOTAL_BYTES, translationCacheKey, type PageTranslation } from '@core/mangatranslate/translationCore';
import { TranslationPrivacy } from '@core/mangatranslate/translationPrivacy';
import { PreferencesManager, SettingsRepository } from '@core/settings/settingsRepository';
import { getPlatform, getPlatformKind, type PlatformBundle } from '@platform/index';
import { getPrivacyService } from '@platform/privacyRuntime';
import { bakeMangaTranslation } from '@platform/raster/mangaTranslationBake';
import { NativeMangaModels } from './nativeMangaModels';
import { NativeMangaOcr } from './nativeMangaOcr';

const CONFIG_KEY = 'mangaTranslate.llm.v1';
const defaultConfig: LlmConfig = { apiUrl: '', apiKey: '', modelName: '', geminiFormat: false };
const check = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('已取消漫画翻译', 'AbortError'); };

export class MangaTranslationRuntime {
  readonly models: NativeMangaModels;
  private readonly ocr: NativeMangaOcr;
  private readonly network: MangaTranslationNetwork;
  private readonly pageLock = new AsyncMutex();
  private readonly diskLock = new AsyncMutex();
  private readonly preferences: PreferencesManager;
  private llm = defaultConfig;
  private cacheBytes = 0;
  private configLoaded = false;
  private configVersion = 0;
  private configWrite = Promise.resolve();

  constructor(private readonly platform: PlatformBundle) {
    this.models = new NativeMangaModels(platform.fs, platform.http);
    this.ocr = new NativeMangaOcr(this.models);
    this.preferences = new PreferencesManager(new SettingsRepository(platform.db));
    this.network = new MangaTranslationNetwork(platform.http, platform.keyValue, () => this.privacyAllowed());
  }

  async privacyAllowed(): Promise<boolean> {
    const [privacy, incognito] = await Promise.all([getPrivacyService().ready(), this.preferences.incognitoBrowsingEnabled()]);
    return TranslationPrivacy.allowed(privacy.enabled, incognito);
  }

  async refresh(): Promise<void> { await Promise.all([this.models.refresh(), this.loadConfig(), this.refreshCache()]); }
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
    this.configVersion++; this.configLoaded = true;
    this.llm = { ...config };
    this.configWrite = this.configWrite.catch(() => {}).then(() => this.platform.secure.set(CONFIG_KEY, JSON.stringify(config)));
    return this.configWrite;
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

  async clearCache(): Promise<void> {
    await this.diskLock.withLock(async () => {
      for (const file of await this.cacheFiles()) {
        await this.platform.fs.delete(TRANSLATION_CACHE_DIR + '/' + file.name);
        this.platform.keyValue.remove('mangaTranslate.used.' + file.name);
      }
      this.cacheBytes = 0;
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
      check(signal);
      if (!await this.privacyAllowed()) return null;
      if (!this.models.ready) {
        stage('正在准备翻译模型…');
        const failure = await this.models.ensureDownloaded();
        check(signal);
        if (failure) throw new Error(failure);
      }
      await this.loadConfig();
      check(signal);
      const image = new Image();
      image.src = bitmap.src;
      await image.decode();
      check(signal);
      const width = image.naturalWidth, height = image.naturalHeight;
      if (width * height * 4 > 48 * 1024 * 1024) throw new Error('漫画页面过大，无法翻译');
      const imageData = await (await fetch(bitmap.src, { signal })).arrayBuffer();
      const hash = await crypto.subtle.digest('SHA-256', imageData);
      const fingerprint = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const cfg = this.config;
      const name = await translationCacheKey([fingerprint, config.translationLang, config.translationEngine,
        config.translationEngine === 'ai' ? [cfg.apiUrl, cfg.modelName, cfg.geminiFormat] : 'online-v1'].join('|') + '|v2');
      let result = await this.readCache(name, width, height);
      if (!result) {
        stage('正在识别漫画文字…');
        const lines = await this.ocr.recognize({ image, width, height }, config.translationLang === 'auto' ? null : config.translationLang, signal);
        const regions = await this.network.translate(lines, config.translationEngine, cfg, signal, stage);
        result = { pageWidth: width, pageHeight: height, regions };
        check(signal);
        if (!await this.privacyAllowed()) return null;
        await this.writeCache(name, result).catch(() => {});
      }
      check(signal);
      if (!result.regions.some((region) => region.translated.trim()) || !await this.privacyAllowed()) return null;
      return bakeMangaTranslation(image, result, config.translationTextScale);
    });
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
