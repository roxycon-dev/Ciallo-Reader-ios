/**
 * smallDiscoverDesignCoverParity.test.ts —— 第十六批（69/71 行档，2 个文件，合计 140 行）。
 *
 *   · `discover/DiscoverDesign.kt`（69）—— 配色、对比度提升、空态尺寸
 *   · `source/zlibrary/parser/CoverExtractor.kt`（71）—— 十个懒加载属性 + srcset + style
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DISCOVER_ACCENT_MIN_CONTRAST,
  DISCOVER_BLACK,
  DISCOVER_EMPTY_ACTION_MIN_HEIGHT_PX,
  DISCOVER_EMPTY_DESCRIPTION_ALPHA,
  DISCOVER_EMPTY_DESCRIPTION_SP,
  DISCOVER_EMPTY_MASCOT_PX,
  DISCOVER_EMPTY_TITLE_SP,
  DISCOVER_FALL,
  DISCOVER_GLASS_PADDING_DP,
  DISCOVER_MEDALS,
  DISCOVER_RISE,
  DISCOVER_STOPPED,
  DISCOVER_TEXT_MIN_CONTRAST,
  DISCOVER_TEXT_MIX_STEP,
  DISCOVER_WARNING,
  DISCOVER_WHITE,
  compositeOver,
  contrast,
  contrastInk,
  discoverAccentText,
  discoverTintAlpha,
  luminance,
  themeText,
} from '@core/discover/design';
import { CoverExtractor } from '@core/source/zlibrary/parser/coverExtractor';
import type { HtmlElement } from '@core/source/zlibrary/parser/htmlDocument';
import { parseHtmlDocument } from '@core/source/zlibrary/parser/htmlDocument';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① discover/DiscoverDesign.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DiscoverDesign.kt：配色与对比度', () => {
  const KT = kt('discover/DiscoverDesign.kt');

  it('五个色值逐字（涨/跌/警示/停止/三枚奖牌）', () => {
    expect(KT).toContain('val DiscoverRise = Color(0xFFE5484D)');
    expect(KT).toContain('val DiscoverFall = Color(0xFF2E9E6B)');
    expect(KT).toContain('val DiscoverWarning = Color(0xFFF5A524)');
    expect(KT).toContain('val DiscoverStopped = Color(0xFF9AA0A6)');
    expect(KT).toContain('val DiscoverMedals = listOf(Color(0xFFE8B53A), Color(0xFFB8C0CC), Color(0xFFC98A5B))');
    expect([DISCOVER_RISE, DISCOVER_FALL, DISCOVER_WARNING, DISCOVER_STOPPED]).toEqual([
      0xe5484d, 0x2e9e6b, 0xf5a524, 0x9aa0a6,
    ]);
    expect([...DISCOVER_MEDALS]).toEqual([0xe8b53a, 0xb8c0cc, 0xc98a5b]);
    expect([DISCOVER_BLACK, DISCOVER_WHITE]).toEqual([0x000000, 0xffffff]);
  });

  it('luminance / contrast 按 WCAG 2.1 公式', () => {
    expect(KT).toContain('(maxOf(a.luminance(), b.luminance()) + .05f) /');
    expect(KT).toContain('(minOf(a.luminance(), b.luminance()) + .05f)');
    expect(luminance(DISCOVER_BLACK)).toBeCloseTo(0, 10);
    expect(luminance(DISCOVER_WHITE)).toBeCloseTo(1, 10);
    // 黑/白对比度 = (1+.05)/(0+.05) = 21
    expect(contrast(DISCOVER_WHITE, DISCOVER_BLACK)).toBeCloseTo(21, 6);
    // 对称
    expect(contrast(DISCOVER_WHITE, DISCOVER_BLACK)).toBe(contrast(DISCOVER_BLACK, DISCOVER_WHITE));
  });

  it('contrastInk 取黑/白中对比度更高者（等号归黑）', () => {
    expect(KT).toContain('if (contrast(Color.Black, background) >= contrast(Color.White, background)) Color.Black else Color.White');
    expect(contrastInk(DISCOVER_WHITE)).toBe(DISCOVER_BLACK);
    expect(contrastInk(DISCOVER_BLACK)).toBe(DISCOVER_WHITE);
    // 中灰上黑白对比度相等 → `>=` 走黑
    expect(contrastInk(0x808080)).toBe(DISCOVER_BLACK);
  });

  it('themeText：每步 mix += .02，直到达标或 mix 到 1', () => {
    expect(KT).toContain('var mix = 0f');
    expect(KT).toContain('mix += .02f');
    expect(KT).toContain('color = androidx.compose.ui.graphics.lerp(primary.copy(alpha = 1f), target, mix.coerceAtMost(1f))');
    expect(DISCOVER_TEXT_MIX_STEP).toBe(0.02);
    expect(DISCOVER_TEXT_MIN_CONTRAST).toBe(4.5);
    expect(DISCOVER_ACCENT_MIN_CONTRAST).toBe(5.2);

    // 白底上的浅色文字最终必须达标；已经达标的不动
    const onWhite = themeText(0xdddddd, DISCOVER_WHITE);
    expect(contrast(onWhite, DISCOVER_WHITE)).toBeGreaterThanOrEqual(DISCOVER_TEXT_MIN_CONTRAST);
    expect(themeText(DISCOVER_BLACK, DISCOVER_WHITE)).toBe(DISCOVER_BLACK);
    // 混到 1 仍未达标时停在 target（= contrastInk）
    const impossible = themeText(0xfefefe, 0xfefefe, 21);
    expect(impossible).toBe(contrastInk(0xfefefe));
  });

  it('discoverTintAlpha：surface 亮度 < .5 用 .22，否则 .14', () => {
    expect(KT).toContain('if (MaterialTheme.colorScheme.surface.luminance() < .5f) .22f else .14f');
    expect(discoverTintAlpha(0x000000)).toBe(0.22);
    expect(discoverTintAlpha(0xffffff)).toBe(0.14);
    // 0x808080 的亮度 ≈ .216 < .5 → .22
    expect(discoverTintAlpha(0x808080)).toBe(0.22);
  });

  it('compositeOver 是 src-over；discoverAccentText 用 5.2 的门槛', () => {
    expect(KT).toContain('primary.copy(alpha = if (MaterialTheme.colorScheme.surface.luminance() < .5f) .22f else .14f)');
    expect(KT).toContain('discoverTint().compositeOver(MaterialTheme.colorScheme.surface), 5.2f)');
    expect(compositeOver(DISCOVER_WHITE, 1, DISCOVER_BLACK)).toBe(DISCOVER_WHITE);
    expect(compositeOver(DISCOVER_WHITE, 0, DISCOVER_BLACK)).toBe(DISCOVER_BLACK);
    expect(compositeOver(0x808080, 0.5, 0x000000)).toBe(0x404040);

    const accent = discoverAccentText(DISCOVER_RISE, DISCOVER_WHITE);
    // 结果必须在「tint over surface」上达到 5.2
    const tinted = compositeOver(DISCOVER_RISE, 0.14, DISCOVER_WHITE);
    expect(contrast(accent, tinted)).toBeGreaterThanOrEqual(DISCOVER_ACCENT_MIN_CONTRAST - 1e-9);
  });

  it('空态常量：12 内边距、120 吉祥物、16/13 字号、.64 alpha、48 最小高、玻璃 10', () => {
    expect(KT).toContain('Column(Modifier.fillMaxWidth().padding(12.dp)');
    expect(KT).toContain('Image(painterResource(mascotResId), null, Modifier.size(120.dp))');
    expect(KT).toContain('Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold');
    expect(KT).toContain('Text(description, fontSize = 13.sp, color = discoverInk().copy(alpha = .64f)');
    expect(KT).toContain('Modifier.heightIn(min = 48.dp)');
    expect(KT).toContain('padding: PaddingValues = PaddingValues(10.dp)');
    expect(DISCOVER_EMPTY_MASCOT_PX).toBe(120);
    expect(DISCOVER_EMPTY_TITLE_SP).toBe(16);
    expect(DISCOVER_EMPTY_DESCRIPTION_SP).toBe(13);
    expect(DISCOVER_EMPTY_DESCRIPTION_ALPHA).toBe(0.64);
    expect(DISCOVER_EMPTY_ACTION_MIN_HEIGHT_PX).toBe(48);
    expect(DISCOVER_GLASS_PADDING_DP).toBe(10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② source/zlibrary/parser/CoverExtractor.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('CoverExtractor.kt：封面提取顺序', () => {
  const KT = kt('source/zlibrary/parser/CoverExtractor.kt');

  function extract(html: string): string {
    return CoverExtractor.extract(parseHtmlDocument(html) as unknown as HtmlElement);
  }

  it('十个属性按序收集（data-* 优先于 src），data:image 一律丢弃', () => {
    expect(KT).toContain('"data-src", "data-original", "data-lazy-src", "data-url", "src",');
    expect(KT).toContain('"data-cover", "data-img", "data-image", "data-background", "data-bg"');
    expect(KT).toContain('if (value.isNotBlank() && !value.startsWith("data:image"))');
    expect(extract('<img data-src="https://a/1.jpg" src="https://a/2.jpg">')).toBe('https://a/1.jpg');
    expect(extract('<img src="https://a/2.jpg">')).toBe('https://a/2.jpg');
    // 只有 data:image 时没有候选
    expect(extract('<img src="data:image/png;base64,AAA">')).toBe('');
  });

  it('srcset 取每段「第一个空格之前」的部分，img 与 picture source 都收', () => {
    expect(KT).toContain('img.attr("srcset").split(",").forEach {');
    expect(KT).toContain('val first = it.trim().substringBefore(\' \')');
    expect(KT).toContain('root.select("picture source[srcset], source[srcset]")');
    expect(extract('<img srcset="https://a/1.jpg 640w, https://a/2.jpg 1280w">')).toBe('https://a/1.jpg');
    expect(extract('<picture><source srcset="https://a/3.jpg 2x"></picture>')).toBe('https://a/3.jpg');
  });

  it('style 里的 background-image:url(...) 也收（引号可有可无）', () => {
    expect(KT).toContain('root.select("[style*=\'background-image\'], [style*=\'background\']")');
    expect(KT).toContain('Regex("url\\\\(\\\\s*[\'\\"]?([^\'\\")]+)[\'\\"]?\\\\s*\\\\)")');
    expect(extract('<div style="background-image:url(https://a/bg.jpg)"></div>')).toBe('https://a/bg.jpg');
    expect(extract("<div style=\"background:url('https://a/q.jpg')\"></div>")).toBe('https://a/q.jpg');
    expect(extract('<div style="background-image:url(&quot;https://a/d.jpg&quot;)"></div>')).toBe(
      'https://a/d.jpg',
    );
  });

  it('优先 cdn-zlib.sk / s3proxy（大小写不敏感），否则第一个 http(s) 或 //', () => {
    expect(KT).toContain('it.contains("cdn-zlib.sk", ignoreCase = true) ||');
    expect(KT).toContain('it.contains("s3proxy", ignoreCase = true)');
    expect(KT).toContain('it.startsWith("http://") || it.startsWith("https://") || it.startsWith("//")');

    expect(
      extract('<img src="https://other/1.jpg"><img src="https://CDN-ZLIB.sk/x.jpg">'),
    ).toBe('https://CDN-ZLIB.sk/x.jpg');
    expect(extract('<img src="https://s3proxy.example/c.jpg">')).toBe('https://s3proxy.example/c.jpg');
    // 没有 preferred 时取第一个 http(s)/协议相对
    expect(extract('<img src="/local/1.jpg"><img src="//cdn/2.jpg">')).toBe('//cdn/2.jpg');
  });

  it('全都不是 URL 时退回第一个候选（不是空串）', () => {
    expect(KT).toContain('} ?: clean.first()');
    expect(extract('<img src="plain-name.jpg">')).toBe('plain-name.jpg');
  });

  it('没有候选时返回空串（Kotlin L54-57 的分支）', () => {
    expect(KT).toContain('Log.d(TAG, "no cover in: ${root.outerHtml().take(900)}")');
    expect(KT).toContain('return ""');
    expect(extract('<div>no image here</div>')).toBe('');
  });

  it('去重且保持首次出现顺序', () => {
    expect(KT).toContain('.distinct()');
    expect(extract('<img src="https://a/1.jpg"><img src="https://a/1.jpg"><img src="https://a/2.jpg">')).toBe(
      'https://a/1.jpg',
    );
  });
});
