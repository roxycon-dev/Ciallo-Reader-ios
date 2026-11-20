/**
 * smallInsetsAndBudgetParity.test.ts —— 第五批**小文件**（合计 205 行，8 个文件）。
 *
 *   · `ui/theme/AppInsets.kt`（32）—— 底部避让的两个 CompositionLocal
 *   · `mangatranslate/PageMemoryBudget.kt`（32）—— 32 MiB / ÷8 / ÷4 与采样指纹
 *   · `source/js/JsSourcePayload.kt`（33）—— 四个 payload 校验函数（本轮新补齐）
 *   · `source/NovelInfo.kt`（33）—— 13 个字段 + revision + 全本小说源集合
 *   · `source/impl/AliceSwDiscovery.kt`（33）—— 倒写域名 + 明文 https 抽取
 *   · `source/parser/RuleBudget.kt`（34）—— 4096 / 128 / 2MiB / 64 与 256 次读检查
 *   · `source/SourceLog.kt`（38）—— 300 条环形缓冲 + 双层脱敏
 *   · `source/keyword/LocalKeywordIndex.kt`（29）—— 5 字段种子 → 索引
 *
 * 本轮的真缺口（E169）：`JsSourcePayload.kt` 从来没被移植 —— `sourceText.ts` 里挂过
 * 一个**同名但内容完全不同**的 interface（id/name/version/code/adult，零调用方），
 * 而真正的「payload 校验」四个函数一个都不存在。
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  APP_INSETS_DEFAULT,
  FLOATING_TAB_BAR_TOTAL_DP,
  INSET_DEFAULT_DP,
  TAB_BAR_BODY_DP,
  TAB_BAR_MARGIN_DP,
  VISUAL_GAP_DP,
  resolveAppInsets,
} from '@core/ui-theme/appInsets';
import {
  PageMemoryBudget,
  fingerprintBitmap,
  packFingerprintRows,
  planFingerprintRows,
} from '@core/mangatranslate/pageMemoryBudget';
import {
  JsSourcePayload,
  jsPayloadChapters,
  jsPayloadImages,
  jsPayloadString,
  requiredJsPayloadArray,
} from '@core/source/js/jsSourcePayload';
import {
  WholeBookNovelSources,
  createNovelInfo,
  novelInfoHasRevision,
  novelInfoRevision,
} from '@core/source/novelInfo';
import { AliceSwDiscovery } from '@core/source/impl/aliceSwEndpoints';
import {
  MAX_JSON_CHARS,
  MAX_JSON_DEPTH,
  MAX_NESTING,
  MAX_RULE_LENGTH,
  boundedText,
  validateJson,
  validateRule,
} from '@core/parser/ruleBudget';
import { SOURCE_LOG_TAG, SourceLog, setLogSink } from '@core/source/sourceLog';
import { LocalKeywordIndex } from '@core/source/keyword/localKeywordIndex';
import { ParseError } from '@core/source/sourceException';
import { tr } from '@core/i18n';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

describe('AppInsets.kt：底部避让的唯一事实来源', () => {
  const KT = kt('ui/theme/AppInsets.kt');

  it('两个 ProvidableCompositionLocal<Dp>，默认都是 0.dp', () => {
    expect(KT).toContain('val LocalAppBottomInset: androidx.compose.runtime.ProvidableCompositionLocal<Dp> =');
    expect(KT).toContain('val LocalAppBottomInsetNoTabBar: androidx.compose.runtime.ProvidableCompositionLocal<Dp> =');
    expect((KT.match(/compositionLocalOf \{ 0\.dp \}/g) ?? [])).toHaveLength(2);
    expect(INSET_DEFAULT_DP).toBe(0);
    expect(APP_INSETS_DEFAULT.bottomInset).toBe(0);
    expect(APP_INSETS_DEFAULT.bottomInsetNoTabBar).toBe(0);
  });

  it('KDoc 记录的历史（96/104/120/24/60）与「不要再写 magic number」', () => {
    expect(KT).toContain('全 App 底部避让高度的**唯一事实来源**');
    expect(KT).toContain('96 / 104 / 120 / 24 / 60.dp');
    expect(KT).toContain('手势导航（系统导航栏 ≈0）');
    expect(KT).toContain('三键导航（≈48dp，小米/华为/OPPO/vivo');
    expect(KT).toContain('页面一律改用 `LocalAppBottomInset.current`');
    // 第二个 local 的用途（多选/拖拽把 Tab 栏藏起来时）
    expect(KT).toContain('底部就会凭空多出 92dp 的空白');
  });

  it('92 = 12 + 68，底部避让 = 导航栏 + 92 + 8；无 Tab 栏时 = 导航栏 + 8', () => {
    expect(FLOATING_TAB_BAR_TOTAL_DP).toBe(92);
    expect(TAB_BAR_MARGIN_DP).toBe(12);
    expect(TAB_BAR_BODY_DP).toBe(68);
    expect(VISUAL_GAP_DP).toBe(8);
    expect(TAB_BAR_MARGIN_DP * 2 + TAB_BAR_BODY_DP).toBe(FLOATING_TAB_BAR_TOTAL_DP);

    // 三键导航 48dp
    const three = resolveAppInsets({ navBarBottom: 48, width: 400 });
    expect(three.bottomInset).toBe(48 + 92 + 8);
    expect(three.bottomInsetNoTabBar).toBe(48 + 8);
    expect(three.active).toBe(148);
    // 手势导航 0dp
    const gesture = resolveAppInsets({ navBarBottom: 0, width: 400 });
    expect(gesture.bottomInset).toBe(100);
    expect(gesture.bottomInsetNoTabBar).toBe(8);
    // Tab 栏隐藏 → 用 NoTabBar 那个值（差正好 92）
    const hidden = resolveAppInsets({ navBarBottom: 48, width: 400, tabBarVisible: false });
    expect(hidden.active).toBe(56);
    expect(hidden.bottomInset - hidden.active).toBe(FLOATING_TAB_BAR_TOTAL_DP);
  });
});

describe('PageMemoryBudget.kt：32 MiB / ÷8 / ÷4', () => {
  const KT = kt('mangatranslate/PageMemoryBudget.kt');

  it('常量逐字：32L*1024*1024、maxMemory()/8、allowed/4', () => {
    expect(KT).toContain('val gate=Mutex()');
    expect(KT).toContain('val allowed=minOf(32L*1024*1024,Runtime.getRuntime().maxMemory()/8)');
    expect(KT).toContain('require(pixels<=allowed/4) { tr("页面过大，请降低图片清晰度后翻译") }');
    expect(PageMemoryBudget.allowedPixelBudget(1024 * 1024 * 1024)).toBe(32 * 1024 * 1024);
    // 小内存设备：maxMemory/8 才是上限（512 MiB → 64 MiB，仍被 32 MiB 压住）
    expect(PageMemoryBudget.allowedPixelBudget(512 * 1024 * 1024)).toBe(32 * 1024 * 1024);
    // 128 MiB → /8 = 16 MiB（小于 32 MiB，取它）
    expect(PageMemoryBudget.allowedPixelBudget(128 * 1024 * 1024)).toBe(16 * 1024 * 1024);
  });

  it('check 的边界：pixels 恰等于 allowed/4 通过，多 1 像素即抛', () => {
    const maxMemory = 128 * 1024 * 1024; // allowed = 16 MiB → /4 = 4 MiB 像素
    const limit = (16 * 1024 * 1024) / 4; // = 4 Mi 像素
    // 2048×2048 恰好等于 allowed/4 —— Kotlin 是 `pixels <= allowed/4`，等号通过
    expect(PageMemoryBudget.pixelCount({ width: 2048, height: 2048 })).toBe(limit);
    expect(() => PageMemoryBudget.check({ width: 2048, height: 2048 }, maxMemory)).not.toThrow();
    // 多 1 行（2048 像素）即越界
    expect(() => PageMemoryBudget.check({ width: 2048, height: 2049 }, maxMemory)).toThrow(
      '页面过大，请降低图片清晰度后翻译',
    );
  });

  it('采样行数 = max(1, min(32, 16384/width))（整除截断）', () => {
    expect(KT).toContain('val rows=maxOf(1,minOf(32,16384/bitmap.width.coerceAtLeast(1)))');
    expect(PageMemoryBudget.sampleRows(0)).toBe(32); // 16384/1 很大 → 夹到 32
    expect(PageMemoryBudget.sampleRows(1)).toBe(32);
    expect(PageMemoryBudget.sampleRows(512)).toBe(32);
    expect(PageMemoryBudget.sampleRows(1024)).toBe(16);
    expect(PageMemoryBudget.sampleRows(2048)).toBe(8);
    expect(PageMemoryBudget.sampleRows(16384)).toBe(1);
    expect(PageMemoryBudget.sampleRows(999999)).toBe(1);
  });

  it('采样计划：按 rows 递增 y，最后一段被裁到剩余高度', () => {
    expect(KT).toContain('val height=minOf(rows,bitmap.height-y)');
    expect(planFingerprintRows(1024, 40)).toEqual([
      { y: 0, height: 16, count: 1024 * 16 },
      { y: 16, height: 16, count: 1024 * 16 },
      { y: 32, height: 8, count: 1024 * 8 },
    ]);
    // 高度小于一行时只有一段
    expect(planFingerprintRows(2048, 3)).toEqual([{ y: 0, height: 3, count: 2048 * 3 }]);
  });

  it('打包是 big-endian 的 A,R,G,B（`ByteBuffer.putInt`）', () => {
    expect(KT).toContain('for(i in 0 until bitmap.width*height) buffer.putInt(pixels[i])');
    const bytes = packFingerprintRows(() => [0x11223344], 1, 1);
    expect([...bytes]).toEqual([0x11, 0x22, 0x33, 0x44]);
  });

  it('fingerprintBitmap = check + 采样 + 注入的 SHA-256（先守卫后摘要）', () => {
    expect(KT).toContain('check(bitmap)');
    expect(KT).toContain('digest.digest().joinToString("") { "%02x".format(it) }');
    let sawBytes = 0;
    const digest = fingerprintBitmap(
      { width: 2, height: 1 },
      1024 * 1024 * 1024,
      () => [0x01020304, 0x05060708],
      (bytes) => {
        sawBytes = bytes.length;
        return 'ff';
      },
    );
    expect(digest).toBe('ff');
    expect(sawBytes).toBe(8); // 2 像素 × 4 字节
    // 守卫先于摘要：过大页面连 digest 都不会被调用
    let called = false;
    expect(() =>
      fingerprintBitmap({ width: 4096, height: 4096 }, 128 * 1024 * 1024, () => [], () => {
        called = true;
        return 'x';
      }),
    ).toThrow('页面过大，请降低图片清晰度后翻译');
    expect(called).toBe(false);
  });

  it('未实现的 `fingerprint(bitmap)` 仍先跑守卫，再报「不支持」', () => {
    expect(() => PageMemoryBudget.fingerprint({ width: 4096, height: 4096 }, 128 * 1024 * 1024)).toThrow(
      '页面过大，请降低图片清晰度后翻译',
    );
  });
});

describe('JsSourcePayload.kt：四个校验函数（E169 新补齐）', () => {
  const KT = kt('source/js/JsSourcePayload.kt');

  it('requiredArray 按字段名分三档文案；缺失 / 非数组都抛 ParseError', () => {
    expect(KT).toContain('fun requiredArray(data: JSONObject?, field: String): JSONArray = data?.opt(field) as? JSONArray');
    expect(KT).toContain('"comics" -> tr("搜索列表"); "images" -> tr("图片列表"); else -> tr("目录")');
    expect(requiredJsPayloadArray({ comics: [] }, 'comics')).toEqual([]);
    expect(requiredJsPayloadArray({ comics: [{ id: 1 }] }, 'comics')).toHaveLength(1);

    const comicsMessage = `源站返回的${tr('搜索列表')}格式异常，请更新书源或稍后重试`;
    expect(() => requiredJsPayloadArray({}, 'comics')).toThrow(comicsMessage);
    expect(() => requiredJsPayloadArray(null, 'comics')).toThrow(comicsMessage);
    expect(() => requiredJsPayloadArray({ comics: 'nope' }, 'comics')).toThrow(comicsMessage);
    expect(() => requiredJsPayloadArray({ images: null }, 'images')).toThrow(
      `源站返回的${tr('图片列表')}格式异常，请更新书源或稍后重试`,
    );
    expect(() => requiredJsPayloadArray({}, 'whatever')).toThrow(
      `源站返回的${tr('目录')}格式异常，请更新书源或稍后重试`,
    );
    // 抛的是 ParseError（不是普通 Error）
    try {
      requiredJsPayloadArray({}, 'comics');
      throw new Error('不该走到这里');
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
    }
  });

  it('chapters 反过来是宽容的：缺省 / null → 空数组，非数组才抛', () => {
    expect(KT).toContain('if (!data.has("chapters") || data.isNull("chapters")) return JSONArray()');
    expect(jsPayloadChapters({})).toEqual([]);
    expect(jsPayloadChapters({ chapters: null })).toEqual([]);
    expect(jsPayloadChapters({ chapters: [] })).toEqual([]);
    expect(jsPayloadChapters({ chapters: [{ id: '1' }] })).toHaveLength(1);
    expect(() => jsPayloadChapters({ chapters: { id: '1' } })).toThrow(ParseError);
    // 有 chapters 但不是数组时，文案用的是「目录」档
    expect(() => jsPayloadChapters({ chapters: 1 })).toThrow(`源站返回的${tr('目录')}格式异常`);
  });

  it('string：字符串 trim；数字只在 key==="id" 时转文本；其余空串', () => {
    expect(KT).toContain('is String -> value.trim()');
    expect(KT).toContain('is Number -> if (key == "id") value.toString() else ""');
    expect(jsPayloadString({ title: '  书名  ' }, 'title')).toBe('书名');
    expect(jsPayloadString({ id: 42 }, 'id')).toBe('42');
    expect(jsPayloadString({ pages: 42 }, 'pages')).toBe('');
    expect(jsPayloadString({ id: null }, 'id')).toBe('');
    expect(jsPayloadString({}, 'title')).toBe('');
    expect(jsPayloadString({ flag: true }, 'flag')).toBe('');
    expect(jsPayloadString(null, 'title')).toBe('');
  });

  it('images：任意一页为空 / 非字符串即整条失败，不做「跳过坏图」', () => {
    expect(KT).toContain('if (value.isNullOrBlank()) throw SourceException.ParseError(tr("源站图片列表包含缺失或异常的页面，请稍后重试"))');
    expect(jsPayloadImages({ images: [' a.jpg ', 'b.jpg'] })).toEqual(['a.jpg', 'b.jpg']);
    expect(jsPayloadImages({ images: [] })).toEqual([]);
    expect(() => jsPayloadImages({ images: ['a.jpg', '   '] })).toThrow(
      tr('源站图片列表包含缺失或异常的页面，请稍后重试'),
    );
    expect(() => jsPayloadImages({ images: ['a.jpg', 42] })).toThrow(ParseError);
    expect(() => jsPayloadImages({})).toThrow(`源站返回的${tr('图片列表')}格式异常`);
  });

  it('对外是 Kotlin `object JsSourcePayload` 的调用形状（四个成员）', () => {
    expect(Object.keys(JsSourcePayload)).toEqual(['requiredArray', 'chapters', 'string', 'images']);
    expect(JsSourcePayload.chapters({})).toEqual([]);
    expect(JsSourcePayload.images({ images: ['x'] })).toEqual(['x']);
  });
});

describe('NovelInfo.kt：13 个字段与全本小说源集合', () => {
  const KT = kt('source/NovelInfo.kt');

  it('13 个字段全可空；tags 默认空表', () => {
    for (const field of [
      'synopsis',
      'originalTitle',
      'status',
      'category',
      'latestChapter',
      'updatedAt',
      'wordCount',
      'publisher',
      'translation',
      'notice',
    ]) {
      expect(KT).toContain(`val ${field}: String? = null,`);
    }
    // 这两个是 Int?，不是 String?
    expect(KT).toContain('val chapterCount: Int? = null,');
    expect(KT).toContain('val volumeCount: Int? = null,');
    expect(KT).toContain('val tags: List<String> = emptyList(),');
    const info = createNovelInfo();
    expect(info.tags).toEqual([]);
    expect(info.synopsis).toBeNull();
    expect(info.chapterCount).toBeNull();
    expect(Object.keys(info)).toHaveLength(13);
  });

  it('revision 用 `|` 串四个字段；空值当空串', () => {
    expect(KT).toContain('val revision: String get()');
    expect(novelInfoRevision(createNovelInfo())).toBe('|||');
    expect(
      novelInfoRevision(
        createNovelInfo({ updatedAt: '2026-11-17', latestChapter: '第 9 章', chapterCount: 9, volumeCount: 2 }),
      ),
    ).toBe('2026-11-17|第 9 章|9|2');
  });

  it('hasRevision：两个非空字符串或两个数字任一成立', () => {
    expect(KT).toContain('val hasRevision: Boolean get()');
    expect(novelInfoHasRevision(createNovelInfo())).toBe(false);
    expect(novelInfoHasRevision(createNovelInfo({ updatedAt: '  ' }))).toBe(false);
    expect(novelInfoHasRevision(createNovelInfo({ updatedAt: 'x' }))).toBe(true);
    expect(novelInfoHasRevision(createNovelInfo({ latestChapter: 'x' }))).toBe(true);
    expect(novelInfoHasRevision(createNovelInfo({ chapterCount: 0 }))).toBe(true);
    expect(novelInfoHasRevision(createNovelInfo({ volumeCount: 0 }))).toBe(true);
  });

  it('WholeBookNovelSources = 5 个字面量 + PublicNovelSources.ids(quanben/ihuaben/sfacg/fanqie)', () => {
    expect(KT).toContain(
      'val ids = setOf("auto_novel", "wenku8_library", "ixdzs8", "xbookcn", "alicesw") + com.example.source.impl.PublicNovelSources.ids',
    );
    expect(KT).toContain('fun contains(id: String?) = id in ids');
    const kotlinPublic = kt('source/impl/PublicNovelSource.kt');
    expect(kotlinPublic).toContain('val ids = setOf("quanben", "ihuaben", "sfacg", "fanqie")');
    expect([...WholeBookNovelSources.ids].sort()).toEqual(
      ['alicesw', 'auto_novel', 'fanqie', 'ihuaben', 'ixdzs8', 'quanben', 'sfacg', 'wenku8_library', 'xbookcn'].sort(),
    );
    expect(WholeBookNovelSources.contains('fanqie')).toBe(true);
    expect(WholeBookNovelSources.contains('mangadex')).toBe(false);
    expect(WholeBookNovelSources.contains(null)).toBe(false);
  });

  it('UpdatableNovelSource.refreshNovelDetail 返回 SourceResult<SearchBook>', () => {
    expect(KT).toContain('interface UpdatableNovelSource : BookSource');
    expect(KT).toContain('suspend fun refreshNovelDetail(bookId: String): SourceResult<SearchBook>');
  });
});

describe('AliceSwDiscovery.kt：倒写域名 + 明文 https', () => {
  const KT = kt('source/impl/AliceSwDiscovery.kt');

  it('两条正则逐字：`r(\'…\')` 8–120 字符、https 主机', () => {
    expect(KT).toContain('private val REVERSED_LITERAL = Regex("""r\\(\'([^\']{8,120})\'\\)""")');
    expect(KT).toContain('private val HTTPS_HOST = Regex("""https://([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)""")');
    expect(KT).toContain('这里只做纯文本抽取，不执行页面脚本');
  });

  it('倒写字符串先 reverse 再取 https 主机；最后统一 lowercase / 去 www. / 只留 alicesw', () => {
    expect(KT).toContain('val reversed = match.groupValues[1].reversed()');
    expect(KT).toContain('val host = raw.lowercase().removePrefix("www.")');
    expect(KT).toContain('if (host.startsWith("alicesw") && !result.contains(host)) result.add(host)');

    // 「semoh.2wsecila.www//:sptth」反转 = https://www.alicesw2.homes
    const html = `<script>r('semoh.2wsecila.www//:sptth')</script>`;
    expect(AliceSwDiscovery.hosts(html)).toEqual(['alicesw2.homes']);
  });

  it('明文 https 地址也收；非 alicesw 的丢掉；重复只留一条；顺序 = 倒写在前', () => {
    const html = [
      "r('semoh.2wsecila.www//:sptth')",
      'https://alicesw.example.com/1',
      'https://www.alicesw2.homes/2',
      'https://other.example.com/3',
    ].join('\n');
    expect(AliceSwDiscovery.hosts(html)).toEqual(['alicesw2.homes', 'alicesw.example.com']);
  });

  it('没有候选时返回空数组（不抛错）', () => {
    expect(AliceSwDiscovery.hosts('')).toEqual([]);
    expect(AliceSwDiscovery.hosts('<html>nothing here</html>')).toEqual([]);
  });
});

describe('RuleBudget.kt：4096 / 128 / 2 MiB / 64', () => {
  const KT = kt('source/parser/RuleBudget.kt');

  it('规则长度 4096、嵌套符号计数 128', () => {
    expect(KT).toContain('require(rule.length<=4096) { tr("书源规则过长") }');
    expect(KT).toContain("require(rule.count { it=='@' || it=='&' || it=='|' }<=128) { tr(\"书源规则嵌套过多\") }");
    expect(MAX_RULE_LENGTH).toBe(4096);
    expect(MAX_NESTING).toBe(128);
    expect(() => validateRule('x'.repeat(4096))).not.toThrow();
    expect(() => validateRule('x'.repeat(4097))).toThrow('书源规则过长');
    expect(() => validateRule('@'.repeat(128))).not.toThrow();
    expect(() => validateRule('@'.repeat(129))).toThrow('书源规则嵌套过多');
    // 三种符号都计数
    expect(() => validateRule(`${'@&|'.repeat(43)}`)).toThrow('书源规则嵌套过多');
  });

  it('JSON：2 MiB 上限 + 只数未加引号的括号 + 深度 64', () => {
    expect(KT).toContain('require(value.length<=2*1024*1024) { tr("JSON 超过 2MiB") }');
    expect(KT).toContain("'{','[' -> { depth++; require(depth<=64) { tr(\"JSON 嵌套过深\") } }");
    expect(MAX_JSON_CHARS).toBe(2 * 1024 * 1024);
    expect(MAX_JSON_DEPTH).toBe(64);
    expect(() => validateJson('{'.repeat(64))).not.toThrow();
    expect(() => validateJson('{'.repeat(65))).toThrow('JSON 嵌套过深');
    expect(() => validateJson('"{"'.replace(/"/g, '"'))).not.toThrow();
    // 引号内的括号不计深度
    expect(() => validateJson(`{"a":"${'['.repeat(200)}"}`)).not.toThrow();
    // 转义引号不提前结束字符串
    expect(() => validateJson(`{"a":"\\"${'['.repeat(200)}"}`)).not.toThrow();
    expect(() => validateJson('x'.repeat(MAX_JSON_CHARS + 1))).toThrow('JSON 超过 2MiB');
  });

  it('text() 与 Bounded：2 MiB 上限 + 每 256 次读检查截止时间', () => {
    expect(KT).toContain('require(value.length<=2*1024*1024) { tr("规则输入超过 2MiB") }');
    expect(KT).toContain('if(++reads%256==0) check(');
    expect(KT).toContain('"书源正则执行超时"');
    expect(boundedText('short')).toBe('short');
    expect(() => boundedText('x'.repeat(MAX_JSON_CHARS + 1))).toThrow('规则输入超过 2MiB');
    // 已过期（millis = -1）立刻超时
    expect(() => boundedText('short', -1)).toThrow('书源正则执行超时');
  });
});

describe('SourceLog.kt：300 条环形缓冲与双层脱敏', () => {
  const KT = kt('source/SourceLog.kt');

  beforeEach(() => {
    SourceLog.clear();
    setLogSink(null);
  });

  it('上限 300；超出丢最早的；clear() 清空后回到「暂无」文案', () => {
    expect(KT).toContain('private const val MAX = 300');
    expect(KT).toContain('while (entries.size > MAX) entries.removeFirst()');
    expect(KT).toContain('（暂无书源请求日志，请先执行一次搜索）');
    expect(SourceLog.dump()).toBe('（暂无书源请求日志，请先执行一次搜索）');
    for (let i = 0; i < 305; i += 1) SourceLog.log('src', `line-${String(i)}`);
    const lines = SourceLog.dump().split('\n');
    expect(lines).toHaveLength(300);
    expect(lines[0]).toContain('line-5');
    expect(lines[299]).toContain('line-304');
    SourceLog.clear();
    expect(SourceLog.dump()).toBe('（暂无书源请求日志，请先执行一次搜索）');
  });

  it('URL 抹到 scheme://host/…；解析失败回落 [URL]', () => {
    expect(KT).toContain('"${u.scheme}://${u.host}/…"');
    expect(KT).toContain('getOrDefault("[URL]")');
    SourceLog.log('src', 'GET https://a.com/path?q=1 200');
    expect(SourceLog.dump()).toContain('GET https://a.com/… 200');
    expect(SourceLog.dump()).not.toContain('/path?q=1');
  });

  it('`k=v` 形式的密钥就地替换成 `k=[redacted]`', () => {
    expect(KT).toContain('"$1=[redacted]"');
    // 不含「被整体判定为敏感」的关键字组合时，只有值被替换
    SourceLog.log('src', 'token=abc123 ok');
    const line = SourceLog.dump();
    expect(line).toContain('[敏感信息已隐藏]');
    expect(line).not.toContain('abc123');
  });

  it('第 24 行判定的是**原始** message：命中即整行换成 [敏感信息已隐藏]', () => {
    expect(KT).toContain('if (Regex("(?i)(cookie|authorization|password|userkey|api[_-]?key|token)\\\\s*[:=]").containsMatchIn(message)) "[敏感信息已隐藏]"');
    SourceLog.log('src', 'Cookie: sid=1');
    expect(SourceLog.dump()).toContain('[敏感信息已隐藏]');
    expect(SourceLog.dump()).not.toContain('sid=1');
  });

  it('日志行格式 `MM-dd HH:mm:ss.SSS [source] text`；tag 固定 SourceLog；sink 可注入可关', () => {
    expect(KT).toContain('"${fmt.format(Date())} [$source] $redacted"');
    expect(KT).toContain('android.util.Log.i("SourceLog", line)');
    expect(SOURCE_LOG_TAG).toBe('SourceLog');
    const seen: string[] = [];
    setLogSink((tag, line) => seen.push(`${tag}|${line}`));
    SourceLog.log('src', 'hello');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^SourceLog\|\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \[src\] hello$/);
    setLogSink(null);
    SourceLog.log('src', 'quiet');
    expect(seen).toHaveLength(1);
    // 关掉 sink 后仍然进环形缓冲（dump 可见）
    expect(SourceLog.dump()).toContain('quiet');
  });
});

describe('LocalKeywordIndex.kt：5 字段种子', () => {
  const KT = kt('source/keyword/LocalKeywordIndex.kt');

  const seed = [
    '# 注释行跳过',
    '',
    'wuzhi\t无职转生\tMushoku Tensei\tむしょくてんせい\t mushoku tensei',
  ].join('\n');

  it('跳过空行与 #，字段数必须 5，否则 "Invalid keyword seed row"', () => {
    expect(KT).toContain('lines.filter { it.isNotBlank() && !it.startsWith("#") }');
    expect(KT).toContain('require(fields.size == 5) { "Invalid keyword seed row" }');
    expect(() => LocalKeywordIndex.fromText('a\tb\tc\td')).toThrow('Invalid keyword seed row');
    expect(() => LocalKeywordIndex.fromText('a\tb\tc\td\te\tf')).toThrow('Invalid keyword seed row');
  });

  it('四列语言按 zh/en/ja/romaji 顺序入表，`|` 分隔且空段丢弃', () => {
    expect(KT).toContain('fields[1].split(\'|\').filter { it.isNotBlank() }.forEach { add(KeywordName(it, "zh")) }');
    expect(KT).toContain('fields[2].split(\'|\').filter { it.isNotBlank() }.forEach { add(KeywordName(it, "en")) }');
    expect(KT).toContain('fields[3].split(\'|\').filter { it.isNotBlank() }.forEach { add(KeywordName(it, "ja")) }');
    expect(KT).toContain('fields[4].split(\'|\').filter { it.isNotBlank() }.forEach { add(KeywordName(it, "romaji")) }');
    const index = LocalKeywordIndex.fromText('one\t简|简二\t\tja\tr');
    const found = index.find('简二');
    expect(found).toHaveLength(1);
    expect(found[0]?.names).toEqual([
      { text: '简', language: 'zh' },
      { text: '简二', language: 'zh' },
      { text: 'ja', language: 'ja' },
      { text: 'r', language: 'romaji' },
    ]);
  });

  it('concept id = `seed:<第 0 列>:<匹配化后的第一个中文名>`，source = curated-v1', () => {
    expect(KT).toContain('KeywordConcept("seed:${fields[0]}:${KeywordKeys.match(fields[1].substringBefore(\'|\'))}", names, "curated-v1")');
    const index = LocalKeywordIndex.fromText('wuzhi\t無職転生|无职转生\tMushoku\tむしょく\tmushoku');
    const first = index.find('無職転生')[0];
    expect(first?.source).toBe('curated-v1');
    expect(first?.id.startsWith('seed:wuzhi:')).toBe(true);
    // 同一 concept 可从任一名字命中，且只出现一次
    expect(index.find('无职转生')).toHaveLength(1);
    expect(index.find('mushoku')).toHaveLength(1);
    expect(index.find('不存在')).toEqual([]);
  });

  it('注释与空行不产生任何条目', () => {
    expect(KT).toContain('class LocalKeywordIndex(reader: Reader)');
    const index = LocalKeywordIndex.fromText(`${seed}\n#another comment\n`);
    expect(index.find('Mushoku Tensei')).toHaveLength(1);
    expect(index.find('#another comment')).toEqual([]);
  });
});
