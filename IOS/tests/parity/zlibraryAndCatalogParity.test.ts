/**
 * zlibraryAndCatalogParity.test.ts —— Z-Library 元数据/节点选择 + 目录封面共享转场。
 *
 * 覆盖 3 个 Kotlin 文件：
 *   `library/ZLibraryNovelMetadata.kt`   只读展示元数据（简介 / 出版社 / 标签 / 事实行的 ` · ` 拼接）
 *   `source/zlibrary/ZLibraryNodeSelection.kt` 页面识别（4 个标记串，忽略大小写）+ 健康节点选择
 *   `ui/components/CatalogCoverMotion.kt` 共享元素转场 360ms + easeOutCubic + key 模板
 *
 * 其中节点选择有一条**真实的语义差异**（登记 E144）：
 * Kotlin 是「并发 check + 超时预算 + 先完成者胜」，iOS 是「调用方先探活、再按延迟升序取第一个」。
 * 测试两侧都断言，差异写在 E144 里，不假装等价。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { substringAfterColon, zLibraryNovelMetadata } from '@core/library/zLibraryNovelMetadata';
import { isZLibraryPage, selectHealthyNode } from '@core/source/sourceText';
import { CATALOG_COVER_MOTION_MS, catalogCoverKey } from '@core/motion/navigationMotion';

import { androidReference } from '../helpers/androidReference';

const KT = 'app/src/main/java/com/example';

function kt(rel: string): string {
  return readFileSync(androidReference(`${KT}/${rel}`), 'utf8');
}

describe('ZLibraryNovelMetadata.kt：只读展示元数据', () => {
  const source = kt('library/ZLibraryNovelMetadata.kt');

  it('四条事实行前缀与 ` · ` 分隔符', () => {
    expect(source).toContain('"出版年份：$it"');
    expect(source).toContain('"页数：$it"');
    expect(source).toContain('"ISBN：$it"');
    expect(source).toContain('"ISBN-13：$it"');
    expect(source).toContain('joinToString(" · ")');

    const html = `
      <html><body>
        <div id="bookDescriptionBox">这是简介<span>（含标签）</span><script>x()</script></div>
        <div class="property_year"><span class="property_value">2001</span></div>
        <div class="property_pages"><span class="property_value">352</span></div>
        <div class="property_isbn"><span class="property_value">1234567890</span></div>
        <div class="property_isbn13"><span class="property_value">9781234567890</span></div>
        <div class="property_publisher"><span class="property_value">某出版社</span></div>
        <div class="property_categories"><span class="property_value"><a>科幻</a><a>  </a><a>长篇</a></span></div>
      </body></html>`;
    const info = zLibraryNovelMetadata(html);
    expect(info.synopsis).toBe('这是简介（含标签）');
    expect(info.publisher).toBe('某出版社');
    expect(info.tags).toEqual(['科幻', '长篇']);
    // 四行按声明顺序拼接，空的跳过
    expect(info.notice).toBe('出版年份：2001 · 页数：352 · ISBN：1234567890 · ISBN-13：9781234567890');
  });

  it('缺字段时不留空行；`substringAfter(:)` 兜底路径也工作', () => {
    // 只有 year，且是「.property_year 文本里带冒号」的兜底形态
    const sparse = '<div class="property_year">出版年份: 1999</div>';
    const info = zLibraryNovelMetadata(sparse);
    expect(info.synopsis).toBeNull();
    expect(info.publisher).toBeNull();
    expect(info.tags).toEqual([]);
    expect(info.notice).toBe('出版年份：1999');
    // 全空 → notice 为 null（不是空串）
    expect(zLibraryNovelMetadata('<div>nothing</div>').notice).toBeNull();
    expect(substringAfterColon('a:b:c')).toBe('b:c');
    expect(substringAfterColon('nocolon')).toBe('nocolon');
  });
});

describe('ZLibraryNodeSelection.kt：页面识别与健康节点', () => {
  const source = kt('source/zlibrary/ZLibraryNodeSelection.kt');

  it('4 个标记串、忽略大小写', () => {
    expect(source).toContain('listOf("zlibrary.js", "z-cover", "z-bookcard", "book-item").any { html.contains(it, true) }');
    for (const marker of ['zlibrary.js', 'z-cover', 'z-bookcard', 'book-item']) {
      expect(isZLibraryPage(`<html><script src="${marker}"></script></html>`), marker).toBe(true);
    }
    // 大小写不敏感
    expect(isZLibraryPage('<SCRIPT SRC="ZLIBRARY.JS">')).toBe(true);
    expect(isZLibraryPage('<div class="BOOK-ITEM">')).toBe(true);
    // 都不含
    expect(isZLibraryPage('<html><body>普通页面</body></html>')).toBe(false);
    // 空串
    expect(isZLibraryPage('')).toBe(false);
  });

  it('Kotlin 侧是「并发 check + 超时预算 + 先完成者胜」', () => {
    expect(source).toContain('Channel<String?>(Channel.UNLIMITED)');
    expect(source).toContain('withTimeoutOrNull(budgetMs)');
    expect(source).toContain('jobs.forEach { it.cancel() }');
    // 空候选直接 null
    expect(source).toContain('if (candidates.isEmpty()) return@coroutineScope null');
  });

  it('iOS 侧按「延迟升序取第一个健康节点」（E144 的差异面）', () => {
    const nodes = [
      { host: 'slow', healthy: true, latencyMs: 900 },
      { host: 'fast', healthy: true, latencyMs: 120 },
      { host: 'dead', healthy: false, latencyMs: 30 },
    ];
    expect(selectHealthyNode(nodes)?.host).toBe('fast');
    // 全不健康 → null
    expect(selectHealthyNode([{ host: 'x', healthy: false, latencyMs: 1 }])).toBeNull();
    // 空列表 → null
    expect(selectHealthyNode([])).toBeNull();
    // 只有不健康节点时即使延迟低也不选
    expect(
      selectHealthyNode([
        { host: 'a', healthy: false, latencyMs: 5 },
        { host: 'b', healthy: true, latencyMs: 999 },
      ])?.host,
    ).toBe('b');
  });
});

describe('CatalogCoverMotion.kt：共享元素转场', () => {
  const source = kt('ui/components/CatalogCoverMotion.kt');

  it('360ms + easeOutCubic，且 360 是字面量而非令牌', () => {
    expect(source).toContain('boundsTransform = { _, _ -> tween(360, easing = AppMotion.easeOutCubic) }');
    expect(CATALOG_COVER_MOTION_MS).toBe(360);
    // 与 AppMotion 里的常量区分：不能是 220/260/240
    expect(CATALOG_COVER_MOTION_MS).not.toBe(220);
    expect(CATALOG_COVER_MOTION_MS).not.toBe(260);
  });

  it('key 模板 catalog_cover_{sourceId}_{bookId}', () => {
    expect(source).toContain('rememberSharedContentState("catalog_cover_${sourceId}_$bookId")');
    expect(catalogCoverKey('ixdzs8', '42')).toBe('catalog_cover_ixdzs8_42');
    expect(catalogCoverKey('', '')).toBe('catalog_cover__');
    // 不同 source/book 组合不撞 key
    expect(catalogCoverKey('a', 'bc')).not.toBe(catalogCoverKey('ab', 'c'));
  });

  it('没有共享作用域或开启了「减少动态效果」时直接原样返回（不挂转场）', () => {
    expect(source).toContain('if (shared == null || visible == null || LocalReduceMotion.current) return this');
  });
});
