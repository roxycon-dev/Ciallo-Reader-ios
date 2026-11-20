/**
 * discoverSettingsParity.test.ts —— `discover/DiscoverSettings.kt`（75 行）+ `data/ImportSafety.kt`（74 行）。
 *
 * 两处都是「实现早就有、但没有一条读 Kotlin 原文的测试」：
 *   · `ImportSafety.kt` 的三个成员在 `src/core/data/importSafety.ts` 里逐行对齐；
 *   · `DiscoverSettings.kt` 则相反 —— 端口此前是个通用容器（收 `rows` + `onToggle`），
 *     在 production 里**零调用**，布局/缓存时长/清除缓存/屏蔽管理全无入口（E187）。
 *     本轮按 Kotlin 的自包含结构重写，并把可判定部分抽到 `@core/discover/settingsModel`。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  ArchiveBudget,
  MAX_CHAPTER_LENGTH,
  bytesInputStream,
  readImportBytes,
  splitChapterText,
} from '@core/data/importSafety';
import {
  BLOCKED_DIALOG_MAX_HEIGHT_DP,
  BLOCKED_EMPTY_LABEL,
  BLOCKED_SECTION_LABEL,
  CACHE_HOUR_OPTIONS,
  CACHE_SETTING,
  CLEAR_CACHE_LABEL,
  DISCOVER_CACHE_HOURS_DEFAULT,
  DISCOVER_LAYOUT_DEFAULT,
  DISCOVER_LAYOUT_OPTIONS,
  DISCOVER_LAYOUT_SECTION_TITLE,
  DISCOVER_SETTINGS_CARD_GAP_DP,
  DISCOVER_SETTINGS_DEFAULT_PARTITION,
  DISCOVER_SETTINGS_MAX_HEIGHT_DP,
  DISCOVER_SETTINGS_PADDING_DP,
  DISCOVER_SETTINGS_SECTIONS,
  DISCOVER_SETTINGS_SPACER_DP,
  DISCOVER_SETTINGS_TITLE,
  DONE_LABEL,
  GREEN_RISE_SETTING,
  PERSONALIZATION_SETTING,
  SETTINGS_DIVIDER_ALPHA,
  SETTINGS_TOGGLE_GAP_DP,
  SETTINGS_TOGGLE_MIN_HEIGHT_DP,
  UNBLOCK_ALL_LABEL,
  blockedRowLabel,
  blockedRows,
  cacheHoursSelection,
  cacheHoursValue,
  discoverLayoutIndex,
  discoverLayoutNameAt,
  showsCacheHours,
  shouldClearCacheOnToggle,
} from '@core/discover/settingsModel';
import { DiscoverStore } from '@core/discover/store';
import type { FileSystemApi, SecureStore } from '@platform/interfaces';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① data/ImportSafety.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ImportSafety.kt：解压预算', () => {
  const KT = kt('data/ImportSafety.kt');

  it('三个默认上限逐字：64 MiB / 512 MiB / 10000 条；缓冲区 64 KiB', () => {
    expect(KT).toContain('private val maxEntryBytes: Long = 64L * 1024 * 1024');
    expect(KT).toContain('private val maxTotalBytes: Long = 512L * 1024 * 1024');
    expect(KT).toContain('private val maxEntries: Int = 10_000');
    expect(KT).toContain('val buffer = ByteArray(64 * 1024)');

    // 默认构造的预算：一条 64 MiB 通过、64 MiB + 1 字节被拒
    const ok = new ArchiveBudget();
    expect(() => ok.copyEntry(bytesInputStream(new Uint8Array(64 * 1024 * 1024)))).not.toThrow();
    const over = new ArchiveBudget();
    expect(() => over.copyEntry(bytesInputStream(new Uint8Array(64 * 1024 * 1024 + 1)))).toThrow(
      '压缩包解压体积超过安全上限',
    );
  });

  it('条目数先 ++ 再判：第 maxEntries+1 条直接抛「压缩包条目过多」', () => {
    expect(KT).toContain('require(++entries <= maxEntries) { tr("压缩包条目过多") }');
    const budget = new ArchiveBudget(16, 1024, 2);
    budget.copyEntry(bytesInputStream(new Uint8Array([1])));
    budget.copyEntry(bytesInputStream(new Uint8Array([2])));
    expect(() => budget.copyEntry(bytesInputStream(new Uint8Array([3])))).toThrow('压缩包条目过多');
  });

  it('累计体积跨条目也计：两条各 60 B、上限 100 B → 第二条抛', () => {
    expect(KT).toContain('require(size <= maxEntryBytes && total <= maxTotalBytes) { tr("压缩包解压体积超过安全上限") }');
    const budget = new ArchiveBudget(1024, 100, 10);
    budget.copyEntry(bytesInputStream(new Uint8Array(60)));
    expect(() => budget.copyEntry(bytesInputStream(new Uint8Array(60)))).toThrow(
      '压缩包解压体积超过安全上限',
    );
  });

  it('destination：反斜杠归一、绝对路径拒绝、`..` 越界拒绝', () => {
    expect(KT).toContain("val normalized = entryName.replace('\\\\', '/')");
    expect(KT).toContain('require(!normalized.startsWith(\'/\') && !Regex("^[A-Za-z]:").containsMatchIn(normalized))');
    expect(KT).toContain('require(target.canonicalPath.startsWith(root.canonicalPath.trimEnd(File.separatorChar)+File.separator))');

    expect(ArchiveBudget.destination('/root', 'a/b.txt')).toBe('/root/a/b.txt');
    // Windows 反斜杠先归一再判
    expect(ArchiveBudget.destination('/root', 'a\\b.txt')).toBe('/root/a/b.txt');
    expect(() => ArchiveBudget.destination('/root', '/etc/passwd')).toThrow('压缩包包含绝对路径');
    expect(() => ArchiveBudget.destination('/root', 'C:/Windows/x')).toThrow('压缩包包含绝对路径');
    expect(() => ArchiveBudget.destination('/root', 'c:x')).toThrow('压缩包包含绝对路径');
    expect(() => ArchiveBudget.destination('/root', '../escape.txt')).toThrow('压缩包包含越界路径');
    expect(() => ArchiveBudget.destination('/root', 'a/../../escape.txt')).toThrow('压缩包包含越界路径');
    // 恰好等于 root 本身也不算越界（前缀是 `root/`，故被拒）
    expect(() => ArchiveBudget.destination('/root', '.')).toThrow('压缩包包含越界路径');
  });

  it('readImportBytes：`ArchiveBudget(max,max,1)` —— 一次读完且有上限', () => {
    expect(KT).toContain('ArchiveBudget(maxBytes.toLong(), maxBytes.toLong(), 1).copyEntry(this, output)');
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    expect([...readImportBytes(bytesInputStream(data))]).toEqual([1, 2, 3, 4, 5]);
    // maxBytes 同时是「单条」和「总量」上限
    expect([...readImportBytes(bytesInputStream(data), 5)]).toEqual([1, 2, 3, 4, 5]);
    expect(() => readImportBytes(bytesInputStream(data), 4)).toThrow('压缩包解压体积超过安全上限');
    // 条目数上限是 1：一次调用只允许一条
    expect(() => readImportBytes(bytesInputStream(data), 10)).not.toThrow();
  });
});

describe('ImportSafety.kt：章节切分', () => {
  const KT = kt('data/ImportSafety.kt');

  it('MAX_CHAPTER_LENGTH = 30000；limit < 2 抛', () => {
    expect(KT).toContain('require(limit >= 2)');
    expect(MAX_CHAPTER_LENGTH).toBe(30_000);
    expect(splitChapterText('')).toEqual([]);
    expect(() => splitChapterText('abc', 1)).toThrow();
    expect(() => splitChapterText('abc', 1.5)).toThrow();
  });

  it('长度不足一片时原样返回；刚好等于 limit 也不切', () => {
    expect(splitChapterText('abcd', 4)).toEqual(['abcd']);
    expect(splitChapterText('abcde', 4)).toEqual(['abcd', 'e']);
  });

  it('代理对不切半：末尾是高位、下一位是低位时 end--', () => {
    expect(KT).toContain('if (text[end - 1].isHighSurrogate() && text[end].isLowSurrogate()) end--');
    // 'a' + '😀'（U+1F600 占两码元）→ limit=2 时应在 'a' 处切开而不是切开代理对
    const text = 'a😀b';
    const parts = splitChapterText(text, 2);
    expect(parts.join('')).toBe(text);
    for (const part of parts) {
      const last = part.charCodeAt(part.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });

  it('`[IMG:...]` 跨过切点时整段前移（不把内嵌图引用切两半）', () => {
    expect(KT).toContain('val tokenStart = text.lastIndexOf("[IMG:", end - 1)');
    expect(KT).toContain('if (tokenStart >= start && text.indexOf(\']\', tokenStart).let { it >= end }) {');
    // 引用本身 7 字符、limit 8 → 切点落在引用之后，整段进第 2 片
    const text = 'aaaa[IMG:a]bbbb';
    const parts = splitChapterText(text, 8);
    expect(parts.join('')).toBe(text);
    expect(parts[0]).toBe('aaaa');
    expect(parts[1]).toContain('[IMG:a]');
    // 每个分片里的 `[IMG:` 都必须自带 `]`（没有被切两半）
    for (const part of parts) {
      const open = part.lastIndexOf('[IMG:');
      if (open >= 0) expect(part.indexOf(']', open)).toBeGreaterThan(open);
    }
    // 更宽的 limit：整段进一片，同样完整
    const wide = splitChapterText(text, 30);
    expect(wide).toEqual([text]);
  });

  it('`[IMG:` 本身跨不过 limit（tokenStart 落在 start 之前）→ 抛「内嵌图片引用超过章节长度上限」', () => {
    expect(KT).toContain('require(tokenStart > start) { tr("内嵌图片引用超过章节长度上限") }');
    const longRef = `[IMG:${'x'.repeat(40)}]`;
    expect(() => splitChapterText(longRef, 10)).toThrow('内嵌图片引用超过章节长度上限');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② discover/DiscoverSettings.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DiscoverSettings.kt：窗尺寸与文案（E187）', () => {
  const KT = kt('discover/DiscoverSettings.kt');

  it('主窗 460dp、卡片间距 16、卡内边距 16、标题后 12；默认分区 COMIC', () => {
    expect(KT).toContain('heightIn(max = 460.dp)');
    expect(KT).toContain('verticalArrangement = Arrangement.spacedBy(16.dp)');
    expect(KT).toContain('GlassCard(contentPadding = PaddingValues(16.dp))');
    expect(KT).toContain('Spacer(Modifier.height(12.dp))');
    expect(KT).toContain('partition: DiscoverPartition = DiscoverPartition.COMIC');
    expect(DISCOVER_SETTINGS_MAX_HEIGHT_DP).toBe(460);
    expect(DISCOVER_SETTINGS_CARD_GAP_DP).toBe(16);
    expect(DISCOVER_SETTINGS_PADDING_DP).toBe(16);
    expect(DISCOVER_SETTINGS_SPACER_DP).toBe(12);
    expect(DISCOVER_SETTINGS_DEFAULT_PARTITION).toBe('COMIC');
  });

  it('五个文案逐字：发现设置 / 浏览布局 / 屏蔽管理 / 还没有屏蔽作品 / 全部解除 / 完成 / 清除离线缓存', () => {
    expect(KT).toContain('Text(tr("发现设置")');
    expect(KT).toContain('Text(tr("浏览布局")');
    expect(KT).toContain('AppActionButton(tr("屏蔽管理")');
    expect(KT).toContain('Text(tr("还没有屏蔽作品"))');
    expect(KT).toContain('AppActionButton(tr("全部解除")');
    expect(KT).toContain('AppActionButton(tr("完成")');
    expect(KT).toContain('Text(tr("清除离线缓存"))');
    expect(DISCOVER_SETTINGS_TITLE).toBe('发现设置');
    expect(DISCOVER_LAYOUT_SECTION_TITLE).toBe('浏览布局');
    expect(BLOCKED_SECTION_LABEL).toBe('屏蔽管理');
    expect(BLOCKED_EMPTY_LABEL).toBe('还没有屏蔽作品');
    expect(UNBLOCK_ALL_LABEL).toBe('全部解除');
    expect(DONE_LABEL).toBe('完成');
    expect(CLEAR_CACHE_LABEL).toBe('清除离线缓存');
  });

  it('二级窗 320dp；行格式 `解除 · <书名>`', () => {
    expect(KT).toContain('heightIn(max = 320.dp)');
    expect(KT).toContain('Text("解除 · $title")');
    expect(BLOCKED_DIALOG_MAX_HEIGHT_DP).toBe(320);
    expect(blockedRowLabel('无职转生')).toBe('解除 · 无职转生');
    expect(blockedRows([{ key: 'k1', title: '甲' }])).toEqual([
      { key: 'k1', title: '甲', label: '解除 · 甲' },
    ]);
  });

  it('toggle 行：最小高 56、间距 12；分隔线 alpha .4', () => {
    expect(KT).toContain('Row(Modifier.fillMaxWidth().heightIn(min = 56.dp)');
    expect(KT).toContain('horizontalArrangement = Arrangement.spacedBy(12.dp)');
    expect(KT).toContain('outlineVariant.copy(alpha = .4f)');
    expect(SETTINGS_TOGGLE_MIN_HEIGHT_DP).toBe(56);
    expect(SETTINGS_TOGGLE_GAP_DP).toBe(12);
    expect(SETTINGS_DIVIDER_ALPHA).toBe(0.4);
  });
});

describe('DiscoverSettings.kt：三段结构与六个键', () => {
  const KT = kt('discover/DiscoverSettings.kt');

  it('三段卡片，只有第一段有标题（浏览布局），第二段两个开关、第三段一个', () => {
    expect(DISCOVER_SETTINGS_SECTIONS.map((section) => section.title)).toEqual([
      '浏览布局',
      null,
      null,
    ]);
    expect(DISCOVER_SETTINGS_SECTIONS.map((section) => section.settings.length)).toEqual([0, 2, 1]);
  });

  it('三个开关的 title/description/默认值与 Kotlin 逐条一致', () => {
    expect(KT).toContain('DiscoverSettingToggle(tr("个性化推荐"), tr("结合喜欢的作品与阅读记录"), store.flag("personalization"))');
    expect(KT).toContain('DiscoverSettingToggle(tr("绿涨红跌"), tr("关闭时为红涨绿跌"), store.flag("green_rise", false))');
    expect(KT).toContain('DiscoverSettingToggle(tr("离线缓存"), tr("下次打开立即显示上次内容"), store.flag("cache"))');

    expect(PERSONALIZATION_SETTING).toEqual({
      key: 'personalization',
      title: '个性化推荐',
      description: '结合喜欢的作品与阅读记录',
      defaultChecked: true,
    });
    expect(GREEN_RISE_SETTING).toEqual({
      key: 'green_rise',
      title: '绿涨红跌',
      description: '关闭时为红涨绿跌',
      defaultChecked: false,
    });
    expect(CACHE_SETTING).toEqual({
      key: 'cache',
      title: '离线缓存',
      description: '下次打开立即显示上次内容',
      defaultChecked: true,
    });
    // `flag(key)` 的默认是 true，`flag(key, false)` 才是 false —— 三个键的默认值各不相同
    expect([PERSONALIZATION_SETTING.defaultChecked, GREEN_RISE_SETTING.defaultChecked, CACHE_SETTING.defaultChecked]).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('布局选择传**索引**：GRID 是默认、未知值回落第 0 项（列表）', () => {
    expect(DISCOVER_LAYOUT_DEFAULT).toBe('GRID');
    expect(DISCOVER_LAYOUT_OPTIONS.map((option) => option.name)).toEqual(['LIST', 'GRID', 'LARGE']);
    expect(DISCOVER_LAYOUT_OPTIONS.map((option) => option.ordinal)).toEqual([0, 1, 2]);
    expect(DISCOVER_LAYOUT_OPTIONS.map((option) => option.label)).toEqual(['列表', '双列网格', '大图']);
    // 空 / 未设置 → 用默认 GRID（索引 1）
    expect(discoverLayoutIndex(null)).toBe(1);
    expect(discoverLayoutIndex('')).toBe(1);
    // 未知值 → indexOfFirst 是 −1 → coerceAtLeast(0) → 0
    expect(discoverLayoutIndex('TRIANGLE')).toBe(0);
    expect(discoverLayoutIndex('LARGE')).toBe(2);
    expect(discoverLayoutNameAt(2)).toBe('LARGE');
    expect(discoverLayoutNameAt(99)).toBe('LARGE');
    expect(discoverLayoutNameAt(-5)).toBe('LIST');
  });

  it('缓存时长传**值**而不是索引（Kotlin 的不对称，照抄）', () => {
    expect(KT).toContain('store.string("cache_hours", "24").toIntOrNull() ?: 24');
    expect(DISCOVER_CACHE_HOURS_DEFAULT).toBe('24');
    expect(CACHE_HOUR_OPTIONS.map((option) => option.hours)).toEqual([6, 24, 72]);
    expect(CACHE_HOUR_OPTIONS.map((option) => option.label)).toEqual(['6小时', '24小时', '72小时']);
    // 返回的是小时值：24 而不是 1（布局那边返回的是索引）
    expect(cacheHoursSelection('24')).toBe(24);
    expect(cacheHoursSelection('6')).toBe(6);
    expect(cacheHoursSelection('72')).toBe(72);
    expect(cacheHoursSelection(null)).toBe(24);
    expect(cacheHoursSelection('abc')).toBe(24);
    expect(cacheHoursValue(72)).toBe('72');
    // 与布局的索引语义形成对照
    expect(discoverLayoutIndex('GRID')).toBe(1);
    expect(cacheHoursSelection('GRID')).toBe(24);
  });

  it('缓存时长的显示受「离线缓存」控制；关掉缓存会立刻清盘', () => {
    expect(KT).toContain('if (store.flag("cache")) {');
    expect(KT).toContain('store.put("cache", it); if (!it) store.cache.edit().clear()');
    expect(showsCacheHours(true)).toBe(true);
    expect(showsCacheHours(false)).toBe(false);
    expect(shouldClearCacheOnToggle(false)).toBe(true);
    expect(shouldClearCacheOnToggle(true)).toBe(false);
  });
});

describe('DiscoverSettings.kt：屏蔽管理（store.clearBlocked 本轮补齐）', () => {
  const KT = kt('discover/DiscoverSettings.kt');

  function memoryStore(): Pick<SecureStore, 'get' | 'set' | 'remove'> {
    const map = new Map<string, string>();
    return {
      get: async (key: string) => map.get(key) ?? null,
      set: async (key: string, value: string) => {
        map.set(key, value);
      },
      remove: async (key: string) => {
        map.delete(key);
      },
    };
  }

  function memoryFs(): FileSystemApi {
    return {
      exists: async () => false,
      readFile: async () => new Uint8Array(),
      writeFile: async () => undefined,
      delete: async () => undefined,
      list: async () => [],
      mkdirs: async () => undefined,
    } as unknown as FileSystemApi;
  }

  it('Kotlin 的「全部解除」调 `store.clearBlocked()`', () => {
    expect(KT).toContain('AppActionButton(tr("全部解除"), { store.clearBlocked(); close {} })');
  });

  it('clearBlocked 三个键一起清：blocked / blocked_groups / blocked_labels', () => {
    const store = new DiscoverStore('COMIC', memoryStore(), memoryFs(), () => 0);
    expect(store.clearBlocked).toBeTypeOf('function');
    store.put('blocked', new Set(['a', 'b']));
    store.put('blocked_groups', { k1: ['a', 'b'] });
    store.put('blocked_labels', { k1: '甲' });
    expect(store.blockedWorks()).toEqual([{ key: 'k1', title: '甲' }]);
    store.clearBlocked();
    expect(store.blockedWorks()).toEqual([]);
    expect([...store.selection('blocked')]).toEqual([]);
    // 少清任何一个都会留下「已解除但仍被过滤」的幽灵
    const raw = store.string('blocked_groups', 'sentinel');
    expect(raw).toBe('sentinel');
  });

  it('unblock 只摘一个 key，其余保留', () => {
    const store = new DiscoverStore('NOVEL', memoryStore(), memoryFs(), () => 0);
    store.put('blocked', new Set(['a', 'b']));
    store.put('blocked_groups', { k1: ['a'], k2: ['b'] });
    store.put('blocked_labels', { k1: '甲', k2: '乙' });
    store.unblock('k1');
    expect(store.blockedWorks().map((row) => row.key)).toEqual(['k2']);
    expect([...store.selection('blocked')]).toEqual(['b']);
  });
});

describe('DiscoverSettings.tsx：自包含（不再是外部塞 rows）', () => {
  const TSX = readFileSync('src/ui/components/discover/DiscoverSettings.tsx', 'utf8');

  it('props 只留 store / onDismissRequest / partition —— 没有 rows / onToggle', () => {
    expect(TSX).toContain('readonly store: DiscoverSettingsStorePort');
    expect(TSX).toContain('readonly onDismissRequest: () => void');
    expect(TSX).toContain('readonly partition?: DiscoverPartition');
    expect(TSX).not.toContain('DiscoverSettingRow');
    expect(TSX).not.toContain('readonly rows');
    expect(TSX).not.toContain('onToggle');
  });

  it('三个 store 键真被读：layout / cache_hours / cache', () => {
    expect(TSX).toContain("store.string('layout', 'GRID')");
    expect(TSX).toContain("store.string('cache_hours', '24')");
    expect(TSX).toContain('store.flag(CACHE_SETTING.key, CACHE_SETTING.defaultChecked)');
    expect(TSX).toContain("store.put('layout', discoverLayoutNameAt(index))");
    expect(TSX).toContain("store.put('cache_hours', cacheHoursValue(hours))");
  });

  it('屏蔽管理是一整块：入口按钮、二级窗、空态、逐行解除、全部解除', () => {
    expect(TSX).toContain('setBlockedOpen(true)');
    expect(TSX).toContain('data-testid="discover_blocked"');
    expect(TSX).toContain('tr(BLOCKED_EMPTY_LABEL)');
    expect(TSX).toContain('store.unblock(row.key)');
    expect(TSX).toContain('store.clearBlocked()');
    expect(TSX).toContain('tr(UNBLOCK_ALL_LABEL)');
  });

  it('两处尺寸用常量而不是字面量（460 / 320 / 16 / 12 / 56）', () => {
    expect(TSX).toContain('maxHeight: DISCOVER_SETTINGS_MAX_HEIGHT_DP');
    expect(TSX).toContain('maxHeight: BLOCKED_DIALOG_MAX_HEIGHT_DP');
    expect(TSX).toContain('<GlassCard padding={DISCOVER_SETTINGS_PADDING_DP}>');
    expect(TSX).toContain('height: DISCOVER_SETTINGS_SPACER_DP');
    expect(TSX).toContain('minHeight: SETTINGS_TOGGLE_MIN_HEIGHT_DP');
    // 代码里不许留裸字面量（注释里的 Kotlin 行号说明不算）
    expect(TSX).not.toContain('maxHeight: 460');
    expect(TSX).not.toContain('maxHeight: 320');
  });
});
