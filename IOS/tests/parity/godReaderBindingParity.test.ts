/**
 * godReaderBindingParity.test.ts —— 神回窗口的绑定层（`god/GodReaderBinding.kt`，183 行）。
 *
 * 五个 composable / 纯函数，核心是**四道守卫**：
 *   ① `ctx == null` 时不挂 `onOpenCurrent`（该场景未启用神回）；
 *   ② 页号必须 `coerceIn(0, max(size-1, 0))`（空页列表收敛到 0，否则会崩在 `pages[idx]`）；
 *   ③ `request == null` 或 `ctx == null` 时窗口直接 return，不渲染空壳；
 *   ④ 已加载标志为假前不渲染 —— 否则表单会用「空壳」初始化，之后永远显示默认文字
 *      （Kotlin L149-152 记录的真实用户 bug）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  createGodReaderBinding,
  godBindingBuildRequest,
  godBindingClampPageIndex,
  godBindingEnabled,
  godBindingLoadKey,
  godBindingNeedsRemoteLoader,
  godBindingOpenEdit,
  godContextWithLoader,
} from '@core/god/godReaderBinding';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/god/GodReaderBinding.kt'),
  'utf8',
);

describe('GodReaderBinding.kt：四道守卫', () => {
  it('① ctx 为 null 时不挂 onOpenCurrent（enabled = false）', () => {
    expect(KT).toContain('if (ctx != null) {');
    expect(godBindingEnabled(null)).toBe(false);
    expect(godBindingEnabled(() => undefined)).toBe(true);
    // ctx 为空时构造请求也返回 null
    expect(godBindingBuildRequest(null, [], () => 0)).toBeNull();
  });

  it('② 页号钳制：空页列表 → 0；越界/负数/NaN 都不越界', () => {
    expect(KT).toContain('val idx = latestPage().coerceIn(0, (latestPages.size - 1).coerceAtLeast(0))');
    // 空页：maxIndex 用 coerceAtLeast(0) 兜底
    expect(godBindingClampPageIndex(5, 0)).toBe(0);
    expect(godBindingClampPageIndex(-3, 10)).toBe(0);
    expect(godBindingClampPageIndex(99, 10)).toBe(9);
    expect(godBindingClampPageIndex(4, 10)).toBe(4);
    expect(godBindingClampPageIndex(Number.NaN, 10)).toBe(0);
    expect(godBindingClampPageIndex(3.9, 10)).toBe(3);
  });

  it('③ 初始 binding 的 request 为 null（窗口关闭态）', () => {
    expect(KT).toContain('val binding = remember(ctx) { GodMomentBinding() }');
    const binding = createGodReaderBinding();
    expect(binding.request).toBeNull();
  });

  it('④ 已有神回必须先加载完再渲染（否则表单用空壳初始化）', () => {
    expect(KT).toContain('if (!loaded) return');
    expect(KT).toContain('别让表单按空壳初始化');
    // 加载门 key 由 bookId + chapterId 组成
    const request = godBindingBuildRequest(
      { bookId: 7, chapterId: 'c1', bookTitle: '书', chapterTitle: '章', chapterNumber: 3 } as never,
      [{ remote: false } as never],
      () => 0,
    );
    expect(request).not.toBeNull();
    expect(godBindingLoadKey(request as never)).toBe('7\u0000c1');
  });
});

describe('GodReaderBinding.kt：请求构造', () => {
  const ctx = {
    bookId: 42,
    chapterId: 'ch-9',
    bookTitle: '书名',
    chapterTitle: '第九章',
    chapterNumber: 9,
  };

  it('contentType 固定 COMIC，字段逐个透传', () => {
    expect(KT).toContain('contentType = GodContentType.COMIC');
    const request = godBindingBuildRequest(ctx as never, [{ remote: true } as never, { remote: false } as never], () => 1);
    expect(request).not.toBeNull();
    expect(request?.contentType).toBe('comic');
    expect(request?.bookId).toBe(42);
    expect(request?.chapterId).toBe('ch-9');
    expect(request?.bookTitle).toBe('书名');
    expect(request?.chapterTitle).toBe('第九章');
    expect(request?.chapterNumber).toBe(9);
    expect(request?.pages).toHaveLength(2);
    expect(request?.initialPageIndex).toBe(1);
  });

  it('初始页号也被钳制（当前页超出页数时落到最后一页）', () => {
    const request = godBindingBuildRequest(ctx as never, [{ remote: true } as never], () => 50);
    expect(request?.initialPageIndex).toBe(0);
  });

  it('openEdit：只有漫画页来源才带页号，其它回 0', () => {
    expect(KT).toContain('initialPageIndex = (existing.source as? CoverSource.ComicPage)?.pageIndex ?: 0');
    const existing = {
      contentType: 'comic',
      bookId: 1,
      chapterId: 'c',
      bookTitle: 't',
      chapterTitle: 'ct',
      chapterNumber: 1,
      coverSource: 'comicPage:5',
    };
    const parseSource = (tag: string) =>
      tag.startsWith('comicPage')
        ? { kind: 'comicPage' as const, pageIndex: Number(tag.split(':')[1]), pageId: tag }
        : { kind: 'album' as const, uri: tag };
    expect(godBindingOpenEdit(existing as never, [], parseSource).initialPageIndex).toBe(5);
    // 非漫画页来源 → 0
    const album = { ...existing, coverSource: 'album:2' };
    expect(godBindingOpenEdit(album as never, [], parseSource).initialPageIndex).toBe(0);
  });

  it('远程 loader 只在存在远程页时构建（纯本地不拉起整套加载器）', () => {
    // Kotlin 里按「有没有远程页」决定是否构建 loader；具体表达式在不同宿主略有差异
    expect(KT).toContain('comicImageLoader');
    expect(KT).toContain('remote');
    expect(godBindingNeedsRemoteLoader([{ remote: false } as never, { remote: false } as never])).toBe(false);
    expect(godBindingNeedsRemoteLoader([{ remote: false } as never, { remote: true } as never])).toBe(true);
    expect(godBindingNeedsRemoteLoader([])).toBe(false);
  });

  it('godContextWithLoader 语义：Kotlin 是 copy(remoteLoader)，TS 侧 loader 已由端口承载', () => {
    expect(KT).toContain('ctx.copy(remoteLoader = loader)');
    const out = godContextWithLoader(ctx as never, null);
    expect(out.bookId).toBe(42);
    expect(out.chapterId).toBe('ch-9');
  });
});

describe('GodReaderBinding.kt：窗口生命周期', () => {
  it('返回键拦截：编辑窗内按返回只关窗口，不弹整条路由', () => {
    expect(KT).toContain('BackHandler { binding.request = null }');
    expect(KT).toContain('编辑窗内按返回应关闭窗口回到当前页');
  });

  it('保存后先关闭窗口再回调（避免窗口闪回）', () => {
    expect(KT).toContain('binding.request = null');
    expect(KT).toContain('onSaved(entity)');
    // 顺序：先置 null 再回调（逐行判断，两处宿主都成立）
    const lines = KT.split(/\r?\n/);
    const idx = lines.findIndex((l) => l.includes('onSaved(entity)'));
    expect(idx).toBeGreaterThan(0);
    const above = lines.slice(Math.max(0, idx - 2), idx).join('\n');
    expect(above).toContain('binding.request = null');
  });

  it('两个宿主共用同一套「先查已有再渲染」的模式', () => {
    // GodMomentHost 与 GodMomentEditHost 各出现一次 `if (!loaded) return`
    const occurrences = KT.split('if (!loaded) return').length - 1;
    expect(occurrences).toBe(2);
  });
});
