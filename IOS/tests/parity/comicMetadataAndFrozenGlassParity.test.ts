/**
 * comicMetadataAndFrozenGlassParity.test.ts
 *   ├ `ui/ComicMetadataUi.kt`（89 行）→ `@ui/components/ComicMetadataUi`
 *   └ `ui/comic/ComicFrozenGlassBackdrop.kt`（89 行）→ `@core/comic/comicFrozenGlassBackdrop`
 *
 * 两个文件都在 65–96 行档，且都属「端口看起来有、实际不对」：
 *
 *   · `ComicMetadataUi.tsx` 把 `"状态"` 也包了 `tr()` —— Kotlin L35 是**裸字面量**，
 *     同文件只有取值 / `"标签"` / 两个折叠按钮包了 `tr()`；另外 `tagName` 的
 *     `substringAfter('：').trim().ifBlank { tag }` 被写成 `|| tag`，
 *     对「冒号后只有空格」的标签判定不同。
 *   · `ComicFrozenGlassBackdrop.kt` 在端口里只剩 `parityMisc.ts` 的两行常量
 *     `{ blurRadiusDp: 24, surfaceAlpha: 0.78 }`，而这两个数**原文里一个都没有** ——
 *     真身是「五档背景色 + 纸张等比铺满 + 每页落点」的整套绘制计划（E199）。
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  COMIC_BG_COLORS,
  frozenGlassBackgroundColor,
  frozenGlassGapPx,
  frozenGlassSlotTop,
  frozenGlassSlotWidth,
  frozenGlassSlots,
  orderedSlotsForDirection,
  paperPlacement,
} from '@core/comic/comicFrozenGlassBackdrop';
import { comicSearchActions, languageName } from '@ui/components/ComicMetadataUi';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(rel, 'utf8');
}

const META_KT = 'ui/ComicMetadataUi.kt';
const GLASS_KT = 'ui/comic/ComicFrozenGlassBackdrop.kt';

/* ══════════════════════════════════════════════════════════════════════════════
   ① ComicMetadataUi.kt L19-25 comicSearchActions
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicMetadataUi.kt L19-25 comicSearchActions', () => {
  const src = kt(META_KT);

  it('L22-25 `clickable(role = Role.Button, onClickLabel = "搜索$label")` + `if (text.isNotBlank())`', () => {
    expect(src).toContain('role = Role.Button, onClickLabel = "搜索$label",');
    expect(src).toContain('onClick = { if (text.isNotBlank()) onSearch(text) },');
    const seen: string[] = [];
    const props = comicSearchActions('标签', '科幻', (v) => seen.push(v));
    expect(props.role).toBe('button');
    expect(props.type).toBe('button');
    expect(props['aria-label']).toBe('搜索标签');
    props.onClick();
    expect(seen).toEqual(['科幻']);
  });

  it('`isNotBlank()`：空白串不触发，且**原样**传出（不 trim）', () => {
    const seen: string[] = [];
    for (const blank of ['', '   ', '\u3000', '\t\n']) {
      comicSearchActions('标签', blank, (v) => seen.push(v)).onClick();
    }
    expect(seen).toEqual([]);
    const padded = comicSearchActions('书名', ' 三体 ', (v) => seen.push(v));
    padded.onClick();
    expect(seen).toEqual([' 三体 ']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② ComicMetadataUi.kt L27-86 ComicMetadataBlock 的文案与阈值
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicMetadataUi.kt L34-46 五行资料', () => {
  const src = kt(META_KT);

  it('L35-41 状态映射五支（`ongoing/completed|finished/hiatus/cancelled|canceled/else`）', () => {
    expect(src).toContain('"ongoing" -> tr("连载中")');
    expect(src).toContain('"completed", "finished" -> tr("已完结")');
    expect(src).toContain('"hiatus" -> tr("休刊中")');
    expect(src).toContain('"cancelled", "canceled" -> tr("已中止")');
    expect(src).toContain('else -> raw');
    // 大小写不敏感（`raw.lowercase()`）
    expect(src).toContain('when (raw.lowercase())');
  });

  it('五个 label 都是**裸字面量**（只有取值与「标签」/两个按钮包了 tr()）', () => {
    expect(src).toContain('add("状态" to when');
    expect(src).toContain('add("源站标注语言" to it)');
    expect(src).toContain('add("原作语言" to languageName(it))');
    expect(src).toContain('add("画师" to it.joinToString("、"))');
    expect(src).toContain('add("源站更新信息" to it)');
    expect(src).toContain('Text(tr("标签"), style = MaterialTheme.typography.bodySmall,');
    // 端口源码里 label 不得再被 tr() 包住
    const tsx = repoText('src/ui/components/ComicMetadataUi.tsx');
    expect(tsx).toContain("rows.push(['状态', mapped]);");
    expect(tsx).not.toContain("push([tr('状态')");
    expect(tsx).toContain("rows.push(['源站标注语言', language]);");
    expect(tsx).toContain("rows.push(['原作语言', languageName(originalLanguage)]);");
    expect(tsx).toContain("rows.push(['画师', artists.join('、')]);");
    expect(tsx).toContain("rows.push(['源站更新信息', updatedAt]);");
  });

  it('L44 三者皆空才整块不渲染；L47-48 `Spacer(12.dp)` + `RoundedCornerShape(14.dp)`', () => {
    expect(src).toContain('if (rows.isEmpty() && aliases.isEmpty() && tags.isEmpty()) return');
    expect(src).toContain('Spacer(Modifier.height(12.dp))');
    expect(src).toContain('Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh)');
    const tsx = repoText('src/ui/components/ComicMetadataUi.tsx');
    expect(tsx).toContain('if (rows.length === 0 && distinctAliases.length === 0 && tags.length === 0) return null;');
  });
});

describe('ComicMetadataUi.kt L32-33 / L56-57 / L65-80 别名与标签', () => {
  const src = kt(META_KT);

  it('L32 别名先滤掉与书名相同的、再 `distinct()`', () => {
    expect(src).toContain('info?.alternateTitles.orEmpty().filter { it != book.title }.distinct()');
    const tsx = repoText('src/ui/components/ComicMetadataUi.tsx');
    expect(tsx).toContain('.filter((title) => title !== book.title)');
    expect(tsx).toContain('if (!distinctAliases.includes(alias)) distinctAliases.push(alias);');
  });

  it('L56 折叠时别名 `take(3)`、`joinToString(" / ")`，且前缀是裸 `"别名："`', () => {
    expect(src).toContain('if (aliases.isNotEmpty()) Text("别名：${(if (expanded) aliases else aliases.take(3)).joinToString(" / ")}"');
    const tsx = repoText('src/ui/components/ComicMetadataUi.tsx');
    expect(tsx).toContain('const shownAliases = expanded ? distinctAliases : distinctAliases.slice(0, 3);');
    expect(tsx).toContain("`别名：${shownAliases.join(' / ')}`");
  });

  it('L65 折叠时标签 `take(6)`；L80 两个阈值合起来决定折叠按钮', () => {
    expect(src).toContain('(if (expanded) tags else tags.take(6)).forEach { tag ->');
    expect(src).toContain('if (aliases.size > 3 || tags.size > 6) PullOutTextButton(');
    const tsx = repoText('src/ui/components/ComicMetadataUi.tsx');
    expect(tsx).toContain('const shownTags = expanded ? tags : tags.slice(0, 6);');
    expect(tsx).toContain('{distinctAliases.length > 3 || tags.length > 6 ? (');
  });

  it('L80-81 两个按钮文案包了 tr()', () => {
    expect(src).toContain('Text(if (expanded) tr("收起资料") else tr("展开全部资料"))');
    expect(repoText('src/ui/components/ComicMetadataUi.tsx')).toContain(
      "{expanded ? tr('收起资料') : tr('展开全部资料')}",
    );
  });

  it('L63 标签名 `substringAfter(\'：\', tag).trim().ifBlank { tag }`：先 trim 再判空', () => {
    expect(src).toContain("val tagName = tag.substringAfter('：', tag).trim().ifBlank { tag }");
    // 「冒号后只有空格」必须回落到整个 tag（旧端口留下空白串 → 点了没反应）
    const tsx = repoText('src/ui/components/ComicMetadataUi.tsx');
    expect(tsx).toContain("const afterColon = tagSubstringAfter(tag).trim();");
    expect(tsx).toContain("const tagName = afterColon !== '' ? afterColon : tag;");
  });

  it('L74 标签 chip 显示的是**整个 tag**，搜索用的是 tagName', () => {
    expect(src).toContain('Text(tag, modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),');
    // 空白判定在 comicSearchActions 内部（L24），chip 只是把 tagName 传进去
    expect(src).toContain('if (text.isNotBlank()) onSearch(text)');
    // Kotlin 是 `comicSearchActions("标签", tagName, onSearch)` —— 空白判定在 Modifier 里
    expect(src).toContain('.comicSearchActions("标签", tagName, onSearch),');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ ComicMetadataUi.kt L88-89 languageName
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicMetadataUi.kt L88-89 languageName', () => {
  const src = kt(META_KT);

  it('`Locale.forLanguageTag(code).getDisplayLanguage(SIMPLIFIED_CHINESE).takeIf { isNotBlank } ?: code`', () => {
    expect(src).toContain('private fun languageName(code: String): String = java.util.Locale.forLanguageTag(code)');
    expect(src).toContain('.getDisplayLanguage(java.util.Locale.SIMPLIFIED_CHINESE).takeIf { it.isNotBlank() } ?: code');
    // BCP-47 → 简体中文显示名（与 getDisplayLanguage(SIMPLIFIED_CHINESE) 同源）
    expect(languageName('ja')).toBe('日语');
    expect(languageName('zh')).toBe('中文');
    expect(languageName('en')).toBe('英语');
  });

  it('未知标签回落原始 code（不是空串）', () => {
    for (const code of ['qqq']) expect(languageName(code)).toBe(code);
    // 已知语言 + 地区：两个平台都只到语言段（Java 只取语言段，Intl 取「语言（地区）」前缀）
    expect(languageName('ja-JP').startsWith('日语')).toBe(true);
    expect(languageName('')).toBe('');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ ComicFrozenGlassBackdrop.kt L49-55 五档背景色
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicFrozenGlassBackdrop.kt L49-55 五档背景色', () => {
  const src = kt(GLASS_KT);

  it('BLACK / WHITE / GRAY / PAPER 四个字面量逐字', () => {
    expect(src).toContain('ComicBgType.BLACK -> Color.Black');
    expect(src).toContain('ComicBgType.WHITE -> Color(0xFFF7F7F5)');
    expect(src).toContain('ComicBgType.GRAY -> Color(0xFF232326)');
    expect(src).toContain('ComicBgType.PAPER -> Color(0xFFF3ECDF)');
    expect(COMIC_BG_COLORS).toEqual({
      BLACK: '#000000',
      WHITE: '#F7F7F5',
      GRAY: '#232326',
      PAPER: '#F3ECDF',
      DYNAMIC_FALLBACK: '#101014',
    });
    expect(frozenGlassBackgroundColor('BLACK')).toBe('#000000');
    expect(frozenGlassBackgroundColor('WHITE')).toBe('#F7F7F5');
    expect(frozenGlassBackgroundColor('GRAY')).toBe('#232326');
    expect(frozenGlassBackgroundColor('PAPER')).toBe('#F3ECDF');
  });

  it('L54 DYNAMIC：有主色用主色，没有才用 `#101014`（不是黑）', () => {
    expect(src).toContain('ComicBgType.DYNAMIC -> dynamicColor ?: Color(0xFF101014)');
    expect(frozenGlassBackgroundColor('DYNAMIC', '#336699')).toBe('#336699');
    expect(frozenGlassBackgroundColor('DYNAMIC', null)).toBe('#101014');
    expect(frozenGlassBackgroundColor('DYNAMIC')).toBe('#101014');
    expect(frozenGlassBackgroundColor('DYNAMIC')).not.toBe('#000000');
  });

  it('`parityMisc.ts` 里那两个造出来的数已删除（原文既没有 24 也没有 0.78）', () => {
    expect(src).not.toContain('24.dp');
    expect(src).not.toContain('.78f');
    expect(src).not.toContain('blur');
    const misc = repoText('src/core/ui/parityMisc.ts');
    // 所以只钉这两个被造出来的**值**
    // `blurRadiusDp` 本身在 `rememberScreenGlassBackdrop`（LiquidGlass.kt）里是合法的，
    // 所以只钉这两个被造出来的**值**
    expect(misc).not.toContain('blurRadiusDp: 24');
    expect(misc).not.toContain('surfaceAlpha: 0.78');
    expect(misc).toContain("from '../comic/comicFrozenGlassBackdrop'");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ ComicFrozenGlassBackdrop.kt L32 / L58-84 几何
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicFrozenGlassBackdrop.kt L32 / L66-67 顺序与槽宽', () => {
  const src = kt(GLASS_KT);

  it('L32 RTL 时整体反转（LTR/TTB 保持原序）', () => {
    expect(src).toContain('val ordered = if (config.direction == ComicDirection.RTL) slots.reversed() else slots');
    expect(orderedSlotsForDirection([1, 2, 3], 'RTL')).toEqual([3, 2, 1]);
    expect(orderedSlotsForDirection([1, 2, 3], 'LTR')).toEqual([1, 2, 3]);
    expect(orderedSlotsForDirection([1, 2, 3], 'TTB')).toEqual([1, 2, 3]);
  });

  it('L66 `gap` 只在多于一页时非零；L67 槽宽 `coerceAtLeast(1f)`', () => {
    expect(src).toContain('val gap = if (bitmaps.size > 1) config.doubleGapDp.dp.toPx() else 0f');
    expect(src).toContain('val width = ((viewportSize.width - gap * (bitmaps.size - 1)) / bitmaps.size).coerceAtLeast(1f)');
    expect(frozenGlassGapPx(1, 8)).toBe(0);
    expect(frozenGlassGapPx(2, 8)).toBe(8);
    expect(frozenGlassSlotWidth(1000, 0, 1)).toBe(1000);
    expect(frozenGlassSlotWidth(1000, 8, 2)).toBe(496);
    // 视口比间距还小 → 钳到 1，不是负数
    expect(frozenGlassSlotWidth(4, 8, 2)).toBe(1);
    expect(frozenGlassSlotWidth(0, 0, 0)).toBe(1);
  });

  it('L73-77 单页恒居中；多页按 `doubleAlign`', () => {
    expect(src).toContain('val y = if (bitmaps.size == 1) (viewportSize.height - fitted.height) / 2f else when (config.doubleAlign) {');
    expect(frozenGlassSlotTop(800, 400, 1, 'TOP')).toBe(200);
    expect(frozenGlassSlotTop(800, 400, 2, 'TOP')).toBe(0);
    expect(frozenGlassSlotTop(800, 400, 2, 'CENTER')).toBe(200);
    expect(frozenGlassSlotTop(800, 400, 2, 'BOTTOM')).toBe(400);
  });
});

describe('ComicFrozenGlassBackdrop.kt L65-84 每页落点', () => {
  const src = kt(GLASS_KT);

  it('L65 空列表直接返回（不画任何页）', () => {
    expect(src).toContain('if (bitmaps.isEmpty()) return@withTransform');
    expect(
      frozenGlassSlots(
        {
          fitted: [],
          viewportWidth: 100,
          viewportHeight: 100,
          doubleGapPx: 8,
          align: 'CENTER',
          doubleShiftXPx: 0,
          doubleShiftYPx: 0,
        },
        [],
      ),
    ).toEqual([]);
  });

  it('L80-82 `clipRect` 到槽、`dstOffset` 居中、`dstSize` 至少 1', () => {
    expect(src).toContain('clipRect(left, 0f, left + width, viewportSize.height) {');
    expect(src).toContain('dstSize = IntSize(fitted.width.roundToInt().coerceAtLeast(1), fitted.height.roundToInt().coerceAtLeast(1))');
    const out = frozenGlassSlots(
      {
        fitted: [],
        viewportWidth: 1000,
        viewportHeight: 800,
        doubleGapPx: 0,
        align: 'CENTER',
        doubleShiftXPx: 0,
        doubleShiftYPx: 0,
      },
      [{ width: 400, height: 600 }],
    );
    expect(out).toHaveLength(1);
    // 单页：width = 1000，left = 0，x = 0 + (1000-400)/2 = 300，y = (800-600)/2 = 100
    expect(out[0]?.clip).toEqual({ left: 0, top: 0, right: 1000, bottom: 800 });
    expect(out[0]?.dstOffset).toEqual({ x: 300, y: 100 });
    expect(out[0]?.dstSize).toEqual({ width: 400, height: 600 });
  });

  it('两页：间距参与槽宽与 left；`doubleShift` 只在多页时生效', () => {
    const out = frozenGlassSlots(
      {
        fitted: [],
        viewportWidth: 1000,
        viewportHeight: 800,
        doubleGapPx: 8,
        align: 'TOP',
        doubleShiftXPx: 5,
        doubleShiftYPx: 7,
      },
      [
        { width: 400, height: 600 },
        { width: 400, height: 600 },
      ],
    );
    // width = (1000 - 8) / 2 = 496；left0 = 0、left1 = 504
    expect(out[0]?.clip).toEqual({ left: 0, top: 0, right: 496, bottom: 800 });
    expect(out[1]?.clip).toEqual({ left: 504, top: 0, right: 1000, bottom: 800 });
    // x = left + (496-400)/2 + 5、y = 0 + 7（TOP 档）
    expect(out[0]?.dstOffset).toEqual({ x: 53, y: 7 });
    expect(out[1]?.dstOffset).toEqual({ x: 557, y: 7 });
  });

  it('单页时 `doubleShift` 被忽略（L78-79 的两个 `if`）', () => {
    const out = frozenGlassSlots(
      {
        fitted: [],
        viewportWidth: 1000,
        viewportHeight: 800,
        doubleGapPx: 0,
        align: 'TOP',
        doubleShiftXPx: 5,
        doubleShiftYPx: 7,
      },
      [{ width: 400, height: 600 }],
    );
    // 单页：x = 300（不带 5）、y = 100（居中，不带 7）
    expect(out[0]?.dstOffset).toEqual({ x: 300, y: 100 });
  });

  it('未加载页（null）跳过落点，但**仍占槽**（`width` 按含它的 count 算）', () => {
    expect(src).toContain('bitmap ?: return@forEachIndexed');
    const out = frozenGlassSlots(
      {
        fitted: [],
        viewportWidth: 1000,
        viewportHeight: 800,
        doubleGapPx: 0,
        align: 'CENTER',
        doubleShiftXPx: 0,
        doubleShiftYPx: 0,
      },
      [null, { width: 400, height: 600 }],
    );
    expect(out).toHaveLength(1);
    // count = 2 → width = 500；第二页 left = 500
    expect(out[0]?.clip.left).toBe(500);
    expect(out[0]?.clip.right).toBe(1000);
  });
});

describe('ComicFrozenGlassBackdrop.kt L58-63 纸张纹理', () => {
  const src = kt(GLASS_KT);

  it('`scale = max(vw/pw, vh/ph)` —— 取**大**者，保证盖满', () => {
    expect(src).toContain('val scale = maxOf(viewportSize.width / paper.width, viewportSize.height / paper.height)');
    // 纸张比视口宽得多：按宽度铺满，纵向溢出
    // scale = max(1000/2000, 1000/1000) = 1 → 2000x1000，横向溢出并居中（x = -500）
    const wide = paperPlacement(2000, 1000, 1000, 1000);
    expect(wide).toEqual({ dstOffset: { x: -500, y: 0 }, dstSize: { width: 2000, height: 1000 } });
    // 纸张比视口高得多：按高度铺满，横向溢出并居中
    const tall = paperPlacement(500, 2000, 1000, 1000);
    expect(tall).toEqual({ dstOffset: { x: 0, y: -1500 }, dstSize: { width: 1000, height: 4000 } });
  });

  it('`roundToInt().coerceAtLeast(1)`：尺寸永不为 0', () => {
    expect(src).toContain('IntSize(w.roundToInt().coerceAtLeast(1), h.roundToInt().coerceAtLeast(1))');
    const p = paperPlacement(1, 1, 1, 1);
    expect(p?.dstSize).toEqual({ width: 1, height: 1 });
    const tiny = paperPlacement(0.1, 0.1, 1, 1);
    expect(tiny?.dstSize.width).toBeGreaterThanOrEqual(1);
    expect(tiny?.dstSize.height).toBeGreaterThanOrEqual(1);
  });

  it('纸张只在 PAPER 档才生成（L38-40 的 `if (bgType == PAPER)`），尺寸非法时不画', () => {
    expect(src).toContain('val paper = if (config.bgType == ComicBgType.PAPER) remember(config.paperIntensity) {');
    expect(paperPlacement(0, 100, 100, 100)).toBeNull();
    expect(paperPlacement(100, 0, 100, 100)).toBeNull();
  });
});
