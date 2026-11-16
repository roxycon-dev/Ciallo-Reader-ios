/**
 * comicConfigStore.test.ts — `ComicSettingsStore.kt` 端口的单元测试。
 *
 * 覆盖：键名/键前缀（**load-bearing**）、内置预设默认值、`ensureBuiltinPresets`
 *       的升级迁移、预设 CRUD + 收藏置顶、自定义缩放预设、每本漫画覆盖与状态、
 *       `effectiveConfig` 优先级、损坏存档的兜底。
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/comic/ComicSettingsStore.kt
 * TS 源:    IOS/src/core/comic/comicSettingsStore.ts
 */

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_IDS,
  BOOK_CONFIG_PREFIX,
  BOOK_STATE_PREFIX,
  ComicSettingsStore,
  COMIC_PREF_FILE,
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
  comicCustomFitPresetFromJson,
  comicCustomFitPresetToJson,
  comicPrefsKey,
  comicPresetFromJson,
  comicPresetToJson,
  createMemoryComicStore,
  type ComicKeyValueStore,
  type ComicPreset,
} from '../../src/core/comic/comicSettingsStore';
import {
  DEFAULT_COMIC_READER_CONFIG,
  createComicReaderConfig,
} from '../../src/core/comic/comicReaderConfig';

/**
 * 确定性 UUID 源（Kotlin 的 `UUID.randomUUID()` 由 options.randomUuid 注入）。
 * 前缀每次不同，好让 `take(12)` / `take(10)` 之后的 id 也互不相同。
 */
function uuidSequence(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${String(n).padStart(8, '0')}abcd-4ccc-8ddd-eeeeffff0000`;
  };
}

function makeStore(initial?: Record<string, string>): {
  store: ComicKeyValueStore;
  settings: ComicSettingsStore;
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
} {
  const backing = createMemoryComicStore(initial);
  const read = (key: string): string | null => backing.getString(key);
  const write = (key: string, value: string): void => backing.putString(key, value);
  return {
    store: backing,
    settings: new ComicSettingsStore(backing, { randomUuid: uuidSequence() }),
    read,
    write,
  };
}

describe('comicConfigStore — keys (Kotlin L20 / L332-335 / L246 / L258)', () => {
  it('uses the SharedPreferences file name verbatim', () => {
    expect(COMIC_PREF_FILE).toBe('comic_reader_store');
  });

  it('namespaces platform keys the same way ComicReaderPage.tsx already does', () => {
    // 与既有 WebComicSettingsStore 的 localStorage 键逐字一致 → 存量数据无需迁移
    expect(comicPrefsKey(KEY_GLOBAL_CONFIG)).toBe('comic_reader_store:global_config');
    expect(comicPrefsKey(KEY_PRESETS)).toBe('comic_reader_store:presets');
    expect(comicPrefsKey(KEY_DEFAULT_PRESET)).toBe('comic_reader_store:default_preset');
    expect(comicPrefsKey(KEY_CUSTOM_FIT_PRESETS)).toBe('comic_reader_store:custom_fit_presets');
    expect(comicPrefsKey(bookConfigKey('42'))).toBe('comic_reader_store:book_cfg_42');
    expect(comicPrefsKey(bookStateKey('42'))).toBe('comic_reader_store:book_state_42');
  });

  it('keeps the raw SharedPreferences key names', () => {
    expect(KEY_GLOBAL_CONFIG).toBe('global_config');
    expect(KEY_PRESETS).toBe('presets');
    expect(KEY_DEFAULT_PRESET).toBe('default_preset');
    expect(KEY_CUSTOM_FIT_PRESETS).toBe('custom_fit_presets');
    expect(BOOK_CONFIG_PREFIX).toBe('book_cfg_');
    expect(BOOK_STATE_PREFIX).toBe('book_state_');
    expect(bookConfigKey('abc')).toBe('book_cfg_abc');
    expect(bookStateKey('abc')).toBe('book_state_abc');
  });

  it('uses the fixed built-in preset ids', () => {
    expect(PRESET_MANGA).toBe('preset_builtin_manga');
    expect(PRESET_WEBTOON).toBe('preset_builtin_webtoon');
    expect(PRESET_CLASSIC).toBe('preset_builtin_classic');
    expect([...BUILTIN_IDS].sort()).toEqual([PRESET_MANGA, PRESET_WEBTOON, PRESET_CLASSIC].sort());
  });
});

describe('comicConfigStore — builtins (Kotlin L33-67)', () => {
  it('ships three built-ins in declaration order, all builtIn=true, none favorited', () => {
    const list = builtins();
    expect(list).toHaveLength(3);
    expect(list.map((p) => p.id)).toEqual([PRESET_MANGA, PRESET_WEBTOON, PRESET_CLASSIC]);
    expect(list.map((p) => p.name)).toEqual(['日漫', '条漫', '老漫画']);
    expect(list.map((p) => p.emoji)).toEqual(['JP', 'WL', 'RZ']);
    expect(list.every((p) => p.builtIn)).toBe(true);
    expect(list.every((p) => !p.favorite)).toBe(true);
  });

  it('日漫 = SINGLE / RTL / FIT_WIDTH / CURL / PAPER', () => {
    const manga = builtins()[0]!;
    expect(manga.config.mode).toBe('SINGLE');
    expect(manga.config.direction).toBe('RTL');
    expect(manga.config.fit).toBe('FIT_WIDTH');
    expect(manga.config.pageAnim).toBe('CURL');
    expect(manga.config.bgType).toBe('PAPER');
    // 未覆写的字段保持构造默认值
    expect(manga.config.pageSpacingDp).toBe(8);
    expect(manga.config.enhanceStrength).toBe(60);
  });

  it('条漫 = WEBTOON / TTB / NONE / pageSpacingDp=0 / BLACK', () => {
    const webtoon = builtins()[1]!;
    expect(webtoon.config.mode).toBe('WEBTOON');
    expect(webtoon.config.direction).toBe('TTB');
    expect(webtoon.config.pageAnim).toBe('NONE');
    expect(webtoon.config.pageSpacingDp).toBe(0);
    expect(webtoon.config.bgType).toBe('BLACK');
  });

  it('老漫画 = SINGLE / LTR / FIT_WIDTH / AUTO / CAS / gamma 0.9 / sharpen 30 / GRAY', () => {
    const classic = builtins()[2]!;
    expect(classic.config.mode).toBe('SINGLE');
    expect(classic.config.direction).toBe('LTR');
    expect(classic.config.fit).toBe('FIT_WIDTH');
    expect(classic.config.cropMode).toBe('AUTO');
    expect(classic.config.enhanceMode).toBe('CAS');
    expect(classic.config.filterGamma).toBe(0.9);
    expect(classic.config.filterSharpen).toBe(30);
    expect(classic.config.bgType).toBe('GRAY');
  });
});

describe('comicConfigStore — loadGlobalConfig (Kotlin L72-80)', () => {
  it('falls back to the default preset config when nothing is stored', () => {
    const { settings } = makeStore();
    // 默认预设 = PRESET_MANGA → pageAnim CURL / bgType PAPER
    expect(settings.loadGlobalConfig().pageAnim).toBe('CURL');
    expect(settings.loadGlobalConfig().bgType).toBe('PAPER');
  });

  it('seeds the presets key on first load (ensureBuiltinPresets)', () => {
    const { settings, read } = makeStore();
    settings.loadGlobalConfig();
    expect(read(KEY_PRESETS)).not.toBeNull();
    expect(JSON.parse(read(KEY_PRESETS) ?? '[]')).toHaveLength(3);
  });

  it('prefers a stored global config over the preset', () => {
    const { settings, read } = makeStore();
    settings.saveGlobalConfig(createComicReaderConfig({ pageAnim: 'FADE' }));
    expect(read(KEY_GLOBAL_CONFIG)).not.toBeNull();
    expect(settings.loadGlobalConfig().pageAnim).toBe('FADE');
    // 预设配置是 CURL —— 说明确实读的是存档而不是预设
    expect(settings.loadGlobalConfig().pageAnim).not.toBe('CURL');
  });

  it('falls back to the preset when the stored global config is corrupt', () => {
    const { settings, write } = makeStore();
    write(KEY_GLOBAL_CONFIG, '{not json');
    expect(settings.loadGlobalConfig().pageAnim).toBe('CURL');
  });

  it('round-trips every field through saveGlobalConfig/loadGlobalConfig', () => {
    const { settings } = makeStore();
    const config = createComicReaderConfig({
      mode: 'CONTINUOUS',
      direction: 'TTB',
      filterHue: -33,
      manualCrop: [0.1, 0.2, 0.3, 0.4],
      translationLang: 'ko',
    });
    settings.saveGlobalConfig(config);
    expect(settings.loadGlobalConfig()).toEqual(config);
  });
});

describe('comicConfigStore — loadPresets / ensureBuiltinPresets migration (Kotlin L88-97, L218-241)', () => {
  it('writes built-ins when the key is absent', () => {
    const { settings, read } = makeStore();
    expect(settings.loadPresets().map((p) => p.id)).toEqual([
      PRESET_MANGA,
      PRESET_WEBTOON,
      PRESET_CLASSIC,
    ]);
    expect(JSON.parse(read(KEY_PRESETS) ?? '[]')).toHaveLength(3);
  });

  it('restores built-ins when the stored JSON is not an array', () => {
    const { settings } = makeStore({ [KEY_PRESETS]: '{"not":"an array"}' });
    expect(settings.loadPresets()).toHaveLength(3);
  });

  it('rewrites the key when the decode result is empty', () => {
    const { settings, read } = makeStore({ [KEY_PRESETS]: '[]' });
    expect(settings.loadPresets()).toHaveLength(3);
    expect(JSON.parse(read(KEY_PRESETS) ?? '[]')).toHaveLength(3);
  });

  it('skips undecodable entries but keeps the good ones', () => {
    const { settings } = makeStore({
      [KEY_PRESETS]: JSON.stringify([
        { id: 'user-1', name: '我的', emoji: 'X', config: {} },
        'not an object',
        null,
        42,
        { id: 'user-2', name: '另一个', emoji: 'Y', config: {} },
      ]),
    });
    const ids = settings.loadPresets().map((p) => p.id);
    expect(ids).toContain('user-1');
    expect(ids).toContain('user-2');
    expect(ids).not.toContain('');
  });

  it('replaces a stale built-in with the CURRENT definition, keeping favorite', () => {
    const stale = JSON.stringify([
      {
        id: PRESET_MANGA,
        name: '旧日漫',
        emoji: 'OLD',
        builtIn: true,
        favorite: true,
        config: { pageAnim: 'NONE', mode: 'DOUBLE' },
      },
      {
        id: 'user-keep',
        name: '用户预设',
        emoji: 'U',
        builtIn: false,
        favorite: false,
        config: { pageAnim: 'CURL' },
      },
    ]);
    const { settings, read } = makeStore({ [KEY_PRESETS]: stale });
    const list = settings.loadPresets();
    const manga = list.find((p) => p.id === PRESET_MANGA)!;
    // 内置定义被当前版本覆盖
    expect(manga.name).toBe('日漫');
    expect(manga.emoji).toBe('JP');
    expect(manga.config.pageAnim).toBe('CURL');
    expect(manga.config.mode).toBe('SINGLE');
    // 收藏标记保留
    expect(manga.favorite).toBe(true);
    // 用户预设原样保留
    expect(list.find((p) => p.id === 'user-keep')?.name).toBe('用户预设');
    // 落盘已更新为当前内置定义
    const persisted = JSON.parse(read(KEY_PRESETS) ?? '[]') as Array<ComicPreset & { name: string }>;
    const persistedManga = persisted.find((p) => p.id === PRESET_MANGA)!;
    expect(persistedManga.name).toBe('日漫');
    expect(persistedManga.favorite).toBe(true);
  });

  it('prepends a missing built-in (Kotlin `missing + migrated`)', () => {
    const only = JSON.stringify([
      { id: 'user-only', name: '只有我', emoji: 'U', builtIn: false, favorite: false, config: {} },
    ]);
    const { settings } = makeStore({ [KEY_PRESETS]: only });
    const ids = settings.loadPresets().map((p) => p.id);
    expect(ids).toEqual([PRESET_MANGA, PRESET_WEBTOON, PRESET_CLASSIC, 'user-only']);
  });

  it('does not duplicate a built-in that is already present', () => {
    const full = JSON.stringify(builtins().map((p) => comicPresetToJson(p)));
    const { settings } = makeStore({ [KEY_PRESETS]: full });
    expect(settings.loadPresets()).toHaveLength(3);
  });

  it('preserves the default selection across a migration', () => {
    const { settings } = makeStore({
      [KEY_PRESETS]: JSON.stringify([{ id: 'user-x', name: 'X', emoji: 'U', config: {} }]),
      [KEY_DEFAULT_PRESET]: 'user-x',
    });
    settings.loadPresets();
    expect(settings.defaultPresetId()).toBe('user-x');
  });
});

describe('comicConfigStore — preset CRUD (Kotlin L105-216)', () => {
  it('createPreset builds a `preset_<12>` id and appends', () => {
    const { settings } = makeStore();
    settings.loadPresets();
    const created = settings.createPreset('我的模式', 'M', createComicReaderConfig({ mode: 'DOUBLE' }));
    // randomUuid() = '00000001abcd-…' → take(12) = '00000001abcd'
    expect(created.id).toBe('preset_00000001abcd');
    expect(created.builtIn).toBe(false);
    expect(created.favorite).toBe(false);
    expect(settings.loadPresets().map((p) => p.id)).toContain(created.id);
    expect(settings.loadPresets()).toHaveLength(4);
  });

  it('duplicatePreset copies config/emoji, appends " 副本", keeps a fresh id', () => {
    const { settings } = makeStore();
    const copy = settings.duplicatePreset(PRESET_MANGA)!;
    expect(copy).not.toBeNull();
    expect(copy.id.startsWith('preset_')).toBe(true);
    expect(copy.id).not.toBe(PRESET_MANGA);
    expect(copy.name).toBe('日漫 副本');
    expect(copy.emoji).toBe('JP');
    expect(copy.builtIn).toBe(false);
    expect(copy.favorite).toBe(false);
    expect(copy.config).toEqual(builtins()[0]!.config);
  });

  it('duplicatePreset returns null for an unknown id', () => {
    const { settings } = makeStore();
    expect(settings.duplicatePreset('nope')).toBeNull();
  });

  it('updatePreset edits a user preset', () => {
    const { settings } = makeStore();
    const created = settings.createPreset('A', 'a', DEFAULT_COMIC_READER_CONFIG);
    const updated = settings.updatePreset(created.id, 'B')!;
    expect(updated.name).toBe('B');
    expect(updated.config).toEqual(DEFAULT_COMIC_READER_CONFIG);
    // null 保留旧值
    const renamed = settings.updatePreset(created.id, null, createComicReaderConfig({ mode: 'DOUBLE' }))!;
    expect(renamed.name).toBe('B');
    expect(renamed.config.mode).toBe('DOUBLE');
  });

  it('updatePreset refuses built-ins and unknown ids', () => {
    const { settings } = makeStore();
    expect(settings.updatePreset(PRESET_MANGA, 'X')).toBeNull();
    expect(settings.updatePreset('nope', 'X')).toBeNull();
  });

  it('updatePreset keeps the favorite flag', () => {
    const { settings } = makeStore();
    const created = settings.createPreset('A', 'a', DEFAULT_COMIC_READER_CONFIG);
    settings.togglePresetFavorite(created.id);
    expect(settings.updatePreset(created.id, 'B')!.favorite).toBe(true);
  });

  it('deletePreset refuses built-ins', () => {
    const { settings } = makeStore();
    expect(settings.deletePreset(PRESET_MANGA)).toBe(false);
    expect(settings.deletePreset(PRESET_WEBTOON)).toBe(false);
    expect(settings.deletePreset(PRESET_CLASSIC)).toBe(false);
    expect(settings.loadPresets()).toHaveLength(3);
  });

  it('deletePreset removes a user preset and returns false for unknown ids', () => {
    const { settings } = makeStore();
    const created = settings.createPreset('A', 'a', DEFAULT_COMIC_READER_CONFIG);
    expect(settings.deletePreset(created.id)).toBe(true);
    expect(settings.loadPresets().map((p) => p.id)).not.toContain(created.id);
    expect(settings.deletePreset('nope')).toBe(false);
  });

  it('deleting the default preset re-points it at PRESET_MANGA', () => {
    const { settings } = makeStore();
    const created = settings.createPreset('默认用的', 'D', createComicReaderConfig({ mode: 'DOUBLE' }));
    settings.setDefaultPreset(created.id);
    expect(settings.defaultPresetId()).toBe(created.id);
    expect(settings.deletePreset(created.id)).toBe(true);
    expect(settings.defaultPresetId()).toBe(PRESET_MANGA);
  });

  it('defaultPresetId defaults to PRESET_MANGA', () => {
    const { settings } = makeStore();
    expect(settings.defaultPresetId()).toBe(PRESET_MANGA);
  });

  it('setDefaultPreset clears the stored global config and saves the preset config', () => {
    const { settings, read } = makeStore();
    settings.saveGlobalConfig(createComicReaderConfig({ pageAnim: 'FADE' }));
    expect(read(KEY_GLOBAL_CONFIG)).not.toBeNull();
    settings.setDefaultPreset(PRESET_WEBTOON);
    expect(settings.defaultPresetId()).toBe(PRESET_WEBTOON);
    // 全局配置被重写为条漫预设（而不是被删掉后回落到默认）
    expect(settings.loadGlobalConfig().mode).toBe('WEBTOON');
  });

  it('setDefaultPreset ignores an unknown id', () => {
    const { settings } = makeStore();
    settings.setDefaultPreset('nope');
    expect(settings.defaultPresetId()).toBe(PRESET_MANGA);
  });
});

describe('comicConfigStore — favorite pinning (Kotlin L115-127)', () => {
  it('togglePresetFavorite flips the flag and returns the updated preset', () => {
    const { settings } = makeStore();
    const created = settings.createPreset('A', 'a', DEFAULT_COMIC_READER_CONFIG);
    const on = settings.togglePresetFavorite(created.id)!;
    expect(on.favorite).toBe(true);
    const off = settings.togglePresetFavorite(created.id)!;
    expect(off.favorite).toBe(false);
  });

  it('togglePresetFavorite returns null for an unknown id', () => {
    const { settings } = makeStore();
    expect(settings.togglePresetFavorite('nope')).toBeNull();
  });

  it('pins favorites to the top while preserving relative order (stable)', () => {
    const { settings } = makeStore();
    const a = settings.createPreset('A', 'a', DEFAULT_COMIC_READER_CONFIG);
    const b = settings.createPreset('B', 'b', DEFAULT_COMIC_READER_CONFIG);
    // 原始顺序：[MANGA, WEBTOON, CLASSIC, a, b]
    // 先收藏 a → [a, MANGA, WEBTOON, CLASSIC, b]
    settings.togglePresetFavorite(a.id);
    // 再收藏 b → 稳定排序保持 a、b 之间的原相对顺序
    settings.togglePresetFavorite(b.id);
    const ids = settings.loadPresets().map((p) => p.id);
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
    expect(ids.slice(0, 2)).toEqual([a.id, b.id]);
    // 内置预设相对顺序不变
    expect(ids.slice(2)).toEqual([PRESET_MANGA, PRESET_WEBTOON, PRESET_CLASSIC]);
  });

  it('favoritePresets filters', () => {
    const { settings } = makeStore();
    const created = settings.createPreset('A', 'a', DEFAULT_COMIC_READER_CONFIG);
    settings.togglePresetFavorite(created.id);
    expect(settings.favoritePresets().map((p) => p.id)).toEqual([created.id]);
  });

  it('keeps user favorites across a built-in migration', () => {
    const { settings } = makeStore();
    const created = settings.createPreset('A', 'a', DEFAULT_COMIC_READER_CONFIG);
    settings.togglePresetFavorite(created.id);
    // 触发一次迁移
    settings.loadPresets();
    expect(settings.loadPresets().find((p) => p.id === created.id)?.favorite).toBe(true);
  });
});

describe('comicConfigStore — custom fit presets (Kotlin L129-162)', () => {
  it('starts empty and round-trips', () => {
    const { settings } = makeStore();
    expect(settings.loadCustomFitPresets()).toEqual([]);
    const saved = settings.saveCustomFitPreset('我的缩放', 'FIT_WIDTH', 150);
    expect(settings.loadCustomFitPresets()).toEqual([saved]);
    expect(saved.base).toBe('FIT_WIDTH');
    expect(saved.scalePct).toBe(150);
  });

  it('builds a `cfit_<10>` id', () => {
    const { settings } = makeStore();
    // randomUuid() = '00000001abcd-…' → take(10) = '00000001ab'
    expect(settings.saveCustomFitPreset('X', 'FIT_PAGE', 100).id).toBe('cfit_00000001ab');
  });

  it('names a blank preset "缩放 %d%%"', () => {
    const { settings } = makeStore();
    expect(settings.saveCustomFitPreset('', 'FIT_PAGE', 175).name).toBe('缩放 175%');
    expect(settings.saveCustomFitPreset('   ', 'FIT_PAGE', 200).name).toBe('缩放 200%');
    expect(settings.saveCustomFitPreset(' 保留 ', 'FIT_PAGE', 100).name).toBe(' 保留 ');
  });

  it('clamps scalePct into [50, 250]', () => {
    const { settings } = makeStore();
    expect(settings.saveCustomFitPreset('a', 'FIT_PAGE', 10).scalePct).toBe(50);
    expect(settings.saveCustomFitPreset('b', 'FIT_PAGE', 900).scalePct).toBe(250);
    expect(settings.saveCustomFitPreset('c', 'FIT_PAGE', 120).scalePct).toBe(120);
  });

  it('deleteCustomFitPreset removes and reports', () => {
    const { settings } = makeStore();
    const saved = settings.saveCustomFitPreset('X', 'FIT_PAGE', 100);
    expect(settings.deleteCustomFitPreset('nope')).toBe(false);
    expect(settings.deleteCustomFitPreset(saved.id)).toBe(true);
    expect(settings.loadCustomFitPresets()).toEqual([]);
  });

  it('falls back to an empty list on a corrupt key', () => {
    const { settings } = makeStore({ [KEY_CUSTOM_FIT_PRESETS]: 'not json' });
    expect(settings.loadCustomFitPresets()).toEqual([]);
  });

  it('ComicCustomFitPreset.fromJson defaults name/base/scalePct', () => {
    expect(comicCustomFitPresetFromJson({})).toEqual({
      id: '',
      name: '自定义',
      base: 'FIT_PAGE',
      scalePct: 100,
    });
    expect(comicCustomFitPresetFromJson({ base: 'NOPE', scalePct: 999 })).toEqual({
      id: '',
      name: '自定义',
      base: 'FIT_PAGE',
      scalePct: 250,
    });
    expect(comicCustomFitPresetFromJson({ base: 'STRETCH', scalePct: 1 }).base).toBe('STRETCH');
  });

  it('ComicCustomFitPreset.toJson uses base by NAME', () => {
    expect(comicCustomFitPresetToJson({ id: 'x', name: 'n', base: 'FIT_WIDTH', scalePct: 120 })).toEqual(
      { id: 'x', name: 'n', base: 'FIT_WIDTH', scalePct: 120 },
    );
  });
});

describe('comicConfigStore — per-book config & state (Kotlin L245-264)', () => {
  it('loadBookConfig returns null when absent', () => {
    const { settings } = makeStore();
    expect(settings.loadBookConfig('42')).toBeNull();
  });

  it('round-trips a per-book override', () => {
    const { settings } = makeStore();
    const config = createComicReaderConfig({ mode: 'DOUBLE', doubleFirstAlone: true });
    settings.saveBookConfig('42', config);
    expect(settings.loadBookConfig('42')).toEqual(config);
  });

  it('clearBookConfig removes it', () => {
    const { settings } = makeStore();
    settings.saveBookConfig('42', DEFAULT_COMIC_READER_CONFIG);
    settings.clearBookConfig('42');
    expect(settings.loadBookConfig('42')).toBeNull();
  });

  it('loadBookConfig returns null on a corrupt value', () => {
    const { settings, write } = makeStore();
    write(bookConfigKey('42'), '{{{');
    expect(settings.loadBookConfig('42')).toBeNull();
  });

  it('loadBookState defaults to the empty state', () => {
    const { settings } = makeStore();
    expect(settings.loadBookState('42')).toEqual({
      lastPage: 0,
      lastChapterSig: null,
      pageRotations: {},
      mergeAnchors: new Set<number>(),
    });
  });

  it('round-trips book state including rotations and merge anchors', () => {
    const { settings } = makeStore();
    const state = {
      lastPage: 17,
      lastChapterSig: 'ch-3',
      pageRotations: { a: 90, b: 270 },
      mergeAnchors: new Set([2, 4]),
    };
    settings.saveBookState('42', state);
    expect(settings.loadBookState('42')).toEqual(state);
  });

  it('loadBookState falls back to the empty state on a corrupt value', () => {
    const { settings, write } = makeStore();
    write(bookStateKey('42'), 'not json');
    expect(settings.loadBookState('42').lastPage).toBe(0);
  });

  it('keys books independently', () => {
    const { settings } = makeStore();
    settings.saveBookConfig('a', createComicReaderConfig({ mode: 'DOUBLE' }));
    settings.saveBookConfig('b', createComicReaderConfig({ mode: 'WEBTOON' }));
    expect(settings.loadBookConfig('a')?.mode).toBe('DOUBLE');
    expect(settings.loadBookConfig('b')?.mode).toBe('WEBTOON');
    expect(settings.loadBookConfig('c')).toBeNull();
  });
});

describe('comicConfigStore — effectiveConfig (Kotlin L266-274)', () => {
  it('returns the global config with hasOverride=false for a null bookKey', () => {
    const { settings } = makeStore();
    settings.saveGlobalConfig(createComicReaderConfig({ pageAnim: 'FADE' }));
    const effective = settings.effectiveConfig(null);
    expect(effective.hasOverride).toBe(false);
    expect(effective.config.pageAnim).toBe('FADE');
  });

  it('returns the global config when the book has no override', () => {
    const { settings } = makeStore();
    settings.saveGlobalConfig(createComicReaderConfig({ pageAnim: 'FADE' }));
    const effective = settings.effectiveConfig('unknown');
    expect(effective.hasOverride).toBe(false);
    expect(effective.config.pageAnim).toBe('FADE');
  });

  it('prefers the per-book override and flags hasOverride=true', () => {
    const { settings } = makeStore();
    settings.saveGlobalConfig(createComicReaderConfig({ pageAnim: 'FADE' }));
    settings.saveBookConfig('42', createComicReaderConfig({ pageAnim: 'CURL' }));
    const effective = settings.effectiveConfig('42');
    expect(effective.hasOverride).toBe(true);
    expect(effective.config.pageAnim).toBe('CURL');
  });
});

describe('comicConfigStore — ComicPreset JSON (Kotlin L287-305)', () => {
  it('serialises id/name/emoji/builtIn/favorite/config', () => {
    const preset: ComicPreset = {
      id: 'p1',
      name: 'N',
      emoji: 'E',
      config: createComicReaderConfig({ mode: 'DOUBLE' }),
      builtIn: false,
      favorite: true,
    };
    expect(comicPresetToJson(preset)).toEqual({
      id: 'p1',
      name: 'N',
      emoji: 'E',
      builtIn: false,
      favorite: true,
      config: expect.objectContaining({ mode: 'DOUBLE' }),
    });
  });

  it('deserialises with Kotlin defaults for missing fields', () => {
    expect(comicPresetFromJson({})).toEqual({
      id: '',
      name: '预设',
      emoji: 'SC',
      config: DEFAULT_COMIC_READER_CONFIG,
      builtIn: false,
      favorite: false,
    });
  });

  it('substitutes a default config when the nested object is missing or the wrong type', () => {
    expect(comicPresetFromJson({ config: null }).config).toEqual(DEFAULT_COMIC_READER_CONFIG);
    expect(comicPresetFromJson({ config: [1, 2] }).config).toEqual(DEFAULT_COMIC_READER_CONFIG);
  });

  it('only accepts real booleans for builtIn/favorite', () => {
    expect(comicPresetFromJson({ builtIn: 'true' }).builtIn).toBe(false);
    expect(comicPresetFromJson({ favorite: 1 }).favorite).toBe(false);
    expect(comicPresetFromJson({ favorite: true }).favorite).toBe(true);
  });
});
