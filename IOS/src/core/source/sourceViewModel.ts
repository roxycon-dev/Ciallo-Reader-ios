/**
 * Android `com.example.source.SourceViewModel.kt` (188 lines, 169 non-blank)
 * → `src/core/source/sourceViewModel.ts`.
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-14    package/imports                       → header + imports
 *   15-23   class + secondary constructor        → SourceViewModel + options
 *   25-28   StateFlow properties                  → re-exported StateFlow getters
 *   30-34   init { viewModelScope.launch { sourceManager.initialize() } }
 *                                                    → constructor kicks off `initialize()`
 *   36-37   _importStatus + importStatus          → importStatus StateFlow
 *   39-43   enableSource()                        → enableSource()
 *   45-49   disableSource()                       → disableSource()
 *   51-55   setActiveSource()                     → setActiveSource()
 *   57-59   isSourceEnabled()                     → isSourceEnabled()
 *   61-63   isCustomSource()                      → isCustomSource()
 *   65-69   removeSource()                        → removeSource()
 *   71-83   importSourceFromUri()                 → importSourceFromUri()
 *   85-97   importSourceFromJsonString()          → importSourceFromJsonString()
 *   99-112  importSourceFromUrl()                 → importSourceFromUrl()
 *   114-122 buildImportStatus()                   → buildImportStatus()
 *   124-126 clearImportStatus()                   → clearImportStatus()
 *   128-150 refreshJsSources()                    → refreshJsSources()
 *   152-187 setAdultSourcesEnabled()              → setAdultSourcesEnabled()
 *
 * Skipped lines / adaptations:
 *   - `android.app.Application` + `AndroidViewModel(application)` → no Android
 *     lifecycle: the class is constructed by the UI layer and every side effect
 *     is an explicit `async` method. `viewModelScope.launch { … }` becomes an
 *     `async` method (or a fire-and-forget task) whose promise the caller can
 *     await; nothing is auto-cancelled on "viewModel cleared", which the web/iOS
 *     app has no equivalent for.
 *   - `android.net.Uri` → a `string | UriLike` token passed to the injected
 *     `readUriText` (the importer owns the platform file access).
 *   - `SourceImporter.importBatchFromUri(getApplication(), uri)` →
 *     `importBatchFromUri(uri, {readUriText})`; `importBatchFromJsonString` and
 *     `importBatchFromUrl` are module functions already.
 *   - `SharedPreferencesSourceStorage(application)` → an injected `SourceStorage`
 *     (the interface `SourceManager` already declares).
 *   - `PreferencesManager(app)` + `JsSourceRepo.install(...)` →
 *     `jsSourceRepo: { install(options): Promise<BookSource[]> }`, injected
 *     because `source/js/**` belongs to another module. `prefs.jsSourceRepoUrl`
 *     and `prefs.showAdultSources` are read from the injected
 *     `adultSourcePrefs` port; writing `prefs.showAdultSources` calls its setter.
 *   - `MutableStateFlow.asStateFlow()` → the `createStateFlow` helper already
 *     exported by `./sourceManager`.
 *   - `it.sourceKey in adultKeys` (line 182) → a structural check
 *     `sourceKey in adultKeys` on the returned objects; `JsComicSource` is owned
 *     by the JS module, so the duck-typed read is the documented equivalent.
 *   - The three import methods keep their exact status strings.
 */

import type { BookSource } from './bookSource';
import { SourceManager } from './sourceManager';
import type { StateFlow } from './sourceManager';
import { createStateFlow } from './sourceManager';
import type { SourceStorage } from './sourceManager';
import {
  buildImportStatusText,
  importBatchFromJsonString,
  importBatchFromUrl,
  importBatchFromUri,
} from './importer/sourceImporter';
import type { SourceImporterOptions } from './importer/sourceImporter';

/** Kotlin `PreferencesManager` — the two JS-repo prefs this view model touches. */
export interface AdultSourcePrefs {
  jsSourceRepoUrl: string;
  showAdultSources: boolean;
}

/** Kotlin `JsSourceRepo.install(context, repoUrl, includeAdult)`. */
export interface JsSourceRepo {
  install(options: { repoUrl: string; includeAdult: boolean }): Promise<BookSource[]>;
  /** Kotlin `JsSourceRepo.ADULT_KEYS`. */
  readonly adultKeys: ReadonlySet<string>;
}

export interface SourceViewModelOptions {
  /** Kotlin `sourceManager: SourceManager`. */
  readonly sourceManager: SourceManager;
  /** Kotlin `SharedPreferencesSourceStorage(application)`. */
  readonly storage?: SourceStorage;
  /** Passed through to `SourceManager` when `sourceManager` is not supplied. */
  readonly makeSourceManager?: (storage: SourceStorage | null) => SourceManager;
  /** Kotlin `SourceImporter.importBatchFromUri` platform file access. */
  readonly importer?: SourceImporterOptions;
  /** Kotlin `JsSourceRepo`. */
  readonly jsSourceRepo?: JsSourceRepo;
  /** Kotlin `PreferencesManager(app)` for the JS-repo prefs. */
  readonly adultSourcePrefs?: AdultSourcePrefs;
  /** Kotlin `getApplication()`-bound coroutine scope. */
  readonly launch?: (task: () => Promise<void>) => void;
}

/**
 * The shape the importer returns. `BookSource` (not `JsonBookSource`) because
 * `SourceManager.registerSource` accepts any source and the Kotlin list is
 * re-registered through the same manager.
 */
interface ImportableBatch {
  readonly imported: ReadonlyArray<{ source: BookSource; rawJson: string }>;
  readonly skipped: ReadonlyArray<{ id: string; reason: string }>;
}

const NOOP_LAUNCH = (task: () => Promise<void>): void => {
  void task();
};

export class SourceViewModel {
  readonly sourceManager: SourceManager;

  readonly allSources: StateFlow<BookSource[]>;
  readonly availableSources: StateFlow<BookSource[]>;
  readonly activeSource: StateFlow<BookSource | null>;
  readonly enabledStates: StateFlow<Map<string, boolean>>;

  private readonly _importStatus = createStateFlow<string | null>(null);
  readonly importStatus: StateFlow<string | null> = this._importStatus;

  private readonly options: SourceViewModelOptions;
  private readonly launch: (task: () => Promise<void>) => void;

  constructor(options: SourceViewModelOptions) {
    this.options = options;
    this.sourceManager =
      options.sourceManager ?? (options.makeSourceManager?.(options.storage ?? null) ?? new SourceManager(options.storage ?? null));
    this.allSources = this.sourceManager.allSources;
    this.availableSources = this.sourceManager.availableSources;
    this.activeSource = this.sourceManager.activeSource;
    this.enabledStates = this.sourceManager.enabledStates;
    this.launch = options.launch ?? NOOP_LAUNCH;

    // Kotlin `init { viewModelScope.launch(Dispatchers.IO) { sourceManager.initialize() } }`
    this.launch(async () => {
      await this.sourceManager.initialize();
    });
  }

  enableSource(id: string): Promise<void> {
    return this.sourceManager.setSourceEnabled(id, true);
  }

  disableSource(id: string): Promise<void> {
    return this.sourceManager.setSourceEnabled(id, false);
  }

  setActiveSource(id: string): Promise<void> {
    return this.sourceManager.setActiveSource(id);
  }

  isSourceEnabled(id: string): boolean {
    return this.sourceManager.isSourceEnabled(id);
  }

  isCustomSource(id: string): boolean {
    return this.sourceManager.isCustomSource(id);
  }

  removeSource(id: string): Promise<void> {
    return this.sourceManager.unregisterSource(id);
  }

  importSourceFromUri(uri: string): void {
    this.launch(async () => {
      const result = await importBatchFromUri(uri, this.options.importer ?? {});
      await this.registerImported(result, '导入失败: ');
    });
  }

  importSourceFromJsonString(jsonStr: string): void {
    this.launch(async () => {
      const result = importBatchFromJsonString(jsonStr);
      await this.registerImported(result, '导入失败: ');
    });
  }

  importSourceFromUrl(url: string): void {
    this.launch(async () => {
      this._importStatus.value = '正在从网络获取书源...';
      const result = await importBatchFromUrl(url, this.options.importer ?? {});
      await this.registerImported(result, '网络导入失败: ');
    });
  }

  /**
   * Shared tail of the three `importSourceFrom…` methods (Kotlin lines 74-82 / 88-96 / 107-111).
   *
   * `failurePrefix` is the per-entry-point literal Kotlin inlines at each call site:
   * `"导入失败: "` for `importSourceFromUri`/`importSourceFromJsonString` (Kotlin L75 / L89)
   * and `"网络导入失败: "` for `importSourceFromUrl` (Kotlin L104). It is prepended to the
   * first skipped reason, falling back to `"未找到可导入的书源"` when there is none.
   */
  private async registerImported(result: ImportableBatch, failurePrefix: string): Promise<void> {
    if (result.imported.length === 0) {
      this._importStatus.value =
        failurePrefix + this.failureMessage(result.skipped[0]?.reason, '未找到可导入的书源');
      return;
    }
    for (const entry of result.imported) {
      await this.sourceManager.registerSource(entry.source, true, entry.rawJson);
    }
    this._importStatus.value = buildImportStatusText(result);
  }

  /** Kotlin's `buildImportStatus` (lines 114-122). */
  buildImportStatus(result: ImportableBatch): string {
    return buildImportStatusText(result);
  }

  clearImportStatus(): void {
    this._importStatus.value = null;
  }

  /** 刷新 Venera 源仓库：移除现有 JS 源并从远程仓库重新安装。 */
  refreshJsSources(): void {
    this.launch(async () => {
      this._importStatus.value = '正在刷新 JS 源仓库…';
      const repo = this.options.jsSourceRepo;
      const prefs = this.options.adultSourcePrefs;
      if (repo == null || prefs == null) {
        this._importStatus.value = '源仓库刷新失败或仓库为空，请检查网络后重试';
        return;
      }
      const sources = await repo.install({
        repoUrl: prefs.jsSourceRepoUrl,
        includeAdult: true,
      });
      if (sources.length === 0) {
        this._importStatus.value = '源仓库刷新失败或仓库为空，请检查网络后重试';
        return;
      }
      await this.unregisterJsSources();
      for (const source of sources) {
        await this.sourceManager.registerSource(source, true);
      }
      this._importStatus.value = `源仓库刷新完成，共 ${sources.length} 个漫画源`;
    });
  }

  /**
   * 成人源开关：开启时自动从 Venera 仓库拉取并注册成人源；关闭时只移除成人源。
   * 不再做“能否连网站”的自动开关检测，开关状态完全由用户控制。
   */
  setAdultSourcesEnabled(enabled: boolean): void {
    // Android 1.5.2+: the old disabled preference no longer hides these sources.
    enabled = true;
    this.launch(async () => {
      const repo = this.options.jsSourceRepo;
      const prefs = this.options.adultSourcePrefs;
      if (prefs != null) prefs.showAdultSources = enabled;
      if (repo == null || prefs == null) {
        this._importStatus.value = '成人源更新失败，请检查网络后重试';
        return;
      }
      if (enabled) {
        this._importStatus.value = '正在更新成人源…';
        const sources = await repo.install({
          repoUrl: prefs.jsSourceRepoUrl,
          includeAdult: true,
        });
        if (sources.length === 0) {
          this._importStatus.value = '成人源更新失败，请检查网络后重试';
          return;
        }
        await this.unregisterJsSources();
        for (const source of sources) {
          await this.sourceManager.registerSource(source, true);
        }
        this._importStatus.value = `成人源已更新（共 ${sources.length} 个漫画源）`;
        return;
      }
      const adultKeys = repo.adultKeys;
      this.sourceManager.allSources.value
        .filter((it) => it.id.startsWith('js_'))
        .filter((it) => adultKeys.has(sourceKeyOf(it)))
        .forEach((it) => {
          void this.sourceManager.unregisterSource(it.id);
        });
      this._importStatus.value = '成人源已隐藏';
    });
  }

  /** Kotlin lines 139-141 / 168-170 / 179-183 — remove every `js_` source (optionally adult-only). */
  private async unregisterJsSources(): Promise<void> {
    for (const source of this.sourceManager.allSources.value.filter((it) => it.id.startsWith('js_'))) {
      await this.sourceManager.unregisterSource(source.id);
    }
  }

  /**
   * Kotlin `result.skipped.firstOrNull()?.second ?: "未找到可导入的书源"` (L75 / L89 / L104).
   *
   * The elvis only fires on a **null** element, so an empty-but-present reason is kept
   * verbatim — hence `??` rather than `||`.
   */
  private failureMessage(reason: string | undefined, fallback: string): string {
    return reason ?? fallback;
  }
}

/** Kotlin `it is JsComicSource → it.sourceKey`, duck-typed across the JS module boundary. */
function sourceKeyOf(source: BookSource): string {
  const key = (source as { sourceKey?: unknown }).sourceKey;
  return typeof key === 'string' ? key : '';
}
