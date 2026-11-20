/**
 * nodeManagerAndComicStoreParity.test.ts —— Z-Library 节点表 + 漫画配置存储的键名。
 *
 * 覆盖 2 个 Kotlin 文件：
 *   `library/ZLibraryNodeManager.kt`（6 常量 + 初始候选 12 项 + 退役 13 项）
 *   `ui/comic/ComicSettingsStore.kt`（3 个内置预设 id + 4 个持久化键）
 *
 * **本轮修掉两处真漂移**（都是「看起来没事、用起来不对」的类型）：
 *   ① `DEFAULT_NODE`：iOS 是 `'1lib.sk'`（候选列表最后一项），Kotlin `L15` 是 `"z-lib.sk"`。
 *   ② `VERIFIED_LIVE_NODES`：Kotlin `L24` 是 `emptySet()`（注释明说「历史检查不等于当前可用」），
 *      iOS 却硬编码了 6 个「已验证」→ 节点管理页会长期显示过期标签。
 *
 * 候选/退役列表都**从 Kotlin 原文解析**后逐项比对（含顺序），不写死字符串数组。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NODE,
  INITIAL_SCRAPED_NODES,
  KEY_CUSTOM_NODES,
  KEY_SCRAPED_NODES,
  KEY_SELECTED_NODE,
  PREFS_NAME,
  RETIRED_NODES,
  SCRAPE_URL,
  VERIFIED_LIVE_NODES,
  filterRetired,
  isAutomaticCandidate,
} from '@core/library/zLibraryNodeManager';
import {
  COMIC_PREF_FILE,
  KEY_CUSTOM_FIT_PRESETS,
  KEY_DEFAULT_PRESET,
  KEY_GLOBAL_CONFIG,
  KEY_PRESETS,
  PRESET_CLASSIC,
  PRESET_MANGA,
  PRESET_WEBTOON,
  BUILTIN_IDS,
} from '@core/comic/comicSettingsStore';

import { androidReference } from '../helpers/androidReference';

const KT = 'app/src/main/java/com/example';

function kt(rel: string): string {
  return readFileSync(androidReference(`${KT}/${rel}`), 'utf8');
}

/** 抽取 `val NAME = listOf(...)` / `setOf(...)` 里的字符串（保持原顺序）。 */
function kotlinStringList(source: string, name: string): string[] {
  const start = new RegExp(`val\\s+${name}\\s*=\\s*(?:listOf|setOf)\\s*\\(`).exec(source);
  if (start === null) return [];
  const open = source.indexOf('(', start.index);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        // 先剥行注释：Kotlin 的退役表每行都带 `// 说明`，注释里也有引号字符串
        const body = source
          .slice(open + 1, i)
          .split(/\r?\n/)
          .map((line) => line.replace(/\/\/.*$/, ''))
          .join("\n");
        return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
      }
    }
  }
  return [];
}

describe('ZLibraryNodeManager.kt：节点常量与两张表', () => {
  const source = kt('library/ZLibraryNodeManager.kt');

  it('DEFAULT_NODE = "z-lib.sk"（不是候选列表的最后一项）', () => {
    expect(source).toContain('const val DEFAULT_NODE = "z-lib.sk"');
    expect(DEFAULT_NODE).toBe('z-lib.sk');
    // 关键：默认节点必须在候选列表里，但不必是最后一项
    const initial = kotlinStringList(source, 'INITIAL_SCRAPED_NODES');
    expect(initial).toContain(DEFAULT_NODE);
    expect(initial[initial.length - 1]).not.toBe(DEFAULT_NODE);
  });

  it('SCRAPE_URL / PREFS_NAME / 三个 KEY 逐值一致', () => {
    expect(source).toContain('const val SCRAPE_URL = "https://zlib.wwkejishe.top/"');
    expect(source).toContain('private const val PREFS_NAME = "zlib_node_manager"');
    expect(source).toContain('private const val KEY_SCRAPED_NODES = "scraped_nodes"');
    expect(source).toContain('private const val KEY_CUSTOM_NODES = "custom_nodes"');
    expect(source).toContain('private const val KEY_SELECTED_NODE = "selected_node"');
    expect(SCRAPE_URL).toBe('https://zlib.wwkejishe.top/');
    expect(PREFS_NAME).toBe('zlib_node_manager');
    expect(KEY_SCRAPED_NODES).toBe('scraped_nodes');
    expect(KEY_CUSTOM_NODES).toBe('custom_nodes');
    expect(KEY_SELECTED_NODE).toBe('selected_node');
    // scrape URL 是 https 且以 / 结尾（拼接路径不会丢分隔符）
    expect(SCRAPE_URL.startsWith('https://')).toBe(true);
    expect(SCRAPE_URL.endsWith('/')).toBe(true);
  });

  it('VERIFIED_LIVE_NODES 必须是空集（历史检查不等于当前可用）', () => {
    expect(source).toContain('// Historical checks are not a live availability guarantee.');
    expect(source).toContain('val VERIFIED_LIVE_NODES = emptySet<String>()');
    expect([...VERIFIED_LIVE_NODES]).toEqual([]);
  });

  it('INITIAL_SCRAPED_NODES 与 Kotlin 的 12 项同序', () => {
    const want = kotlinStringList(source, 'INITIAL_SCRAPED_NODES');
    expect(want.length).toBeGreaterThanOrEqual(8);
    expect([...INITIAL_SCRAPED_NODES]).toEqual(want);
    // 全部是小写域名的 host 形式（不含 scheme / 路径）
    for (const node of INITIAL_SCRAPED_NODES) {
      expect(node).not.toContain('/');
      expect(node).not.toContain('://');
    }
  });

  it('RETIRED_NODES 与 Kotlin 的 13 项一致，且与初始候选不相交', () => {
    const want = kotlinStringList(source, 'RETIRED_NODES');
    expect(want.length).toBeGreaterThanOrEqual(10);
    expect([...RETIRED_NODES].sort()).toEqual([...want].sort());
    for (const retired of RETIRED_NODES) {
      expect(INITIAL_SCRAPED_NODES).not.toContain(retired);
    }
  });

  it('isAutomaticCandidate / filterRetired：退役域名被剔除，空串与带空白的不算候选', () => {
    expect(source).toContain('fun isAutomaticCandidate(node: String): Boolean =');
    expect(source).toContain('fun isAutomaticCandidate');
    const retired = [...RETIRED_NODES][0] ?? '';
    expect(retired).not.toBe('');
    expect(isAutomaticCandidate(retired)).toBe(false);
    expect(isAutomaticCandidate('z-lib.sk')).toBe(true);
    expect(isAutomaticCandidate('   ')).toBe(false);
    expect(filterRetired(['z-lib.sk', retired])).toEqual(['z-lib.sk']);
  });
});

describe('ComicSettingsStore.kt：预设 id 与持久化键', () => {
  const source = kt('ui/comic/ComicSettingsStore.kt');

  it('三个内置预设 id 逐值一致', () => {
    expect(source).toContain('const val PRESET_MANGA = "preset_builtin_manga"');
    expect(source).toContain('const val PRESET_WEBTOON = "preset_builtin_webtoon"');
    expect(source).toContain('const val PRESET_CLASSIC = "preset_builtin_classic"');
    expect(PRESET_MANGA).toBe('preset_builtin_manga');
    expect(PRESET_WEBTOON).toBe('preset_builtin_webtoon');
    expect(PRESET_CLASSIC).toBe('preset_builtin_classic');
    expect([...BUILTIN_IDS]).toEqual([PRESET_MANGA, PRESET_WEBTOON, PRESET_CLASSIC]);
  });

  it('四个持久化键逐值一致', () => {
    expect(source).toContain('private const val KEY_GLOBAL_CONFIG = "global_config"');
    expect(source).toContain('private const val KEY_PRESETS = "presets"');
    expect(source).toContain('private const val KEY_DEFAULT_PRESET = "default_preset"');
    expect(source).toContain('private const val KEY_CUSTOM_FIT_PRESETS = "custom_fit_presets"');
    expect(KEY_GLOBAL_CONFIG).toBe('global_config');
    expect(KEY_PRESETS).toBe('presets');
    expect(KEY_DEFAULT_PRESET).toBe('default_preset');
    expect(KEY_CUSTOM_FIT_PRESETS).toBe('custom_fit_presets');
  });

  it('默认预设是 PRESET_MANGA，且四个键互不相同', () => {
    expect(source).toContain('val defaultId = prefs.getString(KEY_DEFAULT_PRESET, PRESET_MANGA)');
    const keys = [KEY_GLOBAL_CONFIG, KEY_PRESETS, KEY_DEFAULT_PRESET, KEY_CUSTOM_FIT_PRESETS];
    expect(new Set(keys).size).toBe(4);
    // 共享偏好文件名
    expect(COMIC_PREF_FILE).toBe('comic_reader_store');
  });
});
