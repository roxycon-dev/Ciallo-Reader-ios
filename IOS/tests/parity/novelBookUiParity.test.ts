/**
 * novelBookUiParity.test.ts —— 小说搜索卡与详情面板（`library/NovelBookUi.kt`，470 行）。
 *
 * 本轮修掉的三类问题：
 *   ① **文案没本地化**：`novelDownloadLabel` 六个分支里五个在 Kotlin 包了 `tr(...)`
 *      （只有「整本下载 N%」是裸串），`novelDetailFacts` 六个标签同理 —— 端口全返回中文，
 *      英文界面下这些行仍是中文。
 *   ② **详情封面尺寸**：Kotlin `coverWidth = if (wide) 150.dp else 118.dp`，高 = 宽 × 1.4；
 *      端口写死 `106×150`（宽与比例都不对）。
 *   ③ **详情排版**：标题 `headlineSmall` + 28/24sp ExtraBold（端口 20px/700）、
 *      作者 bodyMedium(14sp)（端口 16px）、事实卡两层 14dp 间距（端口只有行内 12）、
 *      简介 `maxLines = 7` 折叠（端口缺规则）、提示条 `secondaryContainer@.6`（端口 `.12`）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DownloadStatePending,
  downloadingState,
  errorState,
  pausedState,
  successState,
} from '@core/download/downloadState';
import {
  chunkFactsIntoRows,
  novelAccentColor,
  novelActionColors,
  novelAuthorLine,
  novelDetailFacts,
  novelDetailLabels,
  novelDownloadLabel,
  novelSearchFacts,
  novelSearchLabels,
} from '@core/library/libraryDisplay';

import { novelCoverRequest } from '@core/library/uiHelpers';
import { favoriteCoverRequest } from '@core/ui/designTokens';
import { lerpColor } from '@core/glass/color';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/library/NovelBookUi.kt'),
  'utf8',
);
const TSX = readFileSync('src/ui/pages/LibraryPage.tsx', 'utf8');
const CSS = readFileSync('src/styles/library.css', 'utf8');

describe('NovelBookUi.kt：六态下载文案（五个包 tr）', () => {
  it('Success / Pending / Paused / Error(两分支) / 默认 都走 tr；只有百分比是裸串', () => {
    expect(KT).toContain('is DownloadState.Success -> tr("已在书架 · 离线阅读")');
    expect(KT).toContain('is DownloadState.Pending -> tr("正在准备整本下载")');
    expect(KT).toContain('is DownloadState.Paused -> tr("整本下载已暂停")');
    expect(KT).toContain('is DownloadState.Error -> if (downloaded) tr("可读离线版本 · 更新下载失败") else tr("下载失败 · 点开重试")');
    expect(KT).toContain('else -> if (downloaded) tr("已在书架 · 离线阅读") else tr("查看详情 · 整本下载")');
    // 百分比那一条**没有** tr（Kotlin 原文如此）
    expect(KT).toContain('is DownloadState.Downloading -> "整本下载 ${(state.progress * 100).toInt()}%"');
  });

  it('六种状态各自对应一句，互不串台', () => {
    expect(novelDownloadLabel(successState('/x.epub'), false)).toBe('已在书架 · 离线阅读');
    expect(novelDownloadLabel(downloadingState(1, 10, 0.42), false)).toBe('整本下载 42%');
    expect(novelDownloadLabel(DownloadStatePending, false)).toBe('正在准备整本下载');
    expect(novelDownloadLabel(pausedState(1, 10), false)).toBe('整本下载已暂停');
    expect(novelDownloadLabel(errorState('boom'), false)).toBe('下载失败 · 点开重试');
    expect(novelDownloadLabel(errorState('boom'), true)).toBe('可读离线版本 · 更新下载失败');
    // Idle + 已下载 → 已在书架；未下载 → 查看详情
    expect(novelDownloadLabel(DownloadStatePending, true)).toBe('正在准备整本下载');
    const distinct = new Set([
      novelDownloadLabel(successState(''), false),
      novelDownloadLabel(pausedState(0, 0), false),
      novelDownloadLabel(errorState(''), false),
    ]);
    expect(distinct.size).toBe(3);
  });

  it('百分比是截断（`toInt()`），不是四舍五入', () => {
    expect(novelDownloadLabel(downloadingState(0, 0, 0.999), false)).toBe('整本下载 99%');
    expect(novelDownloadLabel(downloadingState(0, 0, 0.005), false)).toBe('整本下载 0%');
  });

  it('文案走 tr(...)，不是裸中文字符串（英文界面不再露中文）', () => {
    expect(TSX).toContain('novelDownloadLabel(');
    const src = readFileSync('src/core/library/libraryDisplay.ts', 'utf8');
    expect(src).toContain("return tr('已在书架 · 离线阅读');");
    expect(src).toContain("return tr('正在准备整本下载');");
    expect(src).toContain("return tr('整本下载已暂停');");
    expect(src).toContain("tr('可读离线版本 · 更新下载失败')");
    expect(src).toContain("tr('查看详情 · 整本下载')");
    // 百分比那条保持裸串（与 Kotlin 一致）
    expect(src).toContain('return `整本下载 ${String(Math.trunc(state.progress * 100))}%`;');
  });
});

describe('NovelBookUi.kt：accent / action 配色', () => {
  it('accent：surface 亮度 < .3 → 白 35%，否则黑 18%', () => {
    expect(KT).toContain('if (MaterialTheme.colorScheme.surface.luminance() < .3f) lerp(primary, Color.White, .35f)');
    expect(KT).toContain('else lerp(primary, Color.Black, .18f)');
    // 深底提亮、浅底压暗（两条分支方向相反），且与 lerpColor 同参
    const dark = novelAccentColor('#059669', '#111111');
    const light = novelAccentColor('#059669', '#FFFFFF');
    expect(dark).toBe(lerpColor('#059669', '#FFFFFF', 0.35));
    expect(light).toBe(lerpColor('#059669', '#000000', 0.18));
    expect(dark).not.toBe(light);
  });

  it('action：底 = primary 混黑 12%，文字按亮度阈值 .179 选 #111111 / 白', () => {
    expect(KT).toContain('val background = lerp(MaterialTheme.colorScheme.primary, Color.Black, .12f)');
    expect(KT).toContain('contentColor = if (background.luminance() > .179f) Color(0xFF111111) else Color.White');
    expect(novelActionColors('#10B981').container).toBe(lerpColor('#10B981', '#000000', 0.12));
    expect(novelActionColors('#10B981').content).toBe('#111111');
    expect(novelActionColors('#052E22').content).toBe('#FFFFFF');
  });
});

describe('NovelBookUi.kt：封面与标签', () => {
  it('封面 r12 + primary@.22 → secondaryContainer 渐变；占位 10dp / 图标 18 / 标题 12sp 5 行 / 格式 9sp', () => {
    expect(KT).toContain('.clip(RoundedCornerShape(12.dp))');
    expect(KT).toContain('MaterialTheme.colorScheme.primary.copy(alpha = .22f), MaterialTheme.colorScheme.secondaryContainer');
    expect(KT).toContain('Column(Modifier.fillMaxSize().padding(10.dp)');
    expect(KT).toContain('Modifier.size(18.dp)');
    expect(KT).toContain('fontSize = 12.sp, maxLines = 5');
    expect(KT).toContain('Text(book.format.uppercase(), fontSize = 9.sp');
    expect(CSS).toContain('border-radius: 12px;');
  });

  it('封面请求带两个站点的 Referer（ixdzs8 / wenku8_library）', () => {
    expect(KT).toContain('"ixdzs8" -> addHeader("Referer", "https://ixdzs8.com/")');
    expect(KT).toContain('"wenku8_library" -> addHeader("Referer", "https://wenku8.ywy.moe/")');
    // 端口把 Kotlin 的一个 ImageRequest 拆成两支：本地路径归一 + Referer 头。
    expect(novelCoverRequest('/data/x.jpg')).toBe('file:///data/x.jpg');
    expect(novelCoverRequest('https://a/b.jpg')).toBe('https://a/b.jpg');
    expect(novelCoverRequest('   ')).toBeNull();
    expect(
      favoriteCoverRequest({ data: 'https://a/b.jpg', sourceId: 'ixdzs8', attempt: 0 }).headers.Referer,
    ).toBe('https://ixdzs8.com/');
    expect(
      favoriteCoverRequest({ data: 'https://a/b.jpg', sourceId: 'wenku8_library', attempt: 0 }).headers.Referer,
    ).toBe('https://wenku8.ywy.moe/');
    expect(
      favoriteCoverRequest({ data: 'https://a/b.jpg', sourceId: 'other', attempt: 0 }).headers,
    ).toEqual({});
  });

  it('标签：间距 6、11sp、primary@.08、7×4 内边距，去重且跳过空白', () => {
    expect(KT).toContain('labels.filter(String::isNotBlank).distinct()');
    expect(KT).toContain('horizontalArrangement = Arrangement.spacedBy(6.dp)');
    expect(KT).toContain('fontSize = 11.sp');
    expect(KT).toContain('MaterialTheme.colorScheme.primary.copy(alpha = .08f)');
    expect(KT).toContain('.padding(horizontal = 7.dp, vertical = 4.dp)');
  });
});

describe('NovelBookUi.kt：搜索卡结构', () => {
  it('卡 r20 / surface / 1dp 描边 / 14dp 内边距与列间距 / 封面 86×124 / 文本 6dp 间距', () => {
    expect(KT).toContain('clip(RoundedCornerShape(20.dp))');
    expect(KT).toContain('color = MaterialTheme.colorScheme.surface');
    expect(KT).toContain('tonalElevation = 1.dp');
    expect(KT).toContain('Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp))');
    expect(KT).toContain('Modifier.width(86.dp).height(124.dp)');
    expect(KT).toContain('verticalArrangement = Arrangement.spacedBy(6.dp)');
    expect(CSS).toContain('gap: 14px;');
    expect(CSS).toContain('padding: 14px;');
    expect(CSS).toContain('border-radius: 20px;');
    expect(TSX).toContain('width={86} height={124}');
  });

  it('标题 titleMedium SemiBold 两行；作者行「作者 · 源」12sp；事实 11sp', () => {
    expect(KT).toContain('style = MaterialTheme.typography.titleMedium');
    expect(KT).toContain('fontWeight = FontWeight.SemiBold, maxLines = 2');
    expect(KT).toContain('fontSize = 12.sp');
    expect(KT).toContain('fontSize = 11.sp');
    expect(novelAuthorLine({ author: '张三' }, '源A')).toBe('张三 · 源A');
    // 作者为空时不留下前导分隔符
    expect(novelAuthorLine({ author: '  ' }, '源A')).toBe('源A');
    expect(novelSearchFacts(null)).toEqual([]);
    expect(novelSearchFacts({ wordCount: '12万字', volumeCount: 3, chapterCount: 120 } as never)).toEqual([
      '12万字',
      '3 卷',
      '120 章',
    ]);
  });

  it('搜索卡标签顺序：状态 → 分类 → 译文/语言 → 格式（大写）', () => {
    expect(KT).toContain('NovelLabels(listOfNotNull(info?.status, info?.category, info?.translation ?: book.language, book');
    expect(
      novelSearchLabels(
        { language: 'zh', format: 'epub' },
        { status: '连载', category: '都市', translation: null } as never,
      ),
    ).toEqual(['连载', '都市', 'zh', 'EPUB']);
    // novelInfo 为 null 时仍回落 book.language（Kotlin 的 `?:` 在 `info?.` 守卫之外）
    expect(novelSearchLabels({ language: 'zh', format: 'txt' }, null)).toEqual(['zh', 'TXT']);
    expect(
      novelDetailLabels({ format: 'epub', language: 'en' }, { status: '完结', category: '奇幻' } as never),
    ).toEqual(['完结', '奇幻', 'EPUB', 'en']);
  });
});

describe('NovelBookUi.kt：详情面板排版', () => {
  it('封面宽 118 / 宽屏 150，高 = 宽 × 1.4（原先写死 106×150）', () => {
    expect(KT).toContain('val coverWidth = if (wide) 150.dp else 118.dp');
    expect(KT).toContain('Modifier.size(coverWidth, coverWidth * 1.4f)');
    expect(CSS).toContain('width: 118px;');
    expect(CSS).toContain('height: calc(118px * 1.4);');
    expect(CSS).toContain('width: 150px;');
    expect(CSS).toContain('height: calc(150px * 1.4);');
    expect(CSS).not.toContain('width: 106px;');
  });

  it('标题 24sp / 宽屏 28sp / ExtraBold；作者 14sp', () => {
    expect(KT).toContain('fontSize = if (wide) 28.sp else 24.sp');
    expect(KT).toContain('fontWeight = FontWeight.ExtraBold');
    expect(KT).toContain('style = MaterialTheme.typography.bodyMedium');
    expect(CSS).toContain('font-weight: 800;');
    expect(CSS).toContain('font-size: 24px;');
    expect(CSS).toContain('font-size: 28px;');
    expect(CSS).toContain('font-size: 14px;');
  });

  it('分栏断点 720dp 且字号缩放 < 1.45；identity 宽 270；面板横向 22dp 内边距', () => {
    expect(KT).toContain('val split = maxWidth >= 720.dp && fontScale < 1.45f');
    expect(KT).toContain('BoxWithConstraints(modifier.padding(horizontal = 22.dp))');
    expect(KT).toContain('Box(Modifier.width(270.dp)) { identityPanel() }');
    expect(CSS).toContain('@media (min-width: 720px)');
    // 窄屏 20dp、宽屏 28dp 的封面-身份间距
    expect(KT).toContain('horizontalArrangement = Arrangement.spacedBy(if (wide) 28.dp else 20.dp)');
    expect(CSS).toContain('gap: 20px;');
    expect(CSS).toContain('gap: 28px;');
  });

  it('事实卡：14dp 内边距 + 两层 14dp 间距；标签 11sp / 值 13sp Medium', () => {
    expect(KT).toContain('Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp))');
    expect(KT).toContain('Text(label, fontSize = 11.sp');
    expect(KT).toContain('Text(value, fontSize = 13.sp, fontWeight = FontWeight.Medium)');
    expect(CSS).toContain('.lib-detail__facts {');
    const factsBlock = CSS.slice(CSS.indexOf('.lib-detail__facts {'), CSS.indexOf('.lib-detail__fact {'));
    expect(factsBlock).toContain('gap: 14px;');
    expect(factsBlock).toContain('padding: 14px;');
    expect(chunkFactsIntoRows([['a', '1'], ['b', '2'], ['c', '3']])).toEqual([
      [['a', '1'], ['b', '2']],
      [['c', '3']],
    ]);
  });

  it('事实项六个标签都走 tr(...)', () => {
    const src = readFileSync('src/core/library/libraryDisplay.ts', 'utf8');
    for (const label of ['字数', '源站目录', '收录卷数', '下载大小', '出版社', '阅读版本']) {
      expect(src).toContain(`tr('${label}')`);
    }
    const facts = novelDetailFacts(
      { size: 2 * 1024 * 1024 } as never,
      { wordCount: '12万', chapterCount: 100, volumeCount: 2, publisher: '某社', translation: '简中' } as never,
    );
    expect(facts.map(([label]) => label)).toEqual(['字数', '源站目录', '收录卷数', '下载大小', '出版社', '阅读版本']);
    expect(facts[3]?.[1]).toBe('2.0 MB');
  });

  it('简介：行高 23、折叠 7 行、超过 180 字才给展开按钮', () => {
    expect(KT).toContain('maxLines = if (expanded) Int.MAX_VALUE else 7');
    expect(KT).toContain('if (synopsis.length > 180)');
    expect(KT).toContain('if (expanded) tr("收起简介") else tr("展开完整简介")');
    expect(CSS).toContain('line-height: 23px;');
    expect(CSS).toContain('-webkit-line-clamp: 7;');
    expect(TSX).toContain('synopsis.length > 180');
    expect(TSX).toContain('展开完整简介');
  });

  it('提示条：secondaryContainer@.6 + 12dp 内边距 + 8dp 间距 + 16dp 图标', () => {
    expect(KT).toContain('MaterialTheme.colorScheme.secondaryContainer.copy(alpha = .6f)');
    expect(KT).toContain('.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)');
    expect(KT).toContain('Modifier.size(16.dp)');
    expect(CSS).toContain('color-mix(in srgb, var(--lib-secondary) 60%, transparent)');
  });
});
