/**
 * jsDiscoverAdapterParity.test.ts —— `source/js/JsDiscoverAdapter.kt`（75 行）+ `discover/DiscoverModels.kt` L199。
 *
 * 端口 `src/core/discover/jsAdapter.ts` 早就有，但有三处真漂移（本轮修掉）：
 *   1. `data.optJSONArray("entries") ?: data.optJSONArray("comics")` —— 「存在但不是数组」
 *      时 Kotlin 会继续回退，`??` 不会；
 *   2. `row.opt(k)` 的 `text()` 与 `data.optString("origin")` 是两种取值语义，后者保留
 *      显式 JSON null 的字面量 "null"；
 *   3. `is String -> value.toLongOrNull()` / `toDoubleOrNull()` 只认十进制字面量，
 *      `Number()` 还认 `0x10` / `0b101` / 空串。
 * 另加：`compactMetric` 不再复写档位表，改为委托 i18n 的 `compactCount`（英文 M/k 分支）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { JSONObject } from '@core/source/js/json';
import type { HtmlDomParser } from '@core/source/js/jsPlatform';
import { AppLanguage, setAppLanguage } from '@core/i18n/locale';
import { compactMetric, discoverQuery } from '@core/discover/models';
import { parseJsDiscoverCatalog, parseJsDiscoverPage } from '@core/discover/jsAdapter';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

const dom: HtmlDomParser = {
  wholeText: (html: string) => html.replace(/<[^>]*>/g, ''),
} as unknown as HtmlDomParser;

function page(fields: Record<string, unknown>, query = discoverQuery(), now = 1_700_000_000_000) {
  return parseJsDiscoverPage(new JSONObject(fields), 'src', query, dom, now);
}

describe('JsDiscoverAdapter.kt L10-24 catalog', () => {
  const KT = kt('source/js/JsDiscoverAdapter.kt');

  it('feeds/categories 的 "null"/空白 kind 归一；categories 的 group 不做归一', () => {
    expect(KT).toContain('it.optString("kind").takeUnless { v -> v.isBlank() || v == "null" }');
    expect(KT).toContain('DiscoverNativeCategory(it.optString("id"), it.optString("label"), it.optString("group"))');
    const catalog = parseJsDiscoverCatalog(new JSONObject({
      feeds: [{ id: 'f1', label: 'F', kind: 'null' }, { id: 'f2', label: 'G' }],
      categories: [{ id: 'c1', label: 'C', group: 'g' }],
      statuses: ['连载中'],
      capabilities: { updates: ['最新'] },
      explicit: true,
    }));
    expect(catalog.feeds.map((feed) => feed.kind)).toEqual([null, null]);
    expect(catalog.categories[0]!.group).toBe('g');
    expect(catalog.declared).toBe(true);
    expect(catalog.statuses).toEqual(['连载中']);
    expect(catalog.capabilities['updates']).toEqual(['最新']);
  });
});

describe('JsDiscoverAdapter.kt L25-74 page', () => {
  const KT = kt('source/js/JsDiscoverAdapter.kt');

  it('rows：entries 不是数组时回退到 comics（optJSONArray 语义）', () => {
    expect(KT).toContain('val rows = data.optJSONArray("entries") ?: data.optJSONArray("comics") ?: JSONArray()');
    const rows = page({ entries: { not: 'an array' }, comics: [{ id: 'b1', title: 'T' }] });
    expect(rows.entries.map((entry) => entry.book.id)).toEqual(['b1']);
  });

  it('native 的三段优先级：feedId / categoryId / (native 且 categoryIds 为空)', () => {
    expect(KT).toContain('val native = query.feedId != null || query.categoryId != null ||');
    expect(KT).toContain('(data.optBoolean("native") && query.categoryIds.isEmpty())');
    expect(page({ native: true, entries: [] }).native).toBe(true);
    expect(page({ native: true, entries: [] }, discoverQuery({ categoryIds: ['c'] })).native).toBe(false);
    expect(page({ native: false, entries: [] }, discoverQuery({ feedId: 'f' })).native).toBe(true);
    expect(page({ native: false, entries: [] }, discoverQuery({ categoryId: 'c' })).native).toBe(true);
  });

  it('id/title 过滤：空、以 __ 开头、"null" 一律丢弃', () => {
    expect(KT).toContain('if (id.isBlank() || id.startsWith("__") || title.isBlank() || id == "null") return@mapNotNull null');
    const result = page({ entries: [
      { id: 'ok', title: 'T' },
      { id: '__internal', title: 'T' },
      { id: 'null', title: 'T' },
      { id: 'x', title: '   ' },
      { id: '', title: 'T' },
    ] });
    expect(result.entries.map((entry) => entry.book.id)).toEqual(['ok']);
  });

  it('growth 只认十进制字面量（toDoubleOrNull），十六进制/二进制/空串都是 null', () => {
    expect(KT).toContain('growth = text("growth")?.toDoubleOrNull()?.takeIf { it.isFinite() }');
    const entries = page({ entries: [
      { id: 'a', title: 'A', growth: '0x10' },
      { id: 'b', title: 'B', growth: '0b101' },
      { id: 'c', title: 'C', growth: '1.5' },
      { id: 'd', title: 'D', growth: '1.5e2' },
      { id: 'e', title: 'E', growth: 2 },
    ] }).entries;
    expect(entries.map((entry) => entry.growth)).toEqual([null, null, 1.5, 150, 2]);
  });

  it('discussions/clicks 丢掉负数；rank 只收 1..Int.MAX；rankChange 只收 Int 范围', () => {
    expect(KT).toContain('discussions = number("discussions", "commentCount")?.takeIf { it >= 0 }');
    expect(KT).toContain('rank = number("rank")?.takeIf { it in 1..Int.MAX_VALUE.toLong() }?.toInt()');
    expect(KT).toContain('rankChange = number("rankChange")?.takeIf { it in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong() }?.toInt()');
    const [entry] = page({ entries: [
      { id: 'a', title: 'A', discussions: -1, clicks: -5, rank: 0, rankChange: 3_000_000_000 },
    ] }).entries;
    expect(entry!.discussions).toBeNull();
    expect(entry!.clicks).toBeNull();
    expect(entry!.rank).toBeNull();
    expect(entry!.rankChange).toBeNull();
  });

  it('updatedAt：秒级补 000（< 10_000_000_000），非数字回退 parseDate', () => {
    expect(KT).toContain('val updated = number("updatedAt", "updateTime")?.takeIf { it > 0 }?.let { if (it < 10_000_000_000L) it * 1000 else it }');
    expect(page({ entries: [{ id: 'a', title: 'A', updatedAt: 1_700_000 }] }).entries[0]!.updatedAt).toBe(1_700_000_000);
    expect(page({ entries: [{ id: 'a', title: 'A', updatedAt: 1_700_000_000_000 }] }).entries[0]!.updatedAt).toBe(1_700_000_000_000);
    expect(page({ entries: [{ id: 'a', title: 'A', updatedAt: '2024-01-02' }] }).entries[0]!.updatedAt)
      .toBe(new Date(2024, 0, 2).getTime());
  });

  it('origin 两级：条目 text() 优先，否则 data.optString("origin") —— 显式 null 变字面量 "null"', () => {
    expect(KT).toContain('origin = text("origin") ?: data.optString("origin").takeIf { it.isNotBlank() }');
    expect(page({ origin: 'source-origin', entries: [{ id: 'a', title: 'A' }] }).entries[0]!.origin).toBe('source-origin');
    expect(page({ entries: [{ id: 'a', title: 'A', origin: 'row-origin' }] }).entries[0]!.origin).toBe('row-origin');
    expect(page({ entries: [{ id: 'a', title: 'A' }] }).entries[0]!.origin).toBeNull();
    expect(page({ origin: '   ', entries: [{ id: 'a', title: 'A' }] }).entries[0]!.origin).toBeNull();
    // org.json 的既有行为：显式 JSON null → "null"
    expect(page({ origin: null, entries: [{ id: 'a', title: 'A' }] }).entries[0]!.origin).toBe('null');
  });

  it('statistic：^(关注|收藏)\\s+(\\d+)$ 命中后数字走 compact 档位，其余原样', () => {
    expect(KT).toContain('Regex("^(关注|收藏)\\\\s+(\\\\d+)$")');
    expect(page({ entries: [{ id: 'a', title: 'A', statistic: '关注 23456' }] }).entries[0]!.statistic).toBe('关注 2.3万');
    expect(page({ entries: [{ id: 'a', title: 'A', statistic: '收藏 12' }] }).entries[0]!.statistic).toBe('收藏 12');
    expect(page({ entries: [{ id: 'a', title: 'A', statistic: '关注23456' }] }).entries[0]!.statistic).toBe('关注23456');
  });

  it('nativeOrder 回退 offset + index + 1（index 是原始行号，不是过滤后的序号）', () => {
    expect(KT).toContain('nativeOrder = number("nativeOrder")?.toInt() ?: query.offset + index + 1');
    const result = page({ entries: [{ id: '__skip', title: 'X' }, { id: 'b', title: 'B' }] }, discoverQuery({ offset: 20 }));
    expect(result.entries[0]!.nativeOrder).toBe(22);
  });

  it('entries 按 book.id 去重；catalog 必须是 JSON 对象', () => {
    expect(KT).toContain('DiscoverPage(entries.distinctBy { it.book.id }');
    expect(KT).toContain('data.optJSONObject("catalog")?.let { catalog(it).copy(dated = dated) }');
    const result = page({ entries: [{ id: 'a', title: 'A' }, { id: 'a', title: 'A again' }], catalog: ['not', 'object'] });
    expect(result.entries).toHaveLength(1);
    expect(result.catalog).toBeNull();
  });

  it('supported 默认 true；notice/nextCursor 的空串与 "null" 都归一', () => {
    expect(KT).toContain('data.optBoolean("supported", true)');
    const result = page({ entries: [], notice: 'null', nextCursor: '' });
    expect(result.supported).toBe(true);
    expect(result.notice).toBeNull();
    expect(result.nextCursor).toBeNull();
  });
});

describe('DiscoverModels.kt L199 compact → i18n.compactCount', () => {
  it('委托而不是复写：英文走 M/k，中文走 亿/万，null 走词表', () => {
    expect(kt('discover/DiscoverModels.kt')).toContain('fun compact(value: Long?): String = com.example.i18n.compactCount(value)');
    setAppLanguage(AppLanguage.EN);
    try {
      expect(compactMetric(1234)).toBe('1.2k');
      expect(compactMetric(1_234_567)).toBe('1.2M');
      expect(compactMetric(null)).toBe('Not provided');
    } finally {
      setAppLanguage(AppLanguage.ZH);
    }
    expect(compactMetric(123_456_789)).toBe('1.2亿');
    expect(compactMetric(23456)).toBe('2.3万');
    expect(compactMetric(null)).toBe('未提供');
  });
});