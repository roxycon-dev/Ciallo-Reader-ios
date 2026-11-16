/**
 * comicSettingsStoreKeys.test.ts — `ComicSettingsStore.kt` 存储键的**字节级**核对 +
 * global / per-book 读写优先级 + 预设系统的端到端行为。
 *
 * 为什么单独一份：键名是**跨设备、跨版本的持久化契约**。`comic_reader_store:` 前缀
 * 在 Android 上是 SharedPreferences 的文件名、在 Web 上退化成 localStorage 的键前缀，
 * 两者必须逐字节相同，否则存量用户的所有阅读设置会静默丢失。Kotlin 源：
 *   L20  `context.getSharedPreferences("comic_reader_store", MODE_PRIVATE)`
 *   L332 `private const val KEY_GLOBAL_CONFIG = "global_config"`
 *   L333 `private const val KEY_PRESETS = "presets"`
 *   L334 `private const val KEY_DEFAULT_PRESET = "default_preset"`
 *   L335 `private const val KEY_CUSTOM_FIT_PRESETS = "custom_fit_presets"`
 *   L246 `prefs.getString("book_cfg_$bookKey", null)`
 *   L258 `prefs.getString("book_state_$bookKey", null)`
 *
 * TS 源: IOS/src/core/comic/comicSettingsStore.ts
 */

import { describe, expect, it } from 'vitest';
import {
  BOOK_CONFIG_PREFIX,
  BOOK_STATE_PREFIX,
  BUILTIN_IDS,
  COMIC_PREF_FILE,
  ComicSettingsStore,
  KEY_CUSTOM_FIT_PRESETS,
  KEY_DEFAULT_PRESET,
  KEY_GLOBAL_CONFIG,
  KEY_PRESETS,
  PRESET_CLASSIC,
  PRESET_MANGA,
  PRESET_WEBTOON,
  bookConfigKey,
  bookStateKey,
  builtins,
  comicPrefsKey,
  createMemoryComicStore,
  type ComicKeyValueStore,
} from '../../src/core/comic/comicSettingsStore';
import {
  DEFAULT_COMIC_READER_CONFIG,
  createComicReaderConfig,
  type ComicReaderConfig,
} from '../../src/core/comic/comicReaderConfig';

/** 记录所有 KV 读写的存储（顺便验证没有漏写/漏删）。 */
function recordingStore(): ComicKeyValueStore & { readonly reads: string[]; readonly writes: string[] } {
  const map = new Map<string, string>();
  const reads: string[] = [];
  const writes: string[] = [];
  return {
    reads,
    writes,
    getString: (key) => {
      reads.push(key);
      return map.get(key) ?? null;
    },
    putString: (key, value) => {
      writes.push(key);
      map.set(key, value);
    },
    remove: (key) => {
      writes.push(key);
      map.delete(key);
    },
  };
}

describe('存储键 · 字面量逐字节（Kotlin L20 / L332-335 / L246 / L258）', () => {
  it('SharedPreferences 文件名 = "comic_reader_store"（Kotlin L20）', () => {
    expect(COMIC_PREF_FILE).toBe('comic_reader_store');
    // 逐码位核对，避免不可见字符 / 大小写 / 前后空白
    expect([...COMIC_PREF_FILE].map((c) => c.charCodeAt(0))).toEqual([
      99, 111, 109, 105, 99, 95, 114, 101, 97, 100, 101, 114, 95, 115, 116, 111, 114, 101,
    ]);
  });

  it('四个常量的字面量逐字一致（Kotlin L332-335）', () => {
    expect(KEY_GLOBAL_CONFIG).toBe('global_config');
    expect(KEY_PRESETS).toBe('presets');
    expect(KEY_DEFAULT_PRESET).toBe('default_preset');
    expect(KEY_CUSTOM_FIT_PRESETS).toBe('custom_fit_presets');
  });

  it('每本漫画的两个键前缀逐字一致（Kotlin L246 / L258）', () => {
    expect(BOOK_CONFIG_PREFIX).toBe('book_cfg_');
    expect(BOOK_STATE_PREFIX).toBe('book_state_');
  });

  it('平台层键名 = comic_reader_store:<key>（三个必需的形态）', () => {
    expect(comicPrefsKey(KEY_GLOBAL_CONFIG)).toBe('comic_reader_store:global_config');
    expect(comicPrefsKey(bookConfigKey('k1'))).toBe('comic_reader_store:book_cfg_k1');
    expect(comicPrefsKey(bookStateKey('k1'))).toBe('comic_reader_store:book_state_k1');
  });

  it('前缀用单个冒号连接，不是 :: 或 . （与 Kotlin 文件名退化语义一致）', () => {
    for (const key of [KEY_GLOBAL_CONFIG, bookConfigKey('x'), bookStateKey('x')]) {
      expect(comicPrefsKey(key).match(/comic_reader_store:/g)).toHaveLength(1);
      expect(comicPrefsKey(key)).not.toContain('::');
    }
  });

  it('bookKey 原样嵌入，不做转义 / 大小写变换 / trim（Kotlin 字符串模板）', () => {
    expect(bookConfigKey('MyBook/中文 #1')).toBe('book_cfg_MyBook/中文 #1');
    expect(bookStateKey('MyBook/中文 #1')).toBe('book_state_MyBook/中文 #1');
    expect(comicPrefsKey(bookConfigKey('MyBook/中文 #1'))).toBe(
      'comic_reader_store:book_cfg_MyBook/中文 #1',
    );
  });

  it('不同 bookKey 落在不同的完整键上（不互相覆盖）', () => {
    expect(comicPrefsKey(bookConfigKey('a'))).not.toBe(comicPrefsKey(bookConfigKey('b')));
    expect(comicPrefsKey(bookStateKey('a'))).not.toBe(comicPrefsKey(bookStateKey('b')));
  });

  it('saveGlobalConfig / saveBookConfig / saveBookState 只碰各自的键', () => {
    const kv = recordingStore();
    const settings = new ComicSettingsStore(kv, { randomUuid: () => '0'.repeat(36) });
    const config = createComicReaderConfig({ mode: 'DOUBLE' });

    kv.writes.length = 0;
    settings.saveGlobalConfig(config);
    expect(kv.writes).toEqual([KEY_GLOBAL_CONFIG]);

    kv.writes.length = 0;
    settings.saveBookConfig('k9', config);
    expect(kv.writes).toEqual([bookConfigKey('k9')]);

    kv.writes.length = 0;
    settings.saveBookState('k9', {
      lastPage: 3,
      lastChapterSig: 'p1',
      pageRotations: {},
      mergeAnchors: new Set<number>(),
    });
    expect(kv.writes).toEqual([bookStateKey('k9')]);
  });
});

describe('存储键 · 内置预设 id（Kotlin L24-26 / L28）', () => {
  it('三个内置 id 逐字一致', () => {
    expect(PRESET_MANGA).toBe('preset_builtin_manga');
    expect(PRESET_WEBTOON).toBe('preset_builtin_webtoon');
    expect(PRESET_CLASSIC).toBe('preset_builtin_classic');
  });

  it('BUILTIN_IDS 恰含这三个，顺序即声明顺序', () => {
    expect([...BUILTIN_IDS]).toEqual([PRESET_MANGA, PRESET_WEBTOON, PRESET_CLASSIC]);
  });

  it('builtins() 按 Kotlin L33-67 的声明顺序返回（日漫 / 条漫 / 老漫画）', () => {
    expect(builtins().map((p) => p.id)).toEqual([PRESET_MANGA, PRESET_WEBTOON, PRESET_CLASSIC]);
    expect(builtins().map((p) => p.name)).toEqual(['日漫', '条漫', '老漫画']);
    expect(builtins().map((p) => p.emoji)).toEqual(['JP', 'WL', 'RZ']);
    expect(builtins().every((p) => p.builtIn)).toBe(true);
    expect(builtins().every((p) => !p.favorite)).toBe(true);
  });
});

describe('首次读取 · ensureBuiltinPresets 播种（Kotlin L218-223）', () => {
  it('loadGlobalConfig() 首次会写 KEY_PRESETS（播种三个内置）', () => {
    const kv = recordingStore();
    const settings = new ComicSettingsStore(kv);
    kv.writes.length = 0;
    settings.loadGlobalConfig();
    expect(kv.writes).toContain(KEY_PRESETS);
  });

  it('播种后 presets 键能解出三个内置', () => {
    const kv = createMemoryComicStore();
    const settings = new ComicSettingsStore(kv);
    settings.loadGlobalConfig();
    expect(settings.loadPresets().map((p) => p.id)).toEqual([
      PRESET_MANGA,
      PRESET_WEBTOON,
      PRESET_CLASSIC,
    ]);
  });
});

describe('global vs per-book 读写优先级（Kotlin L269-274 effectiveConfig）', () => {
  it('bookKey === null → 全局，hasOverride=false（Kotlin L271）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    settings.saveGlobalConfig(createComicReaderConfig({ mode: 'MAGNETIC' }));
    const eff = settings.effectiveConfig(null);
    expect(eff.config.mode).toBe('MAGNETIC');
    expect(eff.hasOverride).toBe(false);
  });

  it('无覆盖 → 用全局，hasOverride=false（Kotlin L273）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    settings.saveGlobalConfig(createComicReaderConfig({ mode: 'WEBTOON' }));
    const eff = settings.effectiveConfig('bk');
    expect(eff.config.mode).toBe('WEBTOON');
    expect(eff.hasOverride).toBe(false);
  });

  it('有覆盖 → 覆盖优先，hasOverride=true（Kotlin L273）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    settings.saveGlobalConfig(createComicReaderConfig({ mode: 'WEBTOON' }));
    settings.saveBookConfig('bk', createComicReaderConfig({ mode: 'DOUBLE' }));
    const eff = settings.effectiveConfig('bk');
    expect(eff.config.mode).toBe('DOUBLE');
    expect(eff.hasOverride).toBe(true);
  });

  it('clearBookConfig 后回落到全局（Kotlin L253-255）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    settings.saveGlobalConfig(createComicReaderConfig({ mode: 'WEBTOON' }));
    settings.saveBookConfig('bk', createComicReaderConfig({ mode: 'DOUBLE' }));
    expect(settings.effectiveConfig('bk').config.mode).toBe('DOUBLE');
    settings.clearBookConfig('bk');
    const after = settings.effectiveConfig('bk');
    expect(after.config.mode).toBe('WEBTOON');
    expect(after.hasOverride).toBe(false);
  });

  it('本书覆盖不影响别的书（键隔离）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    settings.saveGlobalConfig(createComicReaderConfig({ mode: 'WEBTOON' }));
    settings.saveBookConfig('a', createComicReaderConfig({ mode: 'DOUBLE' }));
    expect(settings.effectiveConfig('a').config.mode).toBe('DOUBLE');
    expect(settings.effectiveConfig('b').config.mode).toBe('WEBTOON');
  });

  it('loadBookConfig 从未写入时返回 null（Kotlin L246）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    expect(settings.loadBookConfig('never-written')).toBeNull();
  });

  it('覆盖值损坏时回落 null（而非全局）（Kotlin L247 runCatching.getOrNull）', () => {
    const kv = createMemoryComicStore();
    const settings = new ComicSettingsStore(kv);
    kv.putString(bookConfigKey('bk'), '{not json');
    expect(settings.loadBookConfig('bk')).toBeNull();
  });
});

describe('book state 读写（Kotlin L257-264）', () => {
  it('缺键时返回默认空状态（L260 `?: ComicBookState()`）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    const state = settings.loadBookState('nobody');
    expect(state.lastPage).toBe(0);
    expect(state.lastChapterSig).toBeNull();
    expect(state.pageRotations).toEqual({});
    expect([...state.mergeAnchors]).toEqual([]);
  });

  it('saveBookState → loadBookState 全字段往返（含 lastChapterSig / 旋转 / 合页）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    const state = {
      lastPage: 7,
      lastChapterSig: 'p1',
      pageRotations: { p1: 90, p2: 180 },
      mergeAnchors: new Set([0, 3]),
    };
    settings.saveBookState('bk', state);
    const back = settings.loadBookState('bk');
    expect(back.lastPage).toBe(7);
    expect(back.lastChapterSig).toBe('p1');
    expect(back.pageRotations).toEqual({ p1: 90, p2: 180 });
    expect([...back.mergeAnchors].sort((a, b) => a - b)).toEqual([0, 3]);
  });

  it('lastChapterSig 为 null 时该键不写进 JSON（Kotlin L327 的 ?.let）', () => {
    const kv = recordingStore();
    const settings = new ComicSettingsStore(kv);
    settings.saveBookState('bk', {
      lastPage: 1,
      lastChapterSig: null,
      pageRotations: {},
      mergeAnchors: new Set<number>(),
    });
    const raw = kv.getString(bookStateKey('bk'));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).not.toHaveProperty('lastChapterSig');
  });

  it('存档损坏时回落默认空状态（Kotlin L259 runCatching.getOrNull）', () => {
    const kv = createMemoryComicStore();
    kv.putString(bookStateKey('bk'), 'not-json{');
    expect(new ComicSettingsStore(kv).loadBookState('bk').lastPage).toBe(0);
  });
});

describe('预设系统 · setDefaultPreset 的副作用（Kotlin L208-216）', () => {
  it('设默认会先删全局配置再把预设配置写成全局（清掉手动改过的值）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    settings.saveGlobalConfig(createComicReaderConfig({ mode: 'MAGNETIC' }));
    settings.setDefaultPreset(PRESET_WEBTOON);
    expect(settings.defaultPresetId()).toBe(PRESET_WEBTOON);
    // 条漫内置预设的字段（Kotlin L44-53）
    const global = settings.loadGlobalConfig();
    expect(global.mode).toBe('WEBTOON');
    expect(global.direction).toBe('TTB');
    expect(global.pageAnim).toBe('NONE');
    expect(global.pageSpacingDp).toBe(0);
    expect(global.bgType).toBe('BLACK');
  });

  it('设默认为未知 id 是 no-op（L209 `?: return`）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    settings.setDefaultPreset('nope');
    expect(settings.defaultPresetId()).toBe(PRESET_MANGA);
  });

  it('删除当前默认预设会回落到 PRESET_MANGA（L199-201）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore(), {
      randomUuid: () => 'a1b2c3d4e5f6-7890-abcd-ef1234567890',
    });
    const created = settings.createPreset('我的', '我', DEFAULT_COMIC_READER_CONFIG);
    settings.setDefaultPreset(created.id);
    expect(settings.defaultPresetId()).toBe(created.id);
    settings.deletePreset(created.id);
    expect(settings.defaultPresetId()).toBe(PRESET_MANGA);
  });

  it('内置预设不可删除（L195 `if (id in BUILTIN_IDS) return false`）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    for (const id of BUILTIN_IDS) expect(settings.deletePreset(id)).toBe(false);
    // 内置条目仍在
    expect(settings.loadPresets()).toHaveLength(3);
  });

  it('内置预设不可改写（L170 `if (old.builtIn) return null`）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    for (const id of BUILTIN_IDS) {
      expect(settings.updatePreset(id, '改名')).toBeNull();
    }
    expect(settings.loadPresets().map((p) => p.name)).toEqual(['日漫', '条漫', '老漫画']);
  });

  it('默认预设 id 缺键时回落 PRESET_MANGA（L205）', () => {
    expect(new ComicSettingsStore(createMemoryComicStore()).defaultPresetId()).toBe(PRESET_MANGA);
  });

  it('切换默认预设会保留用户自建预设与收藏（Kotlin L236-240 的迁移语义）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore(), {
      randomUuid: () => '0f0f0f0f-1111-2222-3333-444444444444',
    });
    const created = settings.createPreset('夜间', '夜', DEFAULT_COMIC_READER_CONFIG);
    settings.togglePresetFavorite(created.id);
    settings.setDefaultPreset(PRESET_CLASSIC);
    settings.loadPresets(); // 触发 ensureBuiltinPresets 的迁移路径
    const mine = settings.loadPresets().find((p) => p.id === created.id);
    expect(mine).toBeDefined();
    expect(mine?.favorite).toBe(true);
    expect(mine?.name).toBe('夜间');
  });
});

describe('loadGlobalConfig 三级回落（Kotlin L77-79 `saved ?: preset?.config ?: ComicReaderConfig()`）', () => {
  it('什么都没有时用默认预设（日漫）的配置，不是全默认', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    const global = settings.loadGlobalConfig();
    // 日漫预设：SINGLE / RTL / FIT_WIDTH / CURL / PAPER（Kotlin L36-42）
    expect(global.mode).toBe('SINGLE');
    expect(global.direction).toBe('RTL');
    expect(global.fit).toBe('FIT_WIDTH');
    expect(global.pageAnim).toBe('CURL');
    expect(global.bgType).toBe('PAPER');
  });

  it('存量全局配置优先于默认预设（L77-79）', () => {
    const settings = new ComicSettingsStore(createMemoryComicStore());
    settings.saveGlobalConfig(createComicReaderConfig({ mode: 'DOUBLE', pageAnim: 'FADE' }));
    const global = settings.loadGlobalConfig();
    expect(global.mode).toBe('DOUBLE');
    expect(global.pageAnim).toBe('FADE');
  });

  it('全局配置损坏时回落到预设配置（runCatching.getOrNull → saved=null）', () => {
    const kv = createMemoryComicStore();
    const settings = new ComicSettingsStore(kv);
    settings.loadGlobalConfig(); // 先播种
    kv.putString(KEY_GLOBAL_CONFIG, '{broken');
    const global = settings.loadGlobalConfig();
    expect(global.pageAnim).toBe('CURL'); // 日漫预设的值
  });

  it('默认预设 id 指向被删的条目时回落到全默认（preset == null 分支）', () => {
    const kv = createMemoryComicStore();
    const settings = new ComicSettingsStore(kv);
    settings.loadGlobalConfig();
    kv.putString(KEY_DEFAULT_PRESET, 'preset_deleted_somehow');
    expect(settings.loadGlobalConfig()).toEqual(DEFAULT_COMIC_READER_CONFIG);
  });
});

describe('全局配置序列化往返（Kotlin L83 toJson().toString() / L78 fromJson）', () => {
  it('逐字段 round-trip（含枚举、manualCrop、翻译三字段）', () => {
    const kv = createMemoryComicStore();
    const settings = new ComicSettingsStore(kv);
    const config: ComicReaderConfig = createComicReaderConfig({
      mode: 'CONTINUOUS',
      direction: 'TTB',
      fit: 'CUSTOM',
      customFitBase: 'STRETCH',
      customFitScale: 1.75,
      pageSpacingDp: 3,
      doubleGapDp: 5,
      doubleFirstAlone: true,
      doubleAlign: 'BOTTOM',
      doubleShiftXDp: -7,
      doubleShiftYDp: 9,
      bookRotation: 270,
      cropMode: 'BLACK',
      manualCrop: [0.1, 0.2, 0.9, 0.8],
      splitWide: true,
      splitReverse: true,
      splitPosition: 0.42,
      enhanceMode: 'WAIFU2X',
      enhanceStrength: 70,
      filterBrightness: -20,
      filterContrast: 15,
      filterSaturation: 33,
      filterHue: -90,
      filterGamma: 0.8,
      filterSharpen: 12,
      filterShadow: -7,
      filterBW: true,
      bgType: 'PAPER',
      paperIntensity: 60,
      scene: 'CAMPFIRE',
      sceneSound: false,
      sceneEffect: false,
      sceneVolume: 11,
      pageAnim: 'CURL',
      autoPageIntervalSec: 15,
      autoScrollSpeedDp: 120,
      gestureTapLeft: 'TOC',
      gestureTapRight: 'EXIT',
      gestureTapCenter: 'NONE',
      gestureSwipe: false,
      gesturePinchClose: false,
      gestureEdgeSwipe: false,
      gestureLongPressPanel: true,
      volumeKeyTurn: false,
      showThumbPreview: false,
      hideSystemBars: false,
      translationEnabled: true,
      translationLang: 'ja',
      translationTextScale: 1.3,
      translationEngine: 'ai',
    });
    settings.saveGlobalConfig(config);
    expect(settings.loadGlobalConfig()).toEqual(config);
  });

  it('manualCrop = null 时该键不出现在存档里（L124 `?.let`）', () => {
    const kv = createMemoryComicStore();
    const settings = new ComicSettingsStore(kv);
    settings.saveGlobalConfig(createComicReaderConfig({ manualCrop: null }));
    const raw = kv.getString(KEY_GLOBAL_CONFIG);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? '')).not.toHaveProperty('manualCrop');
  });
});