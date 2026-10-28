/**
 * homeShelfParity.test.ts — 回归测试：本轮「书架」逐行审查修掉的每一处 BUG /
 * MISSING 的锚点断言。
 *
 * 覆盖的文件：
 *   src/core/home/homeViewModel.ts   （纯逻辑 + 常量）
 *   src/ui/pages/HomePage.tsx        （以 homeViewModel 导出的纯函数为代理断言）
 *
 * ⚠️ HomePage 的 JSX 无法在 node 环境里直接断言，所以每条用例都指向
 * HomePage 实际调用的那个纯函数；断言失败即表示 HomePage 的行为又偏了。
 *
 * 每条用例的注释里给出 Kotlin 的行号，方便复核。
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_FAV_CATEGORY,
  AUTO_SELECT_WINDOW_MS,
  CATEGORY_EMPTY_ACTION,
  CATEGORY_EMPTY_TEST_TAG,
  CATEGORY_LOCKED_ACTION,
  CATEGORY_LOCKED_SUBTITLE,
  DEFAULT_CATEGORY_DELETE_TOAST,
  DRAG_HINT_MAX_SHOWS,
  EMPTY_FAVORITES_ACTION,
  EMPTY_FAVORITES_DESCRIPTION,
  EMPTY_FAVORITES_TEST_TAG,
  EMPTY_FAVORITES_TITLE,
  EMPTY_SHELF_ACTION,
  EMPTY_SHELF_DESCRIPTION,
  EMPTY_SHELF_IMPORT_LABEL,
  EMPTY_SHELF_TEST_TAG,
  EMPTY_SHELF_TITLE,
  FAVORITES_LOCKED_TITLE,
  LONG_PRESS_MS,
  PICK_UP_MS,
  SELECTED_SCALE,
  PRESS_SCALE,
  DRAG_SCALE,
  DIM_UNSELECTED,
  SHELF_BREATH_AMPLITUDE_DP,
  SHELF_BREATH_PERIOD_MS,
  SHELF_HEAL_LOG_TAG,
  categoryDeleteCopy,
  categoryEmptyDescription,
  categoryEmptyTitle,
  categoryLockedTitle,
  compareKotlinLowercase,
  createShelfSelection,
  endDrag,
  exitSelection,
  favCustomCategories,
  favLockedRowText,
  favoriteActionsSpec,
  bookActionsSpec,
  gridColumns,
  heroProgressPercent,
  isAllSelected,
  isFavShelfKey,
  longPressAction,
  markedFinishedBooks,
  nextDragHintShown,
  orphanBooks,
  pickDropTarget,
  planBulkMoveToCategory,
  planDropToCategory,
  planDropToFavorite,
  planDropToFavoriteCategory,
  pruneSelection,
  removedFavoritesMessage,
  resolveShelfCategory,
  selectedCategoryLocked,
  shelfAliveKeys,
  shelfHealLogMessage,
  shareTitlesText,
  sortShelfBooks,
  splitShelfKeys,
  streakDaysText,
  todayReadMinutes,
  todayReadTimeText,
  type HomeBook,
  type HomeCategory,
  type Rect,
  type ShelfSelectionState,
} from '@core/home/homeViewModel';
import type { FavoriteEntity, FavoriteItem } from '@core/library/favoriteTypes';

/* ── fixtures ─────────────────────────────────────────────────────────── */

function book(over: Partial<HomeBook> = {}): HomeBook {
  return {
    id: 1,
    title: 'A',
    author: 'au',
    filePath: '/a.txt',
    coverUri: null,
    category: '默认',
    currentChapterIndex: 0,
    scrollOffset: 0,
    isFinished: false,
    totalChapters: 0,
    contentType: 'NOVEL',
    addedTime: 0,
    lastReadTime: 0,
    sourceId: null,
    comicId: null,
    isCoverValid: false,
    ...over,
  };
}

function cat(name: string, id: number, isProtected = false): HomeCategory {
  return { id, name, isProtected };
}

function fav(over: Partial<FavoriteEntity> = {}): FavoriteEntity {
  return {
    sourceId: 'a',
    comicId: '1',
    title: 'T',
    author: '',
    coverUrl: null,
    localThumbPath: null,
    serialStatus: 'unknown',
    latestChapterId: null,
    latestChapterTitle: null,
    latestChapterUpdateAt: 0,
    lastCheckedAt: 0,
    sourceAlive: true,
    categoryName: '默认',
    favoritedAt: 0,
    sortOrder: 0,
    ...over,
  } as FavoriteEntity;
}

function favItem(f: FavoriteEntity): FavoriteItem {
  return { favorite: f, progress: null, downloadedChapters: 0 };
}

function selecting(key = '1'): ShelfSelectionState {
  return { ...createShelfSelection(), phase: 'SELECTING', scope: 'BOOK', selected: [key] };
}

/* ═══════════════════════════════════════════════════════════════════════
   1. 长按的两步语义 —— ShelfMultiSelect.kt L601–628
   ═══════════════════════════════════════════════════════════════════════ */

describe('longPressAction (ShelfMultiSelect.kt 601–628)', () => {
  it('浏览态长按只**进入多选**，不直接拿起（L605–609）', () => {
    const r = longPressAction(createShelfSelection(), '1', 1000);
    expect(r.kind).toBe('enter');
    expect(r.haptic).toBe('MEDIUM');
    expect(r.state.phase).toBe('SELECTING');
    // 之前这里直接 beginDrag ⇒ 第一次长按就把书拿起来了
    expect(r.state.phase).not.toBe('DRAGGING');
    expect(r.state.dragging).toEqual([]);
    expect(r.state.selected).toEqual(['1']);
    expect(r.state.scope).toBe('BOOK');
  });

  it('多选态长按**已选中**的那本才拿起（L610–614）', () => {
    const r = longPressAction(selecting('1'), '1', 2000);
    expect(r.kind).toBe('pickUp');
    expect(r.haptic).toBe('HEAVY');
    expect(r.state.phase).toBe('DRAGGING');
    expect(r.state.dragging[0]).toBe('1');
  });

  it('多选态长按**未选中**的本板块条目 = 选中（L620–624）', () => {
    const r = longPressAction(selecting('1'), '2', 2000);
    expect(r.kind).toBe('select');
    expect(r.haptic).toBe('SELECTION');
    expect(r.state.phase).toBe('SELECTING');
    expect(r.state.selected).toEqual(['1', '2']);
  });

  it('多选态长按**另一板块**的条目什么都不做（L615–619）', () => {
    const base = selecting('1');
    const r = longPressAction(base, 'fav::a::1', 2000);
    expect(r.kind).toBe('reject');
    expect(r.haptic).toBeNull();
    // 原样返回同一个状态对象（不改名单、不给触觉）
    expect(r.state).toBe(base);
  });

  it('拿起时被长按的那本排在最上层（L372–379）', () => {
    const base = { ...selecting('1'), selected: ['1', '2', '3'] };
    const r = longPressAction(base, '2', 2000);
    expect(r.state.dragging).toEqual(['2', '1', '3']);
  });
});

describe('long-press timing tokens (Motion.kt)', () => {
  it('LONG_PRESS_MS = 350 / PICK_UP_MS = 250', () => {
    expect(LONG_PRESS_MS).toBe(350);
    expect(PICK_UP_MS).toBe(250);
  });
  it('isRecentAutoSelect 的窗口是 500ms（ShelfMultiSelect.kt L213–214）', () => {
    expect(AUTO_SELECT_WINDOW_MS).toBe(500);
  });
  it('拖拽提示最多 3 次（HomeScreen.kt L266）', () => {
    expect(DRAG_HINT_MAX_SHOWS).toBe(3);
    expect(nextDragHintShown(2)).toBe(3);
    expect(nextDragHintShown(3)).toBe(4);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   2. 呼吸动画 —— HomeScreen.kt L750–764 / L1513–1514
   ═══════════════════════════════════════════════════════════════════════ */

describe('breathing (HomeScreen.kt 750–764, 1513–1514)', () => {
  it('周期 4000ms、幅度 ±3dp', () => {
    expect(SHELF_BREATH_PERIOD_MS).toBe(4000);
    expect(SHELF_BREATH_AMPLITUDE_DP).toBe(3);
  });
  it('缩放常量逐字一致（L1478 / 1490 / 1488 / 1504）', () => {
    expect(DRAG_SCALE).toBe(0.92);
    expect(SELECTED_SCALE).toBe(0.94);
    expect(DIM_UNSELECTED).toBe(0.85);
    expect(PRESS_SCALE).toBe(0.96);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   3. 网格列数 —— HomeScreen.kt L1023
   ═══════════════════════════════════════════════════════════════════════ */

describe('gridColumns (HomeScreen.kt 1023)', () => {
  it('((w + 24) / 150) 向下取整后夹到 [3, 6]', () => {
    expect(gridColumns(320)).toBe(3);
    expect(gridColumns(375)).toBe(2 + 1); // (399/150) = 2 → 夹到 3
    expect(gridColumns(426)).toBe(3);
    expect(gridColumns(600)).toBe(4);
    expect(gridColumns(834)).toBe(5);
    expect(gridColumns(1024)).toBe(6);
    expect(gridColumns(2000)).toBe(6);
    expect(gridColumns(100)).toBe(3);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   4. Hero 进度 —— HomeScreen.kt L1216–1220
   ═══════════════════════════════════════════════════════════════════════ */

describe('heroProgressPercent (HomeScreen.kt 1216–1220)', () => {
  it('Int 整除，不是四舍五入', () => {
    expect(heroProgressPercent(book({ currentChapterIndex: 1, totalChapters: 3 }))).toBe(33);
    expect(heroProgressPercent(book({ currentChapterIndex: 2, totalChapters: 3 }))).toBe(66);
  });
  it('totalChapters <= 0 → 32（Beautiful fallback progress）', () => {
    expect(heroProgressPercent(book({ currentChapterIndex: 0, totalChapters: 0 }))).toBe(32);
    expect(heroProgressPercent(book({ currentChapterIndex: 5, totalChapters: 0 }))).toBe(32);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   5. 孤儿书自愈 —— HomeScreen.kt L687–695
   ═══════════════════════════════════════════════════════════════════════ */

describe('ShelfHeal (HomeScreen.kt 687–695)', () => {
  it('分类列表为空时不动手（否则一上来把所有书都当孤儿）', () => {
    expect(orphanBooks([book({ category: '幽灵' })], [])).toEqual([]);
  });
  it('只捞 category 不在分类表里的书', () => {
    const keep = book({ id: 1, category: '默认' });
    const orphan = book({ id: 2, category: '已删' });
    expect(orphanBooks([keep, orphan], [cat('默认', 1)])).toEqual([orphan]);
  });
  it('日志 tag / 文案逐字一致', () => {
    expect(SHELF_HEAL_LOG_TAG).toBe('ShelfHeal');
    expect(shelfHealLogMessage(3)).toBe('捞回 3 本掉进不存在分类的书');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   6. 落点命中（12dp 粘性）—— ShelfMultiSelect.kt L150–155 / L397–411
   ═══════════════════════════════════════════════════════════════════════ */

describe('pickDropTarget (ShelfMultiSelect.kt 150–155, 397–411)', () => {
  const rects = new Map<string, Rect>([
    ['drop::cat::A', { left: 0, top: 100, right: 80, bottom: 140 }],
    ['drop::cat::B', { left: 100, top: 100, right: 180, bottom: 140 }],
  ]);
  it('命中矩形内', () => {
    expect(pickDropTarget({ x: 40, y: 120, targetRects: rects, lastHoverId: null })).toBe('drop::cat::A');
  });
  it('缝隙里不命中', () => {
    expect(pickDropTarget({ x: 90, y: 120, targetRects: rects, lastHoverId: null })).toBeNull();
  });
  it('已命中的目标有 12dp 粘性（边界含端点，与 Rect.contains 一致）', () => {
    // A 的矩形是 0..80，外扩 12dp 后是 -12..92
    expect(pickDropTarget({ x: 90, y: 120, targetRects: rects, lastHoverId: 'drop::cat::A' })).toBe(
      'drop::cat::A',
    );
    expect(pickDropTarget({ x: 92, y: 120, targetRects: rects, lastHoverId: 'drop::cat::A' })).toBe(
      'drop::cat::A',
    );
    expect(pickDropTarget({ x: 93, y: 120, targetRects: rects, lastHoverId: 'drop::cat::A' })).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   7. 四条放置计划与撤销文案 —— HomeScreen.kt L772–849 / L402–445
   ═══════════════════════════════════════════════════════════════════════ */

describe('planDropToCategory (HomeScreen.kt 772–811)', () => {
  it('分类名不存在 → 拒绝并给出原话（L777）', () => {
    const p = planDropToCategory({
      keys: ['1'],
      books: [book({ id: 1 })],
      favoriteItems: [],
      categories: [cat('默认', 1)],
      targetName: '已删',
    });
    expect(p.blockedReason).toBe('『已删』不是可用的分类，没有移动');
    expect(p.books).toEqual([]);
    expect(p.total).toBe(0);
  });

  it('书 + 收藏混合拖拽：总数与文案都用两边之和（L804–806）', () => {
    const p = planDropToCategory({
      keys: ['1', 'fav::a::9'],
      books: [book({ id: 1 })],
      favoriteItems: [favItem(fav({ sourceId: 'a', comicId: '9', categoryName: '旧' }))],
      categories: [cat('默认', 1), cat('新', 2)],
      targetName: '新',
    });
    expect(p.blockedReason).toBeNull();
    expect(p.total).toBe(2);
    expect(p.message).toBe('已移动 2 本到『新』');
    expect(p.favKeys).toEqual(['a::9']);
    expect(p.favUndo).toEqual([{ key: 'a::9', category: '旧' }]);
  });

  it('total = 0 时不弹提示（L805）', () => {
    const p = planDropToCategory({
      keys: ['99'],
      books: [book({ id: 1 })],
      favoriteItems: [],
      categories: [cat('默认', 1)],
      targetName: '默认',
    });
    expect(p.message).toBeNull();
  });
});

describe('planDropToFavorite (HomeScreen.kt 812–817)', () => {
  it('无来源的书计入 skipped（L815）', () => {
    const withSource = book({ id: 1, sourceId: 's', comicId: 'c' });
    const noSource = book({ id: 2, sourceId: null, comicId: 'c' });
    const p = planDropToFavorite([withSource, noSource]);
    expect(p.ok).toBe(1);
    expect(p.skipped).toBe(1);
    expect(p.message).toBe('已喜欢 1 本，1 本无来源已跳过');
  });
  it('全部有来源 → 已加入我喜欢的 N 本', () => {
    const p = planDropToFavorite([book({ id: 1, sourceId: 's', comicId: 'c' })]);
    expect(p.message).toBe('已加入我喜欢的 1 本');
  });
});

describe('planDropToFavoriteCategory (HomeScreen.kt 818–849)', () => {
  it('只拖了收藏 → 已移动 N 本到『X』（L841–842）', () => {
    const p = planDropToFavoriteCategory({
      keys: ['fav::a::9'],
      books: [],
      favoriteItems: [favItem(fav({ sourceId: 'a', comicId: '9' }))],
      targetName: '追更',
    });
    expect(p.message).toBe('已移动 1 本到『追更』');
  });
  it('只拖了书且有跳过 → L843 分支', () => {
    const p = planDropToFavoriteCategory({
      keys: ['1', '2'],
      books: [book({ id: 1, sourceId: 's', comicId: 'c' }), book({ id: 2 })],
      favoriteItems: [],
      targetName: '追更',
    });
    expect(p.ok).toBe(1);
    expect(p.skipped).toBe(1);
    expect(p.message).toBe('已加入『追更』1 本，1 本无来源已跳过');
  });
  it('只拖了书且无跳过 → L844 分支', () => {
    const p = planDropToFavoriteCategory({
      keys: ['1'],
      books: [book({ id: 1, sourceId: 's', comicId: 'c' })],
      favoriteItems: [],
      targetName: '追更',
    });
    expect(p.message).toBe('已加入『追更』1 本');
  });
  it('plan.books 只包含书 —— 收藏侧不许被当成书架的书去改分类（L827）', () => {
    const p = planDropToFavoriteCategory({
      keys: ['fav::a::9'],
      books: [],
      favoriteItems: [favItem(fav({ sourceId: 'a', comicId: '9' }))],
      targetName: '追更',
    });
    expect(p.books).toEqual([]);
    expect(p.favKeys).toEqual(['a::9']);
  });
});

describe('planBulkMoveToCategory (HomeScreen.kt 402–445)', () => {
  it('用全部书而不是分类过滤后的列表（L420–423）', () => {
    const p = planBulkMoveToCategory({
      pickedKeys: ['1'],
      books: [book({ id: 1, category: '默认' })],
      currentCategory: '默认',
    });
    expect(p.books.map((b) => b.id)).toEqual([1]);
    expect(p.message).toBe('已移动 1 本到『默认』');
  });
  it('混选时收藏也算进总数（L430）', () => {
    const p = planBulkMoveToCategory({
      pickedKeys: ['1', 'fav::a::9'],
      books: [book({ id: 1 })],
      currentCategory: '默认',
    });
    expect(p.favKeys).toEqual(['a::9']);
    expect(p.message).toBe('已移动 2 本到『默认』');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   8. key 前缀分流 —— HomeScreen.kt L785–788 / L822–825
   ═══════════════════════════════════════════════════════════════════════ */

describe('splitShelfKeys (ShelfSelectionHost.kt 133–135)', () => {
  it('fav:: 前缀剥掉，书本 key 原样保留', () => {
    expect(splitShelfKeys(['1', 'fav::a::9'])).toEqual({ bookKeys: ['1'], favKeys: ['a::9'] });
  });
  it('isFavShelfKey', () => {
    expect(isFavShelfKey('fav::a::9')).toBe(true);
    expect(isFavShelfKey('9')).toBe(false);
  });
  it('shelfAliveKeys 同时收录书 id 与收藏的 fav:: key（HomeScreen.kt 705–710）', () => {
    const keys = shelfAliveKeys([book({ id: 7 })], [favItem(fav({ sourceId: 'a', comicId: '9' }))]);
    expect([...keys].sort()).toEqual(['7', 'fav::a::9']);
  });
  it('pruneSelection 把搬走的 key 摘掉（宿主几何裁剪的等价物）', () => {
    const s = { ...selecting('1'), selected: ['1', '2'] };
    expect(pruneSelection(s, new Set(['2'])).selected).toEqual(['2']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   9. 松手后的状态迁移 —— ShelfSelectionHost.kt L431–443 / L760–822
   ═══════════════════════════════════════════════════════════════════════ */

describe('endDrag (ShelfMultiSelect.kt 431–443)', () => {
  it('落在非放置区：保持多选、卡片藏进 flyingHome', () => {
    const dragging = { ...selecting('1'), phase: 'DRAGGING' as const, dragging: ['1'] };
    const next = endDrag(dragging, null);
    expect(next.phase).toBe('SELECTING');
    expect(next.flyingHome).toEqual(['1']);
    expect(next.selected).toEqual(['1']);
  });
  it('落到 ♡：同样保持选中（HomePage 传 null 走这一支，见 onPointerUp 注释）', () => {
    const dragging = { ...selecting('1'), phase: 'DRAGGING' as const, dragging: ['1'] };
    const next = endDrag(dragging, null);
    expect(next.phase).toBe('SELECTING');
    expect(next.scope).toBe('BOOK');
  });
  it('落到有效分类：拖走的 key 必须被 exitSelection 清掉（L800）', () => {
    const dragging = { ...selecting('1'), phase: 'DRAGGING' as const, dragging: ['1'] };
    // HomePage 的做法：endDrag(target) → 随后 exitSelection()
    const afterExit = exitSelection();
    expect(endDrag(dragging, 'drop::cat::新').dragging).toEqual([]);
    expect(afterExit.selected).toEqual([]);
    expect(afterExit.scope).toBeNull();
    expect(afterExit.phase).toBe('BROWSE');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   10. 分类失效回退 / 隐私锁 —— HomeScreen.kt L212–221 / L299–305
   ═══════════════════════════════════════════════════════════════════════ */

describe('resolveShelfCategory (HomeScreen.kt 212–221)', () => {
  it('分类表为空 → 不动', () => {
    expect(resolveShelfCategory('默认', [])).toBeNull();
  });
  it('仍存在 → 不动', () => {
    expect(resolveShelfCategory('默认', ['默认', '悬疑'])).toBeNull();
  });
  it('失效 → 优先回「默认」', () => {
    expect(resolveShelfCategory('没了', ['悬疑', '默认'])).toBe('默认');
  });
  it('失效且没有「默认」→ 回第一行', () => {
    expect(resolveShelfCategory('没了', ['悬疑', '科幻'])).toBe('悬疑');
  });
});

describe('selectedCategoryLocked (HomeScreen.kt 299–305)', () => {
  const categories = [cat('默认', 1), cat('私密', 2, true)];
  it('隐私模式没开 → 永不锁', () => {
    expect(
      selectedCategoryLocked({
        privacyModeEnabled: false,
        protectedCategoryNames: new Set(['私密']),
        unlockedCategoryIds: new Set<number>(),
        categories,
        categoryName: '私密',
      }),
    ).toBe(false);
  });
  it('开启 + 受保护 + 未解锁 → 锁（含重启后默认选中的场景）', () => {
    expect(
      selectedCategoryLocked({
        privacyModeEnabled: true,
        protectedCategoryNames: new Set(['私密']),
        unlockedCategoryIds: new Set<number>(),
        categories,
        categoryName: '私密',
      }),
    ).toBe(true);
  });
  it('已解锁 → 不锁', () => {
    expect(
      selectedCategoryLocked({
        privacyModeEnabled: true,
        protectedCategoryNames: new Set(['私密']),
        unlockedCategoryIds: new Set([2]),
        categories,
        categoryName: '私密',
      }),
    ).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   11. 操作栏动作表 —— HomeScreen.kt L2008–2087
   ═══════════════════════════════════════════════════════════════════════ */

describe('action specs (HomeScreen.kt 2008–2087)', () => {
  it('收藏侧恒 4 项，「打开」只在恰好选中 1 本时可用', () => {
    expect(favoriteActionsSpec(0).map((a) => a.label)).toEqual(['打开', '移动', '分享', '取消喜欢']);
    expect(favoriteActionsSpec(0)[0]?.enabled).toBe(false);
    expect(favoriteActionsSpec(1)[0]?.enabled).toBe(true);
    expect(favoriteActionsSpec(2)[0]?.enabled).toBe(false);
  });
  it('书架侧恒 4 项，永远没有「喜欢 / 取消喜欢」', () => {
    expect(bookActionsSpec(3).map((a) => a.label)).toEqual(['移动', '分享', '删除下载', '更多']);
    expect(bookActionsSpec(0).every((a) => !a.enabled)).toBe(true);
  });
  it('数量不随选中数跳变（切换板块时底栏不位移）', () => {
    expect(favoriteActionsSpec(1).length).toBe(bookActionsSpec(7).length);
  });
  it('isAllSelected：空名单不算全选（HomeScreen.kt L904–905）', () => {
    expect(isAllSelected([], [])).toBe(false);
    expect(isAllSelected(['1'], ['1'])).toBe(true);
    expect(isAllSelected(['1', '2'], ['1'])).toBe(false);
  });
  it('「更多」里的标记为已读完走当前分类过滤后的书（L455）', () => {
    const list = [book({ id: 1 }), book({ id: 2 })];
    expect(markedFinishedBooks(list, ['2']).map((b) => b.id)).toEqual([2]);
  });
  it('取消喜欢文案（L2043）', () => {
    expect(removedFavoritesMessage(4)).toBe('已取消喜欢 4 部');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   12. 中文文案逐字核对
   ═══════════════════════════════════════════════════════════════════════ */

describe('中文文案逐字一致', () => {
  it('整页空态（HomeScreen.kt 1002–1006）', () => {
    expect(EMPTY_SHELF_TITLE).toBe('「书架空空如也」');
    expect(EMPTY_SHELF_DESCRIPTION).toBe(
      '您的书架还没有任何书哦！Roxy 觉得有点寂寞。您可以点击下方按钮导入本地电子书，或者直接去在线书库挑选精彩的小说！',
    );
    expect(EMPTY_SHELF_ACTION).toBe('立即前往在线书库');
    expect(EMPTY_SHELF_IMPORT_LABEL).toBe('或者 导入本地 TXT / EPUB / Comic 文件');
    expect(EMPTY_SHELF_TEST_TAG).toBe('books_empty_state');
  });
  it('分类空态（HomeScreen.kt 1426–1430）', () => {
    expect(categoryEmptyTitle()).toBe('「分类下没有图书」');
    expect(categoryEmptyDescription('悬疑')).toBe(
      '在分类『悬疑』下还没有任何图书哦。您可以点击下方按钮导入新书到该分类！',
    );
    expect(CATEGORY_EMPTY_ACTION).toBe('在此分类下导入新书');
    expect(CATEGORY_EMPTY_TEST_TAG).toBe('category_empty_state');
  });
  it('收藏空态（HomeScreen.kt 1891–1895 / FavoritesPanel.kt 215–219）', () => {
    expect(EMPTY_FAVORITES_TITLE).toBe('「还没有喜欢的漫画」');
    expect(EMPTY_FAVORITES_DESCRIPTION).toBe(
      '在漫画页点一下 ♡，喜欢的漫画都在这里 —— 不下载、不占空间，随时在线接着看。',
    );
    expect(EMPTY_FAVORITES_ACTION).toBe('去书库逛逛');
    expect(EMPTY_FAVORITES_TEST_TAG).toBe('favorites_empty_state');
  });
  it('锁定态（HomeScreen.kt 1391–1418 / 1873–1879）', () => {
    expect(categoryLockedTitle('私密')).toBe('分类『私密』已锁定');
    expect(CATEGORY_LOCKED_SUBTITLE).toBe('验证隐私密码后即可查看其中的书籍');
    expect(CATEGORY_LOCKED_ACTION).toBe('验证密码查看');
    expect(FAVORITES_LOCKED_TITLE).toBe('「我喜欢的」已锁定');
    expect(favLockedRowText()).toBe('点击验证密码后查看');
  });
  it('分类删除对话框（HomeScreen.kt 366–394）', () => {
    const def = categoryDeleteCopy('默认');
    expect(def.title).toBe('无法删除');
    expect(def.text).toBe('默认分类不可删除。');
    expect(def.confirmLabel).toBe('知道了');
    expect(def.dismissLabel).toBeNull();
    const other = categoryDeleteCopy('悬疑');
    expect(other.title).toBe('删除分类');
    expect(other.text).toBe('确定要删除分类「悬疑」吗？其中的书籍会移动到「默认」分类。');
    expect(other.confirmLabel).toBe('删除');
    expect(other.dismissLabel).toBe('取消');
    expect(DEFAULT_CATEGORY_DELETE_TOAST).toBe('默认分类不可删除');
  });
  it('统计卡（HomeScreen.kt 2308 / 1958 / 1979）', () => {
    expect(todayReadMinutes(0)).toBe(0);
    expect(todayReadMinutes(300)).toBe(5);
    expect(todayReadTimeText(300)).toBe('今日已阅读 5 分钟');
    expect(streakDaysText(7)).toBe('连续 7 天');
  });
  it('分享文本（HomeScreen.kt 2288–2291）', () => {
    expect(shareTitlesText(['甲', '乙'])).toBe('我在 Ciallo Reader里看：\n《甲》\n《乙》\n');
    expect(shareTitlesText([])).toBe('');
  });
  it('「全部」是伪分类（HomeScreen.kt 1821–1826 / FavoritesPanel.kt 251）', () => {
    expect(ALL_FAV_CATEGORY).toBe('全部');
    // 自建分类里不含兜底的「默认」
    expect(favCustomCategories(['默认', '追更', '热血'])).toEqual(['追更', '热血']);
  });
  it('排序 0/1/2 的标签（HomeScreen.kt 1279）', () => {
    const list = [book({ id: 2, title: 'b' }), book({ id: 1, title: 'A' })];
    expect(sortShelfBooks(list, 0).map((b) => b.id)).toEqual([2, 1]);
    expect(sortShelfBooks(list, 1).map((b) => b.title)).toEqual(['A', 'b']);
    expect(sortShelfBooks([...list].reverse(), 2)).toBeTruthy();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   本轮（第二轮逐行审查）新修的两处 BUG 的锚点断言
   ═══════════════════════════════════════════════════════════════════════ */

describe('pickDropTarget 的「完整可见」判定 — ShelfMultiSelect.kt L150–155', () => {
  /* 一个从顶部露出半截的胶囊：rect.top < hostTop */
  const halfOut = new Map<string, Rect>([
    ['drop::cat::A', { left: 0, top: 90, right: 80, bottom: 130 }],
    ['drop::cat::B', { left: 100, top: 100, right: 180, bottom: 140 }],
  ]);

  it('滚出宿主顶部的胶囊不命中（手指停在空白处也会命中的那条用户反馈）', () => {
    // A 的 top=90 < hostTop=100 —— 只从顶部露出 10px，手指在 90..130 之间
    expect(
      pickDropTarget({
        x: 40,
        y: 110,
        targetRects: halfOut,
        lastHoverId: null,
        hostTop: 100,
        hostBottom: 800,
      }),
    ).toBeNull();
    // B 完整可见 ⇒ 照常命中
    expect(
      pickDropTarget({
        x: 140,
        y: 120,
        targetRects: halfOut,
        lastHoverId: null,
        hostTop: 100,
        hostBottom: 800,
      }),
    ).toBe('drop::cat::B');
  });

  it('滚出宿主底部的胶囊同样不命中', () => {
    const below = new Map<string, Rect>([['drop::cat::A', { left: 0, top: 700, right: 80, bottom: 760 }]]);
    expect(
      pickDropTarget({
        x: 40,
        y: 740,
        targetRects: below,
        lastHoverId: null,
        hostTop: 0,
        hostBottom: 700,
      }),
    ).toBeNull();
  });

  it('不传宿主边界时退化为纯 contains（旧行为，保持向后兼容）', () => {
    expect(pickDropTarget({ x: 40, y: 110, targetRects: halfOut, lastHoverId: null })).toBe(
      'drop::cat::A',
    );
  });

  it('12dp 迟滞分支不受可见性判定约束（与 Kotlin moveDrag 的 kept 分支同构）', () => {
    // 手指已经移到宿主顶之外，但仍在 A 的外扩 12dp 矩形内 → 保持高亮
    expect(
      pickDropTarget({
        x: 40,
        y: 92,
        targetRects: halfOut,
        lastHoverId: 'drop::cat::A',
        hostTop: 100,
        hostBottom: 800,
      }),
    ).toBe('drop::cat::A');
  });
});

describe('Kotlin String.compareTo 排序（非 localeCompare）— HomeScreen.kt L329 / L353', () => {
  it('中文按 UTF-16 码元排，不是拼音排', () => {
    const list = [book({ id: 1, title: '甲' }), book({ id: 2, title: '乙' }), book({ id: 3, title: '丙' })];
    // 丙 U+4E19 < 乙 U+4E59 < 甲 U+7532（丙的码点是 U+4E19，不是 U+4F19；U+4F19 是「伙」）
    expect(sortShelfBooks(list, 1).map((b) => b.title.codePointAt(0))).toEqual([
      0x4e19, 0x4e59, 0x7532,
    ]);
  });

  it('混合大小写：先 lowercase 再按码元（Kotlin sortedBy { it.title.lowercase() }）', () => {
    const list = [book({ id: 1, title: 'b' }), book({ id: 2, title: 'A' })];
    // 'a' U+0061 < 'b' U+0062
    expect(sortShelfBooks(list, 1).map((b) => b.id)).toEqual([2, 1]);
    expect(compareKotlinLowercase('a', 'b')).toBeLessThan(0);
    expect(compareKotlinLowercase('b', 'a')).toBeGreaterThan(0);
    expect(compareKotlinLowercase('a', 'a')).toBe(0);
  });

  it('与 localeCompare 的结果不同（这正是原 BUG 的成因）', () => {
    const t = ['甲', '乙', '丙'];
    const codeUnit = [...t].sort((a, b) => compareKotlinLowercase(a, b));
    const locale = [...t].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    expect(codeUnit).not.toEqual(locale);
  });
});
