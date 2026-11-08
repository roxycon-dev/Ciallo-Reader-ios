import type { ComicBitmap, ComicReaderConfig } from '@core/comic/comicReaderCore';
import { formatCacheSize } from '@core/cache/cacheManagement';
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

export type MangaTranslationStorageKey = 'manga_tr_cache' | 'manga_tr_models';

/** Safe, runtime-owned rows used by CacheManagementPage instead of raw path deletion. */
export interface MangaTranslationStorageEntry {
  readonly file: string;
  readonly size: number;
  readonly label: string;
  readonly sublabel: string;
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

  testConnection(engine: 'ai' | 'online', config: LlmConfig, signal?: AbortSignal): Promise<string> {
    return this.network.testConnection(engine, config, signal);
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
