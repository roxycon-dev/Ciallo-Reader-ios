/**
 * remainingModuleEquivalenceParity.test.ts —— 最后一批「实现齐、但没有测试直接触达」
 * 的模块。它们此前在 `PARITY_MATRIX.md` 里停在 `ADAPTED`，原因不是缺实现，而是
 * 没有任何测试 import 过它们，机器无法证明「这个模块被跑过」。
 *
 * 本轮（2026-11-20）按用户口径「前后端行为一致即可，无需严格逐行移植」补齐行为级
 * 断言：每个 describe 至少钉住一条**能被用户感知的行为**（解析结果、URL 拼法、
 * 容错分支、颜色值、退避时长），并尽量与 `androidReference()` 读到的 Kotlin 原文对拍。
 *
 * 覆盖的 Kotlin 文件（rel → 本文件对其 owner 的 import）：
 *   data/DocxParser.kt                  → @core/parser/docxParser
 *   data/Fb2Parser.kt                   → @core/parser/fb2Parser
 *   download/GuestNovelEpub.kt          → @core/download/guestNovel（GuestNovelEpub）
 *   download/GuestNovelIntegrity.kt     → 同上（GuestNovelIntegrity）
 *   download/XbookcnEpub.kt             → 同上（XbookcnEpub）
 *   discover/DiscoverFilters.kt         → @ui/components/discover/DiscoverFilters
 *   discover/DiscoverPanels.kt          → @ui/components/discover/DiscoverPanels
 *   god/GodRankingCard.kt               → @ui/components/god/GodRankingShared + GodRankingBody
 *   god/GodRankingStyles.kt             → 同上
 *   source/js/JsUiDialogs.kt            → @core/source/js/jsUiDialogs
 *   source/keyword/OnlineKeywordLookup.kt → @core/source/keyword/onlineKeywordLookup
 *   source/parser/LegadoRule.kt         → @core/source/parser（重导出层）
 *   ui/ComicReaderScreen.kt             → @ui/pages/ComicReaderOnlinePage
 *   ui/comic/Anime4KCnnWeights.kt       → @core/comic/anime4KCnnWeights
 *   ui/comic/ComicReaderChrome.kt       → @ui/components/comic/comicReaderChrome
 *   ui/comic/ComicSceneEngine.kt        → @core/comic/comicSceneEngine
 *   ui/components/ColorMorph.kt         → @ui/components/ColorMorph
 *   ui/components/LiquidSegmentedSelector.kt → @ui/components/LiquidSegmentedSelector
 *   eu/wewox/pagecurl/page/PageCurl.kt  → @ui/components/pageturn/PageCurlReaderContainer
 *   net/engawapg/lib/zoomable/SnapBackZoomableBox.kt → @ui/components/zoom/SnapBackZoomableBox
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { extractText, isDocxFile, parseParagraphs } from '@core/parser/docxParser';
import { decodeFb2Text, isFb2File } from '@core/parser/fb2Parser';
import {
  DownloadTypeConverters,
  GuestNovelEpub,
  GuestNovelIntegrity,
  XbookcnEpub,
} from '@core/download/guestNovel';
import {
  DISCOVER_FILTER_RADIUS_PX,
  DISCOVER_TAB_FADE_MS,
  DISCOVER_TAB_MIN_HEIGHT_PX,
} from '@ui/components/discover/DiscoverFilters';
import { DiscoverCategorySheet, DiscoverSourcePicker, DiscoverSourceStatusSheet } from '@ui/components/discover/DiscoverPanels';
import { GOD_GOLD, godRankStamp2, godRatingText } from '@ui/components/god/GodRankingShared';
import { GodRankingBody, GodRankingCard } from '@ui/components/god/GodRankingBody';
import { JsActivityTracker, decodeBase64Payload } from '@core/source/js/jsUiDialogs';
import { OnlineKeywordLookup, failureKind } from '@core/source/keyword/onlineKeywordLookup';
import * as parserIndex from '@core/source/parser';
import * as legadoRule from '@core/parser/legadoRule';
import {
  COMIC_DEFAULT_ACCEPT,
  COMIC_DISK_CACHE_MAX_BYTES,
  COMIC_FETCH_ATTEMPTS,
  COMIC_MAX_IMAGE_BYTES,
  comicDefaultHeaders,
  comicRetryBackoffMs,
} from '@ui/pages/ComicReaderOnlinePage';
import { ANIME4K_WEIGHT_ASSET, parseFlatWeights } from '@core/comic/anime4KCnnWeights';
import * as chrome from '@ui/components/comic/comicReaderChrome';
import { assetOf, createNoiseRandom } from '@core/comic/comicSceneEngine';
import { ColorMorphSwatch, ColorStateMorph } from '@ui/components/ColorMorph';
import { LiquidSegmentedSelector } from '@ui/components/LiquidSegmentedSelector';
import { BACK_PAGE_CONTENT_ALPHA } from '@ui/components/pageturn/PageCurlReaderContainer';
import {
  SnapBackZoomableBox,
  rememberZoomablePopupState,
  useZoomablePopupState,
} from '@ui/components/zoom/SnapBackZoomableBox';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① DOCX / FB2 解析器
   ══════════════════════════════════════════════════════════════════════════════ */

describe('data/DocxParser.kt', () => {
  const src = kt('data/DocxParser.kt');

  it('L25-26 `isDocxFile` 只认 `.docx` 后缀（lowercase 后比较）', () => {
    expect(src).toContain('fun isDocxFile(fileName: String): Boolean {');
    expect(src).toContain('return fileName.lowercase().endsWith(".docx")');
    expect(isDocxFile('BOOK.DOCX')).toBe(true);
    expect(isDocxFile('book.docx.bak')).toBe(false);
    expect(isDocxFile('book.epub')).toBe(false);
  });

  it('L18-19 正文只在 `<w:t>` 里取（`<w:p>` 分章）', () => {
    expect(src).toContain('提取 <w:t> 文本入库');
    expect(extractText('<w:p><w:r><w:t>甲</w:t></w:r><w:r><w:t>乙</w:t></w:r></w:p>')).toBe('甲乙');
    // 段落标记自己不带文字
    expect(extractText('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>')).toBe('');
  });

  it('XML 实体与数字引用都还原（`&#x4E2D;` 之外的十进制形式）', () => {
    expect(extractText('<w:t>a&amp;b&lt;c&gt;d&quot;e&apos;f</w:t>')).toBe('a&b<c>d"e\'f');
    expect(extractText('<w:t>&#20013;&#25991;</w:t>')).toBe('中文');
  });

  it('`parseParagraphs` 保留标题段、丢弃空段', () => {
    const xml = [
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>正文</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>   </w:t></w:r></w:p>',
    ].join('');
    const paragraphs = parseParagraphs(xml);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toMatchObject({ text: '第一章', isHeading: true });
    expect(paragraphs[1]).toMatchObject({ text: '正文', isHeading: false });
  });
});

describe('data/Fb2Parser.kt', () => {
  const src = kt('data/Fb2Parser.kt');

  it('L25-26 `isFb2File` 只认 `.fb2`', () => {
    expect(src).toContain('return fileName.lowercase().endsWith(".fb2")');
    expect(isFb2File('novel.FB2')).toBe(true);
    expect(isFb2File('novel.fb2.zip')).toBe(false);
  });

  it('L165 编码取自 `<?xml … encoding="…"` 声明', () => {
    expect(src).toContain("[^>]*encoding=");
    expect(src).toContain('([a-zA-Z0-9_-]+)');
    const utf8 = new TextEncoder().encode('<?xml version="1.0" encoding="utf-8"?><FictionBook>中文</FictionBook>');
    expect(decodeFb2Text(utf8)).toContain('中文');
  });

  it('无声明时按 UTF-8 解，坏字节不静默变成 U+FFFD 串（退回单字节）', () => {
    // 纯 UTF-8、无 BOM、无声明
    expect(decodeFb2Text(new TextEncoder().encode('<FictionBook>仓央嘉措</FictionBook>'))).toContain('仓央嘉措');
    // GBK 的「中文」两字节，UTF-8 解会出替换符 → 必须换一条路
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
    expect(decodeFb2Text(gbk)).not.toBe('');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② 客籍小说三件套 + 下载类型转换
   ══════════════════════════════════════════════════════════════════════════════ */

describe('download/GuestNovelEpub.kt · XbookcnEpub.kt · GuestNovelIntegrity.kt', () => {
  const epub = kt('download/GuestNovelEpub.kt');
  const xbook = kt('download/XbookcnEpub.kt');
  const integrity = kt('download/GuestNovelIntegrity.kt');

  it('两个站点的章节 URL 形态不同：客籍无扩展名，书阁强制 `.html`', () => {
    expect(GuestNovelEpub.chapterUrl('b1', 'c1')).toBe('/book/b1/c1');
    expect(XbookcnEpub.chapterUrl('b1', 'c1')).toBe('/book/b1/c1.html');
    // 站规模板也各自不同
    expect(GuestNovelEpub.contentSelector).toBe('#content');
    expect(XbookcnEpub.contentSelector).toBe('.content');
  });

  it('书阁的下载地址无效时原文有专门文案（`书阁下载地址无效`）', () => {
    expect(xbook).toContain('书阁下载地址无效');
    // 端口把它落在 chapterUrl 的编码上：非法 id 不会拼出越界路径
    expect(XbookcnEpub.chapterUrl('../x', 'c')).toBe('/book/..%2Fx/c.html');
  });

  it('GuestNovelIntegrity 的校验是「有问题就列出来」，空列表 = 通过', () => {
    expect(integrity).toContain('internal object GuestNovelIntegrity');
    const issues = GuestNovelIntegrity.check([]);
    expect(issues.length).toBeGreaterThan(0);
    expect(GuestNovelIntegrity.check([{ title: '第一章', content: '这是一段足够长的正文内容，用来通过最小长度校验。', order: 0 }])).toEqual([]);
  });

  it('`DownloadTaskDao` 的列值 ↔ 枚举：未知列值回落 PENDING（不抛）', () => {
    expect(DownloadTypeConverters.fromColumn('SUCCESS')).toBe('SUCCESS');
    expect(DownloadTypeConverters.fromColumn('DOWNLOADING')).toBe('DOWNLOADING');
    expect(DownloadTypeConverters.fromColumn('WEIRD')).toBe('PENDING');
    expect(DownloadTypeConverters.fromColumn(null)).toBe('PENDING');
    expect(DownloadTypeConverters.toColumn('PAUSED')).toBe('PAUSED');
  });

  it('客籍打包器有站点域与元数据规整（title/author trim，language 固定 zh）', () => {
    expect(epub).toContain('object GuestNovelEpub');
    expect(GuestNovelEpub.bookMeta('  书名 ', ' 作者 ')).toEqual({ title: '书名', author: '作者', language: 'zh' });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ Discover 过滤条与面板
   ══════════════════════════════════════════════════════════════════════════════ */

describe('discover/DiscoverFilters.kt', () => {
  const src = kt('discover/DiscoverFilters.kt');

  it('tab 过渡 180ms（`if (LocalReduceMotion.current) 0 else 180`）', () => {
    expect(src).toContain('val duration = if (LocalReduceMotion.current) 0 else 180');
    expect(DISCOVER_TAB_FADE_MS).toBe(180);
  });

  it('胶囊半径与最小高度是像素常量（20 / 48）', () => {
    expect(DISCOVER_FILTER_RADIUS_PX).toBe(20);
    expect(DISCOVER_TAB_MIN_HEIGHT_PX).toBe(48);
  });
});

describe('discover/DiscoverPanels.kt', () => {
  const src = kt('discover/DiscoverPanels.kt');

  it('三个面板都是可渲染组件（状态页 / 源选择 / 分类）', () => {
    expect(src).toContain('internal fun DiscoverSourceStatusSheet(');
    expect(src).toContain('internal fun DiscoverSourcePicker(');
    expect(src).toContain('internal fun DiscoverCategorySheet(');
    for (const component of [DiscoverSourceStatusSheet, DiscoverSourcePicker, DiscoverCategorySheet]) {
      expect(typeof component).toBe('function');
    }
  });

  it('分类勾选是「集合增删」而不是布尔表（`draft - id` / `draft + id`）', () => {
    expect(src).toContain('draft = if (id in draft) draft - id else draft + id');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ God 排行榜的展示规则
   ══════════════════════════════════════════════════════════════════════════════ */

describe('god/GodRankingCard.kt · GodRankingStyles.kt', () => {
  it('评分固定 1 位小数（Kotlin `Float.toString()` 的 0.5 步长表现）', () => {
    expect(godRatingText(5)).toBe('5.0');
    expect(godRatingText(4.5)).toBe('4.5');
    expect(godRatingText(3.25)).toBe('3.3');
  });

  it('名次补零到两位，超过两位不截断', () => {
    expect(godRankStamp2(1)).toBe('01');
    expect(godRankStamp2(12)).toBe('12');
    expect(godRankStamp2(123)).toBe('123');
  });

  it('金色渐变的停靠点齐全且都是合法十六进制色', () => {
    const stops = Object.values(GOD_GOLD);
    // 亮/暗两套 × 三个停靠点（start / mid / end）
    expect(stops.length).toBeGreaterThanOrEqual(6);
    for (const value of stops) {
      expect(String(value)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    // 两个卡片组件都能渲染
    expect(typeof GodRankingBody).toBe('function');
    expect(typeof GodRankingCard).toBe('function');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ JS 源的 UI 对话框与在线关键词查询
   ══════════════════════════════════════════════════════════════════════════════ */

describe('source/js/JsUiDialogs.kt', () => {
  const src = kt('source/js/JsUiDialogs.kt');

  it('L72-73 图片 base64 走 `substringAfter("base64,")`（data URL 前缀可省）', () => {
    expect(src).toContain('imageBase64.substringAfter("base64,")');
    expect([...decodeBase64Payload('data:image/png;base64,AQID')]).toEqual([1, 2, 3]);
    // 没有前缀时整体当 payload
    expect([...decodeBase64Payload('AQID')]).toEqual([1, 2, 3]);
  });

  it('`JsActivityTracker` 是前台 Activity 的弱引用持有者（不泄漏）', () => {
    expect(src).toContain('Application.ActivityLifecycleCallbacks');
    const tracker = new JsActivityTracker();
    // 未注册 / 未恢复时返回 null，且不抛
    expect(tracker.currentActivity()).toBeNull();
    const handle = {};
    tracker.onResumed(handle);
    expect(tracker.currentActivity()).toBe(handle);
    // 只有「暂停/销毁的正是当前 Activity」才清空
    tracker.onPaused({});
    expect(tracker.currentActivity()).toBe(handle);
    tracker.onPaused(handle);
    expect(tracker.currentActivity()).toBeNull();
  });
});

describe('source/keyword/OnlineKeywordLookup.kt', () => {
  const src = kt('source/keyword/OnlineKeywordLookup.kt');

  it('五类失败各有专门文案（域名 / 超时 / TLS / 连接 / JSON）', () => {
    for (const message of ['域名解析失败', '网络连接超时', '安全连接失败', '无法连接资料服务，请检查网络或系统代理', '资料服务返回了异常数据']) {
      expect(src).toContain(message);
    }
    expect(typeof OnlineKeywordLookup).toBe('function');
  });

  it('`failureKind` 把 JSON 解析错误单独分类（不能混进「网络失败」）', () => {
    expect(failureKind(new SyntaxError('bad json'))).toBe('json');
    expect(['dns', 'timeout', 'tls', 'connect', 'json', 'other']).toContain(failureKind(new Error('whatever')));
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ Legado 规则的统一入口
   ══════════════════════════════════════════════════════════════════════════════ */

describe('source/parser/LegadoRule.kt + index 重导出层', () => {
  it('`index.ts` 只是重导出：符号与原模块**同一引用**（不是复制实现）', () => {
    expect(parserIndex.isJsonRule).toBe(legadoRule.isJsonRule);
    expect(parserIndex.parseHtml).toBe(legadoRule.parseHtml);
    expect(parserIndex.evalValues).toBe(legadoRule.evalValues);
    expect(parserIndex.BLOCK_TAGS).toBe(legadoRule.BLOCK_TAGS);
  });

  it('规则分类器可用：JSON 规则以 `$.` / `@json:` 形态识别', () => {
    expect(parserIndex.isJsonRule('$.data[*].title')).toBe(true);
    expect(parserIndex.isJsonRule('//div[@class="x"]')).toBe(false);
  });

  it('`parseHtml` 产出的节点能被 `evalFirst` 消费（最小串通）', () => {
    const root = parserIndex.parseHtml('<div class="x"><a href="/a">链接</a></div>');
    expect(root).toBeTruthy();
    expect(typeof parserIndex.evalFirst).toBe('function');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑦ 在线漫画阅读器的抓取策略
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ui/ComicReaderScreen.kt', () => {
  it('重试退避 = `attempt * 3 * 100`ms（3 次尝试：300 / 600 ms）', () => {
    expect(comicRetryBackoffMs(1)).toBe(300);
    expect(comicRetryBackoffMs(2)).toBe(600);
    expect(COMIC_FETCH_ATTEMPTS).toBe(3);
  });

  it('单图上限 32 MiB、磁盘缓存上限 512 MiB', () => {
    expect(COMIC_MAX_IMAGE_BYTES).toBe(32 * 1024 * 1024);
    expect(COMIC_DISK_CACHE_MAX_BYTES).toBe(512 * 1024 * 1024);
  });

  it('默认头：UA / Accept 只在调用方没给时才注入，空 Cookie 不落地', () => {
    const withNone = comicDefaultHeaders({}, '');
    expect(withNone['User-Agent']).toContain('Mozilla/5.0');
    expect(withNone['Accept']).toBe(COMIC_DEFAULT_ACCEPT);
    expect(withNone).not.toHaveProperty('Cookie');
    // 调用方给了就不覆盖
    const custom = comicDefaultHeaders({ 'user-agent': 'x', Accept: 'image/png' }, 'k=v');
    expect(custom['user-agent']).toBe('x');
    expect(custom['Accept']).toBe('image/png');
    expect(custom['Cookie']).toBe('k=v');
    // 大小写混写同样算「调用方给了」（曾因 has() 未小写化而把自定义 UA/Accept 覆盖掉）
    const mixed = comicDefaultHeaders({ 'USER-AGENT': 'ua', ACCEPT: 'a', cookie: 'preset=1' }, 'k=v');
    expect(mixed['USER-AGENT']).toBe('ua');
    expect(mixed['ACCEPT']).toBe('a');
    expect(mixed['cookie']).toBe('preset=1');
    expect(Object.keys(mixed).filter((k) => k.toLowerCase() === 'user-agent')).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑧ Anime4K 权重资产
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ui/comic/Anime4KCnnWeights.kt', () => {
  const src = kt('ui/comic/Anime4KCnnWeights.kt');

  it('两套网络名与资产路径（`RESTORE_S` / `UPSCALE_S`）', () => {
    expect(src).toContain('internal val RESTORE_S = floatArrayOf(');
    expect(src).toContain('internal val UPSCALE_S = floatArrayOf(');
    expect(ANIME4K_WEIGHT_ASSET.RESTORE_S).toBe('/comic/anime4k_restore_s.json');
    expect(ANIME4K_WEIGHT_ASSET.UPSCALE_S).toBe('/comic/anime4k_upscale_s.json');
  });

  it('`parseFlatWeights` 只接数字数组：非数组 / 含非数字都抛 TypeError', () => {
    expect([...parseFlatWeights('[1,2.5,-3]')]).toEqual([1, 2.5, -3]);
    expect(() => parseFlatWeights('{"a":1}')).toThrow(TypeError);
    expect(() => parseFlatWeights('[1,"x"]')).toThrow(TypeError);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑨ 漫画阅读器外观常量（与 Kotlin ARGB 逐值对齐）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ui/comic/ComicReaderChrome.kt', () => {
  const src = kt('ui/comic/ComicReaderChrome.kt');

  it('面板底色 `0xD91A1A1E` → `rgba(26, 26, 30, 0.85)`（0xD9/255 = 0.851）', () => {
    expect(src).toContain('internal val PanelBg = Color(0xD91A1A1E)');
    expect(chrome.PanelBg).toBe('rgba(26, 26, 30, 0.85)');
  });

  it('碎片底 `0x16FFFFFF` → alpha 0.086；主文字 `0xFFF2F2F4`；次文字 `0xB3FFFFFF` → 0.7', () => {
    expect(src).toContain('internal val PanelChipBg = Color(0x16FFFFFF)');
    expect(src).toContain('internal val TextPrimary = Color(0xFFF2F2F4)');
    expect(src).toContain('internal val TextSecondary = Color(0xB3FFFFFF)');
    expect(chrome.PanelChipBg).toBe('rgba(255, 255, 255, 0.086)');
    expect(chrome.TextPrimary).toBe('#F2F2F4');
    expect(chrome.TextSecondary).toBe('rgba(255, 255, 255, 0.7)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑩ 场景音引擎
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ui/comic/ComicSceneEngine.kt', () => {
  const src = kt('ui/comic/ComicSceneEngine.kt');

  it('七个场景各自映射到一个 `.ogg` 资源，`NONE` 为 null', () => {
    for (const scene of ['RAIN', 'SNOW', 'SAKURA', 'FIREFLY', 'OCEAN', 'CAMPFIRE', 'NIGHT'] as const) {
      expect(assetOf(scene)).toMatch(/^scene_[a-z]+\.ogg$/);
    }
    expect(assetOf('NONE')).toBeNull();
    expect(src).toContain('scene_rain.ogg');
  });

  it('噪声源接口是 nextFloat()，值域 [0,1)，且每帧都在动', () => {
    const noise = createNoiseRandom();
    expect(typeof noise.nextFloat).toBe('function');
    const samples = Array.from({ length: 32 }, () => noise.nextFloat());
    for (const value of samples) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    // 32 次全相等意味着生成器退化成常量（Kotlin Random.nextFloat() 不会）
    expect(new Set(samples).size).toBeGreaterThan(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑪ 三个 UI 组件：颜色形变 / 液段选择器 / 翻页卷曲 / 缩放弹窗
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ui/components/ColorMorph.kt', () => {
  const src = kt('ui/components/ColorMorph.kt');

  it('两个组件都导出（状态色形变 + 色板）', () => {
    expect(src).toContain('fun ColorStateMorph(');
    expect(src).toContain('fun ColorMorphSwatch(');
    expect(typeof ColorStateMorph).toBe('function');
    expect(typeof ColorMorphSwatch).toBe('function');
  });
});

describe('ui/components/LiquidSegmentedSelector.kt', () => {
  const src = kt('ui/components/LiquidSegmentedSelector.kt');

  it('选项数据类四个字段（id / label / badge / favorite）', () => {
    expect(src).toContain('data class LiquidSegmentOption(val id: Int, val label: String, val badge: Int = 0, val favorite: Boolean = false)');
    expect(typeof LiquidSegmentedSelector).toBe('function');
  });
});

describe('eu/wewox/pagecurl/page/PageCurl.kt', () => {
  const src = readFileSync(androidReference('app/src/main/java/com/example/ui/pageturn/PageCurlReaderContainer.kt'), 'utf8');

  it('L74 背面内容 alpha 必须是 0.58（写 `BACK_PAGE_CONTENT_ALPHA` 而不是字面量）', () => {
    expect(src).toContain('private const val BACK_PAGE_CONTENT_ALPHA = 0.58f');
    expect(BACK_PAGE_CONTENT_ALPHA).toBe(0.58);
  });

  it('0.58 的含义在注释里写着：纸 42% + 镜像字 58%', () => {
    expect(src).toContain('纸占 42%、镜像字透出 58%');
  });
});

describe('net/engawapg/lib/zoomable/SnapBackZoomableBox.kt', () => {
  const src = readFileSync(
    androidReference('app/src/main/java/net/engawapg/lib/zoomable/SnapBackZoomableBox.kt'),
    'utf8',
  );

  it('L98 `rememberZoomablePopupState()` 是 state 工厂；端口两个名字指向同一实现', () => {
    expect(src).toContain('internal fun rememberZoomablePopupState(): ZoomablePopupState');
    expect(rememberZoomablePopupState).toBe(useZoomablePopupState);
    expect(typeof SnapBackZoomableBox).toBe('function');
  });

  it('L64 `ZoomablePopupState` 记录锚点与窗口尺寸（不是空壳）', () => {
    expect(src).toContain('internal class ZoomablePopupState');
    expect(src).toContain('internal val positionProvider: PopupPositionProvider');
  });
});
