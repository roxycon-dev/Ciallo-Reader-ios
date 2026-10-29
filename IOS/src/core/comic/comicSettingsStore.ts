/**
 * comicSettingsStore.ts — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicSettingsStore.kt`（335 行 / 295 非空）。
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/comic/ComicSettingsStore.kt
 * TS 目标:   IOS/src/core/comic/comicSettingsStore.ts
 * 配套:      IOS/src/core/comic/comicReaderConfig.ts（配置模型 + JSON 语义）
 *
 * Kotlin → TS 映射（行号 = ComicSettingsStore.kt）
 * -----------------------------------------------
 *   1       `package com.example.ui.comic`          → 无对应物（TS 无包）
 *   3-4     `android.content.Context` / `SharedPreferences`
 *                                                      → 注入式 `ComicKeyValueStore`
 *                                                      （见下方「存储端口」；core 层
 *                                                       不能碰 DOM / Capacitor）
 *   5-7     `org.json.JSONArray` / `JSONObject` / `java.util.UUID`
 *                                                      → `./comicReaderConfig` 的 JSON
 *                                                        助手 + 注入式 `randomUuid`
 *   9-16    文件 KDoc「漫画阅读器设置仓库」           → 本文件头（压缩保留）
 *   17-20   `class ComicSettingsStore(context)` + `getSharedPreferences("comic_reader_store")`
 *                                                      → `class ComicSettingsStore(store, opts)`
 *                                                      + `COMIC_PREF_FILE` / `comicPrefsKey()`
 *   22-27   `companion object` 的三个 `const val PRESET_*` + `BUILTIN_IDS`
 *                                                      → `PRESET_MANGA` / `PRESET_WEBTOON` /
 *                                                        `PRESET_CLASSIC` / `BUILTIN_IDS`
 *   30-31   `private fun builtinPreset(...)`         → `builtinPreset()`
 *   33-67   `private fun builtins(): List<ComicPreset>`→ `builtins()`
 *   72-80   `fun loadGlobalConfig()`                 → `loadGlobalConfig()`
 *   82-84   `fun saveGlobalConfig(config)`           → `saveGlobalConfig()`
 *   88-97   `fun loadPresets()`                      → `loadPresets()`
 *   99-103  `private fun savePresets(list)`          → `savePresets()`
 *   105-112 `fun createPreset(name, emoji, config)`  → `createPreset()`
 *   115-124 `fun togglePresetFavorite(id)`           → `togglePresetFavorite()`
 *   127     `fun favoritePresets()`                  → `favoritePresets()`
 *   131-139 `fun loadCustomFitPresets()`             → `loadCustomFitPresets()`
 *   141-145 `private fun saveCustomFitPresets(list)` → `saveCustomFitPresets()`
 *   147-155 `fun saveCustomFitPreset(name, base, scalePct)` → `saveCustomFitPreset()`
 *   157-162 `fun deleteCustomFitPreset(id)`          → `deleteCustomFitPreset()`
 *   165-178 `fun updatePreset(id, name, config)`     → `updatePreset()`
 *   180-192 `fun duplicatePreset(id)`                → `duplicatePreset()`
 *   194-203 `fun deletePreset(id)`                   → `deletePreset()`
 *   205     `fun defaultPresetId()`                  → `defaultPresetId()`
 *   208-216 `fun setDefaultPreset(id)`               → `setDefaultPreset()`
 *   218-241 `private fun ensureBuiltinPresets()`     → `ensureBuiltinPresets()`（迁移逻辑）
 *   245-251 `loadBookConfig` / `saveBookConfig`      → 同名 + `BOOK_CONFIG_PREFIX`
 *   253-255 `fun clearBookConfig(bookKey)`           → `clearBookConfig()`
 *   257-260 `fun loadBookState(bookKey)`             → `loadBookState()`
 *   262-264 `fun saveBookState(bookKey, state)`      → `saveBookState()`
 *   266-267 `data class EffectiveConfig`             → `interface EffectiveConfig`
 *   269-274 `fun effectiveConfig(bookKey?)`          → `effectiveConfig()`
 *   277-285 `data class ComicPreset`                → `interface ComicPreset`
 *   287-295 `fun toJson(): JSONObject`               → `comicPresetToJson()`
 *   296-305 `companion object { fun fromJson }`      → `comicPresetFromJson()`
 *   308-313 `data class ComicCustomFitPreset`        → `interface ComicCustomFitPreset`
 *   315-321 `fun toJson()`                           → `comicCustomFitPresetToJson()`
 *   322-330 `companion object { fun fromJson }`      → `comicCustomFitPresetFromJson()`
 *   332-335 `private const val KEY_*`                → `KEY_GLOBAL_CONFIG` / `KEY_PRESETS` /
 *                                                        `KEY_DEFAULT_PRESET` /
 *                                                        `KEY_CUSTOM_FIT_PRESETS`（改为导出，
 *                                                        供平台层与测试引用）
 *
 * 存储端口（`SharedPreferences` → `ComicKeyValueStore`）
 * ---------------------------------------------------
 *  Android 把整份 `comic_reader_store` 存成一个 SharedPreferences 文件（键值对）。
 *  Web/iOS 端沿用同一份键名空间：`comic_reader_store:<key>`（与
 *  `ComicReaderPage.tsx` 里那份临时 `WebComicSettingsStore` 的 localStorage 键
 *  **逐字相同**，因此既有用户数据不需要迁移）。
 *  适配器（localStorage / Capacitor Preferences）由平台层提供，见报告的 swap 说明：
 *
 *    import { comicPrefsKey } from '@core/comic/comicSettingsStore';
 *    const store: ComicKeyValueStore = {
 *      getString: (k) => localStorage.getItem(comicPrefsKey(k)),
 *      putString: (k, v) => localStorage.setItem(comicPrefsKey(k), v),
 *      remove: (k) => localStorage.removeItem(comicPrefsKey(k)),
 *    };
 *
 * Skipped（未移植 + 原因）
 * ------------------------
 *   L3-4     `Context` / `SharedPreferences`           → 注入式 KV 端口（core 层不能碰
 *                                                      localStorage / Capacitor Preferences）
 *   L20      `Context.MODE_PRIVATE`                   → Web 无访问模式概念
 *   L7/L107  `java.util.UUID.randomUUID()`            → 注入式 `randomUuid()`（默认
 *                                                      `crypto.randomUUID`），并保留
 *                                                      `.toString().take(12)` / `take(10)`
 *                                                      的截断长度
 *   L150     `name.ifBlank { "缩放 %d%%".format(scalePct) }`
 *                                                      → `'缩放 %d%%'.replace('%d', …)`
 *                                                      （Kotlin `String.format` 的 `%d` 对
 *                                                       非负整数与 JS 一致）
 *   L185     `src.name + " 副本"`                     → `' 副本'`（ASCII 空格，非 U+3000；
 *                                                      已按字节核对）
 *   L122     `list.sortedByDescending { it.favorite }`→ `favoritesFirst()`：Kotlin 的
 *                                                      `sortedBy` 是**稳定**排序，因此结果
 *                                                      恰好等于「收藏在前、组内保持原相对
 *                                                      顺序」的稳定划分
 *   L240     `if (merged != existing || …)`           → `presetsEqual()`（`data class`
 *                                                      结构相等的显式实现，逐字段比）
 *   L275     `class` 的最后一个 `}`                   → TS class 结束
 */

import {
  COMIC_FIT_VALUES,
  DEFAULT_COMIC_READER_CONFIG,
  EMPTY_COMIC_BOOK_STATE,
  comicBookStateFromJson,
  comicBookStateToJsonString,
  comicReaderConfigFromJson,
  comicReaderConfigToJson,
  comicReaderConfigToJsonString,
  coerceIn,
  optInt,
  optJSONObject,
  optString,
  type ComicBookState,
  type ComicFit,
  type ComicReaderConfig,
  type JsonArray,
  type JsonObject,
} from './comicReaderConfig';

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L332-335 + L20 — 键名与键前缀（**load-bearing**）
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin L20 `context.getSharedPreferences("comic_reader_store", MODE_PRIVATE)`。 */
export const COMIC_PREF_FILE = 'comic_reader_store';

/** Kotlin L332 `KEY_GLOBAL_CONFIG`。 */
export const KEY_GLOBAL_CONFIG = 'global_config';
/** Kotlin L333 `KEY_PRESETS`。 */
export const KEY_PRESETS = 'presets';
/** Kotlin L334 `KEY_DEFAULT_PRESET`。 */
export const KEY_DEFAULT_PRESET = 'default_preset';
/** Kotlin L335 `KEY_CUSTOM_FIT_PRESETS`。 */
export const KEY_CUSTOM_FIT_PRESETS = 'custom_fit_presets';

/** Kotlin L246 `prefs.getString("book_cfg_$bookKey", null)`。 */
export const BOOK_CONFIG_PREFIX = 'book_cfg_';
/** Kotlin L258 `prefs.getString("book_state_$bookKey", null)`。 */
export const BOOK_STATE_PREFIX = 'book_state_';

/** Kotlin L246 的键名（SharedPreferences 内部键，不含文件名）。 */
export function bookConfigKey(bookKey: string): string {
  return `${BOOK_CONFIG_PREFIX}${bookKey}`;
}

/** Kotlin L258 的键名。 */
export function bookStateKey(bookKey: string): string {
  return `${BOOK_STATE_PREFIX}${bookKey}`;
}

/**
 * 平台层（localStorage / Capacitor Preferences）使用的完整键名。
 * Android 的 SharedPreferences 文件名在 Web 上退化为键前缀，
 * 形式与 `ComicReaderPage.tsx` 现有的 `comic_reader_store:*` 一致 —— 数据兼容。
 */
export function comicPrefsKey(key: string): string {
  return `${COMIC_PREF_FILE}:${key}`;
}

/** `SharedPreferences` 的最小同步 KV 形状（本仓库只用到字符串）。 */
export interface ComicKeyValueStore {
  getString(key: string): string | null;
  putString(key: string, value: string): void;
  remove(key: string): void;
}

/** 内存实现（测试 / 无存储环境兜底）。 */
export function createMemoryComicStore(initial?: Readonly<Record<string, string>>): ComicKeyValueStore {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getString: (key) => map.get(key) ?? null,
    putString: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

/** Kotlin `JSONObject.optString(key, default)` 在 SharedPreferences 上的等价读法。 */
function getStringOr(prefs: ComicKeyValueStore, key: string, fallback: string): string {
  return prefs.getString(key) ?? fallback;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L277-330 — `data class ComicPreset` / `ComicCustomFitPreset`
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 一套阅读预设 */
export interface ComicPreset {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly config: ComicReaderConfig;
  readonly builtIn: boolean;
  /** 收藏星标（第 27 条）：收藏的预设列表置顶 + 长按设置入口快捷应用 */
  readonly favorite: boolean;
}

/** Kotlin L287-295 `fun toJson(): JSONObject`。 */
export function comicPresetToJson(preset: ComicPreset): Record<string, unknown> {
  return {
    // L288-294
    id: preset.id,
    name: preset.name,
    emoji: preset.emoji,
    builtIn: preset.builtIn,
    favorite: preset.favorite,
    config: comicReaderConfigToJson(preset.config),
  };
}

/** Kotlin L297-304 `fun fromJson(json: JSONObject): ComicPreset`。 */
export function comicPresetFromJson(json: JsonObject): ComicPreset {
  return {
    // L298
    id: optString(json, 'id', ''),
    // L299
    name: optString(json, 'name', '预设'),
    // L300
    emoji: optString(json, 'emoji', 'SC'),
    // L301 `ComicReaderConfig.fromJson(json.optJSONObject("config") ?: JSONObject())`
    config: comicReaderConfigFromJson(optJSONObject(json, 'config') ?? {}),
    // L302
    builtIn: readOptBoolean(json, 'builtIn', false),
    // L303
    favorite: readOptBoolean(json, 'favorite', false),
  };
}

/** Kotlin L308-313 `data class ComicCustomFitPreset`（第 26 条）。 */
export interface ComicCustomFitPreset {
  readonly id: string;
  readonly name: string;
  readonly base: ComicFit;
  readonly scalePct: number;
}

/** Kotlin L315-321 `fun toJson()`。 */
export function comicCustomFitPresetToJson(preset: ComicCustomFitPreset): Record<string, unknown> {
  return {
    // L316-320
    id: preset.id,
    name: preset.name,
    base: preset.base,
    scalePct: preset.scalePct,
  };
}

/** Kotlin L323-329 `fun fromJson()`。 */
export function comicCustomFitPresetFromJson(json: JsonObject): ComicCustomFitPreset {
  // L326 `ComicFit.entries.firstOrNull { it.name == json.optString("base") } ?: ComicFit.FIT_PAGE`
  const rawBase = optString(json, 'base', COMIC_FIT_VALUES[5] ?? 'FIT_PAGE');
  return {
    // L324
    id: optString(json, 'id', ''),
    // L325
    name: optString(json, 'name', '自定义'),
    base: COMIC_FIT_VALUES.find((candidate) => candidate === rawBase) ?? 'FIT_PAGE',
    // L327 `json.optInt("scalePct", 100).coerceIn(50, 250)`
    scalePct: coerceIn(optInt(json, 'scalePct', 100), 50, 250),
  };
}

/** `JSONObject.optBoolean(name, fallback)` —— 复用 comicReaderConfig 的语义（只认真 boolean）。 */
function readOptBoolean(json: JsonObject, name: string, fallback: boolean): boolean {
  const value = json[name];
  return typeof value === 'boolean' ? value : fallback;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L17-275 — `class ComicSettingsStore`
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── Kotlin L22-27 — 内置预设 id ── */

/** 内置预设 id 固定，不可删除 */
export const PRESET_MANGA = 'preset_builtin_manga'; // 日漫
export const PRESET_WEBTOON = 'preset_builtin_webtoon'; // 条漫
export const PRESET_CLASSIC = 'preset_builtin_classic'; // 老漫画

/** Kotlin L28 `private val BUILTIN_IDS = setOf(PRESET_MANGA, PRESET_WEBTOON, PRESET_CLASSIC)`。 */
export const BUILTIN_IDS: ReadonlySet<string> = new Set([PRESET_MANGA, PRESET_WEBTOON, PRESET_CLASSIC]);

/** Kotlin L30-31 `private fun builtinPreset(id, name, emoji, config)`。 */
function builtinPreset(
  id: string,
  name: string,
  emoji: string,
  config: ComicReaderConfig,
): ComicPreset {
  // L31 `ComicPreset(id = id, name = name, emoji = emoji, config = config, builtIn = true)`
  return { id, name, emoji, config, builtIn: true, favorite: false };
}

/**
 * Kotlin L33-67 `private fun builtins(): List<ComicPreset>`。
 * 逐字段照抄（含 `pageSpacingDp = 0f`、`filterGamma = 0.9f`、`filterSharpen = 30`
 * 等只在某个内置预设里出现的覆写）。
 */
export function builtins(): ComicPreset[] {
  return [
    // L34-43 日漫
    builtinPreset(
      PRESET_MANGA,
      '日漫',
      'JP',
      {
        ...DEFAULT_COMIC_READER_CONFIG,
        mode: 'SINGLE', // L37
        direction: 'RTL', // L38
        fit: 'FIT_WIDTH', // L39
        pageAnim: 'CURL', // L40
        bgType: 'PAPER', // L41
      },
    ),
    // L44-53 条漫
    builtinPreset(
      PRESET_WEBTOON,
      '条漫',
      'WL',
      {
        ...DEFAULT_COMIC_READER_CONFIG,
        mode: 'WEBTOON', // L47
        direction: 'TTB', // L48
        pageAnim: 'NONE', // L49
        pageSpacingDp: 0, // L50 `0f`
        bgType: 'BLACK', // L51
      },
    ),
    // L54-66 老漫画
    builtinPreset(
      PRESET_CLASSIC,
      '老漫画',
      'RZ',
      {
        ...DEFAULT_COMIC_READER_CONFIG,
        mode: 'SINGLE', // L57
        direction: 'LTR', // L58
        fit: 'FIT_WIDTH', // L59
        cropMode: 'AUTO', // L60
        enhanceMode: 'CAS', // L61
        filterGamma: 0.9, // L62 `0.9f`
        filterSharpen: 30, // L63
        bgType: 'GRAY', // L64
      },
    ),
  ];
}

/** Kotlin L122 `list.sortedByDescending { it.favorite }`（稳定排序 → 收藏在前）。 */
function favoritesFirst(list: readonly ComicPreset[]): ComicPreset[] {
  const favorites: ComicPreset[] = [];
  const rest: ComicPreset[] = [];
  for (const preset of list) {
    if (preset.favorite) favorites.push(preset);
    else rest.push(preset);
  }
  return [...favorites, ...rest];
}

/** Kotlin `data class ComicPreset` 的结构相等（L240 `merged != existing`）。 */
function presetsEqual(a: readonly ComicPreset[], b: readonly ComicPreset[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined || right === undefined) return false;
    if (
      left.id !== right.id ||
      left.name !== right.name ||
      left.emoji !== right.emoji ||
      left.builtIn !== right.builtIn ||
      left.favorite !== right.favorite ||
      JSON.stringify(comicReaderConfigToJson(left.config)) !==
        JSON.stringify(comicReaderConfigToJson(right.config))
    ) {
      return false;
    }
  }
  return true;
}

/** `JSONArray` 解码（L92-L95 / L132-L138）：逐项 `runCatching`，失败项被跳过。 */
function decodeArray(raw: string, decode: (item: JsonObject) => unknown): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: unknown[] = [];
  for (const item of parsed as JsonArray) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    try {
      out.push(decode(item as JsonObject));
    } catch {
      // L94 `runCatching { … }.getOrNull()?.let { result.add(it) }` → 失败项跳过
    }
  }
  return out;
}

export interface ComicSettingsStoreOptions {
  /**
   * Kotlin L107/L148/L183 的 `UUID.randomUUID()` 注入点。
   * 返回**完整 UUID 字符串**（36 字符，形如 `8-4-4-4-12`），
   * 调用方仍按 Kotlin 的 `take(12)` / `take(10)` 截断。
   */
  randomUuid?: () => string;
}

/** 默认 UUID 源（`crypto.randomUUID`，Web/iOS 都有）。 */
function defaultRandomUuid(): string {
  return crypto.randomUUID();
}

export class ComicSettingsStore {
  private readonly prefs: ComicKeyValueStore;
  private readonly randomUuid: () => string;

  constructor(store: ComicKeyValueStore, options: ComicSettingsStoreOptions = {}) {
    this.prefs = store;
    this.randomUuid = options.randomUuid ?? defaultRandomUuid;
  }

  /* ── 全局配置（L70-84） ── */

  /** Kotlin L72-80 `fun loadGlobalConfig(): ComicReaderConfig`。 */
  loadGlobalConfig(): ComicReaderConfig {
    this.ensureBuiltinPresets();
    // 默认配置 = 默认预设（用户可换默认预设）
    // L75 `prefs.getString(KEY_DEFAULT_PRESET, PRESET_MANGA)`
    const defaultId = getStringOr(this.prefs, KEY_DEFAULT_PRESET, PRESET_MANGA);
    // L76 `loadPresets().firstOrNull { it.id == defaultId }`
    const preset = this.loadPresets().find((item) => item.id === defaultId);
    // L77-78 `prefs.getString(KEY_GLOBAL_CONFIG, null)?.let { runCatching { fromJson }.getOrNull() }`
    const rawGlobal = this.prefs.getString(KEY_GLOBAL_CONFIG);
    let saved: ComicReaderConfig | null = null;
    if (rawGlobal !== null) {
      try {
        saved = comicReaderConfigFromJson(JSON.parse(rawGlobal) as JsonObject);
      } catch {
        saved = null;
      }
    }
    // L79 `return saved ?: preset?.config ?: ComicReaderConfig()`
    return saved ?? preset?.config ?? DEFAULT_COMIC_READER_CONFIG;
  }

  /** Kotlin L82-84 `fun saveGlobalConfig(config)`。 */
  saveGlobalConfig(config: ComicReaderConfig): void {
    this.prefs.putString(KEY_GLOBAL_CONFIG, comicReaderConfigToJsonString(config));
  }

  /* ── 预设系统（L86-241） ── */

  /** Kotlin L88-97 `fun loadPresets(): List<ComicPreset>`。 */
  loadPresets(): ComicPreset[] {
    this.ensureBuiltinPresets();
    // L90 `val raw = prefs.getString(KEY_PRESETS, null) ?: return builtins()`
    const raw = this.prefs.getString(KEY_PRESETS);
    if (raw === null) return builtins();
    const result = decodeArray(raw, (item) => comicPresetFromJson(item)) as ComicPreset[];
    if (result.length === 0) {
      // L96 `result.ifEmpty { builtins().also { savePresets(it) } }`
      const fallback = builtins();
      this.savePresets(fallback);
      return fallback;
    }
    return result;
  }

  /** Kotlin L99-103 `private fun savePresets(list)`。 */
  private savePresets(list: readonly ComicPreset[]): void {
    const arr = list.map((preset) => comicPresetToJson(preset));
    this.prefs.putString(KEY_PRESETS, JSON.stringify(arr));
  }

  /** Kotlin L105-112 `fun createPreset(name, emoji, config)`。 */
  createPreset(name: string, emoji: string, config: ComicReaderConfig): ComicPreset {
    const preset: ComicPreset = {
      // L107 `id = "preset_" + UUID.randomUUID().toString().take(12)`
      id: `preset_${this.randomUuid().slice(0, 12)}`,
      name,
      emoji,
      config,
      builtIn: false,
      favorite: false,
    };
    // L110 `savePresets(loadPresets() + preset)`
    this.savePresets([...this.loadPresets(), preset]);
    return preset;
  }

  /** 收藏/取消收藏预设（第 27 条）：收藏的预设在列表中置顶展示 */
  /** Kotlin L115-124 `fun togglePresetFavorite(id): ComicPreset?`。 */
  togglePresetFavorite(id: string): ComicPreset | null {
    const list = [...this.loadPresets()];
    // L117 `val idx = list.indexOfFirst { it.id == id }`
    const idx = list.findIndex((item) => item.id === id);
    if (idx < 0) return null;
    const current = list[idx];
    if (current === undefined) return null;
    // L119 `list[idx].copy(favorite = !list[idx].favorite)`
    const updated: ComicPreset = { ...current, favorite: !current.favorite };
    list[idx] = updated;
    // 收藏置顶排序：favorite 优先，组内保持原相对顺序（稳定排序）
    // L122 `savePresets(list.sortedByDescending { it.favorite })`
    this.savePresets(favoritesFirst(list));
    return updated;
  }

  /** 收藏的预设（第 27 条：长按设置入口快捷弹出的候选） */
  /** Kotlin L127 `fun favoritePresets(): List<ComicPreset> = loadPresets().filter { it.favorite }`。 */
  favoritePresets(): ComicPreset[] {
    return this.loadPresets().filter((item) => item.favorite);
  }

  /* ── 自定义缩放预设（第 26 条）L129-162 ── */

  /** Kotlin L131-139 `fun loadCustomFitPresets(): List<ComicCustomFitPreset>`。 */
  loadCustomFitPresets(): ComicCustomFitPreset[] {
    // L132 `?: return emptyList()`
    const raw = this.prefs.getString(KEY_CUSTOM_FIT_PRESETS);
    if (raw === null) return [];
    return decodeArray(raw, (item) => comicCustomFitPresetFromJson(item)) as ComicCustomFitPreset[];
  }

  /** Kotlin L141-145 `private fun saveCustomFitPresets(list)`。 */
  private saveCustomFitPresets(list: readonly ComicCustomFitPreset[]): void {
    const arr = list.map((preset) => comicCustomFitPresetToJson(preset));
    this.prefs.putString(KEY_CUSTOM_FIT_PRESETS, JSON.stringify(arr));
  }

  /** Kotlin L147-155 `fun saveCustomFitPreset(name, base, scalePct)`。 */
  saveCustomFitPreset(name: string, base: ComicFit, scalePct: number): ComicCustomFitPreset {
    const preset: ComicCustomFitPreset = {
      // L149 `id = "cfit_" + UUID.randomUUID().toString().take(10)`
      id: `cfit_${this.randomUuid().slice(0, 10)}`,
      // L150 `name = name.ifBlank { "缩放 %d%%".format(scalePct) }`
      name: name.trim() === '' ? `缩放 ${scalePct}%` : name,
      base,
      // L151 `scalePct = scalePct.coerceIn(50, 250)`
      scalePct: coerceIn(scalePct, 50, 250),
    };
    // L153 `saveCustomFitPresets(loadCustomFitPresets() + preset)`
    this.saveCustomFitPresets([...this.loadCustomFitPresets(), preset]);
    return preset;
  }

  /** Kotlin L157-162 `fun deleteCustomFitPreset(id): Boolean`。 */
  deleteCustomFitPreset(id: string): boolean {
    const list = this.loadCustomFitPresets();
    // L159 `if (list.none { it.id == id }) return false`
    if (!list.some((item) => item.id === id)) return false;
    this.saveCustomFitPresets(list.filter((item) => item.id !== id));
    return true;
  }

  /** 内置预设不可改写：返回 null（UI 仅对用户预设提供编辑入口）。 */
  /** Kotlin L165-178 `fun updatePreset(id, name = null, config = null): ComicPreset?`。 */
  updatePreset(
    id: string,
    name: string | null = null,
    config: ComicReaderConfig | null = null,
  ): ComicPreset | null {
    const list = [...this.loadPresets()];
    // L167
    const idx = list.findIndex((item) => item.id === id);
    if (idx < 0) return null;
    const old = list[idx];
    if (old === undefined) return null;
    // L170 `if (old.builtIn) return null`
    if (old.builtIn) return null;
    // L171-174 `old.copy(name = name ?: old.name, config = config ?: old.config)`
    //     ⚠️ Kotlin 的 `copy()` 不改 `favorite`，展开实现同理。
    const updated: ComicPreset = {
      ...old,
      name: name ?? old.name,
      config: config ?? old.config,
    };
    list[idx] = updated;
    this.savePresets(list);
    return updated;
  }

  /** Kotlin L180-192 `fun duplicatePreset(id): ComicPreset?`。 */
  duplicatePreset(id: string): ComicPreset | null {
    const list = this.loadPresets();
    // L182 `val src = list.firstOrNull { it.id == id } ?: return null`
    const src = list.find((item) => item.id === id);
    if (src === undefined) return null;
    const copy: ComicPreset = {
      // L184
      id: `preset_${this.randomUuid().slice(0, 12)}`,
      // L185 `name = src.name + " 副本"`（ASCII 空格，已按字节核对）
      name: `${src.name} 副本`,
      emoji: src.emoji,
      config: src.config,
      // L186 `builtIn = false`
      builtIn: false,
      // L285 `favorite = false` —— Kotlin 构造未传该参数，取默认值
      favorite: false,
    };
    // L189 `savePresets(list + copy)`
    this.savePresets([...list, copy]);
    return copy;
  }

  /** Kotlin L194-203 `fun deletePreset(id): Boolean`。 */
  deletePreset(id: string): boolean {
    // L195 `if (id in BUILTIN_IDS) return false`
    if (BUILTIN_IDS.has(id)) return false;
    const list = this.loadPresets();
    // L197 `if (list.none { it.id == id }) return false`
    if (!list.some((item) => item.id === id)) return false;
    this.savePresets(list.filter((item) => item.id !== id));
    // L199-201 `if (defaultPresetId() == id) setDefaultPreset(PRESET_MANGA)`
    if (this.defaultPresetId() === id) this.setDefaultPreset(PRESET_MANGA);
    return true;
  }

  /** Kotlin L205 `fun defaultPresetId(): String`。 */
  defaultPresetId(): string {
    // `prefs.getString(KEY_DEFAULT_PRESET, PRESET_MANGA) ?: PRESET_MANGA`
    return getStringOr(this.prefs, KEY_DEFAULT_PRESET, PRESET_MANGA);
  }

  /** 设为默认预设：新开阅读即以该预设起步（清除手动改过的全局配置） */
  /** Kotlin L208-216 `fun setDefaultPreset(id)`。 */
  setDefaultPreset(id: string): void {
    // L209 `val preset = loadPresets().firstOrNull { it.id == id } ?: return`
    const preset = this.loadPresets().find((item) => item.id === id);
    if (preset === undefined) return;
    // L210-213 `putString(KEY_DEFAULT_PRESET, id).remove(KEY_GLOBAL_CONFIG).apply()`
    this.prefs.putString(KEY_DEFAULT_PRESET, id);
    this.prefs.remove(KEY_GLOBAL_CONFIG);
    // L214-215 触发一次保存使 preset 配置成为新全局
    this.saveGlobalConfig(preset.config);
  }

  /**
   * Kotlin L218-241 `private fun ensureBuiltinPresets()`。
   *
   * 内置预设不可变：升级时用**当前**的内置配置覆盖旧的同 id 条目，
   * 但保留用户的收藏标记、用户自建预设、默认选择与每本漫画设置；
   * 缺失的内置条目补到**列表头部**（Kotlin L239 `val merged = missing + migrated`）。
   */
  private ensureBuiltinPresets(): void {
    // L219-223
    const raw = this.prefs.getString(KEY_PRESETS);
    if (raw === null) {
      this.savePresets(builtins());
      return;
    }
    // L224-229 Decode directly: loadPresets() calls this method and would recurse when
    // an upgrade needs to restore a missing built-in entry.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (!Array.isArray(parsed)) {
      this.savePresets(builtins());
      return;
    }
    // L230-233
    const existing = decodeArray(raw, (item) => comicPresetFromJson(item)) as ComicPreset[];
    // L236 `val defaults = builtins().associateBy { it.id }`
    const defaults = new Map<string, ComicPreset>(builtins().map((item) => [item.id, item]));
    // L237 `existing.map { old -> defaults[old.id]?.copy(favorite = old.favorite) ?: old }`
    const migrated = existing.map((old) => {
      const replacement = defaults.get(old.id);
      return replacement === undefined ? old : { ...replacement, favorite: old.favorite };
    });
    // L238 `val missing = defaults.values.filter { candidate -> migrated.none { it.id == candidate.id } }`
    const missing = [...defaults.values()].filter(
      (candidate) => !migrated.some((item) => item.id === candidate.id),
    );
    // L239 `val merged = missing + migrated`
    const merged = [...missing, ...migrated];
    // L240 `if (merged != existing || existing.size != arr.length()) savePresets(merged)`
    if (!presetsEqual(merged, existing) || existing.length !== parsed.length) {
      this.savePresets(merged);
    }
  }

  /* ── 每本漫画独立配置 / 状态（L243-264） ── */

  /** Kotlin L245-247 `fun loadBookConfig(bookKey): ComicReaderConfig?`。 */
  loadBookConfig(bookKey: string): ComicReaderConfig | null {
    const raw = this.prefs.getString(bookConfigKey(bookKey));
    if (raw === null) return null;
    try {
      return comicReaderConfigFromJson(JSON.parse(raw) as JsonObject);
    } catch {
      return null;
    }
  }

  /** Kotlin L249-251 `fun saveBookConfig(bookKey, config)`。 */
  saveBookConfig(bookKey: string, config: ComicReaderConfig): void {
    this.prefs.putString(bookConfigKey(bookKey), comicReaderConfigToJsonString(config));
  }

  /** Kotlin L253-255 `fun clearBookConfig(bookKey)`。 */
  clearBookConfig(bookKey: string): void {
    this.prefs.remove(bookConfigKey(bookKey));
  }

  /** Kotlin L257-260 `fun loadBookState(bookKey): ComicBookState`。 */
  loadBookState(bookKey: string): ComicBookState {
    const raw = this.prefs.getString(bookStateKey(bookKey));
    if (raw === null) {
      // L260 `?: ComicBookState()`
      return EMPTY_COMIC_BOOK_STATE;
    }
    try {
      return comicBookStateFromJson(JSON.parse(raw) as JsonObject);
    } catch {
      return EMPTY_COMIC_BOOK_STATE;
    }
  }

  /** Kotlin L262-264 `fun saveBookState(bookKey, state)`。 */
  saveBookState(bookKey: string, state: ComicBookState): void {
    this.prefs.putString(bookStateKey(bookKey), comicBookStateToJsonString(state));
  }

  /** 阅读器启动时的有效配置：本漫画覆盖 > 全局。hasOverride 用于 UI 提示。 */
  /** Kotlin L267 `data class EffectiveConfig(val config, val hasOverride)`。 */
  effectiveConfig(bookKey: string | null): EffectiveConfig {
    // L270-274
    const global = this.loadGlobalConfig();
    if (bookKey === null) return { config: global, hasOverride: false };
    const override = this.loadBookConfig(bookKey);
    return override !== null
      ? { config: override, hasOverride: true }
      : { config: global, hasOverride: false };
  }
}

/** Kotlin L267 `data class EffectiveConfig`。 */
export interface EffectiveConfig {
  readonly config: ComicReaderConfig;
  readonly hasOverride: boolean;
}
