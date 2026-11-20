/**
 * smallMotionMetadataGlassParity.test.ts —— 第十五批（67–71 行档，3 个文件，合计 206 行）。
 *
 *   · `ui/theme/IosMotion.kt`（71）—— 四个时长 / 三条曲线 / 三个弹簧（E184）
 *   · `source/js/JsComicMetadata.kt`（68）—— 作者与「副标题」的边界
 *   · `ui/wenku/WenkuGlassFilters.kt`（67）—— 0.25px 量化 LRU 与四种 null（E185）
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  IOS_EASING_CSS,
  IOS_EASINGS,
  IOS_MOTION,
  SPRING,
  SPRING_SNAPPY,
  SPRING_SOFT,
  easeInOut,
  easeOut,
  easeOutQuart,
  spring,
  springSettleMs,
  springSnappy,
  springSoft,
} from '@core/ui-theme/iosMotion';
import { WenkuGlassFilters, wenkuGlassBlur, wenkuGlassFilters } from '@core/wenku/parityNames';
import { JsComicMetadata } from '@core/source/js/jsComicMetadata';
import { JSONObject } from '@core/source/js/json';
import type { HtmlDomParser } from '@core/source/js/jsPlatform';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① ui/theme/IosMotion.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('IosMotion.kt：四个时长全部转发 AppMotion（E184）', () => {
  const KT = kt('ui/theme/IosMotion.kt');

  it('FAST / NORMAL / TRANSITION / SHEET 分别是 PRESS / CONTENT / PAGE / PAGE', () => {
    expect(KT).toContain('const val FAST = AppMotion.PRESS_MS');
    expect(KT).toContain('const val NORMAL = AppMotion.CONTENT_MS');
    expect(KT).toContain('const val TRANSITION = AppMotion.PAGE_MS');
    expect(KT).toContain('const val SHEET = AppMotion.PAGE_MS');
    expect(IOS_MOTION).toEqual({ FAST: 110, NORMAL: 200, TRANSITION: 280, SHEET: 280 });
    // SHEET 与 TRANSITION 同值（都指向 PAGE_MS）—— 不是 400
    expect(IOS_MOTION.SHEET).toBe(IOS_MOTION.TRANSITION);
    expect(IOS_MOTION.SHEET).not.toBe(400);
  });

  it('三条曲线：EaseOut = easeOutCubic；EaseInOut / EaseOutQuart 逐字', () => {
    expect(KT).toContain('val EaseOut: Easing = AppMotion.easeOutCubic');
    expect(KT).toContain('val EaseInOut: Easing = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)');
    expect(KT).toContain('val EaseOutQuart: Easing = CubicBezierEasing(0.25f, 1f, 0.5f, 1f)');
    expect(IOS_EASINGS.EaseOut).toEqual({ x1: 0.215, y1: 0.61, x2: 0.355, y2: 1 });
    expect(IOS_EASINGS.EaseInOut).toEqual({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 });
    expect(IOS_EASINGS.EaseOutQuart).toEqual({ x1: 0.25, y1: 1, x2: 0.5, y2: 1 });
    expect(IOS_EASING_CSS.easeOut).toBe('cubic-bezier(0.215, 0.61, 0.355, 1)');
    // EaseOut 必须与 `AppMotion.easeOutCubic` 一致，不能是旧的 (0,0,0.58,1)
    expect(IOS_EASINGS.EaseOut).not.toEqual({ x1: 0, y1: 0, x2: 0.58, y2: 1 });
  });

  it('三个弹簧转发 AppMotion.settle / press / reorder（1/420、0.85/650、0.88/210）', () => {
    expect(KT).toContain('fun <T> spring(): SpringSpec<T> = AppMotion.settle()');
    expect(KT).toContain('fun <T> springSnappy(): SpringSpec<T> = AppMotion.press()');
    expect(KT).toContain('fun <T> springSoft(): SpringSpec<T> = AppMotion.reorder()');
    expect([SPRING.dampingRatio, SPRING.stiffness]).toEqual([1, 420]);
    expect([SPRING_SNAPPY.dampingRatio, SPRING_SNAPPY.stiffness]).toEqual([0.85, 650]);
    expect([SPRING_SOFT.dampingRatio, SPRING_SOFT.stiffness]).toEqual([0.88, 210]);
    expect(spring()).toBe(SPRING);
    expect(springSnappy()).toBe(SPRING_SNAPPY);
    expect(springSoft()).toBe(SPRING_SOFT);
  });

  it('Motion.kt 的源值逐条对得上（110/200/280 + easeOutCubic + 三个 spring）', () => {
    const motion = kt('ui/feedback/Motion.kt');
    expect(motion).toContain('const val PRESS_MS = 110');
    expect(motion).toContain('const val CONTENT_MS = 200');
    expect(motion).toContain('const val PAGE_MS = 280');
    expect(motion).toContain('val easeOutCubic: Easing = CubicBezierEasing(0.215f, 0.61f, 0.355f, 1f)');
    expect(motion).toContain('fun <T> reorder() = spring<T>(dampingRatio = 0.88f, stiffness = 210f)');
    expect(motion).toContain('fun <T> settle() = spring<T>(dampingRatio = 1f, stiffness = 420f)');
    expect(motion).toContain('fun <T> press() = spring<T>(dampingRatio = 0.85f, stiffness = 650f)');
  });

  it('settleMs 由同一闭式算出：225 / 212 / 361，且 snappy 最快', () => {
    expect(springSettleMs(1, 420)).toBe(225);
    expect(springSettleMs(0.85, 650)).toBe(212);
    expect(springSettleMs(0.88, 210)).toBe(361);
    expect(SPRING_SNAPPY.settleMs).toBeLessThan(SPRING.settleMs);
    expect(SPRING.settleMs).toBeLessThan(SPRING_SOFT.settleMs);
  });

  it('三条 ease 补间的默认时长与 CSS', () => {
    expect(KT).toContain('fun <T> easeOut(duration: Int = NORMAL)');
    expect(KT).toContain('fun <T> easeInOut(duration: Int = NORMAL)');
    expect(KT).toContain('fun <T> easeOutQuart(duration: Int = SHEET)');
    expect(easeOut().durationMillis).toBe(200);
    expect(easeInOut().durationMillis).toBe(200);
    expect(easeOutQuart().durationMillis).toBe(280);
    expect(easeOut().css).toBe('200ms cubic-bezier(0.215, 0.61, 0.355, 1)');
    expect(easeInOut().css).toBe('200ms cubic-bezier(0.42, 0, 0.58, 1)');
    expect(easeOutQuart().css).toBe('280ms cubic-bezier(0.25, 1, 0.5, 1)');
    expect(easeOut(220).css).toBe('220ms cubic-bezier(0.215, 0.61, 0.355, 1)');
  });

  it('下游 token 层已同步（tokens.ts + theme.css），不再留旧值', async () => {
    const { MOTION } = await import('../../src/ui/theme/tokens');
    expect(MOTION.fast).toBe(IOS_MOTION.FAST);
    expect(MOTION.normal).toBe(IOS_MOTION.NORMAL);
    expect(MOTION.transition).toBe(IOS_MOTION.TRANSITION);
    expect(MOTION.sheet).toBe(IOS_MOTION.SHEET);
    const css = readFileSync('src/styles/theme.css', 'utf8');
    expect(css).toContain('--motion-fast: 110ms;');
    expect(css).toContain('--motion-normal: 200ms;');
    expect(css).toContain('--motion-transition: 280ms;');
    expect(css).toContain('--ease-out: cubic-bezier(0.215, 0.61, 0.355, 1);');
    expect(css).not.toContain('--motion-fast: 150ms;');
    expect(css).not.toContain('--ease-out: cubic-bezier(0, 0, 0.58, 1);');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② source/js/JsComicMetadata.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('JsComicMetadata.kt：作者与副标题的边界', () => {
  const KT = kt('source/js/JsComicMetadata.kt');

  /** 极简 DOM：`wholeText` 只剥标签（Kotlin 用 Jsoup）。 */
  const dom: HtmlDomParser = {
    wholeText: (html: string) => html.replace(/<[^>]*>/g, ''),
  } as unknown as HtmlDomParser;

  function book(fields: Record<string, unknown>): ReturnType<typeof JsComicMetadata.book> {
    return JsComicMetadata.book(new JSONObject(JSON.stringify(fields)), 'src', 'b1', dom);
  }

  it('KDoc：Venera 源可能是字符串 / 数组 / 按类目分组的对象；**副标题绝不当作者**', () => {
    expect(KT).toContain('Venera sources use strings, arrays, or category-keyed tag objects. Never treat a subtitle as an author.');
    const ts = readFileSync('src/core/source/js/jsComicMetadata.ts', 'utf8');
    expect(ts).toContain('Never treat a subtitle as an author');
  });

  it('values()：字符串 trim 且丢弃 "null"；数组递归；对象取 name/nick/username/title 去重', () => {
    expect(KT).toContain('is String -> listOf(value.trim()).filter { it.isNotEmpty() && it != "null" }');
    expect(KT).toContain('is JSONArray -> (0 until value.length()).flatMap { values(value.opt(it)) }');
    expect(KT).toContain('values(value.opt("name")) + values(value.opt("nick")) +');
    expect(book({ author: '  理不尽  ' }).author).toBe('理不尽');
    expect(book({ author: 'null' }).author).toBe('');
    expect(book({ author: ['A', 'B'] }).author).toBe('A、B');
    expect(book({ author: { name: '甲', nick: '乙' } }).author).toBe('甲、乙');
  });

  it('作者：四个来源合并去重（author / authors / tags 类目 / `author:xxx` 前缀）', () => {
    expect(KT).toContain('val authors = (values(data.opt("author")) + values(data.opt("authors")) +');
    expect(KT).toContain('category("author", "authors", "作者", "作家") + prefixed("author")).distinct()');
    expect(book({ author: '甲', authors: '乙' }).author).toBe('甲、乙');
    // 同一个名字出现两次只留一份
    expect(book({ author: '甲', authors: '甲' }).author).toBe('甲');
    // 类目形式的 tags
    expect(book({ tags: { 作者: '丙' } }).author).toBe('丙');
    // `author:` 前缀形式（扁平数组）
    expect(book({ tags: ['author:丁', 'tag:无关'] }).author).toBe('丁');
  });

  it('画家：六个中日文类目名 + `artist:` 前缀；不进作者', () => {
    expect(KT).toContain('category("artist", "artists", "艺术家", "藝術家", "画师", "画家", "繪師", "绘师")');
    const painted = book({ tags: ['artist:戊', 'artist:己'] });
    expect(painted.comicInfo?.artists).toEqual(['戊', '己']);
    expect(painted.author).toBe('');
  });

  it('tags：类目形式展开成 `键：值`；没有类目对象才用扁平数组', () => {
    expect(KT).toContain('values(categories.opt(key)).map { "$key：$it" }');
    expect(book({ tags: { 状态: '连载中', 题材: '异世界' } }).comicInfo?.tags).toEqual([
      '状态：连载中',
      '题材：异世界',
    ]);
    expect(book({ tags: ['a', 'b'] }).comicInfo?.tags).toEqual(['a', 'b']);
  });

  it('status 三档：扁平 / 类目 / isCompleted 的布尔分支', () => {
    expect(KT).toContain('(data.opt("isCompleted") as? Boolean)?.let { if (it) tr("已完结") else tr("连载中") }');
    expect(book({ status: '连载中' }).comicInfo?.status).toBe('连载中');
    expect(book({ tags: { 状态: '已完结' } }).comicInfo?.status).toBe('已完结');
    expect(book({ isCompleted: true }).comicInfo?.status).toBe('已完结');
    expect(book({ isCompleted: false }).comicInfo?.status).toBe('连载中');
    expect(book({}).comicInfo?.status).toBeNull();
  });

  it('description：先把 `<br>` 换行再取纯文本；format 恒为「漫画」', () => {
    expect(KT).toContain('Regex("(?i)<br\\\\s*/?>")');
    expect(KT).toContain('format = "漫画"');
    expect(book({ description: '第一行<br/>第二行' }).description).toBe('第一行\n第二行');
    expect(book({}).format).toBe('漫画');
  });

  it('别名四个来源；updatedAt 三档（updateTime / updatedAt / 类目）', () => {
    expect(KT).toContain('values(data.opt("alternateTitles")) + values(data.opt("aliases")) +');
    expect(book({ aliases: 'Mushoku' }).comicInfo?.alternateTitles).toEqual(['Mushoku']);
    expect(book({ updateTime: '2026-11-17' }).comicInfo?.updatedAt).toBe('2026-11-17');
    expect(book({ updatedAt: '2026-11-16' }).comicInfo?.updatedAt).toBe('2026-11-16');
    expect(book({ tags: { 更新: '2026-11-15' } }).comicInfo?.updatedAt).toBe('2026-11-15');
    expect(book({}).comicInfo?.updatedAt).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ ui/wenku/WenkuGlassFilters.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('WenkuGlassFilters.kt：0.25px 量化 LRU（E185）', () => {
  const KT = kt('ui/wenku/WenkuGlassFilters.kt');

  it('KDoc 的两条约束：按 0.25px 量化、LRU 上限 12（常驻半径只有 1–3 个）', () => {
    expect(KT).toContain('这里按 0.25px 量化半径做极小的 LRU（同时存活的半径');
    expect(KT).toContain('private const val MAX_ENTRIES = 12');
    expect(WenkuGlassFilters.MAX_ENTRIES).toBe(12);
    expect(WenkuGlassFilters.STEP_PX).toBe(0.25);
  });

  it('半径量化到 0.25 的整数倍，同一档命中同一字符串', () => {
    expect(KT).toContain('val key = (radiusPx * 4f).roundToInt()');
    const filters = new WenkuGlassFilters();
    expect(filters.blur(22)).toBe('blur(22px)');
    expect(filters.blur(22.1)).toBe('blur(22px)');
    expect(filters.blur(22.2)).toBe('blur(22.25px)');
    expect(filters.blur(12.6)).toBe('blur(12.5px)');
    // 同一档只占一个槽
    const sizeAfter = filters.size;
    filters.blur(22.05);
    expect(filters.size).toBe(sizeAfter);
  });

  it('四种 null：≤0 / NaN / Infinity / 量化后为 0（0.1px → 0）', () => {
    expect(KT).toContain('if (radiusPx <= 0f || radiusPx.isNaN() || radiusPx.isInfinite()) return null');
    expect(KT).toContain('if (key <= 0) return null');
    const filters = new WenkuGlassFilters();
    expect(filters.blur(0)).toBeNull();
    expect(filters.blur(-3)).toBeNull();
    expect(filters.blur(Number.NaN)).toBeNull();
    expect(filters.blur(Number.POSITIVE_INFINITY)).toBeNull();
    // 0.1px * 4 = 0.4 → round = 0 → null（Kotlin 同款）
    expect(filters.blur(0.1)).toBeNull();
    expect(filters.size).toBe(0);
  });

  it('LRU 淘汰最久未用的那一档（容量 12）', () => {
    expect(KT).toContain('while (cache.size > MAX_ENTRIES) {');
    const filters = new WenkuGlassFilters();
    for (let i = 1; i <= 12; i += 1) filters.blur(i);
    expect(filters.size).toBe(12);
    // 再插一档 → 淘汰最早插入的 1px
    filters.blur(13);
    expect(filters.size).toBe(12);
    // 1px 若还在缓存里会立刻返回；被淘汰则会重新计算并再淘汰一档
    expect(filters.blur(13)).toBe('blur(13px)');
    expect(filters.size).toBe(12);
  });

  it('wenkuGlassBlur：radiusPx ≤ 0 直接返回 null（Kotlin L62 的早退）', () => {
    expect(KT).toContain('fun BackdropEffectScope.wenkuGlassBlur(radiusPx: Float) {');
    expect(KT).toContain('if (radiusPx <= 0f) return');
    expect(wenkuGlassBlur(0)).toBeNull();
    expect(wenkuGlassBlur(-1)).toBeNull();
    expect(wenkuGlassBlur(16)).toBe('blur(16px)');
    expect(wenkuGlassFilters).toBeInstanceOf(WenkuGlassFilters);
  });
});
