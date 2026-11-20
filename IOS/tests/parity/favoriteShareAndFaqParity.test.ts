/**
 * favoriteShareAndFaqParity.test.tsx
 *   ├ `library/FavoriteShareHelper.kt`（80 行）→ `@core/library/favoriteShare`
 *   └ `ui/help/FaqExpandableItem.kt`（85 行）→ `@ui/components/help/FaqExpandableItem` +
 *       `src/styles/help.css`
 *
 * 两个文件都有实现，缺的都是**读原文的测试**。本轮的实测抓出四处偏差：
 *
 *   ① 收藏去重：Kotlin L49 `distinctBy { it.sourceId to it.comicId }` 保留**第一条**，
 *      端口用 `new Map(pairs).values()` —— `Map` 是「后写覆盖、位置留首个」，
 *      于是同 key 的两条记录保留的是**最后一条**；同一作品的两个书名会换人。
 *   ② 分享主题行：Kotlin L77 `favorites.joinToString("、")` 用的是**原始列表**（含重复），
 *      去重只作用于正文。端口用了去重后的列表 —— 「选了两本同一作品」会显示成一本。
 *   ③ FAQ 展开动画：Kotlin 走 `PullOutVisibility` = `fadeIn(tween(420, easeOutCubic)) +
 *      scaleIn(tween(420, settle), initialScale = .985f)` / 出口 `320ms retract`，
 *      端口写的是编出来的 `grid-template-rows … 250ms`，文件头还自称 `expandVertically`
 *      （而那个函数在 Kotlin 里只有 import、一次都没调用）。
 *   ④ FAQ 两个颜色：`surfaceVariant` 是 `#F0EDE5`（不是 Google grey `#F1F3F4`），
 *      描边是 `outlineVariant` `#DAD5C9`（不是拿 `onSurfaceVariant` 当描边）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  FAVORITE_SHARE_APP_LINK_SUFFIX,
  FAVORITE_SHARE_CONCURRENCY,
  FAVORITE_SHARE_EMPTY_MESSAGE,
  FAVORITE_SHARE_INVALID_LINK_MESSAGE,
  FAVORITE_SHARE_PREFS_NAME,
  FAVORITE_SHARE_SOURCE_TIMEOUT_MS,
  FAVORITE_SHARE_TIMEOUT_MESSAGE,
  FAVORITE_SHARE_TOTAL_TIMEOUT_MS,
  favoriteShareDistinct,
  favoriteShareLinkKey,
  favoriteShareText,
} from '@core/library/favoriteShare';
import type { BookSource } from '@core/source/bookSource';
import { FaqExpandableItem, hashCode } from '@ui/components/help/FaqExpandableItem';

import { androidReference } from '../helpers/androidReference';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

const SHARE_KT = 'library/FavoriteShareHelper.kt';
const FAQ_KT = 'ui/help/FaqExpandableItem.kt';

/* ══════════════════════════════════════════════════════════════════════════════
   ① FavoriteShareHelper.kt L44-47 四个常量
   ══════════════════════════════════════════════════════════════════════════════ */

const work = (comicId: string, title = `作品 ${comicId}`, sourceId = 'source') => ({
  sourceId,
  comicId,
  title,
});

function preferences() {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const source = (getShareUrl: (id: string) => Promise<string | null>) => ({ getShareUrl }) as unknown as BookSource;

describe('FavoriteShareHelper.kt L44-47 空列表 / prefs 名 / 并发 / 两个超时', () => {
  const src = kt(SHARE_KT);

  it('L44 `require(favorites.isNotEmpty()) { tr("请先选择要分享的作品") }`', async () => {
    expect(src).toContain('require(favorites.isNotEmpty()) { tr("请先选择要分享的作品") }');
    expect(FAVORITE_SHARE_EMPTY_MESSAGE).toBe('请先选择要分享的作品');
    await expect(favoriteShareText([], () => null, preferences())).rejects.toThrow('请先选择要分享的作品');
  });

  it('L45 prefs 名 `work_detail_share_links`', () => {
    expect(src).toContain('context.getSharedPreferences("work_detail_share_links", Context.MODE_PRIVATE)');
    expect(FAVORITE_SHARE_PREFS_NAME).toBe('work_detail_share_links');
    expect(favoriteShareLinkKey(work('abc'))).toBe('work_detail_share_links:["source","abc"]');
  });

  it('L46 `Semaphore(3)`、L47 `withTimeout(25_000)`、L54 `withTimeout(4_000)`', () => {
    expect(src).toContain('val semaphore = Semaphore(3)');
    expect(src).toContain('val links = withTimeout(25_000) {');
    expect(src).toContain('withTimeout(4_000) {');
    expect(FAVORITE_SHARE_CONCURRENCY).toBe(3);
    expect(FAVORITE_SHARE_TOTAL_TIMEOUT_MS).toBe(25_000);
    expect(FAVORITE_SHARE_SOURCE_TIMEOUT_MS).toBe(4_000);
  });

  it('并发上限真的是 3（不是 2、也不是不限）', async () => {
    let active = 0;
    let peak = 0;
    await favoriteShareText(
      Array.from({ length: 9 }, (_, i) => work(String(i))),
      () =>
        source(async () => {
          active += 1;
          peak = Math.max(active, peak);
          await Promise.resolve();
          active -= 1;
          throw new Error('offline');
        }),
      preferences(),
    );
    expect(peak).toBeLessThanOrEqual(FAVORITE_SHARE_CONCURRENCY);
    expect(peak).toBe(FAVORITE_SHARE_CONCURRENCY);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② FavoriteShareHelper.kt L49 distinctBy 保留**第一条**
   ══════════════════════════════════════════════════════════════════════════════ */

describe('FavoriteShareHelper.kt L49 distinctBy 保留第一条', () => {
  const src = kt(SHARE_KT);

  it('Kotlin 原文是 `distinctBy { it.sourceId to it.comicId }`', () => {
    expect(src).toContain('favorites.distinctBy { it.sourceId to it.comicId }.map { favorite -> async {');
    expect(repoText('src/core/library/favoriteShare.ts')).toContain('export function favoriteShareDistinct(');
    // 负断言：`new Map(...)` 的「后写覆盖」语义不许回来
    expect(repoText('src/core/library/favoriteShare.ts')).not.toContain('new Map(works.map');
  });

  it('同一 key 的两条记录，保留**第一条**的书名', () => {
    const first = work('c1', '三体');
    const second = work('c1', '三体（全集）');
    expect(favoriteShareDistinct([first, second])).toEqual([first]);
    expect(favoriteShareDistinct([second, first])).toEqual([second]);
    // 位置也按首次出现，不是按最后出现
    expect(favoriteShareDistinct([first, work('c2'), second]).map((w) => w.comicId)).toEqual(['c1', 'c2']);
  });

  it('正文里用的是第一条的标题，且只取一次详情链接', async () => {
    const get = vi.fn(async (id: string) => `https://example.org/t/${id}`);
    const shared = await favoriteShareText(
      [work('c1', '三体'), work('c1', '三体（全集）')],
      () => source(get),
      preferences(),
    );
    expect(get).toHaveBeenCalledTimes(1);
    expect(shared.text).toBe('《三体》\nhttps://example.org/t/c1');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ FavoriteShareHelper.kt L77 主题行用**原始列表**
   ══════════════════════════════════════════════════════════════════════════════ */

describe('FavoriteShareHelper.kt L77 `favorites.joinToString("、")` 用原始列表', () => {
  const src = kt(SHARE_KT);

  it('原文拼的是 `favorites`，不是去重结果', () => {
    expect(src).toContain('putExtra(Intent.EXTRA_SUBJECT, favorites.joinToString("、") { it.title })');
    // 去重只出现在 links 那一段（L49），正文与主题行分属两个列表
    const subjectIndex = src.indexOf('EXTRA_SUBJECT');
    const distinctIndex = src.indexOf('distinctBy');
    expect(distinctIndex).toBeGreaterThan(0);
    expect(subjectIndex).toBeGreaterThan(distinctIndex);
  });

  it('选了两本同一作品 → 主题行出现两次，正文只出现一次', async () => {
    const shared = await favoriteShareText(
      [work('c1', '三体'), work('c1', '三体（全集）')],
      () => source(async () => 'https://example.org/t/c1'),
      preferences(),
    );
    expect(shared.title).toBe('三体、三体（全集）');
    expect(shared.text.match(/https:\/\/example\.org/g)).toHaveLength(1);
  });

  it('全都没命中时的兜底串与 Kotlin L67-68 逐字一致', async () => {
    expect(src).toContain('"《${favorite.title}》\\n$link\\n（用 Ciallo Reader 打开，需启用相同书源）"');
    expect(FAVORITE_SHARE_APP_LINK_SUFFIX).toBe('（用 Ciallo Reader 打开，需启用相同书源）');
    const shared = await favoriteShareText(
      [work('opaque 编号', '私有作品', '私有源')],
      () => source(async () => null),
      preferences(),
    );
    expect(shared.text.endsWith(`\n${FAVORITE_SHARE_APP_LINK_SUFFIX}`)).toBe(true);
    expect(shared.text).toContain('ciallo://detail');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ FavoriteShareHelper.kt L52-64 三级回退与无效链接
   ══════════════════════════════════════════════════════════════════════════════ */

describe('FavoriteShareHelper.kt L52-64 三级回退', () => {
  const src = kt(SHARE_KT);

  it('L52-53 `DetailLink.valid(comicId) ?: DetailLink.valid(prefs.getString(key, null))`', () => {
    expect(src).toContain(': DetailLink.valid(prefs.getString(key, null))');
    const ts = repoText('src/core/library/favoriteShare.ts');
    expect(ts).toContain('validDetailLink(work.comicId) ?? validDetailLink(await preferences.get(key))');
  });

  it('缓存命中时**不再**请求书源（顺序不能颠倒）', async () => {
    const prefs = preferences();
    await prefs.set(favoriteShareLinkKey(work('c1')), 'https://cached.example/c1');
    const get = vi.fn(async () => 'https://fresh.example/c1');
    const shared = await favoriteShareText([work('c1')], () => source(get), prefs);
    expect(get).not.toHaveBeenCalled();
    expect(shared.text).toContain('https://cached.example/c1');
  });

  it('取到链接后写回缓存（L64）', async () => {
    const prefs = preferences();
    await favoriteShareText([work('c1')], () => source(async () => 'https://fresh.example/c1'), prefs);
    expect(prefs.values.get(favoriteShareLinkKey(work('c1')))).toBe('https://fresh.example/c1');
  });

  it('L56 `require(raw == null || DetailLink.valid(raw) != null)` + L61 带书名重抛', async () => {
    expect(src).toContain('require(raw == null || DetailLink.valid(raw) != null) { tr("书源详情链接无效") }');
    expect(src).toContain('throw IllegalStateException("《${favorite.title}》：书源详情链接无效", e)');
    expect(FAVORITE_SHARE_INVALID_LINK_MESSAGE).toBe('书源详情链接无效');
    await expect(
      favoriteShareText([work('c1', '三体')], () => source(async () => 'javascript:alert(1)'), preferences()),
    ).rejects.toThrow('《三体》：书源详情链接无效');
  });

  it('L59 `catch (_: TimeoutCancellationException) { null }` —— 超时落成 App 链接，不抛', async () => {
    vi.useFakeTimers();
    try {
      const pending = favoriteShareText(
        [work('slow')],
        () => source(() => new Promise(() => {})),
        preferences(),
      );
      await vi.advanceTimersByTimeAsync(FAVORITE_SHARE_SOURCE_TIMEOUT_MS + 1);
      const shared = await pending;
      expect(shared.text).toContain('ciallo://detail');
      // 超时后计时器要清干净，否则 25 s 的总闸会一直挂着
      expect(vi.getTimerCount()).toBe(0);
      expect(FAVORITE_SHARE_TIMEOUT_MESSAGE).toBe('获取详情链接超时，请检查网络后重试');
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ FaqExpandableItem.kt L34-83 卡片与文案
   ══════════════════════════════════════════════════════════════════════════════ */

describe('FaqExpandableItem.kt L34-50 卡片外壳', () => {
  const src = kt(FAQ_KT);
  const css = repoText('src/styles/help.css');
  const theme = kt('ui/theme/Theme.kt');

  it('L38 `RoundedCornerShape(12.dp)`', () => {
    expect(src).toContain('RoundedCornerShape(12.dp)');
    expect(css).toContain('border-radius: 12px;');
  });

  it('L40 `surfaceVariant.copy(alpha = 0.4f)` —— 底色是 `#F0EDE5`，不是 Google grey', () => {
    expect(src).toContain('containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)');
    expect(theme).toContain('surfaceVariant = Color(0xFFF0EDE5)');
    expect(css).toContain('background: rgba(240, 237, 229, 0.4);');
    expect(css).not.toContain('rgba(241, 243, 244, 0.4)');
  });

  it('L42-45 `BorderStroke(1.dp, outlineVariant.copy(alpha = 0.5f))` —— 描边用 outlineVariant', () => {
    // Kotlin 原文是 CRLF，跨行的三处断言一律用 `\r?\n`
    expect(src).toMatch(/BorderStroke\(\r?\n\s+width = 1\.dp,\r?\n\s+color = MaterialTheme\.colorScheme\.outlineVariant\.copy\(alpha = 0\.5f\)\r?\n\s+\)/);
    expect(theme).toContain('outlineVariant = Color(0xFFDAD5C9)');
    expect(css).toContain('border: 1px solid rgba(218, 213, 201, 0.5);');
    // 旧值拿 onSurfaceVariant `#61666D` 当描边，比 outlineVariant 深一档
    expect(css).not.toContain('border: 1px solid rgba(97, 102, 109, 0.5);');
  });

  it('L50 `.padding(16.dp)`：左右下 16、问题行与答案之间是 L74 的 12', () => {
    expect(src).toContain('.padding(16.dp)');
    expect(src).toContain('Spacer(modifier = Modifier.height(12.dp))');
    expect(css).toContain('padding: 16px 16px 12px;');
    expect(css).toContain('padding: 0 16px 16px;');
  });
});

describe('FaqExpandableItem.kt L57-79 问题 / 箭头 / 答案', () => {
  const src = kt(FAQ_KT);
  const css = repoText('src/styles/help.css');

  it('L60 问题 14sp Bold + `onSurface`', () => {
    expect(src).toContain('fontWeight = FontWeight.Bold,');
    expect(src).toContain('fontSize = 14.sp,');
    expect(src).toContain('modifier = Modifier.weight(1f)');
    expect(css).toContain('font-size: 14px;');
    expect(css).toContain('font-weight: 700;');
  });

  it('L66 语义随展开态切换，且 tick 恒为 MintPrimary', () => {
    expect(src).toContain('contentDescription = if (expanded) tr("收起") else tr("展开"),');
    expect(src).toContain('tint = MintPrimary,');
    const tsx = repoText('src/ui/components/help/FaqExpandableItem.tsx');
    expect(tsx).toContain("aria-label={expanded ? '收起' : '展开'}");
    expect(tsx).toContain("transform: `rotate(${expanded ? 180 : 0}deg)`");
  });

  it('L77-79 答案 13sp / `lineHeight = 20.sp` + `onSurfaceVariant`', () => {
    expect(src).toContain('fontSize = 13.sp,');
    expect(src).toContain('lineHeight = 20.sp');
    expect(kotlinFaqInk()).toContain('val InkSecondaryLight = Color(0xFF646B62)');
    expect(css).toContain('font-size: 13px;');
    expect(css).toContain('line-height: 20px;');
    expect(css).toContain('color: var(--color-medium-gray, #646b62);');
  });

  it('L37 `testTag("faq_item_${question.hashCode()}")` —— JVM hashCode 逐位一致', () => {
    expect(src).toContain('testTag("faq_item_${question.hashCode()}")');
    const tsx = repoText('src/ui/components/help/FaqExpandableItem.tsx');
    expect(tsx).toContain('data-testid={`faq_item_${hashCode(props.question)}`}');
    expect(hashCode('为什么搜索没有结果？')).toBe(jvmHashCode('为什么搜索没有结果？'));
  });
});

/** Kotlin `String.hashCode()` 的独立实现（`31*h + c`，int 溢出）。 */
function jvmHashCode(s: string): number {
  let h = 0;
  for (const ch of s) {
    h = (Math.imul(31, h) + (ch.codePointAt(0) ?? 0)) | 0;
  }
  return h;
}

function kotlinFaqInk(): string {
  return readFileSync(androidReference('app/src/main/java/com/example/ui/wenku/WenkuTokens.kt'), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ FaqExpandableItem.kt L71-72 展开动画 = PullOutVisibility（进 420 / 出 320）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('FaqExpandableItem.kt L71-72 PullOutVisibility 的 420 / 320', () => {
  const src = kt(FAQ_KT);
  const motion = kt('ui/components/PullOutMotion.kt');
  const css = repoText('src/styles/help.css');

  it('Kotlin 的 enter/exit 两个时长与两条曲线', () => {
    // 原文 CRLF：跨行处一律 `\r?\n`
    expect(src).toMatch(/PullOutVisibility\(\r?\n\s+visible = expanded\) \{/);
    expect(motion).toContain('fadeIn(tween(420, easing = CubicBezierEasing(.215f, .61f, .355f, 1f)))');
    expect(motion).toContain('scaleIn(tween(420, easing = CubicBezierEasing(.2f, 1.08f, .34f, 1f)), initialScale = .985f)');
    expect(motion).toContain('fadeOut(tween(320, easing = CubicBezierEasing(.55f, .055f, .675f, .19f)))');
    expect(motion).toContain('scaleOut(tween(320, easing = CubicBezierEasing(.55f, .055f, .675f, .19f)), targetScale = .985f)');
  });

  it('CSS 展开档写 420 / 收起档写 320（`transition` 取目标态那套，正好复现不对称）', () => {
    expect(css).toContain('grid-template-rows 420ms cubic-bezier(0.215, 0.61, 0.355, 1)');
    expect(css).toContain('transform 420ms cubic-bezier(0.2, 1.08, 0.34, 1)');
    expect(css).toContain('grid-template-rows 320ms cubic-bezier(0.55, 0.055, 0.675, 0.19)');
    expect(css).toContain('transform: scale(0.985);');
  });

  it('负断言：编出来的 250ms / `expandVertically` 调用都不许回来', () => {
    const faqBlock = css.slice(css.indexOf('.faq-item {'), css.indexOf('/* ── JsonSourceGuideCard.kt'));
    expect(faqBlock).not.toContain('250ms');
    // L7-8 只 import、不调用：钉调用形状而不是裸标识符
    expect(src).not.toContain('expandVertically(');
    expect(src).not.toContain('shrinkVertically(');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑦ 组件行为：点击切换、data-testid、答案在展开后才进布局
   ══════════════════════════════════════════════════════════════════════════════ */

interface Mounted {
  readonly root: Root;
  readonly host: HTMLDivElement;
}

const mounted: Mounted[] = [];

async function mount(node: ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  mounted.push({ root, host });
  return host;
}

afterAll(async () => {
  for (const entry of mounted) {
    await act(async () => {
      entry.root.unmount();
    });
    entry.host.remove();
  }
});

describe('FaqExpandableItem 组件行为', () => {
  it('初始收起，点一次展开、再点收起；`aria-expanded` 与 `data-open` 同步', async () => {
    // 本文件是 `.test.ts`（`vitest.config.ts` 的 parity 只收 `.ts`），所以用 createElement
    const host = await mount(
      createElement(FaqExpandableItem, { question: '为什么搜索没有结果？', answer: '确认书源已启用。' }),
    );
    const button = host.querySelector('.faq-item__header') as HTMLButtonElement;
    const body = host.querySelector('.faq-item__body') as HTMLDivElement;
    expect(host.querySelector('.faq-item')?.getAttribute('data-testid')).toBe(
      `faq_item_${jvmHashCode('为什么搜索没有结果？')}`,
    );
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(body.getAttribute('data-open')).toBe('false');
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(body.getAttribute('data-open')).toBe('true');
    expect(host.querySelector('.faq-item__answer')?.textContent).toBe('确认书源已启用。');
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(body.getAttribute('data-open')).toBe('false');
  });
});
